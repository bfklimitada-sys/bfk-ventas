// ═══════════════════════════════════════════════════════════════
// Registro desde la cartola: protección contra duplicados (versión con garantía en la base, 09/10/2026)
//  · La base (funciones registrar_movimiento_cartola / registrar_pago_financiador_cartola) garantiza que un
//    movimiento bancario quede registrado UNA sola vez, aunque dos sesiones lo intenten a la vez o con tipos
//    distintos: la marca del movimiento va en la columna marca_cartola de cada registro.
//  · Este módulo arma la marca, hace una verificación previa con datos frescos (aviso temprano para el usuario)
//    y reconoce las respuestas de la base: 23505 (ya registrado), BFK01 (posible duplicado de un registro
//    manual: vincular o confirmar que es otra operación) y PGRST202 (función aún no instalada).
// ═══════════════════════════════════════════════════════════════
import { CIERRE_CONCILIACION, ESTADOS, conciliarMovimientos } from "./conciliacion.js";

// Marca del movimiento: cart:AAAAMMDD:cargo:abono:saldo:ocurrencia. La ocurrencia distingue dos líneas idénticas
// (mismo día, monto y saldo), que al unir cartolas se conservan las dos.
export function marcaCartola(movs, i) {
  const m = movs?.[i];
  if (!m) return null;
  const ocurrencia = movs.slice(0, i).filter((x) => x.clave === m.clave).length + 1;
  return `cart:${String(m.fecha).replace(/-/g, "")}:${Number(m.cargo) || 0}:${Number(m.abono) || 0}:${Number(m.saldo)}:${ocurrencia}`;
}

// Marcas vigentes en los datos (un pago a vendedor anulado no cuenta).
export function marcasVigentes({ ocs = [], gastos = [], pagosVendedor = [], pagoFinSueltos = [], aportes = [] } = {}) {
  const s = new Set();
  const agrega = (r) => { if (r?.marca_cartola) s.add(r.marca_cartola); };
  for (const o of ocs) { (o.eventos_pago_cliente || []).forEach(agrega); (o.eventos_pago_financiamiento || []).forEach(agrega); }
  gastos.forEach(agrega); pagoFinSueltos.forEach(agrega); aportes.forEach(agrega);
  pagosVendedor.filter((p) => !p.anulado_en).forEach(agrega);
  return s;
}

// Verificación previa con los datos RECIÉN leídos de la base. La garantía definitiva la da la base.
// decidido: el usuario ya resolvió un aviso BFK01 (vincular o «es otra operación»); el registro manual parecido
// hace que la conciliación vea el movimiento como registrado, así que esa comprobación se omite (la base decide).
export function verificarRegistro(movs, i, datosFrescos, { cierre = CIERRE_CONCILIACION, decidido = false } = {}) {
  if (!datosFrescos) return { ok: false, motivo: "No se pudieron leer los registros actuales de la base: no se registra." };
  const x = conciliarMovimientos(movs, datosFrescos, { cierre }).movimientos[i];
  if (!x) return { ok: false, motivo: "El movimiento ya no está en la cartola cargada." };
  if (x.anteriorCierre) return { ok: false, motivo: "Movimiento anterior al cierre: solo consulta." };
  if (marcasVigentes(datosFrescos).has(marcaCartola(movs, i))) return { ok: false, motivo: "Este movimiento ya fue registrado desde la cartola (otra sesión): no se registra de nuevo." };
  if (!x.registrable && !decidido) return { ok: false, motivo: `Este movimiento ya tiene un registro en BFK (${ESTADOS[x.estado] || x.estado}): no se registra de nuevo.` };
  return { ok: true, motivo: "" };
}

const codigo = (e) => String(e?.rpcCuerpo?.code || e?.code || "");
const texto = (e) => String(e?.message || e || "");
// Ya registrado (clave repetida en la base).
export const esConflictoDuplicado = (e) => codigo(e) === "23505" || /duplicate key|23505|already exists|llave duplicada/i.test(texto(e));
// Posible duplicado de un registro manual: el usuario decide vincular o confirmar que es otra operación.
export const esPosibleDuplicadoManual = (e) => codigo(e) === "BFK01" || /Posible duplicado de un (registro|pago) manual/i.test(texto(e));
// La función de la base aún no está instalada (la aplicación se activó antes que la base): no se registra nada.
export const esFuncionNoDisponible = (e) => codigo(e) === "PGRST202" || /Could not find the function/i.test(texto(e));
// Ids de los registros manuales informados por la base en el mensaje BFK01: «(... id1, id2): ...».
export function idsDelMensaje(e) {
  const m = /\(([^()]+)\)\s*:/.exec(texto(e));
  return m ? m[1].split(",").map((x) => x.trim()).filter(Boolean) : [];
}

// Registros con alerta de posible duplicado (los marca la base al registrar algo manual que coincide con un
// movimiento ya registrado desde la cartola).
export function registrosConAlerta({ ocs = [], gastos = [], pagosVendedor = [], pagoFinSueltos = [], aportes = [] } = {}) {
  const r = [];
  const agrega = (tabla, x, tipo, detalle) => { if (x?.alerta_cartola) r.push({ tabla, id: x.id, fecha: x.fecha, monto: Number(tabla === "pagos_vendedor" ? (x.monto_transferido ?? x.monto_pagado) : x.monto) || 0, tipo, detalle, alerta: x.alerta_cartola }); };
  for (const o of ocs) {
    (o.eventos_pago_cliente || []).forEach((e) => agrega("eventos_pago_cliente", e, "Cobro", o.numero_oc));
    (o.eventos_pago_financiamiento || []).forEach((e) => agrega("eventos_pago_financiamiento", e, "Pago a financiador", o.numero_oc));
  }
  pagoFinSueltos.forEach((e) => agrega("eventos_pago_financiamiento", e, "Pago a financiador", "sin OC"));
  gastos.forEach((g) => agrega("gastos_indirectos", g, "Gasto", g.detalle || ""));
  pagosVendedor.forEach((p) => agrega("pagos_vendedor", p, "Pago a vendedor", ""));
  aportes.forEach((a) => agrega("aportes_socios", a, a.tipo === "retiro" ? "Retiro de capital" : "Aporte", a.socio || ""));
  const vistos = new Set();
  return r.filter((x) => (vistos.has(x.tabla + x.id) ? false : vistos.add(x.tabla + x.id))).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
}
