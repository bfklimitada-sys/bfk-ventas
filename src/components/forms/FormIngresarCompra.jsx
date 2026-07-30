import { useState } from "react";
import { Field } from "../ui/Basicos";
import { del } from "../../lib/supabase";
import { C, btnP, iMono, iStyle, selStyle } from "../../lib/theme";

export function FormIngresarCompra({ ocs, financiadores, vendedores, onSave, entidadesCatalogo, ocExistente }) {
  const [paso,setPaso]=useState(1);
  // Paso 1 — Datos OC (si ocExistente, el código viene definido)
  const [numOC,setNumOC]=useState(ocExistente?.numero_oc||"");
  const [vendedorId,setVendedorId]=useState(ocExistente?.vendedor_id||vendedores[0]?.id||"");
  const [rutCliente,setRutCliente]=useState(ocExistente?.rut_cliente||"");
  const [cliente,setCliente]=useState(ocExistente?.cliente||"");
  const [entidad,setEntidad]=useState(ocExistente?.entidad||"");
  const [comuna,setComuna]=useState(ocExistente?.comuna||"");
  const [contacto,setContacto]=useState(ocExistente?.contacto||"");
  const [correo,setCorreo]=useState(ocExistente?.correo_cliente||"");
  const [autocompletado,setAutocompletado]=useState(false);
  // Paso 2 — Productos
  const [productos,setProductos]=useState([{desc:"",cantidad:1,precioCompra:"",precioVenta:"",link:""}]);
  // Paso 3 — Compra
  const [financiadorId,setFinanciadorId]=useState(financiadores[0]?.id||"");
  const [fechaCompra,setFechaCompra]=useState(new Date().toISOString().slice(0,10));
  const [fechaEst,setFechaEst]=useState("");
  const [obs,setObs]=useState("");
  // Control
  const [err,setErr]=useState(""); const [saving,setSaving]=useState(false);

  // Totales calculados desde productos
  const costoTotal=productos.reduce((s,p)=>s+(Number(p.precioCompra)||0)*(Number(p.cantidad)||1),0);
  const ventaTotal=productos.reduce((s,p)=>s+(Number(p.precioVenta)||0)*(Number(p.cantidad)||1),0);
  const utilidad=ventaTotal-costoTotal;
  const margen=ventaTotal>0?((utilidad/ventaTotal)*100).toFixed(1):0;

  const handleRutChange=(val)=>{
    setRutCliente(val);
    const match=(entidadesCatalogo||[]).find(e=>e.rut===val.trim());
    if(match&&val.trim()){
      if(!entidad) setEntidad(match.nombre_entidad||"");
      if(!comuna) setComuna(match.comuna||"");
      if(!contacto) setContacto(match.contacto||"");
      if(!correo) setCorreo(match.correo||"");
      if(!cliente) setCliente(match.nombre_entidad||"");
      setAutocompletado(true);
    } else { setAutocompletado(false); }
  };

  const addProducto=()=>setProductos(p=>[...p,{desc:"",cantidad:1,precioCompra:"",precioVenta:"",link:""}]);
  const updProducto=(i,field,val)=>setProductos(p=>p.map((x,idx)=>idx===i?{...x,[field]:val}:x));
  const delProducto=(i)=>setProductos(p=>p.filter((_,idx)=>idx!==i));

  const validarPaso1=()=>{
    if(!numOC.trim()){setErr("Ingresa el código de la OC");return false;}
    if(!cliente.trim()){setErr("Ingresa el nombre del cliente");return false;}
    setErr(""); return true;
  };
  const validarPaso2=()=>{
    if(productos.length===0){setErr("Agrega al menos un producto");return false;}
    for(const p of productos){
      if(!p.desc.trim()){setErr("Todos los productos deben tener descripción");return false;}
      if(!p.precioCompra||Number(p.precioCompra)<=0){setErr("Todos los productos deben tener precio de compra");return false;}
      if(!p.precioVenta||Number(p.precioVenta)<=0){setErr("Todos los productos deben tener precio de venta");return false;}
    }
    setErr(""); return true;
  };
  const validarPaso3=()=>{
    if(!financiadorId){setErr("Selecciona el financiador");return false;}
    setErr(""); return true;
  };

  const handleGuardar=async()=>{
    if(!validarPaso3()) return;
    setSaving(true);
    try {
      await onSave({
        esNueva:!ocExistente, ocId:ocExistente?.id||null, numNueva:numOC.trim(),
        cliente:cliente.toUpperCase(), rutCliente, entidad:entidad.toUpperCase(),
        comuna:comuna.toUpperCase(), contacto, correo, vendedorId,
        montoVenta:ventaTotal, costoCompra:costoTotal,
        fecha:fechaCompra, fechaEst:fechaEst||null,
        financiadorId, proveedor:obs,
        productos:productos.map(p=>({
          descripcion:p.desc.trim(), cantidad:Number(p.cantidad)||1,
          precioCompra:Number(p.precioCompra)||0, precioVenta:Number(p.precioVenta)||0,
          url:p.link.trim(),
        })),
      });
    } catch(e){setErr(e.message);setSaving(false);}
  };

  // ── UI helpers ─────────────────────────────────
  const stepStyle=(n)=>({
    width:28,height:28,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",
    fontSize:12,fontWeight:800,flexShrink:0,
    background:paso>n?C.ok:paso===n?C.teal:C.border,
    color:paso>=n?"#fff":C.inkMuted,
  });
  const lineStyle=(n)=>({height:2,flex:1,background:paso>n?C.ok:C.border});

  return (
    <div>
      {/* Indicador de pasos */}
      <div style={{display:"flex",alignItems:"center",gap:0,marginBottom:20,padding:"0 4px"}}>
        <div style={stepStyle(1)}>1</div>
        <div style={lineStyle(1)} />
        <div style={stepStyle(2)}>2</div>
        <div style={lineStyle(2)} />
        <div style={stepStyle(3)}>3</div>
        <div style={lineStyle(3)} />
        <div style={stepStyle(4)}>✓</div>
      </div>
      <div style={{fontSize:11,color:C.inkMuted,textAlign:"center",marginTop:-14,marginBottom:16}}>
        {paso===1?"Datos de la OC":paso===2?"Productos":paso===3?"Compra":"Resumen y confirmación"}
      </div>

      {/* ─── PASO 1: Datos OC ─── */}
      {paso===1&&(
        <div>
          <Field label="Código OC (Mercado Público)" required>
            {ocExistente
              ? <div style={{...iMono,background:C.paper,color:C.inkMuted,display:"flex",alignItems:"center"}}>{numOC} <span style={{fontSize:10,marginLeft:8,color:C.teal}}>✓ definida</span></div>
              : <input style={iMono} value={numOC} onChange={e=>setNumOC(e.target.value)} placeholder="ej: 2436-690-AG26" />}
          </Field>
          <Field label="Vendedor" required>
            <select style={selStyle} value={vendedorId} onChange={e=>setVendedorId(e.target.value)}>
              {vendedores.map(v=><option key={v.id} value={v.id}>{v.nombre}</option>)}
            </select>
          </Field>
          <div style={{height:1,background:C.border,margin:"14px 0"}} />
          <Field label="RUT del cliente" hint="Escribe el RUT para autocompletar">
            <input style={iStyle} value={rutCliente} onChange={e=>handleRutChange(e.target.value)} placeholder="ej: 69.150.600-2" />
          </Field>
          {autocompletado&&<div style={{background:C.okLight,borderRadius:8,padding:"7px 10px",fontSize:11.5,color:C.ok,fontWeight:600,marginBottom:10}}>✓ Datos autocompletados desde el catálogo</div>}
          <Field label="Institución / Cliente" required>
            <input style={iStyle} value={cliente} onChange={e=>setCliente(e.target.value)} placeholder="ej: Municipalidad de Concepción" />
          </Field>
          <Field label="Entidad (nombre organismo)">
            <input style={iStyle} value={entidad} onChange={e=>setEntidad(e.target.value)} placeholder="ej: Depto. de Salud" />
          </Field>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <Field label="Comuna"><input style={iStyle} value={comuna} onChange={e=>setComuna(e.target.value)} placeholder="ej: Concepción" /></Field>
            <Field label="Contacto"><input style={iStyle} value={contacto} onChange={e=>setContacto(e.target.value)} placeholder="Nombre / teléfono" /></Field>
          </div>
          <Field label="Correo">
            <input style={iStyle} type="email" value={correo} onChange={e=>setCorreo(e.target.value)} placeholder="contacto@entidad.cl" />
          </Field>
        </div>
      )}

      {/* ─── PASO 2: Productos ─── */}
      {paso===2&&(
        <div>
          <div style={{fontSize:12,color:C.inkMuted,marginBottom:12}}>Agrega cada producto con su cantidad, precios y link de compra.</div>
          {productos.map((p,i)=>(
            <div key={i} style={{background:C.paper,borderRadius:10,padding:"12px 12px 8px",marginBottom:10,border:`1px solid ${C.border}`}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                <div style={{fontSize:12,fontWeight:700,color:C.teal}}>Producto {i+1}</div>
                {productos.length>1&&<button onClick={()=>delProducto(i)} style={{background:"none",border:"none",color:C.danger,fontSize:13,cursor:"pointer",padding:"0 4px"}}>✕ Eliminar</button>}
              </div>
              <Field label="Descripción" required>
                <input style={iStyle} value={p.desc} onChange={e=>updProducto(i,"desc",e.target.value)} placeholder="ej: Silla ergonómica negra 3C" />
              </Field>
              <Field label="Link de compra (tienda online)">
                <input style={iStyle} value={p.link} onChange={e=>updProducto(i,"link",e.target.value)} placeholder="https://..." />
              </Field>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
                <Field label="Cantidad">
                  <input style={iMono} type="number" min="1" value={p.cantidad} onChange={e=>updProducto(i,"cantidad",e.target.value)} />
                </Field>
                <Field label="P. Compra ($)" hint="Lo que pagas">
                  <input style={iMono} type="number" value={p.precioCompra} onChange={e=>updProducto(i,"precioCompra",e.target.value)} />
                </Field>
                <Field label="P. Venta ($)" hint="Lo que cobras">
                  <input style={iMono} type="number" value={p.precioVenta} onChange={e=>updProducto(i,"precioVenta",e.target.value)} />
                </Field>
              </div>
              {(p.precioCompra||p.precioVenta)&&(
                <div style={{fontSize:11,color:C.inkMuted,marginTop:4}}>
                  Subtotal compra: <b>${((Number(p.precioCompra)||0)*(Number(p.cantidad)||1)).toLocaleString("es-CL")}</b>
                  {" · "}Subtotal venta: <b>${((Number(p.precioVenta)||0)*(Number(p.cantidad)||1)).toLocaleString("es-CL")}</b>
                </div>
              )}
            </div>
          ))}
          <button onClick={addProducto} style={{...btnP(C.inkFaint),fontSize:12,marginBottom:14}}>+ Agregar otro producto</button>
          {ventaTotal>0&&(
            <div style={{background:C.tealLight,borderRadius:9,padding:"10px 14px",fontSize:12.5}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:4}}>
                <div><div style={{color:C.inkMuted,fontSize:10.5}}>Costo total</div><div style={{fontWeight:700,color:C.ink}}>${costoTotal.toLocaleString("es-CL")}</div></div>
                <div><div style={{color:C.inkMuted,fontSize:10.5}}>Venta total</div><div style={{fontWeight:700,color:C.ink}}>${ventaTotal.toLocaleString("es-CL")}</div></div>
                <div><div style={{color:C.inkMuted,fontSize:10.5}}>Utilidad ({margen}%)</div><div style={{fontWeight:700,color:utilidad>=0?C.ok:C.danger}}>${utilidad.toLocaleString("es-CL")}</div></div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── PASO 3: Compra ─── */}
      {paso===3&&(
        <div>
          <Field label="Financiador" required>
            <select style={selStyle} value={financiadorId} onChange={e=>setFinanciadorId(e.target.value)}>
              {financiadores.map(f=><option key={f.id} value={f.id}>{f.nombre}</option>)}
            </select>
          </Field>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <Field label="Fecha de compra" required>
              <input style={iStyle} type="date" value={fechaCompra} onChange={e=>setFechaCompra(e.target.value)} />
            </Field>
            <Field label="Entrega estimada">
              <input style={iStyle} type="date" value={fechaEst} onChange={e=>setFechaEst(e.target.value)} />
            </Field>
          </div>
          <Field label="Observaciones / Proveedor">
            <input style={iStyle} value={obs} onChange={e=>setObs(e.target.value)} placeholder="ej: MercadoLibre, nota de despacho, etc." />
          </Field>
          {/* Resumen de montos */}
          <div style={{background:C.paper,borderRadius:9,padding:"12px 14px",marginTop:8}}>
            <div style={{fontSize:11,fontWeight:700,color:C.inkMuted,marginBottom:8,textTransform:"uppercase"}}>Resumen financiero</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:4,fontSize:12.5}}>
              <div><div style={{color:C.inkMuted,fontSize:10.5}}>Costo</div><div style={{fontWeight:700}}>${costoTotal.toLocaleString("es-CL")}</div></div>
              <div><div style={{color:C.inkMuted,fontSize:10.5}}>Venta</div><div style={{fontWeight:700}}>${ventaTotal.toLocaleString("es-CL")}</div></div>
              <div><div style={{color:C.inkMuted,fontSize:10.5}}>Utilidad ({margen}%)</div><div style={{fontWeight:700,color:utilidad>=0?C.ok:C.danger}}>${utilidad.toLocaleString("es-CL")}</div></div>
            </div>
          </div>
        </div>
      )}

      {/* ─── PASO 4: Resumen ─── */}
      {paso===4&&(
        <div>
          <div style={{background:C.paper,borderRadius:10,padding:"12px 14px",marginBottom:12}}>
            <div style={{fontSize:11,fontWeight:700,color:C.inkMuted,textTransform:"uppercase",marginBottom:8}}>Datos de la OC</div>
            <div style={{fontSize:12.5,lineHeight:1.8}}>
              <b>OC:</b> {numOC}<br/>
              <b>Vendedor:</b> {vendedores.find(v=>v.id===vendedorId)?.nombre}<br/>
              <b>Cliente:</b> {cliente}{entidad?` · ${entidad}`:""}<br/>
              {comuna&&<><b>Comuna:</b> {comuna}<br/></>}
              {contacto&&<><b>Contacto:</b> {contacto}<br/></>}
              {correo&&<><b>Correo:</b> {correo}<br/></>}
            </div>
          </div>
          <div style={{background:C.paper,borderRadius:10,padding:"12px 14px",marginBottom:12}}>
            <div style={{fontSize:11,fontWeight:700,color:C.inkMuted,textTransform:"uppercase",marginBottom:8}}>{productos.length} Producto{productos.length!==1?"s":""}</div>
            {productos.map((p,i)=>(
              <div key={i} style={{borderLeft:`2px solid ${C.teal}`,paddingLeft:10,marginBottom:8}}>
                <div style={{fontSize:12.5,fontWeight:600}}>{p.desc} × {p.cantidad}</div>
                <div style={{fontSize:11,color:C.inkMuted}}>Compra: ${(Number(p.precioCompra)*Number(p.cantidad)).toLocaleString("es-CL")} · Venta: ${(Number(p.precioVenta)*Number(p.cantidad)).toLocaleString("es-CL")}</div>
                {p.link&&<div style={{fontSize:10.5,color:C.teal,wordBreak:"break-all"}}>{p.link.slice(0,60)}{p.link.length>60?"…":""}</div>}
              </div>
            ))}
          </div>
          <div style={{background:C.tealLight,borderRadius:10,padding:"12px 14px",marginBottom:12}}>
            <div style={{fontSize:11,fontWeight:700,color:C.inkMuted,textTransform:"uppercase",marginBottom:8}}>Resumen financiero</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:4,fontSize:13}}>
              <div><div style={{color:C.inkMuted,fontSize:10.5}}>Costo</div><div style={{fontWeight:800}}>${costoTotal.toLocaleString("es-CL")}</div></div>
              <div><div style={{color:C.inkMuted,fontSize:10.5}}>Venta</div><div style={{fontWeight:800}}>${ventaTotal.toLocaleString("es-CL")}</div></div>
              <div><div style={{color:C.inkMuted,fontSize:10.5}}>Utilidad</div><div style={{fontWeight:800,color:utilidad>=0?C.ok:C.danger}}>${utilidad.toLocaleString("es-CL")} ({margen}%)</div></div>
            </div>
            <div style={{marginTop:8,fontSize:12,color:C.inkMuted}}>
              <b>Financiador:</b> {financiadores.find(f=>f.id===financiadorId)?.nombre} · <b>Fecha:</b> {fechaCompra}
              {fechaEst&&<> · <b>Entrega est.:</b> {fechaEst}</>}
            </div>
          </div>
        </div>
      )}

      {/* Error */}
      {err&&<div style={{background:C.dangerLight,color:C.danger,borderRadius:8,padding:"8px 12px",fontSize:12.5,marginBottom:10,fontWeight:600}}>{err}</div>}

      {/* Navegación entre pasos */}
      <div style={{display:"flex",gap:8,marginTop:8}}>
        {paso>1&&<button onClick={()=>{setErr("");setPaso(p=>p-1);}} style={{...btnP(C.inkFaint),flex:1}}>← Atrás</button>}
        {paso<4&&(
          <button onClick={()=>{
            const ok=paso===1?validarPaso1():paso===2?validarPaso2():validarPaso3();
            if(ok) setPaso(p=>p+1);
          }} style={{...btnP(C.teal),flex:2}}>Siguiente →</button>
        )}
        {paso===4&&(
          <button onClick={handleGuardar} disabled={saving} style={{...btnP(saving?C.inkFaint:C.ok),flex:2}}>{saving?"Guardando…":"✓ Crear OC"}</button>
        )}
      </div>
    </div>
  );
}
