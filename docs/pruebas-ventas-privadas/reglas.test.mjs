// Reglas puras de Ventas privadas (lib/ventasPrivadas.js) y PDF (lib/vpPdf.js): totales, márgenes, indicadores sin dobles
// conteos, alertas, agenda, extracción y privacidad del PDF (sin costos). Con VP_DB_URL compara los totales con la base.
// Uso: node docs/pruebas-ventas-privadas/reglas.test.mjs   (opcional VP_DB_URL=… para la comparación con la base desechable)
import { execFileSync } from "node:child_process";
import { calcularTotales, calcularLinea, indicadoresVP, alertasVP, eventosAgendaVP, propuestasDesdeTexto, tieneDatosComerciales, revisarEETT, documentoPublicoCotizacion,
  documentoDesdeEditor, itemEETTDesde, accionesCotizacion, filtrarVentas, resumenCliente, NO_INFORMADO } from "../../src/lib/ventasPrivadas.js";
import { crearPdfCotizacion } from "../../src/lib/vpPdf.js";
import { crearPdfEETTVP as crearPdfEETT } from "../../src/lib/vpEETT.js";
import { jsPDF } from "jspdf";

let ok = 0, fallas = 0;
const eq = (n, a, b) => { const v = JSON.stringify(a) === JSON.stringify(b); v ? ok++ : fallas++; if (!v) console.log(`FALLA ${n} :: esperado ${JSON.stringify(b)} obtenido ${JSON.stringify(a)}`); };
const si = (n, c) => eq(n, !!c, true);

// ── Totales (mismos números que la base en sql.test.mjs) ──
const items = [
  { cantidad: 2, precio_unitario: 350000, descuento_pct: 5, costo_unitario: 240000 },
  { cantidad: 12.5, precio_unitario: 3990, descuento_pct: 0, costo_unitario: 2100.5 },
  { cantidad: 1, precio_unitario: 180000, descuento_pct: 10 },
];
const t = calcularTotales(items);
eq("bruto/descuento/neto/IVA/total", [t.bruto, t.descuento, t.neto, t.iva, t.total], [929875, 53000, 876875, 166606, 1043481]);
eq("costo interno y líneas sin costo", [t.costo, t.sinCosto], [506256, 1]);
eq("utilidad = neto − costo", t.utilidad, 876875 - 506256);
eq("margen sobre venta neta", Math.round(t.margen * 10000) / 10000, Math.round(((876875 - 506256) / 876875) * 10000) / 10000);
eq("exenta: sin IVA", calcularTotales(items, { afecta_iva: false }).iva, 0);
eq("línea con descuento 100 %", calcularLinea({ cantidad: 3, precio_unitario: 1000, descuento_pct: 100 }).neto, 0);
eq("cantidad decimal con coma", calcularLinea({ cantidad: "2,5", precio_unitario: 1000 }).neto, 2500);
eq("redondeo .5 hacia arriba (como PostgreSQL)", calcularLinea({ cantidad: 1, precio_unitario: 0.5 }).neto, 1);

// ── Indicadores: cotizado ≠ vendido; anticipo + aplicación = un cobro ──
const vp = {
  cotizaciones: [
    { id: "c1", folio: "CP-1", estado: "enviada", estado_efectivo: "enviada", total: 500000, venta_id: null, fecha_emision: "2026-11-02", vigencia_hasta: "2026-11-08", dias_para_vencer: 2, cliente_nombre: "A" },
    { id: "c2", folio: "CP-2", estado: "aceptada", estado_efectivo: "aceptada", total: 1439156, venta_id: "v1", fecha_emision: "2026-11-01", vigencia_hasta: "2026-11-20", dias_para_vencer: 14, cliente_nombre: "B", revision_aceptada_id: "r" },
    { id: "c3", folio: "CP-3", estado: "enviada", estado_efectivo: "vencida", total: 90000, venta_id: null, fecha_emision: "2026-10-01", vigencia_hasta: "2026-10-15", dias_para_vencer: -22, cliente_nombre: "C" },
  ],
  ventas: [
    { id: "v1", folio: "OV-1", cliente_id: "B", estado: "vigente", fecha: "2026-11-05", neto: 1209375, total: 1439156, facturado: 1439156, cobrado: 719578, anticipos: 719578, saldo: 719578, por_facturar: 0, monto_vencido: 0,
      estado_entrega: "entregada", fecha_entrega_comprometida: "2026-11-04", cant_total: 16.5, cant_entregada: 16.5, plazo_pago_dias: 30, proximo_vencimiento: "2026-12-06" },
    { id: "v2", folio: "OV-2", cliente_id: "D", estado: "vigente", fecha: "2026-11-01", neto: 100000, total: 119000, facturado: 119000, cobrado: 0, anticipos: 0, saldo: 119000, por_facturar: 0, monto_vencido: 119000, primer_vencimiento: "2026-11-01",
      estado_entrega: "parcial", fecha_entrega_comprometida: "2026-11-03", cant_total: 2, cant_entregada: 1, plazo_pago_dias: 0 },
    { id: "v3", folio: "OV-3", cliente_id: "B", estado: "anulada", fecha: "2026-11-02", neto: 5000, total: 5950, facturado: 0, cobrado: 0, saldo: 5950, por_facturar: 5950, monto_vencido: 0, estado_entrega: "pendiente" },
  ],
  margenes: [{ venta_id: "v1", costo_estimado: 1006256, n_compras: 2, costo_real: 900000, costo_real_desde_gastos: 50001 }, { venta_id: "v2", costo_estimado: null }],
};
const k = indicadoresVP(vp);
eq("cotizado = solo enviadas vivas sin venta (no se suma la aceptada ni la vencida)", [k.cotizado, k.nCotizado], [500000, 1]);
eq("vendido = ventas vigentes (la anulada no cuenta)", [k.vendido, k.nVentas], [1439156 + 119000, 2]);
eq("cobrado cuenta el anticipo una sola vez", k.cobrado, 719578);
eq("saldo y vencido", [k.saldo, k.vencido], [719578 + 119000, 119000]);
eq("utilidad estimada solo con costos visibles (v2 sin costos no se supone en cero)", [k.costosVisibles, k.ventasSinCostoVisible, k.utilidadEstimada], [1, 1, 1209375 - 1006256]);
eq("utilidad real con compras", [k.ventasConCostoReal, k.utilidadReal, k.costoRealDesdeGastos], [1, 1209375 - 900000, 50001]);
eq("período por fecha de venta", indicadoresVP(vp, { desde: "2026-11-02", hasta: "2026-11-30" }).nVentas, 1);

// ── Alertas y agenda ──
const al = alertasVP(vp, "2026-11-06");
si("alerta: cotización por vencer", al.some((a) => a.filtro === "vp_cot_por_vencer" && a.oc === "CP-1"));
si("alerta: cotización vencida sin respuesta", al.some((a) => a.filtro === "vp_cot_vencida" && a.oc === "CP-3"));
si("alerta: entrega atrasada (parcial)", al.some((a) => a.filtro === "vp_entrega_atrasada" && a.oc === "OV-2"));
si("alerta: pago vencido", al.some((a) => a.filtro === "vp_pago_vencido" && a.oc === "OV-2" && a.monto === 119000));
si("sin alerta de entrega para venta entregada", !al.some((a) => a.oc === "OV-1" && /entrega/i.test(a.filtro)));
si("sin alertas de ventas anuladas", !al.some((a) => a.oc === "OV-3"));
eq("alertas ordenadas por urgencia", al[0].nivel, "alto");
si("todas las alertas con destino", al.every((a) => a.destino?.tab && a.destino?.id && a.canal === "vp"));
const ag = eventosAgendaVP(vp);
si("agenda: vence cotización, entrega comprometida y vencimiento de pago", ["cotizacion_vence", "entrega", "pago_vence"].every((tp) => ag.some((e) => e.tipo === tp)));

// ── Acciones según estado ──
eq("borrador: editar y enviar", (({ editar, enviar, aceptar }) => [editar, enviar, aceptar])(accionesCotizacion({ estado: "borrador", n_items: 2 }, { esResponsable: true })), [true, true, false]);
eq("aceptada sin venta: crear venta", accionesCotizacion({ estado: "aceptada", revision_aceptada_id: "x" }, { esResponsable: true }).crearVenta, true);
eq("aceptada con venta: no crear otra", accionesCotizacion({ estado: "aceptada", revision_aceptada_id: "x", venta_id: "v" }, { esResponsable: true }).crearVenta, false);
eq("no responsable: sin acciones de estado", accionesCotizacion({ estado: "enviada" }, { esResponsable: false }).aceptar, false);
eq("filtros de ventas", ["por_cobrar", "vencidas", "anuladas", "por_entregar"].map((e) => filtrarVentas(vp.ventas, { estado: e }).map((v) => v.folio)), [["OV-1", "OV-2"], ["OV-2"], ["OV-3"], ["OV-2"]]);
eq("resumen de cliente (sin anuladas)", (({ vendido, saldo }) => [vendido, saldo])(resumenCliente("B", vp)), [1439156, 719578]);

// ── EETT ──
si("detecta claves comerciales anidadas", tieneDatosComerciales({ items: [{ caracteristicas: [{ x: 1 }], precio_unitario: 3 }] }));
si("sin claves comerciales", !tieneDatosComerciales({ objeto: "x", items: [{ nombre: "Bomba", caracteristicas: [{ caracteristica: "Potencia", valor: "2", unidad: "HP" }] }] }));
const it = itemEETTDesde({ id: "i1", orden: 1, cantidad: 2, unidad: "UN", tipo: "producto", descripcion: "Bomba" }, { id: "p", nombre: "Bomba", marca: "X", modelo: "Y" }, { tipo_producto: "equipo", caracteristicas: [{ caracteristica: "Potencia", valor: "2", unidad: "HP" }] });
si("parámetros faltantes quedan «No informado» (no se inventan)", it.caracteristicas.some((c) => c.caracteristica === "Peso" && c.valor === NO_INFORMADO));
eq("se conservan cantidad, unidad y numeración", [it.orden, it.cantidad, it.unidad], [1, 2, "UN"]);
const rv = revisarEETT({ objeto: "S", items: [{ ...it, requisitos: [{ requisito: "Caudal", cumplimiento: "cumple" }] }] });
si("revisión: «No informado» bloquea", rv.errores.some((e) => /No informado/.test(e)));
si("revisión: cumplimiento sin respaldo bloquea", rv.errores.some((e) => /sin respaldo/.test(e)));
si("revisión: excluidos y completos pasan", !revisarEETT({ objeto: "S", items: [{ ...it, caracteristicas: it.caracteristicas.map((c) => (c.valor === NO_INFORMADO ? { ...c, excluir: true } : c)) }] }).errores.length);

// ── Extracción: solo pares presentes en el texto, con página ──
const pr = propuestasDesdeTexto(["FICHA TÉCNICA\nPotencia: 2 HP\nVoltaje: 220 V\nTexto sin dos puntos", "Peso: 18,5 kg\nPotencia: 2 HP"]);
eq("pares extraídos con unidad y página", pr.map((p) => [p.caracteristica, p.valor, p.unidad, p.pagina]), [["Potencia", "2", "HP", 1], ["Voltaje", "220", "V", 1], ["Peso", "18,5", "kg", 2]]);

// ── Documento público y PDF sin costos ──
const empresa = { razon_social: "Ingeniería y Servicios BFK Limitada", rut: "77.322.317-3", correo: "bfklimitada@gmail.com", telefonos: "+56 9 5732 2538", direccion: "Villa Celulosa Pasaje 2 #733", comuna: "Laja" };
const conCosto = { folio: "CP-2026-0001", revision: 1, fecha_emision: "2026-11-06", vigencia_hasta: "2026-11-21", cliente: { razon_social: "Maderas del Sur SpA", rut: "76.086.428-5", costo_secreto: 1 },
  items: [{ orden: 1, descripcion: "Bomba centrífuga", unidad: "UN", cantidad: 2, precio_unitario: 350000, descuento_pct: 5, subtotal_neto: 665000, costo_unitario: 240000, margen: 0.3 }],
  neto: 665000, iva: 126350, total: 791350, bruto: 700000, descuento: 35000, afecta_iva: true, tasa_iva: 0.19, costo: 480000, utilidad: 185000, empresa };
const pub = documentoPublicoCotizacion(conCosto);
si("documento público sin costo ni margen", !/costo|margen|utilidad/i.test(JSON.stringify(pub)));
const pdf = crearPdfCotizacion(conCosto, { jsPDF });
const crudo = Buffer.from(pdf.output("arraybuffer")).toString("latin1");
const pdfjsMod = await import("pdfjs-dist/legacy/build/pdf.js"); const pdfjs = pdfjsMod.getDocument ? pdfjsMod : pdfjsMod.default;
async function textoPDF(ab) { const d = await pdfjs.getDocument({ data: new Uint8Array(ab), isEvalSupported: false, useSystemFonts: false }).promise; let s = ""; for (let i = 1; i <= d.numPages; i++) s += (await (await d.getPage(i)).getTextContent()).items.map((x) => x.str).join(" ") + "\n"; return s; }
const txt = await textoPDF(pdf.output("arraybuffer"));
si("PDF contiene datos de BFK y del cliente", /77\.322\.317-3/.test(txt) && /Maderas del Sur/.test(txt) && /CP-2026-0001/.test(txt));
si("PDF contiene totales", /665\.000/.test(txt) && /126\.350/.test(txt) && /791\.350/.test(txt));
si("PDF NO contiene costos (240.000 / 480.000 / 185.000) ni palabras costo/margen/utilidad", !/240\.000|480\.000|185\.000/.test(txt) && !/costo|margen|utilidad/i.test(txt) && crudo.length > 1000);
const docEd = documentoDesdeEditor({ folio: "CP-X", revision: 0, cab: { fecha_emision: "2026-11-06", vigencia_hasta: "2026-11-20", afecta_iva: true }, cliente: { razon_social: "C" }, items: items.map((x) => ({ ...x, descripcion: "x", unidad: "UN" })), empresa });
eq("documento desde el editor = mismos totales", [docEd.neto, docEd.iva, docEd.total], [876875, 166606, 1043481]);
si("documento desde el editor sin costos", !/costo/i.test(JSON.stringify(docEd)));
let error = ""; try { crearPdfEETT({ folio: "ET-1", revision: 0, contenido: { objeto: "x", items: [{ orden: 1, precio_unitario: 2 }] } }, { jsPDF }); } catch (e) { error = e.message; }
si("PDF EETT rechaza contenido con precios", /comerciales/.test(error));
const eettPdf = crearPdfEETT({ folio: "ET-2026-0001", revision: 1, estado: "emitida", emitida_en: "2026-11-06T12:00:00Z", hash: "a".repeat(64),
  contenido: { objeto: "Suministro de bomba", alcance: "Instalación", cliente: { razon_social: "Maderas del Sur SpA", rut: "76.086.428-5" }, cotizacion: { folio: "CP-2026-0001", revision: 1 },
    items: [{ ...it, caracteristicas: it.caracteristicas.filter((c) => c.valor !== NO_INFORMADO), requisitos: [{ requisito: "Caudal 100 L/min", ofrecido: "Según curva", cumplimiento: "sin_declarar" }] }] } }, { jsPDF, empresa });
const te = await textoPDF(eettPdf.output("arraybuffer"));
si("PDF EETT con el formato de Mercado Público (título y pie de BFK)", /INFORMACI.N\s+T.CNICA DE/.test(te) && /PRODUCTOS/.test(te) && /bfklimitada@gmail\.com/.test(te));
si("PDF EETT con cotización, EETT, cliente y RUT en la tabla", /COTIZACI.N/.test(te) && /CP-2026-0001 Rev\. 1/.test(te) && /ET-2026-0001 Rev\. 1/.test(te) && /Maderas del Sur/.test(te) && /76\.086\.428-5/.test(te));
si("PDF EETT sin campos solo de Mercado Público", !/LICITACI.N/.test(te) && !/INSTITUCI.N SOLICITANTE/.test(te) && !/OC DEL CLIENTE/i.test(te));
si("PDF EETT con ítem numerado y cantidad", /1\. /.test(te) && /CANTIDAD/.test(te) && /2 UN/.test(te));
si("PDF EETT distingue requisito del cliente y ofrecido", /Requisitos del cliente/.test(te) && /Caudal 100/.test(te) && /Ofrecido: Según curva/.test(te) && !/Cumplimiento/.test(te));
si("PDF EETT sin precios ni «No informado» en características", !/\$\s?\d/.test(te) && !/Peso\s+No informado/.test(te));
{ const conOC = crearPdfEETT({ folio: "ET-2026-0001", revision: 2, estado: "emitida", emitida_en: "2026-11-07T12:00:00Z", hash: "b".repeat(64),
    contenido: { objeto: "x", cliente: { razon_social: "Maderas del Sur SpA", rut: "76.086.428-5" }, cotizacion: { folio: "CP-2026-0001", revision: 1 }, oc_cliente: { numero: "4500012345", fecha: "2026-11-07" },
      items: [{ ...it, caracteristicas: it.caracteristicas.filter((c) => c.valor !== NO_INFORMADO) }] } }, { jsPDF, empresa });
  const t2 = await textoPDF(conOC.output("arraybuffer"));
  si("PDF EETT muestra la OC del cliente cuando existe", /OC DEL CLIENTE/.test(t2) && /4500012345/.test(t2) && /07\/11\/2026/.test(t2)); }
{ const b = crearPdfEETT({ folio: "ET-2026-0002", revision: 0, estado: "borrador", contenido: { objeto: "x", cliente: { razon_social: "C" }, items: [{ ...it }] } }, { jsPDF, empresa });
  si("PDF EETT borrador marcado como no emitido", /BORRADOR - NO EMITIDO/.test(await textoPDF(b.output("arraybuffer")))); }

// ── Comparación con la base (fórmula única) ──
if (process.env.VP_DB_URL) {
  let iguales = 0; const casos = [];
  for (let n = 0; n < 60; n++) {
    const its = Array.from({ length: 1 + (n % 5) }, (_, i) => ({ cantidad: Number((((n * 7 + i * 3) % 37) + 0.25 * (i % 4)).toFixed(3)) || 1, precio_unitario: Number((((n * 991 + i * 577) % 99999) + (i % 2 ? 0.5 : 0.49)).toFixed(2)), descuento_pct: [0, 5, 12.5, 33.33, 100][(n + i) % 5] }));
    casos.push(its);
  }
  const sql = casos.map((its, n) => `select ${n}, sum(round(c*p)), sum(round(c*p*(100-d)/100)) from (values ${its.map((x) => `(${x.cantidad}::numeric(14,3), ${x.precio_unitario}::numeric(14,2), ${x.descuento_pct}::numeric(5,2))`).join(",")}) v(c,p,d)`).join(" union all ") + " order by 1;";
  const filas = execFileSync("psql", [process.env.VP_DB_URL, "-X", "-At", "-F", "|"], { input: sql, encoding: "utf8" }).trim().split("\n").map((l) => l.split("|").map(Number));
  for (const [n, b, ne] of filas) { const tt = calcularTotales(casos[n]); if (tt.bruto === b && tt.neto === ne) iguales++; else console.log("difiere", n, tt.bruto, b, tt.neto, ne); }
  const ivaSql = execFileSync("psql", [process.env.VP_DB_URL, "-X", "-At"], { input: `select string_agg(round(n*0.19)::text, ',' order by i) from unnest(array[${filas.map((f) => f[2]).join(",")}]::numeric[]) with ordinality u(n, i);`, encoding: "utf8" }).trim().split(",").map(Number);
  eq("60 cotizaciones aleatorias: bruto y neto idénticos a la base", iguales, 60);
  eq("IVA idéntico a la base", filas.map((f) => calcularTotales(casos[f[0]]).iva), ivaSql);
}

console.log(`RESUMEN reglas ventas privadas: ${ok} OK, ${fallas} FALLA(S)`);
process.exit(fallas ? 1 : 0);
