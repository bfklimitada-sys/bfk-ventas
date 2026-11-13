// Ventas privadas › Cotizaciones privadas: lista con búsqueda y filtros y pestaña «Biblioteca técnica». Cada cotización se abre en
// EditorCotizacionPrivada (misma experiencia que la cotización de Mercado Público: Datos · Productos · Precios · EETT), con el
// flujo privado: revisiones, PDF para el cliente (sin costos), registro MANUAL de envío/aceptación/rechazo/vencimiento,
// duplicar, «Crear venta / Registrar OC» y EETT.
import { useEffect, useMemo, useState } from "react";
import { C, MONO, R, S, T, cardStyle } from "../../lib/theme";
import { Seccion, Pestanas, PanelPestana, Badge, FiltrosAgrupados, Ayuda } from "../ui/Sistema";
import { useEsEscritorio } from "../ui/Navegacion";
import { Entrada, Selector } from "../proyectos/Comunes";
import { NoInstalado, Vacio, estiloBoton, BadgeVP, Kpi, RejillaKpi } from "./Comunes";
import { BibliotecaTecnica } from "./BibliotecaTecnica";
import { EditorCotizacionPrivada, HistorialLista } from "./EditorCotizacionPrivada";
import { ESTADOS_COTIZACION, filtrarCotizaciones, pesos, fechaTxt, folioRevision } from "../../lib/ventasPrivadas";
import { folioVPDesdeHash, hashVP } from "../../lib/navegacion";
import { claveVendedor, nombreVendedor, gruposVendedor, filtrarPorVendedor } from "../../lib/vpFinanciamiento";

// Fecha de un filtro: en el panel «Filtros» (celular y tableta) lleva su rótulo encima; en computador, como antes, solo el campo.
const FiltroFecha = ({ etiqueta, compacto, ...p }) => compacto
  ? <label style={{ display: "grid", gap: 4, fontSize: T.small, fontWeight: 600, color: C.inkMuted, minWidth: 0 }}>{etiqueta}<Entrada type="date" aria-label={etiqueta} {...p} /></label>
  : <Entrada type="date" aria-label={etiqueta} title={etiqueta} {...p} />;

const FILTROS = [{ v: "", l: "Todos los estados" }, ...["borrador", "enviada", "aceptada", "rechazada", "vencida"].map((k) => ({ v: k, l: ESTADOS_COTIZACION[k].l }))];

export function PanelCotizacionesPrivadas({ token, perfil, vp, onRecargar, showToast, onAbrir, focoId, onFocoUsado, nuevaSolicitada, onNuevaUsada }) {
  const [pestana, setPestana] = useState("cotizaciones");
  const [texto, setTexto] = useState(""); const [estado, setEstado] = useState(""); const [cliente, setCliente] = useState(""); const [desde, setDesde] = useState(""); const [hasta, setHasta] = useState("");
  const [abierta, setAbierta] = useState(null);   // id | "nueva"
  const [vendedor, setVendedor] = useState("*");
  const escritorio = useEsEscritorio();
  // Enlace directo #/cotizaciones-privadas/CP-AAAA-NNNN
  useEffect(() => {
    const sync = (ev) => { const f = folioVPDesdeHash(window.location.hash, "vp_cotizaciones"); if (!f) { if (ev) setAbierta((a) => (a === "nueva" ? a : null)); return; } { const c = vp.cotizaciones.find((x) => x.folio === f); if (c) setAbierta(c.id); } };
    sync(null); window.addEventListener("popstate", sync); return () => window.removeEventListener("popstate", sync);
  }, [vp.cotizaciones]);
  useEffect(() => { if (focoId) { setAbierta(focoId); setPestana("cotizaciones"); onFocoUsado?.(); } }, [focoId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (nuevaSolicitada) { setAbierta("nueva"); setPestana("cotizaciones"); onNuevaUsada?.(); } }, [nuevaSolicitada]); // eslint-disable-line react-hooks/exhaustive-deps
  const abrir = (id) => { const c = vp.cotizaciones.find((x) => x.id === id); if (c) window.history.pushState(null, "", hashVP("vp_cotizaciones", c.folio)); setAbierta(id); };
  const cerrar = () => { if (folioVPDesdeHash(window.location.hash, "vp_cotizaciones")) window.history.pushState(null, "", hashVP("vp_cotizaciones")); setAbierta(null); };
  const filas = useMemo(() => filtrarPorVendedor(filtrarCotizaciones(vp.cotizaciones, { texto, estado, cliente, desde, hasta }), vp.finInstalado ? vendedor : "*"), [vp.cotizaciones, texto, estado, cliente, desde, hasta, vendedor, vp.finInstalado]);
  const vendedoresLista = useMemo(() => gruposVendedor(vp.cotizaciones || []), [vp.cotizaciones]);
  const clientesConCot = useMemo(() => [...new Map(vp.cotizaciones.map((c) => [c.cliente_id, c.cliente_nombre]))].map(([v, l]) => ({ v, l })).sort((a, b) => a.l.localeCompare(b.l)), [vp.cotizaciones]);
  const activos = [cliente, vendedor !== "*" ? vendedor : "", desde, hasta].filter(Boolean).length;   // secundarios (los agrupados)
  const filtrando = Boolean(texto || estado || activos);
  const limpiar = () => { setCliente(""); setVendedor("*"); setDesde(""); setHasta(""); };
  if (!vp.instalado) return <NoInstalado />;
  const ind = { borrador: 0, enviada: 0, aceptada: 0, porVencer: 0, montoEnviado: 0 };
  for (const c of vp.cotizaciones) { const e = c.estado_efectivo; if (ind[e] != null) ind[e]++; if (e === "enviada") { ind.montoEnviado += Number(c.total || 0); if (Number(c.dias_para_vencer) <= 3) ind.porVencer++; } }
  return (
    <div data-panel-vp-cotizaciones>
      <Pestanas etiqueta="Cotizaciones privadas" activa={pestana} onCambiar={setPestana} items={[{ key: "cotizaciones", label: "Cotizaciones" }, { key: "biblioteca", label: "Biblioteca técnica" }]} />
      <PanelPestana visible={pestana === "cotizaciones"} titulo="Cotizaciones">
        {/* Misma disposición que Cotizaciones MP: acción principal y búsqueda en una barra; conteos en una línea. */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: S.sm }}>
          <button type="button" data-nueva-cotizacion onClick={() => setAbierta("nueva")} style={{ ...estiloBoton("pri"), minHeight: 44, padding: "10px 16px" }}>+ Nueva cotización</button>
          <Entrada data-buscar-cotizaciones value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar por folio, cliente, RUT, contacto u orden de venta" style={{ flex: "1 1 220px", width: "auto" }} />
        </div>
        <RejillaKpi linea desliza={!escritorio}>
          <Kpi linea dato="cot-enviadas" et="Enviadas sin respuesta" v={ind.enviada} n={ind.enviada ? `${pesos(ind.montoEnviado)} cotizado (no es venta)` : null} onClick={() => setEstado("enviada")} />
          <Kpi linea dato="cot-por-vencer" et="Vencen en ≤ 3 días" v={ind.porVencer} tono={ind.porVencer ? "warn" : null} onClick={() => setEstado("enviada")} />
          <Kpi linea dato="cot-aceptadas" et="Aceptadas" v={ind.aceptada} onClick={() => setEstado("aceptada")} />
          <Kpi linea dato="cot-borradores" et="Borradores" v={ind.borrador} onClick={() => setEstado("borrador")} />
        </RejillaKpi>
        {/* Un solo conteo (el de la lista, que refleja los filtros). Estado queda a la vista; cliente, vendedor y fechas, bajo «Filtros»
            en celular y tableta. */}
        <FiltrosAgrupados dato="cotizaciones-vp" activos={activos} onLimpiar={limpiar}
          principal={<Selector data-filtro-estado aria-label="Estado" value={estado} onChange={(e) => setEstado(e.target.value)} opciones={FILTROS} />}>
          <Selector data-filtro-cliente aria-label="Cliente" value={cliente} onChange={(e) => setCliente(e.target.value)} vacio="Todos los clientes" opciones={clientesConCot} />
          {vp.finInstalado && <Selector aria-label="Vendedor" data-filtro-vendedor-cot value={vendedor} onChange={(e) => setVendedor(e.target.value)} opciones={[{ v: "*", l: "Todos los vendedores" }, ...vendedoresLista.map((g) => ({ v: g.clave, l: g.nombre }))]} />}
          <FiltroFecha compacto={!escritorio} etiqueta="Emitidas desde" value={desde} onChange={(e) => setDesde(e.target.value)} />
          <FiltroFecha compacto={!escritorio} etiqueta="Emitidas hasta" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </FiltrosAgrupados>
        <Seccion titulo={<>{filtrando ? `${filas.length} de ${vp.cotizaciones.length} cotizaciones` : `${filas.length} cotizaci${filas.length === 1 ? "ón" : "ones"}`}<Ayuda etiqueta="Cómo cambia el estado">El envío y la aceptación se registran manualmente: descargar el PDF no cambia el estado.</Ayuda></>}>
          {!filas.length && <Vacio dato="sin-cotizaciones">{vp.cotizaciones.length ? "Ninguna cotización coincide." : "Aún no hay cotizaciones privadas."}</Vacio>}
          {filas.map((c) => (
            <button key={c.id} type="button" data-cotizacion={c.folio} onClick={() => abrir(c.id)} style={{ ...cardStyle, borderRadius: R.md, padding: "11px 14px", marginBottom: 8, width: "100%", textAlign: "left", cursor: "pointer", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                <div style={{ fontFamily: MONO, fontWeight: 700, color: C.ink }}>{folioRevision(c.folio, c.revision_actual)}</div>
                <div style={{ fontSize: T.small, color: C.inkMuted }}>{c.cliente_nombre} · emitida {fechaTxt(c.fecha_emision)} · vence {fechaTxt(c.vigencia_hasta)}{vp.finInstalado ? <> · <span data-vendedor-cot={claveVendedor(c) || "sin"}>{claveVendedor(c) ? "vendedor " : ""}{nombreVendedor(c)}</span></> : null}</div>
              </div>
              <BadgeVP mapa={ESTADOS_COTIZACION} k={c.estado_efectivo} />
              {c.venta_folio && <Badge tono="ok">{c.venta_folio}</Badge>}
              <span style={{ fontFamily: MONO, fontWeight: 700 }}>{pesos(c.total)}</span>
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
