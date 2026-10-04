// Único camino para registrar pagos a financiadores (Fase 7).
// Llama a la función transaccional de la base: o se guarda todo, o no se guarda nada.
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./supabase.jsx";

export async function registrarPagoFinanciador(token, { financiadorId, fecha, monto, asignaciones = [], origen = "manual" }) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/registrar_pago_financiador`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      p_financiador_id: financiadorId,
      p_fecha: fecha,
      p_monto: Number(monto),
      p_asignaciones: asignaciones.map((a) => ({ oc_id: a.ocId, monto: Number(a.monto) })),
      p_origen: origen,
    }),
  });
  if (!r.ok) {
    let msg = "No se pudo registrar el pago. No se guardó nada.";
    try { const j = await r.json(); if (j?.message) msg = `${j.message} (no se guardó nada)`; } catch {}
    throw new Error(msg);
  }
  return r.json();
}
