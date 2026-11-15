// Genera el SQL de las liquidaciones HISTÓRICAS cerradas (hasta octubre 2026) con el cálculo VIGENTE de la app, sin
// recalcular nada: solo meses con evidencia (monto verificado o pago completo). Lee una copia vía PostgREST (solo lectura).
// Kevin (15/11/2026): las pagadas sin monto verificado se protegen tal como están. Un pago parcial no cierra el mes.
//   PGRST_URL=… JWT_SECRET=… USUARIO=… SALIDA=historicas.sql node generar_historicas.bundle.mjs
import { createHmac } from "node:crypto";
import { writeFileSync } from "node:fs";
import * as N from "../../src/lib/calculos.js";
const { PGRST_URL, JWT_SECRET, USUARIO, SALIDA } = process.env;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url"); const t = Math.floor(Date.now() / 1000);
const h = b64({ alg: "HS256", typ: "JWT" }), p = b64({ sub: USUARIO, role: "authenticated", aud: "authenticated", exp: t + 3600, iat: t });
const TOKEN = `${h}.${p}.${createHmac("sha256", JWT_SECRET).update(`${h}.${p}`).digest("base64url")}`;
const get = async (r) => { const x = await fetch(`${PGRST_URL}/${r}`, { headers: { Authorization: `Bearer ${TOKEN}` } }); if (!x.ok) throw new Error(`${x.status} ${r}`); return x.json(); };
const ocs = (await get("ordenes_compra_v2?select=*,eventos_factura(*)")).filter((o) => !o.archivada);
const ivaMensual = await get("iva_mensual?select=*"); const pagos = await get("pagos_vendedor?select=*"); const vendedores = await get("vendedores?select=id");
const q = (v) => (v == null ? "null" : typeof v === "number" ? String(Math.round(v * 100) / 100) : typeof v === "boolean" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const filas = [], ocsF = [], chequeos = []; const omitidos = [];
for (const v of vendedores) {
  const meses = new Set(pagos.filter((x) => x.vendedor_id === v.id && !x.anulado_en).map((x) => `${x.anio}-${x.mes}`));
  for (const k of meses) {
    const [anio, mes] = k.split("-").map(Number);
    if (anio * 12 + mes >= 2026 * 12 + 11) continue;
    const c = N.calcularPagoVendedor({ vendedorId: v.id, ocs, anio, mes, ivaMensual, pagosVendedor: pagos });
    if (!c) { omitidos.push(`${v.id} ${k}: pago sin cálculo`); continue; }
    const origen = c.esVerificado ? "historica_verificada" : c.pagado > 0 && c.deuda === 0 ? "historica_pagada" : null;
    if (!origen) { omitidos.push(`${v.id} ${k}: pago parcial (no se cierra)`); continue; }
    const d = N.datosCierre(c, v.id, origen); const id = `cl_${v.id}_${anio}_${String(mes).padStart(2, "0")}`;
    filas.push(`(${[id, d.vendedor_id, anio, mes, origen, d.comision_reconocida, d.comision_ordinaria, d.ventas_propias, d.utilidad_vendedor, d.utilidad_periodo, d.descuento_f29, d.regla_periodo, d.peso, d.peso_total, d.pagado_al_cierre].map(q).join(", ")}, null, 'Registrada el 15/11/2026 con el cálculo vigente, sin recalcular (${origen === "historica_verificada" ? "monto verificado" : "pagada completa sin monto verificado"})')`);
    for (const o of d.ocs) ocsF.push(`(${[id, o.oc_id, o.numero_oc, o.utilidad, o.venta_propia, o.pago_venta_propia].map(q).join(", ")})`);
    chequeos.push(`(${[id, d.pagado_al_cierre, c.esVerificado ? Number(c.pagos.find((x) => x.monto_verificado != null).monto_verificado) : null].map(q).join(", ")})`);
    console.log(`HISTORICA|${id}|${origen}|reconocida ${d.comision_reconocida}|pagado ${d.pagado_al_cierre}|OC ${d.ocs.length}|descuento F29 ${d.descuento_f29}${c.porRegularizar ? `|POR REGULARIZAR ${c.porRegularizar}` : ""}`);
  }
}
omitidos.forEach((x) => console.log("OMITIDA|" + x));
const sql = `-- Generado ${new Date().toISOString()} desde la copia del respaldo del día con la regla vigente de la app (sin recalcular).
insert into public.comision_liquidaciones (id, vendedor_id, anio, mes, origen, comision_reconocida, comision_ordinaria, ventas_propias, utilidad_vendedor, utilidad_periodo, descuento_f29, regla_periodo, peso, peso_total, pagado_al_cierre, cerrada_por, nota) values
${filas.join(",\n")};
insert into public.comision_liquidacion_ocs (liquidacion_id, oc_id, numero_oc, utilidad, venta_propia, pago_venta_propia) values
${ocsF.join(",\n")};
-- Comprobación en la misma transacción: pagos y montos verificados iguales a los de la generación; utilidad de cada OC
-- (venta − costo) igual a la registrada. Si algo cambió entre el respaldo y la migración, se revierte todo.
do $$ declare n int; begin
  select count(*) into n from (values ${chequeos.join(", ")}) x(id, pagado, verificado) join public.comision_liquidaciones l on l.id = x.id
   where abs(public.comision_pagado_mes(l.vendedor_id, l.anio, l.mes) - x.pagado) > 0.005
      or (x.verificado is not null and not exists (select 1 from public.pagos_vendedor v where v.vendedor_id = l.vendedor_id and v.anio = l.anio and v.mes = l.mes and v.anulado_en is null and v.monto_verificado = x.verificado));
  if n > 0 then raise exception 'CL-HIST: % liquidaciones con pagos distintos a los de la generación: se revierte', n; end if;
  select count(*) into n from public.comision_liquidacion_ocs r join public.ordenes_compra_v2 o on o.id = r.oc_id
   where abs((coalesce(o.monto_total, 0) - coalesce(o.costo_total, 0)) - r.utilidad) > 0.005;
  if n > 0 then raise exception 'CL-HIST: % OC con utilidad distinta a la de la generación: se revierte', n; end if;
  if (select count(*) from public.comision_liquidacion_ocs r where not exists (select 1 from public.ordenes_compra_v2 o where o.id = r.oc_id)) > 0 then raise exception 'CL-HIST: OC inexistente'; end if;
  raise notice 'CL-HIST|liquidaciones=%|oc=%', ${filas.length}, ${ocsF.length};
end $$;
`;
writeFileSync(SALIDA || "historicas.sql", sql);
console.log(`GENERADAS|${filas.length} liquidaciones|${ocsF.length} OC|${omitidos.length} omitidas`);
