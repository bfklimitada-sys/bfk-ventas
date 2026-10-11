// Cálculo de cotizaciones (fórmula PROVISIONAL) y revisión de fichas. Datos simulados.
// Uso: node docs/pruebas-cotizaciones/cotizaciones.test.mjs
import { calcularCotizacion, repartirEnvios, revisarFicha, estadoParaPDF, fichaPublica, textoParaMercadoPublico, margenDeRecargo, paresDeTexto, textoDePares, FORMULA } from "../../src/lib/cotizaciones.js";

const F = []; let nOk = 0;
const ok = (k, v, d) => { if (!v) { F.push(k); console.log("FALLA " + k + (d !== undefined ? " :: " + JSON.stringify(d).slice(0, 400) : "")); } else { nOk++; console.log("OK    " + k); } };
const env = (key, monto, extra = {}) => ({ key, proveedor: "Prov " + key, monto, con_factura: true, estado: "confirmado", destino: "Calle 1, Laja", evidencia: "Simulación de compra", ...extra });
// Todas las cotizaciones de prueba tienen dirección de entrega (salvo los casos que la quitan a propósito).
const calc = (cot, f) => calcularCotizacion({ direccion_entrega: "Calle 1", comuna: "Laja", ...cot }, f);
const item = (key, cantidad, precio, envio_key, extra = {}) => ({ key, cantidad, precio_origen: precio, precio_incluye_iva: true, con_factura: true, envio_key, ficha: { nombre: "Producto " + key }, ...extra });

// C1: caso del Excel histórico (2656-40-COT25): 3 × 82.865, envío 0, 30% → L = 90.524,79 → 90.525.
{
  const c = calc({ recargo: 0.3, envios: [env("e", 0, { estado: "sin_costo_confirmado" })], items: [item("a", 3, 82865, "e")] });
  const l = c.lineas[0], t = c.totales;
  ok("C1_unitario_igual_al_excel", l.unitario_neto === 90525, l);
  ok("C1_desglose", Math.round(l.costo_bruto) === 248595 && Math.round(l.costo_neto) === 208903 && Math.round(l.iva_credito) === 39692 && t.neto === 271575 && t.iva_debito === 51599 && t.total === 323174, t);
  ok("C1_utilidad_e_iva_a_pagar", Math.round(t.utilidad_neta) === 62672 && Math.round(t.iva_a_pagar) === 11907, t);
  ok("C1_despacho_mp_cero_y_listo", t.despacho_mercado_publico === 0 && c.listo, c.pendientes);
}
// C2: 163 filas históricas reproducibles — mismo resultado con base "neto" y "bruto" cuando todo es con factura.
{
  const filas = [[116990, 5, 16990, 0.3], [569990, 2, 5990, 0.3], [6330, 5, 0, 0.3], [53980, 5, 3990, 0.2], [1290, 17, 2490, 0.25]];
  const igual = filas.every(([p, q, e, r]) => {
    const cot = { recargo: r, envios: [env("e", e)], items: [item("a", q, p, "e")] };
    const a = calc(cot, { ...FORMULA, base: "neto" }).lineas[0].unitario_neto;
    const b = calc(cot, { ...FORMULA, base: "bruto" }).lineas[0].unitario_neto;
    const excel = Math.ceil(((q * p + e) * (1 + r)) / q / 1.19 - 1e-7);
    return a === b && a === excel;
  });
  ok("C2_neto_y_bruto_coinciden_con_factura_y_con_excel", igual);
}
// C3: compra con boleta (sin IVA recuperable): la base neta protege el margen.
{
  const cot = { recargo: 0.3, envios: [env("e", 0, { estado: "sin_costo_confirmado" })], items: [item("a", 3, 82865, "e", { con_factura: false })] };
  const n = calc(cot); const b = calc(cot, { ...FORMULA, base: "bruto" });
  ok("C3_boleta_iva_es_costo", n.lineas[0].iva_credito === 0 && n.lineas[0].unitario_neto === 107725 && b.lineas[0].unitario_neto === 90525, [n.lineas[0].unitario_neto, b.lineas[0].unitario_neto]);
}
// C4: precio publicado sin IVA.
{
  const c = calc({ recargo: 0.3, envios: [env("e", 0, { estado: "sin_costo_confirmado" })], items: [item("a", 2, 10000, "e", { precio_incluye_iva: false })] });
  ok("C4_precio_sin_iva", Math.round(c.lineas[0].costo_bruto) === 23800 && Math.round(c.lineas[0].costo_neto) === 20000 && c.lineas[0].unitario_neto === 13000, c.lineas[0]);
}
// C5: envío compartido entre productos del mismo pedido: reparto según valor, cuadre exacto, sin duplicar.
{
  const items = [item("a", 1, 10000, "e"), item("b", 2, 3333, "e"), item("c", 1, 1, "e")];
  const rep = repartirEnvios(items, [env("e", 9990)]);
  ok("C5_reparto_cuadra_exacto", rep.a + rep.b + rep.c === 9990 && rep.a > rep.b && rep.b > rep.c, rep);
  const c = calc({ recargo: 0.3, envios: [env("e", 9990)], items });
  ok("C5_envio_no_se_duplica", Math.round(c.totales.envios) === 9990 && Math.round(c.totales.costo_bruto) === 10000 + 6666 + 1 + 9990, c.totales);
  const rq = repartirEnvios(items, [env("e", 100)], "cantidad");
  ok("C5_reparto_por_cantidad", rq.a === 25 && rq.b === 50 && rq.c === 25, rq);
}
// C6: dos proveedores, cada uno con su envío.
{
  const c = calc({ recargo: 0.3, envios: [env("f", 5990), env("m", 0, { estado: "sin_costo_confirmado" })], items: [item("a", 1, 100000, "f"), item("b", 4, 2500, "m")] });
  ok("C6_varios_proveedores", c.lineas[0].envio_asignado === 5990 && c.lineas[1].envio_asignado === 0 && c.listo, c.lineas);
}
// C7: dirección desconocida / envío no verificado / sin envío → nunca gratis, queda pendiente.
{
  const c1 = calc({ recargo: 0.3, envios: [], items: [item("a", 1, 1000, null)] });
  const c2 = calc({ recargo: 0.3, envios: [env("e", 0, { estado: "pendiente" })], items: [item("a", 1, 1000, "e")] });
  const c3 = calc({ recargo: 0.3, envios: [env("e", 0, { estado: "no_despacha" })], items: [item("a", 1, 1000, "e")] });
  ok("C7_sin_envio_pendiente", !c1.listo && c1.pendientes.some((p) => /Nunca se asume despacho gratis/.test(p)));
  ok("C7_envio_por_verificar_pendiente", !c2.listo && !c3.listo, [c2.pendientes, c3.pendientes]);
}
// C8: decimales y redondeo: el unitario nunca queda bajo el recargo con redondeo hacia arriba; "normal" disponible.
{
  const cot = { recargo: 0.3, envios: [env("e", 0, { estado: "sin_costo_confirmado" })], items: [item("a", 7, 999.99, "e"), item("b", 3, 1, "e")] };
  const c = calc(cot); const cn = calc(cot, { ...FORMULA, redondeo: "normal" });
  ok("C8_unitarios_enteros", c.lineas.every((l) => Number.isInteger(l.unitario_neto)) && c.totales.neto === c.lineas.reduce((s, l) => s + l.unitario_neto * l.cantidad, 0));
  ok("C8_nunca_bajo_recargo", c.lineas.every((l) => l.neto_linea >= l.costo_neto * 1.3 - 1e-6));
  ok("C8_redondeo_normal_alternativo", cn.lineas[1].unitario_neto === 1 && c.lineas[1].unitario_neto === 2, [cn.lineas[1].unitario_neto, c.lineas[1].unitario_neto]);
}
// C9: recargo configurable por cotización y por línea; 30% solo sugerido.
{
  const c = calc({ recargo: 0.1, envios: [env("e", 0, { estado: "sin_costo_confirmado" })], items: [item("a", 1, 11900, "e"), item("b", 1, 11900, "e", { recargo: 0.5 })] });
  const sin = calc({ recargo: "", envios: [env("e", 0, { estado: "sin_costo_confirmado" })], items: [item("a", 1, 11900, "e")] });
  ok("C9_recargo_editable", c.lineas[0].unitario_neto === 11000 && c.lineas[1].unitario_neto === 15000 && sin.lineas[0].unitario_neto === 13000, [c.lineas.map((l) => l.unitario_neto), sin.lineas[0].unitario_neto]);
  ok("C9_margen_equivalente", Math.abs(margenDeRecargo(0.3) - 0.230769) < 1e-5);
}
// C10: texto para Mercado Público (tabulado) con despacho 0.
{
  const cot = { recargo: 0.3, envios: [env("e", 0, { estado: "sin_costo_confirmado" })], items: [item("a", 3, 82865, "e")] };
  const t = textoParaMercadoPublico(cot, calc(cot)).split("\n");
  ok("C10_texto_tabulado", t[1] === "1\tProducto a\t3\t90525\t271575" && t[2].endsWith("\t0") && t[3].endsWith("\t271575"), t);
}
// R: revisión de fichas.
{
  const smart = { nombre: "IMPRESORA MULTIFUNCIONAL SMART TANK 520 TANQUE DE TINTA", marca: "HP", modelo: "SMART TANK 580", imagenes: ["data:image/jpeg;base64,AA"], especificaciones: [{ etiqueta: "Tipo", valor: "Tinta" }] };
  const av = revisarFicha(smart);
  ok("R1_detecta_smart_tank_520_vs_580", av.some((a) => a.tipo === "modelo_discrepante" && /520/.test(a.mensaje) && /580/.test(a.mensaje)), av);
  ok("R1_no_corrige", smart.modelo === "SMART TANK 580" && smart.nombre.includes("520"));
  ok("R2_ficha_coherente_sin_avisos", revisarFicha({ ...smart, nombre: "Impresora HP Smart Tank 580" }).length === 0, revisarFicha({ ...smart, nombre: "Impresora HP Smart Tank 580" }));
  ok("R3_dato_comercial_bloquea", revisarFicha({ ...smart, nombre: "Impresora 580", especificaciones: [{ etiqueta: "Envío", valor: "Despacho gratis" }] }).some((a) => a.nivel === "bloqueo"));
  ok("R4_atributo_modelo_distinto", revisarFicha({ ...smart, nombre: "Impresora 580", especificaciones: [{ etiqueta: "Modelo", valor: "Smart Tank 520" }] }).some((a) => a.tipo === "modelo_atributo"));
  const cot = { id_externo: "1-1-COT26", institucion: "Muni", items: [{ key: "a", ficha: smart }, { key: "b", ficha: { ...smart, nombre: "Impresora 580" } }] };
  ok("R5_pdf_requiere_aprobar_discrepancias", !estadoParaPDF(cot).listo && estadoParaPDF({ ...cot, items: [{ ...cot.items[0], ficha_aprobada: true }, cot.items[1]] }).listo);
  ok("R6_pdf_sin_id_permitido", !estadoParaPDF({ ...cot, id_externo: "" }).faltan.length && estadoParaPDF({ ...cot, id_externo: "", items: [{ ...cot.items[0], ficha_aprobada: true }, cot.items[1]] }).listo);
  ok("R6b_pdf_requiere_institucion", estadoParaPDF({ ...cot, institucion: "" }).faltan.includes("institución"));
  const fp = fichaPublica({ ...smart, precio_origen: 1, enlace: "https://x", proveedor: "F", imagenes: ["https://externa/sin-copiar.jpg", "data:image/png;base64,AA"] });
  ok("R7_ficha_publica_solo_tecnica", Object.keys(fp).sort().join(",") === "color,descripcion,especificaciones,generales,imagenes,marca,modelo,nombre" && fp.imagenes.length === 1, fp);
  ok("R8_pares_texto_ida_y_vuelta", textoDePares(paresDeTexto("Marca: HP\nResolución:  1200 dpi\nSolo etiqueta")) === "Marca: HP\nResolución: 1200 dpi\nSolo etiqueta");
}
// C11: el envío se verifica para la dirección real del cliente y nunca se supone gratuito.
{
  const base = { recargo: 0.3, items: [item("a", 1, 1000, "e")] };
  const sinDir = calcularCotizacion({ ...base, envios: [env("e", 0, { estado: "sin_costo_confirmado" })] });
  ok("C11_sin_direccion_no_se_confirma", !sinDir.listo && sinDir.pendientes.some((p) => /falta la dirección de entrega/.test(p)), sinDir.pendientes);
  const otra = calc({ ...base, direccion_entrega: "Otra 99", envios: [env("e", 0, { estado: "sin_costo_confirmado" })] });
  ok("C11_confirmado_para_otra_direccion_queda_pendiente", !otra.listo && otra.pendientes.some((p) => /se verificó para "Calle 1, Laja"/.test(p)), otra.pendientes);
  const sinEvid = calc({ ...base, envios: [env("e", 5990, { evidencia: "" })] });
  ok("C11_confirmar_exige_como_se_verifico", !sinEvid.listo && sinEvid.pendientes.some((p) => /registra cómo se verificó/.test(p)));
  const acentos = calc({ ...base, direccion_entrega: "calle  1", comuna: "LAJA", envios: [env("e", 0, { estado: "sin_costo_confirmado" })] });
  ok("C11_misma_direccion_sin_importar_mayusculas_espacios", acentos.listo, acentos.pendientes);
  const gratisSinVerificar = calc({ ...base, envios: [env("e", 0, { estado: "pendiente" })] });
  ok("C11_monto_cero_sin_verificar_no_es_gratis", !gratisSinVerificar.listo);
}
console.log(`\n${nOk} OK · ${F.length} fallas`);
process.exit(F.length ? 1 : 0);
