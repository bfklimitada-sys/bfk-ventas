import { useState, useMemo } from "react";
import { PanelDatos } from "./PanelDatos";
import { C, btnG, btnP, fmt } from "../../lib/theme";

export function PanelUsuarios({ perfiles, ocs, onChangeRol, session, showToast, entidadesCatalogo, onImportarEntidades }) {
  const [showImport,setShowImport]=useState(false);
  const [importFile,setImportFile]=useState(null);
  const [importMsg,setImportMsg]=useState("");

  const handleImport=async()=>{
    if(!importFile){setImportMsg("Selecciona un archivo primero");return;}
    setImportMsg("Procesando…");
    try {
      const text=await importFile.text();
      const lines=text.split('\n').filter(l=>l.trim());
      const header=lines[0].toLowerCase().split(',');
      const idxRut=header.findIndex(h=>h.includes('rut'));
      const idxNombre=header.findIndex(h=>h.includes('nombre')||h.includes('entidad'));
      const idxComuna=header.findIndex(h=>h.includes('comuna'));
      const idxContacto=header.findIndex(h=>h.includes('contacto'));
      const idxCorreo=header.findIndex(h=>h.includes('correo')||h.includes('email'));
      if(idxRut<0||idxNombre<0){setImportMsg("El archivo debe tener columnas 'rut' y 'nombre' (o 'entidad')");return;}
      const rows=lines.slice(1).map(l=>l.split(',')).filter(r=>r[idxRut]?.trim());
      await onImportarEntidades(rows.map(r=>({
        rut:r[idxRut]?.trim()||"",
        nombre_entidad:r[idxNombre]?.trim()||"",
        comuna:idxComuna>=0?r[idxComuna]?.trim()||"":"",
        contacto:idxContacto>=0?r[idxContacto]?.trim()||"":"",
        correo:idxCorreo>=0?r[idxCorreo]?.trim()||"":"",
      })));
      setImportMsg(`✓ ${rows.length} entidades importadas`);
      setImportFile(null);
    } catch(e){setImportMsg("Error: "+e.message);}
  };

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
      {perfiles.map(p=>{
        const ultima=ultimaActividad[p.id];
        const diasInactivo = ultima ? Math.floor((new Date()-new Date(ultima))/(1000*60*60*24)) : null;
        const activo = diasInactivo!==null && diasInactivo<=14;
        return (
          <div key={p.id} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:12,padding:"12px 15px",marginBottom:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <span style={{width:7,height:7,borderRadius:"50%",background:activo?C.ok:C.inkFaint,display:"inline-block"}} />
                <span style={{fontWeight:700,fontSize:13.5,color:C.ink}}>{p.nombre}</span>
              </div>
              <div style={{fontSize:11.5,color:C.inkMuted,marginTop:2}}>{p.rol==="admin"?"Administrador":"Usuario"}</div>
              <div style={{fontSize:10.5,color:C.inkFaint,marginTop:2}}>{ultima?`Última actividad: ${fmt.datetime(ultima)}`:"Sin actividad registrada"}</div>
            </div>
            <button onClick={()=>onChangeRol(p.id,p.rol==="admin"?"usuario":"admin")} style={btnG}>{p.rol==="admin"?"Quitar admin":"Hacer admin"}</button>
          </div>
        );
      })}
      <PanelDatos session={session} showToast={showToast} />

      <div style={{marginTop:20}}>
        <div style={{fontWeight:800,fontSize:13,color:C.ink,marginBottom:4}}>🏢 Catálogo de entidades</div>
        <div style={{fontSize:12,color:C.inkMuted,marginBottom:10}}>
          {(entidadesCatalogo||[]).length} entidades guardadas · Se autocompletan al escribir el RUT en cualquier OC
        </div>
        {!showImport?(
          <button onClick={()=>setShowImport(true)} style={btnP(C.teal)}>⬆ Importar desde CSV/Excel</button>
        ):(
          <div style={{background:C.tealLight,borderRadius:10,padding:"12px 14px"}}>
            <div style={{fontSize:12.5,fontWeight:700,color:C.tealDark,marginBottom:8}}>Importar entidades desde CSV</div>
            <div style={{fontSize:11.5,color:C.inkMuted,marginBottom:10}}>
              El archivo debe tener columnas: <b>rut</b>, <b>nombre</b> (o entidad), y opcionalmente <b>comuna</b>, <b>contacto</b>, <b>correo</b>. Primera fila = encabezados.
            </div>
            <input type="file" accept=".csv,.txt" onChange={e=>setImportFile(e.target.files[0])} style={{marginBottom:10,fontSize:12}} />
            {importMsg&&<div style={{fontSize:12,color:importMsg.startsWith("✓")?C.ok:C.danger,marginBottom:8,fontWeight:600}}>{importMsg}</div>}
            <div style={{display:"flex",gap:8}}>
              <button onClick={handleImport} style={btnP(C.teal)}>✓ Importar</button>
              <button onClick={()=>{setShowImport(false);setImportMsg("");setImportFile(null);}} style={btnP(C.inkFaint)}>Cancelar</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
