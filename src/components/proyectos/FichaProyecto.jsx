// Proyectos Industriales — ficha del proyecto (panel lateral en PC, pantalla completa en el celular).
// Pestañas: Resumen · Actividades · Entregables e hitos · Documentos · Equipo · Historial.
// Los cálculos (avance, atrasos, plazo) vienen de la vista pi_proyectos_resumen; los permisos los aplica la base.
import { useState } from "react";
import { C, MONO, R, S, T, cardStyle } from "../../lib/theme";
import { Badge, HojaLateral, Pestanas, PanelPestana, AvisoLinea, Seccion } from "../ui/Sistema";
import { BarraAvance, BadgeEstado, PedirMotivo, Ventana, Campo, Rejilla, Entrada, Selector, ErrorForm, estiloBoton } from "./Comunes";
import { permisos, accionesEstado, razonesAtraso, textoPlazo, formatoMonto, formatoFecha, formatoPct, etiqueta, tipoDe, especialidadDe, rubroDe, rolDe, monedaDe,
  ACTIVOS, MONEDAS, leerMonto, mensajeError } from "../../lib/proyectos";
import { cambiarEstado, actualizarEconomia } from "../../lib/proyectosDatos";
import { PestanaActividades } from "./PestanaActividades";
import { PestanaEntregables } from "./PestanaEntregables";
import { PestanaDocumentos } from "./PestanaDocumentos";
import { PestanaEquipo } from "./PestanaEquipo";
import { PestanaHistorial } from "./PestanaHistorial";

export function FichaProyecto({ token, yo, proyecto, perfiles, clientes, modulo, onCerrar, onRecargar, onEditar, showToast }) {
  const [pestana, setPestana] = useState("resumen");
  const [version, setVersion] = useState(0);   // al guardar en una pestaña, se recargan las demás
  const p = { ...proyecto, _yo: yo };
  const per = permisos(p);
  const nombres = Object.fromEntries(perfiles.map((x) => [x.id, x.nombre]));
  const cambio = async () => { setVersion((v) => v + 1); await onRecargar(proyecto.codigo); };
  const items = [
    { key: "resumen", label: "Resumen" },
    { key: "actividades", label: "Actividades", n: proyecto.n_actividades || null, tono: proyecto.n_actividades_atrasadas ? "danger" : null },
    { key: "entregables", label: "Entregables e hitos", n: (proyecto.n_entregables_vencidos || 0) + (proyecto.n_hitos_vencidos || 0) || null, tono: "danger" },
    { key: "documentos", label: "Documentos", n: proyecto.n_documentos || null },
    { key: "equipo", label: "Equipo", n: proyecto.n_equipo || null },
    { key: "historial", label: "Historial" },
  ];
  const comunes = { token, yo, proyecto: p, per, nombres, perfiles, version, onCambio: cambio, showToast };
  return (
    <HojaLateral abierta onCerrar={onCerrar} dato={proyecto.codigo} ancho={860}
      titulo={`${proyecto.codigo} · ${proyecto.nombre}`}
      subtitulo={`${proyecto.cliente_nombre || "—"} · ${ESTADO_TXT[proyecto.estado] || proyecto.estado}`}
      derecha={<Badge tono="info" style={{ flexShrink: 0 }}><span data-mi-rol={per.rol}>{rolDe(per.rol)?.l || "Sin acceso"}</span></Badge>}>
      <div data-ficha-proyecto={proyecto.codigo} style={{ padding: S.lg, maxWidth: 900 }}>
        <Pestanas etiqueta="Ficha del proyecto" activa={pestana} onCambiar={setPestana} items={items} compacta />
        <PanelPestana visible={pestana === "resumen"} titulo="Resumen">
          <Resumen {...comunes} clientes={clientes} onEditar={onEditar} />
        </PanelPestana>
        <PanelPestana visible={pestana === "actividades"} titulo="Actividades">{pestana === "actividades" && <PestanaActividades {...comunes} />}</PanelPestana>
        <PanelPestana visible={pestana === "entregables"} titulo="Entregables e hitos">{pestana === "entregables" && <PestanaEntregables {...comunes} />}</PanelPestana>
        <PanelPestana visible={pestana === "documentos"} titulo="Documentos">{pestana === "documentos" && <PestanaDocumentos {...comunes} modulo={modulo} />}</PanelPestana>
        <PanelPestana visible={pestana === "equipo"} titulo="Equipo">{pestana === "equipo" && <PestanaEquipo {...comunes} />}</PanelPestana>
        <PanelPestana visible={pestana === "historial"} titulo="Historial">{pestana === "historial" && <PestanaHistorial {...comunes} />}</PanelPestana>
      </div>
    </HojaLateral>
  );
}
const ESTADO_TXT = { propuesta: "Propuesta", por_iniciar: "Por iniciar", en_ejecucion: "En ejecución", suspendido: "Suspendido", finalizado: "Finalizado", cerrado: "Cerrado", anulado: "Anulado" };

function Kpi({ etiqueta: et, valor, nota, tono, dato }) {
  const col = { danger: C.dangerText, ok: C.okText, warn: C.warnText }[tono] || C.ink;
  return (
    <div data-kpi={dato} style={{ ...cardStyle, borderRadius: R.md, padding: "12px 14px", minWidth: 0 }}>
      <div style={{ fontSize: T.small, fontWeight: 700, color: C.inkMuted }}>{et}</div>
      <div data-kpi-valor style={{ fontFamily: MONO, fontWeight: 700, fontSize: 20, color: col, marginTop: 4, overflowWrap: "anywhere" }}>{valor}</div>
      {nota && <div style={{ fontSize: T.small, color: C.inkFaint, marginTop: 3, lineHeight: 1.4 }}>{nota}</div>}
    </div>
  );
}

function Resumen({ token, proyecto: p, per, nombres, clientes, onCambio, onEditar, showToast }) {
  const [pidiendo, setPidiendo] = useState(null);   // acción que requiere motivo o confirmación
  const [ocupado, setOcupado] = useState(false);
  const [editEco, setEditEco] = useState(false);
  const razones = razonesAtraso(p);
  const activo = ACTIVOS.includes(p.estado);
  const acciones = accionesEstado(p);
  const cliente = clientes.find((c) => c.id === p.cliente_id);
  const plazo = textoPlazo(p);

  async function ejecutar(acc, motivo) {
    setOcupado(true);
    try {
      await cambiarEstado(token, p.id, acc.estado, motivo, p.version);
      showToast(`${acc.etiqueta}: listo`); setPidiendo(null); await onCambio();
    } catch (e) { showToast(mensajeError(e), "error"); setPidiendo(null); await onCambio(); }
    finally { setOcupado(false); }
  }
  const pedir = (acc) => (acc.motivo || acc.peligro || acc.estado === "cerrado" || acc.estado === "por_iniciar") ? setPidiendo(acc) : ejecutar(acc, null);

  return (
    <div data-resumen-proyecto>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
        <BadgeEstado estado={p.estado} />
        {activo && (p.atrasado ? <Badge tono="danger"><span data-atraso="si">Con atraso</span></Badge> : <Badge tono="ok"><span data-atraso="no">Al día</span></Badge>)}
        <span style={{ fontFamily: MONO, fontSize: T.small, color: C.inkMuted }}>PI · centro de costo {p.centro_costo}</span>
      </div>
      {p.estado === "propuesta" && (
        <AvisoLinea tono="info" icono="⏳" dato="propuesta">{per.admin ? "Propuesta: autoriza su activación o recházala con un motivo." : "Propuesta esperando la autorización de un administrador para activarse."}</AvisoLinea>
      )}
      {p.motivo_estado && ["suspendido", "anulado"].includes(p.estado) && <AvisoLinea tono="warn" dato="motivo-estado">Motivo: {p.motivo_estado}</AvisoLinea>}
      {razones.map((r) => <AvisoLinea key={r} tono="danger" dato="razon-atraso">{r}</AvisoLinea>)}

      <div style={{ ...cardStyle, padding: "14px 16px", marginBottom: S.md }}>
        <div style={{ fontSize: T.small, fontWeight: 700, color: C.inkMuted, textTransform: "uppercase", letterSpacing: 0.5 }}>Avance físico</div>
        <BarraAvance real={p.avance_real} planificado={p.avance_planificado} atrasado={p.atrasado} alto={10} dato="ficha" />
        <div style={{ fontSize: T.small, color: C.inkFaint, marginTop: 4, lineHeight: 1.45 }}>
          {p.n_actividades ? `Ponderado por el peso de ${p.n_actividades} ${p.n_actividades === 1 ? "actividad" : "actividades"} sin subtareas · ${p.n_actividades_completadas} ${p.n_actividades_completadas === 1 ? "completada" : "completadas"}. La línea negra marca lo planificado a hoy.` : "Sin actividades: el avance se calcula cuando se registran actividades con su peso."}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: S.sm, marginBottom: S.md }}>
        <Kpi dato="plazo" etiqueta="Plazo" valor={p.dias_restantes === null || p.dias_restantes === undefined ? "—" : `${p.dias_restantes} días`} nota={plazo || (p.fecha_termino_prevista ? `Término previsto ${formatoFecha(p.fecha_termino_prevista)}` : "Sin término previsto")}
          tono={activo && Number(p.dias_restantes) < 0 ? "danger" : activo && Number(p.dias_restantes) <= 15 ? "danger" : undefined} />
        {per.verEconomia ? (
          <Kpi dato="presupuesto" etiqueta="Presupuesto inicial (neto, sin IVA)" valor={p.presupuesto_inicial === null || p.presupuesto_inicial === undefined ? "Sin registrar" : formatoMonto(p.presupuesto_inicial, p.moneda)}
            nota={`${monedaDe(p.moneda)?.l || p.moneda}. Línea base; no es gasto ni facturación.`} />
        ) : (
          <Kpi dato="presupuesto-reservado" etiqueta="Presupuesto inicial" valor="Reservados" nota="Los datos económicos los ven el administrador, el responsable principal y quienes ellos autoricen." />
        )}
        <Kpi dato="act-atrasadas" etiqueta="Actividades atrasadas" valor={p.n_actividades_atrasadas} tono={p.n_actividades_atrasadas ? "danger" : "ok"} nota={`${p.n_actividades} en el cálculo de avance`} />
        <Kpi dato="hitos-vencidos" etiqueta="Hitos vencidos" valor={p.n_hitos_vencidos} tono={p.n_hitos_vencidos ? "danger" : "ok"}
          nota={p.proximo_hito_fecha ? `Próximo: ${p.proximo_hito_nombre} (${formatoFecha(p.proximo_hito_fecha)})` : p.n_hitos ? "Sin hitos pendientes por venir" : "Sin hitos pendientes"} />
        <Kpi dato="entregables-pendientes" etiqueta="Entregables pendientes" valor={p.n_entregables_pendientes} tono={p.n_entregables_vencidos ? "danger" : undefined}
          nota={p.n_entregables_vencidos ? `${p.n_entregables_vencidos} con fecha vencida` : `${p.n_entregables} en total`} />
        <Kpi dato="documentos" etiqueta="Documentos vigentes" valor={p.n_documentos} nota={`Equipo: ${p.n_equipo} ${p.n_equipo === 1 ? "persona" : "personas"}`} />
      </div>

      {(per.editarDatos || per.editarEconomia || acciones.length > 0) && (
        <div data-acciones-proyecto style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: S.lg }}>
          {per.editarDatos && <button type="button" data-accion="editar" onClick={onEditar} style={estiloBoton()}>✏️ Editar datos</button>}
          {per.editarEconomia && <button type="button" data-accion="editar-presupuesto" onClick={() => setEditEco(true)} style={estiloBoton()}>Presupuesto inicial</button>}
          {acciones.map((a) => (
            <button key={a.estado} type="button" data-accion-estado={a.estado} disabled={ocupado} onClick={() => pedir(a)} style={estiloBoton(a.peligro ? "peligro" : a.estado === "por_iniciar" ? "pri" : "sec")}>{a.etiqueta}</button>
          ))}
        </div>
      )}

      <Seccion titulo="Datos del proyecto">
        <div style={{ ...cardStyle, padding: "4px 16px" }}>
          <Dato k="Cliente" v={p.cliente_nombre} nota={[p.cliente_rut, rubroDe(p.cliente_rubro)?.l].filter(Boolean).join(" · ") || null} />
          <Dato k="Mandante" v={p.mandante_nombre || "—"} />
          <Dato k="Tipo" v={etiqueta(tipoDe, p.tipo)} nota={(p.especialidades || []).map((e) => etiqueta(especialidadDe, e)).join(", ") || null} />
          <Dato k="Ubicación" v={p.ubicacion || "—"} nota={[p.comuna, p.region].filter(Boolean).join(", ") || null} />
          <Dato k="Responsable principal" v={p.responsable_nombre || nombres[p.responsable_id] || "—"} />
          <Dato k="Inicio previsto · real" v={`${formatoFecha(p.fecha_inicio_prevista)} · ${formatoFecha(p.fecha_inicio_real)}`} />
          <Dato k="Término previsto · real" v={`${formatoFecha(p.fecha_termino_prevista)} · ${formatoFecha(p.fecha_termino_real)}`} />
          {p.autorizado_en && <Dato k="Activación autorizada" v={formatoFecha(String(p.autorizado_en).slice(0, 10))} nota={`por ${nombres[p.autorizado_por] || "un administrador"}`} />}
          {p.descripcion && <Texto k="Descripción" v={p.descripcion} />}
          {p.alcance_tecnico && <Texto k="Alcance técnico" v={p.alcance_tecnico} />}
          {cliente?.contacto_nombre && <Dato k="Contacto del cliente" v={cliente.contacto_nombre} nota={[cliente.contacto_cargo, cliente.contacto_correo, cliente.contacto_telefono].filter(Boolean).join(" · ") || null} />}
        </div>
      </Seccion>

      {pidiendo && (
        <PedirMotivo titulo={`${pidiendo.etiqueta} · ${p.codigo}`} obligatorio={pidiendo.motivo} peligro={pidiendo.peligro} ocupado={ocupado}
          etiquetaBoton={pidiendo.etiqueta}
          texto={pidiendo.estado === "por_iniciar" && p.estado === "propuesta" ? "Al autorizar, el proyecto pasa a «Por iniciar» y queda registrado quién lo autorizó y cuándo." :
            pidiendo.estado === "cerrado" ? "Un proyecto cerrado queda en solo lectura para el equipo; solo un administrador puede reabrirlo." :
            pidiendo.estado === "anulado" ? "El proyecto queda anulado y en solo lectura. Un administrador puede restaurarlo como propuesta." : null}
          onCancelar={() => setPidiendo(null)} onConfirmar={(m) => ejecutar(pidiendo, m || null)} />
      )}
      {editEco && <EditarPresupuesto token={token} proyecto={p} onCerrar={() => setEditEco(false)} onGuardado={async () => { setEditEco(false); await onCambio(); }} showToast={showToast} />}
    </div>
  );
}

function Dato({ k, v, nota }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "9px 0", borderBottom: `1px solid ${C.border}` }}>
      <span style={{ minWidth: 0 }}><span style={{ display: "block", fontSize: T.sm, fontWeight: 600, color: C.inkMuted }}>{k}</span>
        {nota && <span style={{ display: "block", fontSize: T.small, color: C.inkFaint }}>{nota}</span>}</span>
      <span style={{ fontWeight: 700, fontSize: T.sm, color: C.ink, textAlign: "right", overflowWrap: "anywhere" }}>{v}</span>
    </div>
  );
}
function Texto({ k, v }) {
  return (
    <div style={{ padding: "9px 0", borderBottom: `1px solid ${C.border}` }}>
      <div style={{ fontSize: T.sm, fontWeight: 600, color: C.inkMuted, marginBottom: 4 }}>{k}</div>
      <div style={{ fontSize: T.sm, color: C.ink, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{v}</div>
    </div>
  );
}

function EditarPresupuesto({ token, proyecto: p, onCerrar, onGuardado, showToast }) {
  const [monto, setMonto] = useState(p.presupuesto_inicial === null || p.presupuesto_inicial === undefined ? "" : String(p.presupuesto_inicial).replace(".", ","));
  const [moneda, setMoneda] = useState(p.moneda || "CLP");
  const [err, setErr] = useState(""); const [ocupado, setOcupado] = useState(false);
  const iniciado = !["propuesta", "por_iniciar"].includes(p.estado);
  async function guardar() {
    const m = monto.trim() === "" ? null : leerMonto(monto);
    if (m !== null && (!Number.isFinite(m) || m < 0)) { setErr("Monto no válido."); return; }
    setOcupado(true);
    try { await actualizarEconomia(token, p.id, p.version_economia, { presupuesto_inicial: m, moneda }); showToast("Presupuesto inicial guardado"); await onGuardado(); }
    catch (e) { setErr(mensajeError(e)); }
    finally { setOcupado(false); }
  }
  return (
    <Ventana titulo={`Presupuesto inicial · ${p.codigo}`} onCerrar={onCerrar} dato="presupuesto" ancho={460}
      pie={<><button type="button" onClick={onCerrar} style={estiloBoton()}>Cancelar</button><button type="button" data-guardar-presupuesto disabled={ocupado} onClick={guardar} style={estiloBoton("pri")}>Guardar</button></>}>
      <ErrorForm>{err}</ErrorForm>
      {iniciado && <AvisoLinea tono="warn" dato="presupuesto-iniciado">El proyecto ya inició: el presupuesto es línea base y solo un administrador lo corrige. El cambio queda en el historial.</AvisoLinea>}
      <Rejilla>
        <Campo etiqueta="Monto neto (sin IVA)"><Entrada data-campo="presupuesto" inputMode="decimal" value={monto} onChange={(e) => { setMonto(e.target.value); setErr(""); }} /></Campo>
        <Campo etiqueta="Moneda"><Selector data-campo="moneda" value={moneda} onChange={(e) => setMoneda(e.target.value)} opciones={MONEDAS} /></Campo>
      </Rejilla>
      {monto.trim() !== "" && Number.isFinite(leerMonto(monto)) && <div style={{ fontSize: T.small, color: C.inkMuted }}>Quedará: <b>{formatoMonto(leerMonto(monto), moneda)} neto</b> · sin conversión entre monedas.</div>}
    </Ventana>
  );
}
