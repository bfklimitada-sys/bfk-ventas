// Sistema visual unico de BFK Ventas: secciones, tarjetas, badges, montos y botones administrativos.
// Solo presentacion: no contiene logica de negocio.
import { C, MONO, R, S, T, TOUCH, cardStyle } from "../../lib/theme";

// Titulo de seccion (mismo estilo en todas las pantallas)
export function Seccion({ titulo, nota, accion, children, ocultarSiVacio, margen = 22, id }) {
  if (ocultarSiVacio) return null;
  return (
    <section id={id} style={{ marginBottom: margen, scrollMarginTop: 96 }}>
      {(titulo || accion) && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: S.md, marginBottom: nota ? 2 : S.sm, paddingLeft: 2, minHeight: accion ? 36 : undefined }}>
          <h2 style={{ margin: 0, fontSize: T.small, fontWeight: 800, color: C.inkMuted, textTransform: "uppercase", letterSpacing: 0.6 }}>{titulo}</h2>
          {accion}
        </div>
      )}
      {nota && <div style={{ fontSize: T.small, color: C.inkMuted, lineHeight: 1.45, marginBottom: S.sm, paddingLeft: 2 }}>{nota}</div>}
      {children}
    </section>
  );
}

// Tarjeta blanca estandar
export function Tarjeta({ children, style, onClick, padding = "14px 16px", ...resto }) {
  const base = { ...cardStyle, padding, marginBottom: S.sm, ...style };
  if (onClick) {
    return <button type="button" onClick={onClick} {...resto} style={{ ...base, display: "block", width: "100%", textAlign: "left", cursor: "pointer", font: "inherit", color: "inherit" }}>{children}</button>;
  }
  return <div {...resto} style={base}>{children}</div>;
}

const TONOS = {
  ok: { fg: "#047857", bg: C.okLight },
  warn: { fg: "#B45309", bg: C.warnLight },
  danger: { fg: "#B91C1C", bg: C.dangerLight },
  neutro: { fg: C.inkMuted, bg: "#EEF1F5" },
  info: { fg: "#1D4ED8", bg: C.infoLight },
};
// verde = correcto, ambar = atencion, rojo = vencido/problema, gris = informacion
export function Badge({ tono = "neutro", children, style }) {
  const t = TONOS[tono] || TONOS.neutro;
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 9px", borderRadius: R.pill, background: t.bg, color: t.fg, fontSize: T.small, fontWeight: 700, whiteSpace: "nowrap", ...style }}>{children}</span>;
}

// Monto con el mismo tratamiento en toda la app
const COL = { ok: C.okText, warn: C.warnText, danger: C.dangerText, neutro: C.ink, suave: C.inkMuted };
export function Monto({ children, tono = "neutro", tam = "md", style }) {
  const size = { sm: 14, md: 17, lg: 22, xl: 28 }[tam] || 17;
  return <span style={{ fontFamily: MONO, fontWeight: 800, fontSize: size, color: COL[tono] || C.ink, letterSpacing: -0.3, whiteSpace: "nowrap", ...style }}>{children}</span>;
}

// Accion administrativa: menos protagonismo que las acciones habituales (borde punteado, texto sobrio)
export function BotonAdmin({ children, peligro, style, ...resto }) {
  return (
    <button type="button" {...resto} style={{ minHeight: TOUCH, padding: "10px 14px", borderRadius: R.md, border: `1.5px dashed ${peligro ? C.danger + "88" : C.border}`, background: "transparent", color: peligro ? C.danger : C.inkMuted, fontWeight: 600, fontSize: T.body, cursor: resto.disabled ? "default" : "pointer", opacity: resto.disabled ? 0.6 : 1, ...style }}>{children}</button>
  );
}

// Acceso secundario discreto (enlace-boton)
export function Enlace({ children, onClick, color = C.tealDark, style }) {
  return <button type="button" onClick={onClick} style={{ background: "none", border: "none", color, fontWeight: 700, fontSize: T.small, minHeight: 36, padding: "6px 4px", cursor: "pointer", ...style }}>{children}</button>;
}

// Índice de una pantalla larga: botones que llevan a cada sección (navegación dentro de la pantalla).
export function IndiceSecciones({ items }) {
  const ir = (id) => { const el = document.getElementById(id); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); };
  return (
    <nav data-noprint className="bfk-indice" aria-label="Secciones de esta pantalla" style={{ display: "flex", gap: S.sm, overflowX: "auto", margin: `0 0 ${S.lg}px`, paddingBottom: 2, WebkitOverflowScrolling: "touch" }}>
      {items.map((it) => (
        <button key={it.id} type="button" data-compact onClick={() => ir(it.id)}
          style={{ flexShrink: 0, border: `1px solid ${C.border}`, background: C.card, borderRadius: R.pill, padding: "7px 13px", fontSize: T.small + 1, fontWeight: 700, color: C.inkMuted, minHeight: 36, cursor: "pointer", whiteSpace: "nowrap" }}>
          {it.label}{it.n != null ? ` · ${it.n}` : ""}
        </button>
      ))}
    </nav>
  );
}
