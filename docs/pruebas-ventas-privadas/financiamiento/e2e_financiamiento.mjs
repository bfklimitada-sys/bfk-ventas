// Financiamiento de compras y vendedor «BFK» (11/11/2026) — navegador real (escritorio y celular) sobre una base DESECHABLE con
// la migración instalada (nunca producción). Mercado Público, con su simulador de siempre: se comprueba que no recibe escrituras.
// Uso: (entorno con la migración del 11/11) → PGRST_URL, JWT_SECRET, VP_DB_URL · node e2e_financiamiento.mjs http://127.0.0.1:4330/ [carpeta_capturas]
import { abrir, chromium, CHROME, U, psql, comoUsuario, crearAuth, sinDesborde, marca, calma, escriturasMP } from "../arnes_vp.mjs";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";

const URL_APP = process.argv[2] || "http://127.0.0.1:4330/";
const CAP = process.argv[3] || null; if (CAP) mkdirSync(CAP, { recursive: true });
let nOk = 0; const F = [];
const ok = (n, c, det = "") => { if (c) { nOk++; console.log("OK   ", n); } else { F.push(n); console.log("FALLA", n, typeof det === "string" ? det.slice(0, 500) : JSON.stringify(det).slice(0, 500)); } };
const espera = (p, ms = 400) => p.waitForTimeout(ms);
const q1 = (sql) => psql(sql).split("\n").pop();
const lit = (s) => { const t = "q" + Math.random().toString(36).slice(2, 8); return `$${t}$${s}$${t}$`; };
const $ = (x) => { const t = String(x); const n = Number(t.replace(/[^\d]/g, "")); return /[−-]\s?\$/.test(t) ? -n : n; };
const como = (u, sql) => q1(`${comoUsuario(u)}${sql}`);
const rpcJ = (u, fn, arg) => JSON.parse(como(u, `select public.${fn}(${lit(JSON.stringify(arg))}::jsonb);`));
const txt = async (loc) => (await loc.innerText()).trim();
const foto = async (p, nombre) => { if (CAP) await p.screenshot({ path: `${CAP}/${nombre}.png`, fullPage: false }); };
const hoy = q1("select public.vp_hoy();");

// ── Datos de prueba ──────────────────────────────────────────────────────────────────────────────────────
const cliPrevio = q1(`select id from public.pi_clientes where regexp_replace(rut, '[^0-9kK]', '', 'g') = '770001110' limit 1;`);
const cli = cliPrevio || rpcJ(U.ana, "vp_guardar_cliente", { rut: "77000111-0", razon_social: "Forestal Laja SpA (prueba)", tipo_persona: "empresa", direccion_entrega: "Los Boldos 1, Laja" }).id;
const DESP = { key: "e-fin", proveedor: "Ferretería Sur", monto: 4990, con_factura: true, estado: "confirmado", destino: "Los Boldos 1, Laja", evidencia: "correo" };
function nuevaOrden({ vendedor, desc = "Motosierra 45 cc" } = {}) {
  const item = { tipo: "producto", descripcion: desc, unidad: "UN", cantidad: 2, precio_unitario: 79990, ficha: { nombre: desc, marca: "Stihl", modelo: "MS 250" }, ficha_aprobada: true,
    costo_unitario: 60911.78, proveedor: "Ferretería Sur", enlace: "https://ferreteria.example/ms250", precio_compra: 69990, precio_incluye_iva: true, con_factura: true, despacho: DESP };
  const p = { cliente_id: cli, plazo_entrega: "3 días", vigencia_dias: 15, direccion_entrega: "Los Boldos 1, Laja", items: [item], ...(vendedor !== undefined ? { vendedor } : {}) };
  const cot = rpcJ(U.ana, "vp_guardar_cotizacion_v2", p);
  const ver = () => Number(q1(`select version from public.vp_cotizaciones where id = '${cot.id}';`));
  como(U.ana, `select public.vp_cotizacion_estado('${cot.id}', 'enviada', '{}'::jsonb, ${ver()});`);
  como(U.ana, `select public.vp_cotizacion_estado('${cot.id}', 'aceptada', '{}'::jsonb, ${ver()});`);
  const v = JSON.parse(como(U.ana, `select public.vp_crear_venta_desde_cotizacion('${cot.id}', gen_random_uuid(), '{}'::jsonb);`));
  return { cot: cot.id, id: v.id, folio: v.folio, item: q1(`select id from public.vp_venta_items where venta_id = '${v.id}';`) };
}
const compraDirecta = (o) => { const ped = randomUUID().replace(/-/g, ""); return rpcJ(U.ana, "vp_registrar_compras_cotizacion", { venta_id: o.id, fecha: hoy, filas: [
  { clave: `${ped}-1-a-0`, pedido: `${ped}-1`, concepto: "producto", venta_item_id: o.item, cantidad: 2, precio_unitario: 69990, proveedor: "Ferretería Sur", documento_tipo: "factura", descripcion: "Motosierra × 2" },
  { clave: `${ped}-1-d-0`, pedido: `${ped}-1`, concepto: "despacho", envio_clave: "e-fin", monto: 4990, proveedor: "Ferretería Sur", documento_tipo: "factura", descripcion: "Despacho" }] }); };
const TOTAL = 2 * 69990 + 4990;   // 144.970 pagado con IVA
const aportes = (id) => JSON.parse(q1(`select coalesce(jsonb_agg(to_jsonb(a) order by creado_en), '[]') from public.vp_fin_aportes a where venta_id = '${id}';`));
const devoluciones = (id) => JSON.parse(q1(`select coalesce(jsonb_agg(to_jsonb(a) order by creado_en), '[]') from public.vp_fin_devoluciones a where venta_id = '${id}';`));
const nCompras = (id) => Number(q1(`select count(*) from public.vp_compras where venta_id = '${id}';`));
const margen = (id) => JSON.parse(como(U.ana, `select to_jsonb(m) from public.vp_margen_ventas m where venta_id = '${id}';`));

const oPrev = nuevaOrden({ vendedor: "vend_kevin" }); compraDirecta(oPrev);              // compra «anterior» sin financiamiento
const oKev = nuevaOrden({ vendedor: "bfk" });                                            // vendedor BFK, financia Kevin
const oBfk = nuevaOrden({ vendedor: "vend_kevin" });                                     // vendedor personal, financia BFK
const oMix = nuevaOrden({ vendedor: "bfk" }); compraDirecta(oMix);                       // aportes mixtos y parciales
const oRed = nuevaOrden({ vendedor: "bfk" });                                            // reintento con conexión perdida
const oSin = nuevaOrden();                                                               // sin vendedor (se asigna en la ficha)
const cotBorr = rpcJ(U.ana, "vp_guardar_cotizacion_v2", { cliente_id: cli, plazo_entrega: "1 día", items: [{ tipo: "producto", descripcion: "Casco de seguridad", unidad: "UN", cantidad: 1, precio_unitario: 15000 }], vendedor: "vend_kevin" });
const cotBorrFolio = q1(`select folio from public.vp_cotizaciones where id = '${cotBorr.id}';`);
// Órdenes del recorrido en celular (creadas antes de abrir la app, como las del escritorio).
const movilK = nuevaOrden({ vendedor: "bfk" }); const movilB = nuevaOrden({ vendedor: "vend_kevin" }); const movilM = nuevaOrden({ vendedor: "bfk" }); compraDirecta(movilM);

async function irOrden(p, folio, movil) {
  if (await p.locator('[data-hoja-lateral="ficha-venta"]').count()) { await p.locator('[data-hoja-lateral="ficha-venta"] [data-cerrar-hoja]').first().click(); await espera(p, 400); }
  if (movil) { await irListaMovil(p); await p.locator(`[data-venta="${folio}"]`).click(); }
  else { await p.locator('aside [data-nav="vp_ordenes"]').click(); await p.locator("[data-panel-vp-ordenes]").waitFor(); await espera(p, 500); await p.locator(`[data-venta="${folio}"]`).click(); }
  await p.locator('[data-hoja-lateral="ficha-venta"]').waitFor(); await p.locator("[data-financiamiento-venta]").waitFor(); await espera(p, 600);
}
async function irListaMovil(p) {
  await p.locator('[data-nav="mas"]').click(); await espera(p, 400);
  await p.locator('[role="dialog"] [data-nav="vp_ordenes"]').click(); await p.locator("[data-panel-vp-ordenes]").waitFor(); await espera(p, 600);
}
const W = (p, d = "compra-cotizacion-vp") => p.locator(`[data-ventana="${d}"]`);
// Confirmaciones del recorrido de Mercado Público (vigencia de precios, especificaciones), si se piden.
const confirmar = async (w) => { for (const c of await w.locator("[data-confirmar] input[type=checkbox]").all()) if (!(await c.isChecked())) await c.check(); };

const arranque = { desde: 0, hasta: 0 };
async function recorrido(browser, { movil }) {
  const sufijo = movil ? "celular" : "escritorio"; const T = (s) => `${s} (${sufijo})`;
  const op = movil ? { ancho: 390, alto: 844, movil: true } : {};
  const { page: p, errs } = await abrir(browser, { usuario: U.ana, url: URL_APP, hash: "#/panel", ...op });
  await calma(); const m0 = marca();

  if (!movil) {
    // 1. Compra anterior: «Financiamiento sin informar», sin atribuir a nadie.
    await irOrden(p, oPrev.folio, movil);
    const fp = await txt(p.locator("[data-financiamiento-venta]"));
    ok(T("E01 compra anterior: «Financiamiento sin informar» por el total, sin aportantes"), /Financiamiento sin informar/.test(fp) && $(await txt(p.locator('[data-kpi-valor="fin-falta"]'))) === TOTAL
      && $(await txt(p.locator('[data-kpi-valor="fin-financiado"]'))) === 0 && (await p.locator("[data-aportante]").count()) === 0, fp);
    await foto(p, `01-sin-informar-${sufijo}`);
  }

  // 2. Registrar compra (opción A) financiada completamente por Kevin; doble clic sin duplicar.
  const oK = movil ? movilK : oKev;
  await irOrden(p, oK.folio, movil);
  const fichaV = await txt(p.locator('[data-vendedor-ficha]'));
  ok(T("E02 la ficha muestra vendedor BFK y responsable distintos"), /BFK · sin comisión personal/.test(fichaV) && /Responsable \(gestiona y registra\)/.test(await txt(p.locator('[data-hoja-lateral="ficha-venta"]'))), fichaV);
  await p.locator("[data-registrar-compra]").click(); await W(p).waitFor();
  await W(p).locator('[data-opcion="A"]').click(); await espera(p, 300);
  ok(T("E03 «Registrar compra» ofrece el financiamiento (opcional)"), (await W(p).locator("[data-financiamiento-compra]").count()) === 1 && /Informar después/.test(await txt(W(p).locator("[data-financiamiento-compra]"))));
  await W(p).locator("[data-financiamiento-ahora]").click(); await espera(p, 200);
  ok(T("E04 el aporte se precarga con el total a pagar de la compra"), $(await W(p).locator('[data-aporte-campo="monto"]').inputValue()) === TOTAL && /Por financiar: \$\s?144\.970/.test(await txt(W(p).locator("[data-resumen-aportes]"))));
  await W(p).locator('[data-aporte-campo="aportante"]').selectOption("fin_kevin");
  await W(p).locator('[data-aporte-campo="comprobante"]').fill("TRX-778");
  await W(p).locator('[data-aporte-campo="medio"]').selectOption("tarjeta");
  await foto(p, `02-registrar-compra-financiada-${sufijo}`);
  const costoPrev = $(await txt(W(p).locator("[data-costo-esta-compra]")));
  await confirmar(W(p)); await W(p).locator("[data-registrar-compra-cotizacion]").dblclick(); await espera(p, 2500);
  if (process.env.DEPURAR && (await W(p).count())) console.log("DEPURAR", await txt(W(p).locator("[data-errores-compra]")).catch(() => "sin errores visibles"));
  const ak = aportes(oK.id);
  ok(T("E05 doble clic: una compra (2 filas) y un aporte de Kevin por el total"), nCompras(oK.id) === 2 && ak.length === 1 && ak[0].financiador_id === "fin_kevin" && Number(ak[0].monto) === TOTAL && ak[0].medio === "tarjeta" && ak[0].comprobante === "TRX-778", ak);
  ok(T("E06 quien registra (Ana) es distinto de quien aporta (Kevin)"), ak[0]?.creado_por === U.ana && ak[0]?.aportante_nombre === "Kevin Vergara");
  const mk = margen(oK.id);
  ok(T("E07 el costo real es el de la compra (registrado una sola vez) y coincide con lo mostrado"), Number(mk.costo_real) === costoPrev, { mk, costoPrev });
  await p.locator("[data-financiamiento-venta]").waitFor(); await espera(p, 400);
  const fk = await txt(p.locator("[data-financiamiento-venta]"));
  ok(T("E08 sección Financiamiento: total, financiado 100 %, falta $0 y Kevin con pendiente de devolución"), $(await txt(p.locator('[data-kpi-valor="fin-total"]'))) === TOTAL && $(await txt(p.locator('[data-kpi-valor="fin-financiado"]'))) === TOTAL
    && $(await txt(p.locator('[data-kpi-valor="fin-falta"]'))) === 0 && $(await txt(p.locator('[data-kpi-valor="fin-pendiente"]'))) === TOTAL && /Kevin Vergara/.test(fk) && /Financiamiento informado/.test(fk), fk);
  await p.locator('[data-aportante="fin_kevin"]').scrollIntoViewIfNeeded(); await foto(p, `03-financiamiento-kevin-${sufijo}`);

  // 3. Devoluciones: rechazo por sobre el saldo, parcial y total.
  await p.locator(`[data-registrar-devolucion="${ak[0].id}"]`).click(); await W(p, "form-devolucion").waitFor();
  await W(p, "form-devolucion").locator('[data-devolucion-campo="monto"]').fill(String(TOTAL + 1));
  await W(p, "form-devolucion").locator("[data-guardar-devolucion]").click(); await espera(p, 500);
  ok(T("E09 devolver más que el saldo: rechazado antes de enviar, nada se registra"), /más que el saldo pendiente/.test(await txt(W(p, "form-devolucion").locator("[data-errores-devolucion]"))) && devoluciones(oK.id).length === 0);
  await W(p, "form-devolucion").locator('[data-devolucion-campo="monto"]').fill("44970");
  await W(p, "form-devolucion").locator('[data-devolucion-campo="comprobante"]').fill("DEV-1");
  await foto(p, `04-devolucion-${sufijo}`);
  await W(p, "form-devolucion").locator("[data-guardar-devolucion]").click(); await espera(p, 2000);
  ok(T("E10 devolución parcial: devuelto $44.970, pendiente $100.000"), devoluciones(oK.id).length === 1 && $(await txt(p.locator('[data-kpi-valor="fin-pendiente"]'))) === 100000
    && $(await txt(p.locator('[data-aportante="fin_kevin"] [data-pendiente-devolucion]'))) === 100000);
  await p.locator(`[data-registrar-devolucion="${ak[0].id}"]`).click(); await W(p, "form-devolucion").waitFor();
  ok(T("E11 la devolución propone el saldo pendiente"), $(await W(p, "form-devolucion").locator('[data-devolucion-campo="monto"]').inputValue()) === 100000);
  await W(p, "form-devolucion").locator("[data-guardar-devolucion]").click(); await espera(p, 2000);
  ok(T("E12 devolución total: pendiente $0 y sin botón de nueva devolución"), $(await txt(p.locator('[data-kpi-valor="fin-pendiente"]'))) === 0 && (await p.locator(`[data-registrar-devolucion="${ak[0].id}"]`).count()) === 0
    && /Aporte personal · devuelto/.test(await txt(p.locator('[data-aportante="fin_kevin"]'))));
  ok(T("E13 aportes y devoluciones no cambiaron el costo ni la utilidad"), JSON.stringify(margen(oK.id)) === JSON.stringify(mk));
  // Anular devolución (corrección con historial) → vuelve el saldo.
  const dv = devoluciones(oK.id);
  await p.locator(`[data-anular-devolucion="${dv[1].id}"]`).click(); await p.locator('[data-ventana="motivo"]').waitFor();
  await p.locator("[data-motivo]").fill("Transferencia devuelta por el banco"); await p.locator("[data-confirmar-motivo]").click(); await espera(p, 2000);
  ok(T("E14 anular una devolución repone el saldo y la conserva como anulada"), $(await txt(p.locator('[data-kpi-valor="fin-pendiente"]'))) === 100000 && devoluciones(oK.id).filter((x) => x.estado === "anulada").length === 1
    && /Anulados \(1\)/.test(await txt(p.locator("[data-financiamiento-venta]"))));
  ok(T("E15 el historial de la venta registra aportes y devoluciones"), /vp_fin_aportes|vp_fin_devoluciones|aporte|devoluci/i.test(await txt(p.locator('[data-hoja-lateral="ficha-venta"]'))));

  // 4. Venta con vendedor personal y financiamiento de BFK.
  const oB = movil ? movilB : oBfk;
  await irOrden(p, oB.folio, movil);
  ok(T("E16 venta con vendedor personal (Kevin)"), /Kevin Vergara/.test(await txt(p.locator("[data-vendedor-ficha]"))));
  await p.locator("[data-registrar-compra]").click(); await W(p).waitFor(); await W(p).locator('[data-opcion="A"]').click(); await espera(p, 200);
  await W(p).locator("[data-financiamiento-ahora]").click(); await W(p).locator('[data-aporte-campo="aportante"]').selectOption("bfk");
  await confirmar(W(p)); await W(p).locator("[data-registrar-compra-cotizacion]").click(); await espera(p, 2500);
  const ab = aportes(oB.id);
  ok(T("E17 compra financiada por BFK con fondos propios: sin deuda ni devoluciones"), ab.length === 1 && ab[0].aportante_tipo === "bfk" && ab[0].financiador_id === "fin_cuenta_bfk"
    && /Fondos propios · no es deuda/.test(await txt(p.locator("[data-financiamiento-venta]"))) && (await p.locator("[data-registrar-devolucion]").count()) === 0 && $(await txt(p.locator('[data-kpi-valor="fin-pendiente"]'))) === 0);
  await foto(p, `05-financiamiento-bfk-${sufijo}`);

  // 5. Aportes mixtos y financiamiento parcial desde la sección (compra ya registrada).
  const oM = movil ? movilM : oMix;
  await irOrden(p, oM.folio, movil);
  await p.locator("[data-registrar-aporte]").click(); await W(p, "form-aportes").waitFor();
  const FA = W(p, "form-aportes");
  await FA.locator('[data-aporte-fila="1"] [data-aporte-campo="aportante"]').selectOption("fin_kevin");
  await FA.locator('[data-aporte-fila="1"] [data-aporte-campo="monto"]').fill("60000");
  await FA.locator("[data-agregar-aporte]").click();
  await FA.locator('[data-aporte-fila="2"] [data-aporte-campo="aportante"]').selectOption("bfk");
  await FA.locator('[data-aporte-fila="2"] [data-aporte-campo="monto"]').fill("40000");
  await FA.locator("[data-agregar-aporte]").click();
  await FA.locator('[data-aporte-fila="3"] [data-aporte-campo="aportante"]').selectOption("otra");
  await FA.locator('[data-aporte-fila="3"] [data-aporte-campo="nombre"]').fill("Pedro Soto");
  await FA.locator('[data-aporte-fila="3"] [data-aporte-campo="monto"]').fill("50000");
  ok(T("E18 la ventana avisa si lo financiado supera lo que falta"), /supera lo que falta financiar/.test(await txt(FA.locator("[data-resumen-aportes]"))));
  await FA.locator("[data-guardar-aportes]").click(); await espera(p, 400);
  ok(T("E19 no se registra un financiamiento mayor que lo pagado"), /supera lo que falta financiar/.test(await txt(FA.locator("[data-errores-aportes]"))) && aportes(oM.id).length === 0);
  await FA.locator('[data-aporte-fila="3"] [data-aporte-campo="monto"]').fill("10000");
  await foto(p, `06-aportes-mixtos-${sufijo}`);
  await FA.locator("[data-guardar-aportes]").click(); await espera(p, 2200);
  const am = aportes(oM.id);
  ok(T("E20 tres aportantes (Kevin, BFK, otra persona): parcial, falta $34.970"), am.length === 3 && $(await txt(p.locator('[data-kpi-valor="fin-financiado"]'))) === 110000 && $(await txt(p.locator('[data-kpi-valor="fin-falta"]'))) === TOTAL - 110000
    && /Financiamiento parcial/.test(await txt(p.locator("[data-financiamiento-venta]"))) && /Pedro Soto/.test(await txt(p.locator("[data-financiamiento-venta]"))), am);
  ok(T("E21 pendiente de devolución solo de aportes personales ($70.000)"), $(await txt(p.locator('[data-kpi-valor="fin-pendiente"]'))) === 70000);
  await foto(p, `07-parcial-${sufijo}`);

  // 6. Reintento con la respuesta perdida (el servidor registra, el navegador no recibe la respuesta).
  if (!movil) {
    const A = crearAuth(); arranque.desde = Date.now();
    const { page: p2 } = await abrir(browser, { usuario: U.ana, url: URL_APP, hash: "#/panel", auth: A });
    await calma(); arranque.hasta = Date.now();   // la sincronización inicial de Mercado Público de esta otra pestaña no es del módulo
    await irOrden(p2, oRed.folio, false);
    await p2.locator("[data-registrar-compra]").click(); await W(p2).waitFor(); await W(p2).locator('[data-opcion="A"]').click(); await espera(p2, 200);
    await W(p2).locator("[data-financiamiento-ahora]").click(); await W(p2).locator('[data-aporte-campo="aportante"]').selectOption("fin_kevin");
    A.cortes.push({ patron: /rpc\/vp_registrar_compra_financiada/, modo: "despues", veces: 1 });
    await confirmar(W(p2)); await W(p2).locator("[data-registrar-compra-cotizacion]").click(); await espera(p2, 2000);
    const msg = await txt(W(p2).locator("[data-errores-compra]")).catch(() => "");
    ok("E22 respuesta perdida: la app lo informa y permite reintentar sin duplicar", /Se perdió la conexión/.test(msg) && nCompras(oRed.id) === 2 && aportes(oRed.id).length === 1, msg);
    await W(p2).locator("[data-registrar-compra-cotizacion]").click(); await espera(p2, 2500);
    ok("E23 reintento: «ya estaba registrada», sigue habiendo 1 compra y 1 aporte", nCompras(oRed.id) === 2 && aportes(oRed.id).length === 1 && (await W(p2).count()) === 0);
    await p2.close();
  }

  // 7. Vendedor: filtro por vendedor (BFK) y asignar en una venta sin vendedor.
  await p.locator('[data-hoja-lateral="ficha-venta"] [data-cerrar-hoja]').first().click(); await espera(p, 400);
  if (movil) await irListaMovil(p);
  else { await p.locator('aside [data-nav="vp_ordenes"]').click(); }
  await p.locator("[data-panel-vp-ordenes]").waitFor(); await espera(p, 600);
  await p.locator("[data-filtro-vendedor]").selectOption("bfk"); await espera(p, 400);
  const visiblesBfk = await p.locator("[data-venta]").count();
  const bfkBase = Number(q1("select count(*) from public.vp_ventas where estado = 'vigente' and vendedor_tipo = 'bfk';"));
  ok(T("E24 filtro por vendedor BFK: solo sus ventas"), visiblesBfk === bfkBase && (await p.locator('[data-vendedor-venta="vend_kevin"]').count()) === 0, { visiblesBfk, bfkBase });
  await foto(p, `08-filtro-bfk-${sufijo}`);
  await p.locator("[data-filtro-vendedor]").selectOption("*"); await espera(p, 300);
  if (!movil) {
    await p.locator(`[data-venta="${oSin.folio}"]`).click(); await p.locator('[data-hoja-lateral="ficha-venta"]').waitFor(); await espera(p, 800);
    ok("E25 venta sin vendedor: «Sin vendedor asignado» (no se atribuye a nadie)", /Sin vendedor asignado/.test(await txt(p.locator("[data-vendedor-ficha]"))));
    await p.locator("[data-cambiar-vendedor]").click(); await W(p, "form-vendedor").waitFor();
    await W(p, "form-vendedor").locator("[data-selector-vendedor]").selectOption("bfk"); await W(p, "form-vendedor").locator("[data-guardar-vendedor]").click(); await espera(p, 2000);
    ok("E26 el responsable asigna BFK como vendedor; el responsable no cambia", q1(`select vendedor_tipo||'|'||responsable_id from public.vp_ventas where id = '${oSin.id}';`) === `bfk|${U.ana}`
      && /BFK/.test(await txt(p.locator("[data-vendedor-ficha]"))) && (await p.locator("[data-cambiar-vendedor]").count()) === 0);
  }

  // 8. Cotización: el vendedor se elige en «Datos» y se guarda con la cotización (una versión).
  if (!movil) {
    await p.locator('[data-hoja-lateral="ficha-venta"] [data-cerrar-hoja]').first().click(); await espera(p, 300);
    await p.locator('aside [data-nav="vp_cotizaciones"]').click(); await p.locator("[data-panel-vp-cotizaciones]").waitFor(); await espera(p, 600);
    await p.locator(`[data-cotizacion="${cotBorrFolio}"]`).click(); await espera(p, 2500);
    await p.locator('[data-hoja-lateral] button:has-text("Datos")').first().click(); await espera(p, 500);
    const sel = p.locator('[data-campo="vendedor"]');
    ok("E27 «Datos» muestra el vendedor de la cotización y la opción BFK", (await sel.inputValue()) === "vend_kevin" && /BFK \(empresa/.test(await sel.innerText()));
    const v0 = Number(q1(`select version from public.vp_cotizaciones where id = '${cotBorr.id}';`));
    await sel.selectOption("bfk"); await espera(p, 200);
    await foto(p, `09-cotizacion-vendedor-${sufijo}`);
    await p.locator("[data-guardar-cotizacion], [data-guardar]").first().click().catch(async () => { await p.getByRole("button", { name: /^Guardar/ }).first().click(); });
    await espera(p, 2500);
    ok("E28 guardar la cotización con vendedor BFK: una sola versión nueva", q1(`select vendedor_tipo||'|'||version from public.vp_cotizaciones where id = '${cotBorr.id}';`) === `bfk|${v0 + 1}`,
      q1(`select vendedor_tipo||'|'||version from public.vp_cotizaciones where id = '${cotBorr.id}';`));
    await p.keyboard.press("Escape").catch(() => {}); await espera(p, 500);
  }

  // 9. Finanzas: indicadores por vendedor (sin duplicar) y financiamiento de Ventas privadas.
  if (movil) { await p.locator('nav[aria-label="Navegación principal"] [data-nav="finanzas"]').click(); await espera(p, 1500); }
  else { const cerrar = p.locator("[data-cerrar-hoja]").first(); if (await cerrar.count()) await cerrar.click().catch(() => {}); await p.evaluate(() => { window.location.hash = "#/finanzas"; }); await espera(p, 1500); }
  await p.locator('[data-canal-filtro="finanzas"] [data-canal="vp"]').click(); await espera(p, 600);
  await p.locator("[data-periodo]").selectOption("todo"); await espera(p, 600);
  const pv = p.locator("[data-vp-por-vendedor]");
  ok(T("E29 Finanzas › Ventas privadas: tabla por vendedor con BFK"), (await pv.count()) === 1 && /BFK/.test(await txt(pv)) && /sin comisión personal/.test(await txt(pv)));
  const filas = await pv.locator('[data-vendedor-fila]:not([data-vendedor-fila="total"]) [data-vendedor-total]').allInnerTexts();
  const suma = filas.reduce((s, x) => s + $(x), 0); const general = $(await txt(pv.locator("[data-vendedor-total-general]")));
  const vendidoKpi = $(await txt(p.locator('[data-kpi-valor="vp-vendido"]')));
  const totalBase = Number(q1("select sum(total) from public.vp_ventas where estado = 'vigente';"));
  ok(T("E30 la suma por vendedor = total de Ventas privadas = base (cada venta una sola vez)"), suma === general && general === vendidoKpi && vendidoKpi === totalBase, { suma, general, vendidoKpi, totalBase });
  const bfkTot = $(await txt(pv.locator('[data-vendedor-fila="bfk"] [data-vendedor-total]')));
  ok(T("E31 el total BFK = sus ventas en la base (no se atribuyen a Kevin)"), bfkTot === Number(q1("select sum(total) from public.vp_ventas where estado = 'vigente' and vendedor_tipo = 'bfk';")));
  await pv.scrollIntoViewIfNeeded(); await foto(p, `10-finanzas-por-vendedor-${sufijo}`);
  if (movil) await p.locator('[data-nav="financiamiento"]').first().click(); else await p.evaluate(() => { window.location.hash = "#/financiamiento"; });
  await espera(p, 1500);
  const fv = p.locator("[data-fin-vp]");
  ok(T("E32 Finanzas › Financiamiento: sección de Ventas privadas con pendiente por persona"), (await fv.count()) === 1 && /Kevin Vergara/.test(await txt(fv)) && /Pedro Soto/.test(await txt(fv)), await fv.count() ? await txt(fv) : "sin sección");
  const pendBase = JSON.parse(como(U.ana, "select jsonb_build_object('p', coalesce(sum(pendiente_devolucion),0), 'b', coalesce(sum(financiado_bfk),0)) from public.vp_fin_resumen;"));
  ok(T("E33 los totales de Finanzas coinciden con la base"), $(await txt(p.locator('[data-kpi-valor="finvp-pendiente"]'))) === Number(pendBase.p) && $(await txt(p.locator('[data-kpi-valor="finvp-bfk"]'))) === Number(pendBase.b), pendBase);
  await fv.scrollIntoViewIfNeeded(); await foto(p, `11-finanzas-financiamiento-${sufijo}`);
  ok(T("E34 sin desborde horizontal"), await sinDesborde(p));
  const esc = escriturasMP(m0).filter((x) => !(x.t >= arranque.desde && x.t <= arranque.hasta));
  ok(T("E35 Mercado Público no recibió escrituras del módulo"), esc.length === 0, esc);
  ok(T("E36 sin errores de JavaScript"), errs.length === 0, errs);
  await p.close();
}

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
try {
  await recorrido(browser, { movil: false });
  await recorrido(browser, { movil: true });
  // Otro usuario (no responsable ni administrador): no ve costos ni financiamiento.
  const { page: pb } = await abrir(browser, { usuario: U.beto, url: URL_APP, hash: "#/panel" });
  await irOrden(pb, oKev.folio, false).catch(() => {});
  ok("E37 otro usuario no ve el financiamiento ni sus montos", (await pb.locator("[data-financiamiento-venta]").count()) === 0 && /visibles solo para el responsable/.test(await txt(pb.locator('[data-hoja-lateral="ficha-venta"]'))));
  await pb.close();
} catch (e) { F.push("EXCEPCIÓN"); console.log("EXCEPCIÓN", e.message); }
finally { await browser.close(); }
console.log(`RESUMEN e2e_financiamiento: ${nOk} OK, ${F.length} fallas${F.length ? " · " + F.join(" | ") : ""}`);
process.exit(F.length ? 1 : 0);
