// Fase 3 de ventas exentas (20/10/2026): fórmula de cotización exenta y compatibilidad exacta de las afectas.
// Compara el cálculo nuevo con el de PRODUCCIÓN (commit 0bbca75, leído con git) sobre 3.000 cotizaciones afectas
// generadas al azar (semilla fija) y verifica la fórmula exenta con casos calculados a mano.
// Uso: node docs/pruebas-cotizaciones/exentas_fase3.test.mjs
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { calcularCotizacion, formulaParaGuardar, FORMULA, aplicarRecargoProducto, textoParaMercadoPublico, repartirEnvios } from "../../src/lib/cotizaciones.js";

const F = []; let nOk = 0;
const ok = (k, v, d) => { if (!v) { F.push(k); console.log("FALLA " + k + (d !== undefined ? " :: " + JSON.stringify(d).slice(0, 600) : "")); } else { nOk++; console.log("OK    " + k); } };
const dir = mkdtempSync(join(tmpdir(), "cz-ref-")); const ref = join(dir, "cotizaciones_produccion.mjs");
writeFileSync(ref, execFileSync("git", ["show", "0bbca75:src/lib/cotizaciones.js"]));
const PROD = await import(ref);

// ── 1. Afectas: idénticas a producción (todas las claves que producción entrega) ──
let s = 20261020; const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
const elegir = (a) => a[Math.floor(rnd() * a.length)];
const env = (k) => ({ key: k, proveedor: "P" + k, monto: elegir([0, 3990, 5990, 12500, 80000, 15001]), con_factura: rnd() > 0.2, estado: "confirmado", destino: "Calle 1, Laja", evidencia: "sim" });
function aleatoria(extra = {}) {
  const envios = Array.from({ length: 1 + Math.floor(rnd() * 3) }, (_, i) => env("e" + i));
  const items = Array.from({ length: 1 + Math.floor(rnd() * 6) }, (_, i) => ({ key: "i" + i, cantidad: 1 + Math.floor(rnd() * 25), precio_origen: Math.round(1000 + rnd() * 900000),
    precio_incluye_iva: rnd() > 0.3, con_factura: rnd() > 0.15, envio_key: rnd() > 0.1 ? elegir(envios).key : null, recargo: rnd() > 0.6 ? elegir([0, 0.15, 0.225, 0.45, -0.05]) : null, ficha: { nombre: "Prod " + i } }));
  return { recargo: elegir([0.3, 0.25, 0.35, 0, "", null]), direccion_entrega: "Calle 1", comuna: "Laja", envios, items, ...extra };
}
let difs = 0, n = 0; const ejemplo = [];
for (let k = 0; k < 3000; k++) {
  const variante = k % 4 === 0 ? {} : k % 4 === 1 ? { tratamiento_iva: null } : k % 4 === 2 ? { tratamiento_iva: "afecta", clasificacion_id: "x" } : { tratamiento_iva: "exenta_fora" }; // exenta SIN aprobación = afecta
  const c = aleatoria(variante);
  const a = PROD.calcularCotizacion(JSON.parse(JSON.stringify(c))), b = calcularCotizacion(JSON.parse(JSON.stringify(c)));
  const same = JSON.stringify(a.totales) === JSON.stringify(Object.fromEntries(Object.keys(a.totales).map((x) => [x, b.totales[x]])))
    && a.lineas.every((l, i) => JSON.stringify(l) === JSON.stringify(Object.fromEntries(Object.keys(l).map((x) => [x, b.lineas[i][x]]))))
    && JSON.stringify(a.pendientes) === JSON.stringify(b.pendientes) && b.exenta === false;
  n++; if (!same) { difs++; if (ejemplo.length < 1) ejemplo.push({ c, a: a.totales, b: b.totales }); }
}
ok("A1_3000_afectas_identicas_a_produccion", difs === 0 && n === 3000, { difs, ejemplo });
ok("A2_formula_guardada_afecta_identica", formulaParaGuardar({ items: [] }) === FORMULA && JSON.stringify(FORMULA) === JSON.stringify(PROD.FORMULA));
{
  const c = aleatoria(); const t1 = PROD.textoParaMercadoPublico(c, PROD.calcularCotizacion(c)), t2 = textoParaMercadoPublico(c, calcularCotizacion(c));
  ok("A3_texto_mercado_publico_afecta_identico", t1 === t2);
}

// ── 2. Exenta FO.R.A. aprobada ──
const ap = { tratamiento_iva: "exenta_fora", clasificacion_id: "tc-1" };
const e = (k, monto, cf = true) => ({ key: k, proveedor: "P", monto, con_factura: cf, estado: "confirmado", destino: "Prat 620, Valparaíso", evidencia: "sim" });
const it = (k, q, precio, envio_key, extra = {}) => ({ key: k, cantidad: q, precio_origen: precio, precio_incluye_iva: true, con_factura: true, envio_key, recargo: null, ficha: { nombre: k }, ...extra });
const caso = (extra) => ({ recargo: 0.3, direccion_entrega: "Prat 620", comuna: "Valparaíso", envios: [e("e1", 80000)], items: [it("a", 1, 2000000, "e1")], ...extra });
{
  // Ejemplo de la auditoría: compra $2.000.000 + despacho $80.000 (ambos con IVA), recargo 30%.
  const x = calcularCotizacion(caso(ap)), y = calcularCotizacion(caso({}));
  ok("E1_exenta_recargo_sobre_costo_bruto", x.exenta && x.totales.costo_bruto === 2080000 && x.totales.neto === 2704000 && x.lineas[0].unitario_neto === 2704000, x.totales);
  ok("E2_exenta_iva_venta_cero_total_exento", x.totales.iva_debito === 0 && x.totales.total === 2704000 && x.totales.iva_credito === 0 && x.totales.iva_a_pagar === 0);
  ok("E3_iva_no_recuperable_es_costo", Math.round(x.totales.iva_no_recuperable) === 332101 && x.totales.costo_real === 2080000 && x.totales.utilidad_neta === 624000, x.totales);
  ok("E4_misma_compra_afecta_sin_cambios", !y.exenta && y.totales.neto === 2272269 && y.totales.total === 2272269 + Math.round(2272269 * 0.19) && Math.round(y.totales.utilidad_neta) === 524370, y.totales);
}
{
  // Compra con IVA no recuperable y otra SIN factura (sin IVA): ambas al costo pagado; despacho sin factura.
  const c = caso({ ...ap, envios: [e("e1", 10000, false)], items: [it("a", 2, 119000, "e1"), it("b", 3, 50000, "e1", { con_factura: false })] });
  const x = calcularCotizacion(c);
  const costo = 2 * 119000 + 3 * 50000 + 10000;
  ok("E5_compras_con_y_sin_factura_al_costo_pagado", x.totales.costo_bruto === costo && x.totales.costo_real === costo && Math.round(x.totales.iva_no_recuperable) === Math.round(238000 - 238000 / 1.19), x.totales);
}
{
  // Despacho compartido entre varios productos: se reparte una sola vez, la suma es exacta y va en los unitarios.
  const c = caso({ ...ap, envios: [e("e1", 15001), e("e2", 5990)], items: [it("a", 3, 82865, "e1"), it("b", 2, 45990, "e1"), it("c", 7, 1990, "e2")] });
  const x = calcularCotizacion(c); const rep = repartirEnvios(c.items, c.envios);
  ok("E6_despacho_repartido_sin_duplicar", rep.a + rep.b === 15001 && rep.c === 5990 && x.totales.envios === 15001 + 5990 && x.totales.costo_bruto === 3 * 82865 + 2 * 45990 + 7 * 1990 + 20991, { rep, t: x.totales });
  ok("E7_unitario_exento_redondeado_hacia_arriba", x.lineas.every((l) => l.unitario_neto === Math.ceil(l.costo_bruto * 1.3 / l.cantidad - 1e-7) && l.neto_linea === l.unitario_neto * l.cantidad && l.neto_linea >= l.costo_bruto * 1.3 - 1e-6));
  ok("E8_pesos_enteros", x.lineas.every((l) => Number.isInteger(l.unitario_neto) && Number.isInteger(l.neto_linea)) && Number.isInteger(x.totales.neto) && Number.isInteger(x.totales.total));
  // Recargos individuales y general.
  const r = calcularCotizacion(aplicarRecargoProducto(JSON.parse(JSON.stringify(c)), "b", 0.45));
  ok("E9_recargo_individual_y_general_exento", r.lineas[0].recargo === 0.3 && r.lineas[1].recargo === 0.45 && r.lineas[1].unitario_neto === Math.ceil(r.lineas[1].costo_bruto * 1.45 / 2 - 1e-7) && r.lineas[0].unitario_neto === x.lineas[0].unitario_neto);
  ok("E10_texto_mercado_publico_exento", /Precio unitario exento/.test(textoParaMercadoPublico(c, x)) && /Total exento \(IVA \$0\)/.test(textoParaMercadoPublico(c, x)));
  ok("E11_formula_guardada_exenta", formulaParaGuardar(c).exenta === true && formulaParaGuardar(c).base_exenta === "costo_bruto" && FORMULA.exenta === undefined);
}
{
  // Utilidad negativa: se muestra tal cual (recargo negativo), sin ajustes.
  const x = calcularCotizacion(caso({ ...ap, recargo: -0.1 }));
  ok("E12_utilidad_negativa_sin_ajustes", x.totales.utilidad_neta < 0 && x.totales.neto === Math.ceil(2080000 * 0.9 - 1e-7));
}
// ── 3. Sin aprobación o con precios ya adjudicados: nunca exenta por defecto ──
{
  ok("S1_exenta_sin_clasificacion_aprobada_es_afecta", !calcularCotizacion(caso({ tratamiento_iva: "exenta_fora" })).exenta && !calcularCotizacion(caso({ clasificacion_id: "x" })).exenta);
  ok("S2_iva_cero_en_bases_no_basta", !calcularCotizacion(caso({ impuestos: 0, iva: 0, mp_impuestos: 0, observaciones: "IVA 0%" })).exenta);
  ok("S3_adjudicada_conserva_formula_afecta", !calcularCotizacion(caso({ ...ap, _exenta_fija: false })).exenta);
  ok("S4_adjudicada_conserva_formula_exenta", calcularCotizacion(caso({ _exenta_fija: true })).exenta);
}
console.log(`\n${nOk} OK · ${F.length} fallas`);
process.exit(F.length ? 1 : 0);
