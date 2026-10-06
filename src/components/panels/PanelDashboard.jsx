import { useState, useMemo } from "react";
import { DiasBadge } from "../ui/Basicos";
import { del } from "../../lib/supabase";
import { calcularPagoVendedor, costoPostventa, estadoVencimiento, facturaVigente, gananciaReal, plazoPago } from "../../lib/calculos";
import { C, MONO, SANS, btnP, fmt } from "../../lib/theme";
import { Ic } from "../ui/Iconos";
import { coincideBusqueda } from "../../lib/busqueda";
import { calcularF29 } from "../../lib/f29";
import { Seccion, Tarjeta, Badge, Monto, Enlace } from "../ui/Sistema";
import { FILTROS_PANEL, etapasCompletadas, filtrarPanel, financiamientoPagado, valeVistasPendientes } from "../../lib/ocs";

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
        {descripcion&&<div style={{fontSize:12,color:C.inkMuted,marginBottom:11,lineHeight:1.5}}>{descripcion}</div>}
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
        <span style={{fontSize:12,color:C.inkFaint,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",display:"block"}}>{nombre||""}</span>
      </span>
      {accion&&<span style={{flexShrink:0,fontSize:12,fontWeight:700,color}}>{accion} ›</span>}
    </Tag>
  );
}

function VerMasAvisoMP({n}){
  return <div style={{fontSize:12,color:C.inkFaint,marginTop:6,textAlign:"center"}}>y {n} más</div>;
}

export function PanelDashboard({ ocs, financiadores, gastos, pagosVendedor, ivaMensual, vendedores, pagoFinSueltos, aportes: aportesLista, perfil, onExportarTodo, exportando, onNavigate, onAccion, onSincronizar, onCorregirFechas, sincronizando, porAceptar, onActualizarPorAceptar, verificandoPorAceptar, aceptadasSinCargar, onCargarOC, onCargarTodasAceptadas, cargandoAceptadas, onActualizarAceptadas, verificandoAceptadas, canceladasEnMP, onArchivarCancelada, onActualizarCanceladas, verificandoCanceladas, onValidarTodo, validandoTodo, usoMP, actMP, esCodigoMP, ultimaCartola, saldoBanco, bancoMensual, onEditarSaldo, onBuscarCompras }) {
  const [busq,setBusq]=useState("");
  const esAdmin=perfil?.rol==="admin";
  const [verMP,setVerMP]=useState(false);
  // Carga masiva de OCs aceptadas (Fase 4A): el vendedor es obligatorio y se puede indicar venta propia.
  const [masiva,setMasiva]=useState(null); // null | {vendedorId, ventaPropia}

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
      if(!financiamientoPagado(oc)) creditoPendienteTotal+=oc.costo_total||0;   // "no aplica" (venta propia / fondos propios) no es crédito pendiente
      creditoPagadoTotal+=(oc.eventos_pago_financiamiento||[]).reduce((s,e)=>s+(e.monto||0),0);
      const finNombre=oc.financiadores?.nombre||"";
      // Fondos propios (regla 2): por tipo de financiador, ya no por el nombre.
      if((financiadores||[]).some(f=>f.id===oc.financiador_id&&f.tipo==="propio")||(!financiadores?.some(f=>f.tipo)&&(finNombre.toLowerCase().includes("bfk")))) costoBFK+=oc.costo_total||0;
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
      // Lo que falta por cobrar (un cobro parcial ya está en "cobrado": no se cuenta dos veces).
      if(oc.estado_pago_cliente!=="pagado") ingresosPendientes+=Math.max(0,(Number(oc.monto_total)||0)-(Number(oc.monto_cobrado)||0));
    }

    const deudaFin=financiadores.reduce((s,f)=>s+(Number(f.saldo_deuda)||0),0);
    // Misma regla que el panel Vendedores (lib/calculos.js).
    const deudaVendedoresMes=vendedores?.reduce((sv,v)=>
      sv+(calcularPagoVendedor({vendedorId:v.id,ocs,anio:anioActual,mes:mesActual,ivaMensual,pagosVendedor})?.deuda||0),0)||0;
    // F29 por período (reglas y fecha de corte F29_DESDE en lib/f29.js)
    const f29Calc=calcularF29({ivaMensual,gastos,anioActual,mesActual});
    const f29Periodos=f29Calc.mostrados;
    const f29Anterior=f29Calc.anterior; // pendiente de períodos más antiguos (desde F29_DESDE)
    const f29=f29Calc.total;            // deuda total F29 (todos los períodos desde F29_DESDE)
    const f29Visible=f29Calc.visible;
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

    const ocsAbiertas=ocs.filter(o=>esVenta(o)&&etapasCompletadas(o)<5).length;

    const utilidad=ingresos-costos;
    return {saldoReal,saldoEsperado,brecha,corteBanco:corte,movDesdeCorte,gananciaMes,ventaMes,aportes:totalAportes,cobrado,porCobrar,deudaFin,utilidad,saldoProyectado,saldoCtaCte,ingresosPendientes,deudaTotal,gastoContador,gastosVendedores,gastoImpuesto,f29,f29Periodos,f29Anterior,f29Visible,margenPromPct,deudaVendedoresMes,ocsAbiertas,creditoPagadoTotal,gastosTotal,costoBFK};
  },[ocs,financiadores,gastos,pagosVendedor,ivaMensual,vendedores,pagoFinSueltos,aportesLista,saldoBanco]);

  // ── Proyección del mes: promedio histórico completo, para tener ──
  // algo que mostrar desde el día 1, antes de que existan ventas reales.
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
  // Fase 4A: cada contador usa el MISMO criterio que la lista que abre (lib/ocs.js, FILTROS_PANEL),
  // así "N facturas por vencer" abre exactamente esas N OCs, sin filtros aproximados.
  const prioridades=useMemo(()=>{
    const items=[];
    const saldoFact=(o)=>(o.monto_facturado||0)-(o.monto_cobrado||0);

    // Vale vistas o cheques que el cliente ya entregó, pero que todavía
    // no se han cobrado en el banco — esa plata no cuenta como real
    // hasta que alguien vaya físicamente a cobrarlos. Va primero: es
    // plata ya en la mano, solo falta el trámite de cobrarla.
    const ocsVale=filtrarPanel(ocs,"vale_vista");
    const valeVistas=ocsVale.flatMap(o=>valeVistasPendientes(o));
    if(valeVistas.length){
      const porInstitucion={};
      valeVistas.forEach(ev=>{
        const inst=ev.institucion||"sin especificar";
        porInstitucion[inst]=(porInstitucion[inst]||0)+1;
      });
      const detalleInst=Object.entries(porInstitucion).map(([inst,n])=>`${n} en ${inst}`).join(" · ");
      items.push({
        label:`${valeVistas.length} vale vista${valeVistas.length>1?"s":""}/cheque${valeVistas.length>1?"s":""} por cobrar`,
        detalle:`${detalleInst}${ocsVale.length!==valeVistas.length?` · en ${ocsVale.length} OC`:""}`,
        monto:valeVistas.reduce((s,ev)=>s+(ev.monto||0),0),
        color:C.dangerText,tab:"compras",filtro:"vale_vista",n:ocsVale.length});
    }

    const vencidas=filtrarPanel(ocs,"vencidas");
    if(vencidas.length) items.push({
      label:`${vencidas.length} factura${vencidas.length>1?"s":""} vencida${vencidas.length>1?"s":""}`,
      detalle:"Ya se pasó el plazo de pago",
      monto:vencidas.reduce((s,o)=>s+saldoFact(o),0),
      color:C.dangerText,tab:"compras",filtro:"vencidas",n:vencidas.length});

    const porVencer=filtrarPanel(ocs,"por_vencer");
    if(porVencer.length) items.push({
      label:`${porVencer.length} factura${porVencer.length>1?"s":""} por vencer`,
      detalle:"Vencen dentro de 5 días",
      monto:porVencer.reduce((s,o)=>s+saldoFact(o),0),
      color:C.warnText,tab:"compras",filtro:"por_vencer",n:porVencer.length});

    const sinFacturar=filtrarPanel(ocs,"entregadas_sin_factura");
    if(sinFacturar.length) items.push({
      label:`${sinFacturar.length} entregada${sinFacturar.length>1?"s":""} sin facturar`,
      detalle:"Ya se entregó, falta emitir la factura",
      monto:sinFacturar.reduce((s,o)=>s+(o.monto_total||0),0),
      color:C.info,tab:"compras",filtro:"entregadas_sin_factura",n:sinFacturar.length});

    const sinEntregar=filtrarPanel(ocs,"compradas_sin_entregar");
    if(sinEntregar.length) items.push({
      label:`${sinEntregar.length} compra${sinEntregar.length>1?"s":""} sin entregar`,
      detalle:"Comprado, pendiente de entregar",
      monto:sinEntregar.reduce((s,o)=>s+(o.monto_total||0),0),
      color:C.transit,tab:"compras",filtro:"compradas_sin_entregar",n:sinEntregar.length});

    // OCs que llegaron desde Mercado Público (aceptadas y cargadas) pero
    // a las que todavía nadie les registró la compra — quedan "colgadas"
    // si no se les presta atención, porque no aparecen en ningún otro aviso.
    const sinCompraDeMP=filtrarPanel(ocs,"mp_sin_comprar");
    if(sinCompraDeMP.length) items.push({
      label:`${sinCompraDeMP.length} OC de Mercado Público sin comprar`,
      detalle:"Se cargaron desde MP, pero falta registrar la compra",
      monto:sinCompraDeMP.reduce((s,o)=>s+(o.monto_total||0),0),
      color:C.purple,tab:"compras",filtro:"mp_sin_comprar",n:sinCompraDeMP.length});

    // OCs sin vendedor: no entran en ninguna comisión (Fase 4A). Informativo: puede ser a propósito.
    const sinVendedor=filtrarPanel(ocs,"sin_vendedor");
    if(sinVendedor.length){
      const abiertas=sinVendedor.filter(o=>!(o.estado_pago_cliente==="pagado"&&o.estado_pago_financiamiento==="pagado")).length;
      items.push({
        label:`${sinVendedor.length} OC sin vendedor`,
        detalle:`No entran en ninguna comisión${abiertas?` · ${abiertas} abierta${abiertas>1?"s":""}`:""}`,
        monto:sinVendedor.reduce((s,o)=>s+(o.monto_total||0),0),
        color:C.inkMuted,tab:"compras",filtro:"sin_vendedor",n:sinVendedor.length});
    }

    return items;
  },[ocs]);

  return (
    <div style={{fontFamily:SANS}}>
      <div style={{marginBottom:14}}>
        <input type="search" value={busq} onChange={e=>setBusq(e.target.value)} placeholder="🔍 Buscar OC, cliente, factura o monto"
          onKeyDown={e=>{if(e.key==="Enter"&&busq.trim()&&onBuscarCompras)onBuscarCompras(busq.trim());}}
          style={{width:"100%",boxSizing:"border-box",minHeight:46,padding:"10px 14px",fontSize:16,fontFamily:SANS,border:`1px solid ${C.border}`,borderRadius:12,background:C.surface||"#fff",color:C.ink}} />
        {busq.trim().length>=2&&(()=>{
          const r=(ocs||[]).filter(o=>coincideBusqueda(o,busq));
          return (<Tarjeta padding="4px" style={{marginTop:6}}>
            {r.length===0&&<div style={{padding:"12px",fontSize:13,color:C.inkMuted}}>Sin resultados</div>}
            {r.slice(0,5).map(o=>(
              <button key={o.id} onClick={()=>onNavigate&&onNavigate("compras",null,o.id)}
                style={{width:"100%",display:"block",minHeight:48,padding:"8px 10px",background:"none",border:"none",borderBottom:`1px solid ${C.border}`,textAlign:"left",cursor:"pointer",fontFamily:SANS}}>
                <span style={{fontSize:14,fontWeight:700,color:C.ink,display:"block"}}>{o.numero_oc}</span>
                <span style={{fontSize:12,color:C.inkMuted}}>{o.cliente||o.entidad||""}</span>
              </button>))}
            {r.length>0&&onBuscarCompras&&<button onClick={()=>onBuscarCompras(busq.trim())} style={{width:"100%",minHeight:44,background:"none",border:"none",color:C.accent||C.ink,fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:SANS}}>Ver {r.length>5?`los ${r.length} resultados`:"en Compras"} →</button>}
          </Tarjeta>);
        })()}
      </div>
      <Seccion titulo="Prioridades de hoy" nota={prioridades.length>0?"Toca una para ver esas órdenes":undefined} margen={18}>
      {/* ── Prioridades de hoy: tareas accionables ── */}
      <Tarjeta padding="4px 4px 4px 4px">
        {prioridades.length===0&&<div style={{fontSize:14,color:C.okText,fontWeight:700,padding:"14px 12px"}}>✓ Sin pendientes urgentes</div>}
        {prioridades.map((p,i)=>(
          <button key={i} data-prioridad={p.filtro} data-n={p.n} onClick={()=>onNavigate&&onNavigate(p.tab,p.filtro)}
            style={{width:"100%",display:"flex",alignItems:"center",gap:10,minHeight:60,
              padding:"8px 10px",background:"none",border:"none",cursor:"pointer",textAlign:"left",
              borderBottom:i<prioridades.length-1?`1px solid ${C.border}`:"none"}}>
            <span style={{width:4,alignSelf:"stretch",borderRadius:4,background:p.color,flexShrink:0,margin:"4px 0"}} />
            <span style={{minWidth:0,flex:1}}>
              <span style={{fontSize:14,color:C.ink,fontWeight:700,display:"block",lineHeight:1.3}}>{p.label}</span>
              {p.detalle&&<span style={{fontSize:12,color:C.inkMuted,display:"block",marginTop:2,lineHeight:1.35}}>{p.detalle}</span>}
            </span>
            <span style={{display:"flex",alignItems:"center",gap:4,flexShrink:0}}>
              <Monto tam="sm" style={{color:p.color}}>{fmt.money(p.monto)}</Monto>
              <Ic n="chevR"/>
            </span>
          </button>
        ))}
      </Tarjeta>
      </Seccion>

      <Seccion titulo="Registrar" nota="Pasos 1 a 4 de una OC ya creada. Cartola es aparte: concilia los movimientos del banco." margen={18}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:6}}>
        {[
          {key:"compra",      icon:<Ic n="📦"/>, label:"Compra",  color:C.transit, paso:1},
          {key:"entrega",     icon:<Ic n="🚚"/>, label:"Entrega", color:C.info,    paso:2},
          {key:"factura",     icon:<Ic n="🧾"/>, label:"Factura", color:C.purple,  paso:3},
          {key:"pago_cliente",icon:<Ic n="💰"/>, label:"Pago",    color:C.okText,      paso:4},
          {key:"cartola",     icon:<Ic n="🏦"/>, label:"Cartola", color:C.info,    paso:null},
        ].map(a=>(
          <button key={a.key} onClick={()=>onAccion&&onAccion(a.key)}
            style={{position:"relative",background:C.card,
              border:a.paso===null?`1px dashed ${C.border}`:`1px solid ${C.border}`,
              borderRadius:12,padding:"10px 4px",cursor:"pointer",display:"flex",flexDirection:"column",
              alignItems:"center",gap:4}}>
            {a.paso!==null&&(
              <span style={{position:"absolute",top:4,left:5,width:13,height:13,borderRadius:"50%",
                background:a.color,color:"#fff",fontSize:12,fontWeight:800,
                display:"flex",alignItems:"center",justifyContent:"center"}}>{a.paso}</span>
            )}
            <span style={{fontSize:19}}>{a.icon}</span>
            <span style={{fontSize:12,fontWeight:700,color:a.color,textAlign:"center",lineHeight:1.2}}>{a.label}</span>
          </button>
        ))}
      </div>
      </Seccion>

      <Seccion titulo="Caja">
      {/* ── Saldo Proyectado: solo lo esencial ── */}
      <div style={{background:`linear-gradient(135deg,${C.night},${C.nightSoft})`,borderRadius:16,padding:"16px 18px",marginBottom:8,border:"1px solid rgba(45,212,191,0.25)"}}>
        <div style={{fontSize:13,color:"#E2E8F0",fontWeight:800,marginBottom:4,textTransform:"uppercase",letterSpacing:0.6}}>Saldo proyectado</div>
        <div style={{fontFamily:MONO,fontWeight:800,fontSize:34,color:kpis.saldoProyectado>=0?"#2DD4BF":"#F87171",letterSpacing:-1,lineHeight:1.1}}>{fmt.money(kpis.saldoProyectado)}</div>
        <div style={{fontSize:12,color:"#CBD5E1",marginTop:6,lineHeight:1.45}}>Cuánto quedaría si se cobra todo lo pendiente y se paga todo lo que se debe</div>
        <div style={{display:"flex",flexDirection:"column",gap:6,marginTop:12,paddingTop:12,borderTop:"1px solid rgba(255,255,255,0.14)"}}>
          <button onClick={onEditarSaldo}
            style={{minHeight:44,background:"rgba(45,212,191,0.14)",border:"1px solid rgba(45,212,191,0.45)",
              borderRadius:10,padding:"8px 12px",color:"#5EEAD4",fontSize:14,fontWeight:700,cursor:"pointer",textAlign:"left",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span>{kpis.saldoReal!==null?"Actualizar saldo de la cuenta":"Registrar saldo de la cuenta"}</span><Ic n="chevR"/>
          </button>
        </div>
      </div>

      </Seccion>

      <Seccion titulo="Compromisos" ocultarSiVacio={!(kpis.deudaFin>0||kpis.deudaVendedoresMes>0||kpis.f29Visible)}>
      {/* Deuda a terceros — el detalle vive en Vendedores y Financiamiento */}
      {(kpis.deudaFin>0||kpis.deudaVendedoresMes>0||kpis.f29Visible)&&(
        <Tarjeta padding="4px 14px">
          {kpis.deudaFin>0&&(
            <button onClick={()=>onNavigate&&onNavigate("financiamiento",null)}
              style={{width:"100%",background:"none",border:"none",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",minHeight:52,textAlign:"left"}}>
              <span style={{fontSize:14,color:C.ink,fontWeight:600}}>Deuda con financiadores</span>
              <span style={{display:"flex",alignItems:"center",gap:4}}>
                <Monto tam="sm" tono="danger">{fmt.money(kpis.deudaFin)}</Monto>
                <Ic n="chevR"/>
              </span>
            </button>
          )}
          {kpis.deudaVendedoresMes>0&&(
            <button onClick={()=>onNavigate&&onNavigate("vendedores",null)}
              style={{width:"100%",background:"none",border:"none",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",minHeight:52,textAlign:"left",borderTop:kpis.deudaFin>0?`1px solid ${C.border}`:"none"}}>
              <span style={{fontSize:14,color:C.ink,fontWeight:600}}>Comisiones a vendedores</span>
              <span style={{display:"flex",alignItems:"center",gap:4}}>
                <Monto tam="sm" tono="warn">{fmt.money(kpis.deudaVendedoresMes)}</Monto>
                <Ic n="chevR"/>
              </span>
            </button>
          )}
          {kpis.f29Periodos.map((x,i)=>(
            <div key={x.anio+"-"+x.mes} style={{padding:"10px 0",borderTop:(kpis.deudaFin>0||kpis.deudaVendedoresMes>0||i>0)?`1px solid ${C.border}`:"none"}}>
              <div style={{fontSize:14,color:C.ink,fontWeight:600,marginBottom:4}}>Impuesto F29 · {fmt.monthYear(x.mes,x.anio)}</div>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:13,color:C.inkMuted,minHeight:24,alignItems:"center"}}><span>IVA determinado</span><Monto tam="sm">{fmt.money(x.det)}</Monto></div>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:13,color:C.inkMuted,minHeight:24,alignItems:"center"}}><span>Pagado (gastos Impuesto SII)</span><Monto tam="sm">{fmt.money(x.pag)}</Monto></div>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:13,color:C.ink,fontWeight:700,minHeight:24,alignItems:"center"}}><span>Pendiente de pago</span><Monto tam="sm" tono={x.pend>0?"warn":undefined}>{fmt.money(x.pend)}</Monto></div>
              {x.det===0&&x.pag>0&&<div style={{fontSize:12,color:C.warnText,marginTop:2}}>Hay un pago registrado, pero el IVA de este período aún no está cargado en Vendedores.</div>}
            </div>
          ))}
          {kpis.f29Anterior>0&&(
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",minHeight:44,borderTop:(kpis.deudaFin>0||kpis.deudaVendedoresMes>0||kpis.f29Periodos.length>0)?`1px solid ${C.border}`:"none"}}>
              <span style={{fontSize:13,color:C.warnText,fontWeight:700}}><Ic n="⚠"/> Deuda F29 de períodos anteriores</span>
              <Monto tam="sm" tono="warn">{fmt.money(kpis.f29Anterior)}</Monto>
            </div>
          )}
        </Tarjeta>
      )}

      </Seccion>

      <Seccion titulo="Nuevas OC y Mercado Público">
      {/* ── Contador de uso diario de Mercado Público (estimado) ── */}
      {usoMP&&usoMP.solicitudes>0&&(()=>{
        const pct=Math.min(100,Math.round(usoMP.solicitudes/10000*100));
        const color=usoMP.solicitudes>9000?C.danger:usoMP.solicitudes>7000?C.warn:C.inkFaint;
        return (
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10,fontSize:12}}>
            <span style={{color,fontWeight:700,flexShrink:0}}>MP hoy: {usoMP.solicitudes.toLocaleString("es-CL")}/10.000</span>
            <div style={{flex:1,height:4,borderRadius:2,background:C.border,overflow:"hidden"}}>
              <div style={{width:`${pct}%`,height:"100%",background:color,borderRadius:2}} />
            </div>
          </div>
        );
      })()}

      {/* ── OCs sin datos: ofrecer completarlas desde Mercado Público ── */}
      {(()=>{
        const sinDatos=sinDatosMP;
        if(!sinDatos&&!sincronizando) return null;
        return (
          <Tarjeta>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginBottom:6}}>
              <span style={{fontSize:14,fontWeight:700,color:C.ink}}>
                {sincronizando?`Revisando ${sincronizando.hechas} de ${sincronizando.total}…`:`${sinDatos} OC${sinDatos>1?"s":""} sin datos de cliente`}
              </span>
              {!sincronizando&&<Badge tono="info">Mercado Público</Badge>}
            </div>
            <div style={{fontSize:12,color:C.inkMuted,marginBottom:sincronizando?0:10,lineHeight:1.45}}>
              Mercado Público tiene el cliente, RUT, comuna, contacto, fecha de emisión y productos de estas órdenes. Solo se consultan las que tienen código de Mercado Público; las ventas directas quedan fuera.
            </div>
            {!sincronizando&&(
              <button onClick={onSincronizar}
                style={{width:"100%",minHeight:44,background:C.teal,border:"none",color:"#fff",borderRadius:10,padding:"10px 12px",fontSize:14,fontWeight:700,cursor:"pointer"}}>
                Completar desde Mercado Público
              </button>
            )}
          </Tarjeta>
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
              {ultimaGeneral&&<span style={{display:"block",fontSize:12,color:C.inkFaint,marginTop:1}}>Última consulta exitosa: {hace(ultimaGeneral)}</span>}
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
                {!verificandoAlgo&&ultimaGeneral&&<span style={{display:"block",fontSize:12,color:C.inkFaint,marginTop:1}}>Última consulta exitosa: {hace(ultimaGeneral)}</span>}
              </span>
              {nPorAceptar>0&&<span style={{fontSize:12,fontWeight:800,color:C.warnText,background:C.warnLight,borderRadius:20,padding:"2px 8px"}}><Ic n="⏳"/> {nPorAceptar}</span>}
              {nAceptadas>0&&<span style={{fontSize:12,fontWeight:800,color:C.okText,background:C.okLight,borderRadius:20,padding:"2px 8px"}}>✓ {nAceptadas}</span>}
              {nCanceladas>0&&<span style={{fontSize:12,fontWeight:800,color:C.dangerText,background:C.dangerLight,borderRadius:20,padding:"2px 8px"}}>✕ {nCanceladas}</span>}
              <span style={{fontSize:12,color:C.inkFaint,flexShrink:0}}>{verMP?"▲":"▼"}</span>
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
                    fontSize:12,fontWeight:700,cursor:verificandoAlgo?"default":"pointer",marginBottom:8}}>
                  {verificandoAlgo?"Revisando…":"↻ Revisar de nuevo"}
                </button>

                {nPorAceptar>0&&(
                  <AvisoMP icon={<Ic n="⏳"/>} color={C.warn} bg={C.warnLight}
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
                    descripcion="Ya las aceptaron en Mercado Público, pero todavía no existen como registro en la app. Revísalas una a una, o cárgalas todas de una vez indicando el vendedor (sin link de compra — lo agregas después en cada una). Las que figuren canceladas en MP no se cargan."
                    onActualizar={onActualizarAceptadas} verificando={verificandoAceptadas}>
                    {cargandoAceptadas?(
                      <div style={{background:C.paper,borderRadius:10,padding:"10px 12px",fontSize:12,fontWeight:700,color:C.okText,textAlign:"center",marginBottom:2}}>
                        Cargando {cargandoAceptadas.hechas} de {cargandoAceptadas.total}…
                      </div>
                    ):masiva?(
                      <div data-carga-masiva style={{background:C.paper,borderRadius:10,padding:"10px 12px",marginBottom:6}}>
                        <label style={{display:"block",fontSize:12,fontWeight:800,color:C.inkMuted,textTransform:"uppercase",letterSpacing:0.3,marginBottom:4}} htmlFor="masiva-vendedor">Vendedor de estas {nAceptadas} OC *</label>
                        <select id="masiva-vendedor" value={masiva.vendedorId} onChange={e=>setMasiva(m=>({...m,vendedorId:e.target.value,ventaPropia:e.target.value?m.ventaPropia:false}))}
                          style={{width:"100%",boxSizing:"border-box",minHeight:40,padding:"8px 10px",borderRadius:8,border:`1px solid ${C.border}`,fontSize:13,fontFamily:SANS,background:C.card,color:C.ink,marginBottom:8}}>
                          <option value="">Elige el vendedor…</option>
                          {(vendedores||[]).map(v=><option key={v.id} value={v.id}>{v.nombre}</option>)}
                        </select>
                        {masiva.vendedorId&&(
                          <label style={{display:"flex",alignItems:"flex-start",gap:8,cursor:"pointer",marginBottom:8}}>
                            <input type="checkbox" checked={masiva.ventaPropia} onChange={e=>setMasiva(m=>({...m,ventaPropia:e.target.checked}))} style={{marginTop:2}} />
                            <span style={{fontSize:12,color:C.ink,fontWeight:600}}>Son ventas propias del vendedor (100% de la utilidad, menos el IVA de su factura)</span>
                          </label>
                        )}
                        <div style={{display:"flex",gap:6}}>
                          <button disabled={!masiva.vendedorId} onClick={()=>{ const m=masiva; setMasiva(null); onCargarTodasAceptadas&&onCargarTodasAceptadas({vendedorId:m.vendedorId,ventaPropia:!!(m.vendedorId&&m.ventaPropia)}); }}
                            style={{flex:2,background:masiva.vendedorId?C.ok:C.inkFaint,border:"none",color:"#fff",borderRadius:10,padding:"10px 12px",fontSize:12.5,fontWeight:700,cursor:masiva.vendedorId?"pointer":"not-allowed"}}>
                            Cargar las {nAceptadas} con este vendedor
                          </button>
                          <button onClick={()=>setMasiva(null)} style={{flex:1,background:"none",border:`1px solid ${C.border}`,color:C.inkMuted,borderRadius:10,padding:"10px 12px",fontSize:12.5,fontWeight:700,cursor:"pointer"}}>Cancelar</button>
                        </div>
                      </div>
                    ):(
                      <button onClick={()=>setMasiva({vendedorId:"",ventaPropia:false})}
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
                    descripcion="Están cargadas acá, pero en Mercado Público figuran canceladas. Revisa si ya alcanzaste a comprar o gastar algo antes de archivarlas."
                    onActualizar={onActualizarCanceladas} verificando={verificandoCanceladas}>
                    {canceladasEnMP.map((o,i)=>(
                      <div key={o.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,padding:"9px 0",
                        borderBottom:i<nCanceladas-1?`1px solid ${C.border}`:"none"}}>
                        <span style={{minWidth:0}}>
                          <span style={{fontFamily:MONO,fontSize:12,fontWeight:700,color:C.ink,display:"block"}}>{o.numero_oc}</span>
                          <span style={{fontSize:12,color:C.inkFaint,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",display:"block"}}>{o.cliente||o.nombre||""}</span>
                        </span>
                        {esAdmin&&(
                        <button onClick={()=>{
                            if(window.confirm(`¿Archivar la OC ${o.numero_oc}?\n\nFigura cancelada en Mercado Público. Se ocultará de la operación normal sin borrar ningún dato y podrá restaurarse desde Administración.`))
                              onArchivarCancelada&&onArchivarCancelada(o.id);
                          }}
                          style={{flexShrink:0,background:C.card,border:`1px solid ${C.warn}`,color:C.warnText,borderRadius:8,
                            padding:"6px 11px",fontSize:12,fontWeight:700,cursor:"pointer"}}>
                          <Ic n="🗄"/> Archivar
                        </button>
                        )}
                      </div>
                    ))}
                  </AvisoMP>
                )}
              </div>
            )}
          </div>
        );
      })()}

      </Seccion>

      <Seccion titulo="Utilidad del mes">
      {/* Utilidad: promedio histórico, mes pasado cerrado, y este mes en curso — un solo gráfico, sin vueltas */}
      {(()=>{
        const barras=[
          {label:"Promedio histórico",v:proyeccionMes.utilProm,pct:proyeccionMes.pct},
          {label:mesCerrado?mesCerrado.nombreMes:"Mes pasado",v:mesCerrado?mesCerrado.util:0,pct:mesCerrado?mesCerrado.pct:0},
          {label:"Este mes",v:kpis.gananciaMes||0,pct:kpis.margenPromPct||0},
        ];
        const max=Math.max(1,...barras.map(b=>Math.abs(b.v)));
        return (
          <Tarjeta padding="16px 16px 14px">
            <div style={{display:"flex",alignItems:"flex-end",gap:10,height:110}}>
              {barras.map(b=>(
                <div key={b.label} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"flex-end",height:"100%"}}>
                  <span style={{fontSize:12,fontWeight:800,fontFamily:MONO,color:b.v>=0?C.ink:C.danger,marginBottom:4,textAlign:"center"}}>{fmt.money(b.v)}</span>
                  <div style={{width:"64%",minHeight:4,height:`${Math.max(4,Math.min(100,Math.abs(b.v)/max*100))}%`,
                    background:b.v>=0?C.teal:C.danger,borderRadius:"7px 7px 2px 2px"}} />
                </div>
              ))}
            </div>
            <div style={{display:"flex",gap:10,marginTop:8}}>
              {barras.map(b=>(
                <div key={b.label} style={{flex:1,textAlign:"center"}}>
                  <div style={{fontSize:12,color:C.inkFaint,lineHeight:1.3}}>{b.label}</div>
                  {b.pct>0&&<div style={{fontSize:12,fontWeight:700,color:C.inkMuted}}>{b.pct}%</div>}
                </div>
              ))}
            </div>
          </Tarjeta>
        );
      })()}

      </Seccion>

    </div>
  );
}
