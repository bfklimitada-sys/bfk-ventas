import { useState, useEffect } from "react";
import { Field } from "../ui/Basicos";
import { C, MONO, SANS, btnP, btnG, fmt, iStyle, iMono, selStyle } from "../../lib/theme";
import { Ic } from "../ui/Iconos";
import { entidadPorRut } from "../../lib/rut";
import { estadoMP, mensajeDuplicado, resultadoConsultaMP } from "../../lib/ocs";

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

export function NuevaOCRapida({ perfil, vendedores, entidadesCatalogo, codigoInicial, onGuardar, onCerrar, buscarDuplicado }) {
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

  const buscar = async (codigoForzado) => {
    // Fase 4A: el botón entregaba el evento del clic como "código" y la búsqueda fallaba en silencio
    // (solo funcionaba con Enter). Ahora solo se acepta un texto.
    const cod = String(typeof codigoForzado === "string" ? codigoForzado : codigo).trim().toUpperCase();
    if (!cod) { setErr("Ingresa el código de la OC"); return; }
    setErr(""); setCargando(true); setDatos(null); setPendiente(false); setConfirmaCancelada(false);
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

  const guardar = async () => {
    if (!links.some(l => l.trim())) { setErr("Agrega al menos un link de producto"); return; }
    if (!pendiente && estadoMP(datos?.codigo_estado).tipo === "cancelada" && !confirmaCancelada) {
      setErr("Esta OC figura cancelada en Mercado Público. Marca la casilla si de todas formas quieres cargarla."); return;
    }
    setErr(""); setGuardando(true);
    try {
      await onGuardar({
        pendienteSync: pendiente,
        oc: datos,
        links: links.map(l => l.trim()).filter(Boolean),
        direccion_entrega: direccion.trim(),
        correo_cliente: correo.trim(),
        vendedorId: vendedorId || null,
        ventaPropia: !!(vendedorId && ventaPropia),
      });
    } catch (e) {
      setErr(e.message); setGuardando(false);
    }
  };

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
        <div style={{ background: C.tealLight, borderRadius: 10, padding: "12px 14px", marginBottom: 16 }}>
          <div style={{ fontSize: 12.5, color: C.tealDark, fontWeight: 700, marginBottom: 4 }}>Solo necesitas el código</div>
          <div style={{ fontSize: 12, color: C.inkMuted, lineHeight: 1.5 }}>
            La app trae sola el cliente, los productos, cantidades y montos desde Mercado Público.
          </div>
        </div>

        <Field label="Vendedor" hint="Quién trajo esta venta">
          <select style={selStyle} value={vendedorId} onChange={e => { setVendedorId(e.target.value); if (!e.target.value) setVentaPropia(false); }}>
            <option value="">Sin vendedor asignado</option>
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
            background:C.paper,borderRadius:10,padding:"10px 12px"}}>
            <input type="checkbox" checked={ventaPropia} onChange={e=>setVentaPropia(e.target.checked)}
              style={{marginTop:2,width:16,height:16,flexShrink:0}} />
            <span>
              <span style={{display:"block",fontSize:12.5,fontWeight:700,color:C.ink}}>Es venta propia del vendedor</span>
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

        {err && <div style={{ background: C.dangerLight, color:C.dangerText, borderRadius: 8, padding: "8px 12px", fontSize: 12.5, marginBottom: 10, fontWeight: 600 }}>{err}</div>}

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
        <div data-estado-mp="no_disponible" style={{ background: C.warnLight, border: `1px solid ${C.warn}`, borderRadius: 10, padding: "12px 14px", marginBottom: 14 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color:C.warnText, marginBottom: 4 }}><Ic n="⏳"/> Todavía no disponible en Mercado Público</div>
          <div style={{ fontSize: 12, color: C.inkMuted, lineHeight: 1.5 }}>
            Mercado Público respondió que no tiene esta OC: puede que aún no esté publicada o aceptada,
            o que el código tenga un error (revísalo). Si el código es correcto, guárdala igual con el link:
            la app completará el cliente, los productos y los montos cuando la OC aparezca.
          </div>
        </div>
      ) : (() => {
        const est = estadoMP(oc.codigo_estado);
        if (est.tipo === "cancelada") return (
          <div data-estado-mp="cancelada" style={{ background: C.dangerLight, border: `1px solid ${C.danger}`, borderRadius: 10, padding: "12px 14px", marginBottom: 14 }}>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: C.dangerText, marginBottom: 4 }}><Ic n="⚠"/> Cancelada en Mercado Público</div>
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
          <div data-estado-mp="sin_aceptar" style={{ background: C.warnLight, border: `1px solid ${C.warn}`, borderRadius: 10, padding: "12px 14px", marginBottom: 14 }}>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: C.warnText, marginBottom: 4 }}><Ic n="⏳"/> {est.texto}</div>
            <div style={{ fontSize: 12, color: C.inkMuted, lineHeight: 1.5 }}>
              Los datos ya vienen de Mercado Público, pero la OC sigue sin aceptar. Acéptala en el portal antes de comprar.
            </div>
          </div>
        );
        return (
          <div data-estado-mp={est.tipo} style={{ background: C.okLight, borderRadius: 10, padding: "10px 14px", marginBottom: 14 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color:C.okText }}>✓ Datos traídos de Mercado Público · {est.texto}</div>
          </div>
        );
      })()}

      {/* Resumen de lo que trajo la API */}
      <div style={{ background: C.paper, borderRadius: 10, padding: "12px 14px", marginBottom: 14 }}>
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
            <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 9, padding: "10px 12px", marginBottom: 6 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: C.ink, lineHeight: 1.4 }}>{p.descripcion}</div>
              <div style={{ fontSize: 12, color: C.inkMuted, marginTop: 4 }}>
                {p.cantidad} × {fmt.money(p.precio_venta_unitario)} = <b>{fmt.money(p.total_linea)}</b>
              </div>
              {p.categoria && <div style={{ fontSize: 12, color: C.inkFaint, marginTop: 2 }}>{p.categoria}</div>}
            </div>
          ))}
        </div>
      )}

      {/* Links de compra — lo único obligatorio para Mati */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: C.inkMuted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>
          Link de compra <span style={{ color:C.dangerText }}>*</span>
        </div>
        {links.map((l, i) => (
          <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
            <input style={{ ...iStyle, flex: 1 }} value={l}
              onChange={e => setLinks(ls => ls.map((x, ix) => ix === i ? e.target.value : x))}
              placeholder="https://…" />
            {links.length > 1 && (
              <button onClick={() => setLinks(ls => ls.filter((_, ix) => ix !== i))}
                style={{ background: C.dangerLight, border: "none", borderRadius: 8, padding: "0 12px", color:C.dangerText, fontSize: 14, cursor: "pointer" }}>✕</button>
            )}
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
      </Field>

      {err && <div style={{ background: C.dangerLight, color:C.dangerText, borderRadius: 8, padding: "8px 12px", fontSize: 12.5, marginBottom: 10, fontWeight: 600 }}>{err}</div>}

      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => { setPaso(1); setErr(""); }} style={{ ...btnP(C.inkFaint), flex: 1 }}>← Atrás</button>
        <button onClick={guardar} disabled={guardando} style={{ ...btnP(guardando ? C.inkFaint : C.ok), flex: 2 }}>
          {guardando ? "Guardando…" : "✓ Crear OC"}
        </button>
      </div>

      <div style={{ fontSize: 12, color: C.inkFaint, textAlign: "center", marginTop: 10 }}>
        Creada por {perfil?.nombre || "tu usuario"} · el vendedor es el elegido arriba
      </div>
    </div>
  );
}
