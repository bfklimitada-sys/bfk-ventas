// Pruebas unitarias de la Fase 4B (integridad financiera). Ejecutar: node docs/pruebas-financieras/ejecutar.mjs
// Lógica pura del navegador: reglas 1–4 tal como las muestra y usa la interfaz. Los totales los calcula la base
// (pruebas SQL en docs/migraciones/pruebas/financiero); aquí se prueba que el navegador los interpreta igual.
import { facturasVigentes, facturaVigente, facturaAnulada, calcularPagoVendedor, mesesConFactura } from "../../src/lib/calculos.js";
import { financiamientoPagado, estaCerrada, etapasCompletadas } from "../../src/lib/ocs.js";
import { deudaOC, tipoFinanciamiento, financiamientoNoAplica, describirSaldo, diferenciasPendientes, bloqueoDominio, financiadoresExternos, TIPOS_FINANCIAMIENTO,
  registrarCompraOC, editarCompraOC, eliminarCompraOC, editarPagoFinanciador, eliminarPagoFinanciador, cambiarFinanciamientoOC } from "../../src/lib/finanzas.js";
import { repartirFIFO, ocsPendientesFinanciador } from "../../src/components/forms/FormAbonoFinanciador.jsx";
import { clasificarCargo } from "../../src/components/forms/ImportarCartola.jsx";

let ok = 0, fallas = 0;
const eq = (nombre, real, esperado) => {
  const b = JSON.stringify(real) === JSON.stringify(esperado);
  if (b) ok++; else fallas++;
  console.log((b ? "OK    " : "FALLA ") + nombre + (b ? "" : ` :: esperado ${JSON.stringify(esperado)} obtenido ${JSON.stringify(real)}`));
};
const f = (id, numero, fecha, monto, anula = null) => ({ id, numero_factura: numero, fecha, monto, factura_anulada_numero: anula, nota_credito: anula ? "NC" + id : null });

// ── 1. Regla 4: facturas vigentes (mismo criterio que fin_facturas_vigentes en la base) ──
const ids = (oc) => facturasVigentes(oc).map((x) => x.id);
eq("vigentes: una sola factura", ids({ eventos_factura: [f("a", "100", "2026-07-01", 10)] }), ["a"]);
eq("vigentes: la reemisión anula la original", ids({ eventos_factura: [f("a", "257", "2026-07-22", 10), f("b", "295", "2026-08-13", 10, "257")] }), ["b"]);
eq("vigentes: cadena A → B → C deja solo C", ids({ eventos_factura: [f("a", "1", "2026-05-01", 9), f("b", "2", "2026-06-01", 9, "1"), f("c", "3", "2026-07-01", 9, "2")] }), ["c"]);
eq("vigentes: facturas parciales (sin anulación) cuentan todas", ids({ eventos_factura: [f("a", "163", "2026-05-04", 124800), f("b", "164", "2026-05-04", 62400)] }), ["a", "b"]);
eq("vigentes: espacios en los números no impiden reconocer la anulación", ids({ eventos_factura: [f("a", " 260 ", "2026-07-22", 1), f("b", "296", "2026-08-14", 1, "260 ")] }), ["b"]);
eq("vigentes: anulación de un número inexistente no anula nada (caso ambiguo, queda para decisión)",
  ids({ eventos_factura: [f("a", "227", "2026-06-30", 172900), f("b", "227", "2026-07-30", 172900, "225")] }), ["a", "b"]);
eq("vigentes: dos reemisiones de la misma original dejan ambas vigentes (caso ambiguo)",
  ids({ eventos_factura: [f("a", "182", "2026-05-29", 78003), f("b", "183", "2026-09-17", 78005, "182"), f("c", "328", "2026-09-17", 78005, "182")] }), ["b", "c"]);
eq("facturaVigente: la vigente más reciente, nunca la anulada", facturaVigente({ eventos_factura: [f("b", "295", "2026-08-13", 10, "257"), f("a", "257", "2026-09-30", 10)] })?.id, "b");
eq("facturaAnulada", facturaAnulada({ eventos_factura: [f("a", "257", "2026-07-22", 10), f("b", "295", "2026-08-13", 10, "257")] }, { id: "a" }), true);

// ── 2. Regla 4 en la comisión: la anulada no vuelve a generar comisión; el período es el de la vigente ──
const ocRe = { id: "o1", vendedor_id: "v", estado_factura_propia: "emitida", es_venta_propia: false, monto_total: 239200, costo_total: 222970,
  eventos_factura: [f("a", "257", "2026-07-22", 239200), f("b", "295", "2026-08-13", 239200, "257")] };
const ocOtra = { id: "o2", vendedor_id: "v", estado_factura_propia: "emitida", es_venta_propia: false, monto_total: 200000, costo_total: 100000,
  eventos_factura: [f("c", "300", "2026-07-10", 200000)] };
const julio = calcularPagoVendedor({ vendedorId: "v", ocs: [ocRe, ocOtra], anio: 2026, mes: 7 });
const agosto = calcularPagoVendedor({ vendedorId: "v", ocs: [ocRe, ocOtra], anio: 2026, mes: 8 });
eq("comisión: julio ya no cuenta la OC refacturada (solo la otra)", [julio.sumaUtilidad, julio.sumaFacts], [100000, 200000]);
eq("comisión: agosto (factura vigente) cuenta la OC una vez", [agosto.sumaUtilidad, agosto.sumaFacts], [16230, 239200]);
eq("comisión: mes que solo tenía la anulada no aparece", mesesConFactura("v", [ocRe]).map((m) => `${m.anio}-${m.mes}`), ["2026-8"]);
const verificado = calcularPagoVendedor({ vendedorId: "v", ocs: [ocRe, ocOtra], anio: 2026, mes: 7, pagosVendedor: [{ vendedor_id: "v", anio: 2026, mes: 7, monto_pagado: 90000, monto_verificado: 90000 }] });
eq("comisión: un mes verificado conserva su monto verificado", verificado.pagoCalculado, 90000);
const vp = { ...ocRe, id: "o3", es_venta_propia: true };
eq("comisión venta propia: también solo con la factura vigente", calcularPagoVendedor({ vendedorId: "v", ocs: [vp], anio: 2026, mes: 7 }), null);

// ── 3. Reglas 2 y 3: etapa de financiamiento "no aplica" ──
const vpCobrada = { estado_pago_cliente: "pagado", estado_pago_financiamiento: "no_aplica", estado_entrega: "confirmada", estado_factura_propia: "emitida", eventos_compra: [{}], es_venta_propia: true };
eq("financiamiento no aplica cuenta como etapa cumplida", financiamientoPagado(vpCobrada), true);
eq("venta propia cobrada se cierra sin pago ficticio", estaCerrada(vpCobrada), true);
eq("etapas completas 5/5 con no aplica", etapasCompletadas(vpCobrada), 5);
eq("pendiente/parcial siguen abiertas", [financiamientoPagado({ estado_pago_financiamiento: "pendiente" }), financiamientoPagado({ estado_pago_financiamiento: "parcial" })], [false, false]);
const fins = [{ id: "fin_externo_a", tipo: "externo" }, { id: "fin_cuenta_bfk", tipo: "propio", nombre: "Cuenta BFK" }];
eq("tipo de financiamiento", [tipoFinanciamiento({ es_venta_propia: true, financiador_id: "fin_externo_a" }, fins), tipoFinanciamiento({ financiador_id: "fin_cuenta_bfk" }, fins), tipoFinanciamiento({ financiador_id: "fin_externo_a" }, fins)],
  ["venta_propia", "fondos_propios", "externo"]);
eq("fondos propios no se ofrecen como financiador a pagar", financiadoresExternos(fins).map((x) => x.id), ["fin_externo_a"]);
eq("textos de los tres tipos", Object.keys(TIPOS_FINANCIAMIENTO), ["externo", "fondos_propios", "venta_propia"]);
eq("deudaOC: no aplica = 0; externa = costo − pagado; nunca negativa",
  [deudaOC({ estado_pago_financiamiento: "no_aplica", costo_total: 9, monto_pagado_fin: 0 }), deudaOC({ costo_total: 900, monto_pagado_fin: 300 }), deudaOC({ costo_total: 100, monto_pagado_fin: 300 })], [0, 600, 0]);
eq("financiamientoNoAplica", financiamientoNoAplica({ estado_pago_financiamiento: "no_aplica" }), true);
eq("saldo: deuda / a favor / cero", [describirSaldo(10), describirSaldo(-1000000), describirSaldo(0)], ["deuda", "a_favor", "cero"]);

// ── 4. Abono FIFO: solo deuda real (sin venta propia, sin no aplica, sin OCs con corrección pendiente) ──
const difs = [{ entidad: "oc", entidad_id: "h1", estado: "pendiente", bloquea: ["financiamiento"] }, { entidad: "oc", entidad_id: "h2", estado: "pendiente", bloquea: ["facturacion"] }];
const ocsF = [
  { id: "a", financiador_id: "F", estado_pago_financiamiento: "pendiente", costo_total: 100, monto_pagado_fin: 0, eventos_compra: [{ fecha: "2026-01-02" }] },
  { id: "vp", financiador_id: "F", es_venta_propia: true, estado_pago_financiamiento: "pendiente", costo_total: 500, monto_pagado_fin: 0, eventos_compra: [{ fecha: "2026-01-01" }] },
  { id: "na", financiador_id: "F", estado_pago_financiamiento: "no_aplica", costo_total: 500, monto_pagado_fin: 0, eventos_compra: [{ fecha: "2026-01-01" }] },
  { id: "h1", financiador_id: "F", estado_pago_financiamiento: "pendiente", costo_total: 500, monto_pagado_fin: 0, eventos_compra: [{ fecha: "2025-01-01" }] },
  { id: "h2", financiador_id: "F", estado_pago_financiamiento: "parcial", costo_total: 300, monto_pagado_fin: 100, eventos_compra: [{ fecha: "2025-06-01" }] },
  { id: "otro", financiador_id: "G", estado_pago_financiamiento: "pendiente", costo_total: 999, monto_pagado_fin: 0 },
];
eq("abono: pendientes en orden FIFO, sin venta propia, sin no aplica, sin bloqueo de financiamiento", ocsPendientesFinanciador(ocsF, "F", difs).map((o) => o.id), ["h2", "a"]);
const fifo = repartirFIFO(250, ocsPendientesFinanciador(ocsF, "F", difs));
eq("abono: reparto FIFO por deuda real y sobrante sin OC", [fifo.reparto.map((r) => [r.oc.id, r.asignado, r.completa]), fifo.sobrante], [[["h2", 200, true], ["a", 50, false]], 0]);
eq("diferencias pendientes de una OC", diferenciasPendientes(difs, "oc", "h1").length, 1);
eq("bloqueo por dominio", [bloqueoDominio(difs, "h1", "financiamiento"), bloqueoDominio(difs, "h2", "financiamiento"), bloqueoDominio(difs, "h2", "facturacion")], [true, false, true]);

// ── 5. Cartola: la Cuenta BFK no se reconoce como financista al que se devuelve dinero ──
const finsC = [{ id: "fin_cuenta_bfk", nombre: "Cuenta BFK", tipo: "propio" }, { id: "fin_externo_a", nombre: "Pedro Rojas Soto", tipo: "externo" }];
eq("cartola: transferencia a la cuenta BFK no es devolución a financista", clasificarCargo({ descripcion: "TRANSFERENCIA A CUENTA BFK" }, finsC, [])?.tipo === "financiador", false);
eq("cartola: devolución a un financista externo sí", clasificarCargo({ descripcion: "TRANSF A PEDRO ROJAS SOTO" }, finsC, [])?.destinoId, "fin_externo_a");

// ── 6. Las operaciones financieras van a la base (RPC atómicas), con los parámetros exactos ──
const llamadas = []; let respuesta = { status: 200, body: { ok: true } };
globalThis.fetch = async (url, init) => { llamadas.push({ fn: String(url).split("/rpc/")[1], body: JSON.parse(init.body) }); return { ok: respuesta.status < 300, status: respuesta.status, json: async () => respuesta.body }; };
await registrarCompraOC("t", { ocId: "oc1", fecha: "2026-10-06T10:00:00", costo: "300000", financiadorId: "fin_externo_a", fechaEntregaEstimada: "", montoVenta: "" });
eq("RPC compra", llamadas.at(-1), { fn: "registrar_compra_oc", body: { p_oc_id: "oc1", p_fecha: "2026-10-06", p_costo: 300000, p_financiador_id: "fin_externo_a", p_proveedor: "", p_fecha_entrega_estimada: null, p_monto_venta: null, p_notas: "" } });
await editarCompraOC("t", { eventoId: "e1", fecha: "2026-10-01", costo: 1, montoVenta: 5 });
eq("RPC corregir compra", llamadas.at(-1).fn + "|" + JSON.stringify(llamadas.at(-1).body), 'editar_compra_oc|{"p_evento_id":"e1","p_fecha":"2026-10-01","p_costo":1,"p_monto_venta":5,"p_fecha_entrega_estimada":null,"p_proveedor":null}');
await eliminarCompraOC("t", "e1"); await editarPagoFinanciador("t", { eventoId: "p1", fecha: "2026-10-02", monto: "10" }); await eliminarPagoFinanciador("t", "p1");
await cambiarFinanciamientoOC("t", { ocId: "oc1", tipo: "fondos_propios" });
eq("RPC eliminar compra, corregir/eliminar pago y cambiar financiamiento", llamadas.slice(-4).map((l) => l.fn + ":" + JSON.stringify(l.body)),
  ['eliminar_compra_oc:{"p_evento_id":"e1"}', 'editar_pago_financiador:{"p_evento_id":"p1","p_fecha":"2026-10-02","p_monto":10}',
   'eliminar_pago_financiador:{"p_evento_id":"p1"}', 'cambiar_financiamiento_oc:{"p_oc_id":"oc1","p_tipo":"fondos_propios","p_financiador_id":null}']);
respuesta = { status: 400, body: { message: "La OC 9001-001-XX26 tiene una corrección histórica pendiente de aprobación (x). No se registró ningún cambio." } };
let msg = ""; try { await registrarCompraOC("t", { ocId: "x", fecha: "2026-10-06", costo: 1 }); } catch (e) { msg = e.message; }
eq("RPC rechazada: el mensaje de la base llega tal cual (sin duplicar el aviso)", msg, respuesta.body.message);
respuesta = { status: 400, body: { message: "El monto debe ser mayor que cero" } };
try { await editarPagoFinanciador("t", { eventoId: "x", fecha: "2026-10-06", monto: 0 }); } catch (e) { msg = e.message; }
eq("RPC rechazada: se aclara que no se guardó nada", msg, "El monto debe ser mayor que cero (no se guardó nada)");
globalThis.fetch = async () => { throw new TypeError("Failed to fetch"); };
try { await eliminarPagoFinanciador("t", "x"); } catch (e) { msg = e.message; }
eq("RPC sin conexión: no se guardó nada", msg, "Sin conexión con la base: no se guardó nada.");

console.log(`\nRESUMEN pruebas Fase 4B (unitarias): ${ok} OK, ${fallas} FALLA(S)`);
process.exit(fallas ? 1 : 0);
