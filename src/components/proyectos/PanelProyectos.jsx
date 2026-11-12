// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Proyectos Industriales (línea de negocio PI) — pantalla autocontenida.
// Separada de Mercado Público: solo lee y escribe tablas pi_* (y lee perfiles para mostrar nombres).
// Carga sus datos al abrir la pantalla. Si la migración aún no está instalada, informa «aún no está activado»
// y no ofrece ninguna acción. Enlace directo: #/proyectos/PI-AAAA-NNN abre la ficha del proyecto.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useState } from "react";
import { C, MONO, R, S, T, cardStyle } from "../../lib/theme";
import { Badge, Pestanas, AvisoLinea, Seccion } from "../ui/Sistema";
import { Ic } from "../ui/Iconos";
import { BarraAvance, BadgeEstado, Selector, Vacio, PedirMotivo, estiloBoton } from "./Comunes";
import { FormProyecto } from "./FormProyecto";
import { FichaProyecto } from "./FichaProyecto";
import { ESTADOS, FILTROS, filtrar, ordenar, indicadores, formatoMonto, formatoFecha, textoPlazo, etiqueta, tipoDe, ACTIVOS, mensajeError } from "../../lib/proyectos";
import { estadoModulo, listarProyectos, leerProyecto, listarPerfiles, listarClientes, configurarDocumentos } from "../../lib/proyectosDatos";
import { detalleDesdeHash, hashProyecto } from "../../lib/navegacion";

export function PanelProyectos({ token, perfil, showToast }) {
  const yo = perfil?.id; const esAdmin = perfil?.rol === "admin";
  const [modulo, setModulo] = useState(null);           // null = cargando · {instalado, documentosHabilitados}
  const [filas, setFilas] = useState([]); const [perfiles, setPerfiles] = useState([]); const [clientes, setClientes] = useState([]);
  const [error, setError] = useState("");
  const [filtro, setFiltro] = useState("todos"); const [texto, setTexto] = useState(""); const [estado, setEstado] = useState(""); const [resp, setResp] = useState("");
  const [abierto, setAbierto] = useState(() => detalleDesdeHash(window.location.hash));   // código del proyecto abierto
  const [form, setForm] = useState(null);                // null · {nuevo:true} · {proyecto}
  const [confDoc, setConfDoc] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const m = await estadoModulo(token); setModulo(m);
      if (!m.instalado) return;
      const [pr, pf, cl] = await Promise.all([listarProyectos(token), listarPerfiles(token), listarClientes(token)]);
      setFilas(pr || []); setPerfiles(pf || []); setClientes(cl || []); setError("");
    } catch (e) { setError(mensajeError(e)); setModulo((m) => m || { instalado: true, documentosHabilitados: false }); }
  }, [token]);
  useEffect(() => { cargar(); }, [cargar]);

  // Enlace directo y atrás/adelante: la dirección #/proyectos/CÓDIGO abre la ficha; #/proyectos la cierra.
  useEffect(() => {
    const sync = () => setAbierto(detalleDesdeHash(window.location.hash));
    window.addEventListener("popstate", sync); window.addEventListener("hashchange", sync);
    return () => { window.removeEventListener("popstate", sync); window.removeEventListener("hashchange", sync); };
  }, []);
  const abrir = (codigo) => { if (window.location.hash !== hashProyecto(codigo)) window.history.pushState(null, "", hashProyecto(codigo)); setAbierto(codigo); };
  const cerrar = () => { if (detalleDesdeHash(window.location.hash)) window.history.pushState(null, "", hashProyecto(null)); setAbierto(null); };

  // Relee un proyecto (tras guardar) sin recargar toda la pantalla.
  const recargarProyecto = useCallback(async (codigo) => {
    try {
      const r = await leerProyecto(token, { codigo });
      setFilas((xs) => (r ? (xs.some((x) => x.codigo === codigo) ? xs.map((x) => (x.codigo === codigo ? r : x)) : [r, ...xs]) : xs.filter((x) => x.codigo !== codigo)));
    } catch (e) { showToast(mensajeError(e), "error"); }
  }, [token, showToast]);

  const visibles = useMemo(() => ordenar(filtrar(filas, { filtro, texto, estado, responsable: resp })), [filas, filtro, texto, estado, resp]);
  const ind = useMemo(() => indicadores(filas), [filas]);
  const responsables = useMemo(() => [...new Map(filas.map((p) => [p.responsable_id, p.responsable_nombre || "—"])).entries()].map(([v, l]) => ({ v, l })).sort((a, b) => a.l.localeCompare(b.l)), [filas]);
  const proyectoAbierto = abierto ? filas.find((p) => p.codigo === abierto) : null;

  if (modulo === null) return <Vacio>Cargando Proyectos Industriales…</Vacio>;
  if (!modulo.instalado) return (
    <div data-pi-no-instalado style={{ ...cardStyle, padding: "18px 20px" }}>
      <div style={{ fontWeight: 700, fontSize: T.title, color: C.ink, marginBottom: 6 }}>Proyectos Industriales aún no está activado</div>
      <div style={{ fontSize: T.sm, color: C.inkMuted, lineHeight: 1.5 }}>El módulo se activa al instalar su migración en la base de datos. Mientras tanto no se guarda nada y Mercado Público funciona igual que siempre.</div>
    </div>
  );

  return (
    <div data-panel-proyectos>
      {/* Acción principal primero (como en el resto de las listas); la explicación, en una línea discreta a su lado. */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: S.md }}>
        <button type="button" data-nuevo-proyecto onClick={() => setForm({ nuevo: true })} style={{ ...estiloBoton("pri"), minHeight: 44, padding: "10px 16px" }}>+ Nuevo proyecto</button>
        <div style={{ fontSize: T.small, color: C.inkFaint, flex: "1 1 240px", lineHeight: 1.45 }}>Línea separada de Mercado Público. {esAdmin ? "Como administrador ves todos los proyectos." : "Ves los proyectos donde integras el equipo."}</div>
      </div>
      {error && <AvisoLinea tono="danger" dato="error-carga">{error}</AvisoLinea>}
      {ind.propuestas > 0 && (
        <AvisoLinea tono="info" icono="⏳" dato="propuestas" onClick={() => setFiltro("propuestas")} accion="Ver">
          {esAdmin ? `${ind.propuestas} ${ind.propuestas === 1 ? "propuesta esperando tu autorización" : "propuestas esperando tu autorización"}` : `${ind.propuestas} ${ind.propuestas === 1 ? "propuesta esperando" : "propuestas esperando"} la autorización de un administrador`}
        </AvisoLinea>
      )}
      {esAdmin && (
        <div data-config-documentos={modulo.documentosHabilitados ? "habilitada" : "deshabilitada"} style={{ ...cardStyle, borderRadius: R.md, padding: "10px 14px", marginBottom: S.md, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <Ic n="🔒" color={modulo.documentosHabilitados ? C.ok : C.warn} />
          <span style={{ flex: "1 1 220px", fontSize: T.sm, color: C.ink }}>Carga de documentos: <b>{modulo.documentosHabilitados ? "habilitada" : "deshabilitada"}</b>
            <span style={{ display: "block", fontSize: T.small, color: C.inkFaint }}>{modulo.documentosHabilitados ? (modulo.motivoDocumentos || "") : "Se habilita cuando el respaldo diario de archivos esté activo."}</span></span>
          <button type="button" data-alternar-documentos onClick={() => setConfDoc(true)} style={estiloBoton(modulo.documentosHabilitados ? "peligro" : "sec")}>{modulo.documentosHabilitados ? "Deshabilitar" : "Habilitar"}</button>
        </div>
      )}

      <div data-indicadores-pi style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: S.sm, marginBottom: S.lg }}>
        <Kpi dato="activos" et="Activos" v={ind.activos} n={[`${ind.enEjecucion} en ejecución`, `${ind.porIniciar} por iniciar`, ind.suspendidos ? `${ind.suspendidos} suspendidos` : null].filter(Boolean).join(" · ")} onClick={() => setFiltro("activos")} />
        <Kpi dato="atraso" et="Con atraso" v={ind.conAtraso} tono={ind.conAtraso ? "danger" : "ok"} n={ind.conAtraso ? "Revisa actividades, hitos y entregables vencidos" : "Ningún proyecto activo atrasado"} onClick={() => setFiltro("atraso")} />
        <Kpi dato="finalizados" et="Finalizados y cerrados" v={ind.finalizados} onClick={() => setFiltro("finalizados")} />
        <Kpi dato="presupuesto" et="Presupuesto inicial activos (neto)" v={ind.presupuesto.length ? formatoMonto(ind.presupuesto[0].monto, ind.presupuesto[0].moneda) : "—"}
          n={[ind.presupuesto.slice(1).map((x) => `+ ${formatoMonto(x.monto, x.moneda)}`).join(" · "), ind.presupuesto.length > 1 ? "(otras monedas, no se suman)" : null, "Línea base, sin IVA.", ind.reservados ? `${ind.reservados} con datos reservados.` : null].filter(Boolean).join(" ")} />
      </div>

      <Seccion titulo={`${visibles.length} proyecto${visibles.length === 1 ? "" : "s"}`}>
        <input data-buscar-proyectos value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar por código, nombre, cliente, mandante o ubicación"
          style={{ width: "100%", minHeight: 42, padding: "10px 12px", marginBottom: S.sm }} />
        <Pestanas etiqueta="Filtro de proyectos" activa={filtro} onCambiar={setFiltro} variante="chips"
          items={FILTROS.filter((x) => x.v !== "propuestas" || ind.propuestas > 0 || filtro === "propuestas").map((x) => ({ key: x.v, label: x.l, n: x.v === "propuestas" ? ind.propuestas : x.v === "atraso" ? ind.conAtraso : null, tono: x.v === "atraso" ? "danger" : null }))} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: S.sm, marginBottom: S.md }}>
          <Selector data-filtro-estado value={estado} onChange={(e) => setEstado(e.target.value)} vacio="Todos los estados" opciones={ESTADOS} />
          <Selector data-filtro-responsable value={resp} onChange={(e) => setResp(e.target.value)} vacio="Todos los responsables" opciones={responsables} />
        </div>
        {!filas.length && <Vacio dato="sin-proyectos">{esAdmin ? "Aún no hay proyectos industriales." : "No integras el equipo de ningún proyecto industrial."} Crea uno con «+ Nuevo proyecto».</Vacio>}
        {filas.length > 0 && !visibles.length && <Vacio dato="sin-resultados">Ningún proyecto coincide con la búsqueda o los filtros.</Vacio>}
        {visibles.map((p) => <TarjetaProyecto key={p.id} p={p} onAbrir={() => abrir(p.codigo)} />)}
      </Seccion>

      {abierto && !proyectoAbierto && filas.length > 0 && (
        <AvisoLinea tono="warn" dato="proyecto-no-visible" onClick={cerrar} accion="Cerrar">No tienes acceso al proyecto {abierto} o no existe.</AvisoLinea>
      )}
      {proyectoAbierto && (
        <FichaProyecto token={token} yo={yo} proyecto={proyectoAbierto} perfiles={perfiles} clientes={clientes} modulo={modulo} showToast={showToast}
          onCerrar={cerrar} onRecargar={recargarProyecto} onEditar={() => setForm({ proyecto: proyectoAbierto })} />
      )}
      {form && (
        <FormProyecto token={token} yo={yo} esAdmin={esAdmin} perfiles={perfiles} clientes={clientes} proyecto={form.proyecto} showToast={showToast}
          onCerrar={() => setForm(null)} onClienteCreado={(c) => setClientes((xs) => [...xs, c].sort((a, b) => a.razon_social.localeCompare(b.razon_social)))}
          onGuardado={async (codigo, opc) => { if (!opc?.recargar) setForm(null); await recargarProyecto(codigo); if (!opc?.recargar && form.nuevo) abrir(codigo); }} />
      )}
      {confDoc && (
        <PedirMotivo titulo={modulo.documentosHabilitados ? "Deshabilitar la carga de documentos" : "Habilitar la carga de documentos"} etiquetaBoton={modulo.documentosHabilitados ? "Deshabilitar" : "Habilitar"}
          texto={modulo.documentosHabilitados ? "Los documentos ya subidos se siguen viendo y descargando; no se podrán subir nuevos." : "Habilita la carga solo cuando el respaldo diario de archivos esté activo y verificado. El cambio queda en el historial."}
          onCancelar={() => setConfDoc(false)} onConfirmar={async (m) => {
            try { await configurarDocumentos(token, !modulo.documentosHabilitados, m); showToast(modulo.documentosHabilitados ? "Carga de documentos deshabilitada" : "Carga de documentos habilitada"); }
            catch (e) { showToast(mensajeError(e), "error"); }
            setConfDoc(false); await cargar(); }} />
      )}
    </div>
  );
}

function Kpi({ et, v, n, tono, onClick, dato }) {
  const col = { danger: C.dangerText, ok: C.okText }[tono] || C.ink;
  const Tag = onClick ? "button" : "div";
  return (
    <Tag type={onClick ? "button" : undefined} data-kpi-pi={dato} onClick={onClick} style={{ ...cardStyle, borderRadius: R.md, padding: "12px 14px", minWidth: 0, textAlign: "left", font: "inherit", cursor: onClick ? "pointer" : "default", width: "100%", boxSizing: "border-box" }}>
      <span style={{ display: "block", fontSize: T.small, fontWeight: 700, color: C.inkMuted }}>{et}</span>
      <span data-kpi-valor style={{ display: "block", fontFamily: MONO, fontWeight: 700, fontSize: 18, letterSpacing: -0.5, color: col, marginTop: 4, overflowWrap: "anywhere" }}>{v}</span>
      {n && <span style={{ display: "block", fontSize: T.small, color: C.inkFaint, marginTop: 3, lineHeight: 1.4 }}>{n}</span>}
    </Tag>
  );
}

function TarjetaProyecto({ p, onAbrir }) {
  const activo = ACTIVOS.includes(p.estado);
  const plazo = textoPlazo(p);
  const vencidos = [p.n_actividades_atrasadas ? `${p.n_actividades_atrasadas} act.` : null, p.n_hitos_vencidos ? `${p.n_hitos_vencidos} hito${p.n_hitos_vencidos > 1 ? "s" : ""}` : null, p.n_entregables_vencidos ? `${p.n_entregables_vencidos} entreg.` : null].filter(Boolean);
  return (
    <button type="button" data-proyecto={p.codigo} data-atrasado={p.atrasado ? "si" : "no"} onClick={onAbrir}
      style={{ ...cardStyle, width: "100%", boxSizing: "border-box", textAlign: "left", font: "inherit", color: "inherit", cursor: "pointer", display: "block", padding: "12px 16px", marginBottom: S.sm, borderLeft: `4px solid ${p.atrasado ? C.danger : activo ? C.teal : p.estado === "propuesta" ? C.info : C.border}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: MONO, fontSize: T.small, fontWeight: 700, color: C.tealDark }}>{p.codigo}</div>
          <div style={{ fontWeight: 700, fontSize: T.title, color: C.ink, overflowWrap: "anywhere" }}>{p.nombre}</div>
          <div style={{ fontSize: T.small, color: C.inkMuted, marginTop: 1, overflowWrap: "anywhere" }}>
            {[p.cliente_nombre, p.mandante_nombre ? `mandante ${p.mandante_nombre}` : null, etiqueta(tipoDe, p.tipo), p.ubicacion].filter(Boolean).join(" · ")}
          </div>
        </div>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end", flexShrink: 0 }}>
          <BadgeEstado estado={p.estado} />
          {activo && (p.atrasado ? <Badge tono="danger">Con atraso</Badge> : <Badge tono="ok">Al día</Badge>)}
        </div>
      </div>
      {p.estado !== "propuesta" && p.estado !== "anulado" && <BarraAvance real={p.avance_real} planificado={p.avance_planificado} atrasado={p.atrasado} dato={p.codigo} />}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: T.small, color: C.inkMuted, marginTop: 4 }}>
        <span>👤 {p.responsable_nombre || "—"}</span>
        <span>{formatoFecha(p.fecha_inicio_prevista)} → {formatoFecha(p.fecha_termino_prevista)}</span>
        {plazo && <span style={{ color: activo && Number(p.dias_restantes) <= 15 ? C.dangerText : C.inkMuted, fontWeight: activo && Number(p.dias_restantes) <= 15 ? 700 : 400 }}>{plazo}</span>}
        <span data-presupuesto-tarjeta style={{ fontFamily: MONO }}>{p.ve_economia ? (p.presupuesto_inicial === null || p.presupuesto_inicial === undefined ? "sin presupuesto" : `${formatoMonto(p.presupuesto_inicial, p.moneda)} neto`) : "Datos económicos reservados"}</span>
        {vencidos.length > 0 && <span style={{ color: C.dangerText, fontWeight: 700 }}>⚠ {vencidos.join(" · ")} vencidos</span>}
      </div>
    </button>
  );
}
