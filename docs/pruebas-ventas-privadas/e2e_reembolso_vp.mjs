// Compra de una venta privada anulada con reembolso del proveedor (24/11/2026) — navegador real, PostgREST REAL sobre una base
// desechable (nunca producción) con BORRADOR-2026-11-24-vp-compra-reembolso.sql aplicada.
// Caso de Kevin: compra en Falabella que nunca llegó → se cancela (Falabella devuelve) → se compra en otro lado más barato.
// Uso: (entorno.sh instalar + migración) → PGRST_URL, JWT_SECRET, VP_DB_URL · node docs/pruebas-ventas-privadas/e2e_reembolso_vp.mjs http://127.0.0.1:4330/
import { abrir, chromium, CHROME, U, psql, comoUsuario, sinDesborde } from "./arnes_vp.mjs";

const HOY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(new Date());
const URL_APP = process.argv[2] || "http://127.0.0.1:4330/";
let nOk = 0; const F = [];
const ok = (n, c, det = "") => { if (c) { nOk++; console.log("OK   ", n); } else { F.push(n); console.log("FALLA", n, typeof det === "string" ? det.slice(0, 500) : JSON.stringify(det).slice(0, 500)); } };
const espera = (p, ms = 400) => p.waitForTimeout(ms);
const q1 = (sql) => psql(sql).split("\n").pop();
const lit = (s) => { const t = "q" + Math.random().toString(36).slice(2, 8); return `$${t}$${s}$${t}$`; };
const comoAna = (sql) => q1(`${comoUsuario(U.ana)}${sql}`);
const j = (o) => `${lit(JSON.stringify(o))}::jsonb`;

// ── Datos: cliente, orden de venta directa y dos compras (una registrada en la venta y otra que venía de Gastos) ──
const cliPrevio = q1(`select id from public.pi_clientes where regexp_replace(rut, '[^0-9kK]', '', 'g') = '761234560' limit 1;`);
const cli = cliPrevio || JSON.parse(comoAna(`select public.vp_guardar_cliente(${j({ rut: "76123456-0", razon_social: "Constructora Biobío SpA (prueba)", tipo_persona: "empresa" })});`)).id;
const venta = JSON.parse(comoAna(`select public.vp_crear_venta_directa(${j({ clave: crypto.randomUUID(), cliente_id: cli, afecta_iva: true, plazo_pago_dias: 30,
  items: [{ descripcion: "Taladro percutor 750 W", unidad: "UN", cantidad: 1, precio_unitario: 200000, costo_unitario: 100000 }] })});`));
const gid = "gas_e2e_" + Date.now();
psql(`insert into public.gastos_indirectos (id, categoria_id, monto, mes, anio, fecha, descripcion) values ('${gid}', 'cat1', 59990, 11, 2026, '2026-11-03', 'Falabella broca (Gastos)');`);
const kFal = JSON.parse(comoAna(`select public.vp_registrar_compra(${j({ venta_id: venta.id, origen: "registro", proveedor: "Falabella", fecha: "2026-11-02", documento_tipo: "factura", documento_numero: "F-77", neto: 100000, iva: 19000, iva_recuperable: true })});`));
const kGas = JSON.parse(comoAna(`select public.vp_registrar_compra(${j({ venta_id: venta.id, origen: "gasto_existente", gasto_id: gid })});`));
const compra = (id) => JSON.parse(q1(`select to_jsonb(k) from public.vp_compras k where id = '${id}';`));
const costoReal = () => Number(comoAna(`select costo_real from public.vp_margen_ventas where venta_id = '${venta.id}';`));
const ficha = (p) => p.locator('[data-hoja-lateral="ficha-venta"]');

async function abrirOrden(p) {
  if (await ficha(p).count()) { await ficha(p).locator("[data-cerrar-hoja]").first().click(); await espera(p, 400); }
  const lateral = p.locator('aside [data-nav="vp_ordenes"]');
  if (await lateral.isVisible().catch(() => false)) await lateral.click(); else await p.evaluate(() => { location.hash = "#/vp_ordenes"; });
  await p.locator("[data-panel-vp-ordenes]").waitFor(); await espera(p, 600);
  await p.locator(`[data-venta="${venta.folio}"]`).click(); await ficha(p).waitFor(); await espera(p, 1200);
}

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
try {
  const c0 = costoReal();
  ok("R00 orden con dos compras vigentes (Falabella 119.000 con factura y un gasto vinculado de 59.990)", c0 === 100000 + 59990, c0);
  const { page: p, errs } = await abrir(browser, { usuario: U.ana, url: URL_APP, hash: "#/panel" });
  await abrirOrden(p);

  // ── 1. Anular la compra de Falabella: «el proveedor devolverá el dinero» (marcado por defecto) ─────────────────────
  await ficha(p).locator(`[data-anular-compra="${kFal.id}"]`).click();
  const V = p.locator('[data-ventana="anular-compra"]'); await V.waitFor();
  const tv = await V.innerText();
  ok("R01 la ventana pregunta si el proveedor devolverá el dinero (marcado) con el total como monto", (await V.locator("[data-con-reembolso]").isChecked()) && (await V.locator("[data-monto-reembolso]").inputValue()) === "119000", tv);
  ok("R02 avisa de la nota de crédito (compra con factura) y del abono en la cartola", (await V.locator('[data-nota-anular="nc"]').count()) === 1 && (await V.locator('[data-nota-anular="cartola"]').count()) === 1, tv);
  await V.locator("[data-confirmar-anular-compra]").click(); await espera(p, 300);
  ok("R03 exige motivo", /Indica el motivo/.test(await V.innerText()));
  await V.locator("[data-motivo]").fill("El producto nunca llegó; compra cancelada en Falabella");
  await V.locator("[data-confirmar-anular-compra]").click(); await V.waitFor({ state: "detached", timeout: 15000 }).catch(() => {}); await espera(p, 1500);
  const k1 = compra(kFal.id);
  ok("R04 compra anulada con reembolso pendiente por $119.000", k1.estado === "anulada" && k1.reembolso_estado === "pendiente" && Number(k1.reembolso_monto) === 119000, k1);
  ok("R05 la fila muestra «Reembolso pendiente» y el botón para registrarlo", (await ficha(p).locator('[data-reembolso="pendiente"]').count()) === 1 && (await ficha(p).locator(`[data-registrar-reembolso="${kFal.id}"]`).count()) === 1);
  ok("R06 deja de ser costo real de la orden", costoReal() === 59990, costoReal());

  // ── 2. Compra que venía de Gastos: con reembolso, el gasto se anula solo ─────────────────────────────────────────
  await ficha(p).locator(`[data-anular-compra="${kGas.id}"]`).click(); await V.waitFor();
  ok("R07 compra de Gastos: avisa que el gasto se anulará solo", /se anula solo/.test(await V.locator('[data-nota-anular="gasto"]').innerText()));
  await V.locator("[data-con-reembolso]").uncheck(); await espera(p, 200);
  ok("R08 sin reembolso: avisa que el gasto se mantiene (dinero perdido)", /se mantiene/.test(await V.locator('[data-nota-anular="gasto"]').innerText()) && (await V.locator("[data-monto-reembolso]").count()) === 0);
  await V.locator("[data-con-reembolso]").check();
  await V.locator("[data-monto-reembolso]").fill("70000"); await V.locator("[data-motivo]").fill("Cancelada en Falabella");
  await V.locator("[data-confirmar-anular-compra]").click(); await espera(p, 600);
  ok("R09 no acepta un reembolso mayor que lo pagado", /no superar lo pagado/.test(await V.innerText()) && compra(kGas.id).estado === "vigente");
  await V.locator("[data-monto-reembolso]").fill("59990");
  await V.locator("[data-confirmar-anular-compra]").click(); await V.waitFor({ state: "detached", timeout: 15000 }).catch(() => {}); await espera(p, 1500);
  const g = JSON.parse(q1(`select to_jsonb(g) from public.gastos_indirectos g where id = '${gid}';`));
  ok("R10 el gasto vinculado quedó anulado (no borrado), con referencia a la compra", !!g.anulado_en && g.anulacion_ref === `vp_compras:${kGas.id}` && Number(g.monto) === 59990, g);

  // ── 3. Compra nueva más barata en otro proveedor ───────────────────────────────────────────────────────────────
  comoAna(`select public.vp_registrar_compra(${j({ venta_id: venta.id, origen: "registro", proveedor: "Sodimac", fecha: HOY, documento_tipo: "factura", documento_numero: "S-1", neto: 84034, iva: 15966, iva_recuperable: true })});`);
  ok("R11 costo real = solo la compra nueva (más barata)", costoReal() === 84034, costoReal());

  // ── 4. Reembolso recibido a mano y deshacer ────────────────────────────────────────────────────────────────────
  await abrirOrden(p);
  await ficha(p).locator(`[data-registrar-reembolso="${kFal.id}"]`).click();
  const RV = p.locator('[data-ventana="registrar-reembolso"]'); await RV.waitFor();
  ok("R12 «Registrar reembolso» propone hoy y el monto esperado", (await RV.locator("[data-fecha-reembolso]").inputValue()) === HOY && (await RV.locator("[data-monto-reembolso]").inputValue()) === "119000");
  await RV.locator("[data-confirmar-reembolso]").click(); await RV.waitFor({ state: "detached", timeout: 15000 }).catch(() => {}); await espera(p, 1500);
  const k2 = compra(kFal.id);
  ok("R13 reembolso recibido (sin marca de cartola)", k2.reembolso_estado === "recibido" && k2.reembolso_fecha === HOY && k2.reembolso_marca === null, k2);
  ok("R14 la fila muestra «Reembolsado» y «Deshacer»", /Reembolsado \$119\.000/.test(await ficha(p).locator('[data-reembolso="recibido"]').innerText()) && (await ficha(p).locator(`[data-deshacer-reembolso="${kFal.id}"]`).count()) === 1);
  await ficha(p).locator(`[data-deshacer-reembolso="${kFal.id}"]`).click();
  await p.locator("[data-motivo]").fill("Me equivoqué de compra"); await p.locator("[data-confirmar-motivo]").click(); await espera(p, 2000);
  ok("R15 deshacer: vuelve a pendiente", compra(kFal.id).reembolso_estado === "pendiente");

  // ── 5. Celular: la ventana cabe sin desbordar ────────────────────────────────────────────────────────────────
  const { page: m } = await abrir(browser, { usuario: U.ana, url: URL_APP, hash: "#/panel", movil: true, ancho: 390, alto: 844 });
  comoAna(`select public.vp_registrar_compra(${j({ venta_id: venta.id, origen: "registro", proveedor: "Mercado Libre", fecha: HOY, neto: 5000, iva: 950, iva_recuperable: true, documento_tipo: "boleta" })});`);
  await abrirOrden(m);
  const kML = q1(`select id from public.vp_compras where venta_id = '${venta.id}' and proveedor = 'Mercado Libre';`);
  await ficha(m).locator(`[data-anular-compra="${kML}"]`).click(); await m.locator('[data-ventana="anular-compra"]').waitFor();
  ok("R16 celular: la ventana de anular compra cabe sin desbordar", await sinDesborde(m));
  ok("R17 boleta: no pide nota de crédito", (await m.locator('[data-nota-anular="nc"]').count()) === 0);
  ok("R18 sin errores de página", errs.length === 0, errs);
} catch (e) { F.push("EXCEPCIÓN"); console.log("EXCEPCIÓN", e.stack || e.message); }
finally { await browser.close(); }
console.log(`\nRESUMEN e2e_reembolso_vp: ${nOk} OK, ${F.length} FALLA(S)`);
process.exit(F.length ? 1 : 0);
