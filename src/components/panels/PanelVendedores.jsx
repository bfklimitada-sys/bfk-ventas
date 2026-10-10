import { useState, useMemo } from "react";
import { Field, Modal } from "../ui/Basicos";
import { del } from "../../lib/supabase";
import { C, MONO, btnG, btnP, fmt, iMono, iStyle, selStyle } from "../../lib/theme";
import { Ic } from "../ui/Iconos";
import { Seccion, Tarjeta, Badge, Monto, IndiceSecciones } from "../ui/Sistema";
import { evaluarPagoVendedor, pagoParecido } from "../../lib/pagosVendedor";
import { calcularPagoVendedor, mesesConFactura, registroIvaDe, ivaNetoPeriodo, ivaAPagarPeriodo, totalTransferido, extraGestion, comisionProvisoria, estadoComisionMes, motivoProvisoria, ESTADOS_COMISION } from "../../lib/calculos";
import { estaFacturada, filtrarPanel } from "../../lib/ocs";
import { FormIvaMensual } from "../forms/FormIvaMensual";
import { periodosIvaIncompletos } from "../../lib/ivaUnificado";

// Monto con signo explícito (el IVA neto puede ser negativo).
const conSigno=(n)=>(n<0?"−":"")+fmt.money(Math.abs(n));

export function PanelVendedores({ vendedores, ocs, ivaMensual, gastos=[], pagosVendedor, onGuardarIva, onPagoVendedor, onAnularPago, esAdmin, onVerOCs, onAbrirOC }) {
  const [anulando,setAnulando]=useState(null); // pago a anular (solo administrador)
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
  // Estado de cada mes (regla única, lib/calculos.js): solo «pendiente» es deuda exigible.
  const datosVendedor=(v)=>mesesConFactura(v.id,ocs).map(({anio,mes})=>{
    const c=calcularPagoVendedor({vendedorId:v.id,ocs,anio,mes,ivaMensual,pagosVendedor});
    return {...c,estadoComision:estadoComisionMes(c,hoy),provisoria:comisionProvisoria(c)};
  });
  // Por qué no se puede pagar todavía un mes no exigible (botón deshabilitado).
  const motivoNoPagable=(d)=>d.estadoComision==="en_curso"
    ?`Mes en curso: se paga después del cierre y de registrar el IVA y el F29 de ${d.label}.`
    :`Comisión provisoria (${motivoProvisoria(d)}): se podrá pagar al registrar el IVA y el total del F29 de ${d.label}.`;

  const [verHistorialIva,setVerHistorialIva]=useState(false);
  const ivaOrdenado=useMemo(()=>ivaMensual.slice().sort((a,b)=>`${b.anio}-${String(b.mes).padStart(2,"0")}`.localeCompare(`${a.anio}-${String(a.mes).padStart(2,"0")}`)),[ivaMensual]);
  const [editandoIvaExistente,setEditandoIvaExistente]=useState(null); // null = mes sugerido, o {anio,mes} del período a editar/completar
  const ivaIncompletos=useMemo(()=>periodosIvaIncompletos({gastos,ivaMensual}),[gastos,ivaMensual]);

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
        const suma=(e)=>datos.filter(d=>d.estadoComision===e).reduce((s,d)=>s+d.deuda,0);
        const deudaTotal=suma("pendiente");          // «Falta pagarle»: solo comisiones definitivas impagas
        const porLiquidar=suma("por_liquidar"), enCurso=suma("en_curso");
        const meses=datos.filter(d=>(d.pagoCalculado||0)>0||d.pagado>0).length;
        const mesesPend=datos.filter(d=>d.estadoComision==="pendiente").length;
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
                    ? <Badge tono="warn">{mesesPend} mes{mesesPend!==1?"es":""} pendiente{mesesPend!==1?"s":""} de pago</Badge>
                    : meses>0
                      ? <Badge tono="ok">✓ Al día{ultimoPagado?` · último pago ${ultimoPagado.label}`:""}</Badge>
                      : <Badge tono="neutro">Sin ventas registradas</Badge>}
                  {porLiquidar>0&&<span data-vendedor-por-liquidar={v.id}><Badge tono="warn">Por liquidar (provisoria) {fmt.money(porLiquidar)}</Badge></span>}
                  {enCurso>0&&<span data-vendedor-en-curso={v.id}><Badge tono="neutro">En curso {fmt.money(enCurso)}</Badge></span>}
                  {meses>0&&<Badge tono="neutro">{meses} mes{meses>1?"es":""} con ventas</Badge>}
                </div>
              </div>
              <div style={{textAlign:"right",flexShrink:0}}>
                {deudaTotal>0&&<span data-vendedor-exigible={v.id}><div style={{fontSize:12,color:C.inkMuted,marginBottom:2}}>Falta pagarle</div><Monto tam="md" tono="warn">{fmt.money(deudaTotal)}</Monto></span>}
              </div>
              <Ic n={estaAbierto?"chevD":"chevR"}/>
            </button>

            {datos.some(d=>d.deuda>0)&&(()=>{
              // Mes más antiguo pendiente de pago; si no hay ninguno exigible, el más antiguo por liquidar o en curso (botón deshabilitado).
              const pend=datos.filter(d=>d.estadoComision==="pendiente"), resto=datos.filter(d=>d.deuda>0&&d.estadoComision!=="pendiente");
              const d=(pend.length?pend:resto)[(pend.length?pend:resto).length-1]; const pagable=d.estadoComision==="pendiente";
              return (
                <div style={{padding:"0 14px 12px"}}>
                  <button data-pagar-vendedor={v.id} disabled={!pagable} onClick={pagable?()=>{setPagoInicial({vendedorId:v.id,mes:d.mes,anio:d.anio,monto:Math.round(d.deuda)});setPagando(true);}:undefined}
                    style={{...btnP(pagable?C.tealDark:C.inkFaint),minHeight:44,fontSize:14,cursor:pagable?"pointer":"not-allowed",opacity:pagable?1:0.75}}>Pagar {d.label} · {fmt.money(d.deuda)}{pagable?"":` · ${d.estadoComision==="en_curso"?"en curso":"por liquidar"}`}</button>
                  {!pagable&&<div data-motivo-no-pagable={v.id} style={{fontSize:12,color:C.inkMuted,marginTop:4,lineHeight:1.4}}>{motivoNoPagable(d)}</div>}
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
                      <span style={{display:"flex",gap:4,flexWrap:"wrap",justifyContent:"flex-end"}}>
                        {/* Cierre financiero: sin IVA o sin total del F29 el cálculo no es definitivo (misma regla que el Panel) */}
                        {d.provisoria&&d.estadoComision!=="en_curso"&&<span data-comision-provisoria><Badge tono="warn">Provisoria · {motivoProvisoria(d)}</Badge></span>}
                        <span data-estado-comision={d.estadoComision}><Badge tono={d.estadoComision==="pagada"?"ok":d.estadoComision==="pendiente"?"warn":"neutro"}>{d.estadoComision==="pagada"?"✓ ":""}{ESTADOS_COMISION[d.estadoComision]}</Badge></span>
                      </span>
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
                              : <div style={{color:C.warnText}}><Ic n="⚠"/> IVA de este mes sin registrar todavía — se está calculando sin IVA neto; cambiará cuando lo cargues{" "}<button onClick={()=>{setEditandoIvaExistente({anio:d.anio,mes:d.mes});setEditIva(true);}} style={{background:"none",border:"none",color:C.info,fontSize:12.5,fontWeight:700,cursor:"pointer",textDecoration:"underline",padding:0}}>Registrar IVA de {fmt.monthYear(d.mes,d.anio)}</button></div>
                          }
                          {!d.sinIva&&d.retenciones>0&&<div>Retenciones del F29 (PPM y otras): <b style={{color:C.dangerText}}>−{fmt.money(d.retenciones)}</b> <span style={{color:C.inkFaint}}>· total F29 descontado {fmt.money(d.descuentoF29)}</span></div>}
                          <div>Mitad de (utilidad − IVA neto{d.retenciones>0?" − retenciones":""}): <b style={{color:C.ink}}>{conSigno(Math.round((d.sumaUtilidad-(d.sinIva?0:d.descuentoF29))/2))}</b>{(d.sumaUtilidad-(d.sinIva?0:d.descuentoF29))<0&&<span style={{color:C.inkFaint}}> (negativo: cuenta como $0)</span>}</div>
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
                      <span style={{fontSize:12,color:C.inkMuted}}>Comisión pagada: {fmt.money(d.pagado)}</span>
                      {d.deuda>0&&(d.estadoComision==="pendiente"
                        ?<span style={{fontSize:12,fontWeight:700,color:C.dangerText}}>Falta pagarle: {fmt.money(d.deuda)}</span>
                        :<span style={{fontSize:12,fontWeight:700,color:C.warnText}}>{d.estadoComision==="en_curso"?"En curso (acumulado)":"Por liquidar"}: {fmt.money(d.deuda)}</span>)}
                    </div>
                    {d.extraGestion>0&&<div data-extra-gestion style={{fontSize:12,color:C.inkMuted}}>Extra por gestión (aparte de la comisión): <b style={{color:C.ink}}>{fmt.money(d.extraGestion)}</b> · total transferido {fmt.money(d.transferido)}</div>}
                    {d.porRegularizar>0&&d.pagos.some(p=>p.monto_transferido!=null)&&(
                      <div data-por-regularizar style={{fontSize:12,color:C.warnText,marginTop:3,lineHeight:1.4}}>
                        <Ic n="⚠"/> Saldo por regularizar: se pagaron {fmt.money(d.porRegularizar)} de comisión por sobre la comisión actual (cambió después del pago, p. ej. al registrar el IVA). Los pagos no se reclasifican solos.
                      </div>
                    )}
                    {d.pagos.length>0&&(
                      <div data-pagos-mes style={{marginTop:4}}>
                        {d.pagos.map(p=>(
                          <div key={p.id} data-pago={p.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,fontSize:12,color:C.inkFaint,padding:"3px 0"}}>
                            <span style={{minWidth:0}}>
                              {p.fecha?fmt.date(String(p.fecha).slice(0,10)):"—"} · transferido {fmt.money(totalTransferido(p))}
                              {p.monto_transferido!=null&&<> (comisión {fmt.money(Number(p.monto_pagado)||0)}{extraGestion(p)>0?` + gestión ${fmt.money(extraGestion(p))}`:""})</>}
                              {p.referencia_bancaria?` · ref. ${p.referencia_bancaria}`:""}
                            </span>
                            {esAdmin&&onAnularPago&&<button data-anular-pago={p.id} onClick={()=>setAnulando(p)} style={{flexShrink:0,background:"none",border:"none",color:C.dangerText,fontWeight:700,fontSize:12,cursor:"pointer",minHeight:32}}>Anular</button>}
                          </div>
                        ))}
                      </div>
                    )}
                    {d.deuda>0&&(d.estadoComision==="pendiente"
                      ?<button data-pagar-mes={`${v.id}|${d.anio}|${d.mes}`} onClick={()=>{setPagoInicial({vendedorId:v.id,mes:d.mes,anio:d.anio,monto:Math.round(d.deuda)});setPagando(true);}}
                        style={{...btnG,minHeight:40,fontSize:12.5,marginTop:6,padding:"6px 12px"}}>Pagar este mes · {fmt.money(d.deuda)}</button>
                      :<div>
                        <button data-pagar-mes={`${v.id}|${d.anio}|${d.mes}`} disabled style={{...btnG,minHeight:40,fontSize:12.5,marginTop:6,padding:"6px 12px",cursor:"not-allowed",opacity:0.6}}>Pagar este mes · {d.estadoComision==="en_curso"?"en curso":"por liquidar"}</button>
                        <div style={{fontSize:12,color:C.inkMuted,marginTop:3,lineHeight:1.4}}>{motivoNoPagable(d)}</div>
                      </div>)}
                    {!d.esVerificado&&d.pagado>d.pagoCalculado+1000&&!d.pagos.some(p=>p.monto_transferido!=null)&&(
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
      {ivaIncompletos.length>0&&(
        <div data-aviso="iva-incompleto" style={{background:C.warnLight,border:`1px solid ${C.warn}55`,borderRadius:12,padding:"10px 12px",marginBottom:10}}>
          <div style={{fontSize:13,fontWeight:700,color:C.warnText,marginBottom:6}}>Pago al SII registrado sin débito/crédito: la comisión de estos meses se calcula sin IVA.</div>
          {ivaIncompletos.map(p=>(
            <button key={`${p.anio}-${p.mes}`} onClick={()=>{setEditandoIvaExistente({anio:p.anio,mes:p.mes});setEditIva(true);}} style={{...btnG,minHeight:40,fontSize:12.5,marginRight:6,marginTop:4,padding:"6px 12px"}}>
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
      {anulando&&(
        <Modal title="Anular pago a vendedor" onClose={()=>setAnulando(null)}>
          <FormAnularPago pago={anulando} vendedor={vendedores.find(v=>v.id===anulando.vendedor_id)} onAnular={async(motivo)=>{await onAnularPago(anulando,motivo);setAnulando(null);}} />
        </Modal>
      )}
      {editIva&&(
        <Modal title="IVA mensual" onClose={()=>setEditIva(false)}>
          <FormIvaMensual ivaMensual={ivaMensual} gastos={gastos} periodo={editandoIvaExistente?{anio:editandoIvaExistente.anio,mes:editandoIvaExistente.mes}:null} onSave={async(d)=>{await onGuardarIva(d);setEditIva(false);}} />
        </Modal>
      )}
    </div>
  );
}

// El formulario de IVA es único (Vendedores y Gastos): components/forms/FormIvaMensual.jsx
export { FormIvaMensual };

// Pago a vendedor (08/10/2026): se ingresa el TOTAL realmente transferido y el sistema lo reparte en
// pago de comisión (hasta la comisión pendiente del período) y extra por gestión (el excedente, del mismo período).
const nuevoIdPago=()=>"pv_"+Date.now().toString(36)+Math.random().toString(36).slice(2,8);
export function FormPagoVendedorSimple({ vendedores, ocs, ivaMensual, pagosVendedor, onSave, inicial }) {
  const [vendedorId,setVendedorId]=useState(inicial?.vendedorId||vendedores[0]?.id||"");
  const [mes,setMes]=useState(Number(inicial?.mes)||new Date().getMonth()+1); const [anio,setAnio]=useState(Number(inicial?.anio)||new Date().getFullYear());
  const evInicial=evaluarPagoVendedor({vendedorId,mes,anio,monto:0,ocs,ivaMensual,pagosVendedor});
  const [monto,setMonto]=useState(String(inicial?.monto??evInicial.pendienteAntes??""));
  const [fecha,setFecha]=useState(new Date().toLocaleDateString("sv-SE"));
  const [referencia,setReferencia]=useState(""); const [observacion,setObservacion]=useState("");
  const [revisar,setRevisar]=useState(false);
  const [confirmaProvisoria,setConfirmaProvisoria]=useState(false); // pago sobre comisión provisoria o del mes en curso: confirmación explícita
  const [err,setErr]=useState(""); const [saving,setSaving]=useState(false);
  const [idPago]=useState(nuevoIdPago);   // fijo mientras el formulario está abierto: un doble envío no crea dos pagos
  const MESES=["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
  const vend=vendedores.find(v=>v.id===vendedorId);
  const labelMes=`${MESES[mes-1]}/${anio}`;
  const ev=evaluarPagoVendedor({vendedorId,mes,anio,monto:Number(monto)||0,ocs,ivaMensual,pagosVendedor});
  const parecido=pagoParecido({pagosVendedor,vendedorId,mes,anio,fecha,monto});
  const cambiarPeriodo=(v,m,a)=>{ setRevisar(false); setConfirmaProvisoria(false); const e=evaluarPagoVendedor({vendedorId:v,mes:Number(m),anio:Number(a),monto:0,ocs,ivaMensual,pagosVendedor}); setMonto(String(e.pendienteAntes)); };
  const pedirRevision=()=>{
    if(!(Number(monto)>0)){setErr("Indica el monto total transferido");return;}
    if(!fecha){setErr("Indica la fecha de la transferencia");return;}
    setErr(""); setRevisar(true);
  };
  // Comisión no definitiva (provisoria o del mes en curso): se puede registrar una transferencia real, pero con confirmación
  // explícita, y la nota del pago lo deja escrito.
  const noDefinitiva=ev.provisoria||ev.enCurso;
  const motivoNoDefinitiva=ev.enCurso?"mes en curso":ev.sinIvaRegistrado?"IVA sin registrar":"falta el total del F29";
  const handleSave=async()=>{
    if(noDefinitiva&&!confirmaProvisoria){setErr("Confirma que la transferencia ya se realizó y que se registra sobre una comisión no definitiva");return;}
    setErr(""); setSaving(true);
    try{await onSave({id:idPago,vendedorId,monto:Math.round(Number(monto)),fecha,mes:Number(mes),anio:Number(anio),referencia,observacion,label:`Ventas de ${labelMes}`,
      avisoProvisoria:noDefinitiva?`Pagado sobre comisión provisoria (${motivoNoDefinitiva}): confirmado por el usuario`:""});}
    catch(e){setErr(e.message);}finally{setSaving(false);}
  };
  const Linea=({k,v,fuerte,tono,dato})=>(
    <div style={{display:"flex",justifyContent:"space-between",gap:8,padding:"3px 0"}}>
      <span>{k}</span><span data-desglose={dato} style={{fontFamily:MONO,fontWeight:fuerte?800:600,color:tono||C.ink}}>{fmt.money(v)}</span>
    </div>
  );
  return (
    <div data-form-pago-vendedor>
      <Field label="Vendedor" required><select style={selStyle} value={vendedorId} disabled={revisar} onChange={e=>{setVendedorId(e.target.value);cambiarPeriodo(e.target.value,mes,anio);}}>{vendedores.map(v=><option key={v.id} value={v.id}>{v.nombre}</option>)}</select></Field>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        <Field label="Mes de la comisión" required><select style={selStyle} value={mes} disabled={revisar} onChange={e=>{setMes(Number(e.target.value));cambiarPeriodo(vendedorId,e.target.value,anio);}}>{MESES.map((m,i)=><option key={i} value={i+1}>{m}</option>)}</select></Field>
        <Field label="Año" required><input style={iMono} type="number" value={anio} disabled={revisar} onChange={e=>{setAnio(Number(e.target.value));cambiarPeriodo(vendedorId,mes,e.target.value);}} /></Field>
      </div>
      <div style={{background:C.paper,borderRadius:9,padding:"10px 12px",marginBottom:12,fontSize:12.5,color:C.inkMuted,lineHeight:1.5}}>
        <Linea k={`Comisión calculada · ${labelMes}`} v={ev.comision} dato="comision" />
        <Linea k="Comisión ya pagada" v={ev.pagadoAntes} dato="pagada" />
        <Linea k="Saldo pendiente" v={ev.pendienteAntes} fuerte dato="pendiente" />
        {ev.enCurso&&<div data-aviso-en-curso style={{color:C.warnText,fontWeight:700,marginTop:4}}><Ic n="⚠"/> {labelMes} es el mes en curso: su comisión todavía no es exigible y seguirá cambiando con las ventas del mes.</div>}
        {ev.provisoria&&<div data-aviso-provisoria style={{color:C.warnText,fontWeight:700,marginTop:4}}><Ic n="⚠"/> Comisión provisoria: {ev.sinIvaRegistrado?`el IVA de ${labelMes} no está registrado`:`falta el total del F29 (IVA + PPM) de ${labelMes}`}. Puede cambiar al registrarlo; si baja, la diferencia quedará como saldo por regularizar (el pago no se reclasifica solo).</div>}
      </div>
      <Field label="Monto total transferido ($)" required hint="Lo que salió realmente de la cuenta. Puede ser menor, igual o mayor que el saldo pendiente.">
        <input data-monto-transferido style={iMono} type="number" inputMode="numeric" min="0" value={monto} disabled={revisar} onChange={e=>setMonto(e.target.value)} />
      </Field>
      <div data-desglose-pago style={{background:C.tealLight,borderRadius:9,padding:"10px 12px",marginBottom:12,fontSize:12.5,color:C.tealDark,lineHeight:1.5}}>
        <Linea k="Pago de comisión" v={ev.pagoComision} fuerte tono={C.tealDark} dato="pago_comision" />
        <Linea k="Extra por gestión" v={ev.extraGestion} fuerte tono={C.tealDark} dato="extra_gestion" />
        <div style={{fontSize:12,marginTop:2}}>Saldo de comisión de {labelMes} después de este pago: <b data-desglose="pendiente_despues">{fmt.money(ev.pendiente)}</b>{ev.extraGestion>0?" · el extra es gestión de este mes: no aumenta la comisión ni pasa a otro mes":""}</div>
      </div>
      <Field label="Fecha efectiva de la transferencia" required><input style={iStyle} type="date" value={fecha} disabled={revisar} onChange={e=>setFecha(e.target.value)} /></Field>
      <Field label="Referencia o comprobante bancario"><input style={iStyle} value={referencia} disabled={revisar} onChange={e=>setReferencia(e.target.value)} placeholder="Opcional" /></Field>
      <Field label="Observación"><input style={iStyle} value={observacion} disabled={revisar} onChange={e=>setObservacion(e.target.value)} placeholder="Opcional" /></Field>
      {err&&<div style={{background:C.dangerLight,color:C.dangerText,borderRadius:8,padding:"8px 12px",fontSize:12.5,marginBottom:10,fontWeight:600}}>{err}</div>}
      {!revisar?(
        <button data-revisar-pago onClick={pedirRevision} style={btnP(C.teal)}>Revisar pago</button>
      ):(
        <div data-vista-previa style={{border:`1.5px solid ${C.teal}`,borderRadius:12,padding:"12px 14px"}}>
          <div style={{fontSize:13,fontWeight:800,color:C.ink,marginBottom:6}}>Vista previa · una sola transferencia</div>
          <div style={{fontSize:12.5,color:C.inkMuted,lineHeight:1.6,marginBottom:8}}>
            {vend?.nombre} · {labelMes} · {fecha?`${fecha.slice(8,10)}-${fecha.slice(5,7)}-${fecha.slice(0,4)}`:""}{referencia.trim()?` · ref. ${referencia.trim()}`:""}<br/>
            Total transferido <b style={{color:C.ink}}>{fmt.money(ev.total)}</b> = comisión <b style={{color:C.ink}}>{fmt.money(ev.pagoComision)}</b> + extra por gestión <b style={{color:C.ink}}>{fmt.money(ev.extraGestion)}</b><br/>
            Comisión de {labelMes}: pendiente {fmt.money(ev.pendienteAntes)} → {fmt.money(ev.pendiente)}{ev.completo&&ev.ocIds.length?` · ${ev.ocIds.length} OC quedan con comisión pagada`:""}
          </div>
          {noDefinitiva&&(
            <label data-confirmar-provisoria style={{display:"flex",gap:8,alignItems:"flex-start",background:C.warnLight,border:`1px solid ${C.warn}55`,borderRadius:9,padding:"8px 10px",fontSize:12,color:C.warnText,fontWeight:700,marginBottom:8,lineHeight:1.45,cursor:"pointer"}}>
              <input type="checkbox" checked={confirmaProvisoria} onChange={e=>setConfirmaProvisoria(e.target.checked)} style={{marginTop:1,width:18,height:18,flexShrink:0}} />
              <span>Pago sobre una comisión {ev.enCurso?"del MES EN CURSO":"PROVISORIA"} ({motivoNoDefinitiva}). Confirmo que esta transferencia ya se realizó. La comisión puede cambiar al registrar el IVA y el F29; si baja, la diferencia quedará como saldo por regularizar.</span>
            </label>
          )}
          {parecido&&<div data-aviso-duplicado style={{fontSize:12,color:C.dangerText,fontWeight:700,marginBottom:8}}><Ic n="⚠"/> Ya hay un pago de {fmt.money(totalTransferido(parecido))} a {vend?.nombre} para {labelMes} con esta misma fecha. Confirma solo si es una transferencia distinta.</div>}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            <button onClick={()=>{setRevisar(false);setConfirmaProvisoria(false);}} disabled={saving} style={btnG}>Corregir</button>
            <button data-confirmar-pago onClick={handleSave} disabled={saving||(noDefinitiva&&!confirmaProvisoria)} style={btnP(saving||(noDefinitiva&&!confirmaProvisoria)?C.inkFaint:C.teal)}>{saving?"Guardando…":"✓ Confirmar pago"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

// Anulación controlada (solo administrador): el pago se conserva con fecha, usuario y motivo, y deja de contar.
export function FormAnularPago({ pago, vendedor, onAnular }) {
  const [motivo,setMotivo]=useState(""); const [err,setErr]=useState(""); const [saving,setSaving]=useState(false);
  return (
    <div>
      <div style={{background:C.paper,borderRadius:9,padding:"10px 12px",marginBottom:12,fontSize:12.5,color:C.inkMuted,lineHeight:1.6}}>
        {vendedor?.nombre} · {String(pago.mes).padStart(2,"0")}/{pago.anio} · {pago.fecha?fmt.date(String(pago.fecha).slice(0,10)):"—"}<br/>
        Transferido {fmt.money(totalTransferido(pago))}{pago.monto_transferido!=null?` (comisión ${fmt.money(Number(pago.monto_pagado)||0)} + gestión ${fmt.money(extraGestion(pago))})`:""}<br/>
        El pago queda guardado como anulado y deja de contar en la comisión y en la caja.
      </div>
      <Field label="Motivo de la anulación" required><input data-motivo-anulacion style={iStyle} value={motivo} onChange={e=>setMotivo(e.target.value)} /></Field>
      {err&&<div style={{background:C.dangerLight,color:C.dangerText,borderRadius:8,padding:"8px 12px",fontSize:12.5,marginBottom:10,fontWeight:600}}>{err}</div>}
      <button data-confirmar-anulacion disabled={saving} onClick={async()=>{ if(!motivo.trim()){setErr("Indica el motivo");return;} setSaving(true); try{await onAnular(motivo.trim());}catch(e){setErr(e.message);}finally{setSaving(false);} }} style={btnP(saving?C.inkFaint:C.danger)}>{saving?"Anulando…":"Anular pago"}</button>
    </div>
  );
}
