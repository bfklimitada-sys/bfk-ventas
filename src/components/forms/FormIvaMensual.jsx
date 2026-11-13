import { useState } from "react";
import { Field } from "../ui/Basicos";
import { C, MONO, btnP, fmt, iMono, selStyle } from "../../lib/theme";
import { registroIvaDe, ivaNetoPeriodo, ivaAPagarPeriodo, aplicaRetenciones } from "../../lib/calculos";
import { mesSugeridoIva, pagadoSiiDe, gastosImpuestoDe } from "../../lib/ivaUnificado";
import { desgloseRegistroF29, leerMontoF29, tieneDesgloseF29, ETIQUETA_PENDIENTE } from "../../lib/f29Desglose";

const MESES=["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const conSigno=(n)=>(n<0?"−":"")+fmt.money(Math.abs(n));
const txt=(v)=>v===null||v===undefined?"":String(v);
const miles=(v)=>v===null||v===undefined||v===""?"":Number(v).toLocaleString("es-CL");
const pendiente=<span style={{color:C.warnText,fontWeight:600}}>Pendiente</span>;
const monto=(v)=>v===null?pendiente:fmt.money(v);

// Formulario del F29 de un período (Finanzas › Impuestos y Gastos). 13/11/2026:
//  · Registra los mismos datos del informe del contador: ventas y compras netas, IVA débito y crédito, remanente anterior
//    reajustado, PPM y otras retenciones. Un campo vacío es un dato PENDIENTE; «0» (o «–», como en el informe) es $0.
//  · Guardar deja el F29 DECLARADO; no registra pagos ni gastos. El pago se ingresa aparte, cuando está hecho.
//  · Un registro anterior sin desglose se edita en su formato (mismo cálculo de siempre) hasta que el usuario elija pasarlo
//    al desglose del informe; entonces los tres datos nuevos son obligatorios (no se completan con valores inferidos).
//  periodo: {anio, mes} para abrir en un período concreto.
export function FormIvaMensual({ ivaMensual=[], gastos=[], periodo, onSave }) {
  const inicial=periodo||mesSugeridoIva({gastos,ivaMensual});
  const valoresDe=(anio,mes)=>{
    const r=registroIvaDe(ivaMensual,anio,mes);
    return { vN:miles(r?.ventas_netas), iV:miles(r?.iva_ventas), cN:miles(r?.compras_netas), iC:miles(r?.iva_compras),
      rem:miles(r?.remanente_anterior), ppm:miles(r?.ppm), otras:miles(r?.otras_retenciones),
      total:r&&!tieneDesgloseF29(r)&&Number(r.iva_pagado)>0?miles(r.iva_pagado):"",
      existe:!!r, anterior:!!r&&!tieneDesgloseF29(r), pagos:gastosImpuestoDe(gastos,anio,mes).length, pagado:pagadoSiiDe(gastos,anio,mes) };
  };
  const [mes,setMes]=useState(Number(inicial.mes));
  const [anio,setAnio]=useState(Number(inicial.anio));
  const [v,setV]=useState(()=>valoresDe(inicial.anio,inicial.mes));
  const [pasarDesglose,setPasarDesglose]=useState(false);
  const [err,setErr]=useState(""); const [saving,setSaving]=useState(false);

  const cambiarPeriodo=(a,m)=>{ setAnio(a); setMes(m); setPasarDesglose(false); setErr(""); if(Number(a)>2000) setV(valoresDe(Number(a),Number(m))); };
  const set=(k,val)=>setV(p=>({...p,[k]:val}));
  const conDesglose=!v.anterior||pasarDesglose;
  const conRet=aplicaRetenciones(anio,mes);

  const L={vN:leerMontoF29(v.vN),iV:leerMontoF29(v.iV),cN:leerMontoF29(v.cN),iC:leerMontoF29(v.iC),
    rem:leerMontoF29(v.rem),ppm:leerMontoF29(v.ppm),otras:leerMontoF29(v.otras),total:leerMontoF29(v.total)};
  const d=desgloseRegistroF29({iva_ventas:L.iV.valor,iva_compras:L.iC.valor,remanente_anterior:L.rem.valor,ppm:L.ppm.valor,otras_retenciones:L.otras.valor});
  // Referencia (no se copia): remanente nominal que dejó el mes anterior, si se registró con desglose.
  const mPrev=mes===1?12:mes-1, aPrev=mes===1?anio-1:anio;
  const rPrev=registroIvaDe(ivaMensual,aPrev,mPrev);
  const remPrevNominal=tieneDesgloseF29(rPrev)?desgloseRegistroF29(rPrev).remanenteSiguiente:null;

  const handleSave=async()=>{
    const nombres={vN:"Ventas netas",iV:"IVA débito",cN:"Compras netas",iC:"IVA crédito",rem:"Remanente anterior reajustado",ppm:"PPM",otras:"Otras retenciones",total:"Total del F29"};
    const usados=conDesglose?["vN","iV","cN","iC","rem","ppm","otras"]:["vN","iV","cN","iC","total"];
    for(const k of usados) if(L[k].error){ setErr(`${nombres[k]}: ${L[k].error}`); return; }
    for(const k of ["vN","iV","cN","iC"]) if(L[k].valor===null){ setErr(`Ingresa ${nombres[k]} (puede ser 0)`); return; }
    if(conDesglose&&v.anterior){
      const falta=["rem","ppm","otras"].filter(k=>L[k].valor===null).map(k=>nombres[k]);
      if(falta.length){ setErr(`Para pasar este período al desglose del informe ingresa: ${falta.join(", ")} (0 si no hay). No se completan con valores supuestos.`); return; }
    }
    setErr(""); setSaving(true);
    const base={mes:Number(mes),anio:Number(anio),ventasNetas:L.vN.valor,ivaVentas:L.iV.valor,comprasNetas:L.cN.valor,ivaCompras:L.iC.valor};
    try{ await onSave(conDesglose?{...base,desglose:true,remanenteAnterior:L.rem.valor,ppm:L.ppm.valor,otrasRetenciones:L.otras.valor}:{...base,totalF29:L.total.valor||0}); }
    catch(e){setErr(e.message);}finally{setSaving(false);}
  };

  const campo=(k,label,hint)=>(
    <Field label={label} hint={hint}>
      <input data-f29-campo={k} style={iMono} type="text" inputMode="numeric" autoComplete="off" placeholder="Pendiente" value={v[k]} onChange={e=>set(k,e.target.value)} />
      {L[k].error&&<div style={{fontSize:12,color:C.dangerText,marginTop:3}}>{L[k].error}</div>}
    </Field>
  );
  const fila=(dato,etiqueta,valor,{fuerte=false,color}={})=>(
    <div data-desglose={dato} style={{display:"flex",justifyContent:"space-between",gap:10,padding:"3px 0",fontWeight:fuerte?700:500}}>
      <span>{etiqueta}</span><span style={{fontFamily:MONO,color,whiteSpace:"nowrap"}}>{valor}</span>
    </div>
  );

  return (
    <div data-form-f29={conDesglose?"desglose":"anterior"}>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        <Field label="Mes del F29"><select style={selStyle} value={mes} onChange={e=>cambiarPeriodo(anio,Number(e.target.value))}>{MESES.map((m,i)=><option key={i} value={i+1}>{m}</option>)}</select></Field>
        <Field label="Año"><input style={iMono} type="number" value={anio} onChange={e=>cambiarPeriodo(e.target.value,mes)} /></Field>
      </div>
      {v.existe&&<div style={{fontSize:12,color:C.inkMuted,marginBottom:8}}>Este período ya tiene su F29 registrado: estás editándolo. Sus pagos ({v.pagos}) no se modifican.</div>}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        {campo("vN","Ventas netas ($)")}
        {campo("iV","IVA débito ($)")}
        {campo("cN","Compras netas · columna Neto ($)")}
        {campo("iC","IVA crédito ($)")}
      </div>
      {conDesglose?(<>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          {campo("rem","Remanente anterior reajustado ($)",remPrevNominal!==null?`Cópialo del informe. Nominal de ${MESES[mPrev-1].toLowerCase()}: ${fmt.money(remPrevNominal)} (puede diferir por el reajuste)`:"Cópialo del informe de este mes (reajustado)")}
          {campo("ppm","PPM ($)","Cópialo del informe")}
          {campo("otras","Otras retenciones ($)","Impuesto Único, honorarios, etc.")}
        </div>
        <div style={{fontSize:12,color:C.inkFaint,marginTop:-6,marginBottom:10}}>Campo vacío = dato pendiente. Escribe 0 (o «–», como en el informe) para registrar $0.</div>
      </>):(
        <div data-f29-anterior style={{background:C.relleno,borderRadius:8,padding:"10px 12px",marginBottom:12,fontSize:13,color:C.inkMuted,lineHeight:1.45}}>
          Registro anterior sin desglose: conserva su cálculo de siempre.
          {campo("total","Total del F29 (IVA + retenciones) ($)",conRet?"Sin total, las comisiones del mes quedan provisorias":"Antes de agosto 2026, vacío = IVA a pagar")}
          <button data-f29-pasar-desglose type="button" onClick={()=>setPasarDesglose(true)} style={{background:"none",border:"none",color:C.info,fontSize:13,fontWeight:600,cursor:"pointer",textDecoration:"underline",padding:0}}>Registrar este período con el desglose del informe</button>
        </div>
      )}
      {conDesglose?(
        <div data-desglose-f29 style={{background:C.tealLight,borderRadius:8,padding:"10px 12px",fontSize:13,color:C.tealDark,marginBottom:12,lineHeight:1.5}}>
          {fila("iva-neto","IVA neto del mes (débito − crédito)",conSigno(d.ivaNeto))}
          {fila("remanente-anterior","(−) Remanente anterior reajustado",monto(d.remanente))}
          {fila("iva-a-pagar","IVA a pagar",monto(d.ivaAPagar),{fuerte:true})}
          {fila("remanente-siguiente",`Remanente para ${MESES[mes%12].toLowerCase()}`,monto(d.remanenteSiguiente))}
          {fila("ppm","(+) PPM",monto(d.ppm))}
          {fila("otras","(+) Otras retenciones",monto(d.otras))}
          <div style={{borderTop:`1px solid ${C.teal}55`,margin:"4px 0"}} />
          {fila("total-f29","Total a pagar F29",d.total===null?<>{pendiente} <span style={{fontWeight:500}}>(conocido {fmt.money(d.totalConocido)})</span></>:fmt.money(d.total),{fuerte:true})}
          {fila("descuento-comisiones","Descuento tributario para comisiones (antes de dividir)",
            !conRet?`${conSigno(d.ivaNeto)} (solo IVA neto: antes de ago-2026 no se descuentan retenciones)`:d.descuentoComisiones===null?pendiente:conSigno(d.descuentoComisiones))}
          {d.pendientes.length>0&&<div data-f29-pendientes style={{fontSize:12,color:C.warnText,marginTop:4,fontWeight:600}}>Pendiente de ingresar: {d.pendientes.map(p=>ETIQUETA_PENDIENTE[p]).join(", ")}. {d.pendientes.some(p=>p!=="remanente_anterior")&&conRet?"Las comisiones del mes quedan provisorias.":""}</div>}
        </div>
      ):(
        <div data-desglose-f29 style={{background:C.tealLight,borderRadius:8,padding:"10px 12px",fontSize:13,color:C.tealDark,fontWeight:600,marginBottom:12,lineHeight:1.5}}>
          <div>IVA neto (débito − crédito): {conSigno(ivaNetoPeriodo({iva_ventas:L.iV.valor,iva_compras:L.iC.valor}))} · IVA a pagar: {fmt.money(ivaAPagarPeriodo({iva_ventas:L.iV.valor,iva_compras:L.iC.valor}))}</div>
        </div>
      )}
      <div style={{fontSize:12,color:C.inkMuted,marginBottom:10}}>Guardar deja el F29 declarado. El pago al SII se registra aparte, con su monto y fecha reales, desde el detalle del período.</div>
      {err&&<div style={{background:C.dangerLight,color:C.dangerText,borderRadius:8,padding:"8px 12px",fontSize:13,marginBottom:10,fontWeight:500}}>{err}</div>}
      <button data-f29-guardar onClick={handleSave} disabled={saving} style={btnP(saving?C.inkFaint:C.info)}>{saving?"Guardando…":"✓ Guardar F29 (declarado)"}</button>
    </div>
  );
}
