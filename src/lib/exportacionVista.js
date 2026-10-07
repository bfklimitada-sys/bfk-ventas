// ═══════════════════════════════════════════════════════════════
// Fase 4C: Excel de la vista filtrada de Compras y ficha PDF de una OC.
// Solo LEEN lo que la pantalla ya tiene cargado: no consultan ni modifican datos.
// ═══════════════════════════════════════════════════════════════
import * as XLSX from "xlsx";
import { facturaVigente, facturasVigentes, gananciaReal } from "./calculos.js";
import { esFactura, esNotaCredito, nombreDocumento, estadoDocumento, ETIQUETA_ESTADO, efectoMonto } from "./tributario.js";
import { estadoOperativo, etapasCompletadas, fechaCompra, fechaOC, valeVistasPendientes } from "./ocs.js";
import { productosDe, proveedoresDe } from "./busqueda.js";
import { recepcionMP } from "./mercadoPublico.js";
import { esDocumentoBancario, etiquetaMedio } from "./mediosPago.js";
import { estadoComision, nombreFinanciador, nombreVendedor } from "./asignaciones.js";

const fecha10 = (v) => (v ? String(v).slice(0, 10) : "");
const n = (v) => Number(v) || 0;

// Una fila por OC, con los montos como números (para poder sumar en Excel).
export function filasVista(ocs) {
  return (ocs || []).map((oc) => {
    const fv = facturaVigente(oc);
    const g = gananciaReal(oc);
    return {
      "OC": oc.numero_oc,
      "Fecha OC": fecha10(fechaOC(oc).valor),
      "Cliente": oc.cliente || "",
      "Entidad": oc.entidad || "",
      "RUT cliente": oc.rut_cliente || "",
      "Comuna": oc.comuna || "",
      "Vendedor": nombreVendedor(oc),
      "Comisión": estadoComision(oc).texto,
      "Venta propia": oc.es_venta_propia ? "Sí" : "No",
      "Financiador": nombreFinanciador(oc),
      "Estado": estadoOperativo(oc).texto,
      "Etapas (de 5)": etapasCompletadas(oc),
      "Venta (monto OC)": n(oc.monto_total),
      "Neto MP": oc.mp ? n(oc.mp.neto) : "",
      "IVA MP": oc.mp ? n(oc.mp.iva) : "",
      "Costo": n(oc.costo_total),
      "Ganancia": g.pesos,
      "Margen %": g.pct,
      "Fecha compra": fecha10(fechaCompra(oc)),
      "Proveedor": proveedoresDe(oc).join(" · "),
      "Productos": productosDe(oc).join(" · "),
      "Factura vigente": facturasVigentes(oc).map((f) => f.numero_factura).join(", "),
      "NC / ND": (oc.eventos_factura || []).filter((e) => !esFactura(e)).map((e) => `${nombreDocumento(e)} (${ETIQUETA_ESTADO[estadoDocumento(oc, e)]})`).join(", "),
      "Fecha factura": fecha10(fv?.fecha),
      "Facturado": n(oc.monto_facturado),
      "Cobrado": n(oc.monto_cobrado),
      "Por cobrar": Math.max(0, n(oc.monto_facturado) - n(oc.monto_cobrado)),
      "Vale vista sin cobrar": valeVistasPendientes(oc).reduce((s, e) => s + n(e.monto), 0),
      "Pagado al financiador": n(oc.monto_pagado_fin),
      "Estado financiamiento": oc.estado_pago_financiamiento || "",
      "Estado MP": oc.mp?.estado || "",
    };
  });
}

export function libroVista(ocs, { titulo = "Compras" } = {}) {
  const filas = filasVista(ocs);
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(filas.length ? filas : [{ OC: "(sin órdenes con estos filtros)" }]);
  ws["!cols"] = Object.keys(filas[0] || { OC: 1 }).map((k) => ({ wch: Math.min(40, Math.max(10, k.length + 2)) }));
  XLSX.utils.book_append_sheet(wb, ws, titulo.slice(0, 31));
  return { wb, filas };
}

export function exportarVistaExcel(ocs, { descripcion = "" } = {}) {
  const { wb, filas } = libroVista(ocs);
  const resumen = XLSX.utils.json_to_sheet([
    { Dato: "Generado", Valor: new Date().toLocaleString("es-CL") },
    { Dato: "Filtros", Valor: descripcion || "sin filtros" },
    { Dato: "Órdenes", Valor: filas.length },
    { Dato: "Venta total", Valor: filas.reduce((s, f) => s + f["Venta (monto OC)"], 0) },
    { Dato: "Ganancia total", Valor: filas.reduce((s, f) => s + f["Ganancia"], 0) },
    { Dato: "Por cobrar", Valor: filas.reduce((s, f) => s + f["Por cobrar"], 0) },
  ]);
  XLSX.utils.book_append_sheet(wb, resumen, "_Resumen");
  const fecha = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  XLSX.writeFile(wb, `bfk-compras-${fecha}.xlsx`);
  return filas.length;
}

// ── Ficha PDF de una OC (texto, A4) ───────────────────────────
const pesos = (v) => "$" + Math.round(n(v)).toLocaleString("es-CL");
const fCL = (v) => { const s = fecha10(v); return s ? `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}` : "—"; };

// Contenido de la ficha como secciones de pares (etiqueta, valor) y tablas: se prueba sin generar el PDF.
export function contenidoFicha(oc) {
  const g = gananciaReal(oc);
  const rec = recepcionMP(oc.mp?.codigo_estado);
  return [
    { titulo: "Orden de compra", pares: [
      ["Código", oc.numero_oc], ["Fecha de la OC", fCL(fechaOC(oc).valor)], ["Estado", estadoOperativo(oc).texto],
      ["Cliente", oc.cliente || "—"], ["Entidad", oc.entidad || "—"], ["RUT", oc.rut_cliente || "—"], ["Comuna", oc.comuna || "—"],
      ["Vendedor", nombreVendedor(oc)], ["Comisión", estadoComision(oc).texto], ["Venta propia", oc.es_venta_propia ? "Sí" : "No"],
      ["Financiador", nombreFinanciador(oc)], ["Plazo de pago", `${oc.dias_pago || 30} días`],
      ["Dirección de despacho", oc.direccion_entrega || "—"],
    ] },
    { titulo: "Montos", pares: [
      ["Venta (monto OC)", pesos(oc.monto_total)],
      ...(oc.mp ? [["Neto (Mercado Público)", pesos(oc.mp.neto)], ["IVA (Mercado Público)", pesos(oc.mp.iva)]] : []),
      ["Costo", pesos(oc.costo_total)], ["Ganancia", `${pesos(g.pesos)} (${g.pct}%)`],
      ["Facturado (vigente)", pesos(oc.monto_facturado)], ["Cobrado", pesos(oc.monto_cobrado)],
      ["Por cobrar", pesos(Math.max(0, n(oc.monto_facturado) - n(oc.monto_cobrado)))],
      ["Pagado al financiador", pesos(oc.monto_pagado_fin)], ["Financiamiento", oc.estado_pago_financiamiento || "—"],
    ] },
    ...(oc.mp ? [{ titulo: "Mercado Público", pares: [
      ["Estado", oc.mp.estado || "—"], ["Aceptación", oc.mp.fecha_aceptacion ? fCL(oc.mp.fecha_aceptacion) : (oc.mp.aceptada ? "Aceptada" : "No aceptada")],
      ["Recepción", rec ? rec.texto : "Sin información"], ["Revisado", fCL(oc.mp.revisado_en)],
    ] }] : []),
    { titulo: "Productos", tabla: { cols: ["Producto", "Cant.", "Venta", "Compra", "Proveedor"], filas:
      (oc.oc_productos_link || []).slice().sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0)).map((l) => [
        `${(l.origen || "venta") === "venta" ? "" : "[compra] "}${l.descripcion || ""}`, l.cantidad ?? "", l.precio_venta != null ? pesos(l.precio_venta) : "",
        l.precio_compra != null ? pesos(l.precio_compra) : "", l.proveedor || ""]) } },
    { titulo: "Etapas", tabla: { cols: ["Etapa", "Fecha", "Detalle", "Monto"], filas: [
      ...(oc.eventos_compra || []).map((e) => ["Compra", fCL(e.fecha), [e.proveedor, e.fecha_entrega_estimada ? `entrega estimada ${fCL(e.fecha_entrega_estimada)}` : ""].filter(Boolean).join(" · "), pesos(e.costo_compra)]),
      ...(oc.eventos_entrega || []).map((e) => ["Entrega", fCL(e.fecha), e.persona_recibe || "", ""]),
      ...(oc.eventos_factura || []).map((e) => [esFactura(e) ? "Factura" : esNotaCredito(e) ? "Nota de crédito" : "Nota de débito", fCL(e.fecha),
        `${nombreDocumento(e)} · ${ETIQUETA_ESTADO[estadoDocumento(oc, e)]}${e.ref_folio ? ` · ref. ${e.ref_folio} código ${e.ref_codigo}` : ""}${e.nota_credito ? ` · NC ${e.nota_credito}` : ""}${e.verificado_sii ? " · verificada SII" : ""}`,
        pesos(efectoMonto(oc, e))]),
      ...(oc.eventos_pago_cliente || []).map((e) => ["Cobro", fCL(e.fecha), `${etiquetaMedio(e)}${esDocumentoBancario(e) ? (e.cobrado_en_banco ? " · cobrado en banco" : " · sin cobrar en banco") : ""}`, pesos(e.monto)]),
      ...(oc.eventos_pago_financiamiento || []).map((e) => ["Pago financiador", fCL(e.fecha), "", pesos(e.monto)]),
    ] } },
  ];
}

export async function generarFichaPDF(oc) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const M = 14, W = 210 - 2 * M, ALTO = 297 - 14;
  let y = 16;
  const salto = (h) => { if (y + h > ALTO) { pdf.addPage(); y = 16; } };
  pdf.setFont("helvetica", "bold"); pdf.setFontSize(15);
  pdf.text(`Ficha de OC ${oc.numero_oc}`, M, y); y += 6;
  pdf.setFont("helvetica", "normal"); pdf.setFontSize(9); pdf.setTextColor(110);
  pdf.text(`BFK Ventas · generada el ${new Date().toLocaleString("es-CL")}`, M, y); pdf.setTextColor(0); y += 8;
  for (const sec of contenidoFicha(oc)) {
    salto(14);
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(11); pdf.text(sec.titulo, M, y); y += 2;
    pdf.setDrawColor(200); pdf.line(M, y, M + W, y); y += 5;
    pdf.setFontSize(9);
    if (sec.pares) {
      for (const [k, v] of sec.pares) {
        const lineas = pdf.splitTextToSize(String(v ?? "—"), W - 55);
        salto(5 * lineas.length);
        pdf.setFont("helvetica", "bold"); pdf.text(String(k), M, y);
        pdf.setFont("helvetica", "normal"); pdf.text(lineas, M + 55, y);
        y += 5 * lineas.length;
      }
    } else if (sec.tabla) {
      const anchos = sec.tabla.cols.length === 5 ? [78, 14, 28, 28, 34] : [32, 22, 100, 28];
      const fila = (celdas, negrita) => {
        const partes = celdas.map((c, i) => pdf.splitTextToSize(String(c ?? ""), anchos[i] - 2));
        const h = 4.5 * Math.max(1, ...partes.map((p) => p.length));
        salto(h);
        pdf.setFont("helvetica", negrita ? "bold" : "normal");
        let x = M; partes.forEach((p, i) => { pdf.text(p, x, y); x += anchos[i]; });
        y += h + 1;
      };
      fila(sec.tabla.cols, true);
      if (!sec.tabla.filas.length) fila(["Sin registros"], false);
      sec.tabla.filas.forEach((f) => fila(f, false));
    }
    y += 4;
  }
  pdf.save(`OC-${String(oc.numero_oc).replace(/[^A-Za-z0-9-]/g, "_")}.pdf`);
}
