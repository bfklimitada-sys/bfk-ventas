// Recuperación de contraseña (Supabase Auth). Funciones puras: sin red, sin React.
// El enlace del correo pasa por Supabase y vuelve a la app con los datos en la dirección:
//   éxito:   https://bfk-ventas.vercel.app/?flujo=recuperacion#access_token=…&refresh_token=…&type=recovery
//   error:   https://bfk-ventas.vercel.app/?flujo=recuperacion#error=access_denied&error_code=otp_expired&…
//   plantilla con token_hash (si algún día se cambia el correo): ?token_hash=…&type=recovery

// Dirección canónica de producción (proyecto Vercel bfk-ventas). Nunca localhost.
export const URL_APP = "https://bfk-ventas.vercel.app/";
export const URL_RETORNO_RECUPERACION = URL_APP + "?flujo=recuperacion";

export const CONTRASENA_MIN = 8;
export const CONTRASENA_MAX = 72; // límite de bcrypt en Supabase

const parametros = (texto) => {
  const p = new URLSearchParams((texto || "").replace(/^[?#]/, ""));
  const o = {};
  for (const [k, v] of p.entries()) o[k] = v;
  return o;
};

// Lee la dirección con la que se abrió la app. Devuelve null si no viene de un enlace de recuperación.
export function leerRetornoRecuperacion(href) {
  let u;
  try { u = new URL(href); } catch { return null; }
  const q = parametros(u.search), h = parametros(u.hash);
  const marcado = q.flujo === "recuperacion";
  const tipo = h.type || q.type || "";
  // Error devuelto por Supabase (enlace expirado, ya usado o inválido).
  const err = h.error || h.error_code || q.error || q.error_code;
  if (err) {
    return { tipo: "error", codigo: h.error_code || q.error_code || h.error || q.error || "desconocido",
      descripcion: (h.error_description || q.error_description || "").replace(/\+/g, " "), marcado };
  }
  if (tipo === "recovery" && h.access_token) {
    const expiresIn = Number(h.expires_in) || 3600;
    return { tipo: "sesion", access_token: h.access_token, refresh_token: h.refresh_token || null,
      expires_at: Number(h.expires_at) || Math.floor(Date.now() / 1000) + expiresIn };
  }
  if (tipo === "recovery" && q.token_hash) return { tipo: "token_hash", token_hash: q.token_hash };
  // Flujo PKCE (?code=…): esta app no lo inicia; se trata como enlace no utilizable.
  if (marcado && q.code) return { tipo: "error", codigo: "flujo_no_soportado", descripcion: "", marcado };
  if (marcado) return { tipo: "error", codigo: "sin_token", descripcion: "", marcado };
  return null;
}

// Dirección limpia (sin tokens) para reemplazar en el historial del navegador.
export function direccionLimpia(href) {
  try { const u = new URL(href); return u.pathname || "/"; } catch { return "/"; }
}

export function mensajeEnlaceInvalido(codigo) {
  if (codigo === "otp_expired") return "El enlace de recuperación expiró o ya fue utilizado. Solicita uno nuevo.";
  if (codigo === "flujo_no_soportado") return "Este enlace no se puede usar en la app. Solicita un nuevo correo de recuperación.";
  return "El enlace de recuperación no es válido o expiró. Solicita uno nuevo.";
}

// Reglas de la nueva contraseña. Devuelve un mensaje de error o null si es válida.
export function validarNuevaContrasena(pass, confirmacion, email) {
  if (!pass) return "Escribe la nueva contraseña.";
  if (pass !== pass.trim()) return "La contraseña no puede empezar ni terminar con espacios.";
  if (pass.length < CONTRASENA_MIN) return `La contraseña debe tener al menos ${CONTRASENA_MIN} caracteres.`;
  if (new TextEncoder().encode(pass).length > CONTRASENA_MAX) return `La contraseña no puede superar ${CONTRASENA_MAX} caracteres.`;
  if (!/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(pass) || !/\d/.test(pass)) return "La contraseña debe incluir letras y números.";
  if (email && pass.toLowerCase() === String(email).trim().toLowerCase()) return "La contraseña no puede ser igual a tu correo.";
  if (pass !== confirmacion) return "Las contraseñas no coinciden.";
  return null;
}

export const correoValido = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || "").trim());

// Traduce las respuestas de error de Supabase Auth a mensajes para el usuario.
export function mensajeErrorAuth(status, cuerpo, porDefecto) {
  const codigo = cuerpo?.error_code || cuerpo?.code || "";
  const texto = String(cuerpo?.msg || cuerpo?.error_description || cuerpo?.message || "");
  if (status === 429 || codigo === "over_email_send_rate_limit" || codigo === "over_request_rate_limit") {
    const s = (texto.match(/(\d+)\s*seconds?/) || [])[1];
    return s ? `Por seguridad debes esperar ${s} segundos antes de pedir otro correo.` : "Demasiados intentos. Espera unos minutos y vuelve a intentarlo.";
  }
  if (codigo === "same_password" || /different from the old password/i.test(texto)) return "La nueva contraseña debe ser distinta de la anterior.";
  if (codigo === "weak_password" || /password/i.test(texto) && /weak|least|characters|pwned/i.test(texto)) return "La contraseña no cumple los requisitos de seguridad de Supabase. Usa una más larga, con letras y números.";
  if (status === 401 || status === 403 || codigo === "bad_jwt" || codigo === "session_not_found" || codigo === "otp_expired" || /expired|invalid/i.test(texto))
    return "La sesión de recuperación expiró. Solicita un nuevo correo de recuperación.";
  if (codigo === "email_address_invalid") return "El correo indicado no es válido.";
  return porDefecto;
}
