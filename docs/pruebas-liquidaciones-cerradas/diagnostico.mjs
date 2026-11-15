// Diagnóstico de SOLO LECTURA (copia vía PostgREST): cómo están hoy las liquidaciones de comisiones por vendedor y mes.
// Evidencia de cierre que existe en BFK Datos: pagos (pagos_vendedor), monto verificado (planilla/cartola), OC marcadas pagadas
// (vendedor_pagado + mes de liquidación) y utilidad liquidada (comision_utilidad, desde noviembre 2026). Sin datos personales.
import { createHmac } from "node:crypto";
import * as N from "../../src/lib/calculos.js";
const { PGRST_URL, JWT_SECRET, USUARIO } = process.env;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url"); const t = Math.floor(Date.now() / 1000);
const h = b64({ alg: "HS256", typ: "JWT" }), p = b64({ sub: USUARIO, role: "authenticated", aud: "authenticated", exp: t + 3600, iat: t });
const TOKEN = `${h}.${p}.${createHmac("sha256", JWT_SECRET).update(`${h}.${p}`).digest("base64url")}`;
const get = async (r) => { const x = await fetch(`${PGRST_URL}/${r}`, { headers: { Authorization: `Bearer ${TOKEN}` } }); if (!x.ok) throw new Error(`${x.status} ${r}`); return x.json(); };
const ocsTodas = await get("ordenes_compra_v2?select=*,eventos_factura(*)"); const ocs = ocsTodas.filter((o) => !o.archivada);
const ivaMensual = await get("iva_mensual?select=*"); const pagos = await get("pagos_vendedor?select=*"); const vendedores = await get("vendedores?select=id");
const per = (x) => `${x.anio}-${String(x.mes).padStart(2, "0")}`;
console.log("COLUMNAS_PAGOS|" + Object.keys(pagos[0] || {}).sort().join(","));
for (const q of [...pagos].sort((a, b) => per(a).localeCompare(per(b)) || String(a.fecha).localeCompare(String(b.fecha))))
  console.log(`PAGO|${q.vendedor_id}|${per(q)}|fecha ${String(q.fecha || "").slice(0, 10)}|pagado ${q.monto_pagado}|verificado ${q.monto_verificado ?? "-"}|transferido ${q.monto_transferido ?? "-"}|extra ${q.monto_extra_gestion ?? 0}|estado ${q.estado ?? "-"}|anulado ${q.anulado_en ? "sí" : "no"}|origen ${q.origen ?? q.fuente ?? "-"}`);
for (const v of vendedores) {
  const meses = new Map(); N.mesesConFactura(v.id, ocs).forEach((x) => meses.set(per(x), x));
  pagos.filter((q) => q.vendedor_id === v.id && !q.anulado_en).forEach((q) => meses.set(per(q), { anio: q.anio, mes: q.mes }));
  for (const [k, x] of [...meses].sort()) {
    const c = N.calcularPagoVendedor({ vendedorId: v.id, ocs, anio: x.anio, mes: x.mes, ivaMensual, pagosVendedor: pagos });
    const marcadas = ocs.filter((o) => o.vendedor_id === v.id && o.vendedor_pagado && N.periodoComision(o) && per(N.periodoComision(o)) === k).length;
    const evid = !c ? "sin cálculo" : c.esVerificado ? "VERIFICADA (monto verificado)" : c.pagado > 0 && c.deuda === 0 ? "PAGADA COMPLETA (sin verificación)" : c.pagado > 0 ? "PAGO PARCIAL" : "SIN PAGO";
    console.log(`MES|${v.id}|${k}|${evid}|calculado ${c?.pagoCalculado ?? "-"}|pagado ${c?.pagado ?? 0}|saldo ${c?.deuda ?? "-"}|por regularizar ${c?.porRegularizar ?? 0}|OC ${c?.detalle.length ?? 0}|OC marcadas pagadas ${marcadas}|descuento F29 ${c?.descuentoF29 ?? "-"}`);
  }
}
const conVend = ocs.filter((o) => N.generaComision(o) && o.vendedor_id);
console.log(`OC|con comisión ${conVend.length}|marcadas pagadas ${conVend.filter((o) => o.vendedor_pagado).length}|con mes anclado ${ocs.filter((o) => o.comision_anio != null).length}|con utilidad liquidada ${ocs.filter((o) => o.comision_utilidad != null).length}|período cerrado ${ocs.filter((o) => o.comision_cierre_anio != null).length}|por revisar ${ocs.filter((o) => o.comision_revision === "por_revisar").length}|creadas tras el cierre ${ocs.filter((o) => o.comision_tras_cierre).length}`);
// OC antiguas (factura hasta octubre 2026) SIN vendedor: si recibieran vendedor hoy, entrarían a un mes cerrado.
const antiguasSinVend = ocs.filter((o) => (o.tipo_registro || "venta") === "venta" && o.estado_factura_propia === "emitida" && !o.vendedor_id && !o.capitalizacion_bfk
  && N.facturaVigente(o) && N.anioMesDe(N.facturaVigente(o).fecha).anio * 12 + N.anioMesDe(N.facturaVigente(o).fecha).mes < 2026 * 12 + 11);
console.log(`OC_ANTIGUAS_SIN_VENDEDOR|${antiguasSinVend.length}|${antiguasSinVend.map((o) => `${o.numero_oc}(${String(N.facturaVigente(o).fecha).slice(0, 7)})`).slice(0, 40).join(" ")}`);
const excluidas = ocs.filter((o) => o.comision_excluida);
console.log(`OC_COMISION_EXCLUIDA|${excluidas.length}`);
// Pagos que no calzan con lo calculado (información; no se corrige nada).
