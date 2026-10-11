// Sistema visual único de BFK Ventas: secciones, tarjetas, badges, montos, pestañas, desplegables,
// indicadores, panel lateral y avisos. Solo presentación: no contiene lógica de negocio.
import { createContext, useContext, useEffect, useId, useState } from "react";
import { C, MONO, R, S, T, TOUCH, cardStyle, sombra } from "../../lib/theme";
import { Ic } from "./Iconos";
import { useCerrarConEscape } from "./Basicos";

// ── Modo "todas las pantallas" (imprimir / PDF): abre desplegables y muestra todas las pestañas ──
export const ModoTodoContext = createContext(false);
export const useModoTodo = () => useContext(ModoTodoContext);

// Título de sección (mismo estilo en todas las pantallas)
export function Seccion({ titulo, nota, accion, children, ocultarSiVacio, margen = 20, id }) {
  if (ocultarSiVacio) return null;
  return (
    <section id={id} style={{ marginBottom: margen, scrollMarginTop: 96 }}>
      {(titulo || accion) && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: S.md, marginBottom: nota ? 2 : S.sm, paddingLeft: 2, minHeight: accion ? 36 : undefined }}>
          <h2 style={{ margin: 0, fontSize: T.small, fontWeight: 800, color: C.inkMuted, textTransform: "uppercase", letterSpacing: 0.6 }}>{titulo}</h2>
          {accion}
        </div>
      )}
      {nota && <div style={{ fontSize: T.small, color: C.inkFaint, lineHeight: 1.45, marginBottom: S.sm, paddingLeft: 2 }}>{nota}</div>}
      {children}
    </section>
  );
}

// Tarjeta blanca estándar
export function Tarjeta({ children, style, onClick, padding = "14px 16px", ...resto }) {
  const base = { ...cardStyle, borderRadius: R.md, padding, marginBottom: S.sm, ...style };
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
export const tonoDe = (t) => TONOS[t] || TONOS.neutro;
// verde = correcto, ámbar = atención, rojo = vencido/problema, gris = información
export function Badge({ tono = "neutro", children, style }) {
  const t = tonoDe(tono);
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 9px", borderRadius: R.pill, background: t.bg, color: t.fg, fontSize: T.small, fontWeight: 700, whiteSpace: "nowrap", ...style }}>{children}</span>;
}

// Monto con el mismo tratamiento en toda la app
const COL = { ok: C.okText, warn: C.warnText, danger: C.dangerText, neutro: C.ink, suave: C.inkMuted };
export function Monto({ children, tono = "neutro", tam = "md", style }) {
  const size = { sm: 14, md: 16, lg: 20, xl: 28 }[tam] || 16;
  return <span style={{ fontFamily: MONO, fontWeight: 800, fontSize: size, color: COL[tono] || C.ink, letterSpacing: -0.3, whiteSpace: "nowrap", ...style }}>{children}</span>;
}

// Acción administrativa: menos protagonismo que las acciones habituales (borde punteado, texto sobrio)
export function BotonAdmin({ children, peligro, style, ...resto }) {
  return (
    <button type="button" {...resto} style={{ minHeight: TOUCH, padding: "10px 14px", borderRadius: R.sm, border: `1.5px dashed ${peligro ? C.danger + "88" : C.border}`, background: "transparent", color: peligro ? C.danger : C.inkMuted, fontWeight: 600, fontSize: T.body, cursor: resto.disabled ? "default" : "pointer", opacity: resto.disabled ? 0.6 : 1, ...style }}>{children}</button>
  );
}

// Acceso secundario discreto (enlace-botón)
export function Enlace({ children, onClick, color = C.tealDark, style, ...resto }) {
  return <button type="button" onClick={onClick} {...resto} style={{ background: "none", border: "none", color, fontWeight: 700, fontSize: T.sm, minHeight: 36, padding: "6px 4px", cursor: "pointer", ...style }}>{children}</button>;
}

// Índice de una pantalla larga: botones que llevan a cada sección (navegación dentro de la pantalla).
export function IndiceSecciones({ items }) {
  const ir = (id) => { const el = document.getElementById(id); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); };
  return (
    <nav data-noprint className="bfk-indice" aria-label="Secciones de esta pantalla" style={{ display: "flex", gap: S.sm, overflowX: "auto", margin: `0 0 ${S.lg}px`, paddingBottom: 2, WebkitOverflowScrolling: "touch" }}>
      {items.map((it) => (
        <button key={it.id} type="button" data-compact onClick={() => ir(it.id)}
          style={{ flexShrink: 0, border: `1px solid ${C.border}`, background: C.card, borderRadius: R.pill, padding: "7px 13px", fontSize: T.sm, fontWeight: 700, color: C.inkMuted, minHeight: 36, cursor: "pointer", whiteSpace: "nowrap" }}>
          {it.label}{it.n != null ? ` · ${it.n}` : ""}
        </button>
      ))}
    </nav>
  );
}

// ── Pestañas (control segmentado con desplazamiento horizontal) ────────────
// items: [{ key, label, n?, tono?, attrs? }]. Cada botón lleva data-tab={key} (y los attrs extra, p. ej. data-nav).
export function Pestanas({ items, activa, onCambiar, etiqueta = "Secciones", style, compacta }) {
  const todo = useModoTodo();
  if (todo) return null; // en la vista de impresión se muestran todas las pestañas seguidas
  return (
    <div data-noprint role="tablist" aria-label={etiqueta}
      style={{ display: "flex", gap: 4, overflowX: "auto", padding: 4, margin: `0 0 ${S.lg}px`, background: "#EEF1F5", borderRadius: R.md, WebkitOverflowScrolling: "touch", scrollbarWidth: "none", ...style }}>
      {items.map((it) => {
        const act = it.key === activa;
        const t = it.tono ? tonoDe(it.tono) : null;
        return (
          <button key={it.key} type="button" role="tab" aria-selected={act} data-tab={it.key} data-compact {...(it.attrs || {})} onClick={() => onCambiar(it.key)}
            style={{ flex: compacta ? "0 0 auto" : "1 0 auto", border: "none", borderRadius: R.sm, padding: "8px 12px", minHeight: 38, cursor: "pointer", whiteSpace: "nowrap",
              background: act ? C.card : "transparent", boxShadow: act ? sombra.card : "none", color: act ? C.ink : C.inkMuted, fontSize: T.sm, fontWeight: act ? 800 : 600, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            {it.label}
            {it.n != null && it.n !== 0 && <span style={{ fontSize: T.small, fontWeight: 800, borderRadius: R.pill, padding: "0 7px", lineHeight: "18px", background: t ? t.bg : act ? C.tealLight : "#E2E5EB", color: t ? t.fg : act ? C.tealDark : C.inkMuted }}>{it.n}</span>}
          </button>
        );
      })}
    </div>
  );
}

// Contenido de una pestaña: en modo impresión se muestran todas, cada una con su título.
export function PanelPestana({ visible, titulo, children }) {
  const todo = useModoTodo();
  if (!visible && !todo) return null;
  return (
    <div role="tabpanel">
      {todo && titulo && <h2 style={{ fontSize: T.title, fontWeight: 800, color: C.ink, margin: "8px 0 10px" }}>{titulo}</h2>}
      {children}
    </div>
  );
}

// ── Desplegable: título + resumen en una línea; el detalle se abre al tocar ──
export function Desplegable({ titulo, resumen, derecha, abiertoInicial = false, children, dato, icono, tono, plano, style, onAbrir }) {
  const todo = useModoTodo();
  const [ab, setAb] = useState(abiertoInicial);
  const abierto = ab || todo;
  const idc = useId();
  const t = tono ? tonoDe(tono) : null;
  return (
    <div data-desplegable={dato} style={plano ? { marginBottom: S.sm, ...style } : { ...cardStyle, borderRadius: R.md, marginBottom: S.sm, overflow: "hidden", borderColor: t ? t.fg + "44" : C.border, ...style }}>
      <button type="button" aria-expanded={abierto} aria-controls={idc} onClick={() => { setAb((v) => !v); if (!abierto && onAbrir) onAbrir(); }}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, background: t ? t.bg : "none", border: "none", padding: plano ? "8px 2px" : "12px 14px", minHeight: 48, cursor: "pointer", textAlign: "left", font: "inherit", color: "inherit" }}>
        {icono && <span style={{ color: t ? t.fg : C.inkMuted, display: "flex", flexShrink: 0 }}>{icono}</span>}
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontSize: T.body, fontWeight: 800, color: t ? t.fg : C.ink, lineHeight: 1.3 }}>{titulo}</span>
          {resumen && <span style={{ display: "block", fontSize: T.small, color: C.inkMuted, marginTop: 2, lineHeight: 1.35 }}>{resumen}</span>}
        </span>
        {derecha && <span style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 6 }}>{derecha}</span>}
        <span data-noprint style={{ color: C.inkFaint, flexShrink: 0, display: "flex", transform: abierto ? "rotate(180deg)" : "none", transition: "transform .15s" }}><Ic n="chevD" /></span>
      </button>
      {abierto && <div id={idc} style={{ padding: plano ? "4px 2px 6px" : "0 14px 14px" }}>{children}</div>}
    </div>
  );
}

// ── Indicador (KPI): etiqueta, monto grande y una línea de contexto ─────────
export function Indicador({ etiqueta, valor, tono = "neutro", nota, onClick, dato, destacado }) {
  const col = { ok: C.okText, warn: C.warnText, danger: C.dangerText, neutro: C.ink, marca: C.tealDark }[tono] || C.ink;
  const cuerpo = (
    <>
      <span style={{ display: "block", fontSize: T.small, fontWeight: 700, color: C.inkMuted, lineHeight: 1.3 }}>{etiqueta}</span>
      <span data-indicador-monto={dato} style={{ display: "block", fontFamily: MONO, fontWeight: 800, fontSize: destacado ? 22 : 18, color: col, letterSpacing: -0.5, marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{valor}</span>
      {nota && <span style={{ display: "block", fontSize: T.small, color: C.inkFaint, marginTop: 3, lineHeight: 1.35 }}>{nota}</span>}
    </>
  );
  const base = { ...cardStyle, borderRadius: R.md, padding: "12px 14px", minWidth: 0, textAlign: "left", font: "inherit", color: "inherit", borderColor: destacado ? C.teal + "66" : C.border, background: destacado ? "linear-gradient(180deg,#F0FDFA,#FFFFFF)" : C.card };
  return onClick
    ? <button type="button" data-indicador={dato} onClick={onClick} style={{ ...base, cursor: "pointer", display: "block", width: "100%" }}>{cuerpo}</button>
    : <div data-indicador={dato} style={base}>{cuerpo}</div>;
}

export function Indicadores({ children, columnas = 2 }) {
  return <div style={{ display: "grid", gridTemplateColumns: `repeat(${columnas},minmax(0,1fr))`, gap: S.sm, marginBottom: S.lg }}>{children}</div>;
}

// ── Fila de dato (etiqueta · valor) ──────────────────────────────────────────
export function FilaDato({ k, v, nota, fuerte, tono, dato, onClick, signo }) {
  const col = COL[tono] || (fuerte ? C.ink : C.ink);
  return (
    <div data-fila={dato} onClick={onClick} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, padding: "7px 0", borderBottom: `1px solid ${C.border}`, cursor: onClick ? "pointer" : "default" }}>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontSize: T.sm, color: fuerte ? C.ink : C.inkMuted, fontWeight: fuerte ? 800 : 600 }}>{signo ? <span style={{ color: C.inkFaint, marginRight: 4 }}>{signo}</span> : null}{k}</span>
        {nota && <span style={{ display: "block", fontSize: T.small, color: C.inkFaint, marginTop: 1, lineHeight: 1.35 }}>{nota}</span>}
      </span>
      <span style={{ fontFamily: MONO, fontWeight: 800, fontSize: fuerte ? 16 : 14, color: col, flexShrink: 0, whiteSpace: "nowrap" }}>{v}</span>
    </div>
  );
}

// ── Ayuda: botón "i" que muestra una explicación breve (reemplaza las notas largas siempre visibles) ──
export function Ayuda({ children, etiqueta = "Más información" }) {
  const [ab, setAb] = useState(false);
  const todo = useModoTodo();
  return (
    <>
      <button type="button" data-compact data-noprint aria-expanded={ab} aria-label={etiqueta} onClick={(e) => { e.stopPropagation(); setAb((v) => !v); }}
        style={{ width: 22, height: 22, minHeight: 22, borderRadius: R.pill, border: `1px solid ${C.border}`, background: ab ? C.infoLight : C.card, color: C.info, fontSize: 12, fontWeight: 800, fontStyle: "italic", fontFamily: "Georgia,serif", cursor: "pointer", padding: 0, marginLeft: 6, verticalAlign: "middle", lineHeight: "20px" }}>i</button>
      {(ab || todo) && <span style={{ display: "block", fontSize: T.small, color: C.inkMuted, lineHeight: 1.45, background: C.paper, border: `1px solid ${C.border}`, borderRadius: R.sm, padding: "8px 10px", margin: "6px 0" }}>{children}</span>}
    </>
  );
}

// ── Aviso compacto de una línea (en lugar de banners grandes) ───────────────
export function AvisoLinea({ tono = "warn", children, accion, onClick, dato, icono = "⚠" }) {
  const t = tonoDe(tono);
  const Tag = onClick ? "button" : "div";
  return (
    <Tag type={onClick ? "button" : undefined} data-aviso-linea={dato} onClick={onClick}
      style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, background: t.bg, color: t.fg, border: `1px solid ${t.fg}33`, borderRadius: R.sm, padding: "8px 12px", marginBottom: S.sm, fontSize: T.sm, fontWeight: 700, textAlign: "left", cursor: onClick ? "pointer" : "default", minHeight: 40, font: "inherit", boxSizing: "border-box" }}>
      <span style={{ display: "flex", flexShrink: 0 }}><Ic n={icono} /></span>
      <span style={{ flex: 1, minWidth: 0, lineHeight: 1.35, fontSize: T.sm, fontWeight: 700 }}>{children}</span>
      {accion && <span style={{ flexShrink: 0, fontSize: T.small, fontWeight: 800, textDecoration: "underline" }}>{accion}</span>}
    </Tag>
  );
}

// ── Barra de acciones: botón principal + acciones secundarias en una línea ──
export function BarraAcciones({ children, style }) {
  return <div style={{ display: "flex", gap: S.sm, alignItems: "center", flexWrap: "wrap", marginBottom: S.lg, ...style }}>{children}</div>;
}

export function BotonPrincipal({ children, onClick, color = C.teal, style, ...resto }) {
  return <button type="button" onClick={onClick} {...resto} style={{ minHeight: 44, padding: "10px 16px", borderRadius: R.sm, border: "none", background: color, color: "#fff", fontWeight: 700, fontSize: T.body, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8, boxShadow: "0 2px 8px rgba(13,148,136,0.25)", ...style }}>{children}</button>;
}

export function BotonSecundario({ children, onClick, style, activo, ...resto }) {
  return <button type="button" onClick={onClick} {...resto} style={{ minHeight: 40, padding: "8px 12px", borderRadius: R.sm, border: `1px solid ${activo ? C.info : C.border}`, background: activo ? C.infoLight : C.card, color: activo ? C.info : C.ink, fontWeight: 700, fontSize: T.sm, cursor: resto.disabled ? "default" : "pointer", opacity: resto.disabled ? 0.6 : 1, display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", ...style }}>{children}</button>;
}

// ── Panel lateral (escritorio) / pantalla completa (celular) ────────────────
// Se usa para la ficha de OC. Escape cierra (respetando las ventanas abiertas encima).
export function HojaLateral({ abierta, onCerrar, titulo, subtitulo, derecha, children, ancho = 720, dato }) {
  const [escritorio, setEscritorio] = useState(() => typeof window !== "undefined" && window.innerWidth >= 1024);
  useEffect(() => { const f = () => setEscritorio(window.innerWidth >= 1024); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f); }, []);
  useCerrarConEscape(onCerrar, !!abierta);
  useEffect(() => {
    if (!abierta) return undefined;
    const prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [abierta]);
  if (!abierta) return null;
  return (
    <div data-hoja-lateral={dato} style={{ position: "fixed", inset: 0, zIndex: 60, display: "flex", justifyContent: "flex-end" }}>
      {escritorio && <div data-noprint onClick={onCerrar} style={{ position: "absolute", inset: 0, background: "rgba(11,17,32,0.35)" }} />}
      <div role="dialog" aria-modal="true" aria-label={typeof titulo === "string" ? titulo : "Detalle"} className="bfk-hoja"
        style={{ position: "relative", width: escritorio ? `min(${ancho}px, 92vw)` : "100%", height: "100%", background: C.paper, boxShadow: escritorio ? sombra.panel : "none", display: "flex", flexDirection: "column" }}>
        <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 10, background: C.card, borderBottom: `1px solid ${C.border}`, padding: escritorio ? "12px 16px" : "calc(10px + env(safe-area-inset-top)) 12px 10px" }}>
          <button type="button" onClick={onCerrar} aria-label="Cerrar ficha" data-cerrar-hoja
            style={{ width: 40, height: 40, minHeight: 40, borderRadius: R.sm, border: `1px solid ${C.border}`, background: C.card, color: C.ink, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            {escritorio ? <span style={{ fontSize: 16, lineHeight: 1 }}>✕</span> : <Ic n="chevL" />}
          </button>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: T.body, fontWeight: 800, color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{titulo}</div>
            {subtitulo && <div style={{ fontSize: T.small, color: C.inkMuted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{subtitulo}</div>}
          </div>
          {derecha}
        </div>
        <div data-hoja-cuerpo style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch", position: "relative" }}>{children}</div>
      </div>
    </div>
  );
}
