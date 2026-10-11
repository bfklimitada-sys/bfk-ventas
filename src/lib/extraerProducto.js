// ═══════════════════════════════════════════════════════════════
// Extracción de datos técnicos y comerciales desde el HTML de una página de proveedor
// (Falabella, Mercado Libre, Sodimac, Paris, PC Factory u otros). Función pura: recibe el HTML ya descargado.
// Fuentes, en orden de confiabilidad: datos estructurados schema.org (JSON-LD) → datos embebidos de la
// página (__NEXT_DATA__ / estado precargado) → metadatos Open Graph → tablas de especificaciones del HTML.
// Todo resultado es una PROPUESTA: el usuario la revisa y corrige antes de guardarla.
// El envío NUNCA se extrae como gratis: siempre queda por verificar manualmente.
// ═══════════════════════════════════════════════════════════════

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", ntilde: "ñ", Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú", Ntilde: "Ñ", uuml: "ü", deg: "°", ordm: "º", ordf: "ª", reg: "®", trade: "™", times: "×", laquo: "«", raquo: "»", iexcl: "¡", iquest: "¿" };
export const decodificar = (s) => String(s ?? "")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&([a-z]+);/gi, (m, n) => ENT[n] ?? m);
const sinEtiquetas = (s) => decodificar(String(s ?? "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const limpio = (s) => (typeof s === "string" || typeof s === "number" ? sinEtiquetas(String(s)) : "");

export function numeroPrecio(v) {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? Math.round(v) : null;
  const s = String(v ?? "").replace(/[^\d.,]/g, "");
  if (!s) return null;
  // CLP: "1.234.990" o "1234990" o "1,234,990"; decimales poco comunes ("1234990.00").
  let n;
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) n = Number(s.replace(/[.,]/g, ""));
  else if (/^\d+[.,]\d{1,2}$/.test(s)) n = Math.round(Number(s.replace(",", ".")));
  else n = Number(s.replace(/[.,]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function absoluta(u, base) { try { const x = new URL(decodificar(String(u).trim()), base); return /^https?:$/.test(x.protocol) ? x.href : null; } catch { return null; } }

// ── JSON-LD ──
function bloquesJsonLd(html) {
  const out = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi; let m;
  while ((m = re.exec(html))) {
    const txt = m[1].trim().replace(/^<!\[CDATA\[|\]\]>$/g, "");
    try { out.push(JSON.parse(txt)); } catch { try { out.push(JSON.parse(txt.replace(/[\u0000-\u001f]+/g, " "))); } catch { /* bloque inválido */ } }
  }
  return out;
}
function recorrer(x, fn, prof = 0) {
  if (!x || prof > 40) return;
  if (Array.isArray(x)) { for (const y of x) recorrer(y, fn, prof + 1); return; }
  if (typeof x === "object") { fn(x); for (const k of Object.keys(x)) recorrer(x[k], fn, prof + 1); }
}
const esTipo = (o, t) => [].concat(o?.["@type"] || []).some((x) => String(x).toLowerCase() === t);

function productoJsonLd(bloques) {
  let mejor = null;
  for (const b of bloques) recorrer(b, (o) => { if (esTipo(o, "product") && (!mejor || Object.keys(o).length > Object.keys(mejor).length)) mejor = o; });
  return mejor;
}
const textoDe = (v) => (v && typeof v === "object" ? limpio(v.name ?? v["@value"] ?? v.value ?? "") : limpio(v));
function imagenesDe(v, base) {
  const out = [];
  for (const x of [].concat(v || [])) { const u = typeof x === "string" ? x : x?.url || x?.contentUrl; const a = u && absoluta(u, base); if (a) out.push(a); }
  return out;
}
const DISPONIBILIDAD = { instock: "En stock", outofstock: "Agotado", preorder: "Preventa", backorder: "Bajo pedido", limitedavailability: "Stock limitado", soldout: "Agotado", discontinued: "Descontinuado", onlineonly: "Solo en línea", instoreonly: "Solo en tienda" };
function ofertaDe(offers) {
  let precio = null, moneda = null, disp = null;
  recorrer(offers, (o) => {
    const p = numeroPrecio(o.price ?? o.lowPrice ?? o.priceSpecification?.price);
    if (p && (precio === null || p < precio)) { precio = p; moneda = o.priceCurrency || o.priceSpecification?.priceCurrency || moneda; }
    if (o.availability && !disp) { const k = String(o.availability).split("/").pop().toLowerCase(); disp = DISPONIBILIDAD[k] || k; }
  });
  return { precio, moneda, disponibilidad: disp };
}

// ── Datos embebidos (Next.js, estado precargado): busca listas de pares nombre/valor ──
function jsonEmbebidos(html) {
  const out = [];
  const re = /<script[^>]*(?:id=["']__NEXT_DATA__["']|type=["']application\/json["'])[^>]*>([\s\S]*?)<\/script>/gi; let m;
  while ((m = re.exec(html))) { try { out.push(JSON.parse(m[1])); } catch { /* ignorar */ } }
  const re2 = /window\.__PRELOADED_STATE__\s*=\s*(\{[\s\S]*?\});\s*<\/script>/i; const m2 = html.match(re2);
  if (m2) { try { out.push(JSON.parse(m2[1])); } catch { /* ignorar */ } }
  return out;
}
const CLAVES_NOMBRE = ["name", "label", "key", "title", "nombre", "attribute"];
const CLAVES_VALOR = ["value_name", "value", "values", "valor", "text"];
function parDe(o) {
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  const kn = CLAVES_NOMBRE.find((k) => typeof o[k] === "string" && o[k].trim()); if (!kn) return null;
  const kv = CLAVES_VALOR.find((k) => k !== kn && o[k] != null && o[k] !== "");
  if (!kv) return null;
  let v = o[kv];
  if (Array.isArray(v)) v = v.map((x) => (typeof x === "object" ? x?.name ?? x?.value ?? "" : x)).filter(Boolean).join(", ");
  if (typeof v === "object") v = v?.name ?? v?.value ?? "";
  const e = limpio(o[kn]); const val = limpio(v);
  return e && val && e.length <= 80 && val.length <= 300 ? { etiqueta: e, valor: val } : null;
}
function paresEmbebidos(objs) {
  let mejor = [];
  for (const raiz of objs) recorrer(raiz, (o) => {
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (!Array.isArray(v) || v.length < 2 || v.length > 150) continue;
      const pares = v.map(parDe).filter(Boolean);
      // Grupos de atributos (Mercado Libre: [{ attributes: [...] }])
      const anidados = v.flatMap((g) => (Array.isArray(g?.attributes) ? g.attributes.map(parDe).filter(Boolean) : []));
      const cand = pares.length >= anidados.length ? pares : anidados;
      if (cand.length >= 2 && cand.length >= v.length * 0.6 && cand.length > mejor.length) mejor = cand;
    }
  });
  return mejor;
}

// ── HTML: tablas de dos celdas y listas de definición ──
function paresHtml(html) {
  const out = [];
  const reTr = /<tr[^>]*>([\s\S]*?)<\/tr>/gi; let m;
  while ((m = reTr.exec(html))) {
    const celdas = [...m[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) => sinEtiquetas(c[1]));
    if (celdas.length === 2 && celdas[0] && celdas[1] && celdas[0].length <= 80 && celdas[1].length <= 300) out.push({ etiqueta: celdas[0], valor: celdas[1] });
  }
  const reDl = /<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi;
  while ((m = reDl.exec(html))) { const e = sinEtiquetas(m[1]), v = sinEtiquetas(m[2]); if (e && v && e.length <= 80) out.push({ etiqueta: e, valor: v }); }
  return out;
}

function meta(html, nombre) {
  const re = new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${nombre.replace(/[:.]/g, "\\$&")}["'][^>]*>`, "i");
  const tag = html.match(re)?.[0]; if (!tag) return "";
  return decodificar(tag.match(/content=["']([^"']*)["']/i)?.[1] || "").trim();
}

const normalE = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const ETQ_MARCA = new Set(["marca", "brand", "fabricante"]);
const ETQ_MODELO = new Set(["modelo", "model", "numero de modelo", "modelo del producto", "linea modelo"]);
const ETQ_COLOR = new Set(["color", "colour", "color principal"]);
// Atributos comerciales que nunca pasan a la ficha técnica.
const ETQ_COMERCIAL = /precio|price|env[ií]o|despacho|shipping|cuotas|descuento|vendedor|seller|stock|disponib|sku|c[oó]digo (de )?producto|ean|upc|gtin|retiro/i;

export function extraerProducto(html, url, ahora = new Date()) {
  const h = String(html || "");
  const metodos = []; const advertencias = [];
  let fuente = ""; try { fuente = new URL(url).hostname.replace(/^www\./, ""); } catch { /* sin dominio */ }
  const ld = productoJsonLd(bloquesJsonLd(h));
  let nombre = "", marca = "", modelo = "", color = "", descripcion = "", imagenes = [], precio = null, moneda = null, disponibilidad = null;
  let pares = [];
  if (ld) {
    metodos.push("json-ld");
    nombre = textoDe(ld.name); marca = textoDe(ld.brand) || textoDe(ld.manufacturer); modelo = textoDe(ld.model) || textoDe(ld.mpn);
    color = textoDe(ld.color); descripcion = textoDe(ld.description); imagenes = imagenesDe(ld.image, url);
    ({ precio, moneda, disponibilidad } = ofertaDe(ld.offers));
    for (const p of [].concat(ld.additionalProperty || [])) { const par = parDe({ name: p?.name, value: p?.value ?? p?.valueReference }); if (par) pares.push(par); }
  }
  const emb = paresEmbebidos(jsonEmbebidos(h));
  if (emb.length > pares.length) { pares = emb; metodos.push("datos-pagina"); }
  const og = { titulo: meta(h, "og:title"), imagen: meta(h, "og:image"), desc: meta(h, "og:description"), precio: meta(h, "product:price:amount") || meta(h, "og:price:amount"), marca: meta(h, "product:brand") };
  if (!nombre && og.titulo) { nombre = og.titulo; metodos.push("open-graph"); }
  if (!nombre) nombre = sinEtiquetas(h.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").split(/\s[|–-]\s/)[0];
  if (!imagenes.length && og.imagen) { const a = absoluta(og.imagen, url); if (a) imagenes.push(a); }
  if (!descripcion && og.desc) descripcion = og.desc;
  if (!precio && og.precio) precio = numeroPrecio(og.precio);
  if (!marca && og.marca) marca = og.marca;
  if (pares.length < 2) { const t = paresHtml(h); if (t.length > pares.length) { pares = t; metodos.push("tabla-html"); } }

  // Separar marca/modelo/color y descartar atributos comerciales o con enlaces.
  const especificaciones = []; const vistos = new Set();
  for (const p of pares) {
    const e = normalE(p.etiqueta);
    if (ETQ_MARCA.has(e)) { if (!marca) marca = p.valor; continue; }
    if (ETQ_MODELO.has(e)) { if (!modelo) modelo = p.valor; else if (normalE(modelo) !== normalE(p.valor)) especificaciones.push(p); continue; }
    if (ETQ_COLOR.has(e)) { if (!color) color = p.valor; continue; }
    if (ETQ_COMERCIAL.test(p.etiqueta) || /https?:\/\/|www\./i.test(p.valor)) continue;
    if (vistos.has(e)) continue; vistos.add(e); especificaciones.push(p);
  }
  imagenes = [...new Set(imagenes)].slice(0, 6);
  if (!nombre) advertencias.push("No se encontró el nombre del producto: ingrésalo manualmente.");
  if (!precio) advertencias.push("No se encontró el precio: ingrésalo manualmente.");
  if (!especificaciones.length) advertencias.push("No se encontraron especificaciones: complétalas o pega el texto de la ficha.");
  if (!imagenes.length) advertencias.push("No se encontraron imágenes.");
  advertencias.push("El costo de envío no se obtiene automáticamente: verifícalo con la dirección real del cliente.");
  if (moneda && moneda !== "CLP") advertencias.push(`El precio está en ${moneda}, no en pesos chilenos.`);
  return {
    ficha: { nombre: nombre.slice(0, 300), marca, modelo, color, descripcion: descripcion.slice(0, 3000), generales: [], especificaciones: especificaciones.slice(0, 80), imagenes },
    precio_origen: precio, moneda: moneda || (precio ? "CLP" : null), precio_incluye_iva: true, disponibilidad: disponibilidad || "",
    fuente, fecha_consulta: ahora.toISOString(), metodos, advertencias,
    completo: !!(nombre && precio && especificaciones.length),
  };
}

// Texto pegado por el usuario (copiado de la ficha del proveedor): "Etiqueta: valor", tabulado o alternado en líneas.
export function extraerDeTexto(texto) {
  const lineas = String(texto || "").split(/\r?\n/).map((l) => l.replace(/\u00a0/g, " ").trim()).filter(Boolean);
  const pares = []; const una = (x) => x.replace(/\s+/g, " ").trim();
  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i];
    const m = l.match(/^([^:\t]{1,80}?)\s*(?::|\t+)\s*(.+)$/) || l.match(/^(.{1,60}?) {2,}(.+)$/);
    if (m) pares.push({ etiqueta: una(m[1]), valor: una(m[2]) });
    else if (i + 1 < lineas.length && l.length <= 40 && !/[:\t]/.test(lineas[i + 1])) { pares.push({ etiqueta: l, valor: lineas[i + 1] }); i++; }
  }
  const r = extraerProducto(`<table>${pares.map((p) => `<tr><th>${p.etiqueta.replace(/</g, "&lt;")}</th><td>${p.valor.replace(/</g, "&lt;")}</td></tr>`).join("")}</table>`, "https://texto.local/");
  return { ...r, fuente: "texto pegado", metodos: ["texto"], advertencias: r.advertencias.filter((a) => !/nombre|precio|imágenes/.test(a)) };
}
