import { useState, useMemo } from "react";
import { DiasBadge, Leyenda } from "../ui/Basicos";
import { del } from "../../lib/supabase";
import { C, MONO, SANS, btnP, fmt } from "../../lib/theme";

export function PanelDashboard({ ocs, financiadores, gastos, pagosVendedor, ivaMensual, vendedores, pagoFinSueltos, onNavigate, onAccion }) {
  const [expandido,setExpandido]=useState(null);

  const kpis=useMemo(()=>{
    const hoy=new Date(); hoy.setHours(0,0,0,0);
    const mesActual=hoy.getMonth()+1; const anioActual=hoy.getFullYear();

    let cobrado=0, ingresos=0, costos=0;
    let creditoPendienteTotal=0;
    let creditoPagadoTotal=0;
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
    creditoPagadoTotal+=(pagoFinSueltos||[]).reduce((s,e)=>s+(e.monto||0),0);

    const gastosTotal=gastos.reduce((s,g)=>s+(g.monto||0),0);
    const gastoContador=gastos.filter(g=>g.categoria_id==="cat_contador").reduce((s,g)=>s+(g.monto||0),0);
    const gastoImpuesto=gastos.filter(g=>g.categoria_id==="cat_impuesto").reduce((s,g)=>s+(g.monto||0),0);
    const gastosVendedores=pagosVendedor.reduce((s,p)=>s+(p.monto_pagado||0),0);

    const saldoCtaCte = cobrado - creditoPagadoTotal - gastosTotal - costoBFK;

    let ingresosPendientes=0;
    for(const oc of ocs){
      if(oc.estado_pago_cliente!=="pagado") ingresosPendientes+=oc.monto_total||0;
    }

    const deudaFin=financiadores.reduce((s,f)=>s+(Number(f.saldo_deuda)||0),0);
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
    const deudaContadorMes=0;
    const deudaTotal=deudaFin+deudaVendedoresMes+f29+deudaContadorMes;

    const saldoProyectado=saldoCtaCte+ingresosPendientes-deudaTotal;

    let porCobrar=0;
    for(const oc of ocs){
      if(oc.estado_factura_propia==="emitida") porCobrar+=(oc.monto_facturado||0)-(oc.monto_cobrado||0);
    }

    const ocsDelMes=ocs.filter(o=>{ const evC=(o.eventos_compra||[])[0]; if(!evC) return false; const f=new Date(evC.fecha); return f.getMonth()+1===mesActual&&f.getFullYear()===anioActual; });
    const margenPromPct=ocsDelMes.length>0?Math.round(ocsDelMes.reduce((s,o)=>{ const v=o.monto_total||0; if(v<=0) return s; return s+((v-(o.costo_total||0))/v)*100; },0)/ocsDelMes.length):0;

    const ocsAbiertas=ocs.filter(o=>{
      const completas=[
        (o.eventos_compra||[]).length>0,
        o.estado_entrega==="confirmada"||o.estado_entrega==="entregado",
        o.estado_factura_propia==="emitida",
        o.estado_pago_cliente==="pagado",
        o.estado_pago_financiamiento==="pagado",
      ].filter(Boolean).length;
      return completas<5;
    }).length;

    const utilidad=ingresos-costos;
    return {cobrado,porCobrar,deudaFin,utilidad,saldoProyectado,saldoCtaCte,ingresosPendientes,deudaTotal,gastoContador,gastosVendedores,gastoImpuesto,f29,margenPromPct,deudaVendedoresMes,ocsAbiertas};
  },[ocs,financiadores,gastos,pagosVendedor,ivaMensual,vendedores,pagoFinSueltos]);

  const ocsPagadas=useMemo(()=>ocs.filter(o=>o.estado_pago_cliente==="pagado").map(o=>{
    const evF=(o.eventos_factura||[])[0]; return {...o,fechaFactura:evF?.fecha};
  }),[ocs]);

  const ocsPorCobrar=useMemo(()=>ocs.filter(o=>o.estado_factura_propia==="emitida"&&o.estado_pago_cliente!=="pagado").map(o=>{
    const evF=(o.eventos_factura||[])[0]; const dias=fmt.diasDesde(evF?.fecha);
    return {...o,fechaFactura:evF?.fecha,diasDesde:dias};
  }),[ocs]);

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

  // ── Serie diaria acumulada de ventas (mes actual vs mes anterior) ──
  const ventasChart=useMemo(()=>{
    const hoy=new Date(); const diaHoy=hoy.getDate();
    const mesAct=hoy.getMonth()+1, anioAct=hoy.getFullYear();
    const mesAnt=mesAct===1?12:mesAct-1, anioAnt=mesAct===1?anioAct-1:anioAct;
    const diasMesAnt=new Date(anioAnt,mesAnt,0).getDate();
    const porDiaAct=Array(diaHoy).fill(0);
    const porDiaAnt=Array(Math.min(diaHoy,diasMesAnt)).fill(0);
    for(const oc of ocs){
      const evC=(oc.eventos_compra||[])[0]; if(!evC||!evC.fecha) continue;
      const f=new Date(String(evC.fecha).slice(0,10)+"T00:00:00");
      const monto=oc.monto_total||0;
      if(f.getFullYear()===anioAct&&f.getMonth()+1===mesAct&&f.getDate()<=diaHoy) porDiaAct[f.getDate()-1]+=monto;
      else if(f.getFullYear()===anioAnt&&f.getMonth()+1===mesAnt&&f.getDate()<=porDiaAnt.length) porDiaAnt[f.getDate()-1]+=monto;
    }
    let acc=0; const acumAct=porDiaAct.map(v=>acc+=v);
    acc=0; const acumAntRaw=porDiaAnt.map(v=>acc+=v);
    const acumAnt=Array.from({length:diaHoy},(_,i)=>acumAntRaw[i]??acumAntRaw[acumAntRaw.length-1]??0);
    const totalAct=acumAct[acumAct.length-1]||0;
    const totalAntComparable=acumAntRaw[acumAntRaw.length-1]||0;
    const variacion=totalAntComparable>0?Math.round(((totalAct-totalAntComparable)/totalAntComparable)*100):null;
    return {acumAct,acumAnt,totalAct,variacion};
  },[ocs]);

  const buildPath=(arr,w,h,max)=>{
    if(!arr.length) return "";
    const stepX=arr.length>1?w/(arr.length-1):w;
    return arr.map((v,i)=>`${i===0?"M":"L"}${(i*stepX).toFixed(1)},${(h-(v/max)*h*0.92-2).toFixed(1)}`).join(" ");
  };
  const chartMax=Math.max(...ventasChart.acumAct,...ventasChart.acumAnt,1);
  const CW=300, CH=84;
  const pathAct=buildPath(ventasChart.acumAct,CW,CH,chartMax);
  const pathAnt=buildPath(ventasChart.acumAnt,CW,CH,chartMax);

  // ── Prioridades de hoy (reales, derivadas de las OCs) ──
  const prioridades=useMemo(()=>{
    const items=[];
    const vencidas=ocsPorCobrar.filter(o=>(o.diasDesde||0)>=(Number(o.dias_pago)>0?Number(o.dias_pago):30));
    if(vencidas.length) items.push({label:`${vencidas.length} factura${vencidas.length>1?"s":""} vencida${vencidas.length>1?"s":""}`,monto:vencidas.reduce((s,o)=>s+((o.monto_facturado||0)-(o.monto_cobrado||0)),0),color:C.danger,tab:"compras",filtro:"cobro"});
    if(ocsPorCobrar.length) items.push({label:`${ocsPorCobrar.length} factura${ocsPorCobrar.length>1?"s":""} por cobrar`,monto:kpis.porCobrar,color:C.warn,tab:"compras",filtro:"cobro"});
    const sinFacturar=ocs.filter(o=>(o.estado_entrega==="confirmada"||o.estado_entrega==="entregado")&&o.estado_factura_propia!=="emitida");
    if(sinFacturar.length) items.push({label:`${sinFacturar.length} entregada${sinFacturar.length>1?"s":""} sin facturar`,monto:sinFacturar.reduce((s,o)=>s+(o.monto_total||0),0),color:C.info,tab:"compras",filtro:"factura"});
    const sinEntregar=ocs.filter(o=>(o.eventos_compra||[]).length>0&&o.estado_entrega!=="confirmada"&&o.estado_entrega!=="entregado");
    if(sinEntregar.length) items.push({label:`${sinEntregar.length} compra${sinEntregar.length>1?"s":""} sin entregar`,monto:sinEntregar.reduce((s,o)=>s+(o.monto_total||0),0),color:C.transit,tab:"compras",filtro:"entrega"});
    if(kpis.deudaFin>0) items.push({label:"Deuda con financiadores",monto:kpis.deudaFin,color:C.purple,tab:"financiamiento",filtro:null});
    return items.slice(0,5);
  },[ocsPorCobrar,ocs,kpis]);

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

  const MiniStat=({label,value,color,tab,filtro})=>(
    <div onClick={()=>tab&&onNavigate&&onNavigate(tab,filtro)}
      style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:"10px 12px",minWidth:118,flex:"0 0 auto",cursor:tab?"pointer":"default"}}>
      <div style={{fontSize:10,color:C.inkMuted,fontWeight:600,marginBottom:3,whiteSpace:"nowrap"}}>{label}{tab&&<span style={{color:C.inkFaint}}> ›</span>}</div>
      <div style={{fontSize:14.5,fontWeight:800,color:color||C.ink,fontFamily:MONO,letterSpacing:-0.3}}>{value}</div>
    </div>
  );

  return (
    <div style={{fontFamily:SANS}}>
      {/* ── Acciones rápidas ── */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:6,marginBottom:14}}>
        {[
          {key:"compra_oc",  icon:"📄", label:"Nueva OC",  color:C.teal},
          {key:"compra",     icon:"📦", label:"Compra",    color:C.transit},
          {key:"entrega",    icon:"🚚", label:"Entrega",   color:C.info},
          {key:"factura",    icon:"🧾", label:"Factura",   color:C.purple},
          {key:"pago_cliente",icon:"💰",label:"Pago",      color:C.ok},
        ].map(a=>(
          <button key={a.key} onClick={()=>onAccion&&onAccion(a.key)}
            style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,
              padding:"10px 4px",cursor:"pointer",display:"flex",flexDirection:"column",
              alignItems:"center",gap:4}}>
            <span style={{fontSize:19}}>{a.icon}</span>
            <span style={{fontSize:9.5,fontWeight:700,color:a.color,textAlign:"center",lineHeight:1.2}}>{a.label}</span>
          </button>
        ))}
      </div>

      {/* ── Fila de KPIs rápidos (scroll horizontal, estilo captura móvil) ── */}
      <div style={{display:"flex",gap:8,overflowX:"auto",paddingBottom:4,marginBottom:14,WebkitOverflowScrolling:"touch"}}>
        <MiniStat label="Saldo disponible" value={fmt.money(kpis.saldoCtaCte)} color={kpis.saldoCtaCte>=0?C.ink:C.danger} />
        <MiniStat label="Proyección total" value={fmt.money(kpis.saldoProyectado)} color={kpis.saldoProyectado>=0?C.teal:C.danger} />
        <MiniStat label="Órdenes abiertas" value={kpis.ocsAbiertas} color={C.info} tab="compras" filtro={null} />
        <MiniStat label="Por cobrar" value={fmt.money(kpis.porCobrar)} color={C.warn} tab="compras" filtro="cobro" />
      </div>

      {/* ── Prioridades de hoy ── */}
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:"14px 16px",marginBottom:12}}>
        <div style={{fontSize:11.5,fontWeight:800,color:C.inkMuted,textTransform:"uppercase",letterSpacing:0.4,marginBottom:10}}>Prioridades de hoy</div>
        {prioridades.length===0&&<div style={{fontSize:12.5,color:C.inkFaint}}>✓ Sin pendientes urgentes</div>}
        {prioridades.map((p,i)=>(
          <button key={i} onClick={()=>onNavigate&&onNavigate(p.tab,p.filtro)}
            style={{width:"100%",display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,
              padding:"9px 0",background:"none",border:"none",cursor:"pointer",textAlign:"left",
              borderBottom:i<prioridades.length-1?`1px solid ${C.border}`:"none"}}>
            <span style={{fontSize:12.5,color:C.ink,fontWeight:600}}>{p.label}</span>
            <span style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
              <span style={{fontSize:12.5,fontWeight:800,color:p.color,fontFamily:MONO}}>{fmt.money(p.monto)}</span>
              <span style={{fontSize:13,color:C.inkFaint}}>›</span>
            </span>
          </button>
        ))}
      </div>

      {/* ── Ventas del mes (línea acumulada) ── */}
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:"14px 16px",marginBottom:12}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:2}}>
          <div style={{fontSize:11.5,fontWeight:800,color:C.inkMuted,textTransform:"uppercase",letterSpacing:0.4}}>Ventas del mes</div>
          {ventasChart.variacion!==null&&(
            <span style={{fontSize:11,fontWeight:700,color:ventasChart.variacion>=0?C.ok:C.danger}}>{ventasChart.variacion>=0?"+":""}{ventasChart.variacion}% vs mes ant.</span>
          )}
        </div>
        <div style={{fontSize:20,fontWeight:800,color:C.ink,fontFamily:MONO,marginBottom:8}}>{fmt.money(ventasChart.totalAct)}</div>
        <svg viewBox={`0 0 ${CW} ${CH}`} width="100%" height={CH} preserveAspectRatio="none">
          <path d={pathAnt} fill="none" stroke={C.border} strokeWidth="2" />
          <path d={pathAct} fill="none" stroke={C.teal} strokeWidth="2.5" />
        </svg>
        <div style={{display:"flex",gap:14,marginTop:4}}>
          <span style={{fontSize:10.5,color:C.inkMuted,display:"flex",alignItems:"center",gap:4}}><span style={{width:8,height:8,borderRadius:"50%",background:C.teal,display:"inline-block"}} />Este mes</span>
          <span style={{fontSize:10.5,color:C.inkMuted,display:"flex",alignItems:"center",gap:4}}><span style={{width:8,height:8,borderRadius:"50%",background:C.border,display:"inline-block"}} />Mes anterior</span>
        </div>
      </div>

      {/* ── Margen del mes (dona) ── */}
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:"14px 16px",marginBottom:14,display:"flex",alignItems:"center",gap:16}}>
        <div style={{width:80,height:80,borderRadius:"50%",flexShrink:0,background:`conic-gradient(${kpis.margenPromPct>=20?C.ok:kpis.margenPromPct>=10?C.warn:C.danger} ${Math.max(0,Math.min(100,kpis.margenPromPct))*3.6}deg, ${C.paper} 0)`,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{width:56,height:56,borderRadius:"50%",background:C.card,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column"}}>
            <span style={{fontSize:15,fontWeight:800,color:C.ink,fontFamily:MONO}}>{kpis.margenPromPct}%</span>
          </div>
        </div>
        <div>
          <div style={{fontSize:11.5,fontWeight:800,color:C.inkMuted,textTransform:"uppercase",letterSpacing:0.4,marginBottom:4}}>Margen del mes</div>
          <div style={{fontSize:12.5,color:C.inkMuted}}>Promedio esperado de las OCs compradas este mes</div>
        </div>
      </div>

      {/* ── Saldo Proyectado — detalle de la fórmula ── */}
      <div style={{background:`linear-gradient(135deg,${C.night},${C.nightSoft})`,borderRadius:16,padding:"18px 20px",marginBottom:14}}>
        <div style={{fontSize:11.5,color:C.inkFaint,fontWeight:700,marginBottom:6,textTransform:"uppercase",letterSpacing:0.5}}>Saldo Proyectado</div>
        <div style={{fontFamily:MONO,fontWeight:800,fontSize:28,color:kpis.saldoProyectado>=0?C.teal:C.danger,letterSpacing:-1}}>{fmt.money(kpis.saldoProyectado)}</div>
        <div style={{fontSize:11,color:C.inkFaint,marginTop:4}}>Saldo Cta Cte + Ingresos Pendientes − Deuda total</div>
        <div style={{display:"flex",gap:12,marginTop:8,flexWrap:"wrap"}}>
          <div style={{fontSize:10.5,color:C.inkFaint}}>Cta Cte: <span style={{color:C.teal,fontWeight:700}}>{fmt.money(kpis.saldoCtaCte)}</span></div>
          <div style={{fontSize:10.5,color:C.inkFaint}}>Ing. Pendientes: <span style={{color:C.warn,fontWeight:700}}>{fmt.money(kpis.ingresosPendientes)}</span></div>
          <div style={{fontSize:10.5,color:C.inkFaint}}>Deuda: <span style={{color:C.danger,fontWeight:700}}>{fmt.money(kpis.deudaTotal)}</span></div>
        </div>
      </div>

      {/* 4 KPIs clickeables (detalle expandible) */}
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
              {o.diasDesde!==null&&<DiasBadge dias={o.diasDesde} diasPago={o.dias_pago} />}
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

      <Leyenda titulo="¿Qué significan estos números?" items={[
        {muestra:"Saldo", texto:"Saldo disponible: lo cobrado menos pagos a financiadores, gastos y compras con cuenta BFK."},
        {muestra:"Proy.", texto:"Proyección total: saldo disponible + ingresos pendientes − deuda total. Es cuánto quedaría si todo se cobra y se paga."},
        {muestra:"18%", color:C.ok, bg:C.okLight, texto:"Margen del mes: promedio esperado de las OCs compradas este mes. Verde sobre 20%, amarillo 10–20%, rojo bajo 10%."},
        {muestra:"›", texto:"Las prioridades y los recuadros con flecha te llevan al listado ya filtrado."},
        {muestra:"—", texto:"La línea gris del gráfico es el mes anterior a la misma altura del mes, para comparar parejo."},
      ]} />
    </div>
  );
}
