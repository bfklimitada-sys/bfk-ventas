import * as XLSX from "xlsx";
import { HOJAS_RESPALDO } from "./hojasRespaldo.js";

// ÚNICA fuente para construir el Excel de respaldo manual (lo usan "Exportar todo a Excel" y
// "Exportar Excel completo"). Solo LEE: cada hoja se pide completa a la base, con paginación,
// para no depender de lo que la pantalla tenga cargado ni del tope de 1.000 filas por consulta.
const PAGINA = 1000;
const COLUMNA_SECRETA = /(token|password|passwd|secret|api_?key|service_role|clave)/i;

export async function leerTablaCompleta(sel, token, tabla) {
  const leer = async (orden) => {
    const filas = [];
    for (let desde = 0; ; desde += PAGINA) {
      const lote = await sel(tabla, token, `${orden}&limit=${PAGINA}&offset=${desde}`);
      filas.push(...lote);
      if (lote.length < PAGINA) return filas;
    }
  };
  try { return await leer("&order=id"); }
  catch { return await leer(""); }          // tablas sin columna id: sin orden explícito
}

export async function construirLibroRespaldo({ sel, token, hojas = HOJAS_RESPALDO }) {
  const wb = XLSX.utils.book_new();
  const resumen = [];
  const datos = {};
  for (const h of hojas) {
    try {
      const filas = await leerTablaCompleta(sel, token, h.tabla);
      const omitidas = new Set();
      datos[h.hoja] = filas.map((f) => {
        const limpia = {};
        for (const k of Object.keys(f)) { if (COLUMNA_SECRETA.test(k)) omitidas.add(k); else limpia[k] = f[k]; }
        return limpia;
      });
      resumen.push({ Hoja: h.hoja, Tabla: h.tabla, Filas: filas.length, Estado: "OK", Nota: omitidas.size ? `columnas omitidas por seguridad: ${[...omitidas].join(", ")}` : "" });
    } catch (e) {
      resumen.push({ Hoja: h.hoja, Tabla: h.tabla, Filas: 0, Estado: "ERROR", Nota: e.message });
    }
  }
  // En el historial se agrega el nombre actual del usuario (para no cruzar UUID a mano).
  const nombrePorId = Object.fromEntries((datos.Perfiles || []).map((p) => [p.id, p.nombre]));
  if (datos.HistorialCambios) datos.HistorialCambios = datos.HistorialCambios.map((r) => ({ ...r, usuario_nombre_actual: nombrePorId[r.usuario_id] || r.usuario_nombre || "(desconocido)" }));

  const hojaResumen = XLSX.utils.json_to_sheet([
    ...resumen,
    {},
    { Hoja: "Generado", Tabla: new Date().toISOString() },
    { Hoja: "Excluido (técnico)", Tabla: "oc_bloqueos, mp_cache_avisos, mp_uso_diario" },
  ]);
  XLSX.utils.book_append_sheet(wb, hojaResumen, "_Resumen");

  for (const h of hojas) {
    if (!(h.hoja in datos)) continue;       // si no se pudo leer, queda registrado como ERROR en _Resumen (no se inventa una hoja vacía)
    const filas = datos[h.hoja];
    const ws = XLSX.utils.json_to_sheet(filas.length ? filas : [{}]);
    if (h.margen && filas.length) agregarMargen(ws, filas);
    XLSX.utils.book_append_sheet(wb, ws, h.hoja.slice(0, 31));
  }
  return { wb, resumen, errores: resumen.filter((r) => r.Estado === "ERROR") };
}

function agregarMargen(ws, data) {
  const cols = Object.keys(data[0]);
  const idxMonto = cols.indexOf("monto_total"), idxCosto = cols.indexOf("costo_total");
  const baseCol = cols.length;
  XLSX.utils.sheet_add_aoa(ws, [["_Margen($)", "_Margen(%)"]], { origin: { r: 0, c: baseCol } });
  if (idxMonto >= 0 && idxCosto >= 0) {
    const lm = XLSX.utils.encode_col(idxMonto), lc = XLSX.utils.encode_col(idxCosto);
    data.forEach((_, i) => {
      const row = i + 2;
      ws[XLSX.utils.encode_cell({ r: i + 1, c: baseCol })] = { t: "n", f: `${lm}${row}-${lc}${row}` };
      ws[XLSX.utils.encode_cell({ r: i + 1, c: baseCol + 1 })] = { t: "n", f: `IF(${lm}${row}=0,0,ROUND((${lm}${row}-${lc}${row})/${lm}${row}*100,0))`, z: '0"%"' };
    });
  }
  const range = XLSX.utils.decode_range(ws["!ref"]);
  range.e.c = Math.max(range.e.c, baseCol + 1);
  ws["!ref"] = XLSX.utils.encode_range(range);
}

export async function exportarExcelRespaldo({ sel, token, prefijo = "bfk-datos" }) {
  const { wb, resumen, errores } = await construirLibroRespaldo({ sel, token });
  const fecha = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  XLSX.writeFile(wb, `${prefijo}-${fecha}.xlsx`);
  return { resumen, errores };
}
