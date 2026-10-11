import { useMemo, useState } from "react";
import { Modal } from "../ui/Basicos";
import { C, MONO, btnG, fmt } from "../../lib/theme";
import { Seccion, Tarjeta, Pestanas, PanelPestana, Indicador, Indicadores, Badge } from "../ui/Sistema";
import { registroIvaDe, ivaNetoPeriodo, ivaAPagarPeriodo } from "../../lib/calculos";
import { calcularF29, desgloseF29 } from "../../lib/f29";
import { FormIvaMensual } from "../forms/FormIvaMensual";
import { periodosIvaIncompletos } from "../../lib/ivaUnificado";

// Impuestos (rediseño 2026-10): un solo lugar para el IVA mensual y el F29. Solo presentación:
// el registro usa el mismo formulario único (FormIvaMensual) y los cálculos de lib/f29.js y lib/calculos.js.
const conSigno=(n)=>(n<0?"−":"")+fmt.money(Math.abs(n));
const MES=["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];

export function PanelImpuestos({ ivaMensual, gastos=[], onGuardarIva }) {
  const [pestana,setPestana]=useState("iva");
  const [editIva,setEditIva]=useState(false);
  const [verHistorialIva,setVerHistorialIva]=useState(false);
  const [editandoIvaExistente,setEditandoIvaExistente]=useState(null);
  const ivaOrdenado=useMemo(()=>ivaMensual.slice().sort((a,b)=>`${b.anio}-${String(b.mes).padStart(2,"0")}`.localeCompare(`${a.anio}-${String(a.mes).padStart(2,"0")}`)),[ivaMensual]);
  const ivaIncompletos=useMemo(()=>periodosIvaIncompletos({gastos,ivaMensual}),[gastos,ivaMensual]);
  const hoy=new Date(); const mesActual=hoy.getMonth()+1; const anioActual=hoy.getFullYear();
  const f29=useMemo(()=>calcularF29({ivaMensual,gastos,anioActual,mesActual}),[ivaMensual,gastos,anioActual,mesActual]);
  const periodos=f29.periodos.filter(p=>p.det>0||p.pag>0).slice().reverse();
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
          <div style={{fontSize:13,fontWeight:700,color:C.warnText,marginBottom:6}}>Pago al SII registrado sin débito/crédito: la comisión de estos meses se calcula sin IVA.</div>
          {ivaIncompletos.map(p=>(
            <button key={`${p.anio}-${p.mes}`} onClick={()=>{setEditandoIvaExistente({anio:p.anio,mes:p.mes});setEditIva(true);}} style={{...btnG,minHeight:40,fontSize:13,marginRight:6,marginTop:4,padding:"6px 12px"}}>
              Completar {fmt.monthYear(p.mes,p.anio)} · pagado {fmt.money(p.pagado)}
            </button>
          ))}
        </div>
      )}
      <Tarjeta padding="14px 16px">
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
          <div style={{fontWeight:800,fontSize:14,color:C.ink}}>IVA del mes ({fmt.monthYear(mesActual,anioActual)})</div>
          <button onClick={()=>{setEditandoIvaExistente(registroIvaDe(ivaMensual,anioActual,mesActual));setEditIva(true);}} style={btnG}>{registroIvaDe(ivaMensual,anioActual,mesActual)?"Editar":"Registrar"}</button>
        </div>
        {registroIvaDe(ivaMensual,anioActual,mesActual)?(()=>{ const r=registroIvaDe(ivaMensual,anioActual,mesActual); return (<>
          <div style={{fontFamily:MONO,fontWeight:800,fontSize:20,color:C.info}}>{conSigno(ivaNetoPeriodo(r))}</div>
          <div style={{fontSize:12,color:C.inkMuted,marginTop:2}}>IVA neto = débito {fmt.money(Number(r.iva_ventas)||0)} − crédito {fmt.money(Number(r.iva_compras)||0)} · se descuenta en comisiones · a pagar al SII: {fmt.money(ivaAPagarPeriodo(r))}</div>
        </>); })():
          <div style={{fontSize:13,color:C.inkFaint}}>Sin registrar.</div>
        }
        <div style={{display:"flex",gap:14,marginTop:10,paddingTop:10,borderTop:`1px solid ${C.border}`}}>
          <button onClick={()=>{setEditandoIvaExistente(null);setEditIva(true);}} style={{background:"none",border:"none",color:C.info,fontSize:12,fontWeight:700,cursor:"pointer",textDecoration:"underline",padding:0}}>+ Registrar IVA de otro mes</button>
          {ivaMensual.length>0&&<button onClick={()=>setVerHistorialIva(v=>!v)} style={{background:"none",border:"none",color:C.inkFaint,fontSize:12,fontWeight:700,cursor:"pointer",textDecoration:"underline",padding:0}}>{verHistorialIva?"Ocultar historial":`Ver historial (${ivaMensual.length})`}</button>}
        </div>
        {verHistorialIva&&(
          <div style={{marginTop:10}}>
            {ivaOrdenado.map(i=>(
              <button key={i.id} onClick={()=>{setEditandoIvaExistente(i);setEditIva(true);}}
                style={{width:"100%",background:"none",border:"none",padding:"7px 0",borderBottom:`1px solid ${C.border}`,
                  display:"flex",justifyContent:"space-between",cursor:"pointer",textAlign:"left"}}>
                <span style={{fontSize:12,color:C.ink,fontWeight:700}}>{fmt.monthYear(i.mes,i.anio)}</span>
                <span style={{fontFamily:MONO,fontSize:12,color:C.info,fontWeight:700}}>neto {conSigno(ivaNetoPeriodo(i))} · a pagar {fmt.money(ivaAPagarPeriodo(i))}</span>
              </button>
            ))}
          </div>
        )}
      </Tarjeta>
      </Seccion>
      </PanelPestana>
      <PanelPestana visible={pestana==="f29"} titulo="F29">
        <Seccion nota="IVA + PPM por período. Los períodos anteriores a agosto 2026 no incluyen PPM (regla vigente; sin cambios retroactivos).">
          <Tarjeta padding="4px 14px">
            {periodos.length===0&&<div style={{fontSize:13,color:C.inkFaint,padding:"10px 0"}}>Sin períodos registrados</div>}
            {periodos.map(p=>{ const d=desgloseF29(ivaMensual,gastos,p.anio,p.mes); return (
              <div key={`${p.anio}-${p.mes}`} data-f29={`${p.anio}-${p.mes}`} style={{padding:"10px 0",borderBottom:`1px solid ${C.border}`}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}>
                  <span style={{fontSize:14,fontWeight:800,color:C.ink}}>{MES[p.mes-1]}-{p.anio}</span>
                  {d.pend>0?<Badge tono="danger">Pendiente {fmt.money(d.pend)}</Badge>:<Badge tono="ok">Pagado</Badge>}
                </div>
                <div style={{fontSize:12,color:C.inkMuted,marginTop:3,fontFamily:MONO}}>IVA {fmt.money(d.iva)} + PPM {fmt.money(d.ppm)} = {fmt.money(d.det)} · pagado {fmt.money(d.pag)}</div>
                {d.faltaTotalF29&&<div style={{fontSize:12,color:C.warnText,marginTop:2}}>Falta registrar el total del F29 (PPM): el pendiente puede ser mayor.</div>}
              </div>); })}
            <div style={{display:"flex",justifyContent:"space-between",padding:"10px 0",fontWeight:800,fontSize:13}}><span>Total pendiente</span><span style={{fontFamily:MONO,color:f29.total>0?C.dangerText:C.okText}}>{fmt.money(f29.total)}</span></div>
          </Tarjeta>
          <button onClick={()=>{setEditandoIvaExistente(null);setEditIva(true);}} style={{...btnG,width:"100%"}}>Registrar IVA / F29 de un mes</button>
        </Seccion>
      </PanelPestana>
      {editIva&&(
        <Modal title="IVA mensual" onClose={()=>setEditIva(false)}>
          <FormIvaMensual ivaMensual={ivaMensual} gastos={gastos} periodo={editandoIvaExistente?{anio:editandoIvaExistente.anio,mes:editandoIvaExistente.mes}:null} onSave={async(d)=>{await onGuardarIva(d);setEditIva(false);}} />
        </Modal>
      )}
    </div>
  );
}
