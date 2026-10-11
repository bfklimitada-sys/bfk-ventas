// Extractor de productos (lib + /api/producto) con páginas SIMULADAS: nada sale a la red.
// Uso: node docs/pruebas-cotizaciones/extraer.test.mjs
import { extraerProducto, extraerDeTexto, numeroPrecio } from "../../src/lib/extraerProducto.js";
import handler, { dep, ipPrivada, urlPermitida } from "../../api/producto.mjs";

const F = []; let nOk = 0;
const ok = (k, v, d) => { if (!v) { F.push(k); console.log("FALLA " + k + (d !== undefined ? " :: " + JSON.stringify(d).slice(0, 400) : "")); } else { nOk++; console.log("OK    " + k); } };

// Página tipo Falabella: JSON-LD + especificaciones en __NEXT_DATA__.
const FALABELLA = `<html><head><title>Consola PS5 | falabella.com</title>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Consola PS5 Slim Standard + 2 Juegos","brand":{"@type":"Brand","name":"Sony"},"sku":"17055793",
"image":["https://media.falabella.com/a.jpg","https://media.falabella.com/b.jpg","https://media.falabella.com/a.jpg"],"description":"Consola &amp; juegos",
"offers":{"@type":"AggregateOffer","lowPrice":"569.990","priceCurrency":"CLP","availability":"https://schema.org/InStock"}}</script>
<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"productData":{"attributes":{"specifications":[
{"name":"Marca","value":"Sony"},{"name":"Modelo","value":"CFI-2015"},{"name":"Color","value":"Blanco"},{"name":"Capacidad de almacenamiento","value":"1 TB"},
{"name":"Resolución máxima","value":"4K"},{"name":"Envío","value":"Gratis sobre $19.990"},{"name":"Precio normal","value":"$619.990"},{"name":"Manual","value":"https://x.cl/m.pdf"}]}}}}}</script>
</head><body></body></html>`;
{
  const r = extraerProducto(FALABELLA, "https://www.falabella.com/falabella-cl/product/17055793/x", new Date("2026-10-11T12:00:00Z"));
  ok("X1_nombre_marca_modelo_color", r.ficha.nombre === "Consola PS5 Slim Standard + 2 Juegos" && r.ficha.marca === "Sony" && r.ficha.modelo === "CFI-2015" && r.ficha.color === "Blanco", r.ficha);
  ok("X2_precio_clp_iva_incluido", r.precio_origen === 569990 && r.moneda === "CLP" && r.precio_incluye_iva === true, r.precio_origen);
  ok("X3_disponibilidad", r.disponibilidad === "En stock");
  ok("X4_imagenes_sin_duplicados", r.ficha.imagenes.length === 2);
  ok("X5_especificaciones_sin_datos_comerciales", r.ficha.especificaciones.map((p) => p.etiqueta).join("|") === "Capacidad de almacenamiento|Resolución máxima", r.ficha.especificaciones);
  ok("X6_procedencia_y_fecha", r.fuente === "falabella.com" && r.fecha_consulta === "2026-10-11T12:00:00.000Z" && r.metodos.includes("json-ld") && r.metodos.includes("datos-pagina"), r);
  ok("X7_envio_siempre_por_verificar", r.advertencias.some((a) => /envío no se obtiene/i.test(a)));
  ok("X8_entidades_html", r.ficha.descripcion === "Consola & juegos");
}
// Página tipo Mercado Libre: grupos de atributos {name, value_name} en el estado precargado.
const ML = `<html><head><meta property="og:title" content="Silla Ejecutiva Ergonómica Cuero"><meta property="og:image" content="//http2.mlstatic.com/silla.jpg">
<meta itemprop="price" content="82865"></head><body><script>window.__PRELOADED_STATE__ = {"initialState":{"components":{"highlighted_specs_attrs":{"groups":[
{"attributes":[{"name":"Marca","value_name":"Genérica"},{"name":"Modelo","value_name":"SE-2000"},{"name":"Material del tapizado","value_name":"Cuero sintético"},{"name":"Altura máxima","value_name":"120 cm"}]},
{"attributes":[{"name":"Peso máximo soportado","value_name":"120 kg"},{"name":"Con apoyabrazos","value_name":"Sí"}]}]}}}};</script></body></html>`;
{
  const r = extraerProducto(ML, "https://articulo.mercadolibre.cl/MLC-1485556773-silla");
  ok("X9_mercadolibre_atributos_agrupados", r.ficha.marca === "Genérica" && r.ficha.modelo === "SE-2000" && r.ficha.especificaciones.length === 4, r.ficha);
  ok("X10_open_graph_nombre_imagen", r.ficha.nombre === "Silla Ejecutiva Ergonómica Cuero" && r.ficha.imagenes[0] === "https://http2.mlstatic.com/silla.jpg", r.ficha);
  ok("X11_sin_precio_estructurado_avisa", r.precio_origen === null && r.advertencias.some((a) => /precio/i.test(a)) && !r.completo);
}
// Tienda genérica: tabla HTML y lista de definición.
{
  const html = `<title>Cable UTP Cat6 - Tienda</title><table><tr><th>Categoría</th><td>6</td></tr><tr><th>Largo</th><td>305 m</td></tr><tr><td>Despacho</td><td>Gratis</td></tr></table><dl><dt>Marca</dt><dd>Nexxt</dd></dl>`;
  const r = extraerProducto(html, "https://tienda.ejemplo.cl/cable");
  ok("X12_tabla_html_y_dl", r.ficha.nombre === "Cable UTP Cat6" && r.ficha.marca === "Nexxt" && r.ficha.especificaciones.length === 2 && r.metodos.includes("tabla-html"), r.ficha);
}
// Página sin datos (bloqueo, captcha, enlace a portada).
{
  const r = extraerProducto("<html><body>Verifica que no eres un robot</body></html>", "https://www.paris.cl/x");
  ok("X13_pagina_vacia_no_inventa", !r.ficha.nombre && r.precio_origen === null && !r.ficha.especificaciones.length && r.advertencias.length >= 4 && !r.completo);
}
ok("X14_numero_precio", numeroPrecio("$1.234.990") === 1234990 && numeroPrecio("1,234,990") === 1234990 && numeroPrecio("569990.00") === 569990 && numeroPrecio("0") === null && numeroPrecio("abc") === null);
{
  const r = extraerDeTexto("Tipo de impresión: Inyección a color\nResolución (DPI)\tHasta 1200 x 1200 dpi\nMarca: HP\nModelo: SMART TANK 580\nConectividad\nUSB, Wifi");
  ok("X15_texto_pegado", r.ficha.marca === "HP" && r.ficha.modelo === "SMART TANK 580" && r.ficha.especificaciones.length === 3 && r.fuente === "texto pegado", r.ficha);
}

// ── Seguridad del endpoint ──
ok("X16_ip_privadas", ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "::ffff:10.0.0.1", "0.0.0.0"].every(ipPrivada) && !ipPrivada("200.14.85.10") && !ipPrivada("2800:3f0::1"));
dep.lookup = async (h) => { if (h.endsWith(".invalid")) throw new Error("ENOTFOUND"); if (h === "interno.ejemplo.cl") return [{ address: "10.0.0.5" }]; return [{ address: "200.14.85.10" }]; };
const rech = await Promise.all(["ftp://x.cl/a", "http://localhost/a", "http://127.0.0.1/a", "https://[::1]/a", "https://intranet/a", "https://interno.ejemplo.cl/a", "https://x.cl:8080/a", "https://u:p@x.cl/a"].map(urlPermitida));
ok("X17_urls_no_publicas_rechazadas", rech.every((r) => r.error), rech);
ok("X18_url_publica_aceptada", !(await urlPermitida("https://www.falabella.com/x")).error);

const respuesta = () => { const r = { code: 0, body: null, headers: {} }; return { r, res: { setHeader: (k, v) => { r.headers[k] = v; }, status(c) { r.code = c; return this; }, json(b) { r.body = b; return this; } } }; };
const sesionOK = (url) => url.includes("/auth/v1/user") ? new Response(JSON.stringify({ id: "u1" }), { status: 200 }) : url.includes("/rest/v1/perfiles") ? new Response(JSON.stringify([{ id: "u1" }]), { status: 200 }) : null;
const paginas = {
  "https://www.falabella.com/p/1": () => new Response(FALABELLA, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }),
  "https://www.falabella.com/p/viejo": () => new Response("", { status: 404 }),
  "https://www.falabella.com/p/bloqueado": () => new Response("", { status: 403 }),
  "https://www.falabella.com/p/redirige": () => new Response("", { status: 302, headers: { location: "https://interno.ejemplo.cl/admin" } }),
  "https://articulo.mercadolibre.cl/MLC-1": () => new Response("<p>Found</p>", { status: 302, headers: { location: "https://www.mercadolibre.cl/gz/account-verification?go=x" } }),
  "https://www.falabella.com/p/cloudflare": () => new Response("<html><title>Just a moment...</title></html>", { status: 403, headers: { server: "cloudflare", "content-type": "text/html" } }),
  "https://www.tienda.cl/portada": () => new Response("<html><head><title>Tienda - Inicio</title></head><body>Bienvenido</body></html>", { status: 200, headers: { "content-type": "text/html" } }),
  "https://media.falabella.com/a.jpg": () => new Response(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), { status: 200, headers: { "content-type": "image/jpeg" } }),
  "https://media.falabella.com/no-imagen": () => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }),
};
const llamadas = [];
dep.fetch = async (url) => { llamadas.push(String(url)); const s = sesionOK(String(url)); if (s) return s; const f = paginas[String(url)]; if (!f) throw new Error("red no permitida en prueba: " + url); return f(); };
const llamar = async (query, auth = "Bearer t") => { const { r, res } = respuesta(); await handler({ method: "GET", headers: auth ? { authorization: auth } : {}, query }, res); return r; };

let r = await llamar({ url: "https://www.falabella.com/p/1" }, null);
ok("X19_sin_sesion_401_y_sin_consultar_proveedor", r.code === 401 && !llamadas.some((u) => u.includes("falabella")), r);
r = await llamar({ url: "https://www.falabella.com/p/1" });
ok("X20_consulta_completa", r.code === 200 && r.body.ok && r.body.precio_origen === 569990 && r.body.ficha.modelo === "CFI-2015" && r.headers["Cache-Control"] === "no-store", r.body);
r = await llamar({ url: "https://www.falabella.com/p/viejo" });
ok("X21_enlace_caido_404", r.code === 422 && /ya no existe/.test(r.body.error), r.body);
r = await llamar({ url: "https://tienda-cerrada.invalid/p" });
ok("X22_sitio_inexistente", r.code === 422 && /No se encontró el sitio/.test(r.body.error), r.body);
r = await llamar({ url: "https://www.falabella.com/p/bloqueado" });
ok("X23_bloqueo_sugiere_ingreso_manual", r.code === 422 && /manualmente/.test(r.body.error) && r.body.bloqueo === true, r.body);
r = await llamar({ url: "https://www.falabella.com/p/redirige" });
ok("X24_redireccion_a_red_interna_bloqueada", r.code === 422 && /no permitida/.test(r.body.error) && !llamadas.includes("https://interno.ejemplo.cl/admin"), r.body);
r = await llamar({ url: "https://articulo.mercadolibre.cl/MLC-1" });
ok("X28_verificacion_ml_no_es_producto", r.code === 422 && r.body.bloqueo === true && /antibots/.test(r.body.error) && !llamadas.some((u) => u.includes("account-verification")), r.body);
r = await llamar({ url: "https://www.falabella.com/p/cloudflare" });
ok("X29_cloudflare_403_bloqueo", r.code === 422 && r.body.bloqueo === true && /Pegar texto de ficha/.test(r.body.error), r.body);
r = await llamar({ url: "https://www.tienda.cl/portada" });
ok("X30_pagina_sin_producto_no_propone_ficha_vacia", r.code === 422 && /no entregó datos del producto/.test(r.body.error), r.body);
r = await llamar({ imagen: "https://media.falabella.com/a.jpg" });
ok("X25_imagen_como_data_url", r.code === 200 && r.body.dataUrl === "data:image/jpeg;base64,/9j/2Q==", r.body);
r = await llamar({ imagen: "https://media.falabella.com/no-imagen" });
ok("X26_imagen_tipo_invalido", r.code === 422);
r = await llamar({});
ok("X27_sin_enlace_400", r.code === 400);

console.log(`\n${nOk} OK · ${F.length} fallas`);
process.exit(F.length ? 1 : 0);
