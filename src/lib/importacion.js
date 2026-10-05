import * as XLSX from "xlsx";
import { leerTablaCompleta } from "./exportacion.js";

// Importación desde Excel. El alcance lo define SIEMPRE la lista oficial que se le pasa
// (TABLAS_EXPORT, las 14 hojas importables); las hojas extra del respaldo completo se ignoran.
// Todo lo de este archivo, salvo `aplicarPlan`, es de SOLO LECTURA.

export class ErrorImportacion extends Error {
  constructor(mensaje, detalle = {}) { super(mensaje); this.name = "ErrorImportacion"; Object.assign(this, detalle); }
}

const valorTexto = (v) => String(v ?? "");

// json/jsonb/arrays: el Excel los guarda como texto JSON (ver exportacion.js). Para compararlos o escribirlos se
// reconstruyen SOLO donde la base devuelve un objeto/array para esa columna; en las demás el texto sigue siendo texto.
const esJSON = (v) => v !== null && typeof v === "object";
const canonico = (v) => Array.isArray(v) ? v.map(canonico) : esJSON(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonico(v[k])])) : v;
const analizar = (txt) => { try { return { ok: true, v: JSON.parse(txt) }; } catch { return { ok: false }; } };
const igualValor = (archivo, bd) => {
  if (esJSON(bd)) { if (typeof archivo !== "string") return false; const a = analizar(archivo); return a.ok && JSON.stringify(canonico(a.v)) === JSON.stringify(canonico(bd)); }
  return valorTexto(archivo) !== valorTexto(bd) ? false : true;
};

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
    // defval:null → una celda en blanco es NULL (el exportador deja en blanco los NULL y escribe "" como texto vacío),
    // así una fila borrada que se vuelve a insertar recupera NULL en vez del valor por defecto de la columna.
    const filas = XLSX.utils.sheet_to_json(ws, { defval: null }).map((fila) => {
      const limpia = {};
      for (const k of Object.keys(fila)) { if (!k.startsWith("_")) limpia[k] = fila[k]; }
      return limpia;
    }).filter((f) => Object.values(f).some((v) => v !== null));
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
    // columnas que la base entrega como objeto/array (cualquier fila de esa tabla): se reconstruyen desde el texto JSON del archivo
    const columnasJSON = new Set(); for (const r of actuales) for (const k of Object.keys(r)) if (esJSON(r[k])) columnasJSON.add(k);
    const nuevas = []; const actualizadas = []; const ops = [];   // ops conserva el orden del archivo (igual que el importador original)
    for (const original of filasArchivo) {
      const fila = { ...original };
      for (const k of columnasJSON) if (typeof fila[k] === "string") { const a = analizar(fila[k]); if (a.ok) fila[k] = a.v; else problemas.push(`${hoja}: id ${fila.id}, columna ${k} no contiene JSON válido.`); }
      const existente = mapaActual[String(fila.id)];
      if (!existente) { nuevas.push(fila); ops.push({ op: "insert", fila }); }
      else {
        // solo las columnas que difieren, junto con el valor actual que vio la comparación (control optimista en la base)
        const cambios = {}; const esperado = {};
        for (const k of Object.keys(fila)) {
          if (k === "id") continue;
          if (!igualValor(esJSON(fila[k]) ? JSON.stringify(fila[k]) : fila[k], existente[k])) { cambios[k] = fila[k]; esperado[k] = existente[k] === undefined ? null : existente[k]; }
        }
        if (Object.keys(cambios).length) { actualizadas.push(fila); ops.push({ op: "update", fila, id: fila.id, cambios, esperado }); }
      }
    }
    plan.push({ tabla, hoja, nuevas, actualizadas, ops });
  }
  if (problemas.length) throw new ErrorImportacion(`Archivo no válido para esta base: ${problemas.join(" ")} No se aplicó ningún cambio.`, { problemas });
  comprobarLimite(plan);   // antes de cualquier llamada de escritura (y antes de simular)
  return plan;
}

export const resumirPlan = (plan) => plan
  .filter((p) => p.nuevas.length || p.actualizadas.length)
  .map((p) => ({ tabla: p.tabla, hoja: p.hoja, nuevas: p.nuevas.length, actualizadas: p.actualizadas.length }));

// 3) Payload para la función de la base `importar_respaldo_excel` (una sola transacción).
//    Orden y dependencias los resuelve la base con el catálogo real; aquí solo se agrupa por tabla.
export function construirPayloadRPC(plan) {
  const tablas = {};
  for (const { tabla, ops } of plan) {
    const insertar = ops.filter((o) => o.op === "insert").map((o) => o.fila);
    const actualizar = ops.filter((o) => o.op === "update").map((o) => ({ id: String(o.id), cambios: o.cambios, esperado: o.esperado }));
    if (insertar.length || actualizar.length) tablas[tabla] = { ...(insertar.length ? { insertar } : {}), ...(actualizar.length ? { actualizar } : {}) };
  }
  return { version: 1, tablas };
}

// Máximo de operaciones (INSERT + UPDATE de las 14 tablas) por importación. PostgreSQL lo vuelve a comprobar (RPC): es la autoridad.
export const LIMITE_OPERACIONES = 1000;
const miles = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
export const totalOperaciones = (plan) => plan.reduce((s, p) => s + p.ops.length, 0);
export const mensajeLimite = (n) => `La importación contiene ${miles(n)} cambios y supera el máximo permitido de ${miles(LIMITE_OPERACIONES)}. No se aplicó ningún cambio.`;
const comprobarLimite = (plan) => { const n = totalOperaciones(plan); if (n > LIMITE_OPERACIONES) throw new ErrorImportacion(mensajeLimite(n), { causa: "limite_excedido", total: n }); };

const CAUSAS = {
  conflicto_concurrente: "otro usuario modificó el dato después de la comparación",
  fila_inexistente: "la fila ya no existe",
  id_ya_existe: "el id apareció después de la comparación",
  columna_inexistente: "la columna no existe", columna_generada: "la columna es generada", columna_obligatoria: "falta una columna obligatoria",
  json_invalido: "JSON inválido", tipo_incompatible: "tipo incompatible", valor_incompatible: "valor incompatible con el tipo de la columna",
  referencia_inexistente: "la referencia no existe", duplicado_en_payload: "id repetido en el archivo", tabla_no_autorizada: "tabla no autorizada",
  dependencia_circular: "dependencia circular entre tablas", error_base: "error de la base de datos",
};
const AVISO = "IMPORTACIÓN CANCELADA — no se aplicó ningún cambio";

// Traduce la respuesta de error de la base (código IMxxx, message, details JSON) a un mensaje para el usuario.
export function errorDeRPC(status, cuerpo) {
  if (status === 404 || cuerpo?.code === "PGRST202") return new ErrorImportacion(`${AVISO}. La función de importación atómica no está instalada en la base de datos.`, { causa: "rpc_no_instalada" });
  let d = {}; try { d = JSON.parse(cuerpo?.details || "{}"); } catch { /* sin detalle */ }
  if (d.causa === "limite_excedido") return new ErrorImportacion(mensajeLimite(d.total), { causa: "limite_excedido", total: d.total, codigo: cuerpo?.code });
  const donde = [d.tabla && `tabla ${d.tabla}`, d.id && `id ${d.id}`, d.campo && `campo ${d.campo}`].filter(Boolean).join(" · ");
  const causa = CAUSAS[d.causa] || (cuerpo?.message || "error desconocido").replace(/^IMPORTACION_CANCELADA:\s*/, "");
  return new ErrorImportacion(`${AVISO}${donde ? ` (${donde})` : ""}: ${causa}.`, { causa: d.causa, tabla: d.tabla, id: d.id, campo: d.campo, codigo: cuerpo?.code, detalleServidor: cuerpo?.message });
}

// ÚNICA función que escribe: UNA llamada a la base. Si falla cualquier fila, la base revierte todo.
// `rpc(payload, simular)` la inyecta quien llama (ver supabase.jsx: rpcImportarRespaldo).
export async function aplicarPlan({ rpc, plan, simular = false }) {
  comprobarLimite(plan);
  const payload = construirPayloadRPC(plan);
  let r;
  try { r = await rpc(payload, simular); }
  catch (e) {
    if (e instanceof ErrorImportacion) throw e;
    if (e && e.rpcStatus !== undefined) throw errorDeRPC(e.rpcStatus, e.rpcCuerpo);   // la base respondió con un error: no se aplicó nada
    // sin respuesta del servidor: la operación es atómica (se aplicó completa o no se aplicó), pero el resultado se desconoce
    throw new ErrorImportacion(`${AVISO} confirmado: no hubo respuesta del servidor (${e.message}). La operación es atómica: se aplicó completa o no se aplicó nada. Compruebe volviendo a subir el archivo antes de repetirla.`, { causa: "sin_respuesta" });
  }
  return r;
}

export const simularPlan = (args) => aplicarPlan({ ...args, simular: true });
