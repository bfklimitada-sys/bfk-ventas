// Proyectos Industriales — historial inalterable (pi_historial): quién, cuándo y qué cambió (antes → después).
// Lo escriben disparadores de la base; nadie lo modifica. Los cambios económicos solo los ve quien puede ver la economía.
import { useEffect, useState } from "react";
import { C, S, T } from "../../lib/theme";
import { Seccion } from "../ui/Sistema";
import { Vacio, ErrorForm } from "./Comunes";
import { describirHistorial, mensajeError } from "../../lib/proyectos";
import { listarHistorial } from "../../lib/proyectosDatos";

export function PestanaHistorial({ token, proyecto: p, nombres, version }) {
  const [filas, setFilas] = useState(null); const [error, setError] = useState("");
  useEffect(() => { let vivo = true; listarHistorial(token, p.id).then((h) => vivo && setFilas(h || [])).catch((e) => { if (vivo) { setError(mensajeError(e)); setFilas([]); } }); return () => { vivo = false; }; }, [p.id, version, token]);
  if (filas === null) return <Vacio>Cargando historial…</Vacio>;
  return (
    <Seccion titulo={`Historial de modificaciones · ${filas.length}`} nota="Registro automático e inalterable de cada cambio: quién, cuándo y qué cambió.">
      {error && <ErrorForm>{error}</ErrorForm>}
      {!filas.length && <Vacio dato="historial">Sin registros.</Vacio>}
      {filas.map((h) => {
        const d = describirHistorial(h, nombres);
        return (
          <div key={h.id} data-historial={h.tabla} data-historial-accion={h.accion} style={{ borderLeft: `3px solid ${h.accion === "crear" ? C.teal : h.accion === "eliminar" ? C.danger : C.border}`, padding: "8px 12px", marginBottom: S.sm, background: "transparent" }}>
            <div style={{ fontWeight: 800, color: C.ink, fontSize: T.sm, overflowWrap: "anywhere" }}>{d.titulo}</div>
            <div style={{ fontSize: T.small, color: C.inkMuted }}>{h.usuario_nombre || (h.usuario_id ? nombres[h.usuario_id] || "Usuario" : "Sistema")} · {new Date(h.fecha).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" })}</div>
            {d.detalles.length > 0 && (
              <ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: T.small, color: C.ink, lineHeight: 1.5 }}>
                {d.detalles.map((x) => <li key={x.campo}><b>{x.campo}:</b> {x.antes} → {x.despues}</li>)}
              </ul>
            )}
          </div>
        );
      })}
    </Seccion>
  );
}
