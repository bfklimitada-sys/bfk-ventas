import { useState, useMemo } from "react";
import { PanelDatos } from "./PanelDatos";
import { C, btnG, btnP, fmt } from "../../lib/theme";
import { Ic } from "../ui/Iconos";
import { Seccion, Tarjeta, Badge, BotonAdmin } from "../ui/Sistema";

export function PanelUsuarios({ perfiles, ocs, onChangeRol, session, showToast, entidadesCatalogo, onImportarEntidades, usoMP, sincronizando, validandoTodo, exportando, onCorregirFechas, onValidarTodo, onExportarTodo }) {
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
      {/* ── 1. Usuarios y permisos ── */}
      <Seccion titulo="Usuarios y permisos">
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
      <Seccion titulo="Datos y respaldo" nota="Acciones administrativas: tienen más alcance que el trabajo diario.">
        <Tarjeta>
          <div style={{fontSize:12,color:C.inkMuted,marginBottom:12,lineHeight:1.5}}>
            Se hace un respaldo cifrado de la base de datos todos los días, automáticamente, con una prueba de restauración. El estado se revisa en el repositorio de respaldos (GitHub → Actions).
          </div>
          {onExportarTodo&&(
            <button onClick={()=>onExportarTodo()} disabled={!!exportando} style={{...btnG,width:"100%",opacity:exportando?0.6:1}}>
              {exportando?"Armando el Excel…":"Exportar todo a Excel"}
            </button>
          )}
        </Tarjeta>

        <PanelDatos session={session} showToast={showToast} />

        <Tarjeta>
          <div style={{fontSize:14,fontWeight:700,color:C.ink,marginBottom:2}}><Ic n="🏢"/> Catálogo de entidades</div>
          <div style={{fontSize:12,color:C.inkMuted,marginBottom:10}}>
            {(entidadesCatalogo||[]).length} entidades guardadas · Se autocompletan al escribir el RUT en cualquier OC
          </div>
          {!showImport?(
            <BotonAdmin onClick={()=>setShowImport(true)} style={{width:"100%"}}>⬆ Importar desde CSV/Excel</BotonAdmin>
          ):(
            <div style={{background:C.tealLight,borderRadius:10,padding:"12px 14px"}}>
              <div style={{fontSize:12.5,fontWeight:700,color:C.tealDark,marginBottom:8}}>Importar entidades desde CSV</div>
              <div style={{fontSize:12,color:C.inkMuted,marginBottom:10}}>
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
        </Tarjeta>
      </Seccion>

      {/* ── 3. Mercado Público ── */}
      <Seccion titulo="Mercado Público" nota="Mantenimiento masivo. Consulta muchas órdenes a la vez; úsalo solo cuando haga falta.">
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
    </div>
  );
}
