// Interruptor central de Inteligencia Comercial (06/11/2026). Prueba el servidor REAL (api/inteligencia.mjs) con la red
// SIMULADA: se reemplaza globalThis.fetch por un contador. Nada sale a la red y no se consume ninguna API real.
// Uso: node docs/pruebas-inteligencia/interruptor.test.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "../..");
let F = 0, N = 0;
const ok = (k, c, d) => { N++; if (c) console.log("OK    " + k); else { F++; console.log("FALLA " + k + (d !== undefined ? " :: " + JSON.stringify(d).slice(0, 400) : "")); } };

// ── Red simulada: registra cada URL pedida y responde según la regla de cada prueba ──
const llamadas = [];
let responderInterruptor = () => new Response(JSON.stringify({ code: "PGRST202", message: "Could not find the function public.ic_interruptor_estado" }), { status: 404 });
globalThis.fetch = async (url, init) => {
  const u = String(url); llamadas.push({ u, metodo: init?.method || "GET" });
  if (u.includes("/rpc/ic_interruptor_estado")) return responderInterruptor();
  return new Response(JSON.stringify({ simulado: true }), { status: 200 });   // cualquier otra llamada queda contada
};
const { leerInterruptor, crearManejador, RESPUESTA_DESACTIVADA, default: manejadorPublicado } = await import(join(RAIZ, "api/inteligencia.mjs"));
const resp = () => { const r = { code: 0, body: null, headers: {} }; return { r, res: { setHeader: (k, v) => { r.headers[k] = v; }, status(c) { r.code = c; return this; }, json(b) { r.body = b; return this; } } }; };
const externas = () => llamadas.filter((l) => !l.u.includes("/rpc/ic_interruptor_estado"));
const aChileCompra = () => llamadas.filter((l) => /mercadopublico\.cl/.test(l.u));
const aIA = () => llamadas.filter((l) => /anthropic\.com|openai\.com|googleapis\.com\/.*generat/i.test(l.u));

// 1) Lectura del interruptor: solo { habilitada: true } exacto activa; todo lo demás es DESACTIVADA.
const casos = [
  ["funcion_no_instalada_404", () => new Response("{}", { status: 404 }), false],
  ["error_500", () => new Response("{}", { status: 500 }), false],
  ["permiso_401", () => new Response("{}", { status: 401 }), false],
  ["cuerpo_no_json", () => new Response("<html>", { status: 200 }), false],
  ["null", () => new Response("null", { status: 200 }), false],
  ["arreglo", () => new Response("[]", { status: 200 }), false],
  ["arreglo_con_true", () => new Response('[{"habilitada":true}]', { status: 200 }), false],
  ["texto_true", () => new Response('{"habilitada":"true"}', { status: 200 }), false],
  ["numero_1", () => new Response('{"habilitada":1}', { status: 200 }), false],
  ["falso_explicito", () => new Response('{"habilitada":false}', { status: 200 }), false],
  ["sin_campo", () => new Response('{"estado":"activa"}', { status: 200 }), false],
  ["red_caida", () => { throw new TypeError("fetch failed"); }, false],
  ["habilitada_true_explicito", () => new Response('{"habilitada":true,"cambiado_por":"admin"}', { status: 200 }), true],
];
for (const [n, fn, esperado] of casos) { responderInterruptor = fn; ok(`I01_lectura_${n}_=_${esperado ? "habilitada" : "desactivada"}`, (await leerInterruptor()) === esperado); }

// 2) Manejador PUBLICADO (export default, el mismo que usa Vercel) con la función del interruptor ausente, como hoy en
//    producción: toda solicitud recibe 423 y la única llamada de red es la lectura del interruptor.
responderInterruptor = () => new Response(JSON.stringify({ code: "PGRST202" }), { status: 404 });
const solicitudes = [
  ["post_manual", { method: "POST", headers: { authorization: "Bearer tk-admin" }, body: { origen: "manual" } }],
  ["post_automatica", { method: "POST", headers: { authorization: "Bearer tk-admin" }, body: { origen: "automatica" } }],
  ["post_forzar", { method: "POST", headers: { authorization: "Bearer tk-admin" }, body: { origen: "manual", forzar: true } }],
  ["post_codigos", { method: "POST", headers: { authorization: "Bearer tk-admin" }, body: { codigos: ["1001-2-COT26"] } }],
  ["post_texto", { method: "POST", headers: { authorization: "Bearer tk-admin" }, body: '{"origen":"manual"}' }],
  ["post_sin_sesion", { method: "POST", headers: {}, body: {} }],
  ["get", { method: "GET", headers: {} }],
];
for (const [n, req] of solicitudes) {
  llamadas.length = 0; const { r, res } = resp(); await manejadorPublicado(req, res);
  ok(`I02_${n}_responde_423_desactivada`, r.code === 423 && r.body?.codigo === "IC_DESACTIVADA" && r.body?.ok === false, r);
  ok(`I02_${n}_sin_llamadas_externas`, externas().length === 0 && aChileCompra().length === 0 && aIA().length === 0, llamadas);
  ok(`I02_${n}_una_sola_lectura_del_interruptor`, llamadas.length === 1, llamadas);
}
// Ráfaga (como un navegador con la versión anterior que reintenta): 50 solicitudes seguidas → 0 llamadas a ChileCompra.
llamadas.length = 0;
for (let i = 0; i < 50; i++) { const { res } = resp(); await manejadorPublicado({ method: "POST", headers: { authorization: "Bearer x" }, body: { origen: "automatica" } }, res); }
ok("I03_rafaga_50_solicitudes_0_ChileCompra_0_IA", aChileCompra().length === 0 && aIA().length === 0 && externas().length === 0, { total: llamadas.length });

// 3) Con dependencias contadas: desactivado no valida sesión, no lee la cola, no lee el ticket, no llama a ChileCompra.
const cont = { validar: 0, rpcDe: 0, ticket: 0, f: 0 };
const mk = (interruptor) => crearManejador({ interruptor,
  validar: async () => { cont.validar++; return { uid: "a", token: "t", admin: true }; },
  rpcDe: () => { cont.rpcDe++; return async () => []; }, ticketDe: () => { cont.ticket++; return "T"; }, f: async () => { cont.f++; return new Response("{}"); } });
for (const [n, fn] of [["false", () => false], ["undefined", () => undefined], ["texto", () => "true"], ["lanza_error", () => { throw new Error("x"); }], ["promesa_rechazada", () => Promise.reject(new Error("x"))]]) {
  Object.keys(cont).forEach((k) => { cont[k] = 0; });
  const { r, res } = resp(); await mk(fn)({ method: "POST", headers: {}, body: { origen: "manual" } }, res);
  ok(`I04_interruptor_${n}_bloquea_antes_de_todo`, r.code === 423 && cont.validar === 0 && cont.rpcDe === 0 && cont.ticket === 0 && cont.f === 0, { code: r.code, cont });
}
// Habilitado de forma explícita: sigue el camino normal (aquí sin pendientes → "Todo al día"); prueba que el bloqueo no
// rompe la reactivación futura.
{
  Object.keys(cont).forEach((k) => { cont[k] = 0; });
  const { r, res } = resp(); await mk(() => true)({ method: "POST", headers: {}, body: { origen: "manual" } }, res);
  ok("I05_habilitado_explicito_sigue_flujo_normal", r.code === 200 && r.body.ok && cont.validar === 1 && cont.f === 0, { code: r.code, body: r.body, cont });
}
ok("I06_mensaje_desactivada_claro", /desactivada/i.test(RESPUESTA_DESACTIVADA.error) && /administrador/i.test(RESPUESTA_DESACTIVADA.error));

// 4) Código fuente: ni el servidor ni la interfaz de IC llaman a un proveedor de IA; la vista de IC no sincroniza sola.
const fuentes = ["api/inteligencia.mjs", "src/lib/inteligenciaDatos.js", "src/lib/inteligenciaComercial.js", "src/components/inteligencia/InteligenciaComercial.jsx", "src/components/inteligencia/Graficos.jsx", "src/lib/interruptorIC.js", "src/components/inteligencia/AdminInteligencia.jsx"];
const texto = fuentes.map((p) => readFileSync(join(RAIZ, p), "utf8")).join("\n");
ok("I07_IC_sin_proveedor_de_IA_en_el_codigo", !/anthropic|openai|ANTHROPIC_API_KEY|claude-|gpt-|gemini/i.test(texto));
const ic = readFileSync(join(RAIZ, "src/components/inteligencia/InteligenciaComercial.jsx"), "utf8");
ok("I08_vista_IC_sin_sincronizacion_automatica", !/origen:\s*["']automatica["']/.test(ic) && !/AUTO_HORAS/.test(ic));
const dash = readFileSync(join(RAIZ, "src/components/panels/PanelDashboard.jsx"), "utf8");
ok("I09_inicio_no_carga_IC", !/InteligenciaComercial|inteligencia/i.test(dash.replace(/\/\/.*$/gm, "")));
const vj = JSON.parse(readFileSync(join(RAIZ, "vercel.json"), "utf8"));
ok("I10_vercel_sin_crons", !vj.crons || vj.crons.length === 0);

console.log(`interruptor IC: ${N - F}/${N} correctas`);
process.exit(F ? 1 : 0);
