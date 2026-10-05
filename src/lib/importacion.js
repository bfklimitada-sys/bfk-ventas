import * as XLSX from "xlsx";
import { leerTablaCompleta } from "./exportacion.js";

// Importación desde Excel. El alcance lo define SIEMPRE la lista oficial que se le pasa
// (TABLAS_EXPORT, las 14 hojas importables); las hojas extra del respaldo completo se ignoran.
// Todo lo de este archivo, salvo `aplicarPlan`, es de SOLO LECTURA.

export class ErrorImportacion extends Error {
  constructor(mensaje, detalle = {}) { super(mensaje); this.name = "ErrorImportacion"; Object.assign(this, detalle); }
}

const valorTexto = (v) => String(v ?? "");

// 1) Interpreta el archivo. No toca la base. Devuelve { datos, problemas }.
export function leerArchivoImportable(buf, tablas) {
  let wb;
  try { wb = XLSX.read(buf, { type: "array" }); }
  catch { return { datos: null, problemas: ["El archivo no es un Excel (.xlsx) legible."] }; }
  const problemas = [];
  const faltantes = tablas.filter(({ hoja }) => !wb.Sheets[hoja]).map(({ hoja }) => hoja);
  if (faltantes.length) problemas.push(`Faltan hojas requeridas: ${faltantes.join(", ")}.`);

  // Si el archivo viene del exportador nuevo, _Resumen declara cuántas filas tenía cada hoja y su estado.
  const resumen = wb.Sheets["_Resumen"] ? XLSX.utils.sheet_to_json(wb.Sheets["_Resumen"]) : null;
  const datos = {};
  for (const { hoja, tabla } of tablas) {
    const ws = wb.Sheets[hoja];
    if (!ws) continue;
    const crudas = XLSX.utils.sheet_to_json(ws);
    const filas = crudas.map((fila) => {
      const limpia = {};
      for (const k of Object.keys(fila)) { if (!k.startsWith("_")) limpia[k] = fila[k]; }
      return limpia;
    }).filter((f) => Object.keys(f).length);
    const sinId = filas.filter((f) => f.id === undefined || f.id === null || valorTexto(f.id).trim() === "").length;
    if (sinId) problemas.push(`${hoja}: ${sinId} fila(s) sin id.`);
    const vistos = new Set(); const dup = new Set();
    for (const f of filas) { const id = valorTexto(f.id); if (vistos.has(id)) dup.add(id); vistos.add(id); }
    if (dup.size) problemas.push(`${hoja}: ids duplicados (${[...dup].slice(0, 5).join(", ")}${dup.size > 5 ? "…" : ""}).`);
    if (resumen) {
      const r = resumen.find((x) => x.Tabla === tabla && x.Hoja === hoja);
      if (r && r.Estado === "ERROR") problemas.push(`${hoja}: el archivo declara que esta hoja no se pudo leer al exportarse.`);
      else if (r && Number(r.Filas) !== crudas.length) problemas.push(`${hoja}: el archivo declara ${r.Filas} filas pero contiene ${crudas.length} (archivo incompleto o alterado).`);
    }
    datos[tabla] = filas;
  }
  return { datos: problemas.length ? null : datos, problemas };
}

// 2) Lee TODAS las tablas oficiales completas (paginado) y calcula qué se insertaría/actualizaría.
//    Si cualquier página de cualquier tabla falla, lanza ErrorImportacion con el nombre de la tabla: nada se escribe.
export async function planificarImportacion({ sel, token, tablas, datos }) {
  const plan = []; const problemas = [];
  for (const { hoja, tabla } of tablas) {
    let actuales;
    try { actuales = await leerTablaCompleta(sel, token, tabla); }
    catch (e) { throw new ErrorImportacion(`No se pudo leer completa la tabla ${tabla} (${hoja}): ${e.message}. No se aplicó ningún cambio.`, { tabla, hoja }); }
    const mapaActual = Object.fromEntries(actuales.map((r) => [String(r.id), r]));
    const filasArchivo = datos[tabla] || [];
    if (actuales.length) {
      const columnasBD = new Set(); for (const r of actuales) for (const k of Object.keys(r)) columnasBD.add(k);
      const ajenas = new Set(); for (const f of filasArchivo) for (const k of Object.keys(f)) if (!columnasBD.has(k)) ajenas.add(k);
      if (ajenas.size) problemas.push(`${hoja}: columnas que no existen en la tabla (${[...ajenas].join(", ")}).`);
    }
    const nuevas = []; const actualizadas = []; const ops = [];   // ops conserva el orden del archivo (igual que el importador original)
    for (const fila of filasArchivo) {
      const existente = mapaActual[String(fila.id)];
      if (!existente) { nuevas.push(fila); ops.push({ op: "insert", fila }); }
      else if (Object.keys(fila).some((k) => valorTexto(fila[k]) !== valorTexto(existente[k]))) { actualizadas.push(fila); ops.push({ op: "update", fila }); }
    }
    plan.push({ tabla, hoja, nuevas, actualizadas, ops });
  }
  if (problemas.length) throw new ErrorImportacion(`Archivo no válido para esta base: ${problemas.join(" ")} No se aplicó ningún cambio.`, { problemas });
  return plan;
}

export const resumirPlan = (plan) => plan
  .filter((p) => p.nuevas.length || p.actualizadas.length)
  .map((p) => ({ tabla: p.tabla, hoja: p.hoja, nuevas: p.nuevas.length, actualizadas: p.actualizadas.length }));

// 3) ÚNICA función que escribe. Aplica el plan en orden, fila a fila, y se detiene en el primer error.
//    No es transaccional: si falla a mitad, lo ya escrito queda aplicado (ver `aplicadas` en el error).
export async function aplicarPlan({ ins, upd, token, plan }) {
  const aplicadas = [];
  for (const { tabla, ops } of plan) {
    for (const { op, fila } of ops) {
      try { if (op === "insert") await ins(tabla, token, fila); else await upd(tabla, token, fila.id, fila); }
      catch (e) { throw new ErrorImportacion(`Falló la escritura en ${tabla} (${op === "insert" ? "insertar" : "actualizar"} id ${fila.id}): ${e.message}. La importación quedó PARCIAL: ${aplicadas.length} fila(s) ya aplicadas antes del fallo.`, { aplicadas, tabla, id: fila.id, parcial: true }); }
      aplicadas.push({ tabla, id: fila.id, op });
    }
  }
  return aplicadas;
}
