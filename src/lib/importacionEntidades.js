// Importador de entidades (entidades_catalogo): lectura de archivo, encabezados, validación y comparación.
// Módulo puro (sin React ni Supabase): no escribe nada. La escritura es una sola RPC al confirmar.
import * as XLSX from "xlsx";
import { analizarRut, claveComparacion, formatoAlmacenamiento } from "./rut";

export const LIMITE_OPERACIONES = 500;
export const FORMATOS_ACEPTADOS = ".csv,.tsv,.txt,.xlsx";
export const TEXTO_FORMATOS = "CSV (separado por coma, punto y coma o tabulación) o Excel .xlsx";

// ── Decodificación: UTF-8 estricto; si no es válido, Windows-1252 (Excel en español). Quita el BOM. ──
export function decodificarTexto(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let texto, codificacion = "UTF-8";
  try { texto = new TextDecoder("utf-8", { fatal: true }).decode(u8); }
  catch { texto = new TextDecoder("windows-1252").decode(u8); codificacion = "Windows-1252"; }
  if (texto.charCodeAt(0) === 0xFEFF) texto = texto.slice(1);
  return { texto, codificacion };
}

// ── Delimitador: el más frecuente fuera de comillas en la primera línea con contenido. ──
export function detectarDelimitador(texto) {
  const cuenta = { ",": 0, ";": 0, "\t": 0 };
  let enComillas = false, vistoContenido = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (c === '"') { if (enComillas && texto[i + 1] === '"') { i++; continue; } enComillas = !enComillas; vistoContenido = true; continue; }
    if (!enComillas && (c === "\n" || c === "\r")) { if (vistoContenido) break; continue; }
    if (!enComillas && c in cuenta) cuenta[c]++;
    if (!/\s/.test(c)) vistoContenido = true;
  }
  const orden = Object.entries(cuenta).sort((a, b) => b[1] - a[1]);
  return orden[0][1] > 0 ? orden[0][0] : ",";
}

// ── Parser CSV (RFC 4180): comillas, "" escapada, delimitador y saltos de línea dentro de campos, CRLF/LF/CR. ──
export function parsearCsv(texto, delimitador) {
  const d = delimitador || detectarDelimitador(texto);
  const filas = []; let fila = [], campo = "", enComillas = false, huboComillas = false;
  const cerrarCampo = () => { fila.push(campo); campo = ""; huboComillas = false; };
  const cerrarFila = () => { cerrarCampo(); filas.push(fila); fila = []; };
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (enComillas) {
      if (c === '"') { if (texto[i + 1] === '"') { campo += '"'; i++; } else { enComillas = false; } }
      else campo += c;
    } else if (c === '"' && campo === "" && !huboComillas) { enComillas = true; huboComillas = true; }
    else if (c === d) cerrarCampo();
    else if (c === "\r") { if (texto[i + 1] === "\n") i++; cerrarFila(); }
    else if (c === "\n") cerrarFila();
    else campo += c;
  }
  if (enComillas) throw new Error("El archivo tiene una comilla sin cerrar (campo entre comillas incompleto).");
  if (campo !== "" || fila.length > 0) cerrarFila();
  return { filas, delimitador: d };
}

// ── Lectura de archivo (CSV o XLSX): devuelve { filas: string[][], formato, detalle } o lanza Error con causa clara. ──
export function leerArchivoEntidades(nombre, bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const ext = (String(nombre).toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || "";
  const esZip = u8.length > 3 && u8[0] === 0x50 && u8[1] === 0x4B;           // PK → xlsx (zip)
  const esOle = u8.length > 4 && u8[0] === 0xD0 && u8[1] === 0xCF && u8[2] === 0x11 && u8[3] === 0xE0; // xls antiguo
  if (u8.length === 0) throw new Error("El archivo está vacío.");
  if (esOle || ext === "xls") throw new Error("El formato .xls (Excel antiguo) no es compatible. Guarde el archivo como .xlsx o como CSV.");
  if (ext === "xlsx" || esZip) {
    if (!esZip) throw new Error("El archivo dice ser .xlsx pero no es un libro de Excel válido.");
    let libro;
    try { libro = XLSX.read(u8, { type: "array" }); } catch { throw new Error("No se pudo leer el archivo .xlsx (¿está dañado o protegido con contraseña?)."); }
    const hoja = libro.SheetNames.find(n => { const ws = libro.Sheets[n]; return ws && ws["!ref"]; });
    if (!hoja) throw new Error("El libro de Excel no tiene datos.");
    const aoa = XLSX.utils.sheet_to_json(libro.Sheets[hoja], { header: 1, raw: false, defval: "", blankrows: false });
    return { filas: aoa.map(f => f.map(v => String(v ?? ""))), formato: "xlsx", detalle: `hoja «${hoja}»` };
  }
  if (!["csv", "tsv", "txt", ""].includes(ext)) throw new Error(`Formato «.${ext}» no admitido. Use ${TEXTO_FORMATOS}.`);
  const { texto, codificacion } = decodificarTexto(u8);
  if (texto.indexOf("\u0000") >= 0) throw new Error("El archivo parece binario, no es un CSV de texto.");
  if (!texto.trim()) throw new Error("El archivo está vacío.");
  const { filas, delimitador } = parsearCsv(texto);
  const nombreDelim = delimitador === ";" ? "punto y coma" : delimitador === "\t" ? "tabulación" : "coma";
  return { filas, formato: "csv", detalle: `delimitador: ${nombreDelim} · codificación: ${codificacion}` };
}

// ── Encabezados: aliases EXPLÍCITOS (comparación exacta tras normalizar), nunca "contiene". ──
const normEnc = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").trim();
export const ALIASES = {
  rut: ["rut", "run", "rut entidad", "rut cliente", "rut de la entidad"],
  nombre_entidad: ["nombre", "entidad", "nombre entidad", "nombre de la entidad", "razon social"],
  comuna: ["comuna"],
  contacto: ["contacto", "nombre contacto", "nombre de contacto", "persona de contacto"],
  correo: ["correo", "email", "e mail", "correo electronico", "mail"],
};
export const OBLIGATORIOS = ["rut", "nombre_entidad"];

export function mapearEncabezados(encabezados) {
  const mapa = {}, ignoradas = [], conflictos = [];
  encabezados.forEach((h, i) => {
    const n = normEnc(h); if (!n) return;
    const campo = Object.keys(ALIASES).find(k => ALIASES[k].includes(n));
    if (!campo) { ignoradas.push(String(h).trim()); return; }
    if (mapa[campo] !== undefined) conflictos.push(`«${String(encabezados[mapa[campo]]).trim()}» y «${String(h).trim()}» corresponden a ${campo}`);
    else mapa[campo] = i;
  });
  const faltantes = OBLIGATORIOS.filter(c => mapa[c] === undefined);
  return { mapa, ignoradas, conflictos, faltantes };
}

// ── Validación fila por fila. Cualquier error bloquea toda la importación (nada se escribe). ──
const MAX_TEXTO = 200;
const CORREO_RE = /^[^\s@;,]+@[^\s@;,]+\.[^\s@;,]+$/;
export function validarFilas(filas) {
  const errores = [], validas = [], infoGeneral = { filasVacias: 0 };
  if (!filas.length) { errores.push({ fila: 1, rut: "", causa: "El archivo no tiene filas." }); return { errores, validas, ...infoGeneral, encabezados: null }; }
  const enc = mapearEncabezados(filas[0]);
  if (enc.faltantes.length) errores.push({ fila: 1, rut: "", causa: `Faltan columnas obligatorias: ${enc.faltantes.map(c => c === "rut" ? "rut" : "nombre/entidad").join(", ")}. Encabezados reconocidos: rut, nombre o entidad, comuna, contacto, correo.` });
  enc.conflictos.forEach(c => errores.push({ fila: 1, rut: "", causa: `Encabezado ambiguo: ${c}.` }));
  if (errores.length) return { errores, validas, ...infoGeneral, encabezados: enc };
  const visto = new Map();
  for (let i = 1; i < filas.length; i++) {
    const f = filas[i], nro = i + 1;
    const cel = (campo) => (enc.mapa[campo] === undefined ? undefined : String(f[enc.mapa[campo]] ?? "").trim());
    if (f.every(v => String(v ?? "").trim() === "")) { infoGeneral.filasVacias++; continue; }
    const rutOriginal = cel("rut") || "";
    const causas = [];
    const a = analizarRut(rutOriginal);
    if (!a.ok) causas.push(`RUT «${rutOriginal}»: ${a.motivo}`);
    const nombre = cel("nombre_entidad");
    if (!nombre) causas.push("falta el nombre de la entidad");
    const comuna = cel("comuna"), contacto = cel("contacto"), correo = cel("correo");
    for (const [k, v] of [["nombre", nombre], ["comuna", comuna], ["contacto", contacto], ["correo", correo]]) if (v && v.length > MAX_TEXTO) causas.push(`${k} demasiado largo (máximo ${MAX_TEXTO})`);
    if (correo && !CORREO_RE.test(correo)) causas.push(`correo «${correo}» no es válido`);
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test([nombre, comuna, contacto, correo].join(""))) causas.push("contiene caracteres de control");
    if (a.ok) {
      if (visto.has(a.normalizado)) causas.push(`RUT repetido en el archivo (también en la fila ${visto.get(a.normalizado)})`);
      else visto.set(a.normalizado, nro);
    }
    if (causas.length) { errores.push({ fila: nro, rut: rutOriginal, causa: causas.join("; ") }); continue; }
    validas.push({ fila: nro, rutOriginal, rut: a.normalizado, nombre_entidad: nombre,
      comuna: comuna || null, contacto: contacto || null, correo: correo || null });
  }
  if (!validas.length && !errores.length) errores.push({ fila: 1, rut: "", causa: "El archivo solo tiene encabezados o filas vacías." });
  return { errores, validas, ...infoGeneral, encabezados: enc };
}

// ── Comparación con el catálogo existente (por RUT normalizado). No elige entre duplicados históricos. ──
const igual = (a, b) => String(a ?? "").trim() === String(b ?? "").trim();
export function compararConCatalogo(validas, catalogo) {
  const porClave = new Map();
  for (const e of catalogo || []) { const k = claveComparacion(e.rut); if (!k) continue; (porClave.get(k) || porClave.set(k, []).get(k)).push(e); }
  return validas.map(v => {
    const coincidencias = porClave.get(claveComparacion(v.rut)) || [];
    if (coincidencias.length === 0) return { ...v, estado: "nueva", rutAlmacenado: formatoAlmacenamiento(v.rut) };
    if (coincidencias.length > 1) return { ...v, estado: "ambigua", coincidencias: coincidencias.length };
    const ex = coincidencias[0];
    const cambios = {};
    if (!igual(v.nombre_entidad, ex.nombre_entidad)) cambios.nombre_entidad = v.nombre_entidad;
    for (const c of ["comuna", "contacto", "correo"]) if (v[c] != null && !igual(v[c], ex[c])) cambios[c] = v[c];
    return Object.keys(cambios).length ? { ...v, estado: "actualizacion", cambios, existente: { id: ex.id, rut: ex.rut } } : { ...v, estado: "sin_cambios", existente: { id: ex.id, rut: ex.rut } };
  });
}

export function resumir(comparadas, omitidas = new Set()) {
  const r = { nuevas: 0, actualizaciones: 0, sinCambios: 0, ambiguas: 0, omitidas: 0 };
  for (const c of comparadas) {
    if (c.estado === "ambigua") { if (omitidas.has(c.fila)) r.omitidas++; else r.ambiguas++; }
    else if (c.estado === "nueva") r.nuevas++;
    else if (c.estado === "actualizacion") r.actualizaciones++;
    else r.sinCambios++;
  }
  return r;
}

// Payload de la RPC: solo filas a crear/actualizar (ni «sin cambios» ni ambiguas omitidas). Campos fijos.
export function armarPayload(comparadas) {
  return comparadas.filter(c => c.estado === "nueva" || c.estado === "actualizacion").map(c => ({
    fila: c.fila, rut: c.rut, nombre_entidad: c.nombre_entidad, comuna: c.comuna, contacto: c.contacto, correo: c.correo,
  }));
}
