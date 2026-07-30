import { useState, useEffect, useMemo } from "react";
import { FormIngresarCompra } from "../forms/FormIngresarCompra";
import { FormEntregaFallida, FormFechaEntrega, FormReclamarFactura } from "../forms/FormulariosCorreo";
import { FormConfirmarEntrega, FormEmitirFactura, FormPagoCliente, FormPagoFinanciamiento } from "../forms/FormulariosRapidos";
import { DiasBadge, Field, Leyenda, Modal, Trazabilidad } from "../ui/Basicos";
import { EtapasOC, FormPostventa } from "../ui/EtapasOC";
import { BloqueoBanner, ComentariosOC, HistorialCambiosOC } from "../ui/Multiusuario";
import { del } from "../../lib/supabase";
import { C, MONO, btnG, btnP, calcMargen, fmt, iMono, iStyle, selStyle } from "../../lib/theme";

export const FILTROS=[
  {key:"compra",label:"Compra",okField:"estado_compra",okValue:"comprado",okLabel:"Comprado",pendLabel:"Pendiente"},
  {key:"entrega",label:"Entrega",okField:"estado_entrega",okValue:"confirmada",okLabel:"Confirmada",pendLabel:"Sin confirmar"},
  {key:"factura",label:"Factura",okField:"estado_factura_propia",okValue:"emitida",okLabel:"Emitida",pendLabel:"Por emitir"},
  {key:"cobro",label:"Cobro",okField:"estado_pago_cliente",okValue:"pagado",okLabel:"Cobrado",pendLabel:"Por cobrar"},
  {key:"financ",label:"Financ.",okField:"estado_pago_financiamiento",okValue:"pagado",okLabel:"Pagado",pendLabel:"Con deuda"},
];

export function FormEditarDatosOC({ oc, onSave, entidadesCatalogo }) {
  const [cliente,setCliente]=useState(oc.cliente||"");
  const [entidad,setEntidad]=useState(oc.entidad||"");
  const [comuna,setComuna]=useState(oc.comuna||"");
  const [contacto,setContacto]=useState(oc.contacto||"");
  const [rutCliente,setRutCliente]=useState(oc.rut_cliente||"");
  const [correo,setCorreo]=useState(oc.correo_cliente||"");
  const fechaActual=(oc.eventos_compra||[])[0]?.fecha||"";
  const [fechaOC,setFechaOC]=useState(fechaActual?String(fechaActual).slice(0,10):"");
  const [autocompletado,setAutocompletado]=useState(false);
  const [err,setErr]=useState(""); const [saving,setSaving]=useState(false);
  const handleRutChange=(val)=>{
    setRutCliente(val);
    const match=(entidadesCatalogo||[]).find(e=>e.rut===val.trim());
    if(match&&val.trim()){
      if(!entidad) setEntidad(match.nombre_entidad||"");
      if(!comuna) setComuna(match.comuna||"");
      if(!contacto) setContacto(match.contacto||"");
      if(!correo) setCorreo(match.correo||"");
      setAutocompletado(true);
    }
  };
  const handleSave=async()=>{
    setErr(""); setSaving(true);
    try { await onSave({ cliente:cliente.toUpperCase(), entidad:entidad.toUpperCase(), comuna:comuna.toUpperCase(), contacto, rutCliente, correo, fechaOC:fechaOC||null }); }
    catch(e){ setErr(e.message); } finally{ setSaving(false); }
  };
  return (
    <div>
      <Field label="RUT del cliente" hint="Si ya existe en el catálogo, autocompleta los demás datos"><input style={iStyle} value={rutCliente} onChange={e=>handleRutChange(e.target.value)} placeholder="ej: 12.345.678-9" /></Field>
      {autocompletado&&<div style={{background:C.okLight,borderRadius:8,padding:"8px 12px",fontSize:11.5,color:C.ok,fontWeight:600,marginBottom:12}}>✓ Datos autocompletados desde el catálogo de entidades</div>}
      <Field label="Nombre del cliente" hint="Se guarda en mayúscula"><input style={iStyle} value={cliente} onChange={e=>setCliente(e.target.value)} placeholder="Nombre del cliente" /></Field>
      <Field label="Entidad (organismo público)" hint="Se guarda en mayúscula"><input style={iStyle} value={entidad} onChange={e=>setEntidad(e.target.value)} placeholder="ej: I. Municipalidad de..." /></Field>
      <Field label="Comuna" hint="Se guarda en mayúscula"><input style={iStyle} value={comuna} onChange={e=>setComuna(e.target.value)} placeholder="ej: Concepción" /></Field>
      <Field label="Contacto"><input style={iStyle} value={contacto} onChange={e=>setContacto(e.target.value)} placeholder="Nombre y/o teléfono de contacto" /></Field>
      <Field label="Correo del cliente"><input style={iStyle} type="email" value={correo} onChange={e=>setCorreo(e.target.value)} placeholder="contacto@entidad.cl" /></Field>
      <Field label="Fecha de la OC" hint="Fecha de compra que se muestra como fecha de creación"><input style={iStyle} type="date" value={fechaOC} onChange={e=>setFechaOC(e.target.value)} /></Field>
      {err&&<div style={{background:C.dangerLight,color:C.danger,borderRadius:8,padding:"8px 12px",fontSize:12.5,marginBottom:10,fontWeight:600}}>{err}</div>}
      <button onClick={handleSave} disabled={saving} style={btnP(saving?C.inkFaint:C.info)}>{saving?"Guardando…":"✓ Guardar datos"}</button>
    </div>
  );
}

export function FormEditarEvento({ item, onSave, onCancel }) {
  const e = item.e; const tabla = item.tabla;
  const [fecha,setFecha]=useState(e.fecha||"");
  const [montoVenta,setMontoVenta]=useState(e.monto_venta??"");
  const [costoCompra,setCostoCompra]=useState(e.costo_compra??"");
  const [personaRecibe,setPersonaRecibe]=useState(e.persona_recibe||"");
  const [numeroFactura,setNumeroFactura]=useState(e.numero_factura||"");
  const [monto,setMonto]=useState(e.monto??"");
  const [err,setErr]=useState(""); const [saving,setSaving]=useState(false);

  const handleSave=async()=>{
    setErr(""); setSaving(true);
    try {
      let cambios={fecha};
      if(tabla==="eventos_compra") cambios={...cambios, monto_venta:Number(montoVenta), costo_compra:Number(costoCompra)};
      if(tabla==="eventos_entrega") cambios={...cambios, persona_recibe:personaRecibe};
      if(tabla==="eventos_factura") cambios={...cambios, numero_factura:numeroFactura, monto:Number(monto)};
      if(tabla==="eventos_pago_cliente"||tabla==="eventos_pago_financiamiento") cambios={...cambios, monto:Number(monto)};
      await onSave(tabla, e, cambios);
    } catch(err){ setErr(err.message); } finally{ setSaving(false); }
  };

  return (
    <div>
      <div style={{background:C.warnLight,borderRadius:9,padding:"10px 12px",fontSize:12,color:C.warn,fontWeight:600,marginBottom:14}}>
        ⚠ Editar este evento ajustará automáticamente el saldo del financiador y los totales de la OC según la diferencia.
      </div>
      <Field label="Fecha" required><input style={iStyle} type="date" value={fecha} onChange={ev=>setFecha(ev.target.value)} /></Field>
      {tabla==="eventos_compra"&&(<>
        <Field label="Monto venta ($)" required><input style={iMono} type="number" value={montoVenta} onChange={ev=>setMontoVenta(ev.target.value)} /></Field>
        <Field label="Costo compra ($)" required><input style={iMono} type="number" value={costoCompra} onChange={ev=>setCostoCompra(ev.target.value)} /></Field>
      </>)}
      {tabla==="eventos_entrega"&&(
        <Field label="Persona que recibe"><input style={iStyle} value={personaRecibe} onChange={ev=>setPersonaRecibe(ev.target.value)} /></Field>
      )}
      {tabla==="eventos_factura"&&(<>
        <Field label="N° factura" required><input style={iMono} value={numeroFactura} onChange={ev=>setNumeroFactura(ev.target.value)} /></Field>
        <Field label="Monto ($)" required><input style={iMono} type="number" value={monto} onChange={ev=>setMonto(ev.target.value)} /></Field>
      </>)}
      {(tabla==="eventos_pago_cliente"||tabla==="eventos_pago_financiamiento")&&(
        <Field label="Monto ($)" required><input style={iMono} type="number" value={monto} onChange={ev=>setMonto(ev.target.value)} /></Field>
      )}
      {err&&<div style={{background:C.dangerLight,color:C.danger,borderRadius:8,padding:"8px 12px",fontSize:12.5,marginBottom:10,fontWeight:600}}>{err}</div>}
      <button onClick={handleSave} disabled={saving} style={btnP(saving?C.inkFaint:C.warn)}>{saving?"Guardando…":"✓ Guardar corrección"}</button>
      <button onClick={onCancel} style={{...btnG,marginTop:8,width:"100%"}}>Cancelar</button>
    </div>
  );
}

export function FilaOC({ oc, perfiles, expanded, onToggle, contactos, onEnviarReclamo, onGuardarContacto, onGuardarDatosOC, onEditarEvento, financiadores, onConfirmarEntrega, onEmitirFactura, onPagoCliente, onPagoFinanciamiento, entidadesCatalogo, onGuardarLink, onEliminarLink, onEditarLink, bloqueos, perfil, historialCambios, onAgregarComentario, onEliminarComentario, onBloquear, onLiberar, onEliminarOC, onEliminarFactura, onEliminarEvento, vendedores, onIngresarCompra, onAsignarResponsable, onGuardarPostventa }) {
  const evF=(oc.eventos_factura||[])[0];
  const dias=fmt.diasDesde(evF?.fecha);
  const saldo=(oc.monto_facturado||0)-(oc.monto_cobrado||0);
  const [reclamando,setReclamando]=useState(false);
  const [editandoDatos,setEditandoDatos]=useState(false);
  const [editandoEvento,setEditandoEvento]=useState(null);
  const [accionRapida,setAccionRapida]=useState(null);
  const [correoFallida,setCorreoFallida]=useState(false);
  const [correoFecha,setCorreoFecha]=useState(false);
  const plazoOC = Number(oc.dias_pago)>0?Number(oc.dias_pago):30;
  const puedeReclamar = oc.estado_pago_cliente!=="pagado" && evF && dias!==null && dias>=plazoOC;

  const ultimoReclamo=(oc.oc_reclamos||[]).slice().sort((a,b)=>b.fecha?.localeCompare(a.fecha))[0];
  const hrsDesdeReclamo=ultimoReclamo?Math.floor((new Date()-new Date(ultimoReclamo.fecha))/(1000*60*60)):null;

  const bloqueoActivo=(bloqueos||[]).find(b=>b.oc_id===oc.id&&b.usuario_id!==perfil?.id&&new Date(b.expira_en)>new Date());

  const completadas=[
    (oc.eventos_compra||[]).length>0,
    oc.estado_entrega==="confirmada"||oc.estado_entrega==="entregado",
    oc.estado_factura_propia==="emitida",
    oc.estado_pago_cliente==="pagado",
    oc.estado_pago_financiamiento==="pagado",
  ].filter(Boolean).length;
  const borderColor = oc.estado_pago_cliente==="pagado"&&oc.estado_pago_financiamiento==="pagado" ? C.ok
    : puedeReclamar ? C.danger
    : evF ? C.warn
    : completadas>0 ? C.teal : C.border;

  const evFechas=[
    ...(oc.eventos_compra||[]).map(e=>e.creadoEn||e.fecha),
    ...(oc.eventos_entrega||[]).map(e=>e.creadoEn||e.fecha),
    ...(oc.eventos_factura||[]).map(e=>e.creadoEn||e.fecha),
    ...(oc.eventos_pago_cliente||[]).map(e=>e.creadoEn||e.fecha),
  ].filter(Boolean).sort();
  const ultimaActividad=evFechas[evFechas.length-1];
  const diasEstancada=ultimaActividad?Math.floor((new Date()-new Date(ultimaActividad))/(1000*60*60*24)):null;
  const estancada=completadas>0&&completadas<5&&diasEstancada!==null&&diasEstancada>=7;

  const handleToggle=async()=>{
    if(!expanded && onBloquear) await onBloquear(oc.id);
    if(expanded && onLiberar) await onLiberar(oc.id);
    onToggle();
  };

  return (
    <div style={{background:C.card,border:`1px solid ${C.border}`,borderLeft:`4px solid ${borderColor}`,borderRadius:13,marginBottom:8,overflow:"hidden"}}>
      <div onClick={handleToggle} style={{padding:"12px 14px",cursor:"pointer"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2}}>
              <span style={{fontFamily:MONO,fontWeight:800,fontSize:13,color:C.ink}}>{oc.numero_oc}</span>
              {estancada&&<span style={{fontSize:9.5,background:C.warnLight,color:C.warn,borderRadius:5,padding:"1px 5px",fontWeight:700}}>⏸ {diasEstancada}d sin avance</span>}
              {completadas===5&&<span style={{fontSize:9.5,background:C.okLight,color:C.ok,borderRadius:5,padding:"1px 5px",fontWeight:700}}>✓ Completa</span>}
            </div>
            {(()=>{
              const esPorCompletar=oc.cliente?.toUpperCase().includes("POR COMPLETAR");
              const nombreMostrar=esPorCompletar?(oc.entidad||null):oc.cliente;
              return nombreMostrar
                ? <div style={{fontSize:11.5,color:C.inkMuted,marginBottom:2}}>{nombreMostrar}{oc.comuna?` · ${oc.comuna}`:""}</div>
                : <div style={{fontSize:11.5,color:C.warn,marginBottom:2,fontWeight:700}}>⚠ Agregar entidad{oc.comuna?` · ${oc.comuna}`:""}</div>;
            })()}
            <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
              <span style={{fontSize:11,color:C.inkFaint}}>{oc.financiadores?.nombre} · {oc.vendedores?.nombre}</span>
              {evF&&<span style={{fontSize:10.5,color:C.info,fontWeight:600}}>🧾 {evF.numero_factura}{oc.estado_pago_cliente!=="pagado"&&dias!==null?` · ${dias}d`:""}</span>}
            </div>
          </div>
          <div style={{textAlign:"right",flexShrink:0}}>
            <div style={{fontFamily:MONO,fontWeight:800,fontSize:14,color:C.ok}}>{fmt.money(oc.monto_total)}</div>
            {(()=>{const mg=calcMargen(oc.monto_total,oc.costo_total);return(<span style={{fontSize:10,color:mg.color,fontWeight:700,background:mg.bg,padding:"1px 6px",borderRadius:5}}>{mg.pct}%</span>);})()}
            <div style={{fontSize:10,color:C.inkFaint,marginTop:2}}>{completadas}/5 etapas</div>
          </div>
        </div>
        {evF&&dias!==null&&oc.estado_pago_cliente!=="pagado"&&<div style={{marginTop:4}}><DiasBadge dias={dias} diasPago={oc.dias_pago} /></div>}
      </div>

      {expanded&&(
        <div style={{borderTop:`1px solid ${C.border}`,padding:"12px 14px",background:C.paper}}>
          {bloqueoActivo&&<BloqueoBanner bloqueo={bloqueoActivo} />}

          <div style={{background:C.card,borderRadius:9,padding:"10px 12px",marginBottom:12,fontSize:12}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,color:C.inkMuted}}>
              <div>Vendedor: <b style={{color:C.ink}}>{oc.vendedores?.nombre||"—"}</b></div>
              <div>Financiador: <b style={{color:C.ink}}>{oc.financiadores?.nombre||"—"}</b></div>
              {oc.monto_facturado>0&&<div>Facturado: <b style={{color:C.ink}}>{fmt.money(oc.monto_facturado)}</b></div>}
              {oc.monto_facturado>0&&(
                saldo>0
                  ? <div>Por cobrar: <b style={{color:C.danger}}>{fmt.money(saldo)}</b></div>
                  : <div>Pago cliente: <b style={{color:C.ok}}>✓ Recibido</b></div>
              )}
              {oc.entidad&&<div style={{gridColumn:"1/-1"}}>Entidad: <b style={{color:C.ink}}>{oc.entidad}</b></div>}
              {oc.contacto&&<div style={{gridColumn:"1/-1"}}>Contacto: <b style={{color:C.ink}}>{oc.contacto}</b></div>}
              {(()=>{
                const esHistorica=oc.id?.startsWith("ocv2_hist");
                const fechaCompra=(oc.eventos_compra||[])[0]?.fecha;
                const fechaMostrar=esHistorica&&fechaCompra?fechaCompra:oc.creadoEn;
                return fechaMostrar?<div style={{gridColumn:"1/-1"}}>Creada: <b style={{color:C.ink}}>{esHistorica&&fechaCompra?fmt.date(fechaCompra):fmt.datetime(fechaMostrar)}</b></div>:null;
              })()}
            </div>
            {oc.vendedor_pagado&&<div style={{fontSize:11,color:C.ok,fontWeight:600,marginTop:6}}>✓ Vendedor ya pagado por esta venta</div>}
            {oc.ultima_edicion&&<div style={{fontSize:10,color:C.inkFaint,marginTop:4}}>✏️ Editado por <Trazabilidad creadoPor={oc.ultimo_editor} creadoEn={oc.ultima_edicion} perfiles={perfiles} /></div>}
          </div>

          <EtapasOC oc={oc} perfil={perfil} perfiles={perfiles}
            onAsignarResponsable={onAsignarResponsable}
            onEditarEvento={setEditandoEvento}
            onEliminarFactura={onEliminarFactura}
            onEliminarEvento={onEliminarEvento}
            onAccion={(key)=>setAccionRapida(key)}
            onCorreoFallida={()=>setCorreoFallida(true)}
            onCorreoFecha={()=>setCorreoFecha(true)}
            onGuardarLink={onGuardarLink}
            onEliminarLink={onEliminarLink}
            onEditarLink={onEditarLink}
          />

          {puedeReclamar&&(
            hrsDesdeReclamo!==null&&hrsDesdeReclamo<24
              ? <div style={{background:C.okLight,borderRadius:8,padding:"8px 12px",fontSize:11.5,color:C.ok,fontWeight:600,marginBottom:10}}>
                  ✅ Reclamada hace {hrsDesdeReclamo}h · {ultimoReclamo.correo}
                </div>
              : <button onClick={()=>setReclamando(true)} style={{...btnP(C.danger),marginBottom:10}}>
                  📧 Reclamar pago de factura{(oc.oc_reclamos||[]).length>0?` (${(oc.oc_reclamos||[]).length} reclamo${(oc.oc_reclamos||[]).length>1?"s":""} previo${(oc.oc_reclamos||[]).length>1?"s":""})`:""}</button>
          )}

          <ComentariosOC oc={oc} perfil={perfil} onAgregar={onAgregarComentario} onEliminar={onEliminarComentario} />
          <HistorialCambiosOC ocId={oc.id} historialCambios={historialCambios} />

          <div style={{display:"flex",gap:6,marginTop:8,flexWrap:"wrap"}}>
            <button onClick={()=>setEditandoDatos(true)} style={{...btnG,flex:1}}>✏️ Editar datos</button>
            <button onClick={()=>setCorreoFallida(true)} style={{...btnG,flex:1}}>⚠️ Entrega fallida</button>
            <button onClick={()=>setCorreoFecha(true)} style={{...btnG,flex:1}}>📅 Fecha entrega</button>
          </div>
          {perfil?.rol==="admin"&&(
            <button onClick={async()=>{
              if(window.confirm(`¿Eliminar la OC ${oc.numero_oc}?\n\nEsta acción no se puede deshacer.`))
                await onEliminarOC(oc.id);
            }} style={{width:"100%",background:"none",border:`1px solid ${C.danger}`,color:C.danger,borderRadius:9,padding:"8px 12px",fontSize:12,fontWeight:600,cursor:"pointer",marginTop:8}}>
              🗑 Eliminar esta OC
            </button>
          )}
        </div>
      )}
      {reclamando&&(
        <Modal title="Reclamar pago de factura" onClose={()=>setReclamando(false)}>
          <FormReclamarFactura oc={oc} evF={evF} dias={dias} contactos={contactos||[]}
            onGuardarContacto={onGuardarContacto}
            onEnviar={async(data)=>{ await onEnviarReclamo(data); setReclamando(false); }} />
        </Modal>
      )}
      {editandoDatos&&(
        <Modal title="Editar datos de la OC" onClose={()=>setEditandoDatos(false)}>
          <FormEditarDatosOC oc={oc} entidadesCatalogo={entidadesCatalogo} onSave={async(data)=>{ await onGuardarDatosOC(oc.id,data); setEditandoDatos(false); }} />
        </Modal>
      )}
      {editandoEvento&&(
        <Modal title={`Editar ${editandoEvento.tipo}`} onClose={()=>setEditandoEvento(null)}>
          <FormEditarEvento item={editandoEvento}
            onCancel={()=>setEditandoEvento(null)}
            onSave={async(tabla,eventoOriginal,cambios)=>{ await onEditarEvento(oc, tabla, eventoOriginal, cambios); setEditandoEvento(null); }} />
        </Modal>
      )}
      {accionRapida==="postventa"&&(
        <Modal title="Post-venta" onClose={()=>setAccionRapida(null)}>
          <FormPostventa oc={oc} onSave={async(d)=>{ await onGuardarPostventa(d); setAccionRapida(null); }} />
        </Modal>
      )}
      {accionRapida==="compra"&&(
        <Modal title="Registrar compra" onClose={()=>setAccionRapida(null)}>
          <FormIngresarCompra ocs={[]} financiadores={financiadores} vendedores={vendedores} entidadesCatalogo={entidadesCatalogo} ocExistente={oc} onSave={async(data)=>{ await onIngresarCompra(data); setAccionRapida(null); }} />
        </Modal>
      )}
      {accionRapida==="entrega"&&(
        <Modal title="Confirmar entrega" onClose={()=>setAccionRapida(null)}>
          <FormConfirmarEntrega ocs={[oc]} ocPreseleccionada={oc.id} onSave={async(data)=>{ await onConfirmarEntrega(data); setAccionRapida(null); }} />
        </Modal>
      )}
      {accionRapida==="factura"&&(
        <Modal title="Emitir factura" onClose={()=>setAccionRapida(null)}>
          <FormEmitirFactura ocs={[oc]} ocPreseleccionada={oc.id} onSave={async(data)=>{ await onEmitirFactura(data); setAccionRapida(null); }} />
        </Modal>
      )}
      {accionRapida==="pago_cliente"&&(
        <Modal title="Pago de factura" onClose={()=>setAccionRapida(null)}>
          <FormPagoCliente ocs={[oc]} ocPreseleccionada={oc.id} onSave={async(data)=>{ await onPagoCliente(data); setAccionRapida(null); }} />
        </Modal>
      )}
      {accionRapida==="pago_financ"&&(
        <Modal title="Pago de financiamiento" onClose={()=>setAccionRapida(null)}>
          <FormPagoFinanciamiento ocs={[oc]} financiadores={financiadores} ocPreseleccionada={oc.id} financiadorPreseleccionado={oc.financiador_id} onSave={async(data)=>{ await onPagoFinanciamiento(data); setAccionRapida(null); }} />
        </Modal>
      )}
      {correoFallida&&(
        <Modal title="Aviso de entrega fallida" onClose={()=>setCorreoFallida(false)}>
          <FormEntregaFallida oc={oc} entidadesCatalogo={entidadesCatalogo} onEnviar={async()=>{ setCorreoFallida(false); }} />
        </Modal>
      )}
      {correoFecha&&(
        <Modal title="Fecha estimada de entrega" onClose={()=>setCorreoFecha(false)}>
          <FormFechaEntrega oc={oc} entidadesCatalogo={entidadesCatalogo} onEnviar={async()=>{ setCorreoFecha(false); }} />
        </Modal>
      )}
    </div>
  );
}

export function PanelCompras({ ocs, perfiles, filtroInicial, contactos, onEnviarReclamo, onGuardarContacto, onGuardarDatosOC, onEditarEvento, financiadores, onConfirmarEntrega, onEmitirFactura, onPagoCliente, onPagoFinanciamiento, entidadesCatalogo, onGuardarLink, onEliminarLink, onEditarLink, bloqueos, perfil, historialCambios, onAgregarComentario, onEliminarComentario, onBloquear, onLiberar, onEliminarOC, onEliminarFactura, onEliminarEvento, vendedores, onIngresarCompra, onAsignarResponsable, onGuardarPostventa }) {
  const [filtros,setFiltros]=useState({}); const [busq,setBusq]=useState(""); const [expId,setExpId]=useState(null);
  const [reclamandoBanner,setReclamandoBanner]=useState(null); const [comunaSel,setComunaSel]=useState("");
  const [bannerAbierto,setBannerAbierto]=useState(false);
  useEffect(()=>{ setFiltros(filtroInicial?{[filtroInicial]:"pend"}:{}); },[filtroInicial]);
  const toggle=(key,val)=>setFiltros(prev=>({...prev,[key]:prev[key]===val?undefined:val}));
  const comunas=useMemo(()=>Array.from(new Set(ocs.map(o=>o.comuna).filter(Boolean))).sort(),[ocs]);
  const filtered=useMemo(()=>ocs.filter(oc=>{
    if(busq.trim()){ const q=busq.toLowerCase(); if(!oc.numero_oc.toLowerCase().includes(q)&&!(oc.cliente||"").toLowerCase().includes(q)&&!(oc.comuna||"").toLowerCase().includes(q)&&!(oc.entidad||"").toLowerCase().includes(q)) return false; }
    if(comunaSel&&oc.comuna!==comunaSel) return false;
    for(const f of FILTROS){ const s=filtros[f.key]; if(!s) continue; const ok=oc[f.okField]===f.okValue; if(s==="ok"&&!ok) return false; if(s==="pend"&&ok) return false; }
    return true;
  }).sort((a,b)=>{
    const fa=((a.eventos_compra||[])[0]?.fecha)||a.creadoEn||"";
    const fb=((b.eventos_compra||[])[0]?.fecha)||b.creadoEn||"";
    return String(fb).localeCompare(String(fa));
  }),[ocs,filtros,busq,comunaSel]);

  const alertas=useMemo(()=>ocs.filter(o=>{
    if(o.estado_pago_cliente==="pagado") return false;
    const evF=(o.eventos_factura||[])[0]; if(!evF) return false;
    const plazo=Number(o.dias_pago)>0?Number(o.dias_pago):30;
    return (fmt.diasDesde(evF.fecha)||0)>=plazo;
  }).sort((a,b)=>{
    const dA=fmt.diasDesde((a.eventos_factura||[])[0]?.fecha)||0;
    const dB=fmt.diasDesde((b.eventos_factura||[])[0]?.fecha)||0;
    return dB-dA;
  }),[ocs]);

  return (
    <div>
      {alertas.length>0&&(
        <div style={{background:C.dangerLight,border:`1px solid ${C.danger}`,borderRadius:12,marginBottom:14,overflow:"hidden"}}>
          <div onClick={()=>setBannerAbierto(v=>!v)} style={{padding:"10px 12px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{fontWeight:800,color:C.danger,fontSize:12}}>⚠ {alertas.length} factura{alertas.length>1?"s":""} vencida{alertas.length>1?"s":""} sin pagar</span>
            <span style={{color:C.danger,fontSize:13,fontWeight:700}}>{bannerAbierto?"▲":"▼"}</span>
          </div>
          {bannerAbierto&&(
            <div style={{padding:"0 12px 10px"}}>
              {alertas.map(o=>{
            const evF=(o.eventos_factura||[])[0];
            const dias=fmt.diasDesde(evF?.fecha);
            const reclamos=(o.oc_reclamos||[]).slice().sort((a,b)=>b.fecha?.localeCompare(a.fecha));
            const ultimoReclamo=reclamos[0];
            const hrsDesde=ultimoReclamo?Math.floor((new Date()-new Date(ultimoReclamo.fecha))/(1000*60*60)):null;
            const reclamadaHoy=hrsDesde!==null&&hrsDesde<24;
            return (
              <div key={o.id} style={{display:"flex",alignItems:"center",gap:8,marginBottom:6,background:"rgba(255,255,255,0.5)",borderRadius:8,padding:"7px 10px"}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    <span style={{fontFamily:MONO,fontWeight:700,fontSize:12,color:C.ink}}>{o.numero_oc}</span>
                    <span style={{fontSize:10,color:C.danger,fontWeight:600}}>{dias}d</span>
                    {reclamos.length>0&&<span style={{fontSize:10,color:C.inkFaint}}>· {reclamos.length} reclamo{reclamos.length>1?"s":""}</span>}
                  </div>
                  {ultimoReclamo&&<div style={{fontSize:10,color:C.inkMuted,marginTop:1}}>Último: {ultimoReclamo.correo} · {fmt.datetime(ultimoReclamo.fecha)}</div>}
                </div>
                {reclamadaHoy
                  ? <div style={{display:"flex",alignItems:"center",gap:4,background:C.okLight,borderRadius:6,padding:"4px 8px",flexShrink:0}}>
                      <span style={{fontSize:12}}>✅</span>
                      <div>
                        <div style={{fontSize:10,fontWeight:700,color:C.ok,lineHeight:1.2}}>Reclamada</div>
                        <div style={{fontSize:9,color:C.inkMuted}}>hace {hrsDesde}h</div>
                      </div>
                    </div>
                  : <button onClick={()=>setReclamandoBanner(o)} style={{flexShrink:0,background:C.danger,border:"none",color:"#fff",borderRadius:7,padding:"6px 10px",fontSize:11,fontWeight:700,cursor:"pointer"}}>📧 Reclamar</button>
                }
              </div>
            );
          })}
            </div>
          )}
        </div>
      )}
      {reclamandoBanner&&(
        <Modal title="Reclamar pago de factura" onClose={()=>setReclamandoBanner(null)}>
          <FormReclamarFactura oc={reclamandoBanner} evF={(reclamandoBanner.eventos_factura||[])[0]} dias={fmt.diasDesde((reclamandoBanner.eventos_factura||[])[0]?.fecha)} contactos={contactos||[]}
            onGuardarContacto={onGuardarContacto}
            onEnviar={async(data)=>{ await onEnviarReclamo(data); setReclamandoBanner(null); }} />
        </Modal>
      )}
      <input style={{...iStyle,marginBottom:10}} placeholder="Buscar por N° OC, cliente, entidad o comuna…" value={busq} onChange={e=>setBusq(e.target.value)} />
      {comunas.length>0&&(
        <select style={{...selStyle,marginBottom:12}} value={comunaSel} onChange={e=>setComunaSel(e.target.value)}>
          <option value="">Todas las comunas</option>
          {comunas.map(c=><option key={c} value={c}>{c}</option>)}
        </select>
      )}
      <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:14}}>
        {FILTROS.map(f=>(
          <div key={f.key} style={{display:"flex",gap:3}}>
            <button onClick={()=>toggle(f.key,"pend")} style={{fontSize:10.5,fontWeight:700,padding:"5px 8px",borderRadius:7,border:`1.5px solid ${filtros[f.key]==="pend"?C.danger:C.border}`,background:filtros[f.key]==="pend"?C.dangerLight:C.card,color:filtros[f.key]==="pend"?C.danger:C.inkMuted,cursor:"pointer"}}>{f.label}: {f.pendLabel}</button>
            <button onClick={()=>toggle(f.key,"ok")} style={{fontSize:10.5,fontWeight:700,padding:"5px 8px",borderRadius:7,border:`1.5px solid ${filtros[f.key]==="ok"?C.ok:C.border}`,background:filtros[f.key]==="ok"?C.okLight:C.card,color:filtros[f.key]==="ok"?C.ok:C.inkMuted,cursor:"pointer"}}>{f.okLabel}</button>
          </div>
        ))}
      </div>
      <div style={{fontSize:11.5,color:C.inkFaint,marginBottom:10}}>{filtered.length} orden{filtered.length!==1?"es":""}</div>
      {filtered.map(oc=><FilaOC key={oc.id} oc={oc} perfiles={perfiles} expanded={expId===oc.id} onToggle={()=>setExpId(expId===oc.id?null:oc.id)} contactos={contactos} onEnviarReclamo={onEnviarReclamo} onGuardarContacto={onGuardarContacto} onGuardarDatosOC={onGuardarDatosOC} onEditarEvento={onEditarEvento} financiadores={financiadores} onConfirmarEntrega={onConfirmarEntrega} onEmitirFactura={onEmitirFactura} onPagoCliente={onPagoCliente} onPagoFinanciamiento={onPagoFinanciamiento} entidadesCatalogo={entidadesCatalogo} onGuardarLink={onGuardarLink} onEliminarLink={onEliminarLink} onEditarLink={onEditarLink} bloqueos={bloqueos} perfil={perfil} historialCambios={historialCambios} onAgregarComentario={onAgregarComentario} onEliminarComentario={onEliminarComentario} onBloquear={onBloquear} onLiberar={onLiberar} onEliminarOC={onEliminarOC} onEliminarFactura={onEliminarFactura} onEliminarEvento={onEliminarEvento} vendedores={vendedores} onIngresarCompra={onIngresarCompra} onAsignarResponsable={onAsignarResponsable} onGuardarPostventa={onGuardarPostventa} />)}
      {filtered.length===0&&<div style={{textAlign:"center",padding:30,color:C.inkFaint,fontSize:13}}>No hay órdenes con estos filtros.</div>}
      <Leyenda items={[
        {muestra:"12d / 30d", color:C.ok, bg:C.okLight, texto:"Días desde que se emitió la factura sobre el plazo de pago de esa OC. Verde: al día."},
        {muestra:"Por vencer", color:C.warn, bg:C.warnLight, texto:"Faltan 5 días o menos para cumplirse el plazo."},
        {muestra:"Vencida", color:C.danger, bg:C.dangerLight, texto:"Se pasó el plazo. A los 9 días de vencida cambia a «Reclamar» y se habilita el correo de cobranza."},
        {muestra:"23%", color:C.ok, bg:C.okLight, texto:"Margen de la OC. Verde sobre 20%, amarillo entre 10% y 20%, rojo bajo 10%."},
        {muestra:"⏸", texto:"Sin avance hace 7 días o más: la OC quedó estancada entre una etapa y otra."},
        {muestra:"✓", texto:"Ciclo completo: compra, entrega, factura, cobro y financiamiento cerrados."},
        {muestra:"⚠", texto:"Falta completar la entidad del cliente."},
        {muestra:"🔒", texto:"Otra persona está editando esta OC en este momento."},
        {muestra:"▎", texto:"La franja de color a la izquierda resume el estado: verde cerrada, rojo por reclamar, amarillo facturada, celeste en curso."},
      ]} />
    </div>
  );
}
