// Interruptor central de Inteligencia Comercial (06/11/2026). La decisión real la toma el SERVIDOR (api/inteligencia.mjs
// consulta ic_interruptor_estado antes de cualquier otra cosa). Aquí solo se LEE el estado para mostrarlo en
// Administración, y un administrador puede cambiarlo con una acción explícita y confirmada.
// Regla: solo { habilitada: true } exacto significa habilitada. Función ausente, error o valor inválido = DESACTIVADA.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabase.jsx";

export const FRASE_REACTIVAR = "REACTIVAR INTELIGENCIA COMERCIAL";

export function interpretarEstado(status, cuerpo) {
  const instalado = status !== 404;
  const habilitada = status >= 200 && status < 300 && cuerpo !== null && typeof cuerpo === "object" && !Array.isArray(cuerpo) && cuerpo.habilitada === true;
  return { habilitada, instalado, cambiado_por: cuerpo?.cambiado_por || null, cambiado_en: cuerpo?.cambiado_en || null, motivo: cuerpo?.motivo || null };
}

export async function leerInterruptorIC(token, f = (...a) => fetch(...a)) {
  try {
    const r = await f(`${SUPABASE_URL}/rest/v1/rpc/ic_interruptor_estado`, { method: "POST", headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token || SUPABASE_ANON_KEY}`, "Content-Type": "application/json" }, body: "{}" });
    const c = await r.json().catch(() => null);
    return interpretarEstado(r.status, c);
  } catch { return { habilitada: false, instalado: null, cambiado_por: null, cambiado_en: null, motivo: null }; }
}

export async function cambiarInterruptorIC(token, { habilitar, confirmacion = "", motivo = "" }, f = (...a) => fetch(...a)) {
  const r = await f(`${SUPABASE_URL}/rest/v1/rpc/ic_cambiar_interruptor`, { method: "POST", headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_habilitar: !!habilitar, p_confirmacion: confirmacion, p_motivo: motivo }) });
  const c = await r.json().catch(() => null);
  if (r.status === 404) throw new Error("El interruptor aún no está instalado en la base de datos. La reactivación requiere aplicar antes su migración (con autorización).");
  if (!r.ok) throw new Error(String(c?.message || `HTTP ${r.status}`).replace(/^IC\d+:\s*/, ""));
  return interpretarEstado(200, c);
}
