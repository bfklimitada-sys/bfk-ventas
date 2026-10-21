// Carga bajo demanda de módulos pesados (jsPDF, html2canvas, pdf.js, lector de texto) con recuperación controlada.
// Causa del error «Failed to fetch dynamically imported module» (21/10/2026): una pestaña abierta con una versión anterior
// pide un archivo con el nombre de ESA versión; tras una nueva publicación ese archivo ya no existe en el sitio.
// Aquí NO se recarga solo: se avisa (evento bfk:version-nueva) y el usuario decide cuándo actualizar, después de guardar.
// La recarga queda limitada a una cada 5 minutos por pestaña: nunca hay recargas infinitas.
const PATRON = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|ChunkLoadError|Loading chunk \S+ failed/i;
export const esErrorDeCargaDeModulo = (e) => PATRON.test(String(e?.message ?? e ?? ""));

export const CLAVE_RECARGA = "bfk_recarga_por_version";
export const ESPERA_RECARGA_MS = 5 * 60_000;
const sesion = () => { try { return window.sessionStorage; } catch { return null; } };

// ¿Se puede ofrecer una recarga? No, si ya se recargó por este motivo hace menos de 5 minutos (el problema no es la versión).
export function puedeRecargar(ahora = Date.now(), almacen = sesion()) {
  try { const t = Number(almacen?.getItem(CLAVE_RECARGA) || 0); return !t || ahora - t > ESPERA_RECARGA_MS; } catch { return true; }
}
export function recargarPorVersionNueva({ ahora = Date.now(), almacen = sesion(), recargar = () => window.location.reload() } = {}) {
  if (!puedeRecargar(ahora, almacen)) return false;
  try { almacen?.setItem(CLAVE_RECARGA, String(ahora)); } catch { /* sin almacenamiento: igual se recarga una vez (acción del usuario) */ }
  recargar();
  return true;
}

export function avisarVersionNueva(causa) {
  try { window.dispatchEvent(new CustomEvent("bfk:version-nueva", { detail: { mensaje: String(causa?.message ?? causa ?? "") } })); } catch { /* fuera del navegador */ }
}

// Envuelve un import() dinámico. Si falla por un archivo de una versión anterior, lanza un error claro (versionNueva = true)
// y avisa a la app; cualquier otro error se propaga tal cual.
export async function importarModulo(cargar) {
  try { return await cargar(); }
  catch (e) {
    if (!esErrorDeCargaDeModulo(e)) throw e;
    avisarVersionNueva(e);
    const err = new Error("BFK Datos se actualizó mientras esta pestaña estaba abierta y falta un archivo de la versión anterior. Guarda tus cambios y pulsa «Actualizar BFK Datos».");
    err.versionNueva = true; err.causa = e;
    throw err;
  }
}
