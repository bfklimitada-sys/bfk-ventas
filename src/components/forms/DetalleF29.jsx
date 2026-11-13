import { useState } from "react";
import { Field } from "../ui/Basicos";
import { Badge } from "../ui/Sistema";
import { C, MONO, btnG, btnP, fmt, iMono, iStyle } from "../../lib/theme";
import { aplicaRetenciones, registroIvaDe } from "../../lib/calculos";
import { desgloseF29 } from "../../lib/f29";
import { gastosImpuestoDe } from "../../lib/ivaUnificado";
import { leerMontoF29, ETIQUETA_PENDIENTE } from "../../lib/f29Desglose";
import { genId } from "../../lib/supabase";
import { hoyChile } from "../../lib/fechaChile";

const MESES=["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
const conSigno=(n)=>(n<0?"−":"")+fmt.money(Math.abs(n));
const pendiente=<span style={{color:C.warnText,fontWeight:600}}>Pendiente</span>;
const monto=(v)=>v===null?pendiente:fmt.money(v);

// Estado de un período F29 (misma regla en la lista y en el detalle).
export const estadoF29=(d)=>{
  if(!d.declarado) return {tono:"warn",texto:"Sin F29 registrado"};
  if(d.pend>0) return {tono:"danger",texto:`Declarado · pendiente de pago ${fmt.money(d.pend)}`};
  if(d.faltaTotalF29) return {tono:"warn",texto:"Declarado · faltan datos"};
  if(d.det===0&&d.pag===0) return {tono:"ok",texto:"Declarado · $0 a pagar"};
  return {tono:"ok",texto:"Pagado"};
};

// Vista del período (13/11/2026): desglose del F29 declarado, pagos vigentes del período, saldo pendiente y registro de un
// pago REALIZADO (monto y fecha reales → un gasto «Impuesto SII»). El id del pago se fija al abrir el formulario: un
// segundo envío no se registra dos veces.
export function DetalleF29({ ivaMensual=[], gastos=[], anio, mes, onEditar, onPagar }) {
  const d={...desgloseF29(ivaMensual,gastos,anio,mes),registro:registroIvaDe(ivaMensual,anio,mes)};
  d.declarado=!!d.registro;
  const x=d.desglose;
  const pagos=gastosImpuestoDe(gastos,anio,mes).slice().sort((a,b)=>String(a.fecha||"").localeCompare(String(b.fecha||"")));
  const est=estadoF29(d);
  const nuevoPago=()=>({id:genId("gas"),monto:d.pend>0?String(d.pend):"",fecha:hoyChile()});
  const [pago,setPago]=useState(null);
  const [err,setErr]=useState(""); const [saving,setSaving]=useState(false);
  const conRet=aplicaRetenciones(anio,mes);
  const fila=(dato,etiqueta,valor,fuerte)=>(
    <div data-detalle={dato} style={{display:"flex",justifyContent:"space-between",gap:10,padding:"4px 0",fontWeight:fuerte?700:500,borderBottom:fuerte?"none":`1px solid ${C.border}`}}>
      <span style={{color:C.inkMuted}}>{etiqueta}</span><span style={{fontFamily:MONO,color:C.ink,whiteSpace:"nowrap"}}>{valor}</span>
    </div>
  );
  const registrar=async()=>{
    const m=leerMontoF29(pago.monto);
    if(m.error||!(m.valor>0)){ setErr("Indica el monto pagado (mayor que $0)"); return; }
    setErr(""); setSaving(true);
    try{ await onPagar({id:pago.id,anio,mes,monto:m.valor,fecha:pago.fecha}); setPago(null); }
    catch(e){ setErr(e.message); } finally{ setSaving(false); }
  };
  return (
    <div data-detalle-f29={`${anio}-${mes}`} style={{fontSize:13}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,marginBottom:10}}>
        <span style={{fontWeight:700,fontSize:15,color:C.ink}}>F29 {MESES[mes-1]} {anio}</span>
        <Badge tono={est.tono}><span data-estado-f29>{est.texto}</span></Badge>
      </div>
      {!d.declarado?<div style={{color:C.inkMuted,marginBottom:10}}>Este período aún no tiene su F29 registrado.</div>:x?(<>
        {fila("ventas-netas","Ventas netas",fmt.money(Number(d.registro?.ventas_netas)||0))}
        {fila("compras-netas","Compras netas",fmt.money(Number(d.registro?.compras_netas)||0))}
        {fila("iva-debito","IVA débito",fmt.money(x.debito))}
        {fila("iva-credito","IVA crédito",fmt.money(x.credito))}
        {fila("iva-neto","IVA neto del mes",conSigno(x.ivaNeto))}
        {fila("remanente-anterior","(−) Remanente anterior reajustado",monto(x.remanente))}
        {fila("iva-a-pagar","IVA a pagar",monto(x.ivaAPagar))}
        {fila("remanente-siguiente",`Remanente para ${MESES[mes%12]}`,monto(x.remanenteSiguiente))}
        {fila("ppm","PPM",monto(x.ppm))}
        {fila("otras","Otras retenciones",monto(x.otras))}
        {fila("total-f29","Total a pagar F29",x.total===null?pendiente:fmt.money(x.total),true)}
        {fila("descuento-comisiones","Descuento tributario para comisiones",!conRet?`${conSigno(x.ivaNeto)} (solo IVA neto)`:x.descuentoComisiones===null?pendiente:conSigno(x.descuentoComisiones),true)}
        {x.pendientes.length>0&&<div style={{fontSize:12,color:C.warnText,fontWeight:600,margin:"4px 0"}}>Pendiente de ingresar: {x.pendientes.map(p=>ETIQUETA_PENDIENTE[p]).join(", ")}.</div>}
      </>):(<>
        <div data-f29-anterior style={{fontSize:12,color:C.inkFaint,marginBottom:4}}>Registro anterior sin desglose (cálculo de siempre).</div>
        {fila("iva-a-pagar","IVA a pagar",fmt.money(d.iva))}
        {fila("ppm","PPM y retenciones",fmt.money(d.ppm))}
        {fila("total-f29","Total F29",fmt.money(d.det),true)}
        {d.faltaTotalF29&&<div style={{fontSize:12,color:C.warnText,fontWeight:600}}>Falta registrar el total del F29 (PPM): el pendiente puede ser mayor.</div>}
      </>)}
      <div style={{marginTop:12,fontWeight:700,color:C.ink}}>Pagos registrados</div>
      {pagos.length===0&&<div data-sin-pagos style={{color:C.inkFaint,padding:"4px 0"}}>Sin pagos registrados.</div>}
      {pagos.map(g=>(
        <div key={g.id} data-pago-f29={g.id} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:`1px solid ${C.border}`}}>
          <span style={{color:C.inkMuted}}>{fmt.date?fmt.date(g.fecha):String(g.fecha||"").slice(0,10)}{g.subcategoria&&g.subcategoria!=="IVA Mensual"?` · ${g.subcategoria}`:""}</span>
          <span style={{fontFamily:MONO}}>{fmt.money(Number(g.monto)||0)}</span>
        </div>
      ))}
      <div data-saldo-f29={d.pend} style={{display:"flex",justifyContent:"space-between",padding:"8px 0",fontWeight:700}}>
        <span>Saldo pendiente</span><span style={{fontFamily:MONO,color:d.pend>0?C.dangerText:C.okText}}>{fmt.money(d.pend)}</span>
      </div>
      {pago?(
        <div data-form-pago-f29 style={{background:C.relleno,borderRadius:8,padding:"10px 12px",marginTop:6}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <Field label="Monto pagado ($)"><input data-pago-monto style={iMono} type="text" inputMode="numeric" value={pago.monto} onChange={e=>setPago(p=>({...p,monto:e.target.value}))} /></Field>
            <Field label="Fecha real del pago"><input data-pago-fecha style={iStyle} type="date" value={pago.fecha} max={hoyChile()} onChange={e=>setPago(p=>({...p,fecha:e.target.value}))} /></Field>
          </div>
          <div style={{fontSize:12,color:C.inkMuted,marginBottom:8}}>Se registra una salida de caja en Gastos › Impuesto SII del período {String(mes).padStart(2,"0")}/{anio}.</div>
          {err&&<div style={{background:C.dangerLight,color:C.dangerText,borderRadius:8,padding:"8px 12px",marginBottom:8,fontWeight:500}}>{err}</div>}
          <div style={{display:"flex",gap:8}}>
            <button data-pago-confirmar onClick={registrar} disabled={saving} style={{...btnP(saving?C.inkFaint:C.info),flex:1}}>{saving?"Registrando…":"✓ Registrar pago realizado"}</button>
            <button onClick={()=>{setPago(null);setErr("");}} style={btnG}>Cancelar</button>
          </div>
        </div>
      ):(
        <div style={{display:"flex",gap:8,marginTop:6,flexWrap:"wrap"}}>
          {onEditar&&<button data-f29-editar onClick={onEditar} style={btnG}>{d.declarado?"Editar F29":"Registrar F29"}</button>}
          {d.declarado&&d.pend>0&&onPagar&&<button data-f29-registrar-pago onClick={()=>{setErr("");setPago(nuevoPago());}} style={btnG}>Registrar pago realizado</button>}
        </div>
      )}
    </div>
  );
}
