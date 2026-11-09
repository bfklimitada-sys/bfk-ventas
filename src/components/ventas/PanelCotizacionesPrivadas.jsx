// Ventas privadas › Cotizaciones privadas: lista con búsqueda y filtros y pestaña «Biblioteca técnica». Cada cotización se abre en
// EditorCotizacionPrivada (misma experiencia que la cotización de Mercado Público: Datos · Productos · Precios · EETT), con el
// flujo privado: revisiones, PDF para el cliente (sin costos), registro MANUAL de envío/aceptación/rechazo/vencimiento,
// duplicar, «Crear venta / Registrar OC» y EETT.
import { useEffect, useMemo, useState } from "react";
import { C, MONO, R, S, T, cardStyle } from "../../lib/theme";
import { Seccion, Pestanas, PanelPestana, Badge } from "../ui/Sistema";
import { Entrada, Selector } from "../proyectos/Comunes";
import { NoInstalado, Vacio, estiloBoton, BadgeVP, Kpi, RejillaKpi } from "./Comunes";
import { BibliotecaTecnica } from "./BibliotecaTecnica";
import { EditorCotizacionPrivada, HistorialLista } from "./EditorCotizacionPrivada";
import { ESTADOS_COTIZACION, filtrarCotizaciones, pesos, fechaTxt, folioRevision } from "../../lib/ventasPrivadas";
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
      {abierta && <EditorCotizacionPrivada key={abierta} token={token} perfil={perfil} vp={vp} id={abierta === "nueva" ? null : abierta} showToast={showToast} usuarioId={perfil?.id || null}
        onCerrar={cerrar} onRecargar={onRecargar} onAbierta={(id) => { const x = vp.cotizaciones.find((y) => y.id === id); if (x) window.history.replaceState(null, "", hashVP("vp_cotizaciones", x.folio)); setAbierta(id); }} onAbrir={onAbrir} />}
    </div>
  );
}

// La ficha de la cotización es el editor con la misma experiencia de Mercado Público (EditorCotizacionPrivada.jsx).
export { HistorialLista };
