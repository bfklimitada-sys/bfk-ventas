import { useState, useMemo } from "react";
import { PanelDatos } from "./PanelDatos";
import { C, btnP, fmt, iStyle } from "../../lib/theme";
import { Ic } from "../ui/Iconos";
import { Seccion, Tarjeta, Badge, BotonAdmin, IndiceSecciones } from "../ui/Sistema";
import { ImportarEntidades } from "../forms/ImportarEntidades";

export function PanelUsuarios({ perfiles, ocs, ocsArchivadas, onRestaurarOC, onChangeRol, session, showToast, entidadesCatalogo, onEntidadesImportadas, usoMP, sincronizando, validandoTodo, exportando, onCorregirFechas, onValidarTodo, onExportarTodo }) {
  const [showImport,setShowImport]=useState(false);
  const [filtroArch,setFiltroArch]=useState("");
  const [archAbierta,setArchAbierta]=useState(null);
  const [restaurando,setRestaurando]=useState(null);
  const archivadasFiltradas=useMemo(()=>{
    const q=filtroArch.trim().toLowerCase();
    const lista=[...(ocsArchivadas||[])].sort((a,b)=>String(b.archivada_en||"").localeCompare(String(a.archivada_en||"")));
    if(!q) return lista;
    return lista.filter(o=>[o.numero_oc,o.cliente,o.rut_cliente,o.archivo_motivo,o.archivada_por_nombre].some(v=>String(v||"").toLowerCase().includes(q)));
  },[ocsArchivadas,filtroArch]);
  const ultimaActividad = useMemo(() => {
    const map = {};
    for (const oc of ocs) {
      const todos = [
        ...(oc.eventos_compra||[]), ...(oc.eventos_entrega||[]), ...(oc.eventos_factura||[]),
        ...(oc.eventos_pago_cliente||[]), ...(oc.eventos_pago_financiamiento||[]),
      ];
      for (const e of todos) {
        if (!e.creado_por || !e.creadoEn) continue;
        if (!map[e.creado_por] || e.creadoEn > map[e.creado_por]) map[e.creado_por] = e.creadoEn;
      }
    }
    return map;
  }, [ocs]);

  return (
    <div>
      <IndiceSecciones items={[
        {id:"adm-usuarios",label:"Usuarios"},
        {id:"adm-datos",label:"Datos y respaldo"},
        {id:"adm-mp",label:"Mercado Público"},
        {id:"adm-archivadas",label:"OCs archivadas",n:(ocsArchivadas||[]).length},
      ]} />
      {/* ── 1. Usuarios y permisos ── */}
      <Seccion id="adm-usuarios" titulo="Usuarios y permisos">
      {perfiles.map(p=>{
        const ultima=ultimaActividad[p.id];
        const diasInactivo = ultima ? Math.floor((new Date()-new Date(ultima))/(1000*60*60*24)) : null;
        const activo = diasInactivo!==null && diasInactivo<=14;
        return (
          <Tarjeta key={p.id}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10}}>
              <div style={{minWidth:0}}>
                <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                  <span style={{width:8,height:8,borderRadius:"50%",background:activo?C.ok:C.inkFaint,display:"inline-block",flexShrink:0}} />
                  <span style={{fontWeight:700,fontSize:15,color:C.ink}}>{p.nombre}</span>
                  <Badge tono={p.rol==="admin"?"info":"neutro"}>{p.rol==="admin"?"Administrador":"Usuario"}</Badge>
                </div>
                <div style={{fontSize:12,color:C.inkMuted,marginTop:4}}>{ultima?`Última actividad: ${fmt.datetime(ultima)}`:"Sin actividad registrada"}</div>
              </div>
              <BotonAdmin peligro={p.rol==="admin"} onClick={()=>onChangeRol(p.id,p.rol==="admin"?"usuario":"admin")} style={{flexShrink:0,padding:"8px 12px",fontSize:13}}>{p.rol==="admin"?"Quitar admin":"Hacer admin"}</BotonAdmin>
            </div>
          </Tarjeta>
        );
      })}
      </Seccion>

      {/* ── 2. Datos y respaldo ── */}
      <Seccion id="adm-datos" titulo="Datos y respaldo" nota="Acciones administrativas: tienen más alcance que el trabajo diario.">
        <Tarjeta>
          <div style={{fontSize:12,color:C.inkMuted,lineHeight:1.5}}>
            Se hace un respaldo cifrado de la base de datos todos los días, automáticamente, con una prueba de restauración. El estado se revisa en el repositorio de respaldos (GitHub → Actions). Para descargar toda la base en Excel, usa la tarjeta siguiente.
          </div>
        </Tarjeta>

        <PanelDatos session={session} showToast={showToast} />

        <Tarjeta>
          <div style={{fontSize:14,fontWeight:700,color:C.ink,marginBottom:2}}><Ic n="🏢"/> Catálogo de entidades</div>
          <div style={{fontSize:12,color:C.inkMuted,marginBottom:10}}>
            {(entidadesCatalogo||[]).length} entidades guardadas · Se autocompletan al escribir el RUT en cualquier OC
          </div>
          {!showImport?(
            <BotonAdmin onClick={()=>setShowImport(true)} style={{width:"100%"}}>⬆ Importar entidades (CSV o Excel .xlsx)</BotonAdmin>
          ):(
            <ImportarEntidades session={session} onTerminado={onEntidadesImportadas} onCancelar={()=>setShowImport(false)} />
          )}
        </Tarjeta>
      </Seccion>

      {/* ── 3. Mercado Público ── */}
      <Seccion id="adm-mp" titulo="Mercado Público" nota="Mantenimiento masivo. Consulta muchas órdenes a la vez; úsalo solo cuando haga falta.">
        <Tarjeta>
          {usoMP&&(
            <div style={{fontSize:12,color:C.inkMuted,marginBottom:10}}>Consultas de hoy: <b style={{color:C.ink}}>{(usoMP.solicitudes||0).toLocaleString("es-CL")}</b> de 10.000</div>
          )}
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {onValidarTodo&&(
              <BotonAdmin onClick={()=>onValidarTodo()} disabled={!!validandoTodo}>
                {validandoTodo?`Validando ${validandoTodo.hechas} de ${validandoTodo.total}…`:"Validar todas mis OC contra Mercado Público"}
              </BotonAdmin>
            )}
            {onCorregirFechas&&(
              <BotonAdmin onClick={()=>onCorregirFechas()} disabled={!!sincronizando}>
                {sincronizando?`Revisando ${sincronizando.hechas} de ${sincronizando.total}…`:"Corregir fechas de todas contra Mercado Público"}
              </BotonAdmin>
            )}
          </div>
        </Tarjeta>
      </Seccion>

      {/* ── 4. OCs archivadas ── */}
      <Seccion id="adm-archivadas" titulo="OCs archivadas" nota="Ocultas de la operación diaria, con todos sus datos intactos. Se pueden consultar y restaurar.">
        <Tarjeta>
          <div style={{fontSize:12,color:C.inkMuted,marginBottom:8}}>{(ocsArchivadas||[]).length===0?"No hay OCs archivadas.":`${(ocsArchivadas||[]).length} OC${(ocsArchivadas||[]).length>1?"s":""} archivada${(ocsArchivadas||[]).length>1?"s":""}`}</div>
          {(ocsArchivadas||[]).length>0&&(
            <input value={filtroArch} onChange={e=>setFiltroArch(e.target.value)} placeholder="Buscar por N° OC, cliente, RUT o motivo" aria-label="Buscar OCs archivadas"
              style={{...iStyle,marginBottom:8}} />
          )}
          {archivadasFiltradas.map(o=>{
            const abierta=archAbierta===o.id;
            const n=k=>(o[k]||[]).length;
            return (
              <div key={o.id} data-oc-archivada={o.numero_oc} style={{borderTop:`1px solid ${C.border}`,padding:"10px 0"}}>
                <button type="button" onClick={()=>setArchAbierta(abierta?null:o.id)} style={{background:"none",border:"none",padding:0,width:"100%",textAlign:"left",cursor:"pointer",font:"inherit",color:"inherit"}}>
                  <div style={{display:"flex",justifyContent:"space-between",gap:8,alignItems:"baseline"}}>
                    <span style={{fontWeight:700,color:C.ink,fontSize:14}}>{o.numero_oc}</span>
                    <span style={{fontSize:13,color:C.ink}}>{fmt.money(o.monto_total)}</span>
                  </div>
                  <div style={{fontSize:12,color:C.inkMuted}}>{o.cliente||"—"}</div>
                  <div style={{fontSize:12,color:C.inkFaint,marginTop:2}}>Archivada {o.archivada_en?fmt.datetime(o.archivada_en):""}{o.archivada_por_nombre?` por ${o.archivada_por_nombre}`:""}{o.archivo_motivo?` · ${o.archivo_motivo}`:""}</div>
                </button>
                {abierta&&(
                  <div style={{marginTop:8,fontSize:12,color:C.inkMuted,lineHeight:1.6}}>
                    <div>RUT cliente: <b style={{color:C.ink}}>{o.rut_cliente||"—"}</b></div>
                    <div>Emisión: <b style={{color:C.ink}}>{fmt.date(String(o.fecha_emision_mp||"").slice(0,10)||null)}</b> · Facturado: <b style={{color:C.ink}}>{fmt.money(o.monto_facturado||0)}</b> · Cobrado: <b style={{color:C.ink}}>{fmt.money(o.monto_cobrado||0)}</b></div>
                    <div>Registros conservados: {n("eventos_compra")} compras · {n("eventos_entrega")} entregas · {n("eventos_factura")} facturas · {n("eventos_pago_cliente")} pagos cliente · {n("eventos_pago_financiamiento")} pagos financiamiento · {n("eventos_postventa")} postventa · {n("oc_reclamos")} reclamos</div>
                    <BotonAdmin disabled={restaurando===o.id} onClick={async()=>{
                      if(!window.confirm(`¿Restaurar la OC ${o.numero_oc}? Volverá a la operación normal con todos sus datos.`)) return;
                      setRestaurando(o.id); try{ await onRestaurarOC(o.id); } finally { setRestaurando(null); setArchAbierta(null); }
                    }} style={{width:"100%",marginTop:8}}>{restaurando===o.id?"Restaurando…":"Restaurar esta OC"}</BotonAdmin>
                  </div>
                )}
              </div>
            );
          })}
        </Tarjeta>
      </Seccion>
    </div>
  );
}
