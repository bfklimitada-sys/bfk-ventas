// Con los DATOS REALES de una copia (vía PostgREST, solo lectura). También simula refacturar TODAS las OC en 2027 y 2028.
// versión publicada vs nueva, comisión de cada vendedor y
// mes (calculada, pagada, saldo, OC incluidas) y los avisos nuevos (por revisar, refacturadas fuera, ajustes).
//   PGRST_URL=… JWT_SECRET=… USUARIO=… node comparar_liq.bundle.mjs
import { createHmac } from "node:crypto";
import * as N from "../../src/lib/calculos.js";
import * as A from "@anterior/calculos.js";
import * as V from "@vigente/calculos.js";   // producción antes de esta regla (460951e), para mostrar lo que corrige
const { PGRST_URL, JWT_SECRET, USUARIO } = process.env;
const ANTES_DE = "2026-11";   // vigencia (13/11/2026 15:42): noviembre 2026; los meses anteriores, octubre incluido, deben quedar idénticos
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url"); const t = Math.floor(Date.now() / 1000);
const h = b64({ alg: "HS256", typ: "JWT" }), p = b64({ sub: USUARIO, role: "authenticated", aud: "authenticated", exp: t + 3600, iat: t });
const TOKEN = `${h}.${p}.${createHmac("sha256", JWT_SECRET).update(`${h}.${p}`).digest("base64url")}`;
const get = async (r) => { const x = await fetch(`${PGRST_URL}/${r}`, { headers: { Authorization: `Bearer ${TOKEN}` } }); if (!x.ok) throw new Error(`${x.status} ${r}`); return x.json(); };
const ocs = (await get("ordenes_compra_v2?select=*,eventos_factura(*)")).filter((o) => !o.archivada);
const ivaMensual = await get("iva_mensual?select=*"); const pagosVendedor = await get("pagos_vendedor?select=*"); const vendedores = await get("vendedores?select=id,nombre");
const per = (x) => `${x.anio}-${String(x.mes).padStart(2, "0")}`;
const res = (lib, v, a, m) => { const c = lib.calcularPagoVendedor({ vendedorId: v, ocs, anio: a, mes: m, ivaMensual, pagosVendedor }); return c && { calculado: c.pagoCalculado, pagado: c.pagado, saldo: c.deuda, verificado: c.esVerificado, ocs: c.detalle.map((l) => l.numero_oc).sort(), rev: (c.porRevisar || []).map((r) => `${r.numero_oc}${r.incluida ? "(incluida)" : "(excluida)"}`), fuera: (c.refacturadasFuera || []).map((r) => `${r.numero_oc}→${per(r.liquidacion)}${r.pagada ? "(pagada)" : ""}`), ajuste: c.ajusteUtilidadTotal || 0 }; };
let iguales = 0, distintos = 0; const distintosPrevios = [];
for (const v of vendedores) {
  const meses = new Map(); [...A.mesesConFactura(v.id, ocs), ...N.mesesConFactura(v.id, ocs)].forEach((x) => meses.set(per(x), x));
  pagosVendedor.filter((q) => q.vendedor_id === v.id && !q.anulado_en).forEach((q) => meses.set(per(q), { anio: q.anio, mes: q.mes }));
  for (const [k, x] of [...meses].sort()) {
    const a = res(A, v.id, x.anio, x.mes), n = res(N, v.id, x.anio, x.mes);
    const igualNum = JSON.stringify(a && { ...a, rev: 0, fuera: 0, ajuste: 0 }) === JSON.stringify(n && { ...n, rev: 0, fuera: 0, ajuste: 0 });
    if (igualNum) iguales++; else { distintos++; if (k < ANTES_DE) distintosPrevios.push(`${v.id} ${k}`); }
    const avisos = n && (n.rev.length || n.fuera.length || n.ajuste);
    if (!igualNum || avisos) {
      const ocsA = new Set(a?.ocs || []), ocsN = new Set(n?.ocs || []);
      console.log(`MES|${v.id}|${k}|antes calc ${a?.calculado ?? "-"} pagado ${a?.pagado ?? "-"} saldo ${a?.saldo ?? "-"}${a?.verificado ? " (verificado)" : ""}|ahora calc ${n?.calculado ?? "-"} pagado ${n?.pagado ?? "-"} saldo ${n?.saldo ?? "-"}`
        + `|entran ${[...ocsN].filter((x) => !ocsA.has(x)).join(",") || "-"}|salen ${[...ocsA].filter((x) => !ocsN.has(x)).join(",") || "-"}|por revisar ${n?.rev.join(",") || "-"}|refacturadas fuera ${n?.fuera.join(",") || "-"}|ajuste ${n?.ajuste || 0}`);
    }
  }
}
// Duplicados: con la versión nueva ninguna OC que cuente desde noviembre 2026 cuenta además en otro mes, y ninguna OC pagada
// antes de noviembre vuelve a contar desde noviembre. Los duplicados anteriores a la vigencia (octubre incluido) se dejan como
// estaban y solo se informan.
const usos = (lib) => { const m = new Map(); for (const v of vendedores) for (const x of lib.mesesConFactura(v.id, ocs)) {
  const c = lib.calcularPagoVendedor({ vendedorId: v.id, ocs, anio: x.anio, mes: x.mes, ivaMensual, pagosVendedor }); (c?.detalle || []).forEach((l) => m.set(l.numero_oc, [...(m.get(l.numero_oc) || []), per(x)])); } return m; };
const uN = usos(N), uA = usos(A);
const dobleN = [...uN].filter(([, ms]) => ms.length > 1 && ms.some((k) => k >= ANTES_DE));
const doblePrevios = [...uN].filter(([, ms]) => ms.length > 1 && !ms.some((k) => k >= ANTES_DE)).map(([o, ms]) => `${o}(${ms.join(",")})`);
const pagadasPrevias = ocs.filter((o) => o.vendedor_pagado && N.liquidacionComision(o).liquidacion && N.liquidacionComision(o).liquidacion.anio * 12 + N.liquidacionComision(o).liquidacion.mes < 2026 * 12 + 11);
const repagoN = pagadasPrevias.filter((o) => (uN.get(o.numero_oc) || []).some((k) => k >= ANTES_DE)).map((o) => o.numero_oc);
const repagoA = pagadasPrevias.filter((o) => (uA.get(o.numero_oc) || []).some((k) => k >= ANTES_DE)).map((o) => `${o.numero_oc}(${(uA.get(o.numero_oc) || []).join(",")})`);
console.log(`DUPLICADOS|nueva: OC en dos meses (desde noviembre) ${dobleN.length}, pagadas antes de noviembre que vuelven a contar ${repagoN.length}|anteriores a la vigencia, se dejan como estaban: ${doblePrevios.join(" ") || "ninguno"}|publicada: pagadas antes de noviembre que volvían a contar desde noviembre ${repagoA.join(" ") || "ninguna"}`);
// Octubre 2026 en detalle (F29 y pagos registrados).
const esperado = Object.fromEntries(String(process.env.ESPERADO_OCTUBRE || "").split(",").filter(Boolean).map((x) => x.split("=")).map(([k, v]) => [k, Number(v)]));
const octubreMal = [];
for (const v of vendedores) { const c = N.calcularPagoVendedor({ vendedorId: v.id, ocs, anio: 2026, mes: 10, ivaMensual, pagosVendedor }); if (!c) continue;
  if (esperado[v.id] != null && esperado[v.id] !== c.pagoCalculado) octubreMal.push(`${v.id}: ${c.pagoCalculado} ≠ ${esperado[v.id]}`);
  console.log(`OCTUBRE|${v.id}|utilidad ordinaria ${c.sumaUtilidad}|utilidad del período ${c.periodo?.utilidadTotal}|descuento tributario ${c.descuentoF29} (IVA a pagar ${c.impIva} + PPM y otras ${c.retenciones})|comisión del período ${c.periodo?.total}|su parte ${c.comisionOrdinaria} (${c.periodo?.peso}/${c.periodo?.pesoTotal})|ventas propias ${c.pagoVentasPropias}|comisión del mes ${c.pagoCalculado}|pagado ${c.pagado}|saldo ${c.deuda}|provisoria ${N.comisionProvisoria(c)}|OC ${c.detalle.length}`); }
const liqs = ocs.filter((o) => N.generaComision(o) && N.liquidacionComision(o).refacturada).map((o) => { const l = N.liquidacionComision(o);
  return `${o.numero_oc}|${o.vendedor_id}|antes ${A.periodoComision(o) ? per(A.periodoComision(o)) : "-"}|ahora ${l.periodo ? per(l.periodo) : "ninguno (ya pagada)"}|liquidación ${l.liquidacion ? per(l.liquidacion) : "-"}|factura vigente ${l.actual ? per(l.actual) : "-"}|${l.pagada ? "pagada" : "no pagada"}|${l.anclada ? "anclada" : "derivada"}|${l.porRevisar ? "POR REVISAR: " + l.motivoRevision : "ok"}`; });
liqs.forEach((x) => console.log("OC_REFACTURADA|" + x));
console.log(`RESUMEN comparación de comisiones con datos reales: ${iguales + distintos} vendedor-mes, ${iguales} con montos idénticos, ${distintos} distintos (${distintosPrevios.length} anteriores a noviembre 2026)`);
if (Object.keys(esperado).length) console.log(`OCTUBRE_ESPERADO|${octubreMal.length ? "NO COINCIDE: " + octubreMal.join("; ") : "coincide: " + JSON.stringify(esperado)}`);
// ── Regla definitiva (13/11/2026 16:15): simulación con los datos reales. Todas las OC con comisión se anulan (NC código 1)
// y se refacturan en marzo 2027, y otra vez en febrero 2028. Ningún mes anterior cambia (cálculo, OC y montos), ningún mes
// nuevo genera comisión por ellas y cada OC cuenta en un solo mes. Solo en memoria: no escribe nada.
const refacturarTodo = (lista, fecha) => lista.map((o) => { if (!N.generaComision(o) || !o.vendedor_id) return o; const vig = N.facturasVigentes(o); if (!vig.length) return o;
  const nuevos = vig.flatMap((f, i) => [{ id: `sim-nc-${fecha}-${o.id}-${i}`, oc_id: o.id, numero_factura: `SNC${fecha}${i}${o.id}`, fecha, monto: Number(f.monto) || 0, tipo_dte: 61, ref_folio: f.numero_factura, ref_codigo: 1 },
    { id: `sim-f-${fecha}-${o.id}-${i}`, oc_id: o.id, numero_factura: `SF${fecha}${i}${o.id}`, fecha, monto: Number(f.monto) || 0, tipo_dte: f.tipo_dte ?? 33 }]);
  return { ...o, eventos_factura: [...(o.eventos_factura || []), ...nuevos] }; });
const cuadro = (lista, L = N) => { const m = new Map(); for (const v of vendedores) for (const x of L.mesesConFactura(v.id, lista)) {
  const c = L.calcularPagoVendedor({ vendedorId: v.id, ocs: lista, anio: x.anio, mes: x.mes, ivaMensual, pagosVendedor });
  if (c) m.set(`${v.id}|${per(x)}`, JSON.stringify({ calc: c.pagoCalculado, pagado: c.pagado, saldo: c.deuda, util: c.sumaUtilidad, ocs: c.detalle.map((l) => `${l.numero_oc}:${l.utilidad}`).sort() })); } return m; };
const conComision = ocs.filter((o) => N.generaComision(o) && o.vendedor_id && N.facturasVigentes(o).length);
const sim1 = refacturarTodo(ocs, "2027-03-15"), sim2 = refacturarTodo(sim1, "2028-02-10");
const base0 = cuadro(ocs), base2 = cuadro(sim2);
const cambiados = [...base0].filter(([k, v]) => base2.get(k) !== v).map(([k]) => k);
const nuevosMeses = [...base2.keys()].filter((k) => !base0.has(k));
const v0 = cuadro(ocs, V), v2 = cuadro(sim2, V);
const cambiadosV = [...v0].filter(([k, x]) => v2.get(k) !== x).length, nuevosV = [...v2.keys()].filter((k) => !v0.has(k)).length;
const cerradas = ocs.filter((o) => o.comision_cierre_anio != null).length;
const periodoMenorNov = ocs.filter((o) => N.generaComision(o) && o.vendedor_id && N.periodoComision(o) && N.periodoComision(o).anio * 12 + N.periodoComision(o).mes < 2026 * 12 + 11).length;
const sinCierreAntesNov = ocs.filter((o) => N.generaComision(o) && o.vendedor_id && o.comision_cierre_anio == null && N.periodoComision(o) && N.periodoComision(o).anio * 12 + N.periodoComision(o).mes < 2026 * 12 + 11).map((o) => o.numero_oc);
console.log(`SIMULACION_REFACTURAR|oc_refacturadas=${conComision.length} (dos veces: mar-2027 y feb-2028)|vendedor_mes=${base0.size}|cambiados=${cambiados.length}|meses_nuevos_con_comision=${nuevosMeses.length}${nuevosMeses.length ? " " + nuevosMeses.join(",") : ""}|version_anterior_460951e: cambiados=${cambiadosV} meses_nuevos_con_comision=${nuevosV}`);
console.log(`PERIODO_CERRADO|oc_con_periodo_cerrado=${cerradas}|oc_con_comision_hasta_octubre=${periodoMenorNov}|sin_periodo_cerrado=${sinCierreAntesNov.length}${sinCierreAntesNov.length ? " " + sinCierreAntesNov.join(",") : ""}`);
const fallaSim = cambiados.length || nuevosMeses.length || (process.env.EXIGIR_CIERRE && sinCierreAntesNov.length);
if (fallaSim) { console.log("FALLA|" + JSON.stringify({ cambiados, nuevosMeses, sinCierreAntesNov })); process.exitCode = 1; }
// Mes de comisión de cada OC según la app (para compararlo con fin_periodo_comision de la base): PERIODOS_SALIDA=archivo.
if (process.env.PERIODOS_SALIDA) { const fs = await import("node:fs");
  fs.writeFileSync(process.env.PERIODOS_SALIDA, ocs.map((o) => { const x = N.periodoComision(o); return `${o.id}|${x ? per(x) : "-"}`; }).sort().join("\n") + "\n"); }
if (distintosPrevios.length || dobleN.length || repagoN.length || octubreMal.length) { console.log("FALLA|" + JSON.stringify({ distintosPrevios, dobleN, repagoN, octubreMal })); process.exitCode = 1; }
