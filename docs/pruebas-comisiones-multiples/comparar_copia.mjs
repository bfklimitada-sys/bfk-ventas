// Etapa 4 — comparación de comisiones ANTES (regla vigente en producción, cfedaf0, congelada en ./anterior) y DESPUÉS
// (regla común del período, src/lib) con los datos REALES de una copia restaurada. SOLO LECTURA.
// Por período y vendedor: utilidad ordinaria, descuento tributario, comisión anterior y nueva, ventas propias, pagado,
// verificado y si el período está CERRADO (todas sus comisiones pagadas o verificadas) o ABIERTO.
// «Nueva (sin vigencia)» aplica la regla nueva a TODOS los períodos para mostrar el efecto completo; «nueva vigente» es lo
// que mostraría la app con COMISION_PERIODO_DESDE (los períodos anteriores conservan el cálculo anterior).
// Conexión: variables PG* (copia) o DB_URL. Salida: líneas C|… (detalle), P|… (período), R|… (resumen).
import { execFileSync } from "node:child_process";
import * as N from "../../src/lib/calculos.js";
import * as A from "./anterior/calculos.js";

const conn = process.env.DB_URL ? [process.env.DB_URL] : [];
const env = { ...process.env, PGOPTIONS: "-c default_transaction_read_only=on" };
const sh = (sql) => execFileSync(process.env.PSQL || "psql", [...conn, "-X", "-At", "-q", "-v", "ON_ERROR_STOP=1"], { input: sql, env, encoding: "utf8", maxBuffer: 1 << 29 }).trim();
const tabla = (t) => JSON.parse(sh(`select coalesce(jsonb_agg(to_jsonb(x)),'[]') from public.${t} x`));
const todas = JSON.parse(sh(`select coalesce(jsonb_agg(to_jsonb(o) || jsonb_build_object('eventos_factura',(select coalesce(jsonb_agg(to_jsonb(e)),'[]') from public.eventos_factura e where e.oc_id=o.id))),'[]') from public.ordenes_compra_v2 o`));
const ocs = todas.filter((o) => !o.archivada);   // la app calcula comisiones solo con OC activas
const iva = tabla("iva_mensual"), pv = tabla("pagos_vendedor"), vend = tabla("vendedores");
const nombre = new Map(vend.map((v) => [v.id, v.nombre]));
const hoy = new Date(process.env.HOY || Date.now());
const D = N.COMISION_PERIODO_DESDE;

// Períodos con comisión (por la regla vigente: mes de la factura vigente).
const periodos = new Map();
for (const v of vend) for (const { anio, mes } of A.mesesConFactura(v.id, ocs)) {
  const k = `${anio}-${String(mes).padStart(2, "0")}`; if (!periodos.has(k)) periodos.set(k, { anio, mes, v: [] }); periodos.get(k).v.push(v.id);
}
const $ = (n) => Math.round(n).toLocaleString("es-CL");
let nPer = 0, nMulti = 0, nCerr = 0, nAbi = 0, nMultiCerr = 0, nMultiAbi = 0, difTotal = 0, difVigente = 0, difAbiertos = 0, difCerrados = 0, negativos = 0, soloVP = 0, iguales = 0;
const lineas = [];
for (const [k, p] of [...periodos.entries()].sort()) {
  nPer++;
  const per = N.comisionOrdinariaPeriodo({ ocs, anio: p.anio, mes: p.mes, ivaMensual: iva });
  const filas = p.v.map((id) => {
    const a = A.calcularPagoVendedor({ vendedorId: id, ocs, anio: p.anio, mes: p.mes, ivaMensual: iva, pagosVendedor: pv });
    const n = N.calcularPagoVendedor({ vendedorId: id, ocs, anio: p.anio, mes: p.mes, ivaMensual: iva, pagosVendedor: pv });
    const parte = per.partes.get(String(id)) || 0;
    const nuevaSinVigencia = a.esVerificado ? a.pagoCalculado : parte + a.pagoVentasPropias;
    const estado = A.estadoComisionMes(a, hoy);
    const cerrado = a.esVerificado || estado === "pagada";
    return { id, a, n, parte, nuevaSinVigencia, estado, cerrado };
  });
  const cerrado = filas.every((f) => f.cerrado);
  cerrado ? nCerr++ : nAbi++;
  if (per.vendedores > 1) { nMulti++; cerrado ? nMultiCerr++ : nMultiAbi++; }
  if ([...per.utilidades.values()].some((u) => u <= 0) && per.vendedores > 1) negativos++;
  const dA = filas.reduce((s, f) => s + f.a.pagoCalculado, 0), dN = filas.reduce((s, f) => s + f.nuevaSinVigencia, 0), dV = filas.reduce((s, f) => s + f.n.pagoCalculado, 0);
  difTotal += dN - dA; difVigente += dV - dA; cerrado ? (difCerrados += dN - dA) : (difAbiertos += dN - dA);
  if (dN === dA) iguales++;
  for (const f of filas) {
    if (!per.utilidades.has(f.id) && f.a.pagoCalculado !== f.nuevaSinVigencia) soloVP++;
    lineas.push(["C", k, nombre.get(f.id) || f.id.slice(0, 8), per.utilidades.has(f.id) ? $(per.utilidades.get(f.id)) : "solo ventas propias", $(f.a.pagoCalculado - f.a.pagoVentasPropias), $(f.parte), $(f.a.pagoVentasPropias),
      $(f.a.pagoCalculado), $(f.nuevaSinVigencia), $(f.nuevaSinVigencia - f.a.pagoCalculado), $(f.n.pagoCalculado), $(f.a.pagado), f.a.esVerificado ? "verificado" : "-", f.estado, f.cerrado ? "cerrado" : "abierto"].join("|"));
  }
  lineas.push(["P", k, per.vendedores, $(per.utilidadTotal), per.sinIva ? "sin IVA (regla abril 2025)" : `${$(per.impIva)} + ${$(per.retenciones)} = ${$(per.descuentoF29)}`, $(per.total), per.metodo,
    $(dA), $(dN), $(dN - dA), N.aplicaComisionPeriodo(p.anio, p.mes) ? "regla nueva vigente" : "regla anterior (antes de la vigencia)", cerrado ? "cerrado" : "abierto"].join("|"));
}
console.log("H|C|período|vendedor|utilidad ordinaria|comisión ordinaria anterior|parte nueva|ventas propias|total anterior|total nuevo (sin vigencia)|diferencia|total vigente en la app|pagado|verificado|estado (regla anterior)|cierre");
console.log("H|P|período|vendedores ordinarios|utilidad ordinaria total|descuento tributario (IVA neto + retenciones)|comisión ordinaria total nueva|método|suma anterior|suma nueva|diferencia|vigencia|cierre");
lineas.forEach((l) => console.log(l));
console.log(`R|periodos=${nPer}|con_2_o_mas_vendedores=${nMulti}|cerrados=${nCerr}|abiertos=${nAbi}|multi_cerrados=${nMultiCerr}|multi_abiertos=${nMultiAbi}|periodos_sin_diferencia=${iguales}`);
console.log(`R|diferencia_total_sin_vigencia=${$(difTotal)}|en_cerrados=${$(difCerrados)}|en_abiertos=${$(difAbiertos)}|diferencia_vigente_en_la_app=${$(difVigente)}|vigencia_desde=${D.anio}-${String(D.mes).padStart(2, "0")}`);
console.log(`R|periodos_multi_con_utilidad_no_positiva=${negativos}|vendedores_solo_ventas_propias_con_cambio=${soloVP}|ocs_activas=${ocs.length}|vendedores=${vend.length}|iva_mensual=${iva.length}|pagos=${pv.length}`);
