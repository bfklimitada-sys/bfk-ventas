// Navegación de la app (Fase 3): barra inferior y menú "Más" en el celular,
// barra lateral en escritorio. Solo presentación: las pantallas y permisos
// vienen de lib/navegacion.js y la acción de navegar la decide App.
import { useEffect, useRef, useState } from "react";
import { C, MONO } from "../../lib/theme";
import { GRUPOS, PRINCIPALES } from "../../lib/navegacion";
import { Ic } from "./Iconos";

export const ANCHO_ESCRITORIO = 1024;
export const ANCHO_LATERAL = 248;

// true cuando la ventana es de escritorio (≥ 1024 px). Se actualiza al girar o redimensionar.
export function useEsEscritorio() {
  const consulta = `(min-width: ${ANCHO_ESCRITORIO}px)`;
  const leer = () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(consulta).matches : false);
  const [es, setEs] = useState(leer);
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia(consulta);
    const cambio = () => setEs(mq.matches);
    cambio();
    if (mq.addEventListener) mq.addEventListener("change", cambio); else mq.addListener(cambio);
    return () => { if (mq.removeEventListener) mq.removeEventListener("change", cambio); else mq.removeListener(cambio); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return es;
}

// Cantidad que muestra el aviso de Alertas (no leídas + urgentes), igual que NotifBadge.
export const contarAlertas = (notificaciones, urgentes) =>
  (notificaciones || []).filter((n) => !n.leida).length + Number(urgentes || 0);

const Contador = ({ n, oscuro }) => (n > 0
  ? <span aria-hidden="true" style={{ background: C.danger, color: "#fff", borderRadius: 10, fontSize: 12, fontWeight: 800, padding: "1px 6px", marginLeft: 4, lineHeight: "16px", boxShadow: oscuro ? "0 0 0 2px #0B1120" : "none" }}>{n > 9 ? "9+" : n}</span>
  : null);

const nombreAccesible = (p, nAlertas) => (p.key === "notif" && nAlertas > 0 ? `${p.label}, ${nAlertas} pendiente${nAlertas > 1 ? "s" : ""}` : p.label);

// ── Celular: barra inferior con las 4 principales + "Más" ──────────────────
export function BarraInferior({ visibles, tab, onIr, menuAbierto, onAlternarMenu, nAlertas }) {
  const principales = visibles.filter((p) => PRINCIPALES.includes(p.key));
  const secundarias = visibles.filter((p) => !PRINCIPALES.includes(p.key));
  const enMas = secundarias.some((p) => p.key === tab);
  return (
    <nav data-noprint aria-label="Navegación principal" style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "rgba(255,255,255,0.96)", backdropFilter: "blur(12px)", borderTop: `1px solid ${C.border}`, display: "flex", padding: "6px 4px calc(6px + env(safe-area-inset-bottom))", boxShadow: "0 -4px 20px rgba(15,23,42,0.06)", zIndex: 42 }}>
      {principales.map((p) => {
        const activo = tab === p.key;
        return (
          <button key={p.key} data-nav={p.key} aria-current={activo ? "page" : undefined} aria-label={nombreAccesible(p, nAlertas)} onClick={() => onIr(p.key)}
            style={{ flex: 1, background: "none", border: "none", padding: "6px 1px", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
            <span style={{ fontSize: 17, position: "relative", display: "flex", alignItems: "center", justifyContent: "center", width: 44, height: 28, borderRadius: 14, background: activo ? C.tealLight : "transparent", transition: "all 0.18s" }}>
              <Ic n={p.icono} />
              {p.key === "notif" && <Contador n={nAlertas} />}
            </span>
            <span style={{ fontSize: 12, fontWeight: activo ? 800 : 600, color: activo ? C.tealDark : C.inkMuted }}>{p.label}</span>
          </button>
        );
      })}
      {secundarias.length > 0 && (
        <button data-nav="mas" aria-haspopup="dialog" aria-expanded={menuAbierto} aria-label="Más pantallas y cuenta" onClick={onAlternarMenu}
          style={{ flex: 1, background: "none", border: "none", padding: "6px 1px", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
          <span style={{ fontSize: 17, display: "flex", alignItems: "center", justifyContent: "center", width: 44, height: 28, borderRadius: 14, background: enMas || menuAbierto ? C.tealLight : "transparent", transition: "all 0.18s" }}><Ic n="☰" /></span>
          <span style={{ fontSize: 12, fontWeight: enMas || menuAbierto ? 800 : 600, color: enMas || menuAbierto ? C.tealDark : C.inkMuted }}>Más</span>
        </button>
      )}
    </nav>
  );
}

// ── Celular: hoja "Más" con las demás pantallas (agrupadas) y la cuenta ─────
export function MenuMas({ abierto, onCerrar, visibles, tab, onIr, perfil, onImprimir, onSalir }) {
  const caja = useRef(null);
  useEffect(() => {
    if (!abierto) return;
    const tecla = (e) => { if (e.key === "Escape") onCerrar(); };
    window.addEventListener("keydown", tecla);
    if (caja.current) caja.current.focus({ preventScroll: true });
    return () => window.removeEventListener("keydown", tecla);
  }, [abierto]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!abierto) return null;
  const secundarias = visibles.filter((p) => !PRINCIPALES.includes(p.key));
  const grupos = GRUPOS.map((g) => ({ ...g, items: secundarias.filter((p) => p.grupo === g.key) })).filter((g) => g.items.length);
  const esAdmin = perfil?.rol === "admin";
  const titulo = { fontSize: 12, fontWeight: 800, color: C.inkFaint, textTransform: "uppercase", letterSpacing: 0.6, margin: "4px 6px 6px" };
  const fila = (activo) => ({ width: "100%", display: "flex", alignItems: "center", gap: 12, background: activo ? C.tealLight : "transparent", border: "none", borderRadius: 12, padding: "10px 10px", cursor: "pointer", textAlign: "left" });
  return (
    <div data-noprint onClick={onCerrar} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.35)", zIndex: 40 }}>
      <div ref={caja} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Más pantallas y cuenta" onClick={(e) => e.stopPropagation()}
        style={{ position: "fixed", bottom: "calc(64px + env(safe-area-inset-bottom))", left: 12, right: 12, maxWidth: 520, margin: "0 auto", maxHeight: "calc(100vh - 140px - env(safe-area-inset-bottom))", overflowY: "auto", background: C.card, borderRadius: 16, padding: "10px 8px 8px", boxShadow: "0 -10px 40px rgba(15,23,42,0.2)", zIndex: 41, outline: "none" }}>
        <div style={{ width: 36, height: 4, background: C.border, borderRadius: 2, margin: "0 auto 10px" }} />
        {grupos.map((g) => (
          <div key={g.key} style={{ marginBottom: 8 }}>
            <div style={titulo}>{g.label}</div>
            {g.items.map((p) => (
              <button key={p.key} data-nav={p.key} aria-current={tab === p.key ? "page" : undefined} onClick={() => onIr(p.key)} style={fila(tab === p.key)}>
                <span style={{ width: 38, height: 38, borderRadius: 10, background: tab === p.key ? "#fff" : C.paper, color: tab === p.key ? C.tealDark : C.inkMuted, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}><Ic n={p.icono} /></span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: tab === p.key ? C.tealDark : C.ink }}>{p.label}</span>
                  <span style={{ display: "block", fontSize: 12, color: C.inkMuted, lineHeight: 1.35 }}>{p.desc}</span>
                </span>
                <span style={{ color: C.inkFaint, flexShrink: 0 }}><Ic n="chevR" /></span>
              </button>
            ))}
          </div>
        ))}
        <div style={{ borderTop: `1px solid ${C.border}`, margin: "4px 4px 0", paddingTop: 8 }}>
          <div style={titulo}>Cuenta</div>
          <div style={{ padding: "2px 10px 8px", fontSize: 13, color: C.inkMuted }}>
            <b style={{ color: C.ink }}>{perfil?.nombre || "—"}</b> · {esAdmin ? "Administrador" : "Usuario"}
          </div>
          {esAdmin && onImprimir && (
            <button aria-label="Imprimir o guardar como PDF todas las pantallas" onClick={onImprimir} style={fila(false)}>
              <span style={{ width: 38, height: 38, borderRadius: 10, background: C.paper, color: C.inkMuted, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}><Ic n="printer" /></span>
              <span style={{ fontSize: 14, fontWeight: 700, color: C.ink }}>Imprimir o guardar PDF de todas las pantallas</span>
            </button>
          )}
          <button data-nav="salir" onClick={onSalir} style={fila(false)}>
            <span style={{ width: 38, height: 38, borderRadius: 10, background: C.paper, color: C.dangerText, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}><Ic n="salir" /></span>
            <span style={{ fontSize: 14, fontWeight: 700, color: C.dangerText }}>Cerrar sesión</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Escritorio: barra lateral con todas las pantallas agrupadas ────────────
export function BarraLateral({ visibles, tab, onIr, nAlertas, perfil, onNuevaOC, onImprimir, onSalir }) {
  const grupos = GRUPOS.map((g) => ({ ...g, items: visibles.filter((p) => p.grupo === g.key) })).filter((g) => g.items.length);
  const esAdmin = perfil?.rol === "admin";
  const sec = { width: "100%", display: "flex", alignItems: "center", gap: 10, background: "transparent", border: "1px solid rgba(255,255,255,0.10)", borderRadius: 10, padding: "8px 10px", color: "#B8C4D9", fontSize: 13, fontWeight: 600, cursor: "pointer", textAlign: "left", minHeight: 40 };
  return (
    <aside data-noprint aria-label="Navegación" style={{ position: "sticky", top: 0, height: "100vh", width: ANCHO_LATERAL, flexShrink: 0, boxSizing: "border-box", display: "flex", flexDirection: "column", background: `linear-gradient(180deg,${C.night} 0%,#16213E 100%)`, color: "#fff", padding: "18px 14px 14px", overflowY: "auto", zIndex: 30 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 4px 16px" }}>
        <div style={{ width: 38, height: 38, background: "rgba(20,184,166,0.15)", border: `1.5px solid ${C.teal}`, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: MONO, color: C.teal, fontWeight: 800, fontSize: 13, flexShrink: 0 }}>BFK</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 15, letterSpacing: -0.3 }}>BFK Ltda</div>
          <div style={{ fontSize: 12, color: "#8B9AB5" }}>Ventas Mercado Público</div>
        </div>
      </div>
      <button onClick={onNuevaOC} style={{ width: "100%", background: C.teal, border: "none", color: "#fff", borderRadius: 10, padding: "11px 14px", fontSize: 14, fontWeight: 800, cursor: "pointer", boxShadow: "0 3px 10px rgba(20,184,166,0.35)", marginBottom: 14 }}>+ Nueva OC</button>
      <nav aria-label="Pantallas" style={{ flex: 1 }}>
        {grupos.map((g) => (
          <div key={g.key} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#8B9AB5", textTransform: "uppercase", letterSpacing: 0.7, padding: "0 10px 6px" }}>{g.label}</div>
            {g.items.map((p) => {
              const activo = tab === p.key;
              return (
                <button key={p.key} data-nav={p.key} aria-current={activo ? "page" : undefined} aria-label={nombreAccesible(p, nAlertas)} title={p.desc} onClick={() => onIr(p.key)}
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, background: activo ? "rgba(20,184,166,0.16)" : "transparent", border: "none", borderLeft: `3px solid ${activo ? C.teal : "transparent"}`, borderRadius: 8, padding: "9px 10px", marginBottom: 2, color: activo ? "#5EEAD4" : "#CBD5E1", fontSize: 14, fontWeight: activo ? 800 : 600, cursor: "pointer", textAlign: "left", minHeight: 40 }}>
                  <Ic n={p.icono} />
                  <span style={{ flex: 1 }}>{p.label}</span>
                  {p.key === "notif" && <Contador n={nAlertas} oscuro />}
                </button>
              );
            })}
          </div>
        ))}
      </nav>
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.12)", paddingTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ padding: "0 4px", fontSize: 13, lineHeight: 1.35 }}>
          <div style={{ fontWeight: 700, color: "#E2E8F0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{perfil?.nombre || "—"}</div>
          <div style={{ color: "#8B9AB5", fontSize: 12 }}>{esAdmin ? "Administrador" : "Usuario"}</div>
        </div>
        {esAdmin && onImprimir && (
          <button aria-label="Imprimir o guardar como PDF todas las pantallas" onClick={onImprimir} style={sec}><Ic n="printer" /> Imprimir / PDF</button>
        )}
        <button data-nav="salir" onClick={onSalir} style={sec}><Ic n="salir" /> Cerrar sesión</button>
      </div>
    </aside>
  );
}
