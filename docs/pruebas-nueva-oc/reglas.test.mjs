// «Nueva OC» con la cotización BFK (03/11/2026): reglas puras (sugerencias, elegibilidad, vínculo sin recalcular, enlaces).
// Datos ficticios. Ejecutar: node docs/pruebas-nueva-oc/reglas.test.mjs
import { sugerirCotizaciones, puntuar, elegibilidad, payloadVinculo, enlacesParaProductos, diferenciasOC, similitud, normalRut, coberturaProductos, preliminares, UMBRAL_SUGERENCIA } from "../../src/lib/nuevaOCCotizacion.js";
import { baseCotizacion, armarPedidos, compradoEnOC, estadoLineas, filasIniciales, comparar, validarCompra } from "../../src/lib/compraCotizacion.js";

let nOk = 0; const F = [];
const ok = (k, v, d) => { if (v) { nOk++; console.log("OK    " + k); } else { F.push(k); console.log("FALLA " + k + (d !== undefined ? " :: " + JSON.stringify(d).slice(0, 500) : "")); } };

const OC = { numero_oc: "2600-77-SE26", nombre_oc: "Monitores y teclados oficina", cliente: "MUNICIPALIDAD DE LAJA", entidad: "DEPTO. INFORMÁTICA", rut_cliente: "69.170.300-K",
  monto_total: 2380000, productos: [{ descripcion: "Monitor LED 24 pulgadas LG 24MK430", cantidad: 2 }, { descripcion: "Teclado inalámbrico Logitech K270", cantidad: 4 }] };
const cot = (id, o = {}) => ({ id, id_externo: `5602-${id}-COT26`, nombre: "Monitores y teclados oficina", institucion: "Municipalidad de Laja", rut: "69170300-k", estado: "presentada",
  oc_codigo: null, total: 2380000, vendedor_id: "v1", vendedor_nombre: "Vendedor Uno", actualizado_en: "2026-10-20", ...o });
const ITEMS = { c1: [{ nombre: "Monitor 24 pulgadas", marca: "LG", modelo: "24MK430" }, { nombre: "Teclado inalámbrico", marca: "Logitech", modelo: "K270" }] };

// ── Sugerencias ──
{
  const lista = [cot("c1"), cot("c2", { rut: "70.111.222-3", institucion: "Hospital Ficticio", nombre: "Sillas", total: 500000 }),
    cot("c3", { oc_codigo: "9999-1-SE26" }), cot("c4", { estado: "borrador" }), cot("c5", { estado: "descartada" })];
  const s = sugerirCotizaciones(OC, lista, ITEMS);
  ok("S01_sugiere_la_que_coincide", s.length === 1 && s[0].cot.id === "c1" && s[0].confianza === "alta", s.map((x) => [x.cot.id, x.puntaje]));
  ok("S02_motivos_explicitos", ["Mismo RUT del comprador", "Mismo monto total", "Nombre de la compra similar", "Misma institución"].every((m) => s[0].motivos.includes(m)) && s[0].motivos.some((m) => /Productos coinciden \(100%\)/.test(m)), s[0].motivos);
  ok("S03_no_sugiere_vinculada_a_otra_oc", !s.some((x) => x.cot.id === "c3"));
  ok("S04_no_sugiere_borrador_ni_descartada", !s.some((x) => ["c4", "c5"].includes(x.cot.id)));
  ok("S05_sin_coincidencias_no_sugiere_nada", sugerirCotizaciones(OC, [lista[1]]).length === 0);
  const ya = sugerirCotizaciones(OC, [cot("c6", { estado: "adjudicada", oc_codigo: " 2600-77-se26 ", rut: "", total: 1, nombre: "x", institucion: "y" })]);
  ok("S06_vinculada_a_esta_oc_primero", ya.length === 1 && ya[0].motivos[0] === "Ya vinculada a esta OC en Cotizaciones" && ya[0].eleg.ok && ya[0].eleg.yaVinculada);
  const lic = puntuar({ ...OC, codigo_licitacion: "5602-c9-COT26" }, cot("c9", { rut: "", total: 0, nombre: "", institucion: "" }));
  ok("S07_codigo_compra_mercado_publico", lic.puntaje >= 120 && lic.motivos.includes("Mismo código de la compra en Mercado Público"), lic);
  const varias = sugerirCotizaciones(OC, [cot("a1"), cot("a2"), cot("a3"), cot("a4"), cot("a5"), cot("a6"), cot("a7")]);
  ok("S08_maximo_cinco_y_ninguna_elegida", varias.length === 5 && varias.every((x) => !("elegida" in x)));
  ok("S09_monto_similar_5pct", puntuar(OC, cot("m", { total: 2380000 * 1.04, rut: "", nombre: "", institucion: "" })).motivos.some((m) => /Monto similar/.test(m)));
  ok("S10_institucion_generica_no_cuenta", similitud("MUNICIPALIDAD DE LAJA", "Municipalidad de Cabrero", new Set(["municipalidad"])) === 0);
  ok("S11_rut_normalizado", normalRut("69.170.300-k") === normalRut("069170300K"));
  ok("S12_productos_cobertura", coberturaProductos(OC.productos, ITEMS.c1) === 1 && coberturaProductos(OC.productos, [{ nombre: "Silla" }]) === 0);
  ok("S13_preliminares_limita_lectura", preliminares(OC, [cot("p1"), cot("p2", { rut: "", total: 0, nombre: "", institucion: "" })]).join() === "p1");
  ok("S14_umbral", UMBRAL_SUGERENCIA === 40 && puntuar(OC, cot("r", { total: 0, nombre: "", institucion: "" })).puntaje === 40);
}

// ── Elegibilidad (mismas reglas que la base) ──
{
  ok("E01_presentada_con_vendedor_se_adjudica", JSON.stringify(elegibilidad(cot("x"), OC.numero_oc)) === JSON.stringify({ ok: true, yaVinculada: false, adjudicar: true }));
  ok("E02_adjudicada_sin_oc_no_cambia_estado", elegibilidad(cot("x", { estado: "adjudicada" }), OC.numero_oc).adjudicar === false);
  ok("E03_presentada_sin_vendedor_no", !elegibilidad(cot("x", { vendedor_id: null }), OC.numero_oc).ok);
  ok("E04_adjudicada_sin_vendedor_si", elegibilidad(cot("x", { estado: "adjudicada", vendedor_id: null }), OC.numero_oc).ok);
  ok("E05_otra_oc_no", /Ya está vinculada a la OC 1-1-SE26/.test(elegibilidad(cot("x", { oc_codigo: "1-1-SE26" }), OC.numero_oc).motivo));
  ok("E06_misma_oc_si_aunque_cambie_formato", elegibilidad(cot("x", { estado: "adjudicada", oc_codigo: "2600-77-se26" }), " 2600-77-SE26").yaVinculada);
  ok("E07_otros_estados_no", ["borrador", "lista", "no_adjudicada", "descartada"].every((e) => !elegibilidad(cot("x", { estado: e }), OC.numero_oc).ok));
}

// ── Vínculo: reenvía lo guardado, solo cambian estado y código de la OC ──
const FILA = { id: "11111111-2222-4333-8444-555555555555", version: 7, id_externo: "5602-1-COT26", nombre: "Monitores", institucion: "Municipalidad de Laja", rut: "69170300-K",
  direccion_entrega: "Balmaceda 292", comuna: "Laja", fecha: "2026-10-01", plazo: "10 días", observaciones: null, estado: "presentada", recargo: 0.3,
  formula: { confirmada: true, base: "neto", redondeo: "arriba", prorrateo: "valor" }, subtotal_neto: 2000000, impuestos: 380000, total: 2380000, costo_neto: 1520000, iva_credito: 288800,
  oc_codigo: null, vendedor_id: "v1", vendedor_nombre: "Vendedor Uno", tratamiento_iva: "afecta", requerimientos: [{ nombre: "x" }], documentos_mp: [] };
const ITS = [
  { id: "aaaaaaaa-0000-4000-8000-000000000002", cotizacion_id: FILA.id, orden: 2, producto_id: null, envio_clave: "e1", enlace: "https://falabella.com/teclado", enlace_original: null, proveedor: "Falabella", disponibilidad: "Stock", fecha_consulta: "2026-10-01T12:00:00+00:00", origen_datos: "manual", cantidad: 4, precio_origen: 90000.5, precio_incluye_iva: true, con_factura: true, iva_compra: 57479, envio_asignado: 3200, costo_bruto: 363202, costo_neto: 305212, recargo: null, unitario_venta_neto: 99194, especificaciones_aprobadas: { nombre: "Teclado inalámbrico", marca: "Logitech", modelo: "K270", imagenes: ["img/t.jpg"] }, ficha_aprobada: true },
  { id: "aaaaaaaa-0000-4000-8000-000000000001", cotizacion_id: FILA.id, orden: 1, producto_id: "bbbbbbbb-0000-4000-8000-000000000001", envio_clave: "e1", enlace: "https://falabella.com/monitor", enlace_original: "https://falabella.com/monitor-v", proveedor: "Falabella", disponibilidad: null, fecha_consulta: null, origen_datos: null, cantidad: 2, precio_origen: 450000, precio_incluye_iva: true, con_factura: true, iva_compra: 143698, envio_asignado: 8790, costo_bruto: 908790, costo_neto: 763689, recargo: 0.25, unitario_venta_neto: 477306, especificaciones_aprobadas: { nombre: "Monitor 24 pulgadas", marca: "LG", modelo: "24MK430" }, ficha_aprobada: true },
];
const ENV = [{ id: "e-uuid", cotizacion_id: FILA.id, clave: "e1", proveedor: "Falabella", origen_publicacion: "web", destino: "Balmaceda 292, Laja", monto: 11990, con_factura: true, cobertura: "Laja", fecha_cotizacion: "2026-10-01", estado_confirmacion: "confirmado", evidencia: "Simulación" }];
{
  const p = payloadVinculo(FILA, ITS, ENV, " 2600-77-SE26 ");
  ok("V01_solo_estado_y_oc_cambian", p.estado === "adjudicada" && p.oc_codigo === "2600-77-SE26" && p.version === 7 && p.id === FILA.id);
  ok("V02_totales_formula_recargo_identicos", ["subtotal_neto", "impuestos", "total", "costo_neto", "iva_credito", "recargo"].every((k) => p[k] === FILA[k]) && JSON.stringify(p.formula) === JSON.stringify(FILA.formula));
  ok("V03_lineas_en_orden_con_su_id", p.items.map((i) => i.key).join() === [ITS[1].id, ITS[0].id].join());
  const camposLinea = [["cantidad", "cantidad"], ["precio_origen", "precio_origen"], ["iva_compra", "iva_compra"], ["envio_asignado", "envio_asignado"], ["costo_bruto", "costo_bruto"], ["costo_neto", "costo_neto"], ["recargo", "recargo"], ["unitario_venta_neto", "unitario_venta_neto"], ["enlace", "enlace"], ["enlace_original", "enlace_original"], ["proveedor", "proveedor"], ["producto_id", "producto_id"], ["envio_key", "envio_clave"], ["precio_incluye_iva", "precio_incluye_iva"], ["con_factura", "con_factura"], ["fecha_consulta", "fecha_consulta"], ["disponibilidad", "disponibilidad"], ["origen_datos", "origen_datos"], ["ficha_aprobada", "ficha_aprobada"]];
  ok("V04_lineas_identicas_campo_a_campo", p.items.every((x) => { const o = ITS.find((i) => i.id === x.key); return camposLinea.every(([a, b]) => JSON.stringify(x[a]) === JSON.stringify(o[b])) && JSON.stringify(x.ficha) === JSON.stringify(o.especificaciones_aprobadas); }));
  ok("V05_despachos_identicos", JSON.stringify(p.envios[0]) === JSON.stringify({ key: "e1", proveedor: "Falabella", origen_publicacion: "web", destino: "Balmaceda 292, Laja", monto: 11990, con_factura: true, cobertura: "Laja", fecha_cotizacion: "2026-10-01", estado: "confirmado", evidencia: "Simulación" }));
  ok("V06_no_envia_vendedor_ni_clasificacion_ni_compra_agil", !["vendedor_id", "vendedor_nombre", "tratamiento_iva", "requerimientos", "documentos_mp", "clasificacion_id"].some((k) => k in p));
  ok("V07_formula_vacia_se_omite", !("formula" in payloadVinculo({ ...FILA, formula: null }, ITS, ENV, "X")));
  ok("V08_no_muta_lo_leido", ITS[0].orden === 2 && FILA.estado === "presentada");
  // Precio de venta: el payload lleva el unitario guardado aunque la fórmula actual diera otro valor.
  ok("V09_unitario_guardado_no_recalculado", p.items.find((i) => i.key === ITS[1].id).unitario_venta_neto === 477306);
}

// ── Enlaces y diferencias ──
{
  const base = baseCotizacion({ items: [{ key: "k1", cantidad: 2, precio_origen: 450000, envio_key: null, ficha: { nombre: "Monitor 24 pulgadas", marca: "LG", modelo: "24MK430" }, enlace: "https://f.com/monitor", proveedor: "F" },
    { key: "k2", cantidad: 4, precio_origen: 90000, envio_key: null, ficha: { nombre: "Teclado inalámbrico", marca: "Logitech", modelo: "K270" }, enlace: "https://f.com/teclado", proveedor: "F" }], envios: [], recargo: 0.3 });
  const productosInvertidos = [OC.productos[1], OC.productos[0]];
  ok("L01_enlace_por_nombre_no_por_posicion", enlacesParaProductos(productosInvertidos, base.lineas).join() === "https://f.com/teclado,https://f.com/monitor");
  ok("L02_sin_enlaces_en_cotizacion", enlacesParaProductos(OC.productos, base.lineas.map((l) => ({ ...l, enlace: "" }))).length === 0);
  ok("L03_sin_reconocer_usa_primero", enlacesParaProductos([{ descripcion: "Servicio de instalación" }, { descripcion: "Otro" }, { descripcion: "Más" }], base.lineas).every((u) => u === "https://f.com/monitor"));
  const av = diferenciasOC({ ...OC, monto_total: 2400000, rut_cliente: "1-9" }, cot("d"), base);
  ok("L04_avisa_rut_y_monto", av.length === 2 && /RUT/.test(av[0]) && /\$2\.400\.000/.test(av[1]), av);
  ok("L05_avisa_cantidades", diferenciasOC({ ...OC, productos: [{ cantidad: 5 }] }, cot("d"), base).some((a) => /5 unidades/.test(a)));
  ok("L06_sin_diferencias_sin_avisos", diferenciasOC(OC, cot("d"), base).length === 0);
}

// ── La compra reutiliza la lógica existente (nueva OC: sin compras previas) ──
{
  const base = baseCotizacion({ items: [{ key: "k1", cantidad: 2, precio_origen: 450000, envio_key: "e1", ficha: { nombre: "Monitor" }, proveedor: "F" }, { key: "k2", cantidad: 4, precio_origen: 90000, envio_key: "e1", ficha: { nombre: "Teclado" }, proveedor: "F" }],
    envios: [{ key: "e1", proveedor: "F", monto: 11990 }], recargo: 0.3 });
  const comprado = compradoEnOC({ eventos_compra: [], oc_productos_link: [] }); const lineas = estadoLineas(base, comprado);
  const filas = filasIniciales(base, lineas).map((f, i) => (i === 0 ? { ...f, unitario: 480000, cantidad: 1 } : f));
  const g = armarPedidos({ filas, base, comprado });
  const c = comparar({ base, lineas, grupos: g, ventaOC: 2380000, comprado });
  ok("C01_parcial_y_precio_real", c.parcial && c.productosReal === 480000 + 360000 && c.diferencia === 30000 && c.utilidadActualizada === c.utilidadOriginal - 30000, c);
  ok("C02_despacho_una_vez", g.length === 1 && g[0].despachos.length === 1 && g[0].despachos[0].real === 11990);
  ok("C03_no_compra_mas_de_lo_cotizado", validarCompra({ opcion: "B", filas: [...filas, { ...filas[0], rid: "z", cantidad: 2 }], lineas, base }).errores.some((e) => /no se duplican/.test(e)));
}

console.log(`\nRESUMEN reglas Nueva OC: ${nOk} OK, ${F.length} FALLA(S)`);
process.exit(F.length ? 1 : 0);
