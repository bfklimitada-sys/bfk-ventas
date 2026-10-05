// Análisis (solo lectura, copia restaurada) del IVA usado en comisiones. Imprime solo agregados por período.
import { execFileSync } from "node:child_process";
import { calcularPagoVendedor, mesesConFactura, anioMesDe } from "../../src/lib/calculos.js";
const sh = (sql) => execFileSync(process.env.PSQL || "psql", ["-X", "-At", "-q", "-v", "ON_ERROR_STOP=1"], { input: sql, encoding: "utf8", maxBuffer: 1 << 29 }).trim();
const tabla = (t, extra = "") => JSON.parse(sh(`select coalesce(jsonb_agg(to_jsonb(x)),'[]') from public.${t} x ${extra}`));
const ocs = JSON.parse(sh(`select coalesce(jsonb_agg(to_jsonb(o) || jsonb_build_object('eventos_factura',(select coalesce(jsonb_agg(to_jsonb(e)),'[]') from public.eventos_factura e where e.oc_id=o.id))),'[]') from public.ordenes_compra_v2 o`))
  .filter((o) => !o.archivada);
const iva = tabla("iva_mensual"), pv = tabla("pagos_vendedor"), vend = tabla("vendedores"), gastos = tabla("gastos_indirectos");
const neto = (i) => (Number(i.iva_ventas) || 0) - (Number(i.iva_compras) || 0);
console.log("IVA_MENSUAL periodos:", iva.length, "| neto>0:", iva.filter((i) => neto(i) > 0).length, "| neto=0:", iva.filter((i) => neto(i) === 0).length, "| neto<0:", iva.filter((i) => neto(i) < 0).length);
console.log("IVA_MENSUAL rango:", iva.map((i) => `${i.anio}-${String(i.mes).padStart(2, "0")}`).sort().join(" "));
console.log("IVA_MENSUAL negativos:", iva.filter((i) => neto(i) < 0).map((i) => `${i.anio}-${i.mes}`).join(" ") || "-");
console.log("iva_pagado distinto de max(0,neto):", iva.filter((i) => i.iva_pagado != null && Number(i.iva_pagado) !== Math.max(0, neto(i))).length, "| iva_pagado null:", iva.filter((i) => i.iva_pagado == null).length);
console.log("columnas iva_mensual:", Object.keys(iva[0] || {}).join(","));
// Comparación con el IVA de las facturas del mes y con gastos Impuesto SII
for (const i of iva.slice().sort((a, b) => a.anio - b.anio || a.mes - b.mes)) {
  let fact = 0; for (const o of ocs) for (const f of o.eventos_factura || []) { const p = anioMesDe(f.fecha); if (p.anio === i.anio && p.mes === i.mes) fact += Number(f.monto) || 0; }
  const sii = gastos.filter((g) => g.categoria_id === "cat_impuesto" && Number(g.anio) === i.anio && Number(g.mes) === i.mes).reduce((s, g) => s + (Number(g.monto) || 0), 0);
  const vendMes = vend.filter((v) => calcularPagoVendedor({ vendedorId: v.id, ocs, anio: i.anio, mes: i.mes, ivaMensual: iva, pagosVendedor: pv })).length;
  console.log(`P ${i.anio}-${String(i.mes).padStart(2, "0")} neto=${neto(i)} ivaFacturasApp=${Math.round(fact - fact / 1.19)} gastoSII=${sii} vendedoresConFacturas=${vendMes}`);
}
// Vendedores x mes: comisión actual vs IVA neto sin tope en 0
let filas = 0, distintas = 0, verificados = 0, sinIvaReg = 0;
for (const v of vend) for (const { anio, mes } of mesesConFactura(v.id, ocs)) {
  const r = calcularPagoVendedor({ vendedorId: v.id, ocs, anio, mes, ivaMensual: iva, pagosVendedor: pv }); if (!r) continue; filas++;
  if (r.esVerificado) verificados++; if (!r.ivaRegistrado && !r.sinIva) sinIvaReg++;
  const i = iva.find((x) => x.mes === mes && x.anio === anio); const n = i && !r.sinIva ? neto(i) : 0;
  const alt = Math.max(0, Math.round(r.sumaUtilidad / 2 - n / 2)) + r.pagoVentasPropias;
  const actualFormula = Math.max(0, Math.round(r.sumaUtilidad / 2 - r.impIva / 2)) + r.pagoVentasPropias;
  if (alt !== actualFormula) { distintas++; console.log(`DIF vend=${vend.indexOf(v)} ${anio}-${mes} verificado=${r.esVerificado} actual=${actualFormula} netoSinTope=${alt}`); }
}
console.log("VENDEDOR-MES:", filas, "| verificados:", verificados, "| sin IVA registrado:", sinIvaReg, "| distintos con neto sin tope:", distintas);
