// Reglas puras del reembolso de compras anuladas (24/11/2026): cartola, caja e informes. Sin red ni base.
// Uso (la app importa .jsx, por eso se empaqueta antes):
//   npx esbuild docs/pruebas-ventas-privadas/reembolso.test.mjs --bundle --platform=node --format=esm --outfile=/tmp/reembolso.bundle.mjs \
//     --loader:.jsx=jsx --loader:.jpg=empty --loader:.png=empty --define:import.meta.env='{"VITE_SUPABASE_URL":"http://x","VITE_SUPABASE_ANON_KEY":"x"}' \
//   && node /tmp/reembolso.bundle.mjs
import { conciliarMovimientos, registrosBancarios, TABLA_REGISTRO, proveedorEnGlosa } from "../../src/lib/conciliacion.js";
import { movimientosCaja } from "../../src/lib/caja.js";
import { resultadoMes, apoyoEnGestion, cajaYFueraDelBanco } from "../../src/lib/informes.js";
import { gastoVigente } from "../../src/lib/mediosPago.js";
import { vistaConciliacion } from "../../src/lib/conciliacionVista.js";

let n = 0; const F = [];
const ok = (t, c, d = "") => { if (c) { n++; console.log("OK   ", t); } else { F.push(t); console.log("FALLA", t, typeof d === "string" ? d : JSON.stringify(d)); } };

const gastos = [
  { id: "g1", categoria_id: "cat_ops", monto: 59990, mes: 11, anio: 2026, fecha: "2026-11-03", detalle: "Falabella broca", anulado_en: "2026-11-05T12:00:00Z", anulacion_motivo: "Compra de venta privada anulada con reembolso: no llegó" },
  { id: "g2", categoria_id: "cat_ops", monto: 30000, mes: 11, anio: 2026, fecha: "2026-11-04", detalle: "Luz" },
  { id: "g3", categoria_id: "cat_apoyo_gestion", monto: 10000, mes: 11, anio: 2026, fecha: "2026-11-04", detalle: "Apoyo anulado", anulado_en: "2026-11-06T00:00:00Z", anulacion_motivo: "x x x" },
];
const reembolsos = [
  { id: "k-fal", venta_id: "v1", origen: "registro", gasto_id: null, proveedor: "Falabella", total: 119000, anulada_en: "2026-11-05T13:00:00Z", reembolso_estado: "pendiente", reembolso_monto: 119000, reembolso_fecha: null, reembolso_marca: null },
  { id: "k-gas", venta_id: "v1", origen: "gasto_existente", gasto_id: "g1", proveedor: "Falabella", total: 59990, anulada_en: "2026-11-05T13:00:00Z", reembolso_estado: "recibido", reembolso_monto: 59990, reembolso_fecha: "2026-11-12", reembolso_marca: "cart:MARCA-GAS" },
];

// ── Gasto vigente / anulado ──
ok("G1 gasto anulado no es vigente; sin la columna (antes de la migración) sí lo es", !gastoVigente(gastos[0]) && gastoVigente(gastos[1]) && gastoVigente({ id: "x" }));
const r = resultadoMes({ ocs: [], gastos, pagosVendedor: [], ivaMensual: [], vendedores: [], categorias: [{ id: "cat_ops", nombre: "Operación" }] }, 2026, 11);
ok("G2 resultado del mes: el gasto anulado no cuenta (solo $30.000 operacionales)", r.gastosOperacionales === 30000, r);
ok("G3 apoyo en gestión: el gasto anulado no cuenta", apoyoEnGestion({ gastos, pagosVendedor: [] }).total === 0);

// ── Caja: el cargo del gasto anulado sigue (ocurrió) y el reembolso recibido entra ──
const movs = movimientosCaja({ ocs: [], financiadores: [], gastos, pagosVendedor: [], pagoFinSueltos: [], aportes: [], reembolsos });
const tot = (t) => movs.filter((m) => m.tipo === t).reduce((s, m) => s + m.monto, 0);
ok("C1 caja: los gastos (incluido el anulado) salen igual", tot("gasto") === -(59990 + 30000 + 10000), tot("gasto"));
ok("C2 caja: entra el reembolso recibido de la compra que venía de Gastos", tot("reembolso") === 59990, movs);
ok("C3 caja: el reembolso de una compra registrada solo en Ventas privadas no entra (su compra tampoco está en la caja)", movs.filter((m) => m.tipo === "reembolso").length === 1);
const cf = cajaYFueraDelBanco({ ocs: [], financiadores: [], gastos, pagosVendedor: [], pagoFinSueltos: [], aportes: [], reembolsos });
ok("C4 informe de caja: línea de reembolsos", cf.porTipo.reembolso?.monto === 59990, cf.porTipo);
ok("C5 sin reembolsos (antes de la migración) la caja queda igual que antes", movimientosCaja({ ocs: [], financiadores: [], gastos, pagosVendedor: [], pagoFinSueltos: [], aportes: [] }).every((m) => m.tipo !== "reembolso"));

// ── Cartola ──
ok("K1 tabla de los reembolsos = vp_compras", TABLA_REGISTRO.reembolso === "vp_compras");
const regs = registrosBancarios({ ocs: [], financiadores: [], vendedores: [], gastos, pagosVendedor: [], pagoFinSueltos: [], aportes: [], reembolsos });
const rr = regs.filter((x) => x.tipo === "reembolso");
ok("K2 registros: un reembolso pendiente y uno recibido, ambos «entra»", rr.length === 2 && rr.every((x) => x.dir === "entra" && x.tabla === "vp_compras"), rr);
ok("K3 el pendiente usa la fecha de anulación; el recibido, la de reembolso", rr.find((x) => x.id === "k-fal").fecha === "2026-11-05" && rr.find((x) => x.id === "k-gas").fecha === "2026-11-12");
const movsBanco = [
  { fecha: "2026-11-09", descripcion: "ABONO FALABELLA RETAIL S.A.", operacion: "1", cargo: 0, abono: 119000, saldo: 900000 },   // reembolso pendiente
  { fecha: "2026-11-12", descripcion: "TEF DE FALABELLA", operacion: "2", cargo: 0, abono: 59990, saldo: 959990 },               // ya registrado (marca)
  { fecha: "2026-11-10", descripcion: "DEPOSITO", operacion: "3", cargo: 0, abono: 77777, saldo: 1037767 },                       // nada que ver
];
// La marca del recibido es la del segundo movimiento: se calcula igual que en la app.
import { marcaCartola } from "../../src/lib/conciliacion.js";
reembolsos[1].reembolso_marca = marcaCartola(movsBanco, 1);
const c = conciliarMovimientos(movsBanco, { ocs: [], financiadores: [], vendedores: [], gastos, pagosVendedor: [], pagoFinSueltos: [], aportes: [], reembolsos, decisiones: [] }, { cierre: "2026-10-07" });
const [a, b, d] = c.movimientos || c;
ok("K4 abono de Falabella por el monto del reembolso pendiente → «Por revisar» con el reembolso como candidato", a.estado === "posible" && a.candidatos?.some((x) => x.id === "k-fal"), a);
ok("K5 …con la evidencia «proveedor del reembolso en la glosa» (nunca se confirma solo)", a.evidencia.includes("proveedor del reembolso en la glosa") && a.estado !== "conciliado", a.evidencia);
ok("K6 abono ya registrado como reembolso (marca) → «Ya registrado»", b.estado === "conciliado" && b.registros?.[0]?.id === "k-gas" && b.origen === "cartola", b);
ok("K7 un depósito de otro monto no se vincula a reembolsos", d.estado === "pendiente" && !(d.candidatos || []).length, d);
ok("K8 proveedor en glosa: palabra de 4+ letras del proveedor", proveedorEnGlosa(rr[0], "ABONO FALABELLA") && !proveedorEnGlosa(rr[0], "ABONO RIPLEY") && !proveedorEnGlosa({ tipo: "gasto", proveedor: "FALABELLA" }, "FALABELLA"));
const v = vistaConciliacion(c, { ocs: [], categorias: [], cierre: "2026-10-07" });
const todos = [...(v.revisar || []), ...(v.ya || []), ...(v.nuevos || []), ...(v.pendientes || [])];
const txt = JSON.stringify(todos.map((x) => [x.titulo, x.registros, x.opciones]));
ok("K9 la vista nombra «Reembolso de compra anulada»", /Reembolso de compra anulada/.test(txt), txt.slice(0, 400));
// Sin la migración (reembolsos vacíos), la conciliación queda igual que antes para el mismo extracto.
const c0 = conciliarMovimientos(movsBanco, { ocs: [], financiadores: [], vendedores: [], gastos, pagosVendedor: [], pagoFinSueltos: [], aportes: [], decisiones: [] }, { cierre: "2026-10-07" });
ok("K10 sin reembolsos, ningún movimiento cambia de estado por esta función", (c0.movimientos || c0).every((x) => x.estado === "pendiente"));

console.log(`\nRESUMEN reembolso: ${n} OK, ${F.length} FALLA(S)`);
process.exit(F.length ? 1 : 0);
