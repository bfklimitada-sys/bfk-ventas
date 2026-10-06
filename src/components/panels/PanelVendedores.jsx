import { useState, useMemo } from "react";
import { Field, Modal } from "../ui/Basicos";
import { del } from "../../lib/supabase";
import { C, MONO, btnG, btnP, fmt, iMono, iStyle, selStyle } from "../../lib/theme";
import { Ic } from "../ui/Iconos";
import { Seccion, Tarjeta, Badge, Monto, IndiceSecciones } from "../ui/Sistema";
import { evaluarPagoVendedor } from "../../lib/pagosVendedor";
import { calcularPagoVendedor, mesesConFactura, registroIvaDe, ivaNetoPeriodo, ivaAPagarPeriodo } from "../../lib/calculos";
import { estaFacturada, filtrarPanel } from "../../lib/ocs";

// Monto con signo explícito (el IVA neto puede ser negativo).
const conSigno=(n)=>(n<0?"−":"")+fmt.money(Math.abs(n));

export function PanelVendedores({ vendedores, ocs, ivaMensual, pagosVendedor, onGuardarIva, onPagoVendedor, onVerOCs, onAbrirOC }) {
  const [detalleMes,setDetalleMes]=useState(null); // "vendedor|anio|mes" con las OCs del cálculo desplegadas (Fase 4C)
  // Fase 4A: OCs sin vendedor no entran en ninguna comisión; se advierte para que no pase inadvertido.
  const sinVendedor=useMemo(()=>filtrarPanel(ocs,"sin_vendedor"),[ocs]);
  const sinVendedorFacturadas=sinVendedor.filter(estaFacturada).length;
  const [editIva,setEditIva]=useState(false);
  const [pagando,setPagando]=useState(false);
  const [pagoInicial,setPagoInicial]=useState(null); // {vendedorId,mes,anio,monto} cuando se paga desde la tarjeta
  const [abierto,setAbierto]=useState(null); // id del vendedor desplegado
  const hoy=new Date(); const mesActual=hoy.getMonth()+1; const anioActual=hoy.getFullYear();
  const MESES=["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

  // La regla de comisión vive en lib/calculos.js (una sola para toda la app).
  const datosVendedor=(v)=>mesesConFactura(v.id,ocs).map(({anio,mes})=>
    calcularPagoVendedor({vendedorId:v.id,ocs,anio,mes,ivaMensual,pagosVendedor}));

  const [verHistorialIva,setVerHistorialIva]=useState(false);
  const ivaOrdenado=useMemo(()=>ivaMensual.slice().sort((a,b)=>`${b.anio}-${String(b.mes).padStart(2,"0")}`.localeCompare(`${a.anio}-${String(a.mes).padStart(2,"0")}`)),[ivaMensual]);
  const [editandoIvaExistente,setEditandoIvaExistente]=useState(null); // null = nuevo mes actual, o el registro a editar

  return (
    <div>
      <button onClick={()=>{setPagoInicial(null);setPagando(true);}} style={{...btnP(C.tealDark),minHeight:50,fontSize:15,borderRadius:12,boxShadow:"0 4px 12px rgba(13,148,136,0.35)",marginBottom:20}}>+ Pago a vendedor</button>
      <IndiceSecciones items={[{id:"ven-comisiones",label:"Comisiones"},{id:"ven-iva",label:"IVA mensual"}]} />
      <Seccion id="ven-comisiones" titulo="Comisiones por vendedor">
      {sinVendedor.length>0&&(
        <div data-aviso="ocs-sin-vendedor" style={{display:"flex",alignItems:"center",gap:10,background:C.warnLight,border:`1px solid ${C.warn}55`,borderRadius:12,padding:"10px 12px",marginBottom:10}}>
          <span style={{flex:1,minWidth:0,fontSize:13,color:C.warnText,fontWeight:700,lineHeight:1.4}}>
            <Ic n="⚠"/> {sinVendedor.length} OC sin vendedor{sinVendedorFacturadas?` (${sinVendedorFacturadas} con factura emitida)`:""}: no entran en ninguna comisión.
          </span>
          {onVerOCs&&<button onClick={()=>onVerOCs("sin_vendedor")} style={{flexShrink:0,background:"none",border:"none",color:C.warnText,fontWeight:800,fontSize:13,cursor:"pointer",minHeight:44,padding:"0 6px"}}>Ver OCs →</button>}
        </div>
      )}
      {vendedores.map(v=>{
        const datos=datosVendedor(v);
        const ultimoPagado=datos.find(d=>d.estado==="pagado");
        const deudaTotal=datos.reduce((s,d)=>s+d.deuda,0);
        const meses=datos.filter(d=>(d.pagoCalculado||0)>0||d.pagado>0).length;
        const mesesPend=datos.filter(d=>d.deuda>0).length;
        const estaAbierto=abierto===v.id;
        return (
          <Tarjeta key={v.id} padding="0" style={{overflow:"hidden",marginBottom:8}}>
            <button onClick={()=>setAbierto(estaAbierto?null:v.id)} aria-expanded={estaAbierto}
              style={{width:"100%",background:"none",border:"none",padding:"14px 16px",textAlign:"left",cursor:"pointer",minHeight:64,
                display:"flex",alignItems:"center",gap:10}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:800,fontSize:15,color:C.ink,lineHeight:1.25}}>{v.nombre}</div>
                <div style={{display:"flex",flexWrap:"wrap",gap:6,marginTop:6}}>
                  {deudaTotal>0
                    ? <Badge tono="warn">{mesesPend} mes{mesesPend!==1?"es":""} pendiente{mesesPend!==1?"s":""}</Badge>
                    : meses>0
                      ? <Badge tono="ok">✓ Al día{ultimoPagado?` · último pago ${ultimoPagado.label}`:""}</Badge>
                      : <Badge tono="neutro">Sin ventas registradas</Badge>}
                  {meses>0&&<Badge tono="neutro">{meses} mes{meses>1?"es":""} con ventas</Badge>}
                </div>
              </div>
              <div style={{textAlign:"right",flexShrink:0}}>
                {deudaTotal>0&&<><div style={{fontSize:12,color:C.inkMuted,marginBottom:2}}>Falta pagarle</div><Monto tam="md" tono="warn">{fmt.money(deudaTotal)}</Monto></>}
              </div>
              <Ic n={estaAbierto?"chevD":"chevR"}/>
            </button>

            {deudaTotal>0&&(()=>{
              const pend=datos.filter(d=>d.deuda>0); const d=pend[pend.length-1]; // el mes pendiente más antiguo
              return (
                <div style={{padding:"0 14px 12px"}}>
                  <button onClick={()=>{setPagoInicial({vendedorId:v.id,mes:d.mes,anio:d.anio,monto:Math.round(d.deuda)});setPagando(true);}}
                    style={{...btnP(C.tealDark),minHeight:44,fontSize:14}}>Pagar {d.label} · {fmt.money(d.deuda)}</button>
                </div>
              );
            })()}

            {estaAbierto&&meses>0&&(
              <div style={{padding:"0 14px 14px"}}>
                <div style={{fontSize:12,fontWeight:800,color:C.inkMuted,textTransform:"uppercase",marginBottom:2,paddingTop:6,borderTop:`1px solid ${C.border}`}}>Comisión mes a mes</div>
                <div style={{fontSize:12,color:C.inkFaint,marginBottom:6}}>Solo se listan los meses con al menos una venta facturada — el resto no tuvo actividad.</div>
                {datos.map(d=>(
                  <div key={d.label} style={{padding:"9px 0",borderBottom:`1px solid ${C.border}`}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:3}}>
                      <span style={{fontSize:12.5,fontWeight:700,color:C.ink}}>{d.label}</span>
                      <Badge tono={d.estado==="pagado"?"ok":"warn"}>{d.estado==="pagado"?"✓ Comisión pagada":"Comisión pendiente"}</Badge>
                    </div>
                    <div style={{fontSize:12,color:C.inkFaint,marginBottom:5,lineHeight:1.7}}>
                      {d.esVerificado ? (
                        <>Comisión del mes: <b style={{color:C.ink}}>{fmt.money(d.pagoCalculado)}</b> <span style={{color:C.okText}}>✓ verificado contra planilla histórica / cartola real</span></>
                      ) : (
                        <>
                          <div>Utilidad del mes: <b style={{color:C.ink}}>+{fmt.money(d.sumaUtilidad)}</b> <span style={{color:C.inkFaint}}>(de {fmt.money(d.sumaFacts)} facturados)</span></div>
                          {d.sinIva
                            ? <div style={{color:C.inkFaint}}>Sin descuento de IVA (regla especial de ese mes)</div>
                            : d.ivaRegistrado
                              ? <div>IVA neto del período (débito {fmt.money(d.ivaVentas)} − crédito {fmt.money(d.ivaCompras)}): <b style={{color:d.impIva>0?C.dangerText:C.okText}}>{d.impIva>0?"−":d.impIva<0?"+":""}{fmt.money(Math.abs(d.impIva))}</b>{d.impIva<0&&<span style={{color:C.inkFaint}}> (crédito mayor que débito: suma)</span>}</div>
                              : <div style={{color:C.warnText}}><Ic n="⚠"/> IVA de este mes sin registrar todavía — se está calculando sin IVA neto; cambiará cuando lo cargues</div>
                          }
                          <div>Mitad de (utilidad − IVA neto): <b style={{color:C.ink}}>{conSigno(Math.round((d.sumaUtilidad-(d.sinIva?0:d.impIva))/2))}</b>{(d.sumaUtilidad-(d.sinIva?0:d.impIva))<0&&<span style={{color:C.inkFaint}}> (negativo: cuenta como $0)</span>}</div>
                          {d.pagoVentasPropias>0&&<div>+ Ventas propias (100% de esa utilidad, sin repartir): <b style={{color:C.ink}}>+{fmt.money(d.pagoVentasPropias)}</b></div>}
                          <div style={{fontWeight:800,color:C.ink,marginTop:2}}>= Comisión del mes: {fmt.money(d.pagoCalculado)}</div>
                        </>
                      )}
                    </div>
                    {/* Fase 4C: las OCs que forman el cálculo del mes (cada una entra solo por su factura vigente) */}
                    {(()=>{ const k=`${v.id}|${d.anio}|${d.mes}`; const ab=detalleMes===k; return (<>
                      <button data-ver-ocs-comision={k} onClick={()=>setDetalleMes(ab?null:k)}
                        style={{background:"none",border:"none",color:C.info,fontWeight:700,fontSize:12.5,cursor:"pointer",padding:"4px 0",minHeight:36}}>
                        {ab?"▾":"▸"} {d.detalle.length} OC{d.detalle.length!==1?"s":""} en este cálculo
                      </button>
                      {ab&&(
                        <div data-ocs-comision={k} style={{background:C.paper,border:`1px solid ${C.border}`,borderRadius:8,padding:"6px 8px",marginBottom:6}}>
                          {d.detalle.map(l=>(
                            <div key={l.ocId} style={{padding:"5px 0",borderBottom:`1px dashed ${C.border}`,fontSize:12,lineHeight:1.5}}>
                              <div style={{display:"flex",justifyContent:"space-between",gap:8}}>
                                <button onClick={()=>onAbrirOC&&onAbrirOC(l.ocId)} style={{background:"none",border:"none",padding:0,cursor:onAbrirOC?"pointer":"default",fontFamily:MONO,fontWeight:700,color:C.ink,textDecoration:onAbrirOC?"underline dotted":"none"}}>{l.numero_oc}</button>
                                <span style={{fontFamily:MONO,fontWeight:700,color:l.utilidad>=0?C.okText:C.dangerText}}>{l.utilidad>=0?"+":"−"}{fmt.money(Math.abs(l.utilidad))}</span>
                              </div>
                              <div style={{color:C.inkMuted}}>
                                Factura vigente N° {l.factura} · {l.fechaFactura?fmt.date(String(l.fechaFactura).slice(0,10)):"—"} · {fmt.money(l.montoFacturas)}
                              </div>
                              <div style={{color:C.inkFaint}}>
                                Venta {fmt.money(l.venta)} − costo {fmt.money(l.costo)} = utilidad {fmt.money(l.utilidad)}
                                {l.ventaPropia&&<> · <b style={{color:C.ink}}>venta propia</b>: 100% de la utilidad menos el IVA de su factura = {fmt.money(l.pagoVentaPropia)}</>}
                              </div>
                            </div>
                          ))}
                          <div style={{fontSize:12,color:C.inkMuted,paddingTop:5}}>
                            Utilidad (sin ventas propias): <b style={{color:C.ink}}>{fmt.money(d.sumaUtilidad)}</b>
                            {d.pagoVentasPropias>0&&<> · Ventas propias: <b style={{color:C.ink}}>{fmt.money(d.pagoVentasPropias)}</b></>}
                          </div>
                        </div>
                      )}
                    </>); })()}
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline"}}>
                      <span style={{fontSize:12,color:C.inkMuted}}>Ya se le pagó: {fmt.money(d.pagado)}</span>
                      {d.deuda>0&&<span style={{fontSize:12,fontWeight:700,color:C.dangerText}}>Falta pagarle: {fmt.money(d.deuda)}</span>}
                    </div>
                    {d.deuda>0&&(
                      <button onClick={()=>{setPagoInicial({vendedorId:v.id,mes:d.mes,anio:d.anio,monto:Math.round(d.deuda)});setPagando(true);}}
                        style={{...btnG,minHeight:40,fontSize:12.5,marginTop:6,padding:"6px 12px"}}>Pagar este mes · {fmt.money(d.deuda)}</button>
                    )}
                    {!d.esVerificado&&d.pagado>d.pagoCalculado+1000&&(
                      <div style={{fontSize:12,color:C.warnText,marginTop:3,lineHeight:1.4}}>
                        <Ic n="⚠"/> Se pagó {fmt.money(d.pagado-d.pagoCalculado)} más de lo que calcula la fórmula automática — probablemente venta propia o extra no marcado en el sistema. Revisa la nota del pago para el detalle.
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Tarjeta>
        );
      })}
      </Seccion>

      <Seccion id="ven-iva" titulo="IVA mensual" nota="Impuesto de la empresa. Su IVA neto (débito − crédito) se descuenta en las comisiones del período; no es un pago a vendedores.">
      <Tarjeta padding="14px 16px">
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
          <div style={{fontWeight:800,fontSize:14,color:C.ink}}>IVA del mes ({fmt.monthYear(mesActual,anioActual)})</div>
          <button onClick={()=>{setEditandoIvaExistente(registroIvaDe(ivaMensual,anioActual,mesActual));setEditIva(true);}} style={btnG}>{registroIvaDe(ivaMensual,anioActual,mesActual)?"Editar":"Registrar"}</button>
        </div>
        {registroIvaDe(ivaMensual,anioActual,mesActual)?(()=>{ const r=registroIvaDe(ivaMensual,anioActual,mesActual); return (<>
          <div style={{fontFamily:MONO,fontWeight:800,fontSize:22,color:C.info}}>{conSigno(ivaNetoPeriodo(r))}</div>
          <div style={{fontSize:12,color:C.inkMuted,marginTop:2}}>IVA neto = débito {fmt.money(Number(r.iva_ventas)||0)} − crédito {fmt.money(Number(r.iva_compras)||0)} · se descuenta en comisiones · a pagar al SII: {fmt.money(ivaAPagarPeriodo(r))}</div>
        </>); })():
          <div style={{fontSize:12.5,color:C.inkFaint}}>Sin registrar.</div>
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

      {pagando&&(
        <Modal title="Pago a vendedor" onClose={()=>{setPagando(false);setPagoInicial(null);}}>
          <FormPagoVendedorSimple vendedores={vendedores} ocs={ocs} ivaMensual={ivaMensual} pagosVendedor={pagosVendedor} inicial={pagoInicial} onSave={async(d)=>{await onPagoVendedor(d);setPagando(false);setPagoInicial(null);}} />
        </Modal>
      )}
      {editIva&&(
        <Modal title="IVA mensual" onClose={()=>setEditIva(false)}>
          <FormIvaMensual ivaExistente={editandoIvaExistente} onSave={async(d)=>{await onGuardarIva(d);setEditIva(false);}} />
        </Modal>
      )}
    </div>
  );
}

export function FormIvaMensual({ ivaExistente, onSave }) {
  const hoy=new Date();
  const [mes,setMes]=useState(ivaExistente?.mes||hoy.getMonth()+1);
  const [anio,setAnio]=useState(ivaExistente?.anio||hoy.getFullYear());
  const [vN,setVN]=useState(ivaExistente?.ventas_netas||""); const [iV,setIV]=useState(ivaExistente?.iva_ventas||"");
  const [cN,setCN]=useState(ivaExistente?.compras_netas||""); const [iC,setIC]=useState(ivaExistente?.iva_compras||"");
  const [err,setErr]=useState(""); const [saving,setSaving]=useState(false);
  const regForm={iva_ventas:iV,iva_compras:iC};
  const ivaNeto=ivaNetoPeriodo(regForm);
  const ivaPagado=ivaAPagarPeriodo(regForm); // se sigue guardando en iva_pagado (mismo significado que antes)
  const MESES=["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
  const handleSave=async()=>{
    setErr(""); setSaving(true);
    try{await onSave({mes:Number(mes),anio:Number(anio),ventasNetas:Number(vN)||0,ivaVentas:Number(iV)||0,comprasNetas:Number(cN)||0,ivaCompras:Number(iC)||0,ivaPagado});}
    catch(e){setErr(e.message);}finally{setSaving(false);};
  };
  return (
    <div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        <Field label="Mes"><select style={selStyle} value={mes} onChange={e=>setMes(e.target.value)}>{MESES.map((m,i)=><option key={i} value={i+1}>{m}</option>)}</select></Field>
        <Field label="Año"><input style={iMono} type="number" value={anio} onChange={e=>setAnio(e.target.value)} /></Field>
        <Field label="Ventas netas ($)"><input style={iMono} type="number" value={vN} onChange={e=>setVN(e.target.value)} /></Field>
        <Field label="IVA ventas ($)"><input style={iMono} type="number" value={iV} onChange={e=>setIV(e.target.value)} /></Field>
        <Field label="Compras netas ($)"><input style={iMono} type="number" value={cN} onChange={e=>setCN(e.target.value)} /></Field>
        <Field label="IVA compras ($)"><input style={iMono} type="number" value={iC} onChange={e=>setIC(e.target.value)} /></Field>
      </div>
      <div style={{background:C.tealLight,borderRadius:9,padding:"10px 12px",fontSize:13,color:C.tealDark,fontWeight:700,marginBottom:14}}>IVA neto del período (usado en comisiones): {conSigno(ivaNeto)} · IVA a pagar: {fmt.money(ivaPagado)}</div>
      {err&&<div style={{background:C.dangerLight,color:C.dangerText,borderRadius:8,padding:"8px 12px",fontSize:12.5,marginBottom:10,fontWeight:600}}>{err}</div>}
      <button onClick={handleSave} disabled={saving} style={btnP(saving?C.inkFaint:C.info)}>{saving?"Guardando…":"✓ Guardar IVA"}</button>
    </div>
  );
}

export function FormPagoVendedorSimple({ vendedores, ocs, ivaMensual, pagosVendedor, onSave, inicial }) {
  const [vendedorId,setVendedorId]=useState(inicial?.vendedorId||vendedores[0]?.id||"");
  const [monto,setMonto]=useState(inicial?.monto?String(inicial.monto):""); const [fecha,setFecha]=useState(new Date().toISOString().slice(0,10));
  const [mes,setMes]=useState(inicial?.mes||new Date().getMonth()+1); const [anio,setAnio]=useState(inicial?.anio||new Date().getFullYear());
  const [err,setErr]=useState(""); const [saving,setSaving]=useState(false);
  const vend=vendedores.find(v=>v.id===vendedorId);
  const MESES=["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
  const labelMes=`Ventas de ${MESES[mes-1]}/${anio}`;
  const ev=evaluarPagoVendedor({vendedorId,mes,anio,monto:Number(monto)||0,ocs,ivaMensual,pagosVendedor});
  const handleSave=async()=>{
    if(!monto||Number(monto)<=0){setErr("Indica el monto");return;}
    setErr(""); setSaving(true);
    try{await onSave({vendedorId,monto:Number(monto),fecha,mes:Number(mes),anio:Number(anio),label:labelMes});}
    catch(e){setErr(e.message);}finally{setSaving(false);};
  };
  return (
    <div>
      <Field label="Vendedor" required><select style={selStyle} value={vendedorId} onChange={e=>setVendedorId(e.target.value)}>{vendedores.map(v=><option key={v.id} value={v.id}>{v.nombre}</option>)}</select></Field>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        <Field label="Mes" required><select style={selStyle} value={mes} onChange={e=>setMes(e.target.value)}>{MESES.map((m,i)=><option key={i} value={i+1}>{m}</option>)}</select></Field>
        <Field label="Año" required><input style={iMono} type="number" value={anio} onChange={e=>setAnio(e.target.value)} /></Field>
      </div>
      <div style={{background:C.tealLight,borderRadius:9,padding:"10px 12px",fontSize:12.5,color:C.tealDark,fontWeight:700,marginBottom:12}}>{labelMes}</div>
      <Field label="Fecha de pago" required><input style={iStyle} type="date" value={fecha} onChange={e=>setFecha(e.target.value)} /></Field>
      <Field label="Monto pagado ($)" required><input style={iMono} type="number" value={monto} onChange={e=>setMonto(e.target.value)} /></Field>
      <div style={{background:C.paper,borderRadius:9,padding:"10px 12px",marginBottom:12,fontSize:12,color:C.inkMuted,lineHeight:1.6}}>
        <div>Comisión del período: <b>{fmt.money(ev.comision)}</b> · Ya pagado: <b>{fmt.money(ev.pagadoAntes)}</b></div>
        <div>Pendiente antes de este pago: <b>{fmt.money(ev.pendienteAntes)}</b></div>
        {Number(monto)>0&&<div style={{color:ev.completo?C.tealDark:C.warnText||C.inkMuted,fontWeight:700}}>
          Pendiente después: {fmt.money(ev.pendiente)}{ev.excedente>0?` · excedente ${fmt.money(ev.excedente)} (no se traslada a otro mes)`:""}
        </div>}
        <div>Las OC del período se marcan como pagadas solo cuando el pago acumulado cubre la comisión{Number(monto)>0&&ev.completo?` (se marcarán ${ev.ocIds.length})`:""}.</div>
      </div>
      {err&&<div style={{background:C.dangerLight,color:C.dangerText,borderRadius:8,padding:"8px 12px",fontSize:12.5,marginBottom:10,fontWeight:600}}>{err}</div>}
      <button onClick={handleSave} disabled={saving} style={btnP(saving?C.inkFaint:C.teal)}>{saving?"Guardando…":"✓ Registrar pago"}</button>
    </div>
  );
}
