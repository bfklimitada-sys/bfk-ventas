// Capturas de pantalla → ficha: reglas de interpretación (no inventar) y servicio de IA opcional (sin llamadas reales).
// Uso: node docs/pruebas-cotizaciones/capturas.test.mjs
import { lecturaDesdeTexto, resultadoDesdeLectura, preciosVisibles } from "../../src/lib/capturaImagen.js";
import handler, { dep, INSTRUCCION } from "../../api/interpretar.mjs";

const F = []; let nOk = 0;
const ok = (k, v, d) => { if (!v) { F.push(k); console.log("FALLA " + k + (d !== undefined ? " :: " + JSON.stringify(d).slice(0, 400) : "")); } else { nOk++; console.log("OK    " + k); } };

// Texto típico leído por OCR de una publicación de Mercado Libre
const ML = `22:41\nmercadolibre.cl\nNuevo | +1000 vendidos\nImpresora Multifuncional HP Smart Tank 580\n4.8 (2.315 opiniones)\n$ 219.990\n$ 189.990 15% OFF\nen 6 cuotas de $ 31.665\nEnvío gratis\nStock disponible\nCaracterísticas del producto\nMarca HP\nModelo Smart Tank 580\nTipo de impresión Inyección a color\nConectividad USB, Wi-Fi\nResolución: 4800 x 1200 dpi\nVendido por TIENDA OFICIAL HP`;
{
  const r = resultadoDesdeLectura(lecturaDesdeTexto(ML), { enlace: "https://articulo.mercadolibre.cl/MLC-1-x" });
  ok("T1_nombre_marca_modelo", r.ficha.nombre === "Impresora Multifuncional HP Smart Tank 580" && r.ficha.marca === "HP" && r.ficha.modelo === "Smart Tank 580", r.ficha);
  ok("T2_especificaciones", r.ficha.especificaciones.map((p) => p.etiqueta).join("|") === "Tipo de impresión|Conectividad|Resolución", r.ficha.especificaciones);
  ok("T3_varios_precios_no_elige", r.precio_origen === null && r.advertencias.some((a) => /varios precios \(\$219\.990, \$189\.990\)/.test(a)), r.advertencias);
  ok("T4_cuotas_no_son_precio", !preciosVisibles(["en 6 cuotas de $ 31.665"]).length && preciosVisibles(["$ 189.990"])[0] === 189990);
  ok("T5_disponibilidad_nunca_supuesta", r.disponibilidad === "" && !JSON.stringify(r.ficha).includes("Stock"));
  ok("T6_sin_comerciales_ni_vendedor", !/env[ií]o|vendido|cuota|opiniones/i.test(JSON.stringify(r.ficha)), r.ficha);
  ok("T7_envio_por_verificar_y_fotos", r.advertencias.some((a) => /envío no se obtiene/.test(a)) && r.advertencias.some((a) => /Agregar foto/.test(a)) && r.ficha.imagenes.length === 0);
  ok("T8_procedencia", r.fuente === "articulo.mercadolibre.cl (capturas de pantalla)" && r.metodos[0] === "ocr");
}
{
  const r = resultadoDesdeLectura(lecturaDesdeTexto("Cable UTP Cat6 305 metros Nexxt\n$ 89.990\nMarca\nNexxt\nCategoría\n6"));
  ok("T9_un_precio_con_aviso_de_verificar", r.precio_origen === 89990 && r.advertencias.some((a) => /verifícalo/.test(a)));
  ok("T10_tabla_en_dos_lineas", r.ficha.marca === "Nexxt" && r.ficha.especificaciones.some((p) => p.etiqueta === "Categoría" && p.valor === "6"), r.ficha);
}
{
  const r = resultadoDesdeLectura(lecturaDesdeTexto("12:00\nInicio\nBuscar"));
  ok("T11_captura_sin_datos_queda_vacia", !r.ficha.nombre && r.precio_origen === null && !r.ficha.especificaciones.length && r.advertencias.some((a) => /ingrésalo/.test(a)));
}

// Servicio de IA opcional (red simulada; nunca llama al servicio real)
const llamadas = [];
let env = {};
dep.env = () => env;
dep.fetch = async (url, o) => {
  const u = String(url); llamadas.push({ u, o });
  if (u.includes("/auth/v1/user")) return new Response(JSON.stringify({ id: "u1" }), { status: 200 });
  if (u.includes("/rest/v1/perfiles")) return new Response(JSON.stringify([{ id: "u1" }]), { status: 200 });
  if (u === "https://api.anthropic.com/v1/messages") return new Response(JSON.stringify({ content: [{ type: "text", text: '```json\n{"nombre":"Impresora HP Smart Tank 580","marca":"HP","modelo":"Smart Tank 580","color":null,"descripcion":null,"especificaciones":[{"etiqueta":"Tipo de impresión","valor":"Inyección"},{"etiqueta":"Envío","valor":"Gratis"}],"precios_visibles":[189990]}\n```' }] }), { status: 200 });
  throw new Error("red no permitida: " + u);
};
const resp = () => { const r = { code: 0, body: null }; return { r, res: { setHeader() {}, status(c) { r.code = c; return this; }, json(b) { r.body = b; return this; } } }; };
const llamar = async (method, body, auth = "Bearer t") => { const { r, res } = resp(); await handler({ method, headers: auth ? { authorization: auth } : {}, body }, res); return r; };
const IMG = "data:image/jpeg;base64,/9j/2Q==";
let r = await llamar("GET", null, null);
ok("A1_requiere_sesion", r.code === 401);
r = await llamar("GET");
ok("A2_sin_clave_no_configurado", r.code === 200 && r.body.configurado === false);
r = await llamar("POST", { imagenes: [IMG] });
ok("A3_sin_clave_no_llama_a_ia", r.code === 503 && !llamadas.some((x) => x.u.includes("anthropic")));
env = { ANTHROPIC_API_KEY: "sk-prueba-SECRETA" };
r = await llamar("GET");
ok("A4_con_clave_configurado", r.body.configurado === true && !JSON.stringify(r.body).includes("SECRETA"));
r = await llamar("POST", { imagenes: [IMG, "data:text/html;base64,AAAA"], enlace: "https://www.falabella.com/x" });
const ia = llamadas.find((x) => x.u.includes("anthropic")); const cuerpo = ia ? JSON.parse(ia.o.body) : {};
ok("A5_llamada_ia_correcta", ia && ia.o.headers["x-api-key"] === "sk-prueba-SECRETA" && ia.o.headers["anthropic-version"] === "2023-06-01" && cuerpo.model === "claude-haiku-5-5" && cuerpo.temperature === 0 && cuerpo.messages[0].content.filter((c) => c.type === "image").length === 1, cuerpo.model);
ok("A6_instruccion_no_inventar", /Nunca deduzcas, completes ni inventes/.test(INSTRUCCION) && /No incluyas disponibilidad ni costos de envío/.test(INSTRUCCION));
ok("A7_resultado_con_mismas_reglas", r.code === 200 && r.body.resultado.ficha.modelo === "Smart Tank 580" && r.body.resultado.precio_origen === 189990 && r.body.resultado.metodos[0] === "ia"
  && !r.body.resultado.ficha.especificaciones.some((p) => /Envío/.test(p.etiqueta)) && r.body.resultado.disponibilidad === "", r.body);
ok("A8_clave_nunca_en_respuesta", !JSON.stringify(r.body).includes("SECRETA"));
r = await llamar("POST", { imagenes: [] });
ok("A9_sin_imagenes_400", r.code === 400);

console.log(`\n${nOk} OK · ${F.length} fallas`);
process.exit(F.length ? 1 : 0);
