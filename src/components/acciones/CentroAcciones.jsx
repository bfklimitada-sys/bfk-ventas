import { useEffect, useMemo, useRef, useState } from "react";
import { C, MONO, R, SANS, btnP, fmt, iStyle } from "../../lib/theme";
import { Field, Modal } from "../ui/Basicos";
import { Badge } from "../ui/Sistema";
import { Ic } from "../ui/Iconos";
import { useEsEscritorio } from "../ui/Navegacion";
import { PRIORIDADES_SEGUIMIENTO } from "../../lib/seguimientos";
import {
  ORIGENES, ESTADOS_ACCION, vencida, venceHoy, tituloAccion, descripcionAccion, contadores, filtrarAcciones, filtrosActivos,
  categoriasActivas, ordenarCategorias, etiquetaCat, etiquetaPrioridadAcc, hoyLocal,
} from "../../lib/acciones";

// ═══════════════════════════════════════════════════════════════
// Centro de Acciones Pendientes (17/11/2026) · bandeja de trabajo de la pantalla principal.
// Muestra las acciones abiertas (con o sin OC) por prioridad y vencimiento; el detalle se despliega en la misma fila.
// Todo cambio pasa por la base (oc_seguimientos): autor, fechas, responsable, resolución e historial los fija ella.
// Resolver una acción NO cambia la OC (ni su entrega, factura, cobro o postventa).
// ═══════════════════════════════════════════════════════════════
const MAX_VISIBLES = 6;
const TONO = { alta: { c: C.dangerText, bg: C.dangerLight }, media: { c: C.warnText, bg: C.warnLight }, baja: { c: C.inkFaint, bg: C.relleno } };
const fecha = (d) => (d ? fmt.date(String(d).slice(0, 10)) : "—");
const btnS = (color = C.tealDark, extra = {}) => ({ background: C.card, border: `1px solid ${color}55`, color, borderRadius: R.sm, padding: "6px 10px", minHeight: 36, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: SANS, ...extra });
const selMini = { ...iStyle, width: "auto", maxWidth: "100%", minHeight: 36, padding: "5px 8px", fontSize: 13 };
const personasDe = (perfiles) => (perfiles || []).filter((p) => p && p.id && p.nombre).sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));

// ── Formulario «Nueva acción» ────────────────────────────────────
function FormNuevaAccion({ categorias, perfiles, ocs, onGuardar, onCancelar, ocInicial }) {
  const [f, setF] = useState({ titulo: "", descripcion: "", categoria: "", oc: ocInicial?.numero_oc || "", cliente: "", responsable_id: "", prioridad: "media", fecha_revision: "" });
  const [errores, setErrores] = useState([]); const [guardando, setGuardando] = useState(false); const enCurso = useRef(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const activas = useMemo(() => (ocs || []).filter((o) => !o.archivada), [ocs]);
  const ocElegida = useMemo(() => { const n = f.oc.trim().toUpperCase(); return n ? activas.find((o) => String(o.numero_oc || "").toUpperCase() === n) || null : null; }, [f.oc, activas]);
  const personas = personasDe(perfiles);
  const guardar = async () => {
    if (enCurso.current) return;
    const e = [];
    if (!f.titulo.trim()) e.push("Indica la acción requerida (título).");
    if (f.titulo.trim().length > 160) e.push("El título puede tener hasta 160 caracteres.");
    if (!f.descripcion.trim()) e.push("Describe el motivo de la acción.");
    if (!f.categoria) e.push("Elige la categoría.");
    if (f.oc.trim() && !ocElegida) e.push(`No existe una OC vigente con el número «${f.oc.trim()}». Déjalo vacío si la acción no tiene OC.`);
    if (e.length) { setErrores(e); return; }
    enCurso.current = true; setGuardando(true); setErrores([]);
    try {
      await onGuardar({ titulo: f.titulo.trim(), descripcion: f.descripcion.trim(), categoria: f.categoria, oc_id: ocElegida?.id || null,
        cliente: ocElegida ? null : f.cliente.trim() || null, responsable_id: f.responsable_id || null, prioridad: f.prioridad, fecha_revision: f.fecha_revision || null });
    } catch (err) { setErrores([`No se guardó: ${err.message}`]); enCurso.current = false; setGuardando(false); }
  };
  return (
    <div data-acc-form>
      <Field label="Acción requerida" required>
        <input data-acc-campo="titulo" style={iStyle} value={f.titulo} maxLength={160} onChange={(e) => set("titulo", e.target.value)} placeholder="ej: Coordinar retiro del producto con el proveedor" />
      </Field>
      <Field label="Descripción y motivo" required>
        <textarea data-acc-campo="descripcion" rows={3} style={{ ...iStyle, resize: "vertical" }} value={f.descripcion} onChange={(e) => set("descripcion", e.target.value)} placeholder="Qué falta hacer y por qué está pendiente" />
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: "0 10px" }}>
        <Field label="Categoría" required>
          <select data-acc-campo="categoria" style={iStyle} value={f.categoria} onChange={(e) => set("categoria", e.target.value)}>
            <option value="">Elegir…</option>
            {categoriasActivas(categorias).map((c) => <option key={c.id} value={c.id}>{c.etiqueta}</option>)}
          </select>
        </Field>
        <Field label="OC asociada (opcional)" hint={ocElegida ? `${ocElegida.cliente || ocElegida.entidad || ""}` : "Vacío = acción sin OC"}>
          <input data-acc-campo="oc" list="acc-lista-oc" style={{ ...iStyle, fontFamily: MONO }} value={f.oc} onChange={(e) => set("oc", e.target.value)} placeholder="N.º de OC" autoComplete="off" />
          <datalist id="acc-lista-oc">{activas.slice(0, 400).map((o) => <option key={o.id} value={o.numero_oc}>{o.cliente || o.entidad || ""}</option>)}</datalist>
        </Field>
        {!ocElegida && <Field label="Cliente (opcional)">
          <input data-acc-campo="cliente" style={iStyle} value={f.cliente} maxLength={160} onChange={(e) => set("cliente", e.target.value)} placeholder="Si corresponde" />
        </Field>}
        <Field label="Responsable">
          <select data-acc-campo="responsable" style={iStyle} value={f.responsable_id} onChange={(e) => set("responsable_id", e.target.value)}>
            <option value="">Sin asignar</option>
            {personas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </Field>
        <Field label="Prioridad">
          <select data-acc-campo="prioridad" style={iStyle} value={f.prioridad} onChange={(e) => set("prioridad", e.target.value)}>
            {PRIORIDADES_SEGUIMIENTO.map((p) => <option key={p.id} value={p.id}>{p.etiqueta}</option>)}
          </select>
        </Field>
        <Field label="Vencimiento (opcional)">
          <input data-acc-campo="vencimiento" type="date" style={iStyle} value={f.fecha_revision} onChange={(e) => set("fecha_revision", e.target.value)} />
        </Field>
      </div>
      <div style={{ fontSize: 12, color: C.inkFaint, margin: "-4px 0 12px" }}>Estado inicial: <b>Pendiente</b>. Quedan registrados quién la crea y cuándo.</div>
      {errores.length > 0 && <div data-acc-errores style={{ background: C.dangerLight, color: C.dangerText, borderRadius: R.sm, padding: "8px 12px", fontSize: 13, marginBottom: 10, fontWeight: 500 }}>{errores.map((x, i) => <div key={i}>• {x}</div>)}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button data-acc-guardar onClick={guardar} disabled={guardando} style={{ ...btnP(guardando ? C.inkFaint : C.teal), flex: 1 }}>{guardando ? "Guardando…" : "Crear acción"}</button>
        <button onClick={onCancelar} disabled={guardando} style={btnS(C.inkMuted, { minHeight: 44 })}>Cancelar</button>
      </div>
    </div>
  );
}

// ── Categorías (solo administradores) ─────────────────────────────
function GestionCategorias({ categorias, onGuardar }) {
  const [nueva, setNueva] = useState(""); const [error, setError] = useState(""); const [ocupado, setOcupado] = useState(false);
  const slug = (t) => String(t).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  const correr = async (fn) => { if (ocupado) return; setOcupado(true); setError(""); try { await fn(); } catch (e) { setError(e.message || String(e)); } finally { setOcupado(false); } };
  const agregar = () => {
    const et = nueva.trim(); let id = slug(et); if (!/^[a-z]/.test(id)) id = "c_" + id;
    if (!et || id.length < 2) { setError("Escribe el nombre de la categoría."); return; }
    if ((categorias || []).some((c) => c.id === id || c.etiqueta.toLowerCase() === et.toLowerCase())) { setError("Ya existe una categoría con ese nombre."); return; }
    const orden = Math.max(0, ...(categorias || []).map((c) => c.orden || 0)) + 10;
    correr(async () => { await onGuardar({ nuevo: true, id, etiqueta: et, orden }); setNueva(""); });
  };
  return (
    <div data-acc-categorias>
      <div style={{ fontSize: 12, color: C.inkMuted, marginBottom: 10 }}>Las categorías no se borran: al desactivar una, deja de ofrecerse para acciones nuevas y las que ya la usan no cambian.</div>
      {ordenarCategorias(categorias).map((c) => (
        <div key={c.id} data-acc-categoria={c.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderBottom: `1px solid ${C.border}` }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: 14, color: c.activa === false ? C.inkFaint : C.ink, textDecoration: c.activa === false ? "line-through" : "none" }}>{c.etiqueta}</span>
          <button disabled={ocupado} onClick={() => correr(() => onGuardar({ id: c.id, activa: c.activa === false }))} style={btnS(c.activa === false ? C.tealDark : C.inkMuted)}>{c.activa === false ? "Activar" : "Desactivar"}</button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <input data-acc-nueva-categoria style={{ ...iStyle, flex: 1 }} value={nueva} maxLength={60} onChange={(e) => setNueva(e.target.value)} placeholder="Nueva categoría" />
        <button disabled={ocupado} onClick={agregar} style={btnS()}>Agregar</button>
      </div>
      {error && <div style={{ color: C.dangerText, fontSize: 13, marginTop: 8 }}>{error}</div>}
    </div>
  );
}

// ── Historial (bitácora) de una acción ───────────────────────────
function Historial({ a }) {
  const items = (a.bitacora || []).slice().sort((x, y) => String(y.creadoEn || "").localeCompare(String(x.creadoEn || "")));
  const [todo, setTodo] = useState(false);
  if (!items.length) return <div style={{ fontSize: 12, color: C.inkFaint }}>Sin registros en el historial.</div>;
  const ver = todo ? items : items.slice(0, 4);
  const txt = (h) => { const t = String(h.accion || "").replace(/^(Seguimiento especial|Acción):?\s*/, ""); return t ? t[0].toUpperCase() + t.slice(1) : "Registro"; };
  return (
    <div data-acc-historial>
      {ver.map((h) => (
        <div key={h.id} style={{ fontSize: 12, color: C.inkMuted, padding: "3px 0", overflowWrap: "anywhere" }}>
          <b style={{ color: C.ink }}>{txt(h)}</b>
          {h.valor_anterior ? <> · {String(h.valor_anterior).slice(0, 160)} →</> : null}{h.valor_nuevo ? <> {String(h.valor_nuevo).slice(0, 220)}</> : null}
          <span style={{ color: C.inkFaint }}> · {h.usuario_nombre || "—"} · {fmt.datetime(h.creadoEn)}</span>
        </div>
      ))}
      {items.length > 4 && <button data-consulta onClick={() => setTodo((v) => !v)} style={{ background: "none", border: "none", padding: 0, color: C.tealDark, fontSize: 12, fontWeight: 600, cursor: "pointer", textDecoration: "underline" }}>{todo ? "Ver menos" : `Ver los ${items.length} registros`}</button>}
    </div>
  );
}

// ── Una acción (fila compacta + detalle desplegable) ─────────────
function FilaAccion({ a, categorias, perfiles, perfil, abiertaInicial, onActualizar, onEliminar, onAbrirOC, ultima, hoy }) {
  const [abierto, setAbierto] = useState(!!abiertaInicial);
  const [modo, setModo] = useState(null); // avance | resolver | reabrir
  const [texto, setTexto] = useState(""); const [error, setError] = useState(""); const [ocupado, setOcupado] = useState(false);
  const enCurso = useRef(false); const ref = useRef(null);
  useEffect(() => { if (abiertaInicial) { setAbierto(true); ref.current?.scrollIntoView?.({ block: "center" }); } }, [abiertaInicial]);
  const esAdmin = perfil?.rol === "admin"; const venc = vencida(a, hoy); const hoyV = venceHoy(a, hoy); const resuelta = a.estado === "resuelto";
  const tono = TONO[a.prioridad] || TONO.media; const personas = personasDe(perfiles);
  const correr = async (fn) => {
    if (enCurso.current) return; enCurso.current = true; setOcupado(true); setError("");
    try { await fn(); setModo(null); setTexto(""); } catch (e) { setError(e.message || String(e)); } finally { enCurso.current = false; setOcupado(false); }
  };
  const cambiar = (patch) => correr(() => onActualizar(a, patch));
  const confirmar = () => {
    const t = texto.trim();
    if (modo === "resolver") { if (!t) { setError("Para resolver, indica la solución aplicada."); return; } return correr(() => onActualizar(a, { estado: "resuelto", solucion: t })); }
    if (modo === "reabrir") { if (!t) { setError("Indica por qué se reabre."); return; } return correr(() => onActualizar(a, { estado: "pendiente" }, `Reabierta: ${t}`)); }
    if (!t) { setError("Escribe el comentario o avance."); return; }
    return correr(() => onActualizar(a, {}, t));
  };
  const meta = [
    etiquetaCat(categorias, a.categoria),
    a.numeroOC ? <span key="oc" style={{ fontFamily: MONO }}>OC {a.numeroOC}</span> : "Sin OC",
    a.clienteVista || null,
    a.responsable_nombre ? `Resp.: ${a.responsable_nombre}` : <span key="r" style={{ color: C.warnText }}>Sin responsable</span>,
  ].filter(Boolean);
  return (
    <div ref={ref} id={`acc-${a.id}`} data-acc-item={a.id} data-acc-estado={a.estado} data-acc-prioridad={a.prioridad} data-acc-vencida={venc ? "1" : undefined} data-acc-oc={a.numeroOC || ""}
      style={{ borderBottom: ultima ? "none" : `1px solid ${C.border}` }}>
      <button type="button" data-acc-fila onClick={() => setAbierto((v) => !v)} aria-expanded={abierto}
        style={{ width: "100%", display: "flex", alignItems: "stretch", gap: 10, padding: "9px 8px", background: abierto ? C.paper : "none", border: "none", textAlign: "left", cursor: "pointer", fontFamily: SANS }}>
        <span aria-hidden="true" style={{ width: 4, borderRadius: 4, background: resuelta ? C.ok : tono.c, flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: C.ink, lineHeight: 1.3, overflowWrap: "anywhere" }}>{tituloAccion(a)}</span>
            {venc && <span data-acc-chip-vencida><Badge tono="danger">Vencida</Badge></span>}
            {hoyV && <Badge tono="warn">Vence hoy</Badge>}
            {a.estado === "en_gestion" && <Badge tono="info">En gestión</Badge>}
            {resuelta && <Badge tono="ok">Resuelta</Badge>}
            {a.origen && <span title={ORIGENES[a.origen]}><Badge>Automática</Badge></span>}
          </span>
          <span style={{ display: "flex", flexWrap: "wrap", gap: "2px 8px", fontSize: 12, color: C.inkMuted, marginTop: 3 }}>
            {meta.map((m, i) => <span key={i} style={{ whiteSpace: "nowrap", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis" }}>{i > 0 && <span aria-hidden="true" style={{ color: C.inkFaint, marginRight: 6 }}>·</span>}{m}</span>)}
          </span>
        </span>
        <span style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", justifyContent: "center", gap: 2 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: tono.c }}>{etiquetaPrioridadAcc(a.prioridad)}</span>
          <span style={{ fontSize: 12, color: venc ? C.dangerText : C.inkFaint, fontWeight: venc ? 700 : 400, whiteSpace: "nowrap" }}>{resuelta ? `✓ ${fecha(a.resuelto_en)}` : a.fecha_revision ? `Vence ${fecha(a.fecha_revision)}` : "Sin vencimiento"}</span>
        </span>
      </button>
      {abierto && (
        <div data-acc-detalle style={{ padding: "4px 12px 12px 22px", background: C.paper }}>
          <div style={{ fontSize: 14, color: C.ink, whiteSpace: "pre-wrap", overflowWrap: "anywhere", marginBottom: 6 }}>{descripcionAccion(a)}</div>
          <div style={{ fontSize: 12, color: C.inkMuted, display: "flex", flexWrap: "wrap", gap: "2px 12px", marginBottom: 8 }}>
            <span>Estado: <b style={{ color: C.ink }}>{ESTADOS_ACCION[a.estado] || a.estado}</b></span>
            <span>Creada: {fmt.datetime(a.creado_en)} · {a.creado_por_nombre || "—"}</span>
            <span>Vencimiento: <b style={{ color: venc ? C.dangerText : C.ink }}>{fecha(a.fecha_revision)}</b></span>
            {a.origen && <span>{ORIGENES[a.origen]}</span>}
            {a.sobrecosto_estimado != null && <span>Sobrecosto estimado: <b>{fmt.money(a.sobrecosto_estimado)}</b> <i>(informativo)</i></span>}
          </div>
          {resuelta && <div data-acc-solucion style={{ fontSize: 13, background: C.okLight, color: C.okText, borderRadius: R.sm, padding: "6px 10px", marginBottom: 8, overflowWrap: "anywhere" }}>
            <b>Solución:</b> {a.solucion} <span style={{ color: C.inkMuted }}>· {a.resuelto_por_nombre || "—"} · {fmt.datetime(a.resuelto_en)}</span></div>}
          {a.origen === "postventa" && !resuelta && <div style={{ fontSize: 12, color: C.inkMuted, marginBottom: 8 }}>Se cierra sola al cerrar el incidente en la OC. Resolverla aquí no cierra el incidente.</div>}
          {a.origen === "entrega_fallida" && !resuelta && <div style={{ fontSize: 12, color: C.inkMuted, marginBottom: 8 }}>Se cierra sola al registrar la entrega de la OC.</div>}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginBottom: 8 }}>
            {!resuelta && <>
              <select data-acc-responsable aria-label="Responsable" disabled={ocupado} value={a.responsable_id || ""} onChange={(e) => cambiar({ responsable_id: e.target.value || null })} style={selMini}>
                <option value="">Sin responsable</option>
                {personas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
              <select data-acc-prioridad aria-label="Prioridad" disabled={ocupado} value={a.prioridad} onChange={(e) => cambiar({ prioridad: e.target.value })} style={selMini}>
                {PRIORIDADES_SEGUIMIENTO.map((p) => <option key={p.id} value={p.id}>Prioridad {p.etiqueta.toLowerCase()}</option>)}
              </select>
              <input data-acc-vencimiento aria-label="Vencimiento" type="date" disabled={ocupado} value={String(a.fecha_revision || "").slice(0, 10)} onChange={(e) => cambiar({ fecha_revision: e.target.value || null })} style={selMini} />
              {a.estado === "pendiente" && <button data-acc-en-gestion disabled={ocupado} onClick={() => cambiar({ estado: "en_gestion" })} style={btnS(C.info)}>En gestión</button>}
              {a.estado === "en_gestion" && <button data-acc-a-pendiente disabled={ocupado} onClick={() => cambiar({ estado: "pendiente" })} style={btnS(C.inkMuted)}>Volver a pendiente</button>}
              <button data-acc-resolver disabled={ocupado} onClick={() => { setModo(modo === "resolver" ? null : "resolver"); setTexto(""); setError(""); }} style={btnS(C.okText)}>Resolver</button>
            </>}
            {resuelta && <button data-acc-reabrir disabled={ocupado} onClick={() => { setModo(modo === "reabrir" ? null : "reabrir"); setTexto(""); setError(""); }} style={btnS(C.warnText)}>Reabrir</button>}
            <button data-acc-avance disabled={ocupado} onClick={() => { setModo(modo === "avance" ? null : "avance"); setTexto(""); setError(""); }} style={btnS()}>Comentario / avance</button>
            {a.oc_id && onAbrirOC && <button data-acc-abrir-oc onClick={() => onAbrirOC(a.oc_id)} style={btnS(C.inkMuted)}>Ver OC ›</button>}
            {esAdmin && <button data-acc-eliminar disabled={ocupado} onClick={() => { if (window.confirm("¿Eliminar esta acción? Solo corresponde si se registró por error; una acción resuelta debe conservarse.")) correr(() => onEliminar(a)); }} style={btnS(C.dangerText)}>Eliminar</button>}
          </div>
          {modo && (
            <div data-acc-modo={modo} style={{ marginBottom: 8 }}>
              <textarea data-acc-texto rows={2} style={{ ...iStyle, resize: "vertical" }} value={texto} onChange={(e) => setTexto(e.target.value)}
                placeholder={modo === "resolver" ? "Solución aplicada (obligatoria)" : modo === "reabrir" ? "Motivo de la reapertura (obligatorio)" : "Qué se hizo, con quién se habló…"} />
              {modo === "resolver" && a.oc_id && <div style={{ fontSize: 12, color: C.inkFaint, marginTop: 4 }}>Resolver la acción no cambia el estado comercial, de entrega, de factura ni de cobro de la OC.</div>}
              <button data-acc-confirmar disabled={ocupado} onClick={confirmar} style={{ ...btnP(ocupado ? C.inkFaint : modo === "resolver" ? C.ok : C.teal), marginTop: 6 }}>
                {ocupado ? "Guardando…" : modo === "resolver" ? "Marcar como resuelta" : modo === "reabrir" ? "Reabrir acción" : "Guardar comentario"}</button>
            </div>
          )}
          {error && <div data-acc-error style={{ background: C.dangerLight, color: C.dangerText, borderRadius: R.sm, padding: "6px 10px", fontSize: 13, marginBottom: 8, fontWeight: 500 }}>{error}</div>}
          <div style={{ fontSize: 12, fontWeight: 700, color: C.inkMuted, textTransform: "uppercase", letterSpacing: 0.5, margin: "6px 0 2px" }}>Historial</div>
          <Historial a={a} />
        </div>
      )}
    </div>
  );
}

// ── Centro de Acciones ───────────────────────────────────────────
export function CentroAcciones({ acciones, categorias, perfiles, perfil, ocs, foco, onFocoUsado, onCrear, onActualizar, onEliminar, onAbrirOC, onGuardarCategoria, onRecargar, recargando }) {
  const escritorio = useEsEscritorio();
  const [filtro, setFiltro] = useState({ vista: "abiertas", categoria: "", responsable: "", oc: "", texto: "" });
  const [verFiltros, setVerFiltros] = useState(false); const [verTodas, setVerTodas] = useState(false);
  const [creando, setCreando] = useState(false); const [verCategorias, setVerCategorias] = useState(false);
  const [focoLocal, setFocoLocal] = useState(null);
  const hoy = hoyLocal();
  const cont = useMemo(() => contadores(acciones, hoy), [acciones, hoy]);
  const lista = useMemo(() => filtrarAcciones(acciones, filtro, { yo: perfil?.id, hoy }), [acciones, filtro, perfil?.id, hoy]);
  // Llegada desde una alerta o un aviso: muestra y despliega esa acción (aunque esté filtrada o más abajo).
  useEffect(() => {
    if (!foco) return; const a = (acciones || []).find((x) => x.id === foco); if (!a) return;
    setFiltro({ vista: a.estado === "resuelto" ? "resueltas" : "abiertas", categoria: "", responsable: "", oc: "", texto: "" }); setVerTodas(true); setFocoLocal(foco); onFocoUsado?.();
  }, [foco, acciones]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k, v) => { setFiltro((f) => ({ ...f, [k]: v })); setVerTodas(false); };
  const nFiltros = filtrosActivos(filtro);
  const visibles = verTodas ? lista : lista.slice(0, MAX_VISIBLES);
  const personas = personasDe(perfiles);
  const contador = (k, etiqueta, n, tono) => {
    const act = filtro.vista === k || (k === "abiertas" && filtro.vista === "abiertas");
    return (
      <button key={k} type="button" data-acc-contador={k} data-n={n} aria-pressed={act} onClick={() => set("vista", act && k !== "abiertas" ? "abiertas" : k)}
        style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 1, padding: escritorio ? "8px 12px" : "7px 9px", minHeight: 52, borderRadius: R.sm,
          border: `1px solid ${act ? C.teal : C.border}`, background: act ? C.tealLight : C.card, cursor: "pointer", fontFamily: SANS, textAlign: "left" }}>
        <span style={{ fontSize: escritorio ? 20 : 18, fontWeight: 700, lineHeight: 1.1, color: n > 0 ? tono : C.inkFaint }}>{n}</span>
        <span style={{ fontSize: 12, color: C.inkMuted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>{etiqueta}</span>
      </button>
    );
  };
  const tituloVista = { abiertas: "Abiertas", urgentes: "Urgentes (prioridad alta)", vencidas: "Vencidas", en_gestion: "En gestión", pendiente: "Pendientes (sin gestionar)", resueltas: "Resueltas (consulta)" }[filtro.vista];
  return (
    <section data-centro-acciones style={{ marginBottom: 18, fontFamily: SANS }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8, paddingLeft: 2 }}>
        <h2 style={{ margin: 0, fontSize: 12, fontWeight: 700, color: C.inkMuted, textTransform: "uppercase", letterSpacing: 0.6 }}>Acciones pendientes</h2>
        <span style={{ display: "flex", gap: 6 }}>
          {onRecargar && <button data-acc-recargar onClick={onRecargar} disabled={recargando} aria-label="Actualizar acciones" title="Actualizar" style={btnS(C.inkMuted, { width: 36, padding: 0 })}>{recargando ? "⋯" : "↻"}</button>}
          <button data-acc-nueva onClick={() => setCreando(true)} style={btnS(C.tealDark, { background: C.tealLight, borderColor: C.teal })}>+ Nueva acción</button>
        </span>
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        {contador("abiertas", "Pendientes", cont.pendientes, C.ink)}
        {contador("urgentes", "Urgentes", cont.urgentes, C.dangerText)}
        {contador("vencidas", "Vencidas", cont.vencidas, C.dangerText)}
        {contador("en_gestion", "En gestión", cont.enGestion, C.info)}
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
        <input data-acc-buscar type="search" value={filtro.texto} onChange={(e) => set("texto", e.target.value)} placeholder={escritorio ? "Buscar por OC, cliente o descripción" : "Buscar OC, cliente o texto"} aria-label="Buscar por número de OC, cliente o descripción"
          style={{ ...iStyle, flex: 1, minHeight: 40, fontSize: escritorio ? 14 : 16 }} />
        <button data-acc-ver-filtros onClick={() => setVerFiltros((v) => !v)} aria-expanded={verFiltros} style={btnS(nFiltros ? C.tealDark : C.inkMuted, { minHeight: 40, flexShrink: 0 })}>Filtros{nFiltros ? ` · ${nFiltros}` : ""}</button>
      </div>
      {verFiltros && (
        <div data-acc-filtros style={{ display: "grid", gridTemplateColumns: escritorio ? "repeat(4,minmax(0,1fr))" : "repeat(2,minmax(0,1fr))", gap: 6, marginBottom: 8 }}>
          <select data-acc-filtro="categoria" aria-label="Categoría" value={filtro.categoria} onChange={(e) => set("categoria", e.target.value)} style={{ ...selMini, width: "100%" }}>
            <option value="">Todas las categorías</option>
            {ordenarCategorias(categorias).map((c) => <option key={c.id} value={c.id}>{c.etiqueta}</option>)}
          </select>
          <select data-acc-filtro="estado" aria-label="Estado" value={filtro.vista} onChange={(e) => set("vista", e.target.value)} style={{ ...selMini, width: "100%" }}>
            <option value="abiertas">Abiertas</option><option value="pendiente">Pendientes</option><option value="en_gestion">En gestión</option>
            <option value="urgentes">Urgentes</option><option value="vencidas">Vencidas</option><option value="resueltas">Resueltas (consulta)</option>
          </select>
          <select data-acc-filtro="responsable" aria-label="Responsable" value={filtro.responsable} onChange={(e) => set("responsable", e.target.value)} style={{ ...selMini, width: "100%" }}>
            <option value="">Todos los responsables</option><option value="yo">Mis acciones</option><option value="sin">Sin responsable</option>
            {personas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
          <select data-acc-filtro="oc" aria-label="OC" value={filtro.oc} onChange={(e) => set("oc", e.target.value)} style={{ ...selMini, width: "100%" }}>
            <option value="">Con y sin OC</option><option value="con">Asociadas a una OC</option><option value="sin">Sin OC</option>
          </select>
          {(nFiltros > 0 || filtro.vista !== "abiertas") && <button data-acc-limpiar onClick={() => setFiltro((f) => ({ ...f, vista: "abiertas", categoria: "", responsable: "", oc: "" }))} style={btnS(C.inkMuted)}>Quitar filtros</button>}
          {perfil?.rol === "admin" && onGuardarCategoria && <button data-acc-abrir-categorias onClick={() => setVerCategorias(true)} style={btnS(C.inkMuted)}>Categorías…</button>}
        </div>
      )}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: R.md, overflow: "hidden" }}>
        {filtro.vista !== "abiertas" && <div data-acc-vista style={{ fontSize: 12, color: C.inkMuted, padding: "6px 10px", borderBottom: `1px solid ${C.border}`, background: C.paper }}>Mostrando: <b>{tituloVista}</b> · {lista.length}</div>}
        {lista.length === 0 && <div data-acc-vacio style={{ fontSize: 14, color: filtro.vista === "abiertas" && !filtro.texto && !nFiltros ? C.okText : C.inkMuted, fontWeight: 600, padding: "14px 12px" }}>
          {filtro.vista === "abiertas" && !filtro.texto && !nFiltros ? "✓ Sin acciones pendientes" : "Ninguna acción coincide con la búsqueda o los filtros"}</div>}
        {visibles.map((a, i) => (
          <FilaAccion key={a.id} a={a} hoy={hoy} categorias={categorias} perfiles={perfiles} perfil={perfil} abiertaInicial={focoLocal === a.id}
            ultima={i === visibles.length - 1 && lista.length <= visibles.length} onActualizar={onActualizar} onEliminar={onEliminar} onAbrirOC={onAbrirOC} />
        ))}
        {lista.length > MAX_VISIBLES && (
          <button data-acc-ver-todas onClick={() => setVerTodas((v) => !v)} style={{ width: "100%", minHeight: 40, background: "none", border: "none", borderTop: `1px solid ${C.border}`, color: C.tealDark, fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: SANS }}>
            {verTodas ? "Ver menos" : `Ver todas (${lista.length})`}</button>
        )}
      </div>
      {filtro.vista === "abiertas" && cont.resueltas > 0 && (
        <button data-acc-ver-resueltas onClick={() => set("vista", "resueltas")} style={{ background: "none", border: "none", padding: "6px 2px 0", color: C.tealDark, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: SANS }}>
          <Ic n="chevR" /> Consultar {cont.resueltas} resuelta{cont.resueltas > 1 ? "s" : ""}</button>
      )}
      {creando && (
        <Modal title="Nueva acción" onClose={() => setCreando(false)}>
          <FormNuevaAccion categorias={categorias} perfiles={perfiles} ocs={ocs} onCancelar={() => setCreando(false)}
            onGuardar={async (d) => { await onCrear(d); setCreando(false); }} />
        </Modal>
      )}
      {verCategorias && (
        <Modal title="Categorías de acciones" onClose={() => setVerCategorias(false)}>
          <GestionCategorias categorias={categorias} onGuardar={onGuardarCategoria} />
        </Modal>
      )}
    </section>
  );
}
