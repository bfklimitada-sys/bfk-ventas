// Pruebas de lib/recuperacion.js. Ejecutar: node docs/pruebas-recuperacion/recuperacion.test.mjs
import { URL_APP, URL_RETORNO_RECUPERACION, leerRetornoRecuperacion, direccionLimpia, mensajeEnlaceInvalido, validarNuevaContrasena, mensajeErrorAuth, correoValido } from "../../src/lib/recuperacion.js";
let ok = 0, fallas = 0;
const eq = (n, a, b) => { const v = JSON.stringify(a) === JSON.stringify(b); v ? ok++ : fallas++; console.log((v ? "OK    " : "FALLA ") + n + (v ? "" : ` :: esperado ${JSON.stringify(b)} obtenido ${JSON.stringify(a)}`)); };
const B = "https://bfk-ventas.vercel.app/";

eq("URL de retorno es producción", URL_RETORNO_RECUPERACION, "https://bfk-ventas.vercel.app/?flujo=recuperacion");
eq("URL de retorno no contiene localhost", /localhost|127\.0\.0\.1/.test(URL_RETORNO_RECUPERACION + URL_APP), false);
eq("URL de retorno es https", URL_RETORNO_RECUPERACION.startsWith("https://"), true);

eq("dirección normal → null", leerRetornoRecuperacion(B), null);
eq("dirección de pantalla → null", leerRetornoRecuperacion(B + "#/compras"), null);
eq("confirmación de registro (type=signup) → null", leerRetornoRecuperacion(B + "#access_token=a&type=signup"), null);
const s = leerRetornoRecuperacion(B + "?flujo=recuperacion#access_token=AT&refresh_token=RT&expires_at=2000000000&expires_in=3600&token_type=bearer&type=recovery");
eq("sesión de recuperación", [s.tipo, s.access_token, s.refresh_token, s.expires_at], ["sesion", "AT", "RT", 2000000000]);
const s2 = leerRetornoRecuperacion(B + "#access_token=AT&type=recovery&expires_in=60");
eq("sesión sin marca (correos antiguos) y sin refresh", [s2.tipo, s2.refresh_token, s2.expires_at > Date.now() / 1000], ["sesion", null, true]);
const e = leerRetornoRecuperacion(B + "?flujo=recuperacion#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired");
eq("enlace expirado", [e.tipo, e.codigo, e.descripcion], ["error", "otp_expired", "Email link is invalid or has expired"]);
eq("error sin marca también se informa", leerRetornoRecuperacion(B + "#error=access_denied&error_description=x").tipo, "error");
eq("error en la consulta (?error=)", leerRetornoRecuperacion(B + "?error=server_error&error_code=unexpected_failure").codigo, "unexpected_failure");
eq("token_hash", leerRetornoRecuperacion(B + "?token_hash=TH&type=recovery"), { tipo: "token_hash", token_hash: "TH" });
eq("PKCE (?code=) no soportado", leerRetornoRecuperacion(B + "?flujo=recuperacion&code=abc").codigo, "flujo_no_soportado");
eq("marca sin token", leerRetornoRecuperacion(B + "?flujo=recuperacion").codigo, "sin_token");
eq("type=recovery sin token → null", leerRetornoRecuperacion(B + "#type=recovery"), null);
eq("dirección inválida → null", leerRetornoRecuperacion("::no-url"), null);

eq("limpia tokens y consulta", direccionLimpia(B + "?flujo=recuperacion#access_token=AT&type=recovery"), "/");
eq("conserva la ruta", direccionLimpia("https://x.cl/app/?a=1#b"), "/app/");

eq("mensaje expirado", mensajeEnlaceInvalido("otp_expired").includes("expiró"), true);
eq("mensaje genérico", mensajeEnlaceInvalido("otro").includes("no es válido"), true);

const v = (p, c = p, m = "kevin@bfk.cl") => validarNuevaContrasena(p, c, m);
eq("vacía", v(""), "Escribe la nueva contraseña.");
eq("corta", v("abc12"), "La contraseña debe tener al menos 8 caracteres.");
eq("sin números", v("abcdefgh"), "La contraseña debe incluir letras y números.");
eq("sin letras", v("12345678"), "La contraseña debe incluir letras y números.");
eq("espacios al borde", v(" abcd1234"), "La contraseña no puede empezar ni terminar con espacios.");
eq("demasiado larga (>72 bytes)", v("a1" + "x".repeat(71)), "La contraseña no puede superar 72 caracteres.");
eq("igual al correo", v("kevin1@bfk.cl", "kevin1@bfk.cl", "Kevin1@bfk.cl"), "La contraseña no puede ser igual a tu correo.");
eq("no coinciden", v("Laja2026x", "Laja2026y"), "Las contraseñas no coinciden.");
eq("válida", v("Laja2026x"), null);
eq("válida con ñ", v("Ñandú2026"), null);

eq("correo válido", correoValido("a@b.cl"), true);
eq("correo inválido", correoValido("a@b"), false);

eq("429 con segundos", mensajeErrorAuth(429, { msg: "For security purposes, you can only request this after 37 seconds." }, "x"), "Por seguridad debes esperar 37 segundos antes de pedir otro correo.");
eq("429 sin segundos", mensajeErrorAuth(429, {}, "x").startsWith("Demasiados"), true);
eq("misma contraseña", mensajeErrorAuth(422, { code: 422, error_code: "same_password", msg: "New password should be different from the old password." }, "x"), "La nueva contraseña debe ser distinta de la anterior.");
eq("contraseña débil", mensajeErrorAuth(422, { error_code: "weak_password", msg: "Password should be at least 6 characters." }, "x").includes("requisitos"), true);
eq("token vencido 401", mensajeErrorAuth(401, { msg: "invalid JWT: token is expired" }, "x").includes("expiró"), true);
eq("sesión inexistente 403", mensajeErrorAuth(403, { error_code: "session_not_found" }, "x").includes("expiró"), true);
eq("error desconocido → por defecto", mensajeErrorAuth(500, { msg: "boom" }, "por defecto"), "por defecto");

console.log(`\n${ok} correctas, ${fallas} fallas`);
process.exit(fallas ? 1 : 0);
