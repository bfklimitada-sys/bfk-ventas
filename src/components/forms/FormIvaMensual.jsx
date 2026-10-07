import { useState } from "react";
import { Field } from "../ui/Basicos";
import { C, btnP, fmt, iMono, iStyle, selStyle } from "../../lib/theme";
import { registroIvaDe, ivaNetoPeriodo, ivaAPagarPeriodo, aplicaRetenciones } from "../../lib/calculos";
import { mesSugeridoIva, pagadoSiiDe, gastosImpuestoDe } from "../../lib/ivaUnificado";

const MESES=["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const conSigno=(n)=>(n<0?"−":"")+fmt.money(Math.abs(n));
const txt=(v)=>v===null||v===undefined?"":String(v);

// Formulario único "IVA del mes" (Vendedores y Gastos). Guarda en un solo paso
// el débito/crédito (iva_mensual, usado por la comisión) y el pago al SII
// (gasto "Impuesto SII", salida de caja). Ver lib/ivaUnificado.js.
//  periodo: {anio, mes} para abrir en un período concreto (editar o completar).
export function FormIvaMensual({ ivaMensual=[], gastos=[], periodo, onSave }) {
  const inicial=periodo||mesSugeridoIva({gastos,ivaMensual});
  const valoresDe=(anio,mes)=>{
    const r=registroIvaDe(ivaMensual,anio,mes);
    const pag=pagadoSiiDe(gastos,anio,mes);
    const g=gastosImpuestoDe(gastos,anio,mes);
    return { vN:txt(r?.ventas_netas), iV:txt(r?.iva_ventas), cN:txt(r?.compras_netas), iC:txt(r?.iva_compras),
      pagado:pag>0?String(pag):"", pagadoManual:pag>0, fecha:(g[0]?.fecha&&String(g[0].fecha).slice(0,10))||new Date().toISOString().slice(0,10),
      existe:!!r, pagos:g.length };
  };
  const [mes,setMes]=useState(Number(inicial.mes));
  const [anio,setAnio]=useState(Number(inicial.anio));
  const [v,setV]=useState(()=>valoresDe(inicial.anio,inicial.mes));
  const [err,setErr]=useState(""); const [saving,setSaving]=useState(false);

  const cambiarPeriodo=(a,m)=>{ setAnio(a); setMes(m); if(Number(a)>2000) setV(valoresDe(Number(a),Number(m))); };
  const set=(k,val)=>setV(p=>({...p,[k]:val}));

  const ivaNeto=ivaNetoPeriodo({iva_ventas:v.iV,iva_compras:v.iC});
  const aPagar=ivaAPagarPeriodo({iva_ventas:v.iV,iva_compras:v.iC});
  // El pagado sigue al IVA a pagar mientras no se escriba a mano.
  const pagado=v.pagadoManual?v.pagado:(aPagar>0?String(aPagar):"");
  const retenciones=Math.max(0,(Number(pagado)||0)-aPagar);
  const conRet=aplicaRetenciones(anio,mes);

  const handleSave=async()=>{
    if(v.iV===""&&v.iC===""){setErr("Indica el IVA débito y el IVA crédito del F29");return;}
    setErr(""); setSaving(true);
    try{await onSave({mes:Number(mes),anio:Number(anio),ventasNetas:Number(v.vN)||0,ivaVentas:Number(v.iV)||0,comprasNetas:Number(v.cN)||0,ivaCompras:Number(v.iC)||0,
      pagadoSii:Number(pagado)||0,fechaPago:v.fecha||null});}
    catch(e){setErr(e.message);}finally{setSaving(false);};
  };

  return (
    <div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        <Field label="Mes del F29"><select style={selStyle} value={mes} onChange={e=>cambiarPeriodo(anio,Number(e.target.value))}>{MESES.map((m,i)=><option key={i} value={i+1}>{m}</option>)}</select></Field>
        <Field label="Año"><input style={iMono} type="number" value={anio} onChange={e=>cambiarPeriodo(e.target.value,mes)} /></Field>
      </div>
      {v.existe&&<div style={{fontSize:12,color:C.inkMuted,marginBottom:8}}>Este período ya tiene IVA registrado: estás editándolo.</div>}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        <Field label="Ventas netas ($)"><input style={iMono} type="number" inputMode="numeric" value={v.vN} onChange={e=>set("vN",e.target.value)} /></Field>
        <Field label="IVA débito · ventas (538)"><input style={iMono} type="number" inputMode="numeric" value={v.iV} onChange={e=>set("iV",e.target.value)} /></Field>
        <Field label="Compras netas ($)"><input style={iMono} type="number" inputMode="numeric" value={v.cN} onChange={e=>set("cN",e.target.value)} /></Field>
        <Field label="IVA crédito · compras (537)"><input style={iMono} type="number" inputMode="numeric" value={v.iC} onChange={e=>set("iC",e.target.value)} /></Field>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        <Field label="Total pagado F29 (IVA + retenciones)" hint={v.pagos>1?`${v.pagos} pagos ya registrados en Gastos: no se modifican`:"Total a pagar del F29 · se registra como gasto Impuesto SII"}>
          <input style={iMono} type="number" inputMode="numeric" value={pagado} disabled={v.pagos>1} onChange={e=>setV(p=>({...p,pagado:e.target.value,pagadoManual:true}))} />
        </Field>
        <Field label="Fecha de pago"><input style={iStyle} type="date" value={v.fecha} disabled={v.pagos>1} onChange={e=>set("fecha",e.target.value)} /></Field>
      </div>
      <div data-desglose-f29 style={{background:C.tealLight,borderRadius:9,padding:"10px 12px",fontSize:13,color:C.tealDark,fontWeight:700,marginBottom:12,lineHeight:1.5}}>
        <div>IVA neto (débito − crédito): {conSigno(ivaNeto)} · IVA a pagar: {fmt.money(aPagar)}</div>
        <div>Retenciones (PPM y otras): {fmt.money(retenciones)}</div>
        <div>Se descuenta en comisiones: {conSigno(ivaNeto+(conRet?retenciones:0))}{!conRet&&retenciones>0?" (antes de ago-2026 las retenciones no se descuentan)":""}</div>
      </div>
      {err&&<div style={{background:C.dangerLight,color:C.dangerText,borderRadius:8,padding:"8px 12px",fontSize:12.5,marginBottom:10,fontWeight:600}}>{err}</div>}
      <button onClick={handleSave} disabled={saving} style={btnP(saving?C.inkFaint:C.info)}>{saving?"Guardando…":"✓ Guardar IVA del mes"}</button>
    </div>
  );
}
