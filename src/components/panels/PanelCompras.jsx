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

export function FormEditarDatosOC({ oc, onSave, entidadesCatalogo, perfil, ocs }) {
  const [numeroOc,setNumeroOc]=useState(oc.numero_oc||"");
  const [resincronizar,setResincronizar]=useState(false);
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
  const norm=(v)=>String(v||"").toUpperCase().replace(/[^A-Z0-9]/g,"").replace(/^N(?=\d)/,"");
  const codigoCambio = norm(numeroOc)!==norm(oc.numero_oc);
  const codigoRepetido = codigoCambio && (ocs||[]).some(o=>o.id!==oc.id&&norm(o.numero_oc)===norm(numeroOc));

  const handleSave=async()=>{
    if(!numeroOc.trim()){ setErr("El código no puede quedar vacío"); return; }
    if(codigoRepetido){ setErr("Ya existe otra OC con ese código"); return; }
    setErr(""); setSaving(true);
    try { await onSave({ numeroOc:numeroOc.trim(), resincronizar:resincronizar&&codigoCambio,
      cliente:cliente.toUpperCase(), entidad:entidad.toUpperCase(), comuna:comuna.toUpperCase(), contacto, rutCliente, correo, fechaOC:fechaOC||null }); }
    catch(e){ setErr(e.message); } finally{ setSaving(false); }
  };
  return (
    <div>
      {perfil?.rol==="admin"&&(
        <Field label="Código de la OC" hint="Corrígelo si se ingresó mal. Debe ser único.">
          <input style={iMono} value={numeroOc} onChange={e=>{setNumeroOc(e.target.value);setErr("");}} />
          {codigoRepetido&&(
            <div style={{fontSize:11.5,color:C.danger,fontWeight:700,marginTop:5}}>
              ⚠ Ya hay otra OC con ese código
            </div>
          )}
          {codigoCambio&&!codigoRepetido&&(
            <label style={{display:"flex",alignItems:"flex-start",gap:7,marginTop:8,cursor:"pointer",
              background:C.tealLight,borderRadius:8,padding:"8px 10px"}}>
              <input type="checkbox" checked={resincronizar} onChange={e=>setResincronizar(e.target.checked)} style={{marginTop:2}} />
              <span style={{fontSize:11.5,color:C.tealDark,fontWeight:600}}>
                Traer de nuevo los datos desde Mercado Público con el código corregido
              </span>
            </label>
          )}
        </Field>
      )}

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

// ─── Detalle completo de la OC, plegable ───────────────────
function DetalleOC({ oc, perfil, onEditarLink, onEliminarLink, onGuardarLink, onSincronizarFecha }) {
  const [abierto,setAbierto]=useState(false);
  const [editando,setEditando]=useState(null);   // id del link en edición
  const [dNom,setDNom]=useState(""); const [dCant,setDCant]=useState("");
  const [dCompra,setDCompra]=useState(""); const [dVenta,setDVenta]=useState("");
  const [dUrl,setDUrl]=useState(""); const [dDir,setDDir]=useState("");
  const [nuevo,setNuevo]=useState(false);
  const [sincronizando,setSincronizando]=useState(false);
  const esAdmin=perfil?.rol==="admin";

  const abrirEdicion=(l)=>{
    setEditando(l.id);
    setDNom(l.descripcion||""); setDCant(l.cantidad??"");
    setDCompra(l.precio_compra??""); setDVenta(l.precio_venta??"");
    setDUrl(l.url&&l.url!=="sin-link"?l.url:"");
    setDDir(l.direccion_entrega||"");
  };
  const guardarEdicion=async(l)=>{
    await onEditarLink(l.id,{
      descripcion:dNom.trim(),
      cantidad:dCant?Number(dCant):null,
      precio_compra:dCompra?Number(dCompra):null,
      precio_venta:dVenta?Number(dVenta):null,
      url:dUrl.trim()||"sin-link",
      direccion_entrega:dDir.trim()||null,
    },oc);
    setEditando(null);
  };
  const limpiar=()=>{setDNom("");setDCant("");setDCompra("");setDVenta("");setDUrl("");setDDir("");};
  const links=(oc.oc_productos_link||[]).slice().sort((a,b)=>a.orden-b.orden);
  const evC=(oc.eventos_compra||[])[0];
  const evE=(oc.eventos_entrega||[])[0];
  const evF=(oc.eventos_factura||[])[0];
  const evP=(oc.eventos_pago_cliente||[])[0];
  const margen=calcMargen(oc.monto_total,oc.costo_total);

  const Dato=({k,v})=> v ? (
    <div style={{display:"flex",justifyContent:"space-between",gap:10,padding:"5px 0",borderBottom:`1px solid ${C.border}`}}>
      <span style={{fontSize:11.5,color:C.inkMuted,flexShrink:0}}>{k}</span>
      <span style={{fontSize:11.5,color:C.ink,fontWeight:600,textAlign:"right",wordBreak:"break-word"}}>{v}</span>
    </div>
  ) : null;

  return (
    <div style={{marginBottom:10}}>
      <button onClick={()=>setAbierto(v=>!v)}
        style={{width:"100%",background:C.card,border:`1px solid ${C.border}`,borderRadius:10,
          padding:"9px 12px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span style={{fontSize:11.5,fontWeight:700,color:C.inkMuted,textTransform:"uppercase",letterSpacing:0.4}}>
          Detalle de la OC{links.length>0&&<span style={{color:C.teal}}> · {links.length} producto{links.length>1?"s":""}</span>}
        </span>
        <span style={{color:C.inkFaint,fontSize:12}}>{abierto?"▲":"▼"}</span>
      </button>

      {abierto&&(
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderTop:"none",
          borderRadius:"0 0 10px 10px",padding:"10px 12px",marginTop:-1}}>

          {/* Traer la fecha real desde Mercado Público */}
          {esAdmin&&(
            <button onClick={async()=>{ setSincronizando(true); await onSincronizarFecha(oc); setSincronizando(false); }}
              disabled={sincronizando}
              style={{width:"100%",background:C.infoLight,border:`1px solid ${C.info}44`,color:C.info,
                borderRadius:9,padding:"8px 12px",fontSize:11.5,fontWeight:700,cursor:"pointer",marginBottom:12}}>
              {sincronizando?"Consultando…":"Actualizar fecha y datos desde Mercado Público"}
            </button>
          )}

          {/* Productos: cantidad y precio separados del nombre */}
          {links.length>0&&(
            <div style={{marginBottom:12}}>
              <div style={{fontSize:10,fontWeight:800,color:C.inkMuted,textTransform:"uppercase",letterSpacing:0.4,marginBottom:6}}>Productos</div>
              {/* Encabezado de la tabla */}
              <div style={{display:"flex",gap:8,padding:"0 11px 5px",fontSize:9.5,fontWeight:800,
                color:C.inkFaint,textTransform:"uppercase",letterSpacing:0.4}}>
                <span style={{flex:1}}>Producto</span>
                <span style={{width:34,textAlign:"center"}}>Cant</span>
                <span style={{width:76,textAlign:"right"}}>Total</span>
              </div>

              {links.map((l)=>{
                const tieneUrl=l.url&&l.url!=="sin-link";
                let dominio="";
                if(tieneUrl){ try{ dominio=new URL(l.url).hostname.replace(/^www\./,""); }catch{} }
                const cant=Number(l.cantidad)||null;
                const venta=Number(l.precio_venta)||0;
                const compra=Number(l.precio_compra)||0;

                if(editando===l.id){
                  return (
                    <div key={l.id} style={{background:C.tealLight,borderRadius:9,padding:"11px",marginBottom:6}}>
                      <Field label="Producto"><input style={iStyle} value={dNom} onChange={e=>setDNom(e.target.value)} /></Field>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:7}}>
                        <Field label="Cantidad"><input style={iMono} type="number" value={dCant} onChange={e=>setDCant(e.target.value)} /></Field>
                        <Field label="Costo"><input style={iMono} type="number" value={dCompra} onChange={e=>setDCompra(e.target.value)} /></Field>
                        <Field label="Venta"><input style={iMono} type="number" value={dVenta} onChange={e=>setDVenta(e.target.value)} /></Field>
                      </div>
                      <Field label="Link de compra"><input style={iStyle} value={dUrl} onChange={e=>setDUrl(e.target.value)} placeholder="https://…" /></Field>
                      <Field label="Dirección de despacho" hint="Solo si este producto va a otra dirección">
                        <input style={iStyle} value={dDir} onChange={e=>setDDir(e.target.value)} placeholder={oc.direccion_entrega||"Misma que la OC"} />
                      </Field>
                      <div style={{display:"flex",gap:6}}>
                        <button onClick={()=>guardarEdicion(l)} style={btnP(C.teal)}>Guardar</button>
                        <button onClick={()=>setEditando(null)} style={btnP(C.inkFaint)}>Cancelar</button>
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={l.id} style={{background:C.paper,borderRadius:9,padding:"9px 11px",marginBottom:6}}>
                    {/* Fila principal alineada con el encabezado */}
                    <div style={{display:"flex",gap:8,alignItems:"flex-start"}}>
                      <span style={{flex:1,minWidth:0,fontSize:12,color:C.ink,fontWeight:600,lineHeight:1.4}}>
                        {l.descripcion}
                      </span>
                      <span style={{width:34,flexShrink:0,textAlign:"center",fontFamily:MONO,
                        fontSize:11.5,fontWeight:800,color:cant?C.tealDark:C.inkFaint}}>
                        {cant?`×${cant}`:"—"}
                      </span>
                      <span style={{width:76,flexShrink:0,textAlign:"right",fontFamily:MONO,
                        fontSize:11.5,fontWeight:800,color:C.ink}}>
                        {venta?fmt.money(venta):"—"}
                      </span>
                    </div>

                    {/* Segunda línea: costo, unitario, proveedor */}
                    {(compra>0||l.proveedor||(cant&&venta))&&(
                      <div style={{fontSize:10.5,color:C.inkMuted,marginTop:3}}>
                        {compra>0&&<>Costo {fmt.money(compra)} · </>}
                        {cant>1&&venta>0&&<>Unit. {fmt.money(Math.round(venta/cant))} · </>}
                        {l.proveedor&&<>{l.proveedor}</>}
                      </div>
                    )}
                    {l.categoria&&(
                      <div style={{fontSize:10,color:C.inkFaint,marginTop:2,lineHeight:1.35}}>{l.categoria}</div>
                    )}

                    {(l.direccion_entrega||oc.direccion_entrega)&&(
                      <div style={{fontSize:10.5,marginTop:4,lineHeight:1.4,
                        color:l.direccion_entrega?C.warn:C.info,fontWeight:l.direccion_entrega?700:400}}>
                        {l.direccion_entrega?"Despacho distinto: ":"Entregar en: "}
                        {l.direccion_entrega||oc.direccion_entrega}
                      </div>
                    )}

                    {/* Link, o el botón para agregarlo */}
                    <div style={{display:"flex",alignItems:"center",gap:8,marginTop:7,
                      paddingTop:7,borderTop:`1px solid ${C.border}`}}>
                      {tieneUrl?(
                        <>
                          <a href={l.url} target="_blank" rel="noopener noreferrer"
                            style={{flex:1,minWidth:0,fontSize:11,color:C.teal,textDecoration:"none",fontWeight:600,
                              overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                            🔗 {dominio||l.url} ↗
                          </a>
                          <button onClick={()=>abrirEdicion(l)}
                            style={{flexShrink:0,background:"none",border:"none",color:C.inkMuted,fontSize:11,cursor:"pointer",fontWeight:600,padding:0}}>Editar</button>
                        </>
                      ):(
                        <button onClick={()=>abrirEdicion(l)}
                          style={{flex:1,background:C.tealLight,border:`1px dashed ${C.teal}66`,borderRadius:7,
                            padding:"6px 10px",fontSize:11,color:C.tealDark,cursor:"pointer",fontWeight:700}}>
                          + Agregar link de compra
                        </button>
                      )}
                      {esAdmin&&(
                        <button onClick={async()=>{ if(window.confirm("¿Eliminar este producto?")) await onEliminarLink(l.id,oc); }}
                          style={{flexShrink:0,background:"none",border:"none",color:C.danger,fontSize:11,cursor:"pointer",fontWeight:600,padding:0}}>Eliminar</button>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Total de los productos */}
              {(()=>{
                const tv=links.reduce((s,l)=>s+(Number(l.precio_venta)||0),0);
                const tc=links.reduce((s,l)=>s+(Number(l.precio_compra)||0),0);
                if(!tv) return null;
                const calza=Math.abs(tv-(Number(oc.monto_total)||0))<=1;
                return (
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
                    padding:"8px 11px",marginTop:2,borderTop:`2px solid ${C.border}`}}>
                    <span style={{fontSize:11,fontWeight:800,color:C.inkMuted,textTransform:"uppercase",letterSpacing:0.4}}>
                      Total productos
                    </span>
                    <span style={{textAlign:"right"}}>
                      <span style={{display:"block",fontFamily:MONO,fontWeight:800,fontSize:12.5,color:C.ink}}>{fmt.money(tv)}</span>
                      {tc>0&&<span style={{display:"block",fontSize:10,color:C.inkFaint}}>costo {fmt.money(tc)}</span>}
                      {!calza&&(
                        <span style={{display:"block",fontSize:10,color:C.warn,fontWeight:700}}>
                          ⚠ la OC dice {fmt.money(oc.monto_total)}
                        </span>
                      )}
                    </span>
                  </div>
                );
              })()}

              {nuevo?(
                <div style={{background:C.tealLight,borderRadius:9,padding:"11px",marginTop:6}}>
                  <Field label="Producto"><input style={iStyle} value={dNom} onChange={e=>setDNom(e.target.value)} /></Field>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:7}}>
                    <Field label="Cantidad"><input style={iMono} type="number" value={dCant} onChange={e=>setDCant(e.target.value)} /></Field>
                    <Field label="Costo"><input style={iMono} type="number" value={dCompra} onChange={e=>setDCompra(e.target.value)} /></Field>
                    <Field label="Venta"><input style={iMono} type="number" value={dVenta} onChange={e=>setDVenta(e.target.value)} /></Field>
                  </div>
                  <Field label="Link de compra"><input style={iStyle} value={dUrl} onChange={e=>setDUrl(e.target.value)} placeholder="https://…" /></Field>
                  <Field label="Dirección de despacho" hint="Solo si va a otra dirección">
                    <input style={iStyle} value={dDir} onChange={e=>setDDir(e.target.value)} placeholder={oc.direccion_entrega||"Misma que la OC"} />
                  </Field>
                  <div style={{display:"flex",gap:6}}>
                    <button onClick={async()=>{
                      if(!dNom.trim()) return;
                      await onGuardarLink(oc.id,{descripcion:dNom.trim(),
                        cantidad:dCant?Number(dCant):null,
                        precio_compra:dCompra?Number(dCompra):null,
                        precio_venta:dVenta?Number(dVenta):null,
                        url:dUrl.trim()||"sin-link",orden:links.length,
                        direccion_entrega:dDir.trim()||null},oc);
                      setNuevo(false); limpiar();
                    }} style={btnP(C.teal)}>Agregar</button>
                    <button onClick={()=>setNuevo(false)} style={btnP(C.inkFaint)}>Cancelar</button>
                  </div>
                </div>
              ):(
                <button onClick={()=>{setNuevo(true);limpiar();}}
                  style={{fontSize:11,background:"none",border:`1px dashed ${C.border}`,borderRadius:8,
                    padding:"7px 12px",color:C.teal,cursor:"pointer",width:"100%",marginTop:4}}>
                  + Agregar producto
                </button>
              )}
            </div>
          )}

          {/* Datos comerciales */}
          <div style={{fontSize:10,fontWeight:800,color:C.inkMuted,textTransform:"uppercase",letterSpacing:0.4,marginBottom:4}}>Datos</div>
          <Dato k="Cliente"      v={oc.cliente} />
          <Dato k="Unidad"       v={oc.entidad} />
          <Dato k="RUT"          v={oc.rut_cliente} />
          <Dato k="Comuna"       v={oc.comuna} />
          <Dato k="Contacto"     v={oc.contacto} />
          <Dato k="Correo"       v={oc.correo_cliente} />
          <Dato k="Despacho"     v={oc.tipo_despacho} />
          <Dato k="Dirección"    v={oc.direccion_entrega} />
          <Dato k="Plazo de pago" v={oc.dias_pago?`${oc.dias_pago} días`:null} />
          <Dato k="Vendedor"     v={oc.vendedores?.nombre} />
          <Dato k="Financiador"  v={oc.financiadores?.nombre} />

          {/* Números */}
          <div style={{fontSize:10,fontWeight:800,color:C.inkMuted,textTransform:"uppercase",letterSpacing:0.4,margin:"10px 0 4px"}}>Números</div>
          <Dato k="Venta"     v={fmt.money(oc.monto_total)} />
          <Dato k="Costo"     v={oc.costo_total?fmt.money(oc.costo_total):null} />
          <Dato k="Utilidad"  v={oc.costo_total?`${fmt.money(margen.pesos)} (${margen.pct}%)`:null} />
          <Dato k="Facturado" v={oc.monto_facturado?fmt.money(oc.monto_facturado):null} />
          <Dato k="Cobrado"   v={oc.monto_cobrado?fmt.money(oc.monto_cobrado):null} />

          {/* Línea de tiempo */}
          <div style={{fontSize:10,fontWeight:800,color:C.inkMuted,textTransform:"uppercase",letterSpacing:0.4,margin:"10px 0 4px"}}>Fechas</div>
          <Dato k="Compra"           v={evC?.fecha?fmt.date(String(evC.fecha).slice(0,10)):null} />
          <Dato k="Entrega estimada" v={evC?.fecha_entrega_estimada?fmt.date(String(evC.fecha_entrega_estimada).slice(0,10)):null} />
          <Dato k="Entrega real"     v={evE?.fecha?fmt.date(String(evE.fecha).slice(0,10)):null} />
          <Dato k="Factura"          v={evF?.fecha?`N°${evF.numero_factura} · ${fmt.date(String(evF.fecha).slice(0,10))}`:null} />
          <Dato k="Cobro"            v={evP?.fecha?fmt.date(String(evP.fecha).slice(0,10)):null} />
          <Dato k="Proveedor"        v={evC?.proveedor} />
        </div>
      )}
    </div>
  );
}

export function FilaOC({ oc, perfiles, todasLasOcs, onSincronizarFecha, expanded, onToggle, contactos, onEnviarReclamo, onGuardarContacto, onGuardarDatosOC, onEditarEvento, financiadores, onConfirmarEntrega, onEmitirFactura, onPagoCliente, onPagoFinanciamiento, entidadesCatalogo, onGuardarLink, onEliminarLink, onEditarLink, bloqueos, perfil, historialCambios, onAgregarComentario, onEliminarComentario, onBloquear, onLiberar, onEliminarOC, onEliminarFactura, onEliminarEvento, vendedores, onIngresarCompra, onAsignarResponsable, onGuardarPostventa }) {
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

  // Estado único: define color de la franja y la línea de estado
  const estadoOC=(()=>{
    const comprada=(oc.eventos_compra||[]).length>0;
    const entregada=oc.estado_entrega==="confirmada"||oc.estado_entrega==="entregado";
    const facturada=oc.estado_factura_propia==="emitida";
    const cobrada=oc.estado_pago_cliente==="pagado";
    const finPagado=oc.estado_pago_financiamiento==="pagado";
    const plazo=Number(oc.dias_pago)>0?Number(oc.dias_pago):30;

    // El ciclo saltó una etapa: el registro quedó incompleto
    if(facturada&&!entregada)
      return {color:C.warn, bg:C.warnLight, icono:"⚠", texto:"Facturada sin registrar la entrega"};
    if(cobrada&&!facturada)
      return {color:C.warn, bg:C.warnLight, icono:"⚠", texto:"Cobrada sin registrar la factura"};

    if(cobrada&&finPagado)  return {color:C.ok,      bg:C.okLight,      icono:"✓", texto:"Cerrada"};
    if(cobrada&&!finPagado) return {color:C.purple,  bg:C.purpleLight,  icono:"🏦", texto:"Cobrada · falta pagar financiamiento"};
    if(facturada&&dias!==null){
      if(dias>=plazo+9)     return {color:C.danger,  bg:C.dangerLight,  icono:"⚠", texto:`Reclamar pago · ${dias} de ${plazo} días`};
      if(dias>=plazo)       return {color:C.danger,  bg:C.dangerLight,  icono:"🔴", texto:`Vencida · ${dias} de ${plazo} días`};
      if(dias>=plazo-5)     return {color:C.warn,    bg:C.warnLight,    icono:"🟡", texto:`Por vencer · quedan ${plazo-dias} días`};
      return {color:C.warn, bg:C.warnLight, icono:"🧾", texto:`Facturada · ${dias} de ${plazo} días`};
    }
    if(facturada)           return {color:C.warn,    bg:C.warnLight,    icono:"🧾", texto:"Facturada · esperando pago"};
    if(entregada)           return {color:C.info,    bg:C.infoLight,    icono:"📦", texto:"Entregada · falta facturar"};
    if(comprada)            return {color:C.transit, bg:C.transitLight, icono:"🚚", texto:"Comprada · falta entregar"};
    return {color:C.inkFaint, bg:C.paper, icono:"○", texto:"Sin compra registrada"};
  })();

  // ¿Qué toca hacer ahora en esta OC?
  const proxima=(()=>{
    if((oc.eventos_compra||[]).length===0)                      return {key:"compra",       label:"Registrar compra",     color:C.teal};
    if(oc.estado_entrega!=="confirmada"&&oc.estado_entrega!=="entregado") return {key:"entrega", label:"Confirmar entrega", color:C.transit};
    if(oc.estado_factura_propia!=="emitida")                     return {key:"factura",       label:"Emitir factura",       color:C.info};
    if(oc.estado_pago_cliente!=="pagado")                        return {key:"pago_cliente",  label:"Registrar cobro",      color:C.ok};
    if(oc.estado_pago_financiamiento!=="pagado")                 return {key:"pago_financ",   label:"Pagar financiamiento", color:C.purple};
    return null;
  })();

  const handleToggle=async()=>{
    if(!expanded && onBloquear) await onBloquear(oc.id);
    if(expanded && onLiberar) await onLiberar(oc.id);
    onToggle();
  };

  return (
    <div style={{background:C.card,border:`1px solid ${C.border}`,borderLeft:`4px solid ${estadoOC.color}`,borderRadius:13,marginBottom:8,overflow:"hidden"}}>
      <div onClick={handleToggle} style={{padding:"12px 14px",cursor:"pointer"}}>
        {/* Línea 1 — identificador y plata */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",gap:10}}>
          <span style={{fontFamily:MONO,fontWeight:800,fontSize:13.5,color:C.ink}}>{oc.numero_oc}</span>
          <span style={{fontFamily:MONO,fontWeight:800,fontSize:14.5,color:C.ink,flexShrink:0}}>{fmt.money(oc.monto_total)}</span>
        </div>

        {/* Línea 2 — quién */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",gap:10,marginTop:3}}>
          <span style={{fontSize:11.5,color:C.inkMuted,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
            {(()=>{
              const esPorCompletar=oc.cliente?.toUpperCase().includes("POR COMPLETAR");
              const nombre=esPorCompletar?(oc.entidad||null):oc.cliente;
              return nombre
                ? [nombre,oc.comuna].filter(Boolean).join(" · ")
                : <span style={{color:C.warn,fontWeight:700}}>⚠ Falta la entidad</span>;
            })()}
          </span>
          {(()=>{const mg=calcMargen(oc.monto_total,oc.costo_total);
            return oc.costo_total?(
              <span style={{fontSize:10.5,color:mg.color,fontWeight:700,background:mg.bg,padding:"1px 6px",borderRadius:5,flexShrink:0}}>{mg.pct}%</span>
            ):null;})()}
        </div>

        {/* Línea 3 — un solo estado, con el progreso al lado */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,marginTop:7}}>
          <span style={{display:"inline-flex",alignItems:"center",gap:5,background:estadoOC.bg,color:estadoOC.color,
            padding:"3px 9px",borderRadius:20,fontSize:11,fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
            {estadoOC.icono} {estadoOC.texto}
          </span>
          <span style={{fontSize:10.5,color:C.inkFaint,flexShrink:0}}>
            {estancada&&<span style={{color:C.warn,fontWeight:700}}>⏸ {diasEstancada}d · </span>}
            {oc.vendedores?.nombre&&<>{oc.vendedores.nombre.split(" ")[0]} · </>}
            {completadas}/5
          </span>
        </div>
      </div>

      {expanded&&(
        <div style={{borderTop:`1px solid ${C.border}`,padding:"12px 14px",background:C.paper}}>
          {bloqueoActivo&&<BloqueoBanner bloqueo={bloqueoActivo} />}

          {/* Lo primero: la acción que corresponde */}
          {proxima&&(
            <button onClick={()=>setAccionRapida(proxima.key)}
              style={{width:"100%",background:proxima.color,border:"none",color:"#fff",borderRadius:10,
                padding:"12px",fontSize:13.5,fontWeight:700,cursor:"pointer",marginBottom:12}}>
              {proxima.label} →
            </button>
          )}

          {/* Datos, en una sola línea y sin repetir lo que ya está arriba */}
          <div style={{fontSize:11.5,color:C.inkMuted,marginBottom:12,lineHeight:1.6}}>
            {[oc.entidad,oc.contacto].filter(Boolean).join(" · ")}
            {(oc.entidad||oc.contacto)&&<br/>}
            {saldo>0&&oc.monto_facturado>0&&<>Por cobrar <b style={{color:C.danger}}>{fmt.money(saldo)}</b> · </>}
            {(()=>{
              const f=oc.fecha_emision_mp||(oc.eventos_compra||[])[0]?.fecha||oc.creadoEn;
              return f?<>Emitida {fmt.date(String(f).slice(0,10))}</>:null;
            })()}
          </div>

          {oc.direccion_entrega&&(
            <div style={{background:C.infoLight,border:`1px solid ${C.info}33`,borderRadius:9,
              padding:"9px 11px",marginBottom:12}}>
              <div style={{fontSize:10,fontWeight:800,color:C.info,textTransform:"uppercase",letterSpacing:0.4,marginBottom:3}}>Dirección de despacho</div>
              <div style={{fontSize:12,color:C.ink,lineHeight:1.45}}>{oc.direccion_entrega}</div>
            </div>
          )}

          <DetalleOC oc={oc} perfil={perfil} onEditarLink={onEditarLink} onEliminarLink={onEliminarLink} onGuardarLink={onGuardarLink} onSincronizarFecha={onSincronizarFecha} />

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

          <details style={{marginTop:6}}>
            <summary style={{fontSize:11.5,color:C.inkFaint,cursor:"pointer",padding:"6px 0",listStyle:"none"}}>⋯ Más acciones</summary>
            <div style={{display:"flex",gap:6,marginTop:6,flexWrap:"wrap"}}>
              <button onClick={()=>setEditandoDatos(true)} style={{...btnG,flex:1,fontSize:12}}>Editar datos</button>
              <button onClick={()=>setCorreoFallida(true)} style={{...btnG,flex:1,fontSize:12}}>Entrega fallida</button>
              <button onClick={()=>setCorreoFecha(true)} style={{...btnG,flex:1,fontSize:12}}>Fecha entrega</button>
            </div>
          </details>
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
          <FormEditarDatosOC oc={oc} entidadesCatalogo={entidadesCatalogo} perfil={perfil} ocs={todasLasOcs} onSave={async(data)=>{ await onGuardarDatosOC(oc.id,data); setEditandoDatos(false); }} />
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

export function PanelCompras({ ocs, perfiles, filtroInicial, ocFoco, onSincronizarFecha, contactos, onEnviarReclamo, onGuardarContacto, onGuardarDatosOC, onEditarEvento, financiadores, onConfirmarEntrega, onEmitirFactura, onPagoCliente, onPagoFinanciamiento, entidadesCatalogo, onGuardarLink, onEliminarLink, onEditarLink, bloqueos, perfil, historialCambios, onAgregarComentario, onEliminarComentario, onBloquear, onLiberar, onEliminarOC, onEliminarFactura, onEliminarEvento, vendedores, onIngresarCompra, onAsignarResponsable, onGuardarPostventa }) {
  const [filtros,setFiltros]=useState({}); const [busq,setBusq]=useState(""); const [expId,setExpId]=useState(null);
  const [reclamandoBanner,setReclamandoBanner]=useState(null); const [comunaSel,setComunaSel]=useState("");
  const [bannerAbierto,setBannerAbierto]=useState(false);
  const [vista,setVista]=useState("todas");
  const [masFiltros,setMasFiltros]=useState(false);
  const [desde,setDesde]=useState(""); const [hasta,setHasta]=useState("");

  const fechaDe=(o)=>String(o.fecha_emision_mp||(o.eventos_compra||[])[0]?.fecha||o.creadoEn||"").slice(0,10);

  // Cada vista responde a "¿qué me falta hacer?" en esa etapa
  const cumpleVista=(oc,v)=>{
    const comprada=(oc.eventos_compra||[]).length>0;
    const entregada=oc.estado_entrega==="confirmada"||oc.estado_entrega==="entregado";
    const facturada=oc.estado_factura_propia==="emitida";
    const cobrada=oc.estado_pago_cliente==="pagado";
    const finPagado=oc.estado_pago_financiamiento==="pagado";
    if(v==="todas")    return true;
    if(v==="comprar")  return !comprada;
    if(v==="entregar") return comprada&&!entregada;
    if(v==="facturar") return entregada&&!facturada;
    if(v==="cobrar")   return facturada&&!cobrada;
    if(v==="financ")   return comprada&&!finPagado;
    return true;
  };
  useEffect(()=>{ setFiltros(filtroInicial?{[filtroInicial]:"pend"}:{}); },[filtroInicial]);

  // Si llegamos desde una alerta, abrimos esa OC y quitamos filtros
  // para que no quede escondida por la vista activa.
  useEffect(()=>{
    if(!ocFoco) return;
    const oc=ocs.find(o=>o.id===ocFoco);
    setVista("todas"); setFiltros({}); setComunaSel("");
    setBusq(oc?.numero_oc||"");
    setExpId(ocFoco);
  },[ocFoco,ocs]);
  const toggle=(key,val)=>setFiltros(prev=>({...prev,[key]:prev[key]===val?undefined:val}));
  const comunas=useMemo(()=>Array.from(new Set(ocs.map(o=>o.comuna).filter(Boolean))).sort(),[ocs]);
  const filtered=useMemo(()=>ocs.filter(oc=>{
    if(busq.trim()){ const q=busq.toLowerCase(); if(!oc.numero_oc.toLowerCase().includes(q)&&!(oc.cliente||"").toLowerCase().includes(q)&&!(oc.comuna||"").toLowerCase().includes(q)&&!(oc.entidad||"").toLowerCase().includes(q)) return false; }
    if(comunaSel&&oc.comuna!==comunaSel) return false;
    if(!cumpleVista(oc,vista)) return false;
    const f=fechaDe(oc);
    if(desde&&(!f||f<desde)) return false;
    if(hasta&&(!f||f>hasta)) return false;
    for(const f of FILTROS){ const s=filtros[f.key]; if(!s) continue; const ok=oc[f.okField]===f.okValue; if(s==="ok"&&!ok) return false; if(s==="pend"&&ok) return false; }
    return true;
  }).sort((a,b)=>{
    const fa=a.fecha_emision_mp||((a.eventos_compra||[])[0]?.fecha)||a.creadoEn||"";
    const fb=b.fecha_emision_mp||((b.eventos_compra||[])[0]?.fecha)||b.creadoEn||"";
    return String(fb).localeCompare(String(fa));
  }),[ocs,filtros,busq,comunaSel,vista,desde,hasta]);

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

  const VISTAS=useMemo(()=>{
    const n=(v)=>ocs.filter(o=>cumpleVista(o,v)).length;
    return [
      {key:"todas",   label:"Todas",        n:ocs.length,   color:C.teal,    bg:C.tealLight},
      {key:"comprar", label:"Por comprar",  n:n("comprar"), color:C.transit, bg:C.transitLight},
      {key:"entregar",label:"Por entregar", n:n("entregar"),color:C.info,    bg:C.infoLight},
      {key:"facturar",label:"Por facturar", n:n("facturar"),color:C.purple,  bg:C.purpleLight},
      {key:"cobrar",  label:"Por cobrar",   n:n("cobrar"),  color:C.warn,    bg:C.warnLight},
      {key:"financ",  label:"Por pagar",    n:n("financ"),  color:C.danger,  bg:C.dangerLight},
    ];
  },[ocs]);

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
      {/* Vista rápida: qué falta hacer. Un toque, una respuesta. */}
      <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:10}}>
        {VISTAS.map(v=>{
          const activa=vista===v.key;
          return (
            <button key={v.key} onClick={()=>{setVista(v.key);setFiltros({});}}
              style={{fontSize:11,fontWeight:700,padding:"6px 11px",borderRadius:9,cursor:"pointer",
                border:`1.5px solid ${activa?v.color:C.border}`,
                background:activa?v.bg:C.card, color:activa?v.color:C.inkMuted}}>
              {v.label}{v.n>0?` ${v.n}`:""}
            </button>
          );
        })}
      </div>

      <button onClick={()=>setMasFiltros(m=>!m)}
        style={{background:"none",border:"none",color:C.inkFaint,fontSize:11,cursor:"pointer",padding:"2px 0",marginBottom:masFiltros?8:12}}>
        {masFiltros?"▾":"▸"} Filtros combinados
      </button>

      {masFiltros&&(
        <div style={{background:C.paper,borderRadius:10,padding:"10px",marginBottom:12}}>
          <div style={{fontSize:10.5,fontWeight:800,color:C.inkMuted,textTransform:"uppercase",letterSpacing:0.4,marginBottom:6}}>Rango de fechas</div>
          <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:6}}>
            <input type="date" value={desde} onChange={e=>setDesde(e.target.value)}
              style={{...iStyle,flex:1,fontSize:12,padding:"7px 9px"}} />
            <span style={{fontSize:11,color:C.inkFaint}}>a</span>
            <input type="date" value={hasta} onChange={e=>setHasta(e.target.value)}
              style={{...iStyle,flex:1,fontSize:12,padding:"7px 9px"}} />
          </div>
          <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:10}}>
            {[
              {t:"Este mes",d:()=>{const h=new Date();return [`${h.getFullYear()}-${String(h.getMonth()+1).padStart(2,"0")}-01`,h.toISOString().slice(0,10)];}},
              {t:"Mes pasado",d:()=>{const h=new Date();const i=new Date(h.getFullYear(),h.getMonth()-1,1);const f=new Date(h.getFullYear(),h.getMonth(),0);return [i.toISOString().slice(0,10),f.toISOString().slice(0,10)];}},
              {t:"Últimos 90 días",d:()=>{const h=new Date();const i=new Date();i.setDate(i.getDate()-90);return [i.toISOString().slice(0,10),h.toISOString().slice(0,10)];}},
              {t:"Este año",d:()=>{const h=new Date();return [`${h.getFullYear()}-01-01`,h.toISOString().slice(0,10)];}},
            ].map(b=>(
              <button key={b.t} onClick={()=>{const [i,f]=b.d();setDesde(i);setHasta(f);}}
                style={{fontSize:10.5,fontWeight:700,padding:"5px 9px",borderRadius:7,cursor:"pointer",
                  border:`1px solid ${C.border}`,background:C.card,color:C.inkMuted}}>{b.t}</button>
            ))}
            {(desde||hasta)&&(
              <button onClick={()=>{setDesde("");setHasta("");}}
                style={{fontSize:10.5,fontWeight:700,padding:"5px 9px",borderRadius:7,cursor:"pointer",
                  border:`1px solid ${C.danger}`,background:C.dangerLight,color:C.danger}}>Quitar fechas</button>
            )}
          </div>

          <div style={{fontSize:10.5,fontWeight:800,color:C.inkMuted,textTransform:"uppercase",letterSpacing:0.4,marginBottom:6}}>Por etapa</div>
          <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
          {FILTROS.map(f=>(
            <div key={f.key} style={{display:"flex",gap:3}}>
              <button onClick={()=>{setVista("todas");toggle(f.key,"pend");}} style={{fontSize:10.5,fontWeight:700,padding:"5px 8px",borderRadius:7,border:`1.5px solid ${filtros[f.key]==="pend"?C.danger:C.border}`,background:filtros[f.key]==="pend"?C.dangerLight:C.card,color:filtros[f.key]==="pend"?C.danger:C.inkMuted,cursor:"pointer"}}>{f.label}: {f.pendLabel}</button>
              <button onClick={()=>{setVista("todas");toggle(f.key,"ok");}} style={{fontSize:10.5,fontWeight:700,padding:"5px 8px",borderRadius:7,border:`1.5px solid ${filtros[f.key]==="ok"?C.ok:C.border}`,background:filtros[f.key]==="ok"?C.okLight:C.card,color:filtros[f.key]==="ok"?C.ok:C.inkMuted,cursor:"pointer"}}>{f.okLabel}</button>
            </div>
          ))}
          </div>
        </div>
      )}

      <div style={{fontSize:11.5,color:C.inkFaint,marginBottom:10}}>
        {filtered.length} orden{filtered.length!==1?"es":""}
        {(desde||hasta)&&<span style={{color:C.teal,fontWeight:700}}> · {desde?fmt.date(desde):"inicio"} a {hasta?fmt.date(hasta):"hoy"}</span>}
        {(desde||hasta)&&<> · <b>{fmt.money(filtered.reduce((s,o)=>s+(Number(o.monto_total)||0),0))}</b></>}
      </div>
      {filtered.map(oc=><FilaOC key={oc.id} oc={oc} perfiles={perfiles} todasLasOcs={ocs} onSincronizarFecha={onSincronizarFecha} expanded={expId===oc.id} onToggle={()=>setExpId(expId===oc.id?null:oc.id)} contactos={contactos} onEnviarReclamo={onEnviarReclamo} onGuardarContacto={onGuardarContacto} onGuardarDatosOC={onGuardarDatosOC} onEditarEvento={onEditarEvento} financiadores={financiadores} onConfirmarEntrega={onConfirmarEntrega} onEmitirFactura={onEmitirFactura} onPagoCliente={onPagoCliente} onPagoFinanciamiento={onPagoFinanciamiento} entidadesCatalogo={entidadesCatalogo} onGuardarLink={onGuardarLink} onEliminarLink={onEliminarLink} onEditarLink={onEditarLink} bloqueos={bloqueos} perfil={perfil} historialCambios={historialCambios} onAgregarComentario={onAgregarComentario} onEliminarComentario={onEliminarComentario} onBloquear={onBloquear} onLiberar={onLiberar} onEliminarOC={onEliminarOC} onEliminarFactura={onEliminarFactura} onEliminarEvento={onEliminarEvento} vendedores={vendedores} onIngresarCompra={onIngresarCompra} onAsignarResponsable={onAsignarResponsable} onGuardarPostventa={onGuardarPostventa} />)}
      {filtered.length===0&&<div style={{textAlign:"center",padding:30,color:C.inkFaint,fontSize:13}}>No hay órdenes con estos filtros.</div>}
      <Leyenda items={[
        {muestra:"✓ Cerrada",   color:C.ok,      bg:C.okLight,      texto:"Cobrada al cliente y pagada al financiador. Ciclo terminado."},
        {muestra:"🏦 Cobrada",  color:C.purple,  bg:C.purpleLight,  texto:"El cliente ya pagó, falta devolverle la plata al financiador."},
        {muestra:"⚠ Reclamar",  color:C.danger,  bg:C.dangerLight,  texto:"Pasaron 9 días o más del plazo. Se habilita el correo de cobranza."},
        {muestra:"🔴 Vencida",  color:C.danger,  bg:C.dangerLight,  texto:"Se cumplió el plazo de pago de esa OC y no ha entrado."},
        {muestra:"🟡 Por vencer",color:C.warn,   bg:C.warnLight,    texto:"Quedan 5 días o menos para que se cumpla el plazo."},
        {muestra:"🧾 Facturada",color:C.warn,    bg:C.warnLight,    texto:"Factura emitida, dentro de plazo, esperando el pago."},
        {muestra:"📦 Entregada",color:C.info,    bg:C.infoLight,    texto:"Ya se entregó, falta emitir la factura."},
        {muestra:"🚚 Comprada", color:C.transit, bg:C.transitLight, texto:"Comprada al proveedor, falta entregar al cliente."},
        {muestra:"23%",         color:C.ok,      bg:C.okLight,      texto:"Margen de la OC. Verde sobre 20%, amarillo 10–20%, rojo bajo 10%."},
        {muestra:"⚠",           color:C.warn,    bg:C.warnLight,    texto:"El ciclo saltó una etapa: hay factura sin entrega, o cobro sin factura. El registro quedó incompleto."},
        {muestra:"⏸ 43d",       color:C.warn,    bg:C.warnLight,    texto:"Días sin avanzar de etapa. La OC quedó detenida."},
        {muestra:"Matías · 3/5", texto:"Vendedor a cargo y etapas completadas de las cinco del ciclo."},
      ]} />
    </div>
  );
}
