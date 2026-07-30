import { useState, useMemo } from "react";
import { C, MONO, fmt, iMono } from "../../lib/theme";

export function Modal({ title, onClose, children }) {
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

export function Field({ label, required, hint, children }) {
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

export function Toast({ toast }) {
  if(!toast) return null;
  return <div style={{position:"fixed",bottom:80,left:"50%",transform:"translateX(-50%)",background:toast.type==="error"?C.danger:C.ink,color:"#fff",padding:"11px 20px",borderRadius:10,fontSize:13,fontWeight:600,zIndex:200,boxShadow:"0 8px 24px rgba(0,0,0,0.25)",maxWidth:"90vw",textAlign:"center"}}>{toast.msg}</div>;
}

export function Trazabilidad({ creadoPor, creadoEn, perfiles }) {
  const u=perfiles?.find(p=>p.id===creadoPor);
  return <span style={{fontSize:10.5,color:C.inkFaint}}>{u?u.nombre:"Usuario"} · {fmt.datetime(creadoEn)}</span>;
}

export function DiasBadge({ dias, diasPago }) {
  if(dias===null||dias===undefined) return null;
  // Plazo real de la OC (15, 30, 50 o 60 días según Mercado Público). 30 por defecto.
  const plazo = Number(diasPago) > 0 ? Number(diasPago) : 30;
  const vencida  = dias >= plazo;
  const reclamar = dias >= plazo + 9;
  const porVencer= !vencida && dias >= plazo - 5;

  const color = reclamar ? C.danger : vencida ? C.danger : porVencer ? C.warn : C.ok;
  const bg    = reclamar ? C.dangerLight : vencida ? C.dangerLight : porVencer ? C.warnLight : C.okLight;
  const label = reclamar ? "⚠ Reclamar" : vencida ? "Vencida" : porVencer ? "Por vencer" : "Al día";

  return (
    <span title={`Plazo de pago: ${plazo} días`}
      style={{display:"inline-flex",alignItems:"center",gap:4,padding:"3px 8px",borderRadius:20,fontSize:11,fontWeight:700,background:bg,color}}>
      {dias}d / {plazo}d · {label}
    </span>
  );
}

// ─── Leyenda de colores y símbolos ───────────────────────────
// Plegada por defecto: explica la simbología sin estorbar.
export function Leyenda({ items, titulo="¿Qué significan los colores?" }) {
  const [abierta,setAbierta]=useState(false);
  return (
    <div style={{marginTop:14,marginBottom:6}}>
      <button onClick={()=>setAbierta(v=>!v)}
        style={{background:"none",border:"none",color:C.inkFaint,fontSize:11,cursor:"pointer",padding:"4px 0",display:"flex",alignItems:"center",gap:5}}>
        <span style={{fontSize:12}}>{abierta?"▾":"▸"}</span> {titulo}
      </button>
      {abierta&&(
        <div style={{background:C.paper,border:`1px solid ${C.border}`,borderRadius:10,padding:"10px 12px",marginTop:4}}>
          {items.map((it,i)=>(
            <div key={i} style={{display:"flex",alignItems:"flex-start",gap:8,marginBottom:i<items.length-1?7:0}}>
              <span style={{flexShrink:0,minWidth:58,textAlign:"center"}}>
                {it.color
                  ? <span style={{display:"inline-block",padding:"2px 7px",borderRadius:12,fontSize:10,fontWeight:700,background:it.bg,color:it.color}}>{it.muestra}</span>
                  : <span style={{fontSize:13}}>{it.muestra}</span>}
              </span>
              <span style={{fontSize:11.5,color:C.inkMuted,lineHeight:1.45}}>{it.texto}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function NotifBadge({ notificaciones, urgentes=0 }) {
  const noLeidas=(notificaciones||[]).filter(n=>!n.leida).length + Number(urgentes||0);
  if(!noLeidas) return null;
  return (
    <span style={{background:C.danger,color:"#fff",borderRadius:10,fontSize:9.5,fontWeight:800,padding:"1px 5px",marginLeft:4,verticalAlign:"top"}}>
      {noLeidas>9?"9+":noLeidas}
    </span>
  );
}

export function BuscadorOC({ ocs, ocId, setOcId, permitirNueva, numeroNueva, setNumeroNueva }) {
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
