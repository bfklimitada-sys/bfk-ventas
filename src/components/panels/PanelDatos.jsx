import { useState } from "react";
import * as XLSX from "xlsx";
import { TABLAS_EXPORT, del, ins, sel, upd } from "../../lib/supabase";
import { C, btnG, btnP } from "../../lib/theme";

export function PanelDatos({ session, showToast }) {
  const [exporting,setExporting]=useState(false);
  const [comparando,setComparando]=useState(false);
  const [resumenCambios,setResumenCambios]=useState(null);
  const [archivoData,setArchivoData]=useState(null);
  const [aplicando,setAplicando]=useState(false);

  const generarExcelCompleto = async (prefijo="bfk-datos") => {
    const wb = XLSX.utils.book_new();
    for (const { hoja, tabla } of TABLAS_EXPORT) {
      const data = await sel(tabla, session.access_token, "&order=id");
      const ws = XLSX.utils.json_to_sheet(data.length ? data : [{}]);

      if (hoja === "OrdenesCompra" && data.length) {
        const cols = Object.keys(data[0]);
        const colIdx = (name) => cols.indexOf(name);
        const colLetter = (idx) => XLSX.utils.encode_col(idx);
        const idxMontoTotal = colIdx("monto_total");
        const idxCostoTotal = colIdx("costo_total");
        const baseCol = cols.length;

        XLSX.utils.sheet_add_aoa(ws, [["_Margen($)", "_Margen(%)"]], { origin: { r:0, c:baseCol } });

        if (idxMontoTotal >= 0 && idxCostoTotal >= 0) {
          const letMonto = colLetter(idxMontoTotal);
          const letCosto = colLetter(idxCostoTotal);
          data.forEach((_, i) => {
            const row = i + 2;
            const cellMargen = XLSX.utils.encode_cell({ r:i+1, c:baseCol });
            const cellPct = XLSX.utils.encode_cell({ r:i+1, c:baseCol+1 });
            ws[cellMargen] = { t:"n", f:`${letMonto}${row}-${letCosto}${row}` };
            ws[cellPct] = { t:"n", f:`IF(${letMonto}${row}=0,0,ROUND((${letMonto}${row}-${letCosto}${row})/${letMonto}${row}*100,0))`, z:"0\"%\"" };
          });
        }
        const range = XLSX.utils.decode_range(ws["!ref"]);
        range.e.c = Math.max(range.e.c, baseCol+1);
        ws["!ref"] = XLSX.utils.encode_range(range);
      }

      XLSX.utils.book_append_sheet(wb, ws, hoja);
    }
    const fechaStr = new Date().toISOString().slice(0,16).replace(/[:T]/g,"-");
    XLSX.writeFile(wb, `${prefijo}-${fechaStr}.xlsx`);
  };

  const handleExportar = async () => {
    setExporting(true);
    try { await generarExcelCompleto("bfk-datos"); showToast("Excel exportado"); }
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
      await generarExcelCompleto("bfk-RESPALDO-antes-de-importar");
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
    <div style={{marginTop:20}}>
      <div style={{fontSize:12,fontWeight:800,color:C.inkMuted,marginBottom:8,textTransform:"uppercase",letterSpacing:0.4}}>Exportar / Importar datos</div>
      <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:16,marginBottom:12}}>
        <div style={{fontSize:12.5,color:C.inkMuted,marginBottom:12}}>Descarga toda la base de datos en un Excel con una hoja por tabla. Edítalo y vuelve a subirlo para actualizar los valores.</div>
        <button onClick={handleExportar} disabled={exporting} style={{...btnP(exporting?C.inkFaint:C.teal),marginBottom:10}}>{exporting?"Generando…":"⬇ Exportar Excel completo"}</button>
        <label style={{...btnG,display:"block",textAlign:"center",cursor:"pointer"}}>
          {comparando?"Comparando…":"⬆ Subir Excel editado"}
          <input type="file" accept=".xlsx" onChange={handleArchivoSeleccionado} style={{display:"none"}} disabled={comparando} />
        </label>
      </div>

      {resumenCambios && resumenCambios.length>0 && (
        <div style={{background:C.warnLight,border:`1px solid ${C.warn}`,borderRadius:14,padding:16,marginBottom:12}}>
          <div style={{fontWeight:800,color:C.warn,fontSize:13.5,marginBottom:10}}>Resumen de cambios detectados</div>
          {resumenCambios.map(r=>(
            <div key={r.tabla} style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:5}}>
              <span style={{color:C.ink,fontWeight:600}}>{r.hoja}</span>
              <span style={{color:C.inkMuted}}>{r.nuevas>0&&`+${r.nuevas} nuevas `}{r.actualizadas>0&&`· ${r.actualizadas} actualizadas`}</span>
            </div>
          ))}
          <div style={{borderTop:`1px solid ${C.warn}`,marginTop:8,paddingTop:8,fontSize:12.5,fontWeight:700,color:C.ink}}>
            Total: {totalNuevas} filas nuevas, {totalActualizadas} actualizadas
          </div>
          <div style={{fontSize:11,color:C.inkMuted,marginTop:8}}>📥 Al confirmar, se descargará automáticamente un respaldo del estado actual antes de aplicar los cambios.</div>
          <button onClick={handleAplicarCambios} disabled={aplicando} style={{...btnP(aplicando?C.inkFaint:C.danger),marginTop:12}}>{aplicando?"Respaldando y aplicando…":"✓ Confirmar y aplicar cambios"}</button>
          <button onClick={()=>{setResumenCambios(null);setArchivoData(null);}} style={{...btnG,marginTop:8,width:"100%"}}>Cancelar</button>
        </div>
      )}
    </div>
  );
}
