import { useState, useEffect, useMemo, useRef } from "react";
import { Field } from "../ui/Basicos";
import { C, MONO, SANS, btnP, btnG, fmt, iStyle, iMono, selStyle } from "../../lib/theme";
import { Ic } from "../ui/Iconos";
import { entidadPorRut } from "../../lib/rut";
import { estadoMP, mensajeDuplicado, resultadoConsultaMP } from "../../lib/ocs";
import { SelectorCotizacionOC, ResumenCotizacionOC } from "./CotizacionNuevaOC";
import { CompraDesdeCotizacion } from "./CompraDesdeCotizacion";
import { enlacesParaProductos } from "../../lib/nuevaOCCotizacion";
import { nuevoPedido } from "../../lib/compraCotizacion";

// ── Heurística para sacar la dirección de entrega del texto del producto ──
// Cuando TipoDespacho = 12 ("ver instrucciones"), Mercado Público mete la
// dirección dentro de la descripción del ítem. Buscamos el patrón y lo
// proponemos; Mati confirma o corrige.
const PISTAS = [
  /despacho\s+a\s+([^.]+)/i,
  /entrega(?:r)?\s+en\s+([^.]+)/i,
  /incluir\s+despacho\s+a\s+([^.]+)/i,
  /dirigid[oa]\s+a\s+([^.]+)/i,
  /direcci[oó]n[:\s]+([^.]+)/i,
];
function extraerDireccion(texto) {
  if (!texto) return "";
  for (const re of PISTAS) {
    const m = texto.match(re);
    if (m && m[1]) {
      return m[1].replace(/\s+/g, " ").replace(/[-–—]+$/, "").trim().slice(0, 200);
    }
  }
  return "";
}

// 03/11/2026: «Nueva OC» centraliza la importación desde Mercado Público, la asociación con la cotización BFK (sugerida,
// nunca automática) y, si el usuario confirma que compró, el registro de la compra real con la lógica existente.
// Sin las funciones de cotización (props) se comporta como antes.
export function NuevaOCRapida({ perfil, vendedores, entidadesCatalogo, codigoInicial, onGuardar, onCerrar, buscarDuplicado,
  financiadores = [], onCandidatasCotizacion, onBuscarCotizacionTexto, onCargarCotizacion, onGuardarConCotizacion }) {
  const [paso, setPaso] = useState(1);
  const [codigo, setCodigo] = useState(codigoInicial || "");
  const [cargando, setCargando] = useState(false);
  const [err, setErr] = useState("");
  const [datos, setDatos] = useState(null);     // respuesta normalizada de la API
  const [pendiente, setPendiente] = useState(false); // true = Mercado Público aún no la tiene (404)
  const [confirmaCancelada, setConfirmaCancelada] = useState(false); // cargar igual una OC cancelada en MP

  // Campos que Mati puede completar o corregir
  const [links, setLinks] = useState([""]);
  const [direccion, setDireccion] = useState("");
  const [correo, setCorreo] = useState("");
  const [vendedorId, setVendedorId] = useState(perfil?.vendedor_id || "");
  const [ventaPropia, setVentaPropia] = useState(false);
  const [guardando, setGuardando] = useState(false);
  // Cotización BFK y compra (solo si la OC trae datos de Mercado Público)
  const conCotizaciones = !!(onCandidatasCotizacion && onCargarCotizacion && onGuardarConCotizacion);
  const [cotSel, setCotSel] = useState(null);          // { fila, cot, base, eleg }
  const [sinCot, setSinCot] = useState(false);
  const [modo, setModo] = useState("solo_oc");         // solo_oc | con_compra
  const ocCreada = useRef(null);                       // id de la OC ya creada en este formulario (reintentos sin duplicar)
  const pedidoNuevaOC = useRef(nuevoPedido());         // marca de la compra: la misma en cada reintento (no se duplica)
  const [avisoParcial, setAvisoParcial] = useState("");

  const buscar = async (codigoForzado) => {
    // Fase 4A: el botón entregaba el evento del clic como "código" y la búsqueda fallaba en silencio
    // (solo funcionaba con Enter). Ahora solo se acepta un texto.
    const cod = String(typeof codigoForzado === "string" ? codigoForzado : codigo).trim().toUpperCase();
    if (!cod) { setErr("Ingresa el código de la OC"); return; }
    setErr(""); setCargando(true); setDatos(null); setPendiente(false); setConfirmaCancelada(false);
    setCotSel(null); setSinCot(false); setModo("solo_oc"); setAvisoParcial(""); ocCreada.current = null; pedidoNuevaOC.current = nuevoPedido(); linksAuto.current = [];
    // Antes de consultar: ¿ya existe (activa o archivada)? Misma clave que el índice único de la base.
    const dup = buscarDuplicado ? buscarDuplicado(cod) : null;
    if (dup) { setErr(mensajeDuplicado(dup)); setCargando(false); return; }
    try {
      const r = await fetch(`/api/oc?codigo=${encodeURIComponent(cod)}`);
      const j = await r.json().catch(() => null);
      const res = resultadoConsultaMP(r.status, j);

      if (res.tipo === "ok") {
        const oc = res.oc;
        setDatos(oc);
        // Correo: primero el del catálogo por RUT, si existe
        const enCatalogo = entidadPorRut(entidadesCatalogo, oc.rut_cliente).entidad;
        setCorreo(oc.correo_cliente || enCatalogo?.correo || "");
        // Dirección: la del comprador, o la que venga en el texto del producto
        const textoItems = (oc.productos || []).map(p => p.descripcion).join(" ");
        setDireccion(oc.direccion || extraerDireccion(textoItems) || "");
        setPaso(2);
      } else if (res.tipo === "no_disponible") {
        // Mercado Público respondió que no tiene esa OC: aún no publicada/aceptada, o código mal escrito.
        setPendiente(true);
        setDatos({ numero_oc: cod, productos: [] });
        setPaso(2);
      } else {
        setErr(res.mensaje);
      }
    } catch (e) {
      setErr("Sin conexión con el servicio. Intenta de nuevo.");
    } finally {
      setCargando(false);
    }
  };

  // Si llega un código prefijado (desde el aviso de "OCs aceptadas sin cargar"),
  // saltamos directo a buscarlo — Mati no tiene que volver a escribirlo.
  useEffect(() => {
    if (codigoInicial) { setCodigo(codigoInicial); buscar(codigoInicial); }
  }, [codigoInicial]);

  // Validaciones de la OC (comunes a «solo OC» y «OC + compra»). Devuelve el mensaje o "".
  const validarOC = () => {
    if (!links.some(l => l.trim())) return "Agrega al menos un link de producto";
    if (!pendiente && estadoMP(datos?.codigo_estado).tipo === "cancelada" && !confirmaCancelada)
      return "Esta OC figura cancelada en Mercado Público. Marca la casilla si de todas formas quieres cargarla.";
    return "";
  };
  const datosOC = () => ({
    pendienteSync: pendiente,
    oc: datos,
    // Un enlace por producto vendido (alineados por posición; vacíos quedan «sin-link» en ese producto).
    links: cotSel ? links.map(l => l.trim()) : links.map(l => l.trim()).filter(Boolean),
    direccion_entrega: direccion.trim(),
    correo_cliente: correo.trim(),
    vendedorId: vendedorId || null,
    ventaPropia: !!(vendedorId && ventaPropia),
  });
  // Con cotización: crea la OC (una sola vez), vincula la cotización y, si corresponde, registra la compra.
  const guardarConCotizacion = (compra) => onGuardarConCotizacion({
    datos: datosOC(), cotizacion: { id: cotSel.cot.id, codigo: cotSel.base.codigo }, compra,
    ocIdCreada: ocCreada.current, onOCCreada: (id) => { ocCreada.current = id; setAvisoParcial(`La OC ${datos.numero_oc} ya quedó creada: un reintento no la vuelve a crear.`); },
  });

  const guardar = async () => {
    const v = validarOC(); if (v) { setErr(v); return; }
    setErr(""); setGuardando(true);
    try {
      if (cotSel) await guardarConCotizacion(null);
      else await onGuardar(datosOC());
    } catch (e) {
      setErr(e.message); setGuardando(false);
    }
  };
  // «Guardar OC y registrar compra»: CompraDesdeCotizacion valida la compra y llama aquí.
  const guardarConCompra = async (compra) => {
    const v = validarOC(); if (v) throw Object.assign(new Error(v), { validacion: true });
    setErr("");
    await guardarConCotizacion(compra);
  };
  // Enlaces de la cotización: no se vuelven a escribir. Se completan los vacíos y los que vinieron de otra cotización
  // (al cambiarla o quitarla); lo que el usuario escribió se conserva.
  const linksAuto = useRef([]);
  const elegirCotizacion = (sel) => {
    setCotSel(sel); setErr("");
    if (!sel) setModo("solo_oc");
    const prev = linksAuto.current;
    const propio = (v, i) => !!String(v || "").trim() && v !== prev[i];
    const enl = sel ? enlacesParaProductos(datos?.productos, sel.base.lineas) : [];
    linksAuto.current = enl;
    setLinks(ls => {
      const r = Array.from({ length: Math.max(ls.length, enl.length) }, (_, i) => (propio(ls[i], i) ? ls[i] : (enl[i] || "")));
      const f = sel && enl.length ? r : r.filter(x => x.trim());
      return f.length ? f : [""];
    });
  };
  const ocVirtual = useMemo(() => datos ? ({ id: ocCreada.current, numero_oc: datos.numero_oc, monto_total: Number(datos.monto_total) || 0,
    eventos_compra: [], oc_productos_link: [], financiador_id: null, es_venta_propia: !!(vendedorId && ventaPropia) }) : null,
    [datos, vendedorId, ventaPropia]); // eslint-disable-line react-hooks/exhaustive-deps

  const Dato = ({ label, valor, alerta }) => (
    <div style={{ marginBottom: 7 }}>
      <div style={{ fontSize: 12, color: C.inkMuted, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3 }}>{label}</div>
      <div style={{ fontSize: 13, color: alerta ? C.warn : C.ink, fontWeight: alerta ? 700 : 500 }}>{valor || "—"}</div>
    </div>
  );

  // ─────────────────────────────── PASO 1: el código
  if (paso === 1) {
    return (
      <div style={{ fontFamily: SANS }}>
        <div style={{ background: C.tealLight, borderRadius: 12, padding: "12px 14px", marginBottom: 16 }}>
          <div style={{ fontSize: 13, color: C.tealDark, fontWeight: 700, marginBottom: 4 }}>Solo necesitas el código</div>
          <div style={{ fontSize: 12, color: C.inkMuted, lineHeight: 1.5 }}>
            La app trae sola el cliente, los productos, cantidades y montos desde Mercado Público.
          </div>
        </div>

        <Field label="Vendedor" hint="Quién trajo esta venta">
          <select style={selStyle} value={vendedorId} onChange={e => { setVendedorId(e.target.value); if (!e.target.value) setVentaPropia(false); }}>
            <option value="">Sin definir</option>
            {(vendedores || []).map(v => (
              <option key={v.id} value={v.id}>{v.nombre}</option>
            ))}
          </select>
          {!vendedorId && (
            <div data-aviso="sin-vendedor" style={{ fontSize: 12, color: C.warnText, fontWeight: 600, marginTop: 5 }}>
              <Ic n="⚠"/> Sin vendedor: esta OC no entrará en ninguna comisión hasta que se le asigne uno.
            </div>
          )}
        </Field>

        {vendedorId&&(
          <label style={{display:"flex",alignItems:"flex-start",gap:9,marginBottom:14,cursor:"pointer",
            background:C.paper,borderRadius:12,padding:"10px 12px"}}>
            <input type="checkbox" checked={ventaPropia} onChange={e=>setVentaPropia(e.target.checked)}
              style={{marginTop:2,width:16,height:16,flexShrink:0}} />
            <span>
              <span style={{display:"block",fontSize:13,fontWeight:700,color:C.ink}}>Es venta propia del vendedor</span>
              <span style={{display:"block",fontSize:12,color:C.inkFaint,marginTop:1}}>Se lleva el 100% de la utilidad (menos el IVA de su propia factura), en vez del 50% general</span>
            </span>
          </label>
        )}

        <Field label="Código de la OC" required hint="Tal como aparece en Mercado Público">
          <input style={iMono} value={codigo} autoFocus
            onChange={e => { setCodigo(e.target.value); setErr(""); }}
            onKeyDown={e => e.key === "Enter" && buscar()}
            placeholder="ej: 3013-587-AG26" />
        </Field>

        {err && <div style={{ background: C.dangerLight, color:C.dangerText, borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 10, fontWeight: 600 }}>{err}</div>}

        <button onClick={() => buscar()} disabled={cargando} style={btnP(cargando ? C.inkFaint : C.teal)}>
          {cargando ? "Consultando Mercado Público…" : "Buscar OC →"}
        </button>
      </div>
    );
  }

  // ─────────────────────────────── PASO 2: revisar y completar
  const oc = datos || {};
  const necesitaDireccion = oc.tipo_despacho_codigo === "12" || oc.tipo_despacho_codigo === "7";
  const esClienteNuevo = !entidadPorRut(entidadesCatalogo, oc.rut_cliente).entidad;

  return (
    <div style={{ fontFamily: SANS }}>
      {pendiente ? (
        <div data-estado-mp="no_disponible" style={{ background: C.warnLight, border: `1px solid ${C.warn}`, borderRadius: 12, padding: "12px 14px", marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color:C.warnText, marginBottom: 4 }}><Ic n="⏳"/> Todavía no disponible en Mercado Público</div>
          <div style={{ fontSize: 12, color: C.inkMuted, lineHeight: 1.5 }}>
            Mercado Público respondió que no tiene esta OC: puede que aún no esté publicada o aceptada,
            o que el código tenga un error (revísalo). Si el código es correcto, guárdala igual con el link:
            la app completará el cliente, los productos y los montos cuando la OC aparezca.
          </div>
        </div>
      ) : (() => {
        const est = estadoMP(oc.codigo_estado);
        if (est.tipo === "cancelada") return (
          <div data-estado-mp="cancelada" style={{ background: C.dangerLight, border: `1px solid ${C.danger}`, borderRadius: 12, padding: "12px 14px", marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: C.dangerText, marginBottom: 4 }}><Ic n="⚠"/> Cancelada en Mercado Público</div>
            <div style={{ fontSize: 12, color: C.inkMuted, lineHeight: 1.5, marginBottom: 8 }}>
              El comprador canceló esta OC. Normalmente no se carga: no se debe comprar ni facturar.
            </div>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 7, cursor: "pointer" }}>
              <input type="checkbox" checked={confirmaCancelada} onChange={e => { setConfirmaCancelada(e.target.checked); setErr(""); }} style={{ marginTop: 2 }} />
              <span style={{ fontSize: 12, color: C.ink, fontWeight: 600 }}>Entiendo que está cancelada y quiero cargarla igual</span>
            </label>
          </div>
        );
        if (est.tipo === "sin_aceptar") return (
          <div data-estado-mp="sin_aceptar" style={{ background: C.warnLight, border: `1px solid ${C.warn}`, borderRadius: 12, padding: "12px 14px", marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: C.warnText, marginBottom: 4 }}><Ic n="⏳"/> {est.texto}</div>
            <div style={{ fontSize: 12, color: C.inkMuted, lineHeight: 1.5 }}>
              Los datos ya vienen de Mercado Público, pero la OC sigue sin aceptar. Acéptala en el portal antes de comprar.
            </div>
          </div>
        );
        return (
          <div data-estado-mp={est.tipo} style={{ background: C.okLight, borderRadius: 12, padding: "10px 14px", marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color:C.okText }}>✓ Datos traídos de Mercado Público · {est.texto}</div>
          </div>
        );
      })()}

      {/* Resumen de lo que trajo la API */}
      <div style={{ background: C.paper, borderRadius: 12, padding: "12px 14px", marginBottom: 14 }}>
        <div style={{ fontFamily: MONO, fontWeight: 800, fontSize: 14, color: C.ink, marginBottom: 10 }}>{oc.numero_oc}</div>
        {!pendiente && (
          <>
            <Dato label="Cliente" valor={oc.cliente} />
            <Dato label="Unidad" valor={oc.entidad} />
            <Dato label="RUT" valor={oc.rut_cliente} />
            <Dato label="Comuna" valor={[oc.comuna, oc.region].filter(Boolean).join(" · ")} />
            <Dato label="Contacto" valor={[oc.contacto, oc.cargo_contacto].filter(Boolean).join(" · ")} />
            <Dato label="Monto total" valor={fmt.money(oc.monto_total)} />
            <Dato label="Despacho" valor={oc.tipo_despacho} />
            <Dato label="Plazo de pago" valor={oc.forma_pago} />
          </>
        )}
      </div>

      {/* Productos que trajo la API */}
      {!pendiente && (oc.productos || []).length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: C.inkMuted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>
            {oc.productos.length} producto{oc.productos.length > 1 ? "s" : ""}
          </div>
          {oc.productos.map((p, i) => (
            <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 12px", marginBottom: 6 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.ink, lineHeight: 1.4 }}>{p.descripcion}</div>
              <div style={{ fontSize: 12, color: C.inkMuted, marginTop: 4 }}>
                {p.cantidad} × {fmt.money(p.precio_venta_unitario)} = <b>{fmt.money(p.total_linea)}</b>
              </div>
              {p.categoria && <div style={{ fontSize: 12, color: C.inkFaint, marginTop: 2 }}>{p.categoria}</div>}
            </div>
          ))}
        </div>
      )}

      {/* Cotización BFK relacionada (sugerida; nunca se vincula sin confirmación) */}
      {conCotizaciones && !pendiente && (
        <SelectorCotizacionOC ocMP={oc} onCandidatas={onCandidatasCotizacion} onBuscarTexto={onBuscarCotizacionTexto || (async () => [])}
          onCargar={onCargarCotizacion} seleccion={cotSel} onSeleccion={elegirCotizacion}
          sinCotizacion={sinCot} onSinCotizacion={(v) => { setSinCot(v); if (v) elegirCotizacion(null); }} bloqueado={!!ocCreada.current} />
      )}

      {/* Links de compra — lo único obligatorio para Mati (con cotización, vienen de ella) */}
      <div style={{ marginBottom: 14 }} data-links-oc>
        <div style={{ fontSize: 12, fontWeight: 800, color: C.inkMuted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>
          Link de compra <span style={{ color:C.dangerText }}>*</span>
        </div>
        {cotSel && links.some(l => l.trim()) && (
          <div data-links-desde-cotizacion style={{ fontSize: 12, color: C.inkMuted, marginTop: -4, marginBottom: 8 }}>Tomados de la cotización {cotSel.base.codigo}. Corrígelos solo si cambió el enlace.</div>
        )}
        {links.map((l, i) => (
          <div key={i} style={{ marginBottom: 6 }}>
          {cotSel && (oc.productos || [])[i] && <div style={{ fontSize: 11, color: C.inkFaint, marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Para: {(oc.productos[i].descripcion || "").slice(0, 90)}</div>}
          <div style={{ display: "flex", gap: 6 }}>
            <input data-link-oc={i} style={{ ...iStyle, flex: 1, minWidth: 0 }} value={l}
              onChange={e => setLinks(ls => ls.map((x, ix) => ix === i ? e.target.value : x))}
              placeholder="https://…" />
            {links.length > 1 && (
              <button onClick={() => setLinks(ls => ls.filter((_, ix) => ix !== i))}
                style={{ background: C.dangerLight, border: "none", borderRadius: 8, padding: "0 12px", color:C.dangerText, fontSize: 14, cursor: "pointer" }}>✕</button>
            )}
          </div>
          </div>
        ))}
        <button onClick={() => setLinks(ls => [...ls, ""])}
          style={{ fontSize: 12, background: "none", border: `1px dashed ${C.border}`, borderRadius: 8, padding: "6px 12px", color:C.tealDark, cursor: "pointer", width: "100%" }}>
          + Otro link
        </button>
      </div>

      {/* Dirección de entrega — prellenada si se pudo detectar */}
      {!pendiente && necesitaDireccion && (
        <Field label="Dirección de entrega"
          hint={direccion ? "Detectada en el texto de la OC — corrige si está mal" : "No se detectó en la OC, escríbela"}>
          <textarea style={{ ...iStyle, minHeight: 56, resize: "vertical" }} value={direccion}
            onChange={e => setDireccion(e.target.value)}
            placeholder="Dirección donde hay que entregar" />
        </Field>
      )}

      {/* Correo — solo si el cliente es nuevo */}
      {!pendiente && (
        <Field label="Correo del cliente"
          hint={esClienteNuevo ? "Cliente nuevo: este correo se guardará para próximas OCs" : "Recuperado del catálogo de entidades"}>
          <input style={iStyle} type="email" value={correo}
            onChange={e => setCorreo(e.target.value)}
            placeholder="contacto@entidad.cl" />
        </Field>
      )}

      <Field label="Vendedor" hint="Elegido en el paso anterior — vuelve atrás si lo quieres cambiar">
        <input style={{...iStyle,background:C.paper,color:C.inkMuted}} disabled
          value={(vendedores||[]).find(v=>v.id===vendedorId)?.nombre || "Sin vendedor asignado"} />
        {cotSel && (() => {
          // Vendedor responsable de la cotización: solo se informa; se asigna únicamente si el usuario lo pide.
          const vc = String(cotSel.cot.vendedor_id || ""); const enBFK = (vendedores || []).find(v => String(v.id) === vc);
          if (!vc || String(vendedorId) === vc) return null;
          if (!vendedorId && enBFK) return (
            <div data-vendedor-cotizacion style={{ fontSize: 12, color: C.inkMuted, marginTop: 6, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span>La cotización tiene como vendedor responsable a <b>{enBFK.nombre}</b>.</span>
              <button data-usar-vendedor-cotizacion onClick={() => setVendedorId(enBFK.id)} style={{ background: "none", border: `1px solid ${C.teal}`, borderRadius: 8, color: C.tealDark, cursor: "pointer", fontSize: 12, padding: "4px 10px", minHeight: 32 }}>Asignarlo a esta OC</button>
            </div>);
          return <div data-aviso-vendedor style={{ fontSize: 12, color: C.warnText, fontWeight: 600, marginTop: 6 }}><Ic n="⚠"/> El vendedor responsable de la cotización es {cotSel.cot.vendedor_nombre || vc}{vendedorId ? ", distinto del elegido para la OC" : ""}. Revisa antes de guardar.</div>;
        })()}
      </Field>

      {/* ¿Qué se guarda? Solo con cotización elegida. La compra real se registra únicamente si el usuario confirma que compró. */}
      {cotSel && (
        <div data-modo-guardado style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: C.inkMuted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>¿Qué quieres guardar?</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <button data-modo="solo_oc" aria-pressed={modo === "solo_oc"} onClick={() => setModo("solo_oc")} style={{ ...btnP(modo === "solo_oc" ? C.teal : C.inkFaint), minHeight: 56, fontSize: 13 }}>Solo la OC<br /><span style={{ fontWeight: 500, fontSize: 11 }}>aún no compro</span></button>
            <button data-modo="con_compra" aria-pressed={modo === "con_compra"} onClick={() => setModo("con_compra")} style={{ ...btnP(modo === "con_compra" ? C.teal : C.inkFaint), minHeight: 56, fontSize: 13 }}>OC y compra<br /><span style={{ fontWeight: 500, fontSize: 11 }}>ya compré</span></button>
          </div>
        </div>
      )}
      {cotSel && modo === "solo_oc" && <ResumenCotizacionOC base={cotSel.base} ventaOC={oc.monto_total} />}
      {cotSel && modo === "con_compra" && ocVirtual && (
        <CompraDesdeCotizacion key={cotSel.cot.id} modoNuevaOC pedidoFijo={pedidoNuevaOC.current} oc={ocVirtual} cot={cotSel.cot} financiadores={financiadores} perfil={perfil}
          onCompraDesdeCotizacion={guardarConCompra}
          avisoBloqueo={estadoMP(oc.codigo_estado).tipo === "cancelada" ? "La OC figura cancelada en Mercado Público: no se registra una compra. Guarda solo la OC si de todas formas quieres cargarla." : ""} />
      )}
      {cotSel && modo === "con_compra" && estadoMP(oc.codigo_estado).tipo === "sin_aceptar" && (
        <div data-aviso-sin-aceptar style={{ fontSize: 12, color: C.warnText, fontWeight: 600, marginBottom: 10 }}><Ic n="⚠"/> La OC aún no está aceptada en Mercado Público: confirma la compra solo si ya la realizaste.</div>
      )}

      {avisoParcial && <div data-aviso-oc-creada style={{ background: C.warnLight, color: C.warnText, borderRadius: 8, padding: "8px 12px", fontSize: 12, marginBottom: 10, fontWeight: 600 }}>{avisoParcial}</div>}
      {err && <div data-error-nueva-oc style={{ background: C.dangerLight, color:C.dangerText, borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 10, fontWeight: 600 }}>{err}</div>}

      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => { setPaso(1); setErr(""); }} disabled={!!ocCreada.current} style={{ ...btnP(C.inkFaint), flex: 1, opacity: ocCreada.current ? 0.45 : 1 }}>← Atrás</button>
        {!(cotSel && modo === "con_compra") && (
          <button data-crear-oc onClick={guardar} disabled={guardando} style={{ ...btnP(guardando ? C.inkFaint : C.ok), flex: 2 }}>
            {guardando ? "Guardando…" : cotSel ? (ocCreada.current ? "↻ Reintentar vínculo" : "✓ Crear OC y vincular cotización") : "✓ Crear OC"}
          </button>
        )}
      </div>

      <div style={{ fontSize: 12, color: C.inkFaint, textAlign: "center", marginTop: 10 }}>
        Creada por {perfil?.nombre || "tu usuario"} · el vendedor es el elegido arriba
      </div>
    </div>
  );
}
