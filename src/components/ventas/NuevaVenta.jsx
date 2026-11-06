// Ventas privadas — crear la venta (orden de venta interna OV-AAAA-NNNN) desde una cotización aceptada o como venta
// directa, y registrar en el mismo paso la OC del cliente si existe. La OC del cliente es el documento que emite el
// cliente; la orden de venta es el registro interno de BFK (existe aunque el cliente no use OC).
// Doble clic / reintento: la clave de la operación se fija al abrir la ventana; la base devuelve la misma venta.
import { useMemo, useRef, useState } from "react";
import { C, MONO, R, T, cardStyle } from "../../lib/theme";
import { AvisoLinea, Pestanas } from "../ui/Sistema";
import { Ventana, Campo, Rejilla, Subtitulo, Entrada, Area, Selector, ErrorForm } from "../proyectos/Comunes";
import { estiloBoton, Fila, SelectorCliente, EditorLineas, ResumenTotales, lineaVacia, Vacio } from "./Comunes";
import { FormCliente } from "./PanelClientes";
import { crearVentaDesdeCotizacion, crearVentaDirecta, registrarOcCliente, subirDocumento } from "../../lib/ventasPrivadasDatos";
import { aPesos, lineaParaGuardar, calcularTotales, validarLineas, pesos, fechaTxt, hoyISO, mensajeVP, nuevaClave, folioRevision } from "../../lib/ventasPrivadas";

function CamposOC({ oc, setOc, habilitado }) {
  const set = (k) => (e) => setOc((x) => ({ ...x, [k]: k === "archivo" ? e.target.files?.[0] || null : e.target.value }));
  return (
    <div data-campos-oc-cliente style={{ background: C.paper, border: `1px solid ${C.border}`, borderRadius: R.md, padding: "10px 12px", marginTop: 8 }}>
      <div style={{ fontSize: T.small, color: C.inkMuted, marginBottom: 8, lineHeight: 1.45 }}>
        <b>OC del cliente</b> (opcional): el documento que el cliente emite a BFK. Si el cliente no usa OC, déjalo vacío: la venta se gestiona con la <b>orden de venta interna</b>.
      </div>
      <Rejilla columnas={3}>
        <Campo etiqueta="N° OC del cliente"><Entrada data-oc-numero value={oc.numero} onChange={set("numero")} maxLength={60} /></Campo>
        <Campo etiqueta="Fecha de la OC"><Entrada data-oc-fecha type="date" max={hoyISO()} value={oc.fecha} onChange={set("fecha")} /></Campo>
        <Campo etiqueta="Monto (opcional)"><Entrada inputMode="numeric" value={oc.monto} onChange={set("monto")} /></Campo>
      </Rejilla>
      {habilitado ? <Campo etiqueta="Archivo de la OC (opcional)"><input data-oc-archivo type="file" onChange={set("archivo")} style={{ fontSize: T.small }} /></Campo>
        : <div style={{ fontSize: T.small, color: C.inkFaint }}>El archivo se podrá adjuntar cuando la carga de archivos esté habilitada.</div>}
    </div>
  );
}
const ocVacia = () => ({ numero: "", fecha: hoyISO(), monto: "", archivo: null });

async function registrarOcSiCorresponde(token, ventaId, oc) {
  if (!oc.numero.trim()) return null;
  let documento_id = null;
  if (oc.archivo) documento_id = (await subirDocumento(token, { ambito: "venta", id: ventaId, categoria: "oc_cliente", titulo: `OC ${oc.numero.trim()}`, archivo: oc.archivo })).id;
  return registrarOcCliente(token, { venta_id: ventaId, numero: oc.numero.trim(), fecha: oc.fecha, monto: aPesos(oc.monto), documento_id });
}

export function CrearVentaDesdeCotizacion({ token, cot, vp, showToast, onCerrar, onCreada }) {
  const clave = useRef(nuevaClave());   // misma clave en todos los intentos de esta ventana
  const [datos, setDatos] = useState({ fecha_entrega_comprometida: "", observaciones: "" });
  const [oc, setOc] = useState(ocVacia()); const [ocupado, setOcupado] = useState(false); const [err, setErr] = useState("");
  const crear = async () => {
    if (oc.numero.trim() && !oc.fecha) { setErr("Indica la fecha de la OC del cliente."); return; }
    setOcupado(true); setErr("");
    let venta = null;
    try {
      venta = await crearVentaDesdeCotizacion(token, cot.id, clave.current, { fecha_entrega_comprometida: datos.fecha_entrega_comprometida || null, observaciones: datos.observaciones || null });
      if (venta.ya_existia) showToast?.(`La cotización ya tenía la venta ${venta.folio}: no se creó otra.`);
    } catch (e) { setErr(mensajeVP(e)); setOcupado(false); return; }
    try { await registrarOcSiCorresponde(token, venta.id, oc); showToast?.(`Venta ${venta.folio} creada${oc.numero.trim() ? ` con la OC ${oc.numero.trim()}` : " (orden interna, sin OC del cliente)"}`); }
    catch (e) { showToast?.(`Venta ${venta.folio} creada, pero la OC no se registró: ${mensajeVP(e)}. Regístrala desde la venta.`, "error"); }
    setOcupado(false); onCreada?.(venta);
  };
  return (
    <Ventana titulo="Crear venta / Registrar OC" onCerrar={onCerrar} dato="crear-venta" ancho={620}
      pie={<><button type="button" onClick={onCerrar} style={estiloBoton()}>Cancelar</button><button type="button" data-confirmar-venta disabled={ocupado} onClick={crear} style={{ ...estiloBoton("pri"), minHeight: 44 }}>{ocupado ? "Creando…" : "Crear venta"}</button></>}>
      <ErrorForm>{err}</ErrorForm>
      <div style={{ ...cardStyle, borderRadius: R.md, padding: "8px 14px", marginBottom: 10 }}>
        <Fila k="Cotización aceptada" v={folioRevision(cot.folio, cot.revision_aceptada)} />
        <Fila k="Cliente" v={cot.cliente_nombre} />
        <Fila k="Total aceptado" v={pesos(cot.total_aceptado)} fuerte />
      </div>
      <AvisoLinea tono="info" icono="ℹ">Se transfieren cliente, ítems, cantidades, precios, condiciones y costos estimados de la revisión aceptada, sin volver a ingresarlos.</AvisoLinea>
      <Rejilla>
        <Campo etiqueta="Entrega comprometida (fecha)"><Entrada data-venta-fecha-entrega type="date" value={datos.fecha_entrega_comprometida} onChange={(e) => setDatos((x) => ({ ...x, fecha_entrega_comprometida: e.target.value }))} /></Campo>
      </Rejilla>
      <CamposOC oc={oc} setOc={setOc} habilitado={vp.documentosHabilitados} />
    </Ventana>
  );
}

// Desde «+ Nuevo › Venta privada / Registrar OC de cliente».
export function NuevaVentaPrivada({ token, perfil, vp, showToast, onCerrar, onCreada, onRecargar }) {
  const aceptadas = useMemo(() => vp.cotizaciones.filter((c) => c.revision_aceptada_id && !c.venta_id), [vp.cotizaciones]);
  const [modo, setModo] = useState(aceptadas.length ? "cotizacion" : "directa");
  const [cotSel, setCotSel] = useState(null);
  const clave = useRef(nuevaClave());
  const [clienteId, setClienteId] = useState(null); const [items, setItems] = useState([lineaVacia()]);
  const [cab, setCab] = useState({ fecha: hoyISO(), afecta_iva: true, plazo_entrega: "", fecha_entrega_comprometida: "", direccion_entrega: "", condiciones_pago: "", plazo_pago_dias: "", observaciones: "", contacto_nombre: "" });
  const [oc, setOc] = useState(ocVacia()); const [ocupado, setOcupado] = useState(false); const [err, setErr] = useState(""); const [nuevoCliente, setNuevoCliente] = useState(false);
  const tot = calcularTotales(items, cab);
  const set = (k) => (e) => setCab((x) => ({ ...x, [k]: e.target.value }));
  const elegirCliente = (cid) => {
    setClienteId(cid); const cl = vp.clientes.find((x) => x.id === cid); if (!cl) return;
    setCab((x) => ({ ...x, contacto_nombre: x.contacto_nombre || cl.contacto_nombre || "", direccion_entrega: x.direccion_entrega || [cl.direccion_entrega, cl.comuna_entrega].filter(Boolean).join(", "),
      condiciones_pago: x.condiciones_pago || cl.condiciones_pago || "", plazo_pago_dias: x.plazo_pago_dias || (cl.plazo_pago_dias ?? "") }));
  };
  if (modo === "cotizacion" && cotSel) return <CrearVentaDesdeCotizacion token={token} cot={cotSel} vp={vp} showToast={showToast} onCerrar={() => setCotSel(null)} onCreada={onCreada} />;
  const crearDirecta = async () => {
    if (!clienteId) { setErr("Selecciona el cliente."); return; }
    const e = validarLineas(items); if (e.length) { setErr(e[0]); return; }
    setOcupado(true); setErr("");
    let venta;
    try {
      venta = await crearVentaDirecta(token, { clave: clave.current, cliente_id: clienteId, fecha: cab.fecha, afecta_iva: cab.afecta_iva !== false, plazo_entrega: cab.plazo_entrega,
        fecha_entrega_comprometida: cab.fecha_entrega_comprometida || null, direccion_entrega: cab.direccion_entrega, condiciones_pago: cab.condiciones_pago,
        plazo_pago_dias: cab.plazo_pago_dias === "" ? null : Number(cab.plazo_pago_dias), observaciones: cab.observaciones, contacto_nombre: cab.contacto_nombre,
        items: items.map((it) => lineaParaGuardar(it, true)) });
    } catch (x) { setErr(mensajeVP(x)); setOcupado(false); return; }
    try { await registrarOcSiCorresponde(token, venta.id, oc); showToast?.(`Venta directa ${venta.folio} creada${oc.numero.trim() ? ` con la OC ${oc.numero.trim()}` : ""}`); }
    catch (x) { showToast?.(`Venta ${venta.folio} creada, pero la OC no se registró: ${mensajeVP(x)}`, "error"); }
    setOcupado(false); onCreada?.(venta);
  };
  return (
    <Ventana titulo="Venta privada / Registrar OC de cliente" onCerrar={onCerrar} dato="nueva-venta" ancho={760}
      pie={modo === "directa" ? <><button type="button" onClick={onCerrar} style={estiloBoton()}>Cancelar</button><button type="button" data-crear-venta-directa disabled={ocupado} onClick={crearDirecta} style={{ ...estiloBoton("pri"), minHeight: 44 }}>{ocupado ? "Creando…" : "Crear venta directa"}</button></> : null}>
      <Pestanas etiqueta="Origen de la venta" activa={modo} onCambiar={setModo} items={[{ key: "cotizacion", label: "Desde cotización aceptada", n: aceptadas.length || null }, { key: "directa", label: "Venta directa (sin cotización)" }]} />
      {modo === "cotizacion" && <>
        {!aceptadas.length && <Vacio dato="sin-aceptadas">No hay cotizaciones aceptadas pendientes de convertir. Registra la aceptación en la cotización o crea una venta directa.</Vacio>}
        {aceptadas.map((c) => (
          <button key={c.id} type="button" data-elegir-cotizacion={c.folio} onClick={() => setCotSel(c)} style={{ ...cardStyle, borderRadius: R.md, padding: "10px 12px", marginBottom: 6, width: "100%", textAlign: "left", cursor: "pointer", display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontFamily: MONO, fontWeight: 800, flex: 1 }}>{folioRevision(c.folio, c.revision_aceptada)}</span>
            <span style={{ fontSize: T.small, color: C.inkMuted }}>{c.cliente_nombre} · aceptada {fechaTxt(c.aceptada_en)}</span>
            <span style={{ fontFamily: MONO, fontWeight: 700 }}>{pesos(c.total_aceptado)}</span>
          </button>
        ))}
      </>}
      {modo === "directa" && <>
        <AvisoLinea tono="info" icono="ℹ">La venta queda identificada como <b>directa</b> (sin cotización previa).</AvisoLinea>
        <ErrorForm>{err}</ErrorForm>
        <Campo etiqueta="Cliente"><SelectorCliente clientes={vp.clientes} valor={clienteId} onCambiar={elegirCliente} onNuevo={() => setNuevoCliente(true)} /></Campo>
        <Rejilla columnas={3}>
          <Campo etiqueta="Fecha de la venta"><Entrada type="date" max={hoyISO()} value={cab.fecha} onChange={set("fecha")} /></Campo>
          <Campo etiqueta="Entrega comprometida"><Entrada type="date" value={cab.fecha_entrega_comprometida} onChange={set("fecha_entrega_comprometida")} /></Campo>
          <Campo etiqueta="IVA"><Selector value={cab.afecta_iva === false ? "no" : "si"} onChange={(e) => setCab((x) => ({ ...x, afecta_iva: e.target.value === "si" }))} opciones={[{ v: "si", l: "Afecta (19 %)" }, { v: "no", l: "Exenta" }]} /></Campo>
          <Campo etiqueta="Contacto"><Entrada value={cab.contacto_nombre} onChange={set("contacto_nombre")} /></Campo>
          <Campo etiqueta="Condiciones de pago"><Entrada value={cab.condiciones_pago} onChange={set("condiciones_pago")} /></Campo>
          <Campo etiqueta="Plazo de pago (días)"><Entrada inputMode="numeric" value={cab.plazo_pago_dias} onChange={set("plazo_pago_dias")} /></Campo>
        </Rejilla>
        <Campo etiqueta="Dirección de entrega"><Entrada value={cab.direccion_entrega} onChange={set("direccion_entrega")} /></Campo>
        <Subtitulo>Productos y servicios</Subtitulo>
        <EditorLineas token={token} items={items} onCambiar={setItems} verCostos />
        <div style={{ marginTop: 10 }}><ResumenTotales tot={tot} verCostos /></div>
        <Campo etiqueta="Observaciones"><Area value={cab.observaciones} onChange={set("observaciones")} /></Campo>
        <CamposOC oc={oc} setOc={setOc} habilitado={vp.documentosHabilitados} />
      </>}
      {nuevoCliente && <FormCliente token={token} clientes={vp.clientes} showToast={showToast} onCerrar={() => setNuevoCliente(false)} onGuardado={async (cid) => { setNuevoCliente(false); await onRecargar?.(); elegirCliente(cid); }} />}
    </Ventana>
  );
}
