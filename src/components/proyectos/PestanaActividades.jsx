// Proyectos Industriales — actividades y subtareas (EDT de hasta 3 niveles).
// Avance, estado mostrado y atraso vienen de la vista pi_actividades_vista. La base valida niveles, ciclos,
// responsables del equipo, fechas reales no futuras y la coherencia estado ↔ avance.
import { useEffect, useState } from "react";
import { C, MONO, R, S, T, cardStyle } from "../../lib/theme";
import { Badge, Seccion } from "../ui/Sistema";
import { BarraAvance, Ventana, Campo, Rejilla, Entrada, Area, Selector, ErrorForm, Vacio, estiloBoton } from "./Comunes";
import { ESTADOS_ACTIVIDAD, ESPECIALIDADES_CONTENIDO, estadoActividadDe, especialidadDe, etiqueta, numerarEDT, nivelMaximo, formatoFecha, formatoPct, mensajeError, hoyChile } from "../../lib/proyectos";
import { listarActividades, listarEquipo, crearActividad, actualizarActividad, eliminarActividad } from "../../lib/proyectosDatos";

export function PestanaActividades({ token, proyecto: p, per, nombres, version, onCambio, showToast }) {
  const [filas, setFilas] = useState(null); const [equipo, setEquipo] = useState([]); const [error, setError] = useState("");
  const [form, setForm] = useState(null);   // { fila?, padre? }
  const cargar = async () => {
    try { const [a, e] = await Promise.all([listarActividades(token, p.id), listarEquipo(token, p.id)]); setFilas(numerarEDT(a || [])); setEquipo((e || []).filter((x) => x.activo)); setError(""); }
    catch (er) { setError(mensajeError(er)); setFilas([]); }
  };
  useEffect(() => { cargar(); }, [p.id, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const tras = async (msg) => { if (msg) showToast(msg); await cargar(); await onCambio(); };

  async function eliminar(a) {
    if (!window.confirm(`¿Eliminar la actividad «${a.nombre}»? Si tiene subtareas o hitos asociados, la base no lo permite: anúlala.`)) return;
    try { await eliminarActividad(token, a); await tras("Actividad eliminada"); } catch (e) { showToast(mensajeError(e), "error"); }
  }
  if (filas === null) return <Vacio>Cargando actividades…</Vacio>;
  return (
    <Seccion titulo={`Actividades y subtareas · ${filas.length}`} accion={per.editarContenido && <button type="button" data-nueva-actividad onClick={() => setForm({})} style={estiloBoton("pri")}>+ Actividad</button>}
      nota="El avance del proyecto pondera por peso las actividades sin subtareas. Una actividad con subtareas toma el avance de ellas.">
      {error && <ErrorForm>{error}</ErrorForm>}
      {!filas.length && <Vacio dato="actividades">Sin actividades. {per.editarContenido ? "Agrega la primera con «+ Actividad»." : ""}</Vacio>}
      {filas.map((a) => {
        const est = estadoActividadDe(a.estado_calculado || a.estado);
        return (
          <div key={a.id} data-actividad={a.edt} data-actividad-nombre={a.nombre} style={{ ...cardStyle, borderRadius: R.md, padding: "12px 14px", marginBottom: S.sm, marginLeft: (a.nivel - 1) * 16, borderLeft: `4px solid ${a.atrasada ? C.danger : a.nivel === 1 ? C.teal : C.border}`, opacity: a.estado === "anulada" ? 0.65 : 1 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <span style={{ fontFamily: MONO, fontSize: T.small, color: C.inkMuted, minWidth: 26, paddingTop: 2 }}>{a.edt}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 800, color: C.ink, fontSize: T.body }}>{a.nombre}</span>
                  <Badge tono={est?.tono}><span data-estado-actividad={a.estado_calculado || a.estado}>{est?.l || a.estado}</span></Badge>
                  {a.atrasada && <Badge tono="danger">Atrasada</Badge>}
                  {!a.atrasada && a.por_vencer && <Badge tono="warn">Vence en 7 días</Badge>}
                </div>
                <div style={{ fontSize: T.small, color: C.inkMuted, marginTop: 2 }}>
                  {[a.responsable_id ? nombres[a.responsable_id] || "—" : "Sin responsable", a.fecha_inicio_prevista || a.fecha_fin_prevista ? `${formatoFecha(a.fecha_inicio_prevista)} → ${formatoFecha(a.fecha_fin_prevista)}` : "sin fechas",
                    a.especialidad ? etiqueta(especialidadDe, a.especialidad) : null, a.tiene_subtareas ? "avance calculado de sus subtareas" : `peso ${formatoPct(a.peso)}`].filter(Boolean).join(" · ")}
                </div>
                {a.estado !== "anulada" && <BarraAvance real={a.avance_calculado} planificado={a.tiene_subtareas ? a.avance_planificado : planHoja(a)} atrasado={a.atrasada} dato={a.edt} />}
                {per.editarContenido && a.estado !== "anulada" && !a.tiene_subtareas && <AvanceRapido token={token} fila={a} onGuardado={tras} showToast={showToast} />}
                {per.editarContenido && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                    <button type="button" data-editar-actividad={a.edt} onClick={() => setForm({ fila: a })} style={{ ...estiloBoton(), minHeight: 34 }}>Editar</button>
                    {a.nivel < nivelMaximo && a.estado !== "anulada" && <button type="button" data-subtarea={a.edt} onClick={() => setForm({ padre: a })} style={{ ...estiloBoton(), minHeight: 34 }}>+ Subtarea</button>}
                    {per.eliminarContenido && <button type="button" data-eliminar-actividad={a.edt} onClick={() => eliminar(a)} style={{ ...estiloBoton("peligro"), minHeight: 34 }}>Eliminar</button>}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
      {form && <FormActividad token={token} proyecto={p} equipo={equipo} nombres={nombres} hermanos={filas} {...form} onCerrar={() => setForm(null)}
        onGuardado={async (msg, recargar) => { if (!recargar) setForm(null); await tras(msg); }} />}
    </Seccion>
  );
}

// Planificado de una actividad hoja (misma fórmula lineal que la vista; solo para la marca de la barra).
function planHoja(a, hoy = hoyChile()) {
  if (!a.fecha_inicio_prevista || !a.fecha_fin_prevista) return null;
  if (hoy < a.fecha_inicio_prevista) return 0;
  if (hoy >= a.fecha_fin_prevista) return 100;
  const d = (x) => Date.UTC(+x.slice(0, 4), +x.slice(5, 7) - 1, +x.slice(8, 10)) / 86400000;
  return Math.round(10000 * (d(hoy) - d(a.fecha_inicio_prevista) + 1) / (d(a.fecha_fin_prevista) - d(a.fecha_inicio_prevista) + 1)) / 100;
}

function AvanceRapido({ token, fila, onGuardado, showToast }) {
  const [v, setV] = useState(String(Number(fila.avance)));
  const [ocupado, setOcupado] = useState(false);
  const cambio = Number(v) !== Number(fila.avance);
  async function guardar() {
    const n = Number(String(v).replace(",", "."));
    if (!Number.isFinite(n) || n < 0 || n > 100) { showToast("El avance va de 0 a 100 %", "error"); return; }
    setOcupado(true);
    try { await actualizarActividad(token, fila, { avance: n, ...(n < 100 && fila.estado === "completada" ? { estado: "en_curso" } : {}) }); await onGuardado("Avance actualizado"); }
    catch (e) { showToast(mensajeError(e), "error"); await onGuardado(); }
    finally { setOcupado(false); }
  }
  return (
    <div data-avance-rapido={fila.edt} style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6 }}>
      <input type="range" min="0" max="100" step="5" value={Number(v) || 0} onChange={(e) => setV(e.target.value)} aria-label={`Avance de ${fila.nombre}`} style={{ flex: 1, minWidth: 80, accentColor: C.teal }} />
      <input data-avance-input inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} style={{ width: 64, minHeight: 34, padding: "4px 8px", border: `1.5px solid ${C.border}`, borderRadius: R.sm, fontFamily: MONO, fontSize: T.sm, textAlign: "right" }} />
      <span style={{ fontSize: T.small, color: C.inkMuted }}>%</span>
      {cambio && <button type="button" data-guardar-avance disabled={ocupado} onClick={guardar} style={{ ...estiloBoton("pri"), minHeight: 34 }}>{ocupado ? "…" : "Guardar"}</button>}
    </div>
  );
}

function FormActividad({ token, proyecto: p, equipo, nombres, hermanos, fila, padre, onCerrar, onGuardado }) {
  const editar = !!fila;
  const base = fila || {};
  const [f, setF] = useState({
    nombre: base.nombre || "", descripcion: base.descripcion || "", especialidad: base.especialidad || "", responsable_id: base.responsable_id || "",
    fecha_inicio_prevista: base.fecha_inicio_prevista || "", fecha_fin_prevista: base.fecha_fin_prevista || "", fecha_inicio_real: base.fecha_inicio_real || "", fecha_fin_real: base.fecha_fin_real || "",
    avance: base.avance !== undefined ? String(Number(base.avance)) : "0", peso: base.peso !== undefined ? String(Number(base.peso)) : "1", estado: base.estado || "pendiente",
  });
  const [err, setErr] = useState(""); const [errs, setErrs] = useState({}); const [ocupado, setOcupado] = useState(false);
  const set = (k) => (e) => { setF((x) => ({ ...x, [k]: e.target.value })); setErrs((x) => ({ ...x, [k]: "" })); setErr(""); };
  const conSub = !!fila?.tiene_subtareas;
  const hoy = hoyChile();
  function validar() {
    const e = {};
    if (f.nombre.trim().length < 2) e.nombre = "Indica el nombre (2 caracteres o más).";
    if (f.fecha_inicio_prevista && f.fecha_fin_prevista && f.fecha_fin_prevista < f.fecha_inicio_prevista) e.fecha_fin_prevista = "El fin previsto no puede ser anterior al inicio.";
    if (f.fecha_inicio_real && f.fecha_inicio_real > hoy) e.fecha_inicio_real = "No puede ser una fecha futura.";
    if (f.fecha_fin_real && f.fecha_fin_real > hoy) e.fecha_fin_real = "No puede ser una fecha futura.";
    if (f.fecha_inicio_real && f.fecha_fin_real && f.fecha_fin_real < f.fecha_inicio_real) e.fecha_fin_real = "El fin real no puede ser anterior al inicio real.";
    const av = Number(String(f.avance).replace(",", ".")); if (!conSub && (!Number.isFinite(av) || av < 0 || av > 100)) e.avance = "De 0 a 100.";
    const pe = Number(String(f.peso).replace(",", ".")); if (!Number.isFinite(pe) || pe <= 0 || pe > 100000) e.peso = "Mayor que 0.";
    setErrs(e); return !Object.keys(e).length;
  }
  async function guardar() {
    if (!validar()) return;
    setOcupado(true); setErr("");
    const datos = { nombre: f.nombre.trim(), descripcion: f.descripcion.trim() || null, especialidad: f.especialidad || null, responsable_id: f.responsable_id || null,
      fecha_inicio_prevista: f.fecha_inicio_prevista || null, fecha_fin_prevista: f.fecha_fin_prevista || null, fecha_inicio_real: f.fecha_inicio_real || null, fecha_fin_real: f.fecha_fin_real || null,
      peso: Number(String(f.peso).replace(",", ".")), estado: f.estado, ...(conSub ? {} : { avance: Number(String(f.avance).replace(",", ".")) }) };
    try {
      if (editar) { await actualizarActividad(token, fila, datos); await onGuardado("Actividad guardada"); }
      else {
        const orden = hermanos.filter((h) => (h.padre_id || null) === (padre?.id || null)).reduce((m, h) => Math.max(m, h.orden), 0) + 1;
        // Una subtarea NO hereda los datos de su actividad: se crea solo con lo escrito aquí.
        await crearActividad(token, { proyecto_id: p.id, padre_id: padre?.id || null, orden, ...datos });
        await onGuardado(padre ? "Subtarea creada" : "Actividad creada");
      }
    } catch (e) { setErr(mensajeError(e)); if (e.conflicto) await onGuardado(null, true); }
    finally { setOcupado(false); }
  }
  const titulo = editar ? `Editar ${fila.edt} · ${fila.nombre}` : padre ? `Nueva subtarea de ${padre.edt} · ${padre.nombre}` : "Nueva actividad";
  return (
    <Ventana titulo={titulo} onCerrar={onCerrar} dato="actividad" pie={<><button type="button" onClick={onCerrar} style={estiloBoton()}>Cancelar</button><button type="button" data-guardar-actividad disabled={ocupado} onClick={guardar} style={estiloBoton("pri")}>{ocupado ? "Guardando…" : "Guardar"}</button></>}>
      <ErrorForm>{err}</ErrorForm>
      <Campo etiqueta="Nombre" error={errs.nombre}><Entrada data-campo="nombre" value={f.nombre} onChange={set("nombre")} maxLength={200} /></Campo>
      <Rejilla>
        <Campo etiqueta="Responsable" ayuda="Debe integrar el equipo activo del proyecto."><Selector data-campo="responsable_id" value={f.responsable_id} onChange={set("responsable_id")} vacio="Sin responsable" opciones={equipo.map((e) => ({ v: e.usuario_id, l: nombres[e.usuario_id] || "—" }))} /></Campo>
        <Campo etiqueta="Especialidad"><Selector data-campo="especialidad" value={f.especialidad} onChange={set("especialidad")} vacio="—" opciones={ESPECIALIDADES_CONTENIDO} /></Campo>
        <Campo etiqueta="Inicio previsto"><Entrada type="date" data-campo="fecha_inicio_prevista" value={f.fecha_inicio_prevista} onChange={set("fecha_inicio_prevista")} /></Campo>
        <Campo etiqueta="Fin previsto" error={errs.fecha_fin_prevista}><Entrada type="date" data-campo="fecha_fin_prevista" value={f.fecha_fin_prevista} onChange={set("fecha_fin_prevista")} /></Campo>
        <Campo etiqueta="Inicio real" error={errs.fecha_inicio_real}><Entrada type="date" max={hoy} data-campo="fecha_inicio_real" value={f.fecha_inicio_real} onChange={set("fecha_inicio_real")} /></Campo>
        <Campo etiqueta="Fin real" error={errs.fecha_fin_real}><Entrada type="date" max={hoy} data-campo="fecha_fin_real" value={f.fecha_fin_real} onChange={set("fecha_fin_real")} /></Campo>
        {!conSub && <Campo etiqueta="Avance (%)" error={errs.avance}><Entrada data-campo="avance" inputMode="decimal" value={f.avance} onChange={set("avance")} /></Campo>}
        <Campo etiqueta="Peso" error={errs.peso} ayuda="Importancia relativa en el avance del proyecto."><Entrada data-campo="peso" inputMode="decimal" value={f.peso} onChange={set("peso")} /></Campo>
        <Campo etiqueta="Estado" ayuda="Completada exige 100 % y fecha de fin real (se completa sola)."><Selector data-campo="estado" value={f.estado} onChange={set("estado")} opciones={ESTADOS_ACTIVIDAD} /></Campo>
      </Rejilla>
      {conSub && <div style={{ fontSize: T.small, color: C.inkMuted, marginBottom: 10 }}>Tiene subtareas: su avance se calcula de ellas.</div>}
      <Campo etiqueta="Descripción"><Area value={f.descripcion} onChange={set("descripcion")} maxLength={4000} /></Campo>
    </Ventana>
  );
}
