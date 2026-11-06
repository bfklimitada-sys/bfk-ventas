// Ventas privadas › Órdenes de venta: lista y ficha con cuatro pestañas (Detalle · Entregas · Documentos · Pagos).
// Entrega, facturación y pago se controlan por separado (una venta entregada puede seguir pendiente de cobro).
// Facturas: se REGISTRAN las emitidas en el SII (este módulo no emite documentos tributarios electrónicos).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { C, MONO, R, S, T, cardStyle } from "../../lib/theme";
import { HojaLateral, Seccion, Pestanas, PanelPestana, AvisoLinea, Badge } from "../ui/Sistema";
import { Ventana, Campo, Rejilla, Entrada, Area, Selector, ErrorForm, PedirMotivo } from "../proyectos/Comunes";
import { NoInstalado, Vacio, estiloBoton, Fila, BadgeVP, SubirArchivo, ListaDocumentos, Kpi, RejillaKpi } from "./Comunes";
import { HistorialLista } from "./PanelCotizacionesPrivadas";
import { descargarEETT } from "./EditorEETT";
import { subirDocumento, leerVenta, actualizarVenta, registrarOcCliente, registrarEntrega, registrarFactura, registrarPago, imputarPago, registrarCompra, anular, anularVenta, buscarGastos, documentoPublico } from "../../lib/ventasPrivadasDatos";
import { aPesos, ESTADOS_ENTREGA, ESTADOS_FACTURACION, ESTADOS_PAGO, MEDIOS_PAGO, TIPOS_DOCUMENTO_VENTA, filtrarVentas, pesos, pct, fechaTxt, hoyISO, cantidadTxt, mensajeVP, nuevaClave, folioRevision, TASA_IVA, redondear } from "../../lib/ventasPrivadas";
import { generarPdfCotizacion } from "../../lib/vpPdf";
import { descargarBlob } from "../../lib/eettPdf";
import { logoBFK } from "../../lib/cotizacionesDatos";
import logoUrl from "../../assets/bfk-logo.jpg";
import { folioVPDesdeHash, hashVP } from "../../lib/navegacion";

const FILTROS = [{ key: "", label: "Vigentes" }, { key: "por_entregar", label: "Por entregar" }, { key: "por_facturar", label: "Por facturar" }, { key: "por_cobrar", label: "Por cobrar" }, { key: "vencidas", label: "Pago vencido" }, { key: "anuladas", label: "Anuladas" }];

export function PanelOrdenesVenta({ token, perfil, vp, onRecargar, showToast, onAbrir, focoId, onFocoUsado }) {
  const [texto, setTexto] = useState(""); const [filtro, setFiltro] = useState(""); const [abierta, setAbierta] = useState(null);
  useEffect(() => {
    const sync = (ev) => { const f = folioVPDesdeHash(window.location.hash, "vp_ordenes"); if (!f) { if (ev) setAbierta((a) => (a === "nueva" ? a : null)); return; } { const v = vp.ventas.find((x) => x.folio === f); if (v) setAbierta(v.id); } };
    sync(null); window.addEventListener("popstate", sync); return () => window.removeEventListener("popstate", sync);
  }, [vp.ventas]);
  useEffect(() => { if (focoId) { setAbierta(focoId); onFocoUsado?.(); } }, [focoId]); // eslint-disable-line react-hooks/exhaustive-deps
  const abrir = (id) => { const v = vp.ventas.find((x) => x.id === id); if (v) window.history.pushState(null, "", hashVP("vp_ordenes", v.folio)); setAbierta(id); };
  const cerrar = () => { if (folioVPDesdeHash(window.location.hash, "vp_ordenes")) window.history.pushState(null, "", hashVP("vp_ordenes")); setAbierta(null); };
  const filas = useMemo(() => filtrarVentas(vp.ventas, { texto, estado: filtro }), [vp.ventas, texto, filtro]);
  if (!vp.instalado) return <NoInstalado />;
  const vig = vp.ventas.filter((v) => v.estado !== "anulada");
  const n = (f) => filtrarVentas(vp.ventas, { estado: f }).length;
  return (
    <div data-panel-vp-ordenes>
      <div style={{ fontSize: T.sm, color: C.inkMuted, marginBottom: S.md }}>Órdenes de venta internas de BFK (folio <b>OV</b>). La OC del cliente, si existe, se registra dentro de cada venta.</div>
      <RejillaKpi>
        <Kpi dato="ov-vendido" et="Ventas vigentes (total)" v={pesos(vig.reduce((s, v) => s + Number(v.total), 0))} n={`${vig.length} venta${vig.length === 1 ? "" : "s"}`} />
        <Kpi dato="ov-por-cobrar" et="Saldo por cobrar" v={pesos(vig.reduce((s, v) => s + Number(v.saldo), 0))} tono="warn" onClick={() => setFiltro("por_cobrar")} />
        <Kpi dato="ov-vencido" et="Pago vencido" v={pesos(vig.reduce((s, v) => s + Number(v.monto_vencido), 0))} tono={vig.some((v) => Number(v.monto_vencido) > 0) ? "danger" : "ok"} onClick={() => setFiltro("vencidas")} />
        <Kpi dato="ov-por-entregar" et="Por entregar" v={n("por_entregar")} onClick={() => setFiltro("por_entregar")} />
      </RejillaKpi>
      <Seccion titulo={`Órdenes de venta · ${filas.length}`}>
        <Entrada data-buscar-ventas value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar por folio, cliente, RUT, cotización u OC del cliente" style={{ marginBottom: 8 }} />
        <Pestanas etiqueta="Filtro de ventas" activa={filtro} onCambiar={setFiltro} compacta items={FILTROS.map((f) => ({ ...f, n: f.key ? n(f.key) || null : null, tono: f.key === "vencidas" ? "danger" : null }))} />
        {!filas.length && <Vacio dato="sin-ventas">{vp.ventas.length ? "Ninguna venta coincide." : "Aún no hay ventas privadas. Crea una desde una cotización aceptada o con «+ Nuevo»."}</Vacio>}
        {filas.map((v) => (
          <button key={v.id} type="button" data-venta={v.folio} onClick={() => abrir(v.id)} style={{ ...cardStyle, borderRadius: R.md, padding: "11px 14px", marginBottom: 8, width: "100%", textAlign: "left", cursor: "pointer", opacity: v.estado === "anulada" ? 0.6 : 1 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontFamily: MONO, fontWeight: 800, color: C.ink }}>{v.folio}</span>
              <span style={{ fontSize: T.small, color: C.inkMuted, flex: 1, minWidth: 140 }}>{v.cliente_nombre} · {v.origen === "directa" ? "venta directa" : folioRevision(v.cotizacion_folio, v.cotizacion_revision)}{v.oc_cliente_numeros ? ` · OC ${v.oc_cliente_numeros}` : ""}</span>
              <span style={{ fontFamily: MONO, fontWeight: 800 }}>{pesos(v.total)}</span>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
              {v.estado === "anulada" ? <Badge tono="danger">Anulada</Badge> : <>
                <BadgeVP mapa={ESTADOS_ENTREGA} k={v.estado_entrega} dato={`entrega-${v.estado_entrega}`} />
                <BadgeVP mapa={ESTADOS_FACTURACION} k={v.estado_facturacion} dato={`fact-${v.estado_facturacion}`} />
                <BadgeVP mapa={ESTADOS_PAGO} k={v.estado_pago} dato={`pago-${v.estado_pago}`} />
                {Number(v.monto_vencido) > 0 && <Badge tono="danger">Vencido {pesos(v.monto_vencido)}</Badge>}
              </>}
            </div>
          </button>
        ))}
      </Seccion>
      {abierta && <FichaVenta key={abierta} token={token} perfil={perfil} vp={vp} id={abierta} showToast={showToast} onCerrar={cerrar} onRecargar={onRecargar} onAbrir={onAbrir} />}
    </div>
  );
}

function FichaVenta({ token, perfil, vp, id, showToast, onCerrar, onRecargar, onAbrir }) {
  const [d, setD] = useState(null); const [err, setErr] = useState(""); const [pestana, setPestana] = useState("detalle"); const [modal, setModal] = useState(null);
  const cargar = useCallback(async () => {
    try { const x = await leerVenta(token, id); if (!x) { setErr("La venta no existe o no tienes acceso."); return; } setD(x); setErr(""); } catch (e) { setErr(mensajeVP(e)); }
  }, [token, id]);
  useEffect(() => { cargar(); }, [cargar]);
  const refrescar = async () => { await cargar(); await onRecargar(); };
  if (err) return <HojaLateral abierta onCerrar={onCerrar} titulo="Orden de venta"><div style={{ padding: 16 }}><AvisoLinea tono="danger">{err}</AvisoLinea></div></HojaLateral>;
  if (!d) return <HojaLateral abierta onCerrar={onCerrar} titulo="Orden de venta"><div style={{ padding: 16 }}><Vacio>Cargando…</Vacio></div></HojaLateral>;
  const v = d.cab; const esAdmin = perfil?.rol === "admin";
  const esResp = esAdmin || v.responsable_id === perfil?.id;
  const vigente = v.estado === "vigente";
  const ctx = { token, d, v, esResp, esAdmin, vigente, vp, showToast, refrescar, setModal };
  return (
    <HojaLateral abierta onCerrar={onCerrar} dato="ficha-venta" ancho={860} titulo={`Orden de venta ${v.folio}`}
      subtitulo={`${v.cliente_nombre} · ${v.origen === "directa" ? "venta directa" : `desde ${folioRevision(v.cotizacion_folio, v.cotizacion_revision)}`}${vigente ? "" : " · ANULADA"}`}>
      <div style={{ padding: 16 }}>
        {!vigente && <AvisoLinea tono="danger" icono="⚠">Venta anulada el {fechaTxt(String(v.anulada_en).slice(0, 10))}: {v.anulacion_motivo}. Se conserva para trazabilidad y no cuenta en los indicadores.</AvisoLinea>}
        <div data-estados-venta style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
          <BadgeVP mapa={ESTADOS_ENTREGA} k={v.estado_entrega} dato={`entrega-${v.estado_entrega}`} />
          <BadgeVP mapa={ESTADOS_FACTURACION} k={v.estado_facturacion} dato={`fact-${v.estado_facturacion}`} />
          <BadgeVP mapa={ESTADOS_PAGO} k={v.estado_pago} dato={`pago-${v.estado_pago}`} />
        </div>
        <RejillaKpi>
          <Kpi dato="v-total" et="Total venta" v={pesos(v.total)} n={`Neto ${pesos(v.neto)} · IVA ${pesos(v.iva)}`} />
          <Kpi dato="v-facturado" et="Facturado" v={pesos(v.facturado)} n={`Por facturar ${pesos(v.por_facturar)}`} />
          <Kpi dato="v-cobrado" et="Cobrado" v={pesos(v.cobrado)} n={Number(v.anticipos) > 0 ? `Incluye anticipos ${pesos(v.anticipos)}` : null} />
          <Kpi dato="v-saldo" et="Saldo pendiente" v={pesos(v.saldo)} tono={Number(v.monto_vencido) > 0 ? "danger" : Number(v.saldo) > 0 ? "warn" : "ok"} n={Number(v.monto_vencido) > 0 ? `${pesos(v.monto_vencido)} vencido` : null} />
        </RejillaKpi>
        <Pestanas etiqueta="Ficha de la venta" activa={pestana} onCambiar={setPestana} items={[
          { key: "detalle", label: "Detalle" }, { key: "entregas", label: "Entregas", n: d.entregas.filter((e) => e.estado === "vigente").length || null },
          { key: "documentos", label: "Documentos", n: d.documentos.filter((x) => x.estado === "vigente").length + d.facturas.filter((f) => f.estado === "vigente").length || null },
          { key: "pagos", label: "Pagos", n: d.pagos.filter((p) => p.estado === "vigente").length || null, tono: Number(v.monto_vencido) > 0 ? "danger" : null }]} />
        <PanelPestana visible={pestana === "detalle"} titulo="Detalle"><Detalle {...ctx} onAbrir={onAbrir} /></PanelPestana>
        <PanelPestana visible={pestana === "entregas"} titulo="Entregas"><Entregas {...ctx} /></PanelPestana>
        <PanelPestana visible={pestana === "documentos"} titulo="Documentos"><Documentos {...ctx} /></PanelPestana>
        <PanelPestana visible={pestana === "pagos"} titulo="Pagos"><Pagos {...ctx} /></PanelPestana>
      </div>
      {modal?.t === "anular" && <PedirMotivo titulo={modal.titulo} texto={modal.texto} etiquetaBoton="Anular" peligro onCancelar={() => setModal(null)}
        onConfirmar={async (m) => { try { await anular(token, modal.tabla, modal.id, m); showToast?.("Registro anulado (se conserva en el historial)"); setModal(null); await refrescar(); } catch (e) { showToast?.(mensajeVP(e), "error"); } }} />}
      {modal?.t === "anular_venta" && <PedirMotivo titulo={`Anular venta ${v.folio}`} texto="Solo un administrador anula ventas. Antes deben anularse sus facturas y pagos vigentes. La venta se conserva para trazabilidad y deja de contar en los indicadores." etiquetaBoton="Anular venta" peligro onCancelar={() => setModal(null)}
        onConfirmar={async (m) => { try { await anularVenta(token, v.id, m); showToast?.(`Venta ${v.folio} anulada`); setModal(null); await refrescar(); } catch (e) { showToast?.(mensajeVP(e), "error"); } }} />}
    </HojaLateral>
  );
}

const pedirAnular = (setModal, tabla, id, titulo, texto) => setModal({ t: "anular", tabla, id, titulo, texto });

// ── Detalle: cliente, origen, OC, ítems, precios, costos, margen y condiciones ─────────────────────
function Detalle({ token, d, v, esResp, esAdmin, vigente, vp, showToast, refrescar, setModal, onAbrir }) {
  const [editando, setEditando] = useState(false); const [f, setF] = useState(null); const [oc, setOc] = useState(false); const [compra, setCompra] = useState(false);
  const costos = new Map(d.costos.map((k) => [k.item_id, Number(k.costo_unitario_estimado)]));
  const m = d.margen; const verCostos = m?.costo_estimado != null;
  const entregado = (itemId) => d.entregaItems.filter((ei) => d.entregas.find((e) => e.id === ei.entrega_id)?.estado === "vigente" && ei.venta_item_id === itemId).reduce((s, x) => s + Number(x.cantidad), 0);
  const pdfAprobada = async () => {
    try { const doc = await documentoPublico(token, v.revision_id); const r = await generarPdfCotizacion(doc, { logo: await logoBFK(logoUrl) }); descargarBlob(r.blob, r.nombre); }
    catch (e) { showToast?.(`No se pudo generar el PDF: ${mensajeVP(e)}`, "error"); }
  };
  const guardar = async () => {
    try { await actualizarVenta(token, v.id, v.version, f); showToast?.("Venta actualizada"); setEditando(false); await refrescar(); } catch (e) { showToast?.(mensajeVP(e), "error"); }
  };
  return (<>
    <Seccion titulo="Cliente y origen">
      <div style={{ ...cardStyle, borderRadius: R.md, padding: "8px 14px" }}>
        <Fila k="Cliente" v={`${v.cliente_nombre} · ${v.cliente_rut || ""}`} />
        <Fila k="Origen" v={v.origen === "directa" ? "Venta directa (sin cotización)" : folioRevision(v.cotizacion_folio, v.cotizacion_revision)} />
        <Fila k="Fecha de la venta" v={fechaTxt(v.fecha)} />
        <Fila k="Responsable" v={v.responsable_nombre || "—"} />
        <Fila k="OC del cliente" v={v.oc_cliente_numeros || "Sin OC del cliente (orden interna)"} />
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
        {v.cotizacion_id && <button type="button" data-ir-cotizacion onClick={() => onAbrir?.("vp_cotizaciones", v.cotizacion_id)} style={estiloBoton()}>Ver cotización</button>}
        {v.revision_id && <button type="button" data-pdf-aprobada onClick={pdfAprobada} style={estiloBoton()}>PDF cotización aprobada</button>}
        {vigente && <button type="button" data-registrar-oc onClick={() => setOc(true)} style={estiloBoton()}>Registrar OC del cliente</button>}
        {vigente && esAdmin && <button type="button" data-anular-venta onClick={() => setModal({ t: "anular_venta" })} style={estiloBoton("peligro")}>Anular venta</button>}
      </div>
    </Seccion>
    {d.oc.length > 0 && <Seccion titulo="OC del cliente">
      {d.oc.map((o) => (
        <div key={o.id} data-oc-cliente={o.numero} style={{ ...cardStyle, borderRadius: R.md, padding: "8px 12px", marginBottom: 6, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", opacity: o.estado === "vigente" ? 1 : 0.55 }}>
          <b style={{ fontFamily: MONO }}>OC {o.numero}</b><span style={{ fontSize: T.small, color: C.inkMuted, flex: 1 }}>{fechaTxt(o.fecha)}{o.monto != null ? ` · ${pesos(o.monto)}` : ""}{o.documento_id ? " · con archivo" : ""}{o.estado !== "vigente" ? ` · anulada: ${o.anulacion_motivo}` : ""}</span>
          {o.estado === "vigente" && esResp && <button type="button" onClick={() => pedirAnular(setModal, "oc_cliente", o.id, `Anular OC ${o.numero}`)} style={estiloBoton("peligro")}>Anular</button>}
        </div>
      ))}
    </Seccion>}
    <Seccion titulo={`Ítems · ${d.items.length}`}>
      {d.items.map((it) => {
        const ent = entregado(it.id); const cu = costos.get(it.id);
        return (
          <div key={it.id} data-item-venta={it.orden} style={{ ...cardStyle, borderRadius: R.md, padding: "9px 12px", marginBottom: 6 }}>
            <div style={{ display: "flex", gap: 8 }}><b style={{ fontFamily: MONO, color: C.tealDark }}>{it.orden}</b><span style={{ flex: 1, fontSize: T.sm, fontWeight: 700 }}>{it.descripcion}</span><b style={{ fontFamily: MONO }}>{pesos(it.subtotal_neto)}</b></div>
            <div style={{ fontSize: T.small, color: C.inkMuted, marginTop: 3 }}>
              {cantidadTxt(it.cantidad)} {it.unidad} × {pesos(it.precio_unitario)}{Number(it.descuento_pct) ? ` − ${String(it.descuento_pct).replace(".", ",")} %` : ""} · entregado <b data-entregado={it.orden}>{cantidadTxt(ent)}</b> de {cantidadTxt(it.cantidad)}
              {verCostos && cu != null && <span style={{ color: C.warnText }}> · costo est. {pesos(redondear(cu * Number(it.cantidad)))}</span>}
            </div>
          </div>
        );
      })}
    </Seccion>
    {verCostos ? <Seccion titulo="Costos y margen (interno)" accion={vigente && <button type="button" data-registrar-compra onClick={() => setCompra(true)} style={estiloBoton()}>Registrar costo real</button>}>
      <div data-margen-venta style={{ ...cardStyle, borderRadius: R.md, padding: "8px 14px", background: "#FFFBF0" }}>
        <Fila k="Venta neta" v={pesos(v.neto)} />
        <Fila k="Costo estimado (cotización)" v={pesos(m.costo_estimado)} dato="costo-estimado" />
        <Fila k="Utilidad estimada" v={`${pesos(Number(v.neto) - Number(m.costo_estimado))} · ${pct(Number(v.neto) > 0 ? (Number(v.neto) - Number(m.costo_estimado)) / Number(v.neto) : null)}`} tono={Number(v.neto) - Number(m.costo_estimado) < 0 ? "danger" : "ok"} dato="utilidad-estimada" />
        {Number(m.lineas_sin_costo) > 0 && <div style={{ fontSize: T.small, color: C.warnText, padding: "4px 0" }}>{m.lineas_sin_costo} línea(s) sin costo estimado.</div>}
        <Fila k={`Costo real (${m.n_compras} registro${Number(m.n_compras) === 1 ? "" : "s"})`} v={Number(m.n_compras) ? pesos(m.costo_real) : "Sin compras registradas"} dato="costo-real" />
        {Number(m.n_compras) > 0 && <Fila k="Utilidad real" v={`${pesos(Number(v.neto) - Number(m.costo_real))} · ${pct(Number(v.neto) > 0 ? (Number(v.neto) - Number(m.costo_real)) / Number(v.neto) : null)}`} tono={Number(v.neto) - Number(m.costo_real) < 0 ? "danger" : "ok"} dato="utilidad-real" />}
        {Number(m.costo_real_desde_gastos) > 0 && <div style={{ fontSize: T.small, color: C.inkMuted, padding: "4px 0" }}>{pesos(m.costo_real_desde_gastos)} provienen de gastos ya registrados en Finanzas › Gastos (vinculados, no duplicados).</div>}
      </div>
      {d.compras.map((k) => (
        <div key={k.id} data-compra={k.origen} style={{ ...cardStyle, borderRadius: R.md, padding: "8px 12px", marginTop: 6, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", opacity: k.estado === "vigente" ? 1 : 0.55 }}>
          <span style={{ flex: 1, fontSize: T.sm }}><b>{k.proveedor || (k.origen === "gasto_existente" ? "Gasto vinculado" : "Compra")}</b> · {fechaTxt(k.fecha)}{k.documento_numero ? ` · ${k.documento_tipo || "doc."} ${k.documento_numero}` : ""}{k.origen === "gasto_existente" ? " · desde Gastos" : ""}{k.estado !== "vigente" ? ` · anulada: ${k.anulacion_motivo}` : ""}</span>
          <b style={{ fontFamily: MONO }}>{pesos(k.iva_recuperable ? k.neto : k.total)}</b>
          {k.estado === "vigente" && <button type="button" onClick={() => pedirAnular(setModal, "compra", k.id, "Anular costo real")} style={estiloBoton("peligro")}>Anular</button>}
        </div>
      ))}
    </Seccion> : <AvisoLinea tono="info" icono="🔒">Costos y márgenes: visibles solo para el responsable de la venta y los administradores.</AvisoLinea>}
    <Seccion titulo="Condiciones" accion={vigente && esResp && !editando && <button type="button" data-editar-venta onClick={() => { setF({ fecha_entrega_comprometida: v.fecha_entrega_comprometida || "", plazo_entrega: v.plazo_entrega || "", direccion_entrega: v.direccion_entrega || "", plazo_pago_dias: v.plazo_pago_dias, observaciones: d.cab.observaciones || "" }); setEditando(true); }} style={estiloBoton()}>Editar</button>}>
      {!editando ? <div style={{ ...cardStyle, borderRadius: R.md, padding: "8px 14px" }}>
        <Fila k="Entrega comprometida" v={v.fecha_entrega_comprometida ? fechaTxt(v.fecha_entrega_comprometida) : "Sin fecha"} />
        <Fila k="Plazo de entrega" v={v.plazo_entrega || "—"} />
        <Fila k="Dirección de entrega" v={v.direccion_entrega || "—"} />
        <Fila k="Condiciones de pago" v={v.condiciones_pago || "—"} />
        <Fila k="Plazo de pago" v={`${v.plazo_pago_dias} días desde la factura`} />
      </div> : <div>
        <Rejilla>
          <Campo etiqueta="Entrega comprometida"><Entrada data-editar-fecha-entrega type="date" value={f.fecha_entrega_comprometida} onChange={(e) => setF((x) => ({ ...x, fecha_entrega_comprometida: e.target.value }))} /></Campo>
          <Campo etiqueta="Plazo de pago (días)"><Entrada inputMode="numeric" value={f.plazo_pago_dias} onChange={(e) => setF((x) => ({ ...x, plazo_pago_dias: e.target.value }))} /></Campo>
          <Campo etiqueta="Plazo de entrega"><Entrada value={f.plazo_entrega} onChange={(e) => setF((x) => ({ ...x, plazo_entrega: e.target.value }))} /></Campo>
          <Campo etiqueta="Dirección de entrega"><Entrada value={f.direccion_entrega} onChange={(e) => setF((x) => ({ ...x, direccion_entrega: e.target.value }))} /></Campo>
        </Rejilla>
        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}><button type="button" onClick={() => setEditando(false)} style={estiloBoton()}>Cancelar</button><button type="button" data-guardar-venta onClick={guardar} style={estiloBoton("pri")}>Guardar</button></div>
      </div>}
    </Seccion>
    <Seccion titulo="Historial"><HistorialLista filas={d.historial} /></Seccion>
    {oc && <FormOC token={token} v={v} vp={vp} showToast={showToast} onCerrar={() => setOc(false)} onListo={async () => { setOc(false); await refrescar(); }} />}
    {compra && <FormCompra token={token} v={v} d={d} vp={vp} showToast={showToast} onCerrar={() => setCompra(false)} onListo={async () => { setCompra(false); await refrescar(); }} />}
  </>);
}

function FormOC({ token, v, vp, showToast, onCerrar, onListo }) {
  const [f, setF] = useState({ numero: "", fecha: hoyISO(), monto: "", observacion: "" }); const [archivo, setArchivo] = useState(null); const [err, setErr] = useState(""); const [ocupado, setOcupado] = useState(false);
  const ok = async () => {
    if (!f.numero.trim()) { setErr("Indica el número de la OC del cliente."); return; }
    setOcupado(true);
    try {
      let documento_id = null;
      if (archivo) { documento_id = (await subirDocumento(token, { ambito: "venta", id: v.id, categoria: "oc_cliente", titulo: `OC ${f.numero.trim()}`, archivo })).id; }
      await registrarOcCliente(token, { venta_id: v.id, ...f, monto: aPesos(f.monto), documento_id }); showToast?.(`OC ${f.numero.trim()} registrada`); onListo();
    } catch (e) { setErr(mensajeVP(e)); } finally { setOcupado(false); }
  };
  return (
    <Ventana titulo="Registrar OC del cliente" onCerrar={onCerrar} dato="form-oc" ancho={500}
      pie={<><button type="button" onClick={onCerrar} style={estiloBoton()}>Cancelar</button><button type="button" data-guardar-oc disabled={ocupado} onClick={ok} style={{ ...estiloBoton("pri"), minHeight: 44 }}>{ocupado ? "Guardando…" : "Registrar OC"}</button></>}>
      <p style={{ marginTop: 0, fontSize: T.sm, color: C.inkMuted }}>Documento que el cliente emitió a BFK para la venta {v.folio}.</p>
      <ErrorForm>{err}</ErrorForm>
      <Rejilla>
        <Campo etiqueta="N° OC del cliente"><Entrada data-oc-numero value={f.numero} onChange={(e) => setF((x) => ({ ...x, numero: e.target.value }))} maxLength={60} /></Campo>
        <Campo etiqueta="Fecha"><Entrada data-oc-fecha type="date" max={hoyISO()} value={f.fecha} onChange={(e) => setF((x) => ({ ...x, fecha: e.target.value }))} /></Campo>
        <Campo etiqueta="Monto (opcional)"><Entrada inputMode="numeric" value={f.monto} onChange={(e) => setF((x) => ({ ...x, monto: e.target.value }))} /></Campo>
      </Rejilla>
      {vp.documentosHabilitados ? <Campo etiqueta="Archivo (opcional)"><input data-oc-archivo type="file" onChange={(e) => setArchivo(e.target.files?.[0] || null)} /></Campo> : <div style={{ fontSize: T.small, color: C.inkFaint, marginBottom: 10 }}>La carga de archivos está deshabilitada.</div>}
      <Campo etiqueta="Observación"><Area value={f.observacion} onChange={(e) => setF((x) => ({ ...x, observacion: e.target.value }))} /></Campo>
    </Ventana>
  );
}

function FormCompra({ token, v, d, vp, showToast, onCerrar, onListo }) {
  const [origen, setOrigen] = useState("registro");
  const [f, setF] = useState({ proveedor: "", fecha: hoyISO(), documento_tipo: "factura", documento_numero: "", neto: "", iva: "", iva_recuperable: true, descripcion: "", venta_item_id: "" });
  const [gastos, setGastos] = useState(null); const [gasto, setGasto] = useState(null); const [q, setQ] = useState(""); const [err, setErr] = useState(""); const [ocupado, setOcupado] = useState(false);
  useEffect(() => { if (origen === "gasto_existente") buscarGastos(token, q).then(setGastos).catch((e) => setErr(mensajeVP(e))); }, [origen, q, token]);
  const ok = async () => {
    setOcupado(true); setErr("");
    try {
      if (origen === "gasto_existente") { if (!gasto) { setErr("Elige el gasto a vincular."); setOcupado(false); return; } await registrarCompra(token, { venta_id: v.id, origen, gasto_id: gasto.id, venta_item_id: f.venta_item_id || null, descripcion: f.descripcion || null }); }
      else await registrarCompra(token, { venta_id: v.id, origen, ...f, venta_item_id: f.venta_item_id || null, neto: aPesos(f.neto), iva: aPesos(f.iva) ?? 0 });
      showToast?.("Costo real registrado"); onListo();
    } catch (e) { setErr(mensajeVP(e)); } finally { setOcupado(false); }
  };
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  return (
    <Ventana titulo="Registrar costo real" onCerrar={onCerrar} dato="form-compra" ancho={600}
      pie={<><button type="button" onClick={onCerrar} style={estiloBoton()}>Cancelar</button><button type="button" data-guardar-compra disabled={ocupado} onClick={ok} style={{ ...estiloBoton("pri"), minHeight: 44 }}>{ocupado ? "Guardando…" : "Registrar"}</button></>}>
      <Pestanas etiqueta="Origen del costo" activa={origen} onCambiar={setOrigen} items={[{ key: "registro", label: "Compra de esta venta" }, { key: "gasto_existente", label: "Vincular gasto ya registrado" }]} />
      <ErrorForm>{err}</ErrorForm>
      <Campo etiqueta="Ítem (opcional)"><Selector value={f.venta_item_id} onChange={set("venta_item_id")} vacio="Toda la venta" opciones={d.items.map((it) => ({ v: it.id, l: `${it.orden}. ${it.descripcion.slice(0, 60)}` }))} /></Campo>
      {origen === "registro" ? <>
        <Rejilla>
          <Campo etiqueta="Proveedor"><Entrada data-compra-proveedor value={f.proveedor} onChange={set("proveedor")} /></Campo>
          <Campo etiqueta="Fecha"><Entrada type="date" max={hoyISO()} value={f.fecha} onChange={set("fecha")} /></Campo>
          <Campo etiqueta="Documento"><Selector value={f.documento_tipo} onChange={set("documento_tipo")} opciones={[{ v: "factura", l: "Factura" }, { v: "boleta", l: "Boleta" }, { v: "guia", l: "Guía" }, { v: "otro", l: "Otro" }]} /></Campo>
          <Campo etiqueta="N° documento"><Entrada value={f.documento_numero} onChange={set("documento_numero")} /></Campo>
          <Campo etiqueta="Neto"><Entrada data-compra-neto inputMode="numeric" value={f.neto} onChange={(e) => setF((x) => ({ ...x, neto: e.target.value, iva: x.documento_tipo === "factura" && e.target.value !== "" ? String(redondear((aPesos(e.target.value) || 0) * TASA_IVA)) : x.iva }))} /></Campo>
          <Campo etiqueta="IVA"><Entrada inputMode="numeric" value={f.iva} onChange={set("iva")} /></Campo>
        </Rejilla>
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: T.sm, marginBottom: 10 }}><input type="checkbox" checked={f.iva_recuperable} onChange={set("iva_recuperable")} /> IVA recuperable (el costo es el neto; si no, el total)</label>
      </> : <>
        <p style={{ fontSize: T.sm, color: C.inkMuted, marginTop: 0 }}>El gasto ya está en Finanzas › Gastos: se vincula como costo de esta venta sin copiarlo (un gasto solo se vincula a una venta).</p>
        <Entrada placeholder="Buscar por descripción" value={q} onChange={(e) => setQ(e.target.value)} />
        <div style={{ maxHeight: 220, overflowY: "auto", marginTop: 6 }}>
          {(gastos || []).map((g) => (
            <button key={g.id} type="button" data-gasto={g.id} onClick={() => setGasto(g)} style={{ width: "100%", textAlign: "left", border: `1.5px solid ${gasto?.id === g.id ? C.teal : C.border}`, background: gasto?.id === g.id ? C.tealLight : C.card, borderRadius: R.sm, padding: "7px 10px", marginBottom: 4, cursor: "pointer" }}>
              <b style={{ fontFamily: MONO }}>{pesos(g.monto)}</b> · {fechaTxt(g.fecha)} · {g.descripcion || "Sin descripción"}
            </button>
          ))}
          {gastos && !gastos.length && <Vacio>Sin gastos.</Vacio>}
        </div>
      </>}
      <Campo etiqueta="Descripción"><Area value={f.descripcion} onChange={set("descripcion")} /></Campo>
      {origen === "registro" && <div style={{ fontSize: T.small, color: C.inkFaint }}>El respaldo (factura del proveedor) se adjunta en Documentos como «Respaldo de compra (interno)».</div>}
    </Ventana>
  );
}

// ── Entregas ──────────────────────────────────────────────────────────────────────────────────────
function Entregas({ token, d, v, esResp, vigente, vp, showToast, refrescar, setModal }) {
  const [form, setForm] = useState(false);
  const pendientes = d.items.map((it) => {
    const ent = d.entregaItems.filter((ei) => d.entregas.find((e) => e.id === ei.entrega_id)?.estado === "vigente" && ei.venta_item_id === it.id).reduce((s, x) => s + Number(x.cantidad), 0);
    return { ...it, entregado: ent, pendiente: Number(it.cantidad) - ent };
  });
  return (<>
    <Seccion titulo="Pendiente por entregar" accion={vigente && pendientes.some((p) => p.pendiente > 0) && <button type="button" data-registrar-entrega onClick={() => setForm(true)} style={estiloBoton("pri")}>Registrar entrega</button>}>
      <div style={{ ...cardStyle, borderRadius: R.md, padding: "6px 14px" }}>
        {pendientes.map((p) => <Fila key={p.id} k={`${p.orden}. ${p.descripcion.slice(0, 70)}`} v={`${cantidadTxt(p.entregado)} / ${cantidadTxt(p.cantidad)} ${p.unidad}`} tono={p.pendiente > 0 ? "warn" : "ok"} dato={`pend-${p.orden}`} />)}
      </div>
      {v.fecha_entrega_comprometida && <div style={{ fontSize: T.small, color: C.inkMuted, marginTop: 6 }}>Entrega comprometida: {fechaTxt(v.fecha_entrega_comprometida)}</div>}
    </Seccion>
    <Seccion titulo={`Entregas registradas · ${d.entregas.length}`}>
      {!d.entregas.length && <Vacio>Sin entregas registradas.</Vacio>}
      {d.entregas.map((e) => (
        <div key={e.id} data-entrega={e.numero} style={{ ...cardStyle, borderRadius: R.md, padding: "9px 12px", marginBottom: 6, opacity: e.estado === "vigente" ? 1 : 0.55 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <b>Entrega {e.numero}</b><Badge tono={e.tipo === "servicio" ? "info" : "neutro"}>{e.tipo === "servicio" ? "Ejecución de servicio" : "Despacho"}</Badge>
            <span style={{ fontSize: T.small, color: C.inkMuted, flex: 1 }}>{fechaTxt(e.fecha)}{e.guia_numero ? ` · guía ${e.guia_numero}` : ""}{e.recibido_por ? ` · recibió ${e.recibido_por}` : ""}{e.estado !== "vigente" ? ` · anulada: ${e.anulacion_motivo}` : ""}</span>
            {e.estado === "vigente" && esResp && <button type="button" onClick={() => pedirAnular(setModal, "entrega", e.id, `Anular entrega ${e.numero}`, "Las cantidades vuelven a quedar pendientes.")} style={estiloBoton("peligro")}>Anular</button>}
          </div>
          <div style={{ fontSize: T.small, color: C.inkMuted, marginTop: 4 }}>{d.entregaItems.filter((x) => x.entrega_id === e.id).map((x) => { const it = d.items.find((i) => i.id === x.venta_item_id); return `${it?.orden}. ${cantidadTxt(x.cantidad)} ${it?.unidad}`; }).join(" · ")}</div>
        </div>
      ))}
    </Seccion>
    {form && <FormEntrega token={token} v={v} vp={vp} pendientes={pendientes} showToast={showToast} onCerrar={() => setForm(false)} onListo={async () => { setForm(false); await refrescar(); }} />}
  </>);
}
function FormEntrega({ token, v, vp, pendientes, showToast, onCerrar, onListo }) {
  const conPend = pendientes.filter((p) => p.pendiente > 0);
  const [f, setF] = useState({ tipo: conPend.every((p) => p.tipo === "servicio") ? "servicio" : "despacho", fecha: hoyISO(), guia_numero: "", recibido_por: "", observacion: "" });
  const [cant, setCant] = useState(() => Object.fromEntries(conPend.map((p) => [p.id, String(p.pendiente)])));
  const [archivo, setArchivo] = useState(null); const [err, setErr] = useState(""); const [ocupado, setOcupado] = useState(false);
  const ok = async () => {
    const items = Object.entries(cant).map(([id, q]) => ({ venta_item_id: id, cantidad: Number(String(q).replace(",", ".")) })).filter((x) => x.cantidad > 0);
    if (!items.length) { setErr("Indica al menos una cantidad entregada."); return; }
    const exceso = items.find((x) => x.cantidad > conPend.find((p) => p.id === x.venta_item_id).pendiente + 1e-9);
    if (exceso) { setErr("Una cantidad supera lo pendiente por entregar."); return; }
    setOcupado(true);
    try {
      let documento_id = null;
      if (archivo) { documento_id = (await subirDocumento(token, { ambito: "venta", id: v.id, categoria: f.tipo === "despacho" ? "guia_despacho" : "comprobante_entrega", titulo: `Entrega ${v.folio}`, archivo })).id; }
      await registrarEntrega(token, { venta_id: v.id, ...f, documento_id, items }); showToast?.("Entrega registrada"); onListo();
    } catch (e) { setErr(mensajeVP(e)); } finally { setOcupado(false); }
  };
  return (
    <Ventana titulo="Registrar entrega" onCerrar={onCerrar} dato="form-entrega" ancho={620}
      pie={<><button type="button" onClick={onCerrar} style={estiloBoton()}>Cancelar</button><button type="button" data-guardar-entrega disabled={ocupado} onClick={ok} style={{ ...estiloBoton("pri"), minHeight: 44 }}>{ocupado ? "Guardando…" : "Registrar entrega"}</button></>}>
      <ErrorForm>{err}</ErrorForm>
      <Rejilla>
        <Campo etiqueta="Tipo"><Selector value={f.tipo} onChange={(e) => setF((x) => ({ ...x, tipo: e.target.value }))} opciones={[{ v: "despacho", l: "Despacho de productos" }, { v: "servicio", l: "Ejecución de servicio" }]} /></Campo>
        <Campo etiqueta="Fecha"><Entrada data-entrega-fecha type="date" max={hoyISO()} value={f.fecha} onChange={(e) => setF((x) => ({ ...x, fecha: e.target.value }))} /></Campo>
        <Campo etiqueta="N° guía / comprobante"><Entrada value={f.guia_numero} onChange={(e) => setF((x) => ({ ...x, guia_numero: e.target.value }))} /></Campo>
        <Campo etiqueta="Recibido por"><Entrada value={f.recibido_por} onChange={(e) => setF((x) => ({ ...x, recibido_por: e.target.value }))} /></Campo>
      </Rejilla>
      <div style={{ fontSize: T.small, fontWeight: 800, color: C.inkMuted, textTransform: "uppercase", margin: "4px 0 6px" }}>Cantidades de esta entrega (parcial o total)</div>
      {conPend.map((p) => (
        <div key={p.id} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
          <span style={{ flex: 1, fontSize: T.sm }}>{p.orden}. {p.descripcion.slice(0, 60)} <span style={{ color: C.inkFaint }}>(pendiente {cantidadTxt(p.pendiente)} {p.unidad})</span></span>
          <Entrada data-entrega-cantidad={p.orden} inputMode="decimal" value={cant[p.id]} onChange={(e) => setCant((x) => ({ ...x, [p.id]: e.target.value }))} style={{ width: 110, fontFamily: MONO }} />
        </div>
      ))}
      {vp.documentosHabilitados && <Campo etiqueta="Comprobante (opcional)"><input type="file" onChange={(e) => setArchivo(e.target.files?.[0] || null)} /></Campo>}
      <Campo etiqueta="Observación"><Area value={f.observacion} onChange={(e) => setF((x) => ({ ...x, observacion: e.target.value }))} /></Campo>
    </Ventana>
  );
}

// ── Documentos: cotización aprobada, EETT, OC, facturas y otros respaldos ─────────────────────────
function Documentos({ token, d, v, esResp, vigente, vp, showToast, refrescar, setModal }) {
  const [form, setForm] = useState(false);
  const facturas = d.facturas;
  return (<>
    <AvisoLinea tono="info" icono="ℹ">Las facturas se emiten en el SII. Aquí se <b>registran</b> (número, fecha, montos y archivo) para controlar facturación y cobro; BFK Datos no emite documentos tributarios.</AvisoLinea>
    <Seccion titulo={`Facturas registradas · ${facturas.filter((f) => f.estado === "vigente").length}`} accion={vigente && esResp && Number(v.por_facturar) > 0 && <button type="button" data-registrar-factura onClick={() => setForm(true)} style={estiloBoton("pri")}>Registrar factura</button>}>
      {!facturas.length && <Vacio>Sin facturas registradas. Por facturar: {pesos(v.por_facturar)}.</Vacio>}
      {facturas.map((f) => {
        const aplicado = d.imputaciones.filter((i) => i.factura_id === f.id && i.estado === "vigente").reduce((s, i) => s + Number(i.monto), 0);
        return (
          <div key={f.id} data-factura={f.numero} style={{ ...cardStyle, borderRadius: R.md, padding: "9px 12px", marginBottom: 6, opacity: f.estado === "vigente" ? 1 : 0.55, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ flex: 1, minWidth: 180 }}><b>{TIPOS_DOCUMENTO_VENTA.find((x) => x.v === f.tipo_documento)?.l} N° {f.numero}</b><span style={{ display: "block", fontSize: T.small, color: C.inkMuted }}>{fechaTxt(f.fecha)} · neto {pesos(f.neto)} · IVA {pesos(f.iva)} · vence {fechaTxt(new Date(new Date(f.fecha + "T12:00:00Z").getTime() + v.plazo_pago_dias * 86400000).toISOString().slice(0, 10))} · pagos aplicados {pesos(aplicado)}{f.estado !== "vigente" ? ` · anulada: ${f.anulacion_motivo}` : ""}</span></span>
            <b style={{ fontFamily: MONO }}>{pesos(f.total)}</b>
            {f.estado === "vigente" && esResp && <button type="button" onClick={() => pedirAnular(setModal, "factura", f.id, `Anular registro de factura ${f.numero}`, "Si la factura se anuló en el SII con nota de crédito, registra aquí su anulación. Las aplicaciones de pago deben anularse primero.")} style={estiloBoton("peligro")}>Anular</button>}
          </div>
        );
      })}
    </Seccion>
    <Seccion titulo="Cotización aprobada y EETT">
      {v.revision_id ? <div style={{ ...cardStyle, borderRadius: R.md, padding: "9px 12px", marginBottom: 6 }}>Cotización aprobada <b style={{ fontFamily: MONO }}>{folioRevision(v.cotizacion_folio, v.cotizacion_revision)}</b> (PDF desde la pestaña Detalle).</div> : <Vacio>Venta directa: sin cotización aprobada.</Vacio>}
      {d.eett.map((e) => (
        <div key={e.id} data-eett-venta={`${e.folio}-R${e.revision}`} style={{ ...cardStyle, borderRadius: R.md, padding: "9px 12px", marginBottom: 6, display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ flex: 1 }}><b style={{ fontFamily: MONO }}>{e.folio} · Rev. {e.revision}</b> {e.id === v.eett_id && <Badge tono="ok">Vinculada a esta venta</Badge>} {e.estado === "reemplazada" && <Badge>Reemplazada</Badge>}</span>
          <button type="button" data-pdf-eett-venta onClick={() => descargarEETT(token, e.id, vp.empresa, showToast)} style={estiloBoton()}>PDF</button>
        </div>
      ))}
    </Seccion>
    <Seccion titulo="Archivos">
      {vigente && <SubirArchivo token={token} ambito="venta" id={v.id} categorias={esResp ? ["oc_cliente", "factura", "guia_despacho", "comprobante_entrega", "comprobante_pago", "compra", "certificado", "otro"] : ["oc_cliente", "guia_despacho", "comprobante_entrega", "certificado", "otro"]} habilitado={vp.documentosHabilitados} showToast={showToast} onSubido={refrescar} />}
      <ListaDocumentos token={token} documentos={d.documentos} showToast={showToast} onAnular={(doc) => pedirAnular(setModal, "documento", doc.id, "Anular archivo")} />
    </Seccion>
    {form && <FormFactura token={token} v={v} vp={vp} showToast={showToast} onCerrar={() => setForm(false)} onListo={async () => { setForm(false); await refrescar(); }} />}
  </>);
}
function FormFactura({ token, v, vp, showToast, onCerrar, onListo }) {
  const porFact = Number(v.por_facturar);
  const netoSug = v.afecta_iva ? Math.round(porFact / (1 + Number(v.tasa_iva))) : porFact;
  const [f, setF] = useState({ tipo_documento: v.afecta_iva ? "factura_afecta" : "factura_exenta", numero: "", fecha: hoyISO(), neto: String(netoSug), iva: String(v.afecta_iva ? porFact - netoSug : 0), observacion: "" });
  const [archivo, setArchivo] = useState(null); const [err, setErr] = useState(""); const [ocupado, setOcupado] = useState(false);
  const setNeto = (e) => { const n = e.target.value; setF((x) => ({ ...x, neto: n, iva: x.tipo_documento === "factura_afecta" && n !== "" ? String(redondear((aPesos(n) || 0) * Number(v.tasa_iva))) : x.tipo_documento === "factura_exenta" ? "0" : x.iva })); };
  const total = (aPesos(f.neto) || 0) + (aPesos(f.iva) || 0);
  const ok = async () => {
    if (!f.numero.trim()) { setErr("Indica el número (folio) de la factura."); return; }
    if (total > porFact) { setErr(`El total (${pesos(total)}) supera lo pendiente por facturar (${pesos(porFact)}).`); return; }
    setOcupado(true);
    try {
      let documento_id = null;
      if (archivo) { documento_id = (await subirDocumento(token, { ambito: "venta", id: v.id, categoria: "factura", titulo: `Factura ${f.numero.trim()}`, archivo })).id; }
      await registrarFactura(token, { venta_id: v.id, ...f, neto: aPesos(f.neto), iva: aPesos(f.iva) ?? 0, documento_id }); showToast?.(`Factura ${f.numero.trim()} registrada`); onListo();
    } catch (e) { setErr(mensajeVP(e)); } finally { setOcupado(false); }
  };
  return (
    <Ventana titulo="Registrar factura emitida en el SII" onCerrar={onCerrar} dato="form-factura" ancho={560}
      pie={<><button type="button" onClick={onCerrar} style={estiloBoton()}>Cancelar</button><button type="button" data-guardar-factura disabled={ocupado} onClick={ok} style={{ ...estiloBoton("pri"), minHeight: 44 }}>{ocupado ? "Guardando…" : "Registrar factura"}</button></>}>
      <ErrorForm>{err}</ErrorForm>
      <Rejilla>
        <Campo etiqueta="Tipo de documento"><Selector value={f.tipo_documento} onChange={(e) => setF((x) => ({ ...x, tipo_documento: e.target.value, iva: e.target.value === "factura_exenta" ? "0" : x.iva }))} opciones={TIPOS_DOCUMENTO_VENTA} /></Campo>
        <Campo etiqueta="N° (folio SII)"><Entrada data-factura-numero value={f.numero} onChange={(e) => setF((x) => ({ ...x, numero: e.target.value }))} maxLength={30} /></Campo>
        <Campo etiqueta="Fecha de emisión"><Entrada data-factura-fecha type="date" max={hoyISO()} value={f.fecha} onChange={(e) => setF((x) => ({ ...x, fecha: e.target.value }))} /></Campo>
        <Campo etiqueta="Neto"><Entrada data-factura-neto inputMode="numeric" value={f.neto} onChange={setNeto} /></Campo>
        <Campo etiqueta="IVA"><Entrada data-factura-iva inputMode="numeric" value={f.iva} onChange={(e) => setF((x) => ({ ...x, iva: e.target.value }))} /></Campo>
        <Campo etiqueta="Total"><Entrada disabled value={pesos(total)} /></Campo>
      </Rejilla>
      <div style={{ fontSize: T.small, color: C.inkMuted, marginBottom: 10 }}>Pendiente por facturar: <b>{pesos(porFact)}</b>. Se puede facturar en partes.</div>
      {vp.documentosHabilitados && <Campo etiqueta="Archivo de la factura (PDF del SII, opcional)"><input type="file" onChange={(e) => setArchivo(e.target.files?.[0] || null)} /></Campo>}
      <Campo etiqueta="Observación"><Area value={f.observacion} onChange={(e) => setF((x) => ({ ...x, observacion: e.target.value }))} /></Campo>
    </Ventana>
  );
}

// ── Pagos: anticipos, abonos, aplicación a facturas y saldo ──────────────────────────────────────
function Pagos({ token, d, v, esResp, vigente, vp, showToast, refrescar, setModal }) {
  const [form, setForm] = useState(false); const [imputar, setImputar] = useState(null);
  const facturasVig = d.facturas.filter((f) => f.estado === "vigente");
  return (<>
    <div style={{ ...cardStyle, borderRadius: R.md, padding: "8px 14px", marginBottom: 12 }}>
      <Fila k="Total de la venta" v={pesos(v.total)} />
      <Fila k="Cobrado (pagos vigentes)" v={pesos(v.cobrado)} dato="cobrado" />
      <Fila k="Saldo pendiente" v={pesos(v.saldo)} fuerte tono={Number(v.monto_vencido) > 0 ? "danger" : Number(v.saldo) > 0 ? "warn" : "ok"} dato="saldo" />
      {Number(v.monto_vencido) > 0 && <Fila k={`Vencido desde ${fechaTxt(v.primer_vencimiento)}`} v={pesos(v.monto_vencido)} tono="danger" dato="vencido" />}
    </div>
    <Seccion titulo={`Pagos · ${d.pagos.length}`} accion={vigente && esResp && Number(v.saldo) > 0 && <button type="button" data-registrar-pago onClick={() => setForm(true)} style={estiloBoton("pri")}>Registrar pago</button>}>
      {!d.pagos.length && <Vacio>Sin pagos registrados.</Vacio>}
      {d.pagos.map((p) => {
        const imps = d.imputaciones.filter((i) => i.pago_id === p.id && i.estado === "vigente");
        const aplicado = imps.reduce((s, i) => s + Number(i.monto), 0);
        return (
          <div key={p.id} data-pago={p.tipo} style={{ ...cardStyle, borderRadius: R.md, padding: "9px 12px", marginBottom: 6, opacity: p.estado === "vigente" ? 1 : 0.55 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <Badge tono={p.tipo === "anticipo" ? "info" : "neutro"}>{p.tipo === "anticipo" ? "Anticipo" : "Abono"}</Badge>
              <span style={{ flex: 1, fontSize: T.small, color: C.inkMuted }}>{fechaTxt(p.fecha)} · {MEDIOS_PAGO.find((m) => m.v === p.medio)?.l}{p.referencia ? ` · ${p.referencia}` : ""}{p.estado !== "vigente" ? ` · anulado: ${p.anulacion_motivo}` : ""}</span>
              <b style={{ fontFamily: MONO }}>{pesos(p.monto)}</b>
            </div>
            {p.estado === "vigente" && <div style={{ fontSize: T.small, color: C.inkMuted, marginTop: 4, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ flex: 1 }}>{imps.length ? `Aplicado a ${imps.map((i) => `factura ${d.facturas.find((f) => f.id === i.factura_id)?.numero} (${pesos(i.monto)})`).join(", ")}` : "Sin aplicar a una factura"}{aplicado < Number(p.monto) && imps.length ? ` · disponible ${pesos(Number(p.monto) - aplicado)}` : ""}</span>
              {esResp && aplicado < Number(p.monto) && facturasVig.length > 0 && <button type="button" data-imputar-pago onClick={() => setImputar(p)} style={estiloBoton()}>Aplicar a factura</button>}
              {esResp && <button type="button" onClick={() => pedirAnular(setModal, "pago", p.id, "Anular pago", "El saldo vuelve a quedar pendiente. Sus aplicaciones a facturas también se anulan.")} style={estiloBoton("peligro")}>Anular</button>}
            </div>}
          </div>
        );
      })}
      <div style={{ fontSize: T.small, color: C.inkFaint, marginTop: 6 }}>Aplicar un anticipo a una factura no crea otro cobro: el monto cobrado se cuenta una sola vez.</div>
    </Seccion>
    {form && <FormPago token={token} v={v} vp={vp} facturas={facturasVig} imputaciones={d.imputaciones} showToast={showToast} onCerrar={() => setForm(false)} onListo={async () => { setForm(false); await refrescar(); }} />}
    {imputar && <FormImputar token={token} pago={imputar} facturas={facturasVig} imputaciones={d.imputaciones} showToast={showToast} onCerrar={() => setImputar(null)} onListo={async () => { setImputar(null); await refrescar(); }} />}
  </>);
}
function FormPago({ token, v, vp, facturas, imputaciones, showToast, onCerrar, onListo }) {
  const clave = useRef(nuevaClave());
  const [f, setF] = useState({ tipo: Number(v.facturado) > 0 ? "abono" : "anticipo", fecha: hoyISO(), monto: String(v.saldo), medio: "transferencia", referencia: "", observacion: "", factura_id: "" });
  const [archivo, setArchivo] = useState(null); const [err, setErr] = useState(""); const [ocupado, setOcupado] = useState(false);
  const pendFact = (fid) => { const fa = facturas.find((x) => x.id === fid); return fa ? Number(fa.total) - imputaciones.filter((i) => i.factura_id === fid && i.estado === "vigente").reduce((s, i) => s + Number(i.monto), 0) : 0; };
  const ok = async () => {
    const m = aPesos(f.monto);
    if (!(m > 0)) { setErr("El monto debe ser mayor que cero."); return; }
    if (m > Number(v.saldo)) { setErr(`El monto supera el saldo pendiente (${pesos(v.saldo)}).`); return; }
    if (f.factura_id && m > pendFact(f.factura_id)) { setErr(`La factura tiene ${pesos(pendFact(f.factura_id))} pendiente de aplicar.`); return; }
    setOcupado(true);
    try {
      let documento_id = null;
      if (archivo) { documento_id = (await subirDocumento(token, { ambito: "venta", id: v.id, categoria: "comprobante_pago", titulo: `Comprobante pago ${v.folio}`, archivo })).id; }
      const r = await registrarPago(token, { clave: clave.current, venta_id: v.id, ...f, monto: m, factura_id: f.factura_id || null, documento_id });
      showToast?.(r.ya_existia ? "Ese pago ya estaba registrado (no se duplicó)" : "Pago registrado"); onListo();
    } catch (e) { setErr(mensajeVP(e)); } finally { setOcupado(false); }
  };
  return (
    <Ventana titulo="Registrar pago del cliente" onCerrar={onCerrar} dato="form-pago" ancho={540}
      pie={<><button type="button" onClick={onCerrar} style={estiloBoton()}>Cancelar</button><button type="button" data-guardar-pago disabled={ocupado} onClick={ok} style={{ ...estiloBoton("pri"), minHeight: 44 }}>{ocupado ? "Guardando…" : "Registrar pago"}</button></>}>
      <ErrorForm>{err}</ErrorForm>
      <Rejilla>
        <Campo etiqueta="Tipo"><Selector data-pago-tipo value={f.tipo} onChange={(e) => setF((x) => ({ ...x, tipo: e.target.value }))} opciones={[{ v: "anticipo", l: "Anticipo (antes de facturar)" }, { v: "abono", l: "Abono / pago" }]} /></Campo>
        <Campo etiqueta="Fecha"><Entrada data-pago-fecha type="date" max={hoyISO()} value={f.fecha} onChange={(e) => setF((x) => ({ ...x, fecha: e.target.value }))} /></Campo>
        <Campo etiqueta="Monto"><Entrada data-pago-monto inputMode="numeric" value={f.monto} onChange={(e) => setF((x) => ({ ...x, monto: e.target.value }))} /></Campo>
        <Campo etiqueta="Medio de pago"><Selector value={f.medio} onChange={(e) => setF((x) => ({ ...x, medio: e.target.value }))} opciones={MEDIOS_PAGO} /></Campo>
        <Campo etiqueta="Referencia (N° transferencia, cheque…)"><Entrada value={f.referencia} onChange={(e) => setF((x) => ({ ...x, referencia: e.target.value }))} maxLength={120} /></Campo>
        {facturas.length > 0 && <Campo etiqueta="Aplicar a factura (opcional)"><Selector data-pago-factura value={f.factura_id} onChange={(e) => setF((x) => ({ ...x, factura_id: e.target.value }))} vacio="No aplicar ahora" opciones={facturas.map((fa) => ({ v: fa.id, l: `N° ${fa.numero} · pendiente ${pesos(pendFact(fa.id))}` }))} /></Campo>}
      </Rejilla>
      <div style={{ fontSize: T.small, color: C.inkMuted, marginBottom: 10 }}>Saldo pendiente: <b>{pesos(v.saldo)}</b>.</div>
      {vp.documentosHabilitados && <Campo etiqueta="Comprobante (opcional)"><input type="file" onChange={(e) => setArchivo(e.target.files?.[0] || null)} /></Campo>}
      <Campo etiqueta="Observación"><Area value={f.observacion} onChange={(e) => setF((x) => ({ ...x, observacion: e.target.value }))} /></Campo>
    </Ventana>
  );
}
function FormImputar({ token, pago, facturas, imputaciones, showToast, onCerrar, onListo }) {
  const disp = Number(pago.monto) - imputaciones.filter((i) => i.pago_id === pago.id && i.estado === "vigente").reduce((s, i) => s + Number(i.monto), 0);
  const pend = (fid) => { const fa = facturas.find((x) => x.id === fid); return fa ? Number(fa.total) - imputaciones.filter((i) => i.factura_id === fid && i.estado === "vigente").reduce((s, i) => s + Number(i.monto), 0) : 0; };
  const [fid, setFid] = useState(facturas.find((fa) => pend(fa.id) > 0)?.id || ""); const [m, setM] = useState(() => String(Math.min(disp, pend(facturas.find((fa) => pend(fa.id) > 0)?.id))));
  const [err, setErr] = useState(""); const [ocupado, setOcupado] = useState(false);
  const ok = async () => { setOcupado(true); try { await imputarPago(token, pago.id, fid, aPesos(m)); showToast?.("Pago aplicado a la factura (el cobro no cambia)"); onListo(); } catch (e) { setErr(mensajeVP(e)); } finally { setOcupado(false); } };
  return (
    <Ventana titulo="Aplicar pago a factura" onCerrar={onCerrar} dato="form-imputar" ancho={460}
      pie={<><button type="button" onClick={onCerrar} style={estiloBoton()}>Cancelar</button><button type="button" data-guardar-imputacion disabled={ocupado || !fid} onClick={ok} style={{ ...estiloBoton("pri"), minHeight: 44 }}>{ocupado ? "Guardando…" : "Aplicar"}</button></>}>
      <p style={{ marginTop: 0, fontSize: T.sm, color: C.inkMuted }}>{pago.tipo === "anticipo" ? "Anticipo" : "Pago"} del {fechaTxt(pago.fecha)} · disponible {pesos(disp)}. Aplicarlo no suma un nuevo cobro.</p>
      <ErrorForm>{err}</ErrorForm>
      <Campo etiqueta="Factura"><Selector value={fid} onChange={(e) => { setFid(e.target.value); setM(String(Math.min(disp, pend(e.target.value)))); }} opciones={facturas.map((fa) => ({ v: fa.id, l: `N° ${fa.numero} · pendiente ${pesos(pend(fa.id))}` }))} /></Campo>
      <Campo etiqueta="Monto a aplicar"><Entrada inputMode="numeric" value={m} onChange={(e) => setM(e.target.value)} /></Campo>
    </Ventana>
  );
}
