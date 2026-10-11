import { useCallback, useEffect, useMemo, useState } from "react";
import { C, T, R, iStyle, fmt } from "../../lib/theme";
import { Pestanas, PanelPestana, Tarjeta, Badge, AvisoLinea, BotonPrincipal, BotonSecundario, BarraAcciones, Indicadores, Indicador, Desplegable } from "../ui/Sistema";
import { leerPendiente, descartarPendiente } from "../../lib/captura";
import { EVENTO_CAPTURA } from "../../lib/capturaEntrada";
import { codigoAtajo } from "../../lib/atajoSafari.generado";
import { ESTADOS_COTIZACION, cotizacionVacia } from "../../lib/cotizaciones";
import { detectarModo, crearAlmacen } from "../../lib/cotizacionesDatos";
import { EditorCotizacion } from "../cotizaciones/EditorCotizacion";
import { EditorFicha } from "../cotizaciones/EditorFicha";

// Cotizaciones y EETT (módulo nuevo, octubre 2026): cotizaciones previas a la OC y biblioteca compartida de productos.
// Independiente del resto de BFK Datos: no lee ni modifica OCs, finanzas, IVA ni comisiones.
export function PanelCotizaciones({ token, entidadesCatalogo, showToast }) {
  const [modo, setModo] = useState(null); const [almacen, setAlmacen] = useState(null);
  const [pestana, setPestana] = useState("cotizaciones");
  const [lista, setLista] = useState([]); const [productos, setProductos] = useState([]);
  const [cargando, setCargando] = useState(true); const [error, setError] = useState("");
  const [abierta, setAbierta] = useState(null); const [ficha, setFicha] = useState(null);
  const [busca, setBusca] = useState(""); const [buscaBib, setBuscaBib] = useState("");

  const [detalleError, setDetalleError] = useState(""); const [intento, setIntento] = useState(0);
  // Captura recibida desde el atajo de Safari (pendiente de revisión; no se guarda nada hasta que el usuario lo decida).
  const [captura, setCaptura] = useState(() => leerPendiente());
  const descartarCaptura = () => { descartarPendiente(); setCaptura(null); };
  useEffect(() => { const f = () => setCaptura(leerPendiente()); window.addEventListener(EVENTO_CAPTURA, f); return () => window.removeEventListener(EVENTO_CAPTURA, f); }, []);
  const copiarAtajo = async () => {
    try { await navigator.clipboard.writeText(codigoAtajo(window.location.origin)); showToast?.("Código del atajo copiado"); }
    catch { showToast?.("No se pudo copiar en este navegador", "error"); }
  };
  useEffect(() => {
    let vivo = true; setModo(null); setAlmacen(null); setCargando(true);
    (async () => {
      const r = await detectarModo(token); if (!vivo) return;
      setModo(r.modo); setDetalleError(r.detalle || ""); setAlmacen(crearAlmacen(token, r.modo));
      if (r.modo === "error") setCargando(false);
    })();
    return () => { vivo = false; };
  }, [token, intento]);
  const recargar = useCallback(async () => {
    if (!almacen) return; setError("");
    try { const [l, p] = await Promise.all([almacen.listarCotizaciones(), almacen.listarProductos()]); setLista(l); setProductos(p); }
    catch (e) { setError(e.message); } finally { setCargando(false); }
  }, [almacen]);
  useEffect(() => { recargar(); }, [recargar]);
  const recargarBib = useCallback(async () => { try { setProductos(await almacen.listarProductos()); } catch { /* se ve en la próxima carga */ } }, [almacen]);

  const abrir = async (id) => { try { setAbierta(await almacen.cargarCotizacion(id)); } catch (e) { showToast?.(e.message, "error"); } };
  const filtrada = useMemo(() => { const q = busca.trim().toLowerCase(); return lista.filter((c) => !q || `${c.id_externo} ${c.nombre} ${c.institucion}`.toLowerCase().includes(q)); }, [lista, busca]);
  const filtradosBib = useMemo(() => { const q = buscaBib.trim().toLowerCase(); return productos.filter((p) => !q || `${p.nombre} ${p.marca} ${p.modelo}`.toLowerCase().includes(q)); }, [productos, buscaBib]);
  const abiertas = lista.filter((c) => ["borrador", "lista"].includes(c.estado)).length;
  const guardarFichaBib = async (it) => { try { await almacen.guardarProducto(it.ficha, { id: it.producto_id }); showToast?.("Ficha actualizada en la biblioteca"); setFicha(null); recargarBib(); } catch (e) { showToast?.(e.message, "error"); } };

  return (
    <div data-panel-cotizaciones>
      {modo === "error" && <AvisoLinea tono="danger" dato="error-conexion" accion="Reintentar" onClick={() => setIntento((n) => n + 1)}>{detalleError}</AvisoLinea>}
      {modo === "prueba" && <AvisoLinea tono="info" dato="modo-prueba" icono="⚠">Modo prueba: el módulo aún no está instalado en la base de datos. Lo que guardes queda solo en este dispositivo.</AvisoLinea>}
      <Indicadores columnas={2}>
        <Indicador dato="cotizaciones-abiertas" etiqueta="Cotizaciones en preparación" valor={String(abiertas)} tono={abiertas ? "info" : "neutro"} onClick={() => setPestana("cotizaciones")} />
        <Indicador dato="biblioteca" etiqueta="Productos en la biblioteca" valor={String(productos.length)} tono="neutro" onClick={() => setPestana("biblioteca")} />
      </Indicadores>
      <Pestanas etiqueta="Cotizaciones" activa={pestana} onCambiar={setPestana} items={[{ key: "cotizaciones", label: "Cotizaciones", n: lista.length || null }, { key: "biblioteca", label: "Biblioteca", n: productos.length || null }]} />

      {captura?.error && <AvisoLinea tono="warn" dato="captura-error" accion="Descartar" onClick={descartarCaptura}>{captura.error}{/[.!?]$/.test(captura.error) ? "" : "."} Puedes ingresar el producto manualmente.</AvisoLinea>}
      {captura?.captura && (
        <Tarjeta padding="12px 14px" data-captura-pendiente style={{ borderColor: C.teal, background: C.tealLight }}>
          <div style={{ fontSize: T.small, fontWeight: 800, color: C.tealDark, textTransform: "uppercase", letterSpacing: 0.5 }}>Producto capturado en Safari</div>
          <div style={{ fontSize: T.sm, fontWeight: 800, color: C.ink, marginTop: 4, lineHeight: 1.3 }}>{captura.captura.ficha.nombre || "Sin nombre (complétalo al revisar)"}</div>
          <div style={{ fontSize: T.small, color: C.inkMuted, marginTop: 2 }}>{captura.captura.fuente || ""} · {captura.captura.ficha.especificaciones.length} especificaciones · {captura.captura.ficha.imagenes.length} imágenes</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
            <BotonPrincipal data-captura-nueva onClick={() => { setPestana("cotizaciones"); setAbierta(cotizacionVacia()); }} disabled={!almacen} style={{ opacity: almacen ? 1 : 0.5 }}>Nueva cotización con este producto</BotonPrincipal>
            <BotonSecundario data-captura-descartar onClick={descartarCaptura}>Descartar</BotonSecundario>
          </div>
          <div style={{ fontSize: T.small, color: C.inkMuted, marginTop: 8 }}>O toca una cotización de la lista para agregarlo ahí. Se abrirá para revisión antes de guardar.</div>
        </Tarjeta>
      )}
      <PanelPestana visible={pestana === "cotizaciones"} titulo="Cotizaciones">
        <BarraAcciones>
          <BotonPrincipal data-nueva-cotizacion onClick={() => setAbierta(cotizacionVacia())} disabled={!almacen} style={{ opacity: almacen ? 1 : 0.5 }}>+ Nueva cotización</BotonPrincipal>
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por ID, nombre o institución" style={{ ...iStyle, flex: "1 1 200px", width: "auto" }} />
        </BarraAcciones>
        {error && <AvisoLinea tono="danger" accion="Reintentar" onClick={recargar}>{error}</AvisoLinea>}
        {cargando && <div style={{ fontSize: T.sm, color: C.inkFaint }}>Cargando…</div>}
        {!cargando && modo !== "error" && !lista.length && <Tarjeta><div style={{ fontSize: T.sm, color: C.inkMuted, lineHeight: 1.5 }}>Aún no hay cotizaciones. El módulo parte vacío desde octubre de 2026: crea la primera con <b>Nueva cotización</b> y agrega productos desde los enlaces de tus proveedores.</div></Tarjeta>}
        {filtrada.map((c) => (
          <Tarjeta key={c.id} onClick={() => abrir(c.id)} padding="12px 14px" data-cotizacion={c.id_externo || c.id}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: T.body, fontWeight: 800, color: C.ink, fontFamily: "inherit" }}>{c.id_externo || <span style={{ color: C.inkMuted }}>Sin ID Mercado Público</span>}</span>
              <Badge tono={ESTADOS_COTIZACION[c.estado]?.tono}>{ESTADOS_COTIZACION[c.estado]?.label || c.estado}</Badge>
            </div>
            <div style={{ fontSize: T.sm, color: C.inkMuted, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.institucion || "Sin institución"}{c.nombre ? ` · ${c.nombre}` : ""}</div>
            <div style={{ fontSize: T.small, color: C.inkFaint, marginTop: 3 }}>{c.n_items} producto{c.n_items === 1 ? "" : "s"} · neto {fmt.money(Number(c.subtotal_neto) || 0)} · {fmt.date(String(c.fecha || "").slice(0, 10))}</div>
          </Tarjeta>
        ))}
        <Desplegable dato="atajo-safari" titulo="Captura desde Safari (iPhone)" resumen="Instala el atajo una vez y comparte productos desde Falabella, Mercado Libre u otras tiendas">
          <ol style={{ margin: "4px 0 10px", paddingLeft: 20, fontSize: T.sm, color: C.ink, lineHeight: 1.55 }}>
            <li>Toca <b>Copiar código del atajo</b> (abajo).</li>
            <li>Abre la app <b>Atajos</b> → <b>+</b> → nombre: <b>Enviar a BFK</b>.</li>
            <li>Toca <b>ⓘ</b> (detalles) → activa <b>Mostrar en hoja para compartir</b> y deja solo <b>Páginas web de Safari</b>.</li>
            <li>Agrega la acción <b>Ejecutar JavaScript en página web</b>, borra el texto de ejemplo y <b>pega</b> el código.</li>
            <li>Agrega la acción <b>Abrir URL</b> (usa el resultado del JavaScript). Guarda.</li>
            <li>En <b>Ajustes → Atajos → Avanzado</b>, activa <b>Permitir ejecutar scripts</b>.</li>
          </ol>
          <div style={{ fontSize: T.small, color: C.inkMuted, marginBottom: 10, lineHeight: 1.45 }}>Uso: en Safari abre el producto → <b>Compartir</b> → <b>Enviar a BFK</b>. BFK Datos se abre en Cotizaciones con el producto listo para revisar. El atajo solo lee la página que estás viendo; el precio queda como dato interno y el envío siempre se verifica aparte.</div>
          <BotonSecundario data-copiar-atajo onClick={copiarAtajo} style={{ width: "100%", justifyContent: "center", minHeight: 44 }}>Copiar código del atajo</BotonSecundario>
        </Desplegable>
      </PanelPestana>

      <PanelPestana visible={pestana === "biblioteca"} titulo="Biblioteca">
        <input value={buscaBib} onChange={(e) => setBuscaBib(e.target.value)} placeholder="Buscar por nombre, marca o modelo" style={{ ...iStyle, marginBottom: 12 }} />
        {!productos.length && <Tarjeta><div style={{ fontSize: T.sm, color: C.inkMuted, lineHeight: 1.5 }}>La biblioteca compartida está vacía. Al agregar un producto a una cotización puedes guardarlo aquí (solo su ficha técnica) para reutilizarlo después.</div></Tarjeta>}
        {filtradosBib.map((p) => (
          <Tarjeta key={p.id} onClick={() => setFicha({ key: p.id, producto_id: p.id, ficha: { nombre: p.nombre, marca: p.marca, modelo: p.modelo, color: p.color, descripcion: p.descripcion, generales: p.generales, especificaciones: p.especificaciones, imagenes: p.imagenes } })} padding="10px 12px" data-producto-biblioteca={p.nombre}>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <div style={{ width: 56, height: 56, flexShrink: 0, background: "#fff", border: `1px solid ${C.border}`, borderRadius: R.sm, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: C.inkFaint }}>{p.imagenes?.[0] ? <img src={p.imagenes[0]} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : "Sin foto"}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: T.sm, fontWeight: 800, color: C.ink, lineHeight: 1.3, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{p.nombre}</div>
                <div style={{ fontSize: T.small, color: C.inkMuted }}>{[p.marca, p.modelo].filter(Boolean).join(" · ") || "Sin marca/modelo"} · {(p.especificaciones || []).length} especificaciones</div>
                <div style={{ fontSize: T.small, color: C.inkFaint }}>{p.fuente ? `Fuente: ${p.fuente}` : "Ingreso manual"}{p.ultima_revision ? ` · revisado ${fmt.date(String(p.ultima_revision).slice(0, 10))}` : ""}</div>
              </div>
            </div>
          </Tarjeta>
        ))}
      </PanelPestana>

      {abierta && almacen && <EditorCotizacion key={abierta.id || "nueva"} almacen={almacen} inicial={abierta} token={token} captura={captura?.captura || null} onCapturaUsada={descartarCaptura} entidadesCatalogo={entidadesCatalogo} productosBib={productos} showToast={showToast}
        onGuardada={() => recargar()} onBibliotecaCambio={recargarBib} onCerrar={() => { setAbierta(null); recargar(); }} />}
      {ficha && <EditorFicha inicial={ficha} modo="biblioteca" token={token} onGuardar={guardarFichaBib} onCerrar={() => setFicha(null)} />}
    </div>
  );
}
