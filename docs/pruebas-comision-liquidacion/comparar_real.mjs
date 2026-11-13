// Con los DATOS REALES de una copia (vía PostgREST, solo lectura): versión publicada vs nueva, comisión de cada vendedor y
// mes (calculada, pagada, saldo, OC incluidas) y los avisos nuevos (por revisar, refacturadas fuera, ajustes).
//   PGRST_URL=… JWT_SECRET=… USUARIO=… node comparar_liq.bundle.mjs
import { createHmac } from "node:crypto";
import * as N from "../../src/lib/calculos.js";
import * as A from "@anterior/calculos.js";
const { PGRST_URL, JWT_SECRET, USUARIO } = process.env;
const ANTES_DE = "2026-10";   // vigencia: los meses anteriores deben quedar idénticos
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
// Duplicados: con la versión nueva ninguna OC cuenta en dos meses, y ninguna OC pagada antes de octubre 2026 vuelve a contar
// desde octubre. Se informan también los duplicados que tenía la versión publicada.
const usos = (lib) => { const m = new Map(); for (const v of vendedores) for (const x of lib.mesesConFactura(v.id, ocs)) {
  const c = lib.calcularPagoVendedor({ vendedorId: v.id, ocs, anio: x.anio, mes: x.mes, ivaMensual, pagosVendedor }); (c?.detalle || []).forEach((l) => m.set(l.numero_oc, [...(m.get(l.numero_oc) || []), per(x)])); } return m; };
const uN = usos(N), uA = usos(A);
const dobleN = [...uN].filter(([, ms]) => ms.length > 1);
const pagadasPreOct = ocs.filter((o) => o.vendedor_pagado && N.liquidacionComision(o).liquidacion && N.liquidacionComision(o).liquidacion.anio * 12 + N.liquidacionComision(o).liquidacion.mes < 2026 * 12 + 10);
const repagoN = pagadasPreOct.filter((o) => (uN.get(o.numero_oc) || []).some((k) => k >= "2026-10")).map((o) => o.numero_oc);
const repagoA = pagadasPreOct.filter((o) => (uA.get(o.numero_oc) || []).some((k) => k >= "2026-10")).map((o) => `${o.numero_oc}(${(uA.get(o.numero_oc) || []).join(",")})`);
console.log(`DUPLICADOS|nueva: OC en dos meses ${dobleN.length}, pagadas antes de octubre que vuelven a contar ${repagoN.length}|publicada: pagadas antes de octubre que volvían a contar desde octubre ${repagoA.join(" ") || "ninguna"}`);
// Octubre 2026 en detalle (F29 y pagos registrados).
const esperado = Object.fromEntries(String(process.env.ESPERADO_OCTUBRE || "").split(",").filter(Boolean).map((x) => x.split("=")).map(([k, v]) => [k, Number(v)]));
const octubreMal = [];
for (const v of vendedores) { const c = N.calcularPagoVendedor({ vendedorId: v.id, ocs, anio: 2026, mes: 10, ivaMensual, pagosVendedor }); if (!c) continue;
  if (esperado[v.id] != null && esperado[v.id] !== c.pagoCalculado) octubreMal.push(`${v.id}: ${c.pagoCalculado} ≠ ${esperado[v.id]}`);
  console.log(`OCTUBRE|${v.id}|utilidad ordinaria ${c.sumaUtilidad}|utilidad del período ${c.periodo?.utilidadTotal}|descuento tributario ${c.descuentoF29} (IVA a pagar ${c.impIva} + PPM y otras ${c.retenciones})|comisión del período ${c.periodo?.total}|su parte ${c.comisionOrdinaria} (${c.periodo?.peso}/${c.periodo?.pesoTotal})|ventas propias ${c.pagoVentasPropias}|comisión del mes ${c.pagoCalculado}|pagado ${c.pagado}|saldo ${c.deuda}|provisoria ${N.comisionProvisoria(c)}|OC ${c.detalle.length}`); }
const liqs = ocs.filter((o) => N.generaComision(o) && N.liquidacionComision(o).refacturada).map((o) => { const l = N.liquidacionComision(o);
  return `${o.numero_oc}|${o.vendedor_id}|antes ${A.periodoComision(o) ? per(A.periodoComision(o)) : "-"}|ahora ${l.periodo ? per(l.periodo) : "ninguno (ya pagada)"}|liquidación ${l.liquidacion ? per(l.liquidacion) : "-"}|factura vigente ${l.actual ? per(l.actual) : "-"}|${l.pagada ? "pagada" : "no pagada"}|${l.anclada ? "anclada" : "derivada"}|${l.porRevisar ? "POR REVISAR: " + l.motivoRevision : "ok"}`; });
liqs.forEach((x) => console.log("OC_REFACTURADA|" + x));
console.log(`RESUMEN comparación de comisiones con datos reales: ${iguales + distintos} vendedor-mes, ${iguales} con montos idénticos, ${distintos} distintos (${distintosPrevios.length} anteriores a octubre 2026)`);
if (Object.keys(esperado).length) console.log(`OCTUBRE_ESPERADO|${octubreMal.length ? "NO COINCIDE: " + octubreMal.join("; ") : "coincide: " + JSON.stringify(esperado)}`);
if (distintosPrevios.length || dobleN.length || repagoN.length || octubreMal.length) { console.log("FALLA|" + JSON.stringify({ distintosPrevios, dobleN, repagoN, octubreMal })); process.exitCode = 1; }
