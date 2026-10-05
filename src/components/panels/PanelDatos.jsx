import { Tarjeta } from "../ui/Sistema";
import { useState } from "react";
import * as XLSX from "xlsx";
import { TABLAS_EXPORT, del, ins, sel, upd } from "../../lib/supabase";
import { exportarExcelRespaldo } from "../../lib/exportacion";
import { C, btnG, btnP } from "../../lib/theme";
import { Ic } from "../ui/Iconos";

export function PanelDatos({ session, showToast }) {
  const [exporting,setExporting]=useState(false);
  const [comparando,setComparando]=useState(false);
  const [resumenCambios,setResumenCambios]=useState(null);
  const [archivoData,setArchivoData]=useState(null);
  const [aplicando,setAplicando]=useState(false);

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

  const handleArchivoSeleccionado = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setComparando(true); setResumenCambios(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type:"array" });
      const datosPorTabla = {};
      for (const { hoja, tabla } of TABLAS_EXPORT) {
        const ws = wb.Sheets[hoja];
        const filas = ws ? XLSX.utils.sheet_to_json(ws) : [];
        datosPorTabla[tabla] = filas.map(fila => {
          const limpia = {};
          for (const k of Object.keys(fila)) { if (!k.startsWith("_")) limpia[k] = fila[k]; }
          return limpia;
        });
      }
      setArchivoData(datosPorTabla);

      const resumen = [];
      for (const { hoja, tabla } of TABLAS_EXPORT) {
        const actuales = await sel(tabla, session.access_token, "&order=id");
        const mapaActual = Object.fromEntries(actuales.map(r => [String(r.id), r]));
        const nuevasFilas = []; const actualizadasFilas = [];
        for (const fila of (datosPorTabla[tabla]||[])) {
          if (!fila.id) continue;
          const id = String(fila.id);
          if (!mapaActual[id]) { nuevasFilas.push(fila); }
          else {
            const existente = mapaActual[id];
            const cambio = Object.keys(fila).some(k => String(fila[k]??"") !== String(existente[k]??""));
            if (cambio) actualizadasFilas.push(fila);
          }
        }
        if (nuevasFilas.length || actualizadasFilas.length) {
          resumen.push({ tabla, hoja, nuevas:nuevasFilas.length, actualizadas:actualizadasFilas.length });
        }
      }
      setResumenCambios(resumen);
      if (resumen.length===0) showToast("Sin cambios detectados respecto a la base de datos actual");
    } catch (e) { showToast("Error al leer el Excel: "+e.message, "error"); }
    finally { setComparando(false); }
  };

  const handleAplicarCambios = async () => {
    if (!archivoData) return;
    setAplicando(true);
    try {
      const erroresRespaldo = await generarExcelCompleto("bfk-RESPALDO-antes-de-importar");
      if (erroresRespaldo.length) throw new Error(`El respaldo previo quedó incompleto (${erroresRespaldo.map(e=>e.Hoja).join(", ")}). No se aplicó ningún cambio.`);
      for (const { tabla } of TABLAS_EXPORT) {
        const actuales = await sel(tabla, session.access_token, "&order=id");
        const mapaActual = Object.fromEntries(actuales.map(r => [String(r.id), r]));
        for (const fila of (archivoData[tabla]||[])) {
          if (!fila.id) continue;
          const id = String(fila.id);
          if (!mapaActual[id]) { await ins(tabla, session.access_token, fila); }
          else {
            const existente = mapaActual[id];
            const cambio = Object.keys(fila).some(k => String(fila[k]??"") !== String(existente[k]??""));
            if (cambio) await upd(tabla, session.access_token, id, fila);
          }
        }
      }
      showToast("Cambios aplicados correctamente");
      setResumenCambios(null); setArchivoData(null);
    } catch (e) { showToast("Error al aplicar cambios: "+e.message, "error"); }
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
          <button onClick={()=>{setResumenCambios(null);setArchivoData(null);}} style={{...btnG,marginTop:8,width:"100%"}}>Cancelar</button>
        </div>
      )}
    </div>
  );
}
