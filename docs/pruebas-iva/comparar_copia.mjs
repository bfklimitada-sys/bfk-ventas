// Compara, con los datos REALES de la copia restaurada, la regla anterior (754c466, congelada en ./anterior)
// con la nueva (src/lib). Solo lectura. Imprime agregados, sin filas.
import { execFileSync } from "node:child_process";
import * as N from "../../src/lib/calculos.js";
import * as NF from "../../src/lib/f29.js";
import * as A from "./anterior/calculos.js";
import * as AF from "./anterior/f29.js";
const sh = (sql) => execFileSync(process.env.PSQL || "psql", ["-X", "-At", "-q", "-v", "ON_ERROR_STOP=1"], { input: sql, encoding: "utf8", maxBuffer: 1 << 29 }).trim();
const tabla = (t) => JSON.parse(sh(`select coalesce(jsonb_agg(to_jsonb(x)),'[]') from public.${t} x`));
const todas = JSON.parse(sh(`select coalesce(jsonb_agg(to_jsonb(o) || jsonb_build_object('eventos_factura',(select coalesce(jsonb_agg(to_jsonb(e)),'[]') from public.eventos_factura e where e.oc_id=o.id))),'[]') from public.ordenes_compra_v2 o`));
const ocs = todas.filter((o) => !o.archivada);
const iva = tabla("iva_mensual"), pv = tabla("pagos_vendedor"), vend = tabla("vendedores"), gastos = tabla("gastos_indirectos");
let filas = 0, dif = 0, conNeg = 0, propias = 0, verif = 0; const F = [];
for (const v of vend) for (const { anio, mes } of N.mesesConFactura(v.id, ocs)) {
  const a = A.calcularPagoVendedor({ vendedorId: v.id, ocs, anio, mes, ivaMensual: iva, pagosVendedor: pv });
  const n = N.calcularPagoVendedor({ vendedorId: v.id, ocs, anio, mes, ivaMensual: iva, pagosVendedor: pv });
  filas++; if (n.esVerificado) verif++; if (n.pagoVentasPropias > 0) propias++; if (n.impIva < 0) conNeg++;
  for (const k of ["pagoCalculado", "deuda", "estado", "pagado", "sumaUtilidad", "pagoVentasPropias", "esVerificado", "ivaRegistrado", "sinIva"]) if (a[k] !== n[k]) { dif++; F.push(`${anio}-${mes}:${k}`); }
  if (n.impIva >= 0 && a.impIva !== n.impIva) { dif++; F.push(`${anio}-${mes}:impIva`); }
}
console.log(`COMISIONES vendedor-mes=${filas} verificados=${verif} con_venta_propia=${propias} con_IVA_neto_negativo=${conNeg} diferencias=${dif} ${F.slice(0, 10).join(" ")}`);
// Panel: deuda de vendedores y F29 para cada mes con datos (como si "hoy" fuera ese mes)
const meses = new Set(); iva.forEach((i) => meses.add(`${i.anio}-${i.mes}`)); gastos.forEach((g) => g.anio && meses.add(`${g.anio}-${g.mes}`));
let difPanel = 0, nPanel = 0;
for (const k of meses) {
  const [anio, mes] = k.split("-").map(Number); nPanel++;
  const dA = vend.reduce((s, v) => s + (A.calcularPagoVendedor({ vendedorId: v.id, ocs, anio, mes, ivaMensual: iva, pagosVendedor: pv })?.deuda || 0), 0);
  const dN = vend.reduce((s, v) => s + (N.calcularPagoVendedor({ vendedorId: v.id, ocs, anio, mes, ivaMensual: iva, pagosVendedor: pv })?.deuda || 0), 0);
  const fA = AF.calcularF29({ ivaMensual: iva, gastos, anioActual: anio, mesActual: mes }), fN = NF.calcularF29({ ivaMensual: iva, gastos, anioActual: anio, mesActual: mes });
  if (dA !== dN || JSON.stringify(fA) !== JSON.stringify(fN)) { difPanel++; console.log(`DIF_PANEL ${k}`); }
}
console.log(`PANEL meses_evaluados=${nPanel} diferencias_deuda_vendedores_o_F29=${difPanel}`);
const neg = iva.filter((i) => N.ivaNetoPeriodo(i) < 0).map((i) => `${i.anio}-${i.mes}`);
console.log(`PERIODOS_IVA=${iva.length} con_neto_negativo=${neg.length} (${neg.join(" ")}) con_neto_cero=${iva.filter((i) => N.ivaNetoPeriodo(i) === 0).length}`);
const ok = dif === 0 && difPanel === 0 && conNeg === 0;
console.log(ok ? "RESULT|regla_nueva_sin_diferencias_en_datos_reales|OK" : "FALLA|diferencias_en_datos_reales");
process.exit(ok ? 0 : 1);
