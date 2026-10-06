// ═══════════════════════════════════════════════════════════════
// Cobranza y cartola (Fase 4C). Funciones puras: proponen, no escriben.
// Un abono del banco puede ser:
//  · exacto: paga una factura completa (el monto calza con su saldo);
//  · varias: paga varias facturas del MISMO RUT (la suma de sus saldos calza exacto);
//  · parcial: un abono menor que lo adeudado por ese RUT (se aplica a la factura más antigua);
//  · vale_vista: es el depósito de un vale vista o cheque ya registrado y aún no cobrado en el banco.
// La propuesta solo viene marcada cuando no hay ambigüedad; lo demás lo confirma la persona.
// ═══════════════════════════════════════════════════════════════
import { facturaVigente } from "./calculos.js";

export const soloDigitosRut = (s) => String(s || "").replace(/[^0-9kK]/g, "").toUpperCase();
export const rutsEnTexto = (desc) => {
  const d = String(desc || "").toUpperCase();
  const a = d.match(/\d{1,2}\.\d{3}\.\d{3}\s*-?\s*[0-9K]/g) || [];   // 69.073.100-2
  const b = d.match(/\d{7,9}\s*-?\s*[0-9K]/g) || [];                    // 690731002 / 69073100-2
  return [...new Set([...a, ...b].map(soloDigitosRut))];
};

// Saldo por cobrar de una OC facturada (facturas vigentes − cobros registrados).
export const saldoPorCobrar = (oc) =>
  Math.max(0, (Number(oc?.monto_facturado) || 0) - (Number(oc?.monto_cobrado) || 0));

export const ocsConSaldo = (ocs) => (ocs || [])
  .filter((o) => (o.tipo_registro || "venta") === "venta" && o.estado_factura_propia === "emitida" && o.estado_pago_cliente !== "pagado")
  .map((o) => ({ oc: o, saldo: saldoPorCobrar(o), fechaFactura: String(facturaVigente(o)?.fecha || "").slice(0, 10) }))
  .filter((x) => x.saldo > 0);

// Puntaje de coincidencia entre un abono y una OC (RUT del pagador, nombre, fecha de la factura).
export function puntuarAbono(abono, oc) {
  let puntos = 0;
  const desc = String(abono.descripcion || "").toUpperCase();
  const rutOC = soloDigitosRut(oc.rut_cliente);
  if (rutOC.length > 6 && rutsEnTexto(desc).includes(rutOC)) puntos += 100;
  const ignorar = new Set(["ILUSTRE", "MUNICIPALIDAD", "MUNIC", "DE", "DEL", "LA", "EL", "SERVICIO", "SALUD", "DEPARTAMENTO"]);
  const palabras = String(oc.cliente || "").toUpperCase().split(/[^A-ZÁÉÍÓÚÑ]+/).filter((p) => p.length >= 5 && !ignorar.has(p));
  if (palabras.some((p) => desc.includes(p))) puntos += 40;
  const evF = facturaVigente(oc);
  if (evF?.fecha) {
    const dias = (new Date(abono.fecha) - new Date(String(evF.fecha).slice(0, 10))) / 86400000;
    if (dias >= 0 && dias <= 90) puntos += 10;
    if (dias < 0) puntos -= 50;
  }
  return puntos;
}

// Subconjunto (de 2 o más) cuyos saldos suman exactamente `monto`. Busca el de menos facturas y,
// entre esos, el de facturas más antiguas. Devuelve null si no hay uno ÚNICO de ese tamaño.
export function combinacionExacta(items, monto, maxItems = 12) {
  const xs = items.slice(0, maxItems);
  let mejor = null, empate = false;
  const n = xs.length;
  for (let mask = 1; mask < (1 << n); mask++) {
    let suma = 0, k = 0;
    for (let i = 0; i < n; i++) if (mask & (1 << i)) { suma += xs[i].saldo; k++; }
    if (k < 2 || Math.abs(suma - monto) > 0.5) continue;
    if (!mejor || k < mejor.k) { mejor = { mask, k }; empate = false; }
    else if (k === mejor.k) empate = true;
  }
  if (!mejor || empate) return null;
  return xs.filter((_, i) => mejor.mask & (1 << i));
}

// Reparte un abono parcial: primero la factura más antigua (sin pasarse de su saldo).
export function repartirAbono(monto, items) {
  let resto = Math.round(Number(monto) || 0);
  const out = [];
  for (const it of items.slice().sort((a, b) => a.fechaFactura.localeCompare(b.fechaFactura) || String(a.oc.numero_oc).localeCompare(String(b.oc.numero_oc)))) {
    if (resto <= 0) break;
    const m = Math.min(resto, it.saldo);
    out.push({ ocId: it.oc.id, numeroOc: it.oc.numero_oc, monto: m, saldoAntes: it.saldo, parcial: m < it.saldo });
    resto -= m;
  }
  return { asignaciones: out, sobrante: resto };
}

// Vale vista o cheque registrado y todavía no cobrado en el banco.
export const valeVistasSinCobrar = (ocs) => (ocs || []).flatMap((o) =>
  (o.eventos_pago_cliente || []).filter((e) => e.medio_pago && e.medio_pago !== "transferencia" && !e.cobrado_en_banco)
    .map((e) => ({ evento: e, oc: o })));

// Un abono que ya está registrado (mismo monto cerca de esa fecha, o fragmentos de cobro del mismo día que suman el total).
export function abonoYaRegistrado(mov, registrados, tolerancia = 3) {
  const monto = Number(mov.abono);
  const f = new Date(mov.fecha).getTime();
  const cerca = (r) => Math.abs(new Date(r.fecha).getTime() - f) <= tolerancia * 86400000;
  if ((registrados || []).some((r) => String(r.destino || "").startsWith("cli_") && Number(r.monto) === monto && cerca(r))) return true;
  const mismoDia = (registrados || []).filter((r) => String(r.destino || "").startsWith("cli_") && String(r.fecha).slice(0, 10) === mov.fecha);
  return mismoDia.length > 1 && Math.abs(mismoDia.reduce((s, r) => s + Number(r.monto || 0), 0) - monto) <= 1;
}

// Propuestas para cada abono de la cartola. Cada ítem trae sus opciones; `sugerida` es la que
// queda marcada (solo si es inequívoca). Las OCs ya propuestas en un abono no se repiten en otro.
export function calzarAbonos(movimientos, ocs, registrados = []) {
  const pendientes = ocsConSaldo(ocs);
  const vales = valeVistasSinCobrar(ocs);
  const usadas = new Set(), valesUsados = new Set();
  const resultado = [];
  for (const mov of (movimientos || []).filter((m) => m.abono > 0)) {
    const opciones = [];
    const libres = pendientes.filter((p) => !usadas.has(p.oc.id));
    const ruts = rutsEnTexto(mov.descripcion);

    // 1) Depósito de un vale vista / cheque ya registrado (mismo monto; desempata el RUT).
    const vv = vales.filter((v) => !valesUsados.has(v.evento.id) && Math.abs(Number(v.evento.monto) - mov.abono) <= 0.5)
      .map((v) => ({ ...v, puntos: ruts.includes(soloDigitosRut(v.oc.rut_cliente)) ? 100 : 0 }))
      .sort((a, b) => b.puntos - a.puntos);
    // Ya registrado (mismo monto y fecha cercana): se omite, salvo que sea el depósito de un vale vista pendiente
    // (ese cobro está registrado, pero falta marcarlo como cobrado en el banco).
    if (!vv.length && abonoYaRegistrado(mov, registrados)) continue;
    for (const v of vv) opciones.push({ id: `vv_${v.evento.id}`, tipo: "vale_vista", etiqueta: `Depósito del ${v.evento.medio_pago === "cheque" ? "cheque" : "vale vista"} de ${v.oc.numero_oc}`,
      valeVista: { eventoId: v.evento.id, ocId: v.oc.id, numeroOc: v.oc.numero_oc }, asignaciones: [], puntos: 200 + v.puntos });

    // 2) Una factura exacta.
    const exactas = libres.filter((p) => Math.abs(p.saldo - mov.abono) <= 0.5).map((p) => ({ ...p, puntos: puntuarAbono(mov, p.oc) })).sort((a, b) => b.puntos - a.puntos);
    for (const p of exactas) opciones.push({ id: `ex_${p.oc.id}`, tipo: "exacto", etiqueta: `${p.oc.numero_oc}${p.oc.cliente ? ` · ${String(p.oc.cliente).slice(0, 28)}` : ""}`,
      asignaciones: [{ ocId: p.oc.id, numeroOc: p.oc.numero_oc, monto: p.saldo, saldoAntes: p.saldo, parcial: false }], puntos: p.puntos });

    // 3 y 4) Mismo RUT del pagador: varias facturas que suman exacto, o un abono parcial.
    for (const rut of ruts) {
      const delRut = libres.filter((p) => soloDigitosRut(p.oc.rut_cliente) === rut && rut.length > 6);
      if (!delRut.length) continue;
      const total = delRut.reduce((s, p) => s + p.saldo, 0);
      const combo = delRut.length >= 2 ? combinacionExacta(delRut.slice().sort((a, b) => a.fechaFactura.localeCompare(b.fechaFactura)), mov.abono) : null;
      if (combo) opciones.push({ id: `va_${rut}`, tipo: "varias", etiqueta: `${combo.length} facturas del RUT del pagador (${combo.map((c) => c.oc.numero_oc).join(", ")})`,
        asignaciones: combo.map((c) => ({ ocId: c.oc.id, numeroOc: c.oc.numero_oc, monto: c.saldo, saldoAntes: c.saldo, parcial: false })), puntos: 150 });
      if (mov.abono < total - 0.5 && !exactas.length) {
        const { asignaciones } = repartirAbono(mov.abono, delRut);
        opciones.push({ id: `pa_${rut}`, tipo: "parcial", etiqueta: `Abono parcial a ${asignaciones.map((a) => a.numeroOc).join(", ")} (queda ${fmtPesos(total - mov.abono)} por cobrar)`,
          asignaciones, puntos: 50 });
      }
    }
    if (!opciones.length) continue;

    // Sugerencia: solo si es inequívoca. Un abono parcial nunca se marca solo.
    const orden = opciones.slice().sort((a, b) => b.puntos - a.puntos);
    const [a, b] = orden;
    let sugerida = "";
    if (a.tipo !== "parcial") {
      if (a.tipo === "exacto") {
        const otrasExactas = orden.filter((o) => o.tipo === "exacto");
        const claro = otrasExactas.length === 1 || (a.puntos - (otrasExactas[1]?.puntos ?? 0)) >= 40;
        if (claro && (!b || b.tipo !== "vale_vista")) sugerida = a.id;
      } else if (!b || b.puntos < a.puntos) sugerida = a.id;
    }
    const elegida = opciones.find((o) => o.id === sugerida);
    if (elegida) {
      elegida.asignaciones.forEach((x) => usadas.add(x.ocId));
      if (elegida.valeVista) valesUsados.add(elegida.valeVista.eventoId);
    }
    resultado.push({ mov, opciones: orden, sugerida, claro: !!sugerida });
  }
  return resultado;
}

// Valida lo elegido antes de registrar: ninguna OC cobrada dos veces por encima de su saldo.
export function validarSeleccion(items, elegido) {
  const porOC = new Map(), vales = new Set();
  for (let i = 0; i < items.length; i++) {
    const op = items[i].opciones.find((o) => o.id === elegido[i]);
    if (!op) continue;
    if (op.valeVista) { if (vales.has(op.valeVista.eventoId)) return "Un mismo vale vista quedó asignado a dos depósitos"; vales.add(op.valeVista.eventoId); }
    for (const a of op.asignaciones) {
      const prev = porOC.get(a.ocId) || 0;
      if (prev + a.monto > a.saldoAntes + 0.5) return `La OC ${a.numeroOc} quedaría cobrada por sobre su saldo (dos abonos la cubren)`;
      porOC.set(a.ocId, prev + a.monto);
    }
  }
  return null;
}

const fmtPesos = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("es-CL");
