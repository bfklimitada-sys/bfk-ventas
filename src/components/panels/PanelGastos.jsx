import { useState, useMemo } from "react";
import { Field, Modal } from "../ui/Basicos";
import { C, btnP, fmt, iMono, iStyle, selStyle } from "../../lib/theme";
import { Ic } from "../ui/Iconos";
import { Seccion, Tarjeta, Badge, Monto } from "../ui/Sistema";
import { FormIvaMensual } from "../forms/FormIvaMensual";
import { CATEGORIA_IMPUESTO, periodosIvaIncompletos } from "../../lib/ivaUnificado";

// Los pagos a vendedores hoy se administran en Vendedores; la categoria historica solo se consulta.
const esHistoricaVendedor=(c)=>/vendedor/i.test(c?.nombre||"");

export function PanelGastos({ gastos, categorias, ivaMensual=[], onNuevoGasto, onGuardarIva }) {
  const [showForm,setShowForm]=useState(false);
  const [ivaPeriodo,setIvaPeriodo]=useState(undefined); // undefined = cerrado · null = mes sugerido · {anio,mes}
  const incompletos=useMemo(()=>periodosIvaIncompletos({gastos,ivaMensual}),[gastos,ivaMensual]);
  const esIncompleto=(g)=>g.categoria_id===CATEGORIA_IMPUESTO&&incompletos.some(p=>p.anio===Number(g.anio)&&p.mes===Number(g.mes));
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

  const tarjetaCategoria=(c,historica)=>{
    const u=ultimoPorCat[c.id];
    const historial=historialPorCat[c.id]||[];
    const estaAbierta=abierta===c.id;
    return (
      <Tarjeta key={c.id} padding="0" style={{overflow:"hidden",marginBottom:8,background:historica?C.paper:C.card}}>
        <button onClick={()=>historial.length&&setAbierta(estaAbierta?null:c.id)}
          style={{width:"100%",background:"none",border:"none",padding:"12px 16px",minHeight:60,cursor:historial.length?"pointer":"default",
            display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,textAlign:"left"}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontWeight:700,fontSize:15,color:historica?C.inkMuted:C.ink,lineHeight:1.25}}>{c.nombre}</div>
            {u
              ?<div style={{fontSize:12,color:C.inkMuted,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",marginTop:2}}>{u.subcategoria||u.detalle||"—"} · {fmt.monthYear(u.mes,u.anio)}</div>
              :<div style={{fontSize:12,color:C.inkMuted,marginTop:2}}>Sin pagos registrados</div>}
          </div>
          {u&&<Monto tam="md" tono={historica?"suave":"neutro"}>{fmt.money(u.monto)}</Monto>}
          {historial.length>1&&<Ic n={estaAbierta?"chevD":"chevR"}/>}
        </button>
        {estaAbierta&&historial.length>0&&(
          <div style={{padding:"0 16px 12px"}}>
            <div style={{fontSize:12,fontWeight:800,color:C.inkMuted,textTransform:"uppercase",letterSpacing:0.5,marginBottom:4,paddingTop:10,borderTop:`1px solid ${C.border}`}}>Historial completo ({historial.length})</div>
            {historial.map(g=>(
              <div key={g.id} style={{padding:"8px 0",borderBottom:`1px solid ${C.border}`}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",gap:8}}>
                  <span style={{fontSize:13,fontWeight:700,color:C.ink}}>{fmt.monthYear(g.mes,g.anio)}</span>
                  <Monto tam="sm" tono={historica?"suave":"neutro"}>{fmt.money(g.monto)}</Monto>
                </div>
                {(g.detalle||g.subcategoria)&&<div style={{fontSize:12,color:C.inkMuted,marginTop:1}}>{g.subcategoria||g.detalle}</div>}
                {esIncompleto(g)&&onGuardarIva&&(
                  <button data-iva-incompleto onClick={()=>setIvaPeriodo({anio:Number(g.anio),mes:Number(g.mes)})}
                    style={{background:"none",border:"none",color:C.warnText,fontSize:12,fontWeight:700,cursor:"pointer",textDecoration:"underline",padding:"4px 0 0"}}>
                    ⚠ Falta débito/crédito: la comisión de este mes va sin IVA · Completar
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </Tarjeta>
    );
  };

  const actuales=categorias.filter(c=>!esHistoricaVendedor(c));
  const historicas=categorias.filter(esHistoricaVendedor);

  return (
    <div>
      <button onClick={()=>{setTipoForm("gasto");setShowForm(true);}} style={{...btnP(C.teal),marginBottom:20}}>+ Registrar gasto</button>

      <Seccion titulo="Gastos por categoría" nota="Se muestra el último pago de cada categoría. Toca una para ver su historial.">
        {actuales.map(c=>tarjetaCategoria(c,false))}
      </Seccion>

      {historicas.length>0&&(
        <Seccion titulo="Histórico" nota="Solo consulta. Los pagos a vendedores ahora se registran en Vendedores.">
          {historicas.map(c=>tarjetaCategoria(c,true))}
        </Seccion>
      )}

      {showForm&&tipoForm==="gasto"&&(
        <Modal title="Registrar gasto" onClose={()=>setShowForm(false)}>
          <FormNuevoGasto categorias={actuales} onSave={async(d)=>{await onNuevoGasto(d);setShowForm(false);}}
            onIva={onGuardarIva?()=>{setShowForm(false);setIvaPeriodo(null);}:null} />
        </Modal>
      )}
      {ivaPeriodo!==undefined&&onGuardarIva&&(
        <Modal title="IVA del mes" onClose={()=>setIvaPeriodo(undefined)}>
          <FormIvaMensual ivaMensual={ivaMensual} gastos={gastos} periodo={ivaPeriodo} onSave={async(d)=>{await onGuardarIva(d);setIvaPeriodo(undefined);}} />
        </Modal>
      )}
    </div>
  );
}

export function FormNuevoGasto({ categorias, onSave, onIva }) {
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
  // IVA mensual va por el formulario único; otro impuesto (subcategoría sin "IVA") sigue como gasto normal.
  const esImpuesto=catId===CATEGORIA_IMPUESTO&&!!onIva&&!(sub&&!/iva/i.test(sub));
  return (
    <div>
      <Field label="Categoría" required><select style={selStyle} value={catId} onChange={e=>{setCatId(e.target.value);setSub("");}}>{categorias.map(c=><option key={c.id} value={c.id}>{c.nombre}</option>)}</select></Field>
      {subs.length>0&&<Field label="Subcategoría"><select style={selStyle} value={sub} onChange={e=>handleSubChange(e.target.value)}><option value="">Selecciona…</option>{subs.map(s=><option key={s.nombre} value={s.nombre}>{s.nombre}{s.monto_sugerido?` (${fmt.money(s.monto_sugerido)})`:"" }</option>)}</select></Field>}
      {esImpuesto&&(
        <div style={{background:C.tealLight,borderRadius:9,padding:"10px 12px",fontSize:13,color:C.tealDark,marginBottom:12}}>
          El impuesto del mes se registra junto con su débito y crédito, en un solo paso: así queda en caja y en la comisión.
          <button onClick={onIva} style={{...btnP(C.info),marginTop:10}}>Registrar IVA del mes</button>
        </div>
      )}
      {!esImpuesto&&<>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        <Field label="Mes" required><select style={selStyle} value={mes} onChange={e=>setMes(e.target.value)}>{MESES.map((m,i)=><option key={i} value={i+1}>{m}</option>)}</select></Field>
        <Field label="Año" required><input style={iMono} type="number" value={anio} onChange={e=>setAnio(e.target.value)} /></Field>
      </div>
      <Field label="Fecha de pago" required><input style={iStyle} type="date" value={fecha} onChange={e=>setFecha(e.target.value)} /></Field>
      <Field label="Monto ($)" required><input style={iMono} type="number" value={monto} onChange={e=>setMonto(e.target.value)} /></Field>
      <Field label="Detalle"><input style={iStyle} value={detalle} onChange={e=>setDetalle(e.target.value)} /></Field>
      {err&&<div style={{background:C.dangerLight,color:C.dangerText,borderRadius:8,padding:"8px 12px",fontSize:12.5,marginBottom:10,fontWeight:600}}>{err}</div>}
      <button onClick={handleSave} disabled={saving} style={btnP(saving?C.inkFaint:C.warn)}>{saving?"Guardando…":"✓ Registrar gasto"}</button>
      </>}
    </div>
  );
}
