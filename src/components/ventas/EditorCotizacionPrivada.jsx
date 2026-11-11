// Ventas privadas › Cotización privada — MISMA experiencia que la cotización de Mercado Público (08/11/2026).
// Estándar: components/cotizaciones/EditorCotizacion.jsx. Se reutilizan sus piezas: hoja lateral, pestañas Datos · Productos ·
// Precios · EETT, pasos, tarjetas de producto, ventana «Ingresar/Editar producto» (EditorFicha), biblioteca de fichas
// (SelectorBiblioteca), imágenes (ImagenFicha + depósito cz-productos), vista previa de PDF (VistaPreviaEETT) y avisos.
// Adaptaciones al canal privado:
//   · Datos: cliente del registro compartido (en lugar de institución), contacto, dirección de entrega, responsable, fechas,
//     vigencia, plazo y condiciones comerciales y de pago. Sin código de Compra Ágil, licitación ni consulta a ChileCompra.
//     Folio automático; la OC del cliente se registra después (al crear la venta), no para cotizar.
//   · Precios: costo de adquisición como Mercado Público; precio de venta y descuento como siempre en ventas privadas
//     (ver lib/vpCotizacion.js). Costos y márgenes solo para el responsable y los administradores.
//   · EETT (09/11/2026): MISMO recorrido de la pestaña EETT de Mercado Público — revisión de fichas con aprobación,
//     «Corregir ficha», «Vista previa de EETT» (no guarda nada) y «Generar y descargar EETT» (guarda si hay cambios, emite y
//     descarga; si la descarga falla, «Reintentar descarga»), con el mismo generador y la misma plantilla de PDF. La ficha
//     ingresada en Productos pasa directo al documento (lib/vpEETT.normalizarFichaEETT). Sin ventana adicional: no se
//     piden objeto, alcance ni requisitos. La EETT queda emitida con folio y revisión para vincularla a la venta.
//     Además, PDF comercial de la cotización (sin costos ni márgenes).
//   · Flujo privado intacto: borrador, envío/aceptación/rechazo/vencimiento MANUALES, revisiones, duplicar, «Crear venta /
//     Registrar OC» (idempotente), respaldos, permisos e historial. Ver o descargar un PDF nunca cambia el estado.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { C, T, R, MONO, iStyle, iMono, selStyle, fmt, cardStyle } from "../../lib/theme";
import { Field } from "../ui/Basicos";
import { HojaLateral, Pestanas, PanelPestana, Tarjeta, Badge, AvisoLinea, BotonPrincipal, BotonSecundario, FilaDato, Seccion } from "../ui/Sistema";
import { Ventana, Campo, Entrada, Area, ErrorForm, PedirMotivo } from "../proyectos/Comunes";
import { Vacio, estiloBoton, BadgeVP, SelectorCliente, SubirArchivo, ListaDocumentos } from "./Comunes";
import { FormCliente } from "./PanelClientes";
import { descargarEETT, imagenesDe } from "../../lib/vpEETTDescarga";
import { CrearVentaDesdeCotizacion } from "./NuevaVenta";
import { EditorFicha } from "../cotizaciones/EditorFicha";
import { SelectorBiblioteca } from "../cotizaciones/EditorCotizacion";
import { ImagenFicha } from "../cotizaciones/ImagenFicha";
import { VistaPreviaEETT } from "../cotizaciones/VistaPreviaEETT";
import { ConflictoVersion } from "../ui/ConflictoVersion";
import { combinarVersiones, aplicarCombinacion, normalizarProductos, resumenProductos, textoValor } from "../../lib/conflictoVersion";
import { claveVendedor, nombreVendedor, opcionesVendedor, vendedorDocumento } from "../../lib/vpFinanciamiento";
import { asignarVendedor } from "../../lib/ventasPrivadasDatos";
import { leerCotizacion, guardarCotizacion, cambiarEstadoCotizacion, nuevaRevision, duplicarCotizacion, historialCotizacion, anular, esquemaFichaVP, leerEETT, listarEETT, guardarEETT, emitirEETT, ocClienteDeVenta } from "../../lib/ventasPrivadasDatos";
import { accionesCotizacion, ESTADOS_COTIZACION, fechaTxt, hoyISO, sumarDias, folioRevision, mensajeVP, documentoDesdeEditor, cantidadTxt } from "../../lib/ventasPrivadas";
import { itemVacioVP, cotizacionParaEditor, calcularCotizacionVP, precioConRecargo, lineaParaGuardarVP, validarItemsVP, descripcionDeFicha } from "../../lib/vpCotizacion";
import { ESTADOS_ENVIO, envioConfirmado, envioVacio, nuevaClave, proveedorDeEnlace, invalidarDespachosPorDireccion, revisarFicha } from "../../lib/cotizaciones";
import { crearAlmacen, logoBFK, subirImagenesFicha } from "../../lib/cotizacionesDatos";
import { generarPdfCotizacion } from "../../lib/vpPdf";
import { generarPdfEETTVP, contenidoEETTVP, normalizarFichaEETT, mismoContenidoEETT } from "../../lib/vpEETT";
import { descargarBlob } from "../../lib/eettPdf";
import { guardarBorrador, borrarBorrador, leerBorrador } from "../../lib/borradoresCotizacion";
import logoUrl from "../../assets/bfk-logo.jpg";

const m = (x) => fmt.money(Math.round(Number(x) || 0));
const pctTxt = (x) => `${(Math.round(Number(x) * 1000) / 10).toLocaleString("es-CL")}%`;
const fechaHora = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" }); };
const enlaceValido = (u) => /^https?:\/\/\S+$/i.test(String(u || "").trim());
const limpiarEnvios = (c) => { c.envios = c.envios.filter((e) => c.items.some((it) => it.envio_key === e.key)); return c; };
const clonar = (x) => JSON.parse(JSON.stringify(x));
const CAMPOS_CAB = ["contacto_nombre", "contacto_correo", "contacto_telefono", "fecha_emision", "vigencia_hasta", "plazo_entrega", "direccion_entrega", "condiciones_pago", "observaciones", "condiciones_comerciales"];
// Recuperación local (este dispositivo): mismo almacén de borradores que Mercado Público, en un espacio propio («vp:»)
// para que no aparezca en la lista de borradores de Mercado Público.
const usuarioLocal = (u) => (u ? `vp:${u}` : null);
// Campos que se comparan si otra pestaña o persona guardó una versión más nueva (lib/conflictoVersion.js).
const ETIQUETAS_CAB = { contacto_nombre: "Contacto", contacto_correo: "Correo del contacto", contacto_telefono: "Teléfono del contacto", fecha_emision: "Fecha de emisión",
  vigencia_hasta: "Vigencia", plazo_entrega: "Plazo de entrega", direccion_entrega: "Dirección de entrega", condiciones_pago: "Condiciones de pago", observaciones: "Observaciones",
  condiciones_comerciales: "Condiciones comerciales" };
const gruposConflicto = (clientes) => [
  { k: "cliente_id", etiqueta: "Cliente", claves: ["cliente_id"], resumen: (v) => clientes.find((x) => x.id === v.cliente_id)?.razon_social || textoValor(v.cliente_id) },
  ...CAMPOS_CAB.map((k) => ({ k, etiqueta: ETIQUETAS_CAB[k] || k, claves: [k] })),
  { k: "afecta_iva", etiqueta: "Afecta IVA", claves: ["afecta_iva"], resumen: (v) => (v.afecta_iva === false ? "No" : "Sí") },
  { k: "vendedor", etiqueta: "Vendedor", claves: ["vendedor"], resumen: (v) => (v.vendedor === "bfk" ? "BFK" : v.vendedor ? v.vendedor : "Sin vendedor asignado") },
  { k: "productos", etiqueta: "Productos, precios y despachos", claves: ["items", "envios"], normalizar: normalizarProductos, resumen: resumenProductos },
];
const cotDesde = (x) => { const { rev, items, envios } = cotizacionParaEditor(x, x.cab.revision_id);
  return { cliente_id: x.cab.cliente_id, ...Object.fromEntries(CAMPOS_CAB.map((k) => [k, rev[k] ?? ""])), afecta_iva: rev.afecta_iva !== false, items, envios,
    ...(x.cab._vendedorInstalado ? { vendedor: claveVendedor(x.cab) } : {}) }; };

// Campo de porcentaje (igual al de Mercado Público): muestra % y entrega fracción; conserva el texto mientras se escribe.
function CampoPorcentaje({ id, dato, valor, onCambiar, disabled, ancho = 80 }) {
  const aTexto = (v) => (v === "" || v == null || Number.isNaN(Number(v)) ? "" : String(Math.round(Number(v) * 10000) / 100));
  const [txt, setTxt] = useState(() => aTexto(valor)); const enfocado = useRef(false);
  useEffect(() => { if (!enfocado.current) setTxt(aTexto(valor)); }, [valor]);
  return <input id={id} data-campo={dato} type="text" inputMode="decimal" disabled={disabled} value={txt}
    onFocus={() => { enfocado.current = true; }} onBlur={() => { enfocado.current = false; setTxt(aTexto(valor)); }}
    onChange={(e) => { const t = e.target.value.replace(",", "."); if (!/^-?\d*\.?\d*$/.test(t)) return; setTxt(e.target.value);
      if (t === "") onCambiar(""); else if (!Number.isNaN(Number(t)) && t !== "-" && t !== ".") onCambiar(Math.round(Number(t) * 100) / 10000); }}
    style={{ ...iMono, width: ancho }} />;
}

// Revisión de la ficha para la EETT (reglas de Mercado Público), sobre lo que irá al PDF (ficha normalizada: pares como
// características y textos como descripción). En un servicio no se exigen marca, modelo ni imágenes.
function revisionFicha(it) {
  const av = revisarFicha(normalizarFichaEETT(it.ficha)).filter((a) => !(it.tipo === "servicio" && ["marca", "modelo", "imagenes"].includes(a.tipo)));
  const bloqueos = av.filter((a) => a.nivel === "bloqueo"); const revisar = av.filter((a) => a.nivel === "revisar");
  return { avisos: av, bloqueos, revisar, aprobado: !bloqueos.length && (!revisar.length || !!it.ficha_aprobada) };
}

export function EditorCotizacionPrivada({ token, perfil, vp, id, showToast, onCerrar, onRecargar, onAbierta, onAbrir, usuarioId }) {
  const esAdmin = perfil?.rol === "admin";
  const tokenRef = useRef(token); tokenRef.current = token;
  const almacen = useMemo(() => crearAlmacen(() => tokenRef.current, "base", 2), []);
  const [d, setD] = useState(null); const [err, setErr] = useState(""); const [revVista, setRevVista] = useState(null);
  const [cot, setCot] = useState(null); const [sucio, setSucio] = useState(false);
  const [pestana, setPestana] = useState(id ? "productos" : "datos");
  const [editor, setEditor] = useState(null); const [verBib, setVerBib] = useState(false);
  const [ocupado, setOcupado] = useState(""); const [modal, setModal] = useState(null); const [historial, setHistorial] = useState(null); const [falla, setFalla] = useState(null);
  const [nuevoCliente, setNuevoCliente] = useState(false); const [previa, setPrevia] = useState(null);
  const [esquema, setEsquema] = useState(undefined); const [recuperable, setRecuperable] = useState(null);
  const yaCargo = useRef(false);
  // Punto de partida de esta pestaña (lo último cargado o guardado): sirve para combinar si otra versión se guardó después.
  const baseRef = useRef(null); const dRef = useRef(null); dRef.current = d;
  const recuperableRef = useRef(null); recuperableRef.current = recuperable;
  const [conflicto, setConflicto] = useState(null);   // { x2, bfk, mio, campos, nota }

  const cargar = useCallback(async (cid) => {
    try {
      const x = await leerCotizacion(tokenRef.current, cid); if (!x) { setErr("La cotización no existe o no tienes acceso."); return null; }
      setD(x); setRevVista(x.cab.revision_id);
      const nuevaCot = cotDesde(x); baseRef.current = clonar(nuevaCot);
      setCot(nuevaCot);
      setSucio(false); setErr("");
      return x;
    } catch (e) {
      // Ya abierta: una falla al recargar (p. ej. sin conexión) no reemplaza la pantalla ni lo escrito.
      if (dRef.current) { showToast?.(`No se pudo recargar la cotización: ${mensajeVP(e)}`, "error"); return null; }
      setErr(mensajeVP(e)); return null;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (yaCargo.current) return; yaCargo.current = true;
    esquemaFichaVP(tokenRef.current).then(setEsquema);
    (async () => {
      let x = null;
      if (id) x = await cargar(id);
      else setCot({ cliente_id: null, contacto_nombre: "", contacto_correo: "", contacto_telefono: "", fecha_emision: hoyISO(), vigencia_hasta: sumarDias(hoyISO(), 15), plazo_entrega: "",
        direccion_entrega: "", condiciones_pago: "", observaciones: "", condiciones_comerciales: "", afecta_iva: true, items: [], envios: [],
        ...(vp.finInstalado ? { vendedor: perfil?.vendedor_id && (vp.vendedores || []).some((v) => v.id === perfil.vendedor_id && v.activo !== false) ? perfil.vendedor_id : "" } : {}) });
      // Borrador de recuperación de este dispositivo (cambios que no alcanzaron a guardarse).
      const b = await leerBorrador(usuarioLocal(usuarioId), id || "nueva").catch(() => null);
      if (b?.cot && (!id || b.versionBase === x?.cab?.version)) setRecuperable(b);
      // Copia de una versión anterior (otra pestaña o persona guardó después): NO se borra; se ofrece revisar y combinar.
      else if (b?.cot && x) setRecuperable({ ...b, desactualizado: true, versionBFK: x.cab.version });
    })();
  }, [id, cargar, usuarioId]);

  const nueva = !id;
  const c = d?.cab;
  const esResp = nueva || esAdmin || c?.responsable_id === perfil?.id || c?.creado_por === perfil?.id;
  const verCostos = nueva || esResp;   // la base vuelve a decidir: si no corresponde, no entrega costos
  const acc = c ? accionesCotizacion(c, { esResponsable: esResp, esAdmin }) : { editar: true };
  const viendoActual = !c || revVista === c.revision_id;
  const editable = nueva || (acc.editar && viendoActual);
  const vistaRev = useMemo(() => (c && !viendoActual && d ? cotizacionParaEditor(d, revVista) : null), [c, viendoActual, d, revVista]);
  const vista = vistaRev ? { ...cot, ...Object.fromEntries(CAMPOS_CAB.map((k) => [k, vistaRev.rev[k] ?? ""])), afecta_iva: vistaRev.rev.afecta_iva !== false, items: vistaRev.items, envios: vistaRev.envios } : cot;
  const calc = useMemo(() => (vista ? calcularCotizacionVP(vista) : null), [vista]);
  const cliente = vp.clientes.find((x) => x.id === vista?.cliente_id);
  const cambiar = (fn) => { setCot((x) => fn(clonar(x))); setSucio(true); };
  const setCampo = (k, v) => cambiar((x) => { x[k] = v; return x; });
  const destino = String(vista?.direccion_entrega || "").trim(); const dirOk = destino.length >= 5;
  const avisoInvalidados = useRef(0);
  const setDireccion = (v) => {
    let n = 0;
    cambiar((x) => { x.direccion_entrega = v; n = invalidarDespachosPorDireccion(x); return x; });
    setTimeout(() => { if (n && Date.now() - avisoInvalidados.current > 4000) { avisoInvalidados.current = Date.now(); showToast?.(`La dirección cambió: ${n} despacho${n === 1 ? "" : "s"} vuelve${n === 1 ? "" : "n"} a «Por verificar».`, "error"); } }, 0);
  };

  // ── Copia local de recuperación (IndexedDB de este dispositivo; nada se envía a BFK hasta «Guardar») ──
  const vivo = useRef({}); vivo.current = { cot, sucio, pestana, version: c?.version || 0, editable, folio: c?.folio };
  const cerrandoAdrede = useRef(false);
  const respaldar = () => {
    const { cot: x, sucio: s, pestana: p, version, editable: ed, folio } = vivo.current;
    if (!usuarioId || !x || !ed) return;
    if (!s) { if (!recuperableRef.current) borrarBorrador(usuarioLocal(usuarioId), id || "nueva").catch(() => {}); return; }   // una copia pendiente de decidir no se borra
    guardarBorrador({ usuario: usuarioLocal(usuarioId), idLocal: id || "nueva", cotId: id || null, versionBase: version, base: baseRef.current, titulo: folio || "Nueva cotización privada", cot: x, pestana: p }).catch(() => {});
  };
  useEffect(() => { const t = setTimeout(respaldar, 400); return () => clearTimeout(t); }, [cot, sucio, pestana]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const ya = () => respaldar();
    const alOcultar = () => { if (document.visibilityState === "hidden") ya(); };
    const antesDeSalir = (e) => { if (vivo.current.sucio) { ya(); e.preventDefault(); e.returnValue = ""; } };
    document.addEventListener("visibilitychange", alOcultar); window.addEventListener("pagehide", ya); window.addEventListener("beforeunload", antesDeSalir);
    return () => { document.removeEventListener("visibilitychange", alOcultar); window.removeEventListener("pagehide", ya); window.removeEventListener("beforeunload", antesDeSalir); if (!cerrandoAdrede.current) ya(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const recuperar = () => {
    if (recuperable.desactualizado) { abrirConflicto({ mio: recuperable.cot, base: recuperable.base || null }); return; }
    setCot(recuperable.cot); setSucio(true); if (recuperable.pestana) setPestana(recuperable.pestana); setRecuperable(null); showToast?.("Cambios recuperados: revísalos y presiona «Guardar»");
  };
  // ── Versión más nueva en BFK: lo escrito se conserva y se combina campo por campo (nada se sobrescribe solo) ──
  const abrirConflicto = async ({ mio = vivo.current.cot, base = baseRef.current } = {}) => {
    if (!c) return;
    try {
      const x2 = await leerCotizacion(tokenRef.current, c.id); if (!x2) return;
      const bfk = cotDesde(x2); const grupos = gruposConflicto(vp.clientes);
      const revEstado = x2.revisiones.find((r) => r.id === x2.cab.revision_id)?.estado;
      setConflicto({ x2, bfk, mio: clonar(mio), grupos, campos: combinarVersiones({ base, mio, bfk, grupos }),
        nota: revEstado && revEstado !== "borrador" ? `La revisión vigente (R${x2.cab.revision_actual}) ya fue enviada: para incorporar tus cambios crea una revisión nueva desde la versión de BFK.` : "" });
    } catch (e) { showToast?.(`No se pudo leer la versión de BFK: ${mensajeVP(e)}. Tus cambios siguen en la pantalla y en este dispositivo.`, "error"); }
  };
  const combinarConflicto = (elecciones) => {
    const k = conflicto; const resultado = aplicarCombinacion({ mio: k.mio, bfk: k.bfk, grupos: k.grupos, campos: k.campos, elecciones });
    setD(k.x2); setRevVista(k.x2.cab.revision_id); baseRef.current = clonar(k.bfk);
    setCot(resultado); setSucio(true); setConflicto(null); setRecuperable(null);
    showToast?.(`Combinado sobre la versión ${k.x2.cab.version} de BFK: revisa y presiona «Guardar».`);
  };
  const descartarConflicto = async () => { setConflicto(null); setRecuperable(null); borrarBorrador(usuarioLocal(usuarioId), id || "nueva").catch(() => {}); await cargar(c.id); showToast?.("Se abrió la versión guardada en BFK"); };
  const descartarRecuperable = () => { borrarBorrador(usuarioLocal(usuarioId), id || "nueva").catch(() => {}); setRecuperable(null); };

  // ── Datos ──
  const elegirCliente = (cid) => {
    const cl = vp.clientes.find((x) => x.id === cid);
    cambiar((x) => {
      x.cliente_id = cid; if (!cl) return x;
      x.contacto_nombre = x.contacto_nombre || cl.contacto_nombre || ""; x.contacto_correo = x.contacto_correo || cl.contacto_correo || ""; x.contacto_telefono = x.contacto_telefono || cl.contacto_telefono || "";
      x.condiciones_pago = x.condiciones_pago || cl.condiciones_pago || "";
      if (!String(x.direccion_entrega || "").trim()) { x.direccion_entrega = [cl.direccion_entrega, cl.comuna_entrega].filter(Boolean).join(", "); invalidarDespachosPorDireccion(x); }
      return x;
    });
  };

  // ── Productos (ingreso manual, biblioteca y edición: misma ventana que Mercado Público) ──
  const abrirNuevo = (item) => setEditor({ esNuevo: true, item });
  const abrirEditar = (item) => setEditor({ esNuevo: false, item });
  const manual = (extra = {}) => abrirNuevo(itemVacioVP({ origen_datos: "manual", ...extra }));
  const guardarItem = async (item, { guardarBiblioteca, actualizarBiblioteca, envio }) => {
    const it = { ...item }; delete it.consulta;
    try {
      if (guardarBiblioteca) { it.producto_id = await almacen.guardarProducto(it.ficha, { fuente: proveedorDeEnlace(it.enlace) || "", fecha_verificacion: null }); showToast?.("Ficha guardada en la biblioteca compartida"); }
      else if (actualizarBiblioteca && it.producto_id) await almacen.guardarProducto(it.ficha, { id: it.producto_id });
    } catch (e) { showToast?.(`No se guardó en la biblioteca: ${e.message}`, "error"); }
    cambiar((x) => {
      if (envio?.modo === "ninguno") it.envio_key = null;   // servicio: el despacho no aplica
      else if (envio) {
        const { modo, ...datos } = envio;
        const anterior = x.envios.find((e) => e.key === it.envio_key);
        const exclusivoAnterior = anterior && !x.items.some((y) => y.key !== it.key && y.envio_key === anterior.key);
        let key = datos.key;
        if (modo === "propio") key = exclusivoAnterior ? anterior.key : null;
        if (!key) { key = nuevaClave("e"); x.envios.push({ ...envioVacio(it.proveedor), key }); }
        const e = x.envios.find((y) => y.key === key);
        const sinDir = envioConfirmado(datos) && !(String(x.direccion_entrega || "").trim().length >= 5);
        Object.assign(e, { proveedor: datos.proveedor || e.proveedor || it.proveedor, monto: datos.monto, estado: sinDir ? "pendiente" : datos.estado, evidencia: datos.evidencia, con_factura: datos.con_factura, destino: sinDir ? "" : datos.destino, fecha_cotizacion: datos.fecha_cotizacion || e.fecha_cotizacion });
        if (modo === "propio" && !String(e.proveedor || "").trim()) e.proveedor = it.proveedor;
        it.envio_key = key;
      }
      const i = x.items.findIndex((y) => y.key === it.key);
      if (i >= 0) { if (JSON.stringify(x.items[i].ficha) !== JSON.stringify(it.ficha)) it.ficha_aprobada = false; x.items[i] = it; } else x.items.push(it);
      return limpiarEnvios(x);
    });
    setEditor(null);
    if (envio && envio.estado === "pendiente" && !dirOk && envio.modo !== "ninguno") showToast?.("Ítem guardado. El despacho queda «Por verificar» hasta registrar la dirección de entrega.");
  };
  const desdeBiblioteca = (p) => {
    manual({ producto_id: p.id, origen_datos: "biblioteca", ficha: { nombre: p.nombre, marca: p.marca, modelo: p.modelo, color: p.color, descripcion: p.descripcion, generales: p.generales, especificaciones: p.especificaciones, imagenes: p.imagenes } });
    setVerBib(false);
  };
  const quitar = (key) => { if (!window.confirm("¿Quitar este ítem de la cotización? (La biblioteca no cambia.)")) return; cambiar((x) => { x.items = x.items.filter((y) => y.key !== key); return limpiarEnvios(x); }); };
  const mover = (i, dd) => cambiar((x) => { const j = i + dd; if (j < 0 || j >= x.items.length) return x; [x.items[i], x.items[j]] = [x.items[j], x.items[i]]; return x; });

  // ── Precios ──
  const setItem = (key, k, v) => cambiar((x) => { const it = x.items.find((y) => y.key === key); if (it) it[k] = v; return x; });
  const aplicarRecargoItem = (i, r) => {
    const l = calc.lineas[i]; if (r === "" || l.costo_unitario == null) return;
    const p = precioConRecargo(l.costo_unitario, r); if (p != null) setItem(cot.items[i].key, "precio_unitario", p);
  };
  const [recargoTodos, setRecargoTodos] = useState(0.3);
  const aplicarRecargoTodos = () => {
    const sinCosto = calc.lineas.filter((l) => l.costo_unitario == null).length;
    cambiar((x) => { x.items.forEach((it, i) => { const p = precioConRecargo(calc.lineas[i].costo_unitario, recargoTodos); if (p != null) it.precio_unitario = p; }); return x; });
    showToast?.(`Recargo de ${pctTxt(recargoTodos)} aplicado al precio de venta${sinCosto ? ` (${sinCosto} ítem${sinCosto === 1 ? "" : "s"} sin costo no cambia${sinCosto === 1 ? "" : "n"})` : ""}.`);
  };

  // ── Guardar ──
  const guardarInterno = async () => {
    if (esquema === false) throw new Error("Falta instalar la actualización de la base de cotizaciones privadas (fichas técnicas y datos de compra por ítem). No se guardó nada para no perder datos.");
    if (!cot.cliente_id) { setPestana("datos"); throw new Error("Selecciona el cliente."); }
    const errores = validarItemsVP(cot.items); if (errores.length) { setPestana(/precio unitario de venta/.test(errores[0]) ? "precios" : "productos"); throw new Error(errores[0]); }
    if (cot.vigencia_hasta < cot.fecha_emision) { setPestana("datos"); throw new Error("La vigencia no puede ser anterior a la emisión."); }
    const ca = calcularCotizacionVP(cot);
    const items = await Promise.all(cot.items.map(async (it, i) => lineaParaGuardarVP(it, ca.lineas[i], {
      imagenes: await subirImagenesFicha(tokenRef.current, (it.ficha?.imagenes || []).slice(0, 4)),
      envio: it.tipo === "servicio" ? null : cot.envios.find((e) => e.key === it.envio_key) || null, conCostos: verCostos })));
    const p = { ...(c ? { id: c.id, version: c.version } : {}), cliente_id: cot.cliente_id, ...Object.fromEntries(CAMPOS_CAB.map((k) => [k, cot[k]])), afecta_iva: cot.afecta_iva !== false, items,
      // Vendedor (11/11/2026): solo se envía si cambió; sin cambio, se guarda con la función de siempre (vp_guardar_cotizacion).
      ...("vendedor" in cot && vp.finInstalado && (cot.vendedor || "") !== (c ? claveVendedor(c) : "") ? { vendedor: cot.vendedor || "" } : {}) };
    const r = await guardarCotizacion(tokenRef.current, p);
    borrarBorrador(usuarioLocal(usuarioId), id || "nueva").catch(() => {});
    await onRecargar?.();
    const x = await cargar(r.id); if (!c) { cerrandoAdrede.current = true; onAbierta?.(r.id); }
    // Guardada, pero la relectura falló (p. ej. se cortó la conexión): lo de la pantalla es lo guardado.
    if (!x) { baseRef.current = clonar(cot); setSucio(false); }
    return { r, x };
  };
  const guardar = async () => {
    setOcupado("guardar");
    try { const { r } = await guardarInterno(); showToast?.(c ? "Cotización guardada" : `Cotización ${r.folio} creada`); return r; }
    catch (e) { showToast?.(`No se guardó: ${mensajeVP(e)}`, "error"); if (e.conflicto && c) await abrirConflicto(); return null; }
    finally { setOcupado(""); }
  };

  // ── PDF comercial (sin costos ni márgenes). Ver o descargar NO cambia el estado de la cotización. ──
  const pdf = async (verPrimero) => {
    setOcupado(verPrimero ? "ver" : "pdf");
    try {
      const rv = c ? d.revisiones.find((r) => r.id === revVista) : null;
      const documento = rv?.documento || documentoDesdeEditor({ folio: c?.folio || "BORRADOR", revision: rv?.numero ?? 0, cab: vista,
        cliente: cliente ? { razon_social: cliente.razon_social, rut: cliente.rut, giro: cliente.giro, direccion: cliente.direccion, comuna: cliente.comuna } : {},
        items: vista.items.map((it) => ({ tipo: it.tipo, codigo: it.codigo, descripcion: descripcionDeFicha(it.ficha), unidad: it.unidad, cantidad: it.cantidad, precio_unitario: it.precio_unitario, descuento_pct: it.descuento_pct })),
        empresa: vp.empresa, responsable: c?.responsable_nombre || perfil?.nombre });
      if (sucio && editable) showToast?.("El PDF incluye cambios aún NO guardados.", "error");
      const r = await generarPdfCotizacion(documento, { logo: await logoBFK(logoUrl) });
      if (verPrimero) setPrevia({ ...r, tipo: "cotizacion" }); else descargarBlob(r.blob, r.nombre);
    } catch (e) { showToast?.(`No se pudo generar el PDF: ${e.message}`, "error"); } finally { setOcupado(""); }
  };

  // ── EETT: el mismo recorrido de Mercado Público (components/cotizaciones/EditorCotizacion.jsx) ──
  //   revisión de fichas → «Vista previa de EETT» (no guarda nada) → «Generar y descargar EETT»: valida → guarda la cotización
  //   (solo si hay cambios) → emite la EETT con los datos recién guardados → la descarga. Si la descarga falla, la EETT ya
  //   emitida se vuelve a descargar con «Reintentar descarga» (no se emite otra). Sin ventana adicional.
  const revEETT = useMemo(() => (vista?.items || []).map(revisionFicha), [vista]);
  // Como en Mercado Público, los avisos «por revisar» se aprueban antes de generar la EETT. En una revisión ya enviada (que no se
  // puede editar) basta con que no haya bloqueos.
  const faltanEETT = cliente || c?.cliente_nombre ? [] : ["cliente"];
  const advEETT = (() => {
    const falta = [["fecha_emision", "fecha de emisión"], ["plazo_entrega", "plazo de entrega"]].filter(([k]) => !String(vista?.[k] || "").trim()).map(([, t]) => t);
    if ((cliente || c) && !String(cliente?.rut || c?.cliente_rut || "").trim()) falta.push("RUT del cliente");
    return falta.length ? [{ tipo: "faltan_datos", mensaje: `Faltan datos del encabezado del PDF: ${falta.join(", ")}. Se omitirán o quedarán en blanco.` }] : [];
  })();
  const eettLista = (vista?.items || []).length > 0 && !faltanEETT.length && revEETT.every((x) => !x.bloqueos.length && (x.aprobado || !editable));
  const nRev = revEETT.filter((x) => !x.aprobado).length;
  const puedeGenerarEETT = (acc.eett || nueva) && viendoActual && esquema !== false;
  const folioEETT = d?.eett?.[0]?.folio || "";
  const lineasEETT = (items) => items.map((it, i) => ({ id: it.key, orden: i + 1, cantidad: Number(it.cantidad), unidad: it.unidad, tipo: it.tipo, producto_id: it.producto_id, descripcion: descripcionDeFicha(it.ficha), ficha: it.ficha }));
  const verPreviaEETT = async () => {
    if (!vista.items.length) return; setOcupado("previa-eett");
    try {
      const rv = c ? d.revisiones.find((r) => r.id === revVista) : null;
      const contenido = contenidoEETTVP({ cotizacion: { folio: c?.folio || "", revision: rv?.numero ?? 0 },
        cliente: { razon_social: cliente?.razon_social || c?.cliente_nombre || "", rut: cliente?.rut || c?.cliente_rut || "" },
        plazo_entrega: vista.plazo_entrega, fecha: hoyISO(), responsable: c?.responsable_nombre || perfil?.nombre || "", elaborado_por: perfil?.nombre || "", items: lineasEETT(vista.items),
        vendedor: vendedorDocumento(vista.vendedor ?? (c ? claveVendedor(c) : ""), { vendedores: vp.vendedores, empresa: vp.empresa, actual: c }) });
      const imagenes = Object.fromEntries(await Promise.all(vista.items.map(async (it) => [it.key, await almacen.resolverImagenes(it.ficha?.imagenes || [], 2)])));
      // Vista previa: no se emite ni se registra nada (el folio de la EETT se muestra si la cotización ya tiene uno).
      setPrevia({ ...(await generarPdfEETTVP({ folio: folioEETT, revision: null, estado: "previa", contenido }, { logo: await logoBFK(logoUrl), imagenes })), tipo: "eett" });
    } catch (e) { showToast?.(`No se pudo preparar la vista previa: ${e.message}${sucio && editable ? " Tus cambios aún NO están guardados: pulsa Guardar antes de generar." : ""}`, "error"); }
    finally { setOcupado(""); }
  };
  // Emite la EETT de la revisión vigente con lo guardado en la base (x = leerCotizacion). Un borrador existente (de la ventana
  // anterior) se completa y emite con el mismo folio y revisión, conservando lo que tenía. Si la última emisión de esta revisión
  // tiene exactamente el mismo contenido, se vuelve a descargar esa emisión (no se emite una revisión idéntica).
  const emitirDesde = async (x) => {
    const t = tokenRef.current; const rv = x.revisiones.find((r) => r.id === x.cab.revision_id);
    const lineas = x.items.filter((i) => i.revision_id === x.cab.revision_id).sort((a, b) => a.orden - b.orden);
    // Estado actual (no el de la pantalla): si un intento anterior quedó sin respuesta y sí se emitió, se reutiliza esa emisión.
    const eett = await listarEETT(t, x.cab.id);
    const borr = eett.find((e) => e.estado === "borrador");
    const ultima = eett.find((e) => e.estado === "emitida" && e.cotizacion_revision_id === x.cab.revision_id);
    const previa = borr || eett.find((e) => e.estado === "emitida") || null;
    const [previo, ult, oc] = await Promise.all([previa ? leerEETT(t, previa.id) : null, ultima ? leerEETT(t, ultima.id) : null, x.cab.venta_id ? ocClienteDeVenta(t, x.cab.venta_id) : null]);
    const contenido = contenidoEETTVP({ cotizacion: { folio: x.cab.folio, revision: rv?.numero ?? x.cab.revision_actual }, cliente: { razon_social: x.cab.cliente_nombre, rut: x.cab.cliente_rut },
      plazo_entrega: rv?.plazo_entrega, fecha: hoyISO(), responsable: x.cab.responsable_nombre || "", elaborado_por: perfil?.nombre || "", oc_cliente: oc, items: lineas, previo: previo?.contenido,
      // Vendedor guardado en la cotización (lo que se emite es lo guardado en la base).
      vendedor: vendedorDocumento(claveVendedor(x.cab), { vendedores: vp.vendedores, empresa: vp.empresa, actual: x.cab }) });
    if (ult && mismoContenidoEETT(ult.contenido, contenido)) return { eett: ult, reutilizada: true };
    const g = await guardarEETT(t, { ...(borr ? { id: borr.id, version: borr.version } : {}), cotizacion_id: x.cab.id, contenido });
    await emitirEETT(t, g.id, g.version);
    return { eett: await leerEETT(t, g.id), reutilizada: false };
  };
  const descargarEmitida = async (e) => {
    const r = await generarPdfEETTVP(e, { logo: await logoBFK(logoUrl), imagenes: await imagenesDe(tokenRef.current, e.contenido) });
    descargarBlob(r.blob, r.nombre);
    return r;
  };
  const etqEETT = (e) => `${e.folio} Rev. ${e.revision}`;
  const pags = (n) => `${n} página${n === 1 ? "" : "s"}`;
  // Generar y descargar: valida → guarda (solo si hay cambios) → emite desde lo guardado → descarga.
  const generarYDescargar = async () => {
    if (!eettLista) { showToast?.("Revisa las fichas pendientes antes de generar la EETT.", "error"); return; }
    if (!puedeGenerarEETT) return;
    setOcupado("generar-eett"); setFalla(null);
    let x = d; let guardada = false;
    try { if (!c || (sucio && editable)) { x = (await guardarInterno()).x; guardada = true; } }
    catch (e) { setOcupado(""); showToast?.(`No se guardó la cotización: ${mensajeVP(e)} No se generó la EETT.`, "error"); if (e.conflicto && c) await abrirConflicto(); return; }
    if (!x) { setOcupado(""); showToast?.("La cotización quedó guardada, pero no se pudo leer de vuelta. No se generó la EETT: vuelve a intentarlo.", "error"); return; }
    let em;
    try { em = await emitirDesde(x); }
    catch (e) { setOcupado(""); showToast?.(`${guardada ? "La cotización quedó guardada, pero no" : "No"} se generó la EETT: ${mensajeVP(e)}${e?.status === 0 ? " Al reintentar, la app comprueba primero si ya quedó emitida (no se emite dos veces)." : ""}`, "error"); await cargar(x.cab.id).catch(() => {}); return; }
    try {
      const r = await descargarEmitida(em.eett);
      showToast?.(em.reutilizada ? `EETT ${etqEETT(em.eett)} descargada (sin cambios desde su emisión): ${pags(r.paginas)}`
        : `${guardada ? "Cotización guardada y " : ""}EETT ${etqEETT(em.eett)} emitida y descargada: ${pags(r.paginas)}`);
    } catch (e) {
      setFalla({ eett: em.eett, mensaje: e.message });
      showToast?.(`La EETT quedó emitida (${etqEETT(em.eett)}), pero la descarga falló: ${e.message}`, "error");
    } finally { setOcupado(""); await cargar(x.cab.id); }
  };
  const reintentar = async () => {
    if (!falla) return; setOcupado("generar-eett");
    try { await descargarEmitida(falla.eett); setFalla(null); showToast?.("EETT descargada"); }
    catch (e) { setFalla({ ...falla, mensaje: e.message }); showToast?.(`La descarga volvió a fallar: ${e.message}`, "error"); } finally { setOcupado(""); }
  };

  // ── Estados, revisiones y duplicar (flujo privado, sin cambios) ──
  const estado = async (est, datos) => {
    setOcupado(est);
    try { await cambiarEstadoCotizacion(tokenRef.current, c.id, est, datos, c.version); showToast?.(`Cotización ${ESTADOS_COTIZACION[est]?.l.toLowerCase() || est}`); setModal(null); await onRecargar?.(); await cargar(c.id); }
    catch (e) { showToast?.(mensajeVP(e), "error"); if (e.conflicto) await cargar(c.id); } finally { setOcupado(""); }
  };
  const registrar = (t) => { if (sucio && editable) { showToast?.("Guarda los cambios antes de registrar el envío.", "error"); return; } setModal({ t }); };
  const revision = async () => {
    setOcupado("revision");
    try { const r = await nuevaRevision(tokenRef.current, c.id, c.version); showToast?.(`Revisión R${r.revision} creada (la anterior se conserva)`); await onRecargar?.(); await cargar(c.id); }
    catch (e) { showToast?.(mensajeVP(e), "error"); } finally { setOcupado(""); }
  };
  const duplicar = async () => {
    if (sucio && editable && !window.confirm("Hay cambios sin guardar: la copia se hará con lo último guardado. ¿Duplicar de todas formas?")) return;
    setOcupado("duplicar");
    try { const r = await duplicarCotizacion(tokenRef.current, c.id); showToast?.(`Cotización duplicada como ${r.folio}`); cerrandoAdrede.current = true; await onRecargar?.(); onAbierta?.(r.id); }
    catch (e) { showToast?.(mensajeVP(e), "error"); } finally { setOcupado(""); }
  };
  const verHistorial = async () => { try { setHistorial(await historialCotizacion(tokenRef.current, c.id)); } catch (e) { showToast?.(mensajeVP(e), "error"); } };
  const cerrar = () => {
    if (sucio && editable && !window.confirm("Hay cambios sin guardar en BFK. ¿Descartarlos y cerrar? Se borrará la copia local de recuperación de esta cotización.")) return;
    cerrandoAdrede.current = true;
    if (usuarioId) borrarBorrador(usuarioLocal(usuarioId), id || "nueva").catch(() => {});
    onCerrar();
  };

  if (err) return <HojaLateral abierta onCerrar={onCerrar} dato="ficha-cotizacion" titulo="Cotización privada"><div style={{ padding: 16 }}><AvisoLinea tono="danger">{err}</AvisoLinea></div></HojaLateral>;
  if (!cot || !calc) return <HojaLateral abierta onCerrar={onCerrar} dato="ficha-cotizacion" titulo="Cotización privada"><div style={{ padding: 16 }}><Vacio>Cargando…</Vacio></div></HojaLateral>;

  const rvVista = c ? d.revisiones.find((r) => r.id === revVista) : null;
  const revAceptada = c ? d.revisiones.find((r) => r.id === c.revision_aceptada_id) : null;
  const margenGuardado = c ? d.margenes.find((x) => x.revision_id === revVista) : null;
  const verInterno = verCostos && (nueva || margenGuardado?.costo != null || esResp);
  const nPend = calc.pendientes.length;
  const ro = !editable;
  const titulo = c ? folioRevision(c.folio, rvVista?.numero ?? c.revision_actual) : "Nueva cotización privada";

  return (
    <HojaLateral abierta onCerrar={cerrar} dato="ficha-cotizacion" titulo={titulo}
      subtitulo={[cliente?.razon_social || c?.cliente_nombre, c ? ESTADOS_COTIZACION[c.estado_efectivo]?.l : "Borrador sin guardar", c?.responsable_nombre, c?.venta_folio ? `venta ${c.venta_folio}` : ""].filter(Boolean).join(" · ")}
      derecha={editable ? <BotonPrincipal data-guardar-cotizacion onClick={guardar} disabled={!!ocupado || esquema === false} style={{ minHeight: 40, padding: "8px 14px", opacity: ocupado || esquema === false ? 0.6 : 1 }}>{ocupado === "guardar" ? "Guardando…" : sucio || !c ? "Guardar •" : "Guardado"}</BotonPrincipal> : null}>
      <div style={{ padding: 16 }} data-editor-cotizacion data-editor-cotizacion-privada>
        {esquema === false && <AvisoLinea tono="danger" dato="esquema-vp-pendiente">Falta instalar la actualización de la base de cotizaciones privadas (fichas técnicas y datos de compra por ítem). Puedes revisar la cotización, pero no se guardará nada hasta que se instale (pendiente de autorización).</AvisoLinea>}
        {recuperable && (
          <AvisoLinea tono="warn" icono="↺" dato={recuperable.desactualizado ? "borrador-desactualizado" : "borrador-recuperado"} accion={recuperable.desactualizado ? "Revisar y combinar" : "Recuperar cambios"} onClick={recuperar}>
            <b>Hay cambios sin guardar de esta cotización en este dispositivo</b> ({fechaHora(recuperable.actualizado)}).{recuperable.desactualizado ? <> Se escribieron sobre la versión {recuperable.versionBase}; en BFK hay una más nueva (versión {recuperable.versionBFK}): no se sobrescribirá, se combinan campo por campo.</> : null} <button type="button" data-descartar-recuperado onClick={descartarRecuperable} style={{ border: "none", background: "none", color: C.tealDark, textDecoration: "underline", cursor: "pointer", padding: 0, fontSize: T.small }}>Descartarlos</button>
          </AvisoLinea>
        )}
        {editable && <div data-estado-guardado={sucio || !c ? "local" : "bfk"} style={{ fontSize: T.small, color: sucio || !c ? C.warnText : C.inkMuted, marginBottom: 6 }}>
          {sucio || !c ? "● Cambios sin guardar en BFK · copia de recuperación solo en este dispositivo" : `✓ Cotización guardada en BFK (versión ${c.version})`}
        </div>}
        {c && <div data-estado-cotizacion={c.estado_efectivo} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
          <BadgeVP mapa={ESTADOS_COTIZACION} k={c.estado_efectivo} />
          {c.estado === "enviada" && c.estado_efectivo === "vencida" && <span style={{ fontSize: T.small, color: C.warnText }}>Vigencia cumplida el {fechaTxt(c.vigencia_hasta)} sin respuesta registrada.</span>}
          {d.revisiones.length > 1 && <select aria-label="Revisión" data-selector-revision value={revVista} onChange={(e) => setRevVista(e.target.value)} style={{ ...selStyle, width: "auto", minHeight: 36 }}>
            {d.revisiones.map((r) => <option key={r.id} value={r.id}>{`R${r.numero} · ${ESTADOS_COTIZACION[r.estado]?.l}${r.id === c.revision_id ? " (actual)" : ""}`}</option>)}
          </select>}
        </div>}
        {c && !viendoActual && <AvisoLinea tono="info" icono="ℹ">Estás viendo una revisión anterior (solo lectura). Se conserva tal como se envió{revAceptada?.id === revVista ? " y es la que respalda la venta" : ""}.</AvisoLinea>}
        {c && viendoActual && !editable && c.estado !== "borrador" && <AvisoLinea tono="info" icono="🔒" dato="cotizacion-protegida">Esta revisión ya fue {ESTADOS_COTIZACION[c.estado]?.l.toLowerCase()}: su contenido no se modifica. Para cambiarla crea una revisión nueva.</AvisoLinea>}
        {c && <Acciones c={c} acc={acc} ocupado={ocupado} onModal={registrar} onRevision={revision} onDuplicar={duplicar} onAbrir={onAbrir} />}

        <Pestanas etiqueta="Cotización" activa={pestana} onCambiar={setPestana} items={[
          { key: "datos", label: "Datos" },
          { key: "productos", label: "Productos", n: vista.items.length || null },
          { key: "precios", label: "Precios", n: verInterno && nPend ? nPend : null, tono: verInterno && nPend ? "warn" : null },
          { key: "eett", label: "EETT", n: nRev || null, tono: nRev ? "warn" : null },
        ]} />
        {(() => {
          const despOk = vista.items.length > 0 && vista.items.every((it) => it.tipo === "servicio" || envioConfirmado(vista.envios.find((e) => e.key === it.envio_key) || {}));
          const preciosOk = vista.items.length > 0 && calc.lineas.every((l) => l.precio_unitario != null);
          const pasos = [["Datos del cliente", !!vista.cliente_id, "datos"], ["Dirección", dirOk, "datos"], ["Productos", vista.items.length > 0, "productos"],
            ...(verInterno ? [["Verificación de despacho", despOk, "productos"]] : []), ["Precios", preciosOk, "precios"], ["EETT", eettLista, "eett"]];
          return <div data-pasos-cotizacion style={{ display: "flex", flexWrap: "wrap", gap: 4, margin: "8px 0 12px", fontSize: T.small }}>
            {pasos.map(([t, ok, tab], i) => <button key={t} type="button" onClick={() => setPestana(tab)} style={{ border: `1px solid ${ok ? C.ok : C.border}`, background: ok ? C.okLight : C.card, color: ok ? C.okText : C.inkMuted, borderRadius: 999, padding: "3px 9px", cursor: "pointer", fontWeight: 600 }}>{ok ? "✓" : i + 1} {t}</button>)}
          </div>;
        })()}

        {/* ── Datos ── */}
        <PanelPestana visible={pestana === "datos"} titulo="Datos">
          <Field label="Cliente" required hint="Registro compartido de clientes (RUT único). La OC del cliente se registra después, al crear la venta: no se necesita para cotizar.">
            <SelectorCliente clientes={vp.clientes} valor={vista.cliente_id} onCambiar={elegirCliente} onNuevo={editable ? () => setNuevoCliente(true) : null} deshabilitado={ro} />
          </Field>
          {cliente && <div data-datos-cliente style={{ fontSize: T.small, color: C.inkMuted, margin: "-6px 0 12px", lineHeight: 1.5 }}>
            Razón social: <b style={{ color: C.ink }}>{cliente.razon_social}</b> · RUT: <b style={{ color: C.ink, fontFamily: MONO }}>{cliente.rut || "Sin RUT"}</b>{cliente.giro ? <> · Giro: {cliente.giro}</> : null}
          </div>}
          <Tarjeta padding="12px" data-bloque-direccion style={{ borderColor: dirOk ? C.ok : C.warn, background: dirOk ? C.card : C.warnLight }}>
            <div style={{ fontSize: T.sm, fontWeight: 700, color: C.ink }}>Dirección de entrega del cliente</div>
            <div style={{ fontSize: T.small, color: dirOk ? C.okText : C.warnText, fontWeight: 600, margin: "2px 0 8px" }}>{dirOk ? "✓ Registrada: los despachos se verifican contra esta dirección." : "Complétala antes de confirmar despachos (los productos se pueden ingresar igual; su despacho quedará «Por verificar»)."}</div>
            <Field label="Dirección de entrega"><input data-campo="direccion" disabled={ro} value={vista.direccion_entrega || ""} maxLength={300} onChange={(e) => setDireccion(e.target.value)} style={iStyle} placeholder="Calle, número, comuna" /></Field>
          </Tarjeta>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 8 }}>
            <Field label="Contacto"><input data-campo="contacto" disabled={ro} value={vista.contacto_nombre || ""} maxLength={150} onChange={(e) => setCampo("contacto_nombre", e.target.value)} style={iStyle} /></Field>
            <Field label="Correo"><input data-campo="correo" type="email" disabled={ro} value={vista.contacto_correo || ""} maxLength={200} onChange={(e) => setCampo("contacto_correo", e.target.value)} style={iStyle} /></Field>
            <Field label="Teléfono"><input data-campo="telefono" disabled={ro} value={vista.contacto_telefono || ""} maxLength={40} onChange={(e) => setCampo("contacto_telefono", e.target.value)} style={iStyle} /></Field>
          </div>
          {"vendedor" in (cot || {}) && vp.finInstalado && <CampoVendedor vp={vp} c={c} valor={vista.vendedor ?? ""} editable={!ro} puedeReasignar={!!c && esResp && (!c.vendedor_tipo || esAdmin)}
            onCambiar={(v) => setCampo("vendedor", v)} onReasignar={async (v) => { try { await asignarVendedor(tokenRef.current, "cotizacion", c.id, v, c.version); showToast?.("Vendedor actualizado"); await onRecargar?.(); await cargar(c.id); } catch (e) { showToast?.(mensajeVP(e), "error"); } }} />}
          <Field label="Responsable" hint="Quien crea la cotización queda como responsable (gestiona: decide costos, envío, aceptación y venta). El vendedor puede ser otra persona o BFK."><input data-campo="responsable" disabled value={c?.responsable_nombre || perfil?.nombre || ""} style={iStyle} /></Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <Field label="Folio"><input data-campo="folio" disabled value={c ? folioRevision(c.folio, rvVista?.numero ?? c.revision_actual) : "Se asigna al guardar"} style={iMono} /></Field>
            <Field label="Fecha de emisión"><input data-campo="emision" type="date" disabled={ro} value={vista.fecha_emision || ""} onChange={(e) => setCampo("fecha_emision", e.target.value)} style={iStyle} /></Field>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <Field label="Vigente hasta" hint={vista.fecha_emision && vista.vigencia_hasta ? `${Math.max(0, Math.round((new Date(vista.vigencia_hasta) - new Date(vista.fecha_emision)) / 86400000))} días de vigencia` : ""}><input data-campo="vigencia" type="date" disabled={ro} value={vista.vigencia_hasta || ""} onChange={(e) => setCampo("vigencia_hasta", e.target.value)} style={iStyle} /></Field>
            <Field label="Plazo de entrega"><input data-campo="plazo" disabled={ro} value={vista.plazo_entrega || ""} maxLength={300} onChange={(e) => setCampo("plazo_entrega", e.target.value)} style={iStyle} placeholder="Ej.: 10 días hábiles desde la aceptación" /></Field>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <Field label="Condiciones de pago"><input data-campo="pago" disabled={ro} value={vista.condiciones_pago || ""} maxLength={500} onChange={(e) => setCampo("condiciones_pago", e.target.value)} style={iStyle} /></Field>
            <Field label="IVA"><select data-campo="iva" disabled={ro} value={vista.afecta_iva === false ? "no" : "si"} onChange={(e) => setCampo("afecta_iva", e.target.value === "si")} style={selStyle}><option value="si">Afecta (19 %)</option><option value="no">Exenta</option></select></Field>
          </div>
          <Field label="Condiciones comerciales"><textarea data-campo="condiciones" rows={3} disabled={ro} value={vista.condiciones_comerciales || ""} maxLength={4000} onChange={(e) => setCampo("condiciones_comerciales", e.target.value)} style={{ ...iStyle, resize: "vertical" }} /></Field>
          <Field label="Observaciones (van en el PDF de la cotización)"><textarea data-campo="observaciones" rows={3} disabled={ro} value={vista.observaciones || ""} maxLength={4000} onChange={(e) => setCampo("observaciones", e.target.value)} style={{ ...iStyle, resize: "vertical" }} /></Field>
          {c && <>
            <Seccion titulo="Respaldos de la cotización">
              <SubirArchivo token={token} ambito="cotizacion" id={c.id} categorias={["aceptacion", "otro"]} habilitado={vp.documentosHabilitados} showToast={showToast} onSubido={() => cargar(c.id)} />
              <ListaDocumentos token={token} documentos={d.documentos} showToast={showToast} onAnular={(doc) => setModal({ t: "anular_doc", doc })} />
            </Seccion>
            <Seccion titulo="Historial" accion={<button type="button" data-ver-historial onClick={verHistorial} style={estiloBoton()}>Ver</button>}>
              {historial && <HistorialLista filas={historial} />}
            </Seccion>
          </>}
        </PanelPestana>

        {/* ── Productos ── */}
        <PanelPestana visible={pestana === "productos"} titulo="Productos">
          {dirOk
            ? <div data-direccion-productos style={{ fontSize: T.small, color: C.inkMuted, marginBottom: 8 }}>Entrega en: <b style={{ color: C.ink }}>{destino}</b>{editable && <> · <button type="button" onClick={() => { setPestana("datos"); setTimeout(() => document.querySelector('[data-editor-cotizacion-privada] [data-campo="direccion"]')?.focus(), 50); }} style={{ border: "none", background: "none", color: C.tealDark, textDecoration: "underline", cursor: "pointer", padding: 0, fontSize: T.small }}>Cambiar</button></>}</div>
            : <AvisoLinea tono="warn" dato="falta-direccion" accion={editable ? "Completar dirección" : undefined} onClick={() => setPestana("datos")}>Falta la dirección de entrega del cliente. Puedes ingresar productos; sus despachos quedarán «Por verificar» hasta completarla.</AvisoLinea>}
          {editable && <Tarjeta padding="12px">
            <BotonPrincipal data-ingreso-manual onClick={() => manual()} style={{ width: "100%", justifyContent: "center", minHeight: 52, fontSize: T.title }}>＋ Ingresar manual</BotonPrincipal>
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <BotonSecundario data-desde-biblioteca onClick={() => setVerBib(true)} style={{ flex: 1, justifyContent: "center" }}>Desde la biblioteca de fichas</BotonSecundario>
            </div>
          </Tarjeta>}
          {!vista.items.length && <div style={{ fontSize: T.sm, color: C.inkFaint, textAlign: "center", padding: 20 }}>{editable ? "Agrega el primer producto o servicio con «Ingresar manual»." : "Sin ítems."}</div>}
          {vista.items.map((it, i) => {
            const l = calc.lineas[i]; const rv = revEETT[i]; const env = vista.envios.find((e) => e.key === it.envio_key);
            const nComp = env ? vista.items.filter((x) => x.envio_key === env.key).length : 0;
            return (
              <Tarjeta key={it.key} padding="10px 12px" data-item-cotizacion={i + 1}>
                <div style={{ display: "flex", gap: 10 }}>
                  <ImagenFicha src={it.ficha.imagenes?.[0]} almacen={almacen} vacio={it.tipo === "servicio" ? "Servicio" : "Sin foto"} style={{ width: 56, height: 56, flexShrink: 0, borderRadius: R.sm, border: `1px solid ${C.border}` }} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: T.sm, fontWeight: 700, color: C.ink, lineHeight: 1.3, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{i + 1}. {it.ficha.nombre || "Sin nombre"}</div>
                    <div data-resumen-item style={{ fontSize: T.small, color: C.inkMuted, marginTop: 3, lineHeight: 1.5 }}>
                      {[it.ficha.marca, it.ficha.modelo].filter(Boolean).length > 0 && <div>{[it.ficha.marca, it.ficha.modelo].filter(Boolean).join(" · ")}</div>}
                      <div>{verInterno && <>Proveedor: <b style={{ color: C.ink }}>{it.proveedor || "—"}</b> · </>}Cantidad: <b style={{ color: C.ink }}>{cantidadTxt(l.cantidad)} {it.unidad}</b>{it.codigo ? <> · Código: <span style={{ fontFamily: MONO }}>{it.codigo}</span></> : null}</div>
                      {verInterno && (Number(it.precio_origen) > 0 || it.precio_origen === 0
                        ? <div>{it.tipo === "servicio" ? "Costo unitario" : "Precio unitario de compra"}: <b style={{ color: C.ink, fontFamily: MONO }}>{m(it.precio_origen)}</b>{it.precio_incluye_iva === false ? " + IVA" : ""}{it.costo_heredado ? " (costo registrado antes de esta versión)" : ""}</div>
                        : <div style={{ color: C.warnText, fontWeight: 600 }}>Falta el precio de compra{editable ? " · toca Editar" : ""}</div>)}
                      {verInterno && it.tipo !== "servicio" && <div data-despacho-item>Despacho: {env ? <><b style={{ color: C.ink, fontFamily: MONO }}>{m(l.envio_asignado)}</b>{nComp > 1 ? ` (parte de ${m(env.monto)} compartido con ${nComp - 1} ítem${nComp > 2 ? "s" : ""})` : ""} · <span style={{ color: envioConfirmado(env) ? C.okText : C.warnText, fontWeight: 600 }}>{ESTADOS_ENVIO[env.estado]?.label}</span></> : <span style={{ color: C.warnText, fontWeight: 600 }}>sin registrar</span>}</div>}
                      {verInterno && <div>Costo de adquisición: <b style={{ color: C.ink, fontFamily: MONO }}>{m(l.costo_bruto)}</b></div>}
                    </div>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
                      {it.tipo === "servicio" && <Badge tono="neutro">Servicio</Badge>}
                      {it.producto_id && <Badge tono="info">Biblioteca</Badge>}
                      {rv.bloqueos.length > 0 && <Badge tono="danger">{rv.bloqueos.length} bloqueo</Badge>}
                      {rv.revisar.length > 0 && <Badge tono={it.ficha_aprobada ? "ok" : "warn"}>{it.ficha_aprobada ? "Ficha aprobada" : `${rv.revisar.length} por revisar`}</Badge>}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
                  {verInterno && (enlaceValido(it.enlace)
                    ? <a data-abrir-publicacion href={it.enlace.trim()} target="_blank" rel="noopener noreferrer" style={{ border: `1px solid ${C.teal}`, color: C.tealDark, borderRadius: 10, padding: "6px 12px", fontWeight: 600, fontSize: T.small, textDecoration: "none", minHeight: 34, display: "inline-flex", alignItems: "center" }}>Abrir publicación ↗</a>
                    : <span data-sin-enlace style={{ fontSize: T.small, color: C.inkFaint }}>Sin enlace registrado{editable && <> · <button type="button" onClick={() => abrirEditar(it)} style={{ border: "none", background: "none", color: C.tealDark, textDecoration: "underline", cursor: "pointer", padding: 0, fontSize: T.small }}>Agregar enlace</button></>}</span>)}
                  <div style={{ flex: 1 }} />
                  {i > 0 && editable && <BotonSecundario aria-label="Subir" onClick={() => mover(i, -1)} style={{ minHeight: 34, padding: "4px 10px" }}>↑</BotonSecundario>}
                  {editable && <BotonSecundario data-quitar-item onClick={() => quitar(it.key)} style={{ minHeight: 34, padding: "4px 10px", color: C.dangerText }}>Quitar</BotonSecundario>}
                  <BotonSecundario data-editar-item onClick={() => abrirEditar(it)} style={{ minHeight: 34, padding: "4px 12px" }}>{editable ? "Editar" : "Ver"}</BotonSecundario>
                </div>
              </Tarjeta>
            );
          })}
        </PanelPestana>

        {/* ── Precios ── */}
        <PanelPestana visible={pestana === "precios"} titulo="Precios">
          {calc.exenta && <AvisoLinea tono="info" icono="⚖️" dato="cotizacion-exenta">Cotización exenta: el IVA de las compras no se recupera (es costo) y la cotización no lleva IVA.</AvisoLinea>}
          {verInterno && <div style={{ fontSize: T.small, color: C.inkMuted, marginBottom: 8 }}>El precio unitario de venta lo defines tú. El recargo sobre costo es una ayuda: al usarlo escribe el precio (costo × (1 + recargo), redondeado hacia arriba). Nada se recalcula solo.</div>}
          {!vista.items.length && <div style={{ fontSize: T.sm, color: C.inkFaint }}>Agrega productos para ver sus precios.</div>}
          {vista.items.map((it, i) => {
            const l = calc.lineas[i];
            return (
              <Tarjeta key={it.key} padding="14px" data-precio-item={i + 1} style={{ borderColor: verInterno && l.avisos.length ? C.warn : C.teal }}>
                <div style={{ fontSize: T.sm, fontWeight: 700, color: C.ink, lineHeight: 1.3 }}>{i + 1}. {it.ficha.nombre || "Ítem"}</div>
                <div style={{ fontSize: T.small, fontWeight: 700, color: C.tealDark, letterSpacing: 0.4, marginTop: 10 }}>{calc.exenta ? "PRECIO UNITARIO EXENTO DE VENTA" : "PRECIO UNITARIO NETO DE VENTA"}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 2 }}>
                  {editable
                    ? <input data-campo={`precio-${i + 1}`} data-precio-unitario={i + 1} type="number" inputMode="decimal" min="0" value={it.precio_unitario ?? ""} onChange={(e) => setItem(it.key, "precio_unitario", e.target.value)} placeholder="0"
                        style={{ ...iMono, fontSize: 26, fontWeight: 700, maxWidth: 240, minHeight: 50 }} />
                    : <span data-unitario={i + 1} style={{ fontSize: 34, fontWeight: 700, color: C.ink, fontFamily: MONO, letterSpacing: -0.5 }}>{l.precio_unitario == null ? "—" : m(l.precio_unitario)}</span>}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                  <label htmlFor={`vp-desc-${it.key}`} style={{ fontSize: T.sm, color: C.inkMuted }}>Descuento (%)</label>
                  <input id={`vp-desc-${it.key}`} data-campo={`descuento-${i + 1}`} type="number" inputMode="decimal" min="0" max="100" disabled={ro} value={it.descuento_pct ?? 0} onChange={(e) => setItem(it.key, "descuento_pct", e.target.value)} style={{ ...iMono, width: 80 }} />
                </div>
                <div style={{ fontSize: T.sm, color: C.inkMuted, marginTop: 6, lineHeight: 1.6 }}>
                  Cantidad: <b style={{ color: C.ink }}>{cantidadTxt(l.cantidad)} {it.unidad}</b> · {calc.exenta ? "Subtotal exento" : "Subtotal neto"}: <b data-subtotal={i + 1} style={{ color: C.ink, fontFamily: MONO }}>{m(l.neto)}</b>{l.descuento ? <> (descuento {m(l.descuento)})</> : null}
                </div>
                {verInterno && <div data-costo-item={i + 1} style={{ fontSize: T.sm, color: C.inkMuted, marginTop: 6, paddingTop: 8, borderTop: `1px solid ${C.border}`, lineHeight: 1.6 }}>
                  {l.costo_unitario == null ? <span style={{ color: C.warnText, fontWeight: 600 }}>Sin costo: falta el precio de compra (el margen de esta línea no se calcula).</span>
                    : <>Costo unitario (compra{it.tipo !== "servicio" ? " + despacho" : ""}, {calc.exenta ? "con IVA no recuperable" : "neto"}): <b data-costo-unitario={i + 1} style={{ color: C.ink, fontFamily: MONO }}>{m(l.costo_unitario)}</b> · Utilidad de la línea: <b style={{ color: l.utilidad >= 0 ? C.okText : C.dangerText, fontFamily: MONO }}>{m(l.utilidad)}</b></>}
                  <div data-recargo-producto={i + 1} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                    <label htmlFor={`vp-recargo-${it.key}`} style={{ fontSize: T.sm, color: C.inkMuted, flex: "1 1 160px" }}>Recargo sobre costo (%)</label>
                    <CampoPorcentaje id={`vp-recargo-${it.key}`} dato={`recargo-producto-${i + 1}`} disabled={ro || l.costo_unitario == null} valor={l.recargo == null ? "" : l.recargo} onCambiar={(v) => aplicarRecargoItem(i, v)} />
                    <span style={{ fontSize: T.sm }}>%</span>
                  </div>
                </div>}
                {verInterno && l.avisos.map((a, j) => <AvisoLinea key={j} tono="warn" dato="pendiente-precio">{a}</AvisoLinea>)}
              </Tarjeta>
            );
          })}

          {vista.items.length > 0 && (
            <Tarjeta padding="12px 14px" data-totales-cotizacion>
              <div data-resumen="totales">
                {verInterno && <FilaDato k="Costo total de adquisición (productos + despachos)" v={m(calc.totales.costo_bruto)} dato="costo-adquisicion" />}
                {verInterno && editable && <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "8px 0", borderBottom: `1px solid ${C.border}` }}>
                  <label htmlFor="vp-recargo-todos" style={{ fontSize: T.sm, color: C.inkMuted, flex: 1 }}>Recargo sobre costo <span style={{ fontSize: T.small }}>(escribe el precio de todos los ítems con costo)</span></label>
                  <CampoPorcentaje id="vp-recargo-todos" dato="recargo" valor={recargoTodos} onCambiar={setRecargoTodos} />
                  <span style={{ fontSize: T.sm }}>%</span>
                  <BotonSecundario data-aplicar-recargo onClick={aplicarRecargoTodos} disabled={recargoTodos === "" || !calc.lineas.some((l) => l.costo_unitario != null)} style={{ minHeight: 34 }}>Aplicar a todos</BotonSecundario>
                </div>}
                <FilaDato k="Subtotal" v={m(calc.totales.bruto)} dato="bruto" />
                {calc.totales.descuento > 0 && <FilaDato k="Descuentos" v={`− ${m(calc.totales.descuento)}`} dato="descuento" />}
                <FilaDato k={calc.exenta ? "Total exento" : "Total neto"} v={m(calc.totales.neto)} fuerte dato="neto" />
                <FilaDato k={calc.exenta ? "IVA (exenta)" : "IVA (19 %)"} v={m(calc.totales.iva)} dato="iva" />
                <FilaDato k="Total de la cotización" v={m(calc.totales.total)} fuerte dato="total" />
                {verInterno && <div data-margen-interno style={{ background: "#FFFBF0", borderRadius: R.sm, padding: "2px 8px", marginTop: 6 }}>
                  <FilaDato k={`Costo estimado${calc.totales.sinCosto ? ` (${calc.totales.sinCosto} ítem${calc.totales.sinCosto === 1 ? "" : "s"} sin costo)` : ""}`} v={m(calc.totales.costo)} dato="costo" />
                  <FilaDato k="Utilidad estimada (interna)" v={m(calc.totales.utilidad)} tono={calc.totales.utilidad >= 0 ? "ok" : "danger"} fuerte dato="utilidad" />
                  <FilaDato k="Margen sobre la venta neta" v={calc.totales.margen == null ? "—" : pctTxt(calc.totales.margen)} dato="margen" />
                  <div style={{ fontSize: T.small, color: C.inkFaint, padding: "4px 0" }}>Costos, utilidad y margen son internos: no aparecen en el PDF ni en la EETT.</div>
                </div>}
                {!verInterno && c && <div style={{ fontSize: T.small, color: C.inkFaint, marginTop: 6 }}>Costos y márgenes: visibles solo para el responsable y los administradores.</div>}
              </div>
            </Tarjeta>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
            <BotonSecundario data-ver-cotizacion onClick={() => pdf(true)} disabled={!vista.items.length || !!ocupado} style={{ flex: "1 1 160px", justifyContent: "center", minHeight: 48 }}>{ocupado === "ver" ? "Preparando…" : "Vista previa de la cotización"}</BotonSecundario>
            <BotonPrincipal data-pdf-cotizacion onClick={() => pdf(false)} disabled={!vista.items.length || !!ocupado} style={{ flex: "2 1 220px", justifyContent: "center", minHeight: 48, opacity: !vista.items.length || ocupado ? 0.55 : 1 }}>{ocupado === "pdf" ? "Generando…" : "Descargar PDF de la cotización"}</BotonPrincipal>
          </div>
          <div style={{ fontSize: T.small, color: C.inkFaint, marginTop: 6 }}>El PDF para el cliente no incluye costos, proveedores, enlaces, despachos ni márgenes. Verlo o descargarlo no la marca como enviada: el envío se registra con «Registrar envío».</div>
        </PanelPestana>

        {/* ── EETT (mismo recorrido de Mercado Público) ── */}
        <PanelPestana visible={pestana === "eett"} titulo="EETT">
          <AvisoLinea tono="info" icono="🔒">El PDF contiene solo información técnica: nunca precios, despachos, enlaces, proveedores, recargos, ganancias ni IVA. Se descarga en este dispositivo; la EETT queda registrada con folio y revisión para vincularla a la venta.</AvisoLinea>
          {faltanEETT.length > 0 && <AvisoLinea tono="warn" dato="faltan-datos" accion="Completar" onClick={() => setPestana("datos")}>Falta: {faltanEETT.join(" y ")}.</AvisoLinea>}
          {advEETT.map((a, i) => <AvisoLinea key={i} tono="warn" icono="⚠" dato={`eett-advertencia-${a.tipo}`} accion="Revisar datos" onClick={() => setPestana("datos")}>{a.mensaje}</AvisoLinea>)}
          {advEETT.length > 0 && <div data-eett-advertencias-nota style={{ fontSize: T.small, color: C.inkMuted, marginBottom: 6 }}>Estas advertencias son para revisión manual: no bloquean la generación del PDF.</div>}
          {!vista.items.length && <div style={{ fontSize: T.sm, color: C.inkFaint }}>Agrega productos para generar la EETT.</div>}
          {revEETT.map((p, i) => {
            const it = vista.items[i];
            return (
              <Tarjeta key={it.key} padding="10px 12px" data-revision-eett={i + 1}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                  <div style={{ fontSize: T.sm, fontWeight: 700, color: C.ink, minWidth: 0 }}>Ficha {i + 1}: {it.ficha.nombre || "Sin nombre"}</div>
                  <Badge tono={p.bloqueos.length ? "danger" : p.aprobado ? "ok" : "warn"}>{p.bloqueos.length ? "Bloqueada" : p.aprobado ? "Lista" : "Revisar"}</Badge>
                </div>
                {p.avisos.map((a, j) => <div key={j} style={{ fontSize: T.small, color: a.nivel === "bloqueo" ? C.dangerText : C.warnText, marginTop: 4 }}>• {a.mensaje}</div>)}
                {p.revisar.length > 0 && !p.bloqueos.length && (
                  <label data-aprobar-ficha style={{ display: "flex", alignItems: "center", gap: 8, fontSize: T.sm, marginTop: 8, minHeight: 36, fontWeight: 600 }}>
                    <input type="checkbox" disabled={ro} checked={!!it.ficha_aprobada} onChange={(e) => cambiar((x) => { x.items[i].ficha_aprobada = e.target.checked; return x; })} />
                    Revisé estos avisos y apruebo la ficha tal como está
                  </label>
                )}
                <div style={{ marginTop: 6 }}><button type="button" onClick={() => abrirEditar(it)} style={{ border: "none", background: "none", color: C.tealDark, textDecoration: "underline", cursor: "pointer", fontSize: T.small, padding: 0, minHeight: 30 }}>{editable ? "Corregir ficha" : "Ver ficha"}</button></div>
              </Tarjeta>
            );
          })}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
            <BotonSecundario data-vista-previa-eett onClick={verPreviaEETT} disabled={!vista.items.length || !!ocupado} style={{ flex: "1 1 160px", justifyContent: "center", minHeight: 48 }}>{ocupado === "previa-eett" ? "Preparando…" : "Vista previa de EETT"}</BotonSecundario>
            {(acc.eett || nueva) && <BotonPrincipal data-generar-eett onClick={generarYDescargar} disabled={!eettLista || !puedeGenerarEETT || !!ocupado} style={{ flex: "2 1 220px", justifyContent: "center", minHeight: 48, opacity: !eettLista || !puedeGenerarEETT || ocupado ? 0.55 : 1 }}>{ocupado === "generar-eett" ? "Guardando y generando…" : "Generar y descargar EETT"}</BotonPrincipal>}
          </div>
          {!viendoActual && <div data-eett-revision-anterior style={{ fontSize: T.small, color: C.warnText, marginTop: 6 }}>Estás viendo una revisión anterior: la vista previa usa esta revisión, pero la EETT se genera desde la revisión vigente.</div>}
          <div style={{ fontSize: T.small, color: C.inkFaint, marginTop: 6 }}>Al generar, la cotización se guarda automáticamente (solo si hay cambios) y el PDF se crea con los datos recién guardados. La vista previa no guarda nada.</div>
          {falla && <AvisoLinea tono="danger" dato="falla-descarga" accion="Reintentar descarga" onClick={reintentar}>La EETT quedó emitida ({etqEETT(falla.eett)}), pero la descarga falló: {falla.mensaje}</AvisoLinea>}
          {c && d.eett.length > 0 && (
            <Seccion titulo="EETT generadas" nota="Cada generación queda emitida y congelada con su folio y revisión; si la cotización cambia, la siguiente generación emite una revisión nueva.">
              {d.eett.map((e) => (
                <div key={e.id} data-eett={`${e.folio}-R${e.revision}`} data-eett-generado={e.estado !== "borrador" ? "" : undefined} style={{ fontSize: T.small, color: C.inkMuted, padding: "6px 0", borderBottom: `1px solid ${C.border}`, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ fontFamily: MONO, fontWeight: 700, color: C.ink }}>{etqEETT(e)}</span>
                  <Badge tono={e.estado === "emitida" ? "ok" : e.estado === "borrador" ? "warn" : "neutro"}>{e.estado === "emitida" ? "Emitida" : e.estado === "borrador" ? "Borrador" : "Reemplazada"}</Badge>
                  <span style={{ flex: 1, minWidth: 140 }}>{e.estado === "borrador" ? "Sin emitir: se completa y emite con «Generar y descargar EETT» (conserva su folio y su contenido)."
                    : `Cotización R${d.revisiones.find((r) => r.id === e.cotizacion_revision_id)?.numero ?? "?"}${e.emitida_en ? ` · ${fechaHora(e.emitida_en)}` : ""}`}</span>
                  {e.estado !== "borrador" && <button type="button" data-descargar-eett onClick={() => descargarEETT(token, e.id, vp.empresa, showToast)} style={estiloBoton()}>PDF</button>}
                </div>
              ))}
            </Seccion>
          )}
        </PanelPestana>
      </div>

      {editor && <EditorFicha key={editor.item.key} vp soloLectura={ro} inicial={editor.item} esNuevo={editor.esNuevo} envios={vista.envios} items={vista.items} destino={destino} destinoValido={dirOk}
        almacen={almacen} token={token} onGuardar={guardarItem} onCerrar={() => setEditor(null)} modo={verInterno ? "item" : "biblioteca"} />}
      {verBib && <SelectorBiblioteca almacen={almacen} onElegir={desdeBiblioteca} onCerrar={() => setVerBib(false)} />}
      {conflicto && <ConflictoVersion version={conflicto.x2.cab.version} campos={conflicto.campos} nota={conflicto.nota} bloqueado={!!conflicto.nota}
        onCombinar={combinarConflicto} onDescartarMios={descartarConflicto} onCancelar={() => setConflicto(null)} />}
      {previa?.tipo === "eett" && <VistaPreviaEETT blob={previa.blob} nombre={previa.nombre} paginas={previa.paginas}
        onCerrar={() => setPrevia(null)} onDescargar={eettLista && puedeGenerarEETT ? () => { setPrevia(null); generarYDescargar(); } : null} />}
      {previa?.tipo === "cotizacion" && <VistaPreviaEETT blob={previa.blob} nombre={previa.nombre} paginas={previa.paginas} titulo="Vista previa de la cotización"
        aviso="Vista previa: es el mismo PDF que se descarga. Verla o descargarla no la marca como enviada ni aceptada."
        onCerrar={() => setPrevia(null)} onDescargar={() => { descargarBlob(previa.blob, previa.nombre); setPrevia(null); }} />}
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
        ocupado={!!ocupado} onCancelar={() => setModal(null)} onConfirmar={(mo) => estado("borrador", { motivo: mo })} />}
      {modal?.t === "venta" && <CrearVentaDesdeCotizacion token={token} cot={c} vp={vp} showToast={showToast} onCerrar={() => setModal(null)}
        onCreada={async (v) => { setModal(null); cerrandoAdrede.current = true; await onRecargar?.(); onAbrir?.("vp_ordenes", v.id); }} />}
      {modal?.t === "anular_doc" && <PedirMotivo titulo="Anular archivo" texto="El archivo se conserva en el registro, marcado como anulado." etiquetaBoton="Anular" peligro onCancelar={() => setModal(null)}
        onConfirmar={async (mo) => { try { await anular(tokenRef.current, "documento", modal.doc.id, mo); setModal(null); await cargar(c.id); } catch (e) { showToast?.(mensajeVP(e), "error"); } }} />}
      {nuevoCliente && <FormCliente token={token} clientes={vp.clientes} showToast={showToast} onCerrar={() => setNuevoCliente(false)}
        onGuardado={async (cid) => { setNuevoCliente(false); await onRecargar?.(); elegirCliente(cid); }} />}
    </HojaLateral>
  );
}

function Acciones({ c, acc, ocupado, onModal, onRevision, onDuplicar, onAbrir }) {
  const b = (k, txt, fn, tipo = "sec", dato) => <button key={k} type="button" data-accion-cot={dato || k} disabled={!!ocupado} onClick={fn} style={{ ...estiloBoton(tipo), opacity: ocupado ? 0.6 : 1 }}>{ocupado === k ? "…" : txt}</button>;
  return (
    <div data-acciones-cotizacion style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
      {acc.enviar && b("enviada", "Registrar envío", () => onModal("enviada"), "pri")}
      {acc.aceptar && b("aceptada", "Registrar aceptación", () => onModal("aceptada"), "pri")}
      {acc.rechazar && b("rechazada", "Registrar rechazo", () => onModal("rechazada"), "peligro")}
      {acc.vencer && b("vencida", "Marcar vencida", () => onModal("vencida"))}
      {acc.crearVenta && b("venta", "Crear venta / Registrar OC", () => onModal("venta"), "pri", "crear-venta")}
      {acc.verVenta && b("verventa", `Ver venta ${c.venta_folio}`, () => onAbrir?.("vp_ordenes", c.venta_id))}
      {acc.nuevaRevision && b("revision", "Nueva revisión", onRevision)}
      {acc.volverBorrador && b("borrador", "Devolver a borrador", () => onModal("borrador"))}
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

// Vendedor de la cotización (11/11/2026): BFK (la empresa, sin cuenta de acceso ni comisión personal) o un vendedor del catálogo.
// En borrador se guarda con la cotización; en una cotización ya enviada se asigna aparte (si ya tenía vendedor, solo un
// administrador lo cambia). Al convertirla en venta, la venta conserva este vendedor.
function CampoVendedor({ vp, c, valor, editable, puedeReasignar, onCambiar, onReasignar }) {
  const [v, setV] = useState(valor); const [ocupado, setOcupado] = useState(false);
  useEffect(() => { setV(valor); }, [valor]);
  const op = opcionesVendedor(vp.vendedores, c || null);
  const hint = valor === "bfk" ? "Venta de BFK: no se atribuye a una persona ni genera comisión personal." : "A quién se atribuye la venta en los indicadores.";
  if (editable) return <Field label="Vendedor" hint={hint}><select data-campo="vendedor" value={valor} onChange={(e) => onCambiar(e.target.value)} style={selStyle}><option value="">Sin vendedor asignado</option>{op.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}</select></Field>;
  return (
    <Field label="Vendedor" hint={puedeReasignar ? hint : `${hint} Ya enviada: solo un administrador cambia un vendedor asignado.`}>
      <div style={{ display: "flex", gap: 6 }}>
        <select data-campo="vendedor" disabled={!puedeReasignar} value={v} onChange={(e) => setV(e.target.value)} style={{ ...selStyle, flex: 1 }}><option value="">{c ? nombreVendedor({}) : "Sin vendedor asignado"}</option>{op.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}</select>
        {puedeReasignar && v !== valor && <button type="button" data-guardar-vendedor-cot disabled={ocupado} onClick={async () => { setOcupado(true); await onReasignar(v); setOcupado(false); }} style={{ minHeight: 40, padding: "0 12px", borderRadius: 8, border: "none", background: "#0B1120", color: "#fff", fontWeight: 700, cursor: "pointer" }}>{ocupado ? "…" : "Guardar"}</button>}
      </div>
    </Field>
  );
}
