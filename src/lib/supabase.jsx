import { HOJAS_RESPALDO } from "./hojasRespaldo.js";

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

// Importación atómica de respaldo: una sola llamada, una sola transacción en la base (ver docs/migraciones).
export async function rpcImportarRespaldo(t, payload, simular) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/importar_respaldo_excel`, { method:"POST", headers:hdrs(t), body:JSON.stringify({ p_payload: payload, p_simular: !!simular }) });
  const cuerpo = await r.json().catch(()=>null);
  if (!r.ok) throw Object.assign(new Error(cuerpo?.message || `HTTP ${r.status}`), { rpcStatus: r.status, rpcCuerpo: cuerpo });
  return cuerpo;
}

// Importación atómica de entidades: una sola llamada; el servidor revalida y aplica todo o nada.
// Alimenta el catálogo de entidades desde una OC (RPC controlada; la escritura directa queda solo para administradores).
export async function rpcRegistrarEntidadDesdeOC(t, { rut, nombre_entidad, comuna, contacto, correo }) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/registrar_entidad_desde_oc`, { method:"POST", headers:hdrs(t),
    body:JSON.stringify({ p_rut: rut, p_nombre_entidad: nombre_entidad, p_comuna: comuna, p_contacto: contacto, p_correo: correo }) });
  const cuerpo = await r.json().catch(()=>null);
  if (!r.ok) throw Object.assign(new Error(cuerpo?.message || `HTTP ${r.status}`), { rpcStatus: r.status, rpcCuerpo: cuerpo });
  return cuerpo;
}

// Archivado reversible de OC (solo administrador; lo valida la base de datos).
async function rpcSimple(t, fn, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method:"POST", headers:hdrs(t), body:JSON.stringify(body) });
  const cuerpo = await r.json().catch(()=>null);
  if (!r.ok) throw Object.assign(new Error(cuerpo?.message || `HTTP ${r.status}`), { rpcStatus: r.status, rpcCuerpo: cuerpo });
  return cuerpo;
}
export const rpcArchivarOC = (t, ocId, motivo) => rpcSimple(t, "archivar_oc", { p_oc_id: ocId, p_motivo: motivo || null });
export const rpcRestaurarOC = (t, ocId) => rpcSimple(t, "restaurar_oc", { p_oc_id: ocId });

export async function rpcImportarEntidades(t, operaciones, simular) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/importar_entidades_catalogo`, { method:"POST", headers:hdrs(t), body:JSON.stringify({ p_payload: { version: 1, operaciones }, p_simular: !!simular }) });
  const cuerpo = await r.json().catch(()=>null);
  if (!r.ok) throw Object.assign(new Error(cuerpo?.message || `HTTP ${r.status}`), { rpcStatus: r.status, rpcCuerpo: cuerpo });
  return cuerpo;
}

export async function del(table, t, id) { const r=await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`,{method:"DELETE",headers:hdrs(t)}); if(!r.ok) throw new Error(`Error eliminando en ${table}`); return r.json(); }

// Borrado CONFIRMADO (Fase 4A): devuelve las filas que la base realmente eliminó.
// Si la base rechaza el borrado, o no elimina nada (sin permiso por RLS, o el registro
// ya no existía), lanza un error: quien llama NO debe ajustar estados ni saldos.
export async function delConfirmado(table, t, id) {
  let r;
  try { r=await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`,{method:"DELETE",headers:hdrs(t)}); }
  catch { throw new Error("Sin conexión con la base: no se eliminó nada."); }
  if(!r.ok){
    let m=""; try{ const j=await r.json(); m=j?.message||""; }catch{}
    throw new Error(`La base rechazó la eliminación${m?` (${m})`:""}. No se modificó nada.`);
  }
  let filas=[]; try{ filas=await r.json(); }catch{ filas=[]; }
  if(!Array.isArray(filas)||!filas.some(f=>String(f?.id)===String(id)))
    throw new Error("La base no eliminó el registro (sin permiso o ya no existe). No se modificó nada.");
  return filas;
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

// Hojas que se pueden volver a importar (subconjunto de la lista única de respaldo; el orden y los nombres no cambian).
export const TABLAS_EXPORT = HOJAS_RESPALDO.filter(h=>h.importable).map(({hoja,tabla})=>({hoja,tabla}));

// Correos de BFK (Fase Correos): pendientes + gestionados de los últimos 30 días, y cambio de estado.
// Solo lectura de la tabla; el estado se cambia con la RPC (el correo original en Gmail no se toca).
export async function cargarCorreosBfk(t, desdeIso) {
  return sel("correos_bfk", t, `&or=(estado.eq.pendiente,fecha.gte.${encodeURIComponent(desdeIso)})&order=fecha.desc&limit=500`);
}
export async function rpcMarcarCorreo(t, id, estado) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/correo_bfk_marcar`, { method:"POST", headers:hdrs(t), body:JSON.stringify({ p_id: id, p_estado: estado }) });
  const cuerpo = await r.json().catch(()=>null);
  if (!r.ok) throw new Error(cuerpo?.message || `No se pudo actualizar el correo (HTTP ${r.status})`);
  return cuerpo;
}

// Vendedor y financiador de una OC (la base valida comisiones pagadas, compras y pagos al financiador).
export async function rpcAsignarVendedor(t, ocId, vendedorId) { return rpcSimple(t, "asignar_vendedor_oc", { p_oc_id: ocId, p_vendedor_id: vendedorId || null }); }
export async function rpcAsignarFinanciador(t, ocId, financiadorId) { return rpcSimple(t, "asignar_financiador_oc", { p_oc_id: ocId, p_financiador_id: financiadorId || null }); }
