// Mensajes del inicio de sesión (incidente 15/11/2026: «Error al ingresar» con Supabase restringido, 402 exceed_egress_quota).
// Uso: node docs/pruebas-ingreso/ingreso.test.mjs
import { mensajeIngreso, mensajeErrorServicio, esFallaTemporalServicio, pedir, MENSAJE_CREDENCIALES, MENSAJE_SERVICIO_RESTRINGIDO, MENSAJE_SERVIDOR, MENSAJE_SIN_CONEXION } from "../../src/lib/errorServicio.js";
import { mensajeErrorAuth } from "../../src/lib/recuperacion.js";
let n = 0; const F = [];
const ok = (t, c, d = "") => { if (c) { n++; console.log("OK   ", t); } else { F.push(t); console.log("FALLA", t, d); } };
const R402 = { message: "Service for this project is restricted due to the following violations: exceed_egress_quota. The project owner must upgrade their plan or remove spend caps to restore service." };
// Respuesta real observada en producción (run 43732106905): 402 con «message», sin error_description.
ok("402 real → servicio restringido", mensajeIngreso(402, R402) === MENSAJE_SERVICIO_RESTRINGIDO);
ok("402 sin cuerpo → servicio restringido", mensajeIngreso(402, {}) === MENSAJE_SERVICIO_RESTRINGIDO);
ok("402 no expone el detalle del proveedor", !/egress|spend|upgrade|quota/i.test(mensajeIngreso(402, R402)));
ok("Credenciales (GoTrue nuevo: error_code)", mensajeIngreso(400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" }) === MENSAJE_CREDENCIALES);
ok("Credenciales (GoTrue antiguo: error_description)", mensajeIngreso(400, { error: "invalid_grant", error_description: "Invalid login credentials" }) === MENSAJE_CREDENCIALES);
ok("Correo sin confirmar", /no está confirmado/.test(mensajeIngreso(400, { error_code: "email_not_confirmed", msg: "Email not confirmed" })));
ok("Demasiados intentos (429)", /Demasiados intentos/.test(mensajeIngreso(429, { msg: "Request rate limit reached" })));
ok("500 → servidor", mensajeIngreso(500, {}) === MENSAJE_SERVIDOR);
ok("503 HTML (proxy) → servidor", mensajeIngreso(503, {}) === MENSAJE_SERVIDOR);
ok("Respuesta 200 sin token → servidor", mensajeIngreso(0, {}) === MENSAJE_SERVIDOR);
ok("Ningún mensaje es el genérico «Error al ingresar»", [400, 401, 402, 429, 500, 0].every((s) => mensajeIngreso(s, {}) !== "Error al ingresar"));
ok("Credenciales ≠ restringido ≠ servidor ≠ conexión", new Set([MENSAJE_CREDENCIALES, MENSAJE_SERVICIO_RESTRINGIDO, MENSAJE_SERVIDOR, MENSAJE_SIN_CONEXION]).size === 4);
ok("Mensajes sin datos sensibles", ![MENSAJE_CREDENCIALES, MENSAJE_SERVICIO_RESTRINGIDO, MENSAJE_SERVIDOR, MENSAJE_SIN_CONEXION].some((m) => /token|supabase|gypy|key|clave:|password/i.test(m)));
ok("mensajeErrorServicio: 400 no es falla del servicio", mensajeErrorServicio(400, {}) === null);
ok("Falla temporal: 402/429/5xx sí; 400/401 no", [402, 429, 500, 503].every(esFallaTemporalServicio) && ![400, 401, 403].some(esFallaTemporalServicio));
ok("Recuperación con 402 → servicio restringido (no «enlace vencido»)", mensajeErrorAuth(402, R402, "x") === MENSAJE_SERVICIO_RESTRINGIDO);
ok("Recuperación con 401 sigue diciendo «expiró»", /expiró/.test(mensajeErrorAuth(401, { msg: "invalid JWT" }, "x")));
ok("Recuperación 429 sigue pidiendo esperar", /esperar 37 segundos/.test(mensajeErrorAuth(429, { msg: "only request this after 37 seconds" }, "x")));
// Falla de red → mensaje de conexión, marcado como red.
const fOrig = globalThis.fetch; globalThis.fetch = async () => { throw new TypeError("Load failed"); };
try { await pedir("https://x", {}); ok("Sin conexión lanza", false); } catch (e) { ok("Sin conexión (Safari «Load failed») → mensaje de conexión", e.message === MENSAJE_SIN_CONEXION && e.red === true); }
globalThis.fetch = fOrig;
console.log(`\n${n} OK, ${F.length} fallas`); process.exit(F.length ? 1 : 0);
