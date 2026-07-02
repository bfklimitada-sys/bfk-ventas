import { useState, useEffect, useMemo } from "react";
import * as XLSX from "xlsx";

// ═══════════════════════════════════════════════
// SUPABASE CONFIG
// ═══════════════════════════════════════════════
const SUPABASE_URL = "https://gypywxaugwuxbgmcqntp.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd5cHl3eGF1Z3d1eGJnbWNxbnRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2MjA4MjksImV4cCI6MjA5NzE5NjgyOX0.ujdKtdhFklJEPHy1vWlm8RLgPAQlo7sNNBGd_MbmibQ";
const SESSION_KEY = "bfk_supabase_session_v2";

// ─── AUTH ─────────────────────────────────────
async function supaSignIn(email, password) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, { method:"POST", headers:{"Content-Type":"application/json", apikey:SUPABASE_ANON_KEY}, body:JSON.stringify({email,password}) });
  const d = await r.json(); if(!r.ok) throw new Error(d.error_description||"Error al ingresar"); return d;
}
async function supaSignUp(email, password, nombre) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/signup`, { method:"POST", headers:{"Content-Type":"application/json", apikey:SUPABASE_ANON_KEY}, body:JSON.stringify({email,password,data:{nombre}}) });
  const d = await r.json(); if(!r.ok) throw new Error(d.error_description||"Error al registrar"); return d;
}
async function supaSignOut(token) { try { await fetch(`${SUPABASE_URL}/auth/v1/logout`, {method:"POST", headers:{apikey:SUPABASE_ANON_KEY, Authorization:`Bearer ${token}`}}); } catch {} }
async function supaResetPassword(email) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/recover`, { method:"POST", headers:{"Content-Type":"application/json", apikey:SUPABASE_ANON_KEY}, body:JSON.stringify({email}) });
  if(!r.ok) { const d=await r.json().catch(()=>({})); throw new Error(d.error_description||"Error al enviar correo de recuperación"); }
}
async function supaRefresh(rt) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, { method:"POST", headers:{"Content-Type":"application/json", apikey:SUPABASE_ANON_KEY}, body:JSON.stringify({refresh_token:rt}) });
  const d = await r.json(); if(!r.ok) throw new Error("Sesión expirada"); return d;
}

// ─── DATA ─────────────────────────────────────
const hdrs = (t) => ({"Content-Type":"application/json", apikey:SUPABASE_ANON_KEY, Authorization:`Bearer ${t}`, Prefer:"return=representation"});
async function sel(table, t, q="") { const r=await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*${q}`,{headers:hdrs(t)}); if(!r.ok) throw new Error(`Error leyendo ${table}`); return r.json(); }
async function ins(table, t, row) { const r=await fetch(`${SUPABASE_URL}/rest/v1/${table}`,{method:"POST",headers:hdrs(t),body:JSON.stringify(row)}); if(!r.ok){const e=await r.json().catch(()=>({})); throw new Error(e.message||`Error insertando en ${table}`);} return r.json(); }
async function upd(table, t, id, row) { const r=await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`,{method:"PATCH",headers:hdrs(t),body:JSON.stringify(row)}); if(!r.ok) throw new Error(`Error actualizando ${table}`); return r.json(); }
async function del(table, t, id) { const r=await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`,{method:"DELETE",headers:hdrs(t)}); if(!r.ok) throw new Error(`Error eliminando en ${table}`); return r.json(); }

// Helpers multiusuario
async function bloquearOC(t, ocId, usuarioId, usuarioNombre) {
  const expira = new Date(Date.now()+30000).toISOString(); // 30 segundos
  await fetch(`${SUPABASE_URL}/rest/v1/oc_bloqueos`,{method:"POST",headers:{...hdrs(t),"Prefer":"resolution=merge-duplicates"},body:JSON.stringify({oc_id:ocId,usuario_id:usuarioId,usuario_nombre:usuarioNombre,expira_en:expira})});
}
async function liberarOC(t, ocId) {
  await fetch(`${SUPABASE_URL}/rest/v1/oc_bloqueos?oc_id=eq.${ocId}`,{method:"DELETE",headers:hdrs(t)});
}
async function getBloqueosVigentes(t) {
  const ahora=new Date().toISOString();
  const r=await fetch(`${SUPABASE_URL}/rest/v1/oc_bloqueos?select=*&expira_en=gt.${ahora}`,{headers:hdrs(t)});
  return r.ok?r.json():[];
}
async function registrarCambio(t, {ocId, ocNumero, usuarioId, usuarioNombre, accion, campo, valorAnterior, valorNuevo}) {
  await ins("historial_cambios",t,{id:genId("hc"),oc_id:ocId,oc_numero:ocNumero,usuario_id:usuarioId,usuario_nombre:usuarioNombre,accion,campo:campo||null,valor_anterior:valorAnterior!=null?String(valorAnterior):null,valor_nuevo:valorNuevo!=null?String(valorNuevo):null});
}
async function crearNotificacion(t, {usuarioId, tipo, ocId, ocNumero, mensaje}) {
  await ins("notificaciones",t,{id:genId("ntf"),usuario_id:usuarioId,tipo,oc_id:ocId,oc_numero:ocNumero,mensaje});
}
async function selPerfiles(t) { const r=await fetch(`${SUPABASE_URL}/rest/v1/perfiles?select=*`,{headers:hdrs(t)}); if(!r.ok) return []; return r.json(); }
async function getPerfil(t, uid) { const r=await fetch(`${SUPABASE_URL}/rest/v1/perfiles?id=eq.${uid}&select=*`,{headers:hdrs(t)}); if(!r.ok) return null; const a=await r.json(); return a[0]||null; }
async function updRol(t, uid, rol) { const r=await fetch(`${SUPABASE_URL}/rest/v1/perfiles?id=eq.${uid}`,{method:"PATCH",headers:hdrs(t),body:JSON.stringify({rol})}); if(!r.ok) throw new Error("Error actualizando rol"); return r.json(); }
async function selOCs(t) {
  const r=await fetch(`${SUPABASE_URL}/rest/v1/ordenes_compra_v2?select=*,vendedores(nombre),financiadores(nombre),eventos_compra(*),eventos_entrega(*),eventos_factura(*),eventos_pago_cliente(*),eventos_pago_financiamiento(*),oc_productos_link(*),oc_comentarios(*),oc_reclamos(*)&order=creadoEn.desc`,{headers:hdrs(t)});
  if(!r.ok) throw new Error("Error leyendo OCs"); return r.json();
}
const storageGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const storageSet = (k,v) => { try { localStorage.setItem(k,v); } catch {} };
const genId = (p) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;

// ─── Tablas exportables/importables (nombre hoja Excel : nombre tabla Supabase) ──
const TABLAS_EXPORT = [
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

// ═══════════════════════════════════════════════
// DISEÑO — Torre de Control
// ═══════════════════════════════════════════════
const C = {
  night:"#0B1120", nightSoft:"#141B2E", paper:"#F7F8FA", card:"#FFFFFF",
  border:"#E2E5EB", borderDark:"#232C42", ink:"#0F172A", inkMuted:"#64748B", inkFaint:"#94A3B8",
  teal:"#14B8A6", tealLight:"#E6FBF8", tealDark:"#0D9488",
  ok:"#10B981", okLight:"#E7F8F0", warn:"#F59E0B", warnLight:"#FEF3E2",
  danger:"#EF4444", dangerLight:"#FEEAEA", transit:"#6366F1", transitLight:"#EEEDFC",
  info:"#3B82F6", infoLight:"#EAF2FF", purple:"#A855F7", purpleLight:"#F6EEFE",
};
const MONO = "'JetBrains Mono','SF Mono',Menlo,Consolas,monospace";
const SANS = "'Inter',system-ui,-apple-system,sans-serif";
const fmt = {
  money: (n) => "$"+Math.round(Number(n)||0).toLocaleString("es-CL"),
  date: (d) => { if(!d) return "—"; const[y,m,dd]=d.split("-"); return `${dd}/${m}/${y.slice(2)}`; },
  monthYear: (mes,anio) => { const M=["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"]; return `${M[mes-1]}/${anio}`; },
  datetime: (iso) => { if(!iso) return "—"; const d=new Date(iso); return d.toLocaleDateString("es-CL")+" "+d.toLocaleTimeString("es-CL",{hour:"2-digit",minute:"2-digit"}); },
  diasDesde: (fechaStr) => { if(!fechaStr) return null; const hoy=new Date(); hoy.setHours(0,0,0,0); const f=new Date(fechaStr+"T00:00:00"); return Math.floor((hoy-f)/(1000*60*60*24)); },
};


// ─── Margen ────────────────────────────────────
const calcMargen=(venta,costo)=>{
  const v=Number(venta)||0; const c=Number(costo)||0;
  if(v<=0) return {pesos:0,pct:0,color:C.danger,bg:C.dangerLight};
  const pesos=v-c; const pct=Math.round((pesos/v)*100);
  const color=pct>=20?C.ok:pct>=10?C.warn:C.danger;
  const bg=pct>=20?C.okLight:pct>=10?C.warnLight:C.dangerLight;
  return {pesos,pct,color,bg};
};
// ═══════════════════════════════════════════════
// COMPONENTES BASE
// ═══════════════════════════════════════════════
const iStyle = { width:"100%", padding:"10px 12px", borderRadius:9, border:`1.5px solid ${C.border}`, fontSize:14, color:C.ink, background:C.card, boxSizing:"border-box", fontFamily:SANS };
const iMono = { ...iStyle, fontFamily:MONO };
const selStyle = { ...iStyle, cursor:"pointer" };
const btnP = (bg=C.teal) => ({ padding:"11px 16px", borderRadius:10, border:"none", background:bg, color:"#fff", fontWeight:700, fontSize:13.5, cursor:"pointer", width:"100%" });
const btnG = { padding:"11px 16px", borderRadius:10, border:`1.5px solid ${C.border}`, background:C.card, color:C.ink, fontWeight:600, fontSize:13.5, cursor:"pointer" };

function Modal({ title, onClose, children }) {
  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(11,17,32,0.6)",backdropFilter:"blur(2px)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:100}}>
      <div onClick={e=>e.stopPropagation()} style={{background:C.card,borderRadius:"18px 18px 0 0",width:"100%",maxWidth:480,maxHeight:"92vh",overflowY:"auto",boxShadow:"0 -8px 40px rgba(0,0,0,0.25)"}}>
        <div style={{position:"sticky",top:0,background:C.card,padding:"16px 20px",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"space-between",zIndex:2}}>
          <span style={{fontWeight:800,fontSize:15,color:C.ink}}>{title}</span>
          <button onClick={onClose} style={{background:C.paper,border:"none",borderRadius:8,width:30,height:30,cursor:"pointer",fontSize:15,color:C.inkMuted}}>✕</button>
        </div>
        <div style={{padding:20}}>{children}</div>
      </div>
    </div>
  );
}

function Field({ label, required, hint, children }) {
  return (
    <div style={{marginBottom:14}}>
      <label style={{display:"block",fontSize:11.5,fontWeight:700,color:C.inkMuted,marginBottom:5,textTransform:"uppercase",letterSpacing:0.3}}>
        {label}{required&&<span style={{color:C.danger}}> *</span>}
      </label>
      {children}
      {hint&&<div style={{fontSize:11,color:C.inkFaint,marginTop:4}}>{hint}</div>}
    </div>
  );
}

function Toast({ toast }) {
  if(!toast) return null;
  return <div style={{position:"fixed",bottom:80,left:"50%",transform:"translateX(-50%)",background:toast.type==="error"?C.danger:C.ink,color:"#fff",padding:"11px 20px",borderRadius:10,fontSize:13,fontWeight:600,zIndex:200,boxShadow:"0 8px 24px rgba(0,0,0,0.25)",maxWidth:"90vw",textAlign:"center"}}>{toast.msg}</div>;
}

function EtapasResumen({ oc }) {
  const etapas=[
    {key:"compra",ok:oc.estado_compra==="comprado",label:"Compra"},
    {key:"entrega",ok:oc.estado_entrega==="confirmada",label:"Entrega"},
    {key:"factura",ok:oc.estado_factura_propia==="emitida",label:"Factura"},
    {key:"cobro",ok:oc.estado_pago_cliente==="pagado",label:"Cobro"},
    {key:"financ",ok:oc.estado_pago_financiamiento==="pagado",label:"Financ."},
  ];
  return (
    <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
      {etapas.map(e=>(
        <span key={e.key} style={{fontSize:10,fontWeight:700,padding:"3px 7px",borderRadius:6,background:e.ok?C.okLight:C.dangerLight,color:e.ok?C.ok:C.danger,display:"inline-flex",alignItems:"center",gap:3}}>
          {e.ok?"✓":"○"} {e.label}
        </span>
      ))}
    </div>
  );
}

function Trazabilidad({ creadoPor, creadoEn, perfiles }) {
  const u=perfiles?.find(p=>p.id===creadoPor);
  return <span style={{fontSize:10.5,color:C.inkFaint}}>{u?u.nombre:"Usuario"} · {fmt.datetime(creadoEn)}</span>;
}

// Badge de días para facturas
function DiasBadge({ dias }) {
  if(dias===null||dias===undefined) return null;
  const color = dias>=39 ? C.danger : dias>=30 ? C.warn : C.ok;
  const bg = dias>=39 ? C.dangerLight : dias>=30 ? C.warnLight : C.okLight;
  const label = dias>=39 ? "⚠ Reclamar" : dias>=30 ? "Vence pronto" : "Al día";
  return (
    <span style={{display:"inline-flex",alignItems:"center",gap:4,padding:"3px 8px",borderRadius:20,fontSize:11,fontWeight:700,background:bg,color}}>
      {dias}d · {label}
    </span>
  );
}

// Indicador de progreso de etapas por OC
function EtapasOC({ oc }) {
  const etapas = [
    { key:"compra",   label:"Compra",   ok: (oc.eventos_compra||[]).length>0,            icon:"📦" },
    { key:"entrega",  label:"Entrega",  ok: oc.estado_entrega==="entregado",              icon:"🚚" },
    { key:"factura",  label:"Factura",  ok: oc.estado_factura_propia==="emitida",         icon:"🧾" },
    { key:"cobro",    label:"Cobro",    ok: oc.estado_pago_cliente==="pagado",            icon:"💰" },
    { key:"financ",   label:"Financ.",  ok: oc.estado_pago_financiamiento==="pagado",     icon:"🏦" },
  ];
  const completadas = etapas.filter(e=>e.ok).length;
  return (
    <div style={{marginBottom:10}}>
      <div style={{display:"flex",alignItems:"center",gap:0,marginBottom:6}}>
        {etapas.map((e,i)=>(
          <>
            <div key={e.key} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2,flex:1}}>
              <div style={{
                width:32,height:32,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",
                fontSize:15,background:e.ok?C.ok:C.paper,border:`2px solid ${e.ok?C.ok:C.border}`,
                transition:"all 0.2s"
              }}>{e.ok?e.icon:<span style={{fontSize:11,color:C.inkFaint}}>{i+1}</span>}</div>
              <span style={{fontSize:9.5,color:e.ok?C.ok:C.inkFaint,fontWeight:e.ok?700:400,textAlign:"center"}}>{e.label}</span>
            </div>
            {i<etapas.length-1&&(
              <div style={{height:2,flex:0.5,background:etapas[i+1].ok&&e.ok?C.ok:C.border,marginBottom:18,transition:"all 0.2s"}} />
            )}
          </>
        ))}
      </div>
      <div style={{fontSize:10.5,color:completadas===5?C.ok:C.inkMuted,textAlign:"right",fontWeight:completadas===5?700:400}}>
        {completadas===5?"✓ OC completada":`${completadas}/5 etapas completadas`}
      </div>
    </div>
  );
}

// Panel de links de productos por OC
function PanelLinksProductos({ oc, onGuardar, onEliminar, onEditar }) {
  const [showForm,setShowForm]=useState(false);
  const [desc,setDesc]=useState(""); const [url,setUrl]=useState(""); const [saving,setSaving]=useState(false);
  const [editId,setEditId]=useState(null); const [editDesc,setEditDesc]=useState(""); const [editUrl,setEditUrl]=useState("");
  const links=(oc.oc_productos_link||[]).sort((a,b)=>a.orden-b.orden);

  const handleGuardar=async()=>{
    if(!desc.trim()||!url.trim()) return;
    setSaving(true);
    await onGuardar(oc.id,{descripcion:desc.trim(),url:url.trim(),orden:links.length});
    setDesc(""); setUrl(""); setShowForm(false); setSaving(false);
  };
  const handleEditar=async(id)=>{
    if(!editDesc.trim()||!editUrl.trim()) return;
    await onEditar(id,{descripcion:editDesc.trim(),url:editUrl.trim()});
    setEditId(null);
  };
  const handleEliminar=async(id)=>{
    if(!window.confirm("¿Eliminar este link?")) return;
    await onEliminar(id);
  };

  return (
    <div style={{marginBottom:14}}>
      <div style={{fontSize:11,fontWeight:700,color:C.inkMuted,textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>
        🔗 Links de productos {links.length>0&&<span style={{color:C.teal}}>({links.length})</span>}
      </div>
      {links.length===0&&!showForm&&(
        <div style={{fontSize:12,color:C.inkFaint,marginBottom:8}}>Sin links registrados</div>
      )}
      {links.map((l,i)=>(
        <div key={l.id} style={{background:C.paper,borderRadius:8,padding:"8px 10px",marginBottom:6}}>
          {editId===l.id?(
            <div>
              <Field label="Descripción"><input style={iStyle} value={editDesc} onChange={e=>setEditDesc(e.target.value)} /></Field>
              <Field label="URL"><input style={iStyle} value={editUrl} onChange={e=>setEditUrl(e.target.value)} /></Field>
              <div style={{display:"flex",gap:6}}>
                <button onClick={()=>handleEditar(l.id)} style={btnP(C.teal)}>✓ Guardar</button>
                <button onClick={()=>setEditId(null)} style={btnP(C.inkFaint)}>Cancelar</button>
              </div>
            </div>
          ):(
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:11,color:C.inkMuted,fontWeight:700,minWidth:16}}>{i+1}</span>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:12.5,fontWeight:600,color:C.ink,marginBottom:2}}>{l.descripcion}</div>
                <a href={l.url} target="_blank" rel="noopener noreferrer"
                  style={{fontSize:11,color:C.teal,wordBreak:"break-all",textDecoration:"none"}}>
                  {l.url.length>50?l.url.slice(0,50)+"…":l.url}
                </a>
              </div>
              <button onClick={()=>window.open(l.url,'_blank')} style={{background:C.tealLight,border:"none",borderRadius:6,padding:"5px 8px",fontSize:12,color:C.teal,cursor:"pointer",flexShrink:0}}>↗</button>
              <button onClick={()=>{setEditId(l.id);setEditDesc(l.descripcion);setEditUrl(l.url);}} style={{background:C.warnLight,border:"none",borderRadius:6,padding:"5px 8px",fontSize:12,color:C.warn,cursor:"pointer",flexShrink:0}}>✏️</button>
              <button onClick={()=>handleEliminar(l.id)} style={{background:C.dangerLight,border:"none",borderRadius:6,padding:"5px 8px",fontSize:12,color:C.danger,cursor:"pointer",flexShrink:0}}>✕</button>
            </div>
          )}
        </div>
      ))}
      {showForm&&(
        <div style={{background:C.tealLight,borderRadius:9,padding:"10px 12px",marginBottom:8}}>
          <Field label="Descripción del producto"><input style={iStyle} value={desc} onChange={e=>setDesc(e.target.value)} placeholder="ej: Silla ergonómica negra" /></Field>
          <Field label="Link (URL)"><input style={iStyle} value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://..." /></Field>
          <div style={{display:"flex",gap:8}}>
            <button onClick={handleGuardar} disabled={saving} style={btnP(C.teal)}>{saving?"Guardando…":"✓ Agregar"}</button>
            <button onClick={()=>{setShowForm(false);setDesc("");setUrl("");}} style={btnP(C.inkFaint)}>Cancelar</button>
          </div>
        </div>
      )}
      {!showForm&&(
        <button onClick={()=>setShowForm(true)} style={{...btnP(C.teal),fontSize:12,padding:"6px 12px"}}>+ Agregar producto</button>
      )}
    </div>
  );
}


// ═══════════════════════════════════════════════
// MULTIUSUARIO: Bloqueo, Historial, Comentarios
// ═══════════════════════════════════════════════

// Banner de bloqueo de OC
function BloqueoBanner({ bloqueo }) {
  const segs=Math.max(0,Math.round((new Date(bloqueo.expira_en)-new Date())/1000));
  return (
    <div style={{background:C.warnLight,border:`1px solid ${C.warn}`,borderRadius:9,padding:"10px 14px",marginBottom:12,display:"flex",alignItems:"center",gap:10}}>
      <span style={{fontSize:18}}>🔒</span>
      <div>
        <div style={{fontSize:12.5,fontWeight:700,color:C.warn}}>{bloqueo.usuario_nombre} está editando esta OC</div>
        <div style={{fontSize:11,color:C.inkMuted}}>Disponible en ~{segs} segundos</div>
      </div>
    </div>
  );
}

// Historial de cambios de una OC
function HistorialCambiosOC({ ocId, historialCambios }) {
  const items=(historialCambios||[]).filter(h=>h.oc_id===ocId).slice(0,30);
  if(!items.length) return null;
  return (
    <div style={{marginBottom:14}}>
      <div style={{fontSize:11,fontWeight:700,color:C.inkMuted,textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>📋 Historial de cambios</div>
      {items.map(h=>(
        <div key={h.id} style={{borderLeft:`2px solid ${C.border}`,paddingLeft:10,marginBottom:8}}>
          <div style={{fontSize:12,fontWeight:600,color:C.ink}}>{h.accion}</div>
          {h.campo&&<div style={{fontSize:11,color:C.inkMuted}}>{h.campo}: <span style={{color:C.danger,textDecoration:"line-through"}}>{h.valor_anterior||"—"}</span> → <span style={{color:C.ok}}>{h.valor_nuevo||"—"}</span></div>}
          <div style={{fontSize:10.5,color:C.inkFaint}}>{h.usuario_nombre} · {fmt.datetime(h.creadoEn)}</div>
        </div>
      ))}
    </div>
  );
}

// Comentarios internos por OC
function ComentariosOC({ oc, perfil, onAgregar, onEliminar }) {
  const [texto,setTexto]=useState(""); const [saving,setSaving]=useState(false);
  const comentarios=(oc.oc_comentarios||[]).slice().sort((a,b)=>(b.creadoEn||"").localeCompare(a.creadoEn||""));
  const handleAgregar=async()=>{
    if(!texto.trim()) return;
    setSaving(true);
    await onAgregar(oc.id,texto.trim());
    setTexto(""); setSaving(false);
  };
  return (
    <div style={{marginBottom:14}}>
      <div style={{fontSize:11,fontWeight:700,color:C.inkMuted,textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>
        💬 Notas del equipo {comentarios.length>0&&<span style={{color:C.teal}}>({comentarios.length})</span>}
      </div>
      {comentarios.map(c=>(
        <div key={c.id} style={{background:C.paper,borderRadius:8,padding:"8px 12px",marginBottom:6}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
            <div style={{flex:1}}>
              <div style={{fontSize:10.5,color:C.teal,fontWeight:700,marginBottom:3}}>{c.usuario_nombre} · {fmt.datetime(c.creadoEn)}</div>
              <div style={{fontSize:12.5,color:C.ink,lineHeight:1.5}}>{c.texto}</div>
            </div>
            {perfil?.rol==="admin"&&(
              <button onClick={()=>onEliminar(c.id)} style={{background:"none",border:"none",color:C.inkFaint,fontSize:14,cursor:"pointer",padding:"0 4px",flexShrink:0}}>✕</button>
            )}
          </div>
        </div>
      ))}
      <div style={{display:"flex",gap:6,marginTop:6,alignItems:"center"}}>
        <input
          style={{flex:1,minWidth:0,padding:"8px 10px",borderRadius:8,border:`1px solid ${C.border}`,fontSize:13,fontFamily:SANS,background:C.card,color:C.ink,outline:"none"}}
          value={texto}
          onChange={e=>setTexto(e.target.value)}
          placeholder="Agregar nota…"
          onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&handleAgregar()}
        />
        <button
          onClick={handleAgregar}
          disabled={saving||!texto.trim()}
          style={{flexShrink:0,width:36,height:36,borderRadius:8,border:"none",background:texto.trim()?C.teal:C.inkFaint,color:"#fff",fontSize:16,cursor:texto.trim()?"pointer":"default",display:"flex",alignItems:"center",justifyContent:"center"}}
        >✓</button>
      </div>
    </div>
  );
}

// Badge de notificaciones no leídas
function NotifBadge({ notificaciones }) {
  const noLeidas=(notificaciones||[]).filter(n=>!n.leida).length;
  if(!noLeidas) return null;
  return (
    <span style={{background:C.danger,color:"#fff",borderRadius:10,fontSize:9.5,fontWeight:800,padding:"1px 5px",marginLeft:4,verticalAlign:"top"}}>
      {noLeidas>9?"9+":noLeidas}
    </span>
  );
}

// Panel de notificaciones
function PanelNotificaciones({ notificaciones, onMarcarLeidas }) {
  const [verTodas,setVerTodas]=useState(false);
  const items=verTodas?notificaciones:(notificaciones||[]).filter(n=>!n.leida);
  return (
    <div style={{padding:"0 16px"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
        <div style={{fontWeight:800,fontSize:13}}>🔔 Notificaciones</div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={()=>setVerTodas(v=>!v)} style={{fontSize:11,color:C.teal,background:"none",border:"none",cursor:"pointer"}}>{verTodas?"Solo no leídas":"Ver todas"}</button>
          {(notificaciones||[]).some(n=>!n.leida)&&<button onClick={onMarcarLeidas} style={{fontSize:11,color:C.inkMuted,background:"none",border:"none",cursor:"pointer"}}>Marcar leídas</button>}
        </div>
      </div>
      {items.length===0&&<div style={{fontSize:12,color:C.inkFaint,textAlign:"center",padding:"20px 0"}}>Sin notificaciones{verTodas?"":" no leídas"}</div>}
      {items.map(n=>(
        <div key={n.id} style={{background:n.leida?C.paper:C.tealLight,borderRadius:9,padding:"10px 12px",marginBottom:6,borderLeft:`3px solid ${n.leida?C.border:C.teal}`}}>
          <div style={{fontSize:12.5,color:C.ink,fontWeight:n.leida?400:600}}>{n.mensaje}</div>
          <div style={{fontSize:10.5,color:C.inkFaint,marginTop:3}}>{fmt.datetime(n.creadoEn)}{n.oc_numero&&` · OC ${n.oc_numero}`}</div>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════
// LOGIN
// ═══════════════════════════════════════════════
function LoginScreen({ onLogin }) {
  const [mode,setMode]=useState("login");
  const [email,setEmail]=useState(""); const [pass,setPass]=useState(""); const [nombre,setNombre]=useState("");
  const [err,setErr]=useState(""); const [info,setInfo]=useState(""); const [loading,setLoading]=useState(false);
  const submit = async () => {
    setErr(""); setInfo(""); setLoading(true);
    try {
      if(mode==="login"){
        if(!email.trim()||!pass){setErr("Completa correo y contraseña");return;}
        const s=await supaSignIn(email.trim(),pass); await onLogin(s);
      } else if(mode==="signup") {
        if(!nombre.trim()||!email.trim()||!pass){setErr("Completa todos los campos");return;}
        if(pass.length<6){setErr("Contraseña mínimo 6 caracteres");return;}
        const d=await supaSignUp(email.trim(),pass,nombre.trim());
        if(d.access_token) await onLogin(d);
        else { setInfo("Cuenta creada. Confirma tu correo, luego inicia sesión."); setMode("login"); }
      } else if(mode==="recover") {
        if(!email.trim()){setErr("Indica tu correo");return;}
        await supaResetPassword(email.trim());
        setInfo("Te enviamos un correo con instrucciones para recuperar tu contraseña.");
      }
    } catch(e){setErr(e.message);}
    finally{setLoading(false);}
  };
  return (
    <div style={{minHeight:"100vh",background:`linear-gradient(165deg,${C.night} 0%,#1A2540 60%,${C.tealDark} 130%)`,display:"flex",alignItems:"center",justifyContent:"center",padding:16,fontFamily:SANS}}>
      <div style={{background:C.card,borderRadius:20,padding:"38px 30px",width:"100%",maxWidth:380,boxShadow:"0 30px 70px rgba(0,0,0,0.35)"}}>
        <div style={{textAlign:"center",marginBottom:26}}>
          <div style={{width:50,height:50,background:C.night,borderRadius:12,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 14px",fontFamily:MONO,color:C.teal,fontWeight:800,fontSize:18}}>BFK</div>
          <div style={{fontWeight:800,fontSize:19,color:C.ink,letterSpacing:-0.3}}>Torre de Control</div>
          <div style={{fontSize:12.5,color:C.inkMuted,marginTop:3}}>BFK Ltda · Ventas Mercado Público</div>
        </div>
        {mode!=="recover"&&(
          <div style={{display:"flex",borderRadius:10,background:C.paper,padding:3,marginBottom:22}}>
            {["login","signup"].map(m=>(
              <button key={m} onClick={()=>{setMode(m);setErr("");setInfo("");}} style={{flex:1,padding:"8px",borderRadius:8,border:"none",cursor:"pointer",fontSize:13,fontWeight:700,background:mode===m?C.card:"transparent",color:mode===m?C.ink:C.inkMuted,boxShadow:mode===m?"0 1px 4px rgba(0,0,0,0.08)":"none"}}>
                {m==="login"?"Iniciar sesión":"Crear cuenta"}
              </button>
            ))}
          </div>
        )}
        {mode==="recover"&&<div style={{fontWeight:800,fontSize:15,color:C.ink,marginBottom:16,textAlign:"center"}}>Recuperar contraseña</div>}
        {err&&<div style={{background:C.dangerLight,color:C.danger,borderRadius:9,padding:"9px 12px",fontSize:12.5,marginBottom:14,textAlign:"center",fontWeight:600}}>{err}</div>}
        {info&&<div style={{background:C.okLight,color:C.ok,borderRadius:9,padding:"9px 12px",fontSize:12.5,marginBottom:14,textAlign:"center",fontWeight:600}}>{info}</div>}
        {mode==="signup"&&<Field label="Nombre"><input style={iStyle} value={nombre} onChange={e=>setNombre(e.target.value)} placeholder="Tu nombre" onKeyDown={e=>e.key==="Enter"&&submit()} /></Field>}
        <Field label="Correo"><input style={iStyle} type="email" value={email} onChange={e=>{setEmail(e.target.value);setErr("");}} placeholder="correo@ejemplo.com" onKeyDown={e=>e.key==="Enter"&&submit()} /></Field>
        {mode!=="recover"&&<Field label="Contraseña"><input style={iStyle} type="password" value={pass} onChange={e=>{setPass(e.target.value);setErr("");}} placeholder="••••••••" onKeyDown={e=>e.key==="Enter"&&submit()} /></Field>}
        <button onClick={submit} disabled={loading} style={btnP(loading?C.inkFaint:C.night)}>{loading?"Procesando…":mode==="login"?"Ingresar":mode==="signup"?"Crear cuenta":"Enviar correo de recuperación"}</button>
        {mode==="login"&&<div style={{textAlign:"center",marginTop:14}}><button onClick={()=>{setMode("recover");setErr("");setInfo("");}} style={{background:"none",border:"none",color:C.teal,fontSize:12,fontWeight:700,cursor:"pointer"}}>¿Olvidaste tu contraseña?</button></div>}
        {mode==="recover"&&<div style={{textAlign:"center",marginTop:14}}><button onClick={()=>{setMode("login");setErr("");setInfo("");}} style={{background:"none",border:"none",color:C.teal,fontSize:12,fontWeight:700,cursor:"pointer"}}>← Volver a iniciar sesión</button></div>}
        <div style={{textAlign:"center",fontSize:11,color:C.inkFaint,marginTop:16}}>{mode==="login"?'¿Sin cuenta? Usa "Crear cuenta"':mode==="signup"?"El primer usuario será administrador.":""}</div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// BUSCADOR DE OC
// ═══════════════════════════════════════════════
function BuscadorOC({ ocs, ocId, setOcId, permitirNueva, numeroNueva, setNumeroNueva }) {
  const [query,setQuery]=useState(""); const [open,setOpen]=useState(false);
  const matches=useMemo(()=>{ if(!query.trim()) return []; const q=query.toLowerCase(); return ocs.filter(o=>o.numero_oc.toLowerCase().includes(q)||(o.cliente||"").toLowerCase().includes(q)).slice(0,8); },[query,ocs]);
  const selected=ocs.find(o=>o.id===ocId);
  if(selected) return (
    <div style={{background:C.tealLight,border:`1.5px solid ${C.teal}`,borderRadius:9,padding:"10px 12px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
      <div><div style={{fontWeight:700,fontSize:13.5,color:C.ink,fontFamily:MONO}}>{selected.numero_oc}</div><div style={{fontSize:11.5,color:C.inkMuted}}>{selected.cliente}</div></div>
      <button onClick={()=>{setOcId(null);setQuery("");}} style={{background:"none",border:"none",color:C.tealDark,fontSize:12,fontWeight:700,cursor:"pointer"}}>Cambiar</button>
    </div>
  );
  return (
    <div style={{position:"relative"}}>
      <input style={iMono} placeholder="N° de OC o cliente…" value={query} onChange={e=>{setQuery(e.target.value);setOpen(true);}} onFocus={()=>setOpen(true)} />
      {open&&query.trim()&&(
        <div style={{position:"absolute",top:"calc(100% + 4px)",left:0,right:0,background:C.card,border:`1px solid ${C.border}`,borderRadius:10,boxShadow:"0 8px 24px rgba(0,0,0,0.12)",zIndex:10,maxHeight:220,overflowY:"auto"}}>
          {matches.length===0&&(
            <div style={{padding:12,fontSize:12.5,color:C.inkFaint}}>
              No encontrada.
              {permitirNueva&&<button onClick={()=>{setNumeroNueva(query.trim());setOpen(false);}} style={{display:"block",marginTop:8,background:C.teal,color:"#fff",border:"none",borderRadius:7,padding:"7px 10px",fontSize:12,fontWeight:700,cursor:"pointer",width:"100%"}}>+ Crear OC "{query.trim()}"</button>}
            </div>
          )}
          {matches.map(o=>(
            <div key={o.id} onClick={()=>{setOcId(o.id);setOpen(false);}} style={{padding:"9px 12px",cursor:"pointer",borderBottom:`1px solid ${C.border}`}}>
              <div style={{fontWeight:700,fontSize:13,fontFamily:MONO}}>{o.numero_oc}</div>
              <div style={{fontSize:11.5,color:C.inkMuted}}>{o.cliente}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════
// FORMULARIOS DE EVENTOS RÁPIDOS
// ═══════════════════════════════════════════════
function FormIngresarCompra({ ocs, financiadores, vendedores, onSave, entidadesCatalogo }) {
  const [paso,setPaso]=useState(1);
  // Paso 1 — Datos OC
  const [numOC,setNumOC]=useState("");
  const [vendedorId,setVendedorId]=useState(vendedores[0]?.id||"");
  const [rutCliente,setRutCliente]=useState("");
  const [cliente,setCliente]=useState("");
  const [entidad,setEntidad]=useState("");
  const [comuna,setComuna]=useState("");
  const [contacto,setContacto]=useState("");
  const [correo,setCorreo]=useState("");
  const [autocompletado,setAutocompletado]=useState(false);
  // Paso 2 — Productos
  const [productos,setProductos]=useState([{desc:"",cantidad:1,precioCompra:"",precioVenta:"",link:""}]);
  // Paso 3 — Compra
  const [financiadorId,setFinanciadorId]=useState(financiadores[0]?.id||"");
  const [fechaCompra,setFechaCompra]=useState(new Date().toISOString().slice(0,10));
  const [fechaEst,setFechaEst]=useState("");
  const [obs,setObs]=useState("");
  // Control
  const [err,setErr]=useState(""); const [saving,setSaving]=useState(false);

  // Totales calculados desde productos
  const costoTotal=productos.reduce((s,p)=>s+(Number(p.precioCompra)||0)*(Number(p.cantidad)||1),0);
  const ventaTotal=productos.reduce((s,p)=>s+(Number(p.precioVenta)||0)*(Number(p.cantidad)||1),0);
  const utilidad=ventaTotal-costoTotal;
  const margen=ventaTotal>0?((utilidad/ventaTotal)*100).toFixed(1):0;

  const handleRutChange=(val)=>{
    setRutCliente(val);
    const match=(entidadesCatalogo||[]).find(e=>e.rut===val.trim());
    if(match&&val.trim()){
      if(!entidad) setEntidad(match.nombre_entidad||"");
      if(!comuna) setComuna(match.comuna||"");
      if(!contacto) setContacto(match.contacto||"");
      if(!correo) setCorreo(match.correo||"");
      if(!cliente) setCliente(match.nombre_entidad||"");
      setAutocompletado(true);
    } else { setAutocompletado(false); }
  };

  const addProducto=()=>setProductos(p=>[...p,{desc:"",cantidad:1,precioCompra:"",precioVenta:"",link:""}]);
  const updProducto=(i,field,val)=>setProductos(p=>p.map((x,idx)=>idx===i?{...x,[field]:val}:x));
  const delProducto=(i)=>setProductos(p=>p.filter((_,idx)=>idx!==i));

  const validarPaso1=()=>{
    if(!numOC.trim()){setErr("Ingresa el código de la OC");return false;}
    if(!cliente.trim()){setErr("Ingresa el nombre del cliente");return false;}
    setErr(""); return true;
  };
  const validarPaso2=()=>{
    if(productos.length===0){setErr("Agrega al menos un producto");return false;}
    for(const p of productos){
      if(!p.desc.trim()){setErr("Todos los productos deben tener descripción");return false;}
      if(!p.precioCompra||Number(p.precioCompra)<=0){setErr("Todos los productos deben tener precio de compra");return false;}
      if(!p.precioVenta||Number(p.precioVenta)<=0){setErr("Todos los productos deben tener precio de venta");return false;}
    }
    setErr(""); return true;
  };
  const validarPaso3=()=>{
    if(!financiadorId){setErr("Selecciona el financiador");return false;}
    setErr(""); return true;
  };

  const handleGuardar=async()=>{
    if(!validarPaso3()) return;
    setSaving(true);
    try {
      await onSave({
        esNueva:true, numNueva:numOC.trim(),
        cliente:cliente.toUpperCase(), rutCliente, entidad:entidad.toUpperCase(),
        comuna:comuna.toUpperCase(), contacto, correo, vendedorId,
        montoVenta:ventaTotal, costoCompra:costoTotal,
        fecha:fechaCompra, fechaEst:fechaEst||null,
        financiadorId, proveedor:obs,
        productos:productos.map(p=>({
          descripcion:p.desc.trim(), cantidad:Number(p.cantidad)||1,
          precioCompra:Number(p.precioCompra)||0, precioVenta:Number(p.precioVenta)||0,
          url:p.link.trim(),
        })),
      });
    } catch(e){setErr(e.message);setSaving(false);}
  };

  // ── UI helpers ─────────────────────────────────
  const stepStyle=(n)=>({
    width:28,height:28,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",
    fontSize:12,fontWeight:800,flexShrink:0,
    background:paso>n?C.ok:paso===n?C.teal:C.border,
    color:paso>=n?"#fff":C.inkMuted,
  });
  const lineStyle=(n)=>({height:2,flex:1,background:paso>n?C.ok:C.border});

  return (
    <div>
      {/* Indicador de pasos */}
      <div style={{display:"flex",alignItems:"center",gap:0,marginBottom:20,padding:"0 4px"}}>
        <div style={stepStyle(1)}>1</div>
        <div style={lineStyle(1)} />
        <div style={stepStyle(2)}>2</div>
        <div style={lineStyle(2)} />
        <div style={stepStyle(3)}>3</div>
        <div style={lineStyle(3)} />
        <div style={stepStyle(4)}>✓</div>
      </div>
      <div style={{fontSize:11,color:C.inkMuted,textAlign:"center",marginTop:-14,marginBottom:16}}>
        {paso===1?"Datos de la OC":paso===2?"Productos":paso===3?"Compra":"Resumen y confirmación"}
      </div>

      {/* ─── PASO 1: Datos OC ─── */}
      {paso===1&&(
        <div>
          <Field label="Código OC (Mercado Público)" required>
            <input style={iMono} value={numOC} onChange={e=>setNumOC(e.target.value)} placeholder="ej: 2436-690-AG26" />
          </Field>
          <Field label="Vendedor" required>
            <select style={selStyle} value={vendedorId} onChange={e=>setVendedorId(e.target.value)}>
              {vendedores.map(v=><option key={v.id} value={v.id}>{v.nombre}</option>)}
            </select>
          </Field>
          <div style={{height:1,background:C.border,margin:"14px 0"}} />
          <Field label="RUT del cliente" hint="Escribe el RUT para autocompletar">
            <input style={iStyle} value={rutCliente} onChange={e=>handleRutChange(e.target.value)} placeholder="ej: 69.150.600-2" />
          </Field>
          {autocompletado&&<div style={{background:C.okLight,borderRadius:8,padding:"7px 10px",fontSize:11.5,color:C.ok,fontWeight:600,marginBottom:10}}>✓ Datos autocompletados desde el catálogo</div>}
          <Field label="Institución / Cliente" required>
            <input style={iStyle} value={cliente} onChange={e=>setCliente(e.target.value)} placeholder="ej: Municipalidad de Concepción" />
          </Field>
          <Field label="Entidad (nombre organismo)">
            <input style={iStyle} value={entidad} onChange={e=>setEntidad(e.target.value)} placeholder="ej: Depto. de Salud" />
          </Field>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <Field label="Comuna"><input style={iStyle} value={comuna} onChange={e=>setComuna(e.target.value)} placeholder="ej: Concepción" /></Field>
            <Field label="Contacto"><input style={iStyle} value={contacto} onChange={e=>setContacto(e.target.value)} placeholder="Nombre / teléfono" /></Field>
          </div>
          <Field label="Correo">
            <input style={iStyle} type="email" value={correo} onChange={e=>setCorreo(e.target.value)} placeholder="contacto@entidad.cl" />
          </Field>
        </div>
      )}

      {/* ─── PASO 2: Productos ─── */}
      {paso===2&&(
        <div>
          <div style={{fontSize:12,color:C.inkMuted,marginBottom:12}}>Agrega cada producto con su cantidad, precios y link de compra.</div>
          {productos.map((p,i)=>(
            <div key={i} style={{background:C.paper,borderRadius:10,padding:"12px 12px 8px",marginBottom:10,border:`1px solid ${C.border}`}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                <div style={{fontSize:12,fontWeight:700,color:C.teal}}>Producto {i+1}</div>
                {productos.length>1&&<button onClick={()=>delProducto(i)} style={{background:"none",border:"none",color:C.danger,fontSize:13,cursor:"pointer",padding:"0 4px"}}>✕ Eliminar</button>}
              </div>
              <Field label="Descripción" required>
                <input style={iStyle} value={p.desc} onChange={e=>updProducto(i,"desc",e.target.value)} placeholder="ej: Silla ergonómica negra 3C" />
              </Field>
              <Field label="Link de compra (tienda online)">
                <input style={iStyle} value={p.link} onChange={e=>updProducto(i,"link",e.target.value)} placeholder="https://..." />
              </Field>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
                <Field label="Cantidad">
                  <input style={iMono} type="number" min="1" value={p.cantidad} onChange={e=>updProducto(i,"cantidad",e.target.value)} />
                </Field>
                <Field label="P. Compra ($)" hint="Lo que pagas">
                  <input style={iMono} type="number" value={p.precioCompra} onChange={e=>updProducto(i,"precioCompra",e.target.value)} />
                </Field>
                <Field label="P. Venta ($)" hint="Lo que cobras">
                  <input style={iMono} type="number" value={p.precioVenta} onChange={e=>updProducto(i,"precioVenta",e.target.value)} />
                </Field>
              </div>
              {(p.precioCompra||p.precioVenta)&&(
                <div style={{fontSize:11,color:C.inkMuted,marginTop:4}}>
                  Subtotal compra: <b>${((Number(p.precioCompra)||0)*(Number(p.cantidad)||1)).toLocaleString("es-CL")}</b>
                  {" · "}Subtotal venta: <b>${((Number(p.precioVenta)||0)*(Number(p.cantidad)||1)).toLocaleString("es-CL")}</b>
                </div>
              )}
            </div>
          ))}
          <button onClick={addProducto} style={{...btnP(C.inkFaint),fontSize:12,marginBottom:14}}>+ Agregar otro producto</button>
          {ventaTotal>0&&(
            <div style={{background:C.tealLight,borderRadius:9,padding:"10px 14px",fontSize:12.5}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:4}}>
                <div><div style={{color:C.inkMuted,fontSize:10.5}}>Costo total</div><div style={{fontWeight:700,color:C.ink}}>${costoTotal.toLocaleString("es-CL")}</div></div>
                <div><div style={{color:C.inkMuted,fontSize:10.5}}>Venta total</div><div style={{fontWeight:700,color:C.ink}}>${ventaTotal.toLocaleString("es-CL")}</div></div>
                <div><div style={{color:C.inkMuted,fontSize:10.5}}>Utilidad ({margen}%)</div><div style={{fontWeight:700,color:utilidad>=0?C.ok:C.danger}}>${utilidad.toLocaleString("es-CL")}</div></div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── PASO 3: Compra ─── */}
      {paso===3&&(
        <div>
          <Field label="Financiador" required>
            <select style={selStyle} value={financiadorId} onChange={e=>setFinanciadorId(e.target.value)}>
              {financiadores.map(f=><option key={f.id} value={f.id}>{f.nombre}</option>)}
            </select>
          </Field>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <Field label="Fecha de compra" required>
              <input style={iStyle} type="date" value={fechaCompra} onChange={e=>setFechaCompra(e.target.value)} />
            </Field>
            <Field label="Entrega estimada">
              <input style={iStyle} type="date" value={fechaEst} onChange={e=>setFechaEst(e.target.value)} />
            </Field>
          </div>
          <Field label="Observaciones / Proveedor">
            <input style={iStyle} value={obs} onChange={e=>setObs(e.target.value)} placeholder="ej: MercadoLibre, nota de despacho, etc." />
          </Field>
          {/* Resumen de montos */}
          <div style={{background:C.paper,borderRadius:9,padding:"12px 14px",marginTop:8}}>
            <div style={{fontSize:11,fontWeight:700,color:C.inkMuted,marginBottom:8,textTransform:"uppercase"}}>Resumen financiero</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:4,fontSize:12.5}}>
              <div><div style={{color:C.inkMuted,fontSize:10.5}}>Costo</div><div style={{fontWeight:700}}>${costoTotal.toLocaleString("es-CL")}</div></div>
              <div><div style={{color:C.inkMuted,fontSize:10.5}}>Venta</div><div style={{fontWeight:700}}>${ventaTotal.toLocaleString("es-CL")}</div></div>
              <div><div style={{color:C.inkMuted,fontSize:10.5}}>Utilidad ({margen}%)</div><div style={{fontWeight:700,color:utilidad>=0?C.ok:C.danger}}>${utilidad.toLocaleString("es-CL")}</div></div>
            </div>
          </div>
        </div>
      )}

      {/* ─── PASO 4: Resumen ─── */}
      {paso===4&&(
        <div>
          <div style={{background:C.paper,borderRadius:10,padding:"12px 14px",marginBottom:12}}>
            <div style={{fontSize:11,fontWeight:700,color:C.inkMuted,textTransform:"uppercase",marginBottom:8}}>Datos de la OC</div>
            <div style={{fontSize:12.5,lineHeight:1.8}}>
              <b>OC:</b> {numOC}<br/>
              <b>Vendedor:</b> {vendedores.find(v=>v.id===vendedorId)?.nombre}<br/>
              <b>Cliente:</b> {cliente}{entidad?` · ${entidad}`:""}<br/>
              {comuna&&<><b>Comuna:</b> {comuna}<br/></>}
              {contacto&&<><b>Contacto:</b> {contacto}<br/></>}
              {correo&&<><b>Correo:</b> {correo}<br/></>}
            </div>
          </div>
          <div style={{background:C.paper,borderRadius:10,padding:"12px 14px",marginBottom:12}}>
            <div style={{fontSize:11,fontWeight:700,color:C.inkMuted,textTransform:"uppercase",marginBottom:8}}>{productos.length} Producto{productos.length!==1?"s":""}</div>
            {productos.map((p,i)=>(
              <div key={i} style={{borderLeft:`2px solid ${C.teal}`,paddingLeft:10,marginBottom:8}}>
                <div style={{fontSize:12.5,fontWeight:600}}>{p.desc} × {p.cantidad}</div>
                <div style={{fontSize:11,color:C.inkMuted}}>Compra: ${(Number(p.precioCompra)*Number(p.cantidad)).toLocaleString("es-CL")} · Venta: ${(Number(p.precioVenta)*Number(p.cantidad)).toLocaleString("es-CL")}</div>
                {p.link&&<div style={{fontSize:10.5,color:C.teal,wordBreak:"break-all"}}>{p.link.slice(0,60)}{p.link.length>60?"…":""}</div>}
              </div>
            ))}
          </div>
          <div style={{background:C.tealLight,borderRadius:10,padding:"12px 14px",marginBottom:12}}>
            <div style={{fontSize:11,fontWeight:700,color:C.inkMuted,textTransform:"uppercase",marginBottom:8}}>Resumen financiero</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:4,fontSize:13}}>
              <div><div style={{color:C.inkMuted,fontSize:10.5}}>Costo</div><div style={{fontWeight:800}}>${costoTotal.toLocaleString("es-CL")}</div></div>
              <div><div style={{color:C.inkMuted,fontSize:10.5}}>Venta</div><div style={{fontWeight:800}}>${ventaTotal.toLocaleString("es-CL")}</div></div>
              <div><div style={{color:C.inkMuted,fontSize:10.5}}>Utilidad</div><div style={{fontWeight:800,color:utilidad>=0?C.ok:C.danger}}>${utilidad.toLocaleString("es-CL")} ({margen}%)</div></div>
            </div>
            <div style={{marginTop:8,fontSize:12,color:C.inkMuted}}>
              <b>Financiador:</b> {financiadores.find(f=>f.id===financiadorId)?.nombre} · <b>Fecha:</b> {fechaCompra}
              {fechaEst&&<> · <b>Entrega est.:</b> {fechaEst}</>}
            </div>
          </div>
        </div>
      )}

      {/* Error */}
      {err&&<div style={{background:C.dangerLight,color:C.danger,borderRadius:8,padding:"8px 12px",fontSize:12.5,marginBottom:10,fontWeight:600}}>{err}</div>}

      {/* Navegación entre pasos */}
      <div style={{display:"flex",gap:8,marginTop:8}}>
        {paso>1&&<button onClick={()=>{setErr("");setPaso(p=>p-1);}} style={{...btnP(C.inkFaint),flex:1}}>← Atrás</button>}
        {paso<4&&(
          <button onClick={()=>{
            const ok=paso===1?validarPaso1():paso===2?validarPaso2():validarPaso3();
            if(ok) setPaso(p=>p+1);
          }} style={{...btnP(C.teal),flex:2}}>Siguiente →</button>
        )}
        {paso===4&&(
          <button onClick={handleGuardar} disabled={saving} style={{...btnP(saving?C.inkFaint:C.ok),flex:2}}>{saving?"Guardando…":"✓ Crear OC"}</button>
        )}
      </div>
    </div>
  );
}

function FormConfirmarEntrega({ ocs, onSave, ocPreseleccionada }) {
  const [ocId,setOcId]=useState(ocPreseleccionada||null); const [fecha,setFecha]=useState(new Date().toISOString().slice(0,10));
  const [persona,setPersona]=useState(""); const [err,setErr]=useState(""); const [saving,setSaving]=useState(false);
  const handleSave=async()=>{ if(!ocId){setErr("Selecciona la OC");return;} setErr(""); setSaving(true); try{await onSave({ocId,fecha,personaRecibe:persona});}catch(e){setErr(e.message);}finally{setSaving(false);} };
  return (
    <div>
      {!ocPreseleccionada&&<Field label="Orden de Compra" required><BuscadorOC ocs={ocs} ocId={ocId} setOcId={setOcId} /></Field>}
      <Field label="Fecha de entrega" required><input style={iStyle} type="date" value={fecha} onChange={e=>setFecha(e.target.value)} /></Field>
      <Field label="Persona que recibe"><input style={iStyle} value={persona} onChange={e=>setPersona(e.target.value)} /></Field>
      {err&&<div style={{background:C.dangerLight,color:C.danger,borderRadius:8,padding:"8px 12px",fontSize:12.5,marginBottom:10,fontWeight:600}}>{err}</div>}
      <button onClick={handleSave} disabled={saving} style={btnP(saving?C.inkFaint:C.transit)}>{saving?"Guardando…":"✓ Confirmar entrega"}</button>
    </div>
  );
}

function FormEmitirFactura({ ocs, onSave, ocPreseleccionada }) {
  const [ocId,setOcId]=useState(ocPreseleccionada||null); const [fecha,setFecha]=useState(new Date().toISOString().slice(0,10));
  const [numFact,setNumFact]=useState(""); const [monto,setMonto]=useState("");
  const [notaCredito,setNotaCredito]=useState(""); const [err,setErr]=useState(""); const [saving,setSaving]=useState(false);
  const selected=ocs.find(o=>o.id===ocId);
  const facturaAnterior=(selected?.eventos_factura||[])[0];
  const esReemision=!!facturaAnterior;
  useEffect(()=>{ if(selected&&!monto) setMonto(String(selected.monto_total||"")); },[selected]);
  const handleSave=async()=>{
    if(!ocId){setErr("Selecciona la OC");return;} if(!numFact.trim()){setErr("Indica el número de factura");return;}
    if(!monto||Number(monto)<=0){setErr("Indica el monto");return;}
    if(esReemision&&!notaCredito.trim()){setErr("Esta OC ya tiene una factura — indica el N° de nota de crédito que la anula");return;}
    setErr(""); setSaving(true);
    try{await onSave({ocId,fecha,numeroFactura:numFact.trim(),monto:Number(monto),esReemision,notaCredito:notaCredito.trim(),facturaAnuladaNumero:facturaAnterior?.numero_factura});}
    catch(e){setErr(e.message);}finally{setSaving(false);};
  };
  return (
    <div>
      {!ocPreseleccionada&&<Field label="Orden de Compra" required><BuscadorOC ocs={ocs} ocId={ocId} setOcId={setOcId} /></Field>}
      {esReemision&&(
        <div style={{background:C.warnLight,borderRadius:9,padding:"10px 12px",fontSize:12,color:C.warn,fontWeight:600,marginBottom:14}}>
          Esta OC ya tiene la factura N°{facturaAnterior.numero_factura} ({fmt.date(facturaAnterior.fecha)}). Si la estás reemplazando, indica la nota de crédito que la anula — el pago al vendedor solo contará esta venta una vez.
        </div>
      )}
      <Field label="Fecha de emisión" required><input style={iStyle} type="date" value={fecha} onChange={e=>setFecha(e.target.value)} /></Field>
      <Field label="N° factura" required><input style={iMono} value={numFact} onChange={e=>setNumFact(e.target.value)} placeholder="ej: 215" /></Field>
      <Field label="Monto ($)" required hint="Autocompletado con monto venta de la OC"><input style={iMono} type="number" value={monto} onChange={e=>setMonto(e.target.value)} /></Field>
      {esReemision&&<Field label="N° Nota de crédito (anula factura anterior)" required><input style={iMono} value={notaCredito} onChange={e=>setNotaCredito(e.target.value)} placeholder="ej: 123" /></Field>}
      {err&&<div style={{background:C.dangerLight,color:C.danger,borderRadius:8,padding:"8px 12px",fontSize:12.5,marginBottom:10,fontWeight:600}}>{err}</div>}
      <button onClick={handleSave} disabled={saving} style={btnP(saving?C.inkFaint:C.info)}>{saving?"Guardando…":esReemision?"✓ Reemitir factura":"✓ Registrar factura"}</button>
    </div>
  );
}

function FormPagoCliente({ ocs, onSave, ocPreseleccionada }) {
  const [ocId,setOcId]=useState(ocPreseleccionada||null); const [fecha,setFecha]=useState(new Date().toISOString().slice(0,10));
  const [monto,setMonto]=useState(""); const [err,setErr]=useState(""); const [saving,setSaving]=useState(false);
  const selected=ocs.find(o=>o.id===ocId);
  const saldo=(selected?.monto_facturado||0)-(selected?.monto_cobrado||0);
  useEffect(()=>{ if(selected&&!monto) setMonto(String(saldo||"")); },[selected]);
  const handleSave=async()=>{
    if(!ocId){setErr("Selecciona la OC");return;} if(!monto||Number(monto)<=0){setErr("Indica el monto");return;}
    setErr(""); setSaving(true); try{await onSave({ocId,fecha,monto:Number(monto)});}catch(e){setErr(e.message);}finally{setSaving(false);};
  };
  return (
    <div>
      {!ocPreseleccionada&&<Field label="Orden de Compra" required><BuscadorOC ocs={ocs} ocId={ocId} setOcId={setOcId} /></Field>}
      {selected&&<div style={{background:C.paper,borderRadius:8,padding:"8px 12px",fontSize:12,color:C.inkMuted,marginBottom:12}}>Facturado: <b style={{color:C.ink}}>{fmt.money(selected.monto_facturado)}</b> · Cobrado: <b style={{color:C.ok}}>{fmt.money(selected.monto_cobrado)}</b> · Saldo: <b style={{color:C.danger}}>{fmt.money(saldo)}</b></div>}
      <Field label="Fecha de pago" required><input style={iStyle} type="date" value={fecha} onChange={e=>setFecha(e.target.value)} /></Field>
      <Field label="Monto pagado ($)" required><input style={iMono} type="number" value={monto} onChange={e=>setMonto(e.target.value)} /></Field>
      {err&&<div style={{background:C.dangerLight,color:C.danger,borderRadius:8,padding:"8px 12px",fontSize:12.5,marginBottom:10,fontWeight:600}}>{err}</div>}
      <button onClick={handleSave} disabled={saving} style={btnP(saving?C.inkFaint:C.ok)}>{saving?"Guardando…":"✓ Registrar pago"}</button>
    </div>
  );
}

function FormPagoFinanciamiento({ ocs, financiadores, onSave, ocPreseleccionada, financiadorPreseleccionado }) {
  const [finId,setFinId]=useState(financiadorPreseleccionado||financiadores[0]?.id||""); const [ocId,setOcId]=useState(ocPreseleccionada||null);
  const [fecha,setFecha]=useState(new Date().toISOString().slice(0,10)); const [monto,setMonto]=useState("");
  const [err,setErr]=useState(""); const [saving,setSaving]=useState(false);
  const fin=financiadores.find(f=>f.id===finId);
  const handleSave=async()=>{
    if(!monto||Number(monto)<=0){setErr("Indica el monto");return;}
    setErr(""); setSaving(true); try{await onSave({financiadorId:finId,ocId,fecha,monto:Number(monto)});}catch(e){setErr(e.message);}finally{setSaving(false);};
  };
  return (
    <div>
      <Field label="Financiador" required><select style={selStyle} value={finId} onChange={e=>setFinId(e.target.value)}>{financiadores.map(f=><option key={f.id} value={f.id}>{f.nombre}</option>)}</select></Field>
      {fin&&<div style={{background:C.paper,borderRadius:8,padding:"8px 12px",fontSize:12,color:C.inkMuted,marginBottom:12}}>Deuda actual: <b style={{color:C.danger}}>{fmt.money(fin.saldo_deuda)}</b></div>}
      {!ocPreseleccionada&&<Field label="OC relacionada (opcional)"><BuscadorOC ocs={ocs} ocId={ocId} setOcId={setOcId} /></Field>}
      <Field label="Fecha" required><input style={iStyle} type="date" value={fecha} onChange={e=>setFecha(e.target.value)} /></Field>
      <Field label="Monto ($)" required hint="Se descuenta de la deuda automáticamente"><input style={iMono} type="number" value={monto} onChange={e=>setMonto(e.target.value)} /></Field>
      {err&&<div style={{background:C.dangerLight,color:C.danger,borderRadius:8,padding:"8px 12px",fontSize:12.5,marginBottom:10,fontWeight:600}}>{err}</div>}
      <button onClick={handleSave} disabled={saving} style={btnP(saving?C.inkFaint:C.purple)}>{saving?"Guardando…":"✓ Registrar pago a financiador"}</button>
    </div>
  );
}

// ═══════════════════════════════════════════════
// PANEL — KPIs clickeables + Saldo Proyectado + Deuda General
// ═══════════════════════════════════════════════
function PanelDashboard({ ocs, financiadores, gastos, pagosVendedor, ivaMensual, vendedores, pagoFinSueltos, onNavigate }) {
  const [expandido,setExpandido]=useState(null);

  const kpis=useMemo(()=>{
    const hoy=new Date(); hoy.setHours(0,0,0,0);
    const mesActual=hoy.getMonth()+1; const anioActual=hoy.getFullYear();

    // ── Variables base ──────────────────────────────────────────────────────
    let cobrado=0, ingresos=0, costos=0;
    let creditoPendienteTotal=0;
    let creditoPagadoTotal=0;     // suma de pagos a financiadores (vinculados a OC)
    let costoBFK=0;

    for(const oc of ocs){
      cobrado+=oc.monto_cobrado||0;
      ingresos+=oc.monto_total||0;
      costos+=oc.costo_total||0;
      if(oc.estado_pago_financiamiento!=="pagado") creditoPendienteTotal+=oc.costo_total||0;
      creditoPagadoTotal+=(oc.eventos_pago_financiamiento||[]).reduce((s,e)=>s+(e.monto||0),0);
      const finNombre=oc.financiadores?.nombre||"";
      if(finNombre.toLowerCase().includes("bfk")||finNombre.toLowerCase().includes("cuenta bfk")) costoBFK+=oc.costo_total||0;
    }
    // Sumar también pagos a financiadores sin OC asociada (ej: pagos sueltos a Kevin)
    creditoPagadoTotal+=(pagoFinSueltos||[]).reduce((s,e)=>s+(e.monto||0),0);

    // ── Gastos generales (PAGOS GENERAL) ────────────────────────────────────
    const gastosTotal=gastos.reduce((s,g)=>s+(g.monto||0),0);
    const gastoContador=gastos.filter(g=>g.categoria_id==="cat_contador").reduce((s,g)=>s+(g.monto||0),0);
    const gastoImpuesto=gastos.filter(g=>g.categoria_id==="cat_impuesto").reduce((s,g)=>s+(g.monto||0),0);
    const gastosVendedores=pagosVendedor.reduce((s,p)=>s+(p.monto_pagado||0),0);

    // ── Saldo Cta Cte (fórmula Excel) ───────────────────────────────────────
    // =SUMAR.SI.CONJUNTO(pagos_mp; estado; "REALIZADO") - SUMA(monto_pagado_credito) - SUMA(PAGOS GENERAL) - AB17
    const saldoCtaCte = cobrado - creditoPagadoTotal - gastosTotal - costoBFK;

    // ── Ingresos pendientes (fórmula Excel) ────────────────────────────────────
    // = monto_total de TODAS las OCs que aún no han sido cobradas (con o sin factura)
    let ingresosPendientes=0;
    for(const oc of ocs){
      if(oc.estado_pago_cliente!=="pagado") ingresosPendientes+=oc.monto_total||0;
    }

    // ── Deuda total (fórmula Excel) ─────────────────────────────────────────
    // =SUMA(credito_pendiente_OCs) + deuda_vendedores + deuda_contador + deuda_impuesto
    // Usamos el saldo real de financiadores (ya calculado y ajustado manualmente)
    const deudaFin=financiadores.reduce((s,f)=>s+(Number(f.saldo_deuda)||0),0);
    // Deuda a vendedores del mes actual
    const deudaVendedoresMes=vendedores?.reduce((sv,v)=>{
      const factsMes=ocs.filter(o=>{
        if(o.vendedor_id!==v.id||o.estado_factura_propia!=="emitida"||o.vendedor_pagado) return false;
        const evF=(o.eventos_factura||[])[0]; if(!evF) return false;
        const f=new Date(evF.fecha); return f.getMonth()+1===mesActual&&f.getFullYear()===anioActual;
      });
      const sumaFacts=factsMes.reduce((s,o)=>s+(o.monto_facturado||0),0);
      const ivaMes=ivaMensual.find(i=>i.mes===mesActual&&i.anio===anioActual);
      const impPagado=ivaMes?(ivaMes.iva_ventas-ivaMes.iva_compras):0;
      const calculado=Math.round(sumaFacts/2 - impPagado/2);
      const pagado=pagosVendedor.filter(p=>p.vendedor_id===v.id&&p.mes===mesActual&&p.anio===anioActual).reduce((s,p)=>s+(p.monto_pagado||0),0);
      return sv+Math.max(0,calculado-pagado);
    },0)||0;
    const ivaMes=ivaMensual.find(i=>i.mes===mesActual&&i.anio===anioActual);
    const f29=ivaMes?Math.max(0,(ivaMes.iva_ventas||0)-(ivaMes.iva_compras||0)):0;
    const deudaContadorMes=0; // contador pagado al día según Excel
    const deudaTotal=deudaFin+deudaVendedoresMes+f29+deudaContadorMes;

    // ── Proyectado (fórmula Excel) ───────────────────────────────────────────
    // =K3+K4-M7 = Saldo Cta Cte + Ingresos Pendientes - Deuda
    const saldoProyectado=saldoCtaCte+ingresosPendientes-deudaTotal;

    // ── Por cobrar (para KPI) ────────────────────────────────────────────────
    let porCobrar=0;
    for(const oc of ocs){
      if(oc.estado_factura_propia==="emitida") porCobrar+=(oc.monto_facturado||0)-(oc.monto_cobrado||0);
    }

    // ── Margen promedio del mes ──────────────────────────────────────────────
    const ocsDelMes=ocs.filter(o=>{ const evC=(o.eventos_compra||[])[0]; if(!evC) return false; const f=new Date(evC.fecha); return f.getMonth()+1===mesActual&&f.getFullYear()===anioActual; });
    const margenPromPct=ocsDelMes.length>0?Math.round(ocsDelMes.reduce((s,o)=>{ const v=o.monto_total||0; if(v<=0) return s; return s+((v-(o.costo_total||0))/v)*100; },0)/ocsDelMes.length):0;

    const utilidad=ingresos-costos;
    return {cobrado,porCobrar,deudaFin,utilidad,saldoProyectado,saldoCtaCte,ingresosPendientes,deudaTotal,gastoContador,gastosVendedores,gastoImpuesto,f29,margenPromPct,deudaVendedoresMes};
  },[ocs,financiadores,gastos,pagosVendedor,ivaMensual,vendedores,pagoFinSueltos]);

  // OCs pagadas para expandir "Ingresos cobrados"
  const ocsPagadas=useMemo(()=>ocs.filter(o=>o.estado_pago_cliente==="pagado").map(o=>{
    const evF=(o.eventos_factura||[])[0]; return {...o,fechaFactura:evF?.fecha};
  }),[ocs]);

  // OCs por cobrar
  const ocsPorCobrar=useMemo(()=>ocs.filter(o=>o.estado_factura_propia==="emitida"&&o.estado_pago_cliente!=="pagado").map(o=>{
    const evF=(o.eventos_factura||[])[0]; const dias=fmt.diasDesde(evF?.fecha);
    return {...o,fechaFactura:evF?.fecha,diasDesde:dias};
  }),[ocs]);

  // Utilidad por periodo
  const utilidadPeriodos=useMemo(()=>{
    const hoy=new Date(); const mesActual=hoy.getMonth()+1; const anioActual=hoy.getFullYear();
    const mesAnterior=mesActual===1?12:mesActual-1; const anioMA=mesActual===1?anioActual-1:anioActual;
    const calcUtil=(meses)=>{
      const limite=new Date(); limite.setMonth(limite.getMonth()-meses);
      return ocs.filter(o=>{
        const evC=(o.eventos_compra||[])[0]; if(!evC) return false;
        return new Date(evC.fecha)>=limite;
      }).reduce((s,o)=>s+(o.monto_total||0)-(o.costo_total||0),0);
    };
    const mesAntOcs=ocs.filter(o=>{
      const evC=(o.eventos_compra||[])[0]; if(!evC) return false;
      const f=new Date(evC.fecha); return f.getMonth()+1===mesAnterior&&f.getFullYear()===anioMA;
    });
    const utilMesAnt=mesAntOcs.reduce((s,o)=>s+(o.monto_total||0)-(o.costo_total||0),0);
    return { mesAnterior:utilMesAnt, m3:calcUtil(3), m6:calcUtil(6), m9:calcUtil(9), m12:calcUtil(12), historico:ocs.reduce((s,o)=>s+(o.monto_total||0)-(o.costo_total||0),0), nombreMesAnt:fmt.monthYear(mesAnterior,anioMA) };
  },[ocs]);

  // Deuda vendedores por vendedor
  const deudaVendedores=useMemo(()=>{
    const hoy=new Date(); const mesActual=hoy.getMonth()+1; const anioActual=hoy.getFullYear();
    return vendedores.map(v=>{
      const factsMes=ocs.filter(o=>{
        if(o.vendedor_id!==v.id) return false;
        if(o.estado_factura_propia!=="emitida") return false;
        if(o.vendedor_pagado) return false;
        const evF=(o.eventos_factura||[])[0]; if(!evF) return false;
        const f=new Date(evF.fecha); return f.getMonth()+1===mesActual&&f.getFullYear()===anioActual;
      });
      const sumaFacts=factsMes.reduce((s,o)=>s+(o.monto_facturado||0),0);
      const ivaMesV=ivaMensual.find(i=>i.mes===mesActual&&i.anio===anioActual); const impPagadoV=ivaMesV?Math.max(0,(ivaMesV.iva_ventas||0)-(ivaMesV.iva_compras||0)):0; const pagoCalculado=Math.max(0,Math.round(sumaFacts/2 - impPagadoV/2));
      const pagado=pagosVendedor.filter(p=>p.vendedor_id===v.id&&p.mes===mesActual&&p.anio===anioActual).reduce((s,p)=>s+(p.monto_pagado||0),0);
      return {vendedor:v,pagoCalculado,pagado,deuda:Math.max(0,pagoCalculado-pagado)};
    });
  },[ocs,vendedores,pagosVendedor]);

  const KpiBtn=({label,value,color,id,children})=>(
    <div style={{background:C.card,border:`1px solid ${expandido===id?color:C.border}`,borderRadius:14,overflow:"hidden",marginBottom:10}}>
      <button onClick={()=>setExpandido(expandido===id?null:id)} style={{width:"100%",background:"none",border:"none",padding:"14px 16px",textAlign:"left",cursor:"pointer"}}>
        <div style={{fontSize:11,color:C.inkMuted,fontWeight:600,marginBottom:4}}>{label}</div>
        <div style={{fontSize:22,fontWeight:800,color:color||C.ink,fontFamily:MONO,letterSpacing:-0.5}}>{value}</div>
        <div style={{fontSize:10.5,color:C.inkFaint,marginTop:2}}>{expandido===id?"▲ Cerrar":"▼ Ver detalle"}</div>
      </button>
      {expandido===id&&<div style={{borderTop:`1px solid ${C.border}`,padding:"12px 16px",background:C.paper}}>{children}</div>}
    </div>
  );

  return (
    <div style={{fontFamily:SANS}}>
      {/* SALDO PROYECTADO — protagonista */}
      <div style={{background:`linear-gradient(135deg,${C.night},${C.nightSoft})`,borderRadius:16,padding:"18px 20px",marginBottom:14}}>
        <div style={{fontSize:11.5,color:C.inkFaint,fontWeight:700,marginBottom:6,textTransform:"uppercase",letterSpacing:0.5}}>Saldo Proyectado</div>
        <div style={{fontFamily:MONO,fontWeight:800,fontSize:28,color:kpis.saldoProyectado>=0?C.teal:C.danger,letterSpacing:-1}}>{fmt.money(kpis.saldoProyectado)}</div>
        <div style={{fontSize:11,color:C.inkFaint,marginTop:4}}>Saldo Cta Cte + Ingresos Pendientes − Deuda total</div>
        <div style={{display:"flex",gap:12,marginTop:8,flexWrap:"wrap"}}>
          <div style={{fontSize:10.5,color:C.inkFaint}}>Cta Cte: <span style={{color:C.teal,fontWeight:700}}>{fmt.money(kpis.saldoCtaCte)}</span></div>
          <div style={{fontSize:10.5,color:C.inkFaint}}>Ing. Pendientes: <span style={{color:C.warn,fontWeight:700}}>{fmt.money(kpis.ingresosPendientes)}</span></div>
          <div style={{fontSize:10.5,color:C.inkFaint}}>Deuda: <span style={{color:C.danger,fontWeight:700}}>{fmt.money(kpis.deudaTotal)}</span></div>
        </div>
        {kpis.margenPromPct!==undefined&&<div style={{marginTop:8,display:"inline-flex",alignItems:"center",gap:6,padding:"4px 10px",borderRadius:20,fontSize:11.5,fontWeight:700,background:kpis.margenPromPct>=20?C.okLight:kpis.margenPromPct>=10?C.warnLight:C.dangerLight,color:kpis.margenPromPct>=20?C.ok:kpis.margenPromPct>=10?C.warn:C.danger}}><span>Margen promedio del mes:</span><span>{kpis.margenPromPct}%</span></div>}
      </div>

      {/* 4 KPIs clickeables */}
      <KpiBtn label="Ingresos cobrados" value={fmt.money(kpis.cobrado)} color={C.ok} id="cobrado">
        <div style={{fontSize:11.5,fontWeight:700,color:C.inkMuted,marginBottom:8}}>OC cobradas ({ocsPagadas.length})</div>
        {ocsPagadas.map(o=>(
          <div key={o.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${C.border}`}}>
            <div><div style={{fontFamily:MONO,fontWeight:700,fontSize:12,color:C.ok}}>✓ {o.numero_oc}</div><div style={{fontSize:11,color:C.inkMuted}}>{o.cliente} · Factura {fmt.date(o.fechaFactura)}</div></div>
            <div style={{fontFamily:MONO,fontWeight:800,fontSize:13,color:C.ok}}>{fmt.money(o.monto_cobrado)}</div>
          </div>
        ))}
      </KpiBtn>

      <KpiBtn label="Por cobrar" value={fmt.money(kpis.porCobrar)} color={C.warn} id="porCobrar">
        <div style={{fontSize:11.5,fontWeight:700,color:C.inkMuted,marginBottom:8}}>Facturas pendientes de pago ({ocsPorCobrar.length})</div>
        {ocsPorCobrar.sort((a,b)=>(b.diasDesde||0)-(a.diasDesde||0)).map(o=>(
          <div key={o.id} style={{padding:"8px 0",borderBottom:`1px solid ${C.border}`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{fontFamily:MONO,fontWeight:700,fontSize:12,color:C.danger}}>{o.numero_oc}</div>
              <div style={{fontFamily:MONO,fontWeight:800,fontSize:13,color:C.warn}}>{fmt.money((o.monto_facturado||0)-(o.monto_cobrado||0))}</div>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:3}}>
              <div style={{fontSize:11,color:C.inkMuted}}>{o.cliente} · Factura {fmt.date(o.fechaFactura)}</div>
              {o.diasDesde!==null&&<DiasBadge dias={o.diasDesde} />}
            </div>
          </div>
        ))}
      </KpiBtn>

      <KpiBtn label="Deuda a financiadores" value={fmt.money(kpis.deudaFin)} color={C.danger} id="deudaFin">
        {financiadores.map(f=>(
          <div key={f.id} style={{marginBottom:12}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
              <span style={{fontWeight:700,color:C.ink}}>{f.nombre}</span>
              <span style={{fontFamily:MONO,fontWeight:800,color:C.danger}}>{fmt.money(f.saldo_deuda)}</span>
            </div>
          </div>
        ))}
        <button onClick={()=>onNavigate("financiamiento")} style={{...btnP(C.night),marginTop:4}}>Ver cartola completa →</button>
      </KpiBtn>

      <KpiBtn label="Utilidad bruta" value={fmt.money(kpis.utilidad)} color={C.teal} id="utilidad">
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
          {[
            {label:`${utilidadPeriodos.nombreMesAnt} (mes ant.)`,v:utilidadPeriodos.mesAnterior},
            {label:"Últimos 3 meses",v:utilidadPeriodos.m3},
            {label:"Últimos 6 meses",v:utilidadPeriodos.m6},
            {label:"Últimos 9 meses",v:utilidadPeriodos.m9},
            {label:"Últimos 12 meses",v:utilidadPeriodos.m12},
            {label:"Histórico total",v:utilidadPeriodos.historico},
          ].map(({label,v})=>(
            <div key={label} style={{background:C.card,borderRadius:10,padding:"10px 12px",border:`1px solid ${C.border}`}}>
              <div style={{fontSize:10.5,color:C.inkFaint,marginBottom:3}}>{label}</div>
              <div style={{fontFamily:MONO,fontWeight:800,fontSize:14,color:v>=0?C.teal:C.danger}}>{fmt.money(v)}</div>
            </div>
          ))}
        </div>
        <div style={{fontSize:11,color:C.inkFaint,marginTop:4}}>Utilidad = Ventas − Costo compras (sin descontar gastos indirectos)</div>
      </KpiBtn>

      {/* DEUDA GENERAL */}
      <div style={{marginTop:6}}>
        <div style={{fontSize:12,fontWeight:800,color:C.inkMuted,marginBottom:8,textTransform:"uppercase",letterSpacing:0.4}}>Deuda General</div>
        {deudaVendedores.map(({vendedor,pagoCalculado,pagado,deuda})=>(
          <div key={vendedor.id} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:"12px 15px",marginBottom:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div><div style={{fontWeight:700,color:C.ink,fontSize:13}}>{vendedor.nombre}</div><div style={{fontSize:11,color:C.inkFaint}}>Calculado {fmt.money(pagoCalculado)} · Pagado {fmt.money(pagado)}</div></div>
            <div style={{fontFamily:MONO,fontWeight:800,color:deuda>0?C.warn:C.ok}}>{fmt.money(deuda)}</div>
          </div>
        ))}
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:"12px 15px",marginBottom:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div><div style={{fontWeight:700,color:C.ink,fontSize:13}}>Impuesto (F29 proyectado)</div><div style={{fontSize:11,color:C.inkFaint}}>Débito − Crédito fiscal del mes</div></div>
          <div style={{fontFamily:MONO,fontWeight:800,color:kpis.f29>0?C.warn:C.ok}}>{fmt.money(kpis.f29)}</div>
        </div>
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:"12px 15px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div><div style={{fontWeight:700,color:C.ink,fontSize:13}}>Contador (gastos registrados)</div><div style={{fontSize:11,color:C.inkFaint}}>Total acumulado de pagos</div></div>
          <div style={{fontFamily:MONO,fontWeight:800,color:C.inkMuted}}>{fmt.money(kpis.gastoContador)}</div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// PANEL COMPRAS — listado con filtros + alerta vencimiento facturas
// ═══════════════════════════════════════════════
const FILTROS=[
  {key:"compra",label:"Compra",okField:"estado_compra",okValue:"comprado",okLabel:"Comprado",pendLabel:"Pendiente"},
  {key:"entrega",label:"Entrega",okField:"estado_entrega",okValue:"confirmada",okLabel:"Confirmada",pendLabel:"Sin confirmar"},
  {key:"factura",label:"Factura",okField:"estado_factura_propia",okValue:"emitida",okLabel:"Emitida",pendLabel:"Por emitir"},
  {key:"cobro",label:"Cobro",okField:"estado_pago_cliente",okValue:"pagado",okLabel:"Cobrado",pendLabel:"Por cobrar"},
  {key:"financ",label:"Financ.",okField:"estado_pago_financiamiento",okValue:"pagado",okLabel:"Pagado",pendLabel:"Con deuda"},
];

function FormEditarDatosOC({ oc, onSave, entidadesCatalogo }) {
  const [cliente,setCliente]=useState(oc.cliente||"");
  const [entidad,setEntidad]=useState(oc.entidad||"");
  const [comuna,setComuna]=useState(oc.comuna||"");
  const [contacto,setContacto]=useState(oc.contacto||"");
  const [rutCliente,setRutCliente]=useState(oc.rut_cliente||"");
  const [correo,setCorreo]=useState(oc.correo_cliente||"");
  const [autocompletado,setAutocompletado]=useState(false);
  const [err,setErr]=useState(""); const [saving,setSaving]=useState(false);
  const handleRutChange=(val)=>{
    setRutCliente(val);
    const match=(entidadesCatalogo||[]).find(e=>e.rut===val.trim());
    if(match&&val.trim()){
      if(!entidad) setEntidad(match.nombre_entidad||"");
      if(!comuna) setComuna(match.comuna||"");
      if(!contacto) setContacto(match.contacto||"");
      if(!correo) setCorreo(match.correo||"");
      setAutocompletado(true);
    }
  };
  const handleSave=async()=>{
    setErr(""); setSaving(true);
    try { await onSave({ cliente:cliente.toUpperCase(), entidad:entidad.toUpperCase(), comuna:comuna.toUpperCase(), contacto, rutCliente, correo }); }
    catch(e){ setErr(e.message); } finally{ setSaving(false); }
  };
  return (
    <div>
      <Field label="RUT del cliente" hint="Si ya existe en el catálogo, autocompleta los demás datos"><input style={iStyle} value={rutCliente} onChange={e=>handleRutChange(e.target.value)} placeholder="ej: 12.345.678-9" /></Field>
      {autocompletado&&<div style={{background:C.okLight,borderRadius:8,padding:"8px 12px",fontSize:11.5,color:C.ok,fontWeight:600,marginBottom:12}}>✓ Datos autocompletados desde el catálogo de entidades</div>}
      <Field label="Nombre del cliente" hint="Se guarda en mayúscula"><input style={iStyle} value={cliente} onChange={e=>setCliente(e.target.value)} placeholder="Nombre del cliente" /></Field>
      <Field label="Entidad (organismo público)" hint="Se guarda en mayúscula"><input style={iStyle} value={entidad} onChange={e=>setEntidad(e.target.value)} placeholder="ej: I. Municipalidad de..." /></Field>
      <Field label="Comuna" hint="Se guarda en mayúscula"><input style={iStyle} value={comuna} onChange={e=>setComuna(e.target.value)} placeholder="ej: Concepción" /></Field>
      <Field label="Contacto"><input style={iStyle} value={contacto} onChange={e=>setContacto(e.target.value)} placeholder="Nombre y/o teléfono de contacto" /></Field>
      <Field label="Correo del cliente"><input style={iStyle} type="email" value={correo} onChange={e=>setCorreo(e.target.value)} placeholder="contacto@entidad.cl" /></Field>
      {err&&<div style={{background:C.dangerLight,color:C.danger,borderRadius:8,padding:"8px 12px",fontSize:12.5,marginBottom:10,fontWeight:600}}>{err}</div>}
      <button onClick={handleSave} disabled={saving} style={btnP(saving?C.inkFaint:C.info)}>{saving?"Guardando…":"✓ Guardar datos"}</button>
    </div>
  );
}

function FormEditarEvento({ item, onSave, onCancel }) {
  const e = item.e; const tabla = item.tabla;
  const [fecha,setFecha]=useState(e.fecha||"");
  const [montoVenta,setMontoVenta]=useState(e.monto_venta??"");
  const [costoCompra,setCostoCompra]=useState(e.costo_compra??"");
  const [personaRecibe,setPersonaRecibe]=useState(e.persona_recibe||"");
  const [numeroFactura,setNumeroFactura]=useState(e.numero_factura||"");
  const [monto,setMonto]=useState(e.monto??"");
  const [err,setErr]=useState(""); const [saving,setSaving]=useState(false);

  const handleSave=async()=>{
    setErr(""); setSaving(true);
    try {
      let cambios={fecha};
      if(tabla==="eventos_compra") cambios={...cambios, monto_venta:Number(montoVenta), costo_compra:Number(costoCompra)};
      if(tabla==="eventos_entrega") cambios={...cambios, persona_recibe:personaRecibe};
      if(tabla==="eventos_factura") cambios={...cambios, numero_factura:numeroFactura, monto:Number(monto)};
      if(tabla==="eventos_pago_cliente"||tabla==="eventos_pago_financiamiento") cambios={...cambios, monto:Number(monto)};
      await onSave(tabla, e, cambios);
    } catch(err){ setErr(err.message); } finally{ setSaving(false); }
  };

  return (
    <div>
      <div style={{background:C.warnLight,borderRadius:9,padding:"10px 12px",fontSize:12,color:C.warn,fontWeight:600,marginBottom:14}}>
        ⚠ Editar este evento ajustará automáticamente el saldo del financiador y los totales de la OC según la diferencia.
      </div>
      <Field label="Fecha" required><input style={iStyle} type="date" value={fecha} onChange={ev=>setFecha(ev.target.value)} /></Field>
      {tabla==="eventos_compra"&&(<>
        <Field label="Monto venta ($)" required><input style={iMono} type="number" value={montoVenta} onChange={ev=>setMontoVenta(ev.target.value)} /></Field>
        <Field label="Costo compra ($)" required><input style={iMono} type="number" value={costoCompra} onChange={ev=>setCostoCompra(ev.target.value)} /></Field>
      </>)}
      {tabla==="eventos_entrega"&&(
        <Field label="Persona que recibe"><input style={iStyle} value={personaRecibe} onChange={ev=>setPersonaRecibe(ev.target.value)} /></Field>
      )}
      {tabla==="eventos_factura"&&(<>
        <Field label="N° factura" required><input style={iMono} value={numeroFactura} onChange={ev=>setNumeroFactura(ev.target.value)} /></Field>
        <Field label="Monto ($)" required><input style={iMono} type="number" value={monto} onChange={ev=>setMonto(ev.target.value)} /></Field>
      </>)}
      {(tabla==="eventos_pago_cliente"||tabla==="eventos_pago_financiamiento")&&(
        <Field label="Monto ($)" required><input style={iMono} type="number" value={monto} onChange={ev=>setMonto(ev.target.value)} /></Field>
      )}
      {err&&<div style={{background:C.dangerLight,color:C.danger,borderRadius:8,padding:"8px 12px",fontSize:12.5,marginBottom:10,fontWeight:600}}>{err}</div>}
      <button onClick={handleSave} disabled={saving} style={btnP(saving?C.inkFaint:C.warn)}>{saving?"Guardando…":"✓ Guardar corrección"}</button>
      <button onClick={onCancel} style={{...btnG,marginTop:8,width:"100%"}}>Cancelar</button>
    </div>
  );
}

function FilaOC({ oc, perfiles, expanded, onToggle, contactos, onEnviarReclamo, onGuardarContacto, onGuardarDatosOC, onEditarEvento, financiadores, onConfirmarEntrega, onEmitirFactura, onPagoCliente, onPagoFinanciamiento, entidadesCatalogo, onGuardarLink, onEliminarLink, onEditarLink, bloqueos, perfil, historialCambios, onAgregarComentario, onEliminarComentario, onBloquear, onLiberar, onEliminarOC }) {
  const evF=(oc.eventos_factura||[])[0];
  const dias=fmt.diasDesde(evF?.fecha);
  const saldo=(oc.monto_facturado||0)-(oc.monto_cobrado||0);
  const [reclamando,setReclamando]=useState(false);
  const [editandoDatos,setEditandoDatos]=useState(false);
  const [editandoEvento,setEditandoEvento]=useState(null);
  const [accionRapida,setAccionRapida]=useState(null);
  const [correoFallida,setCorreoFallida]=useState(false);
  const [correoFecha,setCorreoFecha]=useState(false);
  const puedeReclamar = oc.estado_pago_cliente!=="pagado" && evF && dias!==null && dias>=30;

  // Indicador de reclamo: último reclamo y si fue hace menos de 24 hrs
  const ultimoReclamo=(oc.oc_reclamos||[]).slice().sort((a,b)=>b.fecha?.localeCompare(a.fecha))[0];
  const hrsDesdeReclamo=ultimoReclamo?Math.floor((new Date()-new Date(ultimoReclamo.fecha))/(1000*60*60)):null;
  const reclamadaHoy=hrsDesdeReclamo!==null&&hrsDesdeReclamo<24;

  // Bloqueo: buscar si hay un bloqueo vigente de otro usuario
  const bloqueoActivo=(bloqueos||[]).find(b=>b.oc_id===oc.id&&b.usuario_id!==perfil?.id&&new Date(b.expira_en)>new Date());

  const handleToggle=async()=>{
    if(!expanded && onBloquear) await onBloquear(oc.id);
    if(expanded && onLiberar) await onLiberar(oc.id);
    onToggle();
  };

  return (
    <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:13,marginBottom:8,overflow:"hidden"}}>
      <div onClick={handleToggle} style={{padding:"13px 15px",cursor:"pointer"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
          <div>
            <div style={{fontFamily:MONO,fontWeight:800,fontSize:14,color:C.ink}}>{oc.numero_oc}</div>
            <div style={{fontSize:11.5,color:C.inkMuted}}>{oc.cliente}</div>
            {/* Solo nombre del financiador, sin monto ni estado */}
            {oc.financiadores?.nombre&&<div style={{fontSize:11,color:C.inkFaint,marginTop:2}}>Financiador: {oc.financiadores.nombre}</div>}
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontFamily:MONO,fontWeight:800,fontSize:14,color:C.ok}}>{fmt.money(oc.monto_total)}</div>
            {(()=>{ const mg=calcMargen(oc.monto_total,oc.costo_total); return (<div style={{fontSize:10.5}}><span style={{color:C.inkFaint}}>costo {fmt.money(oc.costo_total)}</span>{" · "}<span style={{color:mg.color,fontWeight:700,background:mg.bg,padding:"1px 6px",borderRadius:6}}>ganancia {fmt.money(mg.pesos)} ({mg.pct}%)</span></div>); })()}
          </div>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <EtapasResumen oc={oc} />
          {evF&&dias!==null&&<DiasBadge dias={dias} />}
        </div>
      </div>
      {expanded&&(
        <div style={{borderTop:`1px solid ${C.border}`,padding:"13px 15px",background:C.paper}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,fontSize:12,color:C.inkMuted,marginBottom:10}}>
            <div>Vendedor: <b style={{color:C.ink}}>{oc.vendedores?.nombre||"—"}</b></div>
            <div>Financiador: <b style={{color:C.ink}}>{oc.financiadores?.nombre||"—"}</b></div>
            <div>Facturado: <b style={{color:C.ink}}>{fmt.money(oc.monto_facturado)}</b></div>
            <div>Saldo: <b style={{color:saldo>0?C.danger:C.ok}}>{fmt.money(saldo)}</b></div>
            {oc.entidad&&<div>Entidad: <b style={{color:C.ink}}>{oc.entidad}</b></div>}
            {oc.comuna&&<div>Comuna: <b style={{color:C.ink}}>{oc.comuna}</b></div>}
            {oc.contacto&&<div style={{gridColumn:"1/-1"}}>Contacto: <b style={{color:C.ink}}>{oc.contacto}</b></div>}
            {evF&&<div style={{gridColumn:"1/-1"}}>Factura: <b>{evF.numero_factura}</b> · {fmt.date(evF.fecha)}{dias!==null&&` · ${dias} días`}</div>}
          </div>
          {(oc.oc_reclamos||[]).length>0&&(
            <div style={{marginBottom:10}}>
              <div style={{fontSize:11,fontWeight:700,color:C.warn,marginBottom:5}}>📧 Historial de reclamos ({(oc.oc_reclamos||[]).length})</div>
              {(oc.oc_reclamos||[]).slice().sort((a,b)=>b.fecha?.localeCompare(a.fecha)).map((r,i)=>(
                <div key={r.id} style={{display:"flex",alignItems:"flex-start",gap:8,borderLeft:`2px solid ${C.warn}`,paddingLeft:8,marginBottom:5}}>
                  <div style={{flex:1}}>
                    <div style={{fontSize:11.5,fontWeight:600,color:C.ink}}>{r.correo}</div>
                    <div style={{fontSize:10.5,color:C.inkFaint}}>{fmt.datetime(r.fecha)}{r.usuario_nombre?` · ${r.usuario_nombre}`:""}</div>
                  </div>
                  {i===0&&<span style={{fontSize:10,background:C.warnLight,color:C.warn,borderRadius:5,padding:"2px 6px",fontWeight:700,flexShrink:0}}>Último</span>}
                </div>
              ))}
            </div>
          )}
          {oc.vendedor_pagado&&<div style={{fontSize:11,color:C.ok,fontWeight:600,marginBottom:8}}>✓ Vendedor ya pagado por esta venta</div>}
          {oc.ultima_edicion&&<div style={{fontSize:10.5,color:C.inkFaint,marginBottom:8}}>✏️ Datos editados por <Trazabilidad creadoPor={oc.ultimo_editor} creadoEn={oc.ultima_edicion} perfiles={perfiles} /></div>}

          {bloqueoActivo&&<BloqueoBanner bloqueo={bloqueoActivo} />}
          <EtapasOC oc={oc} />

          <PanelLinksProductos oc={oc} onGuardar={onGuardarLink} onEliminar={onEliminarLink} onEditar={onEditarLink} />
          <ComentariosOC oc={oc} perfil={perfil} onAgregar={onAgregarComentario} onEliminar={onEliminarComentario} />
          <HistorialCambiosOC ocId={oc.id} historialCambios={historialCambios} />

          <div style={{fontSize:11,fontWeight:800,color:C.inkMuted,textTransform:"uppercase",marginBottom:6,letterSpacing:0.3}}>Marcar etapa</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:12}}>
            {oc.estado_entrega!=="confirmada"&&<button onClick={()=>setAccionRapida("entrega")} style={{background:C.transit,border:"none",color:"#fff",borderRadius:9,padding:"9px 8px",fontSize:11.5,fontWeight:700,cursor:"pointer"}}>🚚 Confirmar entrega</button>}
            {oc.estado_factura_propia!=="emitida"&&<button onClick={()=>setAccionRapida("factura")} style={{background:C.info,border:"none",color:"#fff",borderRadius:9,padding:"9px 8px",fontSize:11.5,fontWeight:700,cursor:"pointer"}}>🧾 Emitir factura</button>}
            {oc.estado_factura_propia==="emitida"&&oc.estado_pago_cliente!=="pagado"&&<button onClick={()=>setAccionRapida("pago_cliente")} style={{background:C.ok,border:"none",color:"#fff",borderRadius:9,padding:"9px 8px",fontSize:11.5,fontWeight:700,cursor:"pointer"}}>💰 Pago de factura</button>}
            {oc.estado_pago_financiamiento!=="pagado"&&<button onClick={()=>setAccionRapida("pago_financ")} style={{background:C.purple,border:"none",color:"#fff",borderRadius:9,padding:"9px 8px",fontSize:11.5,fontWeight:700,cursor:"pointer"}}>🏦 Pago financiamiento</button>}
            <button onClick={()=>setCorreoFallida(true)} style={{background:C.warn,border:"none",color:"#fff",borderRadius:9,padding:"9px 8px",fontSize:11.5,fontWeight:700,cursor:"pointer"}}>⚠️ Entrega fallida</button>
            <button onClick={()=>setCorreoFecha(true)} style={{background:C.ink,border:"none",color:"#fff",borderRadius:9,padding:"9px 8px",fontSize:11.5,fontWeight:700,cursor:"pointer"}}>📅 Fecha de entrega</button>
          </div>

          {puedeReclamar&&(
            reclamadaHoy
              ? <div style={{background:C.okLight,border:`1px solid ${C.ok}`,borderRadius:9,padding:"10px 14px",marginBottom:12,display:"flex",alignItems:"center",gap:10}}>
                  <span style={{fontSize:18}}>✅</span>
                  <div>
                    <div style={{fontSize:12.5,fontWeight:700,color:C.ok}}>Reclamada hoy</div>
                    <div style={{fontSize:11,color:C.inkMuted}}>Enviada a {ultimoReclamo.correo} · hace {hrsDesdeReclamo}h</div>
                    <div style={{fontSize:10.5,color:C.inkMuted}}>Volverá a rojo en {24-hrsDesdeReclamo}h si no hay pago</div>
                  </div>
                </div>
              : <button onClick={()=>setReclamando(true)} style={{...btnP(C.danger),marginBottom:12}}>📧 Reclamar pago de factura</button>
          )}
          <button onClick={()=>setEditandoDatos(true)} style={{...btnG,marginBottom:8,width:"100%"}}>✏️ Editar entidad / comuna / contacto</button>
          {perfil?.rol==="admin"&&(
            <button onClick={async()=>{
              if(window.confirm(`¿Eliminar la OC ${oc.numero_oc}?\n\nEsta acción no se puede deshacer.`)) {
                await onEliminarOC(oc.id);
              }
            }} style={{width:"100%",background:"none",border:`1px solid ${C.danger}`,color:C.danger,borderRadius:9,padding:"8px 12px",fontSize:12,fontWeight:600,cursor:"pointer",marginBottom:12}}>
              🗑 Eliminar esta OC
            </button>
          )}
          <div style={{fontSize:11,fontWeight:800,color:C.inkMuted,textTransform:"uppercase",marginBottom:6,letterSpacing:0.3}}>Historial</div>
          {[
            ...(oc.eventos_compra||[]).map(e=>({tipo:"📦 Compra",fecha:e.fecha,extra:"",e,tabla:"eventos_compra"})),
            ...(oc.eventos_entrega||[]).map(e=>({tipo:"🚚 Entrega",fecha:e.fecha,extra:e.persona_recibe?` · ${e.persona_recibe}`:"",e,tabla:"eventos_entrega"})),
            ...(oc.eventos_factura||[]).map(e=>({tipo:`🧾 Factura ${e.numero_factura}`,fecha:e.fecha,extra:` · ${fmt.money(e.monto)}${e.nota_credito?` · anula N°${e.factura_anulada_numero} con NC ${e.nota_credito}`:""}`,e,tabla:"eventos_factura"})),
            ...(oc.eventos_pago_cliente||[]).map(e=>({tipo:`💰 Pago ${fmt.money(e.monto)}`,fecha:e.fecha,extra:"",e,tabla:"eventos_pago_cliente"})),
            ...(oc.eventos_pago_financiamiento||[]).map(e=>({tipo:`🏦 Pago fin. ${fmt.money(e.monto)}`,fecha:e.fecha,extra:"",e,tabla:"eventos_pago_financiamiento"})),
          ].sort((a,b)=>a.fecha>b.fecha?1:-1).map((item,i)=>(
            <div key={i} style={{fontSize:11.5,display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4,gap:6}}>
              <span style={{color:C.ink,flex:1}}>{item.tipo}{item.extra} · {fmt.date(item.fecha)}</span>
              <Trazabilidad creadoPor={item.e.creado_por} creadoEn={item.e.creadoEn} perfiles={perfiles} />
              <button onClick={()=>setEditandoEvento(item)} style={{background:"none",border:"none",cursor:"pointer",fontSize:13,padding:"2px 4px",flexShrink:0}}>✏️</button>
            </div>
          ))}
        </div>
      )}
      {reclamando&&(
        <Modal title="Reclamar pago de factura" onClose={()=>setReclamando(false)}>
          <FormReclamarFactura oc={oc} evF={evF} dias={dias} contactos={contactos||[]}
            onGuardarContacto={onGuardarContacto}
            onEnviar={async(data)=>{ await onEnviarReclamo(data); setReclamando(false); }} />
        </Modal>
      )}
      {editandoDatos&&(
        <Modal title="Editar datos de la OC" onClose={()=>setEditandoDatos(false)}>
          <FormEditarDatosOC oc={oc} entidadesCatalogo={entidadesCatalogo} onSave={async(data)=>{ await onGuardarDatosOC(oc.id,data); setEditandoDatos(false); }} />
        </Modal>
      )}
      {editandoEvento&&(
        <Modal title={`Editar ${editandoEvento.tipo}`} onClose={()=>setEditandoEvento(null)}>
          <FormEditarEvento item={editandoEvento}
            onCancel={()=>setEditandoEvento(null)}
            onSave={async(tabla,eventoOriginal,cambios)=>{ await onEditarEvento(oc, tabla, eventoOriginal, cambios); setEditandoEvento(null); }} />
        </Modal>
      )}
      {accionRapida==="entrega"&&(
        <Modal title="Confirmar entrega" onClose={()=>setAccionRapida(null)}>
          <FormConfirmarEntrega ocs={[oc]} ocPreseleccionada={oc.id} onSave={async(data)=>{ await onConfirmarEntrega(data); setAccionRapida(null); }} />
        </Modal>
      )}
      {accionRapida==="factura"&&(
        <Modal title="Emitir factura" onClose={()=>setAccionRapida(null)}>
          <FormEmitirFactura ocs={[oc]} ocPreseleccionada={oc.id} onSave={async(data)=>{ await onEmitirFactura(data); setAccionRapida(null); }} />
        </Modal>
      )}
      {accionRapida==="pago_cliente"&&(
        <Modal title="Pago de factura" onClose={()=>setAccionRapida(null)}>
          <FormPagoCliente ocs={[oc]} ocPreseleccionada={oc.id} onSave={async(data)=>{ await onPagoCliente(data); setAccionRapida(null); }} />
        </Modal>
      )}
      {accionRapida==="pago_financ"&&(
        <Modal title="Pago de financiamiento" onClose={()=>setAccionRapida(null)}>
          <FormPagoFinanciamiento ocs={[oc]} financiadores={financiadores} ocPreseleccionada={oc.id} financiadorPreseleccionado={oc.financiador_id} onSave={async(data)=>{ await onPagoFinanciamiento(data); setAccionRapida(null); }} />
        </Modal>
      )}
      {correoFallida&&(
        <Modal title="Aviso de entrega fallida" onClose={()=>setCorreoFallida(false)}>
          <FormEntregaFallida oc={oc} entidadesCatalogo={entidadesCatalogo} onEnviar={async()=>{ setCorreoFallida(false); }} />
        </Modal>
      )}
      {correoFecha&&(
        <Modal title="Fecha estimada de entrega" onClose={()=>setCorreoFecha(false)}>
          <FormFechaEntrega oc={oc} entidadesCatalogo={entidadesCatalogo} onEnviar={async()=>{ setCorreoFecha(false); }} />
        </Modal>
      )}
    </div>
  );
}

function PanelCompras({ ocs, perfiles, filtroInicial, contactos, onEnviarReclamo, onGuardarContacto, onGuardarDatosOC, onEditarEvento, financiadores, onConfirmarEntrega, onEmitirFactura, onPagoCliente, onPagoFinanciamiento, entidadesCatalogo, onGuardarLink, onEliminarLink, onEditarLink, bloqueos, perfil, historialCambios, onAgregarComentario, onEliminarComentario, onBloquear, onLiberar, onEliminarOC }) {
  const [filtros,setFiltros]=useState({}); const [busq,setBusq]=useState(""); const [expId,setExpId]=useState(null);
  const [reclamandoBanner,setReclamandoBanner]=useState(null); const [comunaSel,setComunaSel]=useState("");
  useEffect(()=>{ if(filtroInicial) setFiltros({[filtroInicial]:"pend"}); },[filtroInicial]);
  const toggle=(key,val)=>setFiltros(prev=>({...prev,[key]:prev[key]===val?undefined:val}));
  const comunas=useMemo(()=>Array.from(new Set(ocs.map(o=>o.comuna).filter(Boolean))).sort(),[ocs]);
  const filtered=useMemo(()=>ocs.filter(oc=>{
    if(busq.trim()){ const q=busq.toLowerCase(); if(!oc.numero_oc.toLowerCase().includes(q)&&!(oc.cliente||"").toLowerCase().includes(q)&&!(oc.comuna||"").toLowerCase().includes(q)&&!(oc.entidad||"").toLowerCase().includes(q)) return false; }
    if(comunaSel&&oc.comuna!==comunaSel) return false;
    for(const f of FILTROS){ const s=filtros[f.key]; if(!s) continue; const ok=oc[f.okField]===f.okValue; if(s==="ok"&&!ok) return false; if(s==="pend"&&ok) return false; }
    return true;
  }).sort((a,b)=>(b.creadoEn||"").localeCompare(a.creadoEn||"")),[ocs,filtros,busq,comunaSel]);

  // Alertas de vencimiento
  const alertas=useMemo(()=>ocs.filter(o=>{
    if(o.estado_pago_cliente==="pagado") return false;
    const evF=(o.eventos_factura||[])[0]; if(!evF) return false;
    return (fmt.diasDesde(evF.fecha)||0)>=30;
  }).sort((a,b)=>{
    const dA=fmt.diasDesde((a.eventos_factura||[])[0]?.fecha)||0;
    const dB=fmt.diasDesde((b.eventos_factura||[])[0]?.fecha)||0;
    return dB-dA;
  }),[ocs]);

  return (
    <div>
      {alertas.length>0&&(
        <div style={{background:C.dangerLight,border:`1px solid ${C.danger}`,borderRadius:12,padding:"12px 15px",marginBottom:14}}>
          <div style={{fontWeight:800,color:C.danger,fontSize:13,marginBottom:8}}>⚠ {alertas.length} factura{alertas.length>1?"s":""} vencida{alertas.length>1?"s":""}</div>
          {alertas.map(o=>{ const evF=(o.eventos_factura||[])[0]; const dias=fmt.diasDesde(evF?.fecha); return (
            <div key={o.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4,fontSize:12}}>
              <span style={{fontFamily:MONO,fontWeight:700}}>{o.numero_oc}</span>
              <button onClick={()=>setReclamandoBanner(o)} style={{display:"inline-flex",alignItems:"center",gap:4,padding:"3px 8px",borderRadius:20,fontSize:11,fontWeight:700,background:C.danger,color:"#fff",border:"none",cursor:"pointer"}}>
                {dias}d · ⚠ Reclamar
              </button>
            </div>
          );})}
        </div>
      )}
      {reclamandoBanner&&(
        <Modal title="Reclamar pago de factura" onClose={()=>setReclamandoBanner(null)}>
          <FormReclamarFactura oc={reclamandoBanner} evF={(reclamandoBanner.eventos_factura||[])[0]} dias={fmt.diasDesde((reclamandoBanner.eventos_factura||[])[0]?.fecha)} contactos={contactos||[]}
            onGuardarContacto={onGuardarContacto}
            onEnviar={async(data)=>{ await onEnviarReclamo(data); setReclamandoBanner(null); }} />
        </Modal>
      )}
      <input style={{...iStyle,marginBottom:10}} placeholder="Buscar por N° OC, cliente, entidad o comuna…" value={busq} onChange={e=>setBusq(e.target.value)} />
      {comunas.length>0&&(
        <select style={{...selStyle,marginBottom:12}} value={comunaSel} onChange={e=>setComunaSel(e.target.value)}>
          <option value="">Todas las comunas</option>
          {comunas.map(c=><option key={c} value={c}>{c}</option>)}
        </select>
      )}
      <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:14}}>
        {FILTROS.map(f=>(
          <div key={f.key} style={{display:"flex",gap:3}}>
            <button onClick={()=>toggle(f.key,"pend")} style={{fontSize:10.5,fontWeight:700,padding:"5px 8px",borderRadius:7,border:`1.5px solid ${filtros[f.key]==="pend"?C.danger:C.border}`,background:filtros[f.key]==="pend"?C.dangerLight:C.card,color:filtros[f.key]==="pend"?C.danger:C.inkMuted,cursor:"pointer"}}>{f.label}: {f.pendLabel}</button>
            <button onClick={()=>toggle(f.key,"ok")} style={{fontSize:10.5,fontWeight:700,padding:"5px 8px",borderRadius:7,border:`1.5px solid ${filtros[f.key]==="ok"?C.ok:C.border}`,background:filtros[f.key]==="ok"?C.okLight:C.card,color:filtros[f.key]==="ok"?C.ok:C.inkMuted,cursor:"pointer"}}>{f.okLabel}</button>
          </div>
        ))}
      </div>
      <div style={{fontSize:11.5,color:C.inkFaint,marginBottom:10}}>{filtered.length} orden{filtered.length!==1?"es":""}</div>
      {filtered.map(oc=><FilaOC key={oc.id} oc={oc} perfiles={perfiles} expanded={expId===oc.id} onToggle={()=>setExpId(expId===oc.id?null:oc.id)} contactos={contactos} onEnviarReclamo={onEnviarReclamo} onGuardarContacto={onGuardarContacto} onGuardarDatosOC={onGuardarDatosOC} onEditarEvento={onEditarEvento} financiadores={financiadores} onConfirmarEntrega={onConfirmarEntrega} onEmitirFactura={onEmitirFactura} onPagoCliente={onPagoCliente} onPagoFinanciamiento={onPagoFinanciamiento} entidadesCatalogo={entidadesCatalogo} onGuardarLink={onGuardarLink} onEliminarLink={onEliminarLink} onEditarLink={onEditarLink} bloqueos={bloqueos} perfil={perfil} historialCambios={historialCambios} onAgregarComentario={onAgregarComentario} onEliminarComentario={onEliminarComentario} onBloquear={onBloquear} onLiberar={onLiberar} onEliminarOC={onEliminarOC} />)}
      {filtered.length===0&&<div style={{textAlign:"center",padding:30,color:C.inkFaint,fontSize:13}}>No hay órdenes con estos filtros.</div>}
    </div>
  );
}

// ═══════════════════════════════════════════════
// PANEL FINANCIAMIENTO — cartola por financiador
// ═══════════════════════════════════════════════
function PanelFinanciamiento({ financiadores, ocs, ajustes, perfiles, onAjustar }) {
  const [selFin,setSelFin]=useState(null);
  const [ajustando,setAjustando]=useState(null);

  // Construir cartola de movimientos por financiador
  const cartola=(finId)=>{
    const compras=(ocs||[]).filter(o=>o.financiador_id===finId).flatMap(o=>(o.eventos_compra||[]).map(e=>({
      tipo:"compra", fecha:e.fecha, oc:o.numero_oc, monto:e.costo_compra||0, categoria:"Compra", creadoEn:e.creadoEn, creadoPor:e.creado_por,
    })));
    const pagos=(ocs||[]).flatMap(o=>(o.eventos_pago_financiamiento||[]).filter(e=>{
      // Buscar por financiador_id en el evento
      return e.financiador_id===finId;
    }).map(e=>({tipo:"pago",fecha:e.fecha,oc:o.numero_oc||"—",monto:-(e.monto||0),categoria:"Pago",creadoEn:e.creadoEn,creadoPor:e.creado_por})));
    const ajustesF=(ajustes||[]).filter(a=>a.financiador_id===finId).map(a=>({
      tipo:"ajuste",fecha:a.fecha,oc:"—",monto:a.monto_ajuste||0,categoria:"Otro",detalle:a.motivo,creadoEn:a.creadoEn,creadoPor:a.creado_por,
    }));
    return [...compras,...pagos,...ajustesF].sort((a,b)=>b.fecha>a.fecha?1:-1);
  };

  if(selFin) {
    const fin=financiadores.find(f=>f.id===selFin);
    const movs=cartola(selFin);
    return (
      <div>
        <button onClick={()=>setSelFin(null)} style={{background:"none",border:"none",color:C.teal,fontWeight:700,fontSize:13,cursor:"pointer",marginBottom:12,padding:0}}>← Volver</button>
        <div style={{background:`linear-gradient(135deg,${C.night},${C.nightSoft})`,borderRadius:16,padding:"18px 20px",marginBottom:16}}>
          <div style={{fontSize:12,color:C.inkFaint,marginBottom:4}}>{fin?.nombre}</div>
          <div style={{fontFamily:MONO,fontWeight:800,fontSize:30,color:C.danger,letterSpacing:-1}}>{fmt.money(fin?.saldo_deuda)}</div>
          <div style={{fontSize:11,color:C.inkFaint,marginTop:4}}>Deuda actual</div>
        </div>
        <button onClick={()=>setAjustando(fin)} style={{...btnP(C.nightSoft),marginBottom:16}}>Ajustar saldo manualmente</button>
        <div style={{fontSize:12,fontWeight:800,color:C.inkMuted,marginBottom:8,textTransform:"uppercase"}}>Cartola de movimientos</div>
        {movs.length===0&&<div style={{textAlign:"center",padding:20,color:C.inkFaint,fontSize:13}}>Sin movimientos registrados.</div>}
        {movs.map((m,i)=>(
          <div key={i} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:"11px 14px",marginBottom:8}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <div style={{fontSize:12.5,fontWeight:700,color:C.ink}}>{m.categoria} {m.oc!=="—"?`· ${m.oc}`:""}</div>
                <div style={{fontSize:11,color:C.inkFaint}}>{fmt.date(m.fecha)}{m.detalle?` · ${m.detalle}`:""}</div>
                <div style={{fontSize:10.5,color:C.inkFaint,marginTop:2}}><Trazabilidad creadoPor={m.creadoPor} creadoEn={m.creadoEn} perfiles={perfiles} /></div>
              </div>
              <div style={{fontFamily:MONO,fontWeight:800,fontSize:14,color:m.monto>=0?C.danger:C.ok}}>
                {m.monto>=0?"+":""}{fmt.money(m.monto)}
              </div>
            </div>
          </div>
        ))}
        {ajustando&&(
          <Modal title={`Ajustar saldo · ${ajustando.nombre}`} onClose={()=>setAjustando(null)}>
            <FormAjusteSaldo financiador={ajustando} onSave={async(data)=>{await onAjustar(data);setAjustando(null);}} />
          </Modal>
        )}
      </div>
    );
  }

  return (
    <div>
      <div style={{fontSize:12,color:C.inkFaint,marginBottom:12}}>Toca un financiador para ver su cartola de movimientos.</div>
      {financiadores.map(f=>(
        <button key={f.id} onClick={()=>setSelFin(f.id)} style={{width:"100%",background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:16,marginBottom:10,textAlign:"left",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <div style={{fontWeight:800,fontSize:15,color:C.ink}}>{f.nombre}</div>
            <div style={{fontSize:11.5,color:C.inkFaint,marginTop:2}}>Toca para ver cartola →</div>
          </div>
          <div style={{fontFamily:MONO,fontWeight:800,fontSize:20,color:Number(f.saldo_deuda)>0?C.danger:C.ok}}>{fmt.money(f.saldo_deuda)}</div>
        </button>
      ))}
    </div>
  );
}

function FormEntregaFallida({ oc, onEnviar, entidadesCatalogo }) {
  const matchCatalogo=(entidadesCatalogo||[]).find(e=>e.rut===(oc.rut_cliente||"").trim());
  const [lugar,setLugar]=useState("bodega");
  const [motivo,setMotivo]=useState("usted no estaba en el lugar");
  const [correo,setCorreo]=useState(oc.correo_cliente||matchCatalogo?.correo||"");
  const [err,setErr]=useState(""); const [sending,setSending]=useState(false);

  const asunto=`Entrega OC ${oc.numero_oc}`;
  const cuerpo=`Estimado/a,\n\nJunto con saludar le comento que hoy durante la mañana nos acercamos a ${lugar} para hacer la entrega de los productos asociados a la OC del asunto, siendo esta entrega fallida debido a que ${motivo}.\n\nPor favor avisar a personal de bodega que realizaremos un nuevo intento de entrega entre hoy y el resto de la semana en curso.\n\nAgradezco su ayuda con esa gestión.\n\nSin más que agregar, saludos cordiales,\nBFK Ltda`;

  const handleEnviar=async()=>{
    if(!correo.trim()){setErr("Indica el correo del destinatario");return;}
    setErr(""); setSending(true);
    const url=`mailto:${encodeURIComponent(correo)}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`;
    window.location.href=url;
    await onEnviar({correo,ocId:oc.id});
    setSending(false);
  };

  return (
    <div>
      <div style={{background:C.warnLight,borderRadius:9,padding:"10px 12px",fontSize:12.5,color:C.warn,fontWeight:700,marginBottom:14}}>OC {oc.numero_oc} · Correo de entrega fallida</div>
      <Field label="Correo del destinatario" required hint={oc.correo_cliente?"Correo guardado en esta OC":matchCatalogo?"Autocompletado desde el catálogo de entidades":""}><input style={iStyle} type="email" value={correo} onChange={e=>setCorreo(e.target.value)} placeholder="contacto@entidad.cl" /></Field>
      <Field label="Lugar de entrega" required hint="ej: bodega de farmacología, bodega central"><input style={iStyle} value={lugar} onChange={e=>setLugar(e.target.value)} /></Field>
      <Field label="Motivo de la entrega fallida" required hint="ej: usted no estaba en el lugar, bodega estaba cerrada"><input style={iStyle} value={motivo} onChange={e=>setMotivo(e.target.value)} /></Field>
      <div style={{background:C.paper,borderRadius:9,padding:"10px 12px",marginBottom:14}}>
        <div style={{fontSize:10.5,fontWeight:700,color:C.inkMuted,textTransform:"uppercase",marginBottom:4}}>Asunto</div>
        <div style={{fontSize:12.5,color:C.ink,marginBottom:8}}>{asunto}</div>
        <div style={{fontSize:10.5,fontWeight:700,color:C.inkMuted,textTransform:"uppercase",marginBottom:4}}>Vista previa</div>
        <div style={{fontSize:11.5,color:C.ink,whiteSpace:"pre-wrap"}}>{cuerpo}</div>
      </div>
      {err&&<div style={{background:C.dangerLight,color:C.danger,borderRadius:8,padding:"8px 12px",fontSize:12.5,marginBottom:10,fontWeight:600}}>{err}</div>}
      <button onClick={handleEnviar} disabled={sending} style={btnP(sending?C.inkFaint:C.warn)}>{sending?"Abriendo correo…":"📧 Enviar aviso de entrega fallida"}</button>
    </div>
  );
}

function FormFechaEntrega({ oc, onEnviar, entidadesCatalogo }) {
  const matchCatalogo=(entidadesCatalogo||[]).find(e=>e.rut===(oc.rut_cliente||"").trim());
  const evC=(oc.eventos_compra||[])[0];
  const fechaEstimadaDefault=evC?.fecha_entrega_estimada||"";
  const [fechaEntrega,setFechaEntrega]=useState(fechaEstimadaDefault);
  const [correo,setCorreo]=useState(oc.correo_cliente||matchCatalogo?.correo||"");
  const [err,setErr]=useState(""); const [sending,setSending]=useState(false);

  const asunto=`Fecha de entrega OC ${oc.numero_oc}`;
  const fechaFmt=fechaEntrega?fmt.dateLong(fechaEntrega):"[fecha a definir]";
  const cuerpo=`Estimado/a,\n\nJunto con saludar le informamos que la entrega de los productos asociados a la OC del asunto está programada para el día ${fechaFmt}.\n\nQuedamos atentos ante cualquier consulta.\n\nSaludos cordiales,\nBFK Ltda`;

  const handleEnviar=async()=>{
    if(!correo.trim()){setErr("Indica el correo del destinatario");return;}
    if(!fechaEntrega){setErr("Indica la fecha estimada de entrega");return;}
    setErr(""); setSending(true);
    const url=`mailto:${encodeURIComponent(correo)}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`;
    window.location.href=url;
    await onEnviar({correo,ocId:oc.id});
    setSending(false);
  };

  return (
    <div>
      <div style={{background:C.transitLight,borderRadius:9,padding:"10px 12px",fontSize:12.5,color:C.transit,fontWeight:700,marginBottom:14}}>OC {oc.numero_oc} · Correo de fecha de entrega</div>
      <Field label="Correo del destinatario" required hint={oc.correo_cliente?"Correo guardado en esta OC":matchCatalogo?"Autocompletado desde el catálogo de entidades":""}><input style={iStyle} type="email" value={correo} onChange={e=>setCorreo(e.target.value)} placeholder="contacto@entidad.cl" /></Field>
      <Field label="Fecha estimada de entrega" required hint={fechaEstimadaDefault?"Autocompletado con la fecha estimada registrada":""}><input style={iStyle} type="date" value={fechaEntrega} onChange={e=>setFechaEntrega(e.target.value)} /></Field>
      <div style={{background:C.paper,borderRadius:9,padding:"10px 12px",marginBottom:14}}>
        <div style={{fontSize:10.5,fontWeight:700,color:C.inkMuted,textTransform:"uppercase",marginBottom:4}}>Asunto</div>
        <div style={{fontSize:12.5,color:C.ink,marginBottom:8}}>{asunto}</div>
        <div style={{fontSize:10.5,fontWeight:700,color:C.inkMuted,textTransform:"uppercase",marginBottom:4}}>Vista previa</div>
        <div style={{fontSize:11.5,color:C.ink,whiteSpace:"pre-wrap"}}>{cuerpo}</div>
      </div>
      {err&&<div style={{background:C.dangerLight,color:C.danger,borderRadius:8,padding:"8px 12px",fontSize:12.5,marginBottom:10,fontWeight:600}}>{err}</div>}
      <button onClick={handleEnviar} disabled={sending} style={btnP(sending?C.inkFaint:C.transit)}>{sending?"Abriendo correo…":"📅 Enviar fecha estimada de entrega"}</button>
    </div>
  );
}

function FormReclamarFactura({ oc, evF, dias, contactos, onEnviar, onGuardarContacto }) {
  const contactoExistente = contactos.find(c => c.rut === (oc.rut_cliente || "").trim());
  const [rut, setRut] = useState(oc.rut_cliente || "");
  const [nombreCliente, setNombreCliente] = useState(oc.cliente || contactoExistente?.nombre_cliente || "");
  const [correo, setCorreo] = useState(oc.correo_cliente || contactoExistente?.correo || "");
  const [err, setErr] = useState(""); const [sending, setSending] = useState(false);

  const asunto = `OC ${oc.numero_oc} — Solicitud de pago factura N°${evF?.numero_factura || ""}`;
  const cuerpo = `Estimados,\n\nEsperamos se encuentren bien. Por medio del presente correo solicitamos la gestión de pago de la factura N°${evF?.numero_factura || ""} asociada a la Orden de Compra ${oc.numero_oc}, emitida con fecha ${fmt.date(evF?.fecha)}, la cual registra ${dias} días desde su emisión.\n\nQuedamos atentos a su pronta respuesta.\n\nDatos para transferencia:\nBanco Estado\nBFK Ltda.\nRUT: 77.322.317-3\nChequera Electrónica: 54970259913\n\nSaludos cordiales,\nBFK Ltda`;

  const handleEnviar = async () => {
    if (!correo.trim()) { setErr("Indica el correo del cliente"); return; }
    if (!nombreCliente.trim()) { setErr("Indica el nombre del cliente"); return; }
    setErr(""); setSending(true);
    try {
      if (rut.trim() && !contactoExistente) await onGuardarContacto({ rut: rut.trim(), nombreCliente: nombreCliente.trim(), correo: correo.trim() });
      await onEnviar({ correo: correo.trim(), asunto, cuerpo, ocId: oc.id, rut: rut.trim() });
    } catch (e) { setErr(e.message); } finally { setSending(false); }
  };

  return (
    <div>
      <div style={{background:C.dangerLight,borderRadius:9,padding:"10px 12px",fontSize:12.5,color:C.danger,fontWeight:700,marginBottom:14}}>
        Factura {evF?.numero_factura} · {dias} días desde emisión
      </div>
      {oc.ultimo_reclamo_fecha&&<div style={{background:C.warnLight,borderRadius:9,padding:"8px 12px",fontSize:11.5,color:C.warn,fontWeight:600,marginBottom:14}}>Ya se reclamó esta factura el {fmt.datetime(oc.ultimo_reclamo_fecha)}</div>}
      <Field label="RUT del cliente" hint="Para guardar el correo y reutilizarlo después"><input style={iStyle} value={rut} onChange={e=>setRut(e.target.value)} placeholder="ej: 12.345.678-9" /></Field>
      <Field label="Nombre del cliente" required><input style={iStyle} value={nombreCliente} onChange={e=>setNombreCliente(e.target.value)} /></Field>
      <Field label="Correo del cliente" required hint={oc.correo_cliente?"Correo ya guardado en esta OC":contactoExistente?"Correo guardado encontrado para este RUT":"Se guardará para futuras facturas"}><input style={iStyle} type="email" value={correo} onChange={e=>setCorreo(e.target.value)} placeholder="contacto@entidad.cl" /></Field>
      <div style={{background:C.paper,borderRadius:9,padding:"10px 12px",marginBottom:14}}>
        <div style={{fontSize:10.5,fontWeight:700,color:C.inkMuted,textTransform:"uppercase",marginBottom:4}}>Asunto</div>
        <div style={{fontSize:12.5,color:C.ink,marginBottom:8}}>{asunto}</div>
        <div style={{fontSize:10.5,fontWeight:700,color:C.inkMuted,textTransform:"uppercase",marginBottom:4}}>Mensaje</div>
        <div style={{fontSize:12,color:C.ink,whiteSpace:"pre-wrap"}}>{cuerpo}</div>
      </div>
      {err&&<div style={{background:C.dangerLight,color:C.danger,borderRadius:8,padding:"8px 12px",fontSize:12.5,marginBottom:10,fontWeight:600}}>{err}</div>}
      <button onClick={handleEnviar} disabled={sending} style={btnP(sending?C.inkFaint:C.danger)}>{sending?"Enviando…":"✓ Enviar reclamo de pago"}</button>
    </div>
  );
}

function FormAjusteSaldo({ financiador, onSave }) {
  const [monto,setMonto]=useState(""); const [tipo,setTipo]=useState("sumar");
  const [motivo,setMotivo]=useState(""); const [fecha,setFecha]=useState(new Date().toISOString().slice(0,10));
  const [err,setErr]=useState(""); const [saving,setSaving]=useState(false);
  const handleSave=async()=>{
    if(!monto||Number(monto)<=0){setErr("Indica un monto");return;}
    if(!motivo.trim()){setErr("Indica el motivo");return;}
    setErr(""); setSaving(true);
    const montoFinal=tipo==="sumar"?Number(monto):-Number(monto);
    try{await onSave({financiadorId:financiador.id,fecha,montoAjuste:montoFinal,motivo:motivo.trim()});}
    catch(e){setErr(e.message);}finally{setSaving(false);}
  };
  return (
    <div>
      <div style={{background:C.paper,borderRadius:8,padding:"8px 12px",fontSize:12.5,color:C.inkMuted,marginBottom:14}}>
        Saldo actual <b style={{color:C.ink}}>{financiador.nombre}</b>: <b style={{color:C.danger}}>{fmt.money(financiador.saldo_deuda)}</b>
      </div>
      <Field label="Tipo de ajuste">
        <div style={{display:"flex",gap:8}}>
          <button onClick={()=>setTipo("sumar")} style={{flex:1,padding:"9px",borderRadius:9,border:`1.5px solid ${tipo==="sumar"?C.danger:C.border}`,background:tipo==="sumar"?C.dangerLight:C.card,color:tipo==="sumar"?C.danger:C.inkMuted,fontWeight:700,fontSize:12.5,cursor:"pointer"}}>+ Aumentar deuda</button>
          <button onClick={()=>setTipo("restar")} style={{flex:1,padding:"9px",borderRadius:9,border:`1.5px solid ${tipo==="restar"?C.ok:C.border}`,background:tipo==="restar"?C.okLight:C.card,color:tipo==="restar"?C.ok:C.inkMuted,fontWeight:700,fontSize:12.5,cursor:"pointer"}}>− Reducir deuda</button>
        </div>
      </Field>
      <Field label="Monto ($)" required><input style={iMono} type="number" value={monto} onChange={e=>setMonto(e.target.value)} /></Field>
      <Field label="Fecha" required><input style={iStyle} type="date" value={fecha} onChange={e=>setFecha(e.target.value)} /></Field>
      <Field label="Motivo" required hint="Queda registrado en el historial de auditoría"><input style={iStyle} value={motivo} onChange={e=>setMotivo(e.target.value)} placeholder="ej: corrección de saldo histórico" /></Field>
      {err&&<div style={{background:C.dangerLight,color:C.danger,borderRadius:8,padding:"8px 12px",fontSize:12.5,marginBottom:10,fontWeight:600}}>{err}</div>}
      <button onClick={handleSave} disabled={saving} style={btnP(saving?C.inkFaint:C.purple)}>{saving?"Guardando…":"✓ Aplicar ajuste"}</button>
    </div>
  );
}

// ═══════════════════════════════════════════════
// PANEL GASTOS — categorías inteligentes + pago a vendedores
// ═══════════════════════════════════════════════
function PanelGastos({ gastos, categorias, vendedores, pagosVendedor, ocs, onNuevoGasto, onPagoVendedor }) {
  const [showForm,setShowForm]=useState(false);
  const [tipoForm,setTipoForm]=useState("gasto"); // "gasto" | "vendedor"

  const ultimoPorCat=useMemo(()=>{
    const map={};
    for(const g of gastos){ const k=g.categoria_id; if(!map[k]||`${g.anio}-${g.mes}`>`${map[k].anio}-${map[k].mes}`) map[k]=g; }
    return map;
  },[gastos]);

  return (
    <div>
      <div style={{display:"flex",gap:8,marginBottom:16}}>
        <button onClick={()=>{setTipoForm("gasto");setShowForm(true);}} style={btnP(C.warn)}>+ Registrar gasto</button>
        <button onClick={()=>{setTipoForm("vendedor");setShowForm(true);}} style={{...btnP(C.teal),flex:1}}>+ Pago a vendedor</button>
      </div>
      <div style={{fontSize:12.5,fontWeight:800,color:C.inkMuted,marginBottom:8,textTransform:"uppercase",letterSpacing:0.4}}>Último pago por categoría</div>
      {categorias.map(c=>{
        const u=ultimoPorCat[c.id];
        return (
          <div key={c.id} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:"12px 15px",marginBottom:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div>
              <div style={{fontWeight:700,fontSize:13.5,color:C.ink}}>{c.nombre}</div>
              {u?<div style={{fontSize:11.5,color:C.inkMuted}}>{u.subcategoria||"—"} · {fmt.monthYear(u.mes,u.anio)}</div>:<div style={{fontSize:11.5,color:C.inkFaint}}>Sin pagos</div>}
            </div>
            {u&&<div style={{fontFamily:MONO,fontWeight:800,fontSize:15,color:C.warn}}>{fmt.money(u.monto)}</div>}
          </div>
        );
      })}

      {showForm&&tipoForm==="gasto"&&(
        <Modal title="Registrar gasto" onClose={()=>setShowForm(false)}>
          <FormNuevoGasto categorias={categorias} onSave={async(d)=>{await onNuevoGasto(d);setShowForm(false);}} />
        </Modal>
      )}
      {showForm&&tipoForm==="vendedor"&&(
        <Modal title="Pago a vendedor" onClose={()=>setShowForm(false)}>
          <FormPagoVendedorSimple vendedores={vendedores} ocs={ocs} onSave={async(d)=>{await onPagoVendedor(d);setShowForm(false);}} />
        </Modal>
      )}
    </div>
  );
}

function FormNuevoGasto({ categorias, onSave }) {
  const [catId,setCatId]=useState(categorias[0]?.id||""); const [sub,setSub]=useState(""); const [monto,setMonto]=useState("");
  const [mes,setMes]=useState(new Date().getMonth()+1); const [anio,setAnio]=useState(new Date().getFullYear());
  const [fecha,setFecha]=useState(new Date().toISOString().slice(0,10)); const [detalle,setDetalle]=useState("");
  const [err,setErr]=useState(""); const [saving,setSaving]=useState(false);
  const cat=categorias.find(c=>c.id===catId); const subs=cat?.subcategorias||[];
  const handleSubChange=(n)=>{ setSub(n); const s=subs.find(x=>x.nombre===n); if(s?.monto_sugerido) setMonto(String(s.monto_sugerido)); };
  const handleSave=async()=>{
    if(!monto||Number(monto)<=0){setErr("Indica el monto");return;}
    setErr(""); setSaving(true);
    try{await onSave({categoriaId:catId,subcategoria:sub,monto:Number(monto),mes:Number(mes),anio:Number(anio),fecha,detalle});}
    catch(e){setErr(e.message);}finally{setSaving(false);};
  };
  const MESES=["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
  return (
    <div>
      <Field label="Categoría" required><select style={selStyle} value={catId} onChange={e=>{setCatId(e.target.value);setSub("");}}>{categorias.map(c=><option key={c.id} value={c.id}>{c.nombre}</option>)}</select></Field>
      {subs.length>0&&<Field label="Subcategoría"><select style={selStyle} value={sub} onChange={e=>handleSubChange(e.target.value)}><option value="">Selecciona…</option>{subs.map(s=><option key={s.nombre} value={s.nombre}>{s.nombre}{s.monto_sugerido?` (${fmt.money(s.monto_sugerido)})`:"" }</option>)}</select></Field>}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        <Field label="Mes" required><select style={selStyle} value={mes} onChange={e=>setMes(e.target.value)}>{MESES.map((m,i)=><option key={i} value={i+1}>{m}</option>)}</select></Field>
        <Field label="Año" required><input style={iMono} type="number" value={anio} onChange={e=>setAnio(e.target.value)} /></Field>
      </div>
      <Field label="Fecha de pago" required><input style={iStyle} type="date" value={fecha} onChange={e=>setFecha(e.target.value)} /></Field>
      <Field label="Monto ($)" required><input style={iMono} type="number" value={monto} onChange={e=>setMonto(e.target.value)} /></Field>
      <Field label="Detalle"><input style={iStyle} value={detalle} onChange={e=>setDetalle(e.target.value)} /></Field>
      {err&&<div style={{background:C.dangerLight,color:C.danger,borderRadius:8,padding:"8px 12px",fontSize:12.5,marginBottom:10,fontWeight:600}}>{err}</div>}
      <button onClick={handleSave} disabled={saving} style={btnP(saving?C.inkFaint:C.warn)}>{saving?"Guardando…":"✓ Registrar gasto"}</button>
    </div>
  );
}

function FormPagoVendedorSimple({ vendedores, ocs, onSave }) {
  const [vendedorId,setVendedorId]=useState(vendedores[0]?.id||"");
  const [monto,setMonto]=useState(""); const [fecha,setFecha]=useState(new Date().toISOString().slice(0,10));
  const [mes,setMes]=useState(new Date().getMonth()+1); const [anio,setAnio]=useState(new Date().getFullYear());
  const [marcarPagadas,setMarcarPagadas]=useState(true);
  const [err,setErr]=useState(""); const [saving,setSaving]=useState(false);
  const vend=vendedores.find(v=>v.id===vendedorId);
  const MESES=["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
  const labelMes=`Ventas de ${MESES[mes-1]}/${anio}`;
  // OCs que se marcarían como pagadas con este pago
  const ocsDelMes=ocs?.filter(o=>{
    if(o.vendedor_id!==vendedorId||o.estado_factura_propia!=="emitida"||o.vendedor_pagado) return false;
    const evF=(o.eventos_factura||[])[0]; if(!evF) return false;
    const f=new Date(evF.fecha); return f.getMonth()+1===Number(mes)&&f.getFullYear()===Number(anio);
  })||[];
  const handleSave=async()=>{
    if(!monto||Number(monto)<=0){setErr("Indica el monto");return;}
    setErr(""); setSaving(true);
    try{await onSave({vendedorId,monto:Number(monto),fecha,mes:Number(mes),anio:Number(anio),label:labelMes,ocIdsAMarcar:marcarPagadas?ocsDelMes.map(o=>o.id):[]});}
    catch(e){setErr(e.message);}finally{setSaving(false);};
  };
  return (
    <div>
      <Field label="Vendedor" required><select style={selStyle} value={vendedorId} onChange={e=>setVendedorId(e.target.value)}>{vendedores.map(v=><option key={v.id} value={v.id}>{v.nombre}</option>)}</select></Field>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        <Field label="Mes" required><select style={selStyle} value={mes} onChange={e=>setMes(e.target.value)}>{MESES.map((m,i)=><option key={i} value={i+1}>{m}</option>)}</select></Field>
        <Field label="Año" required><input style={iMono} type="number" value={anio} onChange={e=>setAnio(e.target.value)} /></Field>
      </div>
      <div style={{background:C.tealLight,borderRadius:9,padding:"10px 12px",fontSize:12.5,color:C.tealDark,fontWeight:700,marginBottom:12}}>{labelMes}</div>
      <Field label="Fecha de pago" required><input style={iStyle} type="date" value={fecha} onChange={e=>setFecha(e.target.value)} /></Field>
      <Field label="Monto pagado ($)" required><input style={iMono} type="number" value={monto} onChange={e=>setMonto(e.target.value)} /></Field>
      {ocs&&(
        <label style={{display:"flex",alignItems:"flex-start",gap:8,background:C.paper,borderRadius:9,padding:"10px 12px",marginBottom:12,cursor:"pointer"}}>
          <input type="checkbox" checked={marcarPagadas} onChange={e=>setMarcarPagadas(e.target.checked)} style={{marginTop:2}} />
          <span style={{fontSize:12,color:C.inkMuted}}>Marcar las {ocsDelMes.length} OC{ocsDelMes.length!==1?"s":""} facturadas este mes como "vendedor pagado" — evita que se vuelvan a contar si se re-emite la factura en otro mes</span>
        </label>
      )}
      {err&&<div style={{background:C.dangerLight,color:C.danger,borderRadius:8,padding:"8px 12px",fontSize:12.5,marginBottom:10,fontWeight:600}}>{err}</div>}
      <button onClick={handleSave} disabled={saving} style={btnP(saving?C.inkFaint:C.teal)}>{saving?"Guardando…":"✓ Registrar pago"}</button>
    </div>
  );
}

// ═══════════════════════════════════════════════
// PANEL VENDEDORES — fórmula nueva + cartola de pagos
// ═══════════════════════════════════════════════
function PanelVendedores({ vendedores, ocs, ivaMensual, pagosVendedor, onGuardarIva, onPagoVendedor }) {
  const [editIva,setEditIva]=useState(false);
  const hoy=new Date(); const mesActual=hoy.getMonth()+1; const anioActual=hoy.getFullYear();
  const MESES=["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

  const datosVendedor=(v)=>{
    // Para cada mes en que el vendedor tiene facturas, calcular pago
    const mesSet=new Set();
    ocs.filter(o=>o.vendedor_id===v.id&&o.estado_factura_propia==="emitida").forEach(o=>{
      (o.eventos_factura||[]).forEach(ef=>{ const f=new Date(ef.fecha); mesSet.add(`${f.getFullYear()}-${f.getMonth()+1}`); });
    });
    return Array.from(mesSet).sort((a,b)=>b.localeCompare(a)).map(ym=>{
      const [y,m]=[Number(ym.split("-")[0]),Number(ym.split("-")[1])];
      // Suma facturas del vendedor en ese mes
      const sumaFacts=ocs.filter(o=>o.vendedor_id===v.id&&o.estado_factura_propia==="emitida").reduce((s,o)=>{
        const factsMes=(o.eventos_factura||[]).filter(ef=>{ const f=new Date(ef.fecha); return f.getFullYear()===y&&f.getMonth()+1===m; });
        return s+factsMes.reduce((ss,ef)=>ss+(ef.monto||0),0);
      },0);
      const ivaMesV2=ivaMensual.find(i=>i.mes===m&&i.anio===y); const impPagadoV2=ivaMesV2?Math.max(0,(ivaMesV2.iva_ventas||0)-(ivaMesV2.iva_compras||0)):0; const pagoCalculado=Math.max(0,Math.round(sumaFacts/2 - impPagadoV2/2));
      const pagosDelMes=pagosVendedor.filter(p=>p.vendedor_id===v.id&&p.mes===m&&p.anio===y);
      const pagado=pagosDelMes.reduce((s,p)=>s+(p.monto_pagado||0),0);
      const estado=pagado>=pagoCalculado?"pagado":"pendiente";
      return {mes:m,anio:y,label:fmt.monthYear(m,y),sumaFacts,pagoCalculado,pagado,estado,deuda:Math.max(0,pagoCalculado-pagado)};
    });
  };

  return (
    <div>
      {/* IVA del mes para referencia */}
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:16,marginBottom:16}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
          <div style={{fontWeight:800,fontSize:14,color:C.ink}}>IVA del mes ({fmt.monthYear(mesActual,anioActual)})</div>
          <button onClick={()=>setEditIva(true)} style={btnG}>{ivaMensual.find(i=>i.mes===mesActual&&i.anio===anioActual)?"Editar":"Registrar"}</button>
        </div>
        {ivaMensual.find(i=>i.mes===mesActual&&i.anio===anioActual)?
          <div style={{fontFamily:MONO,fontWeight:800,fontSize:18,color:C.info}}>{fmt.money(ivaMensual.find(i=>i.mes===mesActual&&i.anio===anioActual).iva_pagado)}</div>:
          <div style={{fontSize:12.5,color:C.inkFaint}}>Sin registrar.</div>
        }
      </div>

      {vendedores.map(v=>{
        const datos=datosVendedor(v);
        const ultimoPagado=datos.find(d=>d.estado==="pagado");
        const deudaTotal=datos.reduce((s,d)=>s+d.deuda,0);
        return (
          <div key={v.id} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:16,marginBottom:12}}>
            <div style={{fontWeight:800,fontSize:15,color:C.ink,marginBottom:4}}>{v.nombre}</div>
            {ultimoPagado&&<div style={{fontSize:12,color:C.ok,fontWeight:700,marginBottom:6}}>Último pagado: {ultimoPagado.label} · {fmt.money(ultimoPagado.pagado)}</div>}
            {deudaTotal>0&&<div style={{fontSize:12,color:C.warn,fontWeight:700,marginBottom:10}}>Deuda pendiente: {fmt.money(deudaTotal)}</div>}
            <div style={{fontSize:11.5,fontWeight:800,color:C.inkMuted,textTransform:"uppercase",marginBottom:6}}>Cartola de pagos</div>
            {datos.length===0&&<div style={{fontSize:12,color:C.inkFaint}}>Sin facturas registradas.</div>}
            {datos.map(d=>(
              <div key={d.label} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${C.border}`}}>
                <div>
                  <div style={{fontSize:12.5,fontWeight:700,color:C.ink}}>{d.label}</div>
                  <div style={{fontSize:11,color:C.inkFaint}}>Calculado {fmt.money(d.pagoCalculado)} · Facturas {fmt.money(d.sumaFacts)}</div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:12,fontWeight:800,color:d.estado==="pagado"?C.ok:C.warn}}>{d.estado==="pagado"?"Pagado":"Pendiente"} {fmt.money(d.pagado)}</div>
                  {d.deuda>0&&<div style={{fontSize:11,color:C.danger}}>Debe {fmt.money(d.deuda)}</div>}
                </div>
              </div>
            ))}
          </div>
        );
      })}

      {editIva&&(
        <Modal title="IVA mensual" onClose={()=>setEditIva(false)}>
          <FormIvaMensual ivaExistente={ivaMensual.find(i=>i.mes===mesActual&&i.anio===anioActual)} onSave={async(d)=>{await onGuardarIva(d);setEditIva(false);}} />
        </Modal>
      )}
    </div>
  );
}

function FormIvaMensual({ ivaExistente, onSave }) {
  const hoy=new Date();
  const [mes,setMes]=useState(ivaExistente?.mes||hoy.getMonth()+1);
  const [anio,setAnio]=useState(ivaExistente?.anio||hoy.getFullYear());
  const [vN,setVN]=useState(ivaExistente?.ventas_netas||""); const [iV,setIV]=useState(ivaExistente?.iva_ventas||"");
  const [cN,setCN]=useState(ivaExistente?.compras_netas||""); const [iC,setIC]=useState(ivaExistente?.iva_compras||"");
  const [err,setErr]=useState(""); const [saving,setSaving]=useState(false);
  const ivaPagado=Math.max(0,Number(iV||0)-Number(iC||0));
  const MESES=["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
  const handleSave=async()=>{
    setErr(""); setSaving(true);
    try{await onSave({mes:Number(mes),anio:Number(anio),ventasNetas:Number(vN)||0,ivaVentas:Number(iV)||0,comprasNetas:Number(cN)||0,ivaCompras:Number(iC)||0,ivaPagado});}
    catch(e){setErr(e.message);}finally{setSaving(false);};
  };
  return (
    <div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        <Field label="Mes"><select style={selStyle} value={mes} onChange={e=>setMes(e.target.value)}>{MESES.map((m,i)=><option key={i} value={i+1}>{m}</option>)}</select></Field>
        <Field label="Año"><input style={iMono} type="number" value={anio} onChange={e=>setAnio(e.target.value)} /></Field>
        <Field label="Ventas netas ($)"><input style={iMono} type="number" value={vN} onChange={e=>setVN(e.target.value)} /></Field>
        <Field label="IVA ventas ($)"><input style={iMono} type="number" value={iV} onChange={e=>setIV(e.target.value)} /></Field>
        <Field label="Compras netas ($)"><input style={iMono} type="number" value={cN} onChange={e=>setCN(e.target.value)} /></Field>
        <Field label="IVA compras ($)"><input style={iMono} type="number" value={iC} onChange={e=>setIC(e.target.value)} /></Field>
      </div>
      <div style={{background:C.tealLight,borderRadius:9,padding:"10px 12px",fontSize:13,color:C.tealDark,fontWeight:700,marginBottom:14}}>IVA a pagar: {fmt.money(ivaPagado)}</div>
      {err&&<div style={{background:C.dangerLight,color:C.danger,borderRadius:8,padding:"8px 12px",fontSize:12.5,marginBottom:10,fontWeight:600}}>{err}</div>}
      <button onClick={handleSave} disabled={saving} style={btnP(saving?C.inkFaint:C.info)}>{saving?"Guardando…":"✓ Guardar IVA"}</button>
    </div>
  );
}

// ═══════════════════════════════════════════════
// PANEL USUARIOS
// ═══════════════════════════════════════════════
// ═══════════════════════════════════════════════
// PANEL DATOS — Exportar/Importar Excel completo (solo admin)
// ═══════════════════════════════════════════════
function PanelDatos({ session, showToast }) {
  const [exporting,setExporting]=useState(false);
  const [comparando,setComparando]=useState(false);
  const [resumenCambios,setResumenCambios]=useState(null); // {porTabla:[{tabla,hoja,nuevas,actualizadas,sinCambios,filasNuevas,filasActualizadas}]}
  const [archivoData,setArchivoData]=useState(null); // datos parseados del excel subido
  const [aplicando,setAplicando]=useState(false);

  const generarExcelCompleto = async (prefijo="bfk-datos") => {
    const wb = XLSX.utils.book_new();
    for (const { hoja, tabla } of TABLAS_EXPORT) {
      const data = await sel(tabla, session.access_token, "&order=id");
      const ws = XLSX.utils.json_to_sheet(data.length ? data : [{}]);

      // Hoja OrdenesCompra: agregar columnas calculadas de SOLO LECTURA con fórmulas reales de Excel,
      // para auditar visualmente cómo se calculan margen/% y días desde factura.
      // Estas columnas (prefijo "_") se IGNORAN al importar — son solo para revisión.
      if (hoja === "OrdenesCompra" && data.length) {
        const cols = Object.keys(data[0]);
        const colIdx = (name) => cols.indexOf(name);
        const colLetter = (idx) => XLSX.utils.encode_col(idx);
        const idxMontoTotal = colIdx("monto_total");
        const idxCostoTotal = colIdx("costo_total");
        const baseCol = cols.length; // primera columna nueva, después de las existentes

        // Encabezados de las columnas calculadas
        XLSX.utils.sheet_add_aoa(ws, [["_Margen($)", "_Margen(%)"]], { origin: { r:0, c:baseCol } });

        if (idxMontoTotal >= 0 && idxCostoTotal >= 0) {
          const letMonto = colLetter(idxMontoTotal);
          const letCosto = colLetter(idxCostoTotal);
          const letMargenPesos = colLetter(baseCol);
          data.forEach((_, i) => {
            const row = i + 2; // fila 1 = encabezado
            const cellMargen = XLSX.utils.encode_cell({ r:i+1, c:baseCol });
            const cellPct = XLSX.utils.encode_cell({ r:i+1, c:baseCol+1 });
            ws[cellMargen] = { t:"n", f:`${letMonto}${row}-${letCosto}${row}` };
            ws[cellPct] = { t:"n", f:`IF(${letMonto}${row}=0,0,ROUND((${letMonto}${row}-${letCosto}${row})/${letMonto}${row}*100,0))`, z:"0\"%\"" };
          });
        }
        // Expandir el rango de la hoja para que Excel reconozca las nuevas columnas
        const range = XLSX.utils.decode_range(ws["!ref"]);
        range.e.c = Math.max(range.e.c, baseCol+1);
        ws["!ref"] = XLSX.utils.encode_range(range);
      }

      XLSX.utils.book_append_sheet(wb, ws, hoja);
    }
    const fechaStr = new Date().toISOString().slice(0,16).replace(/[:T]/g,"-");
    XLSX.writeFile(wb, `${prefijo}-${fechaStr}.xlsx`);
  };

  const handleExportar = async () => {
    setExporting(true);
    try { await generarExcelCompleto("bfk-datos"); showToast("Excel exportado"); }
    catch (e) { showToast("Error al exportar: "+e.message, "error"); }
    finally { setExporting(false); }
  };

  const handleArchivoSeleccionado = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setComparando(true); setResumenCambios(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type:"array" });
      const datosPorTabla = {};
      for (const { hoja, tabla } of TABLAS_EXPORT) {
        const ws = wb.Sheets[hoja];
        const filas = ws ? XLSX.utils.sheet_to_json(ws) : [];
        // Ignorar columnas calculadas de solo lectura (prefijo "_", ej: _Margen($), _Margen(%))
        datosPorTabla[tabla] = filas.map(fila => {
          const limpia = {};
          for (const k of Object.keys(fila)) { if (!k.startsWith("_")) limpia[k] = fila[k]; }
          return limpia;
        });
      }
      setArchivoData(datosPorTabla);

      // Comparar contra estado actual de Supabase
      const resumen = [];
      for (const { hoja, tabla } of TABLAS_EXPORT) {
        const actuales = await sel(tabla, session.access_token, "&order=id");
        const mapaActual = Object.fromEntries(actuales.map(r => [String(r.id), r]));
        const nuevasFilas = []; const actualizadasFilas = [];
        for (const fila of (datosPorTabla[tabla]||[])) {
          if (!fila.id) continue;
          const id = String(fila.id);
          if (!mapaActual[id]) { nuevasFilas.push(fila); }
          else {
            const existente = mapaActual[id];
            const cambio = Object.keys(fila).some(k => String(fila[k]??"") !== String(existente[k]??""));
            if (cambio) actualizadasFilas.push(fila);
          }
        }
        if (nuevasFilas.length || actualizadasFilas.length) {
          resumen.push({ tabla, hoja, nuevas:nuevasFilas.length, actualizadas:actualizadasFilas.length });
        }
      }
      setResumenCambios(resumen);
      if (resumen.length===0) showToast("Sin cambios detectados respecto a la base de datos actual");
    } catch (e) { showToast("Error al leer el Excel: "+e.message, "error"); }
    finally { setComparando(false); }
  };

  const handleAplicarCambios = async () => {
    if (!archivoData) return;
    setAplicando(true);
    try {
      // Respaldo automático del estado actual ANTES de aplicar cualquier cambio
      await generarExcelCompleto("bfk-RESPALDO-antes-de-importar");
      for (const { tabla } of TABLAS_EXPORT) {
        const actuales = await sel(tabla, session.access_token, "&order=id");
        const mapaActual = Object.fromEntries(actuales.map(r => [String(r.id), r]));
        for (const fila of (archivoData[tabla]||[])) {
          if (!fila.id) continue;
          const id = String(fila.id);
          if (!mapaActual[id]) { await ins(tabla, session.access_token, fila); }
          else {
            const existente = mapaActual[id];
            const cambio = Object.keys(fila).some(k => String(fila[k]??"") !== String(existente[k]??""));
            if (cambio) await upd(tabla, session.access_token, id, fila);
          }
        }
      }
      showToast("Cambios aplicados correctamente");
      setResumenCambios(null); setArchivoData(null);
    } catch (e) { showToast("Error al aplicar cambios: "+e.message, "error"); }
    finally { setAplicando(false); }
  };

  const totalNuevas = resumenCambios?.reduce((s,r)=>s+r.nuevas,0) || 0;
  const totalActualizadas = resumenCambios?.reduce((s,r)=>s+r.actualizadas,0) || 0;

  return (
    <div style={{marginTop:20}}>
      <div style={{fontSize:12,fontWeight:800,color:C.inkMuted,marginBottom:8,textTransform:"uppercase",letterSpacing:0.4}}>Exportar / Importar datos</div>
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:16,marginBottom:12}}>
        <div style={{fontSize:12.5,color:C.inkMuted,marginBottom:12}}>Descarga toda la base de datos en un Excel con una hoja por tabla. Edítalo y vuelve a subirlo para actualizar los valores.</div>
        <button onClick={handleExportar} disabled={exporting} style={{...btnP(exporting?C.inkFaint:C.teal),marginBottom:10}}>{exporting?"Generando…":"⬇ Exportar Excel completo"}</button>
        <label style={{...btnG,display:"block",textAlign:"center",cursor:"pointer"}}>
          {comparando?"Comparando…":"⬆ Subir Excel editado"}
          <input type="file" accept=".xlsx" onChange={handleArchivoSeleccionado} style={{display:"none"}} disabled={comparando} />
        </label>
      </div>

      {resumenCambios && resumenCambios.length>0 && (
        <div style={{background:C.warnLight,border:`1px solid ${C.warn}`,borderRadius:14,padding:16,marginBottom:12}}>
          <div style={{fontWeight:800,color:C.warn,fontSize:13.5,marginBottom:10}}>Resumen de cambios detectados</div>
          {resumenCambios.map(r=>(
            <div key={r.tabla} style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:5}}>
              <span style={{color:C.ink,fontWeight:600}}>{r.hoja}</span>
              <span style={{color:C.inkMuted}}>{r.nuevas>0&&`+${r.nuevas} nuevas `}{r.actualizadas>0&&`· ${r.actualizadas} actualizadas`}</span>
            </div>
          ))}
          <div style={{borderTop:`1px solid ${C.warn}`,marginTop:8,paddingTop:8,fontSize:12.5,fontWeight:700,color:C.ink}}>
            Total: {totalNuevas} filas nuevas, {totalActualizadas} actualizadas
          </div>
          <div style={{fontSize:11,color:C.inkMuted,marginTop:8}}>📥 Al confirmar, se descargará automáticamente un respaldo del estado actual antes de aplicar los cambios.</div>
          <button onClick={handleAplicarCambios} disabled={aplicando} style={{...btnP(aplicando?C.inkFaint:C.danger),marginTop:12}}>{aplicando?"Respaldando y aplicando…":"✓ Confirmar y aplicar cambios"}</button>
          <button onClick={()=>{setResumenCambios(null);setArchivoData(null);}} style={{...btnG,marginTop:8,width:"100%"}}>Cancelar</button>
        </div>
      )}
    </div>
  );
}

function PanelUsuarios({ perfiles, ocs, onChangeRol, session, showToast, entidadesCatalogo, onImportarEntidades }) {
  const [showImport,setShowImport]=useState(false);
  const [importFile,setImportFile]=useState(null);
  const [importMsg,setImportMsg]=useState("");

  const handleImport=async()=>{
    if(!importFile){setImportMsg("Selecciona un archivo primero");return;}
    setImportMsg("Procesando…");
    try {
      const text=await importFile.text();
      const lines=text.split('\n').filter(l=>l.trim());
      const header=lines[0].toLowerCase().split(',');
      const idxRut=header.findIndex(h=>h.includes('rut'));
      const idxNombre=header.findIndex(h=>h.includes('nombre')||h.includes('entidad'));
      const idxComuna=header.findIndex(h=>h.includes('comuna'));
      const idxContacto=header.findIndex(h=>h.includes('contacto'));
      const idxCorreo=header.findIndex(h=>h.includes('correo')||h.includes('email'));
      if(idxRut<0||idxNombre<0){setImportMsg("El archivo debe tener columnas 'rut' y 'nombre' (o 'entidad')");return;}
      const rows=lines.slice(1).map(l=>l.split(',')).filter(r=>r[idxRut]?.trim());
      await onImportarEntidades(rows.map(r=>({
        rut:r[idxRut]?.trim()||"",
        nombre_entidad:r[idxNombre]?.trim()||"",
        comuna:idxComuna>=0?r[idxComuna]?.trim()||"":"",
        contacto:idxContacto>=0?r[idxContacto]?.trim()||"":"",
        correo:idxCorreo>=0?r[idxCorreo]?.trim()||"":"",
      })));
      setImportMsg(`✓ ${rows.length} entidades importadas`);
      setImportFile(null);
    } catch(e){setImportMsg("Error: "+e.message);}
  };

  // Calcula la fecha del último evento creado por cada usuario, cruzando todas las tablas de eventos embebidas en ocs
  const ultimaActividad = useMemo(() => {
    const map = {};
    for (const oc of ocs) {
      const todos = [
        ...(oc.eventos_compra||[]), ...(oc.eventos_entrega||[]), ...(oc.eventos_factura||[]),
        ...(oc.eventos_pago_cliente||[]), ...(oc.eventos_pago_financiamiento||[]),
      ];
      for (const e of todos) {
        if (!e.creado_por || !e.creadoEn) continue;
        if (!map[e.creado_por] || e.creadoEn > map[e.creado_por]) map[e.creado_por] = e.creadoEn;
      }
    }
    return map;
  }, [ocs]);

  return (
    <div>
      {perfiles.map(p=>{
        const ultima=ultimaActividad[p.id];
        const diasInactivo = ultima ? Math.floor((new Date()-new Date(ultima))/(1000*60*60*24)) : null;
        const activo = diasInactivo!==null && diasInactivo<=14;
        return (
          <div key={p.id} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:"12px 15px",marginBottom:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <span style={{width:7,height:7,borderRadius:"50%",background:activo?C.ok:C.inkFaint,display:"inline-block"}} />
                <span style={{fontWeight:700,fontSize:13.5,color:C.ink}}>{p.nombre}</span>
              </div>
              <div style={{fontSize:11.5,color:C.inkMuted,marginTop:2}}>{p.rol==="admin"?"Administrador":"Usuario"}</div>
              <div style={{fontSize:10.5,color:C.inkFaint,marginTop:2}}>{ultima?`Última actividad: ${fmt.datetime(ultima)}`:"Sin actividad registrada"}</div>
            </div>
            <button onClick={()=>onChangeRol(p.id,p.rol==="admin"?"usuario":"admin")} style={btnG}>{p.rol==="admin"?"Quitar admin":"Hacer admin"}</button>
          </div>
        );
      })}
      <PanelDatos session={session} showToast={showToast} />

      {/* Catálogo de entidades */}
      <div style={{marginTop:20}}>
        <div style={{fontWeight:800,fontSize:13,color:C.ink,marginBottom:4}}>🏢 Catálogo de entidades</div>
        <div style={{fontSize:12,color:C.inkMuted,marginBottom:10}}>
          {(entidadesCatalogo||[]).length} entidades guardadas · Se autocompletan al escribir el RUT en cualquier OC
        </div>
        {!showImport?(
          <button onClick={()=>setShowImport(true)} style={btnP(C.teal)}>⬆ Importar desde CSV/Excel</button>
        ):(
          <div style={{background:C.tealLight,borderRadius:10,padding:"12px 14px"}}>
            <div style={{fontSize:12.5,fontWeight:700,color:C.tealDark,marginBottom:8}}>Importar entidades desde CSV</div>
            <div style={{fontSize:11.5,color:C.inkMuted,marginBottom:10}}>
              El archivo debe tener columnas: <b>rut</b>, <b>nombre</b> (o entidad), y opcionalmente <b>comuna</b>, <b>contacto</b>, <b>correo</b>. Primera fila = encabezados.
            </div>
            <input type="file" accept=".csv,.txt" onChange={e=>setImportFile(e.target.files[0])} style={{marginBottom:10,fontSize:12}} />
            {importMsg&&<div style={{fontSize:12,color:importMsg.startsWith("✓")?C.ok:C.danger,marginBottom:8,fontWeight:600}}>{importMsg}</div>}
            <div style={{display:"flex",gap:8}}>
              <button onClick={handleImport} style={btnP(C.teal)}>✓ Importar</button>
              <button onClick={()=>{setShowImport(false);setImportMsg("");setImportFile(null);}} style={btnP(C.inkFaint)}>Cancelar</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// APP PRINCIPAL
// ═══════════════════════════════════════════════
const TABS=[
  {key:"panel",label:"Panel",icon:"📊"},
  {key:"compras",label:"Compras",icon:"📦"},
  {key:"financiamiento",label:"Financ.",icon:"🏦"},
  {key:"gastos",label:"Gastos",icon:"🧾"},
  {key:"vendedores",label:"Vendedores",icon:"🧑‍💼"},
  {key:"notif",label:"Alertas",icon:"🔔"},
  {key:"usuarios",label:"Usuarios",icon:"👥",adminOnly:true},
];
const ACCIONES=[
  {key:"compra",label:"Ingresar compra",icon:"📦",color:C.teal},
  {key:"entrega",label:"Confirmar entrega",icon:"🚚",color:C.transit},
  {key:"factura",label:"Emitir factura",icon:"🧾",color:C.info},
  {key:"pago_cliente",label:"Pago de factura",icon:"💰",color:C.ok},
  {key:"pago_financ",label:"Pago financiamiento",icon:"🏦",color:C.purple},
];

export default function App() {
  const [session,setSession]=useState(null); const [perfil,setPerfil]=useState(null); const [loadingApp,setLoadingApp]=useState(true);
  const [tab,setTab]=useState("panel"); const [filtroCompras,setFiltroCompras]=useState(null); const [accion,setAccion]=useState(null);
  const [toast,setToast]=useState(null);
  const [ocs,setOcs]=useState([]); const [financiadores,setFinanciadores]=useState([]); const [vendedores,setVendedores]=useState([]);
  const [categoriasGasto,setCategoriasGasto]=useState([]); const [gastos,setGastos]=useState([]); const [ivaMensual,setIvaMensual]=useState([]);
  const [pagosVendedor,setPagosVendedor]=useState([]); const [ajustesSaldo,setAjustesSaldo]=useState([]); const [perfiles,setPerfiles]=useState([]);
  const [contactos,setContactos]=useState([]);
  const [entidadesCatalogo,setEntidadesCatalogo]=useState([]);
  const [pagoFinSueltos,setPagoFinSueltos]=useState([]);
  const [bloqueos,setBloqueos]=useState([]);
  const [notificaciones,setNotificaciones]=useState([]);
  const [historialCambios,setHistorialCambios]=useState([]);

  const showToast=(msg,type="success")=>{ setToast({msg,type}); setTimeout(()=>setToast(null),3000); };

  useEffect(()=>{
    (async()=>{
      const saved=storageGet(SESSION_KEY);
      if(saved){ try {
        let s=JSON.parse(saved);
        try{ s=await supaRefresh(s.refresh_token); storageSet(SESSION_KEY,JSON.stringify(s)); } catch{}
        setSession(s); const p=await getPerfil(s.access_token,s.user.id); setPerfil(p);
      } catch{} }
      setLoadingApp(false);
    })();
  },[]);

  const handleLogin=async(s)=>{
    setSession(s); storageSet(SESSION_KEY,JSON.stringify(s));
    let p=await getPerfil(s.access_token,s.user.id);
    if(!p){ const all=await selPerfiles(s.access_token); const esPrimero=all.length===0;
      p=await ins("perfiles",s.access_token,{id:s.user.id,nombre:s.user.user_metadata?.nombre||s.user.email,rol:esPrimero?"admin":"usuario"});
      p=Array.isArray(p)?p[0]:p; }
    setPerfil(p);
  };
  const handleLogout=async()=>{ await supaSignOut(session.access_token); setSession(null); setPerfil(null); storageSet(SESSION_KEY,""); };

  const cargarTodo=async()=>{
    if(!session) return;
    const t=session.access_token;
    try {
      const [ocsD,finD,vendD,catD,gastD,ivaD,pagVD,ajuD,perfD,contD,entD,pagoFinSueltosD,notifD,histD]=await Promise.all([
        selOCs(t), sel("financiadores",t,"&order=nombre"), sel("vendedores",t,"&order=nombre"),
        sel("categorias_gasto",t,"&order=nombre"), sel("gastos_indirectos",t,"&order=fecha.desc"),
        sel("iva_mensual",t), sel("pagos_vendedor",t), sel("ajustes_saldo_financiador",t,"&order=creadoEn.desc"),
        selPerfiles(t), sel("contactos_cobranza",t).catch(()=>[]), sel("entidades_catalogo",t).catch(()=>[]),
        sel("eventos_pago_financiamiento",t,"&oc_id=is.null").catch(()=>[]),
        sel("notificaciones",t,`&usuario_id=eq.${session.user.id}&order=creadoEn.desc&limit=50`).catch(()=>[]),
        sel("historial_cambios",t,"&order=creadoEn.desc&limit=200").catch(()=>[]),
      ]);
      setOcs(ocsD); setFinanciadores(finD); setVendedores(vendD); setCategoriasGasto(catD);
      setGastos(gastD); setIvaMensual(ivaD); setPagosVendedor(pagVD); setAjustesSaldo(ajuD); setPerfiles(perfD);
      setContactos(contD); setEntidadesCatalogo(entD); setPagoFinSueltos(pagoFinSueltosD);
      setNotificaciones(notifD); setHistorialCambios(histD);
    } catch(e){ showToast(e.message,"error"); }
  };
  useEffect(()=>{ if(session) cargarTodo(); },[session]);

  // Polling de bloqueos cada 10 segundos
  useEffect(()=>{
    if(!session) return;
    const tick=async()=>{
      try { const b=await getBloqueosVigentes(session.access_token); setBloqueos(b); } catch{}
    };
    tick();
    const id=setInterval(tick,10000);
    return()=>clearInterval(id);
  },[session]);

  // ─── HANDLERS ─────────────────────────────────
  const handleIngresarCompra=async(data)=>{
    const t=session.access_token; let ocId=data.ocId;
    if(data.esNueva){
      const nOc=await ins("ordenes_compra_v2",t,{id:genId("ocv2"),numero_oc:data.numNueva,cliente:data.cliente,rut_cliente:data.rutCliente||"",correo_cliente:data.correo||"",entidad:data.entidad||"",comuna:data.comuna||"",contacto:data.contacto||"",vendedor_id:data.vendedorId,financiador_id:data.financiadorId,monto_total:data.montoVenta,costo_total:data.costoCompra,estado_compra:"comprado",creado_por:session.user.id});
      ocId=(Array.isArray(nOc)?nOc[0]:nOc).id;
      // Guardar productos como links
      if(data.productos?.length){
        for(let i=0;i<data.productos.length;i++){
          const p=data.productos[i];
          const desc=`${p.descripcion} × ${p.cantidad} | Compra: $${(p.precioCompra*p.cantidad).toLocaleString("es-CL")} | Venta: $${(p.precioVenta*p.cantidad).toLocaleString("es-CL")}`;
          await ins("oc_productos_link",t,{id:genId("lnk"),oc_id:ocId,descripcion:desc,url:p.url||"sin-link",orden:i,creado_por:session.user.id});
        }
      }
      if(data.rutCliente?.trim()){
        try{
          const existente=entidadesCatalogo.find(e=>e.rut===data.rutCliente.trim());
          const datosEnt={rut:data.rutCliente.trim(),nombre_entidad:data.entidad||data.cliente||"",comuna:data.comuna||"",contacto:data.contacto||"",correo:data.correo||""};
          if(existente) await upd("entidades_catalogo",t,existente.id,datosEnt);
          else await ins("entidades_catalogo",t,{id:genId("ent"),...datosEnt,creado_por:session.user.id});
        }catch{}
      }
    } else {
      await upd("ordenes_compra_v2",t,ocId,{estado_compra:"comprado",monto_total:data.montoVenta,costo_total:data.costoCompra,financiador_id:data.financiadorId});
    }
    await ins("eventos_compra",t,{id:genId("evc"),oc_id:ocId,fecha:data.fecha,monto_venta:data.montoVenta,costo_compra:data.costoCompra,fecha_entrega_estimada:data.fechaEst,financiador_id:data.financiadorId,proveedor:data.proveedor,creado_por:session.user.id});
    const fin=financiadores.find(f=>f.id===data.financiadorId);
    if(fin) await upd("financiadores",t,fin.id,{saldo_deuda:Number(fin.saldo_deuda)+data.costoCompra});
    showToast("OC creada correctamente"); setAccion(null); await cargarTodo();
  };
  const handleEntrega=async(data)=>{
    const t=session.access_token;
    await ins("eventos_entrega",t,{id:genId("eve"),oc_id:data.ocId,fecha:data.fecha,persona_recibe:data.personaRecibe,creado_por:session.user.id});
    await upd("ordenes_compra_v2",t,data.ocId,{estado_entrega:"confirmada"});
    showToast("Entrega confirmada"); setAccion(null); await cargarTodo();
  };
  const handleFactura=async(data)=>{
    const t=session.access_token;
    await ins("eventos_factura",t,{id:genId("evf"),oc_id:data.ocId,fecha:data.fecha,numero_factura:data.numeroFactura,monto:data.monto,nota_credito:data.notaCredito||null,factura_anulada_numero:data.facturaAnuladaNumero||null,creado_por:session.user.id});
    await upd("ordenes_compra_v2",t,data.ocId,{estado_factura_propia:"emitida",monto_facturado:data.monto});
    showToast(data.esReemision?`Factura reemitida (anula N°${data.facturaAnuladaNumero} con NC ${data.notaCredito})`:"Factura registrada"); setAccion(null); await cargarTodo();
  };
  const handlePagoCliente=async(data)=>{
    const t=session.access_token; const oc=ocs.find(o=>o.id===data.ocId);
    await ins("eventos_pago_cliente",t,{id:genId("evp"),oc_id:data.ocId,fecha:data.fecha,monto:data.monto,creado_por:session.user.id});
    const nuevoCobrado=(oc?.monto_cobrado||0)+data.monto;
    await upd("ordenes_compra_v2",t,data.ocId,{monto_cobrado:nuevoCobrado,estado_pago_cliente:nuevoCobrado>=(oc?.monto_facturado||0)?"pagado":"parcial"});
    showToast("Pago registrado"); setAccion(null); await cargarTodo();
  };
  const handlePagoFin=async(data)=>{
    const t=session.access_token;
    await ins("eventos_pago_financiamiento",t,{id:genId("evpf"),financiador_id:data.financiadorId,oc_id:data.ocId,fecha:data.fecha,monto:data.monto,creado_por:session.user.id});
    const fin=financiadores.find(f=>f.id===data.financiadorId);
    if(fin) await upd("financiadores",t,fin.id,{saldo_deuda:Math.max(0,Number(fin.saldo_deuda)-data.monto)});
    if(data.ocId) await upd("ordenes_compra_v2",t,data.ocId,{estado_pago_financiamiento:"pagado"});
    showToast("Pago a financiador registrado"); setAccion(null); await cargarTodo();
  };
  const handleAjusteSaldo=async({financiadorId,fecha,montoAjuste,motivo})=>{
    const t=session.access_token;
    await ins("ajustes_saldo_financiador",t,{id:genId("ajf"),financiador_id:financiadorId,fecha,monto_ajuste:montoAjuste,motivo,creado_por:session.user.id});
    const fin=financiadores.find(f=>f.id===financiadorId);
    if(fin) await upd("financiadores",t,fin.id,{saldo_deuda:Number(fin.saldo_deuda)+montoAjuste});
    showToast("Saldo ajustado"); await cargarTodo();
  };
  const handleNuevoGasto=async(data)=>{
    await ins("gastos_indirectos",session.access_token,{id:genId("gas"),categoria_id:data.categoriaId,subcategoria:data.subcategoria,monto:data.monto,mes:data.mes,anio:data.anio,fecha:data.fecha,detalle:data.detalle,creado_por:session.user.id});
    showToast("Gasto registrado"); await cargarTodo();
  };
  const handlePagoVendedorSimple=async(data)=>{
    await ins("pagos_vendedor",session.access_token,{id:genId("pv"),vendedor_id:data.vendedorId,anio:data.anio,mes:data.mes,monto_calculado:data.monto,monto_pagado:data.monto,fecha:data.fecha,estado:"pagado",notas:data.label,creado_por:session.user.id});
    if (data.ocIdsAMarcar && data.ocIdsAMarcar.length) {
      for (const ocId of data.ocIdsAMarcar) {
        await upd("ordenes_compra_v2", session.access_token, ocId, { vendedor_pagado: true });
      }
    }
    showToast(`Pago a vendedor registrado${data.ocIdsAMarcar?.length?` · ${data.ocIdsAMarcar.length} OCs marcadas como pagadas`:""}`); await cargarTodo();
  };
  const handleGuardarIva=async(data)=>{
    const t=session.access_token; const existe=ivaMensual.find(i=>i.mes===data.mes&&i.anio===data.anio);
    const row={anio:data.anio,mes:data.mes,ventas_netas:data.ventasNetas,iva_ventas:data.ivaVentas,compras_netas:data.comprasNetas,iva_compras:data.ivaCompras,iva_pagado:data.ivaPagado};
    if(existe) await upd("iva_mensual",t,existe.id,row); else await ins("iva_mensual",t,{id:genId("iva"),...row});
    showToast("IVA guardado"); await cargarTodo();
  };
  const handleChangeRol=async(uid,rol)=>{ await updRol(session.access_token,uid,rol); showToast("Rol actualizado"); await cargarTodo(); };
  const handleGuardarLink=async(ocId,{descripcion,url,orden})=>{
    await ins("oc_productos_link",session.access_token,{id:genId("lnk"),oc_id:ocId,descripcion,url,orden,creado_por:session.user.id});
    await cargarTodo();
  };
  const handleEliminarLink=async(linkId)=>{
    await fetch(`${SUPABASE_URL}/rest/v1/oc_productos_link?id=eq.${linkId}`,{method:"DELETE",headers:hdrs(session.access_token)});
    await cargarTodo();
  };
  const handleEditarLink=async(linkId,{descripcion,url})=>{
    await upd("oc_productos_link",session.access_token,linkId,{descripcion,url});
    await cargarTodo();
  };

  // ─── HANDLERS MULTIUSUARIO ────────────────────
  const handleEliminarOC=async(ocId)=>{
    const t=session.access_token;
    // Eliminar registros relacionados primero
    await fetch(`${SUPABASE_URL}/rest/v1/oc_productos_link?oc_id=eq.${ocId}`,{method:"DELETE",headers:hdrs(t)});
    await fetch(`${SUPABASE_URL}/rest/v1/oc_comentarios?oc_id=eq.${ocId}`,{method:"DELETE",headers:hdrs(t)});
    await fetch(`${SUPABASE_URL}/rest/v1/historial_cambios?oc_id=eq.${ocId}`,{method:"DELETE",headers:hdrs(t)});
    await fetch(`${SUPABASE_URL}/rest/v1/ordenes_compra_v2?id=eq.${ocId}`,{method:"DELETE",headers:hdrs(t)});
    showToast("OC eliminada");
    await cargarTodo();
  };
  const handleBloquear=async(ocId)=>{
    if(!perfil) return;
    await bloquearOC(session.access_token,ocId,perfil.id,perfil.nombre);
  };
  const handleLiberar=async(ocId)=>{
    await liberarOC(session.access_token,ocId);
  };
  const handleAgregarComentario=async(ocId,texto)=>{
    const t=session.access_token;
    const oc=ocs.find(o=>o.id===ocId);
    await ins("oc_comentarios",t,{id:genId("cmt"),oc_id:ocId,usuario_id:perfil.id,usuario_nombre:perfil.nombre,texto});
    // Registrar en historial
    await registrarCambio(t,{ocId,ocNumero:oc?.numero_oc,usuarioId:perfil.id,usuarioNombre:perfil.nombre,accion:"Comentario agregado"});
    await cargarTodo();
  };
  const handleEliminarComentario=async(comentarioId)=>{
    await del("oc_comentarios",session.access_token,comentarioId);
    await cargarTodo();
  };
  const handleMarcarNotificacionesLeidas=async()=>{
    const t=session.access_token;
    const noLeidas=notificaciones.filter(n=>!n.leida);
    await Promise.all(noLeidas.map(n=>upd("notificaciones",t,n.id,{leida:true})));
    setNotificaciones(prev=>prev.map(n=>({...n,leida:true})));
  };

  const handleImportarEntidades=async(filas)=>{
    const t=session.access_token;
    for(const fila of filas){
      if(!fila.rut?.trim()) continue;
      const existente=entidadesCatalogo.find(e=>e.rut===fila.rut.trim());
      if(existente) await upd("entidades_catalogo",t,existente.id,fila);
      else await ins("entidades_catalogo",t,{id:genId("ent"),...fila,creado_por:session.user.id});
    }
    showToast(`${filas.length} entidades importadas al catálogo`);
    await cargarTodo();
  };
  const handleGuardarDatosOC=async(ocId,{cliente,entidad,comuna,contacto,rutCliente,correo})=>{
    await upd("ordenes_compra_v2",session.access_token,ocId,{cliente,entidad,comuna,contacto,rut_cliente:rutCliente,correo_cliente:correo,ultimo_editor:session.user.id,ultima_edicion:new Date().toISOString()});
    // Si hay RUT, también actualizamos/creamos el catálogo de entidades para reutilizar después
    if (rutCliente?.trim()) {
      try {
        const existente = entidadesCatalogo.find(e=>e.rut===rutCliente.trim());
        const datos = { rut: rutCliente.trim(), nombre_entidad: entidad||cliente||"", comuna: comuna||"", contacto: contacto||"", correo: correo||"" };
        if (existente) await upd("entidades_catalogo", session.access_token, existente.id, datos);
        else await ins("entidades_catalogo", session.access_token, { id: genId("ent"), ...datos, creado_por: session.user.id });
      } catch {}
    }
    showToast("Datos actualizados"); await cargarTodo();
  };
  const handleEditarEvento=async(oc, tabla, eventoOriginal, cambios)=>{
    const t=session.access_token;
    // 1. Actualizar el evento mismo
    await upd(tabla, t, eventoOriginal.id, cambios);

    // 2. Recalcular según el tipo de evento (ajustar por la DIFERENCIA entre valor viejo y nuevo)
    if (tabla==="eventos_compra") {
      const difVenta = (cambios.monto_venta??eventoOriginal.monto_venta) - (eventoOriginal.monto_venta||0);
      const difCosto = (cambios.costo_compra??eventoOriginal.costo_compra) - (eventoOriginal.costo_compra||0);
      if (difVenta || difCosto) {
        await upd("ordenes_compra_v2", t, oc.id, {
          monto_total: Number(oc.monto_total||0) + difVenta,
          costo_total: Number(oc.costo_total||0) + difCosto,
        });
      }
      if (difCosto && oc.financiador_id) {
        const fin = financiadores.find(f=>f.id===oc.financiador_id);
        if (fin) await upd("financiadores", t, fin.id, { saldo_deuda: Math.max(0, Number(fin.saldo_deuda||0) + difCosto) });
      }
    }
    if (tabla==="eventos_factura") {
      const difMonto = (cambios.monto??eventoOriginal.monto) - (eventoOriginal.monto||0);
      if (difMonto) await upd("ordenes_compra_v2", t, oc.id, { monto_facturado: Math.max(0, Number(oc.monto_facturado||0) + difMonto) });
    }
    if (tabla==="eventos_pago_cliente") {
      const difMonto = (cambios.monto??eventoOriginal.monto) - (eventoOriginal.monto||0);
      if (difMonto) {
        const nuevoCobrado = Math.max(0, Number(oc.monto_cobrado||0) + difMonto);
        await upd("ordenes_compra_v2", t, oc.id, { monto_cobrado: nuevoCobrado, estado_pago_cliente: nuevoCobrado>=(oc.monto_facturado||0) ? "pagado" : (nuevoCobrado>0 ? "parcial" : "pendiente") });
      }
    }
    if (tabla==="eventos_pago_financiamiento") {
      const difMonto = (cambios.monto??eventoOriginal.monto) - (eventoOriginal.monto||0);
      const finId = eventoOriginal.financiador_id;
      if (difMonto && finId) {
        const fin = financiadores.find(f=>f.id===finId);
        // Un pago mayor reduce más la deuda; un pago menor la reduce menos -> restamos la diferencia
        if (fin) await upd("financiadores", t, fin.id, { saldo_deuda: Math.max(0, Number(fin.saldo_deuda||0) - difMonto) });
      }
    }
    showToast("Evento corregido y totales actualizados"); await cargarTodo();
  };
  const handleGuardarContacto=async({rut,nombreCliente,correo})=>{
    try { await ins("contactos_cobranza",session.access_token,{id:genId("cob"),rut,nombre_cliente:nombreCliente,correo,creado_por:session.user.id}); await cargarTodo(); }
    catch(e){ /* si ya existe el RUT (unique), no es un error fatal */ }
  };
  const handleEnviarReclamo=async({correo,asunto,cuerpo,ocId,rut})=>{
    const url=`mailto:${encodeURIComponent(correo)}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`;
    const ahora=new Date().toISOString();
    const t=session.access_token;
    const oc=ocs.find(o=>o.id===ocId);
    try {
      await upd("ordenes_compra_v2",t,ocId,{
        correo_cliente:correo, rut_cliente:rut||undefined,
        ultimo_reclamo_fecha:ahora, ultimo_reclamo_por:session.user.id,
      });
      // Guardar en historial de reclamos
      await ins("oc_reclamos",t,{
        id:genId("rec"),oc_id:ocId,oc_numero:oc?.numero_oc,
        correo,fecha:ahora,
        usuario_id:session.user.id,usuario_nombre:perfil?.nombre||"",
      });
    } catch {}
    window.location.href=url;
    showToast(`Correo abierto para ${correo}`);
    await cargarTodo();
  };

  // ─── RENDER ───────────────────────────────────
  if(loadingApp) return <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",color:C.inkMuted,fontFamily:SANS}}>Cargando…</div>;
  if(!session) return <LoginScreen onLogin={handleLogin} />;
  const visTabs=TABS.filter(t=>!t.adminOnly||perfil?.rol==="admin");

  return (
    <div style={{minHeight:"100vh",background:C.paper,fontFamily:SANS,paddingBottom:72}}>
      {/* HEADER */}
      <div style={{background:C.night,padding:"14px 16px 12px",color:"#fff"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div><div style={{fontWeight:800,fontSize:16,letterSpacing:-0.3}}>BFK Ltda</div><div style={{fontSize:11,color:"#94A3B8"}}>{perfil?.nombre} · {perfil?.rol==="admin"?"Admin":"Usuario"}</div></div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <button onClick={()=>setAccion("compra")} style={{background:C.teal,border:"none",color:"#fff",borderRadius:9,padding:"9px 14px",fontSize:12.5,fontWeight:700,cursor:"pointer"}}>📦 Nueva OC</button>
            <button onClick={handleLogout} style={{background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.15)",color:"#fff",borderRadius:8,padding:"7px 12px",fontSize:12,fontWeight:600,cursor:"pointer"}}>Salir</button>
          </div>
        </div>
      </div>

      {/* CONTENIDO */}
      <div style={{padding:16}}>
        {tab==="panel"&&<PanelDashboard ocs={ocs} financiadores={financiadores} gastos={gastos} pagosVendedor={pagosVendedor} ivaMensual={ivaMensual} vendedores={vendedores} pagoFinSueltos={pagoFinSueltos} onNavigate={(t)=>{setTab(t);}} />}
        {tab==="compras"&&<PanelCompras ocs={ocs} perfiles={perfiles} filtroInicial={filtroCompras} contactos={contactos} onEnviarReclamo={handleEnviarReclamo} onGuardarContacto={handleGuardarContacto} onGuardarDatosOC={handleGuardarDatosOC} onEditarEvento={handleEditarEvento} financiadores={financiadores} onConfirmarEntrega={handleEntrega} onEmitirFactura={handleFactura} onPagoCliente={handlePagoCliente} onPagoFinanciamiento={handlePagoFin} entidadesCatalogo={entidadesCatalogo} onGuardarLink={handleGuardarLink} onEliminarLink={handleEliminarLink} onEditarLink={handleEditarLink} bloqueos={bloqueos} perfil={perfil} historialCambios={historialCambios} onAgregarComentario={handleAgregarComentario} onEliminarComentario={handleEliminarComentario} onBloquear={handleBloquear} onLiberar={handleLiberar} onEliminarOC={handleEliminarOC} />}
        {tab==="notif"&&<PanelNotificaciones notificaciones={notificaciones} onMarcarLeidas={handleMarcarNotificacionesLeidas} />}
        {tab==="financiamiento"&&<PanelFinanciamiento financiadores={financiadores} ocs={ocs} ajustes={ajustesSaldo} perfiles={perfiles} onAjustar={handleAjusteSaldo} />}
        {tab==="gastos"&&<PanelGastos gastos={gastos} categorias={categoriasGasto} vendedores={vendedores} pagosVendedor={pagosVendedor} ocs={ocs} onNuevoGasto={handleNuevoGasto} onPagoVendedor={handlePagoVendedorSimple} />}
        {tab==="vendedores"&&<PanelVendedores vendedores={vendedores} ocs={ocs} ivaMensual={ivaMensual} pagosVendedor={pagosVendedor} onGuardarIva={handleGuardarIva} onPagoVendedor={handlePagoVendedorSimple} />}
        {tab==="usuarios"&&perfil?.rol==="admin"&&<PanelUsuarios perfiles={perfiles} ocs={ocs} onChangeRol={handleChangeRol} session={session} showToast={showToast} entidadesCatalogo={entidadesCatalogo} onImportarEntidades={handleImportarEntidades} />}
      </div>

      {/* NAV BOTTOM */}
      <div style={{position:"fixed",bottom:0,left:0,right:0,background:C.card,borderTop:`1px solid ${C.border}`,display:"flex",padding:"6px 4px"}}>
        {visTabs.map(t=>(
          <button key={t.key} onClick={()=>{setTab(t.key);setFiltroCompras(null);}} style={{flex:1,background:"none",border:"none",padding:"8px 2px",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
            <span style={{fontSize:17,position:"relative",display:"inline-block"}}>
              {t.icon}
              {t.key==="notif"&&<NotifBadge notificaciones={notificaciones} />}
            </span>
            <span style={{fontSize:9.5,fontWeight:700,color:tab===t.key?C.teal:C.inkFaint}}>{t.label}</span>
          </button>
        ))}
      </div>

      {/* MODAL NUEVA OC */}
      {accion==="compra"&&<Modal title="Nueva OC" onClose={()=>setAccion(null)}><FormIngresarCompra ocs={ocs} financiadores={financiadores} vendedores={vendedores} entidadesCatalogo={entidadesCatalogo} onSave={handleIngresarCompra} /></Modal>}

      <Toast toast={toast} />
    </div>
  );
}
