// Ventas privadas › Cotizaciones privadas: lista con búsqueda y filtros, ficha con revisiones, edición del borrador,
// PDF para el cliente (sin costos), registro MANUAL de envío/aceptación/rechazo/vencimiento, nueva revisión, duplicar,
// «Crear venta / Registrar OC» y EETT. Pestaña «Biblioteca técnica»: información técnica reutilizable de productos.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { C, MONO, R, S, T, cardStyle } from "../../lib/theme";
import { HojaLateral, Seccion, Pestanas, PanelPestana, AvisoLinea, Badge } from "../ui/Sistema";
import { Ventana, Campo, Rejilla, Subtitulo, Entrada, Area, Selector, ErrorForm, PedirMotivo } from "../proyectos/Comunes";
import { NoInstalado, Vacio, estiloBoton, Fila, BadgeVP, EditorLineas, ResumenTotales, SelectorCliente, lineaVacia, SubirArchivo, ListaDocumentos, Kpi, RejillaKpi } from "./Comunes";
import { FormCliente } from "./PanelClientes";
import { EditorEETT, descargarEETT } from "./EditorEETT";
import { BibliotecaTecnica } from "./BibliotecaTecnica";
import { CrearVentaDesdeCotizacion } from "./NuevaVenta";
import { leerCotizacion, guardarCotizacion, cambiarEstadoCotizacion, nuevaRevision, duplicarCotizacion, historialCotizacion, anular } from "../../lib/ventasPrivadasDatos";
import { lineaParaGuardar, calcularTotales, validarLineas, accionesCotizacion, ESTADOS_COTIZACION, filtrarCotizaciones, pesos, pct, fechaTxt, hoyISO, sumarDias, folioRevision, mensajeVP, documentoDesdeEditor, cantidadTxt } from "../../lib/ventasPrivadas";
import { generarPdfCotizacion } from "../../lib/vpPdf";
import { descargarBlob } from "../../lib/eettPdf";
import { VistaPreviaEETT } from "../cotizaciones/VistaPreviaEETT";
import { logoBFK } from "../../lib/cotizacionesDatos";
import logoUrl from "../../assets/bfk-logo.jpg";
import { folioVPDesdeHash, hashVP } from "../../lib/navegacion";

const FILTROS = [{ v: "", l: "Todos los estados" }, ...["borrador", "enviada", "aceptada", "rechazada", "vencida"].map((k) => ({ v: k, l: ESTADOS_COTIZACION[k].l }))];

export function PanelCotizacionesPrivadas({ token, perfil, vp, onRecargar, showToast, onAbrir, focoId, onFocoUsado, nuevaSolicitada, onNuevaUsada }) {
  const [pestana, setPestana] = useState("cotizaciones");
  const [texto, setTexto] = useState(""); const [estado, setEstado] = useState(""); const [cliente, setCliente] = useState(""); const [desde, setDesde] = useState(""); const [hasta, setHasta] = useState("");
  const [abierta, setAbierta] = useState(null);   // id | "nueva"
  // Enlace directo #/cotizaciones-privadas/CP-AAAA-NNNN
  useEffect(() => {
    const sync = (ev) => { const f = folioVPDesdeHash(window.location.hash, "vp_cotizaciones"); if (!f) { if (ev) setAbierta((a) => (a === "nueva" ? a : null)); return; } { const c = vp.cotizaciones.find((x) => x.folio === f); if (c) setAbierta(c.id); } };
    sync(null); window.addEventListener("popstate", sync); return () => window.removeEventListener("popstate", sync);
  }, [vp.cotizaciones]);
  useEffect(() => { if (focoId) { setAbierta(focoId); setPestana("cotizaciones"); onFocoUsado?.(); } }, [focoId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (nuevaSolicitada) { setAbierta("nueva"); setPestana("cotizaciones"); onNuevaUsada?.(); } }, [nuevaSolicitada]); // eslint-disable-line react-hooks/exhaustive-deps
  const abrir = (id) => { const c = vp.cotizaciones.find((x) => x.id === id); if (c) window.history.pushState(null, "", hashVP("vp_cotizaciones", c.folio)); setAbierta(id); };
  const cerrar = () => { if (folioVPDesdeHash(window.location.hash, "vp_cotizaciones")) window.history.pushState(null, "", hashVP("vp_cotizaciones")); setAbierta(null); };
  const filas = useMemo(() => filtrarCotizaciones(vp.cotizaciones, { texto, estado, cliente, desde, hasta }), [vp.cotizaciones, texto, estado, cliente, desde, hasta]);
  const clientesConCot = useMemo(() => [...new Map(vp.cotizaciones.map((c) => [c.cliente_id, c.cliente_nombre]))].map(([v, l]) => ({ v, l })).sort((a, b) => a.l.localeCompare(b.l)), [vp.cotizaciones]);
  if (!vp.instalado) return <NoInstalado />;
  const ind = { borrador: 0, enviada: 0, aceptada: 0, porVencer: 0, montoEnviado: 0 };
  for (const c of vp.cotizaciones) { const e = c.estado_efectivo; if (ind[e] != null) ind[e]++; if (e === "enviada") { ind.montoEnviado += Number(c.total || 0); if (Number(c.dias_para_vencer) <= 3) ind.porVencer++; } }
  return (
    <div data-panel-vp-cotizaciones>
      <Pestanas etiqueta="Cotizaciones privadas" activa={pestana} onCambiar={setPestana} items={[{ key: "cotizaciones", label: "Cotizaciones", n: vp.cotizaciones.length || null }, { key: "biblioteca", label: "Biblioteca técnica" }]} />
      <PanelPestana visible={pestana === "cotizaciones"} titulo="Cotizaciones">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: S.md }}>
          <div style={{ fontSize: T.sm, color: C.inkMuted, flex: "1 1 260px" }}>Cotizaciones a clientes privados. El envío y la aceptación se registran <b>manualmente</b>: descargar el PDF no cambia el estado.</div>
          <button type="button" data-nueva-cotizacion onClick={() => setAbierta("nueva")} style={{ ...estiloBoton("pri"), minHeight: 44, padding: "10px 18px" }}>+ Nueva cotización</button>
        </div>
        <RejillaKpi>
          <Kpi dato="cot-enviadas" et="Enviadas sin respuesta" v={ind.enviada} n={`${pesos(ind.montoEnviado)} cotizado (no es venta)`} onClick={() => setEstado("enviada")} />
          <Kpi dato="cot-por-vencer" et="Vencen en ≤ 3 días" v={ind.porVencer} tono={ind.porVencer ? "warn" : "ok"} onClick={() => setEstado("enviada")} />
          <Kpi dato="cot-aceptadas" et="Aceptadas" v={ind.aceptada} onClick={() => setEstado("aceptada")} />
          <Kpi dato="cot-borradores" et="Borradores" v={ind.borrador} onClick={() => setEstado("borrador")} />
        </RejillaKpi>
        <Seccion titulo={`Cotizaciones · ${filas.length}`}>
          <Entrada data-buscar-cotizaciones value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar por folio, cliente, RUT, contacto u orden de venta" style={{ marginBottom: 8 }} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 8, marginBottom: 12 }}>
            <Selector data-filtro-estado value={estado} onChange={(e) => setEstado(e.target.value)} opciones={FILTROS} />
            <Selector data-filtro-cliente value={cliente} onChange={(e) => setCliente(e.target.value)} vacio="Todos los clientes" opciones={clientesConCot} />
            <Entrada type="date" aria-label="Emitidas desde" value={desde} onChange={(e) => setDesde(e.target.value)} />
            <Entrada type="date" aria-label="Emitidas hasta" value={hasta} onChange={(e) => setHasta(e.target.value)} />
          </div>
          {!filas.length && <Vacio dato="sin-cotizaciones">{vp.cotizaciones.length ? "Ninguna cotización coincide." : "Aún no hay cotizaciones privadas."}</Vacio>}
          {filas.map((c) => (
            <button key={c.id} type="button" data-cotizacion={c.folio} onClick={() => abrir(c.id)} style={{ ...cardStyle, borderRadius: R.md, padding: "11px 14px", marginBottom: 8, width: "100%", textAlign: "left", cursor: "pointer", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                <div style={{ fontFamily: MONO, fontWeight: 800, color: C.ink }}>{folioRevision(c.folio, c.revision_actual)}</div>
                <div style={{ fontSize: T.small, color: C.inkMuted }}>{c.cliente_nombre} · emitida {fechaTxt(c.fecha_emision)} · vence {fechaTxt(c.vigencia_hasta)}</div>
              </div>
              <BadgeVP mapa={ESTADOS_COTIZACION} k={c.estado_efectivo} />
              {c.venta_folio && <Badge tono="ok">{c.venta_folio}</Badge>}
              <span style={{ fontFamily: MONO, fontWeight: 800 }}>{pesos(c.total)}</span>
            </button>
          ))}
        </Seccion>
      </PanelPestana>
      <PanelPestana visible={pestana === "biblioteca"} titulo="Biblioteca técnica">
        <BibliotecaTecnica token={token} vp={vp} showToast={showToast} />
      </PanelPestana>
      {abierta && <FichaCotizacion key={abierta} token={token} perfil={perfil} vp={vp} id={abierta === "nueva" ? null : abierta} showToast={showToast}
        onCerrar={cerrar} onRecargar={onRecargar} onAbierta={(id) => { setAbierta(id); }} onAbrir={onAbrir} />}
    </div>
  );
}

// ── Ficha de cotización ─────────────────────────────────────────────────────────────────────────────
function aEditor(d, revisionId) {
  const rev = d.revisiones.find((r) => r.id === revisionId);
  const costos = new Map(d.costos.map((k) => [k.item_id, k]));
  const items = d.items.filter((i) => i.revision_id === revisionId).sort((a, b) => a.orden - b.orden).map((i) => ({
    ...i, _k: i.id, cantidad: Number(i.cantidad), precio_unitario: Number(i.precio_unitario), descuento_pct: Number(i.descuento_pct),
    costo_unitario: costos.has(i.id) ? Number(costos.get(i.id).costo_unitario) : "", costo_nota: costos.get(i.id)?.nota || "" }));
  return { rev, items };
}

function FichaCotizacion({ token, perfil, vp, id, showToast, onCerrar, onRecargar, onAbierta, onAbrir }) {
  const esAdmin = perfil?.rol === "admin";
  const [d, setD] = useState(null); const [err, setErr] = useState(""); const [revVista, setRevVista] = useState(null);
  const [cab, setCab] = useState(null); const [items, setItems] = useState([lineaVacia()]); const [clienteId, setClienteId] = useState(null);
  const [sucio, setSucio] = useState(false); const [ocupado, setOcupado] = useState(""); const [modal, setModal] = useState(null); const [historial, setHistorial] = useState(null);
  const [nuevoCliente, setNuevoCliente] = useState(false);
  const yaCargo = useRef(false);
  const cargar = useCallback(async (cid) => {
    try {
      const x = await leerCotizacion(token, cid); if (!x) { setErr("La cotización no existe o no tienes acceso."); return; }
      setD(x); setRevVista(x.cab.revision_id);
      const { rev, items: its } = aEditor(x, x.cab.revision_id);
      setCab({ ...rev }); setItems(its.length ? its : [lineaVacia()]); setClienteId(x.cab.cliente_id); setSucio(false); setErr("");
    } catch (e) { setErr(mensajeVP(e)); }
  }, [token]);
  useEffect(() => {
    if (yaCargo.current) return; yaCargo.current = true;
    if (id) cargar(id);
    else setCab({ fecha_emision: hoyISO(), vigencia_hasta: sumarDias(hoyISO(), 15), afecta_iva: true, plazo_entrega: "", direccion_entrega: "", condiciones_pago: "", observaciones: "", condiciones_comerciales: "", contacto_nombre: "", contacto_correo: "", contacto_telefono: "" });
  }, [id, cargar]);

  const nueva = !id;
  const c = d?.cab;
  const esResp = nueva || esAdmin || c?.responsable_id === perfil?.id || c?.creado_por === perfil?.id;
  const verCostos = nueva || esResp;   // la base lo vuelve a decidir: si no corresponde, no entrega costos
  const acc = c ? accionesCotizacion(c, { esResponsable: esResp, esAdmin }) : { editar: true };
  const viendoActual = !c || revVista === c.revision_id;
  const editable = (nueva || (acc.editar && viendoActual));
  const vistaRev = c && !viendoActual ? aEditor(d, revVista) : null;
  const itemsVista = vistaRev ? vistaRev.items : items;
  const cabVista = vistaRev ? vistaRev.rev : cab;
  const tot = calcularTotales(itemsVista, cabVista || {});
  const cliente = vp.clientes.find((x) => x.id === clienteId);
  const set = (k) => (e) => { const v = e?.target ? (e.target.type === "checkbox" ? e.target.checked : e.target.value) : e; setCab((x) => ({ ...x, [k]: v })); setSucio(true); };

  // Al elegir cliente se proponen sus datos (contacto, entrega, condiciones); se pueden cambiar.
  const elegirCliente = (cid) => {
    setClienteId(cid); setSucio(true);
    const cl = vp.clientes.find((x) => x.id === cid); if (!cl) return;
    setCab((x) => ({ ...x, contacto_nombre: x.contacto_nombre || cl.contacto_nombre || "", contacto_correo: x.contacto_correo || cl.contacto_correo || "", contacto_telefono: x.contacto_telefono || cl.contacto_telefono || "",
      direccion_entrega: x.direccion_entrega || [cl.direccion_entrega, cl.comuna_entrega].filter(Boolean).join(", "), condiciones_pago: x.condiciones_pago || cl.condiciones_pago || "" }));
  };

  const guardar = async () => {
    if (!clienteId) { showToast?.("Selecciona el cliente.", "error"); return null; }
    const errores = validarLineas(items); if (errores.length) { showToast?.(errores[0], "error"); return null; }
    if (cab.vigencia_hasta < cab.fecha_emision) { showToast?.("La vigencia no puede ser anterior a la emisión.", "error"); return null; }
    setOcupado("guardar");
    try {
      const p = { ...(c ? { id: c.id, version: c.version } : {}), cliente_id: clienteId, contacto_nombre: cab.contacto_nombre, contacto_correo: cab.contacto_correo, contacto_telefono: cab.contacto_telefono,
        fecha_emision: cab.fecha_emision, vigencia_hasta: cab.vigencia_hasta, plazo_entrega: cab.plazo_entrega, direccion_entrega: cab.direccion_entrega, condiciones_pago: cab.condiciones_pago,
        observaciones: cab.observaciones, condiciones_comerciales: cab.condiciones_comerciales, afecta_iva: cab.afecta_iva !== false,
        items: items.map((it) => lineaParaGuardar(it, verCostos)) };
      const r = await guardarCotizacion(token, p);
      showToast?.(c ? "Cotización guardada" : `Cotización ${r.folio} creada`);
      await onRecargar(); await cargar(r.id); if (!c) onAbierta?.(r.id);
      return r;
    } catch (e) { showToast?.(mensajeVP(e), "error"); if (e.conflicto && c) await cargar(c.id); return null; }
    finally { setOcupado(""); }
  };

  // Ver o descargar el PDF NO cambia el estado de la cotización (el envío y la aceptación se registran aparte).
  const [previa, setPrevia] = useState(null);
  const pdf = async (verPrimero = false) => {
    setOcupado(verPrimero ? "ver" : "pdf");
    try {
      // Revisión enviada: el PDF sale del documento congelado. Borrador: del contenido en pantalla (sin costos).
      const rv = c ? d.revisiones.find((r) => r.id === revVista) : null;
      const documento = rv?.documento || documentoDesdeEditor({ folio: c?.folio || "BORRADOR", revision: rv?.numero ?? 0, cab: cabVista, cliente: cliente ? { razon_social: cliente.razon_social, rut: cliente.rut, giro: cliente.giro, direccion: cliente.direccion, comuna: cliente.comuna } : {},
        items: itemsVista, empresa: vp.empresa, responsable: c?.responsable_nombre || perfil?.nombre });
      if (sucio && editable) showToast?.("El PDF incluye cambios aún NO guardados.", "error");
      const r = await generarPdfCotizacion(documento, { logo: await logoBFK(logoUrl) });
      if (verPrimero) setPrevia(r); else descargarBlob(r.blob, r.nombre);
    } catch (e) { showToast?.(`No se pudo generar el PDF: ${e.message}`, "error"); } finally { setOcupado(""); }
  };

  const estado = async (est, datos) => {
    setOcupado(est);
    try { await cambiarEstadoCotizacion(token, c.id, est, datos, c.version); showToast?.(`Cotización ${ESTADOS_COTIZACION[est]?.l.toLowerCase() || est}`); setModal(null); await onRecargar(); await cargar(c.id); }
    catch (e) { showToast?.(mensajeVP(e), "error"); if (e.conflicto) await cargar(c.id); } finally { setOcupado(""); }
  };
  const revision = async () => {
    setOcupado("revision");
    try { const r = await nuevaRevision(token, c.id, c.version); showToast?.(`Revisión R${r.revision} creada (la anterior se conserva)`); await onRecargar(); await cargar(c.id); }
    catch (e) { showToast?.(mensajeVP(e), "error"); } finally { setOcupado(""); }
  };
  const duplicar = async () => {
    setOcupado("duplicar");
    try { const r = await duplicarCotizacion(token, c.id); showToast?.(`Cotización duplicada como ${r.folio}`); await onRecargar(); yaCargo.current = false; onAbierta?.(r.id); }
    catch (e) { showToast?.(mensajeVP(e), "error"); } finally { setOcupado(""); }
  };
  const verHistorial = async () => { try { setHistorial(await historialCotizacion(token, c.id)); } catch (e) { showToast?.(mensajeVP(e), "error"); } };
  const cerrarConAviso = () => { if (sucio && editable && !window.confirm("Hay cambios sin guardar. ¿Cerrar de todas formas?")) return; onCerrar(); };

  if (err) return <HojaLateral abierta onCerrar={onCerrar} titulo="Cotización privada"><div style={{ padding: 16 }}><AvisoLinea tono="danger">{err}</AvisoLinea></div></HojaLateral>;
  if (!cab) return <HojaLateral abierta onCerrar={onCerrar} titulo="Cotización privada"><div style={{ padding: 16 }}><Vacio>Cargando…</Vacio></div></HojaLateral>;
  const margenGuardado = c ? d.margenes.find((m) => m.revision_id === revVista) : null;
  const revAceptada = c ? d.revisiones.find((r) => r.id === c.revision_aceptada_id) : null;

  return (
    <HojaLateral abierta onCerrar={cerrarConAviso} dato="ficha-cotizacion" ancho={860}
      titulo={c ? folioRevision(c.folio, revVista ? d.revisiones.find((r) => r.id === revVista)?.numero : c.revision_actual) : "Nueva cotización privada"}
      subtitulo={c ? `${c.cliente_nombre} · ${ESTADOS_COTIZACION[c.estado_efectivo]?.l}${c.venta_folio ? ` · venta ${c.venta_folio}` : ""}` : "Borrador sin guardar"}
      derecha={<div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
        <button type="button" data-ver-cotizacion disabled={!!ocupado} onClick={() => pdf(true)} style={estiloBoton()}>{ocupado === "ver" ? "…" : "Ver"}</button>
        <button type="button" data-pdf-cotizacion disabled={!!ocupado} onClick={() => pdf(false)} style={estiloBoton()}>{ocupado === "pdf" ? "…" : "PDF"}</button>
        {editable && <button type="button" data-guardar-cotizacion disabled={!!ocupado} onClick={guardar} style={estiloBoton("pri")}>{ocupado === "guardar" ? "Guardando…" : "Guardar"}</button>}
      </div>}>
      <div style={{ padding: 16 }}>
        {c && <div data-estado-cotizacion={c.estado_efectivo} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
          <BadgeVP mapa={ESTADOS_COTIZACION} k={c.estado_efectivo} />
          {c.estado === "enviada" && c.estado_efectivo === "vencida" && <span style={{ fontSize: T.small, color: C.warnText }}>Vigencia cumplida el {fechaTxt(c.vigencia_hasta)} sin respuesta registrada.</span>}
          {d.revisiones.length > 1 && <Selector aria-label="Revisión" data-selector-revision value={revVista} onChange={(e) => setRevVista(e.target.value)} style={{ width: "auto", minHeight: 36 }}
            opciones={d.revisiones.map((r) => ({ v: r.id, l: `R${r.numero} · ${ESTADOS_COTIZACION[r.estado]?.l}${r.id === c.revision_id ? " (actual)" : ""}` }))} />}
        </div>}
        {c && !viendoActual && <AvisoLinea tono="info" icono="ℹ">Estás viendo una revisión anterior (solo lectura). Se conserva tal como se envió{revAceptada?.id === revVista ? " y es la que respalda la venta" : ""}.</AvisoLinea>}
        {c && viendoActual && !editable && c.estado !== "borrador" && <AvisoLinea tono="info" icono="🔒">Esta revisión ya fue {ESTADOS_COTIZACION[c.estado]?.l.toLowerCase()}: su contenido no se modifica. Para cambiarla crea una revisión nueva.</AvisoLinea>}

        {c && <Acciones c={c} acc={acc} ocupado={ocupado} onModal={setModal} onRevision={revision} onDuplicar={duplicar} onAbrir={onAbrir} />}

        <Seccion titulo="Cliente y contacto">
          <SelectorCliente clientes={vp.clientes} valor={clienteId} onCambiar={elegirCliente} onNuevo={() => setNuevoCliente(true)} deshabilitado={!editable} />
          <Rejilla>
            <Campo etiqueta="Contacto"><Entrada data-campo="contacto" disabled={!editable} value={cabVista.contacto_nombre || ""} onChange={set("contacto_nombre")} maxLength={150} /></Campo>
            <Campo etiqueta="Correo"><Entrada disabled={!editable} type="email" value={cabVista.contacto_correo || ""} onChange={set("contacto_correo")} maxLength={200} /></Campo>
            <Campo etiqueta="Teléfono"><Entrada disabled={!editable} value={cabVista.contacto_telefono || ""} onChange={set("contacto_telefono")} maxLength={40} /></Campo>
          </Rejilla>
        </Seccion>
        <Seccion titulo="Fechas y condiciones">
          <Rejilla columnas={3}>
            <Campo etiqueta="Fecha de emisión"><Entrada data-campo="emision" disabled={!editable} type="date" value={cabVista.fecha_emision || ""} onChange={set("fecha_emision")} /></Campo>
            <Campo etiqueta="Vigente hasta"><Entrada data-campo="vigencia" disabled={!editable} type="date" value={cabVista.vigencia_hasta || ""} onChange={set("vigencia_hasta")} /></Campo>
            <Campo etiqueta="IVA"><Selector disabled={!editable} value={cabVista.afecta_iva === false ? "no" : "si"} onChange={(e) => set("afecta_iva")(e.target.value === "si")} opciones={[{ v: "si", l: "Afecta (19 %)" }, { v: "no", l: "Exenta" }]} /></Campo>
            <Campo etiqueta="Plazo de entrega"><Entrada data-campo="plazo" disabled={!editable} value={cabVista.plazo_entrega || ""} onChange={set("plazo_entrega")} maxLength={300} placeholder="Ej.: 10 días hábiles desde la aceptación" /></Campo>
            <Campo etiqueta="Dirección de entrega"><Entrada disabled={!editable} value={cabVista.direccion_entrega || ""} onChange={set("direccion_entrega")} maxLength={300} /></Campo>
            <Campo etiqueta="Condiciones de pago"><Entrada data-campo="pago" disabled={!editable} value={cabVista.condiciones_pago || ""} onChange={set("condiciones_pago")} maxLength={500} /></Campo>
          </Rejilla>
          <Campo etiqueta="Observaciones"><Area disabled={!editable} value={cabVista.observaciones || ""} onChange={set("observaciones")} maxLength={4000} /></Campo>
          <Campo etiqueta="Condiciones comerciales"><Area disabled={!editable} value={cabVista.condiciones_comerciales || ""} onChange={set("condiciones_comerciales")} maxLength={4000} /></Campo>
        </Seccion>
        <Seccion titulo={`Productos y servicios · ${itemsVista.length}`}>
          <EditorLineas token={token} items={itemsVista} onCambiar={(x) => { setItems(x); setSucio(true); }} verCostos={verCostos && (nueva || d.costos.length > 0 || esResp)} soloLectura={!editable} />
        </Seccion>
        <Seccion titulo="Totales">
          <ResumenTotales tot={tot} verCostos={verCostos && (nueva || margenGuardado?.costo != null)} />
          {c && margenGuardado && margenGuardado.costo == null && <div style={{ fontSize: T.small, color: C.inkFaint, marginTop: 6 }}>Costos y márgenes: visibles solo para el responsable y los administradores.</div>}
        </Seccion>
        {c && <>
          <Seccion titulo="Especificaciones técnicas (EETT)" accion={acc.eett && <button type="button" data-generar-eett onClick={() => setModal({ t: "eett" })} style={estiloBoton("pri")}>Generar EETT</button>}>
            {!d.eett.length && <Vacio dato="sin-eett">Sin EETT. «Generar EETT» arma el documento con los ítems y la información técnica de cada producto.</Vacio>}
            {d.eett.map((e) => (
              <div key={e.id} data-eett={`${e.folio}-R${e.revision}`} style={{ ...cardStyle, borderRadius: R.md, padding: "9px 12px", marginBottom: 6, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontFamily: MONO, fontWeight: 800, flex: 1 }}>{e.folio} · Rev. {e.revision}</span>
                <Badge tono={e.estado === "emitida" ? "ok" : e.estado === "borrador" ? "warn" : "neutro"}>{e.estado === "emitida" ? "Emitida" : e.estado === "borrador" ? "Borrador" : "Reemplazada"}</Badge>
                <span style={{ fontSize: T.small, color: C.inkMuted }}>Cotización R{d.revisiones.find((r) => r.id === e.cotizacion_revision_id)?.numero ?? "?"}{e.emitida_en ? ` · ${fechaTxt(String(e.emitida_en).slice(0, 10))}` : ""}</span>
                {e.estado === "borrador" ? <button type="button" data-abrir-eett onClick={() => setModal({ t: "eett", id: e.id })} style={estiloBoton()}>Continuar</button>
                  : <button type="button" data-descargar-eett onClick={() => descargarEETT(token, e.id, vp.empresa, showToast)} style={estiloBoton()}>PDF</button>}
              </div>
            ))}
          </Seccion>
          <Seccion titulo="Respaldos de la cotización">
            <SubirArchivo token={token} ambito="cotizacion" id={c.id} categorias={["aceptacion", "otro"]} habilitado={vp.documentosHabilitados} showToast={showToast} onSubido={() => cargar(c.id)} />
            <ListaDocumentos token={token} documentos={d.documentos} showToast={showToast} onAnular={(doc) => setModal({ t: "anular_doc", doc })} />
          </Seccion>
          <Seccion titulo="Historial" accion={<button type="button" data-ver-historial onClick={verHistorial} style={estiloBoton()}>Ver</button>}>
            {historial && <HistorialLista filas={historial} />}
          </Seccion>
        </>}
      </div>
      {modal?.t === "enviada" && <ModalEstado titulo="Registrar envío" texto="Registra que la cotización se envió al cliente (por ejemplo, por correo). No se envía ningún correo desde la aplicación." boton="Registrar envío" ocupado={ocupado}
        campos={[{ k: "fecha", l: "Fecha de envío", tipo: "date", def: hoyISO() }, { k: "medio", l: "Medio", def: "correo" }, { k: "destinatario", l: "Destinatario", def: c.contacto_nombre || "" }, { k: "nota", l: "Nota", area: true }]}
        onCancelar={() => setModal(null)} onConfirmar={(v) => estado("enviada", v)} />}
      {modal?.t === "aceptada" && <ModalEstado titulo="Registrar aceptación" texto="Registra que el cliente aceptó esta revisión. La revisión aceptada queda congelada y es la que se transfiere a la venta." boton="Registrar aceptación" ocupado={ocupado}
        campos={[{ k: "fecha", l: "Fecha de aceptación", tipo: "date", def: hoyISO() }, { k: "referencia", l: "Aceptada por / referencia", def: c.contacto_nombre || "" }, { k: "nota", l: "Nota", area: true }]}
        onCancelar={() => setModal(null)} onConfirmar={(v) => estado("aceptada", v)} />}
      {modal?.t === "rechazada" && <ModalEstado titulo="Registrar rechazo" boton="Registrar rechazo" peligro ocupado={ocupado}
        campos={[{ k: "fecha", l: "Fecha", tipo: "date", def: hoyISO() }, { k: "motivo", l: "Motivo", area: true, obligatorio: true }]}
        onCancelar={() => setModal(null)} onConfirmar={(v) => estado("rechazada", v)} />}
      {modal?.t === "vencida" && <ModalEstado titulo="Marcar como vencida" texto="La vigencia terminó sin respuesta del cliente." boton="Marcar vencida" ocupado={ocupado}
        campos={[{ k: "fecha", l: "Fecha", tipo: "date", def: hoyISO() }]} onCancelar={() => setModal(null)} onConfirmar={(v) => estado("vencida", v)} />}
      {modal?.t === "borrador" && <PedirMotivo titulo="Devolver a borrador" texto="Corrección administrativa: la revisión se registró como enviada por error. Queda en el historial." etiquetaBoton="Devolver a borrador"
        ocupado={!!ocupado} onCancelar={() => setModal(null)} onConfirmar={(m) => estado("borrador", { motivo: m })} />}
      {modal?.t === "venta" && <CrearVentaDesdeCotizacion token={token} cot={c} vp={vp} showToast={showToast} onCerrar={() => setModal(null)}
        onCreada={async (v) => { setModal(null); await onRecargar(); onAbrir?.("vp_ordenes", v.id); }} />}
      {previa && <VistaPreviaEETT blob={previa.blob} nombre={previa.nombre} paginas={previa.paginas} titulo="Vista previa de la cotización"
        aviso="Vista previa: es el mismo PDF que se descarga. Verla o descargarla no la marca como enviada ni aceptada." onCerrar={() => setPrevia(null)}
        onDescargar={() => { descargarBlob(previa.blob, previa.nombre); setPrevia(null); }} />}
      {modal?.t === "eett" && <EditorEETT token={token} cot={c} datos={d} vp={vp} eettId={modal.id} showToast={showToast} onCerrar={async () => { setModal(null); await cargar(c.id); }} />}
      {modal?.t === "anular_doc" && <PedirMotivo titulo="Anular archivo" texto="El archivo se conserva en el registro, marcado como anulado." etiquetaBoton="Anular" peligro onCancelar={() => setModal(null)}
        onConfirmar={async (m) => { try { await anular(token, "documento", modal.doc.id, m); setModal(null); await cargar(c.id); } catch (e) { showToast?.(mensajeVP(e), "error"); } }} />}
      {nuevoCliente && <FormCliente token={token} clientes={vp.clientes} showToast={showToast} onCerrar={() => setNuevoCliente(false)}
        onGuardado={async (cid) => { setNuevoCliente(false); await onRecargar(); elegirCliente(cid); }} />}
    </HojaLateral>
  );
}

function Acciones({ c, acc, ocupado, onModal, onRevision, onDuplicar, onAbrir }) {
  const b = (k, txt, fn, tipo = "sec", dato) => <button key={k} type="button" data-accion-cot={dato || k} disabled={!!ocupado} onClick={fn} style={{ ...estiloBoton(tipo), opacity: ocupado ? 0.6 : 1 }}>{ocupado === k ? "…" : txt}</button>;
  return (
    <div data-acciones-cotizacion style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
      {acc.enviar && b("enviada", "Registrar envío", () => onModal({ t: "enviada" }), "pri")}
      {acc.aceptar && b("aceptada", "Registrar aceptación", () => onModal({ t: "aceptada" }), "pri")}
      {acc.rechazar && b("rechazada", "Registrar rechazo", () => onModal({ t: "rechazada" }), "peligro")}
      {acc.vencer && b("vencida", "Marcar vencida", () => onModal({ t: "vencida" }))}
      {acc.crearVenta && b("venta", "Crear venta / Registrar OC", () => onModal({ t: "venta" }), "pri", "crear-venta")}
      {acc.verVenta && b("verventa", `Ver venta ${c.venta_folio}`, () => onAbrir?.("vp_ordenes", c.venta_id))}
      {acc.nuevaRevision && b("revision", "Nueva revisión", onRevision)}
      {acc.volverBorrador && b("borrador", "Devolver a borrador", () => onModal({ t: "borrador" }))}
      {b("duplicar", "Duplicar", onDuplicar)}
    </div>
  );
}

function ModalEstado({ titulo, texto, boton, peligro, campos, ocupado, onCancelar, onConfirmar }) {
  const [v, setV] = useState(() => Object.fromEntries(campos.map((x) => [x.k, x.def || ""]))); const [err, setErr] = useState("");
  const ok = () => { const f = campos.find((x) => x.obligatorio && String(v[x.k] || "").trim().length < 3); if (f) { setErr(`Indica ${f.l.toLowerCase()}.`); return; } onConfirmar(v); };
  return (
    <Ventana titulo={titulo} onCerrar={onCancelar} dato="modal-estado" ancho={460}
      pie={<><button type="button" onClick={onCancelar} style={estiloBoton()}>Cancelar</button><button type="button" data-confirmar-estado disabled={!!ocupado} onClick={ok} style={{ ...estiloBoton(peligro ? "peligro" : "pri"), minHeight: 44 }}>{ocupado ? "Guardando…" : boton}</button></>}>
      {texto && <p style={{ marginTop: 0, fontSize: T.sm, color: C.inkMuted, lineHeight: 1.5 }}>{texto}</p>}
      <ErrorForm>{err}</ErrorForm>
      {campos.map((x) => <Campo key={x.k} etiqueta={x.l}>{x.area ? <Area data-campo-estado={x.k} value={v[x.k]} onChange={(e) => setV((o) => ({ ...o, [x.k]: e.target.value }))} maxLength={1000} />
        : <Entrada data-campo-estado={x.k} type={x.tipo || "text"} value={v[x.k]} max={x.tipo === "date" ? hoyISO() : undefined} onChange={(e) => setV((o) => ({ ...o, [x.k]: e.target.value }))} />}</Campo>)}
    </Ventana>
  );
}

const NOMBRE_TABLA = { vp_cotizaciones: "Cotización", vp_cotizacion_revisiones: "Revisión", vp_cotizacion_items: "Línea", vp_cotizacion_item_costos: "Costo (interno)", vp_eett: "EETT", vp_documentos: "Archivo",
  vp_ventas: "Venta", vp_venta_items: "Línea de venta", vp_venta_item_costos: "Costo estimado (interno)", vp_oc_cliente: "OC del cliente", vp_entregas: "Entrega", vp_entrega_items: "Detalle de entrega",
  vp_facturas: "Factura", vp_pagos: "Pago", vp_pago_imputaciones: "Aplicación de pago", vp_compras: "Compra / costo real (interno)" };
export function HistorialLista({ filas }) {
  if (!filas?.length) return <Vacio>Sin registros.</Vacio>;
  return (
    <div data-historial-vp style={{ ...cardStyle, borderRadius: R.md, padding: "4px 12px", maxHeight: 360, overflowY: "auto" }}>
      {filas.map((h) => {
        const est = h.cambios?.estado?.despues ?? (h.accion === "crear" ? h.cambios?.estado : null);
        const resumen = h.accion === "modificar" ? Object.keys(h.cambios || {}).filter((k) => !/(_por|_en)$/.test(k)).slice(0, 4).join(", ") : "";
        return (
          <div key={h.id} style={{ padding: "7px 0", borderBottom: `1px solid ${C.border}`, fontSize: T.small }}>
            <b style={{ color: C.ink }}>{NOMBRE_TABLA[h.tabla] || h.tabla}</b> · {h.accion === "crear" ? "creado" : h.accion === "modificar" ? "modificado" : "eliminado"}
            {est ? <> · estado <b>{String(est)}</b></> : null}{resumen && !est ? <span style={{ color: C.inkMuted }}> ({resumen})</span> : null}
            <div style={{ color: C.inkFaint }}>{h.usuario_nombre || "Sistema"} · {new Date(h.fecha).toLocaleString("es-CL")}</div>
          </div>
        );
      })}
    </div>
  );
}
export { cantidadTxt, pct, Fila, Subtitulo };
