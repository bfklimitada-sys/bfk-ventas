// Proyectos Industriales — acceso a datos (API REST de Supabase con la sesión del usuario).
// Toda regla la aplica la base (RLS, disparadores y funciones pi_*). Este archivo solo lee y escribe tablas pi_*,
// la función pi_crear_proyecto / pi_cambiar_estado / pi_configurar_documentos, el depósito privado
// «pi-documentos» y, para mostrar nombres, la tabla perfiles. Nunca toca tablas de Mercado Público.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabase";

const H = (t, extra = {}) => ({ "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${t}`, ...extra });

export class ErrorPI extends Error {
  constructor(message, { status, code, conflicto, noInstalado, sinPermiso } = {}) {
    super(message); this.status = status; this.code = code; this.conflicto = !!conflicto; this.noInstalado = !!noInstalado; this.sinPermiso = !!sinPermiso;
  }
}
const esNoInstalado = (status, cuerpo) => status === 404 || ["PGRST205", "PGRST202", "42P01", "42883"].includes(cuerpo?.code);

async function pedir(t, metodo, ruta, cuerpo, prefer) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${ruta}`, {
    method: metodo, headers: H(t, prefer ? { Prefer: prefer } : { Prefer: "return=representation" }),
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const txt = await r.text(); let j = null; try { j = txt ? JSON.parse(txt) : null; } catch { j = null; }
  if (!r.ok) {
    const msg = j?.message || `HTTP ${r.status}`;
    throw new ErrorPI(msg, { status: r.status, code: j?.code, noInstalado: esNoInstalado(r.status, j), conflicto: /PI409/.test(msg),
      sinPermiso: r.status === 403 || j?.code === "42501" });
  }
  return j;
}
const leer = (t, ruta) => pedir(t, "GET", ruta, undefined, "count=none");
const q = encodeURIComponent;

// ── Estado del módulo ──────────────────────────────────────────────────────────────────────────
// { instalado:false } si la migración aún no está aplicada (la pantalla lo informa y no guarda nada).
export async function estadoModulo(t) {
  try {
    const filas = await leer(t, "pi_configuracion?select=clave,valor,motivo,actualizado_en");
    const doc = (filas || []).find((f) => f.clave === "documentos_habilitados");
    return { instalado: true, documentosHabilitados: doc?.valor === true, motivoDocumentos: doc?.motivo || null };
  } catch (e) {
    if (e.noInstalado) return { instalado: false, documentosHabilitados: false };
    throw e;
  }
}
export const configurarDocumentos = (t, habilitar, motivo) => pedir(t, "POST", "rpc/pi_configurar_documentos", { p_habilitar: !!habilitar, p_motivo: motivo });

// ── Lecturas ───────────────────────────────────────────────────────────────────────────────────
export const listarProyectos = (t) => leer(t, "pi_proyectos_resumen?select=*&order=codigo.desc");
export async function leerProyecto(t, { id, codigo }) {
  const f = id ? `id=eq.${q(id)}` : `codigo=eq.${q(codigo)}`;
  const filas = await leer(t, `pi_proyectos_resumen?select=*&${f}`);
  return filas?.[0] || null;
}
export const listarPerfiles = (t) => leer(t, "perfiles?select=id,nombre,rol&order=nombre");
export const listarClientes = (t) => leer(t, "pi_clientes?select=*&order=razon_social");
export const listarEquipo = (t, pid) => leer(t, `pi_equipo?select=*&proyecto_id=eq.${q(pid)}&order=creado_en`);
export const listarActividades = (t, pid) => leer(t, `pi_actividades_vista?select=*&proyecto_id=eq.${q(pid)}`);
export const listarHitos = (t, pid) => leer(t, `pi_hitos?select=*&proyecto_id=eq.${q(pid)}&order=fecha_prevista,nombre`);
export const listarEntregables = (t, pid) => leer(t, `pi_entregables?select=*&proyecto_id=eq.${q(pid)}&order=fecha_comprometida.nullslast,nombre`);
export const listarDocumentos = (t, pid) => leer(t, `pi_documentos?select=*&proyecto_id=eq.${q(pid)}&order=subido_en.desc`);
export const listarHistorial = (t, pid) => leer(t, `pi_historial?select=*&proyecto_id=eq.${q(pid)}&order=fecha.desc,id.desc&limit=500`);

// ── Escritura con control de edición simultánea ───────────────────────────────────────────────
// Actualiza solo si la versión no cambió. Sin filas: si la versión cambió → conflicto (otra persona guardó);
// si no cambió → la base no lo permitió (RLS). Un error de la base (p. ej. código duplicado) se informa tal cual.
async function actualizarVersionado(t, tabla, filtro, version, cambios) {
  const filas = await pedir(t, "PATCH", `${tabla}?${filtro}&version=eq.${Number(version)}`, cambios);
  if (Array.isArray(filas) && filas.length) return filas[0];
  const ahora = (await leer(t, `${tabla}?select=version&${filtro}`))?.[0];
  if (ahora && Number(ahora.version) !== Number(version)) throw new ErrorPI("PI409: otra persona guardó cambios antes que tú.", { conflicto: true, status: 409 });
  throw new ErrorPI("No tienes permiso para hacer este cambio.", { sinPermiso: true, status: 403 });
}

export const crearCliente = (t, datos) => pedir(t, "POST", "pi_clientes", datos).then((f) => f?.[0]);
export const crearProyecto = (t, p) => pedir(t, "POST", "rpc/pi_crear_proyecto", { p });
export const actualizarProyecto = (t, id, version, cambios) => actualizarVersionado(t, "pi_proyectos", `id=eq.${q(id)}`, version, cambios);
export const actualizarEconomia = (t, proyectoId, version, cambios) => actualizarVersionado(t, "pi_proyectos_economia", `proyecto_id=eq.${q(proyectoId)}`, version, cambios);
export const cambiarEstado = (t, id, estado, motivo, version) => pedir(t, "POST", "rpc/pi_cambiar_estado", { p_id: id, p_estado: estado, p_motivo: motivo || null, p_version: version ?? null });

export async function agregarIntegrante(t, pid, { usuario_id, rol_proyecto, funcion, ve_economia }, existente) {
  if (existente) return actualizarVersionado(t, "pi_equipo", `id=eq.${q(existente.id)}`, existente.version, { activo: true, rol_proyecto, funcion: funcion || null, ...(ve_economia !== undefined ? { ve_economia } : {}) });
  return pedir(t, "POST", "pi_equipo", { proyecto_id: pid, usuario_id, rol_proyecto, funcion: funcion || null, ve_economia: !!ve_economia }).then((f) => f?.[0]);
}
export const actualizarIntegrante = (t, fila, cambios) => actualizarVersionado(t, "pi_equipo", `id=eq.${q(fila.id)}`, fila.version, cambios);

const crearEn = (tabla) => (t, datos) => pedir(t, "POST", tabla, datos).then((f) => f?.[0]);
const actualizarEn = (tabla) => (t, fila, cambios) => actualizarVersionado(t, tabla, `id=eq.${q(fila.id)}`, fila.version, cambios);
async function eliminarEn(tabla, t, fila) {
  const filas = await pedir(t, "DELETE", `${tabla}?id=eq.${q(fila.id)}`);
  if (!Array.isArray(filas) || !filas.length) throw new ErrorPI("No tienes permiso para eliminar (solo un administrador elimina; los demás anulan).", { sinPermiso: true, status: 403 });
}
export const crearActividad = crearEn("pi_actividades");
export const actualizarActividad = actualizarEn("pi_actividades");
export const eliminarActividad = (t, f) => eliminarEn("pi_actividades", t, f);
export const crearHito = crearEn("pi_hitos");
export const actualizarHito = actualizarEn("pi_hitos");
export const eliminarHito = (t, f) => eliminarEn("pi_hitos", t, f);
export const crearEntregable = crearEn("pi_entregables");
export const actualizarEntregable = actualizarEn("pi_entregables");
export const eliminarEntregable = (t, f) => eliminarEn("pi_entregables", t, f);
export const actualizarDocumento = actualizarEn("pi_documentos");

// ── Documentos (depósito privado «pi-documentos») ─────────────────────────────────────────────
export async function sha256Hex(buffer) {
  const h = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const rutaStorage = (ruta) => ruta.split("/").map(encodeURIComponent).join("/");

// Sube el archivo y luego lo registra. Si el registro falla, el archivo queda sin registro en el depósito
// (no hay borrado para usuarios); el respaldo de documentos lo informa como «sin registro».
export async function subirDocumento(t, { proyectoId, archivo, ruta, titulo, categoria, entregableId, documentoBaseId }) {
  const buf = await archivo.arrayBuffer();
  const sha256 = await sha256Hex(buf);
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/pi-documentos/${rutaStorage(ruta)}`, {
    method: "POST", headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${t}`, "x-upsert": "false", "Content-Type": archivo.type || "application/octet-stream" }, body: buf,
  });
  if (!r.ok) {
    const j = await r.json().catch(() => null);
    const m = j?.message || j?.error || `HTTP ${r.status}`;
    throw new ErrorPI(/row-level security|Unauthorized|403/i.test(m) || r.status === 403 ? "El depósito no aceptó el archivo: la carga de documentos está deshabilitada o no tienes permiso." : `No se pudo subir el archivo (${m}).`, { status: r.status });
  }
  const fila = await pedir(t, "POST", "pi_documentos", {
    proyecto_id: proyectoId, titulo, categoria, entregable_id: entregableId || null, documento_base_id: documentoBaseId || null,
    nombre_archivo: archivo.name.slice(0, 200), ruta, tipo_mime: (archivo.type || null)?.slice(0, 120) || null, tamano: archivo.size, sha256,
  });
  return fila?.[0];
}

// Descarga con el permiso del usuario y comprueba que el archivo coincide con su huella registrada.
export async function descargarDocumento(t, doc) {
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/authenticated/pi-documentos/${rutaStorage(doc.ruta)}`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${t}` } });
  if (!r.ok) throw new ErrorPI(r.status === 404 || r.status === 400 ? "El archivo no está disponible en el depósito." : `No se pudo descargar (HTTP ${r.status}).`, { status: r.status });
  const buf = await r.arrayBuffer();
  const sha = await sha256Hex(buf);
  if (sha !== doc.sha256) throw new ErrorPI("El archivo descargado no coincide con su huella registrada (SHA-256). No se entrega.", { status: 409 });
  return new Blob([buf], { type: doc.tipo_mime || "application/octet-stream" });
}
export function guardarArchivo(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = nombre || "documento"; a.rel = "noopener";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
