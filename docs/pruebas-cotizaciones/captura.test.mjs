// Captura desde Safari: codificación/validación y el código EXACTO del atajo ejecutado en páginas simuladas (Chromium).
// Uso: node docs/pruebas-cotizaciones/captura.test.mjs   (requiere NODE_PATH con playwright-core)
import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { codificarCaptura, decodificarCaptura, validarCaptura, capturaDeHash, VERSION_CAPTURA } from "../../src/lib/captura.js";
import { codigoAtajo, CODIGO_ATAJO_PLANTILLA } from "../../src/lib/atajoSafari.generado.js";

const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const F = []; let nOk = 0;
const ok = (k, v, d) => { if (!v) { F.push(k); console.log("FALLA " + k + (d !== undefined ? " :: " + JSON.stringify(d).slice(0, 400) : "")); } else { nOk++; console.log("OK    " + k); } };

// 1. Codificación y validación
const base = { v: VERSION_CAPTURA, enlace: "https://www.falabella.com/falabella-cl/product/1/x", ficha: { nombre: "Impresora “Smart Tank” 580 ñ", marca: "HP", modelo: "580", especificaciones: [{ etiqueta: "Tipo", valor: "Tinta" }], imagenes: ["https://media.falabella.com/a.jpg", "javascript:alert(1)"] }, precio_origen: "187990", fuente: "falabella.com", metodos: ["json-ld"], advertencias: [] };
const ida = decodificarCaptura(codificarCaptura(validarCaptura(base)));
ok("K1_ida_y_vuelta_utf8", ida.ficha.nombre === "Impresora “Smart Tank” 580 ñ" && ida.precio_origen === 187990 && ida.ficha.modelo === "580");
ok("K2_solo_urls_http", ida.ficha.imagenes.length === 1 && ida.ficha.imagenes[0].startsWith("https://media"));
ok("K3_rechaza_version_o_sin_enlace", (() => { try { validarCaptura({ ...base, v: 9 }); return false; } catch { /* */ } try { validarCaptura({ ...base, enlace: "ftp://x" }); return false; } catch { return true; } })());
const grande = validarCaptura({ ...base, ficha: { ...base.ficha, descripcion: "x".repeat(20000), especificaciones: Array.from({ length: 500 }, (_, i) => ({ etiqueta: "E" + i, valor: "v".repeat(900) })), imagenes: Array.from({ length: 30 }, (_, i) => `https://a.cl/${i}.jpg`) } });
ok("K4_limites", grande.ficha.descripcion.length === 3000 && grande.ficha.especificaciones.length === 80 && grande.ficha.especificaciones[0].valor.length === 300 && grande.ficha.imagenes.length === 6);
ok("K5_campos_desconocidos_descartados", !("token" in validarCaptura({ ...base, token: "x", ficha: { ...base.ficha, script: "x" } })) && !("script" in ida.ficha));
ok("K6_hash", capturaDeHash("#/cotizaciones?captura=" + codificarCaptura(base))?.ok === true && capturaDeHash("#/cotizaciones?captura=xxx")?.ok === false
  && /no pudo leer la página: falló/.test(capturaDeHash("#/cotizaciones?captura_error=fall%C3%B3").error) && capturaDeHash("#/compras") === null);

// 2. Código generado al día con sus fuentes
const tmp = mkdtempSync(join(tmpdir(), "atajo-"));
execFileSync("node", ["-e", `const {buildSync}=require("esbuild");const r=buildSync({entryPoints:["src/atajo/entrada.js"],bundle:true,minify:true,format:"iife",target:["safari15"],write:false,legalComments:"none"});require("fs").writeFileSync("${tmp}/a.js",r.outputFiles[0].text.trim())`]);
ok("K7_codigo_del_atajo_al_dia", readFileSync(`${tmp}/a.js`, "utf8") === CODIGO_ATAJO_PLANTILLA, "ejecuta: node scripts/generar-atajo.mjs");
ok("K8_direccion_de_la_app_insertada", !codigoAtajo("https://bfk-ventas.vercel.app/").includes("__BFK_APP__") && codigoAtajo("https://bfk-ventas.vercel.app/").includes('"https://bfk-ventas.vercel.app"'));

// 3. El código exacto del atajo en páginas simuladas (como "Ejecutar JavaScript en página web" de Atajos)
const FALABELLA = `<!doctype html><html><head><title>Impresora | falabella.com</title>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Impresora Multifuncional HP Smart Tank 580","brand":{"@type":"Brand","name":"HP"},"image":["https://media.falabella.com/a.jpg","https://media.falabella.com/b.jpg"],"description":"Tanque de tinta","offers":{"@type":"Offer","price":"189990","priceCurrency":"CLP","availability":"https://schema.org/InStock"}}</script>
<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"productData":{"attributes":{"specifications":[{"name":"Modelo","value":"Smart Tank 580"},{"name":"Color","value":"Blanco"},{"name":"Tipo de impresión","value":"Inyección a color"},{"name":"Conectividad","value":"USB, Wifi"},{"name":"Envío","value":"Gratis"}]}}}}}</script>
</head><body><h1>Impresora</h1></body></html>`;
// Mercado Libre: especificaciones solo en la tabla ya dibujada en la página (sin datos estructurados de atributos).
const ML = `<!doctype html><html><head><meta property="og:title" content="Silla Ejecutiva Ergonómica"><meta property="og:image" content="//http2.mlstatic.com/D_silla.jpg"><meta itemprop="price" content="82865">
<script type="application/ld+json">{"@type":"Product","name":"Silla Ejecutiva Ergonómica","offers":{"price":82865,"priceCurrency":"CLP"},"image":"https://http2.mlstatic.com/D_silla.jpg"}</script></head>
<body><div id="app"></div><script>document.getElementById("app").innerHTML = '<table><tr><th>Marca</th><td>Genérica</td></tr><tr><th>Modelo</th><td>SE-2000</td></tr><tr><th>Material</th><td>Cuero sintético</td></tr><tr><th>Altura máxima</th><td>120 cm</td></tr></table>';</script></body></html>`;
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const ejecutarAtajo = async (url, html) => {
  const ctx = await browser.newContext(); const p = await ctx.newPage();
  await p.route("**/*", (r) => (r.request().url() === url ? r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html }) : r.abort()));
  await p.goto(url); await p.waitForTimeout(200);
  const res = await p.evaluate((codigo) => new Promise((ok) => { window.completion = ok; (0, eval)(codigo); }), codigoAtajo("https://bfk-ventas.vercel.app"));
  await ctx.close(); return res;
};
{
  const url = await ejecutarAtajo("https://www.falabella.com/falabella-cl/product/121339405/Impresora/121339406", FALABELLA);
  ok("S1_abre_bfk_en_cotizaciones", url.startsWith("https://bfk-ventas.vercel.app/#/cotizaciones?captura="), url.slice(0, 80));
  const c = capturaDeHash(url.slice(url.indexOf("#")))?.captura || {};
  ok("S2_falabella_nombre_marca_modelo", c.ficha?.nombre === "Impresora Multifuncional HP Smart Tank 580" && c.ficha?.marca === "HP" && c.ficha?.modelo === "Smart Tank 580" && c.ficha?.color === "Blanco", c.ficha);
  ok("S3_falabella_especificaciones_sin_comerciales", c.ficha?.especificaciones.map((x) => x.etiqueta).join("|") === "Tipo de impresión|Conectividad", c.ficha?.especificaciones);
  ok("S4_imagenes_y_enlace_original", c.ficha?.imagenes.length === 2 && c.enlace === "https://www.falabella.com/falabella-cl/product/121339405/Impresora/121339406");
  ok("S5_precio_interno_y_envio_por_verificar", c.precio_origen === 189990 && c.disponibilidad === "En stock" && c.advertencias.some((a) => /envío no se obtiene/i.test(a)));
  ok("S6_direccion_de_tamano_razonable", url.length < 8000, url.length);
}
{
  const url = await ejecutarAtajo("https://articulo.mercadolibre.cl/MLC-1434913337-silla-_JM", ML);
  const c = capturaDeHash(url.slice(url.indexOf("#")))?.captura || {};
  ok("S7_ml_tabla_dibujada_en_pagina", c.ficha?.marca === "Genérica" && c.ficha?.modelo === "SE-2000" && c.ficha?.especificaciones.length === 2 && c.precio_origen === 82865 && c.ficha?.imagenes[0] === "https://http2.mlstatic.com/D_silla.jpg", c.ficha);
}
{
  const url = await ejecutarAtajo("https://www.paris.cl/verificacion", "<html><body>Verifica que no eres un robot</body></html>");
  const r = capturaDeHash(url.slice(url.indexOf("#")));
  ok("S8_pagina_sin_datos_llega_vacia_para_completar", r?.ok === true && !r.captura.ficha.nombre && r.captura.precio_origen === null && r.captura.advertencias.length >= 3);
}
await browser.close();
console.log(`\n${nOk} OK · ${F.length} fallas`);
process.exit(F.length ? 1 : 0);
