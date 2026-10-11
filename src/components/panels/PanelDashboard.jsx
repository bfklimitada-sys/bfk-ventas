import { useState, useMemo } from "react";
import { del } from "../../lib/supabase";
import { C, MONO, SANS, fmt } from "../../lib/theme";
import { Ic } from "../ui/Iconos";
import { coincideBusqueda } from "../../lib/busqueda";
import { resumenCaja } from "../../lib/caja";
import { Seccion, Tarjeta, Badge, Monto, Desplegable, Indicador, Indicadores, AvisoLinea, Ayuda, Enlace } from "../ui/Sistema";
import { useEsEscritorio } from "../ui/Navegacion";
import { registrosConAlerta } from "../../lib/registroCartola";

const MAX_PRIOR=5; // prioridades visibles de entrada; el resto con «Ver más»
import { FILTROS_PANEL, estaCerrada, filtrarPanel, valeVistasPendientes } from "../../lib/ocs";

// Tarjeta base para los avisos ligados a Mercado Público: encabezado con
// icono + botón de refresco, y cuerpo blanco para el contenido/lista.
function AvisoMP({icon,color,bg,titulo,descripcion,onActualizar,verificando,children}){
  return (
    <div style={{background:C.card,borderRadius:16,marginBottom:14,overflow:"hidden",
      border:`1px solid ${C.border}`,boxShadow:"0 1px 3px rgba(15,23,42,0.05)"}}>
      <div style={{display:"flex",alignItems:"center",gap:10,padding:"12px 14px",background:bg}}>
        <div style={{width:30,height:30,borderRadius:12,background:color,color:"#fff",flexShrink:0,
          display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:800}}>{icon}</div>
        <div style={{flex:1,minWidth:0,fontSize:13,fontWeight:800,color,lineHeight:1.3}}>{titulo}</div>
        {onActualizar&&(
          <button onClick={onActualizar} disabled={verificando}
            style={{flexShrink:0,width:30,height:30,borderRadius:8,border:"none",
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

export function PanelDashboard({ ocs, financiadores, gastos, pagosVendedor, ivaMensual, vendedores, pagoFinSueltos, aportes: aportesLista, ajustes = [], categorias = [], perfil, onExportarTodo, exportando, onNavigate, onAccion, onSincronizar, onCorregirFechas, sincronizando, porAceptar, onActualizarPorAceptar, verificandoPorAceptar, aceptadasSinCargar, onCargarOC, onCargarTodasAceptadas, cargandoAceptadas, onActualizarAceptadas, verificandoAceptadas, canceladasEnMP, onArchivarCancelada, onActualizarCanceladas, verificandoCanceladas, onValidarTodo, validandoTodo, usoMP, actMP, esCodigoMP, ultimaCartola, saldoBanco, bancoMensual, onEditarSaldo, onBuscarCompras , onQuitarAlertaCartola }) {
  const [busq,setBusq]=useState("");
  const esAdmin=perfil?.rol==="admin";
  const [verTodasPrior,setVerTodasPrior]=useState(false);
  const escritorio=useEsEscritorio();
  const nAvisosMP=(porAceptar||[]).length+(aceptadasSinCargar||[]).length+(canceladasEnMP||[]).length;
  const nAlertasCartola=registrosConAlerta({ocs,gastos,pagosVendedor,pagoFinSueltos,aportes:aportesLista}).length;
  // Carga masiva de OCs aceptadas (Fase 4A): el vendedor es obligatorio y se puede indicar venta propia.
  const [masiva,setMasiva]=useState(null); // null | {vendedorId, ventaPropia}


  // Cierre financiero: caja, compromisos y conciliación con un solo universo de movimientos (lib/caja.js).
  const resumen=useMemo(()=>resumenCaja({ocs,financiadores,gastos,pagosVendedor,ivaMensual,vendedores,pagoFinSueltos,aportes:aportesLista,saldoBanco}),
    [ocs,financiadores,gastos,pagosVendedor,ivaMensual,vendedores,pagoFinSueltos,aportesLista,saldoBanco]);


  // ── OCs de MP sin datos de cliente (antes se recalculaba en cada render) ──
  const sinDatosMP=useMemo(()=>
    ocs.filter(o=>esCodigoMP&&esCodigoMP(o.numero_oc)&&!o.no_en_mp&&(o.sync_pendiente||!o.rut_cliente||!o.fecha_emision_mp||!o.fecha_hora_emision_mp||String(o.cliente||"").toUpperCase().includes("POR COMPLETAR"))).length
  ,[ocs,esCodigoMP]);


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
      const abiertas=sinVendedor.filter(o=>!estaCerrada(o)).length;   // mismo criterio que Alertas (pagado o "no aplica")
      items.push({
        label:`${sinVendedor.length} OC sin vendedor`,
        detalle:`No entran en ninguna comisión${abiertas?` · ${abiertas} abierta${abiertas>1?"s":""}`:""}`,
        monto:sinVendedor.reduce((s,o)=>s+(o.monto_total||0),0),
        color:C.inkMuted,tab:"compras",filtro:"sin_vendedor",n:sinVendedor.length});
    }

    // Fase 4C: OCs que Mercado Público informa canceladas (última consulta) y que no están cobradas.
    const canceladasMP=filtrarPanel(ocs,"mp_cancelada");
    if(canceladasMP.length) items.unshift({
      label:`${canceladasMP.length} OC cancelada${canceladasMP.length>1?"s":""} en Mercado Público`,
      detalle:"Revisar antes de comprar, entregar o facturar",
      monto:canceladasMP.reduce((s,o)=>s+(o.monto_total||0),0),
      color:C.dangerText,tab:"compras",filtro:"mp_cancelada",n:canceladasMP.length});

    return items;
  },[ocs]);

  return (
    <div style={{fontFamily:SANS}}>
      <div style={{marginBottom:14}}>
        <input type="search" value={busq} onChange={e=>setBusq(e.target.value)} placeholder="🔍 Buscar OC, cliente, factura o monto"
          onKeyDown={e=>{if(e.key==="Enter"&&busq.trim()&&onBuscarCompras)onBuscarCompras(busq.trim());}}
          style={{width:"100%",boxSizing:"border-box",minHeight:46,padding:"10px 14px",fontSize:16,fontFamily:SANS,border:`1px solid ${C.border}`,borderRadius:12,background:C.card,color:C.ink}} />
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
            {r.length>0&&onBuscarCompras&&<button onClick={()=>onBuscarCompras(busq.trim())} style={{width:"100%",minHeight:44,background:"none",border:"none",color:C.tealDark,fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:SANS}}>Ver {r.length>5?`los ${r.length} resultados`:"en Compras"} →</button>}
          </Tarjeta>);
        })()}
      </div>
      {/* Indicadores clave (mismo cierre de caja de lib/caja.js; el desglose completo está en «Caja y compromisos») */}
      <Indicadores columnas={escritorio?4:2}>
        <Indicador dato="banco" etiqueta={resumen.baseEsBanco?"Saldo BancoEstado":"Caja registrada BFK"} valor={fmt.money(resumen.baseEsBanco?resumen.saldoBancario:resumen.caja)} tono={resumen.baseEsBanco?"neutro":"warn"} nota={resumen.baseEsBanco?"Saldo esperado en la cuenta":"Sin saldo del banco registrado"} onClick={()=>onNavigate&&onNavigate("banco",null)} />
        <Indicador dato="por_cobrar" etiqueta="Facturas por cobrar" valor={fmt.money(resumen.facturasPorCobrar)} nota={resumen.nValeVista?`+ ${fmt.money(resumen.valeVista)} en vale vista`:"Facturas vigentes"} onClick={()=>onNavigate&&onNavigate("compras","cobro")} />
        <Indicador dato="deuda_fin" etiqueta="Deuda con financiadores" valor={fmt.money(resumen.deudaFinanciadores)} tono={resumen.deudaFinanciadores>0?"danger":"ok"} nota="Devolución FIFO" onClick={()=>onNavigate&&onNavigate("financiamiento",null)} />
        <Indicador dato="proyectado" destacado etiqueta="Saldo proyectado" valor={fmt.money(resumen.saldoProyectado)} tono={resumen.saldoProyectado>=0?"marca":"danger"} nota={resumen.provisorio?"Provisorio · no es dinero disponible hoy":"No es dinero disponible hoy"} onClick={()=>onNavigate&&onNavigate("finanzas",null)} />
      </Indicadores>
      {nAlertasCartola>0&&<AvisoLinea dato="alertas-cartola" onClick={()=>onNavigate&&onNavigate("banco",null)} accion="Revisar">{nAlertasCartola} posible{nAlertasCartola>1?"s":""} duplicado{nAlertasCartola>1?"s":""} con la cartola del banco</AvisoLinea>}
      <div style={escritorio?{display:"grid",gridTemplateColumns:"minmax(0,1.05fr) minmax(0,1fr)",gap:20,alignItems:"start"}:undefined}>
        <div>
      <Seccion titulo={`Prioridades de hoy${prioridades.length?` · ${prioridades.length}`:""}`} margen={16}>
      {/* ── Prioridades de hoy: tareas accionables ── */}
      <Tarjeta padding="4px 4px 4px 4px">
        {prioridades.length===0&&<div style={{fontSize:14,color:C.okText,fontWeight:700,padding:"14px 12px"}}>✓ Sin pendientes urgentes</div>}
        {(verTodasPrior?prioridades:prioridades.slice(0,MAX_PRIOR)).map((p,i,lista)=>(
          <button key={i} data-prioridad={p.filtro} data-n={p.n} onClick={()=>onNavigate&&onNavigate(p.tab,p.filtro)}
            style={{width:"100%",display:"flex",alignItems:"center",gap:10,minHeight:60,
              padding:"8px 10px",background:"none",border:"none",cursor:"pointer",textAlign:"left",
              borderBottom:i<lista.length-1||prioridades.length>MAX_PRIOR?`1px solid ${C.border}`:"none"}}>
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
        {prioridades.length>MAX_PRIOR&&(
          <button type="button" data-ver-prioridades onClick={()=>setVerTodasPrior(v=>!v)}
            style={{width:"100%",minHeight:40,background:"none",border:"none",color:C.tealDark,fontWeight:700,fontSize:13,cursor:"pointer"}}>
            {verTodasPrior?"Ver menos":`Ver ${prioridades.length-MAX_PRIOR} más`}
          </button>
        )}
      </Tarjeta>
      </Seccion>

      <Seccion titulo={<>Registrar<Ayuda>Pasos 1 a 4 de una OC ya creada. Cartola es aparte: concilia los movimientos del banco.</Ayuda></>} margen={16}>
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
            <span style={{fontSize:20}}>{a.icon}</span>
            <span style={{fontSize:12,fontWeight:700,color:a.color,textAlign:"center",lineHeight:1.2}}>{a.label}</span>
          </button>
        ))}
      </div>
      </Seccion>

      <Desplegable dato="mercado-publico" icono={<Ic n="📦"/>} titulo="Mercado Público" tono={nAvisosMP>0?"warn":null}
        resumen={nAvisosMP>0?"OCs por aceptar, aceptadas sin cargar o canceladas":"Sin avisos pendientes · revisar de nuevo cuando quieras"}
        derecha={<>{(porAceptar||[]).length>0&&<Badge tono="warn">⏳ {(porAceptar||[]).length}</Badge>}{(aceptadasSinCargar||[]).length>0&&<Badge tono="ok">✓ {(aceptadasSinCargar||[]).length}</Badge>}{(canceladasEnMP||[]).length>0&&<Badge tono="danger">✕ {(canceladasEnMP||[]).length}</Badge>}{sinDatosMP>0&&<Badge tono="info">{sinDatosMP} sin datos</Badge>}</>}>
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
                style={{width:"100%",minHeight:44,background:C.teal,border:"none",color:"#fff",borderRadius:12,padding:"10px 12px",fontSize:14,fontWeight:700,cursor:"pointer"}}>
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
              background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:"11px 14px",
              cursor:"pointer",marginBottom:10,boxShadow:"0 1px 2px rgba(15,23,42,0.04)"}}>
            <span style={{width:28,height:28,borderRadius:8,background:C.infoLight,color:C.info,flexShrink:0,
              display:"flex",alignItems:"center",justifyContent:"center",fontSize:13}}>↻</span>
            <span style={{flex:1,minWidth:0}}>
              <span style={{display:"block",fontSize:12,fontWeight:700,color:C.ink}}>Revisar Mercado Público de nuevo</span>
              {ultimaGeneral&&<span style={{display:"block",fontSize:12,color:C.inkFaint,marginTop:1}}>Última consulta exitosa: {hace(ultimaGeneral)}</span>}
            </span>
          </button>
        );
        return (
          <div data-mp-avisos>
            {true&&(
              <div>
                <button onClick={()=>{
                    onActualizarPorAceptar&&onActualizarPorAceptar();
                    onActualizarAceptadas&&onActualizarAceptadas();
                    onActualizarCanceladas&&onActualizarCanceladas();
                  }}
                  disabled={verificandoAlgo}
                  style={{width:"100%",background:"none",border:`1px dashed ${C.border}`,
                    color:verificandoAlgo?C.inkFaint:C.inkMuted,borderRadius:12,padding:"8px 12px",
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
                      <div style={{background:C.paper,borderRadius:12,padding:"10px 12px",fontSize:12,fontWeight:700,color:C.okText,textAlign:"center",marginBottom:2}}>
                        Cargando {cargandoAceptadas.hechas} de {cargandoAceptadas.total}…
                      </div>
                    ):masiva?(
                      <div data-carga-masiva style={{background:C.paper,borderRadius:12,padding:"10px 12px",marginBottom:6}}>
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
                            style={{flex:2,background:masiva.vendedorId?C.ok:C.inkFaint,border:"none",color:"#fff",borderRadius:12,padding:"10px 12px",fontSize:13,fontWeight:700,cursor:masiva.vendedorId?"pointer":"not-allowed"}}>
                            Cargar las {nAceptadas} con este vendedor
                          </button>
                          <button onClick={()=>setMasiva(null)} style={{flex:1,background:"none",border:`1px solid ${C.border}`,color:C.inkMuted,borderRadius:12,padding:"10px 12px",fontSize:13,fontWeight:700,cursor:"pointer"}}>Cancelar</button>
                        </div>
                      </div>
                    ):(
                      <button onClick={()=>setMasiva({vendedorId:"",ventaPropia:false})}
                        style={{width:"100%",background:C.ok,border:"none",color:"#fff",borderRadius:12,padding:"10px 12px",
                          fontSize:13,fontWeight:700,cursor:"pointer",marginBottom:6,boxShadow:`0 2px 8px ${C.ok}40`}}>
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

      </Desplegable>

        </div>
        <div>
      <Desplegable dato="caja" abiertoInicial={escritorio} icono={<Ic n="🏦"/>} titulo="Caja y compromisos"
        resumen={`Saldo proyectado ${fmt.money(resumen.saldoProyectado)}${resumen.provisorio?" · provisorio":""}`}>
      {/* Cierre financiero: cada concepto por separado, todos los pendientes sin importar el mes; lo que depende
          de un IVA aún no registrado se marca PROVISORIO (lib/caja.js). */}
      {(()=>{
        const r=resumen; const MES=["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
        const Fila=({k,v,signo,tono,nota,dato,onClick})=>(
          <div data-linea={dato} onClick={onClick} style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",gap:8,padding:"6px 0",borderBottom:`1px solid ${C.border}`,cursor:onClick?"pointer":"default"}}>
            <span style={{minWidth:0}}>
              <span style={{display:"block",fontSize:13,color:C.ink,fontWeight:700}}>{signo?<span style={{color:C.inkFaint,marginRight:4}}>{signo}</span>:null}{k}</span>
              {nota&&<span style={{display:"block",fontSize:12,color:C.inkFaint,marginTop:1,lineHeight:1.35}}>{nota}</span>}
            </span>
            <span data-monto={dato} style={{fontFamily:MONO,fontWeight:800,fontSize:14,color:tono||C.ink,flexShrink:0}}>{fmt.money(v)}</span>
          </div>
        );
        const ivaPend=r.ivaSinRegistrar.map(p=>`${MES[p.mes-1]}-${p.anio}`).join(", ");
        return (<>
          <div data-resumen-caja>
            {r.baseEsBanco
              ?<Fila dato="banco" k={r.conciliacion.nPosteriores?"Saldo esperado BancoEstado":"Saldo BancoEstado"} v={r.saldoBancario} nota={`Dinero en la cuenta: saldo informado al ${fmt.date(r.conciliacion.corte)}${r.conciliacion.nPosteriores?` más ${r.conciliacion.nPosteriores} movimiento${r.conciliacion.nPosteriores>1?"s":""} registrado${r.conciliacion.nPosteriores>1?"s":""} después (por confirmar con la cartola)`:""}`} />
              :<Fila dato="caja" k="Caja registrada BFK" v={r.caja} tono={C.warnText} nota="Sin saldo de BancoEstado registrado: la proyección parte de los movimientos registrados en BFK. Registre el saldo de la cuenta." />}
            <Fila dato="por_cobrar" signo="+" k="Facturas por cobrar" v={r.facturasPorCobrar} nota="Facturas vigentes, descontados los abonos parciales y los vale vista pendientes" onClick={()=>onNavigate&&onNavigate("compras","cobro")} />
            <Fila dato="por_facturar" signo="+" k="Ventas compradas sin facturar" v={r.ventasPorFacturar} nota="Monto de la OC aún sin factura: no es cuenta por cobrar hasta facturarla" />
            <Fila dato="vale_vista" signo="+" k="Vale vista / cheques pendientes" v={r.valeVista} tono={C.warnText} nota={r.nValeVista?`${r.nValeVista} documento${r.nValeVista>1?"s":""} entregado${r.nValeVista>1?"s":""} y aún sin depositar en el banco`:"Ninguno pendiente"} onClick={r.nValeVista?()=>onNavigate&&onNavigate("compras","vale_vista"):undefined} />
            <Fila dato="deuda_fin" signo="−" k="Deuda con financiadores" v={r.deudaFinanciadores} tono={C.dangerText}
              nota={r.porFinanciador.map(f=>`${f.nombre.split(" ")[0]} ${f.saldo<0?"a favor de BFK ":""}${fmt.money(Math.abs(f.saldo))}`).join(" · ")} onClick={()=>onNavigate&&onNavigate("financiamiento",null)} />
            {/* Comisiones en tres estados (regla única, lib/calculos.js). Solo la primera es deuda exigible; las tres se descuentan
                de la proyección, igual que antes (el total no cambia). */}
            {(()=>{ const det=(e)=>r.comisiones.detalle.filter(d=>d.estado===e).map(d=>`${d.vendedor.split(" ")[0]} ${MES[d.mes-1]}-${d.anio} ${fmt.money(d.deuda)}`).join(" · ");
              return (<>
                <Fila dato="comisiones" signo="−" k="Comisiones pendientes de pago" v={r.comisiones.exigible} tono={C.dangerText}
                  nota={det("pendiente")||"Ninguna exigible: comisiones definitivas al día"} onClick={()=>onNavigate&&onNavigate("vendedores",null)} />
                <Fila dato="comisiones_por_liquidar" signo="−" k="Comisiones por liquidar (provisorias)" v={r.comisiones.porLiquidar} tono={C.warnText}
                  nota={r.comisiones.porLiquidar>0?<>{det("por_liquidar")}<span style={{display:"block",color:C.warnText}}>Meses cerrados sin el IVA o sin el total del F29 (IVA + PPM): el monto puede cambiar. No es deuda exigible.</span></>:"Ninguna"} onClick={()=>onNavigate&&onNavigate("vendedores",null)} />
                <Fila dato="comisiones_en_curso" signo="−" k="Comisiones del mes en curso" v={r.comisiones.enCurso} tono={C.warnText}
                  nota={r.comisiones.enCurso>0?<>{det("en_curso")}<span style={{display:"block",color:C.inkFaint}}>Acumulado del mes actual: no es deuda exigible.</span></>:"Ninguna"} onClick={()=>onNavigate&&onNavigate("vendedores",null)} />
              </>); })()}
            <Fila dato="f29" signo="−" k="F29 pendiente (IVA + PPM)" v={r.f29Pendiente} tono={C.dangerText}
              nota={<>{r.f29.periodos.filter(x=>x.pend>0).map(x=>`${MES[x.mes-1]}-${x.anio} ${fmt.money(x.pend)}`).join(" · ")||"Sin saldo pendiente en los períodos registrados"}
                {ivaPend&&<span data-iva-sin-registrar style={{display:"block",color:C.warnText}}>Pendiente de registrar: {ivaPend}. Sin el F29 real no se estima ningún monto.</span>}
                {(r.f29.faltaTotal||[]).length>0&&<span data-f29-sin-total style={{display:"block",color:C.warnText}}>Falta el total del F29 (IVA + PPM) de {r.f29.faltaTotal.map(p=>`${MES[p.mes-1]}-${p.anio}`).join(", ")}: el pendiente puede ser mayor.</span>}</>} />
            {r.fondosExternos>0&&<Fila dato="externos" signo="−" k="Fondos de ventas externas por liquidar" v={r.fondosExternos} tono={C.dangerText} nota="Dinero de ventas externas que entró a la cuenta: está en la caja, pero no es de BFK hasta liquidarlo" />}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",gap:8,paddingTop:10}}>
              <span>
                <span style={{display:"block",fontSize:13,color:C.ink,fontWeight:800,textTransform:"uppercase",letterSpacing:0.6}}>= Saldo proyectado</span>
                <span data-proyectado-nota style={{display:"block",fontSize:12,color:C.inkFaint,marginTop:2}}>Proyección al cobrar y pagar todo lo pendiente: no es dinero disponible hoy</span>
                {r.provisorio&&<span data-proyectado-provisorio style={{display:"block",fontSize:12,color:C.warnText,fontWeight:700,marginTop:2}}>PROVISORIO: falta registrar IVA/F29 de {ivaPend||"algún período"}{r.comisiones.provisorias>0?" y hay comisiones por liquidar o en curso":""}</span>}
              </span>
              <span data-monto="proyectado" style={{fontFamily:MONO,fontWeight:800,fontSize:28,color:r.saldoProyectado>=0?C.tealDark:C.dangerText,letterSpacing:-1}}>{fmt.money(r.saldoProyectado)}</span>
            </div>
          </div>

        </>);
      })()}
      </Desplegable>

        </div>
      </div>
    </div>
  );
}
