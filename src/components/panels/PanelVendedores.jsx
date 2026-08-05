import { useState } from "react";
import { Field, Modal } from "../ui/Basicos";
import { del } from "../../lib/supabase";
import { C, MONO, btnG, btnP, fmt, iMono, selStyle } from "../../lib/theme";

export function PanelVendedores({ vendedores, ocs, ivaMensual, pagosVendedor, onGuardarIva, onPagoVendedor }) {
  const [editIva,setEditIva]=useState(false);
  const hoy=new Date(); const mesActual=hoy.getMonth()+1; const anioActual=hoy.getFullYear();
  const MESES=["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

  // Leer año/mes directo del texto "YYYY-MM-DD" en vez de construir un
  // Date y usar .getFullYear()/.getMonth() — esos métodos leen en la
  // zona horaria local del navegador, y una fecha guardada como
  // medianoche UTC se corre un día para atrás en Chile (UTC-4), haciendo
  // que facturas del día 1 del mes queden contadas en el mes anterior.
  const anioMesDe=(fechaStr)=>{
    const [y,m]=String(fechaStr).slice(0,10).split("-");
    return {anio:Number(y),mes:Number(m)};
  };

  const datosVendedor=(v)=>{
    const mesSet=new Set();
    ocs.filter(o=>o.vendedor_id===v.id&&o.estado_factura_propia==="emitida").forEach(o=>{
      (o.eventos_factura||[]).forEach(ef=>{ const {anio,mes}=anioMesDe(ef.fecha); mesSet.add(`${anio}-${mes}`); });
    });
    return Array.from(mesSet).sort((a,b)=>b.localeCompare(a)).map(ym=>{
      const [y,m]=[Number(ym.split("-")[0]),Number(ym.split("-")[1])];
      // La comisión es sobre la UTILIDAD del período (venta − costo), no
      // sobre el monto bruto facturado — usar sumaFacts acá inflaba el
      // cálculo varias veces por encima de lo real.
      let sumaFacts=0, sumaUtilidad=0;
      ocs.filter(o=>o.vendedor_id===v.id&&o.estado_factura_propia==="emitida").forEach(o=>{
        const factsMes=(o.eventos_factura||[]).filter(ef=>{ const {anio,mes}=anioMesDe(ef.fecha); return anio===y&&mes===m; });
        if(!factsMes.length) return;
        sumaFacts+=factsMes.reduce((ss,ef)=>ss+(ef.monto||0),0);
        sumaUtilidad+=(Number(o.monto_total)||0)-(Number(o.costo_total)||0);
      });
      const ivaMesV2=ivaMensual.find(i=>i.mes===m&&i.anio===y); const impPagadoV2=ivaMesV2?Math.max(0,(ivaMesV2.iva_ventas||0)-(ivaMesV2.iva_compras||0)):0; const pagoCalculado=Math.max(0,Math.round(sumaUtilidad/2 - impPagadoV2/2));
      const pagosDelMes=pagosVendedor.filter(p=>p.vendedor_id===v.id&&p.mes===m&&p.anio===y);
      const pagado=pagosDelMes.reduce((s,p)=>s+(p.monto_pagado||0),0);
      const estado=pagado>=pagoCalculado?"pagado":"pendiente";
      return {mes:m,anio:y,label:fmt.monthYear(m,y),sumaFacts,sumaUtilidad,pagoCalculado,pagado,estado,deuda:Math.max(0,pagoCalculado-pagado)};
    });
  };

  return (
    <div>
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:16,marginBottom:16}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
          <div style={{fontWeight:800,fontSize:14,color:C.ink}}>IVA del mes ({fmt.monthYear(mesActual,anioActual)})</div>
          <button onClick={()=>setEditIva(true)} style={btnG}>{ivaMensual.find(i=>i.mes===mesActual&&i.anio===anioActual)?"Editar":"Registrar"}</button>
        </div>
        {ivaMensual.find(i=>i.mes===mesActual&&i.anio===anioActual)?
          <div style={{fontFamily:MONO,fontWeight:800,fontSize:18,color:C.info}}>{fmt.money(ivaMensual.find(i=>i.mes===mesActual&&i.anio===anioActual).iva_pagado)}</div>:
          <div style={{fontSize:12.5,color:C.inkFaint}}>Sin registrar.</div>
        }
      </div>

      {vendedores.map(v=>{
        const datos=datosVendedor(v);
        const ultimoPagado=datos.find(d=>d.estado==="pagado");
        const deudaTotal=datos.reduce((s,d)=>s+d.deuda,0);
        return (
          <div key={v.id} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:16,marginBottom:12}}>
            <div style={{fontWeight:800,fontSize:15,color:C.ink,marginBottom:4}}>{v.nombre}</div>
            {ultimoPagado&&<div style={{fontSize:12,color:C.ok,fontWeight:700,marginBottom:6}}>Último pagado: {ultimoPagado.label} · {fmt.money(ultimoPagado.pagado)}</div>}
            {deudaTotal>0&&<div style={{fontSize:12,color:C.warn,fontWeight:700,marginBottom:10}}>Deuda pendiente: {fmt.money(deudaTotal)}</div>}
            <div style={{fontSize:11.5,fontWeight:800,color:C.inkMuted,textTransform:"uppercase",marginBottom:6}}>Cartola de pagos</div>
            {datos.length===0&&<div style={{fontSize:12,color:C.inkFaint}}>Sin facturas registradas.</div>}
            {datos.map(d=>(
              <div key={d.label} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${C.border}`}}>
                <div>
                  <div style={{fontSize:12.5,fontWeight:700,color:C.ink}}>{d.label}</div>
                  <div style={{fontSize:11,color:C.inkFaint}}>Calculado {fmt.money(d.pagoCalculado)} · Utilidad {fmt.money(d.sumaUtilidad)} · Facturas {fmt.money(d.sumaFacts)}</div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:12,fontWeight:800,color:d.estado==="pagado"?C.ok:C.warn}}>{d.estado==="pagado"?"Pagado":"Pendiente"} {fmt.money(d.pagado)}</div>
                  {d.deuda>0&&<div style={{fontSize:11,color:C.danger}}>Debe {fmt.money(d.deuda)}</div>}
                </div>
              </div>
            ))}
          </div>
        );
      })}

      {editIva&&(
        <Modal title="IVA mensual" onClose={()=>setEditIva(false)}>
          <FormIvaMensual ivaExistente={ivaMensual.find(i=>i.mes===mesActual&&i.anio===anioActual)} onSave={async(d)=>{await onGuardarIva(d);setEditIva(false);}} />
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
  const ivaPagado=Math.max(0,Number(iV||0)-Number(iC||0));
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
      <div style={{background:C.tealLight,borderRadius:9,padding:"10px 12px",fontSize:13,color:C.tealDark,fontWeight:700,marginBottom:14}}>IVA a pagar: {fmt.money(ivaPagado)}</div>
      {err&&<div style={{background:C.dangerLight,color:C.danger,borderRadius:8,padding:"8px 12px",fontSize:12.5,marginBottom:10,fontWeight:600}}>{err}</div>}
      <button onClick={handleSave} disabled={saving} style={btnP(saving?C.inkFaint:C.info)}>{saving?"Guardando…":"✓ Guardar IVA"}</button>
    </div>
  );
}
