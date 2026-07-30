
export const SUPABASE_URL = "https://gypywxaugwuxbgmcqntp.supabase.co";

export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd5cHl3eGF1Z3d1eGJnbWNxbnRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2MjA4MjksImV4cCI6MjA5NzE5NjgyOX0.ujdKtdhFklJEPHy1vWlm8RLgPAQlo7sNNBGd_MbmibQ";

export const SESSION_KEY = "bfk_supabase_session_v2";

export async function supaSignIn(email, password) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, { method:"POST", headers:{"Content-Type":"application/json", apikey:SUPABASE_ANON_KEY}, body:JSON.stringify({email,password}) });
  const d = await r.json(); if(!r.ok) throw new Error(d.error_description||"Error al ingresar"); return d;
}

export async function supaSignUp(email, password, nombre) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/signup`, { method:"POST", headers:{"Content-Type":"application/json", apikey:SUPABASE_ANON_KEY}, body:JSON.stringify({email,password,data:{nombre}}) });
  const d = await r.json(); if(!r.ok) throw new Error(d.error_description||"Error al registrar"); return d;
}

export async function supaSignOut(token) { try { await fetch(`${SUPABASE_URL}/auth/v1/logout`, {method:"POST", headers:{apikey:SUPABASE_ANON_KEY, Authorization:`Bearer ${token}`}}); } catch {} }

export async function supaResetPassword(email) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/recover`, { method:"POST", headers:{"Content-Type":"application/json", apikey:SUPABASE_ANON_KEY}, body:JSON.stringify({email}) });
  if(!r.ok) { const d=await r.json().catch(()=>({})); throw new Error(d.error_description||"Error al enviar correo de recuperación"); }
}

export async function supaRefresh(rt) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, { method:"POST", headers:{"Content-Type":"application/json", apikey:SUPABASE_ANON_KEY}, body:JSON.stringify({refresh_token:rt}) });
  const d = await r.json(); if(!r.ok) throw new Error("Sesión expirada"); return d;
}

export const hdrs = (t) => ({"Content-Type":"application/json", apikey:SUPABASE_ANON_KEY, Authorization:`Bearer ${t}`, Prefer:"return=representation"});

export async function sel(table, t, q="") { const r=await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*${q}`,{headers:hdrs(t)}); if(!r.ok) throw new Error(`Error leyendo ${table}`); return r.json(); }

export async function ins(table, t, row) { const r=await fetch(`${SUPABASE_URL}/rest/v1/${table}`,{method:"POST",headers:hdrs(t),body:JSON.stringify(row)}); if(!r.ok){const e=await r.json().catch(()=>({})); throw new Error(e.message||`Error insertando en ${table}`);} return r.json(); }

export async function upd(table, t, id, row) { const r=await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`,{method:"PATCH",headers:hdrs(t),body:JSON.stringify(row)}); if(!r.ok) throw new Error(`Error actualizando ${table}`); return r.json(); }

export async function del(table, t, id) { const r=await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`,{method:"DELETE",headers:hdrs(t)}); if(!r.ok) throw new Error(`Error eliminando en ${table}`); return r.json(); }

export async function bloquearOC(t, ocId, usuarioId, usuarioNombre) {
  const expira = new Date(Date.now()+30000).toISOString(); // 30 segundos
  await fetch(`${SUPABASE_URL}/rest/v1/oc_bloqueos`,{method:"POST",headers:{...hdrs(t),"Prefer":"resolution=merge-duplicates"},body:JSON.stringify({oc_id:ocId,usuario_id:usuarioId,usuario_nombre:usuarioNombre,expira_en:expira})});
}

export async function liberarOC(t, ocId) {
  await fetch(`${SUPABASE_URL}/rest/v1/oc_bloqueos?oc_id=eq.${ocId}`,{method:"DELETE",headers:hdrs(t)});
}

export async function getBloqueosVigentes(t) {
  const ahora=new Date().toISOString();
  const r=await fetch(`${SUPABASE_URL}/rest/v1/oc_bloqueos?select=*&expira_en=gt.${ahora}`,{headers:hdrs(t)});
  return r.ok?r.json():[];
}

export async function registrarCambio(t, {ocId, ocNumero, usuarioId, usuarioNombre, accion, campo, valorAnterior, valorNuevo}) {
  await ins("historial_cambios",t,{id:genId("hc"),oc_id:ocId,oc_numero:ocNumero,usuario_id:usuarioId,usuario_nombre:usuarioNombre,accion,campo:campo||null,valor_anterior:valorAnterior!=null?String(valorAnterior):null,valor_nuevo:valorNuevo!=null?String(valorNuevo):null});
}

export async function crearNotificacion(t, {usuarioId, tipo, ocId, ocNumero, mensaje}) {
  await ins("notificaciones",t,{id:genId("ntf"),usuario_id:usuarioId,tipo,oc_id:ocId,oc_numero:ocNumero,mensaje});
}

export async function selPerfiles(t) { const r=await fetch(`${SUPABASE_URL}/rest/v1/perfiles?select=*`,{headers:hdrs(t)}); if(!r.ok) return []; return r.json(); }

export async function getPerfil(t, uid) { const r=await fetch(`${SUPABASE_URL}/rest/v1/perfiles?id=eq.${uid}&select=*`,{headers:hdrs(t)}); if(!r.ok) return null; const a=await r.json(); return a[0]||null; }

export async function updRol(t, uid, rol) { const r=await fetch(`${SUPABASE_URL}/rest/v1/perfiles?id=eq.${uid}`,{method:"PATCH",headers:hdrs(t),body:JSON.stringify({rol})}); if(!r.ok) throw new Error("Error actualizando rol"); return r.json(); }

export async function selOCs(t) {
  const r=await fetch(`${SUPABASE_URL}/rest/v1/ordenes_compra_v2?select=*,vendedores(nombre),financiadores(nombre),eventos_compra(*),eventos_entrega(*),eventos_factura(*),eventos_pago_cliente(*),eventos_pago_financiamiento(*),oc_productos_link(*),oc_comentarios(*)&order=creadoEn.desc`,{headers:hdrs(t)});
  if(!r.ok) throw new Error("Error leyendo OCs"); return r.json();
}

export const storageGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };

export const storageSet = (k,v) => { try { localStorage.setItem(k,v); } catch {} };

export const genId = (p) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;

export const TABLAS_EXPORT = [
  { hoja:"OrdenesCompra", tabla:"ordenes_compra_v2" },
  { hoja:"EventosCompra", tabla:"eventos_compra" },
  { hoja:"EventosEntrega", tabla:"eventos_entrega" },
  { hoja:"EventosFactura", tabla:"eventos_factura" },
  { hoja:"EventosPagoCliente", tabla:"eventos_pago_cliente" },
  { hoja:"EventosPagoFinanciamiento", tabla:"eventos_pago_financiamiento" },
  { hoja:"Financiadores", tabla:"financiadores" },
  { hoja:"Vendedores", tabla:"vendedores" },
  { hoja:"CategoriasGasto", tabla:"categorias_gasto" },
  { hoja:"GastosIndirectos", tabla:"gastos_indirectos" },
  { hoja:"IvaMensual", tabla:"iva_mensual" },
  { hoja:"PagosVendedor", tabla:"pagos_vendedor" },
  { hoja:"AjustesSaldo", tabla:"ajustes_saldo_financiador" },
  { hoja:"ContactosCobranza", tabla:"contactos_cobranza" },
];
