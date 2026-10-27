// Proyectos Industriales — hitos (contractuales, de pago, de entrega, internos) y entregables.
// La base: un hito con fecha real queda cumplido; un entregable emitido o aprobado registra su fecha de entrega;
// código de entregable único por proyecto; fechas reales no futuras; eliminar solo administrador y sin dependencias.
import { useEffect, useState } from "react";
import { C, MONO, R, S, T, cardStyle } from "../../lib/theme";
import { Badge, Seccion } from "../ui/Sistema";
import { Ventana, Campo, Rejilla, Entrada, Area, Selector, ErrorForm, Vacio, PedirMotivo, estiloBoton } from "./Comunes";
import { TIPOS_HITO, TIPOS_ENTREGABLE, ESTADOS_ENTREGABLE, ESPECIALIDADES_CONTENIDO, ENTREGABLE_ABIERTO, tipoHitoDe, estadoHitoDe, tipoEntregableDe, estadoEntregableDe, especialidadDe,
  etiqueta, formatoFecha, mensajeError, hoyChile } from "../../lib/proyectos";
import { listarHitos, listarEntregables, listarActividades, listarEquipo, crearHito, actualizarHito, eliminarHito, crearEntregable, actualizarEntregable, eliminarEntregable } from "../../lib/proyectosDatos";

export function PestanaEntregables({ token, proyecto: p, per, nombres, version, onCambio, showToast }) {
  const [hitos, setHitos] = useState(null); const [ents, setEnts] = useState([]); const [acts, setActs] = useState([]); const [equipo, setEquipo] = useState([]);
  const [form, setForm] = useState(null); const [anular, setAnular] = useState(null); const [error, setError] = useState("");
  const hoy = hoyChile();
  const cargar = async () => {
    try {
      const [h, e, a, q] = await Promise.all([listarHitos(token, p.id), listarEntregables(token, p.id), listarActividades(token, p.id), listarEquipo(token, p.id)]);
      setHitos(h || []); setEnts(e || []); setActs(a || []); setEquipo((q || []).filter((x) => x.activo)); setError("");
    } catch (er) { setError(mensajeError(er)); setHitos([]); }
  };
  useEffect(() => { cargar(); }, [p.id, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const tras = async (msg) => { if (msg) showToast(msg); await cargar(); await onCambio(); };
  const act = async (fn, msg) => { try { await fn(); await tras(msg); } catch (e) { showToast(mensajeError(e), "error"); await cargar(); } };
  if (hitos === null) return <Vacio>Cargando…</Vacio>;
  const vencidoH = (h) => h.estado === "pendiente" && h.fecha_prevista < hoy;
  const vencidoE = (e) => ENTREGABLE_ABIERTO.includes(e.estado) && e.fecha_comprometida && e.fecha_comprometida < hoy;
  const eliminar = (tipo, fila, fn) => { if (window.confirm(`¿Eliminar ${tipo} «${fila.nombre}»? Si tiene elementos asociados, la base no lo permite: anúlalo.`)) act(() => fn(token, fila), `${tipo[0].toUpperCase()}${tipo.slice(1)} eliminado`); };

  return (
    <div>
      {error && <ErrorForm>{error}</ErrorForm>}
      <Seccion titulo={`Hitos · ${hitos.filter((h) => h.estado !== "anulado").length}`} accion={per.editarContenido && <button type="button" data-nuevo-hito onClick={() => setForm({ tipo: "hito" })} style={estiloBoton("pri")}>+ Hito</button>}>
        {!hitos.length && <Vacio dato="hitos">Sin hitos registrados.</Vacio>}
        {hitos.map((h) => (
          <div key={h.id} data-hito={h.nombre} style={{ ...cardStyle, borderRadius: R.md, padding: "12px 14px", marginBottom: S.sm, borderLeft: `4px solid ${vencidoH(h) ? C.danger : h.estado === "cumplido" ? C.ok : C.border}`, opacity: h.estado === "anulado" ? 0.65 : 1 }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontWeight: 800, color: C.ink }}>{h.nombre}</span>
              <Badge tono={estadoHitoDe(h.estado)?.tono}><span data-estado-hito={h.estado}>{etiqueta(estadoHitoDe, h.estado)}</span></Badge>
              <Badge tono="neutro">{etiqueta(tipoHitoDe, h.tipo)}</Badge>
              {vencidoH(h) && <Badge tono="danger">Vencido</Badge>}
            </div>
            <div style={{ fontSize: T.small, color: C.inkMuted, marginTop: 3 }}>
              Previsto {formatoFecha(h.fecha_prevista)}{h.fecha_real ? ` · cumplido ${formatoFecha(h.fecha_real)}` : ""}{h.actividad_id ? ` · actividad: ${acts.find((a) => a.id === h.actividad_id)?.nombre || "—"}` : ""}
            </div>
            {h.descripcion && <div style={{ fontSize: T.small, color: C.inkMuted, marginTop: 3 }}>{h.descripcion}</div>}
            {per.editarContenido && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                {h.estado === "pendiente" && <button type="button" data-cumplir-hito={h.nombre} onClick={() => act(() => actualizarHito(token, h, { fecha_real: hoy }), "Hito cumplido")} style={{ ...estiloBoton("pri"), minHeight: 34 }}>Marcar cumplido hoy</button>}
                <button type="button" data-editar-hito={h.nombre} onClick={() => setForm({ tipo: "hito", fila: h })} style={{ ...estiloBoton(), minHeight: 34 }}>Editar</button>
                {h.estado !== "anulado" && <button type="button" onClick={() => act(() => actualizarHito(token, h, { estado: "anulado" }), "Hito anulado")} style={{ ...estiloBoton("peligro"), minHeight: 34 }}>Anular</button>}
                {per.eliminarContenido && <button type="button" data-eliminar-hito={h.nombre} onClick={() => eliminar("hito", h, eliminarHito)} style={{ ...estiloBoton("peligro"), minHeight: 34 }}>Eliminar</button>}
              </div>
            )}
          </div>
        ))}
      </Seccion>

      <Seccion titulo={`Entregables · ${ents.filter((e) => e.estado !== "anulado").length}`} accion={per.editarContenido && <button type="button" data-nuevo-entregable onClick={() => setForm({ tipo: "entregable" })} style={estiloBoton("pri")}>+ Entregable</button>}>
        {!ents.length && <Vacio dato="entregables">Sin entregables registrados.</Vacio>}
        {ents.map((e) => (
          <div key={e.id} data-entregable={e.codigo || e.nombre} style={{ ...cardStyle, borderRadius: R.md, padding: "12px 14px", marginBottom: S.sm, borderLeft: `4px solid ${vencidoE(e) ? C.danger : ["emitido", "aprobado"].includes(e.estado) ? C.ok : C.border}`, opacity: e.estado === "anulado" ? 0.65 : 1 }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              {e.codigo && <span style={{ fontFamily: MONO, fontSize: T.small, color: C.tealDark, fontWeight: 800 }}>{e.codigo}</span>}
              <span style={{ fontWeight: 800, color: C.ink }}>{e.nombre}</span>
              <Badge tono={estadoEntregableDe(e.estado)?.tono}><span data-estado-entregable={e.estado}>{etiqueta(estadoEntregableDe, e.estado)}</span></Badge>
              <Badge tono="neutro">Rev. {e.revision}</Badge>
              {vencidoE(e) && <Badge tono="danger">Vencido</Badge>}
            </div>
            <div style={{ fontSize: T.small, color: C.inkMuted, marginTop: 3 }}>
              {[etiqueta(tipoEntregableDe, e.tipo), e.especialidad ? etiqueta(especialidadDe, e.especialidad) : null, e.responsable_id ? nombres[e.responsable_id] : "Sin responsable",
                e.fecha_comprometida ? `comprometido ${formatoFecha(e.fecha_comprometida)}` : "sin fecha comprometida", e.fecha_entrega ? `entregado ${formatoFecha(e.fecha_entrega)}` : null,
                e.hito_id ? `hito: ${hitos.find((h) => h.id === e.hito_id)?.nombre || "—"}` : null].filter(Boolean).join(" · ")}
            </div>
            {per.editarContenido && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                <button type="button" data-editar-entregable={e.codigo || e.nombre} onClick={() => setForm({ tipo: "entregable", fila: e })} style={{ ...estiloBoton(), minHeight: 34 }}>Editar</button>
                {e.estado !== "anulado" && <button type="button" onClick={() => setAnular(e)} style={{ ...estiloBoton("peligro"), minHeight: 34 }}>Anular</button>}
                {per.eliminarContenido && <button type="button" data-eliminar-entregable={e.codigo || e.nombre} onClick={() => eliminar("entregable", e, eliminarEntregable)} style={{ ...estiloBoton("peligro"), minHeight: 34 }}>Eliminar</button>}
              </div>
            )}
          </div>
        ))}
      </Seccion>
      {form?.tipo === "hito" && <FormHito token={token} proyecto={p} actividades={acts} fila={form.fila} onCerrar={() => setForm(null)} onGuardado={async (m, rec) => { if (!rec) setForm(null); await tras(m); }} />}
      {form?.tipo === "entregable" && <FormEntregable token={token} proyecto={p} hitos={hitos} equipo={equipo} nombres={nombres} fila={form.fila} onCerrar={() => setForm(null)} onGuardado={async (m, rec) => { if (!rec) setForm(null); await tras(m); }} />}
      {anular && <PedirMotivo titulo={`Anular entregable «${anular.nombre}»`} obligatorio={false} peligro etiquetaBoton="Anular" texto="El entregable queda anulado (no se borra) y deja de contar como pendiente."
        onCancelar={() => setAnular(null)} onConfirmar={(m) => { const e = anular; setAnular(null); act(() => actualizarEntregable(token, e, { estado: "anulado", ...(m ? { descripcion: [e.descripcion, `Anulado: ${m}`].filter(Boolean).join("\n").slice(0, 2000) } : {}) }), "Entregable anulado"); }} />}
    </div>
  );
}

function FormHito({ token, proyecto: p, actividades, fila, onCerrar, onGuardado }) {
  const b = fila || {};
  const [f, setF] = useState({ nombre: b.nombre || "", tipo: b.tipo || "interno", fecha_prevista: b.fecha_prevista || "", fecha_real: b.fecha_real || "", actividad_id: b.actividad_id || "", descripcion: b.descripcion || "", estado: b.estado || "pendiente" });
  const [err, setErr] = useState(""); const [ocupado, setOcupado] = useState(false); const hoy = hoyChile();
  const set = (k) => (e) => { setF((x) => ({ ...x, [k]: e.target.value })); setErr(""); };
  async function guardar() {
    if (f.nombre.trim().length < 2) { setErr("Indica el nombre del hito."); return; }
    if (!f.fecha_prevista) { setErr("Indica la fecha prevista."); return; }
    if (f.fecha_real && f.fecha_real > hoy) { setErr("La fecha real no puede ser futura."); return; }
    setOcupado(true);
    const d = { nombre: f.nombre.trim(), tipo: f.tipo, fecha_prevista: f.fecha_prevista, fecha_real: f.fecha_real || null, actividad_id: f.actividad_id || null, descripcion: f.descripcion.trim() || null,
      estado: f.estado === "anulado" ? "anulado" : (f.fecha_real ? "cumplido" : "pendiente") };
    try { if (fila) await actualizarHito(token, fila, d); else await crearHito(token, { proyecto_id: p.id, ...d }); await onGuardado(fila ? "Hito guardado" : "Hito creado"); }
    catch (e) { setErr(mensajeError(e)); if (e.conflicto) await onGuardado(null, true); }
    finally { setOcupado(false); }
  }
  return (
    <Ventana titulo={fila ? `Editar hito «${fila.nombre}»` : "Nuevo hito"} onCerrar={onCerrar} dato="hito" ancho={520}
      pie={<><button type="button" onClick={onCerrar} style={estiloBoton()}>Cancelar</button><button type="button" data-guardar-hito disabled={ocupado} onClick={guardar} style={estiloBoton("pri")}>Guardar</button></>}>
      <ErrorForm>{err}</ErrorForm>
      <Campo etiqueta="Nombre"><Entrada data-campo="nombre" value={f.nombre} onChange={set("nombre")} maxLength={200} placeholder="Ej.: Estado de pago N.º 1 (30 %)" /></Campo>
      <Rejilla>
        <Campo etiqueta="Tipo"><Selector data-campo="tipo" value={f.tipo} onChange={set("tipo")} opciones={TIPOS_HITO} /></Campo>
        <Campo etiqueta="Fecha prevista"><Entrada type="date" data-campo="fecha_prevista" value={f.fecha_prevista} onChange={set("fecha_prevista")} /></Campo>
        <Campo etiqueta="Fecha real" ayuda="Con fecha real el hito queda cumplido."><Entrada type="date" max={hoy} data-campo="fecha_real" value={f.fecha_real} onChange={set("fecha_real")} /></Campo>
        <Campo etiqueta="Actividad asociada"><Selector data-campo="actividad_id" value={f.actividad_id} onChange={set("actividad_id")} vacio="—" opciones={actividades.filter((a) => a.estado !== "anulada").map((a) => ({ v: a.id, l: a.nombre }))} /></Campo>
      </Rejilla>
      <Campo etiqueta="Descripción"><Area value={f.descripcion} onChange={set("descripcion")} maxLength={2000} /></Campo>
    </Ventana>
  );
}

function FormEntregable({ token, proyecto: p, hitos, equipo, nombres, fila, onCerrar, onGuardado }) {
  const b = fila || {};
  const [f, setF] = useState({ codigo: b.codigo || "", nombre: b.nombre || "", tipo: b.tipo || "otro", especialidad: b.especialidad || "", responsable_id: b.responsable_id || "",
    fecha_comprometida: b.fecha_comprometida || "", fecha_entrega: b.fecha_entrega || "", revision: b.revision || "A", estado: b.estado || "pendiente", hito_id: b.hito_id || "", descripcion: b.descripcion || "" });
  const [err, setErr] = useState(""); const [ocupado, setOcupado] = useState(false); const hoy = hoyChile();
  const set = (k) => (e) => { setF((x) => ({ ...x, [k]: e.target.value })); setErr(""); };
  async function guardar() {
    if (f.nombre.trim().length < 2) { setErr("Indica el nombre del entregable."); return; }
    const rev = f.revision.trim().toUpperCase();
    if (!/^[A-Z0-9]{1,4}$/.test(rev)) { setErr("La revisión usa de 1 a 4 letras o números (A, B, 0, 1…)."); return; }
    if (f.fecha_entrega && f.fecha_entrega > hoy) { setErr("La fecha de entrega no puede ser futura."); return; }
    setOcupado(true);
    const d = { codigo: f.codigo.trim() || null, nombre: f.nombre.trim(), tipo: f.tipo, especialidad: f.especialidad || null, responsable_id: f.responsable_id || null,
      fecha_comprometida: f.fecha_comprometida || null, fecha_entrega: f.fecha_entrega || null, revision: rev, estado: f.estado, hito_id: f.hito_id || null, descripcion: f.descripcion.trim() || null };
    try { if (fila) await actualizarEntregable(token, fila, d); else await crearEntregable(token, { proyecto_id: p.id, ...d }); await onGuardado(fila ? "Entregable guardado" : "Entregable creado"); }
    catch (e) { setErr(mensajeError(e)); if (e.conflicto) await onGuardado(null, true); }
    finally { setOcupado(false); }
  }
  return (
    <Ventana titulo={fila ? `Editar entregable «${fila.nombre}»` : "Nuevo entregable"} onCerrar={onCerrar} dato="entregable"
      pie={<><button type="button" onClick={onCerrar} style={estiloBoton()}>Cancelar</button><button type="button" data-guardar-entregable disabled={ocupado} onClick={guardar} style={estiloBoton("pri")}>Guardar</button></>}>
      <ErrorForm>{err}</ErrorForm>
      <Rejilla>
        <Campo etiqueta="Código de documento" ayuda="N.º del cliente o de BFK; único en el proyecto."><Entrada data-campo="codigo" value={f.codigo} onChange={set("codigo")} maxLength={80} /></Campo>
        <Campo etiqueta="Revisión"><Entrada data-campo="revision" value={f.revision} onChange={set("revision")} maxLength={4} /></Campo>
      </Rejilla>
      <Campo etiqueta="Nombre"><Entrada data-campo="nombre" value={f.nombre} onChange={set("nombre")} maxLength={200} /></Campo>
      <Rejilla>
        <Campo etiqueta="Tipo"><Selector data-campo="tipo" value={f.tipo} onChange={set("tipo")} opciones={TIPOS_ENTREGABLE} /></Campo>
        <Campo etiqueta="Especialidad"><Selector data-campo="especialidad" value={f.especialidad} onChange={set("especialidad")} vacio="—" opciones={ESPECIALIDADES_CONTENIDO} /></Campo>
        <Campo etiqueta="Responsable"><Selector data-campo="responsable_id" value={f.responsable_id} onChange={set("responsable_id")} vacio="Sin responsable" opciones={equipo.map((e) => ({ v: e.usuario_id, l: nombres[e.usuario_id] || "—" }))} /></Campo>
        <Campo etiqueta="Estado" ayuda="Emitido o aprobado registra la fecha de entrega."><Selector data-campo="estado" value={f.estado} onChange={set("estado")} opciones={ESTADOS_ENTREGABLE} /></Campo>
        <Campo etiqueta="Fecha comprometida"><Entrada type="date" data-campo="fecha_comprometida" value={f.fecha_comprometida} onChange={set("fecha_comprometida")} /></Campo>
        <Campo etiqueta="Fecha de entrega"><Entrada type="date" max={hoy} data-campo="fecha_entrega" value={f.fecha_entrega} onChange={set("fecha_entrega")} /></Campo>
        <Campo etiqueta="Hito asociado"><Selector data-campo="hito_id" value={f.hito_id} onChange={set("hito_id")} vacio="—" opciones={hitos.filter((h) => h.estado !== "anulado").map((h) => ({ v: h.id, l: h.nombre }))} /></Campo>
      </Rejilla>
      <Campo etiqueta="Descripción"><Area value={f.descripcion} onChange={set("descripcion")} maxLength={2000} /></Campo>
    </Ventana>
  );
}
