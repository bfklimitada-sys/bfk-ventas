// Correos del buzón de BFK como notificaciones (Fase Correos). Solo presentación: los datos y la acción
// de marcar vienen de App. Marcar "gestionado" solo cambia el estado en BFK; el correo en Gmail no se toca.
import { useState } from "react";
import { C, MONO, R, TOUCH, fmt } from "../../lib/theme";
import { Badge } from "./Sistema";
import { Ic } from "./Iconos";
import { ASOCIACION_TEXTO, NIVEL_PRIORIDAD, categoriaCorreo, esPendiente, filtrarCorreos, ordenarCorreos } from "../../lib/correosBfk";

const tonoPrioridad = (p) => (p >= 3 ? "danger" : p === 2 ? "warn" : p === 1 ? "info" : "neutro");
const colorPrioridad = (p) => (p >= 3 ? C.danger : p === 2 ? C.warn : p === 1 ? C.info : C.border);

export function TarjetaCorreo({ correo: c, oc, onMarcar, onAbrirOC, mostrarOC = true }) {
  const [ocupado, setOcupado] = useState(false);
  const pendiente = esPendiente(c);
  const cat = categoriaCorreo(c.categoria);
  const marcar = async () => {
    if (!onMarcar || ocupado) return;
    setOcupado(true);
    try { await onMarcar(c.id, pendiente ? "gestionado" : "pendiente"); } finally { setOcupado(false); }
  };
  return (
    <div data-correo={c.id} data-correo-estado={c.estado} data-correo-oc={c.oc_id || ""}
      style={{ background: pendiente ? C.card : C.paper, border: `1px solid ${C.border}`, borderLeft: `4px solid ${pendiente ? colorPrioridad(Number(c.prioridad)) : C.border}`,
        borderRadius: R.md, padding: "10px 12px", marginBottom: 7, opacity: pendiente ? 1 : 0.8 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 4 }}>
        <Badge tono={pendiente ? tonoPrioridad(Number(c.prioridad)) : "neutro"}><Ic n={cat.icono} /> {cat.etiqueta}</Badge>
        {pendiente && Number(c.prioridad) >= 2 && <Badge tono={tonoPrioridad(Number(c.prioridad))}>{NIVEL_PRIORIDAD[c.prioridad]}</Badge>}
        {!pendiente && <Badge tono="ok">✓ Gestionado</Badge>}
        <span style={{ marginLeft: "auto", fontSize: 12, color: C.inkFaint, whiteSpace: "nowrap" }}>{fmt.datetime(c.fecha)}</span>
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, wordBreak: "break-word" }}>{c.asunto || "(sin asunto)"}</div>
      <div style={{ fontSize: 12, color: C.inkMuted, marginTop: 2, wordBreak: "break-all" }}>
        {c.remitente_nombre ? `${c.remitente_nombre} · ` : ""}{c.remitente_correo || "—"}
      </div>
      {c.resumen && <div style={{ fontSize: 12.5, color: C.ink, marginTop: 5, lineHeight: 1.45, wordBreak: "break-word" }}>{c.resumen}</div>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
        {mostrarOC && (c.oc_id && !oc
          ? <span style={{ fontSize: 12, color: C.inkFaint }}>Asociado a una OC archivada</span>
          : c.oc_id
          ? <button data-correo-abrir-oc onClick={() => onAbrirOC && onAbrirOC(c.oc_id)} title={c.evidencia || ""}
              style={{ border: `1px solid ${C.tealDark}`, background: C.tealLight, color: C.tealDark, borderRadius: R.sm, padding: "6px 10px", fontSize: 12, fontWeight: 800, cursor: "pointer", minHeight: 36, fontFamily: MONO }}>
              OC {oc?.numero_oc || "—"} ›
            </button>
          : <span style={{ fontSize: 12, color: C.inkFaint }}>{c.rut_detectado ? `General · cliente RUT ${c.rut_detectado}, sin OC única` : "General · sin OC asociada"}</span>)}
        {c.oc_id && <span style={{ fontSize: 12, color: C.inkFaint }}>{ASOCIACION_TEXTO[c.asociacion] || ""}</span>}
        <button data-correo-marcar onClick={marcar} disabled={ocupado}
          style={{ marginLeft: "auto", border: `1px solid ${C.border}`, background: C.card, color: pendiente ? C.okText : C.inkMuted, borderRadius: R.sm,
            padding: "6px 12px", fontSize: 12, fontWeight: 800, cursor: ocupado ? "wait" : "pointer", minHeight: 36 }}>
          {ocupado ? "Guardando…" : pendiente ? "✓ Marcar gestionado" : "Reabrir"}
        </button>
      </div>
      {!pendiente && c.gestionado_por_nombre && <div style={{ fontSize: 12, color: C.inkFaint, marginTop: 4 }}>Gestionado por {c.gestionado_por_nombre} · {fmt.datetime(c.gestionado_en)}</div>}
    </div>
  );
}

// Sección "Correos pendientes" de la pantalla Alertas.
export function CorreosPendientes({ correos, ocs, onMarcar, onAbrirOC }) {
  const [filtro, setFiltro] = useState("todos");
  const [verGestionados, setVerGestionados] = useState(false);
  const todos = ordenarCorreos(correos || []);
  const pendientes = todos.filter(esPendiente);
  const base = verGestionados ? todos.filter((c) => !esPendiente(c)) : pendientes;
  const lista = filtrarCorreos(base, filtro);
  const porId = new Map((ocs || []).map((o) => [o.id, o]));
  const n = { todos: base.length, oc: base.filter((c) => c.oc_id).length, general: base.filter((c) => !c.oc_id).length };
  const chip = (id, label) => (
    <button key={id} data-correos-filtro={id} onClick={() => setFiltro(id)}
      style={{ fontSize: 12, fontWeight: 700, padding: "5px 10px", borderRadius: 8, cursor: "pointer", minHeight: 32,
        border: `1.5px solid ${filtro === id ? C.teal : C.border}`, background: filtro === id ? C.paper : C.card, color: filtro === id ? C.tealDark : C.inkMuted }}>
      {label} {n[id]}
    </button>
  );
  return (
    <section data-correos-pendientes={pendientes.length} style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 14, color: C.ink }}><Ic n="📩" /> Correos de BFK</div>
          <div style={{ fontSize: 12, color: C.inkFaint, marginTop: 2 }}>
            {pendientes.length === 0 ? "Sin correos pendientes de gestión" : `${pendientes.length} pendiente${pendientes.length > 1 ? "s" : ""} de gestión · los urgentes primero`}
          </div>
        </div>
        <button data-correos-ver-gestionados onClick={() => setVerGestionados((v) => !v)}
          style={{ fontSize: 12, color: C.tealDark, background: "none", border: "none", cursor: "pointer", fontWeight: 700, minHeight: TOUCH, whiteSpace: "nowrap" }}>
          {verGestionados ? "Ver pendientes" : "Ver gestionados"}
        </button>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {chip("todos", "Todos")}{chip("oc", "Con OC")}{chip("general", "Generales")}
      </div>
      {lista.length === 0
        ? <div style={{ fontSize: 12.5, color: C.inkFaint, padding: "10px 0" }}>{verGestionados ? "Ningún correo gestionado en los últimos 30 días." : "✓ Nada pendiente aquí."}</div>
        : lista.map((c) => <TarjetaCorreo key={c.id} correo={c} oc={porId.get(c.oc_id)} onMarcar={onMarcar} onAbrirOC={onAbrirOC} />)}
      <div style={{ fontSize: 12, color: C.inkFaint, lineHeight: 1.5 }}>
        Se revisa el buzón de BFK cada hora (solo lectura: BFK no marca, mueve, borra ni responde correos). Un correo se asocia a una OC solo con evidencia inequívoca; si no la hay, queda como general.
      </div>
    </section>
  );
}
