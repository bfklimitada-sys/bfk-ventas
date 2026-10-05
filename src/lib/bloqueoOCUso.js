// Conexión del controlador con Supabase y con React.
import { useEffect, useState } from "react";
import { SUPABASE_URL, hdrs } from "./supabase";
import { crearControlador, TTL_SEGUNDOS } from "./bloqueoOC";

let proveedorToken = () => null;
export const fijarProveedorToken = (f) => { proveedorToken = f; };

export async function rpcBloqueoOC(ocId, accion, opts) {
  const t = proveedorToken();
  if (!t) throw new Error("sin sesión");
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/gestionar_bloqueo_oc`, {
    method: "POST", headers: hdrs(t), keepalive: !!(opts && opts.keepalive),
    body: JSON.stringify({ p_oc_id: ocId, p_accion: accion, p_ttl_segundos: TTL_SEGUNDOS }),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw Object.assign(new Error((j && j.message) || `HTTP ${r.status}`), { status: r.status });
  return j;
}

export const bloqueoOC = crearControlador({ rpc: rpcBloqueoOC });

// Un solo ciclo de bloqueo para la OC expandida, sin importar desde dónde se abrió (lista, Alertas, ocFoco, buscador).
export function useBloqueoOC(ocId) {
  const [est, setEst] = useState(bloqueoOC.obtener());
  useEffect(() => bloqueoOC.suscribir(setEst), []);
  useEffect(() => { bloqueoOC.abrir(ocId || null); }, [ocId]);
  useEffect(() => {
    const salir = () => { bloqueoOC.suspender({ keepalive: true }); };
    const volver = (e) => { if (e.persisted) bloqueoOC.reintentar(); };
    const visible = () => { if (document.visibilityState === "visible") bloqueoOC.reintentar(); };
    window.addEventListener("pagehide", salir);
    window.addEventListener("pageshow", volver);
    document.addEventListener("visibilitychange", visible);
    return () => { window.removeEventListener("pagehide", salir); window.removeEventListener("pageshow", volver); document.removeEventListener("visibilitychange", visible); bloqueoOC.cerrar(); };
  }, []);
  return est;
}
