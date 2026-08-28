import { useState } from "react";
import { Field, Modal } from "../ui/Basicos";
import { del } from "../../lib/supabase";
import { C, MONO, btnG, btnP, fmt, iMono, selStyle } from "../../lib/theme";

export function PanelVendedores({ vendedores, ocs, ivaMensual, pagosVendedor, onGuardarIva, onPagoVendedor }) {
  const [editIva,setEditIva]=useState(false);
  const [abierto,setAbierto]=useState(null); // id del vendedor desplegado
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
      (o.eventos_factura||[]).forEach(ef=>{ const {anio,mes}=anioMesDe(ef.fecha); mesSet.add(`${anio}-${String(mes).padStart(2,"0")}`); });
    });
    return Array.from(mesSet).sort((a,b)=>b.localeCompare(a)).map(ym=>{
      const [y,m]=[Number(ym.split("-")[0]),Number(ym.split("-")[1])];
      // La comisión es sobre la UTILIDAD del período (venta − costo), no
      // sobre el monto bruto facturado. Las OC marcadas "venta propia"
      // se pagan aparte, 100% de su utilidad menos el IVA de su propia
      // factura — no entran al reparto general del 50%.
      let sumaFacts=0, sumaUtilidad=0, pagoVentasPropias=0;
      ocs.filter(o=>o.vendedor_id===v.id&&o.estado_factura_propia==="emitida").forEach(o=>{
        const factsMes=(o.eventos_factura||[]).filter(ef=>{ const {anio,mes}=anioMesDe(ef.fecha); return anio===y&&mes===m; });
        if(!factsMes.length) return;
        const montoFacts=factsMes.reduce((ss,ef)=>ss+(ef.monto||0),0);
        const utilOC=(Number(o.monto_total)||0)-(Number(o.costo_total)||0);
        if(o.es_venta_propia){
          const ivaFactura=montoFacts-(montoFacts/1.19);
          pagoVentasPropias+=Math.max(0,Math.round(utilOC-ivaFactura));
        }else{
          sumaFacts+=montoFacts;
          sumaUtilidad+=utilOC;
        }
      });
      // Abril 2025 fue el único mes donde no se descontaba IVA — esa
      // regla empezó a aplicarse recién desde mayo 2025 en adelante.
      const sinIva=(y===2025&&m===4);
      const ivaMesV2=sinIva?null:ivaMensual.find(i=>i.mes===m&&i.anio===y); const impPagadoV2=ivaMesV2?Math.max(0,(ivaMesV2.iva_ventas||0)-(ivaMesV2.iva_compras||0)):0;
      const pagoCalculadoFormula=Math.max(0,Math.round(sumaUtilidad/2 - impPagadoV2/2))+pagoVentasPropias;
      const pagosDelMes=pagosVendedor.filter(p=>p.vendedor_id===v.id&&p.mes===m&&p.anio===y);
      const pagado=pagosDelMes.reduce((s,p)=>s+(p.monto_pagado||0),0);
      // Si el mes ya fue investigado y confirmado (contra la planilla
      // histórica o contra la cartola real), se usa ese monto verificado
      // en vez de recalcular en vivo — la fórmula genérica no puede
      // reconstruir casos como ventas propias sin OC o errores de la
      // planilla original que ya se investigaron a mano.
      const verificado=pagosDelMes.find(p=>p.monto_verificado!=null)?.monto_verificado;
      const esVerificado=verificado!=null;
      const pagoCalculado=esVerificado?verificado:pagoCalculadoFormula;
      const estado=pagado>=pagoCalculado?"pagado":"pendiente";
      return {mes:m,anio:y,label:fmt.monthYear(m,y),sumaFacts,sumaUtilidad,pagoVentasPropias,pagoCalculado,pagado,estado,esVerificado,deuda:Math.max(0,pagoCalculado-pagado)};
    });
  };

  const [verHistorialIva,setVerHistorialIva]=useState(false);
  const ivaOrdenado=useMemo(()=>ivaMensual.slice().sort((a,b)=>`${b.anio}-${String(b.mes).padStart(2,"0")}`.localeCompare(`${a.anio}-${String(a.mes).padStart(2,"0")}`)),[ivaMensual]);
  const [editandoIvaExistente,setEditandoIvaExistente]=useState(null); // null = nuevo mes actual, o el registro a editar

  return (
    <div>
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:16,marginBottom:16}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
          <div style={{fontWeight:800,fontSize:14,color:C.ink}}>IVA del mes ({fmt.monthYear(mesActual,anioActual)})</div>
          <button onClick={()=>{setEditandoIvaExistente(ivaMensual.find(i=>i.mes===mesActual&&i.anio===anioActual)||null);setEditIva(true);}} style={btnG}>{ivaMensual.find(i=>i.mes===mesActual&&i.anio===anioActual)?"Editar":"Registrar"}</button>
        </div>
        {ivaMensual.find(i=>i.mes===mesActual&&i.anio===anioActual)?
          <div style={{fontFamily:MONO,fontWeight:800,fontSize:18,color:C.info}}>{fmt.money(ivaMensual.find(i=>i.mes===mesActual&&i.anio===anioActual).iva_pagado)}</div>:
          <div style={{fontSize:12.5,color:C.inkFaint}}>Sin registrar.</div>
        }
        <div style={{display:"flex",gap:14,marginTop:10,paddingTop:10,borderTop:`1px solid ${C.border}`}}>
          <button onClick={()=>{setEditandoIvaExistente(null);setEditIva(true);}} style={{background:"none",border:"none",color:C.info,fontSize:11.5,fontWeight:700,cursor:"pointer",textDecoration:"underline",padding:0}}>+ Registrar IVA de otro mes</button>
          {ivaMensual.length>0&&<button onClick={()=>setVerHistorialIva(v=>!v)} style={{background:"none",border:"none",color:C.inkFaint,fontSize:11.5,fontWeight:700,cursor:"pointer",textDecoration:"underline",padding:0}}>{verHistorialIva?"Ocultar historial":`Ver historial (${ivaMensual.length})`}</button>}
        </div>
        {verHistorialIva&&(
          <div style={{marginTop:10}}>
            {ivaOrdenado.map(i=>(
              <button key={i.id} onClick={()=>{setEditandoIvaExistente(i);setEditIva(true);}}
                style={{width:"100%",background:"none",border:"none",padding:"7px 0",borderBottom:`1px solid ${C.border}`,
                  display:"flex",justifyContent:"space-between",cursor:"pointer",textAlign:"left"}}>
                <span style={{fontSize:12,color:C.ink,fontWeight:700}}>{fmt.monthYear(i.mes,i.anio)}</span>
                <span style={{fontFamily:MONO,fontSize:12,color:C.info,fontWeight:700}}>{fmt.money(i.iva_pagado)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {vendedores.map(v=>{
        const datos=datosVendedor(v);
        const ultimoPagado=datos.find(d=>d.estado==="pagado");
        const deudaTotal=datos.reduce((s,d)=>s+d.deuda,0);
        const meses=datos.filter(d=>(d.pagoCalculado||0)>0||d.pagado>0).length;
        const estaAbierto=abierto===v.id;
        return (
          <div key={v.id} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,marginBottom:10,overflow:"hidden"}}>
            <button onClick={()=>setAbierto(estaAbierto?null:v.id)}
              style={{width:"100%",background:"none",border:"none",padding:14,textAlign:"left",cursor:"pointer",
                display:"flex",alignItems:"center",gap:10}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontWeight:800,fontSize:14.5,color:C.ink}}>{v.nombre}</div>
                {deudaTotal>0
                  ? <div style={{fontSize:11.5,color:C.warn,fontWeight:700,marginTop:2}}>Falta pagarle {fmt.money(deudaTotal)}</div>
                  : meses>0
                    ? <div style={{fontSize:11.5,color:C.ok,fontWeight:700,marginTop:2}}>✓ Comisiones al día{ultimoPagado?` · último pago ${ultimoPagado.label}`:""}</div>
                    : <div style={{fontSize:11.5,color:C.inkFaint,marginTop:2}}>Sin ventas registradas</div>
                }
              </div>
              {meses>0&&<span style={{fontSize:10.5,color:C.inkFaint,flexShrink:0}}>{meses} mes{meses>1?"es":""}</span>}
              <span style={{fontSize:11,color:C.inkFaint,flexShrink:0}}>{estaAbierto?"▲":"▼"}</span>
            </button>

            {estaAbierto&&meses>0&&(
              <div style={{padding:"0 14px 14px"}}>
                <div style={{fontSize:11,fontWeight:800,color:C.inkMuted,textTransform:"uppercase",marginBottom:2,paddingTop:6,borderTop:`1px solid ${C.border}`}}>Comisión mes a mes</div>
                <div style={{fontSize:10,color:C.inkFaint,marginBottom:6}}>Solo se listan los meses con al menos una venta facturada — el resto no tuvo actividad.</div>
                {datos.map(d=>(
                  <div key={d.label} style={{padding:"9px 0",borderBottom:`1px solid ${C.border}`}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:3}}>
                      <span style={{fontSize:12.5,fontWeight:700,color:C.ink}}>{d.label}</span>
                      <span style={{fontSize:12.5,fontWeight:800,color:d.estado==="pagado"?C.ok:C.warn}}>
                        {d.estado==="pagado"?"✓ Comisión pagada":"Comisión pendiente"}
                      </span>
                    </div>
                    <div style={{fontSize:11,color:C.inkFaint,marginBottom:3}}>
                      {d.esVerificado
                        ? <>Comisión del mes: <b style={{color:C.ink}}>{fmt.money(d.pagoCalculado)}</b> <span style={{color:C.ok}}>✓ verificado contra planilla histórica / cartola real</span></>
                        : <>Comisión del mes: <b style={{color:C.ink}}>{fmt.money(d.pagoCalculado)}</b> (mitad de la utilidad, {fmt.money(d.sumaUtilidad)}, de {fmt.money(d.sumaFacts)} facturados{d.pagoVentasPropias>0?` · + ${fmt.money(d.pagoVentasPropias)} de ventas propias`:""})</>
                      }
                    </div>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline"}}>
                      <span style={{fontSize:11,color:C.inkMuted}}>Ya se le pagó: {fmt.money(d.pagado)}</span>
                      {d.deuda>0&&<span style={{fontSize:11.5,fontWeight:700,color:C.danger}}>Falta pagarle: {fmt.money(d.deuda)}</span>}
                    </div>
                    {!d.esVerificado&&d.pagado>d.pagoCalculado+1000&&(
                      <div style={{fontSize:10.5,color:C.warn,marginTop:3,lineHeight:1.4}}>
                        ⚠ Se pagó {fmt.money(d.pagado-d.pagoCalculado)} más de lo que calcula la fórmula automática — probablemente venta propia o extra no marcado en el sistema. Revisa la nota del pago para el detalle.
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

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
