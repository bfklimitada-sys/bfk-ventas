import { useState, useEffect } from "react";
import { BuscadorOC, Field } from "../ui/Basicos";
import { C, MONO, btnP, fmt, iMono, iStyle, selStyle } from "../../lib/theme";

export function FormConfirmarEntrega({ ocs, onSave, ocPreseleccionada }) {
  const [ocId,setOcId]=useState(ocPreseleccionada||null); const [fecha,setFecha]=useState(new Date().toISOString().slice(0,10));
  const [persona,setPersona]=useState(""); const [err,setErr]=useState(""); const [saving,setSaving]=useState(false);
  const handleSave=async()=>{ if(!ocId){setErr("Selecciona la OC");return;} setErr(""); setSaving(true); try{await onSave({ocId,fecha,personaRecibe:persona});}catch(e){setErr(e.message);}finally{setSaving(false);} };
  return (
    <div>
      {!ocPreseleccionada&&<Field label="Orden de Compra" required><BuscadorOC ocs={ocs} ocId={ocId} setOcId={setOcId} /></Field>}
      <Field label="Fecha de entrega" required><input style={iStyle} type="date" value={fecha} onChange={e=>setFecha(e.target.value)} /></Field>
      <Field label="Persona que recibe"><input style={iStyle} value={persona} onChange={e=>setPersona(e.target.value)} /></Field>
      {err&&<div style={{background:C.dangerLight,color:C.danger,borderRadius:8,padding:"8px 12px",fontSize:12.5,marginBottom:10,fontWeight:600}}>{err}</div>}
      <button onClick={handleSave} disabled={saving} style={btnP(saving?C.inkFaint:C.transit)}>{saving?"Guardando…":"✓ Confirmar entrega"}</button>
    </div>
  );
}

export function FormEmitirFactura({ ocs, onSave, ocPreseleccionada }) {
  const [ocId,setOcId]=useState(ocPreseleccionada||null); const [fecha,setFecha]=useState(new Date().toISOString().slice(0,10));
  const [numFact,setNumFact]=useState(""); const [monto,setMonto]=useState("");
  const [notaCredito,setNotaCredito]=useState(""); const [motivoDif,setMotivoDif]=useState("");
  const [err,setErr]=useState(""); const [saving,setSaving]=useState(false);
  const selected=ocs.find(o=>o.id===ocId);
  const facturaAnterior=(selected?.eventos_factura||[])[0];
  const esReemision=!!facturaAnterior;
  useEffect(()=>{ if(selected&&!monto) setMonto(String(selected.monto_total||"")); },[selected]);

  // Diferencia entre lo facturado y lo que dice la OC (ajustes del SII, redondeos)
  const montoOC=Number(selected?.monto_total)||0;
  const montoFact=Number(monto)||0;
  const dif=montoFact-montoOC;
  const hayDif=selected&&montoFact>0&&Math.abs(dif)>0;
  const difGrande=Math.abs(dif)>Math.max(1000,montoOC*0.02); // >2% o >$1.000

  const handleSave=async()=>{
    if(!ocId){setErr("Selecciona la OC");return;} if(!numFact.trim()){setErr("Indica el número de factura");return;}
    if(!monto||montoFact<=0){setErr("Indica el monto");return;}
    if(esReemision&&!notaCredito.trim()){setErr("Esta OC ya tiene una factura — indica el N° de nota de crédito que la anula");return;}
    if(difGrande&&!motivoDif.trim()){setErr("La diferencia con la OC es grande — explica el motivo");return;}
    setErr(""); setSaving(true);
    try{await onSave({ocId,fecha,numeroFactura:numFact.trim(),monto:montoFact,esReemision,notaCredito:notaCredito.trim(),facturaAnuladaNumero:facturaAnterior?.numero_factura,motivoDiferencia:hayDif?(motivoDif.trim()||null):null});}
    catch(e){setErr(e.message);}finally{setSaving(false);};
  };
  return (
    <div>
      {!ocPreseleccionada&&<Field label="Orden de Compra" required><BuscadorOC ocs={ocs} ocId={ocId} setOcId={setOcId} /></Field>}
      {esReemision&&(
        <div style={{background:C.warnLight,borderRadius:9,padding:"10px 12px",fontSize:12,color:C.warn,fontWeight:600,marginBottom:14}}>
          Esta OC ya tiene la factura N°{facturaAnterior.numero_factura} ({fmt.date(facturaAnterior.fecha)}). Si la estás reemplazando, indica la nota de crédito que la anula — el pago al vendedor solo contará esta venta una vez.
        </div>
      )}
      <Field label="Fecha de emisión" required><input style={iStyle} type="date" value={fecha} onChange={e=>setFecha(e.target.value)} /></Field>
      <Field label="N° factura" required><input style={iMono} value={numFact} onChange={e=>setNumFact(e.target.value)} placeholder="ej: 215" /></Field>
      <Field label="Monto ($)" required hint="Autocompletado con el monto de la OC — ajústalo si el SII cuadró distinto"><input style={iMono} type="number" value={monto} onChange={e=>setMonto(e.target.value)} /></Field>
      {hayDif&&(
        <div style={{background:difGrande?C.warnLight:C.paper,border:`1px solid ${difGrande?C.warn:C.border}`,borderRadius:9,padding:"10px 12px",marginBottom:14}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:difGrande?8:0}}>
            <span style={{fontSize:12,color:C.inkMuted}}>Difiere de la OC ({fmt.money(montoOC)})</span>
            <span style={{fontSize:13,fontWeight:800,fontFamily:MONO,color:difGrande?C.warn:C.inkMuted}}>{dif>0?"+":""}{fmt.money(dif)}</span>
          </div>
          {difGrande&&<div style={{fontSize:11.5,color:C.warn,fontWeight:600}}>⚠ Diferencia relevante — deja registrado por qué</div>}
        </div>
      )}
      {hayDif&&(
        <Field label={`Motivo de la diferencia${difGrande?" *":""}`} hint="Queda guardado en la factura para revisarlo después">
          <input style={iStyle} value={motivoDif} onChange={e=>setMotivoDif(e.target.value)} placeholder="ej: ajuste por redondeo del SII" />
        </Field>
      )}
      {esReemision&&<Field label="N° Nota de crédito (anula factura anterior)" required><input style={iMono} value={notaCredito} onChange={e=>setNotaCredito(e.target.value)} placeholder="ej: 123" /></Field>}
      {err&&<div style={{background:C.dangerLight,color:C.danger,borderRadius:8,padding:"8px 12px",fontSize:12.5,marginBottom:10,fontWeight:600}}>{err}</div>}
      <button onClick={handleSave} disabled={saving} style={btnP(saving?C.inkFaint:C.info)}>{saving?"Guardando…":esReemision?"✓ Reemitir factura":"✓ Registrar factura"}</button>
    </div>
  );
}

export function FormPagoCliente({ ocs, onSave, ocPreseleccionada }) {
  const [ocId,setOcId]=useState(ocPreseleccionada||null); const [fecha,setFecha]=useState(new Date().toISOString().slice(0,10));
  const [monto,setMonto]=useState(""); const [err,setErr]=useState(""); const [saving,setSaving]=useState(false);
  const selected=ocs.find(o=>o.id===ocId);
  const saldo=(selected?.monto_facturado||0)-(selected?.monto_cobrado||0);
  useEffect(()=>{ if(selected&&!monto) setMonto(String(saldo||"")); },[selected]);
  const handleSave=async()=>{
    if(!ocId){setErr("Selecciona la OC");return;} if(!monto||Number(monto)<=0){setErr("Indica el monto");return;}
    setErr(""); setSaving(true); try{await onSave({ocId,fecha,monto:Number(monto)});}catch(e){setErr(e.message);}finally{setSaving(false);};
  };
  return (
    <div>
      {!ocPreseleccionada&&<Field label="Orden de Compra" required><BuscadorOC ocs={ocs} ocId={ocId} setOcId={setOcId} /></Field>}
      {selected&&<div style={{background:C.paper,borderRadius:8,padding:"8px 12px",fontSize:12,color:C.inkMuted,marginBottom:12}}>Facturado: <b style={{color:C.ink}}>{fmt.money(selected.monto_facturado)}</b> · Cobrado: <b style={{color:C.ok}}>{fmt.money(selected.monto_cobrado)}</b> · Saldo: <b style={{color:C.danger}}>{fmt.money(saldo)}</b></div>}
      <Field label="Fecha de pago" required><input style={iStyle} type="date" value={fecha} onChange={e=>setFecha(e.target.value)} /></Field>
      <Field label="Monto pagado ($)" required><input style={iMono} type="number" value={monto} onChange={e=>setMonto(e.target.value)} /></Field>
      {err&&<div style={{background:C.dangerLight,color:C.danger,borderRadius:8,padding:"8px 12px",fontSize:12.5,marginBottom:10,fontWeight:600}}>{err}</div>}
      <button onClick={handleSave} disabled={saving} style={btnP(saving?C.inkFaint:C.ok)}>{saving?"Guardando…":"✓ Registrar pago"}</button>
    </div>
  );
}

export function FormPagoFinanciamiento({ ocs, financiadores, onSave, ocPreseleccionada, financiadorPreseleccionado }) {
  const [finId,setFinId]=useState(financiadorPreseleccionado||financiadores[0]?.id||""); const [ocId,setOcId]=useState(ocPreseleccionada||null);
  const [fecha,setFecha]=useState(new Date().toISOString().slice(0,10)); const [monto,setMonto]=useState("");
  const [err,setErr]=useState(""); const [saving,setSaving]=useState(false);
  const fin=financiadores.find(f=>f.id===finId);
  const handleSave=async()=>{
    if(!monto||Number(monto)<=0){setErr("Indica el monto");return;}
    setErr(""); setSaving(true); try{await onSave({financiadorId:finId,ocId,fecha,monto:Number(monto)});}catch(e){setErr(e.message);}finally{setSaving(false);};
  };
  return (
    <div>
      <Field label="Financiador" required><select style={selStyle} value={finId} onChange={e=>setFinId(e.target.value)}>{financiadores.map(f=><option key={f.id} value={f.id}>{f.nombre}</option>)}</select></Field>
      {fin&&<div style={{background:C.paper,borderRadius:8,padding:"8px 12px",fontSize:12,color:C.inkMuted,marginBottom:12}}>Deuda actual: <b style={{color:C.danger}}>{fmt.money(fin.saldo_deuda)}</b></div>}
      {!ocPreseleccionada&&<Field label="OC relacionada (opcional)"><BuscadorOC ocs={ocs} ocId={ocId} setOcId={setOcId} /></Field>}
      <Field label="Fecha" required><input style={iStyle} type="date" value={fecha} onChange={e=>setFecha(e.target.value)} /></Field>
      <Field label="Monto ($)" required hint="Se descuenta de la deuda automáticamente"><input style={iMono} type="number" value={monto} onChange={e=>setMonto(e.target.value)} /></Field>
      {err&&<div style={{background:C.dangerLight,color:C.danger,borderRadius:8,padding:"8px 12px",fontSize:12.5,marginBottom:10,fontWeight:600}}>{err}</div>}
      <button onClick={handleSave} disabled={saving} style={btnP(saving?C.inkFaint:C.purple)}>{saving?"Guardando…":"✓ Registrar pago a financiador"}</button>
    </div>
  );
}
