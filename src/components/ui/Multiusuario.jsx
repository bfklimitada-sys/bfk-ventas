import { useState } from "react";
import { del } from "../../lib/supabase";
import { C, SANS, fmt } from "../../lib/theme";

export function BloqueoBanner({ bloqueo }) {
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

export function HistorialCambiosOC({ ocId, historialCambios }) {
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

export function ComentariosOC({ oc, perfil, onAgregar, onEliminar }) {
  const [texto,setTexto]=useState(""); const [saving,setSaving]=useState(false);
  const [abierto,setAbierto]=useState(false);
  const comentarios=(oc.oc_comentarios||[]).slice().sort((a,b)=>(b.creadoEn||"").localeCompare(a.creadoEn||""));
  const handleAgregar=async()=>{
    if(!texto.trim()) return;
    setSaving(true);
    await onAgregar(oc.id,texto.trim());
    setTexto(""); setSaving(false);
  };
  return (
    <div style={{marginBottom:10,background:C.card,borderRadius:9,overflow:"hidden",border:`1px solid ${C.border}`}}>
      <div onClick={()=>setAbierto(v=>!v)} style={{padding:"9px 12px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span style={{fontSize:11,fontWeight:700,color:C.inkMuted,textTransform:"uppercase",letterSpacing:0.5}}>
          💬 Notas del equipo {comentarios.length>0&&<span style={{color:C.teal}}>({comentarios.length})</span>}
        </span>
        <span style={{color:C.inkFaint,fontSize:12}}>{abierto?"▲":"▼"}</span>
      </div>
      {abierto&&(
        <div style={{padding:"0 12px 10px"}}>
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
      )}
    </div>
  );
}

export function PanelNotificaciones({ notificaciones, onMarcarLeidas }) {
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
