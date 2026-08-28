import { useState, useMemo } from "react";
import { Field, Modal } from "../ui/Basicos";
import { C, MONO, btnP, fmt, iMono, iStyle, selStyle } from "../../lib/theme";

export function PanelGastos({ gastos, categorias, vendedores, pagosVendedor, ocs, onNuevoGasto, onPagoVendedor }) {
  const [showForm,setShowForm]=useState(false);
  const [tipoForm,setTipoForm]=useState("gasto");
  const [abierta,setAbierta]=useState(null);

  const ultimoPorCat=useMemo(()=>{
    const map={};
    for(const g of gastos){ const k=g.categoria_id; if(!map[k]||`${g.anio}-${g.mes}`>`${map[k].anio}-${map[k].mes}`) map[k]=g; }
    return map;
  },[gastos]);

  const historialPorCat=useMemo(()=>{
    const map={};
    for(const g of gastos){ (map[g.categoria_id]=map[g.categoria_id]||[]).push(g); }
    for(const k in map) map[k].sort((a,b)=>`${b.anio}-${String(b.mes).padStart(2,"0")}`.localeCompare(`${a.anio}-${String(a.mes).padStart(2,"0")}`));
    return map;
  },[gastos]);

  return (
    <div>
      <div style={{display:"flex",gap:8,marginBottom:16}}>
        <button onClick={()=>{setTipoForm("gasto");setShowForm(true);}} style={btnP(C.warn)}>+ Registrar gasto</button>
        <button onClick={()=>{setTipoForm("vendedor");setShowForm(true);}} style={{...btnP(C.teal),flex:1}}>+ Pago a vendedor</button>
      </div>
      <div style={{fontSize:12.5,fontWeight:800,color:C.inkMuted,marginBottom:8,textTransform:"uppercase",letterSpacing:0.4}}>Gastos por categoría</div>
      {categorias.map(c=>{
        const u=ultimoPorCat[c.id];
        const historial=historialPorCat[c.id]||[];
        const estaAbierta=abierta===c.id;
        return (
          <div key={c.id} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,marginBottom:8,overflow:"hidden"}}>
            <button onClick={()=>historial.length&&setAbierta(estaAbierta?null:c.id)}
              style={{width:"100%",background:"none",border:"none",padding:"12px 15px",cursor:historial.length?"pointer":"default",
                display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,textAlign:"left"}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:700,fontSize:13.5,color:C.ink}}>{c.nombre}</div>
                {u?<div style={{fontSize:11.5,color:C.inkMuted,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{u.subcategoria||u.detalle||"—"} · {fmt.monthYear(u.mes,u.anio)}</div>:<div style={{fontSize:11.5,color:C.inkFaint}}>Sin pagos</div>}
              </div>
              {u&&<div style={{fontFamily:MONO,fontWeight:800,fontSize:15,color:C.warn,flexShrink:0,whiteSpace:"nowrap"}}>{fmt.money(u.monto)}</div>}
              {historial.length>1&&<span style={{fontSize:11,color:C.inkFaint,flexShrink:0}}>{estaAbierta?"▲":"▼"}</span>}
            </button>
            {estaAbierta&&historial.length>0&&(
              <div style={{padding:"0 15px 12px"}}>
                <div style={{fontSize:10.5,fontWeight:800,color:C.inkMuted,textTransform:"uppercase",marginBottom:6,paddingTop:8,borderTop:`1px solid ${C.border}`}}>Historial completo ({historial.length})</div>
                {historial.map(g=>(
                  <div key={g.id} style={{padding:"7px 0",borderBottom:`1px solid ${C.border}`}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",gap:8}}>
                      <span style={{fontSize:12,fontWeight:700,color:C.ink}}>{fmt.monthYear(g.mes,g.anio)}</span>
                      <span style={{fontFamily:MONO,fontWeight:800,fontSize:13,color:C.warn,flexShrink:0}}>{fmt.money(g.monto)}</span>
                    </div>
                    {(g.detalle||g.subcategoria)&&<div style={{fontSize:11,color:C.inkMuted}}>{g.subcategoria||g.detalle}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {showForm&&tipoForm==="gasto"&&(
        <Modal title="Registrar gasto" onClose={()=>setShowForm(false)}>
          <FormNuevoGasto categorias={categorias} onSave={async(d)=>{await onNuevoGasto(d);setShowForm(false);}} />
        </Modal>
      )}
      {showForm&&tipoForm==="vendedor"&&(
        <Modal title="Pago a vendedor" onClose={()=>setShowForm(false)}>
          <FormPagoVendedorSimple vendedores={vendedores} ocs={ocs} onSave={async(d)=>{await onPagoVendedor(d);setShowForm(false);}} />
        </Modal>
      )}
    </div>
  );
}

export function FormNuevoGasto({ categorias, onSave }) {
  const [catId,setCatId]=useState(categorias[0]?.id||""); const [sub,setSub]=useState(""); const [monto,setMonto]=useState("");
  const [mes,setMes]=useState(new Date().getMonth()+1); const [anio,setAnio]=useState(new Date().getFullYear());
  const [fecha,setFecha]=useState(new Date().toISOString().slice(0,10)); const [detalle,setDetalle]=useState("");
  const [err,setErr]=useState(""); const [saving,setSaving]=useState(false);
  const cat=categorias.find(c=>c.id===catId); const subs=cat?.subcategorias||[];
  const handleSubChange=(n)=>{ setSub(n); const s=subs.find(x=>x.nombre===n); if(s?.monto_sugerido) setMonto(String(s.monto_sugerido)); };
  const handleSave=async()=>{
    if(!monto||Number(monto)<=0){setErr("Indica el monto");return;}
    setErr(""); setSaving(true);
    try{await onSave({categoriaId:catId,subcategoria:sub,monto:Number(monto),mes:Number(mes),anio:Number(anio),fecha,detalle});}
    catch(e){setErr(e.message);}finally{setSaving(false);};
  };
  const MESES=["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
  return (
    <div>
      <Field label="Categoría" required><select style={selStyle} value={catId} onChange={e=>{setCatId(e.target.value);setSub("");}}>{categorias.map(c=><option key={c.id} value={c.id}>{c.nombre}</option>)}</select></Field>
      {subs.length>0&&<Field label="Subcategoría"><select style={selStyle} value={sub} onChange={e=>handleSubChange(e.target.value)}><option value="">Selecciona…</option>{subs.map(s=><option key={s.nombre} value={s.nombre}>{s.nombre}{s.monto_sugerido?` (${fmt.money(s.monto_sugerido)})`:"" }</option>)}</select></Field>}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        <Field label="Mes" required><select style={selStyle} value={mes} onChange={e=>setMes(e.target.value)}>{MESES.map((m,i)=><option key={i} value={i+1}>{m}</option>)}</select></Field>
        <Field label="Año" required><input style={iMono} type="number" value={anio} onChange={e=>setAnio(e.target.value)} /></Field>
      </div>
      <Field label="Fecha de pago" required><input style={iStyle} type="date" value={fecha} onChange={e=>setFecha(e.target.value)} /></Field>
      <Field label="Monto ($)" required><input style={iMono} type="number" value={monto} onChange={e=>setMonto(e.target.value)} /></Field>
      <Field label="Detalle"><input style={iStyle} value={detalle} onChange={e=>setDetalle(e.target.value)} /></Field>
      {err&&<div style={{background:C.dangerLight,color:C.danger,borderRadius:8,padding:"8px 12px",fontSize:12.5,marginBottom:10,fontWeight:600}}>{err}</div>}
      <button onClick={handleSave} disabled={saving} style={btnP(saving?C.inkFaint:C.warn)}>{saving?"Guardando…":"✓ Registrar gasto"}</button>
    </div>
  );
}

export function FormPagoVendedorSimple({ vendedores, ocs, onSave }) {
  const [vendedorId,setVendedorId]=useState(vendedores[0]?.id||"");
  const [monto,setMonto]=useState(""); const [fecha,setFecha]=useState(new Date().toISOString().slice(0,10));
  const [mes,setMes]=useState(new Date().getMonth()+1); const [anio,setAnio]=useState(new Date().getFullYear());
  const [marcarPagadas,setMarcarPagadas]=useState(true);
  const [err,setErr]=useState(""); const [saving,setSaving]=useState(false);
  const vend=vendedores.find(v=>v.id===vendedorId);
  const MESES=["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
  const labelMes=`Ventas de ${MESES[mes-1]}/${anio}`;
  const ocsDelMes=ocs?.filter(o=>{
    if(o.vendedor_id!==vendedorId||o.estado_factura_propia!=="emitida"||o.vendedor_pagado) return false;
    const evF=(o.eventos_factura||[])[0]; if(!evF) return false;
    const f=new Date(evF.fecha); return f.getMonth()+1===Number(mes)&&f.getFullYear()===Number(anio);
  })||[];
  const handleSave=async()=>{
    if(!monto||Number(monto)<=0){setErr("Indica el monto");return;}
    setErr(""); setSaving(true);
    try{await onSave({vendedorId,monto:Number(monto),fecha,mes:Number(mes),anio:Number(anio),label:labelMes,ocIdsAMarcar:marcarPagadas?ocsDelMes.map(o=>o.id):[]});}
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
      {ocs&&(
        <label style={{display:"flex",alignItems:"flex-start",gap:8,background:C.paper,borderRadius:9,padding:"10px 12px",marginBottom:12,cursor:"pointer"}}>
          <input type="checkbox" checked={marcarPagadas} onChange={e=>setMarcarPagadas(e.target.checked)} style={{marginTop:2}} />
          <span style={{fontSize:12,color:C.inkMuted}}>Marcar las {ocsDelMes.length} OC{ocsDelMes.length!==1?"s":""} facturadas este mes como "vendedor pagado" — evita que se vuelvan a contar si se re-emite la factura en otro mes</span>
        </label>
      )}
      {err&&<div style={{background:C.dangerLight,color:C.danger,borderRadius:8,padding:"8px 12px",fontSize:12.5,marginBottom:10,fontWeight:600}}>{err}</div>}
      <button onClick={handleSave} disabled={saving} style={btnP(saving?C.inkFaint:C.teal)}>{saving?"Guardando…":"✓ Registrar pago"}</button>
    </div>
  );
}
