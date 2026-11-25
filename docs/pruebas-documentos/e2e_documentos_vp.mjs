// Documentación de la oferta en VENTAS PRIVADAS con la base real local (PostgreSQL + PostgREST desechables, migración
// BORRADOR-2026-11-25-documentos-oferta.sql aplicada): mismo componente y mismo generador que Mercado Público.
// Cotización privada → Documentos → vista previa → emisión (queda en oferta_documentos con permisos reales) → historial →
// descarga idéntica; quien no es responsable no ve los documentos; sin campos de Mercado Público.
// Uso: (entorno.sh instalar + migración) → PGRST_URL, JWT_SECRET, VP_DB_URL · node docs/pruebas-documentos/e2e_documentos_vp.mjs http://127.0.0.1:4330/
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { abrir, chromium, CHROME, U, psql, comoUsuario, calma, sinDesborde } from "../pruebas-ventas-privadas/arnes_vp.mjs";
import * as ui from "../pruebas-ventas-privadas/ui_cotizacion_vp.mjs";

const URL_APP = process.argv[2] || "http://127.0.0.1:4330/";
let nOk = 0; const F = [];
const ok = (n, c, det = "") => { if (c) { nOk++; console.log("OK   ", n); } else { F.push(n); console.log("FALLA", n, String(det).slice(0, 400)); } };
const espera = (p, ms = 400) => p.waitForTimeout(ms);
const q1 = (sql) => psql(sql).split("\n").pop();
const sha = (b) => createHash("sha256").update(b).digest("hex");
const descargar = async (p, accion) => { const [d] = await Promise.all([p.waitForEvent("download", { timeout: 30000 }), accion()]); const buf = readFileSync(await d.path()); return { nombre: d.suggestedFilename(), buf }; };
const texto = (buf) => execFileSync("pdftotext", ["-layout", "-", "-"], { input: buf }).toString().replace(/[ \t]+/g, " ");
const visor = (p) => p.locator('[data-hoja-lateral="visor-documento"]');

psql(`${comoUsuario(U.ana)}select public.vp_guardar_cliente('${JSON.stringify({ rut: "76086428-5", razon_social: "Maderas del Sur SpA", tipo_persona: "empresa", giro: "Aserradero",
  contacto_nombre: "Rosa Pérez", contacto_correo: "rosa@maderas.invalid", direccion_entrega: "Planta km 5", comuna_entrega: "Laja", condiciones_pago: "50% anticipo y saldo a 30 días" })}'::jsonb);`);

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
for (const [pref, ancho, alto, movil] of [["P", 1440, 900, false], ["M", 390, 844, true]]) {
  const { page: p, ctx, errs } = await abrir(browser, { usuario: U.ana, url: URL_APP, hash: "#/panel", ancho, alto, movil });
  const h = ui.hoja(p); await calma();
  if (movil) { await p.locator('[data-nav="mas"]').click(); await espera(p); await p.locator('[role="dialog"] [data-nav="vp_cotizaciones"]').click(); }
  else await p.locator('aside [data-nav="vp_cotizaciones"]').click();
  await p.locator("[data-panel-vp-cotizaciones]").waitFor(); await espera(p, 500);
  await p.locator("[data-nueva-cotizacion]").click(); await h.waitFor(); await espera(p, 600);
  await ui.elegirCliente(p, "Maderas", "76.086.428-5");
  await ui.pestana(p, "productos");
  await ui.ingresarManual(p, { nombre: "Silla ergonómica RD", marca: "RD", modelo: "PR96015", especificaciones: "Respaldo: Reclinable, 90° a 130°\nPeso máximo soportado: 120 kg\nApoyapiés: No",
    proveedor: "Tienda Dos", cantidad: 4, unidad: "UN", precio: 70000, incluyeIva: true, despacho: { modo: "propio", monto: 8000, estado: "confirmado", evidencia: "Simulación de compra" } });
  await ui.pestana(p, "precios"); await ui.fijarPrecio(p, 1, 95000, 0);
  await ui.guardarCotizacion(p);
  const folio = q1(`select folio from public.vp_cotizaciones order by creado_en desc limit 1`);
  const cotId = q1(`select id from public.vp_cotizaciones where folio = '${folio}'`);
  await ui.pestana(p, "eett");
  const sec = h.locator("[data-documentacion-oferta]");
  ok(`${pref}01 sección con los tres documentos y condiciones que vienen de la cotización`, (await sec.locator("[data-documento-oferta]").count()) === 3 && /50% anticipo/.test(await sec.locator('[data-campo="pago"]').inputValue())
    // 25/11/2026: el despacho se propone desde Productos (si el campo queda vacío se imprime la propuesta).
    && /Incluido en el valor unitario/.test(await sec.locator('[data-sugerida="despacho"]').innerText()));
  await sec.locator('[data-condicion="garantia"] input').fill("6 meses por defectos de fabricación");
  await sec.locator("[data-guardar-condiciones]").click(); await espera(p, 1200);
  ok(`${pref}02 condiciones guardadas en la base (con permisos reales)`, q1(`select condiciones->>'garantia' from public.oferta_condiciones where canal = 'vp' and cotizacion_id = '${cotId}'`) === "6 meses por defectos de fabricación");
  await sec.locator('[data-previa-documento="oferta"]').click(); await visor(p).locator("[data-pagina-doc]").first().waitFor({ timeout: 40000 }); await espera(p, 1200);
  const previa = await descargar(p, () => visor(p).locator("[data-descargar-previa]").click());
  const emit = await descargar(p, () => visor(p).locator("[data-emitir-documento]").click()); await espera(p, 1200);
  const t = texto(emit.buf);
  ok(`${pref}03 emitida con el folio interno de BFK`, emit.nombre === `OFERTA_${folio}_v1.pdf`, emit.nombre);
  ok(`${pref}04 idéntica a la vista previa`, sha(emit.buf) === sha(previa.buf));
  ok(`${pref}05 registro en oferta_documentos con huella del PDF y autor`, q1(`select count(*) || '|' || max(huella_pdf) || '|' || max(emitido_por::text) from public.oferta_documentos where canal = 'vp' and cotizacion_id = '${cotId}'`) === `1|${sha(emit.buf)}|${U.ana}`);
  ok(`${pref}06 datos de la venta privada, sin Mercado Público ni datos internos`, /Maderas del Sur SpA/.test(t) && /76\.086\.428-5/.test(t) && /Rosa Pérez/.test(t) && /\$95\.000/.test(t) && /6 meses por defectos/.test(t) && !/Compra Ágil|Licitación|Instituci|Tienda Dos|Simulación|70\.000/.test(t));
  ok(`${pref}07 total del PDF = total de la cotización guardada`, t.includes(`$${Number(q1(`select r.total from public.vp_cotizacion_revisiones r join public.vp_cotizaciones c on c.id = r.cotizacion_id and r.numero = c.revision_actual where c.id = '${cotId}'`) || 0).toLocaleString("es-CL")}`), q1(`select r.total from public.vp_cotizacion_revisiones r join public.vp_cotizaciones c on c.id = r.cotizacion_id and r.numero = c.revision_actual where c.id = '${cotId}'`));
  await visor(p).locator("[data-volver-editar]").click(); await espera(p, 600);
  await sec.locator('[data-desplegable="historial-oferta"] button').first().click(); await espera(p, 300);
  const otra = await descargar(p, () => sec.locator("[data-descargar-emitido]").first().click());
  ok(`${pref}08 descarga desde el historial idéntica a la emitida`, sha(otra.buf) === sha(emit.buf));
  // Otro usuario (no responsable) no ve los documentos ni puede emitir: permisos de la base.
  ok(`${pref}09 quien no es responsable no lee el historial`, psql(`${comoUsuario(U.beto)}select count(*) from public.oferta_documentos where cotizacion_id = '${cotId}';`).split("\n").pop() === "0");
  ok(`${pref}10 sin desborde y sin errores`, (!movil || await sinDesborde(p)) && errs.length === 0, errs);
  await ctx.close();
}
await browser.close();
console.log(`\nRESUMEN e2e_documentos_vp: ${nOk} OK, ${F.length} FALLA(S)`);
process.exit(F.length ? 1 : 0);
