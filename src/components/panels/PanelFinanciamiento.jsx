import { useState } from "react";
import { Field, Modal, Trazabilidad } from "../ui/Basicos";
import { C, MONO, btnP, fmt, iMono, iStyle } from "../../lib/theme";
import { Ic, I } from "../ui/Iconos";
import { Seccion, Tarjeta, Badge, Monto } from "../ui/Sistema";

function FormAporte({ aporte, socios, onSave, onEliminar }) {
  const [socio,setSocio]=useState(aporte?.socio&&aporte.socio!=="Por asignar"?aporte.socio:"");
  const [tipo,setTipo]=useState(aporte?.tipo||"aporte");
  const [monto,setMonto]=useState(aporte?.monto??"");
  const [fecha,setFecha]=useState(aporte?.fecha?String(aporte.fecha).slice(0,10):new Date().toISOString().slice(0,10));
  const [medio,setMedio]=useState(aporte?.medio||"");
  const [notas,setNotas]=useState(aporte?.notas||"");
  const [err,setErr]=useState(""); const [saving,setSaving]=useState(false);
  const guardar=async()=>{
    if(!socio.trim()){setErr("Indica el socio");return;}
    if(!monto||Number(monto)<=0){setErr("Indica el monto");return;}
    setErr("");setSaving(true);
    try{ await onSave({id:aporte?.id,socio:socio.trim(),tipo,monto:Number(monto),fecha,medio:medio.trim(),notas:notas.trim()}); }
    catch(e){setErr(e.message);setSaving(false);}
  };
  return (
    <div>
      <Field label="Socio" required hint="Elige uno o escribe un nombre nuevo">
        <input style={iStyle} list="lista-socios" value={socio} onChange={e=>setSocio(e.target.value)} placeholder="ej: Kevin Vergara" />
        <datalist id="lista-socios">
          {(socios||[]).map(n=><option key={n} value={n} />)}
        </datalist>
      </Field>
      <Field label="Tipo">
        <div style={{display:"flex",gap:8}}>
          <button onClick={()=>setTipo("aporte")} style={{flex:1,padding:"9px",borderRadius:9,cursor:"pointer",fontWeight:700,fontSize:12.5,
            border:`1.5px solid ${tipo==="aporte"?C.ok:C.border}`,background:tipo==="aporte"?C.okLight:C.card,color:tipo==="aporte"?C.ok:C.inkMuted}}>+ Aporte</button>
          <button onClick={()=>setTipo("retiro")} style={{flex:1,padding:"9px",borderRadius:9,cursor:"pointer",fontWeight:700,fontSize:12.5,
            border:`1.5px solid ${tipo==="retiro"?C.danger:C.border}`,background:tipo==="retiro"?C.dangerLight:C.card,color:tipo==="retiro"?C.danger:C.inkMuted}}>− Retiro</button>
        </div>
      </Field>
      <Field label="Monto ($)" required><input style={iMono} type="number" value={monto} onChange={e=>setMonto(e.target.value)} /></Field>
      <Field label="Fecha" required><input style={iStyle} type="date" value={fecha} onChange={e=>setFecha(e.target.value)} /></Field>
      <Field label="Medio" hint="Opcional"><input style={iStyle} value={medio} onChange={e=>setMedio(e.target.value)} placeholder="transferencia, efectivo…" /></Field>
      <Field label="Notas" hint="Opcional"><input style={iStyle} value={notas} onChange={e=>setNotas(e.target.value)} /></Field>
      {err&&<div style={{background:C.dangerLight,color:C.dangerText,borderRadius:8,padding:"8px 12px",fontSize:12.5,marginBottom:10,fontWeight:600}}>{err}</div>}
      <button onClick={guardar} disabled={saving} style={btnP(saving?C.inkFaint:tipo==="retiro"?C.danger:C.ok)}>
        {saving?"Guardando…":aporte?"✓ Guardar cambios":tipo==="retiro"?"✓ Registrar retiro":"✓ Registrar aporte"}
      </button>
      {aporte&&onEliminar&&(
        <button onClick={async()=>{ if(window.confirm("¿Eliminar este movimiento?")) await onEliminar(aporte.id); }}
          style={{width:"100%",background:"none",border:`1px solid ${C.danger}`,color:C.dangerText,borderRadius:9,padding:"8px 12px",fontSize:12,fontWeight:600,cursor:"pointer",marginTop:8}}>
          <Ic n="🗑"/> Eliminar movimiento
        </button>
      )}
    </div>
  );
}

export function PanelFinanciamiento({ financiadores, ocs, ajustes, perfiles, onAjustar, aportes, onGuardarAporte, onEliminarAporte, onAbonar, pagoFinSueltos }) {
  const [nuevoAporte,setNuevoAporte]=useState(false);
  const [editAporte,setEditAporte]=useState(null);
  const [selFin,setSelFin]=useState(null);
  const [verSinDeuda,setVerSinDeuda]=useState(false);
  const [ajustando,setAjustando]=useState(null);
  const [verSolo,setVerSolo]=useState(null);

  const cartola=(finId)=>{
    const compras=(ocs||[]).filter(o=>o.financiador_id===finId&&(o.eventos_compra||[]).length>0).map(o=>{
      const primerEvento=(o.eventos_compra||[]).slice().sort((a,b)=>new Date(a.fecha)-new Date(b.fecha))[0];
      // El monto sale de costo_total (lo mismo que usa el saldo de deuda),
      // no de sumar los eventos — así nunca pueden desalinearse si alguien
      // corrige el costo desde "Editar datos" sin tocar el evento original.
      return {tipo:"compra", fecha:primerEvento.fecha, oc:o.numero_oc, monto:o.costo_total||0, categoria:"Compra", creadoEn:primerEvento.creadoEn, creadoPor:primerEvento.creado_por};
    });
    const pagos=(ocs||[]).flatMap(o=>(o.eventos_pago_financiamiento||[]).filter(e=>{
      return e.financiador_id===finId;
    }).map(e=>({tipo:"pago",fecha:e.fecha,oc:o.numero_oc||"—",monto:-(e.monto||0),categoria:"Pago",creadoEn:e.creadoEn,creadoPor:e.creado_por})));
    // Pagos a financiadores que no están ligados a una OC (oc_id vacío).
    const sueltos=(pagoFinSueltos||[]).filter(e=>e.financiador_id===finId).map(e=>({
      tipo:"pago",fecha:e.fecha,oc:"—",monto:-(e.monto||0),categoria:"Pago",detalle:"Pago sin OC asignada",sinOC:true,creadoEn:e.creadoEn,creadoPor:e.creado_por}));
    const ajustesF=(ajustes||[]).filter(a=>a.financiador_id===finId).map(a=>({
      tipo:"ajuste",fecha:a.fecha,oc:"—",monto:a.monto_ajuste||0,categoria:"Otro",detalle:a.motivo,creadoEn:a.creadoEn,creadoPor:a.creado_por,
    }));
    return [...compras,...pagos,...sueltos,...ajustesF].sort((a,b)=>b.fecha>a.fecha?1:-1);
  };

  if(selFin) {
    const fin=financiadores.find(f=>f.id===selFin);
    const movs=cartola(selFin);
    return (
      <div>
        <button onClick={()=>setSelFin(null)} style={{background:"none",border:"none",color:C.tealDark,fontWeight:700,fontSize:13,cursor:"pointer",marginBottom:12,padding:0}}>← Volver</button>
        <div style={{background:`linear-gradient(135deg,${C.night},${C.nightSoft})`,borderRadius:16,padding:"18px 20px",marginBottom:16}}>
          <div style={{fontSize:12,color:C.inkOnDark,marginBottom:4}}>{fin?.nombre}</div>
          <div style={{fontFamily:MONO,fontWeight:800,fontSize:30,color:C.danger,letterSpacing:-1}}>{fmt.money(fin?.saldo_deuda)}</div>
          <div style={{fontSize:12,color:C.inkOnDark,marginTop:4}}>Deuda actual</div>
        </div>
        <button onClick={()=>setAjustando(fin)} style={{...btnP(C.nightSoft),marginBottom:16}}>Ajustar saldo manualmente</button>

        {(()=>{
          const compras=movs.filter(m=>m.tipo==="compra");
          const pagos=movs.filter(m=>m.tipo==="pago");
          const totalCompras=compras.reduce((s,m)=>s+m.monto,0);
          const totalPagos=pagos.reduce((s,m)=>s-m.monto,0); // los pagos se guardan en negativo
          return (
            <div style={{display:"flex",gap:8,marginBottom:16}}>
              <button onClick={()=>setVerSolo(v=>v==="compra"?null:"compra")}
                style={{flex:1,textAlign:"left",cursor:"pointer",background:verSolo==="compra"?C.infoLight:C.card,
                  border:`1.5px solid ${verSolo==="compra"?C.info:C.border}`,borderRadius:12,padding:"11px 13px"}}>
                <div style={{fontSize:12,fontWeight:800,color:C.inkFaint,textTransform:"uppercase",marginBottom:4}}>Compras realizadas</div>
                <div style={{fontFamily:MONO,fontWeight:800,fontSize:16,color:C.ink}}>{fmt.money(totalCompras)}</div>
                <div style={{fontSize:12,color:C.inkMuted,marginTop:2}}>{compras.length} compra{compras.length!==1?"s":""} · toca para ver{verSolo==="compra"?" (viendo)":""}</div>
              </button>
              <button onClick={()=>setVerSolo(v=>v==="pago"?null:"pago")}
                style={{flex:1,textAlign:"left",cursor:"pointer",background:verSolo==="pago"?C.okLight:C.card,
                  border:`1.5px solid ${verSolo==="pago"?C.ok:C.border}`,borderRadius:12,padding:"11px 13px"}}>
                <div style={{fontSize:12,fontWeight:800,color:C.inkFaint,textTransform:"uppercase",marginBottom:4}}>Abonos realizados</div>
                <div style={{fontFamily:MONO,fontWeight:800,fontSize:16,color:C.ok}}>{fmt.money(totalPagos)}</div>
                <div style={{fontSize:12,color:C.inkMuted,marginTop:2}}>{pagos.length} abono{pagos.length!==1?"s":""} · toca para ver{verSolo==="pago"?" (viendo)":""}</div>
              </button>
            </div>
          );
        })()}

        <div style={{fontSize:12,fontWeight:800,color:C.inkMuted,marginBottom:8,textTransform:"uppercase"}}>
          {verSolo==="compra"?`Solo compras (${movs.filter(m=>m.tipo==="compra").length})`:verSolo==="pago"?`Solo abonos (${movs.filter(m=>m.tipo==="pago").length})`:"Cartola de movimientos"}
          {verSolo&&<button onClick={()=>setVerSolo(null)} style={{marginLeft:8,background:"none",border:"none",color:C.tealDark,fontSize:12,fontWeight:700,cursor:"pointer",textTransform:"none"}}>ver todo</button>}
        </div>
        {(verSolo?movs.filter(m=>m.tipo===verSolo):movs).length===0&&<div style={{textAlign:"center",padding:20,color:C.inkFaint,fontSize:13}}>Sin movimientos registrados.</div>}
        {(verSolo?movs.filter(m=>m.tipo===verSolo):movs).length>0&&(
          <div style={{overflowX:"auto",overflowY:"auto",maxHeight:440,border:`1px solid ${C.border}`,borderRadius:12,marginBottom:16}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <thead>
                <tr style={{background:C.nightSoft}}>
                  <th style={{position:"sticky",top:0,zIndex:1,background:C.nightSoft,textAlign:"left",padding:"8px 10px",color:C.inkOnDark,fontWeight:800,fontSize:12,textTransform:"uppercase",whiteSpace:"nowrap"}}>Fecha</th>
                  <th style={{position:"sticky",top:0,zIndex:1,background:C.nightSoft,textAlign:"left",padding:"8px 10px",color:C.inkOnDark,fontWeight:800,fontSize:12,textTransform:"uppercase"}}>Tipo</th>
                  <th style={{position:"sticky",top:0,zIndex:1,background:C.nightSoft,textAlign:"left",padding:"8px 10px",color:C.inkOnDark,fontWeight:800,fontSize:12,textTransform:"uppercase"}}>OC / Detalle</th>
                  <th style={{position:"sticky",top:0,zIndex:1,background:C.nightSoft,textAlign:"left",padding:"8px 10px",color:C.inkOnDark,fontWeight:800,fontSize:12,textTransform:"uppercase",whiteSpace:"nowrap"}}>Registrado por</th>
                  <th style={{position:"sticky",top:0,zIndex:1,background:C.nightSoft,textAlign:"right",padding:"8px 10px",color:C.inkOnDark,fontWeight:800,fontSize:12,textTransform:"uppercase",whiteSpace:"nowrap"}}>Monto</th>
                </tr>
              </thead>
              <tbody>
                {(verSolo?movs.filter(m=>m.tipo===verSolo):movs).map((m,i)=>{
                  const nombreQuien=perfiles?.find(p=>p.id===m.creadoPor)?.nombre||"Ajuste de validación";
                  return (
                    <tr key={i} style={{borderTop:`1px solid ${C.border}`,background:i%2?C.card:"transparent"}}>
                      <td style={{padding:"7px 10px",color:C.inkMuted,whiteSpace:"nowrap"}}>{fmt.date(m.fecha)}</td>
                      <td style={{padding:"7px 10px",color:C.ink,fontWeight:700}}>{m.categoria}</td>
                      <td style={{padding:"7px 10px",color:C.inkMuted}}>{m.oc!=="—"?m.oc:(m.detalle||"—")}{m.sinOC&&<span style={{marginLeft:6,background:C.warnLight,color:C.warn,borderRadius:10,padding:"1px 7px",fontSize:12,fontWeight:700,whiteSpace:"nowrap"}}>Sin OC</span>}</td>
                      <td style={{padding:"7px 10px",color:C.inkOnDark,whiteSpace:"nowrap"}}>{nombreQuien}</td>
                      <td style={{padding:"7px 10px",textAlign:"right",fontFamily:MONO,fontWeight:800,whiteSpace:"nowrap",color:m.monto>=0?C.danger:C.ok}}>
                        {m.monto>=0?"+":""}{fmt.money(m.monto)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{borderTop:`2px solid ${C.border}`,background:C.nightSoft}}>
                  <td colSpan={4} style={{padding:"8px 10px",fontWeight:800,color:C.ink,fontSize:12}}>Total {verSolo==="compra"?"compras":verSolo==="pago"?"abonos":"neto"}</td>
                  <td style={{padding:"8px 10px",textAlign:"right",fontFamily:MONO,fontWeight:800,fontSize:13,color:C.ink,whiteSpace:"nowrap"}}>
                    {fmt.money((verSolo?movs.filter(m=>m.tipo===verSolo):movs).reduce((s,m)=>s+m.monto,0))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        {ajustando&&(
          <Modal title={`Ajustar saldo · ${ajustando.nombre}`} onClose={()=>setAjustando(null)}>
            <FormAjusteSaldo financiador={ajustando} onSave={async(data)=>{await onAjustar(data);setAjustando(null);}} />
          </Modal>
        )}
      </div>
    );
  }

  return (
    <div>
      <button onClick={onAbonar} style={{...btnP(C.teal),marginBottom:20}}><Ic n="💸"/> Abonar a un financiador</button>

      {/* ── 1. Deuda a financiadores ── */}
      <Seccion titulo="Deuda a financiadores" nota="Toca un financiador para ver su cartola de movimientos.">
      {(()=>{
        const conDeuda=financiadores.filter(f=>Number(f.saldo_deuda)!==0);
        const enCero=financiadores.filter(f=>Number(f.saldo_deuda)===0);
        return (<>
      {conDeuda.length===0&&<Tarjeta><span style={{fontSize:14,color:C.okText,fontWeight:700}}>✓ Sin deuda con financiadores</span></Tarjeta>}
      {conDeuda.map(f=>(
        <Tarjeta key={f.id} onClick={()=>setSelFin(f.id)} padding="14px 16px">
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10}}>
            <div style={{minWidth:0}}>
              <div style={{fontWeight:800,fontSize:15,color:C.ink,lineHeight:1.25}}>{f.nombre}</div>
              <div style={{marginTop:6}}><Badge tono="neutro">Ver cartola <Ic n="chevR"/></Badge></div>
            </div>
            <div style={{textAlign:"right",flexShrink:0}}>
              <div style={{fontSize:12,color:C.inkMuted,marginBottom:2}}>Deuda actual</div>
              <Monto tam="lg" tono={Number(f.saldo_deuda)>0?"danger":"ok"}>{fmt.money(f.saldo_deuda)}</Monto>
            </div>
          </div>
        </Tarjeta>
      ))}
      {enCero.length>0&&(
        <div style={{marginTop:4,marginBottom:6}}>
          <button type="button" onClick={()=>setVerSinDeuda(v=>!v)} aria-expanded={verSinDeuda}
            style={{display:"block",width:"100%",textAlign:"left",background:"none",border:"none",fontSize:12,color:C.inkMuted,cursor:"pointer",padding:"10px 2px",minHeight:36,font:"inherit",fontSize:12}}>
            {verSinDeuda?"− Ocultar":"+"} {enCero.length} financiador{enCero.length>1?"es":""} sin deuda
          </button>
          {verSinDeuda&&enCero.map(f=>(
            <Tarjeta key={f.id} onClick={()=>setSelFin(f.id)} padding="11px 14px" style={{background:C.paper,marginBottom:6}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10}}>
                <span style={{fontWeight:600,fontSize:14,color:C.inkMuted,minWidth:0,overflowWrap:"anywhere"}}>{f.nombre}</span>
                <Monto tam="sm" tono="ok">{fmt.money(f.saldo_deuda)}</Monto>
              </div>
            </Tarjeta>
          ))}
        </div>
      )}
        </>);
      })()}
      </Seccion>

      {/* ── 2. Aportes de socios ── */}
      <div style={{display:"flow-root",clear:"both",position:"relative",marginTop:24}}>
      <Seccion titulo="Aportes de socios"
        nota="Capital que entra o sale de la empresa. Suma a la caja pero no cuenta como venta ni utilidad."
        accion={<button onClick={()=>setNuevoAporte(true)} style={{fontSize:13,background:C.okLight,color:"#047857",border:"none",borderRadius:10,minHeight:36,padding:"6px 12px",fontWeight:700,cursor:"pointer"}}>+ Registrar</button>}>
        {(()=>{
          const lista=aportes||[];
          if(!lista.length) return <div style={{fontSize:13,color:C.inkMuted,padding:"6px 2px"}}>Sin aportes registrados</div>;
          const porSocio={};
          for(const a of lista){
            const m=a.tipo==="retiro"?-(Number(a.monto)||0):(Number(a.monto)||0);
            porSocio[a.socio]=(porSocio[a.socio]||0)+m;
          }
          const total=Object.values(porSocio).reduce((s,v)=>s+v,0);
          return (
            <Tarjeta padding="6px 16px 12px">
              {Object.entries(porSocio).sort((a,b)=>b[1]-a[1]).map(([soc,m])=>(
                <div key={soc} style={{display:"flex",justifyContent:"space-between",alignItems:"center",minHeight:44,borderBottom:`1px solid ${C.border}`}}>
                  <span style={{fontSize:14,color:soc==="Por asignar"?"#B45309":C.ink,fontWeight:600}}>
                    {soc==="Por asignar"?<I t={"⚠ Por asignar"}/>:soc}
                  </span>
                  <Monto tam="sm" tono={m>=0?"ok":"danger"}>{fmt.money(m)}</Monto>
                </div>
              ))}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",paddingTop:12}}>
                <span style={{fontSize:14,fontWeight:800,color:C.ink}}>Total en caja</span>
                <Monto tam="md" tono="ok">{fmt.money(total)}</Monto>
              </div>
            </Tarjeta>
          );
        })()}
      </Seccion>
      </div>

      {/* ── 3. Movimientos de socios ── */}
      {(aportes||[]).length>0&&(
      <Seccion titulo="Movimientos" nota="Toca un movimiento para editarlo.">
        {(aportes||[]).map(a=>(
          <button key={a.id} onClick={()=>setEditAporte(a)}
            style={{width:"100%",textAlign:"left",background:a.socio==="Por asignar"?C.warnLight:C.card,
              border:`1px solid ${a.socio==="Por asignar"?C.warn:C.border}`,
              borderRadius:12,padding:"10px 14px",marginBottom:6,cursor:"pointer",minHeight:52,
              display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}>
            <span style={{minWidth:0}}>
              <span style={{display:"block",fontSize:14,fontWeight:600,color:C.ink}}>{a.socio}{a.medio?` · ${a.medio}`:""}</span>
              <span style={{display:"block",fontSize:12,color:C.inkMuted}}>{fmt.date(String(a.fecha).slice(0,10))}{a.notas?` · ${a.notas.slice(0,50)}`:""}</span>
            </span>
            <span style={{display:"flex",alignItems:"center",gap:4,flexShrink:0}}>
              <Monto tam="sm" tono={a.tipo==="retiro"?"danger":"ok"}>{a.tipo==="retiro"?"−":"+"}{fmt.money(a.monto)}</Monto>
              <Ic n="chevR"/>
            </span>
          </button>
        ))}
      </Seccion>
      )}

      {(()=>{
        const socios=Array.from(new Set([
          ...(aportes||[]).map(a=>a.socio).filter(n=>n&&n!=="Por asignar"),
          ...(financiadores||[]).map(f=>f.nombre),
        ])).sort();
        return (<>
          {nuevoAporte&&(
            <Modal title="Aporte o retiro de socio" onClose={()=>setNuevoAporte(false)}>
              <FormAporte socios={socios} onSave={async(d)=>{ await onGuardarAporte(d); setNuevoAporte(false); }} />
            </Modal>
          )}
          {editAporte&&(
            <Modal title="Editar movimiento" onClose={()=>setEditAporte(null)}>
              <FormAporte aporte={editAporte} socios={socios}
                onSave={async(d)=>{ await onGuardarAporte(d); setEditAporte(null); }}
                onEliminar={onEliminarAporte?async(id)=>{ await onEliminarAporte(id); setEditAporte(null); }:undefined} />
            </Modal>
          )}
        </>);
      })()}
    </div>
  );
}

export function FormAjusteSaldo({ financiador, onSave }) {
  const [monto,setMonto]=useState(""); const [tipo,setTipo]=useState("sumar");
  const [motivo,setMotivo]=useState(""); const [fecha,setFecha]=useState(new Date().toISOString().slice(0,10));
  const [err,setErr]=useState(""); const [saving,setSaving]=useState(false);
  const handleSave=async()=>{
    if(!monto||Number(monto)<=0){setErr("Indica un monto");return;}
    if(!motivo.trim()){setErr("Indica el motivo");return;}
    setErr(""); setSaving(true);
    const montoFinal=tipo==="sumar"?Number(monto):-Number(monto);
    try{await onSave({financiadorId:financiador.id,fecha,montoAjuste:montoFinal,motivo:motivo.trim()});}
    catch(e){setErr(e.message);}finally{setSaving(false);}
  };
  return (
    <div>
      <div style={{background:C.paper,borderRadius:8,padding:"8px 12px",fontSize:12.5,color:C.inkMuted,marginBottom:14}}>
        Saldo actual <b style={{color:C.ink}}>{financiador.nombre}</b>: <b style={{color:C.dangerText}}>{fmt.money(financiador.saldo_deuda)}</b>
      </div>
      <Field label="Tipo de ajuste">
        <div style={{display:"flex",gap:8}}>
          <button onClick={()=>setTipo("sumar")} style={{flex:1,padding:"9px",borderRadius:9,border:`1.5px solid ${tipo==="sumar"?C.danger:C.border}`,background:tipo==="sumar"?C.dangerLight:C.card,color:tipo==="sumar"?C.danger:C.inkMuted,fontWeight:700,fontSize:12.5,cursor:"pointer"}}>+ Aumentar deuda</button>
          <button onClick={()=>setTipo("restar")} style={{flex:1,padding:"9px",borderRadius:9,border:`1.5px solid ${tipo==="restar"?C.ok:C.border}`,background:tipo==="restar"?C.okLight:C.card,color:tipo==="restar"?C.ok:C.inkMuted,fontWeight:700,fontSize:12.5,cursor:"pointer"}}>− Reducir deuda</button>
        </div>
      </Field>
      <Field label="Monto ($)" required><input style={iMono} type="number" value={monto} onChange={e=>setMonto(e.target.value)} /></Field>
      <Field label="Fecha" required><input style={iStyle} type="date" value={fecha} onChange={e=>setFecha(e.target.value)} /></Field>
      <Field label="Motivo" required hint="Queda registrado en el historial de auditoría"><input style={iStyle} value={motivo} onChange={e=>setMotivo(e.target.value)} placeholder="ej: corrección de saldo histórico" /></Field>
      {err&&<div style={{background:C.dangerLight,color:C.dangerText,borderRadius:8,padding:"8px 12px",fontSize:12.5,marginBottom:10,fontWeight:600}}>{err}</div>}
      <button onClick={handleSave} disabled={saving} style={btnP(saving?C.inkFaint:C.purple)}>{saving?"Guardando…":"✓ Aplicar ajuste"}</button>
    </div>
  );
}
