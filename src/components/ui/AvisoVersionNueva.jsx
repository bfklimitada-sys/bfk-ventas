// Aviso cuando BFK Datos se publicó de nuevo mientras esta pestaña estaba abierta (falta un archivo de la versión anterior).
// No recarga solo: el usuario guarda lo que esté editando y decide. Máximo una recarga cada 5 minutos (sin bucles).
import { useEffect, useState } from "react";
import { C } from "../../lib/theme";
import { puedeRecargar, recargarPorVersionNueva } from "../../lib/cargaModulos.js";

export function AvisoVersionNueva() {
  const [visible, setVisible] = useState(false); const [bloqueada, setBloqueada] = useState(false);
  useEffect(() => {
    const on = () => { setVisible(true); setBloqueada(!puedeRecargar()); };
    window.addEventListener("bfk:version-nueva", on);
    return () => window.removeEventListener("bfk:version-nueva", on);
  }, []);
  if (!visible) return null;
  return (
    <div role="alert" data-aviso-version-nueva style={{ position: "fixed", left: 12, right: 12, bottom: "calc(84px + env(safe-area-inset-bottom))", zIndex: 4000, maxWidth: 560, margin: "0 auto",
      background: C.night, color: "#fff", borderRadius: 12, padding: "12px 14px", boxShadow: "0 8px 24px rgba(0,0,0,0.3)", fontSize: 13, lineHeight: 1.45 }}>
      {bloqueada
        ? <>La aplicación ya se actualizó hace pocos minutos y el archivo sigue sin cargar. Cierra esta pestaña y vuelve a abrir BFK Datos; si persiste, revisa la conexión.</>
        : <>Hay una versión nueva de BFK Datos. <b>Guarda lo que estés editando</b> y luego actualiza para seguir generando PDF.</>}
      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        {!bloqueada && <button data-actualizar-version onClick={() => { if (!recargarPorVersionNueva()) setBloqueada(true); }}
          style={{ background: C.teal, color: "#fff", border: "none", borderRadius: 8, padding: "8px 14px", fontWeight: 700, minHeight: 40, cursor: "pointer" }}>Actualizar BFK Datos</button>}
        <button data-cerrar-aviso-version onClick={() => setVisible(false)} style={{ background: "transparent", color: "#fff", border: "1px solid #ffffff55", borderRadius: 8, padding: "8px 14px", minHeight: 40, cursor: "pointer" }}>Ahora no</button>
      </div>
    </div>
  );
}
