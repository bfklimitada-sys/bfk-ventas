import { useRef, useState } from "react";
import { Field } from "../ui/Basicos";
import { Ic } from "../ui/Iconos";
import { C, btnP, fmt, iStyle } from "../../lib/theme";
import {
  CATEGORIAS_SEGUIMIENTO, PRIORIDADES_SEGUIMIENTO, etiquetaCategoria, etiquetaPrioridad, etiquetaEstado,
  seguimientosAbiertos, seguimientosResueltos, revisionVencida,
} from "../../lib/seguimientos";

// «Seguimiento especial» de una OC (15/10/2026).
// La base (oc_seguimientos) fija autor y fechas, exige la solución para resolver y conserva lo resuelto;
// esta sección solo ofrece los formularios. El sobrecosto estimado es SOLO informativo: no se suma a costos,
// compras, utilidad ni deudas.
export const TONO_PRIORIDAD = {
  alta: { color: C.dangerText, bg: C.dangerLight },
  media: { color: C.warnText, bg: C.warnLight },
  baja: { color: C.inkMuted, bg: C.paper },
};
const fecha = (d) => (d ? fmt.date(String(d).slice(0, 10)) : "—");
const chip = (t, tono, extra = {}) => (
  <span style={{ fontSize: 12, fontWeight: 800, padding: "2px 8px", borderRadius: 999, background: tono.bg, color: tono.color, border: `1px solid ${tono.color}33`, whiteSpace: "nowrap", ...extra }}>{t}</span>
);
const btnS = (color = C.tealDark) => ({ background: C.card, border: `1px solid ${color}55`, color, borderRadius: 8, padding: "7px 10px", minHeight: 36, fontSize: 13, fontWeight: 700, cursor: "pointer" });
const VACIO = { categoria: "", descripcion: "", prioridad: "media", responsable_id: "", fecha_revision: "", sobrecosto_estimado: "", estado: "pendiente" };

function Formulario({ perfiles, onGuardar, onCancelar }) {
  const [f, setF] = useState(VACIO); const [errores, setErrores] = useState([]); const [guardando, setGuardando] = useState(false);
  const enCurso = useRef(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const guardar = async () => {
    if (enCurso.current) return;
    const errs = [];
    if (!f.categoria) errs.push("Elige la categoría.");
    if (!f.descripcion.trim()) errs.push("Describe el seguimiento.");
    if (f.sobrecosto_estimado !== "" && (!(Number(f.sobrecosto_estimado) >= 0) || !Number.isFinite(Number(f.sobrecosto_estimado)))) errs.push("El sobrecosto estimado debe ser un monto igual o mayor a 0.");
    if (errs.length) { setErrores(errs); return; }
    enCurso.current = true; setGuardando(true); setErrores([]);
    const resp = perfiles.find((p) => p.id === f.responsable_id);
    try { await onGuardar({ ...f, responsable_id: resp?.id || null, responsable_nombre: resp?.nombre || null }); }
    catch (e) { setErrores([`No se guardó: ${e.message}`]); enCurso.current = false; setGuardando(false); }
  };
  return (
    <div data-seg-form style={{ background: C.paper, border: `1px solid ${C.border}`, borderRadius: 12, padding: "10px 12px", marginBottom: 12 }}>
      <Field label="Categoría" required>
        <select data-seg="categoria" style={iStyle} value={f.categoria} onChange={(e) => set("categoria", e.target.value)}>
          <option value="">Elegir…</option>
          {CATEGORIAS_SEGUIMIENTO.map((c) => <option key={c.id} value={c.id}>{c.etiqueta}</option>)}
        </select>
      </Field>
      <Field label="Descripción" required>
        <textarea data-seg="descripcion" rows={3} style={{ ...iStyle, resize: "vertical" }} value={f.descripcion} onChange={(e) => set("descripcion", e.target.value)} placeholder="ej: el proveedor cobra un despacho adicional; revisar con el cliente" />
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 8 }}>
        <Field label="Prioridad">
          <select data-seg="prioridad" style={iStyle} value={f.prioridad} onChange={(e) => set("prioridad", e.target.value)}>
            {PRIORIDADES_SEGUIMIENTO.map((p) => <option key={p.id} value={p.id}>{p.etiqueta}</option>)}
          </select>
        </Field>
        <Field label="Responsable">
          <select data-seg="responsable" style={iStyle} value={f.responsable_id} onChange={(e) => set("responsable_id", e.target.value)}>
            <option value="">Sin asignar</option>
            {perfiles.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </Field>
        <Field label="Estado inicial">
          <select data-seg="estado" style={iStyle} value={f.estado} onChange={(e) => set("estado", e.target.value)}>
            <option value="pendiente">Pendiente</option><option value="en_gestion">En gestión</option>
          </select>
        </Field>
        <Field label="Fecha de revisión (opcional)">
          <input data-seg="fecha_revision" type="date" style={iStyle} value={f.fecha_revision} onChange={(e) => set("fecha_revision", e.target.value)} />
        </Field>
      </div>
      <Field label="Sobrecosto estimado (opcional)" hint="Solo informativo: no se suma a costos, compras, utilidad ni deudas.">
        <input data-seg="sobrecosto" type="number" min="0" step="1" inputMode="numeric" style={iStyle} value={f.sobrecosto_estimado} onChange={(e) => set("sobrecosto_estimado", e.target.value)} placeholder="$" />
      </Field>
      {errores.length > 0 && <div data-seg-errores style={{ background: C.dangerLight, color: C.dangerText, borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 10, fontWeight: 600 }}>{errores.map((e, i) => <div key={i}>• {e}</div>)}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button data-seg-guardar onClick={guardar} disabled={guardando} style={{ ...btnP(guardando ? C.inkFaint : C.teal), flex: 1 }}>{guardando ? "Guardando…" : "✓ Registrar seguimiento"}</button>
        <button onClick={onCancelar} disabled={guardando} style={{ ...btnS(C.inkMuted), flex: "0 0 auto" }}>Cancelar</button>
      </div>
    </div>
  );
}

function Bitacora({ s }) {
  const items = (s.bitacora || []).slice().sort((a, b) => String(b.creadoEn || "").localeCompare(String(a.creadoEn || "")));
  const [todo, setTodo] = useState(false);
  if (!items.length) return null;
  const ver = todo ? items : items.slice(0, 3);
  return (
    <div data-seg-bitacora style={{ marginTop: 8, borderTop: `1px dashed ${C.border}`, paddingTop: 6 }}>
      {ver.map((h) => (
        <div key={h.id} style={{ fontSize: 12, color: C.inkMuted, padding: "2px 0" }}>
          <b style={{ color: C.ink }}>{h.accion.replace(/^Seguimiento especial:?\s*/, "") || "registro"}</b>
          {h.valor_anterior ? <> · {h.valor_anterior} →</> : null}{h.valor_nuevo ? <> {h.valor_nuevo}</> : null}
          <span style={{ color: C.inkFaint }}> · {h.usuario_nombre || "—"} · {fmt.datetime(h.creadoEn)}</span>
        </div>
      ))}
      {items.length > 3 && <button data-consulta onClick={() => setTodo((v) => !v)} style={{ background: "none", border: "none", padding: 0, color: C.tealDark, fontSize: 12, fontWeight: 700, cursor: "pointer", textDecoration: "underline" }}>{todo ? "Ver menos" : `Ver los ${items.length} registros`}</button>}
    </div>
  );
}

function Item({ s, perfiles, perfil, soloLectura, onActualizar, onEliminar }) {
  const [modo, setModo] = useState(null); // null | "avance" | "resolver"
  const [texto, setTexto] = useState(""); const [error, setError] = useState(""); const [ocupado, setOcupado] = useState(false);
  const enCurso = useRef(false);
  const vencida = revisionVencida(s);
  const esAdmin = perfil?.rol === "admin";
  const correr = async (fn) => {
    if (enCurso.current) return;
    enCurso.current = true; setOcupado(true); setError("");
    try { await fn(); setModo(null); setTexto(""); } catch (e) { setError(e.message || String(e)); }
    finally { enCurso.current = false; setOcupado(false); }
  };
  const cambiar = (patch) => correr(() => onActualizar(s, patch));
  const confirmar = () => {
    if (modo === "resolver") {
      if (!texto.trim()) { setError("Para resolver el seguimiento indica la solución aplicada."); return; }
      return correr(() => onActualizar(s, { estado: "resuelto", solucion: texto.trim() }));
    }
    if (!texto.trim()) { setError("Escribe el avance."); return; }
    return correr(() => onActualizar(s, {}, texto.trim()));
  };
  const tono = TONO_PRIORIDAD[s.prioridad] || TONO_PRIORIDAD.media;
  return (
    <div data-seg-item={s.id} data-estado={s.estado} data-prioridad={s.prioridad} data-atrasado={vencida ? "1" : undefined}
      style={{ background: C.card, border: `1px solid ${vencida || s.prioridad === "alta" ? C.danger + "66" : C.border}`, borderLeft: `4px solid ${tono.color}`, borderRadius: 10, padding: "9px 11px", marginBottom: 8 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center", marginBottom: 5 }}>
        {chip(`Prioridad ${etiquetaPrioridad(s.prioridad).toLowerCase()}`, tono)}
        {chip(etiquetaEstado(s.estado), s.estado === "en_gestion" ? { color: C.info, bg: C.infoLight } : { color: C.inkMuted, bg: C.paper })}
        <span style={{ fontSize: 12, fontWeight: 700, color: C.inkMuted }}>{etiquetaCategoria(s.categoria)}</span>
        {vencida && <span data-seg-atrasado>{chip("⏰ Seguimiento atrasado", { color: C.dangerText, bg: C.dangerLight })}</span>}
      </div>
      <div style={{ fontSize: 14, color: C.ink, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{s.descripcion}</div>
      <div style={{ fontSize: 12, color: C.inkMuted, marginTop: 5, display: "flex", flexWrap: "wrap", columnGap: 10, rowGap: 2 }}>
        <span>Responsable: <b style={{ color: s.responsable_nombre ? C.ink : C.warnText }}>{s.responsable_nombre || "sin asignar"}</b></span>
        <span>Revisión: <b style={{ color: vencida ? C.dangerText : C.ink }}>{fecha(s.fecha_revision)}</b></span>
        {s.sobrecosto_estimado != null && <span data-seg-sobrecosto>Sobrecosto estimado: <b>{fmt.money(s.sobrecosto_estimado)}</b> <i>(informativo)</i></span>}
        <span style={{ color: C.inkFaint }}>Registrado por {s.creado_por_nombre || "—"} · {fmt.datetime(s.creado_en)}</span>
      </div>
      <Bitacora s={s} />
      {!soloLectura && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8, alignItems: "center" }}>
          <select data-seg-prioridad aria-label="Prioridad" disabled={ocupado} value={s.prioridad} onChange={(e) => cambiar({ prioridad: e.target.value })} style={{ ...iStyle, width: "auto", minHeight: 36, padding: "5px 8px", fontSize: 13 }}>
            {PRIORIDADES_SEGUIMIENTO.map((p) => <option key={p.id} value={p.id}>Prioridad {p.etiqueta.toLowerCase()}</option>)}
          </select>
          <select data-seg-responsable aria-label="Responsable" disabled={ocupado} value={s.responsable_id || ""} onChange={(e) => { const p = perfiles.find((x) => x.id === e.target.value); cambiar({ responsable_id: p?.id || null, responsable_nombre: p?.nombre || null }); }} style={{ ...iStyle, width: "auto", maxWidth: "100%", minHeight: 36, padding: "5px 8px", fontSize: 13 }}>
            <option value="">Sin responsable</option>
            {perfiles.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
          <input data-seg-revision aria-label="Fecha de revisión" type="date" disabled={ocupado} value={String(s.fecha_revision || "").slice(0, 10)} onChange={(e) => cambiar({ fecha_revision: e.target.value || null })} style={{ ...iStyle, width: "auto", minHeight: 36, padding: "5px 8px", fontSize: 13 }} />
          {s.estado === "pendiente" && <button data-seg-en-gestion disabled={ocupado} onClick={() => cambiar({ estado: "en_gestion" })} style={btnS(C.info)}>Pasar a En gestión</button>}
          <button data-seg-avance-abrir disabled={ocupado} onClick={() => { setModo(modo === "avance" ? null : "avance"); setTexto(""); setError(""); }} style={btnS()}>Registrar avance</button>
          <button data-seg-resolver-abrir disabled={ocupado} onClick={() => { setModo(modo === "resolver" ? null : "resolver"); setTexto(""); setError(""); }} style={btnS(C.okText)}>Resolver</button>
          {esAdmin && <button data-seg-eliminar disabled={ocupado} onClick={() => { if (window.confirm("¿Eliminar este seguimiento? Solo corresponde si se registró por error; un seguimiento resuelto debe conservarse.")) correr(() => onEliminar(s)); }} style={btnS(C.dangerText)}>Eliminar</button>}
        </div>
      )}
      {modo && !soloLectura && (
        <div data-seg-modo={modo} style={{ marginTop: 8 }}>
          <textarea data-seg={modo === "resolver" ? "solucion" : "avance"} rows={2} style={{ ...iStyle, resize: "vertical" }} value={texto} onChange={(e) => setTexto(e.target.value)}
            placeholder={modo === "resolver" ? "Solución aplicada (obligatoria)" : "Avance: qué se hizo, con quién se habló…"} />
          <button data-seg-confirmar disabled={ocupado} onClick={confirmar} style={{ ...btnP(ocupado ? C.inkFaint : modo === "resolver" ? C.ok : C.teal), marginTop: 6 }}>
            {ocupado ? "Guardando…" : modo === "resolver" ? "✓ Marcar como resuelto" : "✓ Guardar avance"}</button>
        </div>
      )}
      {error && <div data-seg-error style={{ background: C.dangerLight, color: C.dangerText, borderRadius: 8, padding: "6px 10px", fontSize: 13, marginTop: 6, fontWeight: 600 }}>{error}</div>}
    </div>
  );
}

export function SeguimientoEspecial({ oc, perfil, perfiles, soloLectura, onCrear, onActualizar, onEliminar }) {
  const [creando, setCreando] = useState(false); const [verResueltos, setVerResueltos] = useState(false);
  const abiertos = seguimientosAbiertos(oc); const resueltos = seguimientosResueltos(oc);
  const personas = (perfiles || []).filter((p) => p && p.id && p.nombre).sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
  const puede = !soloLectura && !!onCrear;
  return (
    <div data-seguimiento-especial>
      <div style={{ fontSize: 12, color: C.inkMuted, marginBottom: 8 }}>
        Casos que requieren atención especial (garantías, sobrecostos, proveedor, cliente…). El sobrecosto estimado es <b>solo informativo</b>: no modifica costos, utilidad, compras ni deudas.
      </div>
      {puede && !creando && <button data-seg-agregar onClick={() => setCreando(true)} style={{ ...btnS(), width: "100%", marginBottom: 10 }}>+ Agregar seguimiento</button>}
      {puede && creando && <Formulario perfiles={personas} onCancelar={() => setCreando(false)} onGuardar={async (d) => { await onCrear(oc.id, d); setCreando(false); }} />}
      {soloLectura && <div style={{ fontSize: 12, color: C.inkFaint, marginBottom: 8 }}><Ic n="🔒" /> Solo lectura mientras otro usuario edita esta OC.</div>}
      {abiertos.length === 0 && <div data-seg-sin-abiertos style={{ fontSize: 13, color: C.inkFaint, padding: "4px 0 8px" }}>Sin seguimientos abiertos.</div>}
      {abiertos.map((s) => (
        <Item key={s.id} s={s} perfiles={personas} perfil={perfil} soloLectura={soloLectura}
          onActualizar={(seg, patch, avance) => onActualizar(oc.id, seg, patch, avance)} onEliminar={(seg) => onEliminar(oc.id, seg)} />
      ))}
      {resueltos.length > 0 && (
        <div data-seg-resueltos style={{ marginTop: 6 }}>
          <button data-consulta data-seg-ver-resueltos onClick={() => setVerResueltos((v) => !v)} style={{ background: "none", border: "none", padding: "4px 0", color: C.tealDark, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
            {verResueltos ? "▾" : "▸"} Historial: {resueltos.length} seguimiento{resueltos.length > 1 ? "s" : ""} resuelto{resueltos.length > 1 ? "s" : ""}</button>
          {verResueltos && resueltos.map((s) => (
            <div key={s.id} data-seg-resuelto={s.id} style={{ background: C.paper, border: `1px solid ${C.border}`, borderRadius: 10, padding: "8px 11px", marginTop: 6, fontSize: 13 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center", marginBottom: 3 }}>
                {chip("✓ Resuelto", { color: C.okText, bg: C.okLight })}
                <span style={{ fontSize: 12, fontWeight: 700, color: C.inkMuted }}>{etiquetaCategoria(s.categoria)} · prioridad {etiquetaPrioridad(s.prioridad).toLowerCase()}</span>
              </div>
              <div style={{ color: C.ink, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{s.descripcion}</div>
              <div data-seg-solucion style={{ marginTop: 4, color: C.okText, overflowWrap: "anywhere" }}><b>Solución:</b> {s.solucion}</div>
              <div style={{ fontSize: 12, color: C.inkFaint, marginTop: 3 }}>
                Resuelto por {s.resuelto_por_nombre || "—"} · {fmt.datetime(s.resuelto_en)} · registrado por {s.creado_por_nombre || "—"} el {fmt.datetime(s.creado_en)}
                {s.sobrecosto_estimado != null ? ` · sobrecosto estimado ${fmt.money(s.sobrecosto_estimado)} (informativo)` : ""}
              </div>
              <Bitacora s={s} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
