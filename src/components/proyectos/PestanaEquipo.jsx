// Proyectos Industriales — equipo del proyecto y su rol (jefe · editor · lector) y autorización de datos económicos.
// La base: el responsable principal es siempre jefe activo; solo el jefe (o el administrador) gestiona el equipo;
// solo el administrador o el responsable principal otorga o retira «Datos económicos».
import { useEffect, useState } from "react";
import { C, R, S, T, cardStyle, btnMini } from "../../lib/theme";
import { Badge, Seccion } from "../ui/Sistema";
import { Ventana, Campo, Entrada, Selector, ErrorForm, Vacio, estiloBoton } from "./Comunes";
import { ROLES, rolDe, mensajeError } from "../../lib/proyectos";
import { listarEquipo, agregarIntegrante, actualizarIntegrante } from "../../lib/proyectosDatos";

export function PestanaEquipo({ token, proyecto: p, per, nombres, perfiles, version, onCambio, showToast }) {
  const [filas, setFilas] = useState(null); const [error, setError] = useState(""); const [agregar, setAgregar] = useState(false); const [ocupado, setOcupado] = useState(null);
  const cargar = async () => { try { setFilas((await listarEquipo(token, p.id)) || []); setError(""); } catch (e) { setError(mensajeError(e)); setFilas([]); } };
  useEffect(() => { cargar(); }, [p.id, version]); // eslint-disable-line react-hooks/exhaustive-deps
  async function cambiar(fila, cambios, msg) {
    setOcupado(fila.id);
    try { await actualizarIntegrante(token, fila, cambios); showToast(msg); } catch (e) { showToast(mensajeError(e), "error"); }
    await cargar(); await onCambio(); setOcupado(null);
  }
  if (filas === null) return <Vacio>Cargando equipo…</Vacio>;
  const activos = filas.filter((f) => f.activo); const inactivos = filas.filter((f) => !f.activo);
  const Integrante = ({ f }) => {
    const esResp = f.usuario_id === p.responsable_id;
    const verEco = esResp || f.ve_economia;
    return (
      <div data-integrante={nombres[f.usuario_id] || f.usuario_id} style={{ ...cardStyle, borderRadius: R.md, padding: "12px 14px", marginBottom: S.sm, opacity: f.activo ? 1 : 0.6 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontWeight: 700, color: C.ink }}>{nombres[f.usuario_id] || "Usuario"}</span>
          <Badge tono={f.rol_proyecto === "jefe" ? "info" : "neutro"}><span data-rol-integrante={f.rol_proyecto}>{rolDe(f.rol_proyecto)?.l}</span></Badge>
          {esResp && <Badge tono="ok">Responsable principal</Badge>}
          {verEco && <Badge tono="neutro"><span data-ve-economia>Datos económicos</span></Badge>}
          {!f.activo && <Badge tono="danger">Inactivo</Badge>}
        </div>
        {f.funcion && <div style={{ fontSize: T.small, color: C.inkMuted, marginTop: 2 }}>{f.funcion}</div>}
        {(per.gestionarEquipo || per.autorizarEconomia) && !esResp && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8, alignItems: "center" }}>
            {per.gestionarEquipo && f.activo && <Selector data-cambiar-rol={nombres[f.usuario_id]} style={{ width: 170, minHeight: 34 }} value={f.rol_proyecto} disabled={ocupado === f.id}
              onChange={(e) => cambiar(f, { rol_proyecto: e.target.value }, "Rol actualizado")} opciones={ROLES} />}
            {per.autorizarEconomia && f.activo && <button type="button" data-economia={nombres[f.usuario_id]} disabled={ocupado === f.id} onClick={() => cambiar(f, { ve_economia: !f.ve_economia }, f.ve_economia ? "Se retiró la autorización económica" : "Autorizado a ver los datos económicos")}
              style={btnMini()}>{f.ve_economia ? "Retirar datos económicos" : "Autorizar datos económicos"}</button>}
            {per.gestionarEquipo && <button type="button" data-activo={nombres[f.usuario_id]} disabled={ocupado === f.id} onClick={() => cambiar(f, { activo: !f.activo }, f.activo ? "Integrante desactivado" : "Integrante reactivado")}
              style={btnMini(f.activo ? "peligro" : "sec")}>{f.activo ? "Quitar del equipo" : "Reactivar"}</button>}
          </div>
        )}
      </div>
    );
  };
  return (
    <Seccion titulo={`Equipo · ${activos.length}`} accion={per.gestionarEquipo && <button type="button" data-agregar-integrante onClick={() => setAgregar(true)} style={estiloBoton("pri")}>+ Integrante</button>}
      nota="Jefe: edita datos, equipo, estados y contenido. Editor: actividades, hitos, entregables y documentos. Lector: solo consulta y descarga. Los datos económicos los ven el administrador, el responsable principal y quienes ellos autoricen.">
      {error && <ErrorForm>{error}</ErrorForm>}
      {activos.map((f) => <Integrante key={f.id} f={f} />)}
      {inactivos.length > 0 && <div style={{ fontSize: T.small, fontWeight: 700, color: C.inkMuted, margin: "12px 0 6px" }}>Ya no integran el equipo</div>}
      {inactivos.map((f) => <Integrante key={f.id} f={f} />)}
      {agregar && <FormIntegrante token={token} proyecto={p} perfiles={perfiles} filas={filas} puedeEconomia={per.autorizarEconomia} onCerrar={() => setAgregar(false)}
        onGuardado={async () => { setAgregar(false); showToast("Integrante agregado"); await cargar(); await onCambio(); }} />}
    </Seccion>
  );
}

function FormIntegrante({ token, proyecto: p, perfiles, filas, puedeEconomia, onCerrar, onGuardado }) {
  const disponibles = perfiles.filter((x) => !filas.some((f) => f.usuario_id === x.id && f.activo));
  const [u, setU] = useState(""); const [rol, setRol] = useState("editor"); const [funcion, setFuncion] = useState(""); const [eco, setEco] = useState(false);
  const [err, setErr] = useState(""); const [ocupado, setOcupado] = useState(false);
  async function guardar() {
    if (!u) { setErr("Elige a la persona."); return; }
    setOcupado(true);
    try { await agregarIntegrante(token, p.id, { usuario_id: u, rol_proyecto: rol, funcion: funcion.trim(), ve_economia: puedeEconomia ? eco : undefined }, filas.find((f) => f.usuario_id === u)); await onGuardado(); }
    catch (e) { setErr(mensajeError(e)); }
    finally { setOcupado(false); }
  }
  return (
    <Ventana titulo="Agregar integrante" onCerrar={onCerrar} dato="integrante" ancho={480}
      pie={<><button type="button" onClick={onCerrar} style={estiloBoton()}>Cancelar</button><button type="button" data-guardar-integrante disabled={ocupado} onClick={guardar} style={estiloBoton("pri")}>Agregar</button></>}>
      <ErrorForm>{err}</ErrorForm>
      {!disponibles.length && <Vacio>Todos los usuarios BFK ya integran el equipo.</Vacio>}
      <Campo etiqueta="Persona" ayuda="Solo usuarios autorizados en BFK."><Selector data-campo="usuario" value={u} onChange={(e) => { setU(e.target.value); setErr(""); }} vacio="Elige…" opciones={disponibles.map((x) => ({ v: x.id, l: x.nombre }))} /></Campo>
      <Campo etiqueta="Rol en el proyecto"><Selector data-campo="rol" value={rol} onChange={(e) => setRol(e.target.value)} opciones={ROLES} /></Campo>
      <Campo etiqueta="Función (opcional)"><Entrada value={funcion} onChange={(e) => setFuncion(e.target.value)} maxLength={150} placeholder="Ej.: Ingeniero de automatización" /></Campo>
      {puedeEconomia && <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: T.sm, cursor: "pointer" }}><input type="checkbox" data-campo="economia" checked={eco} onChange={(e) => setEco(e.target.checked)} style={{ width: 20, height: 20 }} /> Puede ver los datos económicos</label>}
    </Ventana>
  );
}
