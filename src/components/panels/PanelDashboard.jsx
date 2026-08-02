import { useState, useMemo } from "react";
import { DiasBadge, Leyenda } from "../ui/Basicos";
import { gananciaReal, costoPostventa } from "../../lib/theme";
import { del } from "../../lib/supabase";
import { C, MONO, SANS, btnP, fmt } from "../../lib/theme";

export function PanelDashboard({ ocs, financiadores, gastos, pagosVendedor, ivaMensual, vendedores, pagoFinSueltos, aportes: aportesLista, onNavigate, onAccion, onSincronizar, sincronizando, porAceptar, esCodigoMP, ultimaCartola, saldoBanco, bancoMensual, onEditarSaldo }) {
  const [expandido,setExpandido]=useState(null);
  const [verHistorico,setVerHistorico]=useState(false);

  const kpis=useMemo(()=>{
    const hoy=new Date(); hoy.setHours(0,0,0,0);
    const mesActual=hoy.getMonth()+1; const anioActual=hoy.getFullYear();

    // Separar por tipo: solo 'venta' cuenta como venta y utilidad.
    // 'aporte_socio' entra a caja pero no es venta. 'externa' queda fuera de todo.
    const esVenta =(o)=>(o.tipo_registro||"venta")==="venta";
    const esAporte=(o)=>o.tipo_registro==="aporte_socio";
    const enCaja  =(o)=>esVenta(o)||esAporte(o);

    // Aportes de socios: vienen de su propia tabla
    const totalAportes=(aportesLista||[]).reduce((s,a)=>
      s+(a.tipo==="retiro"?-(Number(a.monto)||0):(Number(a.monto)||0)),0);

    let cobrado=0, ingresos=0, costos=0;
    let creditoPendienteTotal=0;
    let creditoPagadoTotal=0;
    let costoBFK=0;

    for(const oc of ocs){
      if(!enCaja(oc)) continue;                    // externa: fuera de todo
      cobrado+=oc.monto_cobrado||0;                // caja: ventas + aportes
      if(esAporte(oc)) continue;   // los aportes viven en aportes_socios
      ingresos+=oc.monto_total||0;                 // solo ventas reales
      costos+=(Number(oc.costo_total)||0)+costoPostventa(oc);
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

        // La app calcula su propio saldo con lo registrado.
    const saldoCtaCte = cobrado + totalAportes - creditoPagadoTotal - gastosTotal - costoBFK;

    // Y se compara con el saldo real del banco: la diferencia es
    // lo que se movió en la cuenta y no está registrado acá.
    const corte = saldoBanco?.fecha_corte ? String(saldoBanco.fecha_corte).slice(0,10) : null;
    const saldoReal = saldoBanco ? Number(saldoBanco.saldo)||0 : null;

    // Movimientos registrados después del corte: se suman al saldo real
    // para poder comparar ambos en el mismo momento.
    let movDesdeCorte=0;
    if(corte){
      for(const oc of ocs){
        for(const e of (oc.eventos_pago_cliente||[]))
          if(String(e.fecha||"").slice(0,10) > corte) movDesdeCorte += Number(e.monto)||0;
        for(const e of (oc.eventos_pago_financiamiento||[]))
          if(String(e.fecha||"").slice(0,10) > corte) movDesdeCorte -= Number(e.monto)||0;
      }
      for(const e of (pagoFinSueltos||[]))
        if(String(e.fecha||"").slice(0,10) > corte) movDesdeCorte -= Number(e.monto)||0;
      for(const g of gastos)
        if(String(g.fecha||"").slice(0,10) > corte) movDesdeCorte -= Number(g.monto)||0;
      for(const p of pagosVendedor)
        if(String(p.fecha||"").slice(0,10) > corte) movDesdeCorte -= Number(p.monto_pagado)||0;
      for(const a of (aportesLista||[]))
        if(String(a.fecha||"").slice(0,10) > corte)
          movDesdeCorte += (a.tipo==="retiro"?-1:1)*(Number(a.monto)||0);
    }
    const saldoEsperado = saldoReal!==null ? saldoReal + movDesdeCorte : null;
    const brecha = saldoEsperado!==null ? saldoCtaCte - saldoEsperado : null;

    let ingresosPendientes=0;
    for(const oc of ocs){
      if(!esVenta(oc)) continue;
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
      if(!esVenta(oc)) continue;
      if(oc.estado_factura_propia==="emitida") porCobrar+=(oc.monto_facturado||0)-(oc.monto_cobrado||0);
    }

    const ocsDelMes=ocs.filter(o=>{ if(!esVenta(o)) return false; const evC=(o.eventos_compra||[])[0]; if(!evC) return false; const f=new Date(evC.fecha); return f.getMonth()+1===mesActual&&f.getFullYear()===anioActual; });
    const margenPromPct=ocsDelMes.length>0?Math.round(ocsDelMes.reduce((s,o)=>{ const v=o.monto_total||0; if(v<=0) return s; return s+((v-(o.costo_total||0))/v)*100; },0)/ocsDelMes.length):0;
    const gananciaMes=ocsDelMes.reduce((s,o)=>s+gananciaReal(o).pesos,0);
    const ventaMes=ocsDelMes.reduce((s,o)=>s+(Number(o.monto_total)||0),0);

    const ocsAbiertas=ocs.filter(o=>{
      if(!esVenta(o)) return false;
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
    return {saldoReal,saldoEsperado,brecha,corteBanco:corte,movDesdeCorte,gananciaMes,ventaMes,aportes:totalAportes,cobrado,porCobrar,deudaFin,utilidad,saldoProyectado,saldoCtaCte,ingresosPendientes,deudaTotal,gastoContador,gastosVendedores,gastoImpuesto,f29,margenPromPct,deudaVendedoresMes,ocsAbiertas};
  },[ocs,financiadores,gastos,pagosVendedor,ivaMensual,vendedores,pagoFinSueltos,aportesLista,saldoBanco]);

  const ocsPagadas=useMemo(()=>ocs.filter(o=>o.estado_pago_cliente==="pagado").map(o=>{
    const evF=(o.eventos_factura||[])[0]; return {...o,fechaFactura:evF?.fecha};
  }),[ocs]);

  const ocsPorCobrar=useMemo(()=>ocs.filter(o=>(o.tipo_registro||"venta")==="venta"&&o.estado_factura_propia==="emitida"&&o.estado_pago_cliente!=="pagado").map(o=>{
    const evF=(o.eventos_factura||[])[0]; const dias=fmt.diasDesde(evF?.fecha);
    return {...o,fechaFactura:evF?.fecha,diasDesde:dias};
  }),[ocs]);

  const utilidadPeriodos=useMemo(()=>{
    const hoy=new Date(); const mesActual=hoy.getMonth()+1; const anioActual=hoy.getFullYear();
    const mesAnterior=mesActual===1?12:mesActual-1; const anioMA=mesActual===1?anioActual-1:anioActual;
    const calcUtil=(meses)=>{
      const limite=new Date(); limite.setMonth(limite.getMonth()-meses);
      return ocs.filter(o=>{
        if((o.tipo_registro||"venta")!=="venta") return false;
        const evC=(o.eventos_compra||[])[0]; if(!evC) return false;
        return new Date(evC.fecha)>=limite;
      }).reduce((s,o)=>s+gananciaReal(o).pesos,0);
    };
    const mesAntOcs=ocs.filter(o=>{
      const evC=(o.eventos_compra||[])[0]; if(!evC) return false;
      const f=new Date(evC.fecha); return f.getMonth()+1===mesAnterior&&f.getFullYear()===anioMA;
    });
    const utilMesAnt=mesAntOcs.reduce((s,o)=>s+gananciaReal(o).pesos,0);
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
      if((oc.tipo_registro||"venta")!=="venta") continue;
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
    const plazo=(o)=>Number(o.dias_pago)>0?Number(o.dias_pago):30;
    const items=[];

    const vencidas=ocsPorCobrar.filter(o=>(o.diasDesde||0)>=plazo(o));
    if(vencidas.length) items.push({
      label:`${vencidas.length} factura${vencidas.length>1?"s":""} vencida${vencidas.length>1?"s":""}`,
      detalle:"Ya se pasó el plazo de pago",
      monto:vencidas.reduce((s,o)=>s+((o.monto_facturado||0)-(o.monto_cobrado||0)),0),
      color:C.danger,tab:"compras",filtro:"cobro"});

    const porVencer=ocsPorCobrar.filter(o=>(o.diasDesde||0)<plazo(o)&&(o.diasDesde||0)>=plazo(o)-5);
    if(porVencer.length) items.push({
      label:`${porVencer.length} factura${porVencer.length>1?"s":""} por vencer`,
      detalle:"Vencen dentro de 5 días",
      monto:porVencer.reduce((s,o)=>s+((o.monto_facturado||0)-(o.monto_cobrado||0)),0),
      color:C.warn,tab:"compras",filtro:"cobro"});

    const sinFacturar=ocs.filter(o=>(o.tipo_registro||"venta")==="venta"&&(o.estado_entrega==="confirmada"||o.estado_entrega==="entregado")&&o.estado_factura_propia!=="emitida");
    if(sinFacturar.length) items.push({
      label:`${sinFacturar.length} entregada${sinFacturar.length>1?"s":""} sin facturar`,
      detalle:"Ya se entregó, falta emitir la factura",
      monto:sinFacturar.reduce((s,o)=>s+(o.monto_total||0),0),
      color:C.info,tab:"compras",filtro:"factura"});

    const sinEntregar=ocs.filter(o=>(o.tipo_registro||"venta")==="venta"&&(o.eventos_compra||[]).length>0&&o.estado_entrega!=="confirmada"&&o.estado_entrega!=="entregado");
    if(sinEntregar.length) items.push({
      label:`${sinEntregar.length} compra${sinEntregar.length>1?"s":""} sin entregar`,
      detalle:"Comprado, pendiente de entregar",
      monto:sinEntregar.reduce((s,o)=>s+(o.monto_total||0),0),
      color:C.transit,tab:"compras",filtro:"entrega"});

    return items;
  },[ocsPorCobrar,ocs]);

  // Agrupa el contenido bajo un título discreto
  const Seccion=({titulo,children,sub,ocultarSiVacio})=>{
    if(ocultarSiVacio) return null;
    return (
    <div style={{marginBottom:18}}>
      <div style={{fontSize:10.5,fontWeight:800,color:C.inkFaint,textTransform:"uppercase",
        letterSpacing:0.6,marginBottom:8,paddingLeft:2}}>{titulo}</div>
      {sub&&<div style={{fontSize:11.5,color:C.inkFaint,marginBottom:8,paddingLeft:2}}>{sub}</div>}
      {children}
    </div>
    );
  };

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
      <Seccion titulo="Registrar">
      <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:6,marginBottom:6}}>
        {[
          {key:"compra",      icon:"📦", label:"Compra",  color:C.transit},
          {key:"entrega",     icon:"🚚", label:"Entrega", color:C.info},
          {key:"factura",     icon:"🧾", label:"Factura", color:C.purple},
          {key:"pago_cliente",icon:"💰", label:"Pago",    color:C.ok},
          {key:"cartola",     icon:"🏦", label:"Banco",   color:C.info},
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
      <div style={{fontSize:10,color:C.inkFaint,textAlign:"center",marginBottom:14}}>
        Registra una etapa del ciclo de una OC existente
      </div>
      </Seccion>

      <Seccion titulo="Situación">
      {/* ── Saldo Proyectado ── */}
      <div style={{background:`linear-gradient(135deg,${C.night},${C.nightSoft})`,borderRadius:16,padding:"18px 20px",marginBottom:12}}>
        <div style={{fontSize:11.5,color:C.inkFaint,fontWeight:700,marginBottom:6,textTransform:"uppercase",letterSpacing:0.5}}>Saldo Proyectado</div>
        <div style={{fontFamily:MONO,fontWeight:800,fontSize:28,color:kpis.saldoProyectado>=0?C.teal:C.danger,letterSpacing:-1}}>{fmt.money(kpis.saldoProyectado)}</div>
        <div style={{fontSize:11,color:C.inkFaint,marginTop:4}}>Cuánto quedaría si se cobra todo lo pendiente y se paga todo lo que se debe</div>

        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginTop:12,paddingTop:12,borderTop:"1px solid rgba(255,255,255,0.08)"}}>
          <div>
            <div style={{fontSize:9.5,color:C.inkFaint,marginBottom:2}}>En la cuenta</div>
            <div style={{fontFamily:MONO,fontSize:12.5,fontWeight:800,color:kpis.saldoCtaCte>=0?C.teal:C.danger}}>{fmt.money(kpis.saldoCtaCte)}</div>
          </div>
          <div>
            <div style={{fontSize:9.5,color:C.inkFaint,marginBottom:2}}>Por entrar</div>
            <div style={{fontFamily:MONO,fontSize:12.5,fontWeight:800,color:C.warn}}>{fmt.money(kpis.ingresosPendientes)}</div>
          </div>
          <div>
            <div style={{fontSize:9.5,color:C.inkFaint,marginBottom:2}}>Por pagar</div>
            <div style={{fontFamily:MONO,fontSize:12.5,fontWeight:800,color:C.danger}}>{fmt.money(kpis.deudaTotal)}</div>
          </div>
        </div>

        <button onClick={()=>onNavigate&&onNavigate("compras",null)}
          style={{marginTop:12,background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.12)",
            borderRadius:9,padding:"7px 12px",color:"#B8C4D9",fontSize:11.5,fontWeight:600,cursor:"pointer",width:"100%"}}>
          {kpis.ocsAbiertas} órdenes en curso ›
        </button>

        <div style={{fontSize:10.5,color:C.inkFaint,marginTop:10,paddingTop:9,borderTop:"1px solid rgba(255,255,255,0.08)",lineHeight:1.6}}>
          {ultimaCartola&&(
            <>Última cartola: {fmt.date(String(ultimaCartola.fecha_desde).slice(0,10))} a {fmt.date(String(ultimaCartola.fecha_hasta).slice(0,10))}<br/></>
          )}
          <button onClick={onEditarSaldo}
            style={{background:"none",border:"none",color:C.teal,fontSize:10.5,fontWeight:700,cursor:"pointer",padding:"3px 0"}}>
            {kpis.saldoReal!==null?"Actualizar el saldo del banco":"Registrar el saldo del banco para conciliar"}
          </button>
        </div>
      </div>

      {/* Conciliación por mes: el banco valida lo registrado.
          No se comparan movimientos uno a uno porque las entidades
          pagan varias facturas juntas y nunca calzarían. */}
      {(bancoMensual||[]).length>0&&(()=>{
        const meses=(bancoMensual||[]).slice(0,6).map(bm=>{
          const ini=`${bm.anio}-${String(bm.mes).padStart(2,"0")}-01`;
          const fin=`${bm.anio}-${String(bm.mes).padStart(2,"0")}-31`;
          const enRango=(f)=>{const d=String(f||"").slice(0,10); return d>=ini&&d<=fin;};

          let appEntro=0, appSalio=0;
          for(const oc of ocs){
            for(const e of (oc.eventos_pago_cliente||[]))          if(enRango(e.fecha)) appEntro+=Number(e.monto)||0;
            for(const e of (oc.eventos_pago_financiamiento||[]))   if(enRango(e.fecha)) appSalio+=Number(e.monto)||0;
          }
          for(const e of (pagoFinSueltos||[])) if(enRango(e.fecha)) appSalio+=Number(e.monto)||0;
          for(const g of gastos)               if(enRango(g.fecha)) appSalio+=Number(g.monto)||0;
          for(const p of pagosVendedor)        if(enRango(p.fecha)) appSalio+=Number(p.monto_pagado)||0;
          for(const a of (aportesLista||[]))   if(enRango(a.fecha)) (a.tipo==="retiro"?appSalio+=Number(a.monto)||0:appEntro+=Number(a.monto)||0);

          const dEntro=appEntro-(Number(bm.entro)||0);
          const dSalio=appSalio-(Number(bm.salio)||0);
          const peor=Math.max(Math.abs(dEntro),Math.abs(dSalio));
          const nombre=new Date(bm.anio,bm.mes-1,1).toLocaleDateString("es-CL",{month:"short",year:"2-digit"});
          return {bm,nombre,appEntro,appSalio,dEntro,dSalio,peor};
        });

        const conProblema=meses.filter(m=>m.peor>50000).length;

        return (
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:"13px 15px",marginBottom:12}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:3}}>
              <span style={{fontSize:11.5,fontWeight:800,color:C.inkMuted,textTransform:"uppercase",letterSpacing:0.4}}>
                El banco vs lo registrado
              </span>
              {conProblema===0
                ? <span style={{fontSize:11,fontWeight:700,color:C.ok}}>✓ todo cuadra</span>
                : <span style={{fontSize:11,fontWeight:700,color:C.warn}}>{conProblema} mes(es) con diferencia</span>}
            </div>
            <div style={{fontSize:11,color:C.inkFaint,marginBottom:10,lineHeight:1.45}}>
              Se comparan totales del mes, no movimiento a movimiento: las entidades pagan varias facturas juntas.
            </div>

            <div style={{display:"flex",gap:8,padding:"0 0 5px",fontSize:9.5,fontWeight:800,
              color:C.inkFaint,textTransform:"uppercase",letterSpacing:0.4}}>
              <span style={{width:52}}>Mes</span>
              <span style={{flex:1,textAlign:"right"}}>Entró</span>
              <span style={{flex:1,textAlign:"right"}}>Salió</span>
            </div>

            {meses.map(m=>(
              <div key={m.bm.id} style={{padding:"7px 0",borderTop:`1px solid ${C.border}`}}>
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  <span style={{width:52,fontSize:11.5,fontWeight:700,color:C.ink}}>{m.nombre}</span>
                  <span style={{flex:1,textAlign:"right"}}>
                    <span style={{display:"block",fontFamily:MONO,fontSize:11.5,color:C.ink}}>{fmt.money(m.bm.entro)}</span>
                    {Math.abs(m.dEntro)>50000&&(
                      <span style={{display:"block",fontSize:9.5,fontWeight:700,color:m.dEntro>0?C.warn:C.danger}}>
                        app {m.dEntro>0?"+":""}{fmt.money(m.dEntro)}
                      </span>
                    )}
                  </span>
                  <span style={{flex:1,textAlign:"right"}}>
                    <span style={{display:"block",fontFamily:MONO,fontSize:11.5,color:C.ink}}>{fmt.money(m.bm.salio)}</span>
                    {Math.abs(m.dSalio)>50000&&(
                      <span style={{display:"block",fontSize:9.5,fontWeight:700,color:m.dSalio>0?C.warn:C.danger}}>
                        app {m.dSalio>0?"+":""}{fmt.money(m.dSalio)}
                      </span>
                    )}
                  </span>
                </div>
              </div>
            ))}

            <div style={{fontSize:10.5,color:C.inkFaint,marginTop:9,paddingTop:8,borderTop:`1px solid ${C.border}`,lineHeight:1.5}}>
              En negro lo que dice el banco. Debajo, cuánto se desvía lo registrado en la app.
            </div>
          </div>
        );
      })()}

      </Seccion>

      <Seccion titulo="Requiere atención">
      {/* ── OCs esperando aceptación en Mercado Público ── */}
      {(porAceptar||[]).length>0&&(
        <div style={{background:C.warnLight,border:`1px solid ${C.warn}`,borderRadius:12,padding:"12px 14px",marginBottom:12}}>
          <div style={{fontSize:12.5,fontWeight:700,color:C.warn,marginBottom:3}}>
            {porAceptar.length} OC{porAceptar.length>1?"s":""} esperando aceptación
          </div>
          <div style={{fontSize:11.5,color:C.inkMuted,marginBottom:9,lineHeight:1.45}}>
            Están enviadas en Mercado Público pero nadie las ha aceptado. Hasta que se acepten no se pueden cargar acá.
          </div>
          {porAceptar.slice(0,5).map((o,i)=>(
            <div key={i} style={{display:"flex",justifyContent:"space-between",gap:8,padding:"5px 0",
              borderBottom:i<Math.min(porAceptar.length,5)-1?`1px solid ${C.warn}33`:"none"}}>
              <span style={{fontFamily:MONO,fontSize:11.5,fontWeight:700,color:C.ink}}>{o.numero_oc}</span>
              <span style={{fontSize:10.5,color:C.inkMuted,textAlign:"right",minWidth:0,
                overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{o.nombre||""}</span>
            </div>
          ))}
          {porAceptar.length>5&&(
            <div style={{fontSize:10.5,color:C.inkFaint,marginTop:5}}>y {porAceptar.length-5} más</div>
          )}
        </div>
      )}

      {/* ── OCs sin datos: ofrecer completarlas desde Mercado Público ── */}
      {(()=>{
        const sinDatos=ocs.filter(o=>esCodigoMP&&esCodigoMP(o.numero_oc)&&!o.no_en_mp&&(o.sync_pendiente||!o.rut_cliente||!o.fecha_emision_mp||String(o.cliente||"").toUpperCase().includes("POR COMPLETAR"))).length;
        if(!sinDatos&&!sincronizando) return null;
        return (
          <div style={{background:C.infoLight,border:`1px solid ${C.info}`,borderRadius:12,padding:"12px 14px",marginBottom:12}}>
            <div style={{fontSize:12.5,fontWeight:700,color:C.info,marginBottom:3}}>
              {sincronizando?`Completando ${sincronizando.hechas} de ${sincronizando.total}…`:`${sinDatos} OC${sinDatos>1?"s":""} sin datos de cliente`}
            </div>
            <div style={{fontSize:11.5,color:C.inkMuted,marginBottom:sincronizando?0:9,lineHeight:1.45}}>
              Mercado Público tiene el cliente, RUT, comuna, contacto, fecha de emisión y productos de estas órdenes. Solo se consultan las que tienen código de Mercado Público; las ventas directas quedan fuera.
            </div>
            {!sincronizando&&(
              <button onClick={onSincronizar}
                style={{width:"100%",background:C.info,border:"none",color:"#fff",borderRadius:9,padding:"9px 12px",fontSize:12.5,fontWeight:700,cursor:"pointer"}}>
                Completar desde Mercado Público
              </button>
            )}
          </div>
        );
      })()}

      {/* ── Prioridades de hoy ── */}
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:"14px 16px",marginBottom:12}}>
        <div style={{fontSize:11.5,fontWeight:800,color:C.inkMuted,textTransform:"uppercase",letterSpacing:0.4,marginBottom:2}}>Prioridades de hoy</div>
        <div style={{fontSize:10.5,color:C.inkFaint,marginBottom:10}}>Toca cualquiera para ver esas órdenes</div>
        {prioridades.length===0&&<div style={{fontSize:12.5,color:C.inkFaint}}>✓ Sin pendientes urgentes</div>}
        {prioridades.map((p,i)=>(
          <button key={i} onClick={()=>onNavigate&&onNavigate(p.tab,p.filtro)}
            style={{width:"100%",display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,
              padding:"9px 0",background:"none",border:"none",cursor:"pointer",textAlign:"left",
              borderBottom:i<prioridades.length-1?`1px solid ${C.border}`:"none"}}>
            <span style={{minWidth:0}}>
              <span style={{fontSize:12.5,color:C.ink,fontWeight:600,display:"block"}}>{p.label}</span>
              {p.detalle&&<span style={{fontSize:10.5,color:C.inkFaint,display:"block",marginTop:1}}>{p.detalle}</span>}
            </span>
            <span style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
              <span style={{fontSize:12.5,fontWeight:800,color:p.color,fontFamily:MONO}}>{fmt.money(p.monto)}</span>
              <span style={{fontSize:13,color:C.inkFaint}}>›</span>
            </span>
          </button>
        ))}
      </div>

      </Seccion>

      <Seccion titulo="Este mes" ocultarSiVacio={ventasChart.totalAct<=0&&kpis.margenPromPct<=0}>
      {/* Resultado del mes cerrado: dato estable que no depende del día */}
      {(()=>{
        const h=new Date();
        const mAnt=h.getMonth()===0?12:h.getMonth();
        const aAnt=h.getMonth()===0?h.getFullYear()-1:h.getFullYear();
        const delMes=ocs.filter(o=>{
          if((o.tipo_registro||"venta")!=="venta") return false;
          const f=o.fecha_emision_mp||(o.eventos_compra||[])[0]?.fecha;
          if(!f) return false;
          const d=new Date(String(f).slice(0,10)+"T00:00:00");
          return d.getMonth()+1===mAnt&&d.getFullYear()===aAnt;
        });
        if(!delMes.length) return null;
        const venta=delMes.reduce((s,o)=>s+(Number(o.monto_total)||0),0);
        const costo=delMes.reduce((s,o)=>s+(Number(o.costo_total)||0),0);
        const util=venta-costo, pct=venta>0?Math.round(util/venta*100):0;
        const col=pct>=20?C.ok:pct>=10?C.warn:C.danger;
        const nombreMes=new Date(aAnt,mAnt-1,1).toLocaleDateString("es-CL",{month:"long"});
        return (
          <div style={{marginBottom:18}}>
            <div style={{fontSize:10.5,fontWeight:800,color:C.inkFaint,textTransform:"uppercase",
              letterSpacing:0.6,marginBottom:8,paddingLeft:2}}>{nombreMes} · mes cerrado</div>
            <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:"14px 16px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:10}}>
                <span style={{fontSize:11.5,color:C.inkMuted}}>{delMes.length} órdenes</span>
                <span style={{fontFamily:MONO,fontWeight:800,fontSize:19,color:C.ink}}>{fmt.money(venta)}</span>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,
                paddingTop:10,borderTop:`1px solid ${C.border}`}}>
                <div>
                  <div style={{fontSize:10,color:C.inkFaint,fontWeight:700,textTransform:"uppercase"}}>Costo</div>
                  <div style={{fontFamily:MONO,fontWeight:800,fontSize:13.5,color:C.inkMuted}}>{fmt.money(costo)}</div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:10,color:C.inkFaint,fontWeight:700,textTransform:"uppercase"}}>Utilidad</div>
                  <div style={{fontFamily:MONO,fontWeight:800,fontSize:13.5,color:col}}>
                    {fmt.money(util)} <span style={{fontSize:11}}>{pct}%</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Resumen del mes, incluso sin curva todavía */}
      {ventasChart.totalAct<=0&&kpis.margenPromPct<=0&&(
        <div style={{marginBottom:18}}>
          <div style={{fontSize:10.5,fontWeight:800,color:C.inkFaint,textTransform:"uppercase",
            letterSpacing:0.6,marginBottom:8,paddingLeft:2}}>Este mes</div>
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:"14px 16px"}}>
            <div style={{fontSize:12.5,color:C.inkMuted,lineHeight:1.5}}>
              Todavía no hay compras registradas en {new Date().toLocaleDateString("es-CL",{month:"long"})}.
              Las ventas y el margen del mes aparecen aquí cuando se registre la primera.
            </div>
          </div>
        </div>
      )}

      {/* ── Ventas y margen ── */}
      {(ventasChart.totalAct>0||kpis.margenPromPct>0)&&(()=>{ const hayCurva=ventasChart.acumAct.length>=3; return (
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:"14px 16px",marginBottom:14}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:2}}>
          <div style={{fontSize:11.5,fontWeight:800,color:C.inkMuted,textTransform:"uppercase",letterSpacing:0.4}}>Ventas del mes</div>
          {ventasChart.variacion!==null&&(
            <span style={{fontSize:11,fontWeight:700,color:ventasChart.variacion>=0?C.ok:C.danger}}>{ventasChart.variacion>=0?"+":""}{ventasChart.variacion}% vs mes ant.</span>
          )}
        </div>

        <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:6}}>
          <div style={{flex:1}}>
            <div style={{fontSize:20,fontWeight:800,color:C.ink,fontFamily:MONO}}>{fmt.money(ventasChart.totalAct)}</div>
            <div style={{fontSize:10,color:C.inkFaint}}>vendido este mes</div>
          </div>
          <div style={{width:62,height:62,borderRadius:"50%",flexShrink:0,
            background:`conic-gradient(${kpis.margenPromPct>=20?C.ok:kpis.margenPromPct>=10?C.warn:C.danger} ${Math.max(0,Math.min(100,kpis.margenPromPct))*3.6}deg, ${C.paper} 0)`,
            display:"flex",alignItems:"center",justifyContent:"center"}}>
            <div style={{width:44,height:44,borderRadius:"50%",background:C.card,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
              <span style={{fontSize:13,fontWeight:800,color:C.ink,fontFamily:MONO}}>{kpis.margenPromPct>0?`${kpis.margenPromPct}%`:"—"}</span>
              <span style={{fontSize:7,color:C.inkFaint,letterSpacing:0.2}}>MARGEN</span>
            </div>
          </div>
        </div>

        {hayCurva&&<svg viewBox={`0 0 ${CW} ${CH}`} width="100%" height={CH} preserveAspectRatio="none">
          <path d={pathAnt} fill="none" stroke={C.border} strokeWidth="2" />
          <path d={pathAct} fill="none" stroke={C.teal} strokeWidth="2.5" />
        </svg>}
        {!hayCurva&&(
          <div style={{fontSize:11.5,color:C.inkFaint,padding:"14px 0 4px",lineHeight:1.5}}>
            Recién empieza el mes — la curva aparece con unos días de ventas.
          </div>
        )}
        {hayCurva&&<div style={{display:"flex",gap:14,marginTop:4}}>
          <span style={{fontSize:10.5,color:C.inkMuted,display:"flex",alignItems:"center",gap:4}}><span style={{width:8,height:8,borderRadius:"50%",background:C.teal,display:"inline-block"}} />Este mes</span>
          <span style={{fontSize:10.5,color:C.inkMuted,display:"flex",alignItems:"center",gap:4}}><span style={{width:8,height:8,borderRadius:"50%",background:C.border,display:"inline-block"}} />Mes anterior</span>
        </div>}
      </div>); })()}

      <button onClick={()=>setVerHistorico(v=>!v)}
        style={{width:"100%",background:"none",border:"none",cursor:"pointer",textAlign:"left",
          fontSize:11.5,fontWeight:800,color:C.inkMuted,textTransform:"uppercase",letterSpacing:0.4,
          marginBottom:8,padding:"4px 0",display:"flex",alignItems:"center",gap:6}}>
        <span style={{fontSize:12}}>{verHistorico?"▾":"▸"}</span> Detalle e histórico
      </button>

      {/* 4 KPIs clickeables (detalle expandible) */}
      {verHistorico&&<>
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
              <div style={{fontFamily:MONO,fontWeight:800,fontSize:15,color:v>=0?C.teal:C.danger}}>{fmt.money(v)}</div>
            </div>
          ))}
        </div>
        <div style={{fontSize:11,color:C.inkFaint,marginTop:4}}>Utilidad = Ventas − Costo compras (sin descontar gastos indirectos)</div>
      </KpiBtn>
      </>}

      </Seccion>

      {/* Deuda a terceros — el detalle vive en Vendedores y Financiamiento */}
      {(kpis.deudaVendedoresMes>0||kpis.f29>0)&&(
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:"12px 15px",marginBottom:12}}>
          <div style={{fontSize:11,fontWeight:800,color:C.inkMuted,textTransform:"uppercase",letterSpacing:0.4,marginBottom:8}}>Compromisos del mes</div>
          {kpis.deudaVendedoresMes>0&&(
            <button onClick={()=>onNavigate&&onNavigate("vendedores",null)}
              style={{width:"100%",background:"none",border:"none",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",textAlign:"left"}}>
              <span style={{fontSize:12.5,color:C.ink,fontWeight:600}}>Comisiones a vendedores</span>
              <span style={{display:"flex",alignItems:"center",gap:6}}>
                <span style={{fontFamily:MONO,fontWeight:800,fontSize:12.5,color:C.warn}}>{fmt.money(kpis.deudaVendedoresMes)}</span>
                <span style={{fontSize:13,color:C.inkFaint}}>›</span>
              </span>
            </button>
          )}
          {kpis.f29>0&&(
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderTop:kpis.deudaVendedoresMes>0?`1px solid ${C.border}`:"none"}}>
              <span style={{fontSize:12.5,color:C.ink,fontWeight:600}}>Impuesto F29 proyectado</span>
              <span style={{fontFamily:MONO,fontWeight:800,fontSize:12.5,color:C.warn}}>{fmt.money(kpis.f29)}</span>
            </div>
          )}
        </div>
      )}

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
