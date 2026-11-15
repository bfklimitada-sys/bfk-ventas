// Mensajes de error del servicio de datos y de sesión (Supabase), 15/11/2026.
// Causa del incidente «Error al ingresar» (15/11/2026): Supabase restringió el proyecto por superar la cuota de transferencia
// del plan (exceed_egress_quota) y respondía 402 a TODAS las solicitudes, incluido el inicio de sesión. La app mostraba un
// genérico «Error al ingresar» y, al renovar la sesión, trataba el 402 como sesión rechazada.
// Aquí se distingue: credenciales incorrectas · sin conexión · servicio restringido por el proveedor · servidor no disponible.
// Nunca se muestran tokens, contraseñas ni el detalle interno del proveedor.

export const MENSAJE_SIN_CONEXION = "No hay conexión con BFK Datos. Revisa tu conexión a internet e intenta nuevamente.";
export const MENSAJE_SERVICIO_RESTRINGIDO = "BFK Datos no está disponible en este momento: el proveedor del servicio de datos lo restringió temporalmente por límite del plan. Tu cuenta y tus datos están a salvo; avisa al administrador de BFK.";
export const MENSAJE_SERVIDOR = "El servidor de BFK Datos no responde en este momento. Intenta en unos minutos; si persiste, avisa al administrador de BFK.";
export const MENSAJE_CREDENCIALES = "Correo o contraseña incorrectos.";

const textoDe = (c) => String(c?.msg || c?.error_description || c?.message || "");
const codigoDe = (c) => String(c?.error_code || c?.code || "");

// Fallas del servicio (no de quien usa la app): 402 restringido, 5xx no disponible. null si no es una de ellas.
export function mensajeErrorServicio(status, cuerpo) {
  const t = textoDe(cuerpo);
  if (status === 402 || /service for this project is restricted|exceed_\w+_quota/i.test(t)) return MENSAJE_SERVICIO_RESTRINGIDO;
  if (status === 0 || status >= 500) return MENSAJE_SERVIDOR;
  return null;
}
// Una falla temporal del servicio (no significa que la sesión o las credenciales sean inválidas).
export const esFallaTemporalServicio = (status) => status === 402 || status === 429 || status >= 500;

// Respuesta del inicio de sesión con correo y contraseña.
export function mensajeIngreso(status, cuerpo) {
  const s = mensajeErrorServicio(status, cuerpo); if (s) return s;
  const codigo = codigoDe(cuerpo); const t = textoDe(cuerpo);
  if (codigo === "invalid_credentials" || /invalid login credentials/i.test(t)) return MENSAJE_CREDENCIALES;
  if (codigo === "email_not_confirmed" || /email not confirmed/i.test(t)) return "Tu correo aún no está confirmado. Abre el enlace que te enviamos y vuelve a ingresar.";
  if (codigo === "user_banned") return "Esta cuenta está bloqueada. Contacta al administrador de BFK.";
  if (status === 429 || /rate limit/i.test(codigo + t)) return "Demasiados intentos. Espera unos minutos y vuelve a intentarlo.";
  if (status === 400 || status === 401) return MENSAJE_CREDENCIALES;
  return "No se pudo iniciar sesión. Intenta nuevamente; si persiste, avisa al administrador de BFK.";
}

// fetch que convierte una falla de red en un error con el mensaje de «sin conexión» (marcado con red: true).
export async function pedir(url, opciones) {
  try { return await fetch(url, opciones); }
  catch { throw Object.assign(new Error(MENSAJE_SIN_CONEXION), { red: true }); }
}
// Lee el cuerpo JSON sin fallar si la respuesta no es JSON (p. ej. una página de error del proxy).
export const cuerpoJson = (r) => r.json().catch(() => ({}));
