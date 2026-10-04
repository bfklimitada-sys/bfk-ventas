import { useState, useMemo } from "react";
import { Field, Leyenda } from "../ui/Basicos";
import { sel } from "../../lib/supabase";
import { C, MONO, btnP, fmt, iMono } from "../../lib/theme";
import { Ic } from "../ui/Iconos";
import { facturaVigente, plazoPago } from "../../lib/calculos";

export function PanelCalendario({ ocs, onMarcarFecha }) {
  const hoy=new Date();
  const [anio,setAnio]=useState(hoy.getFullYear());
  const [mes,setMes]=useState(hoy.getMonth());
  const [diaSel,setDiaSel]=useState(null);
  const [marcando,setMarcando]=useState(false);
  const [codOC,setCodOC]=useState(""); const [err,setErr]=useState(""); const [saving,setSaving]=useState(false);

  const MESES=["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
  const DIAS=["L","M","M","J","V","S","D"];

  const iso=(y,m,d)=>`${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;

  // Vencimientos de factura y promesas de pago (solo lectura, derivados de las OC).
  const sumarDias=(fechaStr,n)=>{ const d=new Date(String(fechaStr).slice(0,10)+"T00:00:00Z"); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10); };
  const {vencenPorDia,promesasPorDia,facturasVencidas}=useMemo(()=>{
    const vp={},pp={},fv=[];
    const hoyIso=iso(hoy.getFullYear(),hoy.getMonth(),hoy.getDate());
    for(const oc of ocs){
      if((oc.tipo_registro||"venta")!=="venta"||oc.estado_pago_cliente==="pagado") continue;
      const evF=oc.estado_factura_propia==="emitida"?facturaVigente(oc):null;
      if(evF?.fecha){
        const k=sumarDias(evF.fecha,plazoPago(oc));
        (vp[k]=vp[k]||[]).push({oc,evF});
        if(k<hoyIso) fv.push({oc,evF,k});
      }
      const ultimo=(oc.oc_reclamos||[]).slice().sort((a,b)=>(b.fecha||"").localeCompare(a.fecha||""))[0];
      if(ultimo?.fecha_prometida){
        const k=String(ultimo.fecha_prometida).slice(0,10);
        (pp[k]=pp[k]||[]).push({oc,k});
      }
    }
    fv.sort((a,b)=>a.k.localeCompare(b.k));
    return {vencenPorDia:vp,promesasPorDia:pp,facturasVencidas:fv};
  },[ocs]);

  const {estimadasPorDia,realesPorDia,vencidas}=useMemo(()=>{
    const est={},rea={},ven=[];
    const hoyIso=iso(hoy.getFullYear(),hoy.getMonth(),hoy.getDate());
    for(const oc of ocs){
      const fEst=(oc.eventos_compra||[])[0]?.fecha_entrega_estimada;
      const entregada=oc.estado_entrega==="confirmada"||oc.estado_entrega==="entregado";
      const fReal=(oc.eventos_entrega||[])[0]?.fecha;
      if(fEst){
        const k=String(fEst).slice(0,10);
        if(!est[k])est[k]=[]; est[k].push(oc);
        if(!entregada&&k<hoyIso) ven.push({oc,fEst:k});
      }
      if(fReal){
        const k=String(fReal).slice(0,10);
        if(!rea[k])rea[k]=[]; rea[k].push(oc);
      }
    }
    ven.sort((a,b)=>a.fEst.localeCompare(b.fEst));
    return {estimadasPorDia:est,realesPorDia:rea,vencidas:ven};
  },[ocs]);

  const primerDia=new Date(anio,mes,1);
  const diasEnMes=new Date(anio,mes+1,0).getDate();
  let offset=primerDia.getDay()-1; if(offset<0)offset=6;
  const celdas=[];
  for(let i=0;i<offset;i++) celdas.push(null);
  for(let d=1;d<=diasEnMes;d++) celdas.push(d);

  const cambiarMes=(delta)=>{
    let m=mes+delta,a=anio;
    if(m<0){m=11;a--;} if(m>11){m=0;a++;}
    setMes(m);setAnio(a);setDiaSel(null);
  };

  const handleMarcar=async()=>{
    if(!codOC.trim()||!diaSel){setErr("Ingresa el código de la OC");return;}
    setErr("");setSaving(true);
    try{
      await onMarcarFecha(codOC.trim(),iso(anio,mes,diaSel));
      setCodOC("");setMarcando(false);
    }catch(e){setErr(e.message);}
    setSaving(false);
  };

  const kSel=diaSel?iso(anio,mes,diaSel):null;
  const hoyD=hoy.getFullYear()===anio&&hoy.getMonth()===mes?hoy.getDate():null;

  return (
    <div>
      {vencidas.length>0&&(
        <div style={{background:C.dangerLight,border:`1px solid ${C.danger}`,borderRadius:12,padding:"10px 12px",marginBottom:12}}>
          <div style={{fontWeight:800,color:C.danger,fontSize:12,marginBottom:6}}><Ic n="⚠"/> {vencidas.length} entrega{vencidas.length>1?"s":""} atrasada{vencidas.length>1?"s":""}</div>
          {vencidas.map(({oc,fEst})=>(
            <div key={oc.id} style={{fontSize:12,display:"flex",justifyContent:"space-between",marginBottom:3}}>
              <span style={{fontFamily:MONO,fontWeight:700}}>{oc.numero_oc}</span>
              <span style={{color:C.danger}}>estimada {fmt.date(fEst)}</span>
            </div>
          ))}
        </div>
      )}

      {facturasVencidas.length>0&&(
        <div style={{background:C.warnLight,border:`1px solid ${C.warn}`,borderRadius:12,padding:"10px 12px",marginBottom:12}}>
          <div style={{fontWeight:800,color:C.warn,fontSize:12,marginBottom:6}}><Ic n="⚠"/> {facturasVencidas.length} factura{facturasVencidas.length>1?"s":""} vencida{facturasVencidas.length>1?"s":""} sin cobrar</div>
          {facturasVencidas.slice(0,8).map(({oc,evF,k})=>(
            <div key={oc.id} style={{fontSize:12,display:"flex",justifyContent:"space-between",marginBottom:3}}>
              <span style={{fontFamily:MONO,fontWeight:700}}>{oc.numero_oc}</span>
              <span style={{color:C.warn}}>venció {fmt.date(k)}</span>
            </div>
          ))}
          {facturasVencidas.length>8&&<div style={{fontSize:12,color:C.inkMuted}}>y {facturasVencidas.length-8} más en Alertas</div>}
        </div>
      )}

      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
        <button onClick={()=>cambiarMes(-1)} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:"6px 12px",fontSize:14,cursor:"pointer"}}><Ic n="chevL"/></button>
        <div style={{fontWeight:800,fontSize:14}}>{MESES[mes]} {anio}</div>
        <button onClick={()=>cambiarMes(1)} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:8,padding:"6px 12px",fontSize:14,cursor:"pointer"}}><Ic n="chevR"/></button>
      </div>

      <div style={{display:"flex",gap:12,marginBottom:8,fontSize:12,color:C.inkMuted}}>
        <span><span style={{color:C.info}}>●</span> Estimada</span>
        <span><span style={{color:C.ok}}>●</span> Realizada</span>
        <span><span style={{color:C.warn}}>●</span> Vence factura</span>
        <span><span style={{color:C.purple}}>●</span> Promesa de pago</span>
      </div>

      <div style={{background:C.card,borderRadius:12,padding:"10px 8px",border:`1px solid ${C.border}`}}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2,marginBottom:4}}>
          {DIAS.map((d,i)=><div key={i} style={{textAlign:"center",fontSize:12,fontWeight:700,color:C.inkFaint}}>{d}</div>)}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2}}>
          {celdas.map((d,i)=>{
            if(!d) return <div key={i} />;
            const k=iso(anio,mes,d);
            const tieneEst=(estimadasPorDia[k]||[]).length>0;
            const tieneReal=(realesPorDia[k]||[]).length>0;
            const tieneVence=(vencenPorDia[k]||[]).length>0;
            const tienePromesa=(promesasPorDia[k]||[]).length>0;
            const esHoy=d===hoyD;
            const sel=d===diaSel;
            return (
              <button key={i} onClick={()=>setDiaSel(sel?null:d)} style={{
                aspectRatio:"1",border:sel?`2px solid ${C.teal}`:esHoy?`2px solid ${C.ink}`:`1px solid ${C.border}`,
                borderRadius:8,background:sel?C.tealLight:C.paper,cursor:"pointer",
                display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:1,padding:2,
              }}>
                <span style={{fontSize:12,fontWeight:esHoy||sel?800:500,color:C.ink}}>{d}</span>
                <div style={{display:"flex",gap:2}}>
                  {tieneEst&&<span style={{width:5,height:5,borderRadius:"50%",background:C.info}} />}
                  {tieneReal&&<span style={{width:5,height:5,borderRadius:"50%",background:C.ok}} />}
                  {tieneVence&&<span style={{width:5,height:5,borderRadius:"50%",background:C.warn}} />}
                  {tienePromesa&&<span style={{width:5,height:5,borderRadius:"50%",background:C.purple}} />}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {diaSel&&(
        <div style={{background:C.card,borderRadius:12,padding:"12px 14px",marginTop:10,border:`1px solid ${C.border}`}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <span style={{fontWeight:800,fontSize:13}}>{diaSel} de {MESES[mes]}</span>
            <button onClick={()=>{setMarcando(v=>!v);setErr("");}} style={{fontSize:12,background:C.teal,color:"#fff",border:"none",borderRadius:7,padding:"5px 10px",fontWeight:700,cursor:"pointer"}}>
              {marcando?"Cancelar":"+ Marcar entrega estimada"}
            </button>
          </div>

          {marcando&&(
            <div style={{background:C.tealLight,borderRadius:9,padding:"10px 12px",marginBottom:10}}>
              <Field label="Código de la OC">
                <input style={iMono} value={codOC} onChange={e=>setCodOC(e.target.value)} placeholder="ej: 2436-690-AG26" />
              </Field>
              {err&&<div style={{fontSize:12,color:C.danger,fontWeight:600,marginBottom:8}}>{err}</div>}
              <button onClick={handleMarcar} disabled={saving} style={btnP(saving?C.inkFaint:C.teal)}>
                {saving?"Guardando…":`✓ Marcar entrega estimada para el ${diaSel}/${mes+1}`}
              </button>
            </div>
          )}

          {(estimadasPorDia[kSel]||[]).length>0&&(
            <div style={{marginBottom:8}}>
              <div style={{fontSize:12,fontWeight:700,color:C.info,textTransform:"uppercase",marginBottom:4}}>● Entregas estimadas</div>
              {(estimadasPorDia[kSel]||[]).map(oc=>{
                const entregada=oc.estado_entrega==="confirmada"||oc.estado_entrega==="entregado";
                return (
                  <div key={oc.id} style={{fontSize:12,display:"flex",justifyContent:"space-between",marginBottom:3}}>
                    <span style={{fontFamily:MONO,fontWeight:700}}>{oc.numero_oc}</span>
                    <span style={{color:entregada?C.ok:C.warn,fontSize:12,fontWeight:600}}>{entregada?"✓ Entregada":"Pendiente"}</span>
                  </div>
                );
              })}
            </div>
          )}
          {(realesPorDia[kSel]||[]).length>0&&(
            <div>
              <div style={{fontSize:12,fontWeight:700,color:C.ok,textTransform:"uppercase",marginBottom:4}}>● Entregas realizadas</div>
              {(realesPorDia[kSel]||[]).map(oc=>(
                <div key={oc.id} style={{fontSize:12,display:"flex",justifyContent:"space-between",marginBottom:3}}>
                  <span style={{fontFamily:MONO,fontWeight:700}}>{oc.numero_oc}</span>
                  <span style={{color:C.ok,fontSize:12}}>✓</span>
                </div>
              ))}
            </div>
          )}
          {(vencenPorDia[kSel]||[]).length>0&&(
            <div style={{marginTop:8}}>
              <div style={{fontSize:12,fontWeight:700,color:C.warn,textTransform:"uppercase",marginBottom:4}}>● Vencen facturas</div>
              {(vencenPorDia[kSel]||[]).map(({oc,evF})=>(
                <div key={oc.id} style={{fontSize:12,display:"flex",justifyContent:"space-between",marginBottom:3}}>
                  <span style={{fontFamily:MONO,fontWeight:700}}>{oc.numero_oc}</span>
                  <span style={{color:C.inkMuted}}>Factura {evF.numero_factura||"—"} · {fmt.money((oc.monto_facturado||0)-(oc.monto_cobrado||0))}</span>
                </div>
              ))}
            </div>
          )}
          {(promesasPorDia[kSel]||[]).length>0&&(
            <div style={{marginTop:8}}>
              <div style={{fontSize:12,fontWeight:700,color:C.purple,textTransform:"uppercase",marginBottom:4}}>● Promesas de pago</div>
              {(promesasPorDia[kSel]||[]).map(({oc})=>(
                <div key={oc.id} style={{fontSize:12,display:"flex",justifyContent:"space-between",marginBottom:3}}>
                  <span style={{fontFamily:MONO,fontWeight:700}}>{oc.numero_oc}</span>
                  <span style={{color:C.inkMuted}}>{oc.cliente||""}</span>
                </div>
              ))}
            </div>
          )}
          {!(estimadasPorDia[kSel]||[]).length&&!(realesPorDia[kSel]||[]).length&&!(vencenPorDia[kSel]||[]).length&&!(promesasPorDia[kSel]||[]).length&&(
            <div style={{fontSize:12,color:C.inkFaint}}>Sin eventos este día</div>
          )}
        </div>
      )}
      <Leyenda titulo="¿Qué significan los puntos?" items={[
        {muestra:"●", color:C.info, bg:C.infoLight, texto:"Azul: entrega estimada, la fecha que se puso al registrar la compra."},
        {muestra:"●", color:C.ok, bg:C.okLight, texto:"Verde: entrega realizada, la fecha real en que se confirmó."},
        {muestra:"●", color:C.warn, bg:C.warnLight, texto:"Amarillo: vence una factura (fecha de factura + plazo de pago de la OC)."},
        {muestra:"●", color:C.purple, bg:C.purpleLight, texto:"Morado: fecha en que el cliente prometió pagar."},
        {muestra:"▢", texto:"Recuadro negro: hoy. Recuadro verde: el día que tienes seleccionado."},
      ]} />
    </div>
  );
}
