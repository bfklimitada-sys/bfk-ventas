import { useState, useEffect } from "react";
import { Field } from "../ui/Basicos";
import { C, MONO, SANS, btnP, btnG, fmt, iStyle, iMono, selStyle } from "../../lib/theme";

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

export function NuevaOCRapida({ perfil, vendedores, entidadesCatalogo, codigoInicial, onGuardar, onCerrar }) {
  const [paso, setPaso] = useState(1);
  const [codigo, setCodigo] = useState(codigoInicial || "");
  const [cargando, setCargando] = useState(false);
  const [err, setErr] = useState("");
  const [datos, setDatos] = useState(null);     // respuesta normalizada de la API
  const [pendiente, setPendiente] = useState(false); // true = OC aún no aceptada

  // Campos que Mati puede completar o corregir
  const [links, setLinks] = useState([""]);
  const [direccion, setDireccion] = useState("");
  const [correo, setCorreo] = useState("");
  const [vendedorId, setVendedorId] = useState(perfil?.vendedor_id || "");
  const [guardando, setGuardando] = useState(false);

  const buscar = async (codigoForzado) => {
    const cod = (codigoForzado ?? codigo).trim().toUpperCase();
    if (!cod) { setErr("Ingresa el código de la OC"); return; }
    setErr(""); setCargando(true); setDatos(null); setPendiente(false);
    try {
      const r = await fetch(`/api/oc?codigo=${encodeURIComponent(cod)}`);
      const j = await r.json();

      if (j.ok) {
        const oc = j.oc;
        setDatos(oc);
        // Correo: primero el del catálogo por RUT, si existe
        const enCatalogo = (entidadesCatalogo || []).find(e => e.rut === oc.rut_cliente);
        setCorreo(oc.correo_cliente || enCatalogo?.correo || "");
        // Dirección: la del comprador, o la que venga en el texto del producto
        const textoItems = (oc.productos || []).map(p => p.descripcion).join(" ");
        setDireccion(oc.direccion || extraerDireccion(textoItems) || "");
        setPaso(2);
      } else if (r.status === 404) {
        // OC todavía no aceptada en Mercado Público
        setPendiente(true);
        setDatos({ numero_oc: cod, productos: [] });
        setPaso(2);
      } else {
        setErr(j.error || "No se pudo consultar Mercado Público");
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
    setErr(""); setGuardando(true);
    try {
      await onGuardar({
        pendienteSync: pendiente,
        oc: datos,
        links: links.map(l => l.trim()).filter(Boolean),
        direccion_entrega: direccion.trim(),
        correo_cliente: correo.trim(),
        vendedorId: vendedorId || null,
      });
    } catch (e) {
      setErr(e.message); setGuardando(false);
    }
  };

  const Dato = ({ label, valor, alerta }) => (
    <div style={{ marginBottom: 7 }}>
      <div style={{ fontSize: 10, color: C.inkMuted, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3 }}>{label}</div>
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

        <Field label="Código de la OC" required hint="Tal como aparece en Mercado Público">
          <input style={iMono} value={codigo} autoFocus
            onChange={e => { setCodigo(e.target.value); setErr(""); }}
            onKeyDown={e => e.key === "Enter" && buscar()}
            placeholder="ej: 3013-587-AG26" />
        </Field>

        {err && <div style={{ background: C.dangerLight, color: C.danger, borderRadius: 8, padding: "8px 12px", fontSize: 12.5, marginBottom: 10, fontWeight: 600 }}>{err}</div>}

        <button onClick={buscar} disabled={cargando} style={btnP(cargando ? C.inkFaint : C.teal)}>
          {cargando ? "Consultando Mercado Público…" : "Buscar OC →"}
        </button>
      </div>
    );
  }

  // ─────────────────────────────── PASO 2: revisar y completar
  const oc = datos || {};
  const necesitaDireccion = oc.tipo_despacho_codigo === "12" || oc.tipo_despacho_codigo === "7";
  const esClienteNuevo = !(entidadesCatalogo || []).some(e => e.rut === oc.rut_cliente);

  return (
    <div style={{ fontFamily: SANS }}>
      {pendiente ? (
        <div style={{ background: C.warnLight, border: `1px solid ${C.warn}`, borderRadius: 10, padding: "12px 14px", marginBottom: 14 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: C.warn, marginBottom: 4 }}>⏳ Aún no aceptada en Mercado Público</div>
          <div style={{ fontSize: 12, color: C.inkMuted, lineHeight: 1.5 }}>
            Guárdala igual con el link. La app completará el cliente, los productos y los montos
            automáticamente cuando la OC sea aceptada.
          </div>
        </div>
      ) : (
        <div style={{ background: C.okLight, borderRadius: 10, padding: "10px 14px", marginBottom: 14 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: C.ok }}>✓ Datos traídos de Mercado Público</div>
        </div>
      )}

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
          <div style={{ fontSize: 11, fontWeight: 800, color: C.inkMuted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>
            {oc.productos.length} producto{oc.productos.length > 1 ? "s" : ""}
          </div>
          {oc.productos.map((p, i) => (
            <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 9, padding: "10px 12px", marginBottom: 6 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: C.ink, lineHeight: 1.4 }}>{p.descripcion}</div>
              <div style={{ fontSize: 11, color: C.inkMuted, marginTop: 4 }}>
                {p.cantidad} × {fmt.money(p.precio_venta_unitario)} = <b>{fmt.money(p.total_linea)}</b>
              </div>
              {p.categoria && <div style={{ fontSize: 10.5, color: C.inkFaint, marginTop: 2 }}>{p.categoria}</div>}
            </div>
          ))}
        </div>
      )}

      {/* Links de compra — lo único obligatorio para Mati */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: C.inkMuted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>
          Link de compra <span style={{ color: C.danger }}>*</span>
        </div>
        {links.map((l, i) => (
          <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
            <input style={{ ...iStyle, flex: 1 }} value={l}
              onChange={e => setLinks(ls => ls.map((x, ix) => ix === i ? e.target.value : x))}
              placeholder="https://…" />
            {links.length > 1 && (
              <button onClick={() => setLinks(ls => ls.filter((_, ix) => ix !== i))}
                style={{ background: C.dangerLight, border: "none", borderRadius: 8, padding: "0 12px", color: C.danger, fontSize: 14, cursor: "pointer" }}>✕</button>
            )}
          </div>
        ))}
        <button onClick={() => setLinks(ls => [...ls, ""])}
          style={{ fontSize: 11.5, background: "none", border: `1px dashed ${C.border}`, borderRadius: 8, padding: "6px 12px", color: C.teal, cursor: "pointer", width: "100%" }}>
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

      <Field label="Vendedor" hint="Quién trajo esta venta — no necesariamente quien la está cargando">
        <select style={selStyle} value={vendedorId} onChange={e => setVendedorId(e.target.value)}>
          <option value="">Sin vendedor asignado</option>
          {(vendedores || []).map(v => (
            <option key={v.id} value={v.id}>{v.nombre}</option>
          ))}
        </select>
      </Field>

      {err && <div style={{ background: C.dangerLight, color: C.danger, borderRadius: 8, padding: "8px 12px", fontSize: 12.5, marginBottom: 10, fontWeight: 600 }}>{err}</div>}

      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => { setPaso(1); setErr(""); }} style={{ ...btnP(C.inkFaint), flex: 1 }}>← Atrás</button>
        <button onClick={guardar} disabled={guardando} style={{ ...btnP(guardando ? C.inkFaint : C.ok), flex: 2 }}>
          {guardando ? "Guardando…" : "✓ Crear OC"}
        </button>
      </div>

      <div style={{ fontSize: 11, color: C.inkFaint, textAlign: "center", marginTop: 10 }}>
        La venta queda registrada a nombre de {perfil?.nombre || "tu usuario"}
      </div>
    </div>
  );
}
