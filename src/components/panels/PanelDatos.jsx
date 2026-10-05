import { Tarjeta } from "../ui/Sistema";
import { useState } from "react";
import * as XLSX from "xlsx";
import { TABLAS_EXPORT, sel, rpcImportarRespaldo } from "../../lib/supabase";
import { leerArchivoImportable, planificarImportacion, resumirPlan, aplicarPlan, simularPlan } from "../../lib/importacion";
import { exportarExcelRespaldo } from "../../lib/exportacion";
import { C, btnG, btnP } from "../../lib/theme";
import { Ic } from "../ui/Iconos";

export function PanelDatos({ session, showToast }) {
  const [exporting,setExporting]=useState(false);
  const [comparando,setComparando]=useState(false);
  const [resumenCambios,setResumenCambios]=useState(null);
  const [planImport,setPlanImport]=useState(null);       // plan calculado al comparar; se envía tal cual (con `esperado`) a la base
  const [aplicando,setAplicando]=useState(false);
  const [errorImport,setErrorImport]=useState(null);   // mensaje persistente (el toast dura 3 s y un aborto debe quedar a la vista)

  // Misma función que "Exportar todo a Excel": una sola fuente para armar el archivo.
  const generarExcelCompleto = async (prefijo="bfk-datos") => {
    const { errores } = await exportarExcelRespaldo({ sel, token: session.access_token, prefijo });
    return errores;
  };

  const handleExportar = async () => {
    setExporting(true);
    try { const errores = await generarExcelCompleto("bfk-datos"); showToast(errores.length ? `Excel exportado, pero no se pudo leer: ${errores.map(e=>e.Hoja).join(", ")}` : "Excel exportado", errores.length ? "error" : undefined); }
    catch (e) { showToast("Error al exportar: "+e.message, "error"); }
    finally { setExporting(false); }
  };

  const rpc = (payload, simular) => rpcImportarRespaldo(session.access_token, payload, simular);

  // Importación en tres fases; solo la última escribe. Todo lo anterior es lectura y aborta sin tocar la base.
  const handleArchivoSeleccionado = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setComparando(true); setResumenCambios(null); setPlanImport(null); setErrorImport(null);
    try {
      const { datos, problemas } = leerArchivoImportable(await file.arrayBuffer(), TABLAS_EXPORT);
      if (!datos) throw new Error(problemas.join(" "));
      const plan = await planificarImportacion({ sel, token: session.access_token, tablas: TABLAS_EXPORT, datos });
      const resumen = resumirPlan(plan);
      // la base valida el plan completo (tipos reales, referencias, conflictos) en modo simulación: no escribe nada
      if (resumen.length) await simularPlan({ rpc, plan });
      setPlanImport(plan); setResumenCambios(resumen);
      if (resumen.length===0) showToast("Sin cambios detectados respecto a la base de datos actual");
    } catch (err) { const m=(err.message.startsWith("IMPORTACIÓN CANCELADA")||err.causa==="limite_excedido")?err.message:"IMPORTACIÓN CANCELADA — no se aplicó ningún cambio: "+err.message; setErrorImport({msg:m,parcial:false}); showToast(m, "error"); }
    finally { setComparando(false); e.target.value=""; }
  };

  const handleAplicarCambios = async () => {
    if (!planImport) return;
    setAplicando(true); setErrorImport(null);
    try {
      // 1) respaldo previo completo (si queda incompleto, se aborta); 2) UNA llamada a la base, que aplica todo o nada.
      const erroresRespaldo = await generarExcelCompleto("bfk-RESPALDO-antes-de-importar");
      if (erroresRespaldo.length) throw new Error(`El respaldo previo quedó incompleto (${erroresRespaldo.map(e=>e.Hoja).join(", ")}). No se aplicó ningún cambio.`);
      const r = await aplicarPlan({ rpc, plan: planImport });
      showToast(`Importación aplicada: ${r.total_insertadas} nuevas, ${r.total_actualizadas} actualizadas`);
      setResumenCambios(null); setPlanImport(null);
    } catch (err) { const m=(err.message.startsWith("IMPORTACIÓN CANCELADA")||err.causa==="limite_excedido")?err.message:"IMPORTACIÓN CANCELADA — no se aplicó ningún cambio: "+err.message; setErrorImport({msg:m}); showToast(m, "error"); setResumenCambios(null); setPlanImport(null); }
    finally { setAplicando(false); }
  };

  const totalNuevas = resumenCambios?.reduce((s,r)=>s+r.nuevas,0) || 0;
  const totalActualizadas = resumenCambios?.reduce((s,r)=>s+r.actualizadas,0) || 0;

  return (
    <div>
      <Tarjeta>
        <div style={{fontSize:14,fontWeight:700,color:C.ink,marginBottom:4}}>Excel completo de la base</div>
        <div style={{fontSize:12,color:C.inkMuted,marginBottom:12,lineHeight:1.45}}>Descarga toda la base en un Excel con una hoja por tabla. Si lo editas y lo subes, se actualizan los valores (acción administrativa).</div>
        <button onClick={handleExportar} disabled={exporting} style={{...btnG,width:"100%",marginBottom:10,opacity:exporting?0.6:1}}>{exporting?"Generando…":"⬇ Exportar Excel completo"}</button>
        <label style={{display:"block",textAlign:"center",cursor:comparando?"default":"pointer",minHeight:44,padding:"12px 14px",boxSizing:"border-box",borderRadius:10,border:`1.5px dashed ${C.danger}88`,color:C.dangerText,fontWeight:600,fontSize:14,opacity:comparando?0.6:1}}>
          {comparando?"Comparando…":"⬆ Subir Excel editado"}
          <input type="file" accept=".xlsx" onChange={handleArchivoSeleccionado} style={{display:"none"}} disabled={comparando} />
        </label>
      </Tarjeta>

      {errorImport && (
        <div role="alert" style={{background:C.dangerLight||"#fdecec",border:`1.5px solid ${C.danger}`,borderRadius:14,padding:14,marginBottom:12}}>
          <div style={{fontWeight:800,color:C.dangerText,fontSize:13.5,marginBottom:6}}>Importación cancelada: no se aplicó ningún cambio</div>
          <div style={{fontSize:12.5,color:C.ink,lineHeight:1.45}}>{errorImport.msg}</div>
          <button onClick={()=>setErrorImport(null)} style={{...btnG,marginTop:10,width:"100%"}}>Entendido</button>
        </div>
      )}

      {resumenCambios && resumenCambios.length>0 && (
        <div style={{background:C.warnLight,border:`1px solid ${C.warn}`,borderRadius:14,padding:16,marginBottom:12}}>
          <div style={{fontWeight:800,color:C.warnText,fontSize:13.5,marginBottom:10}}>Resumen de cambios detectados</div>
          {resumenCambios.map(r=>(
            <div key={r.tabla} style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:5}}>
              <span style={{color:C.ink,fontWeight:600}}>{r.hoja}</span>
              <span style={{color:C.inkMuted}}>{r.nuevas>0&&`+${r.nuevas} nuevas `}{r.actualizadas>0&&`· ${r.actualizadas} actualizadas`}</span>
            </div>
          ))}
          <div style={{borderTop:`1px solid ${C.warn}`,marginTop:8,paddingTop:8,fontSize:12.5,fontWeight:700,color:C.ink}}>
            Total: {totalNuevas} filas nuevas, {totalActualizadas} actualizadas
          </div>
          <div style={{fontSize:12,color:C.inkMuted,marginTop:8}}><Ic n="📥"/> Al confirmar, se descargará automáticamente un respaldo del estado actual antes de aplicar los cambios.</div>
          <button onClick={handleAplicarCambios} disabled={aplicando} style={{...btnP(aplicando?C.inkFaint:C.danger),marginTop:12}}>{aplicando?"Respaldando y aplicando…":"✓ Confirmar y aplicar cambios"}</button>
          <button onClick={()=>{setResumenCambios(null);setPlanImport(null);}} style={{...btnG,marginTop:8,width:"100%"}}>Cancelar</button>
        </div>
      )}
    </div>
  );
}
