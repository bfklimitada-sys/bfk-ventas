import { useState, useMemo } from "react";
import { Field } from "../ui/Basicos";
import { sel } from "../../lib/supabase";
import { C, MONO, btnP, btnMini, fmt, iMono } from "../../lib/theme";
import { Ic } from "../ui/Iconos";
import { facturaVigente, plazoPago } from "../../lib/calculos";
import { entregaAtrasada, esVenta, estadoOperativo, estaEntregada, facturaPorCobrar, facturaVencida } from "../../lib/ocs";

// Resumen compacto de atrasos: una sola tarjeta con acceso a Alertas. No lista OC individuales.
function ResumenAtraso({ titulo, monto, color, fondo, onVerAlertas }) {
  // Aviso compacto de una línea (el detalle está en Alertas)
  return (
    <div data-resumen-atraso style={{background:fondo,border:`1px solid ${color}33`,borderRadius:8,marginBottom:8,display:"flex",alignItems:"center",gap:8,padding:"4px 4px 4px 12px",minHeight:40}}>
      <span style={{flex:1,minWidth:0,display:"flex",alignItems:"center",gap:6,color,fontWeight:600,fontSize:13,lineHeight:1.3}}>
        <Ic n="⚠"/>
        <span>{titulo}{monto>0&&<span style={{fontFamily:MONO,fontWeight:700}}> · {fmt.money(monto)}</span>}</span>
      </span>
      {onVerAlertas&&<button onClick={onVerAlertas} style={{background:"none",border:"none",cursor:"pointer",color,fontWeight:700,fontSize:12,minHeight:36,padding:"0 8px",whiteSpace:"nowrap",textDecoration:"underline"}}>Ver alertas</button>}
    </div>
  );
}

// eventosExtra (06/11/2026): eventos de Ventas privadas con fecha (entregas comprometidas, vencimiento de cotizaciones y de
// pagos), punto turquesa; onAbrirExtra(destino) abre la cotización o la venta. El filtro de canal lo aplica quien llama.
export function PanelCalendario({ ocs, onMarcarFecha, onVerAlertas, eventosExtra = [], onAbrirExtra }) {
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
      const evF=facturaPorCobrar(oc)?facturaVigente(oc):null;
      if(evF?.fecha){
        const k=sumarDias(evF.fecha,plazoPago(oc));
        (vp[k]=vp[k]||[]).push({oc,evF});
        // Fase 4C: "vencida" con el mismo criterio que Panel, Alertas y la lista (lib/ocs.js, facturaVencida).
        if(facturaVencida(oc)) fv.push({oc,evF,k});
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
      if(!esVenta(oc)) continue;   // Fase 4C: aportes y ventas externas no tienen entregas (igual que Alertas)
      const fEst=(oc.eventos_compra||[])[0]?.fecha_entrega_estimada;
      const fReal=(oc.eventos_entrega||[])[0]?.fecha;
      if(fEst){
        const k=String(fEst).slice(0,10);
        if(!est[k])est[k]=[]; est[k].push(oc);
        // Mismo criterio que Alertas ("Entrega atrasada"): venta, estimada ya pasada y sin entregar.
        if(entregaAtrasada(oc)) ven.push({oc,fEst:k});
      }
      if(fReal){
        const k=String(fReal).slice(0,10);
        if(!rea[k])rea[k]=[]; rea[k].push(oc);
      }
    }
    ven.sort((a,b)=>a.fEst.localeCompare(b.fEst));
    return {estimadasPorDia:est,realesPorDia:rea,vencidas:ven};
  },[ocs]);

  // Mismo criterio que el Panel y Alertas (lib/ocs.js): factura vigente vencida y sin cobrar.
  const resumenFacturas=useMemo(()=>{
    let n=0,monto=0;
    for(const oc of ocs){
      if(!facturaVencida(oc)) continue;
      n++; monto+=(oc.monto_facturado||0)-(oc.monto_cobrado||0);
    }
    return {n,monto};
  },[ocs]);

  const extraPorDia=useMemo(()=>{ const m={}; for(const e of eventosExtra||[]) (m[e.fecha]=m[e.fecha]||[]).push(e); return m; },[eventosExtra]);
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
        <ResumenAtraso color={C.dangerText} fondo={C.dangerLight} onVerAlertas={onVerAlertas&&(()=>onVerAlertas({nivel:"alto",etapa:"entrega"}))}
          titulo={`${vencidas.length} entrega${vencidas.length>1?"s":""} atrasada${vencidas.length>1?"s":""}`} />
      )}

      {resumenFacturas.n>0&&(
        <ResumenAtraso color={C.warnText} fondo={C.warnLight} onVerAlertas={onVerAlertas&&(()=>onVerAlertas({nivel:"alto",etapa:"cobro"}))}
          titulo={`${resumenFacturas.n} factura${resumenFacturas.n>1?"s":""} vencida${resumenFacturas.n>1?"s":""} sin cobrar`}
          monto={resumenFacturas.monto} />
      )}

      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
        <button aria-label="Mes anterior" onClick={()=>cambiarMes(-1)} style={{background:C.card,border:`1px solid ${C.borderFuerte}`,borderRadius:8,padding:"6px 12px",fontSize:14,cursor:"pointer",color:C.ink}}><Ic n="chevL"/></button>
        <div style={{fontWeight:700,fontSize:16,color:C.ink}}>{MESES[mes]} {anio}</div>
        <button aria-label="Mes siguiente" onClick={()=>cambiarMes(1)} style={{background:C.card,border:`1px solid ${C.borderFuerte}`,borderRadius:8,padding:"6px 12px",fontSize:14,cursor:"pointer",color:C.ink}}><Ic n="chevR"/></button>
      </div>

      <div style={{background:C.card,borderRadius:12,padding:"10px 8px",border:`1px solid ${C.border}`}}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2,marginBottom:4}}>
          {DIAS.map((d,i)=><div key={i} style={{textAlign:"center",fontSize:12,fontWeight:600,color:C.inkFaint}}>{d}</div>)}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2}}>
          {celdas.map((d,i)=>{
            if(!d) return <div key={i} />;
            const k=iso(anio,mes,d);
            // Un punto por tipo de evento; si hay más de uno del mismo tipo, su cantidad (en el celular va en el detalle del día).
            const tipos=[
              {n:(estimadasPorDia[k]||[]).length,color:C.info,uno:"entrega estimada",varios:"entregas estimadas"},
              {n:(realesPorDia[k]||[]).length,color:C.ok,uno:"entrega realizada",varios:"entregas realizadas"},
              {n:(vencenPorDia[k]||[]).length,color:C.warn,uno:"factura vence",varios:"facturas vencen"},
              {n:(promesasPorDia[k]||[]).length,color:C.purple,uno:"promesa de pago",varios:"promesas de pago"},
              {n:(extraPorDia[k]||[]).length,color:C.teal,uno:"evento de ventas privadas",varios:"eventos de ventas privadas",vp:true},
            ].filter(t=>t.n>0);
            const total=tipos.reduce((a,t)=>a+t.n,0);
            const esHoy=d===hoyD;
            const sel=d===diaSel;
            const descripcion=`${d} de ${MESES[mes]}${esHoy?" (hoy)":""}: ${total?tipos.map(t=>`${t.n} ${t.n>1?t.varios:t.uno}`).join(", "):"sin eventos"}`;
            return (
              <button key={i} data-compact className="bfk-dia" data-dia={d} data-eventos={total} aria-label={descripcion} title={total?descripcion:undefined} aria-pressed={sel} aria-current={esHoy?"date":undefined} onClick={()=>setDiaSel(sel?null:d)} style={{
                border:sel?`1px solid ${C.teal}`:esHoy?`1px solid ${C.ink}`:"1px solid transparent",
                borderRadius:8,background:sel?C.tealLight:"transparent",cursor:"pointer",
                display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:3,padding:2,minWidth:0,
              }}>
                <span style={{fontSize:13,fontWeight:esHoy||sel?700:500,color:sel?C.tealDark:C.ink}}>{d}</span>
                <span style={{display:"flex",gap:3,alignItems:"center",justifyContent:"center",minHeight:6,flexWrap:"wrap"}}>
                  {tipos.map((t,j)=>(
                    <span key={j} style={{display:"inline-flex",alignItems:"center",gap:2}}>
                      <span {...(t.vp?{"data-punto-vp":true}:{})} style={{width:6,height:6,borderRadius:"50%",background:t.color,flexShrink:0}} />
                      {t.n>1&&<span className="bfk-dia-n" style={{fontSize:11,fontFamily:MONO,color:C.inkMuted,lineHeight:1}}>{t.n}</span>}
                    </span>
                  ))}
                </span>
              </button>
            );
          })}
        </div>
        {/* Única explicación de los puntos: siempre a la vista, en computador y en celular (antes una fila abreviada arriba y un desplegable abajo). */}
        <div data-leyenda-agenda style={{display:"flex",flexWrap:"wrap",gap:"4px 16px",marginTop:10,padding:"10px 6px 2px",borderTop:`1px solid ${C.border}`,fontSize:12,color:C.inkMuted,lineHeight:1.4}}>
          {[
            {c:C.info,t:"Entrega estimada",d:"fecha puesta al registrar la compra"},
            {c:C.ok,t:"Entrega realizada",d:"fecha real confirmada"},
            {c:C.warn,t:"Vence factura",d:"fecha de factura + plazo de pago"},
            {c:C.purple,t:"Promesa de pago",d:"fecha que prometió el cliente"},
            ...((eventosExtra||[]).length>0?[{c:C.teal,t:"Venta privada",d:"entrega, vencimiento de cotización o pago"}]:[]),
          ].map(x=>(
            <span key={x.t} style={{display:"inline-flex",alignItems:"baseline",gap:5}}>
              <span aria-hidden="true" style={{width:7,height:7,borderRadius:"50%",background:x.c,flexShrink:0,alignSelf:"center"}} />
              <span><span style={{color:C.ink}}>{x.t}</span> <span style={{color:C.inkFaint}}>· {x.d}</span></span>
            </span>
          ))}
          <span style={{display:"inline-flex",alignItems:"center",gap:5}}><span aria-hidden="true" style={{width:11,height:11,borderRadius:3,border:`1px solid ${C.ink}`,boxSizing:"border-box"}} /><span style={{color:C.ink}}>Hoy</span></span>
          <span style={{display:"inline-flex",alignItems:"center",gap:5}}><span aria-hidden="true" style={{width:11,height:11,borderRadius:3,border:`1px solid ${C.teal}`,background:C.tealLight,boxSizing:"border-box"}} /><span style={{color:C.ink}}>Día seleccionado</span></span>
        </div>
      </div>

      {diaSel&&(
        <div style={{background:C.card,borderRadius:12,padding:"12px 14px",marginTop:10,border:`1px solid ${C.border}`}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <span style={{fontWeight:700,fontSize:14,color:C.ink}}>{diaSel} de {MESES[mes]}</span>
            <button data-compact onClick={()=>{setMarcando(v=>!v);setErr("");}} style={btnMini(marcando?"sec":"marca")}>
              {marcando?"Cancelar":"+ Marcar entrega estimada"}
            </button>
          </div>

          {marcando&&(
            <div style={{background:C.tealLight,borderRadius:8,padding:"10px 12px",marginBottom:10}}>
              <Field label="Código de la OC">
                <input style={iMono} value={codOC} onChange={e=>setCodOC(e.target.value)} placeholder="ej: 2436-690-AG26" />
              </Field>
              {err&&<div style={{fontSize:12,color:C.dangerText,fontWeight:500,marginBottom:8}}>{err}</div>}
              <button onClick={handleMarcar} disabled={saving} style={btnP(saving?C.inkFaint:C.teal)}>
                {saving?"Guardando…":`✓ Marcar entrega estimada para el ${diaSel}/${mes+1}`}
              </button>
            </div>
          )}

          {(estimadasPorDia[kSel]||[]).length>0&&(
            <div style={{marginBottom:8}}>
              <div style={{fontSize:12,fontWeight:600,color:C.info,textTransform:"uppercase",marginBottom:4}}>● Entregas estimadas</div>
              {(estimadasPorDia[kSel]||[]).map(oc=>{
                const entregada=estaEntregada(oc);
                return (
                  <div key={oc.id} style={{fontSize:13,display:"flex",justifyContent:"space-between",gap:8,padding:"3px 0"}}>
                    <span style={{fontFamily:MONO,fontWeight:600}}>{oc.numero_oc}</span>
                    <span data-estado-agenda style={{color:entregada?C.ok:C.warn,fontSize:12,fontWeight:500}}>{entregada?"✓ Entregada":estadoOperativo(oc).texto}</span>
                  </div>
                );
              })}
            </div>
          )}
          {(realesPorDia[kSel]||[]).length>0&&(
            <div>
              <div style={{fontSize:12,fontWeight:600,color:C.okText,textTransform:"uppercase",marginBottom:4}}>● Entregas realizadas</div>
              {(realesPorDia[kSel]||[]).map(oc=>(
                <div key={oc.id} style={{fontSize:13,display:"flex",justifyContent:"space-between",gap:8,padding:"3px 0"}}>
                  <span style={{fontFamily:MONO,fontWeight:600}}>{oc.numero_oc}</span>
                  <span style={{color:C.okText,fontSize:12}}>✓</span>
                </div>
              ))}
            </div>
          )}
          {(vencenPorDia[kSel]||[]).length>0&&(
            <div style={{marginTop:8}}>
              <div style={{fontSize:12,fontWeight:600,color:C.warnText,textTransform:"uppercase",marginBottom:4}}>● Vencen facturas</div>
              {(vencenPorDia[kSel]||[]).map(({oc,evF})=>(
                <div key={oc.id} style={{fontSize:13,display:"flex",justifyContent:"space-between",gap:8,padding:"3px 0"}}>
                  <span style={{fontFamily:MONO,fontWeight:600}}>{oc.numero_oc}</span>
                  <span style={{color:C.inkMuted}}>Factura {evF.numero_factura||"—"} · {fmt.money((oc.monto_facturado||0)-(oc.monto_cobrado||0))}</span>
                </div>
              ))}
            </div>
          )}
          {(promesasPorDia[kSel]||[]).length>0&&(
            <div style={{marginTop:8}}>
              <div style={{fontSize:12,fontWeight:600,color:C.purple,textTransform:"uppercase",marginBottom:4}}>● Promesas de pago</div>
              {(promesasPorDia[kSel]||[]).map(({oc})=>(
                <div key={oc.id} style={{fontSize:13,display:"flex",justifyContent:"space-between",gap:8,padding:"3px 0"}}>
                  <span style={{fontFamily:MONO,fontWeight:600}}>{oc.numero_oc}</span>
                  <span style={{color:C.inkMuted}}>{oc.cliente||""}</span>
                </div>
              ))}
            </div>
          )}
          {(extraPorDia[kSel]||[]).length>0&&(
            <div style={{marginTop:8}} data-agenda-vp>
              <div style={{fontSize:12,fontWeight:600,color:C.tealDark,textTransform:"uppercase",marginBottom:4}}>● Ventas privadas</div>
              {(extraPorDia[kSel]||[]).map((e,i)=>(
                <button key={i} type="button" data-evento-vp={e.tipo} onClick={()=>onAbrirExtra&&onAbrirExtra(e.destino)} style={{width:"100%",background:"none",border:"none",padding:"2px 0",cursor:"pointer",fontSize:12,display:"flex",justifyContent:"space-between",gap:8,textAlign:"left"}}>
                  <span style={{fontWeight:600,color:C.ink}}>{e.titulo}</span>
                  <span style={{color:C.inkMuted}}>{e.detalle||""}{e.monto>0?` · ${fmt.money(e.monto)}`:""}</span>
                </button>
              ))}
            </div>
          )}
          {!(estimadasPorDia[kSel]||[]).length&&!(realesPorDia[kSel]||[]).length&&!(vencenPorDia[kSel]||[]).length&&!(promesasPorDia[kSel]||[]).length&&!(extraPorDia[kSel]||[]).length&&(
            <div style={{fontSize:12,color:C.inkFaint}}>Sin eventos este día</div>
          )}
        </div>
      )}
    </div>
  );
}
