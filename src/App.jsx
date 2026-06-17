import { useState, useEffect, useMemo } from "react";

// ════════════════════════════════════════════════════════════════════════════
// SUPABASE CONFIG
// ════════════════════════════════════════════════════════════════════════════
const SUPABASE_URL = "https://gypywxaugwuxbgmcqntp.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd5cHl3eGF1Z3d1eGJnbWNxbnRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2MjA4MjksImV4cCI6MjA5NzE5NjgyOX0.ujdKtdhFklJEPHy1vWlm8RLgPAQlo7sNNBGd_MbmibQ";
const SESSION_STORAGE_KEY = "bfk_supabase_session_v2";

// ─── AUTH HELPERS ────────────────────────────────────────────────────────────
async function supaSignUp(email, password, nombre) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, password, data: { nombre } }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.msg || "Error al registrar");
  return data;
}
async function supaSignIn(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.msg || "Credenciales inválidas");
  return data;
}
async function supaSignOut(accessToken) {
  try { await fetch(`${SUPABASE_URL}/auth/v1/logout`, { method: "POST", headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` } }); } catch {}
}
async function supaRefreshToken(refreshToken) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error("Sesión expirada");
  return data;
}

// ─── DATA HELPERS (PostgREST) ────────────────────────────────────────────────
function supaHeaders(accessToken) {
  return { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}`, Prefer: "return=representation" };
}
async function supaSelect(table, accessToken, query = "") {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*${query}`, { headers: supaHeaders(accessToken) });
  if (!res.ok) throw new Error(`Error al leer ${table}`);
  return res.json();
}
async function supaInsert(table, accessToken, row) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, { method: "POST", headers: supaHeaders(accessToken), body: JSON.stringify(row) });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message || `Error al insertar en ${table}`); }
  return res.json();
}
async function supaUpdate(table, accessToken, id, row) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, { method: "PATCH", headers: supaHeaders(accessToken), body: JSON.stringify(row) });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message || `Error al actualizar ${table}`); }
  return res.json();
}
async function supaDelete(table, accessToken, id) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, { method: "DELETE", headers: supaHeaders(accessToken) });
  if (!res.ok) throw new Error(`Error al eliminar de ${table}`);
}
async function supaGetPerfil(accessToken, userId) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/perfiles?id=eq.${userId}&select=*`, { headers: supaHeaders(accessToken) });
  if (!res.ok) return null;
  const arr = await res.json();
  return arr[0] || null;
}
async function supaListPerfiles(accessToken) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/perfiles?select=*`, { headers: supaHeaders(accessToken) });
  if (!res.ok) return [];
  return res.json();
}
async function supaUpdatePerfilRol(accessToken, userId, rol) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/perfiles?id=eq.${userId}`, { method: "PATCH", headers: supaHeaders(accessToken), body: JSON.stringify({ rol }) });
  if (!res.ok) throw new Error("Error al actualizar rol");
  return res.json();
}

// OC con todos sus eventos embebidos (PostgREST resource embedding)
async function supaListOCCompletas(accessToken) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/ordenes_compra_v2?select=*,vendedores(nombre),financiadores(nombre),eventos_compra(*),eventos_entrega(*),eventos_factura(*),eventos_pago_cliente(*),eventos_pago_financiamiento(*)&order=creadoEn.desc`,
    { headers: supaHeaders(accessToken) }
  );
  if (!res.ok) throw new Error("Error al leer órdenes de compra");
  return res.json();
}

// ─── STORAGE (sesión local del navegador) ────────────────────────────────────
async function storageGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
async function storageSet(key, value) { try { localStorage.setItem(key, value); } catch {} }

// ════════════════════════════════════════════════════════════════════════════
// DISEÑO: "TORRE DE CONTROL" — paleta y tokens visuales
// ════════════════════════════════════════════════════════════════════════════
const C = {
  // Base
  night: "#0B1120",      // fondo header/nav, azul noche profundo
  nightSoft: "#141B2E",  // paneles oscuros secundarios
  paper: "#F7F8FA",      // fondo general de trabajo
  card: "#FFFFFF",
  border: "#E2E5EB",
  borderDark: "#232C42",
  ink: "#0F172A",         // texto principal
  inkMuted: "#64748B",    // texto secundario
  inkFaint: "#94A3B8",

  // Acento de marca
  teal: "#14B8A6",
  tealLight: "#E6FBF8",
  tealDark: "#0D9488",

  // Estados semánticos
  ok: "#10B981", okLight: "#E7F8F0",
  warn: "#F59E0B", warnLight: "#FEF3E2",
  danger: "#EF4444", dangerLight: "#FEEAEA",
  transit: "#6366F1", transitLight: "#EEEDFC",
  info: "#3B82F6", infoLight: "#EAF2FF",
  purple: "#A855F7", purpleLight: "#F6EEFE",
};

const FONT_MONO = "'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace";
const FONT_SANS = "'Inter', system-ui, -apple-system, sans-serif";

const fmt = {
  money: (n) => "$" + Math.round(Number(n) || 0).toLocaleString("es-CL"),
  date: (d) => { if (!d) return "—"; const [y, m, dd] = d.split("-"); return `${dd}/${m}/${y.slice(2)}`; },
  dateLong: (d) => { if (!d) return "—"; const [y, m, dd] = d.split("-"); const meses = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"]; return `${dd} ${meses[Number(m)-1]} ${y}`; },
  datetime: (iso) => { if (!iso) return "—"; const d = new Date(iso); return d.toLocaleDateString("es-CL") + " " + d.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" }); },
};

// ════════════════════════════════════════════════════════════════════════════
// COMPONENTES BASE
// ════════════════════════════════════════════════════════════════════════════

function Modal({ title, onClose, children, wide }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(11,17,32,0.55)", backdropFilter: "blur(2px)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 100, padding: 0 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: C.card, borderRadius: "18px 18px 0 0", width: "100%", maxWidth: wide ? 560 : 460, maxHeight: "92vh", overflowY: "auto", boxShadow: "0 -8px 40px rgba(0,0,0,0.25)" }}>
        <div style={{ position: "sticky", top: 0, background: C.card, padding: "16px 20px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", zIndex: 2 }}>
          <span style={{ fontWeight: 800, fontSize: 15, color: C.ink, letterSpacing: -0.2 }}>{title}</span>
          <button onClick={onClose} style={{ background: C.paper, border: "none", borderRadius: 8, width: 30, height: 30, cursor: "pointer", fontSize: 15, color: C.inkMuted }}>✕</button>
        </div>
        <div style={{ padding: 20 }}>{children}</div>
      </div>
    </div>
  );
}

function Field({ label, required, hint, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: C.inkMuted, marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.3 }}>
        {label}{required && <span style={{ color: C.danger }}> *</span>}
      </label>
      {children}
      {hint && <div style={{ fontSize: 11, color: C.inkFaint, marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

const inputStyle = { width: "100%", padding: "10px 12px", borderRadius: 9, border: `1.5px solid ${C.border}`, fontSize: 14, color: C.ink, background: C.card, boxSizing: "border-box", fontFamily: FONT_SANS };
const inputMonoStyle = { ...inputStyle, fontFamily: FONT_MONO };
const selectStyle = { ...inputStyle, cursor: "pointer" };
const btnPrimary = (bg = C.teal) => ({ padding: "11px 16px", borderRadius: 10, border: "none", background: bg, color: "#fff", fontWeight: 700, fontSize: 13.5, cursor: "pointer", width: "100%" });
const btnGhost = { padding: "11px 16px", borderRadius: 10, border: `1.5px solid ${C.border}`, background: C.card, color: C.ink, fontWeight: 600, fontSize: 13.5, cursor: "pointer" };

// Badge de estado genérico (usa tokens semánticos)
function StatusDot({ ok, label, okLabel, pendingLabel }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px 3px 7px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: ok ? C.okLight : C.dangerLight, color: ok ? C.ok : C.danger, whiteSpace: "nowrap" }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: ok ? C.ok : C.danger, display: "inline-block" }} />
      {label || (ok ? (okLabel || "Hecho") : (pendingLabel || "Pendiente"))}
    </span>
  );
}

// Resumen visual de las 5 etapas de una OC, en una fila compacta de chips
function EtapasResumen({ oc }) {
  const etapas = [
    { key: "compra", ok: oc.estado_compra === "comprado", label: "Compra" },
    { key: "entrega", ok: oc.estado_entrega === "confirmada", label: "Entrega" },
    { key: "factura", ok: oc.estado_factura_propia === "emitida", label: "Factura" },
    { key: "pago_cliente", ok: oc.estado_pago_cliente === "pagado", label: "Cobro" },
    { key: "pago_financ", ok: oc.estado_pago_financiamiento === "pagado", label: "Financ." },
  ];
  return (
    <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
      {etapas.map(e => (
        <span key={e.key} style={{
          fontSize: 10, fontWeight: 700, padding: "3px 7px", borderRadius: 6,
          background: e.ok ? C.okLight : C.dangerLight, color: e.ok ? C.ok : C.danger,
          display: "inline-flex", alignItems: "center", gap: 3,
        }}>
          {e.ok ? "✓" : "○"} {e.label}
        </span>
      ))}
    </div>
  );
}

function Toast({ toast }) {
  if (!toast) return null;
  return (
    <div style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", background: toast.type === "error" ? C.danger : C.ink, color: "#fff", padding: "11px 20px", borderRadius: 10, fontSize: 13, fontWeight: 600, zIndex: 200, boxShadow: "0 8px 24px rgba(0,0,0,0.25)", maxWidth: "90vw", textAlign: "center" }}>
      {toast.msg}
    </div>
  );
}

// Quién + cuándo, para trazabilidad de eventos
function Trazabilidad({ creadoPor, creadoEn, perfiles }) {
  const usuario = perfiles?.find(p => p.id === creadoPor);
  return (
    <span style={{ fontSize: 10.5, color: C.inkFaint }}>
      {usuario ? usuario.nombre : "Usuario"} · {fmt.datetime(creadoEn)}
    </span>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// LOGIN
// ════════════════════════════════════════════════════════════════════════════
function LoginScreen({ onLogin }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nombre, setNombre] = useState("");
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setErr(""); setInfo("");
    if (!email.trim() || !password) { setErr("Completa correo y contraseña"); return; }
    setLoading(true);
    try { const session = await supaSignIn(email.trim(), password); await onLogin(session); }
    catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  };
  const handleSignup = async () => {
    setErr(""); setInfo("");
    if (!nombre.trim() || !email.trim() || !password) { setErr("Completa todos los campos"); return; }
    if (password.length < 6) { setErr("La contraseña debe tener al menos 6 caracteres"); return; }
    setLoading(true);
    try {
      const data = await supaSignUp(email.trim(), password, nombre.trim());
      if (data.access_token) await onLogin(data);
      else { setInfo("Cuenta creada. Revisa tu correo para confirmar, luego inicia sesión."); setMode("login"); }
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  };
  const submit = () => mode === "login" ? handleLogin() : handleSignup();

  return (
    <div style={{ minHeight: "100vh", background: `linear-gradient(165deg, ${C.night} 0%, #1A2540 60%, ${C.tealDark} 130%)`, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, fontFamily: FONT_SANS }}>
      <div style={{ background: C.card, borderRadius: 20, padding: "38px 30px", width: "100%", maxWidth: 380, boxShadow: "0 30px 70px rgba(0,0,0,0.35)" }}>
        <div style={{ textAlign: "center", marginBottom: 26 }}>
          <div style={{ width: 50, height: 50, background: C.night, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px", fontFamily: FONT_MONO, color: C.teal, fontWeight: 800, fontSize: 18 }}>BFK</div>
          <div style={{ fontWeight: 800, fontSize: 19, color: C.ink, letterSpacing: -0.3 }}>Torre de Control</div>
          <div style={{ fontSize: 12.5, color: C.inkMuted, marginTop: 3 }}>BFK Ltda · Ventas Mercado Público</div>
        </div>

        <div style={{ display: "flex", borderRadius: 10, background: C.paper, padding: 3, marginBottom: 22 }}>
          <button onClick={() => { setMode("login"); setErr(""); setInfo(""); }} style={{ flex: 1, padding: "8px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 700, background: mode === "login" ? C.card : "transparent", color: mode === "login" ? C.ink : C.inkMuted, boxShadow: mode === "login" ? "0 1px 4px rgba(0,0,0,0.08)" : "none" }}>Iniciar sesión</button>
          <button onClick={() => { setMode("signup"); setErr(""); setInfo(""); }} style={{ flex: 1, padding: "8px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 700, background: mode === "signup" ? C.card : "transparent", color: mode === "signup" ? C.ink : C.inkMuted, boxShadow: mode === "signup" ? "0 1px 4px rgba(0,0,0,0.08)" : "none" }}>Crear cuenta</button>
        </div>

        {err && <div style={{ background: C.dangerLight, color: C.danger, borderRadius: 9, padding: "9px 12px", fontSize: 12.5, marginBottom: 14, textAlign: "center", fontWeight: 600 }}>{err}</div>}
        {info && <div style={{ background: C.okLight, color: C.ok, borderRadius: 9, padding: "9px 12px", fontSize: 12.5, marginBottom: 14, textAlign: "center", fontWeight: 600 }}>{info}</div>}

        {mode === "signup" && (
          <Field label="Nombre completo"><input style={inputStyle} value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Tu nombre" onKeyDown={e => e.key === "Enter" && submit()} /></Field>
        )}
        <Field label="Correo"><input style={inputStyle} type="email" value={email} onChange={e => { setEmail(e.target.value); setErr(""); }} placeholder="correo@ejemplo.com" onKeyDown={e => e.key === "Enter" && submit()} /></Field>
        <Field label="Contraseña"><input style={inputStyle} type="password" value={password} onChange={e => { setPassword(e.target.value); setErr(""); }} placeholder="••••••••" onKeyDown={e => e.key === "Enter" && submit()} /></Field>

        <button onClick={submit} disabled={loading} style={{ ...btnPrimary(loading ? C.inkFaint : C.night), marginTop: 6 }}>
          {loading ? "Procesando…" : mode === "login" ? "Ingresar" : "Crear cuenta"}
        </button>
        <div style={{ textAlign: "center", fontSize: 11, color: C.inkFaint, marginTop: 16 }}>
          {mode === "login" ? '¿No tienes cuenta? Usa "Crear cuenta"' : "El primer usuario registrado será administrador."}
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// BUSCADOR DE OC POR NÚMERO (usado en todos los formularios rápidos de eventos)
// ════════════════════════════════════════════════════════════════════════════
function BuscadorOC({ ocs, ocId, setOcId, permitirNueva, numeroNueva, setNumeroNueva }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const matches = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return ocs.filter(o => o.numero_oc.toLowerCase().includes(q) || (o.cliente || "").toLowerCase().includes(q)).slice(0, 8);
  }, [query, ocs]);

  const selected = ocs.find(o => o.id === ocId);

  if (selected) {
    return (
      <div style={{ background: C.tealLight, border: `1.5px solid ${C.teal}`, borderRadius: 9, padding: "10px 12px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 13.5, color: C.ink, fontFamily: FONT_MONO }}>{selected.numero_oc}</div>
          <div style={{ fontSize: 11.5, color: C.inkMuted }}>{selected.cliente}</div>
        </div>
        <button onClick={() => { setOcId(null); setQuery(""); }} style={{ background: "none", border: "none", color: C.tealDark, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Cambiar</button>
      </div>
    );
  }

  return (
    <div style={{ position: "relative" }}>
      <input
        style={inputMonoStyle}
        placeholder="Escribe el N° de OC o cliente…"
        value={query}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
      />
      {open && query.trim() && (
        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", zIndex: 10, maxHeight: 220, overflowY: "auto" }}>
          {matches.length === 0 && (
            <div style={{ padding: 12, fontSize: 12.5, color: C.inkFaint }}>
              No se encontró ninguna OC con "{query}".
              {permitirNueva && (
                <button onClick={() => { setNumeroNueva(query.trim()); setOpen(false); }} style={{ display: "block", marginTop: 8, background: C.teal, color: "#fff", border: "none", borderRadius: 7, padding: "7px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer", width: "100%" }}>
                    + Crear OC nueva "{query.trim()}"
                  </button>
                )}
            </div>
          )}
          {matches.map(o => (
            <div key={o.id} onClick={() => { setOcId(o.id); setOpen(false); }} style={{ padding: "9px 12px", cursor: "pointer", borderBottom: `1px solid ${C.border}` }}>
              <div style={{ fontWeight: 700, fontSize: 13, fontFamily: FONT_MONO }}>{o.numero_oc}</div>
              <div style={{ fontSize: 11.5, color: C.inkMuted }}>{o.cliente}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// FORMULARIO RÁPIDO: INGRESAR COMPRA (crea la OC si no existe)
// ════════════════════════════════════════════════════════════════════════════
function FormIngresarCompra({ ocs, financiadores, vendedores, onSave, onClose }) {
  const [ocId, setOcId] = useState(null);
  const [numeroNueva, setNumeroNueva] = useState("");
  const [cliente, setCliente] = useState("");
  const [vendedorId, setVendedorId] = useState(vendedores[0]?.id || "");
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [montoVenta, setMontoVenta] = useState("");
  const [costoCompra, setCostoCompra] = useState("");
  const [fechaEntregaEst, setFechaEntregaEst] = useState("");
  const [financiadorId, setFinanciadorId] = useState(financiadores[0]?.id || "");
  const [proveedor, setProveedor] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const esNueva = !ocId && numeroNueva;

  const handleSave = async () => {
    if (!ocId && !numeroNueva) { setErr("Busca una OC existente o crea una nueva"); return; }
    if (esNueva && !cliente.trim()) { setErr("Indica el cliente para la nueva OC"); return; }
    if (!montoVenta || Number(montoVenta) <= 0) { setErr("Indica el monto de venta"); return; }
    if (!costoCompra || Number(costoCompra) < 0) { setErr("Indica el costo de compra"); return; }
    setErr(""); setSaving(true);
    try {
      await onSave({
        ocId, esNueva, numeroNueva, cliente, vendedorId,
        fecha, montoVenta: Number(montoVenta), costoCompra: Number(costoCompra),
        fechaEntregaEst: fechaEntregaEst || null, financiadorId, proveedor,
      });
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div>
      <Field label="Orden de Compra" required>
        <BuscadorOC ocs={ocs} ocId={ocId} setOcId={setOcId} permitirNueva numeroNueva={numeroNueva} setNumeroNueva={setNumeroNueva} />
        {esNueva && <div style={{ marginTop: 6, fontSize: 12, color: C.tealDark, fontWeight: 600 }}>📦 Nueva OC: {numeroNueva}</div>}
      </Field>
      {esNueva && (
        <Field label="Cliente" required><input style={inputStyle} value={cliente} onChange={e => setCliente(e.target.value)} placeholder="Nombre del cliente / municipalidad" /></Field>
      )}
      <Field label="Vendedor">
        <select style={selectStyle} value={vendedorId} onChange={e => setVendedorId(e.target.value)}>
          {vendedores.map(v => <option key={v.id} value={v.id}>{v.nombre}</option>)}
        </select>
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field label="Fecha de compra" required><input style={inputStyle} type="date" value={fecha} onChange={e => setFecha(e.target.value)} /></Field>
        <Field label="Fecha entrega estimada"><input style={inputStyle} type="date" value={fechaEntregaEst} onChange={e => setFechaEntregaEst(e.target.value)} /></Field>
        <Field label="Monto venta ($)" required><input style={inputMonoStyle} type="number" value={montoVenta} onChange={e => setMontoVenta(e.target.value)} placeholder="0" /></Field>
        <Field label="Costo compra ($)" required><input style={inputMonoStyle} type="number" value={costoCompra} onChange={e => setCostoCompra(e.target.value)} placeholder="0" /></Field>
      </div>
      <Field label="Financiador" required>
        <select style={selectStyle} value={financiadorId} onChange={e => setFinanciadorId(e.target.value)}>
          {financiadores.map(f => <option key={f.id} value={f.id}>{f.nombre}</option>)}
        </select>
      </Field>
      <Field label="Proveedor"><input style={inputStyle} value={proveedor} onChange={e => setProveedor(e.target.value)} placeholder="ej: Mercado Libre" /></Field>

      {err && <div style={{ background: C.dangerLight, color: C.danger, borderRadius: 8, padding: "8px 12px", fontSize: 12.5, marginBottom: 10, fontWeight: 600 }}>{err}</div>}
      <button onClick={handleSave} disabled={saving} style={btnPrimary(saving ? C.inkFaint : C.teal)}>{saving ? "Guardando…" : "✓ Registrar compra"}</button>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// FORMULARIO RÁPIDO: CONFIRMAR ENTREGA
// ════════════════════════════════════════════════════════════════════════════
function FormConfirmarEntrega({ ocs, onSave, onClose }) {
  const [ocId, setOcId] = useState(null);
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [personaRecibe, setPersonaRecibe] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!ocId) { setErr("Selecciona la OC"); return; }
    setErr(""); setSaving(true);
    try { await onSave({ ocId, fecha, personaRecibe }); }
    catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div>
      <Field label="Orden de Compra" required><BuscadorOC ocs={ocs} ocId={ocId} setOcId={setOcId} /></Field>
      <Field label="Fecha de entrega" required><input style={inputStyle} type="date" value={fecha} onChange={e => setFecha(e.target.value)} /></Field>
      <Field label="Persona que recibe"><input style={inputStyle} value={personaRecibe} onChange={e => setPersonaRecibe(e.target.value)} placeholder="Nombre de quien recibió" /></Field>
      {err && <div style={{ background: C.dangerLight, color: C.danger, borderRadius: 8, padding: "8px 12px", fontSize: 12.5, marginBottom: 10, fontWeight: 600 }}>{err}</div>}
      <button onClick={handleSave} disabled={saving} style={btnPrimary(saving ? C.inkFaint : C.transit)}>{saving ? "Guardando…" : "✓ Confirmar entrega"}</button>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// FORMULARIO RÁPIDO: EMITIR FACTURA
// ════════════════════════════════════════════════════════════════════════════
function FormEmitirFactura({ ocs, onSave, onClose }) {
  const [ocId, setOcId] = useState(null);
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [numeroFactura, setNumeroFactura] = useState("");
  const [monto, setMonto] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const selected = ocs.find(o => o.id === ocId);
  useEffect(() => { if (selected && !monto) setMonto(String(selected.monto_total || "")); }, [selected]);

  const handleSave = async () => {
    if (!ocId) { setErr("Selecciona la OC"); return; }
    if (!numeroFactura.trim()) { setErr("Indica el número de factura"); return; }
    if (!monto || Number(monto) <= 0) { setErr("Indica el monto de la factura"); return; }
    setErr(""); setSaving(true);
    try { await onSave({ ocId, fecha, numeroFactura: numeroFactura.trim(), monto: Number(monto) }); }
    catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div>
      <Field label="Orden de Compra" required><BuscadorOC ocs={ocs} ocId={ocId} setOcId={setOcId} /></Field>
      <Field label="Fecha de emisión" required><input style={inputStyle} type="date" value={fecha} onChange={e => setFecha(e.target.value)} /></Field>
      <Field label="N° de factura" required><input style={inputMonoStyle} value={numeroFactura} onChange={e => setNumeroFactura(e.target.value)} placeholder="ej: 215" /></Field>
      <Field label="Monto ($)" required hint="Se completó con el monto de venta de la OC; ajústalo si es necesario."><input style={inputMonoStyle} type="number" value={monto} onChange={e => setMonto(e.target.value)} /></Field>
      {err && <div style={{ background: C.dangerLight, color: C.danger, borderRadius: 8, padding: "8px 12px", fontSize: 12.5, marginBottom: 10, fontWeight: 600 }}>{err}</div>}
      <button onClick={handleSave} disabled={saving} style={btnPrimary(saving ? C.inkFaint : C.info)}>{saving ? "Guardando…" : "✓ Registrar emisión"}</button>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// FORMULARIO RÁPIDO: PAGO DE FACTURA (cliente paga)
// ════════════════════════════════════════════════════════════════════════════
function FormPagoCliente({ ocs, onSave, onClose }) {
  const [ocId, setOcId] = useState(null);
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [monto, setMonto] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const selected = ocs.find(o => o.id === ocId);
  const saldoPendiente = selected ? (selected.monto_facturado || 0) - (selected.monto_cobrado || 0) : 0;
  useEffect(() => { if (selected && !monto) setMonto(String(saldoPendiente || "")); }, [selected]);

  const handleSave = async () => {
    if (!ocId) { setErr("Selecciona la OC"); return; }
    if (!monto || Number(monto) <= 0) { setErr("Indica el monto pagado"); return; }
    setErr(""); setSaving(true);
    try { await onSave({ ocId, fecha, monto: Number(monto) }); }
    catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div>
      <Field label="Orden de Compra" required><BuscadorOC ocs={ocs} ocId={ocId} setOcId={setOcId} /></Field>
      {selected && (
        <div style={{ background: C.paper, borderRadius: 8, padding: "8px 12px", fontSize: 12, color: C.inkMuted, marginBottom: 12 }}>
          Facturado: <b style={{ color: C.ink }}>{fmt.money(selected.monto_facturado)}</b> · Cobrado: <b style={{ color: C.ok }}>{fmt.money(selected.monto_cobrado)}</b> · Saldo: <b style={{ color: C.danger }}>{fmt.money(saldoPendiente)}</b>
        </div>
      )}
      <Field label="Fecha de pago" required><input style={inputStyle} type="date" value={fecha} onChange={e => setFecha(e.target.value)} /></Field>
      <Field label="Monto pagado ($)" required><input style={inputMonoStyle} type="number" value={monto} onChange={e => setMonto(e.target.value)} /></Field>
      {err && <div style={{ background: C.dangerLight, color: C.danger, borderRadius: 8, padding: "8px 12px", fontSize: 12.5, marginBottom: 10, fontWeight: 600 }}>{err}</div>}
      <button onClick={handleSave} disabled={saving} style={btnPrimary(saving ? C.inkFaint : C.ok)}>{saving ? "Guardando…" : "✓ Registrar pago"}</button>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// FORMULARIO RÁPIDO: PAGO DE FINANCIAMIENTO (a Kevin/Byron/Francisco)
// ════════════════════════════════════════════════════════════════════════════
function FormPagoFinanciamiento({ ocs, financiadores, onSave, onClose }) {
  const [financiadorId, setFinanciadorId] = useState(financiadores[0]?.id || "");
  const [ocId, setOcId] = useState(null);
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [monto, setMonto] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const financiador = financiadores.find(f => f.id === financiadorId);

  const handleSave = async () => {
    if (!monto || Number(monto) <= 0) { setErr("Indica el monto pagado"); return; }
    setErr(""); setSaving(true);
    try { await onSave({ financiadorId, ocId, fecha, monto: Number(monto) }); }
    catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div>
      <Field label="Financiador" required>
        <select style={selectStyle} value={financiadorId} onChange={e => setFinanciadorId(e.target.value)}>
          {financiadores.map(f => <option key={f.id} value={f.id}>{f.nombre}</option>)}
        </select>
      </Field>
      {financiador && (
        <div style={{ background: C.paper, borderRadius: 8, padding: "8px 12px", fontSize: 12, color: C.inkMuted, marginBottom: 12 }}>
          Deuda actual: <b style={{ color: C.danger }}>{fmt.money(financiador.saldo_deuda)}</b>
        </div>
      )}
      <Field label="OC relacionada (opcional)"><BuscadorOC ocs={ocs} ocId={ocId} setOcId={setOcId} /></Field>
      <Field label="Fecha de pago" required><input style={inputStyle} type="date" value={fecha} onChange={e => setFecha(e.target.value)} /></Field>
      <Field label="Monto pagado ($)" required hint="Este monto se descuenta automáticamente de la deuda."><input style={inputMonoStyle} type="number" value={monto} onChange={e => setMonto(e.target.value)} /></Field>
      {err && <div style={{ background: C.dangerLight, color: C.danger, borderRadius: 8, padding: "8px 12px", fontSize: 12.5, marginBottom: 10, fontWeight: 600 }}>{err}</div>}
      <button onClick={handleSave} disabled={saving} style={btnPrimary(saving ? C.inkFaint : C.purple)}>{saving ? "Guardando…" : "✓ Registrar pago a financiador"}</button>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// PANEL: KPIs principales (Dashboard)
// ════════════════════════════════════════════════════════════════════════════
function KpiCard({ label, value, sub, color }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "14px 16px", flex: "1 1 150px", minWidth: 150 }}>
      <div style={{ fontSize: 11, color: C.inkMuted, fontWeight: 600, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: color || C.ink, fontFamily: FONT_MONO, letterSpacing: -0.5 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: C.inkFaint, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function PanelDashboard({ ocs, financiadores, onNavigate }) {
  const kpis = useMemo(() => {
    let ingresos = 0, porCobrar = 0, deudaTotal = 0, utilidad = 0, comprasPendientes = 0, entregasPendientes = 0, facturasPorEmitir = 0;
    for (const oc of ocs) {
      ingresos += oc.monto_cobrado || 0;
      porCobrar += (oc.monto_facturado || 0) - (oc.monto_cobrado || 0);
      utilidad += (oc.monto_total || 0) - (oc.costo_total || 0);
      if (oc.estado_compra !== "comprado") comprasPendientes++;
      if (oc.estado_entrega !== "confirmada") entregasPendientes++;
      if (oc.estado_factura_propia !== "emitida") facturasPorEmitir++;
    }
    deudaTotal = financiadores.reduce((s, f) => s + (Number(f.saldo_deuda) || 0), 0);
    return { ingresos, porCobrar, deudaTotal, utilidad, comprasPendientes, entregasPendientes, facturasPorEmitir };
  }, [ocs, financiadores]);

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 18 }}>
        <KpiCard label="Ingresos cobrados" value={fmt.money(kpis.ingresos)} color={C.ok} />
        <KpiCard label="Por cobrar" value={fmt.money(kpis.porCobrar)} color={C.warn} />
        <KpiCard label="Deuda a financiadores" value={fmt.money(kpis.deudaTotal)} color={C.danger} />
        <KpiCard label="Utilidad bruta" value={fmt.money(kpis.utilidad)} color={C.teal} />
      </div>

      <div style={{ fontSize: 12.5, fontWeight: 800, color: C.inkMuted, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4 }}>Pendientes por gestionar</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <button onClick={() => onNavigate("compras", "compra")} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: C.card, border: `1px solid ${C.border}`, borderLeft: `4px solid ${C.danger}`, borderRadius: 12, padding: "13px 16px", cursor: "pointer", textAlign: "left" }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: C.ink }}>Compras pendientes de realizar</span>
          <span style={{ fontFamily: FONT_MONO, fontWeight: 800, fontSize: 18, color: C.danger }}>{kpis.comprasPendientes}</span>
        </button>
        <button onClick={() => onNavigate("compras", "entrega")} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: C.card, border: `1px solid ${C.border}`, borderLeft: `4px solid ${C.transit}`, borderRadius: 12, padding: "13px 16px", cursor: "pointer", textAlign: "left" }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: C.ink }}>Entregas sin confirmar</span>
          <span style={{ fontFamily: FONT_MONO, fontWeight: 800, fontSize: 18, color: C.transit }}>{kpis.entregasPendientes}</span>
        </button>
        <button onClick={() => onNavigate("compras", "factura")} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: C.card, border: `1px solid ${C.border}`, borderLeft: `4px solid ${C.info}`, borderRadius: 12, padding: "13px 16px", cursor: "pointer", textAlign: "left" }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: C.ink }}>Facturas por emitir</span>
          <span style={{ fontFamily: FONT_MONO, fontWeight: 800, fontSize: 18, color: C.info }}>{kpis.facturasPorEmitir}</span>
        </button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// PANEL: COMPRAS — listado de OC con filtros combinables por las 5 etapas
// ════════════════════════════════════════════════════════════════════════════
const FILTROS_ETAPA = [
  { key: "compra", label: "Compra", okField: "estado_compra", okValue: "comprado", okLabel: "Comprado", pendLabel: "Pendiente" },
  { key: "entrega", label: "Entrega", okField: "estado_entrega", okValue: "confirmada", okLabel: "Confirmada", pendLabel: "Sin confirmar" },
  { key: "factura", label: "Factura", okField: "estado_factura_propia", okValue: "emitida", okLabel: "Emitida", pendLabel: "Por emitir" },
  { key: "pago_cliente", label: "Cobro", okField: "estado_pago_cliente", okValue: "pagado", okLabel: "Cobrado", pendLabel: "Por cobrar" },
  { key: "pago_financ", label: "Financ.", okField: "estado_pago_financiamiento", okValue: "pagado", okLabel: "Pagado", pendLabel: "Con deuda" },
];

function FilaOC({ oc, perfiles, expanded, onToggle }) {
  const saldoPendienteCliente = (oc.monto_facturado || 0) - (oc.monto_cobrado || 0);
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 13, marginBottom: 8, overflow: "hidden" }}>
      <div onClick={onToggle} style={{ padding: "13px 15px", cursor: "pointer" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
          <div>
            <div style={{ fontFamily: FONT_MONO, fontWeight: 800, fontSize: 14, color: C.ink }}>{oc.numero_oc}</div>
            <div style={{ fontSize: 11.5, color: C.inkMuted }}>{oc.cliente}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontFamily: FONT_MONO, fontWeight: 800, fontSize: 14, color: C.ok }}>{fmt.money(oc.monto_total)}</div>
            <div style={{ fontSize: 10.5, color: C.inkFaint }}>costo {fmt.money(oc.costo_total)}</div>
          </div>
        </div>
        <EtapasResumen oc={oc} />
      </div>
      {expanded && (
        <div style={{ borderTop: `1px solid ${C.border}`, padding: "13px 15px", background: C.paper }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 12, color: C.inkMuted, marginBottom: 10 }}>
            <div>Vendedor: <b style={{ color: C.ink }}>{oc.vendedores?.nombre || "—"}</b></div>
            <div>Financiador: <b style={{ color: C.ink }}>{oc.financiadores?.nombre || "—"}</b></div>
            <div>Facturado: <b style={{ color: C.ink }}>{fmt.money(oc.monto_facturado)}</b></div>
            <div>Saldo por cobrar: <b style={{ color: saldoPendienteCliente > 0 ? C.danger : C.ok }}>{fmt.money(saldoPendienteCliente)}</b></div>
          </div>
          <div style={{ fontSize: 11, fontWeight: 800, color: C.inkMuted, textTransform: "uppercase", marginBottom: 6, letterSpacing: 0.3 }}>Historial de eventos</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {(oc.eventos_compra || []).map(e => (
              <div key={e.id} style={{ fontSize: 11.5, color: C.ink, display: "flex", justifyContent: "space-between" }}>
                <span>📦 Compra · {fmt.date(e.fecha)}</span>
                <Trazabilidad creadoPor={e.creado_por} creadoEn={e.creadoEn} perfiles={perfiles} />
              </div>
            ))}
            {(oc.eventos_entrega || []).map(e => (
              <div key={e.id} style={{ fontSize: 11.5, color: C.ink, display: "flex", justifyContent: "space-between" }}>
                <span>🚚 Entrega · {fmt.date(e.fecha)}</span>
                <Trazabilidad creadoPor={e.creado_por} creadoEn={e.creadoEn} perfiles={perfiles} />
              </div>
            ))}
            {(oc.eventos_factura || []).map(e => (
              <div key={e.id} style={{ fontSize: 11.5, color: C.ink, display: "flex", justifyContent: "space-between" }}>
                <span>🧾 Factura {e.numero_factura} · {fmt.date(e.fecha)}</span>
                <Trazabilidad creadoPor={e.creado_por} creadoEn={e.creadoEn} perfiles={perfiles} />
              </div>
            ))}
            {(oc.eventos_pago_cliente || []).map(e => (
              <div key={e.id} style={{ fontSize: 11.5, color: C.ink, display: "flex", justifyContent: "space-between" }}>
                <span>💰 Pago cliente {fmt.money(e.monto)} · {fmt.date(e.fecha)}</span>
                <Trazabilidad creadoPor={e.creado_por} creadoEn={e.creadoEn} perfiles={perfiles} />
              </div>
            ))}
            {(oc.eventos_pago_financiamiento || []).map(e => (
              <div key={e.id} style={{ fontSize: 11.5, color: C.ink, display: "flex", justifyContent: "space-between" }}>
                <span>🏦 Pago financiador {fmt.money(e.monto)} · {fmt.date(e.fecha)}</span>
                <Trazabilidad creadoPor={e.creado_por} creadoEn={e.creadoEn} perfiles={perfiles} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PanelCompras({ ocs, perfiles, filtroInicial }) {
  const [filtros, setFiltros] = useState({}); // { compra: 'ok'|'pend'|undefined, ... }
  const [busqueda, setBusqueda] = useState("");
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    if (filtroInicial) setFiltros({ [filtroInicial]: "pend" });
  }, [filtroInicial]);

  const toggleFiltro = (key, val) => {
    setFiltros(prev => ({ ...prev, [key]: prev[key] === val ? undefined : val }));
  };

  const filtered = useMemo(() => {
    return ocs.filter(oc => {
      if (busqueda.trim()) {
        const q = busqueda.toLowerCase();
        if (!oc.numero_oc.toLowerCase().includes(q) && !(oc.cliente || "").toLowerCase().includes(q)) return false;
      }
      for (const f of FILTROS_ETAPA) {
        const sel = filtros[f.key];
        if (!sel) continue;
        const isOk = oc[f.okField] === f.okValue;
        if (sel === "ok" && !isOk) return false;
        if (sel === "pend" && isOk) return false;
      }
      return true;
    });
  }, [ocs, filtros, busqueda]);

  return (
    <div>
      <input style={{ ...inputStyle, marginBottom: 12 }} placeholder="Buscar por N° de OC o cliente…" value={busqueda} onChange={e => setBusqueda(e.target.value)} />

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        {FILTROS_ETAPA.map(f => (
          <div key={f.key} style={{ display: "flex", gap: 3 }}>
            <button onClick={() => toggleFiltro(f.key, "pend")} style={{ fontSize: 11, fontWeight: 700, padding: "5px 9px", borderRadius: 7, border: `1.5px solid ${filtros[f.key] === "pend" ? C.danger : C.border}`, background: filtros[f.key] === "pend" ? C.dangerLight : C.card, color: filtros[f.key] === "pend" ? C.danger : C.inkMuted, cursor: "pointer" }}>
              {f.label}: {f.pendLabel}
            </button>
            <button onClick={() => toggleFiltro(f.key, "ok")} style={{ fontSize: 11, fontWeight: 700, padding: "5px 9px", borderRadius: 7, border: `1.5px solid ${filtros[f.key] === "ok" ? C.ok : C.border}`, background: filtros[f.key] === "ok" ? C.okLight : C.card, color: filtros[f.key] === "ok" ? C.ok : C.inkMuted, cursor: "pointer" }}>
              {f.okLabel}
            </button>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 11.5, color: C.inkFaint, marginBottom: 10 }}>{filtered.length} orden{filtered.length !== 1 ? "es" : ""} de compra</div>

      {filtered.map(oc => (
        <FilaOC key={oc.id} oc={oc} perfiles={perfiles} expanded={expandedId === oc.id} onToggle={() => setExpandedId(expandedId === oc.id ? null : oc.id)} />
      ))}
      {filtered.length === 0 && <div style={{ textAlign: "center", padding: 30, color: C.inkFaint, fontSize: 13 }}>No hay órdenes que coincidan con estos filtros.</div>}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// PANEL: FINANCIAMIENTO — saldo por financiador + ajuste manual
// ════════════════════════════════════════════════════════════════════════════
function FormAjusteSaldo({ financiador, onSave, onClose }) {
  const [montoAjuste, setMontoAjuste] = useState("");
  const [tipo, setTipo] = useState("sumar"); // sumar | restar
  const [motivo, setMotivo] = useState("");
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!montoAjuste || Number(montoAjuste) <= 0) { setErr("Indica un monto"); return; }
    if (!motivo.trim()) { setErr("Indica el motivo del ajuste"); return; }
    setErr(""); setSaving(true);
    const montoFinal = tipo === "sumar" ? Number(montoAjuste) : -Number(montoAjuste);
    try { await onSave({ financiadorId: financiador.id, fecha, montoAjuste: montoFinal, motivo: motivo.trim() }); }
    catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div>
      <div style={{ background: C.paper, borderRadius: 8, padding: "8px 12px", fontSize: 12.5, color: C.inkMuted, marginBottom: 14 }}>
        Saldo actual de <b style={{ color: C.ink }}>{financiador.nombre}</b>: <b style={{ color: C.danger }}>{fmt.money(financiador.saldo_deuda)}</b>
      </div>
      <Field label="Tipo de ajuste">
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setTipo("sumar")} style={{ flex: 1, padding: "9px", borderRadius: 9, border: `1.5px solid ${tipo === "sumar" ? C.danger : C.border}`, background: tipo === "sumar" ? C.dangerLight : C.card, color: tipo === "sumar" ? C.danger : C.inkMuted, fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>+ Aumentar deuda</button>
          <button onClick={() => setTipo("restar")} style={{ flex: 1, padding: "9px", borderRadius: 9, border: `1.5px solid ${tipo === "restar" ? C.ok : C.border}`, background: tipo === "restar" ? C.okLight : C.card, color: tipo === "restar" ? C.ok : C.inkMuted, fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>− Reducir deuda</button>
        </div>
      </Field>
      <Field label="Monto del ajuste ($)" required><input style={inputMonoStyle} type="number" value={montoAjuste} onChange={e => setMontoAjuste(e.target.value)} /></Field>
      <Field label="Fecha" required><input style={inputStyle} type="date" value={fecha} onChange={e => setFecha(e.target.value)} /></Field>
      <Field label="Motivo del ajuste" required hint="Quedará registrado en el historial de auditoría."><input style={inputStyle} value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="ej: corrección de saldo histórico" /></Field>
      {err && <div style={{ background: C.dangerLight, color: C.danger, borderRadius: 8, padding: "8px 12px", fontSize: 12.5, marginBottom: 10, fontWeight: 600 }}>{err}</div>}
      <button onClick={handleSave} disabled={saving} style={btnPrimary(saving ? C.inkFaint : C.purple)}>{saving ? "Guardando…" : "✓ Aplicar ajuste"}</button>
    </div>
  );
}

function PanelFinanciamiento({ financiadores, ajustes, perfiles, onAjustar }) {
  const [ajustando, setAjustando] = useState(null);
  const [verHistorial, setVerHistorial] = useState(null);

  return (
    <div>
      {financiadores.map(f => {
        const historialF = ajustes.filter(a => a.financiador_id === f.id);
        return (
          <div key={f.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 16, marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 15, color: C.ink }}>{f.nombre}</div>
                <div style={{ fontFamily: FONT_MONO, fontWeight: 800, fontSize: 20, color: Number(f.saldo_deuda) > 0 ? C.danger : C.ok, marginTop: 2 }}>{fmt.money(f.saldo_deuda)}</div>
              </div>
              <button onClick={() => setAjustando(f)} style={btnGhost}>Ajustar saldo</button>
            </div>
            {historialF.length > 0 && (
              <button onClick={() => setVerHistorial(verHistorial === f.id ? null : f.id)} style={{ background: "none", border: "none", color: C.tealDark, fontSize: 11.5, fontWeight: 700, cursor: "pointer", marginTop: 10, padding: 0 }}>
                {verHistorial === f.id ? "Ocultar" : "Ver"} historial de ajustes ({historialF.length})
              </button>
            )}
            {verHistorial === f.id && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.border}`, display: "flex", flexDirection: "column", gap: 6 }}>
                {historialF.map(a => (
                  <div key={a.id} style={{ fontSize: 11.5 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: a.monto_ajuste > 0 ? C.danger : C.ok, fontWeight: 700 }}>{a.monto_ajuste > 0 ? "+" : ""}{fmt.money(a.monto_ajuste)}</span>
                      <Trazabilidad creadoPor={a.creado_por} creadoEn={a.creadoEn} perfiles={perfiles} />
                    </div>
                    <div style={{ color: C.inkMuted }}>{a.motivo}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {ajustando && (
        <Modal title={`Ajustar saldo · ${ajustando.nombre}`} onClose={() => setAjustando(null)}>
          <FormAjusteSaldo financiador={ajustando} onClose={() => setAjustando(null)} onSave={async (data) => { await onAjustar(data); setAjustando(null); }} />
        </Modal>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// PANEL: GASTOS — categorías inteligentes con subcategoría sugerida
// ════════════════════════════════════════════════════════════════════════════
function FormNuevoGasto({ categorias, onSave, onClose }) {
  const [categoriaId, setCategoriaId] = useState(categorias[0]?.id || "");
  const [subcategoria, setSubcategoria] = useState("");
  const [monto, setMonto] = useState("");
  const [mes, setMes] = useState(new Date().getMonth() + 1);
  const [anio, setAnio] = useState(new Date().getFullYear());
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [detalle, setDetalle] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const categoria = categorias.find(c => c.id === categoriaId);
  const subs = categoria?.subcategorias || [];

  const handleSubChange = (nombreSub) => {
    setSubcategoria(nombreSub);
    const sub = subs.find(s => s.nombre === nombreSub);
    if (sub && sub.monto_sugerido) setMonto(String(sub.monto_sugerido));
  };

  const handleSave = async () => {
    if (!monto || Number(monto) <= 0) { setErr("Indica el monto"); return; }
    setErr(""); setSaving(true);
    try { await onSave({ categoriaId, subcategoria, monto: Number(monto), mes: Number(mes), anio: Number(anio), fecha, detalle }); }
    catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  const meses = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

  return (
    <div>
      <Field label="Categoría" required>
        <select style={selectStyle} value={categoriaId} onChange={e => { setCategoriaId(e.target.value); setSubcategoria(""); }}>
          {categorias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
      </Field>
      {subs.length > 0 && (
        <Field label="Subcategoría">
          <select style={selectStyle} value={subcategoria} onChange={e => handleSubChange(e.target.value)}>
            <option value="">Selecciona…</option>
            {subs.map(s => <option key={s.nombre} value={s.nombre}>{s.nombre}{s.monto_sugerido ? ` (sugerido ${fmt.money(s.monto_sugerido)})` : ""}</option>)}
          </select>
        </Field>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field label="Mes" required>
          <select style={selectStyle} value={mes} onChange={e => setMes(e.target.value)}>
            {meses.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
        </Field>
        <Field label="Año" required><input style={inputMonoStyle} type="number" value={anio} onChange={e => setAnio(e.target.value)} /></Field>
      </div>
      <Field label="Fecha de pago" required><input style={inputStyle} type="date" value={fecha} onChange={e => setFecha(e.target.value)} /></Field>
      <Field label="Monto ($)" required><input style={inputMonoStyle} type="number" value={monto} onChange={e => setMonto(e.target.value)} /></Field>
      <Field label="Detalle (opcional)"><input style={inputStyle} value={detalle} onChange={e => setDetalle(e.target.value)} /></Field>
      {err && <div style={{ background: C.dangerLight, color: C.danger, borderRadius: 8, padding: "8px 12px", fontSize: 12.5, marginBottom: 10, fontWeight: 600 }}>{err}</div>}
      <button onClick={handleSave} disabled={saving} style={btnPrimary(saving ? C.inkFaint : C.warn)}>{saving ? "Guardando…" : "✓ Registrar gasto"}</button>
    </div>
  );
}

function PanelGastos({ gastos, categorias, onNuevoGasto }) {
  const [showForm, setShowForm] = useState(false);

  const ultimoPorCategoria = useMemo(() => {
    const map = {};
    for (const g of gastos) {
      const key = g.categoria_id;
      if (!map[key] || `${g.anio}-${g.mes}` > `${map[key].anio}-${map[key].mes}`) map[key] = g;
    }
    return map;
  }, [gastos]);

  return (
    <div>
      <button onClick={() => setShowForm(true)} style={{ ...btnPrimary(C.warn), marginBottom: 16 }}>+ Registrar gasto</button>

      <div style={{ fontSize: 12.5, fontWeight: 800, color: C.inkMuted, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4 }}>Último mes pagado por categoría</div>
      {categorias.map(c => {
        const ultimo = ultimoPorCategoria[c.id];
        return (
          <div key={c.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "12px 15px", marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13.5, color: C.ink }}>{c.nombre}</div>
              {ultimo ? <div style={{ fontSize: 11.5, color: C.inkMuted }}>{ultimo.subcategoria || "—"} · {fmt.dateLong(ultimo.fecha)}</div> : <div style={{ fontSize: 11.5, color: C.inkFaint }}>Sin pagos registrados</div>}
            </div>
            {ultimo && <div style={{ fontFamily: FONT_MONO, fontWeight: 800, fontSize: 15, color: C.warn }}>{fmt.money(ultimo.monto)}</div>}
          </div>
        );
      })}

      {showForm && (
        <Modal title="Registrar gasto" onClose={() => setShowForm(false)}>
          <FormNuevoGasto categorias={categorias} onClose={() => setShowForm(false)} onSave={async (data) => { await onNuevoGasto(data); setShowForm(false); }} />
        </Modal>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// PANEL: VENDEDORES — IVA mensual + cálculo de pago (Utilidad/2 - IVA/2 + ventas propias)
// ════════════════════════════════════════════════════════════════════════════
function FormIvaMensual({ ivaExistente, onSave, onClose }) {
  const hoy = new Date();
  const [mes, setMes] = useState(ivaExistente?.mes || hoy.getMonth() + 1);
  const [anio, setAnio] = useState(ivaExistente?.anio || hoy.getFullYear());
  const [ventasNetas, setVentasNetas] = useState(ivaExistente?.ventas_netas || "");
  const [ivaVentas, setIvaVentas] = useState(ivaExistente?.iva_ventas || "");
  const [comprasNetas, setComprasNetas] = useState(ivaExistente?.compras_netas || "");
  const [ivaCompras, setIvaCompras] = useState(ivaExistente?.iva_compras || "");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const ivaPagado = Math.max(0, Number(ivaVentas || 0) - Number(ivaCompras || 0));

  const handleSave = async () => {
    setErr(""); setSaving(true);
    try {
      await onSave({
        mes: Number(mes), anio: Number(anio),
        ventasNetas: Number(ventasNetas) || 0, ivaVentas: Number(ivaVentas) || 0,
        comprasNetas: Number(comprasNetas) || 0, ivaCompras: Number(ivaCompras) || 0,
        ivaPagado,
      });
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  const meses = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field label="Mes" required><select style={selectStyle} value={mes} onChange={e => setMes(e.target.value)}>{meses.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}</select></Field>
        <Field label="Año" required><input style={inputMonoStyle} type="number" value={anio} onChange={e => setAnio(e.target.value)} /></Field>
        <Field label="Ventas netas ($)"><input style={inputMonoStyle} type="number" value={ventasNetas} onChange={e => setVentasNetas(e.target.value)} /></Field>
        <Field label="IVA ventas (débito) ($)"><input style={inputMonoStyle} type="number" value={ivaVentas} onChange={e => setIvaVentas(e.target.value)} /></Field>
        <Field label="Compras netas ($)"><input style={inputMonoStyle} type="number" value={comprasNetas} onChange={e => setComprasNetas(e.target.value)} /></Field>
        <Field label="IVA compras (crédito) ($)"><input style={inputMonoStyle} type="number" value={ivaCompras} onChange={e => setIvaCompras(e.target.value)} /></Field>
      </div>
      <div style={{ background: C.tealLight, borderRadius: 9, padding: "10px 12px", fontSize: 13, color: C.tealDark, fontWeight: 700, marginBottom: 14 }}>
        IVA a pagar este mes: {fmt.money(ivaPagado)}
      </div>
      {err && <div style={{ background: C.dangerLight, color: C.danger, borderRadius: 8, padding: "8px 12px", fontSize: 12.5, marginBottom: 10, fontWeight: 600 }}>{err}</div>}
      <button onClick={handleSave} disabled={saving} style={btnPrimary(saving ? C.inkFaint : C.info)}>{saving ? "Guardando…" : "✓ Guardar IVA del mes"}</button>
    </div>
  );
}

function FormPagoVendedor({ vendedor, ivaMes, utilidadMes, onSave, onClose }) {
  const hoy = new Date();
  const [mes] = useState(hoy.getMonth() + 1);
  const [anio] = useState(hoy.getFullYear());
  const [ventasPropias, setVentasPropias] = useState("");
  const [fecha, setFecha] = useState(hoy.toISOString().slice(0, 10));
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const ivaPagadoMes = ivaMes?.iva_pagado || 0;
  const montoCalculado = (utilidadMes / 2) - (ivaPagadoMes / 2) + (Number(ventasPropias) || 0);

  const handleSave = async () => {
    setErr(""); setSaving(true);
    try {
      await onSave({
        vendedorId: vendedor.id, mes, anio, fecha,
        utilidadMes, ivaPagadoMes, ventasPropias: Number(ventasPropias) || 0,
        montoCalculado,
      });
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div>
      <div style={{ background: C.paper, borderRadius: 9, padding: 12, fontSize: 12.5, color: C.inkMuted, marginBottom: 14, lineHeight: 1.6 }}>
        Utilidad del mes: <b style={{ color: C.ink }}>{fmt.money(utilidadMes)}</b><br />
        IVA pagado del mes: <b style={{ color: C.ink }}>{fmt.money(ivaPagadoMes)}</b>
        {!ivaMes && <span style={{ color: C.warn }}> (sin registrar — se asume $0)</span>}
      </div>
      <Field label="Ventas propias del vendedor ($)" required><input style={inputMonoStyle} type="number" value={ventasPropias} onChange={e => setVentasPropias(e.target.value)} /></Field>
      <Field label="Fecha de pago" required><input style={inputStyle} type="date" value={fecha} onChange={e => setFecha(e.target.value)} /></Field>
      <div style={{ background: C.tealLight, borderRadius: 9, padding: "12px 14px", marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: C.tealDark, fontWeight: 700, textTransform: "uppercase" }}>Monto a pagar</div>
        <div style={{ fontFamily: FONT_MONO, fontWeight: 800, fontSize: 22, color: C.tealDark }}>{fmt.money(montoCalculado)}</div>
        <div style={{ fontSize: 10.5, color: C.tealDark, marginTop: 4 }}>(Utilidad/2) − (IVA/2) + ventas propias</div>
      </div>
      {err && <div style={{ background: C.dangerLight, color: C.danger, borderRadius: 8, padding: "8px 12px", fontSize: 12.5, marginBottom: 10, fontWeight: 600 }}>{err}</div>}
      <button onClick={handleSave} disabled={saving} style={btnPrimary(saving ? C.inkFaint : C.teal)}>{saving ? "Guardando…" : "✓ Registrar pago"}</button>
    </div>
  );
}

function PanelVendedores({ vendedores, ocs, ivaMensual, pagosVendedor, onGuardarIva, onPagarVendedor }) {
  const [pagando, setPagando] = useState(null);
  const [editandoIva, setEditandoIva] = useState(false);

  const hoy = new Date();
  const mesActual = hoy.getMonth() + 1, anioActual = hoy.getFullYear();
  const ivaMes = ivaMensual.find(i => i.mes === mesActual && i.anio === anioActual);

  const utilidadMes = useMemo(() => {
    return ocs.filter(oc => (oc.eventos_compra || []).some(e => {
      const f = new Date(e.fecha); return f.getMonth() + 1 === mesActual && f.getFullYear() === anioActual;
    })).reduce((s, oc) => s + ((oc.monto_total || 0) - (oc.costo_total || 0)), 0);
  }, [ocs, mesActual, anioActual]);

  return (
    <div>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 16, marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div style={{ fontWeight: 800, fontSize: 14, color: C.ink }}>IVA del mes actual</div>
          <button onClick={() => setEditandoIva(true)} style={btnGhost}>{ivaMes ? "Editar" : "Registrar"}</button>
        </div>
        {ivaMes ? (
          <div style={{ fontFamily: FONT_MONO, fontWeight: 800, fontSize: 19, color: C.info }}>{fmt.money(ivaMes.iva_pagado)}</div>
        ) : (
          <div style={{ fontSize: 12.5, color: C.inkFaint }}>Sin registrar este mes.</div>
        )}
      </div>

      {vendedores.map(v => (
        <div key={v.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 16, marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontWeight: 800, fontSize: 14.5, color: C.ink }}>{v.nombre}</div>
            <button onClick={() => setPagando(v)} style={btnGhost}>Calcular pago</button>
          </div>
          <div style={{ fontSize: 11.5, color: C.inkFaint, marginTop: 4 }}>
            {pagosVendedor.filter(p => p.vendedor_id === v.id).length} pago(s) registrado(s)
          </div>
        </div>
      ))}

      {editandoIva && (
        <Modal title="IVA mensual" onClose={() => setEditandoIva(false)}>
          <FormIvaMensual ivaExistente={ivaMes} onClose={() => setEditandoIva(false)} onSave={async (data) => { await onGuardarIva(data); setEditandoIva(false); }} />
        </Modal>
      )}
      {pagando && (
        <Modal title={`Calcular pago · ${pagando.nombre}`} onClose={() => setPagando(null)}>
          <FormPagoVendedor vendedor={pagando} ivaMes={ivaMes} utilidadMes={utilidadMes} onClose={() => setPagando(null)} onSave={async (data) => { await onPagarVendedor(data); setPagando(null); }} />
        </Modal>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// PANEL: USUARIOS (solo admin)
// ════════════════════════════════════════════════════════════════════════════
function PanelUsuarios({ perfiles, onChangeRol }) {
  return (
    <div>
      {perfiles.map(p => (
        <div key={p.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "12px 15px", marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13.5, color: C.ink }}>{p.nombre}</div>
            <div style={{ fontSize: 11.5, color: C.inkMuted }}>{p.rol === "admin" ? "Administrador" : "Usuario"}</div>
          </div>
          <button onClick={() => onChangeRol(p.id, p.rol === "admin" ? "usuario" : "admin")} style={btnGhost}>
            {p.rol === "admin" ? "Quitar admin" : "Hacer admin"}
          </button>
        </div>
      ))}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// APP PRINCIPAL
// ════════════════════════════════════════════════════════════════════════════
const TABS = [
  { key: "panel", label: "Panel", icon: "📊" },
  { key: "compras", label: "Compras", icon: "📦" },
  { key: "financiamiento", label: "Financ.", icon: "🏦" },
  { key: "gastos", label: "Gastos", icon: "🧾" },
  { key: "vendedores", label: "Vendedores", icon: "🧑‍💼" },
  { key: "usuarios", label: "Usuarios", icon: "👥", adminOnly: true },
];

const ACCIONES_RAPIDAS = [
  { key: "compra", label: "Ingresar compra", icon: "📦", color: C.teal },
  { key: "entrega", label: "Confirmar entrega", icon: "🚚", color: C.transit },
  { key: "factura", label: "Emitir factura", icon: "🧾", color: C.info },
  { key: "pago_cliente", label: "Pago de factura", icon: "💰", color: C.ok },
  { key: "pago_financ", label: "Pago financiamiento", icon: "🏦", color: C.purple },
];

export default function App() {
  const [session, setSession] = useState(null);
  const [perfil, setPerfil] = useState(null);
  const [loadingApp, setLoadingApp] = useState(true);
  const [tab, setTab] = useState("panel");
  const [filtroCompras, setFiltroCompras] = useState(null);
  const [accionActiva, setAccionActiva] = useState(null);
  const [toast, setToast] = useState(null);

  const [ocs, setOcs] = useState([]);
  const [financiadores, setFinanciadores] = useState([]);
  const [vendedores, setVendedores] = useState([]);
  const [categoriasGasto, setCategoriasGasto] = useState([]);
  const [gastos, setGastos] = useState([]);
  const [ivaMensual, setIvaMensual] = useState([]);
  const [pagosVendedor, setPagosVendedor] = useState([]);
  const [ajustesSaldo, setAjustesSaldo] = useState([]);
  const [perfiles, setPerfiles] = useState([]);

  const showToast = (msg, type = "success") => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };

  // ─── Sesión inicial ────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      const saved = await storageGet(SESSION_STORAGE_KEY);
      if (saved) {
        try {
          let s = JSON.parse(saved);
          try { s = await supaRefreshToken(s.refresh_token); await storageSet(SESSION_STORAGE_KEY, JSON.stringify(s)); } catch {}
          setSession(s);
          const p = await supaGetPerfil(s.access_token, s.user.id);
          setPerfil(p);
        } catch {}
      }
      setLoadingApp(false);
    })();
  }, []);

  const handleLogin = async (s) => {
    setSession(s);
    await storageSet(SESSION_STORAGE_KEY, JSON.stringify(s));
    let p = await supaGetPerfil(s.access_token, s.user.id);
    if (!p) {
      const allPerfiles = await supaListPerfiles(s.access_token);
      const esPrimero = allPerfiles.length === 0;
      p = await supaInsert("perfiles", s.access_token, { id: s.user.id, nombre: s.user.user_metadata?.nombre || s.user.email, rol: esPrimero ? "admin" : "usuario" });
      p = Array.isArray(p) ? p[0] : p;
    }
    setPerfil(p);
  };
  const handleLogout = async () => { await supaSignOut(session.access_token); setSession(null); setPerfil(null); await storageSet(SESSION_STORAGE_KEY, ""); };

  // ─── Carga de datos ──────────────────────────────────────────────────────
  const cargarTodo = async () => {
    if (!session) return;
    const t = session.access_token;
    try {
      const [ocsData, finData, vendData, catData, gastosData, ivaData, pagosVendData, ajustesData, perfilesData] = await Promise.all([
        supaListOCCompletas(t),
        supaSelect("financiadores", t, "&order=nombre"),
        supaSelect("vendedores", t, "&order=nombre"),
        supaSelect("categorias_gasto", t, "&order=nombre"),
        supaSelect("gastos_indirectos", t, "&order=fecha.desc"),
        supaSelect("iva_mensual", t),
        supaSelect("pagos_vendedor", t),
        supaSelect("ajustes_saldo_financiador", t, "&order=creadoEn.desc"),
        supaListPerfiles(t),
      ]);
      setOcs(ocsData); setFinanciadores(finData); setVendedores(vendData); setCategoriasGasto(catData);
      setGastos(gastosData); setIvaMensual(ivaData); setPagosVendedor(pagosVendData); setAjustesSaldo(ajustesData); setPerfiles(perfilesData);
    } catch (e) { showToast(e.message, "error"); }
  };
  useEffect(() => { if (session) cargarTodo(); }, [session]);

  // ─── Helper: id único simple ─────────────────────────────────────────────
  const genId = (prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  // ─── Handlers de eventos (conectan formularios con Supabase) ───────────────
  const handleIngresarCompra = async (data) => {
    const t = session.access_token;
    let ocId = data.ocId;
    if (data.esNueva) {
      const nuevaOc = await supaInsert("ordenes_compra_v2", t, {
        id: genId("ocv2"), numero_oc: data.numeroNueva, cliente: data.cliente,
        vendedor_id: data.vendedorId, financiador_id: data.financiadorId,
        monto_total: data.montoVenta, costo_total: data.costoCompra,
        creado_por: session.user.id,
      });
      ocId = (Array.isArray(nuevaOc) ? nuevaOc[0] : nuevaOc).id;
    } else {
      await supaUpdate("ordenes_compra_v2", t, ocId, {
        estado_compra: "comprado", monto_total: data.montoVenta, costo_total: data.costoCompra, financiador_id: data.financiadorId,
      });
    }
    await supaInsert("eventos_compra", t, {
      id: genId("evc"), oc_id: ocId, fecha: data.fecha, monto_venta: data.montoVenta, costo_compra: data.costoCompra,
      fecha_entrega_estimada: data.fechaEntregaEst, financiador_id: data.financiadorId, proveedor: data.proveedor, creado_por: session.user.id,
    });
    if (!data.esNueva) await supaUpdate("ordenes_compra_v2", t, ocId, { estado_compra: "comprado" });
    const fin = financiadores.find(f => f.id === data.financiadorId);
    if (fin) await supaUpdate("financiadores", t, fin.id, { saldo_deuda: Number(fin.saldo_deuda) + data.costoCompra });
    showToast("Compra registrada"); setAccionActiva(null); await cargarTodo();
  };

  const handleConfirmarEntrega = async (data) => {
    const t = session.access_token;
    await supaInsert("eventos_entrega", t, { id: genId("eve"), oc_id: data.ocId, fecha: data.fecha, persona_recibe: data.personaRecibe, creado_por: session.user.id });
    await supaUpdate("ordenes_compra_v2", t, data.ocId, { estado_entrega: "confirmada" });
    showToast("Entrega confirmada"); setAccionActiva(null); await cargarTodo();
  };

  const handleEmitirFactura = async (data) => {
    const t = session.access_token;
    await supaInsert("eventos_factura", t, { id: genId("evf"), oc_id: data.ocId, fecha: data.fecha, numero_factura: data.numeroFactura, monto: data.monto, creado_por: session.user.id });
    await supaUpdate("ordenes_compra_v2", t, data.ocId, { estado_factura_propia: "emitida", monto_facturado: data.monto });
    showToast("Factura registrada"); setAccionActiva(null); await cargarTodo();
  };

  const handlePagoCliente = async (data) => {
    const t = session.access_token;
    const oc = ocs.find(o => o.id === data.ocId);
    await supaInsert("eventos_pago_cliente", t, { id: genId("evp"), oc_id: data.ocId, fecha: data.fecha, monto: data.monto, creado_por: session.user.id });
    const nuevoCobrado = (oc?.monto_cobrado || 0) + data.monto;
    const nuevoEstado = nuevoCobrado >= (oc?.monto_facturado || 0) ? "pagado" : "parcial";
    await supaUpdate("ordenes_compra_v2", t, data.ocId, { monto_cobrado: nuevoCobrado, estado_pago_cliente: nuevoEstado });
    showToast("Pago de cliente registrado"); setAccionActiva(null); await cargarTodo();
  };

  const handlePagoFinanciamiento = async (data) => {
    const t = session.access_token;
    await supaInsert("eventos_pago_financiamiento", t, { id: genId("evpf"), financiador_id: data.financiadorId, oc_id: data.ocId, fecha: data.fecha, monto: data.monto, creado_por: session.user.id });
    const fin = financiadores.find(f => f.id === data.financiadorId);
    if (fin) await supaUpdate("financiadores", t, fin.id, { saldo_deuda: Math.max(0, Number(fin.saldo_deuda) - data.monto) });
    if (data.ocId) await supaUpdate("ordenes_compra_v2", t, data.ocId, { estado_pago_financiamiento: "pagado" });
    showToast("Pago a financiador registrado"); setAccionActiva(null); await cargarTodo();
  };

  const handleAjusteSaldo = async ({ financiadorId, fecha, montoAjuste, motivo }) => {
    const t = session.access_token;
    await supaInsert("ajustes_saldo_financiador", t, { id: genId("ajf"), financiador_id: financiadorId, fecha, monto_ajuste: montoAjuste, motivo, creado_por: session.user.id });
    const fin = financiadores.find(f => f.id === financiadorId);
    if (fin) await supaUpdate("financiadores", t, fin.id, { saldo_deuda: Math.max(0, Number(fin.saldo_deuda) + montoAjuste) });
    showToast("Saldo ajustado"); await cargarTodo();
  };

  const handleNuevoGasto = async (data) => {
    const t = session.access_token;
    await supaInsert("gastos_indirectos", t, { id: genId("gas"), categoria_id: data.categoriaId, subcategoria: data.subcategoria, monto: data.monto, mes: data.mes, anio: data.anio, fecha: data.fecha, detalle: data.detalle, creado_por: session.user.id });
    showToast("Gasto registrado"); await cargarTodo();
  };

  const handleGuardarIva = async (data) => {
    const t = session.access_token;
    const existente = ivaMensual.find(i => i.mes === data.mes && i.anio === data.anio);
    const row = { anio: data.anio, mes: data.mes, ventas_netas: data.ventasNetas, iva_ventas: data.ivaVentas, compras_netas: data.comprasNetas, iva_compras: data.ivaCompras, iva_pagado: data.ivaPagado };
    if (existente) await supaUpdate("iva_mensual", t, existente.id, row);
    else await supaInsert("iva_mensual", t, { id: genId("iva"), ...row });
    showToast("IVA mensual guardado"); await cargarTodo();
  };

  const handlePagarVendedor = async (data) => {
    const t = session.access_token;
    await supaInsert("pagos_vendedor", t, {
      id: genId("pv"), vendedor_id: data.vendedorId, anio: data.anio, mes: data.mes,
      utilidad_mes: data.utilidadMes, iva_pagado_mes: data.ivaPagadoMes, ventas_propias: data.ventasPropias,
      monto_calculado: data.montoCalculado, monto_pagado: data.montoCalculado, fecha: data.fecha, estado: "pagado", creado_por: session.user.id,
    });
    showToast("Pago a vendedor registrado"); await cargarTodo();
  };

  const handleChangeRol = async (userId, rol) => {
    await supaUpdatePerfilRol(session.access_token, userId, rol);
    showToast("Rol actualizado"); await cargarTodo();
  };

  // ─── Render ──────────────────────────────────────────────────────────────
  if (loadingApp) return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: C.inkMuted, fontFamily: FONT_SANS }}>Cargando…</div>;
  if (!session) return <LoginScreen onLogin={handleLogin} />;

  const visibleTabs = TABS.filter(t => !t.adminOnly || perfil?.rol === "admin");

  return (
    <div style={{ minHeight: "100vh", background: C.paper, fontFamily: FONT_SANS, paddingBottom: 70 }}>
      <div style={{ background: C.night, padding: "16px 16px 14px", color: "#fff" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, letterSpacing: -0.3 }}>BFK Ltda</div>
            <div style={{ fontSize: 11, color: "#94A3B8" }}>{perfil?.nombre} · {perfil?.rol === "admin" ? "Admin" : "Usuario"}</div>
          </div>
          <button onClick={handleLogout} style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", color: "#fff", borderRadius: 8, padding: "7px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Salir</button>
        </div>
        <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 }}>
          {ACCIONES_RAPIDAS.map(a => (
            <button key={a.key} onClick={() => setAccionActiva(a.key)} style={{ flexShrink: 0, background: a.color, border: "none", color: "#fff", borderRadius: 9, padding: "8px 12px", fontSize: 11.5, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
              {a.icon} {a.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: 16 }}>
        {tab === "panel" && <PanelDashboard ocs={ocs} financiadores={financiadores} onNavigate={(t, f) => { setTab(t); setFiltroCompras(f); }} />}
        {tab === "compras" && <PanelCompras ocs={ocs} perfiles={perfiles} filtroInicial={filtroCompras} />}
        {tab === "financiamiento" && <PanelFinanciamiento financiadores={financiadores} ajustes={ajustesSaldo} perfiles={perfiles} onAjustar={handleAjusteSaldo} />}
        {tab === "gastos" && <PanelGastos gastos={gastos} categorias={categoriasGasto} onNuevoGasto={handleNuevoGasto} />}
        {tab === "vendedores" && <PanelVendedores vendedores={vendedores} ocs={ocs} ivaMensual={ivaMensual} pagosVendedor={pagosVendedor} onGuardarIva={handleGuardarIva} onPagarVendedor={handlePagarVendedor} />}
        {tab === "usuarios" && perfil?.rol === "admin" && <PanelUsuarios perfiles={perfiles} onChangeRol={handleChangeRol} />}
      </div>

      <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: C.card, borderTop: `1px solid ${C.border}`, display: "flex", padding: "6px 4px" }}>
        {visibleTabs.map(t => (
          <button key={t.key} onClick={() => { setTab(t.key); setFiltroCompras(null); }} style={{ flex: 1, background: "none", border: "none", padding: "8px 2px", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
            <span style={{ fontSize: 17 }}>{t.icon}</span>
            <span style={{ fontSize: 9.5, fontWeight: 700, color: tab === t.key ? C.teal : C.inkFaint }}>{t.label}</span>
          </button>
        ))}
      </div>

      {accionActiva === "compra" && <Modal title="Ingresar compra" onClose={() => setAccionActiva(null)}><FormIngresarCompra ocs={ocs} financiadores={financiadores} vendedores={vendedores} onClose={() => setAccionActiva(null)} onSave={handleIngresarCompra} /></Modal>}
      {accionActiva === "entrega" && <Modal title="Confirmar entrega" onClose={() => setAccionActiva(null)}><FormConfirmarEntrega ocs={ocs} onClose={() => setAccionActiva(null)} onSave={handleConfirmarEntrega} /></Modal>}
      {accionActiva === "factura" && <Modal title="Emitir factura" onClose={() => setAccionActiva(null)}><FormEmitirFactura ocs={ocs} onClose={() => setAccionActiva(null)} onSave={handleEmitirFactura} /></Modal>}
      {accionActiva === "pago_cliente" && <Modal title="Pago de factura" onClose={() => setAccionActiva(null)}><FormPagoCliente ocs={ocs} onClose={() => setAccionActiva(null)} onSave={handlePagoCliente} /></Modal>}
      {accionActiva === "pago_financ" && <Modal title="Pago de financiamiento" onClose={() => setAccionActiva(null)}><FormPagoFinanciamiento ocs={ocs} financiadores={financiadores} onClose={() => setAccionActiva(null)} onSave={handlePagoFinanciamiento} /></Modal>}

      <Toast toast={toast} />
    </div>
  );
}
