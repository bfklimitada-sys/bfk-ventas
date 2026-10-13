import { useCallback, useEffect, useState } from "react";
import { C, T, R, iStyle, selStyle, fmt } from "../../lib/theme";
import { Pestanas, PanelPestana, Tarjeta, Badge, AvisoLinea, BotonPrincipal, BotonSecundario, BarraAcciones, Indicadores, Indicador } from "../ui/Sistema";
import { ESTADOS_COTIZACION, cotizacionVacia } from "../../lib/cotizaciones";
import { detectarModo, crearAlmacen } from "../../lib/cotizacionesDatos";
import { EditorCotizacion } from "../cotizaciones/EditorCotizacion";
import { EditorFicha } from "../cotizaciones/EditorFicha";
import { ImagenFicha } from "../cotizaciones/ImagenFicha";

const POR_PAGINA = 20, POR_PAGINA_BIB = 30;

// Cotizaciones y EETT (módulo nuevo, octubre 2026): cotizaciones previas a la OC y biblioteca compartida de fichas.
// Independiente del resto de BFK Datos: no lee ni modifica OCs, finanzas, IVA ni comisiones.
// Flujo principal: Datos (Compra Ágil) → Productos («Ingresar manual») → Precios → EETT.
// Los métodos alternativos de captura (capturas/OCR, atajo de Safari, lectura de enlaces, IA, pegar texto) quedan
// fuera del flujo principal; su código y sus datos se conservan sin cambios.
export function PanelCotizaciones({ token, perfil, entidadesCatalogo, showToast }) {
  const [modo, setModo] = useState(null); const [almacen, setAlmacen] = useState(null);
  const [pestana, setPestana] = useState("cotizaciones");
  const [lista, setLista] = useState({ filas: [], total: 0 }); const [pagina, setPagina] = useState(0);
  const [filtros, setFiltros] = useState({ q: "", estado: "", vendedor: "" });
  const [abiertas, setAbiertas] = useState(0); const [nBib, setNBib] = useState(0);
  const [bib, setBib] = useState({ filas: [], total: 0 }); const [paginaBib, setPaginaBib] = useState(0); const [buscaBib, setBuscaBib] = useState("");
  const [cargando, setCargando] = useState(true); const [error, setError] = useState("");
  const [abierta, setAbierta] = useState(null); const [ficha, setFicha] = useState(null);
  const [detalleError, setDetalleError] = useState(""); const [intento, setIntento] = useState(0);

  useEffect(() => {
    let vivo = true; setModo(null); setAlmacen(null); setCargando(true);
    (async () => {
      const r = await detectarModo(token); if (!vivo) return;
      setModo(r.modo); setDetalleError(r.detalle || ""); setAlmacen(crearAlmacen(token, r.modo, r.esquema));
      if (r.modo === "error") setCargando(false);
    })();
    return () => { vivo = false; };
  }, [token, intento]);

  // Listado paginado con búsqueda y filtros en el servidor (no se carga todo).
  const recargar = useCallback(async () => {
    if (!almacen) return; setError(""); setCargando(true);
    try {
      const [l, a, n] = await Promise.all([almacen.listarCotizaciones({ ...filtros, pagina, porPagina: POR_PAGINA }), almacen.contarAbiertas(), almacen.contarProductos()]);
      setLista(l); setAbiertas(a); setNBib(n);
    } catch (e) { setError(e.message); } finally { setCargando(false); }
  }, [almacen, filtros, pagina]);
  useEffect(() => { const t = setTimeout(recargar, 250); return () => clearTimeout(t); }, [recargar]);

  const recargarBib = useCallback(async () => {
    if (!almacen || pestana !== "biblioteca") return;
    try { const r = await almacen.listarProductos({ q: buscaBib, pagina: paginaBib, porPagina: POR_PAGINA_BIB }); setBib((b) => (paginaBib ? { total: r.total, filas: [...b.filas, ...r.filas] } : r)); } catch (e) { setError(e.message); }
  }, [almacen, pestana, buscaBib, paginaBib]);
  useEffect(() => { const t = setTimeout(recargarBib, 250); return () => clearTimeout(t); }, [recargarBib]);

  const filtrar = (k, v) => { setFiltros((f) => ({ ...f, [k]: v })); setPagina(0); };
  const abrir = async (id) => { try { setAbierta(await almacen.cargarCotizacion(id)); } catch (e) { showToast?.(e.message, "error"); } };
  const guardarFichaBib = async (it) => { try { await almacen.guardarProducto(it.ficha, { id: it.producto_id }); showToast?.("Ficha actualizada en la biblioteca"); setFicha(null); setPaginaBib(0); recargarBib(); } catch (e) { showToast?.(e.message, "error"); } };
  const paginas = Math.max(1, Math.ceil(lista.total / POR_PAGINA));
  const hayFiltro = filtros.q || filtros.estado || filtros.vendedor;

  return (
    <div data-panel-cotizaciones>
      {modo === "error" && <AvisoLinea tono="danger" dato="error-conexion" accion="Reintentar" onClick={() => setIntento((n) => n + 1)}>{detalleError}</AvisoLinea>}
      {modo === "prueba" && <AvisoLinea tono="info" dato="modo-prueba" icono="⚠">Modo prueba: el módulo aún no está instalado en la base de datos. Lo que guardes queda solo en este dispositivo.</AvisoLinea>}
      <Indicadores columnas={2}>
        <Indicador dato="cotizaciones-abiertas" etiqueta="Cotizaciones en preparación" valor={String(abiertas)} tono={abiertas ? "info" : "neutro"} onClick={() => { setPestana("cotizaciones"); filtrar("estado", ""); }} />
        <Indicador dato="biblioteca" etiqueta="Fichas en la biblioteca" valor={String(nBib)} tono="neutro" onClick={() => setPestana("biblioteca")} />
      </Indicadores>
      <Pestanas etiqueta="Cotizaciones" activa={pestana} onCambiar={setPestana} items={[{ key: "cotizaciones", label: "Cotizaciones", n: lista.total || null }, { key: "biblioteca", label: "Biblioteca", n: nBib || null }]} />

      <PanelPestana visible={pestana === "cotizaciones"} titulo="Cotizaciones">
        <BarraAcciones>
          <BotonPrincipal data-nueva-cotizacion onClick={() => setAbierta(cotizacionVacia())} disabled={!almacen} style={{ opacity: almacen ? 1 : 0.5 }}>+ Nueva cotización</BotonPrincipal>
          <input data-buscar-cotizacion value={filtros.q} onChange={(e) => filtrar("q", e.target.value)} placeholder="Buscar por código, nombre o institución" style={{ ...iStyle, flex: "1 1 200px", width: "auto" }} />
        </BarraAcciones>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <select data-filtro-estado value={filtros.estado} onChange={(e) => filtrar("estado", e.target.value)} style={{ ...selStyle, flex: "1 1 160px", width: "auto" }}>
            <option value="">Todos los estados</option>
            {Object.entries(ESTADOS_COTIZACION).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          {almacen?.capacidades?.vendedores && <input data-filtro-vendedor value={filtros.vendedor} onChange={(e) => filtrar("vendedor", e.target.value)} placeholder="Vendedor" style={{ ...iStyle, flex: "1 1 160px", width: "auto" }} />}
        </div>
        {error && <AvisoLinea tono="danger" accion="Reintentar" onClick={recargar}>{error}</AvisoLinea>}
        {cargando && <div style={{ fontSize: T.sm, color: C.inkFaint }}>Cargando…</div>}
        {!cargando && modo !== "error" && !lista.filas.length && <Tarjeta><div style={{ fontSize: T.sm, color: C.inkMuted, lineHeight: 1.5 }}>{hayFiltro ? "No hay cotizaciones con esos filtros." : <>Aún no hay cotizaciones. El módulo parte vacío desde octubre de 2026: crea la primera con <b>Nueva cotización</b>.</>}</div></Tarjeta>}
        {lista.filas.map((c) => (
          <Tarjeta key={c.id} onClick={() => abrir(c.id)} padding="12px 14px" data-cotizacion={c.id_externo || c.id}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: T.body, fontWeight: 800, color: C.ink }}>{c.id_externo || <span style={{ color: C.inkMuted }}>Sin código Mercado Público</span>}</span>
              <Badge tono={ESTADOS_COTIZACION[c.estado]?.tono}>{ESTADOS_COTIZACION[c.estado]?.label || c.estado}</Badge>
            </div>
            <div style={{ fontSize: T.sm, color: C.inkMuted, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.institucion || "Sin institución"}{c.nombre ? ` · ${c.nombre}` : ""}</div>
            <div style={{ fontSize: T.small, color: C.inkFaint, marginTop: 3 }}>{c.n_items} producto{c.n_items === 1 ? "" : "s"} · neto {fmt.money(Number(c.subtotal_neto) || 0)} · {fmt.date(String(c.fecha || "").slice(0, 10))}{c.vendedor_nombre ? ` · ${c.vendedor_nombre}` : ""}</div>
          </Tarjeta>
        ))}
        {lista.total > POR_PAGINA && (
          <div data-paginacion style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginTop: 8 }}>
            <BotonSecundario onClick={() => setPagina((p) => Math.max(0, p - 1))} disabled={pagina === 0}>← Anterior</BotonSecundario>
            <span style={{ fontSize: T.sm, color: C.inkMuted }}>Página {pagina + 1} de {paginas} · {lista.total} cotizaciones</span>
            <BotonSecundario onClick={() => setPagina((p) => Math.min(paginas - 1, p + 1))} disabled={pagina >= paginas - 1}>Siguiente →</BotonSecundario>
          </div>
        )}
      </PanelPestana>

      <PanelPestana visible={pestana === "biblioteca"} titulo="Biblioteca">
        <input value={buscaBib} onChange={(e) => { setBuscaBib(e.target.value); setPaginaBib(0); }} placeholder="Buscar por nombre, marca o modelo" style={{ ...iStyle, marginBottom: 12 }} />
        {!bib.filas.length && <Tarjeta><div style={{ fontSize: T.sm, color: C.inkMuted, lineHeight: 1.5 }}>{buscaBib ? "Sin resultados." : "La biblioteca compartida está vacía. Al ingresar un producto en una cotización puedes guardar aquí su ficha técnica para reutilizarla."}</div></Tarjeta>}
        {bib.filas.map((p) => (
          <Tarjeta key={p.id} onClick={() => setFicha({ key: p.id, producto_id: p.id, ficha: { nombre: p.nombre, marca: p.marca, modelo: p.modelo, color: p.color, descripcion: p.descripcion, generales: p.generales, especificaciones: p.especificaciones, imagenes: p.imagenes } })} padding="10px 12px" data-producto-biblioteca={p.nombre}>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <ImagenFicha src={p.imagenes?.[0]} almacen={almacen} style={{ width: 56, height: 56, flexShrink: 0, border: `1px solid ${C.border}`, borderRadius: R.sm }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: T.sm, fontWeight: 800, color: C.ink, lineHeight: 1.3, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{p.nombre}</div>
                <div style={{ fontSize: T.small, color: C.inkMuted }}>{[p.marca, p.modelo].filter(Boolean).join(" · ") || "Sin marca/modelo"} · {(p.especificaciones || []).length} especificaciones</div>
                <div style={{ fontSize: T.small, color: C.inkFaint }}>{p.ultima_revision ? `Revisado ${fmt.date(String(p.ultima_revision).slice(0, 10))}` : ""}</div>
              </div>
            </div>
          </Tarjeta>
        ))}
        {bib.filas.length < bib.total && <BotonSecundario onClick={() => setPaginaBib((p) => p + 1)} style={{ width: "100%", justifyContent: "center" }}>Ver más ({bib.total - bib.filas.length})</BotonSecundario>}
      </PanelPestana>

      {abierta && almacen && <EditorCotizacion key={abierta.id || "nueva"} almacen={almacen} inicial={abierta} token={token} perfil={perfil} entidadesCatalogo={entidadesCatalogo} showToast={showToast}
        onGuardada={() => recargar()} onBibliotecaCambio={() => { setPaginaBib(0); recargarBib(); }} onEliminada={() => { setAbierta(null); recargar(); }} onCerrar={() => { setAbierta(null); recargar(); }} />}
      {ficha && <EditorFicha inicial={ficha} modo="biblioteca" almacen={almacen} token={token} onGuardar={guardarFichaBib} onCerrar={() => setFicha(null)} />}
    </div>
  );
}
