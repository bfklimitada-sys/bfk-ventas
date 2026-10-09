// ═══════════════════════════════════════════════════════════════
// Registro desde la cartola: protección contra duplicados (09/10/2026)
//  Un mismo movimiento bancario no debe quedar registrado dos veces, aunque dos sesiones lo intenten a la vez.
//  Tres capas, todas en este módulo para que cobros, pagos, gastos y retiros usen la misma regla:
//   1. verificarRegistro: con los datos RECIÉN leídos de la base (no los de pantalla) el movimiento debe seguir
//      pendiente y posterior al cierre, y ningún registro vigente puede llevar ya su marca de cartola.
//   2. idRegistroCartola: el id del registro se deriva del movimiento (fecha, cargo, abono, saldo y ocurrencia).
//      Si dos sesiones registran el mismo movimiento en la misma tabla, la clave primaria rechaza la segunda
//      escritura en la base (atómico, sin cambios de esquema).
//   3. esConflictoDuplicado: reconoce ese rechazo para informarlo sin reintentar.
//  Límite conocido: la clave primaria es por tabla. Si dos sesiones registran el mismo movimiento como TIPOS
//  distintos (p. ej., gasto y pago a vendedor) en el mismo instante, o como pago a financiador (función de la
//  base que genera sus propios ids), solo protege la capa 1 y queda una ventana breve entre la lectura y la
//  escritura. Cerrarla requiere un cambio en la base (ver propuesta en el informe), no aplicado.
// ═══════════════════════════════════════════════════════════════
import { CIERRE_CONCILIACION, ESTADOS, conciliarMovimientos } from "./conciliacion.js";

// Prefijos por tabla de destino.
export const PREFIJO_REGISTRO = { cobro: "evp", vendedor: "pv", gasto: "gas", retiro: "ap" };

// Marca única del movimiento dentro de la cartola: clave (fecha|cargo|abono|saldo) + ocurrencia, porque dos
// movimientos reales pueden compartir la clave (se conservan los dos al unir cartolas).
export function marcaMovimiento(movs, i) {
  const m = movs[i];
  if (!m) return null;
  const ocurrencia = movs.slice(0, i).filter((x) => x.clave === m.clave).length + 1;
  return `_cart_${String(m.fecha).replace(/-/g, "")}_${m.cargo}_${m.abono}_${m.saldo}_${ocurrencia}`;
}

// Ids de todos los registros que existen en la base (vigentes o anulados) y los de los vigentes.
export function idsRegistros({ ocs = [], gastos = [], pagosVendedor = [], pagoFinSueltos = [], aportes = [] } = {}) {
  const todos = [], vigentes = [];
  const agrega = (id, vigente = true) => { if (!id) return; todos.push(String(id)); if (vigente) vigentes.push(String(id)); };
  for (const o of ocs) {
    for (const e of o.eventos_pago_cliente || []) agrega(e.id);
    for (const e of o.eventos_pago_financiamiento || []) agrega(e.id);
  }
  for (const g of gastos) agrega(g.id);
  for (const p of pagosVendedor) agrega(p.id, !p.anulado_en);
  for (const e of pagoFinSueltos) agrega(e.id);
  for (const a of aportes) agrega(a.id);
  return { todos, vigentes };
}

// Id determinista del registro. Si ya existe uno anulado con ese id, se usa el siguiente sufijo libre
// (dos sesiones calculan el mismo, así que la clave primaria sigue bloqueando la segunda).
export function idRegistroCartola(tipo, movs, i, existentes = []) {
  const prefijo = PREFIJO_REGISTRO[tipo];
  const marca = marcaMovimiento(movs, i);
  if (!prefijo || !marca) throw new Error("No se pudo identificar el movimiento");
  const usados = new Set(existentes.map(String));
  const ocupado = (id) => usados.has(id) || [...usados].some((u) => u.startsWith(`${id}-`));
  const base = `${prefijo}${marca}`;
  let id = base, k = 2;
  while (ocupado(id)) id = `${base}_r${k++}`;
  return id;
}

// Verificación final, con datos frescos de la base. Devuelve { ok, motivo, existentes }.
export function verificarRegistro(movs, i, datosFrescos, { cierre = CIERRE_CONCILIACION } = {}) {
  if (!datosFrescos) return { ok: false, motivo: "No se pudieron leer los registros actuales de la base: no se registra." };
  const x = conciliarMovimientos(movs, datosFrescos, { cierre }).movimientos[i];
  if (!x) return { ok: false, motivo: "El movimiento ya no está en la cartola cargada." };
  if (x.anteriorCierre) return { ok: false, motivo: "Movimiento anterior al cierre: solo consulta." };
  const { todos, vigentes } = idsRegistros(datosFrescos);
  const marca = marcaMovimiento(movs, i);
  if (vigentes.some((id) => id.includes(marca))) return { ok: false, motivo: "Este movimiento ya fue registrado desde la cartola (otra sesión): no se registra de nuevo." };
  if (!x.registrable) return { ok: false, motivo: `Este movimiento ya tiene un registro en BFK (${ESTADOS[x.estado] || x.estado}): no se registra de nuevo.` };
  return { ok: true, motivo: "", existentes: todos };
}

// Rechazo de la base por clave primaria repetida (PostgREST: 409 / código 23505).
export const esConflictoDuplicado = (e) => /duplicate key|23505|already exists|llave duplicada/i.test(String(e?.message || e || ""));
