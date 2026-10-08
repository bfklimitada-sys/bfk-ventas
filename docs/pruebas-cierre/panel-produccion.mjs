// Números del Panel en producción (SOLO LECTURA). Lee un JSON con los mismos datos que carga la app
// y aplica EXACTAMENTE resumenCaja() del Panel. Imprime solo agregados (sin datos de clientes).
// Uso: node panel.bundle.mjs datos.json
import { readFileSync } from "node:fs";
import { resumenCaja } from "../../src/lib/caja.js";

const d = JSON.parse(readFileSync(process.argv[2], "utf8"));
const ocs = (d.ocs || []).filter((o) => !o.archivada);
const r = resumenCaja({
  ocs, financiadores: d.financiadores || [], gastos: d.gastos || [], pagosVendedor: d.pagosVendedor || [],
  ivaMensual: d.ivaMensual || [], vendedores: d.vendedores || [], pagoFinSueltos: d.pagoFinSueltos || [],
  aportes: d.aportes || [], saldoBanco: d.saldoBanco || null,
});
const $ = (v) => Math.round(Number(v) || 0);
const mm = (x) => `${x.anio}-${String(x.mes).padStart(2, "0")}`;
const c = r.conciliacion;
console.log(`PANEL_CAJA:${$(r.caja)}`);
console.log(`PANEL_POR_COBRAR:${$(r.porCobrar)}`);
console.log(`PANEL_VALE_VISTA:${$(r.valeVista)} (${r.nValeVista})`);
console.log(`PANEL_DEUDA_FIN:${$(r.deudaFinanciadores)} ${r.porFinanciador.map((f) => `${f.id}=${$(f.saldo)}`).join(" ")}`);
console.log(`PANEL_COMISIONES:${$(r.comisiones.total)} definitivas=${$(r.comisiones.definitivas)} provisorias=${$(r.comisiones.provisorias)}`);
console.log(`PANEL_COMISIONES_DETALLE:${r.comisiones.detalle.map((x) => `${x.vendedorId}/${mm(x)}=${$(x.deuda)}${x.provisoria ? "P" : ""}`).join(" ") || "-"}`);
console.log(`PANEL_F29:${$(r.f29Pendiente)}`);
console.log(`PANEL_IVA_SIN_REGISTRAR:${r.ivaSinRegistrar.map(mm).join(",") || "-"}`);
console.log(`PANEL_EXTERNOS:${$(r.fondosExternos)}`);
console.log(`PANEL_PROYECTADO:${$(r.saldoProyectado)} provisorio=${r.provisorio}`);
console.log(c.hayCorte
  ? `PANEL_CONCILIACION:corte=${c.corte} banco=${$(c.saldoBancoCorte)} posteriores=${$(c.movPosteriores)}(${c.nPosteriores}) esperado=${$(c.esperado)} caja=${$(c.caja)} pendiente=${$(c.pendienteConciliacion)} sin_fecha=${c.sinFecha}`
  : "PANEL_CONCILIACION:sin saldo de banco");
console.log(`PANEL_BASE:${r.baseEsBanco ? "banco" : "caja"}=${$(r.baseProyeccion)} diferencia_banco_caja=${$(r.diferenciaBancoCaja)} facturas=${$(r.facturasPorCobrar)} sin_facturar=${$(r.ventasPorFacturar)}`);
const cuadra = $(r.baseProyeccion) + $(r.porCobrar) + $(r.valeVista) - $(r.deudaFinanciadores) - $(r.comisiones.total) - $(r.f29Pendiente) - $(r.fondosExternos);
console.log(`PANEL_ECUACION:${Math.abs(cuadra - $(r.saldoProyectado)) <= 1 ? "OK" : "FALLA " + cuadra}`);
console.log(`PANEL_IGUAL_UNIVERSO:${c.hayCorte && $(c.caja) === $(r.caja) && $(c.esperado + c.pendienteConciliacion) === $(r.caja) ? "OK" : "FALLA"}`);
