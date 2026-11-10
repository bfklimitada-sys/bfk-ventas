// Aviso de sesión vencida (09/11/2026). Aparece cuando la sesión no se pudo renovar (el servidor rechazó la renovación).
// La pantalla NO se cierra: lo que se estaba escribiendo sigue en su lugar y en la copia de recuperación de este dispositivo.
// Se vuelve a ingresar con la MISMA cuenta y luego se guarda normalmente. Mientras el token siga vigente el aviso es una franja
// (se puede seguir trabajando y guardar); cuando vence, bloquea la pantalla hasta reingresar.
import { useEffect, useState } from "react";
import { C, SANS, btnP, iStyle } from "../../lib/theme";
import { reingresar, restanteMs, sesionActual } from "../../lib/sesion";

export function AvisoSesion({ email, onCerrarSesion }) {
  const [ver, setVer] = useState(false); const [pass, setPass] = useState(""); const [err, setErr] = useState(""); const [ocupado, setOcupado] = useState(false);
  const [vencida, setVencida] = useState(() => restanteMs(sesionActual()) <= 0);
  useEffect(() => { const t = setInterval(() => setVencida(restanteMs(sesionActual()) <= 0), 5000); return () => clearInterval(t); }, []);
  const entrar = async () => {
    if (!pass) { setErr("Escribe tu contraseña."); return; }
    setOcupado(true); setErr("");
    try { await reingresar(email, pass); setPass(""); }
    catch (e) { setErr(/invalid|credenciales|Invalid login/i.test(e.message) ? "Correo o contraseña incorrectos." : e.message); }
    finally { setOcupado(false); }
  };
  const abierto = vencida || ver;
  const texto = "Tus cambios sin guardar siguen en esta pantalla y en la copia de recuperación de este dispositivo. Vuelve a ingresar con la misma cuenta y luego guárdalos.";
  if (!abierto) return (
    <div role="alert" data-aviso-sesion="franja" style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 2000, background: C.warnLight || "#FFF4D6", color: C.warnText || "#7A4B00", fontFamily: SANS, fontSize: 13, padding: "8px 14px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", boxShadow: "0 2px 8px rgba(0,0,0,0.12)" }}>
      <b>La sesión no se pudo renovar.</b><span style={{ flex: 1, minWidth: 200 }}>Guarda lo que estás haciendo y vuelve a ingresar antes de que venza.</span>
      <button type="button" data-reingresar onClick={() => setVer(true)} style={{ ...btnP(C.night), width: "auto", padding: "6px 14px", fontSize: 13 }}>Volver a ingresar</button>
    </div>
  );
  return (
    <div role="dialog" aria-modal="true" data-aviso-sesion="ventana" style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(8,14,28,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, fontFamily: SANS }}>
      <div style={{ background: C.card, borderRadius: 14, padding: "22px 20px", width: "100%", maxWidth: 400, boxShadow: "0 20px 50px rgba(0,0,0,0.35)" }}>
        <div style={{ fontWeight: 800, fontSize: 17, color: C.ink, marginBottom: 8 }}>{vencida ? "Tu sesión venció" : "Vuelve a ingresar"}</div>
        <div style={{ fontSize: 13, color: C.inkMuted, lineHeight: 1.5, marginBottom: 14 }}>{texto}</div>
        {err && <div data-error-reingreso style={{ background: C.dangerLight, color: C.dangerText, borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 12, fontWeight: 600 }}>{err}</div>}
        <div style={{ fontSize: 12, color: C.inkMuted, marginBottom: 4 }}>Cuenta</div>
        <div data-cuenta-sesion style={{ fontWeight: 700, fontSize: 14, color: C.ink, marginBottom: 12, wordBreak: "break-all" }}>{email}</div>
        <label style={{ display: "block", fontSize: 12, color: C.inkMuted, marginBottom: 4 }} htmlFor="bfk-reingreso-clave">Contraseña</label>
        <input id="bfk-reingreso-clave" data-clave-reingreso type="password" autoComplete="current-password" value={pass} onChange={(e) => { setPass(e.target.value); setErr(""); }} onKeyDown={(e) => e.key === "Enter" && entrar()} style={{ ...iStyle, marginBottom: 14 }} />
        <button type="button" data-confirmar-reingreso onClick={entrar} disabled={ocupado} style={btnP(ocupado ? C.inkFaint : C.night)}>{ocupado ? "Ingresando…" : "Ingresar y seguir donde estaba"}</button>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12, gap: 8 }}>
          {!vencida ? <button type="button" onClick={() => setVer(false)} style={{ background: "none", border: "none", color: C.tealDark, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Ahora no</button> : <span />}
          <button type="button" data-cerrar-sesion-aviso onClick={onCerrarSesion} style={{ background: "none", border: "none", color: C.inkMuted, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Cerrar sesión (los cambios quedan en este dispositivo)</button>
        </div>
      </div>
    </div>
  );
}
