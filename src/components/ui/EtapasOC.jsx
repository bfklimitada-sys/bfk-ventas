import { useState } from "react";
import { Field } from "./Basicos";
import { del } from "../../lib/supabase";
import { C, MONO, SANS, btnP, fmt, iStyle, selStyle } from "../../lib/theme";

export const TIPOS_PV={falla:"Falla del producto",faltante:"Faltante",cambio:"Cambio / reposición",devolucion:"Devolución",otro:"Otro"};

export function FormPostventa({ oc, evento, onSave }) {
  const [tipo,setTipo]=useState(evento?.tipo||"falla");
  const [fecha,setFecha]=useState(evento?.fecha||new Date().toISOString().slice(0,10));
  const [descripcion,setDescripcion]=useState(evento?.descripcion||"");
  const [estado,setEstado]=useState(evento?.estado||"abierto");
  const [solucion,setSolucion]=useState(evento?.solucion||"");
  const [fechaRes,setFechaRes]=useState(evento?.fecha_resolucion||"");
  const [err,setErr]=useState(""); const [saving,setSaving]=useState(false);
  const guardar=async()=>{
    if(!descripcion.trim()){setErr("Describe la incidencia");return;}
    if(estado==="resuelto"&&!solucion.trim()){setErr("Indica la solución aplicada");return;}
    setErr("");setSaving(true);
    try{ await onSave({id:evento?.id,ocId:oc.id,tipo,fecha,descripcion:descripcion.trim(),estado,solucion:solucion.trim()||null,fecha_resolucion:estado==="resuelto"?(fechaRes||new Date().toISOString().slice(0,10)):null}); }
    catch(e){setErr(e.message);} finally{setSaving(false);}
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
      <Field label="Estado">
        <select style={selStyle} value={estado} onChange={e=>setEstado(e.target.value)}>
          <option value="abierto">Abierto</option>
          <option value="en_gestion">En gestión</option>
          <option value="resuelto">Resuelto</option>
        </select>
      </Field>
      {estado==="resuelto"&&<>
        <Field label="Solución aplicada" required>
          <textarea style={{...iStyle,minHeight:60,resize:"vertical"}} value={solucion} onChange={e=>setSolucion(e.target.value)} placeholder="Qué se hizo para resolver" />
        </Field>
        <Field label="Fecha de resolución"><input style={iStyle} type="date" value={fechaRes} onChange={e=>setFechaRes(e.target.value)} /></Field>
      </>}
      {err&&<div style={{background:C.dangerLight,color:C.danger,borderRadius:8,padding:"8px 12px",fontSize:12.5,marginBottom:10,fontWeight:600}}>{err}</div>}
      <button onClick={guardar} disabled={saving} style={btnP(saving?C.inkFaint:C.warn)}>{saving?"Guardando…":evento?"✓ Actualizar incidencia":"✓ Registrar incidencia"}</button>
    </div>
  );
}

export function EtapasOC({ oc, perfil, perfiles, onEditarEvento, onEliminarFactura, onEliminarEvento, onAccion, onCorreoFallida, onCorreoFecha, onGuardarLink, onEliminarLink, onEditarLink, onAsignarResponsable }) {
  const [detalle,setDetalle]=useState(null);

  const getEventos=(key)=>{
    if(key==="compra") return (oc.eventos_compra||[]);
    if(key==="entrega") return (oc.eventos_entrega||[]);
    if(key==="factura") return (oc.eventos_factura||[]);
    if(key==="cobro") return (oc.eventos_pago_cliente||[]);
    if(key==="financ") return (oc.eventos_pago_financiamiento||[]);
    if(key==="postventa") return (oc.eventos_postventa||[]);
    return [];
  };

  const etapas = [
    { key:"compra",  label:"Compra",  ok:(oc.eventos_compra||[]).length>0,        icon:"📦", tabla:"eventos_compra",
      accion: (oc.eventos_compra||[]).length===0?{label:"📦 Registrar compra",color:C.teal,key:"compra"}:null,
      correoBtns: null },
    { key:"entrega", label:"Entrega", ok:oc.estado_entrega==="confirmada"||oc.estado_entrega==="entregado",          icon:"🚚", tabla:"eventos_entrega",
      accion: oc.estado_entrega!=="confirmada"&&oc.estado_entrega!=="entregado"?{label:"✓ Confirmar entrega",color:C.transit,key:"entrega"}:null,
      correoBtns: [
        {label:"⚠️ Entrega fallida",action:onCorreoFallida,color:C.warn},
        {label:"📅 Fecha de entrega",action:onCorreoFecha,color:C.ink},
      ]},
    { key:"factura", label:"Factura", ok:oc.estado_factura_propia==="emitida",     icon:"🧾", tabla:"eventos_factura",
      accion: oc.estado_factura_propia!=="emitida"
        ?{label:"🧾 Emitir factura",color:C.info,key:"factura"}
        :{label:"🧾 Re-emitir (NC)",color:C.inkMuted,key:"factura"},
      correoBtns: null },
    { key:"cobro",   label:"Cobro",   ok:oc.estado_pago_cliente==="pagado",        icon:"💰", tabla:"eventos_pago_cliente",
      accion: oc.estado_factura_propia==="emitida"&&oc.estado_pago_cliente!=="pagado"?{label:"💰 Registrar cobro",color:C.ok,key:"pago_cliente"}:null,
      correoBtns: null },
    { key:"financ",  label:"Financ.", ok:oc.estado_pago_financiamiento==="pagado", icon:"🏦", tabla:"eventos_pago_financiamiento",
      accion: oc.estado_pago_financiamiento!=="pagado"?{label:"🏦 Registrar pago",color:C.purple,key:"pago_financ"}:null,
      correoBtns: null },
    { key:"postventa", label:"Post-venta", ok:(oc.eventos_postventa||[]).some(e=>e.estado==="resuelto"), icon:"🛠", tabla:"eventos_postventa",
      accion: {label:"🛠 Registrar incidencia",color:C.warn,key:"postventa"},
      correoBtns: null },
  ];
  const principales=etapas.filter(e=>e.key!=="postventa");
  const completadas=principales.filter(e=>e.ok).length;

  const renderDetalle=(etapa)=>{
    const eventos=getEventos(etapa.key);
    return (
      <div>
        {eventos.length===0&&(
          <div>
            {/* Estado marcado en OC pero sin evento detallado (OCs históricas) */}
            {etapa.key==="factura"&&oc.estado_factura_propia==="emitida"&&(
              <div style={{background:C.card,borderRadius:8,padding:"10px 12px",marginBottom:8}}>
                <div style={{fontSize:12.5,fontWeight:600}}>🧾 Factura registrada</div>
                <div style={{fontSize:11.5,color:C.inkMuted}}>Monto: <b>{fmt.money(oc.monto_facturado)}</b></div>
                <div style={{fontSize:11,color:C.warn,marginTop:4}}>Sin detalle de número y fecha — usa Re-emitir para agregar</div>
              </div>
            )}
            {etapa.key==="cobro"&&oc.estado_pago_cliente==="pagado"&&(
              <div style={{background:C.card,borderRadius:8,padding:"10px 12px",marginBottom:8}}>
                <div style={{fontSize:12.5,fontWeight:600}}>💰 Cobro registrado</div>
                <div style={{fontSize:11.5,color:C.inkMuted}}>Monto: <b>{fmt.money(oc.monto_cobrado||oc.monto_facturado||oc.monto_total)}</b></div>
                <div style={{fontSize:11,color:C.warn,marginTop:4}}>Registro histórico — sin fecha detallada</div>
              </div>
            )}
            {etapa.key==="entrega"&&(oc.estado_entrega==="confirmada"||oc.estado_entrega==="entregado")&&(
              <div style={{background:C.card,borderRadius:8,padding:"10px 12px",marginBottom:8}}>
                <div style={{fontSize:12.5,fontWeight:600}}>🚚 Entrega confirmada</div>
                <div style={{fontSize:11,color:C.warn,marginTop:4}}>Registro histórico — sin fecha detallada</div>
              </div>
            )}
            {etapa.key==="financ"&&oc.estado_pago_financiamiento==="pagado"&&(
              <div style={{background:C.card,borderRadius:8,padding:"10px 12px",marginBottom:8}}>
                <div style={{fontSize:12.5,fontWeight:600}}>🏦 Financiamiento pagado</div>
                <div style={{fontSize:11.5,color:C.inkMuted}}>Monto: <b>{fmt.money(oc.costo_total)}</b> · A: <b>{oc.financiadores?.nombre||"—"}</b></div>
                <div style={{fontSize:11,color:C.warn,marginTop:4}}>Registro histórico — sin fecha detallada</div>
              </div>
            )}
            {/* Mensaje solo cuando realmente no hay nada */}
            {!(
              (etapa.key==="factura"&&oc.estado_factura_propia==="emitida")||
              (etapa.key==="cobro"&&oc.estado_pago_cliente==="pagado")||
              (etapa.key==="entrega"&&(oc.estado_entrega==="confirmada"||oc.estado_entrega==="entregado"))||
              (etapa.key==="financ"&&oc.estado_pago_financiamiento==="pagado")
            )&&(
              etapa.key==="cobro"&&oc.estado_factura_propia!=="emitida"
                ? <div style={{fontSize:11.5,color:C.warn,padding:"4px 0 8px",fontWeight:600}}>⚠ Primero emite la factura para poder registrar el cobro</div>
                : <div style={{fontSize:12,color:C.inkFaint,padding:"4px 0 8px"}}>Sin registros aún</div>
            )}
            {/* Botón de acción inmediato cuando no hay registro */}
            {etapa.accion&&(
              <button onClick={()=>{onAccion&&onAccion(etapa.accion.key);}}
                style={{width:"100%",background:etapa.accion.color,border:"none",color:"#fff",borderRadius:8,padding:"9px 12px",fontSize:12,fontWeight:700,cursor:"pointer"}}>
                {etapa.accion.label}
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
          <div key={ev.id||i} style={{background:C.card,borderRadius:8,padding:"10px 12px",marginBottom:6}}>
            {etapa.key==="compra"&&<>
              <div style={{fontSize:12.5,fontWeight:600}}>📅 {fmt.date(ev.fecha)||"—"}</div>
              <div style={{fontSize:11.5,color:C.inkMuted}}>Venta: <b>{fmt.money(ev.monto_venta||oc.monto_total)}</b> · Costo: <b>{fmt.money(ev.costo_compra||oc.costo_total)}</b></div>
              {ev.fecha_entrega_estimada&&<div style={{fontSize:11,color:C.inkMuted}}>Entrega est.: {fmt.date(ev.fecha_entrega_estimada)}</div>}
              {ev.proveedor&&<div style={{fontSize:11,color:C.inkMuted}}>Proveedor: {ev.proveedor}</div>}
              <div style={{fontSize:11,color:C.inkMuted}}>Financiador: <b>{oc.financiadores?.nombre||"—"}</b> · Vendedor: <b>{oc.vendedores?.nombre||"—"}</b></div>
              {/* Links de productos dentro de Compra */}
              <div style={{marginTop:8,borderTop:`1px solid ${C.border}`,paddingTop:8}}>
                <div style={{fontSize:10.5,fontWeight:700,color:C.inkMuted,textTransform:"uppercase",marginBottom:6}}>🔗 Productos</div>
                {(oc.oc_productos_link||[]).sort((a,b)=>a.orden-b.orden).map((l,li)=>(
                  <div key={l.id} style={{display:"flex",alignItems:"center",gap:6,marginBottom:4,background:C.card,borderRadius:7,padding:"6px 8px"}}>
                    <span style={{fontSize:10.5,color:C.inkMuted,fontWeight:700,minWidth:14}}>{li+1}</span>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12,fontWeight:600,color:C.ink}}>{l.descripcion}</div>
                      {l.url&&l.url!=="sin-link"&&<a href={l.url} target="_blank" rel="noopener noreferrer" style={{fontSize:10,color:C.teal,textDecoration:"none"}}>{l.url.length>40?l.url.slice(0,40)+"…":l.url}</a>}
                    </div>
                    {l.url&&l.url!=="sin-link"&&<button onClick={()=>window.open(l.url,'_blank')} style={{background:C.tealLight,border:"none",borderRadius:5,padding:"3px 6px",fontSize:11,color:C.teal,cursor:"pointer",flexShrink:0}}>↗</button>}
                    <button onClick={()=>{const nd=prompt("Nueva descripción:",l.descripcion);if(nd)onEditarLink&&onEditarLink(l.id,{descripcion:nd,url:l.url});}} style={{background:"none",border:"none",fontSize:11,cursor:"pointer",flexShrink:0}}>✏️</button>
                    <button onClick={async()=>{if(window.confirm("¿Eliminar este link?"))await onEliminarLink&&onEliminarLink(l.id);}} style={{background:"none",border:"none",fontSize:11,color:C.danger,cursor:"pointer",flexShrink:0}}>✕</button>
                  </div>
                ))}
                <MiniFormLink ocId={oc.id} onGuardar={onGuardarLink} orden={(oc.oc_productos_link||[]).length} />
              </div>
            </>}
            {etapa.key==="entrega"&&<>
              <div style={{fontSize:12.5,fontWeight:600}}>✅ Entregado el {fmt.date(ev.fecha)||"—"}</div>
              {ev.persona_recibe&&<div style={{fontSize:11.5,color:C.inkMuted}}>Recibe: {ev.persona_recibe}</div>}
              {ev.observaciones&&<div style={{fontSize:11,color:C.inkMuted}}>{ev.observaciones}</div>}
              {!ev.persona_recibe&&!ev.observaciones&&<div style={{fontSize:11,color:C.inkFaint}}>Sin detalle adicional</div>}
            </>}
            {etapa.key==="factura"&&<>
              <div style={{fontSize:12.5,fontWeight:600}}>🧾 Factura N°{ev.numero_factura||"—"} · {fmt.money(ev.monto||oc.monto_facturado)}</div>
              <div style={{fontSize:11.5,color:C.inkMuted}}>Emitida el {fmt.date(ev.fecha)||"—"}</div>
              {ev.nota_credito&&<div style={{fontSize:11,color:C.warn}}>NC N°{ev.nota_credito} · anula factura N°{ev.factura_anulada_numero}</div>}
              {ev.motivo_diferencia&&<div style={{fontSize:11,color:C.warn,marginTop:3}}>⚠ Difiere de la OC: {ev.motivo_diferencia}</div>}
            </>}
            {etapa.key==="cobro"&&<>
              <div style={{fontSize:12.5,fontWeight:600}}>💰 {fmt.money(ev.monto||oc.monto_cobrado)} cobrado</div>
              <div style={{fontSize:11.5,color:C.inkMuted}}>{fmt.date(ev.fecha)||"—"}</div>
              {ev.referencia&&<div style={{fontSize:11,color:C.inkMuted}}>Ref: {ev.referencia}</div>}
            </>}
            {etapa.key==="financ"&&<>
              <div style={{fontSize:12.5,fontWeight:600}}>🏦 {fmt.money(ev.monto||oc.costo_total)} pagado</div>
              <div style={{fontSize:11.5,color:C.inkMuted}}>{fmt.date(ev.fecha)||"—"}</div>
              {ev.financiador_id&&<div style={{fontSize:11,color:C.inkMuted}}>A: {oc.financiadores?.nombre||"—"}</div>}
            </>}
            {etapa.key==="postventa"&&<>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:6}}>
                <div style={{fontSize:12.5,fontWeight:600}}>🛠 {TIPOS_PV[ev.tipo]||ev.tipo||"Incidencia"}</div>
                <span style={{fontSize:9.5,fontWeight:700,borderRadius:5,padding:"2px 6px",background:ev.estado==="resuelto"?C.okLight:ev.estado==="en_gestion"?C.warnLight:C.dangerLight,color:ev.estado==="resuelto"?C.ok:ev.estado==="en_gestion"?C.warn:C.danger}}>
                  {ev.estado==="resuelto"?"✓ Resuelto":ev.estado==="en_gestion"?"En gestión":"Abierto"}
                </span>
              </div>
              <div style={{fontSize:11.5,color:C.inkMuted}}>{fmt.date(ev.fecha)||"—"}</div>
              {ev.descripcion&&<div style={{fontSize:11.5,color:C.ink,marginTop:3}}>{ev.descripcion}</div>}
              {ev.solucion&&<div style={{fontSize:11,color:C.ok,marginTop:3}}>Solución: {ev.solucion}{ev.fecha_resolucion?` · ${fmt.date(ev.fecha_resolucion)}`:""}</div>}
            </>}
            <div style={{display:"flex",gap:6,marginTop:8}}>
              <button onClick={()=>onEditarEvento&&onEditarEvento({tipo:etapa.label,e:ev,tabla:etapa.tabla})}
                style={{fontSize:11,background:C.tealLight,color:C.teal,border:"none",borderRadius:6,padding:"4px 10px",cursor:"pointer",fontWeight:600}}>✏️ Editar</button>
              {perfil?.rol==="admin"&&etapa.key==="factura"&&(
                <button onClick={async()=>{
                  if(!window.confirm(`¿Eliminar factura N°${ev.numero_factura}?\nEsto revertirá el estado a pendiente.`)) return;
                  await onEliminarFactura(oc.id, ev.id); setDetalle(null);
                }} style={{fontSize:11,background:C.dangerLight,color:C.danger,border:"none",borderRadius:6,padding:"4px 10px",cursor:"pointer",fontWeight:600}}>🗑 Eliminar</button>
              )}
              {perfil?.rol==="admin"&&etapa.key!=="factura"&&(
                <button onClick={async()=>{
                  if(!window.confirm(`¿Eliminar este registro de ${etapa.label}?`)) return;
                  if(onEliminarEvento) await onEliminarEvento(etapa.tabla, ev.id, oc.id, etapa.key); setDetalle(null);
                }} style={{fontSize:11,background:C.dangerLight,color:C.danger,border:"none",borderRadius:6,padding:"4px 10px",cursor:"pointer",fontWeight:600}}>🗑 Eliminar</button>
              )}
            </div>
          </div>
        ))}
        {/* Botones cuando SÍ hay eventos (acciones adicionales como re-emitir o correos) */}
        {eventos.length>0&&etapa.accion&&(
          <button onClick={()=>{onAccion&&onAccion(etapa.accion.key);}}
            style={{width:"100%",background:etapa.accion.color,border:"none",color:"#fff",borderRadius:8,padding:"9px 12px",fontSize:12,fontWeight:700,cursor:"pointer",marginTop:4}}>
            {etapa.accion.label}
          </button>
        )}
        {eventos.length>0&&etapa.correoBtns&&etapa.correoBtns.map((b,i)=>(
          <button key={i} onClick={b.action}
            style={{width:"100%",background:b.color,border:"none",color:"#fff",borderRadius:8,padding:"9px 12px",fontSize:12,fontWeight:700,cursor:"pointer",marginTop:4}}>
            {b.label}
          </button>
        ))}
        {/* Responsable de la etapa */}
        <div style={{marginTop:10,paddingTop:8,borderTop:`1px solid ${C.border}`}}>
          <div style={{fontSize:10,fontWeight:700,color:C.inkMuted,textTransform:"uppercase",marginBottom:5}}>Responsable</div>
          <select
            value={(oc.oc_responsables||[]).find(r=>r.etapa===etapa.key)?.usuario_id||""}
            onChange={e=>onAsignarResponsable&&onAsignarResponsable(oc.id,etapa.key,e.target.value)}
            style={{width:"100%",padding:"7px 10px",borderRadius:8,border:`1px solid ${C.border}`,fontSize:12.5,fontFamily:SANS,background:C.card,color:C.ink}}>
            <option value="">Sin asignar</option>
            {(perfiles||[]).map(p=><option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </div>
      </div>
    );
  };

  return (
    <div style={{marginBottom:12}}>
      <div style={{display:"flex",alignItems:"center",gap:0,marginBottom:6}}>
        {etapas.map((e,i)=>(
          <>
            <div key={e.key} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2,flex:1}}>
              <button onClick={()=>setDetalle(detalle===e.key?null:e.key)} style={{
                width:34,height:34,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",
                fontSize:16,background:detalle===e.key?C.teal:e.ok?C.ok:C.paper,
                border:`2px solid ${detalle===e.key?C.teal:e.ok?C.ok:C.border}`,
                cursor:"pointer",transition:"all 0.2s",padding:0,boxShadow:detalle===e.key?"0 2px 8px rgba(20,184,166,0.3)":"none",
              }}>{e.ok?e.icon:<span style={{fontSize:11,color:C.inkFaint}}>{i+1}</span>}</button>
              <span style={{fontSize:9.5,color:detalle===e.key?C.teal:e.ok?C.ok:C.inkFaint,fontWeight:e.ok||detalle===e.key?700:400,textAlign:"center"}}>{e.label}</span>
            </div>
            {i<etapas.length-1&&(
              <div style={{height:2,flex:0.5,background:etapas[i+1].ok&&e.ok?C.ok:C.border,marginBottom:18,transition:"all 0.2s"}} />
            )}
          </>
        ))}
      </div>
      {detalle&&(
        <div style={{background:C.tealLight,borderRadius:10,padding:"10px 12px",marginBottom:8}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <span style={{fontSize:11,fontWeight:700,color:C.tealDark,textTransform:"uppercase"}}>
              {etapas.find(e=>e.key===detalle)?.icon} {etapas.find(e=>e.key===detalle)?.label}
            </span>
            <button onClick={()=>setDetalle(null)} style={{background:"none",border:"none",color:C.inkFaint,cursor:"pointer",fontSize:16,lineHeight:1}}>✕</button>
          </div>
          {renderDetalle(etapas.find(e=>e.key===detalle))}
        </div>
      )}
      <div style={{fontSize:10,color:completadas===5?C.ok:C.inkFaint,textAlign:"right",fontWeight:completadas===5?700:400}}>
        {completadas===5?"✓ Ciclo completo":`${completadas}/5 etapas`}
        {(oc.eventos_postventa||[]).some(e=>e.estado!=="resuelto")&&<span style={{color:C.warn,fontWeight:700}}> · 🛠 post-venta abierta</span>}
      </div>
    </div>
  );
}

export function MiniFormLink({ ocId, onGuardar, orden }) {
  const [show,setShow]=useState(false);
  const [desc,setDesc]=useState(""); const [url,setUrl]=useState(""); const [saving,setSaving]=useState(false);
  if(!show) return <button onClick={()=>setShow(true)} style={{fontSize:11,background:"none",border:`1px dashed ${C.border}`,borderRadius:6,padding:"4px 10px",color:C.teal,cursor:"pointer",width:"100%",marginTop:4}}>+ Agregar producto</button>;
  return (
    <div style={{background:C.tealLight,borderRadius:7,padding:"8px 10px",marginTop:4}}>
      <input style={{...iStyle,marginBottom:6}} value={desc} onChange={e=>setDesc(e.target.value)} placeholder="Descripción del producto" />
      <input style={{...iStyle,marginBottom:6}} value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://... (opcional)" />
      <div style={{display:"flex",gap:6}}>
        <button onClick={async()=>{if(!desc.trim())return;setSaving(true);await onGuardar(ocId,{descripcion:desc.trim(),url:url.trim()||"sin-link",orden});setDesc("");setUrl("");setShow(false);setSaving(false);}} disabled={saving} style={btnP(C.teal)}>{saving?"…":"✓"}</button>
        <button onClick={()=>{setShow(false);setDesc("");setUrl("");}} style={btnP(C.inkFaint)}>✕</button>
      </div>
    </div>
  );
}

export function PanelLinksProductos({ oc, onGuardar, onEliminar, onEditar }) {
  const [showForm,setShowForm]=useState(false);
  const [desc,setDesc]=useState(""); const [url,setUrl]=useState(""); const [saving,setSaving]=useState(false);
  const [editId,setEditId]=useState(null); const [editDesc,setEditDesc]=useState(""); const [editUrl,setEditUrl]=useState("");
  const links=(oc.oc_productos_link||[]).sort((a,b)=>a.orden-b.orden);

  const handleGuardar=async()=>{
    if(!desc.trim()||!url.trim()) return;
    setSaving(true);
    await onGuardar(oc.id,{descripcion:desc.trim(),url:url.trim(),orden:links.length});
    setDesc(""); setUrl(""); setShowForm(false); setSaving(false);
  };
  const handleEditar=async(id)=>{
    if(!editDesc.trim()||!editUrl.trim()) return;
    await onEditar(id,{descripcion:editDesc.trim(),url:editUrl.trim()});
    setEditId(null);
  };
  const handleEliminar=async(id)=>{
    if(!window.confirm("¿Eliminar este link?")) return;
    await onEliminar(id);
  };

  return (
    <div style={{marginBottom:14}}>
      <div style={{fontSize:11,fontWeight:700,color:C.inkMuted,textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>
        🔗 Links de productos {links.length>0&&<span style={{color:C.teal}}>({links.length})</span>}
      </div>
      {links.length===0&&!showForm&&(
        <div style={{fontSize:12,color:C.inkFaint,marginBottom:8}}>Sin links registrados</div>
      )}
      {links.map((l,i)=>(
        <div key={l.id} style={{background:C.paper,borderRadius:8,padding:"8px 10px",marginBottom:6}}>
          {editId===l.id?(
            <div>
              <Field label="Descripción"><input style={iStyle} value={editDesc} onChange={e=>setEditDesc(e.target.value)} /></Field>
              <Field label="URL"><input style={iStyle} value={editUrl} onChange={e=>setEditUrl(e.target.value)} /></Field>
              <div style={{display:"flex",gap:6}}>
                <button onClick={()=>handleEditar(l.id)} style={btnP(C.teal)}>✓ Guardar</button>
                <button onClick={()=>setEditId(null)} style={btnP(C.inkFaint)}>Cancelar</button>
              </div>
            </div>
          ):(
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <span style={{fontSize:11,color:C.inkMuted,fontWeight:700,minWidth:16}}>{i+1}</span>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:12.5,fontWeight:600,color:C.ink,marginBottom:2}}>{l.descripcion}</div>
                <a href={l.url} target="_blank" rel="noopener noreferrer"
                  style={{fontSize:11,color:C.teal,wordBreak:"break-all",textDecoration:"none"}}>
                  {l.url.length>50?l.url.slice(0,50)+"…":l.url}
                </a>
              </div>
              <button onClick={()=>window.open(l.url,'_blank')} style={{background:C.tealLight,border:"none",borderRadius:6,padding:"5px 8px",fontSize:12,color:C.teal,cursor:"pointer",flexShrink:0}}>↗</button>
              <button onClick={()=>{setEditId(l.id);setEditDesc(l.descripcion);setEditUrl(l.url);}} style={{background:C.warnLight,border:"none",borderRadius:6,padding:"5px 8px",fontSize:12,color:C.warn,cursor:"pointer",flexShrink:0}}>✏️</button>
              <button onClick={()=>handleEliminar(l.id)} style={{background:C.dangerLight,border:"none",borderRadius:6,padding:"5px 8px",fontSize:12,color:C.danger,cursor:"pointer",flexShrink:0}}>✕</button>
            </div>
          )}
        </div>
      ))}
      {showForm&&(
        <div style={{background:C.tealLight,borderRadius:9,padding:"10px 12px",marginBottom:8}}>
          <Field label="Descripción del producto"><input style={iStyle} value={desc} onChange={e=>setDesc(e.target.value)} placeholder="ej: Silla ergonómica negra" /></Field>
          <Field label="Link (URL)"><input style={iStyle} value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://..." /></Field>
          <div style={{display:"flex",gap:8}}>
            <button onClick={handleGuardar} disabled={saving} style={btnP(C.teal)}>{saving?"Guardando…":"✓ Agregar"}</button>
            <button onClick={()=>{setShowForm(false);setDesc("");setUrl("");}} style={btnP(C.inkFaint)}>Cancelar</button>
          </div>
        </div>
      )}
      {!showForm&&(
        <button onClick={()=>setShowForm(true)} style={{...btnP(C.teal),fontSize:12,padding:"6px 12px"}}>+ Agregar producto</button>
      )}
    </div>
  );
}
