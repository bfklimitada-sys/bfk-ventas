// «Vendedor» de las EETT privadas nuevas (11/11/2026) y máximo a financiar en «Registrar compra» opción B — navegador real
// sobre una base DESECHABLE (nunca producción), en escritorio o celular.
//   · Vista previa y PDF emitido muestran el vendedor elegido en la cotización: BFK (nombre corto de la empresa) y vendedor personal;
//     sin vendedor asignado, el responsable (como antes). El responsable de la orden no cambia.
//   · Una EETT ya emitida (sin vendedor en su contenido) conserva su contenido y su PDF muestra al responsable, como antes.
//   · Opción B: bajar el precio de compra actualiza el máximo a financiar al total de la compra con su despacho.
// Uso: node e2e_eett_vendedor.mjs http://127.0.0.1:4330/ escritorio|celular
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { abrir, chromium, CHROME, U, psql, comoUsuario, sinDesborde, calma, marca, escriturasMP, archivos } from "../arnes_vp.mjs";
import { contenidoEETTVP } from "../../../src/lib/vpEETT.js";
const AQUI = dirname(fileURLToPath(import.meta.url)); const VPD = join(AQUI, "..");
const URL_APP = process.argv[2] || "http://127.0.0.1:4330/"; const MODO = process.argv[3] || "escritorio"; const movil = MODO === "celular";
let nOk = 0; const F = [];
const ok = (n, c, det = "") => { if (c) { nOk++; console.log("OK   ", n); } else { F.push(n); console.log("FALLA", n, String(det).slice(0, 500)); } };
const espera = (p, ms = 400) => p.waitForTimeout(ms);
const q1 = (sql) => psql(sql).split("\n").pop();
const lit = (s) => { const t = "q" + Math.random().toString(36).slice(2, 8); return `$${t}$${s}$${t}$`; };
const rpcJ = (u, fn, a) => JSON.parse(q1(`${comoUsuario(u)}select public.${fn}(${lit(JSON.stringify(a))}::jsonb);`));
const pdfjsMod = await import("pdfjs-dist/legacy/build/pdf.js"); const pdfjs = pdfjsMod.getDocument ? pdfjsMod : pdfjsMod.default;
async function textoPDF(buf) { const d = await pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, verbosity: 0 }).promise; const t = [];
  for (let i = 1; i <= d.numPages; i++) t.push((await (await d.getPage(i)).getTextContent()).items.map((x) => x.str).join(" ")); return t.join(" ").replace(/\s+/g, " "); }
async function descarga(p, accion) { const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 30000 }), accion()]); return readFileSync(await dl.path()); }
const vendedorPDF = (s) => (s.match(/Vendedor responsable: (.*?)\s{2,}|Vendedor responsable: (\S+(?: \S+){0,3}?) (?=Elaborado por|Fecha)/) || [])[0] || s.match(/Vendedor responsable: [^]{0,60}/)?.[0] || "";

// ── Datos: ficha técnica de la copia aislada de CP-2026-0001 (sin precios reales) y cotizaciones de prueba ───────────────
const FX = JSON.parse(readFileSync(join(VPD, "fixture_cp_2026_0001.json"), "utf8")); const ficha = FX.item.ficha; const C = FX.cat;
for (const r of ficha.imagenes) { psql(`insert into storage.objects (bucket_id, name, owner, metadata) values ('cz-productos', ${lit(r)}, '${U.ana}', '{}'::jsonb) on conflict do nothing;`); archivos.set("cz-productos/" + r, readFileSync(join(VPD, "fixture_cp_2026_0001", r.split("/").pop()))); }
psql(`insert into public.productos_catalogo (id, nombre, marca, modelo, color, descripcion_tecnica, caracteristicas, especificaciones, imagenes, fuente, estado, creado_por, ultima_revision)
  values ('${C.id}', ${lit(C.nombre)}, ${lit(C.marca)}, ${lit(C.modelo)}, ${lit(C.color)}, ${lit(C.descripcion_tecnica)}, ${lit(JSON.stringify(ficha.generales))}::jsonb, ${lit(JSON.stringify(ficha.especificaciones))}::jsonb, ${lit(JSON.stringify(ficha.imagenes))}::jsonb, 'manual', 'aprobado', '${U.ana}', now()) on conflict (id) do nothing;`);
const cliPrevio = q1(`select id from public.pi_clientes where regexp_replace(rut, '[^0-9kK]', '', 'g') = '615130036' limit 1;`);
const cli = cliPrevio || rpcJ(U.ana, "vp_guardar_cliente", { rut: "61513003-6", razon_social: "Cliente EETT (prueba)", tipo_persona: "empresa", direccion_entrega: "Santiago", comuna_entrega: "Santiago" }).id;
const empresaCorto = q1("select valor->>'nombre_corto' from public.vp_configuracion where clave = 'empresa';") || "BFK";
const responsable = q1(`select nombre from public.perfiles where id = '${U.ana}';`);
function cotizacion(vendedor) {
  const item = { tipo: "producto", producto_id: C.id, descripcion: FX.item.descripcion, unidad: "UN", cantidad: 2, precio_unitario: 59990, ficha, ficha_aprobada: true };
  const c = rpcJ(U.ana, "vp_guardar_cotizacion_v2", { cliente_id: cli, plazo_entrega: "5 días hábiles", vigencia_dias: 15, direccion_entrega: "Santiago", items: [item], ...(vendedor !== undefined ? { vendedor } : {}) });
  return { id: c.id, folio: q1(`select folio from public.vp_cotizaciones where id = '${c.id}';`), revision_id: c.revision_id };
}
const cBfk = cotizacion("bfk"), cKev = cotizacion("vend_kevin"), cSin = cotizacion();
// EETT YA EMITIDA (contenido sin vendedor, como las de antes); después se le asigna vendedor BFK a su cotización.
const cAnt = cotizacion();
const lineaAnt = JSON.parse(q1(`select to_jsonb(i) from public.vp_cotizacion_items i where revision_id = '${cAnt.revision_id}';`));
const contAnt = contenidoEETTVP({ cotizacion: { folio: cAnt.folio, revision: 0 }, cliente: { razon_social: "Cliente EETT (prueba)", rut: "61.513.003-6" }, plazo_entrega: "5 días hábiles",
  fecha: q1("select public.vp_hoy();"), responsable, elaborado_por: responsable, items: [{ ...lineaAnt, id: lineaAnt.id }] });
const eAnt = rpcJ(U.ana, "vp_guardar_eett", { cotizacion_id: cAnt.id, contenido: contAnt });
q1(`${comoUsuario(U.ana)}select public.vp_emitir_eett('${eAnt.id}', ${eAnt.version});`);
const huellaAnt = q1(`select md5(contenido::text)||'|'||hash||'|'||estado from public.vp_eett where id = '${eAnt.id}';`);
q1(`${comoUsuario(U.ana)}select public.vp_asignar_vendedor('cotizacion', '${cAnt.id}', 'bfk', (select version from public.vp_cotizaciones where id = '${cAnt.id}'));`);
ok(`${MODO} P0 datos: 3 cotizaciones (BFK, Kevin, sin vendedor) y una EETT ya emitida sin vendedor`, !contAnt.vendedor && huellaAnt.endsWith("|emitida") && q1(`select vendedor_tipo from public.vp_cotizaciones where id = '${cAnt.id}';`) === "bfk");

async function irACotizaciones(p) {
  if (movil) { await p.locator('[data-nav="mas"]').click(); await espera(p); await p.locator('[role="dialog"] [data-nav="vp_cotizaciones"]').click(); }
  else await p.locator('aside [data-nav="vp_cotizaciones"]').click();
  await p.locator("[data-panel-vp-cotizaciones]").waitFor(); await espera(p, 500);
}
const H = (p) => p.locator('[data-hoja-lateral="ficha-cotizacion"]');
async function abrirCot(p, folio) {
  if (await H(p).count()) { await H(p).locator("[data-cerrar-hoja]").first().click(); await espera(p, 600); }
  await p.locator(`[data-cotizacion="${folio}"]`).click(); await H(p).waitFor(); await espera(p, 1500);
  await H(p).locator('[role="tab"][data-tab="eett"]').click(); await espera(p, 600);
}
const ultimoBlob = (p) => p.evaluate(async () => { const b = window.__blobsPdf.at(-1); if (!b) return null; const a = new Uint8Array(await b.arrayBuffer()); let s = ""; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000)); return btoa(s); });

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
try {
  const { page: p, errs } = await abrir(browser, { usuario: U.ana, url: URL_APP, hash: "#/panel", ...(movil ? { ancho: 390, alto: 844, movil: true } : {}) });
  await p.addInitScript(() => {}); // (la captura de blobs se instala abajo, en la página ya cargada)
  await p.evaluate(() => { window.__blobsPdf = []; const o = URL.createObjectURL.bind(URL); URL.createObjectURL = (b) => { if (b && b.type === "application/pdf") window.__blobsPdf.push(b); return o(b); }; });
  await calma(); const m0 = marca();
  await irACotizaciones(p);
  for (const [cot, esperado, etiqueta] of [[cBfk, empresaCorto, "BFK"], [cKev, "Kevin Vergara", "vendedor personal"], [cSin, responsable, "sin vendedor (responsable, como antes)"]]) {
    await abrirCot(p, cot.folio);
    await H(p).locator("[data-vista-previa-eett]").click(); const vp = p.locator('[data-hoja-lateral="vista-previa-eett"]');
    await vp.locator('[data-pagina-preview="1"]').waitFor({ timeout: 20000 }); await espera(p, 600);
    const tPrev = await textoPDF(Buffer.from(await ultimoBlob(p), "base64"));
    ok(`${MODO} E1 vista previa (${etiqueta}): «Vendedor responsable: ${esperado}»`, tPrev.includes(`Vendedor responsable: ${esperado}`), vendedorPDF(tPrev));
    if (cot === cBfk && MODO === "escritorio") await p.screenshot({ path: `/tmp/eett-vendedor-${MODO}-previa-bfk.png` });
    const pdf = await descarga(p, () => vp.getByText("Generar y descargar", { exact: true }).click()); await espera(p, 1500);
    const tEm = await textoPDF(pdf);
    const fila = JSON.parse(q1(`select jsonb_build_object('estado', estado, 'vendedor', contenido->>'vendedor', 'responsable', contenido->>'responsable') from public.vp_eett where cotizacion_id = '${cot.id}' order by revision desc limit 1;`));
    ok(`${MODO} E2 PDF emitido (${etiqueta}): mismo vendedor, guardado en la EETT; el responsable se conserva`, tEm.includes(`Vendedor responsable: ${esperado}`) && fila.estado === "emitida"
      && (cot === cSin ? fila.vendedor === null : fila.vendedor === esperado) && fila.responsable === responsable, JSON.stringify(fila) + " · " + vendedorPDF(tEm));
    ok(`${MODO} E3 (${etiqueta}) la cotización mantiene su responsable`, q1(`select responsable_id from public.vp_cotizaciones where id = '${cot.id}';`) === U.ana);
  }
  // EETT ya emitida: se descarga igual (responsable) aunque la cotización tenga ahora vendedor BFK; su contenido no cambió.
  await abrirCot(p, cAnt.folio);
  const btn = H(p).locator("[data-descargar-eett]").first();
  const tAnt = await textoPDF(await descarga(p, () => btn.click()));
  ok(`${MODO} E4 EETT ya emitida: muestra al responsable como antes y su contenido no cambió`, tAnt.includes(`Vendedor responsable: ${responsable}`) && !tAnt.includes(`Vendedor responsable: ${empresaCorto}`)
    && q1(`select md5(contenido::text)||'|'||hash||'|'||estado from public.vp_eett where id = '${eAnt.id}';`) === huellaAnt, vendedorPDF(tAnt));
  ok(`${MODO} E5 sin desborde horizontal`, !movil || await sinDesborde(p));
  ok(`${MODO} E6 sin escrituras en Mercado Público`, escriturasMP(m0).length === 0, escriturasMP(m0));
  ok(`${MODO} E7 sin errores de página`, !errs.length, errs.join(" | "));
  await p.close();

  // ── Opción B: bajar el precio de compra actualiza el máximo a financiar (total de la compra con su despacho) ──
  const DESP = { key: "e-b", proveedor: "Ferretería Sur", monto: 4990, con_factura: true, estado: "confirmado", destino: "Santiago", evidencia: "correo" };
  const itemB = { tipo: "producto", descripcion: "Motosierra 45 cc", unidad: "UN", cantidad: 2, precio_unitario: 79990, ficha: { nombre: "Motosierra 45 cc", marca: "Stihl", modelo: "MS 250" }, ficha_aprobada: true,
    costo_unitario: 60911.78, proveedor: "Ferretería Sur", enlace: "https://ferreteria.example/ms250", precio_compra: 69990, precio_incluye_iva: true, con_factura: true, despacho: DESP };
  const cb = rpcJ(U.ana, "vp_guardar_cotizacion_v2", { cliente_id: cli, plazo_entrega: "3 días", vigencia_dias: 15, direccion_entrega: "Santiago", items: [itemB], vendedor: "bfk" });
  const verC = () => Number(q1(`select version from public.vp_cotizaciones where id = '${cb.id}';`));
  q1(`${comoUsuario(U.ana)}select public.vp_cotizacion_estado('${cb.id}', 'enviada', '{}'::jsonb, ${verC()});`);
  q1(`${comoUsuario(U.ana)}select public.vp_cotizacion_estado('${cb.id}', 'aceptada', '{}'::jsonb, ${verC()});`);
  const ov = JSON.parse(q1(`${comoUsuario(U.ana)}select public.vp_crear_venta_desde_cotizacion('${cb.id}', '${randomUUID()}', '{}'::jsonb);`));
  const { page: p2, errs: e2 } = await abrir(browser, { usuario: U.ana, url: URL_APP, hash: "#/panel", ...(movil ? { ancho: 390, alto: 844, movil: true } : {}) });
  if (movil) { await p2.locator('[data-nav="mas"]').click(); await espera(p2); await p2.locator('[role="dialog"] [data-nav="vp_ordenes"]').click(); }
  else await p2.locator('aside [data-nav="vp_ordenes"]').click();
  await p2.locator(`[data-venta="${ov.folio}"]`).click(); await p2.locator('[data-hoja-lateral="ficha-venta"]').waitFor(); await espera(p2, 1200);
  await p2.locator("[data-registrar-compra]").click(); const W = p2.locator('[data-ventana="compra-cotizacion-vp"]'); await W.waitFor();
  const $ = (x) => Number(String(x).replace(/[^\d]/g, ""));
  await W.locator('[data-opcion="A"]').click(); await espera(p2, 300);
  await W.locator("[data-financiamiento-ahora]").click(); await espera(p2, 300);
  ok(`${MODO} B1 opción A: máximo a financiar = total a pagar ($144.970 = 2 × 69.990 + despacho 4.990)`, $(await W.locator("[data-maximo-financiar]").innerText()) === 144970 && $(await W.locator('[data-aporte-campo="monto"]').inputValue()) === 144970);
  await W.locator('[data-opcion="B"]').click(); await espera(p2, 300);
  await W.locator('[data-campo-compra="unitario"]').fill("62991"); await espera(p2, 500);
  const total = $(await W.locator("[data-total-real]").innerText());
  ok(`${MODO} B2 opción B con precio menor: total a pagar $130.972 (2 × 62.991 + despacho 4.990)`, total === 2 * 62991 + 4990, total);
  ok(`${MODO} B3 el máximo a financiar se actualiza al nuevo total con despacho`, $(await W.locator("[data-maximo-financiar]").innerText()) === total && /Por financiar: \$\s?130\.972/.test(await W.locator("[data-resumen-aportes]").innerText()));
  ok(`${MODO} B4 el aporte precargado sigue al nuevo total (sin exceso ni rechazo)`, $(await W.locator('[data-aporte-campo="monto"]').inputValue()) === total && !/supera/.test(await W.locator("[data-resumen-aportes]").innerText()));
  // Si la persona edita el monto, se respeta lo que escribió aunque cambie el precio.
  await W.locator('[data-aporte-campo="monto"]').fill("100000"); await W.locator('[data-campo-compra="unitario"]').fill("60000"); await espera(p2, 400);
  ok(`${MODO} B5 un monto escrito a mano no se reemplaza; el máximo sigue al total ($124.990)`, $(await W.locator('[data-aporte-campo="monto"]').inputValue()) === 100000 && $(await W.locator("[data-maximo-financiar]").innerText()) === 2 * 60000 + 4990);
  await W.locator('[data-campo-compra="despacho-real"], [data-despacho-real]').first().fill("9990"); await espera(p2, 400);
  ok(`${MODO} B6 cambiar el despacho también actualiza el máximo ($129.990)`, $(await W.locator("[data-maximo-financiar]").innerText()) === 2 * 60000 + 9990);
  await W.locator("button", { hasText: "Cancelar" }).click(); await espera(p2, 400);
  ok(`${MODO} B7 cancelar no registra compra ni aportes`, q1(`select count(*) from public.vp_compras where venta_id = '${ov.id}';`) === "0" && q1(`select count(*) from public.vp_fin_aportes where venta_id = '${ov.id}';`) === "0");
  ok(`${MODO} B8 sin errores de página`, !e2.length, e2.join(" | "));
  await p2.close();
} catch (e) { F.push("EXCEPCIÓN"); console.log("EXCEPCIÓN", e.message); }
finally { await browser.close(); }
console.log(`RESUMEN e2e_eett_vendedor (${MODO}): ${nOk} OK, ${F.length} fallas${F.length ? " · " + F.join(" | ") : ""}`);
process.exit(F.length ? 1 : 0);
