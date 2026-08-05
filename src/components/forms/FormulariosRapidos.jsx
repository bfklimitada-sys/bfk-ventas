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

  const entregada=selected&&(selected.estado_entrega==="confirmada"||selected.estado_entrega==="entregado");
  const [confirmoSinEntrega,setConfirmoSinEntrega]=useState(false);

  const handleSave=async()=>{
    if(!ocId){setErr("Selecciona la OC");return;}
    if(selected&&!entregada&&!confirmoSinEntrega){
      setErr("Esta OC no tiene la entrega registrada. Regístrala primero, o marca la casilla para continuar igual.");return;}
    if(!numFact.trim()){setErr("Indica el número de factura");return;}
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
      {selected&&!entregada&&(
        <div style={{background:C.warnLight,border:`1px solid ${C.warn}`,borderRadius:9,padding:"10px 12px",marginBottom:14}}>
          <div style={{fontSize:12,fontWeight:700,color:C.warn,marginBottom:6}}>⚠ Sin entrega registrada</div>
          <div style={{fontSize:11.5,color:C.inkMuted,lineHeight:1.45,marginBottom:8}}>
            Lo normal es registrar la entrega antes de facturar. Si ya se entregó y solo faltó anotarlo,
            puedes continuar — pero conviene registrarla para que quede la fecha y el respaldo.
          </div>
          <label style={{display:"flex",alignItems:"flex-start",gap:7,cursor:"pointer"}}>
            <input type="checkbox" checked={confirmoSinEntrega} onChange={e=>{setConfirmoSinEntrega(e.target.checked);setErr("");}} style={{marginTop:2}} />
            <span style={{fontSize:11.5,color:C.ink,fontWeight:600}}>Facturar igual, la entrega se registra después</span>
          </label>
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
  const [medioPago,setMedioPago]=useState("transferencia");
  const [cobradoEnBanco,setCobradoEnBanco]=useState(true);
  const [institucion,setInstitucion]=useState("");
  const selected=ocs.find(o=>o.id===ocId);
  const saldo=(selected?.monto_facturado||0)-(selected?.monto_cobrado||0);
  useEffect(()=>{ if(selected&&!monto) setMonto(String(saldo||"")); },[selected]);
  const sinFactura=selected&&selected.estado_factura_propia!=="emitida";

  const handleSave=async()=>{
    if(!ocId){setErr("Selecciona la OC");return;}
    if(sinFactura){setErr("Esta OC no tiene factura emitida. Registra primero la factura.");return;}
    if(!monto||Number(monto)<=0){setErr("Indica el monto");return;}
    setErr(""); setSaving(true); try{await onSave({ocId,fecha,monto:Number(monto),medioPago,cobradoEnBanco,institucion:institucion.trim()||null});}catch(e){setErr(e.message);}finally{setSaving(false);};
  };
  return (
    <div>
      {!ocPreseleccionada&&<Field label="Orden de Compra" required><BuscadorOC ocs={ocs} ocId={ocId} setOcId={setOcId} /></Field>}
      {sinFactura&&(
        <div style={{background:C.dangerLight,border:`1px solid ${C.danger}`,borderRadius:9,padding:"10px 12px",marginBottom:14,fontSize:12,color:C.danger,fontWeight:600}}>
          ⚠ Sin factura emitida — no se puede registrar el cobro. Emite la factura primero.
        </div>
      )}
      {selected&&!sinFactura&&<div style={{background:C.paper,borderRadius:8,padding:"8px 12px",fontSize:12,color:C.inkMuted,marginBottom:12}}>Facturado: <b style={{color:C.ink}}>{fmt.money(selected.monto_facturado)}</b> · Cobrado: <b style={{color:C.ok}}>{fmt.money(selected.monto_cobrado)}</b> · Saldo: <b style={{color:C.danger}}>{fmt.money(saldo)}</b></div>}
      <Field label="Fecha de pago" required><input style={iStyle} type="date" value={fecha} onChange={e=>setFecha(e.target.value)} /></Field>
      <Field label="Monto pagado ($)" required><input style={iMono} type="number" value={monto} onChange={e=>setMonto(e.target.value)} /></Field>
      <Field label="Medio de pago" hint="Algunas entidades transfieren directo, otras generan vale vista o cheque que hay que ir a cobrar">
        <select style={selStyle} value={medioPago} onChange={e=>{
            const val=e.target.value; setMedioPago(val);
            setCobradoEnBanco(val==="transferencia");
          }}>
          <option value="transferencia">Transferencia</option>
          <option value="vale_vista">Vale Vista</option>
          <option value="cheque">Cheque</option>
        </select>
      </Field>
      {medioPago!=="transferencia"&&(
        <Field label="Institución (banco)" hint="Dónde hay que ir a cobrarlo">
          <input style={iStyle} value={institucion} onChange={e=>setInstitucion(e.target.value)}
            placeholder="ej: BancoEstado, Banco de Chile…" />
        </Field>
      )}
      {medioPago!=="transferencia"&&(
        <label style={{display:"flex",alignItems:"flex-start",gap:9,marginBottom:14,cursor:"pointer",
          background:cobradoEnBanco?C.okLight:C.warnLight,borderRadius:10,padding:"10px 12px"}}>
          <input type="checkbox" checked={cobradoEnBanco} onChange={e=>setCobradoEnBanco(e.target.checked)}
            style={{marginTop:2,width:16,height:16,flexShrink:0}} />
          <span>
            <span style={{display:"block",fontSize:12.5,fontWeight:700,color:C.ink}}>Ya lo cobré / depositó en el banco</span>
            <span style={{display:"block",fontSize:11,color:C.inkFaint,marginTop:1}}>
              {cobradoEnBanco?"Se cuenta como plata real en la cuenta.":"El cliente pagó, pero esta plata todavía no está en el banco — aparecerá en \"Vale vistas por cobrar\" hasta que la marques cobrada."}
            </span>
          </span>
        </label>
      )}
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
