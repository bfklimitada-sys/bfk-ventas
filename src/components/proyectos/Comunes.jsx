// Proyectos Industriales — piezas de presentación compartidas (sin reglas de negocio).
import { useEffect, useState } from "react";
import { C, MONO, R, S, T, iStyle, selStyle } from "../../lib/theme";
import { Badge } from "../ui/Sistema";
import { useCerrarConEscape } from "../ui/Basicos";
import { estadoDe, formatoPct } from "../../lib/proyectos";

// Barra de avance real con la marca de lo planificado a hoy (la línea negra).
export function BarraAvance({ real, planificado, atrasado, alto = 8, etiquetas = true, dato }) {
  const r = Math.max(0, Math.min(100, Number(real) || 0));
  const p = planificado === null || planificado === undefined ? null : Math.max(0, Math.min(100, Number(planificado)));
  const color = atrasado ? C.danger : r >= 100 ? C.ok : C.teal;
  return (
    <div data-avance={dato} data-avance-real={r} data-avance-plan={p ?? ""}>
      <div style={{ position: "relative", height: alto, background: "#E5E8EE", borderRadius: R.pill, margin: "6px 0 4px" }}>
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${r}%`, background: color, borderRadius: R.pill }} />
        {p !== null && <div title={`Planificado a hoy: ${formatoPct(p)} %`} style={{ position: "absolute", top: -4, bottom: -4, left: `calc(${p}% - 1px)`, width: 2, background: C.ink, borderRadius: 1 }} />}
      </div>
      {etiquetas && (
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: T.small, color: C.inkMuted }}>
          <span><b style={{ fontFamily: MONO, color: C.ink }}>{formatoPct(r)}</b> % real</span>
          {p !== null && <span>planificado a hoy <b style={{ fontFamily: MONO, color: C.ink }}>{formatoPct(p)}</b> %</span>}
        </div>
      )}
    </div>
  );
}

export function BadgeEstado({ estado, style }) {
  const e = estadoDe(estado);
  return <Badge tono={e?.tono || "neutro"} style={style}><span data-estado-proyecto={estado}>{e?.l || estado}</span></Badge>;
}

// Ventana de formulario: centrada en escritorio, pantalla completa en el celular.
export function Ventana({ titulo, onCerrar, children, pie, dato, ancho = 560 }) {
  useCerrarConEscape(onCerrar, true);
  const [esc, setEsc] = useState(() => window.innerWidth >= 700);
  useEffect(() => { const f = () => setEsc(window.innerWidth >= 700); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f); }, []);
  return (
    <div data-ventana={dato} style={{ position: "fixed", inset: 0, zIndex: 80, background: "rgba(11,17,32,0.45)", display: "flex", alignItems: esc ? "center" : "stretch", justifyContent: "center", padding: esc ? 24 : 0 }}
      onMouseDown={(e) => { if (e.target === e.currentTarget && esc) onCerrar(); }}>
      <div role="dialog" aria-modal="true" aria-label={titulo}
        style={{ background: C.card, width: esc ? `min(${ancho}px, 100%)` : "100%", maxHeight: esc ? "92vh" : "100%", borderRadius: esc ? R.xl : 0, display: "flex", flexDirection: "column", boxShadow: "0 30px 70px rgba(0,0,0,.25)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: esc ? "16px 20px" : "calc(12px + env(safe-area-inset-top)) 16px 12px", borderBottom: `1px solid ${C.border}` }}>
          <div style={{ fontWeight: 800, fontSize: T.title, color: C.ink, minWidth: 0 }}>{titulo}</div>
          <button type="button" aria-label="Cerrar" data-cerrar-ventana onClick={onCerrar}
            style={{ width: 40, height: 40, minHeight: 40, borderRadius: R.sm, border: `1px solid ${C.border}`, background: C.paper, cursor: "pointer", fontSize: 16, flexShrink: 0 }}>✕</button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: esc ? "16px 20px" : 16 }}>{children}</div>
        {pie && <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap", padding: esc ? "12px 20px" : "12px 16px calc(12px + env(safe-area-inset-bottom))", borderTop: `1px solid ${C.border}` }}>{pie}</div>}
      </div>
    </div>
  );
}

export function Campo({ etiqueta, ayuda, error, children, ancho }) {
  return (
    <label style={{ display: "block", marginBottom: S.md, gridColumn: ancho === "completo" ? "1 / -1" : undefined, minWidth: 0 }}>
      <span style={{ display: "block", fontSize: T.small, fontWeight: 800, color: C.inkMuted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 }}>{etiqueta}</span>
      {children}
      {ayuda && <span style={{ display: "block", fontSize: T.small, color: C.inkFaint, marginTop: 4, lineHeight: 1.4 }}>{ayuda}</span>}
      {error && <span style={{ display: "block", fontSize: T.small, color: C.dangerText, marginTop: 4, fontWeight: 700 }}>{error}</span>}
    </label>
  );
}
export const Rejilla = ({ children, columnas = 2 }) => <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit,minmax(${columnas === 3 ? 160 : 200}px,1fr))`, columnGap: S.md }}>{children}</div>;
export const Subtitulo = ({ children }) => <div style={{ fontSize: T.small, fontWeight: 800, color: C.tealDark, textTransform: "uppercase", letterSpacing: 0.5, margin: "6px 0 10px", paddingTop: 10, borderTop: `1px solid ${C.border}` }}>{children}</div>;

export function Entrada(props) { return <input {...props} style={{ ...iStyle, ...props.style }} />; }
export function Area(props) { return <textarea rows={3} {...props} style={{ ...iStyle, minHeight: 84, resize: "vertical", fontFamily: "inherit", ...props.style }} />; }
export function Selector({ opciones, vacio, ...props }) {
  return (
    <select {...props} style={{ ...selStyle, ...props.style }}>
      {vacio !== undefined && <option value="">{vacio}</option>}
      {opciones.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
    </select>
  );
}

export function ErrorForm({ children }) {
  if (!children) return null;
  return <div data-error-form role="alert" style={{ background: C.dangerLight, color: C.dangerText, borderRadius: R.sm, padding: "9px 12px", fontSize: T.sm, fontWeight: 700, marginBottom: S.md }}>{children}</div>;
}

export function Vacio({ children, dato }) {
  return <div data-vacio={dato} style={{ padding: "18px 16px", textAlign: "center", color: C.inkMuted, fontSize: T.sm, background: C.card, border: `1px dashed ${C.border}`, borderRadius: R.md }}>{children}</div>;
}

// Confirmación con motivo (anular, suspender, rechazar…): devuelve el motivo o null.
export function PedirMotivo({ titulo, texto, etiquetaBoton = "Confirmar", peligro, obligatorio = true, onCancelar, onConfirmar, ocupado }) {
  const [m, setM] = useState(""); const [err, setErr] = useState("");
  const ok = () => { if (obligatorio && m.trim().length < 3) { setErr("Indica el motivo (al menos 3 caracteres)."); return; } onConfirmar(m.trim()); };
  return (
    <Ventana titulo={titulo} onCerrar={onCancelar} dato="motivo" ancho={460}
      pie={<><button type="button" onClick={onCancelar} style={{ minHeight: 44, padding: "10px 14px", borderRadius: R.sm, border: `1px solid ${C.border}`, background: C.card, fontWeight: 700, cursor: "pointer" }}>Cancelar</button>
        <button type="button" data-confirmar-motivo disabled={ocupado} onClick={ok} style={{ minHeight: 44, padding: "10px 16px", borderRadius: R.sm, border: "none", background: peligro ? C.danger : C.night, color: "#fff", fontWeight: 800, cursor: "pointer" }}>{ocupado ? "Guardando…" : etiquetaBoton}</button></>}>
      {texto && <p style={{ marginTop: 0, fontSize: T.sm, color: C.inkMuted, lineHeight: 1.5 }}>{texto}</p>}
      <Campo etiqueta={obligatorio ? "Motivo" : "Motivo (opcional)"} error={err}><Area data-motivo value={m} onChange={(e) => { setM(e.target.value); setErr(""); }} maxLength={1000} /></Campo>
    </Ventana>
  );
}

export const estiloBoton = (tipo = "sec") => ({
  minHeight: 40, padding: "8px 14px", borderRadius: R.sm, cursor: "pointer", fontWeight: 700, fontSize: T.sm, whiteSpace: "nowrap",
  ...(tipo === "pri" ? { border: "none", background: C.teal, color: "#fff" } : tipo === "peligro" ? { border: `1px solid ${C.border}`, background: C.card, color: C.danger } : { border: `1px solid ${C.border}`, background: C.card, color: C.ink }),
});
