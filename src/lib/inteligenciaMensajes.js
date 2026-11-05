// Inteligencia Comercial (05/11/2026): textos del avance y del resultado de la sincronización con ChileCompra.
// Funciones puras (sin React) para poder probarlas. Diferencian revisadas, ganadas, perdidas, en proceso, desiertas o
// canceladas, sin oferta de BFK, por verificar y sin respuesta: una pendiente NUNCA se informa como perdida.
export const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
// Texto del avance (durante) y del resultado (al terminar) de la sincronización. Nunca cuenta una pendiente como perdida.
export function textoConteo(p) {
  const n = (k) => p?.conteo?.[k] || 0;
  const partes = [plural(p?.procesados || 0, "revisada", "revisadas"), plural(n("ganada"), "ganada", "ganadas"), plural(n("perdida"), "perdida", "perdidas"),
    `${n("pendiente")} en proceso`];
  if (n("desierta") + n("cancelada")) partes.push(`${n("desierta") + n("cancelada")} desiertas o canceladas`);
  if (n("sin_oferta_bfk")) partes.push(`${n("sin_oferta_bfk")} sin oferta de BFK`);
  if (n("por_verificar")) partes.push(`${n("por_verificar")} por verificar (ganador aún no confirmado)`);
  if (n("sin_respuesta")) partes.push(`${n("sin_respuesta")} sin respuesta`);
  return partes.join(" · ");
}
export const textoCola = (c) => (c ? ` · quedan ${c.elegibles_ahora} por consultar ahora${c.sin_consultar ? ` (${c.sin_consultar} nunca consultadas)` : ""}` : "");
export function mensajeFinal(r) {
  if (!r) return null;
  const ganadas = r.ganadas_nuevas?.length ? ` Adjudicaciones ganadas confirmadas en esta sincronización: ${r.ganadas_nuevas.slice(0, 6).join(", ")}${r.ganadas_nuevas.length > 6 ? ` y ${r.ganadas_nuevas.length - 6} más` : ""}.` : "";
  const quedan = r.cola && (r.cola.elegibles_ahora > 0 || r.cola.sin_consultar > 0)
    ? ` Quedan ${r.cola.elegibles_ahora || r.cola.sin_consultar} por consultar; lo revisado quedó guardado: presiona «Actualizar resultados» para reanudar.`
    : r.cola?.por_verificar ? ` ${plural(r.cola.por_verificar, "oportunidad queda", "oportunidades quedan")} por verificar (ChileCompra aún no entregó el ganador): se reintenta${r.cola.por_verificar === 1 ? "" : "n"} en la próxima actualización.` : "";
  const base = r.procesados ? textoConteo(r) : "";
  const cab = { completo: r.procesados ? "Sincronización completa:" : "Todo al día: no había resultados por consultar.", cancelado: "Sincronización cancelada:",
    limite_persistente: "ChileCompra siguió pidiendo bajar la velocidad; se detuvo para no insistir:", sin_avance: "Sin avance en las últimas rondas:",
    tope_rondas: "Se alcanzó el máximo de rondas de esta sesión:", tope_tiempo: "Se alcanzó el tiempo máximo de esta sesión:", error: r.error || "No se pudo sincronizar." }[r.motivo_fin] || "Sincronización terminada:";
  const tono = r.motivo_fin === "error" ? (r.codigo === "SIN_MIGRACION" ? "info" : "danger") : r.motivo_fin === "completo" && !r.errores ? "ok" : "warn";
  return { tono, texto: `${cab}${base && r.motivo_fin !== "error" ? " " + base + "." : base ? ` (antes del error: ${base}).` : ""}${ganadas}${quedan}`.replace(/::/g, ":") };
}
