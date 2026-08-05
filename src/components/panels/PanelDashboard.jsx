import { useState, useMemo } from "react";
import { DiasBadge, Leyenda } from "../ui/Basicos";
import { gananciaReal, costoPostventa } from "../../lib/theme";
import { del } from "../../lib/supabase";
import { C, MONO, SANS, btnP, fmt } from "../../lib/theme";

// Agrupa el contenido bajo un título discreto
function Seccion({titulo,children,sub,ocultarSiVacio}){
  if(ocultarSiVacio) return null;
  return (
  <div style={{marginBottom:18}}>
    <div style={{fontSize:10.5,fontWeight:800,color:C.inkFaint,textTransform:"uppercase",
      letterSpacing:0.6,marginBottom:8,paddingLeft:2}}>{titulo}</div>
    {sub&&<div style={{fontSize:11.5,color:C.inkFaint,marginBottom:8,paddingLeft:2}}>{sub}</div>}
    {children}
  </div>
  );
}

// Tarjeta base para los avisos ligados a Mercado Público: encabezado con
// icono + botón de refresco, y cuerpo blanco para el contenido/lista.
function AvisoMP({icon,color,bg,titulo,descripcion,onActualizar,verificando,children}){
  return (
    <div style={{background:C.card,borderRadius:16,marginBottom:14,overflow:"hidden",
      border:`1px solid ${C.border}`,boxShadow:"0 1px 3px rgba(15,23,42,0.05)"}}>
      <div style={{display:"flex",alignItems:"center",gap:10,padding:"12px 14px",background:bg}}>
        <div style={{width:30,height:30,borderRadius:10,background:color,color:"#fff",flexShrink:0,
          display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:800}}>{icon}</div>
        <div style={{flex:1,minWidth:0,fontSize:13,fontWeight:800,color,lineHeight:1.3}}>{titulo}</div>
        {onActualizar&&(
          <button onClick={onActualizar} disabled={verificando}
            style={{flexShrink:0,width:30,height:30,borderRadius:9,border:"none",
              background:"rgba(255,255,255,0.65)",color,fontSize:13,fontWeight:800,
              cursor:verificando?"default":"pointer",opacity:verificando?0.55:1,
              display:"flex",alignItems:"center",justifyContent:"center"}}>
            {verificando?"⋯":"↻"}
          </button>
        )}
      </div>
      <div style={{padding:"12px 14px"}}>
        {descripcion&&<div style={{fontSize:11.5,color:C.inkMuted,marginBottom:11,lineHeight:1.5}}>{descripcion}</div>}
        {children}
      </div>
    </div>
  );
}

// Fila estándar de un código de OC dentro de un AvisoMP
function FilaAvisoMP({codigo,nombre,accion,onClick,color,ultima}){
  const Tag=onClick?"button":"div";
  return (
    <Tag onClick={onClick} style={{width:"100%",display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,
      padding:"9px 0",background:"none",border:"none",textAlign:"left",cursor:onClick?"pointer":"default",
      borderBottom:ultima?"none":`1px solid ${C.border}`}}>
      <span style={{minWidth:0}}>
        <span style={{fontFamily:MONO,fontSize:12,fontWeight:700,color:C.ink,display:"block"}}>{codigo}</span>
        <span style={{fontSize:10.5,color:C.inkFaint,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",display:"block"}}>{nombre||""}</span>
      </span>
      {accion&&<span style={{flexShrink:0,fontSize:11,fontWeight:700,color}}>{accion} ›</span>}
    </Tag>
  );
}

function VerMasAvisoMP({n}){
  return <div style={{fontSize:10.5,color:C.inkFaint,marginTop:6,textAlign:"center"}}>y {n} más</div>;
}

export function PanelDashboard({ ocs, financiadores, gastos, pagosVendedor, ivaMensual, vendedores, pagoFinSueltos, aportes: aportesLista, onNavigate, onAccion, onSincronizar, onCorregirFechas, sincronizando, porAceptar, onActualizarPorAceptar, verificandoPorAceptar, aceptadasSinCargar, onCargarOC, onCargarTodasAceptadas, cargandoAceptadas, onActualizarAceptadas, verificandoAceptadas, canceladasEnMP, onEliminarCancelada, onActualizarCanceladas, verificandoCanceladas, onValidarTodo, validandoTodo, usoMP, actMP, esCodigoMP, ultimaCartola, saldoBanco, bancoMensual, onEditarSaldo }) {
  const [verMP,setVerMP]=useState(false);

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
    // Antes no restaba gastosVendedores (pagos a vendedores como Matías) —
    // esa plata sí sale de la cuenta real, y no descontarla infla el
    // saldo calculado bien por encima de lo que hay en el banco.
    const saldoCtaCte = cobrado + totalAportes - creditoPagadoTotal - gastosTotal - costoBFK - gastosVendedores;

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
        // Leer año/mes del texto, no de un Date — evita el corrimiento de
        // zona horaria que hacía caer facturas del día 1 en el mes anterior.
        const [ay,am]=String(evF.fecha).slice(0,10).split("-");
        return Number(am)===mesActual&&Number(ay)===anioActual;
      });
      // La comisión es sobre la utilidad del período, no sobre el monto
      // bruto facturado. Las OC "venta propia" se pagan aparte: 100% de
      // su utilidad menos el IVA de su propia factura, no el 50% general.
      let sumaUtilidad=0, pagoVentasPropias=0;
      factsMes.forEach(o=>{
        const utilOC=(Number(o.monto_total)||0)-(Number(o.costo_total)||0);
        if(o.es_venta_propia){
          const montoFact=(o.eventos_factura||[])[0]?.monto||0;
          const ivaFactura=montoFact-(montoFact/1.19);
          pagoVentasPropias+=Math.max(0,Math.round(utilOC-ivaFactura));
        }else{
          sumaUtilidad+=utilOC;
        }
      });
      const ivaMes=ivaMensual.find(i=>i.mes===mesActual&&i.anio===anioActual);
      const impPagado=ivaMes?(ivaMes.iva_ventas-ivaMes.iva_compras):0;
      const calculado=Math.round(sumaUtilidad/2 - impPagado/2)+pagoVentasPropias;
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
    return {saldoReal,saldoEsperado,brecha,corteBanco:corte,movDesdeCorte,gananciaMes,ventaMes,aportes:totalAportes,cobrado,porCobrar,deudaFin,utilidad,saldoProyectado,saldoCtaCte,ingresosPendientes,deudaTotal,gastoContador,gastosVendedores,gastoImpuesto,f29,margenPromPct,deudaVendedoresMes,ocsAbiertas,creditoPagadoTotal,gastosTotal,costoBFK};
  },[ocs,financiadores,gastos,pagosVendedor,ivaMensual,vendedores,pagoFinSueltos,aportesLista,saldoBanco]);

  // ── Proyección del mes: promedio histórico completo, para tener ──
  // algo que mostrar desde el día 1, antes de que existan ventas reales.
  const ocsPorCobrar=useMemo(()=>ocs.filter(o=>(o.tipo_registro||"venta")==="venta"&&o.estado_factura_propia==="emitida"&&o.estado_pago_cliente!=="pagado").map(o=>{
    const evF=(o.eventos_factura||[])[0]; const dias=fmt.diasDesde(evF?.fecha);
    return {...o,fechaFactura:evF?.fecha,diasDesde:dias};
  }),[ocs]);

  const proyeccionMes=useMemo(()=>{
    const historicas=ocs.filter(o=>{
      if((o.tipo_registro||"venta")!=="venta") return false;
      const evC=(o.eventos_compra||[])[0];
      return !!evC;
    });
    if(!historicas.length) return {ventaProm:0,utilProm:0,pct:0,meses:0};
    // Meses distintos con al menos una venta, para promediar por mes real
    // y no solo dividir por una cantidad fija de períodos.
    const clavesMes=new Set(historicas.map(o=>String((o.eventos_compra||[])[0].fecha).slice(0,7)));
    const meses=Math.max(1,clavesMes.size);
    const venta=historicas.reduce((s,o)=>s+(Number(o.monto_total)||0),0);
    const costo=historicas.reduce((s,o)=>s+(Number(o.costo_total)||0),0);
    const ventaProm=Math.round(venta/meses), costoProm=Math.round(costo/meses);
    const utilProm=ventaProm-costoProm;
    const pct=ventaProm>0?Math.round(utilProm/ventaProm*100):0;
    return {ventaProm,utilProm,pct,meses};
  },[ocs]);

  // ── OCs de MP sin datos de cliente (antes se recalculaba en cada render) ──
  const sinDatosMP=useMemo(()=>
    ocs.filter(o=>esCodigoMP&&esCodigoMP(o.numero_oc)&&!o.no_en_mp&&(o.sync_pendiente||!o.rut_cliente||!o.fecha_emision_mp||!o.fecha_hora_emision_mp||String(o.cliente||"").toUpperCase().includes("POR COMPLETAR"))).length
  ,[ocs,esCodigoMP]);

  // ── Resultado del mes cerrado (antes se recalculaba en cada render) ──
  const mesCerrado=useMemo(()=>{
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
    return {cantidad:delMes.length,venta,costo,util,pct,col,nombreMes};
  },[ocs]);

  // ── Prioridades de hoy (reales, derivadas de las OCs) ──
  const prioridades=useMemo(()=>{
    const plazo=(o)=>Number(o.dias_pago)>0?Number(o.dias_pago):30;
    const items=[];

    // Vale vistas o cheques que el cliente ya entregó, pero que todavía
    // no se han cobrado en el banco — esa plata no cuenta como real
    // hasta que alguien vaya físicamente a cobrarlos. Va primero: es
    // plata ya en la mano, solo falta el trámite de cobrarla.
    const valeVistas=[];
    ocs.forEach(o=>{
      (o.eventos_pago_cliente||[]).forEach(ev=>{
        if(ev.medio_pago&&ev.medio_pago!=="transferencia"&&!ev.cobrado_en_banco){
          valeVistas.push({oc:o,ev});
        }
      });
    });
    if(valeVistas.length){
      const porInstitucion={};
      valeVistas.forEach(({ev})=>{
        const inst=ev.institucion||"sin especificar";
        porInstitucion[inst]=(porInstitucion[inst]||0)+1;
      });
      const detalleInst=Object.entries(porInstitucion).map(([inst,n])=>`${n} en ${inst}`).join(" · ");
      items.push({
        label:`${valeVistas.length} vale vista${valeVistas.length>1?"s":""}/cheque${valeVistas.length>1?"s":""} por cobrar`,
        detalle:detalleInst,
        monto:valeVistas.reduce((s,{ev})=>s+(ev.monto||0),0),
        color:C.danger,tab:"compras",filtro:null});
    }

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

    // OCs que llegaron desde Mercado Público (aceptadas y cargadas) pero
    // a las que todavía nadie les registró la compra — quedan "colgadas"
    // si no se les presta atención, porque no aparecen en ningún otro aviso.
    const sinCompraDeMP=ocs.filter(o=>(o.tipo_registro||"venta")==="venta"&&esCodigoMP&&esCodigoMP(o.numero_oc)&&(o.eventos_compra||[]).length===0);
    if(sinCompraDeMP.length) items.push({
      label:`${sinCompraDeMP.length} OC de Mercado Público sin comprar`,
      detalle:"Se cargaron desde MP, pero falta registrar la compra",
      monto:sinCompraDeMP.reduce((s,o)=>s+(o.monto_total||0),0),
      color:C.purple,tab:"compras",filtro:"compra"});

    return items;
  },[ocsPorCobrar,ocs,esCodigoMP]);

  return (
    <div style={{fontFamily:SANS}}>
      <Seccion titulo="Registrar">
      <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:6,marginBottom:6}}>
        {[
          {key:"compra",      icon:"📦", label:"Compra",  color:C.transit, paso:1},
          {key:"entrega",     icon:"🚚", label:"Entrega", color:C.info,    paso:2},
          {key:"factura",     icon:"🧾", label:"Factura", color:C.purple,  paso:3},
          {key:"pago_cliente",icon:"💰", label:"Pago",    color:C.ok,      paso:4},
          {key:"cartola",     icon:"🏦", label:"Banco",   color:C.info,    paso:null},
        ].map(a=>(
          <button key={a.key} onClick={()=>onAccion&&onAccion(a.key)}
            style={{position:"relative",background:C.card,
              border:a.paso===null?`1px dashed ${C.border}`:`1px solid ${C.border}`,
              borderRadius:12,padding:"10px 4px",cursor:"pointer",display:"flex",flexDirection:"column",
              alignItems:"center",gap:4}}>
            {a.paso!==null&&(
              <span style={{position:"absolute",top:4,left:5,width:13,height:13,borderRadius:"50%",
                background:a.color,color:"#fff",fontSize:8.5,fontWeight:800,
                display:"flex",alignItems:"center",justifyContent:"center"}}>{a.paso}</span>
            )}
            <span style={{fontSize:19}}>{a.icon}</span>
            <span style={{fontSize:9.5,fontWeight:700,color:a.color,textAlign:"center",lineHeight:1.2}}>{a.label}</span>
          </button>
        ))}
      </div>
      <div style={{fontSize:10,color:C.inkFaint,textAlign:"center",marginBottom:14}}>
        Pasos ① a ④ de una OC ya creada — "Banco" es aparte, para conciliar la cartola
      </div>
      </Seccion>

      <Seccion titulo="Situación">
      {/* ── Saldo Proyectado: solo lo esencial ── */}
      <div style={{background:`linear-gradient(135deg,${C.night},${C.nightSoft})`,borderRadius:16,padding:"18px 20px",marginBottom:12}}>
        <div style={{fontSize:11.5,color:C.inkFaint,fontWeight:700,marginBottom:6,textTransform:"uppercase",letterSpacing:0.5}}>Saldo Proyectado</div>
        <div style={{fontFamily:MONO,fontWeight:800,fontSize:28,color:kpis.saldoProyectado>=0?C.teal:C.danger,letterSpacing:-1}}>{fmt.money(kpis.saldoProyectado)}</div>
        <div style={{fontSize:11,color:C.inkFaint,marginTop:4}}>Cuánto quedaría si se cobra todo lo pendiente y se paga todo lo que se debe</div>

        <button onClick={()=>onNavigate&&onNavigate("compras",null)}
          style={{marginTop:14,background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.12)",
            borderRadius:9,padding:"7px 12px",color:"#B8C4D9",fontSize:11.5,fontWeight:600,cursor:"pointer",width:"100%"}}>
          {kpis.ocsAbiertas} órdenes en curso ›
        </button>

        <div style={{fontSize:10.5,color:C.inkFaint,marginTop:10,paddingTop:9,borderTop:"1px solid rgba(255,255,255,0.08)",lineHeight:1.6}}>
          <button onClick={onEditarSaldo}
            style={{background:"none",border:"none",color:C.teal,fontSize:10.5,fontWeight:700,cursor:"pointer",padding:"3px 0"}}>
            {kpis.saldoReal!==null?"Actualizar el saldo del banco":"Registrar el saldo del banco para conciliar"}
          </button>
        </div>
      </div>

      </Seccion>

      <Seccion titulo="Requiere atención">
      {/* ── Contador de uso diario de Mercado Público (estimado) ── */}
      {usoMP&&usoMP.solicitudes>0&&(()=>{
        const pct=Math.min(100,Math.round(usoMP.solicitudes/10000*100));
        const color=usoMP.solicitudes>9000?C.danger:usoMP.solicitudes>7000?C.warn:C.inkFaint;
        return (
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10,fontSize:10}}>
            <span style={{color,fontWeight:700,flexShrink:0}}>MP hoy: {usoMP.solicitudes.toLocaleString("es-CL")}/10.000</span>
            <div style={{flex:1,height:4,borderRadius:2,background:C.border,overflow:"hidden"}}>
              <div style={{width:`${pct}%`,height:"100%",background:color,borderRadius:2}} />
            </div>
          </div>
        );
      })()}

      {/* ── Todo lo de Mercado Público bajo un solo desplegable ── */}
      {(()=>{
        const nPorAceptar=(porAceptar||[]).length;
        const nAceptadas=(aceptadasSinCargar||[]).length;
        const nCanceladas=(canceladasEnMP||[]).length;
        const total=nPorAceptar+nAceptadas+nCanceladas;
        const verificandoAlgo=verificandoPorAceptar||verificandoAceptadas||verificandoCanceladas;

        const hace=(iso)=>{
          if(!iso) return null;
          const mins=Math.floor((Date.now()-new Date(iso).getTime())/60000);
          if(mins<1) return "recién";
          if(mins<60) return `hace ${mins} min`;
          const hrs=Math.floor(mins/60);
          if(hrs<24) return `hace ${hrs} h`;
          return `hace ${Math.floor(hrs/24)} d`;
        };
        const ultimasFechas=[actMP?.porAceptar,actMP?.aceptadas,actMP?.canceladas].filter(Boolean);
        const ultimaGeneral=ultimasFechas.length?ultimasFechas.sort().slice(-1)[0]:null;

        if(!total&&!verificandoAlgo) return (
          <button onClick={()=>{
              onActualizarPorAceptar&&onActualizarPorAceptar();
              onActualizarAceptadas&&onActualizarAceptadas();
              onActualizarCanceladas&&onActualizarCanceladas();
            }}
            style={{width:"100%",display:"flex",alignItems:"center",gap:10,textAlign:"left",
              background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:"11px 14px",
              cursor:"pointer",marginBottom:10,boxShadow:"0 1px 2px rgba(15,23,42,0.04)"}}>
            <span style={{width:28,height:28,borderRadius:9,background:C.infoLight,color:C.info,flexShrink:0,
              display:"flex",alignItems:"center",justifyContent:"center",fontSize:13}}>↻</span>
            <span style={{flex:1,minWidth:0}}>
              <span style={{display:"block",fontSize:12,fontWeight:700,color:C.ink}}>Revisar Mercado Público de nuevo</span>
              {ultimaGeneral&&<span style={{display:"block",fontSize:10,color:C.inkFaint,marginTop:1}}>Última consulta exitosa: {hace(ultimaGeneral)}</span>}
            </span>
          </button>
        );
        return (
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:16,marginBottom:14,overflow:"hidden"}}>
            <button onClick={()=>setVerMP(v=>!v)}
              style={{width:"100%",display:"flex",alignItems:"center",gap:8,padding:"13px 14px",
                background:"none",border:"none",cursor:"pointer",textAlign:"left"}}>
              <span style={{flex:1,minWidth:0}}>
                <span style={{display:"block",fontSize:13,fontWeight:800,color:C.ink}}>
                  {verificandoAlgo?"Revisando Mercado Público…":"Mercado Público"}
                </span>
                {!verificandoAlgo&&ultimaGeneral&&<span style={{display:"block",fontSize:10,color:C.inkFaint,marginTop:1}}>Última consulta exitosa: {hace(ultimaGeneral)}</span>}
              </span>
              {nPorAceptar>0&&<span style={{fontSize:11,fontWeight:800,color:C.warn,background:C.warnLight,borderRadius:20,padding:"2px 8px"}}>⏳ {nPorAceptar}</span>}
              {nAceptadas>0&&<span style={{fontSize:11,fontWeight:800,color:C.ok,background:C.okLight,borderRadius:20,padding:"2px 8px"}}>✓ {nAceptadas}</span>}
              {nCanceladas>0&&<span style={{fontSize:11,fontWeight:800,color:C.danger,background:C.dangerLight,borderRadius:20,padding:"2px 8px"}}>✕ {nCanceladas}</span>}
              <span style={{fontSize:11,color:C.inkFaint,flexShrink:0}}>{verMP?"▲":"▼"}</span>
            </button>

            {verMP&&(
              <div style={{padding:"0 14px 14px"}}>
                <button onClick={()=>{
                    onActualizarPorAceptar&&onActualizarPorAceptar();
                    onActualizarAceptadas&&onActualizarAceptadas();
                    onActualizarCanceladas&&onActualizarCanceladas();
                  }}
                  disabled={verificandoAlgo}
                  style={{width:"100%",background:"none",border:`1px dashed ${C.border}`,
                    color:verificandoAlgo?C.inkFaint:C.inkMuted,borderRadius:10,padding:"8px 12px",
                    fontSize:11,fontWeight:700,cursor:verificandoAlgo?"default":"pointer",marginBottom:8}}>
                  {verificandoAlgo?"Revisando…":"↻ Revisar de nuevo"}
                </button>

                {onValidarTodo&&(
                  <button onClick={()=>onValidarTodo()} disabled={!!validandoTodo}
                    style={{display:"block",margin:"0 auto 12px",background:"none",border:"none",
                      color:C.inkFaint,fontSize:10.5,cursor:validandoTodo?"default":"pointer",
                      textDecoration:validandoTodo?"none":"underline"}}>
                    {validandoTodo?`Validando ${validandoTodo.hechas} de ${validandoTodo.total}…`:"Validar todas mis OC contra Mercado Público"}
                  </button>
                )}

                {nPorAceptar>0&&(
                  <AvisoMP icon="⏳" color={C.warn} bg={C.warnLight}
                    titulo={`${nPorAceptar} OC${nPorAceptar>1?"s":""} esperando aceptación`}
                    descripcion="Están enviadas en Mercado Público pero nadie las ha aceptado todavía. Hasta que se acepten no se pueden cargar acá."
                    onActualizar={onActualizarPorAceptar} verificando={verificandoPorAceptar}>
                    {porAceptar.slice(0,5).map((o,i)=>(
                      <FilaAvisoMP key={i} codigo={o.numero_oc} nombre={o.nombre} ultima={i===Math.min(nPorAceptar,5)-1} />
                    ))}
                    {nPorAceptar>5&&<VerMasAvisoMP n={nPorAceptar-5} />}
                  </AvisoMP>
                )}

                {nAceptadas>0&&(
                  <AvisoMP icon="✓" color={C.ok} bg={C.okLight}
                    titulo={`${nAceptadas} OC${nAceptadas>1?"s":""} aceptada${nAceptadas>1?"s":""} en MP sin registrar acá`}
                    descripcion="Ya las aceptaron en Mercado Público, pero todavía no existen como registro en la app. Revísalas una a una, o cárgalas todas de una vez (sin link de compra — lo agregas después en cada una)."
                    onActualizar={onActualizarAceptadas} verificando={verificandoAceptadas}>
                    {cargandoAceptadas?(
                      <div style={{background:C.paper,borderRadius:10,padding:"10px 12px",fontSize:11.5,fontWeight:700,color:C.ok,textAlign:"center",marginBottom:2}}>
                        Cargando {cargandoAceptadas.hechas} de {cargandoAceptadas.total}…
                      </div>
                    ):(
                      <button onClick={()=>onCargarTodasAceptadas&&onCargarTodasAceptadas()}
                        style={{width:"100%",background:C.ok,border:"none",color:"#fff",borderRadius:10,padding:"10px 12px",
                          fontSize:12.5,fontWeight:700,cursor:"pointer",marginBottom:6,boxShadow:`0 2px 8px ${C.ok}40`}}>
                        Cargar las {nAceptadas} de una vez
                      </button>
                    )}
                    {aceptadasSinCargar.slice(0,6).map((o,i)=>(
                      <FilaAvisoMP key={i} codigo={o.numero_oc} nombre={o.nombre} accion="Revisar"
                        onClick={()=>onCargarOC&&onCargarOC(o.numero_oc)} color={C.ok}
                        ultima={i===Math.min(nAceptadas,6)-1} />
                    ))}
                    {nAceptadas>6&&<VerMasAvisoMP n={nAceptadas-6} />}
                  </AvisoMP>
                )}

                {nCanceladas>0&&(
                  <AvisoMP icon="✕" color={C.danger} bg={C.dangerLight}
                    titulo={`${nCanceladas} OC${nCanceladas>1?"s":""} cancelada${nCanceladas>1?"s":""} en Mercado Público`}
                    descripcion="Están cargadas acá, pero en Mercado Público figuran canceladas. Revisa si ya alcanzaste a comprar o gastar algo antes de eliminarlas."
                    onActualizar={onActualizarCanceladas} verificando={verificandoCanceladas}>
                    {canceladasEnMP.map((o,i)=>(
                      <div key={o.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,padding:"9px 0",
                        borderBottom:i<nCanceladas-1?`1px solid ${C.border}`:"none"}}>
                        <span style={{minWidth:0}}>
                          <span style={{fontFamily:MONO,fontSize:12,fontWeight:700,color:C.ink,display:"block"}}>{o.numero_oc}</span>
                          <span style={{fontSize:10.5,color:C.inkFaint,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",display:"block"}}>{o.cliente||o.nombre||""}</span>
                        </span>
                        <button onClick={()=>{
                            if(window.confirm(`¿Eliminar la OC ${o.numero_oc}?\n\nFigura cancelada en Mercado Público. Esta acción no se puede deshacer.`))
                              onEliminarCancelada&&onEliminarCancelada(o.id);
                          }}
                          style={{flexShrink:0,background:C.card,border:`1px solid ${C.danger}55`,color:C.danger,borderRadius:8,
                            padding:"6px 11px",fontSize:11,fontWeight:700,cursor:"pointer"}}>
                          🗑 Eliminar
                        </button>
                      </div>
                    ))}
                  </AvisoMP>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* ── OCs sin datos: ofrecer completarlas desde Mercado Público ── */}
      {(()=>{
        const sinDatos=sinDatosMP;
        if(!sinDatos&&!sincronizando) return null;
        return (
          <div style={{background:C.infoLight,border:`1px solid ${C.info}`,borderRadius:12,padding:"12px 14px",marginBottom:12}}>
            <div style={{fontSize:12.5,fontWeight:700,color:C.info,marginBottom:3}}>
              {sincronizando?`Revisando ${sincronizando.hechas} de ${sincronizando.total}…`:`${sinDatos} OC${sinDatos>1?"s":""} sin datos de cliente`}
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

      {/* ── Forzar que la fecha de TODAS las OC de MP calce con Mercado Público, ──
          no solo las que les falta algo (a diferencia del botón de arriba). ──
          Discreto a propósito: es para validar una vez que las fechas ──
          quedaron bien, no una acción de uso diario — las OC nuevas ya ──
          entran con la fecha correcta desde que se cargan. ── */}
      <button onClick={()=>onCorregirFechas&&onCorregirFechas()} disabled={!!sincronizando}
        style={{display:"block",margin:"0 auto 14px",background:"none",border:"none",
          color:C.inkFaint,fontSize:10.5,cursor:sincronizando?"default":"pointer",
          textDecoration:sincronizando?"none":"underline"}}>
        {sincronizando?`Revisando ${sincronizando.hechas} de ${sincronizando.total}…`:"Corregir fechas de todas contra Mercado Público"}
      </button>

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

      <Seccion titulo="Este mes">
      {/* Utilidad: promedio histórico, mes pasado cerrado, y este mes en curso — un solo gráfico, sin vueltas */}
      {(()=>{
        const barras=[
          {label:"Promedio histórico",v:proyeccionMes.utilProm,pct:proyeccionMes.pct},
          {label:mesCerrado?mesCerrado.nombreMes:"Mes pasado",v:mesCerrado?mesCerrado.util:0,pct:mesCerrado?mesCerrado.pct:0},
          {label:"Este mes",v:kpis.gananciaMes||0,pct:kpis.margenPromPct||0},
        ];
        const max=Math.max(1,...barras.map(b=>Math.abs(b.v)));
        return (
          <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:"16px 16px 14px"}}>
            <div style={{fontSize:11.5,fontWeight:800,color:C.inkMuted,textTransform:"uppercase",letterSpacing:0.4,marginBottom:16}}>Utilidad</div>
            <div style={{display:"flex",alignItems:"flex-end",gap:10,height:110}}>
              {barras.map(b=>(
                <div key={b.label} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"flex-end",height:"100%"}}>
                  <span style={{fontSize:11,fontWeight:800,fontFamily:MONO,color:b.v>=0?C.ink:C.danger,marginBottom:4,textAlign:"center"}}>{fmt.money(b.v)}</span>
                  <div style={{width:"64%",minHeight:4,height:`${Math.max(4,Math.min(100,Math.abs(b.v)/max*100))}%`,
                    background:b.v>=0?C.teal:C.danger,borderRadius:"7px 7px 2px 2px"}} />
                </div>
              ))}
            </div>
            <div style={{display:"flex",gap:10,marginTop:8}}>
              {barras.map(b=>(
                <div key={b.label} style={{flex:1,textAlign:"center"}}>
                  <div style={{fontSize:9.5,color:C.inkFaint,lineHeight:1.3}}>{b.label}</div>
                  {b.pct>0&&<div style={{fontSize:9.5,fontWeight:700,color:C.inkMuted}}>{b.pct}%</div>}
                </div>
              ))}
            </div>
          </div>
        );
      })()}

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
