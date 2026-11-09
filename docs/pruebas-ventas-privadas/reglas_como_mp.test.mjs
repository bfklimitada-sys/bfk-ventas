// Reglas puras de la cotización privada con la experiencia de Mercado Público (lib/vpCotizacion.js) — sin red ni base.
//   · El costo de adquisición es EXACTAMENTE el de Mercado Público (mismas funciones y redondeos) en 200 casos aleatorios.
//   · El precio y los totales siguen la fórmula de ventas privadas (idéntica a la base) y el recargo solo escribe el precio.
//   · Ida y vuelta editor → base → editor sin perder ningún dato (ficha, compra, despacho compartido, tipo, unidad, código).
//   · Sin permiso de costos no viaja ningún dato interno; la ficha nunca lleva claves comerciales ni imágenes embebidas.
//   · La EETT privada toma la ficha y usa el formato de Mercado Público (Características Generales / Especificaciones).
import { calcularCotizacion } from "../../src/lib/cotizaciones.js";
import { calcularCotizacionVP, itemVacioVP, lineaParaGuardarVP, itemDesdeLinea, enviosDesdeItems, cotizacionParaEditor, precioConRecargo, descripcionDeFicha, validarItemsVP } from "../../src/lib/vpCotizacion.js";
import { calcularTotales, tieneDatosComerciales, itemEETTDesde } from "../../src/lib/ventasPrivadas.js";
import { datosPdfEETTVP } from "../../src/lib/vpEETT.js";
import { nombreArchivoCotizacion, generarPdfCotizacion } from "../../src/lib/vpPdf.js";

let ok = 0; const F = [];
const t = (n, c, det = "") => { if (c) { ok++; } else { F.push(n); console.log("FALLA", n, det); } };
let semilla = 7; const rnd = () => { semilla = (semilla * 1103515245 + 12345) % 2147483648; return semilla / 2147483648; };
const elegir = (xs) => xs[Math.floor(rnd() * xs.length)];

// 1. Costos idénticos a Mercado Público
let iguales = 0;
for (let caso = 0; caso < 200; caso++) {
  const envios = [{ key: "e1", proveedor: "A", monto: Math.round(rnd() * 30000), con_factura: rnd() > 0.3, estado: "confirmado", destino: "Calle 1, Laja", evidencia: "x" },
                  { key: "e2", proveedor: "B", monto: Math.round(rnd() * 9000), con_factura: true, estado: "pendiente", destino: "", evidencia: "" }];
  const items = Array.from({ length: 1 + Math.floor(rnd() * 4) }, (_, i) => itemVacioVP({ key: `i${i}`, cantidad: 1 + Math.floor(rnd() * 20), precio_origen: Math.round(rnd() * 500000),
    precio_incluye_iva: rnd() > 0.4, con_factura: rnd() > 0.2, envio_key: elegir(["e1", "e2", null]), precio_unitario: Math.round(rnd() * 700000), descuento_pct: elegir([0, 0, 5, 12.5]) }));
  for (const afecta of [true, false]) {
    const vp = calcularCotizacionVP({ items, envios, afecta_iva: afecta, direccion_entrega: "Calle 1, Laja" });
    const mp = calcularCotizacion({ items: items.map((x) => ({ ...x, recargo: 0 })), envios, recargo: 0, direccion_entrega: "Calle 1", comuna: "Laja", ...(afecta ? {} : { _exenta_fija: true }) });
    const mismo = vp.lineas.every((l, i) => Math.abs(l.costo_bruto - mp.lineas[i].costo_bruto) < 1e-6 && Math.abs(l.costo_neto - mp.lineas[i].costo_neto) < 1e-6 && l.envio_asignado === mp.lineas[i].envio_asignado
      && Math.abs(l.costo_real - mp.lineas[i].costo_real) < 1e-6);
    if (mismo) iguales++;
  }
}
t("R1 costo de adquisición, despacho prorrateado y costo real idénticos a Mercado Público (400 cálculos)", iguales === 400, `${iguales}/400`);

// 2. Venta con la fórmula de ventas privadas
const base = { items: [itemVacioVP({ key: "a", cantidad: 2, precio_origen: 119000, envio_key: "e", precio_unitario: 150000, descuento_pct: 5 }), itemVacioVP({ key: "b", tipo: "servicio", unidad: "GL", cantidad: 1, precio_origen: "", precio_unitario: 80000 })],
  envios: [{ key: "e", proveedor: "X", monto: 11900, con_factura: true, estado: "confirmado", destino: "Planta km 5", evidencia: "simulación" }], afecta_iva: true, direccion_entrega: "Planta km 5" };
const c = calcularCotizacionVP(base);
const ref = calcularTotales([{ cantidad: 2, precio_unitario: 150000, descuento_pct: 5, costo_unitario: 105000 }, { cantidad: 1, precio_unitario: 80000, descuento_pct: 0 }], { afecta_iva: true });
t("R2 costo unitario interno = (compra neta + despacho neto) ÷ cantidad", c.lineas[0].costo_unitario === 105000, c.lineas[0].costo_unitario);
t("R3 totales = fórmula de ventas privadas (la misma de la base)", c.totales.neto === ref.neto && c.totales.iva === ref.iva && c.totales.total === ref.total && c.totales.costo === ref.costo && c.totales.sinCosto === 1, JSON.stringify(c.totales));
t("R4 un servicio no exige despacho; sin precio de compra se avisa y queda «sin costo»", !c.lineas[1].avisos.some((a) => /despacho/.test(a)) && c.lineas[1].avisos.some((a) => /precio de compra/.test(a)) && c.lineas[1].costo_unitario == null);
t("R5 recargo sobre costo = precio ÷ costo − 1 (informativo)", Math.abs(c.lineas[0].recargo - (150000 / 105000 - 1)) < 1e-9);
t("R6 recargo → precio redondeado hacia arriba (como Mercado Público)", precioConRecargo(105000, 0.3) === 136500 && precioConRecargo(100.01, 0.3) === 131 && precioConRecargo(null, 0.3) === null);
const exenta = calcularCotizacionVP({ ...base, afecta_iva: false });
t("R7 exenta: IVA de compras no recuperable es costo, IVA de venta 0", exenta.lineas[0].costo_unitario === 124950 && exenta.totales.iva === 0);
t("R8 dirección distinta a la verificada → aviso", calcularCotizacionVP({ ...base, direccion_entrega: "Otra 123" }).lineas[0].avisos.some((a) => /se verificó para/.test(a)));

// 3. Ida y vuelta editor → base → editor
const ficha = { nombre: "Bomba centrífuga", marca: "Pedrollo", modelo: "CPm 680", color: "Azul", generales: [{ etiqueta: "Material", valor: "Hierro" }], especificaciones: [{ etiqueta: "Potencia", valor: "2 HP" }], descripcion: "Para riego", imagenes: ["data:image/jpeg;base64,AAAA"] };
const it = { ...base.items[0], ficha, ficha_aprobada: true, codigo: "B-1", proveedor: "Ferretería", enlace: "https://x.invalid/p", enlace_original: "https://x.invalid/orig", costo_nota: "nota" };
const linea = lineaParaGuardarVP(it, c.lineas[0], { imagenes: ["img/aaa.jpg"], envio: base.envios[0], conCostos: true });
t("R9 la ficha guardada lleva rutas del depósito (no imágenes embebidas) y ninguna clave comercial", linea.ficha.imagenes.join() === "img/aaa.jpg" && !tieneDatosComerciales(linea.ficha));
t("R10 descripción de la línea = nombre + marca y modelo", linea.descripcion === "Bomba centrífuga · Pedrollo CPm 680" && descripcionDeFicha({ nombre: "Bomba Pedrollo CPm 680", marca: "Pedrollo", modelo: "CPm 680" }) === "Bomba Pedrollo CPm 680");
const fila = { id: "L1", revision_id: "R", orden: 1, ...linea };
const costo = { item_id: "L1", costo_unitario: linea.costo_unitario, nota: linea.costo_nota, proveedor: linea.proveedor, enlace: linea.enlace, enlace_original: linea.enlace_original, precio_compra: linea.precio_compra, precio_incluye_iva: linea.precio_incluye_iva, con_factura: linea.con_factura, despacho: linea.despacho };
const vuelta = itemDesdeLinea(fila, costo); const env = enviosDesdeItems([vuelta]);
const campos = ["producto_id", "tipo", "unidad", "codigo", "cantidad", "precio_unitario", "descuento_pct", "enlace", "enlace_original", "proveedor", "precio_origen", "precio_incluye_iva", "con_factura", "envio_key", "costo_nota", "ficha_aprobada"];
t("R11 ida y vuelta sin perder datos del ítem", campos.every((k) => String(vuelta[k] ?? "") === String(it[k] ?? "")), JSON.stringify(campos.filter((k) => String(vuelta[k] ?? "") !== String(it[k] ?? ""))));
t("R12 ida y vuelta de la ficha (con la ruta de la imagen)", JSON.stringify({ ...vuelta.ficha, imagenes: [] }) === JSON.stringify({ ...ficha, imagenes: [] }) && vuelta.ficha.imagenes[0] === "img/aaa.jpg");
t("R13 despacho reconstruido con sus datos (monto, factura, verificación, destino, evidencia)", env.length === 1 && env[0].key === "e" && env[0].monto === 11900 && env[0].estado === "confirmado" && env[0].destino === "Planta km 5" && env[0].evidencia === "simulación");
const dos = cotizacionParaEditor({ revisiones: [{ id: "R", afecta_iva: true }], items: [fila, { ...fila, id: "L2", orden: 2 }], costos: [costo, { ...costo, item_id: "L2" }] }, "R");
t("R14 despacho compartido: una sola entrada para dos ítems", dos.envios.length === 1 && dos.items.every((x) => x.envio_key === "e"));
t("R15 el costo calculado tras la vuelta es el mismo", calcularCotizacionVP({ ...base, items: [vuelta], envios: env }).lineas[0].costo_unitario === c.lineas[0].costo_unitario);
const sinPermiso = lineaParaGuardarVP(it, c.lineas[0], { imagenes: [], envio: base.envios[0], conCostos: false });
t("R16 sin permiso de costos no viaja ningún dato interno", !["costo_unitario", "proveedor", "enlace", "precio_compra", "despacho", "costo_nota"].some((k) => k in sinPermiso));
const heredado = itemDesdeLinea({ id: "L9", orden: 1, descripcion: "Bomba antigua", cantidad: 2, precio_unitario: 1000, unidad: "UN", tipo: "producto" }, { item_id: "L9", costo_unitario: 240000, nota: null });
t("R17 línea anterior (sin ficha): la ficha parte del texto y el costo unitario se conserva tal cual", heredado.ficha.nombre === "Bomba antigua" && calcularCotizacionVP({ items: [{ ...heredado, tipo: "servicio" }], envios: [] }).lineas[0].costo_unitario === 240000);
t("R18 validación: sin precio de venta se pide en Precios", validarItemsVP([itemVacioVP({ ficha: { nombre: "X" }, cantidad: 1 })]).some((e) => /pestaña Precios/.test(e)));

// 4. EETT desde la ficha, formato Mercado Público
const lin = { id: "L1", orden: 1, cantidad: 2, unidad: "UN", tipo: "producto", descripcion: "Bomba", ficha: { ...ficha, imagenes: ["img/aaa.jpg"] } };
const ei = itemEETTDesde(lin, null, null);
t("R19 la EETT toma nombre, marca, modelo, color, descripción e imágenes de la ficha (sin parámetros «No informado»)", ei.marca === "Pedrollo" && ei.modelo === "CPm 680" && ei.color === "Azul" && ei.descripcion === "Para riego" && ei.imagenes[0] === "img/aaa.jpg" && !ei.caracteristicas.some((k) => k.valor === "No informado"));
const { items: fichasPdf } = datosPdfEETTVP({ folio: "ET-2026-0001", revision: 0, estado: "emitida", contenido: { objeto: "x", items: [ei] } });
t("R20 PDF: características generales en «Características Generales» y especificaciones aparte, con color", fichasPdf[0].ficha.generales.some((p) => p.etiqueta === "Material") && fichasPdf[0].ficha.especificaciones.some((p) => p.etiqueta === "Potencia") && !fichasPdf[0].ficha.especificaciones.some((p) => p.etiqueta === "Material") && fichasPdf[0].ficha.color === "Azul");
const antiguo = itemEETTDesde({ id: "L1", orden: 1, cantidad: 2, unidad: "UN", tipo: "producto", descripcion: "Bomba" }, { id: "p", nombre: "Bomba", marca: "X", modelo: "Y" }, { tipo_producto: "equipo", caracteristicas: [{ caracteristica: "Potencia", valor: "2", unidad: "HP", grupo: "Eléctricas" }] });
const { items: pdfAntiguo } = datosPdfEETTVP({ folio: "ET-2026-0001", revision: 0, estado: "emitida", contenido: { objeto: "x", items: [antiguo] } });
t("R21 contenidos anteriores (sin ficha) se imprimen igual que antes", pdfAntiguo[0].ficha.generales.length === 2 && pdfAntiguo[0].ficha.especificaciones.some((p) => p.etiqueta === "Potencia") && !("color" in pdfAntiguo[0].ficha));

// Nombre del PDF de la cotización (09/11/2026): su código y revisión.
t("R22 PDF de la cotización con su código: CP-2026-0001_Rev0.pdf, CP-2026-0001_Rev2.pdf; sin guardar: BORRADOR_Rev0.pdf",
  nombreArchivoCotizacion({ folio: "CP-2026-0001", revision: 0 }) === "CP-2026-0001_Rev0.pdf" && nombreArchivoCotizacion({ folio: "CP-2026-0001", revision: 2 }) === "CP-2026-0001_Rev2.pdf"
  && nombreArchivoCotizacion({ folio: "BORRADOR", revision: 0 }) === "BORRADOR_Rev0.pdf" && nombreArchivoCotizacion({}) === "BORRADOR_Rev0.pdf");
const gen = await generarPdfCotizacion({ folio: "CP-2026-0001", revision: 0, cliente: { razon_social: "FONDO HOSPITAL DE LA DIRECCION DE PREVISION DE CARABINEROS DE CHILE" }, items: [{ orden: 1, descripcion: "Bolso", unidad: "UN", cantidad: 2, precio_unitario: 1000, subtotal_neto: 2000 }], neto: 2000, iva: 380, total: 2380, empresa: {} });
t("R23 la descarga y la vista previa usan ese nombre", gen.nombre === "CP-2026-0001_Rev0.pdf" && gen.paginas >= 1);

console.log(`RESUMEN reglas cotización como MP: ${ok} OK, ${F.length} FALLA(S)`);
process.exit(F.length ? 1 : 0);
