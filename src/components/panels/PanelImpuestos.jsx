import { useEffect, useMemo, useState } from "react";
import { Modal } from "../ui/Basicos";
import { C, MONO, btnG, fmt } from "../../lib/theme";
import { Seccion, Tarjeta, Pestanas, PanelPestana, Indicador, Indicadores, Badge } from "../ui/Sistema";
import { registroIvaDe, ivaNetoPeriodo, ivaAPagarPeriodo } from "../../lib/calculos";
import { calcularF29, desgloseF29 } from "../../lib/f29";
import { FormIvaMensual } from "../forms/FormIvaMensual";
import { DetalleF29, estadoF29 } from "../forms/DetalleF29";
import { periodosIvaIncompletos } from "../../lib/ivaUnificado";

// Impuestos (rediseño 2026-10): un solo lugar para el IVA mensual y el F29. Solo presentación:
// el registro usa el mismo formulario único (FormIvaMensual) y los cálculos de lib/f29.js y lib/calculos.js.
const conSigno=(n)=>(n<0?"−":"")+fmt.money(Math.abs(n));
const MES=["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];

export function PanelImpuestos({ ivaMensual, gastos=[], onGuardarIva, onPagoF29, periodoInicial=null, onPeriodoInicialUsado }) {
  const [detalle,setDetalle]=useState(null);   // {anio,mes}: vista del período (desglose, pagos, saldo)
  const [pestana,setPestana]=useState("iva");
  const [editIva,setEditIva]=useState(false);
  const [verHistorialIva,setVerHistorialIva]=useState(false);
  const [editandoIvaExistente,setEditandoIvaExistente]=useState(null);
  // Enlace desde otra pantalla (p. ej. Vendedores · «Registrar IVA de Oct/2026»): abre el mismo formulario único de IVA
  // en ese período. Solo lo abre; no guarda nada hasta que el usuario confirme en el formulario.
  useEffect(()=>{
    if(!periodoInicial) return;
    setPestana("iva");
    setEditandoIvaExistente({anio:periodoInicial.anio,mes:periodoInicial.mes});
    setEditIva(true);
    onPeriodoInicialUsado&&onPeriodoInicialUsado();
  },[periodoInicial]);
  const ivaOrdenado=useMemo(()=>ivaMensual.slice().sort((a,b)=>`${b.anio}-${String(b.mes).padStart(2,"0")}`.localeCompare(`${a.anio}-${String(a.mes).padStart(2,"0")}`)),[ivaMensual]);
  const ivaIncompletos=useMemo(()=>periodosIvaIncompletos({gastos,ivaMensual}),[gastos,ivaMensual]);
  const hoy=new Date(); const mesActual=hoy.getMonth()+1; const anioActual=hoy.getFullYear();
  const f29=useMemo(()=>calcularF29({ivaMensual,gastos,anioActual,mesActual}),[ivaMensual,gastos,anioActual,mesActual]);
  const periodos=f29.periodos.filter(p=>p.det>0||p.pag>0||p.conDesglose).slice().reverse();
  const pendientes=f29.periodos.filter(p=>p.pend>0).length;
  return (
    <div>
      <Indicadores columnas={2}>
        <Indicador dato="iva-mes" etiqueta={`IVA neto ${fmt.monthYear(mesActual,anioActual)}`} valor={registroIvaDe(ivaMensual,anioActual,mesActual)?conSigno(ivaNetoPeriodo(registroIvaDe(ivaMensual,anioActual,mesActual))):"Sin registrar"} tono={registroIvaDe(ivaMensual,anioActual,mesActual)?"neutro":"warn"} onClick={()=>setPestana("iva")} />
        <Indicador dato="f29-pendiente" etiqueta="F29 pendiente (IVA + PPM)" valor={fmt.money(f29.total)} tono={f29.total>0?"danger":"ok"} nota={pendientes?`${pendientes} período${pendientes>1?"s":""} con saldo`:"Al día"} onClick={()=>setPestana("f29")} />
      </Indicadores>
      <Pestanas etiqueta="Impuestos" activa={pestana} onCambiar={setPestana} items={[
        {key:"iva",label:"IVA mensual",n:ivaIncompletos.length||null,tono:ivaIncompletos.length?"warn":null},
        {key:"f29",label:"F29",n:pendientes||null,tono:pendientes?"danger":null},
      ]} />
      <PanelPestana visible={pestana==="iva"} titulo="IVA mensual">
      <Seccion id="ven-iva" nota="Su IVA neto (débito − crédito) se descuenta en las comisiones del período; no es un pago a vendedores.">
      {ivaIncompletos.length>0&&(
        <div data-aviso="iva-incompleto" style={{background:C.warnLight,border:`1px solid ${C.warn}55`,borderRadius:12,padding:"10px 12px",marginBottom:10}}>
          <div style={{fontSize:13,fontWeight:600,color:C.warnText,marginBottom:6}}>Pago al SII registrado sin débito/crédito: la comisión de estos meses se calcula sin IVA.</div>
          {ivaIncompletos.map(p=>(
            <button key={`${p.anio}-${p.mes}`} onClick={()=>{setEditandoIvaExistente({anio:p.anio,mes:p.mes});setEditIva(true);}} style={{...btnG,minHeight:40,fontSize:13,marginRight:6,marginTop:4,padding:"6px 12px"}}>
              Completar {fmt.monthYear(p.mes,p.anio)} · pagado {fmt.money(p.pagado)}
            </button>
          ))}
        </div>
      )}
      <Tarjeta padding="14px 16px">
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
          <div style={{fontWeight:700,fontSize:14,color:C.ink}}>IVA del mes ({fmt.monthYear(mesActual,anioActual)})</div>
          <button onClick={()=>{setEditandoIvaExistente(registroIvaDe(ivaMensual,anioActual,mesActual));setEditIva(true);}} style={btnG}>{registroIvaDe(ivaMensual,anioActual,mesActual)?"Editar":"Registrar"}</button>
        </div>
        {registroIvaDe(ivaMensual,anioActual,mesActual)?(()=>{ const r=registroIvaDe(ivaMensual,anioActual,mesActual); return (<>
          <div style={{fontFamily:MONO,fontWeight:700,fontSize:20,color:C.info}}>{conSigno(ivaNetoPeriodo(r))}</div>
          <div style={{fontSize:12,color:C.inkMuted,marginTop:2}}>IVA neto = débito {fmt.money(Number(r.iva_ventas)||0)} − crédito {fmt.money(Number(r.iva_compras)||0)} · se descuenta en comisiones · total F29: {fmt.money(desgloseF29(ivaMensual,gastos,anioActual,mesActual).det)}</div>
          <button onClick={()=>setDetalle({anio:anioActual,mes:mesActual})} style={{background:"none",border:"none",color:C.info,fontSize:12,fontWeight:600,cursor:"pointer",textDecoration:"underline",padding:0,marginTop:4}}>Ver desglose y pagos</button>
        </>); })():
          <div style={{fontSize:13,color:C.inkFaint}}>Sin registrar.</div>
        }
        <div style={{display:"flex",gap:14,marginTop:10,paddingTop:10,borderTop:`1px solid ${C.border}`}}>
          <button onClick={()=>{setEditandoIvaExistente(null);setEditIva(true);}} style={{background:"none",border:"none",color:C.info,fontSize:12,fontWeight:600,cursor:"pointer",textDecoration:"underline",padding:0}}>+ Registrar IVA de otro mes</button>
          {ivaMensual.length>0&&<button onClick={()=>setVerHistorialIva(v=>!v)} style={{background:"none",border:"none",color:C.inkFaint,fontSize:12,fontWeight:600,cursor:"pointer",textDecoration:"underline",padding:0}}>{verHistorialIva?"Ocultar historial":`Ver historial (${ivaMensual.length})`}</button>}
        </div>
        {verHistorialIva&&(
          <div style={{marginTop:10}}>
            {ivaOrdenado.map(i=>(
              <button key={i.id} data-historial-iva={`${i.anio}-${i.mes}`} onClick={()=>setDetalle({anio:i.anio,mes:i.mes})}
                style={{width:"100%",background:"none",border:"none",padding:"7px 0",borderBottom:`1px solid ${C.border}`,
                  display:"flex",justifyContent:"space-between",cursor:"pointer",textAlign:"left"}}>
                <span style={{fontSize:12,color:C.ink,fontWeight:600}}>{fmt.monthYear(i.mes,i.anio)}</span>
                <span style={{fontFamily:MONO,fontSize:12,color:C.info,fontWeight:600}}>neto {conSigno(ivaNetoPeriodo(i))} · F29 {fmt.money(desgloseF29(ivaMensual,gastos,Number(i.anio),Number(i.mes)).det)}</span>
              </button>
            ))}
          </div>
        )}
      </Tarjeta>
      </Seccion>
      </PanelPestana>
      <PanelPestana visible={pestana==="f29"} titulo="F29">
        <Seccion nota="Total a pagar del F29 por período (IVA a pagar + PPM + otras retenciones) y sus pagos. Toca un período para ver el desglose o registrar un pago realizado. Los registros anteriores sin desglose conservan su cálculo.">
          <Tarjeta padding="4px 14px">
            {periodos.length===0&&<div style={{fontSize:13,color:C.inkFaint,padding:"10px 0"}}>Sin períodos registrados</div>}
            {periodos.map(p=>{ const d=desgloseF29(ivaMensual,gastos,p.anio,p.mes); const est=estadoF29(d); const x=d.desglose; return (
              <button key={`${p.anio}-${p.mes}`} data-f29={`${p.anio}-${p.mes}`} onClick={()=>setDetalle({anio:p.anio,mes:p.mes})}
                style={{display:"block",width:"100%",textAlign:"left",background:"none",border:"none",borderBottom:`1px solid ${C.border}`,padding:"10px 0",cursor:"pointer"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}>
                  <span style={{fontSize:14,fontWeight:700,color:C.ink}}>{MES[p.mes-1]}-{p.anio}</span>
                  <Badge tono={est.tono}>{d.pend>0?`Pendiente ${fmt.money(d.pend)}`:est.texto.replace("Declarado · ","")}</Badge>
                </div>
                {x?<div style={{fontSize:12,color:C.inkMuted,marginTop:3,fontFamily:MONO}}>IVA a pagar {x.ivaAPagar===null?"pendiente":fmt.money(x.ivaAPagar)} + PPM {x.ppm===null?"pendiente":fmt.money(x.ppm)} + otras {x.otras===null?"pendiente":fmt.money(x.otras)} = {x.total===null?"pendiente":fmt.money(x.total)} · pagado {fmt.money(d.pag)}</div>
                  :<div style={{fontSize:12,color:C.inkMuted,marginTop:3,fontFamily:MONO}}>IVA {fmt.money(d.iva)} + PPM {fmt.money(d.ppm)} = {fmt.money(d.det)} · pagado {fmt.money(d.pag)}</div>}
                {d.faltaTotalF29&&<div style={{fontSize:12,color:C.warnText,marginTop:2}}>{x?"Faltan datos del informe: el pendiente puede ser mayor.":"Falta registrar el total del F29 (PPM): el pendiente puede ser mayor."}</div>}
              </button>); })}
            <div style={{display:"flex",justifyContent:"space-between",padding:"10px 0",fontWeight:700,fontSize:13}}><span>Total pendiente</span><span style={{fontFamily:MONO,color:f29.total>0?C.dangerText:C.okText}}>{fmt.money(f29.total)}</span></div>
          </Tarjeta>
          <button onClick={()=>{setEditandoIvaExistente(null);setEditIva(true);}} style={{...btnG,width:"100%"}}>Registrar F29 de un mes</button>
        </Seccion>
      </PanelPestana>
      {detalle&&!editIva&&(
        <Modal title="Período F29" onClose={()=>setDetalle(null)}>
          <DetalleF29 ivaMensual={ivaMensual} gastos={gastos} anio={detalle.anio} mes={detalle.mes}
            onEditar={()=>{setEditandoIvaExistente({anio:detalle.anio,mes:detalle.mes});setEditIva(true);}} onPagar={onPagoF29} />
        </Modal>
      )}
      {editIva&&(
        <Modal title="IVA mensual · F29 del período" onClose={()=>setEditIva(false)}>
          <FormIvaMensual ivaMensual={ivaMensual} gastos={gastos} periodo={editandoIvaExistente?{anio:editandoIvaExistente.anio,mes:editandoIvaExistente.mes}:null} onSave={async(d)=>{await onGuardarIva(d);setEditIva(false);}} />
        </Modal>
      )}
    </div>
  );
}
