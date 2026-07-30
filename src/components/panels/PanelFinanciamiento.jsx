import { useState } from "react";
import { Field, Modal, Trazabilidad } from "../ui/Basicos";
import { C, MONO, btnP, fmt, iMono, iStyle } from "../../lib/theme";

export function PanelFinanciamiento({ financiadores, ocs, ajustes, perfiles, onAjustar }) {
  const [selFin,setSelFin]=useState(null);
  const [ajustando,setAjustando]=useState(null);

  const cartola=(finId)=>{
    const compras=(ocs||[]).filter(o=>o.financiador_id===finId).flatMap(o=>(o.eventos_compra||[]).map(e=>({
      tipo:"compra", fecha:e.fecha, oc:o.numero_oc, monto:e.costo_compra||0, categoria:"Compra", creadoEn:e.creadoEn, creadoPor:e.creado_por,
    })));
    const pagos=(ocs||[]).flatMap(o=>(o.eventos_pago_financiamiento||[]).filter(e=>{
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
      {(()=>{
        const conDeuda=financiadores.filter(f=>Number(f.saldo_deuda)!==0);
        const enCero=financiadores.filter(f=>Number(f.saldo_deuda)===0);
        return (<>
      {conDeuda.map(f=>(
        <button key={f.id} onClick={()=>setSelFin(f.id)} style={{width:"100%",background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:16,marginBottom:10,textAlign:"left",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <div style={{fontWeight:800,fontSize:15,color:C.ink}}>{f.nombre}</div>
            <div style={{fontSize:11.5,color:C.inkFaint,marginTop:2}}>Toca para ver cartola →</div>
          </div>
          <div style={{fontFamily:MONO,fontWeight:800,fontSize:20,color:Number(f.saldo_deuda)>0?C.danger:C.ok}}>{fmt.money(f.saldo_deuda)}</div>
        </button>
      ))}
      {enCero.length>0&&(
        <details style={{marginTop:4}}>
          <summary style={{fontSize:11,color:C.inkFaint,cursor:"pointer",padding:"6px 0",listStyle:"none"}}>
            + {enCero.length} financiador{enCero.length>1?"es":""} sin deuda
          </summary>
          {enCero.map(f=>(
            <button key={f.id} onClick={()=>setSelFin(f.id)} style={{width:"100%",background:C.paper,border:`1px solid ${C.border}`,borderRadius:12,padding:"11px 14px",marginTop:6,textAlign:"left",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontWeight:600,fontSize:13,color:C.inkMuted}}>{f.nombre}</span>
              <span style={{fontFamily:MONO,fontWeight:700,fontSize:13,color:C.ok}}>{fmt.money(f.saldo_deuda)}</span>
            </button>
          ))}
        </details>
      )}
        </>);
      })()}
    </div>
  );
}

export function FormAjusteSaldo({ financiador, onSave }) {
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
