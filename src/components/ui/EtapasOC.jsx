import { Fragment, useRef, useState, useEffect } from "react";
import { estaCobrada, estaComprada, estaEntregada, estaFacturada, financiamientoPagado } from "../../lib/ocs";
import { Field } from "./Basicos";
import { del } from "../../lib/supabase";
import { C, MONO, SANS, btnP, fmt, iMono, iStyle, selStyle } from "../../lib/theme";
import { Ic, I } from "./Iconos";
import { FormCambiarFinanciamiento } from "../forms/FormCambiarFinanciamiento";
import { TIPOS_FINANCIAMIENTO, financiamientoNoAplica, tipoFinanciamiento } from "../../lib/finanzas";

export const TIPOS_PV={falla:"Falla del producto",faltante:"Faltante",cambio:"Cambio / reposición",devolucion:"Devolución",otro:"Otro"};

export function FormPostventa({ oc, evento, cerrar, onSave }) {
  const [tipo,setTipo]=useState(evento?.tipo||"falla");
  const [fecha,setFecha]=useState(evento?.fecha||new Date().toISOString().slice(0,10));
  const [descripcion,setDescripcion]=useState(evento?.descripcion||"");
  const [estado,setEstado]=useState(cerrar?"resuelto":(evento?.estado||"abierto"));
  const yaGuardado=useRef(false);   // evita duplicados por doble toque
  const [solucion,setSolucion]=useState(evento?.solucion||"");
  const [fechaRes,setFechaRes]=useState(evento?.fecha_resolucion||"");
  const [costoExtra,setCostoExtra]=useState(evento?.costo_extra||"");
  const [detalleCosto,setDetalleCosto]=useState(evento?.detalle_costo||"");
  const [err,setErr]=useState(""); const [saving,setSaving]=useState(false);
  const guardar=async()=>{
    if(yaGuardado.current) return;
    if(!descripcion.trim()){setErr("Describe la incidencia");return;}
    if(estado==="resuelto"&&!solucion.trim()){setErr("Indica la solución o comentario de cierre");return;}
    yaGuardado.current=true; setErr("");setSaving(true);
    try{ await onSave({id:evento?.id,ocId:oc.id,tipo,fecha,descripcion:descripcion.trim(),estado,
      solucion:solucion.trim()||null,
      fecha_resolucion:estado==="resuelto"?(fechaRes||new Date().toISOString().slice(0,10)):null,
      costo_extra:costoExtra?Number(costoExtra):0,
      detalle_costo:detalleCosto.trim()||null}); }
    catch(e){yaGuardado.current=false;setErr(e.message);} finally{setSaving(false);}
  };
  return (
    <div>
      <div style={{background:C.paper,borderRadius:8,padding:"8px 12px",fontSize:12,color:C.inkMuted,marginBottom:12}}>
        OC <b style={{color:C.ink,fontFamily:MONO}}>{oc.numero_oc}</b> · {oc.cliente}
      </div>
      <Field label="Tipo de incidencia" required>
        <select style={selStyle} value={tipo} onChange={e=>setTipo(e.target.value)}>
          {Object.entries(TIPOS_PV).map(([k,v])=><option key={k} value={k}>{v}</option>)}
        </select>
      </Field>
      <Field label="Fecha del reclamo" required><input style={iStyle} type="date" value={fecha} onChange={e=>setFecha(e.target.value)} /></Field>
      <Field label="Descripción" required>
        <textarea style={{...iStyle,minHeight:70,resize:"vertical"}} value={descripcion} onChange={e=>setDescripcion(e.target.value)} placeholder="Qué informó el cliente" />
      </Field>
      <Field label="Costo extra ($)" hint="Lo que costó resolverlo: reposición, flete, repuesto. Se descuenta de la ganancia de la OC.">
        <input style={iMono} type="number" value={costoExtra}
          onChange={e=>setCostoExtra(e.target.value)} placeholder="0" />
      </Field>
      {Number(costoExtra)>0&&(
        <Field label="¿En qué se gastó?">
          <input style={iStyle} value={detalleCosto} onChange={e=>setDetalleCosto(e.target.value)}
            placeholder="ej: reposición de 1 unidad, flete de devolución" />
        </Field>
      )}
      <Field label="Estado">
        <select style={selStyle} value={estado} onChange={e=>setEstado(e.target.value)}>
          <option value="abierto">Abierto</option>
          {evento?.estado==="en_gestion"&&<option value="en_gestion">Abierto · en gestión (registro anterior)</option>}
          <option value="resuelto">Cerrado</option>
        </select>
      </Field>
      {estado==="resuelto"&&<>
        <Field label="Solución / comentario de cierre" required>
          <textarea style={{...iStyle,minHeight:60,resize:"vertical"}} value={solucion} onChange={e=>setSolucion(e.target.value)} placeholder="Qué se hizo para resolverlo" />
        </Field>
        <Field label="Fecha de cierre"><input style={iStyle} type="date" value={fechaRes} onChange={e=>setFechaRes(e.target.value)} /></Field>
      </>}
      {err&&<div style={{background:C.dangerLight,color:C.dangerText,borderRadius:8,padding:"8px 12px",fontSize:12.5,marginBottom:10,fontWeight:600}}>{err}</div>}
      <button onClick={guardar} disabled={saving} style={btnP(saving?C.inkFaint:C.warn)}>{saving?"Guardando…":cerrar?"✓ Cerrar incidente":evento?"✓ Guardar cambios":"✓ Registrar incidencia"}</button>
    </div>
  );
}

// Incidentes abiertos primero; dentro de cada grupo, los más recientes arriba. "En gestión" (registros anteriores) cuenta como abierto.
export const incidenteCerrado=(e)=>e?.estado==="resuelto";
export const ordenarIncidentes=(lista)=>(lista||[]).slice().sort((a,b)=>
  (incidenteCerrado(a)?1:0)-(incidenteCerrado(b)?1:0)||String(b.fecha||"").localeCompare(String(a.fecha||"")));
// Número estable de cada incidente dentro de su OC (1 = el más antiguo).
export const numeroIncidente=(lista,ev)=>{
  const cron=(lista||[]).slice().sort((a,b)=>String(a.fecha||"").localeCompare(String(b.fecha||""))||String(a.creadoEn||"").localeCompare(String(b.creadoEn||"")));
  const i=cron.findIndex(e=>e.id===ev?.id); return i<0?cron.length+1:i+1;
};

export function EtapasOC({ oc, perfil, perfiles, activa, extra, onEditarEvento, onEliminarFactura, onEliminarEvento, onAccion, onCorreoFallida, onCorreoFecha, onPostventa, onReabrirPostventa, onGuardarLink, onEliminarLink, onEditarLink, onAsignarResponsable, financiadores, difsOC, onCambiarFinanciamiento }) {
  // Fase 4B: diferencias históricas pendientes bloquean las operaciones de su dominio hasta que se apruebe la corrección.
  const bloqueado=(dominio)=>(difsOC||[]).some(d=>(d.bloquea||[]).includes(dominio));
  const [cambiandoFin,setCambiandoFin]=useState(false);
  const tipoFin=tipoFinanciamiento(oc,financiadores);
  // La etapa que toca queda abierta: es la acción principal de la OC. Al registrar, avanza sola a la siguiente.
  const reabriendo=useRef(new Set());   // evita reabrir dos veces por doble toque
  const [detalle,setDetalle]=useState(activa||null);
  useEffect(()=>{ setDetalle(activa||null); },[activa]);

  const getEventos=(key)=>{
    if(key==="compra") return (oc.eventos_compra||[]);
    if(key==="entrega") return (oc.eventos_entrega||[]);
    if(key==="factura") return (oc.eventos_factura||[]);
    if(key==="cobro") return (oc.eventos_pago_cliente||[]);
    if(key==="financ") return (oc.eventos_pago_financiamiento||[]);
    if(key==="postventa") return ordenarIncidentes(oc.eventos_postventa);
    return [];
  };

  const etapas = [
    { key:"compra",  label:"Compra",  ok:estaComprada(oc),        icon:<Ic n="📦"/>, tabla:"eventos_compra",
      accion: !estaComprada(oc)?{label:<I t={"📦 Registrar compra"}/>,color:C.tealDark,key:"compra"}:null,
      correoBtns: null },
    { key:"entrega", label:"Entrega", ok:estaEntregada(oc),          icon:<Ic n="🚚"/>, tabla:"eventos_entrega",
      accion: !estaEntregada(oc)?{label:"✓ Confirmar entrega",color:C.transit,key:"entrega"}:null,
      correoBtns: [
        {label:<I t={"⚠️ Entrega fallida"}/>,action:onCorreoFallida,color:C.warnText},
        {label:<I t={"📅 Fecha de entrega"}/>,action:onCorreoFecha,color:C.ink},
      ]},
    { key:"factura", label:"Factura", ok:estaFacturada(oc),     icon:<Ic n="🧾"/>, tabla:"eventos_factura",
      accion: bloqueado("facturacion")?null:!estaFacturada(oc)
        ?{label:<I t={"🧾 Emitir factura"}/>,color:C.info,key:"factura"}
        :{label:<I t={"🧾 Re-emitir (NC)"}/>,color:C.inkMuted,key:"factura"},
      correoBtns: null },
    { key:"cobro",   label:"Cobro",   ok:estaCobrada(oc),        icon:<Ic n="💰"/>, tabla:"eventos_pago_cliente",
      accion: estaFacturada(oc)&&!estaCobrada(oc)&&!bloqueado("cobro")?{label:<I t={"💰 Registrar cobro"}/>,color:C.okText,key:"pago_cliente"}:null,
      correoBtns: null },
    { key:"financ",  label:"Financ.", ok:financiamientoPagado(oc), icon:<Ic n="🏦"/>, tabla:"eventos_pago_financiamiento",
      accion: !financiamientoPagado(oc)&&!bloqueado("financiamiento")&&tipoFin==="externo"?{label:<I t={"🏦 Registrar pago"}/>,color:C.purple,key:"pago_financ"}:null,
      correoBtns: null },
    { key:"postventa", label:"Post-venta", ok:(oc.eventos_postventa||[]).some(e=>e.estado==="resuelto"), icon:<Ic n="🛠"/>, tabla:"eventos_postventa",
      accion: {label:<I t={"🛠 Registrar incidencia"}/>,color:C.warnText,key:"postventa"},
      correoBtns: null },
  ];
  const esActiva=(e)=>!!activa&&e.key===activa;
  const principales=etapas.filter(e=>e.key!=="postventa");
  const completadas=principales.filter(e=>e.ok).length;

  const renderDetalle=(etapa)=>{
    const eventos=getEventos(etapa.key);
    const dominio=etapa.key==="compra"||etapa.key==="financ"?"financiamiento":etapa.key==="factura"?"facturacion":etapa.key==="cobro"?"cobro":null;
    return (
      <div>
        {dominio&&bloqueado(dominio)&&(
          <div data-bloqueo-historico={dominio} style={{background:C.warnLight,borderRadius:8,padding:"8px 10px",marginBottom:8,fontSize:12,color:C.warnText,fontWeight:600,lineHeight:1.4}}>
            <Ic n="⚠"/> Corrección histórica pendiente de aprobación (Fase 4B). Hasta resolverla no se registran ni corrigen movimientos de {dominio==="financiamiento"?"compra y financiamiento":dominio==="facturacion"?"facturación":"cobro"} en esta OC.
          </div>
        )}
        {eventos.length===0&&(
          <div>
            {/* Estado marcado en OC pero sin evento detallado (OCs históricas) */}
            {etapa.key==="factura"&&estaFacturada(oc)&&(
              <div style={{background:C.card,borderRadius:8,padding:"10px 12px",marginBottom:8}}>
                <div style={{fontSize:12.5,fontWeight:600}}><Ic n="🧾"/> Factura registrada</div>
                <div style={{fontSize:12,color:C.inkMuted}}>Monto: <b>{fmt.money(oc.monto_facturado)}</b></div>
                <div style={{fontSize:12,color:C.warnText,marginTop:4}}>Sin detalle de número y fecha — usa Re-emitir para agregar</div>
              </div>
            )}
            {etapa.key==="cobro"&&estaCobrada(oc)&&(
              <div style={{background:C.card,borderRadius:8,padding:"10px 12px",marginBottom:8}}>
                <div style={{fontSize:12.5,fontWeight:600}}><Ic n="💰"/> Cobro registrado</div>
                <div style={{fontSize:12,color:C.inkMuted}}>Monto: <b>{fmt.money(oc.monto_cobrado||oc.monto_facturado||oc.monto_total)}</b></div>
                <div style={{fontSize:12,color:C.warnText,marginTop:4}}>Registro histórico — sin fecha detallada</div>
              </div>
            )}
            {etapa.key==="entrega"&&estaEntregada(oc)&&(
              <div style={{background:C.card,borderRadius:8,padding:"10px 12px",marginBottom:8}}>
                <div style={{fontSize:12.5,fontWeight:600}}><Ic n="🚚"/> Entrega confirmada</div>
                <div style={{fontSize:12,color:C.warnText,marginTop:4}}>Registro histórico — sin fecha detallada</div>
              </div>
            )}
            {etapa.key==="financ"&&financiamientoNoAplica(oc)&&(
              <div data-financiamiento="no_aplica" style={{background:C.card,borderRadius:8,padding:"10px 12px",marginBottom:8}}>
                <div style={{fontSize:12.5,fontWeight:600}}><Ic n="🏦"/> Financiamiento: no aplica</div>
                <div style={{fontSize:12,color:C.inkMuted}}>{TIPOS_FINANCIAMIENTO[tipoFin]?.etiqueta}: {TIPOS_FINANCIAMIENTO[tipoFin]?.detalle}</div>
              </div>
            )}
            {etapa.key==="financ"&&oc.estado_pago_financiamiento==="pagado"&&(
              <div style={{background:C.card,borderRadius:8,padding:"10px 12px",marginBottom:8}}>
                <div style={{fontSize:12.5,fontWeight:600}}><Ic n="🏦"/> Financiamiento pagado</div>
                <div style={{fontSize:12,color:C.inkMuted}}>Monto: <b>{fmt.money(oc.costo_total)}</b> · A: <b>{oc.financiadores?.nombre||"—"}</b></div>
                <div style={{fontSize:12,color:C.warnText,marginTop:4}}>Registro histórico — sin fecha detallada</div>
              </div>
            )}
            {/* Mensaje solo cuando realmente no hay nada */}
            {!(
              (etapa.key==="factura"&&estaFacturada(oc))||
              (etapa.key==="cobro"&&estaCobrada(oc))||
              (etapa.key==="entrega"&&estaEntregada(oc))||
              (etapa.key==="financ"&&financiamientoPagado(oc))
            )&&(
              etapa.key==="cobro"&&!estaFacturada(oc)
                ? <div style={{fontSize:12,color:C.warnText,padding:"4px 0 8px",fontWeight:600}}><Ic n="⚠"/> Primero emite la factura para poder registrar el cobro</div>
                : <div style={{fontSize:12,color:C.inkFaint,padding:"4px 0 8px"}}>Sin registros aún</div>
            )}
            {/* Botón de acción inmediato cuando no hay registro */}
            {etapa.accion&&(
              <button onClick={()=>{onAccion&&onAccion(etapa.accion.key);}}
                style={{width:"100%",background:etapa.accion.color,border:"none",color:"#fff",borderRadius:esActiva(etapa)?10:8,padding:esActiva(etapa)?"12px":"9px 12px",fontSize:esActiva(etapa)?13.5:12,fontWeight:700,cursor:"pointer"}}>
                {etapa.accion.label}{esActiva(etapa)?" →":""}
              </button>
            )}
            {etapa.correoBtns&&etapa.correoBtns.map((b,i)=>(
              <button key={i} onClick={b.action}
                style={{width:"100%",background:b.color,border:"none",color:"#fff",borderRadius:8,padding:"9px 12px",fontSize:12,fontWeight:700,cursor:"pointer",marginTop:4}}>
                {b.label}
              </button>
            ))}
          </div>
        )}
        {eventos.map((ev,i)=>(
          <div key={ev.id||i} style={{background:C.card,borderRadius:8,padding:"10px 12px",marginBottom:6,...(etapa.key==="postventa"?(incidenteCerrado(ev)?{opacity:0.82,borderLeft:`3px solid ${C.okText}`}:{borderLeft:`3px solid ${C.dangerText}`}):{})}}>
            {etapa.key==="compra"&&<>
              <div style={{fontSize:12.5,fontWeight:600}}><Ic n="📅"/> {ev.fecha?`Comprada el ${fmt.date(String(ev.fecha).slice(0,10))}`:"Compra sin fecha registrada"}</div>
              <div style={{fontSize:12,color:C.inkMuted}}>Venta: <b>{fmt.money(ev.monto_venta||oc.monto_total)}</b> · Costo: <b>{fmt.money(ev.costo_compra||oc.costo_total)}</b></div>
              {ev.fecha_entrega_estimada&&<div style={{fontSize:12,color:C.inkMuted}}>Entrega est.: {fmt.date(ev.fecha_entrega_estimada)}</div>}
              {ev.proveedor&&<div style={{fontSize:12,color:C.inkMuted}}>Proveedor: {ev.proveedor}</div>}
              <div style={{fontSize:12,color:C.inkMuted}}>Financiamiento: <b data-tipo-financiamiento={tipoFin}>{TIPOS_FINANCIAMIENTO[tipoFin]?.etiqueta}</b>{tipoFin!=="venta_propia"&&<> · <b>{oc.financiadores?.nombre||"—"}</b></>} · Vendedor: <b>{oc.vendedores?.nombre||"—"}</b></div>
              {onCambiarFinanciamiento&&i===0&&!bloqueado("financiamiento")&&!cambiandoFin&&(
                <button data-accion="cambiar-financiamiento" onClick={()=>setCambiandoFin(true)}
                  style={{background:"none",border:`1px solid ${C.border}`,borderRadius:8,padding:"6px 10px",fontSize:12,fontWeight:700,color:C.tealDark,cursor:"pointer",marginTop:6}}>Cambiar financiamiento</button>
              )}
              {cambiandoFin&&i===0&&<FormCambiarFinanciamiento oc={oc} financiadores={financiadores} onCancel={()=>setCambiandoFin(false)}
                onSave={async(d)=>{ await onCambiarFinanciamiento(d); setCambiandoFin(false); }} />}
              <div style={{fontSize:12,color:C.inkFaint,marginTop:6}}>Los productos y links se gestionan en «Productos y números».</div>
            </>}
            {etapa.key==="entrega"&&<>
              <div style={{fontSize:12.5,fontWeight:600}}><Ic n="✅"/> Entregado el {fmt.date(ev.fecha)||"—"}</div>
              {ev.persona_recibe&&<div style={{fontSize:12,color:C.inkMuted}}>Recibe: {ev.persona_recibe}</div>}
              {ev.notas&&<div style={{fontSize:12,color:C.inkMuted}}>{ev.notas}</div>}
              {!ev.persona_recibe&&!ev.notas&&<div style={{fontSize:12,color:C.inkFaint}}>Sin detalle adicional</div>}
            </>}
            {etapa.key==="factura"&&<>
              <div style={{fontSize:12.5,fontWeight:600}}><Ic n="🧾"/> Factura N°{ev.numero_factura||"—"} · {fmt.money(ev.monto||oc.monto_facturado)}</div>
              <div style={{fontSize:12,color:C.inkMuted}}>Emitida el {fmt.date(ev.fecha)||"—"}</div>
              {ev.nota_credito&&<div style={{fontSize:12,color:C.warnText}}>NC N°{ev.nota_credito} · anula factura N°{ev.factura_anulada_numero}</div>}
              {ev.motivo_diferencia&&<div style={{fontSize:12,color:C.warnText,marginTop:3}}><Ic n="⚠"/> Difiere de la OC: {ev.motivo_diferencia}</div>}
            </>}
            {etapa.key==="cobro"&&<>
              <div style={{fontSize:12.5,fontWeight:600}}><Ic n="💰"/> {fmt.money(ev.monto||oc.monto_cobrado)} cobrado</div>
              <div style={{fontSize:12,color:C.inkMuted}}>{fmt.date(ev.fecha)||"—"}</div>
              {ev.referencia&&<div style={{fontSize:12,color:C.inkMuted}}>Ref: {ev.referencia}</div>}
            </>}
            {etapa.key==="financ"&&<>
              <div style={{fontSize:12.5,fontWeight:600}}><Ic n="🏦"/> {fmt.money(ev.monto||oc.costo_total)} pagado</div>
              <div style={{fontSize:12,color:C.inkMuted}}>{fmt.date(ev.fecha)||"—"}</div>
              {ev.financiador_id&&<div style={{fontSize:12,color:C.inkMuted}}>A: {oc.financiadores?.nombre||"—"}</div>}
            </>}
            {etapa.key==="postventa"&&(()=>{
              const cerrado=incidenteCerrado(ev);
              const n=numeroIncidente(oc.eventos_postventa,ev);
              return <>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:6}}>
                <div style={{fontSize:12.5,fontWeight:700,color:cerrado?C.inkMuted:C.ink}}><Ic n="🛠"/> Incidente {n} · {TIPOS_PV[ev.tipo]||ev.tipo||"Incidencia"}</div>
                <span style={{fontSize:12,fontWeight:800,borderRadius:5,padding:"2px 6px",whiteSpace:"nowrap",background:cerrado?C.okLight:C.dangerLight,color:cerrado?C.okText:C.dangerText}}>
                  {cerrado?"✓ Incidente cerrado":"⚠ Incidente abierto"}
                </span>
              </div>
              <div style={{fontSize:12,color:C.inkMuted}}>Reclamo: {fmt.date(ev.fecha)||"—"}{ev.estado==="en_gestion"?" · en gestión":""}</div>
              {ev.descripcion&&<div style={{fontSize:12,color:cerrado?C.inkMuted:C.ink,marginTop:3}}>{ev.descripcion}</div>}
              {ev.solucion&&<div style={{fontSize:12,color:C.okText,marginTop:3}}>{cerrado?"Cierre":"Solución previa"}: {ev.solucion}{cerrado&&ev.fecha_resolucion?` · ${fmt.date(ev.fecha_resolucion)}`:""}</div>}
              {Number(ev.costo_extra)>0&&(
                <div style={{fontSize:12,color:C.dangerText,marginTop:3,fontWeight:600}}>
                  Costo extra: {fmt.money(ev.costo_extra)}{ev.detalle_costo?` · ${ev.detalle_costo}`:""}
                </div>
              )}
            </>;})()}
            <div style={{display:"flex",gap:6,marginTop:8}}>
              {etapa.key==="postventa"?<>
                {!incidenteCerrado(ev)&&<button onClick={()=>onPostventa&&onPostventa(ev,"cerrar")}
                  style={{fontSize:12,background:C.okText,color:"#fff",border:"none",borderRadius:6,padding:"4px 10px",cursor:"pointer",fontWeight:700}}>✓ Cerrar incidente</button>}
                {incidenteCerrado(ev)&&<button onClick={()=>{ if(reabriendo.current.has(ev.id)) return; if(!window.confirm("¿Reabrir este incidente?")) return; reabriendo.current.add(ev.id); Promise.resolve(onReabrirPostventa&&onReabrirPostventa(ev)).finally(()=>reabriendo.current.delete(ev.id)); }}
                  style={{fontSize:12,background:C.warnLight,color:C.warnText,border:"none",borderRadius:6,padding:"4px 10px",cursor:"pointer",fontWeight:700}}>↺ Reabrir</button>}
                <button onClick={()=>onPostventa&&onPostventa(ev,"editar")}
                  style={{fontSize:12,background:C.tealLight,color:C.tealDark,border:"none",borderRadius:6,padding:"4px 10px",cursor:"pointer",fontWeight:600}}><Ic n="✏️"/> Editar</button>
              </>:
              !(dominio&&bloqueado(dominio))&&<button onClick={()=>onEditarEvento&&onEditarEvento({tipo:etapa.label,e:ev,tabla:etapa.tabla})}
                style={{fontSize:12,background:C.tealLight,color:C.tealDark,border:"none",borderRadius:6,padding:"4px 10px",cursor:"pointer",fontWeight:600}}><Ic n="✏️"/> Editar</button>}
              {perfil?.rol==="admin"&&etapa.key==="factura"&&!bloqueado("facturacion")&&(
                <button onClick={async()=>{
                  if(!window.confirm(`¿Eliminar factura N°${ev.numero_factura}?\nEsto revertirá el estado a pendiente.`)) return;
                  await onEliminarFactura(oc.id, ev.id); setDetalle(null);
                }} style={{fontSize:12,background:C.dangerLight,color:C.dangerText,border:"none",borderRadius:6,padding:"4px 10px",cursor:"pointer",fontWeight:600}}><Ic n="🗑"/> Eliminar</button>
              )}
              {perfil?.rol==="admin"&&etapa.key!=="factura"&&!(dominio&&bloqueado(dominio))&&(
                <button onClick={async()=>{
                  if(!window.confirm(`¿Eliminar este registro de ${etapa.label}?`)) return;
                  if(onEliminarEvento) await onEliminarEvento(etapa.tabla, ev.id, oc.id, etapa.key); setDetalle(null);
                }} style={{fontSize:12,background:C.dangerLight,color:C.dangerText,border:"none",borderRadius:6,padding:"4px 10px",cursor:"pointer",fontWeight:600}}><Ic n="🗑"/> Eliminar</button>
              )}
            </div>
          </div>
        ))}
        {/* Botones cuando SÍ hay eventos (acciones adicionales como re-emitir o correos) */}
        {eventos.length>0&&etapa.accion&&(
          <button onClick={()=>{onAccion&&onAccion(etapa.accion.key);}}
            style={{width:"100%",background:etapa.accion.color,border:"none",color:"#fff",borderRadius:esActiva(etapa)?10:8,padding:esActiva(etapa)?"12px":"9px 12px",fontSize:esActiva(etapa)?13.5:12,fontWeight:700,cursor:"pointer",marginTop:4}}>
            {etapa.accion.label}{esActiva(etapa)?" →":""}
          </button>
        )}
        {eventos.length>0&&etapa.correoBtns&&etapa.correoBtns.map((b,i)=>(
          <button key={i} onClick={b.action}
            style={{width:"100%",background:b.color,border:"none",color:"#fff",borderRadius:8,padding:"9px 12px",fontSize:12,fontWeight:700,cursor:"pointer",marginTop:4}}>
            {b.label}
          </button>
        ))}
        {extra&&extra[etapa.key]}
        {/* Fase 4C: "Responsable" no se usa en la operación diaria: se oculta. Si una etapa ya tiene uno asignado,
            se muestra solo como dato (no se borra nada). */}
        {(()=>{ const r=(oc.oc_responsables||[]).find(x=>x.etapa===etapa.key); return r?(
          <div data-responsable style={{marginTop:10,paddingTop:8,borderTop:`1px solid ${C.border}`,fontSize:12,color:C.inkMuted}}>
            Responsable: <b style={{color:C.ink}}>{r.usuario_nombre||(perfiles||[]).find(p=>p.id===r.usuario_id)?.nombre||"—"}</b>
          </div>):null; })()}
      </div>
    );
  };

  return (
    <div style={{marginBottom:12}}>
      <div style={{display:"flex",alignItems:"center",gap:0,marginBottom:6}}>
        {etapas.map((e,i)=>(
          <Fragment key={e.key}>
            <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2,flex:1}}>
              <button data-consulta="1" data-etapa={e.key} onClick={()=>setDetalle(detalle===e.key?null:e.key)} style={{
                width:26,height:26,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",
                fontSize:12,background:detalle===e.key?C.teal:e.ok?C.ok:C.paper,
                border:`2px solid ${detalle===e.key?C.teal:e.ok?C.ok:C.border}`,
                cursor:"pointer",transition:"all 0.2s",padding:0,boxShadow:detalle===e.key?"0 2px 8px rgba(20,184,166,0.3)":"none",
              }}>{e.ok?<span style={{color:"#fff",fontWeight:800,fontSize:13}}>✓</span>:<span style={{fontSize:12,color:C.inkFaint}}>{i+1}</span>}</button>
              <span style={{fontSize:12,color:detalle===e.key?C.teal:e.ok?C.ok:C.inkFaint,fontWeight:e.ok||detalle===e.key||esActiva(e)?700:400,textAlign:"center",lineHeight:1.1}}>{e.label}</span>
              {esActiva(e)&&<span style={{fontSize:12,color:C.tealDark,fontWeight:800,lineHeight:1}}>● toca</span>}
            </div>
            {i<etapas.length-1&&(
              <div style={{height:2,flex:0.5,background:etapas[i+1].ok&&e.ok?C.ok:C.border,marginBottom:14,transition:"all 0.2s"}} />
            )}
          </Fragment>
        ))}
      </div>
      {detalle&&(
        <div data-detalle-etapa={detalle} style={{background:C.tealLight,borderRadius:10,padding:"10px 12px",marginBottom:8}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <span style={{fontSize:12,fontWeight:700,color:C.tealDark,textTransform:"uppercase"}}>
              {etapas.find(e=>e.key===detalle)?.icon} {etapas.find(e=>e.key===detalle)?.label}
            </span>
            <button data-consulta="1" onClick={()=>setDetalle(null)} style={{background:"none",border:"none",color:C.inkFaint,cursor:"pointer",fontSize:16,lineHeight:1}}>✕</button>
          </div>
          {renderDetalle(etapas.find(e=>e.key===detalle))}
        </div>
      )}
      {(()=>{const n=(oc.eventos_postventa||[]).filter(e=>!incidenteCerrado(e)).length; return n>0&&(
        <div style={{fontSize:12,color:C.dangerText,textAlign:"right",fontWeight:700}}>⚠ {n} incidente{n>1?"s":""} abierto{n>1?"s":""}</div>
      );})()}
    </div>
  );
}

