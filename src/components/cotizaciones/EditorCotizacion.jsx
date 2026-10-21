import { useEffect, useMemo, useRef, useState } from "react";
import { C, T, R, iStyle, iMono, selStyle, fmt, MONO } from "../../lib/theme";
import { Field, Modal } from "../ui/Basicos";
import { HojaLateral, Pestanas, PanelPestana, Tarjeta, Badge, AvisoLinea, BotonPrincipal, BotonSecundario, FilaDato, Desplegable, Seccion } from "../ui/Sistema";
import { calcularCotizacion, formulaParaGuardar, formulaGuardadaExenta, esExentaAprobada, estadoParaPDF, destinoDe, direccionValida, invalidarDespachosPorDireccion, envioConfirmado, textoParaMercadoPublico, aplicarRecargoGeneral, aplicarRecargoProducto, itemVacio, envioVacio, nuevaClave, hoyISO, digitosValor, proveedorDeEnlace, ESTADOS_COTIZACION, ESTADOS_ENVIO, RECARGO_SUGERIDO } from "../../lib/cotizaciones";
import { logoBFK } from "../../lib/cotizacionesDatos";
import { generarPdfEETT, descargarBlob, huellaPDF } from "../../lib/eettPdf";
import { EditorFicha } from "./EditorFicha";
import { ImagenFicha } from "./ImagenFicha";
import { ImportarCompraAgil } from "./ImportarCompraAgil";
import { VistaPreviaEETT } from "./VistaPreviaEETT";
import { bloqueoPorVendedor, exigeVendedor, mensajeVendedor, vendedorProtegido } from "../../lib/vendedorCotizacion";
import { EliminarCotizacion } from "./EliminarCotizacion";
import { ClasificacionTributaria } from "../ficha/ClasificacionTributaria";
import logoUrl from "../../assets/bfk-logo.jpg";
import { guardarBorrador, borrarBorrador, idLocalDe } from "../../lib/borradoresCotizacion";

const m = (x) => fmt.money(Math.round(Number(x) || 0));
const pct = (x) => `${(Math.round(Number(x) * 1000) / 10).toLocaleString("es-CL")}%`;
const fechaHora = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" }); };
const enlaceValido = (u) => /^https?:\/\/\S+$/i.test(String(u || "").trim());

// Copia texto al portapapeles (con alternativa para navegadores sin API de portapapeles).
async function copiarTexto(t) {
  try { await navigator.clipboard.writeText(t); return true; } catch { /* alternativa */ }
  try { const a = document.createElement("textarea"); a.value = t; a.setAttribute("readonly", ""); a.style.position = "fixed"; a.style.opacity = "0"; document.body.appendChild(a); a.select(); const ok = document.execCommand("copy"); a.remove(); return ok; } catch { return false; }
}

// Campo de porcentaje: muestra % (0,30 → 30) y entrega fracción. Conserva el texto mientras se escribe
// (permite «32,5» o «32.») y solo informa valores válidos; vacío = "".
function CampoPorcentaje({ id, dato, valor, onCambiar, disabled }) {
  const aTexto = (v) => (v === "" || v == null || Number.isNaN(Number(v)) ? "" : String(Math.round(Number(v) * 10000) / 100));
  const [txt, setTxt] = useState(() => aTexto(valor)); const enfocado = useRef(false);
  useEffect(() => { if (!enfocado.current) setTxt(aTexto(valor)); }, [valor]);
  return <input id={id} data-campo={dato} type="text" inputMode="decimal" disabled={disabled} value={txt}
    onFocus={() => { enfocado.current = true; }} onBlur={() => { enfocado.current = false; setTxt(aTexto(valor)); }}
    onChange={(e) => { const t = e.target.value.replace(",", "."); if (!/^-?\d*\.?\d*$/.test(t)) return; setTxt(e.target.value);
      if (t === "") onCambiar(""); else if (!Number.isNaN(Number(t)) && t !== "-" && t !== ".") onCambiar(Math.round(Number(t) * 100) / 10000); }}
    style={{ ...iMono, width: 80 }} />;
}

// Quita los despachos que ya no usa ningún producto (evita costos duplicados o huérfanos).
const limpiarEnvios = (c) => { c.envios = c.envios.filter((e) => c.items.some((it) => it.envio_key === e.key)); return c; };

// recuperado: { actualizado, versionBFK } cuando se abre desde un borrador local (cambios NO guardados en BFK).
// fichaRecuperada: { esNuevo, item, estado } de la ventana «Ingresar/Editar producto» que estaba abierta.
export function EditorCotizacion({ tributario = null, almacen, inicial, token, perfil, entidadesCatalogo = [], showToast, onGuardada, onEliminada, onBibliotecaCambio, onCerrar, usuarioId, recuperado = null, pestanaInicial, fichaRecuperada = null, onDescartarBorrador }) {
  const [cot, setCot] = useState(() => JSON.parse(JSON.stringify(inicial)));
  const [sucio, setSucio] = useState(!inicial.id || !!recuperado);
  const [estadoGuardado, setEstadoGuardado] = useState(inicial.id ? inicial.estado : null);
  // Lo último guardado del vendedor responsable (para las reglas de presentación y de cambio autorizado).
  const [guardada, setGuardada] = useState(inicial.id ? { estado: inicial.estado, vendedor_id: inicial.vendedor_id || null, vendedor_nombre: inicial.vendedor_nombre || "" } : null);
  const [histVend, setHistVend] = useState([]);
  const [pestana, setPestana] = useState(pestanaInicial || (inicial.id ? "productos" : "datos"));
  const [editor, setEditor] = useState(() => (fichaRecuperada?.item ? { item: fichaRecuperada.item, esNuevo: !!fichaRecuperada.esNuevo, respaldo: fichaRecuperada.estado || null } : null)); // { item, esNuevo, respaldo }
  const [aviso, setAviso] = useState(recuperado); // banner «Borrador recuperado localmente»
  const [verBib, setVerBib] = useState(false);
  const [guardando, setGuardando] = useState(false); const [generando, setGenerando] = useState(""); const [falla, setFalla] = useState(null);
  const [preview, setPreview] = useState(null);     // { blob, nombre, paginas }
  const [historial, setHistorial] = useState([]); const [eliminar, setEliminar] = useState(false);
  const [vendedores, setVendedores] = useState([]); const [nuevoVend, setNuevoVend] = useState(null);

  const esAdmin = perfil?.rol === "admin";
  const protegido = estadoGuardado === "adjudicada";
  const cap = almacen.capacidades || {};
  // Fase 3 exentas: tratamiento tributario para el cálculo.
  //  · Cotización adjudicada (guardada así): se conserva la fórmula con que se guardaron sus precios (afecta salvo que
  //    se haya guardado exenta). Una clasificación posterior no cambia precios ofertados.
  //  · Si no: la clasificación APROBADA vigente (del historial; la copia local puede ser anterior a la aprobación).
  const [formulaGuardada, setFormulaGuardada] = useState(() => inicial.formula || null);
  const aprobada = tributario?.historial ? tributario.historial.find((h) => h.ambito === "cotizacion" && String(h.cotizacion_id) === String(cot.id) && h.estado === "aprobada") : null;
  const cotTrib = useMemo(() => {
    const vig = aprobada ? { tratamiento_iva: aprobada.tratamiento, clasificacion_id: aprobada.id } : { tratamiento_iva: cot.tratamiento_iva ?? null, clasificacion_id: cot.clasificacion_id ?? null };
    return protegido ? { ...cot, ...vig, _exenta_fija: formulaGuardadaExenta(formulaGuardada) } : { ...cot, ...vig };
  }, [cot, aprobada?.id, aprobada?.tratamiento, protegido, formulaGuardada]);   // eslint-disable-line react-hooks/exhaustive-deps
  const calc = useMemo(() => calcularCotizacion(cotTrib), [cotTrib]);
  const difiereTratamiento = protegido && esExentaAprobada(cotTrib) !== calc.exenta;
  const pdf = useMemo(() => estadoParaPDF(cot), [cot]);
  const cambiar = (fn) => { setCot((c) => fn(JSON.parse(JSON.stringify(c)))); setSucio(true); };
  const setCampo = (k, v) => cambiar((c) => { c[k] = v; return c; });
  const destino = destinoDe(cot); const dirOk = direccionValida(cot);
  // Dirección del cliente (desde Datos o desde la ventana del producto). Si cambia, los despachos confirmados
  // para otra dirección vuelven a «Por verificar»: nunca quedan válidos para un destino distinto.
  const avisoInvalidados = useRef(0);
  const setDireccion = (campos) => {
    let n = 0;
    cambiar((c) => { Object.assign(c, campos); if ("direccion_entrega" in campos || "comuna" in campos) n = invalidarDespachosPorDireccion(c); return c; });
    setTimeout(() => { if (n && Date.now() - avisoInvalidados.current > 4000) { avisoInvalidados.current = Date.now(); showToast?.(`La dirección cambió: ${n} despacho${n === 1 ? "" : "s"} vuelve${n === 1 ? "" : "n"} a «Por verificar».`, "error"); } }, 0);
  };
  // ── Copia local de recuperación (IndexedDB, este dispositivo) ──
  // Mientras haya cambios sin guardar (o una ventana de producto abierta) se respalda TODO: datos, dirección, productos,
  // proveedores, enlaces, cantidades, precios, fotos, características, despachos, recargos y pestaña.
  // No crea ni modifica nada en BFK/Supabase. Al guardar o descartar expresamente se limpia.
  const idLocal = useRef(idLocalDe(inicial));
  const fichaEstado = useRef(fichaRecuperada?.estado || null);
  const vivo = useRef({}); vivo.current = { cot, sucio, pestana, editor };
  const [tickFicha, setTickFicha] = useState(0);
  const respaldar = () => {
    const { cot: c, sucio: s, pestana: p, editor: e } = vivo.current;
    if (!usuarioId || !idLocal.current) return Promise.resolve();
    if (!s && !e) return borrarBorrador(usuarioId, idLocal.current);
    const ficha = e ? { esNuevo: e.esNuevo, item: e.item, estado: fichaEstado.current } : null;
    return guardarBorrador({ usuario: usuarioId, idLocal: idLocal.current, cotId: c.id || null, versionBase: c.version || 0, titulo: c.id_externo || c.nombre || c.institucion || "Nueva cotización", cot: c, pestana: p, ficha });
  };
  useEffect(() => { const t = setTimeout(respaldar, 400); return () => clearTimeout(t); }, [cot, sucio, pestana, editor, tickFicha]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { // al cambiar de app/pestaña, bloquear el teléfono o cerrar: respaldo inmediato
    const ya = () => { respaldar(); };
    const alOcultar = () => { if (document.visibilityState === "hidden") ya(); };
    document.addEventListener("visibilitychange", alOcultar); window.addEventListener("pagehide", ya);
    return () => { document.removeEventListener("visibilitychange", alOcultar); window.removeEventListener("pagehide", ya); if (!cerrandoAdrede.current) ya(); }; // al desmontar (p. ej. cambio de pantalla) también
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const cerrandoAdrede = useRef(false);
  const alCambiarFicha = (estado) => { fichaEstado.current = estado; setTickFicha((n) => n + 1); };
  const cerrarFicha = () => { fichaEstado.current = null; setEditor(null); };

  const irADireccion = () => { setPestana("datos"); setTimeout(() => document.querySelector('[data-campo="direccion"]')?.focus(), 50); };

  useEffect(() => { almacen.listarVendedores?.().then(setVendedores).catch(() => setVendedores([])); }, [almacen]);
  const cargarHistorial = (id = cot.id) => { if (id) almacen.listarEETT?.(id).then(setHistorial).catch(() => {}); };
  useEffect(() => { cargarHistorial(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const cargarHistVend = (id = cot.id) => { if (id) almacen.historialVendedor?.(id).then((h) => setHistVend(h || [])).catch(() => {}); };
  useEffect(() => { cargarHistVend(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Productos (ingreso manual) ──
  const abrirNuevo = (item) => { fichaEstado.current = null; setEditor({ esNuevo: true, item }); };
  const abrirEditar = (item) => { fichaEstado.current = null; setEditor({ esNuevo: false, item }); };
  const manual = (extra = {}) => abrirNuevo({ ...itemVacio(), origen_datos: "manual", ...extra });
  const guardarItem = async (item, { guardarBiblioteca, actualizarBiblioteca, envio }) => {
    const it = { ...item }; delete it.consulta;
    try {
      if (guardarBiblioteca) { it.producto_id = await almacen.guardarProducto(it.ficha, { fuente: proveedorDeEnlace(it.enlace) || "", fecha_verificacion: null }); onBibliotecaCambio?.(); showToast?.("Ficha guardada en la biblioteca compartida"); }
      else if (actualizarBiblioteca && it.producto_id) { await almacen.guardarProducto(it.ficha, { id: it.producto_id }); onBibliotecaCambio?.(); }
    } catch (e) { showToast?.(`No se guardó en la biblioteca: ${e.message}`, "error"); }
    cambiar((c) => {
      if (envio) {
        const { modo, ...datos } = envio; delete datos.modo;
        const anterior = c.envios.find((e) => e.key === it.envio_key);
        const exclusivoAnterior = anterior && !c.items.some((x) => x.key !== it.key && x.envio_key === anterior.key);
        let key = datos.key;
        if (modo === "propio") key = exclusivoAnterior ? anterior.key : null;
        if (!key) { key = nuevaClave("e"); c.envios.push({ ...envioVacio(it.proveedor), key }); }
        const e = c.envios.find((x) => x.key === key);
        // Sin dirección válida nunca se guarda un despacho confirmado: queda «Por verificar».
        const sinDir = envioConfirmado(datos) && !direccionValida(c);
        Object.assign(e, { proveedor: datos.proveedor || e.proveedor || it.proveedor, monto: datos.monto, estado: sinDir ? "pendiente" : datos.estado, evidencia: datos.evidencia, con_factura: datos.con_factura, destino: sinDir ? "" : datos.destino, fecha_cotizacion: datos.fecha_cotizacion || e.fecha_cotizacion });
        if (modo === "propio" && !String(e.proveedor || "").trim()) e.proveedor = it.proveedor;
        it.envio_key = key;
      }
      const i = c.items.findIndex((x) => x.key === it.key);
      if (i >= 0) { if (JSON.stringify(c.items[i].ficha) !== JSON.stringify(it.ficha)) it.ficha_aprobada = false; c.items[i] = it; } else c.items.push(it);
      return limpiarEnvios(c);
    });
    cerrarFicha();
    if (envio && envio.estado === "pendiente" && !dirOk) showToast?.("Producto guardado. El despacho queda «Por verificar» hasta registrar la dirección de entrega.");
  };
  const desdeBiblioteca = (p) => {
    manual({ producto_id: p.id, origen_datos: "biblioteca", ficha: { nombre: p.nombre, marca: p.marca, modelo: p.modelo, color: p.color, descripcion: p.descripcion, generales: p.generales, especificaciones: p.especificaciones, imagenes: p.imagenes } });
    setVerBib(false);
  };
  const quitar = (key) => { if (!window.confirm("¿Quitar este producto de la cotización? (La biblioteca no cambia.)")) return; cambiar((c) => { c.items = c.items.filter((x) => x.key !== key); return limpiarEnvios(c); }); };
  const mover = (i, d) => cambiar((c) => { const j = i + d; if (j < 0 || j >= c.items.length) return c; [c.items[i], c.items[j]] = [c.items[j], c.items[i]]; return c; });

  // ── Guardar ──
  const guardarInterno = async () => {
    const bloqueo = bloqueoPorVendedor(cot, guardada);
    if (bloqueo) { setPestana("datos"); throw Object.assign(new Error(bloqueo), { vendedor: true }); }
    const enviada = cot; const { _idLocal, ...paraBFK } = { ...enviada, ...cotTrib, items: enviada.items, envios: enviada.envios }; // eslint-disable-line no-unused-vars
    const r = await almacen.guardarCotizacion(paraBFK);
    setFormulaGuardada(formulaParaGuardar(paraBFK));
    const nueva = { ...enviada, id: r.id, version: r.version };
    // Lo escrito DURANTE el guardado se conserva (y sigue marcado como pendiente de guardar).
    const posterior = vivo.current.cot !== enviada;
    setCot((c) => ({ ...c, id: r.id, version: r.version })); setSucio(posterior); setEstadoGuardado(nueva.estado); onGuardada?.(nueva);
    setGuardada({ estado: nueva.estado, vendedor_id: nueva.vendedor_id || null, vendedor_nombre: nueva.vendedor_nombre || "" }); cargarHistVend(r.id);
    const anterior = idLocal.current; idLocal.current = r.id;
    if (usuarioId && anterior && anterior !== r.id) borrarBorrador(usuarioId, anterior).catch(() => {});
    setAviso(null);
    return nueva;
  };
  const guardar = async () => {
    setGuardando(true);
    try { await guardarInterno(); showToast?.("Cotización guardada"); }
    catch (e) { showToast?.(`No se guardó: ${mensajeVendedor(e)}`, "error"); if (/vendedor/i.test(e.message)) setPestana("datos"); } finally { setGuardando(false); }
  };

  // ── EETT: mismo generador para vista previa y descarga ──
  const construirPdf = async (base, { conVersion }) => {
    const logo = await logoBFK(logoUrl);
    const items = await Promise.all(base.items.map(async (it) => ({ ficha: { ...it.ficha, imagenes: await almacen.resolverImagenes(it.ficha?.imagenes || [], 2) } })));
    const elaboracion = { vendedor: base.vendedor_nombre, elaborado_por: perfil?.nombre || "", fecha: hoyISO(), cotizacion: base.id_externo, version: conVersion ? base.version : null };
    return generarPdfEETT(base, items, { logo, elaboracion, version: conVersion ? base.version : null });
  };
  const verPrevia = async () => {
    if (!cot.items.length) return; setGenerando("previa");
    try { setPreview(await construirPdf(cot, { conVersion: !sucio && !!cot.id })); } // no guarda nada
    catch (e) { showToast?.(e.versionNueva ? `No se pudo preparar la vista previa: ${e.message}${sucio ? " Tus cambios aún NO están guardados: pulsa Guardar antes de actualizar." : ""}` : `No se pudo preparar la vista previa: ${e.message}`, "error"); }
    finally { setGenerando(""); }
  };
  const descargarDe = async (base) => {
    const r = await construirPdf(base, { conVersion: true });
    descargarBlob(r.blob, r.nombre);
    try {
      await almacen.registrarEETT({ cotizacion_id: base.id, version: base.version, hash: await huellaPDF(r.blob), paginas: r.paginas, nombre_documento: r.nombre, vendedor_nombre: base.vendedor_nombre || "", generado_por_nombre: perfil?.nombre || "" });
      cargarHistorial(base.id);
    } catch (e) { showToast?.(`El PDF se descargó, pero no se pudo registrar la generación: ${e.message}`, "error"); }
    return r;
  };
  // Generar y descargar: valida → guarda (solo si hay cambios) → genera desde lo guardado → descarga → registra metadatos.
  const generarYDescargar = async () => {
    if (!pdf.listo) { showToast?.("Revisa las fichas pendientes antes de generar la EETT.", "error"); return; }
    setGenerando("descarga"); setFalla(null);
    let base = cot;
    try { if (!cot.id || sucio) base = await guardarInterno(); }
    catch (e) { setGenerando(""); showToast?.(`No se guardó la cotización: ${mensajeVendedor(e)} No se generó la EETT.`, "error"); return; }
    try {
      const r = await descargarDe(base);
      showToast?.(`Cotización guardada (versión ${base.version}) y EETT descargada: ${r.paginas} página${r.paginas === 1 ? "" : "s"}`);
    } catch (e) {
      setFalla({ base, mensaje: e.message });
      showToast?.(`Los datos quedaron guardados (versión ${base.version}), pero la descarga falló: ${e.message}`, "error");
    } finally { setGenerando(""); }
  };
  const reintentar = async () => {
    if (!falla) return; setGenerando("descarga");
    try { await descargarDe(falla.base); setFalla(null); showToast?.("EETT descargada"); }
    catch (e) { setFalla({ ...falla, mensaje: e.message }); showToast?.(`La descarga volvió a fallar: ${e.message}`, "error"); } finally { setGenerando(""); }
  };

  // ── Precios ──
  // Recargo general: se aplica a TODOS los productos (reemplaza los ajustes individuales). Nunca se suman recargos.
  const cambiarRecargoGeneral = (v) => {
    const ajustados = cot.items.filter((x) => !(x.recargo == null || x.recargo === "")).length;
    cambiar((c) => aplicarRecargoGeneral(c, v));
    if (ajustados && v !== "" && v != null) showToast?.(`Recargo general aplicado a todos los productos (${ajustados} tenía${ajustados === 1 ? "" : "n"} un recargo propio).`);
  };
  const copiarUno = async (i) => {
    const l = calc.lineas[i];
    if (l.avisos.length) { showToast?.("Este producto tiene costos o despachos pendientes: confírmalos antes de copiar su valor.", "error"); return; }
    if (await copiarTexto(digitosValor(l.unitario_neto))) showToast?.(`Copiado: ${digitosValor(l.unitario_neto)}`); else showToast?.("No se pudo copiar en este navegador", "error");
  };
  const copiarMP = async () => {
    if (!calc.listo) { showToast?.("Hay costos o despachos pendientes: confírmalos antes de copiar precios.", "error"); return; }
    showToast?.((await copiarTexto(textoParaMercadoPublico(cot, calc))) ? "Valores copiados (tabulados)" : "No se pudo copiar en este navegador");
  };

  // ── Datos ──
  // Cerrar = descartar expresamente: con cambios sin guardar se pide confirmación y se borra SOLO el borrador local de esta cotización.
  const cerrar = () => {
    if (sucio && !window.confirm("Hay cambios sin guardar en BFK. ¿Descartarlos y cerrar? Se borrará la copia local de recuperación de esta cotización.")) return;
    cerrandoAdrede.current = true;
    if (usuarioId && idLocal.current) borrarBorrador(usuarioId, idLocal.current).catch(() => {});
    onCerrar();
  };
  const descartarYAbrirBFK = () => {
    if (!window.confirm("¿Descartar los cambios recuperados en este dispositivo y abrir la versión guardada en BFK?")) return;
    cerrandoAdrede.current = true;
    if (usuarioId && idLocal.current) borrarBorrador(usuarioId, idLocal.current).catch(() => {});
    onDescartarBorrador?.(cot.id);
  };
  const elegirEntidad = (nombre) => {
    const e = entidadesCatalogo.find((x) => String(x.nombre_entidad || "").toLowerCase() === String(nombre).toLowerCase());
    cambiar((c) => { c.institucion = nombre; if (e) { if (!c.rut) c.rut = e.rut || ""; if (!c.comuna) c.comuna = e.comuna || ""; } return c; });
  };
  const aplicarCompraAgil = (cambios) => { if (!Object.keys(cambios).length) return; setDireccion(cambios); showToast?.("Datos de la Compra Ágil aplicados: revísalos y guarda"); };
  const elegirVendedor = (id) => {
    const v = vendedores.find((x) => x.id === id);
    // Cambio autorizado (administrador) en una cotización ya presentada o adjudicada: se confirma y queda en la bitácora.
    if (esAdmin && guardada && exigeVendedor(guardada.estado) && guardada.vendedor_id && (v?.id || null) !== guardada.vendedor_id
        && !window.confirm(`La cotización ya está ${guardada.estado === "adjudicada" ? "adjudicada" : "presentada"}. ¿Cambiar el vendedor responsable de «${guardada.vendedor_nombre || guardada.vendedor_id}» a «${v?.nombre || "Sin asignar"}»? El cambio queda registrado con tu usuario al guardar.`)) return;
    cambiar((c) => { c.vendedor_id = v?.id || null; c.vendedor_nombre = v?.nombre || ""; return c; });
  };
  const registrarVendedor = async () => {
    try { const v = await almacen.registrarVendedor(nuevoVend); setVendedores((l) => [...l, v].sort((a, b) => a.nombre.localeCompare(b.nombre))); cambiar((c) => { c.vendedor_id = v.id; c.vendedor_nombre = v.nombre; return c; }); setNuevoVend(null); showToast?.("Vendedor registrado"); }
    catch (e) { showToast?.(e.message, "error"); }
  };
  const eliminarCot = async (confirmacion) => { await almacen.eliminarCotizacion(cot.id, confirmacion); cerrandoAdrede.current = true; showToast?.("Cotización eliminada"); setEliminar(false); onEliminada?.(cot.id); };

  const nPend = calc.pendientes.length; const nRev = pdf.porItem.filter((p) => !p.aprobado).length;
  const titulo = cot.id_externo || (cot.id ? (cot.nombre || cot.institucion || "Cotización sin código") : "Nueva cotización");
  const vendedorBloqueado = vendedorProtegido(guardada, esAdmin);
  const faltaVendedorPresentar = exigeVendedor(cot.estado) && !cot.vendedor_id && !!bloqueoPorVendedor(cot, guardada);
  const sinEsquema = !cap.datosCompraAgil && (cot.vendedor_nombre || cot.requerimientos?.length || cot.descripcion || cot.unidad_compra || cot.region);

  return (
    <HojaLateral abierta onCerrar={cerrar} dato="cotizacion" titulo={titulo} subtitulo={[cot.institucion, ESTADOS_COTIZACION[cot.estado]?.label, cot.vendedor_nombre].filter(Boolean).join(" · ")}
      derecha={<BotonPrincipal data-guardar-cotizacion onClick={guardar} disabled={guardando} style={{ minHeight: 40, padding: "8px 14px", opacity: guardando ? 0.6 : 1 }}>{guardando ? "Guardando…" : sucio ? "Guardar •" : "Guardado"}</BotonPrincipal>}>
      <div style={{ padding: 16 }} data-editor-cotizacion>
        {aviso && (
          <AvisoLinea tono="warn" icono="↺" dato="borrador-recuperado" {...(aviso.versionBFK && cot.id ? { accion: "Descartar y abrir la versión de BFK", onClick: descartarYAbrirBFK } : {})}>
            <b>Borrador recuperado localmente</b> ({fechaHora(aviso.actualizado)}): estos cambios están solo en este dispositivo y <b>aún no se han guardado en BFK</b>. Revísalos y presiona «Guardar».
            {aviso.versionBFK ? <> En BFK hay una versión más reciente (versión {aviso.versionBFK}) guardada después de este borrador: no se sobrescribirá; al guardar, BFK lo rechazará para que puedas revisar.</> : null}
          </AvisoLinea>
        )}
        <div data-estado-guardado={sucio ? "local" : "bfk"} style={{ fontSize: T.small, color: sucio ? C.warnText : C.inkMuted, marginBottom: 6 }}>
          {sucio ? "● Cambios sin guardar en BFK · copia de recuperación solo en este dispositivo" : `✓ Cotización guardada en BFK${cot.version ? ` (versión ${cot.version})` : ""}`}
        </div>
        <Pestanas etiqueta="Cotización" activa={pestana} onCambiar={setPestana} items={[
          { key: "datos", label: "Datos" },
          { key: "productos", label: "Productos", n: cot.items.length || null },
          { key: "precios", label: "Precios", n: nPend || null, tono: nPend ? "warn" : null },
          { key: "eett", label: "EETT", n: nRev || null, tono: nRev ? "warn" : null },
        ]} />
        {(() => {
          const despOk = cot.items.length > 0 && cot.items.every((it) => envioConfirmado(cot.envios.find((e) => e.key === it.envio_key) || {}));
          const pasos = [["Datos del cliente", !!String(cot.institucion || "").trim(), "datos"], ["Dirección", dirOk, "datos"], ["Productos", cot.items.length > 0, "productos"],
            ["Verificación de despacho", despOk && calc.listo, "productos"], ["Precios", calc.listo && cot.items.length > 0, "precios"], ["EETT", pdf.listo, "eett"]];
          return <div data-pasos-cotizacion style={{ display: "flex", flexWrap: "wrap", gap: 4, margin: "8px 0 12px", fontSize: T.small }}>
            {pasos.map(([t, ok, tab], i) => <button key={t} type="button" onClick={() => setPestana(tab)} style={{ border: `1px solid ${ok ? C.ok : C.border}`, background: ok ? C.okLight : C.card, color: ok ? C.okText : C.inkMuted, borderRadius: 999, padding: "3px 9px", cursor: "pointer", fontWeight: 700 }}>{ok ? "✓" : i + 1} {t}</button>)}
          </div>;
        })()}
        {protegido && <AvisoLinea tono="info" icono="🔒" dato="cotizacion-protegida">Adjudicada: lo ofertado (productos, cantidades y precios) y el vínculo con la OC quedan protegidos. Puedes actualizar enlaces de compra y fichas técnicas y regenerar la EETT.</AvisoLinea>}

        <PanelPestana visible={pestana === "datos"} titulo="Datos">
          <Tarjeta padding="12px" data-bloque-direccion style={{ borderColor: dirOk ? C.ok : C.warn, background: dirOk ? C.card : C.warnLight }}>
            <div style={{ fontSize: T.sm, fontWeight: 800, color: C.ink }}>Dirección de entrega del cliente</div>
            <div style={{ fontSize: T.small, color: dirOk ? C.okText : C.warnText, fontWeight: 700, margin: "2px 0 8px" }}>{dirOk ? "✓ Registrada: los despachos se verifican contra esta dirección." : "Complétala antes de confirmar despachos (los productos se pueden ingresar igual; su despacho quedará «Por verificar»)."}</div>
            <Field label="Dirección de entrega"><input data-campo="direccion" value={cot.direccion_entrega} onChange={(e) => setDireccion({ direccion_entrega: e.target.value })} style={iStyle} placeholder="Calle, número, oficina/bodega" /></Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <Field label="Comuna / ciudad"><input data-campo="comuna" value={cot.comuna} onChange={(e) => setDireccion({ comuna: e.target.value })} style={iStyle} /></Field>
              <Field label="Región"><input data-campo="region" value={cot.region || ""} onChange={(e) => setDireccion({ region: e.target.value })} style={iStyle} /></Field>
            </div>
          </Tarjeta>
          <ImportarCompraAgil cot={cot} token={token} onAplicar={aplicarCompraAgil} deshabilitado={protegido} />
          {sinEsquema && <AvisoLinea tono="warn" dato="esquema-pendiente">El vendedor responsable y los datos importados de la Compra Ágil se guardarán cuando se instale la actualización de la base del módulo (pendiente de autorización). El resto de la cotización se guarda normalmente.</AvisoLinea>}

          {!faltaVendedorPresentar && exigeVendedor(cot.estado) && !cot.vendedor_id && <AvisoLinea tono="warn" dato="historica-sin-vendedor">Esta cotización ya figuraba {cot.estado === "adjudicada" ? "adjudicada" : "presentada"} sin vendedor responsable. Asígnalo para completar el registro.</AvisoLinea>}
          {faltaVendedorPresentar && <AvisoLinea tono="danger" dato="falta-vendedor">Falta el vendedor responsable: no se puede {cot.estado === "adjudicada" ? "adjudicar" : "presentar"} la cotización sin él. Elígelo abajo (un borrador sí se puede guardar sin vendedor).</AvisoLinea>}
          <Field label="Vendedor responsable" required={exigeVendedor(cot.estado)} hint={vendedorBloqueado ? `La cotización ya está ${guardada?.estado === "adjudicada" ? "adjudicada" : "presentada"}: solo un administrador puede cambiar el vendedor (queda registrado).` : !cot.vendedor_id ? "Obligatorio para presentar la cotización. Elígelo expresamente: no se asigna solo." : cap.vendedores ? "Puede ser distinto de quien genera la EETT." : "Catálogo de vendedores de BFK (solo lectura)."}>
            {nuevoVend === null ? (
              <div style={{ display: "flex", gap: 6 }}>
                <select data-campo="vendedor" value={cot.vendedor_id || ""} disabled={vendedorBloqueado} onChange={(e) => elegirVendedor(e.target.value)} style={{ ...selStyle, flex: 1 }}>
                  <option value="">Sin asignar</option>
                  {cot.vendedor_id && !vendedores.some((v) => v.id === cot.vendedor_id) && <option value={cot.vendedor_id}>{cot.vendedor_nombre}</option>}
                  {vendedores.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
                </select>
                {cap.vendedores && !vendedorBloqueado && <BotonSecundario data-nuevo-vendedor onClick={() => setNuevoVend("")}>+ Nuevo</BotonSecundario>}
              </div>
            ) : (
              <div style={{ display: "flex", gap: 6 }}>
                <input data-campo="nuevo-vendedor" value={nuevoVend} onChange={(e) => setNuevoVend(e.target.value)} placeholder="Nombre y apellido" style={{ ...iStyle, flex: 1 }} autoFocus />
                <BotonPrincipal data-registrar-vendedor onClick={registrarVendedor} disabled={!nuevoVend.trim()}>Registrar</BotonPrincipal>
                <BotonSecundario onClick={() => setNuevoVend(null)}>✕</BotonSecundario>
              </div>
            )}
          </Field>
          {histVend.length > 0 && <div data-historial-vendedor style={{ fontSize: T.small, color: C.inkMuted, margin: "-6px 0 12px", lineHeight: 1.5 }}>
            {histVend.slice(0, 5).map((h) => <div key={h.id}>{String(h.creado_en || "").slice(0, 10).split("-").reverse().join("-")} · {h.anterior_nombre || "Sin asignar"} → {h.nuevo_nombre || "Sin asignar"}{h.es_admin ? " (administrador)" : ""}</div>)}
          </div>}

          <Field label="Código Mercado Público (opcional)" hint="Puedes agregarlo después: si falta, se omite del encabezado del PDF. Un código COT no es una OC."><input data-campo="id_externo" value={cot.id_externo} onChange={(e) => setCampo("id_externo", e.target.value.trim().toUpperCase())} style={iMono} placeholder="3390-246-COT26" /></Field>
          <Field label="Nombre de la licitación / compra ágil"><input data-campo="nombre_licitacion" value={cot.nombre} onChange={(e) => setCampo("nombre", e.target.value)} style={iStyle} /></Field>
          <Field label="Descripción (del comprador)"><textarea data-campo="descripcion" rows={2} value={cot.descripcion || ""} onChange={(e) => setCampo("descripcion", e.target.value)} style={{ ...iStyle, resize: "vertical" }} /></Field>
          <Field label="Institución" required><input data-campo="institucion" list="cz-entidades" value={cot.institucion} onChange={(e) => elegirEntidad(e.target.value)} style={iStyle} />
            <datalist id="cz-entidades">{entidadesCatalogo.slice(0, 400).map((e) => <option key={e.id || e.rut} value={e.nombre_entidad} />)}</datalist></Field>
          <Field label="Unidad solicitante"><input data-campo="unidad_compra" value={cot.unidad_compra || ""} onChange={(e) => setCampo("unidad_compra", e.target.value)} style={iStyle} /></Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <Field label="RUT"><input data-campo="rut" value={cot.rut} onChange={(e) => setCampo("rut", e.target.value)} style={iMono} /></Field>
            <Field label="Fecha de emisión (BFK)"><input data-campo="fecha" type="date" value={cot.fecha || ""} onChange={(e) => setCampo("fecha", e.target.value)} style={iStyle} /></Field>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <Field label="Plazo de entrega"><input data-campo="plazo" value={cot.plazo} onChange={(e) => setCampo("plazo", e.target.value)} style={iStyle} placeholder="15 DÍAS" /></Field>
            <Field label="Presupuesto del comprador" hint="Referencial. No es el precio de BFK."><input data-campo="presupuesto" type="number" inputMode="numeric" value={cot.presupuesto_estimado ?? ""} onChange={(e) => setCampo("presupuesto_estimado", e.target.value === "" ? null : Number(e.target.value))} style={iMono} /></Field>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <Field label="Publicación"><input data-campo="fecha_publicacion" type="datetime-local" value={String(cot.fecha_publicacion || "").slice(0, 16)} onChange={(e) => setCampo("fecha_publicacion", e.target.value || null)} style={iStyle} /></Field>
            <Field label="Cierre"><input data-campo="fecha_cierre" type="datetime-local" value={String(cot.fecha_cierre || "").slice(0, 16)} onChange={(e) => setCampo("fecha_cierre", e.target.value || null)} style={iStyle} /></Field>
          </div>
          {cot.requerimientos?.length > 0 && (
            <Seccion titulo="Productos requeridos por el comprador" nota="Requerimientos de la Compra Ágil (no son productos de proveedores). Cada producto ofrecido se ingresa en Productos.">
              {cot.requerimientos.map((r, i) => (
                <Tarjeta key={i} padding="8px 10px" data-requerimiento={i + 1}>
                  <div style={{ fontSize: T.sm, color: C.ink }}><b>{r.cantidad ?? "?"} {r.unidad || ""}</b> · {r.nombre}</div>
                  {r.descripcion && <div style={{ fontSize: T.small, color: C.inkMuted, marginTop: 2 }}>{r.descripcion}</div>}
                </Tarjeta>
              ))}
            </Seccion>
          )}
          {cot.documentos_mp?.length > 0 && <div data-documentos-mp style={{ fontSize: T.small, color: C.inkMuted, marginBottom: 12 }}><b>Documentos adjuntos en Mercado Público:</b> {cot.documentos_mp.map((d) => d.nombre || d.id).join(", ")}</div>}
          <Field label="Estado"><select data-campo="estado" value={cot.estado} onChange={(e) => setCampo("estado", e.target.value)} disabled={protegido && !esAdmin} style={selStyle}>{Object.entries(ESTADOS_COTIZACION).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
          {cot.estado === "adjudicada" && <Field label="OC adjudicada (opcional)" hint="Solo deja el vínculo: no crea ni modifica la OC."><input data-campo="oc_codigo" value={cot.oc_codigo || ""} disabled={protegido && !!inicial.oc_codigo && !esAdmin} onChange={(e) => setCampo("oc_codigo", e.target.value.trim().toUpperCase())} style={iMono} placeholder="1525570-1082-AG26" /></Field>}
          {/* Fase 2 exentas: clasificación tributaria respaldada (solicitud + aprobación de un administrador). Solo cotizaciones ya guardadas. */}
          {tributario && cot.id && <Seccion titulo="Clasificación tributaria"><ClasificacionTributaria ambito="cotizacion" objetivo={{ ...inicial, id: cot.id }} historial={tributario.historial} perfil={perfil} acciones={tributario} /></Seccion>}
          <Field label="Observaciones (internas)"><textarea rows={3} value={cot.observaciones} onChange={(e) => setCampo("observaciones", e.target.value)} style={{ ...iStyle, resize: "vertical" }} /></Field>
          {esAdmin && cot.id && cap.eliminar && (
            <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 16, paddingTop: 12 }}>
              <button type="button" data-eliminar-cotizacion onClick={() => { if (sucio) { showToast?.("Guarda o descarta los cambios antes de eliminar la cotización.", "error"); return; } setEliminar(true); }} style={{ border: `1px solid ${C.danger}`, background: "#fff", color: C.dangerText, borderRadius: 10, padding: "8px 14px", minHeight: 40, fontWeight: 700, cursor: "pointer" }}>Eliminar cotización</button>
              <div style={{ fontSize: T.small, color: C.inkFaint, marginTop: 4 }}>Solo administradores. Pide confirmación escrita; no se permite en adjudicadas.</div>
            </div>
          )}
        </PanelPestana>

        <PanelPestana visible={pestana === "productos"} titulo="Productos">
          {dirOk
            ? <div data-direccion-productos style={{ fontSize: T.small, color: C.inkMuted, marginBottom: 8 }}>Entrega en: <b style={{ color: C.ink }}>{[cot.direccion_entrega, cot.comuna, cot.region].filter((x) => String(x || "").trim()).join(", ")}</b> · <button type="button" onClick={irADireccion} style={{ border: "none", background: "none", color: C.tealDark, textDecoration: "underline", cursor: "pointer", padding: 0, fontSize: T.small }}>Cambiar</button></div>
            : <AvisoLinea tono="warn" dato="falta-direccion" accion="Completar dirección" onClick={irADireccion}>Falta la dirección de entrega del cliente. Puedes ingresar productos; sus despachos quedarán «Por verificar» hasta completarla.</AvisoLinea>}
          <Tarjeta padding="12px">
            <BotonPrincipal data-ingreso-manual onClick={() => manual()} disabled={protegido} style={{ width: "100%", justifyContent: "center", minHeight: 52, fontSize: T.title, opacity: protegido ? 0.5 : 1 }}>＋ Ingresar manual</BotonPrincipal>
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <BotonSecundario data-desde-biblioteca onClick={() => setVerBib(true)} disabled={protegido} style={{ flex: 1, justifyContent: "center" }}>Desde la biblioteca de fichas</BotonSecundario>
            </div>
          </Tarjeta>
          {cot.requerimientos?.length > 0 && !protegido && (
            <Desplegable dato="requerimientos-productos" titulo="Requerimientos del comprador" resumen={`${cot.requerimientos.length} producto(s) solicitados`}>
              {cot.requerimientos.map((r, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between", padding: "6px 0", borderBottom: `1px solid ${C.border}` }}>
                  <div style={{ fontSize: T.small, color: C.ink, minWidth: 0 }}><b>{r.cantidad ?? "?"} {r.unidad || ""}</b> · {r.nombre}{r.descripcion ? <div style={{ color: C.inkMuted }}>{r.descripcion}</div> : null}</div>
                  <BotonSecundario data-ingresar-requerimiento={i + 1} onClick={() => manual({ cantidad: Number(r.cantidad) > 0 ? Number(r.cantidad) : 1, consulta: { fuente: "Requerimiento del comprador (referencia)", advertencias: [`${r.nombre}${r.descripcion ? `: ${r.descripcion}` : ""}`] } })} style={{ minHeight: 34, padding: "4px 10px", flexShrink: 0 }}>Ingresar</BotonSecundario>
                </div>
              ))}
            </Desplegable>
          )}
          {!cot.items.length && <div style={{ fontSize: T.sm, color: C.inkFaint, textAlign: "center", padding: 20 }}>Agrega el primer producto con «Ingresar manual».</div>}
          {cot.items.map((it, i) => {
            const l = calc.lineas[i]; const rv = pdf.porItem[i]; const env = cot.envios.find((e) => e.key === it.envio_key);
            const nComp = env ? cot.items.filter((x) => x.envio_key === env.key).length : 0;
            return (
              <Tarjeta key={it.key} padding="10px 12px" data-item-cotizacion={i + 1}>
                <div style={{ display: "flex", gap: 10 }}>
                  <ImagenFicha src={it.ficha.imagenes?.[0]} almacen={almacen} style={{ width: 56, height: 56, flexShrink: 0, borderRadius: R.sm, border: `1px solid ${C.border}` }} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: T.sm, fontWeight: 800, color: C.ink, lineHeight: 1.3, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{i + 1}. {it.ficha.nombre || "Sin nombre"}</div>
                    <div data-resumen-item style={{ fontSize: T.small, color: C.inkMuted, marginTop: 3, lineHeight: 1.5 }}>
                      <div>Proveedor: <b style={{ color: C.ink }}>{it.proveedor || "—"}</b> · Cantidad: <b style={{ color: C.ink }}>{l.cantidad}</b></div>
                      {Number(it.precio_origen) > 0
                        ? <div>Precio unitario de compra: <b style={{ color: C.ink, fontFamily: MONO }}>{m(it.precio_origen)}</b>{it.precio_incluye_iva === false ? " + IVA" : ""}</div>
                        : <div style={{ color: C.warnText, fontWeight: 700 }}>Falta el precio de compra · toca Editar</div>}
                      <div data-despacho-item>Despacho: {env ? <><b style={{ color: C.ink, fontFamily: MONO }}>{m(l.envio_asignado)}</b>{nComp > 1 ? ` (parte de ${m(env.monto)} compartido con ${nComp - 1} producto${nComp > 2 ? "s" : ""})` : ""} · <span style={{ color: envioConfirmado(env) ? C.okText : C.warnText, fontWeight: 700 }}>{ESTADOS_ENVIO[env.estado]?.label}</span></> : <span style={{ color: C.warnText, fontWeight: 700 }}>sin registrar</span>}</div>
                      <div>Costo de adquisición: <b style={{ color: C.ink, fontFamily: MONO }}>{m(l.costo_bruto)}</b></div>
                    </div>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
                      {it.producto_id && <Badge tono="info">Biblioteca</Badge>}
                      {rv.bloqueos.length > 0 && <Badge tono="danger">{rv.bloqueos.length} bloqueo</Badge>}
                      {rv.revisar.length > 0 && <Badge tono={it.ficha_aprobada ? "ok" : "warn"}>{it.ficha_aprobada ? "Ficha aprobada" : `${rv.revisar.length} por revisar`}</Badge>}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
                  {enlaceValido(it.enlace)
                    ? (protegido
                      ? <a data-ir-a-comprar href={it.enlace.trim()} target="_blank" rel="noopener noreferrer" style={{ background: C.teal, color: "#fff", borderRadius: 10, padding: "8px 16px", fontWeight: 800, fontSize: T.sm, textDecoration: "none", minHeight: 40, display: "inline-flex", alignItems: "center" }}>🛒 Ir a comprar</a>
                      : <a data-abrir-publicacion href={it.enlace.trim()} target="_blank" rel="noopener noreferrer" style={{ border: `1px solid ${C.teal}`, color: C.tealDark, borderRadius: 10, padding: "6px 12px", fontWeight: 700, fontSize: T.small, textDecoration: "none", minHeight: 34, display: "inline-flex", alignItems: "center" }}>Abrir publicación ↗</a>)
                    : <span data-sin-enlace style={{ fontSize: T.small, color: C.warnText, fontWeight: 700 }}>Sin enlace registrado · <button type="button" onClick={() => abrirEditar(it)} style={{ border: "none", background: "none", color: C.tealDark, textDecoration: "underline", cursor: "pointer", padding: 0, fontSize: T.small }}>Agregar enlace</button></span>}
                  <div style={{ flex: 1 }} />
                  {i > 0 && !protegido && <BotonSecundario aria-label="Subir" onClick={() => mover(i, -1)} style={{ minHeight: 34, padding: "4px 10px" }}>↑</BotonSecundario>}
                  {!protegido && <BotonSecundario onClick={() => quitar(it.key)} style={{ minHeight: 34, padding: "4px 10px", color: C.dangerText }}>Quitar</BotonSecundario>}
                  <BotonSecundario data-editar-item onClick={() => abrirEditar(it)} style={{ minHeight: 34, padding: "4px 12px" }}>Editar</BotonSecundario>
                </div>
              </Tarjeta>
            );
          })}
        </PanelPestana>

        <PanelPestana visible={pestana === "precios"} titulo="Precios">
          {calc.exenta && <AvisoLinea tono="info" icono="⚖️" dato="cotizacion-exenta">Venta exenta aprobada ({cotTrib.tratamiento_iva === "exenta_fora" ? "FO.R.A., art. 101 Ley 18.948" : "exención legal"}): el recargo se aplica sobre el costo bruto (el IVA de las compras no se recupera) y la oferta no lleva IVA.</AvisoLinea>}
          {difiereTratamiento && <AvisoLinea tono="warn" dato="tratamiento-difiere">La cotización está adjudicada: sus precios se mantienen con la fórmula con que se ofertaron ({calc.exenta ? "exenta" : "afecta"}), aunque la clasificación vigente sea otra.</AvisoLinea>}
          {!cot.items.length && <div style={{ fontSize: T.sm, color: C.inkFaint }}>Agrega productos para ver sus precios.</div>}
          {cot.items.map((it, i) => {
            const l = calc.lineas[i];
            return (
              <Tarjeta key={it.key} padding="14px" data-precio-item={i + 1} style={{ borderColor: l.avisos.length ? C.warn : C.teal }}>
                <div style={{ fontSize: T.sm, fontWeight: 800, color: C.ink, lineHeight: 1.3 }}>{i + 1}. {it.ficha.nombre || "Producto"}</div>
                <div style={{ fontSize: T.small, fontWeight: 800, color: C.tealDark, letterSpacing: 0.4, marginTop: 10 }}>{calc.exenta ? "VALOR UNITARIO EXENTO PARA MERCADO PÚBLICO" : "VALOR UNITARIO NETO PARA MERCADO PÚBLICO"}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 2 }}>
                  <span data-unitario={i + 1} style={{ fontSize: 34, fontWeight: 900, color: l.avisos.length ? C.inkMuted : C.ink, fontFamily: MONO, letterSpacing: -0.5 }}>{m(l.unitario_neto)}</span>
                  <BotonPrincipal data-copiar-valor={i + 1} onClick={() => copiarUno(i)} disabled={!!l.avisos.length} style={{ minHeight: 40, opacity: l.avisos.length ? 0.5 : 1 }}>Copiar valor</BotonPrincipal>
                </div>
                <div style={{ fontSize: T.sm, color: C.inkMuted, marginTop: 6, lineHeight: 1.6 }}>
                  Cantidad: <b style={{ color: C.ink }}>{l.cantidad}</b> · {calc.exenta ? "Subtotal exento" : "Subtotal neto"}: <b data-subtotal={i + 1} style={{ color: C.ink, fontFamily: MONO }}>{m(l.neto_linea)}</b><br />
                  <span style={{ fontSize: T.small }}>El despacho ({m(l.envio_asignado)}) ya está incorporado en el valor unitario: el campo Despacho de Mercado Público va en $0.</span>
                </div>
                <div data-recargo-producto={i + 1} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 8, paddingTop: 8, borderTop: `1px solid ${C.border}` }}>
                  <label htmlFor={`cz-recargo-${it.key}`} style={{ fontSize: T.sm, color: C.inkMuted, flex: "1 1 160px" }}>Recargo de este producto (%)</label>
                  <CampoPorcentaje id={`cz-recargo-${it.key}`} dato={`recargo-producto-${i + 1}`} disabled={protegido} valor={l.recargo} onCambiar={(v) => cambiar((c) => aplicarRecargoProducto(c, it.key, v))} />
                  <span style={{ fontSize: T.sm }}>%</span>
                  <Badge tono={it.recargo == null || it.recargo === "" ? "neutro" : "info"}>{it.recargo == null || it.recargo === "" ? "General" : "Ajustado"}</Badge>
                  {!(it.recargo == null || it.recargo === "") && !protegido && <button type="button" data-volver-general={i + 1} onClick={() => cambiar((c) => aplicarRecargoProducto(c, it.key, null))} style={{ border: "none", background: "none", color: C.tealDark, textDecoration: "underline", cursor: "pointer", fontSize: T.small, padding: 0, minHeight: 32 }}>Usar el general</button>}
                </div>
                {l.avisos.map((a, j) => <AvisoLinea key={j} tono="warn" dato="pendiente-precio">{a}</AvisoLinea>)}
              </Tarjeta>
            );
          })}

          {cot.items.length > 0 && (
            <Tarjeta padding="12px 14px" data-totales-cotizacion>
              <FilaDato k="Costo total de adquisición (productos + despachos)" v={m(calc.totales.costo_bruto)} dato="costo-adquisicion" />
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "8px 0", borderBottom: `1px solid ${C.border}` }}>
                <label htmlFor="cz-recargo" style={{ fontSize: T.sm, color: C.inkMuted, flex: 1 }}>Recargo comercial <span style={{ fontSize: T.small }}>(general: se aplica a todos los productos)</span></label>
                <CampoPorcentaje id="cz-recargo" dato="recargo" disabled={protegido} valor={cot.recargo} onCambiar={cambiarRecargoGeneral} />
                <span style={{ fontSize: T.sm }}>%</span>
                {Number(cot.recargo) !== RECARGO_SUGERIDO && !protegido && <button type="button" onClick={() => cambiarRecargoGeneral(RECARGO_SUGERIDO)} style={{ border: "none", background: "none", color: C.tealDark, textDecoration: "underline", cursor: "pointer", fontSize: T.small, padding: 0, minHeight: 32 }}>Usar sugerido 30%</button>}
              </div>
              <div style={{ padding: "8px 0", borderBottom: `1px solid ${C.border}` }}>
                <div style={{ fontSize: T.sm, color: C.inkMuted, marginBottom: 4 }}>{calc.exenta ? "Precio unitario exento de cada producto" : "Precio unitario neto de cada producto"}</div>
                {cot.items.map((it, i) => <div key={it.key} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: T.sm }}><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i + 1}. {it.ficha.nombre || "Producto"}{calc.lineas[i].recargo !== (cot.recargo === "" ? RECARGO_SUGERIDO : Number(cot.recargo)) ? ` (recargo ${pct(calc.lineas[i].recargo)})` : ""}</span><b style={{ fontFamily: MONO }}>{m(calc.lineas[i].unitario_neto)}</b></div>)}
              </div>
              {calc.exenta ? <>
                <FilaDato k="IVA no recuperable incluido en el costo" v={m(calc.totales.iva_no_recuperable)} dato="iva-no-recuperable" />
                <FilaDato k="Total exento" v={m(calc.totales.neto)} fuerte dato="neto" />
                <FilaDato k="IVA de venta" v={m(0)} dato="iva-venta" />
                <FilaDato k="Total de la oferta" v={m(calc.totales.total)} fuerte dato="total" />
              </> : <>
                <FilaDato k="Total neto de la oferta" v={m(calc.totales.neto)} fuerte dato="neto" />
                <FilaDato k="Total con IVA (19%)" v={m(calc.totales.total)} fuerte dato="total" />
              </>}
              <FilaDato k="Ganancia neta estimada" v={m(calc.totales.utilidad_neta)} tono={calc.totales.utilidad_neta >= 0 ? "ok" : "danger"} fuerte dato="utilidad" />
            </Tarjeta>
          )}
          <BotonSecundario data-copiar-mp onClick={copiarMP} disabled={!cot.items.length || !calc.listo} style={{ width: "100%", justifyContent: "center", minHeight: 44 }}>Copiar valores para Mercado Público</BotonSecundario>
          {cot.items.length > 0 && !calc.listo && <div data-copiar-bloqueado style={{ fontSize: T.small, color: C.warnText, textAlign: "center", marginTop: 6 }}>Bloqueado: confirma los costos y despachos pendientes ({calc.pendientes.length}) antes de copiar precios a Mercado Público.</div>}
        </PanelPestana>

        <PanelPestana visible={pestana === "eett"} titulo="EETT">
          <AvisoLinea tono="info" icono="🔒">El PDF contiene solo información técnica: nunca precios, despachos, enlaces, proveedores, recargos, ganancias ni IVA. Se descarga en este dispositivo y no se guarda en el servidor.</AvisoLinea>
          {pdf.faltan.length > 0 && <AvisoLinea tono="warn" dato="faltan-datos" accion="Completar" onClick={() => setPestana("datos")}>Falta: {pdf.faltan.join(" y ")}.</AvisoLinea>}
          {pdf.advertencias.map((a, i) => <AvisoLinea key={i} tono="warn" icono="⚠" dato={`eett-advertencia-${a.tipo}`} {...(a.tipo === "faltan_datos" ? { accion: "Revisar datos", onClick: () => setPestana("datos") } : {})}>{a.mensaje}</AvisoLinea>)}
          {pdf.advertencias.length > 0 && <div data-eett-advertencias-nota style={{ fontSize: T.small, color: C.inkMuted, marginBottom: 6 }}>Estas advertencias son para revisión manual: no bloquean la generación del PDF.</div>}
          {!cot.items.length && <div style={{ fontSize: T.sm, color: C.inkFaint }}>Agrega productos para generar la EETT.</div>}
          {pdf.porItem.map((p, i) => {
            const it = cot.items[i];
            return (
              <Tarjeta key={p.key} padding="10px 12px" data-revision-eett={i + 1}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                  <div style={{ fontSize: T.sm, fontWeight: 800, color: C.ink, minWidth: 0 }}>Ficha {i + 1}: {it.ficha.nombre || "Sin nombre"}</div>
                  <Badge tono={p.bloqueos.length ? "danger" : p.aprobado ? "ok" : "warn"}>{p.bloqueos.length ? "Bloqueada" : p.aprobado ? "Lista" : "Revisar"}</Badge>
                </div>
                {p.avisos.map((a, j) => <div key={j} style={{ fontSize: T.small, color: a.nivel === "bloqueo" ? C.dangerText : C.warnText, marginTop: 4 }}>• {a.mensaje}</div>)}
                {p.revisar.length > 0 && !p.bloqueos.length && (
                  <label data-aprobar-ficha style={{ display: "flex", alignItems: "center", gap: 8, fontSize: T.sm, marginTop: 8, minHeight: 36, fontWeight: 700 }}>
                    <input type="checkbox" checked={!!it.ficha_aprobada} onChange={(e) => cambiar((c) => { c.items[i].ficha_aprobada = e.target.checked; return c; })} />
                    Revisé estos avisos y apruebo la ficha tal como está
                  </label>
                )}
                <div style={{ marginTop: 6 }}><button type="button" onClick={() => abrirEditar(it)} style={{ border: "none", background: "none", color: C.tealDark, textDecoration: "underline", cursor: "pointer", fontSize: T.small, padding: 0, minHeight: 30 }}>Corregir ficha</button></div>
              </Tarjeta>
            );
          })}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
            <BotonSecundario data-vista-previa-eett onClick={verPrevia} disabled={!cot.items.length || !!generando} style={{ flex: "1 1 160px", justifyContent: "center", minHeight: 48 }}>{generando === "previa" ? "Preparando…" : "Vista previa de EETT"}</BotonSecundario>
            <BotonPrincipal data-generar-eett onClick={generarYDescargar} disabled={!pdf.listo || !!generando} style={{ flex: "2 1 220px", justifyContent: "center", minHeight: 48, opacity: !pdf.listo || generando ? 0.55 : 1 }}>{generando === "descarga" ? "Guardando y generando…" : "Generar y descargar EETT"}</BotonPrincipal>
          </div>
          <div style={{ fontSize: T.small, color: C.inkFaint, marginTop: 6 }}>Al generar, la cotización se guarda automáticamente (solo si hay cambios) y el PDF se crea con los datos recién guardados. La vista previa no guarda nada.</div>
          {falla && <AvisoLinea tono="danger" dato="falla-descarga" accion="Reintentar descarga" onClick={reintentar}>Los datos quedaron guardados (versión {falla.base.version}), pero la descarga falló: {falla.mensaje}</AvisoLinea>}
          {historial.length > 0 && (
            <Seccion titulo="EETT generadas" nota="Registro de cada generación (los PDF quedan en el dispositivo donde se descargaron).">
              {historial.map((h) => (
                <div key={h.id} data-eett-generado style={{ fontSize: T.small, color: C.inkMuted, padding: "4px 0", borderBottom: `1px solid ${C.border}` }}>
                  {fechaHora(h.fecha)} · versión {h.version}{h.paginas ? ` · ${h.paginas} pág.` : ""}{h.generado_por_nombre ? ` · ${h.generado_por_nombre}` : ""}{h.nombre_documento ? ` · ${h.nombre_documento}` : ""}
                </div>
              ))}
            </Seccion>
          )}
        </PanelPestana>
      </div>

      {editor && <EditorFicha key={editor.item.key} inicial={editor.item} esNuevo={editor.esNuevo} envios={cot.envios} items={cot.items} destino={destino} destinoValido={dirOk} dirCliente={{ direccion_entrega: cot.direccion_entrega, comuna: cot.comuna, region: cot.region }} onDireccion={setDireccion} almacen={almacen} token={token} protegido={protegido && !editor.esNuevo} onGuardar={guardarItem} onCerrar={cerrarFicha} respaldo={editor.respaldo} onBorrador={alCambiarFicha} />}
      {verBib && <SelectorBiblioteca almacen={almacen} onElegir={desdeBiblioteca} onCerrar={() => setVerBib(false)} />}
      {preview && <VistaPreviaEETT {...preview} onCerrar={() => setPreview(null)} onDescargar={pdf.listo ? () => { setPreview(null); generarYDescargar(); } : null} />}
      {eliminar && <EliminarCotizacion cot={{ ...cot, estado: estadoGuardado || cot.estado, oc_codigo: inicial.oc_codigo || cot.oc_codigo }} nEett={historial.length} onCancelar={() => setEliminar(false)} onEliminar={eliminarCot} />}
    </HojaLateral>
  );
}

// Biblioteca compartida: búsqueda en el servidor, páginas de 30 y miniaturas que se cargan al mostrarse.
export function SelectorBiblioteca({ almacen, onElegir, onCerrar }) {
  const [q, setQ] = useState(""); const [filas, setFilas] = useState([]); const [total, setTotal] = useState(0); const [pagina, setPagina] = useState(0); const [cargando, setCargando] = useState(false);
  useEffect(() => {
    let vivo = true; setCargando(true);
    const t = setTimeout(() => almacen.listarProductos({ q, pagina }).then((r) => { if (!vivo) return; setTotal(r.total); setFilas((f) => (pagina ? [...f, ...r.filas] : r.filas)); }).catch(() => {}).finally(() => vivo && setCargando(false)), 250);
    return () => { vivo = false; clearTimeout(t); };
  }, [almacen, q, pagina]);
  return (
    <Modal title="Biblioteca de fichas técnicas" onClose={onCerrar}>
      <input value={q} onChange={(e) => { setQ(e.target.value); setPagina(0); }} placeholder="Buscar por nombre, marca o modelo" style={{ ...iStyle, marginBottom: 10 }} autoFocus />
      {!cargando && !filas.length && <div style={{ fontSize: T.sm, color: C.inkFaint }}>{q ? "Sin resultados." : "La biblioteca está vacía. Las fichas que guardes al ingresar productos aparecerán aquí."}</div>}
      {filas.map((p) => (
        <Tarjeta key={p.id} onClick={() => onElegir(p)} padding="8px 10px" data-producto-biblioteca={p.nombre}>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <ImagenFicha src={p.imagenes?.[0]} almacen={almacen} style={{ width: 44, height: 44, flexShrink: 0, border: `1px solid ${C.border}`, borderRadius: R.sm }} />
            <div style={{ minWidth: 0 }}><div style={{ fontSize: T.sm, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.nombre}</div><div style={{ fontSize: T.small, color: C.inkMuted }}>{[p.marca, p.modelo].filter(Boolean).join(" · ")}</div></div>
          </div>
        </Tarjeta>
      ))}
      {cargando && <div style={{ fontSize: T.small, color: C.inkFaint, textAlign: "center", padding: 8 }}>Cargando…</div>}
      {!cargando && filas.length < total && <BotonSecundario onClick={() => setPagina((p) => p + 1)} style={{ width: "100%", justifyContent: "center" }}>Ver más ({total - filas.length})</BotonSecundario>}
    </Modal>
  );
}
