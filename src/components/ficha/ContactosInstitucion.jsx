// Contactos institucionales (21/10/2026): ver, reutilizar, añadir y corregir los contactos de la institución de una OC.
// Los datos los guarda y valida Supabase (RPC). El contacto que vino en cada OC se muestra tal cual y NUNCA se modifica.
import { createContext, useContext, useMemo, useState } from "react";
import { C, btnG, iStyle } from "../../lib/theme";
import { Badge } from "../ui/Sistema";
import { Field } from "../ui/Basicos";
import { Ic } from "../ui/Iconos";
import { claveInstitucion, contactosDeInstitucion, correoSugerido, mensajeErrorContacto, MOTIVOS_PENDIENTE, ORIGENES, textoSugerencia, validarContacto } from "../../lib/contactosInstitucionales";

// valor: { disponible, contactos, vinculos, guardar({id,rut,datos,ocId}), resolver(id,decision,motivo), obsoleto(id,motivo), cargarHistorial(id) }
export const ContactosContext = createContext(null);
export const useContactos = () => useContext(ContactosContext);

const chico = { ...btnG, minHeight: 36, padding: "6px 10px", fontSize: 12 };
const fmtFecha = (v) => { const d = v ? new Date(v) : null; return d && !isNaN(d) ? d.toLocaleDateString("es-CL") : ""; };
const VACIO = { nombre: "", cargo: "", departamento: "", correo: "", telefono: "", es_principal: false, soloOC: false };

function FormContacto({ inicial, ocId, permitirSoloOC, onGuardar, onCancelar }) {
  const esAdmin = !!useContactos()?.esAdmin;
  const [d, setD] = useState({ ...VACIO, ...inicial, soloOC: inicial?.alcance === "oc" });
  const [error, setError] = useState(""); const [guardando, setGuardando] = useState(false);
  const campo = (k, label, tipo = "text", ph = "") => (
    <Field label={label}><input data-campo-contacto={k} style={iStyle} type={tipo} value={d[k] || ""} placeholder={ph} onChange={e => setD({ ...d, [k]: e.target.value })} /></Field>);
  const guardar = async () => {
    const v = validarContacto(d); if (v) { setError(v); return; }
    setGuardando(true); setError("");
    try {
      await onGuardar({ nombre: d.nombre.trim(), cargo: d.cargo.trim(), departamento: d.departamento.trim(), correo: d.correo.trim(), telefono: d.telefono.trim(),
        ...(esAdmin ? { es_principal: !!d.es_principal && !d.soloOC } : {}), alcance: d.soloOC ? "oc" : "institucion", ...(d.soloOC ? { oc_exclusiva: inicial?.oc_exclusiva || ocId } : {}),
        ...(inicial?.estado === "obsoleto" ? { reactivar: true } : {}) });
    } catch (e) { setError(mensajeErrorContacto(e)); setGuardando(false); }
  };
  return (
    <div data-form-contacto style={{ background: C.paper, border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 12px 4px", marginTop: 8 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", columnGap: 10 }}>
        {campo("nombre", "Nombre")}{campo("cargo", "Cargo o función")}{campo("departamento", "Departamento o unidad")}
        {campo("correo", "Correo", "email", "contacto@institucion.cl")}{campo("telefono", "Teléfono", "tel")}
      </div>
      {esAdmin && <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, marginBottom: 8, minHeight: 32 }}>
        <input data-es-principal type="checkbox" checked={!!d.es_principal && !d.soloOC} disabled={d.soloOC} onChange={e => setD({ ...d, es_principal: e.target.checked })} /> Contacto principal de la institución
      </label>}
      {permitirSoloOC && <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, marginBottom: 8, minHeight: 32 }}>
        <input data-solo-oc type="checkbox" checked={!!d.soloOC} onChange={e => setD({ ...d, soloOC: e.target.checked })} /> Solo para esta OC (no se ofrece en otras OC de la institución)
      </label>}
      {error && <div role="alert" style={{ color: C.dangerText, fontSize: 13, marginBottom: 8 }}>{error}</div>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <button data-guardar-contacto onClick={guardar} disabled={guardando} style={{ ...chico, background: C.teal, color: "#fff", border: "none", fontWeight: 700 }}>{guardando ? "Guardando…" : "Guardar contacto"}</button>
        <button onClick={onCancelar} style={chico}>Cancelar</button>
      </div>
      <div style={{ fontSize: 12, color: C.inkFaint, marginBottom: 8 }}>{esAdmin || !inicial ? "Lo que guardes aquí queda confirmado: una sincronización con Mercado Público no lo sobrescribe." : "Tu corrección queda como propuesta hasta que el administrador la apruebe."}</div>
    </div>
  );
}

function Historial({ id }) {
  const ctx = useContactos(); const [filas, setFilas] = useState(null);
  if (filas === null) { ctx.cargarHistorial(id).then(r => setFilas(r || [])).catch(() => setFilas([])); return <div style={{ fontSize: 12, color: C.inkFaint }}>Cargando historial…</div>; }
  if (!filas.length) return <div style={{ fontSize: 12, color: C.inkFaint }}>Sin cambios registrados.</div>;
  return (
    <ul data-historial-contacto style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12, color: C.inkMuted, lineHeight: 1.5 }}>
      {filas.map(h => {
        const a = h.anterior || {}, n = h.nuevo || {};
        const cambios = ["correo", "nombre", "telefono", "cargo", "departamento", "estado"].filter(k => h.anterior && a[k] !== n[k]).map(k => `${k}: ${a[k] || "—"} → ${n[k] || "—"}`);
        return <li key={h.id}>{fmtFecha(h.creado_en)} · {String(h.accion).replace(/_/g, " ")}{h.oc_id ? ` · OC ${h.oc_id}` : ""}{h.origen ? ` · ${ORIGENES[h.origen] || h.origen}` : ""}{cambios.length ? ` · ${cambios.join("; ")}` : ""}</li>;
      })}
    </ul>
  );
}

function TarjetaContacto({ c, ocId, nOCs, numerosOC, todos }) {
  const ctx = useContactos();
  const [editando, setEditando] = useState(false); const [verHist, setVerHist] = useState(false);
  const [error, setError] = useState(""); const [ocupado, setOcupado] = useState(false);
  const esAdmin = !!ctx?.esAdmin;
  const [fusionando, setFusionando] = useState(false); const [absorber, setAbsorber] = useState("");
  const anterior = c.conflicto_con ? todos.find(x => x.id === c.conflicto_con) : null;
  const prop = c.propuesta || null;
  const cambiosProp = prop ? ["nombre", "cargo", "departamento", "correo", "telefono"].filter(k => prop[k] !== undefined && String(prop[k] || "") !== String(c[k] || "")).map(k => `${k}: ${c[k] || "—"} → ${prop[k] || "—"}`) : [];
  const reemplazo = c.reemplazado_por ? todos.find(x => x.id === c.reemplazado_por) : null;
  const accion = async (fn) => { setOcupado(true); setError(""); try { await fn(); } catch (e) { setError(mensajeErrorContacto(e)); } setOcupado(false); };
  const tono = c.estado === "pendiente" ? C.warn : c.estado === "obsoleto" ? C.border : c.confirmado_manual ? C.ok : C.border;
  return (
    <div data-contacto={c.correo || c.nombre} data-estado={c.estado} style={{ border: `1.5px solid ${tono}`, borderRadius: 10, padding: "10px 12px", background: c.estado === "obsoleto" ? C.paper : C.card, opacity: c.estado === "obsoleto" ? 0.85 : 1, minWidth: 0 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginBottom: 4 }}>
        <span style={{ fontWeight: 800, fontSize: 14, color: C.ink, wordBreak: "break-word" }}>{c.nombre || "Sin nombre"}</span>
        {c.es_principal && <Badge tono="info">Principal</Badge>}
        {c.estado === "vigente" && (c.confirmado_manual ? <Badge tono="ok">Confirmado</Badge> : <Badge>{ORIGENES[c.origen] || c.origen}</Badge>)}
        {c.estado === "pendiente" && <Badge tono="warn">Pendiente de verificación</Badge>}
        {c.estado === "obsoleto" && <Badge tono="danger">Obsoleto</Badge>}
        {c.alcance === "oc" && <Badge tono="warn">Solo {c.oc_exclusiva === ocId ? "esta OC" : "una OC"}</Badge>}
      </div>
      {(c.cargo || c.departamento) && <div style={{ fontSize: 12, color: C.inkMuted }}>{[c.cargo, c.departamento].filter(Boolean).join(" · ")}</div>}
      <div style={{ fontSize: 13, marginTop: 3, display: "flex", flexDirection: "column", gap: 2, wordBreak: "break-all" }}>
        {c.correo ? <a href={`mailto:${c.correo}`} style={{ color: c.estado === "obsoleto" ? C.inkFaint : C.tealDark, textDecoration: c.estado === "obsoleto" ? "line-through" : "none" }}>{c.correo}</a> : <span style={{ color: C.inkFaint }}>Sin correo</span>}
        {c.telefono && <a href={`tel:${c.telefono.replace(/[^+0-9]/g, "")}`} style={{ color: C.ink, textDecoration: "none" }}>{c.telefono}</a>}
      </div>
      <div style={{ fontSize: 12, color: C.inkFaint, marginTop: 4 }}>
        {nOCs ? `${nOCs} OC asociada${nOCs === 1 ? "" : "s"}${numerosOC ? ` (${numerosOC})` : ""}` : "Sin OC asociada"}{c.actualizado_en ? ` · actualizado ${fmtFecha(c.actualizado_en)}` : ""}
      </div>
      {c.estado === "pendiente" && <div data-motivo-pendiente={c.motivo_pendiente} style={{ background: C.warnLight, borderRadius: 8, padding: "7px 9px", fontSize: 12, color: C.warnText, marginTop: 6 }}>
        <Ic n="⚠" /> {MOTIVOS_PENDIENTE[c.motivo_pendiente] || "Revisar"}{anterior ? `: hoy se usa ${anterior.correo}${anterior.confirmado_manual ? " (confirmado manualmente)" : ""}.` : "."}
      </div>}
      {prop && <div data-propuesta style={{ background: C.infoLight, borderRadius: 8, padding: "7px 9px", fontSize: 12, color: C.ink, marginTop: 6 }}>
        <b>Actualización propuesta</b>{c.propuesta_en ? ` (${fmtFecha(c.propuesta_en)})` : ""}: {cambiosProp.join("; ") || "sin cambios de datos"}.
        {esAdmin ? <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
          <button data-aprobar-propuesta disabled={ocupado} onClick={() => accion(() => ctx.resolverPropuesta(c.id, true))} style={chico}>Aprobar</button>
          <button data-rechazar-propuesta disabled={ocupado} onClick={() => accion(() => ctx.resolverPropuesta(c.id, false))} style={chico}>Rechazar</button>
        </div> : <div style={{ color: C.inkMuted, marginTop: 2 }}>Pendiente de aprobación del administrador.</div>}
      </div>}
      {c.estado === "obsoleto" && <div style={{ fontSize: 12, color: C.inkMuted, marginTop: 4 }}>{c.obsoleto_motivo}{reemplazo ? ` · reemplazado por ${reemplazo.correo || reemplazo.nombre}` : ""}</div>}
      {error && <div role="alert" style={{ color: C.dangerText, fontSize: 12, marginTop: 6 }}>{error}</div>}
      {!editando && <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
        {c.estado === "pendiente" && <>
          {anterior && esAdmin && <button data-resolver="reemplaza" disabled={ocupado} onClick={() => accion(() => ctx.resolver(c.id, "reemplaza"))} style={chico}>Reemplaza al anterior</button>}
          <button data-resolver="adicional" disabled={ocupado} onClick={() => accion(() => ctx.resolver(c.id, "adicional"))} style={chico}>Es otro contacto válido</button>
          {esAdmin && <button data-resolver="descartar" disabled={ocupado} onClick={() => accion(() => ctx.resolver(c.id, "descartar"))} style={chico}>Descartar</button>}
          {!esAdmin && anterior && <span style={{ fontSize: 12, color: C.inkMuted, alignSelf: "center" }}>El reemplazo lo confirma el administrador.</span>}
        </>}
        {c.estado === "vigente" && <>
          <button data-editar-contacto onClick={() => setEditando(true)} style={chico}><Ic n="✏️" /> Corregir</button>
          {esAdmin && !c.es_principal && c.alcance !== "oc" && <button data-hacer-principal disabled={ocupado} onClick={() => accion(() => ctx.guardar({ id: c.id, datos: { es_principal: true }, ocId: null }))} style={chico}>Hacer principal</button>}
          {esAdmin && <button data-fusionar onClick={() => setFusionando(!fusionando)} style={chico}>Fusionar…</button>}
          {esAdmin && <button data-marcar-obsoleto disabled={ocupado} onClick={() => { const m = window.prompt("¿Por qué ya no es válido este contacto? (ej.: correo rebota, ya no trabaja ahí)"); if (m !== null) accion(() => ctx.obsoleto(c.id, m)); }} style={chico}>Ya no es válido</button>}
        </>}
        {c.estado === "obsoleto" && <button data-reactivar onClick={() => setEditando(true)} style={chico}>Reactivar / corregir</button>}
        <button data-ver-historial onClick={() => setVerHist(!verHist)} style={chico}>{verHist ? "Ocultar historial" : "Historial"}</button>
      </div>}
      {fusionando && esAdmin && <div data-form-fusion style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8, alignItems: "center" }}>
        <select data-absorber style={{ ...iStyle, width: "auto", minWidth: 0, maxWidth: "100%", flex: "1 1 180px" }} value={absorber} onChange={e => setAbsorber(e.target.value)}>
          <option value="">Absorber a este contacto…</option>
          {todos.filter(x => x.id !== c.id && x.estado !== "obsoleto").map(x => <option key={x.id} value={x.id}>{x.nombre || "Sin nombre"} · {x.correo || x.telefono}</option>)}
        </select>
        <button data-confirmar-fusion disabled={!absorber || ocupado} onClick={() => accion(async () => { await ctx.fusionar(c.id, absorber, "misma persona (fusión manual)"); setFusionando(false); setAbsorber(""); })} style={chico}>Fusionar</button>
      </div>}
      {editando && <FormContacto inicial={c} ocId={ocId} permitirSoloOC={!!ocId} onCancelar={() => setEditando(false)}
        onGuardar={async (datos) => { await ctx.guardar({ id: c.id, datos, ocId }); setEditando(false); }} />}
      {verHist && <Historial id={c.id} />}
    </div>
  );
}

// Lista de contactos de UNA institución (por RUT). ocId: la OC desde la que se mira (null = catálogo).
export function ContactosLista({ rut, ocId = null, nombreInstitucion = "" }) {
  const ctx = useContactos();
  const [agregando, setAgregando] = useState(false); const [verObsoletos, setVerObsoletos] = useState(false);
  const lista = useMemo(() => contactosDeInstitucion(ctx?.contactos, rut, ocId), [ctx?.contactos, rut, ocId]);
  const porContacto = useMemo(() => { const m = {}; for (const v of (ctx?.vinculos || [])) (m[v.contacto_id] ||= []).push(v.oc_id); return m; }, [ctx?.vinculos]);
  if (!ctx?.disponible) return null;
  const clave = claveInstitucion(rut);
  if (!clave) return <div data-contactos-sin-rut style={{ fontSize: 12, color: C.inkFaint }}>RUT no válido: el contacto se conserva solo en esta OC y no se asigna a ninguna institución hasta corregir el RUT.</div>;
  const activos = lista.filter(c => c.estado !== "obsoleto"), obsoletos = lista.filter(c => c.estado === "obsoleto");
  const pendientes = activos.filter(c => c.estado === "pendiente" || c.propuesta).length;
  const numeros = (id) => (porContacto[id] || []).map(x => ctx.numeroOC?.(x) || x).slice(0, 4).join(", ") + ((porContacto[id] || []).length > 4 ? "…" : "");
  return (
    <div data-contactos-institucion={clave}>
      {pendientes > 0 && <div data-aviso-pendientes={pendientes} style={{ background: C.warnLight, border: `1px solid ${C.warn}55`, borderRadius: 8, padding: "8px 10px", fontSize: 12, color: C.warnText, marginBottom: 8 }}>
        <Ic n="⚠" /> {pendientes} contacto{pendientes === 1 ? "" : "s"} pendiente{pendientes === 1 ? "" : "s"} de verificación o aprobación{nombreInstitucion ? ` en ${nombreInstitucion}` : ""}.</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(min(100%,260px),1fr))", gap: 8 }}>
        {activos.map(c => <TarjetaContacto key={c.id} c={c} ocId={ocId} nOCs={(porContacto[c.id] || []).length} numerosOC={numeros(c.id)} todos={lista} />)}
      </div>
      {!activos.length && <div style={{ fontSize: 12, color: C.inkFaint }}>Todavía no hay contactos guardados para esta institución.</div>}
      {obsoletos.length > 0 && <button data-ver-obsoletos onClick={() => setVerObsoletos(!verObsoletos)} style={{ ...chico, marginTop: 8 }}>{verObsoletos ? "Ocultar" : "Ver"} correos anteriores ({obsoletos.length})</button>}
      {verObsoletos && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(min(100%,260px),1fr))", gap: 8, marginTop: 8 }}>
        {obsoletos.map(c => <TarjetaContacto key={c.id} c={c} ocId={ocId} nOCs={(porContacto[c.id] || []).length} numerosOC={numeros(c.id)} todos={lista} />)}</div>}
      {!agregando ? <button data-agregar-contacto onClick={() => setAgregando(true)} style={{ ...chico, marginTop: 8 }}>+ Añadir contacto</button>
        : <FormContacto inicial={null} ocId={ocId} permitirSoloOC={!!ocId} onCancelar={() => setAgregando(false)}
            onGuardar={async (datos) => { await ctx.guardar({ id: null, rut, datos, ocId }); setAgregando(false); }} />}
    </div>
  );
}

// Bloque de la ficha de la OC: contacto tal como vino en la OC (histórico) + contactos de la institución.
export function ContactosOC({ oc }) {
  const ctx = useContactos();
  const sug = useMemo(() => correoSugerido(ctx?.contactos, oc), [ctx?.contactos, oc]);
  if (!ctx?.disponible) return null;
  return (
    <div data-contactos-oc style={{ marginTop: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: C.inkMuted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 }}>Contactos de la institución</div>
      {(oc.contacto || oc.correo_cliente) && <div data-contacto-historico-oc style={{ fontSize: 12, color: C.inkMuted, marginBottom: 6, wordBreak: "break-word" }}>
        En esta OC vino: <b style={{ color: C.ink }}>{[oc.contacto, oc.correo_cliente].filter(Boolean).join(" · ")}</b> (se conserva tal cual).
      </div>}
      {sug.obsoleto && <div data-aviso-correo-obsoleto style={{ background: C.warnLight, borderRadius: 8, padding: "7px 9px", fontSize: 12, color: C.warnText, marginBottom: 6 }}>
        <Ic n="⚠" /> El correo de esta OC ({sug.obsoleto.correo}) está marcado como obsoleto{sug.correo ? `; para escribir se usa ${sug.correo}` : ""}.</div>}
      {sug.motivo === "pendiente_usa_confirmado" && <div data-aviso-contradice style={{ background: C.warnLight, borderRadius: 8, padding: "7px 9px", fontSize: 12, color: C.warnText, marginBottom: 6 }}>
        <Ic n="⚠" /> El correo de esta OC contradice un correo confirmado manualmente ({sug.correo}). Revisa el contacto pendiente abajo.</div>}
      {sug.correo && sug.motivo !== "oc" && <div data-correo-sugerido={sug.correo} style={{ fontSize: 12, color: C.inkMuted, marginBottom: 6 }}>Para correos de esta OC: <b style={{ color: C.ink }}>{sug.correo}</b> · {textoSugerencia(sug)}</div>}
      <ContactosLista rut={oc.rut_cliente} ocId={oc.id} nombreInstitucion={oc.entidad || oc.cliente} />
    </div>
  );
}

// Selector para reutilizar un contacto guardado en un formulario de correo.
export function ElegirContacto({ oc, valor, onElegir }) {
  const ctx = useContactos();
  const lista = useMemo(() => contactosDeInstitucion(ctx?.contactos, oc?.rut_cliente, oc?.id).filter(c => c.estado === "vigente" && c.correo), [ctx?.contactos, oc]);
  if (!ctx?.disponible || !lista.length) return null;
  return (
    <div data-elegir-contacto style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "-6px 0 12px" }}>
      {lista.slice(0, 6).map(c => (
        <button type="button" key={c.id} data-usar-contacto={c.correo} onClick={() => onElegir(c)}
          style={{ ...chico, minHeight: 32, borderColor: String(valor).toLowerCase().includes(c.correo) ? C.teal : C.border, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {c.nombre ? `${c.nombre} · ` : ""}{c.correo}
        </button>))}
    </div>
  );
}

// Catálogo (Administración): buscar una institución y gestionar sus contactos; lista de instituciones con pendientes.
export function ContactosCatalogo({ entidades }) {
  const ctx = useContactos();
  const [q, setQ] = useState(""); const [rut, setRut] = useState("");
  const conPendientes = useMemo(() => {
    const m = {}; for (const c of (ctx?.contactos || [])) if (c.estado === "pendiente" || c.propuesta) m[c.rut_clave] = (m[c.rut_clave] || 0) + 1; return m;
  }, [ctx?.contactos]);
  const nombre = (clave) => (entidades || []).find(e => claveInstitucion(e.rut) === clave)?.nombre_entidad || "";
  const rutDe = (clave) => (ctx?.contactos || []).find(c => c.rut_clave === clave)?.rut || clave;
  const resultados = useMemo(() => {
    const t = q.trim().toLowerCase(); if (t.length < 2) return [];
    const claveQ = claveInstitucion(q);
    return (entidades || []).filter(e => (claveQ && claveInstitucion(e.rut) === claveQ) || String(e.nombre_entidad || "").toLowerCase().includes(t) || String(e.rut || "").includes(q.trim())).slice(0, 8);
  }, [q, entidades]);
  if (!ctx?.disponible) return <div style={{ fontSize: 12, color: C.inkFaint }}>Contactos institucionales: pendiente de instalar en la base de datos.</div>;
  const total = (ctx.contactos || []).filter(c => c.estado !== "obsoleto").length;
  return (
    <div data-contactos-catalogo>
      <div style={{ fontSize: 12, color: C.inkMuted, marginBottom: 8 }}>{total} contactos vigentes o pendientes · {Object.keys(conPendientes).length} instituciones con contactos por verificar</div>
      {Object.keys(conPendientes).length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
        {Object.entries(conPendientes).slice(0, 12).map(([k, n]) => <button key={k} data-institucion-pendiente={k} onClick={() => { setRut(rutDe(k)); setQ(""); }} style={{ ...chico, minHeight: 32 }}>{nombre(k) || rutDe(k)} · {n}</button>)}
      </div>}
      <Field label="Buscar institución (RUT o nombre)"><input data-buscar-institucion style={iStyle} value={q} onChange={e => setQ(e.target.value)} placeholder="ej: 69.070.900-7 o Municipalidad" /></Field>
      {resultados.length > 0 && <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: -8, marginBottom: 10 }}>
        {resultados.map(e => <button key={e.id} onClick={() => { setRut(e.rut); setQ(""); }} style={{ ...chico, textAlign: "left" }}>{e.nombre_entidad} · {e.rut}</button>)}
      </div>}
      {rut && <div style={{ marginTop: 4 }}>
        <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 6 }}>{nombre(claveInstitucion(rut)) || "Institución"} · {rut}</div>
        <ContactosLista rut={rut} nombreInstitucion={nombre(claveInstitucion(rut))} />
      </div>}
    </div>
  );
}
