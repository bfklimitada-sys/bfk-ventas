// Proyectos Industriales — formulario de proyecto (crear propuesta o editar datos).
// Crear: pi_crear_proyecto (código PI-AAAA-NNN, equipo y presupuesto inicial NETO). Todo proyecto nace como PROPUESTA.
// Editar: solo la cabecera, con control de versión (si otra persona guardó antes, se avisa y se recarga).
import { useMemo, useState } from "react";
import { C, R, S, T } from "../../lib/theme";
import { Campo, Rejilla, Subtitulo, Entrada, Area, Selector, ErrorForm, Ventana, estiloBoton } from "./Comunes";
import { TIPOS, ESPECIALIDADES, RUBROS, MONEDAS, ROLES, normalizarRut, leerMonto, formatoMonto, mensajeError, rubroDe } from "../../lib/proyectos";
import { crearProyecto, actualizarProyecto, crearCliente } from "../../lib/proyectosDatos";

const vacio = { cliente_id: "", mandante_id: "", nombre: "", descripcion: "", alcance_tecnico: "", tipo: "", especialidades: [], ubicacion: "", comuna: "", region: "",
  responsable_id: "", fecha_inicio_prevista: "", fecha_termino_prevista: "", fecha_inicio_real: "", fecha_termino_real: "", presupuesto: "", moneda: "CLP" };

export function FormProyecto({ token, yo, esAdmin, perfiles, clientes, proyecto, onCerrar, onGuardado, onClienteCreado, showToast }) {
  const editar = !!proyecto;
  const [f, setF] = useState(() => editar ? {
    ...vacio, ...Object.fromEntries(Object.keys(vacio).map((k) => [k, proyecto[k] ?? vacio[k]])), especialidades: proyecto.especialidades || [],
  } : { ...vacio, responsable_id: yo });
  const [equipo, setEquipo] = useState([]);   // [{usuario_id, rol_proyecto, funcion}]
  const [nuevoCliente, setNuevoCliente] = useState(null);   // {para:'cliente'|'mandante', rut, razon_social, rubro, contacto_nombre, contacto_correo}
  const [err, setErr] = useState(""); const [errs, setErrs] = useState({}); const [ocupado, setOcupado] = useState(false);
  const set = (k) => (e) => { const v = e?.target ? e.target.value : e; setF((x) => ({ ...x, [k]: v })); setErrs((x) => ({ ...x, [k]: "" })); setErr(""); };
  const nombrePerfil = (id) => perfiles.find((p) => p.id === id)?.nombre || "—";
  const clientesActivos = clientes.filter((c) => c.activo || c.id === f.cliente_id || c.id === f.mandante_id);
  const opcCliente = clientesActivos.map((c) => ({ v: c.id, l: `${c.razon_social}${c.rut ? ` · ${c.rut}` : ""}` }));
  // pi_crear_proyecto: un presupuesto distinto de cero solo lo registra el responsable del proyecto o un administrador.
  const puedePresupuesto = !editar && (esAdmin || f.responsable_id === yo);
  const enEjecucion = editar && ["en_ejecucion", "suspendido", "finalizado", "cerrado"].includes(proyecto.estado);
  const disponibles = useMemo(() => perfiles.filter((p) => p.id !== f.responsable_id && !equipo.some((e) => e.usuario_id === p.id)), [perfiles, f.responsable_id, equipo]);

  function validar() {
    const e = {};
    if (!f.cliente_id) e.cliente_id = "Elige el cliente.";
    if (f.mandante_id && f.mandante_id === f.cliente_id) e.mandante_id = "El mandante debe ser distinto del cliente.";
    if (f.nombre.trim().length < 3) e.nombre = "El nombre debe tener al menos 3 caracteres.";
    if (!f.tipo) e.tipo = "Elige el tipo de proyecto.";
    if (!f.responsable_id) e.responsable_id = "Elige el responsable principal.";
    if (f.fecha_inicio_prevista && f.fecha_termino_prevista && f.fecha_termino_prevista < f.fecha_inicio_prevista) e.fecha_termino_prevista = "El término previsto no puede ser anterior al inicio.";
    if (f.fecha_inicio_real && f.fecha_termino_real && f.fecha_termino_real < f.fecha_inicio_real) e.fecha_termino_real = "El término real no puede ser anterior al inicio real.";
    if (!editar && f.presupuesto !== "") { const m = leerMonto(f.presupuesto); if (!Number.isFinite(m) || m < 0) e.presupuesto = "Monto no válido (usa solo números; el neto, sin IVA)."; }
    setErrs(e); return !Object.keys(e).length;
  }
  const nn = (v) => (String(v ?? "").trim() === "" ? null : String(v).trim());

  async function guardar() {
    if (!validar()) return;
    setOcupado(true); setErr("");
    try {
      if (editar) {
        const cambios = { cliente_id: f.cliente_id, mandante_id: f.mandante_id || null, nombre: f.nombre.trim(), descripcion: nn(f.descripcion), alcance_tecnico: nn(f.alcance_tecnico),
          tipo: f.tipo, especialidades: f.especialidades, ubicacion: nn(f.ubicacion), comuna: nn(f.comuna), region: nn(f.region), responsable_id: f.responsable_id,
          fecha_inicio_prevista: f.fecha_inicio_prevista || null, fecha_termino_prevista: f.fecha_termino_prevista || null,
          ...(enEjecucion ? { fecha_inicio_real: f.fecha_inicio_real || null, fecha_termino_real: f.fecha_termino_real || null } : {}) };
        await actualizarProyecto(token, proyecto.id, proyecto.version, cambios);
        showToast("Datos del proyecto guardados");
        onGuardado(proyecto.codigo);
      } else {
        const m = f.presupuesto === "" ? null : leerMonto(f.presupuesto);
        const r = await crearProyecto(token, { cliente_id: f.cliente_id, mandante_id: f.mandante_id || null, nombre: f.nombre.trim(), descripcion: f.descripcion, alcance_tecnico: f.alcance_tecnico,
          tipo: f.tipo, especialidades: f.especialidades, ubicacion: f.ubicacion, comuna: f.comuna, region: f.region, responsable_id: f.responsable_id,
          fecha_inicio_prevista: f.fecha_inicio_prevista || null, fecha_termino_prevista: f.fecha_termino_prevista || null,
          presupuesto_inicial: puedePresupuesto ? m : null, moneda: f.moneda, equipo });
        showToast(`Propuesta ${r.codigo} creada${esAdmin ? "" : ": un administrador debe autorizar su activación"}`);
        onGuardado(r.codigo);
      }
    } catch (e) {
      setErr(mensajeError(e));
      if (e.conflicto) onGuardado(proyecto?.codigo, { recargar: true });
    } finally { setOcupado(false); }
  }

  async function guardarCliente() {
    const n = nuevoCliente; const e = {};
    const rut = normalizarRut(n.rut);
    if (!rut.ok) e.rut = rut.error;
    if (n.razon_social.trim().length < 2) e.razon_social = "Indica la razón social.";
    if (n.contacto_correo && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(n.contacto_correo.trim())) e.contacto_correo = "Correo no válido.";
    if (Object.keys(e).length) { setNuevoCliente({ ...n, errs: e }); return; }
    setOcupado(true);
    try {
      const c = await crearCliente(token, { rut: rut.rut, razon_social: n.razon_social.trim(), rubro: n.rubro, contacto_nombre: nn(n.contacto_nombre), contacto_correo: nn(n.contacto_correo) });
      onClienteCreado(c); setF((x) => ({ ...x, [n.para === "mandante" ? "mandante_id" : "cliente_id"]: c.id })); setNuevoCliente(null);
      showToast(`Cliente ${c.razon_social} agregado`);
    } catch (er) { setNuevoCliente({ ...n, errs: { general: mensajeError(er) } }); }
    finally { setOcupado(false); }
  }

  const alternarEsp = (v) => setF((x) => ({ ...x, especialidades: x.especialidades.includes(v) ? x.especialidades.filter((y) => y !== v) : [...x.especialidades, v] }));
  const pie = <>
    <button type="button" onClick={onCerrar} style={estiloBoton()}>Cancelar</button>
    <button type="button" data-guardar-proyecto disabled={ocupado} onClick={guardar} style={estiloBoton("pri")}>{ocupado ? "Guardando…" : editar ? "Guardar cambios" : "Crear propuesta"}</button>
  </>;

  return (
    <Ventana titulo={editar ? `Editar ${proyecto.codigo}` : "Nuevo proyecto industrial"} onCerrar={onCerrar} pie={pie} dato={editar ? "editar-proyecto" : "nuevo-proyecto"} ancho={640}>
      {!editar && <p style={{ margin: "0 0 12px", fontSize: T.sm, color: C.inkMuted, lineHeight: 1.5 }}>El proyecto nace como <b>propuesta</b> y recibe su código PI-AAAA-NNN al guardar. {esAdmin ? "Como administrador, después autorizas su activación desde la ficha." : "Un administrador debe autorizar su activación."}</p>}
      <ErrorForm>{err}</ErrorForm>
      <Subtitulo>Cliente</Subtitulo>
      <Rejilla>
        <Campo etiqueta="Cliente" error={errs.cliente_id}>
          <Selector data-campo="cliente_id" value={f.cliente_id} onChange={set("cliente_id")} vacio="Elige el cliente…" opciones={opcCliente} />
          <button type="button" data-nuevo-cliente="cliente" onClick={() => setNuevoCliente({ para: "cliente", rut: "", razon_social: "", rubro: "otro", contacto_nombre: "", contacto_correo: "" })} style={{ ...estiloBoton(), marginTop: 6, minHeight: 34, padding: "4px 10px", fontSize: T.small }}>+ Nuevo cliente</button>
        </Campo>
        <Campo etiqueta="Mandante (opcional)" error={errs.mandante_id} ayuda="Dueño de la obra cuando el cliente es un contratista.">
          <Selector data-campo="mandante_id" value={f.mandante_id || ""} onChange={set("mandante_id")} vacio="Sin mandante" opciones={opcCliente.filter((o) => o.v !== f.cliente_id)} />
          <button type="button" data-nuevo-cliente="mandante" onClick={() => setNuevoCliente({ para: "mandante", rut: "", razon_social: "", rubro: "otro", contacto_nombre: "", contacto_correo: "" })} style={{ ...estiloBoton(), marginTop: 6, minHeight: 34, padding: "4px 10px", fontSize: T.small }}>+ Nuevo mandante</button>
        </Campo>
      </Rejilla>
      {nuevoCliente && (
        <div data-form-cliente style={{ background: C.paper, border: `1px solid ${C.border}`, borderRadius: R.md, padding: S.md, marginBottom: S.md }}>
          <div style={{ fontWeight: 800, fontSize: T.sm, marginBottom: 8 }}>Nuevo {nuevoCliente.para === "mandante" ? "mandante" : "cliente"} (catálogo industrial, separado de Mercado Público)</div>
          <ErrorForm>{nuevoCliente.errs?.general}</ErrorForm>
          <Rejilla>
            <Campo etiqueta="RUT" error={nuevoCliente.errs?.rut}><Entrada data-cliente="rut" value={nuevoCliente.rut} onChange={(e) => setNuevoCliente({ ...nuevoCliente, rut: e.target.value, errs: {} })} placeholder="76.123.456-7" /></Campo>
            <Campo etiqueta="Razón social" error={nuevoCliente.errs?.razon_social}><Entrada data-cliente="razon_social" value={nuevoCliente.razon_social} onChange={(e) => setNuevoCliente({ ...nuevoCliente, razon_social: e.target.value, errs: {} })} maxLength={200} /></Campo>
            <Campo etiqueta="Rubro"><Selector data-cliente="rubro" value={nuevoCliente.rubro} onChange={(e) => setNuevoCliente({ ...nuevoCliente, rubro: e.target.value })} opciones={RUBROS} /></Campo>
            <Campo etiqueta="Contacto"><Entrada value={nuevoCliente.contacto_nombre} onChange={(e) => setNuevoCliente({ ...nuevoCliente, contacto_nombre: e.target.value })} maxLength={150} /></Campo>
            <Campo etiqueta="Correo del contacto" error={nuevoCliente.errs?.contacto_correo}><Entrada type="email" value={nuevoCliente.contacto_correo} onChange={(e) => setNuevoCliente({ ...nuevoCliente, contacto_correo: e.target.value, errs: {} })} /></Campo>
          </Rejilla>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" onClick={() => setNuevoCliente(null)} style={estiloBoton()}>Cancelar</button>
            <button type="button" data-guardar-cliente disabled={ocupado} onClick={guardarCliente} style={estiloBoton("pri")}>Agregar</button>
          </div>
        </div>
      )}
      <Subtitulo>Proyecto</Subtitulo>
      <Campo etiqueta="Nombre del proyecto" error={errs.nombre}><Entrada data-campo="nombre" value={f.nombre} onChange={set("nombre")} maxLength={200} placeholder="Ej.: Automatización estación de bombeo EB-2" /></Campo>
      <Rejilla>
        <Campo etiqueta="Tipo" error={errs.tipo}><Selector data-campo="tipo" value={f.tipo} onChange={set("tipo")} vacio="Elige el tipo…" opciones={TIPOS} /></Campo>
        <Campo etiqueta="Responsable principal" error={errs.responsable_id} ayuda="Queda en el equipo como jefe de proyecto.">
          <Selector data-campo="responsable_id" value={f.responsable_id} onChange={set("responsable_id")} vacio="Elige…" opciones={perfiles.map((p) => ({ v: p.id, l: p.nombre }))} />
        </Campo>
      </Rejilla>
      <Campo etiqueta="Especialidades">
        <div data-campo="especialidades" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {ESPECIALIDADES.map((e) => { const sel = f.especialidades.includes(e.v); return (
            <button key={e.v} type="button" aria-pressed={sel} data-especialidad={e.v} onClick={() => alternarEsp(e.v)}
              style={{ minHeight: 36, padding: "6px 12px", borderRadius: R.pill, border: `1.5px solid ${sel ? C.teal : C.border}`, background: sel ? C.tealLight : C.card, color: sel ? C.tealDark : C.inkMuted, fontWeight: 700, fontSize: T.small, cursor: "pointer" }}>{e.l}</button>); })}
        </div>
      </Campo>
      <Campo etiqueta="Descripción"><Area data-campo="descripcion" value={f.descripcion || ""} onChange={set("descripcion")} maxLength={4000} /></Campo>
      <Campo etiqueta="Alcance técnico" ayuda="Qué incluye y qué excluye el trabajo de BFK (equipos, disciplinas, entregables, límites de batería)."><Area data-campo="alcance_tecnico" value={f.alcance_tecnico || ""} onChange={set("alcance_tecnico")} maxLength={20000} rows={4} /></Campo>
      <Subtitulo>Ubicación</Subtitulo>
      <Campo etiqueta="Faena, planta o dirección"><Entrada data-campo="ubicacion" value={f.ubicacion || ""} onChange={set("ubicacion")} maxLength={300} /></Campo>
      <Rejilla>
        <Campo etiqueta="Comuna"><Entrada data-campo="comuna" value={f.comuna || ""} onChange={set("comuna")} maxLength={100} /></Campo>
        <Campo etiqueta="Región"><Entrada data-campo="region" value={f.region || ""} onChange={set("region")} maxLength={100} /></Campo>
      </Rejilla>
      <Subtitulo>Fechas</Subtitulo>
      <Rejilla>
        <Campo etiqueta="Inicio previsto"><Entrada type="date" data-campo="fecha_inicio_prevista" value={f.fecha_inicio_prevista || ""} onChange={set("fecha_inicio_prevista")} /></Campo>
        <Campo etiqueta="Término previsto" error={errs.fecha_termino_prevista}><Entrada type="date" data-campo="fecha_termino_prevista" value={f.fecha_termino_prevista || ""} onChange={set("fecha_termino_prevista")} /></Campo>
        {enEjecucion && <Campo etiqueta="Inicio real" ayuda="No puede ser una fecha futura."><Entrada type="date" data-campo="fecha_inicio_real" value={f.fecha_inicio_real || ""} onChange={set("fecha_inicio_real")} /></Campo>}
        {enEjecucion && ["finalizado", "cerrado"].includes(proyecto.estado) && <Campo etiqueta="Término real" error={errs.fecha_termino_real}><Entrada type="date" data-campo="fecha_termino_real" value={f.fecha_termino_real || ""} onChange={set("fecha_termino_real")} /></Campo>}
      </Rejilla>
      {!editar && (<>
        <Subtitulo>Presupuesto inicial</Subtitulo>
        {puedePresupuesto ? (<>
          <Rejilla>
            <Campo etiqueta="Monto neto (sin IVA)" error={errs.presupuesto}><Entrada data-campo="presupuesto" inputMode="decimal" value={f.presupuesto} onChange={set("presupuesto")} placeholder="Ej.: 25.000.000" /></Campo>
            <Campo etiqueta="Moneda"><Selector data-campo="moneda" value={f.moneda} onChange={set("moneda")} opciones={MONEDAS} /></Campo>
          </Rejilla>
          <div style={{ fontSize: T.small, color: C.inkFaint, margin: "-4px 0 10px", lineHeight: 1.45 }}>
            Es la línea base de costos del proyecto (neto, sin IVA). No es facturación ni gasto: los costos reales, la facturación y los cobros se registran en la etapa de control económico. Después de iniciar el proyecto solo un administrador puede corregirlo.
            {f.presupuesto !== "" && Number.isFinite(leerMonto(f.presupuesto)) && <> Se registrará: <b>{formatoMonto(leerMonto(f.presupuesto), f.moneda)} neto</b>.</>}
          </div>
        </>) : (
          <div data-presupuesto-reservado style={{ fontSize: T.sm, color: C.inkMuted, margin: "0 0 10px", lineHeight: 1.45 }}>El presupuesto lo registra el responsable principal ({nombrePerfil(f.responsable_id)}) o un administrador.</div>
        )}
        <Subtitulo>Equipo de trabajo</Subtitulo>
        <div style={{ fontSize: T.small, color: C.inkMuted, marginBottom: 8 }}>{nombrePerfil(f.responsable_id)} queda como jefe de proyecto.{!esAdmin && f.responsable_id !== yo ? " Tú quedas como editor." : ""} Los datos económicos los ve el responsable; a otros integrantes se les autoriza después, en la pestaña Equipo.</div>
        {equipo.map((m, i) => (
          <div key={m.usuario_id} data-integrante-form={m.usuario_id} style={{ display: "flex", gap: 8, alignItems: "center", background: C.paper, borderRadius: R.sm, padding: "8px 10px", marginBottom: 6 }}>
            <span style={{ flex: 1, minWidth: 0, fontWeight: 700, fontSize: T.sm }}>{nombrePerfil(m.usuario_id)}</span>
            <Selector style={{ width: 140, minHeight: 36 }} value={m.rol_proyecto} onChange={(e) => setEquipo(equipo.map((x, j) => (j === i ? { ...x, rol_proyecto: e.target.value } : x)))} opciones={ROLES} />
            <button type="button" onClick={() => setEquipo(equipo.filter((_, j) => j !== i))} style={{ border: "none", background: "none", color: C.danger, fontWeight: 700, cursor: "pointer", minHeight: 36 }}>Quitar</button>
          </div>
        ))}
        {disponibles.length > 0 && (
          <Campo etiqueta="Agregar integrante">
            <Selector data-agregar-integrante value="" onChange={(e) => e.target.value && setEquipo([...equipo, { usuario_id: e.target.value, rol_proyecto: "editor" }])} vacio="Elige una persona…" opciones={disponibles.map((p) => ({ v: p.id, l: p.nombre }))} />
          </Campo>
        )}
      </>)}
      {editar && <div style={{ fontSize: T.small, color: C.inkFaint, lineHeight: 1.45 }}>Código {proyecto.codigo} y centro de costo {proyecto.centro_costo}: no se modifican. Rubro del cliente: {rubroDe(clientes.find((c) => c.id === f.cliente_id)?.rubro)?.l || "—"}.</div>}
    </Ventana>
  );
}
