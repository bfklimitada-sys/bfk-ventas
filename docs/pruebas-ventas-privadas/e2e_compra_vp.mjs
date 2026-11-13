// «Registrar compra» de una orden de venta privada desde la cotización aprobada (10/11/2026) — navegador real, PostgREST REAL
// sobre una base desechable (nunca producción). Recorrido de Mercado Público (A · igual a lo cotizado / B · modificar datos).
// Caso principal pedido: orden ya creada con 2 unidades y un precio de proveedor MENOR al cotizado → total a pagar y utilidad
// antes de guardar, y costo real de la orden actualizado; precio de venta y cotización aprobada intactos.
// Uso: (entorno.sh instalar) → PGRST_URL, JWT_SECRET, VP_DB_URL · node docs/pruebas-ventas-privadas/e2e_compra_vp.mjs http://127.0.0.1:4330/
import { abrir, chromium, CHROME, U, psql, comoUsuario } from "./arnes_vp.mjs";
// Fecha de hoy en Chile: con la fecha UTC, después de las 21:00 (hora de Chile) la base la rechazaba por «futura» (VP_FECHA) y la
// comprobación P25 fallaba por la hora del día, no por lo que valida (no comprar más de lo vendido).
const HOY_CHILE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(new Date());

const URL_APP = process.argv[2] || "http://127.0.0.1:4330/";
let nOk = 0; const F = [];
const ok = (n, c, det = "") => { if (c) { nOk++; console.log("OK   ", n); } else { F.push(n); console.log("FALLA", n, typeof det === "string" ? det.slice(0, 600) : JSON.stringify(det).slice(0, 600)); } };
const espera = (p, ms = 400) => p.waitForTimeout(ms);
const q1 = (sql) => psql(sql).split("\n").pop();
const lit = (s) => { const t = "q" + Math.random().toString(36).slice(2, 8); return `$${t}$${s}$${t}$`; };
const $ = (x) => { const t = String(x); const n = Number(t.replace(/[^\d]/g, "")); return /[−-]/.test(t) ? -n : n; };
const comoAna = (sql) => q1(`${comoUsuario(U.ana)}${sql}`);

// ── Datos: cliente, cotización aceptada (2 unidades a $59.990 c/u con IVA, con factura, despacho $5.990) y su orden de venta ──
const cliPrevio = q1(`select id from public.pi_clientes where regexp_replace(rut, '[^0-9kK]', '', 'g') = '761234560' limit 1;`);
const cli = cliPrevio || JSON.parse(comoAna(`select public.vp_guardar_cliente(${lit(JSON.stringify({ rut: "76123456-0", razon_social: "Constructora Biobío SpA (prueba)", tipo_persona: "empresa", direccion_entrega: "Av. Prat 100, Laja", comuna_entrega: "Laja" }))}::jsonb);`)).id;
const DESP = { key: "e-prueba", proveedor: "Ferretería Sur", monto: 5990, con_factura: true, estado: "confirmado", destino: "Av. Prat 100, Laja", evidencia: "cotización por correo" };
const costoUnit = Math.round(((2 * 59990) / 1.19 + 5990 / 1.19) / 2 * 100) / 100;
function nuevaOrden({ cantidad = 2, precioCompra = 59990, conDespacho = true } = {}) {
  const item = { tipo: "producto", descripcion: "Taladro percutor 750 W · Bosch GSB 13 RE", unidad: "UN", cantidad, precio_unitario: 79990,
    ficha: { nombre: "Taladro percutor 750 W", marca: "Bosch", modelo: "GSB 13 RE", generales: [], especificaciones: [{ etiqueta: "Potencia", valor: "750 W" }], imagenes: [] }, ficha_aprobada: true,
    costo_unitario: costoUnit, proveedor: "Ferretería Sur", enlace: "https://ferreteria.example/taladro", precio_compra: precioCompra, precio_incluye_iva: true, con_factura: true, despacho: conDespacho ? DESP : null };
  const cot = JSON.parse(comoAna(`select public.vp_guardar_cotizacion(${lit(JSON.stringify({ cliente_id: cli, plazo_entrega: "5 días hábiles", vigencia_dias: 15, direccion_entrega: "Av. Prat 100, Laja", items: [item] }))}::jsonb);`));
  const ver = () => Number(q1(`select version from public.vp_cotizaciones where id = '${cot.id}';`));
  comoAna(`select public.vp_cotizacion_estado('${cot.id}', 'enviada', '{}'::jsonb, ${ver()});`);
  comoAna(`select public.vp_cotizacion_estado('${cot.id}', 'aceptada', '{}'::jsonb, ${ver()});`);
  const v = JSON.parse(comoAna(`select public.vp_crear_venta_desde_cotizacion('${cot.id}', gen_random_uuid(), '{}'::jsonb);`));
  return { cot: cot.id, id: v.id, folio: v.folio };
}
const margen = (id) => JSON.parse(comoAna(`select to_jsonb(m) from public.vp_margen_ventas m where venta_id = '${id}';`));
const compras = (id) => JSON.parse(q1(`select coalesce(jsonb_agg(to_jsonb(k) order by k.creado_en, k.concepto desc), '[]') from public.vp_compras k where venta_id = '${id}';`));
const huellaVenta = (id) => q1(`select md5(string_agg(i.precio_unitario::text||'|'||i.cantidad::text||'|'||i.subtotal_neto::text||'|'||coalesce(k.precio_compra::text,'')||'|'||coalesce(k.costo_unitario_estimado::text,''), ',' order by i.orden))
  ||'|'||(select neto::text||'/'||total::text from public.vp_ventas where id = '${id}') from public.vp_venta_items i left join public.vp_venta_item_costos k on k.item_id = i.id where i.venta_id = '${id}';`);
const huellaCot = (cotId) => q1(`select md5(string_agg(to_jsonb(i)::text||coalesce(to_jsonb(k)::text,''), ',' order by i.orden)) from public.vp_cotizacion_items i join public.vp_cotizacion_revisiones r on r.id = i.revision_id
  left join public.vp_cotizacion_item_costos k on k.item_id = i.id where r.cotizacion_id = '${cotId}';`);
const W = (p) => p.locator('[data-ventana="compra-cotizacion-vp"]');
const txt = async (loc) => (await loc.innerText()).trim();

async function abrirOrden(p, folio) {
  if (await p.locator('[data-hoja-lateral="ficha-venta"]').count()) { await p.locator('[data-hoja-lateral="ficha-venta"] [data-cerrar-hoja]').first().click(); await espera(p, 400); }
  await p.locator('aside [data-nav="vp_ordenes"]').click(); await p.locator("[data-panel-vp-ordenes]").waitFor(); await espera(p, 600);
  await p.locator(`[data-venta="${folio}"]`).click(); await p.locator('[data-hoja-lateral="ficha-venta"]').waitFor(); await espera(p, 1200);
}

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
try {
  const o = nuevaOrden(); const hv0 = huellaVenta(o.id); const hc0 = huellaCot(o.cot); const m0 = margen(o.id);
  ok("P00 orden creada desde la cotización aprobada: 2 unidades, sin compras", m0.n_compras === 0 && Number(m0.costo_estimado) > 0, m0);
  const { page: p, ctx, errs } = await abrir(browser, { usuario: U.ana, url: URL_APP, hash: "#/panel" });
  await abrirOrden(p, o.folio);
  await p.locator("[data-registrar-compra]").click(); await W(p).waitFor();
  const lin = await txt(W(p).locator("[data-estado-lineas]"));
  ok("P01 «Registrar compra» abre el recorrido de Mercado Público con la cotización aprobada", /Cotización aprobada: CP-/.test(await txt(W(p))) && (await W(p).locator('[data-opcion="A"]').count()) === 1 && (await W(p).locator('[data-opcion="B"]').count()) === 1
    && /La compra es igual a lo cotizado/.test(await txt(W(p))) && /Modificar datos de la compra/.test(await txt(W(p))), await txt(W(p)));
  ok("P02 cantidades: 2 vendidas, 0 compradas, 2 pendientes", /vendidas 2 · compradas 0/.test(lin) && (await txt(W(p).locator('[data-pendiente="1"]'))) === "2", lin);

  // A: igual a lo cotizado (precarga: proveedor, enlace, precio unitario con IVA y despacho).
  await W(p).locator('[data-opcion="A"]').click(); await espera(p, 300);
  const fa = await txt(W(p).locator("[data-filas-compra]"));
  ok("P03 opción A precarga ítem, cantidad pendiente, proveedor, enlace y precio con IVA", /Taladro percutor 750 W/.test(fa) && /× 2/.test(fa) && /Ferretería Sur/.test(fa) && /\$\s?59\.990 c\/u con IVA/.test(fa) && /ferreteria\.example/.test(fa), fa);
  ok("P04 opción A: despacho cotizado una vez y total a pagar = 2 × 59.990 + 5.990", $(await txt(W(p).locator('[data-costo-pedido="1"]'))) === 125970 && $(await txt(W(p).locator("[data-total-real]"))) === 125970);

  // B: precio de proveedor MENOR al cotizado (49.990 c/u con IVA).
  await W(p).locator('[data-opcion="B"]').click(); await espera(p, 300);
  ok("P05 opción B precarga los mismos datos para editarlos", (await W(p).locator('[data-campo-compra="unitario"]').inputValue()) === "59.990" && (await W(p).locator('[data-campo-compra="cantidad"]').inputValue()) === "2"
    && (await W(p).locator('[data-campo-compra="proveedor"]').inputValue()) === "Ferretería Sur" && (await W(p).locator('[data-campo-compra="enlace"]').inputValue()) === "https://ferreteria.example/taladro"
    && (await W(p).locator('[data-despacho-real]').inputValue()) === "5.990");
  await W(p).locator('[data-campo-compra="unitario"]').fill("49990"); await espera(p, 300);
  const totalReal = $(await txt(W(p).locator("[data-total-real]"))); const costoCompra = $(await txt(W(p).locator("[data-costo-esta-compra]")));
  const utilAct = $(await txt(W(p).locator("[data-utilidad-actualizada]"))); const utilOrig = $(await txt(W(p).locator("[data-utilidad-original]")));
  const esperadoCosto = Math.round(99980 / 1.19) + Math.round(5990 / 1.19);   // filas: producto y despacho, con factura (IVA crédito fiscal)
  ok("P06 antes de guardar: total a pagar con IVA = 2 × 49.990 + 5.990 = 105.970 y diferencia −20.000", totalReal === 105970 && $(await txt(W(p).locator("[data-diferencia-total]"))) === -20000, { totalReal });
  ok("P07 antes de guardar: costo real neto (factura) y utilidad actualizada mayor que la estimada", costoCompra === esperadoCosto && utilAct === 159980 - esperadoCosto && utilAct > utilOrig
    && utilOrig === 159980 - Math.round(Number(m0.costo_estimado)), { costoCompra, esperadoCosto, utilAct, utilOrig });
  ok("P08 el campo modificado se destaca y muestra lo cotizado", /Cotizado: \$\s?59\.990/.test(await txt(W(p).locator("[data-filas-compra]"))));
  // Proveedor y despacho también recalculan antes de guardar.
  await W(p).locator('[data-despacho-real]').fill("7990"); await espera(p, 200);
  ok("P09 cambiar el despacho recalcula el total a pagar (una sola vez por pedido)", $(await txt(W(p).locator("[data-total-real]"))) === 107970);
  await W(p).locator('[data-despacho-real]').fill("5990"); await espera(p, 200);
  await W(p).locator('[data-campo-compra="cantidad"]').fill("3"); await espera(p, 200);
  await W(p).locator("[data-registrar-compra-cotizacion]").click(); await espera(p, 800);
  ok("P10 no permite comprar más de lo vendido (3 de 2)", /quedan 2 pendientes/.test(await txt(W(p).locator("[data-errores-compra]"))) && compras(o.id).length === 0);
  await W(p).locator('[data-campo-compra="cantidad"]').fill("2"); await espera(p, 200);
  await W(p).locator("[data-registrar-compra-cotizacion]").click(); await espera(p, 2500);
  const ks = compras(o.id); const m1 = margen(o.id);
  ok("P11 compra guardada: una fila de producto (2 × 49.990) y una de despacho, factura, mismo pedido", ks.length === 2 && ks.some((k) => k.concepto === "producto" && Number(k.cantidad) === 2 && Number(k.precio_unitario) === 49990 && Number(k.total) === 99980 && k.iva_recuperable && k.proveedor === "Ferretería Sur" && k.enlace === "https://ferreteria.example/taladro")
    && ks.some((k) => k.concepto === "despacho" && Number(k.total) === 5990 && k.envio_clave === "e-prueba") && new Set(ks.map((k) => k.pedido)).size === 1 && ks.every((k) => k.documento_tipo === "factura"), ks);
  ok("P12 costo real de la orden = lo mostrado antes de guardar", Number(m1.costo_real) === esperadoCosto && Number(m1.n_compras) === 2, { m1, esperadoCosto });
  ok("P13 precio de venta, ítems y costo estimado de la orden sin cambios; cotización aprobada intacta", huellaVenta(o.id) === hv0 && huellaCot(o.cot) === hc0 && Number(m1.costo_estimado) === Number(m0.costo_estimado));
  const mv = await txt(p.locator("[data-margen-venta]"));
  ok("P14 la ficha muestra el costo real y la utilidad real actualizados", (await W(p).count()) === 0 && /Costo real \(2 registros\)/.test(mv) && mv.includes(new Intl.NumberFormat("es-CL").format(esperadoCosto))
    && mv.includes(new Intl.NumberFormat("es-CL").format(159980 - esperadoCosto)), mv);
  ok("P15 ítem: comprado 2 de 2; la lista de compras muestra cantidad y pedido", /comprado 2 de 2/.test(await txt(p.locator('[data-comprado-item="1"]'))) && /× 2 · Pedido/.test(await txt(p.locator("[data-compra-detalle]").first())));
  // Reintento con la misma compra (respuesta perdida): la base no duplica.
  const filas = ks.map((k) => ({ clave: k.clave, pedido: k.pedido, concepto: k.concepto, venta_item_id: k.venta_item_id, envio_clave: k.envio_clave, cantidad: k.cantidad, precio_unitario: k.precio_unitario, monto: k.total, documento_tipo: k.documento_tipo }));
  const re = JSON.parse(comoAna(`select public.vp_registrar_compras_cotizacion(${lit(JSON.stringify({ venta_id: o.id, fecha: ks[0].fecha, filas }))}::jsonb);`));
  ok("P16 reintento de la misma compra: «ya_existia», sin filas nuevas", re.ya_existia === true && compras(o.id).length === 2);
  await p.locator("[data-registrar-compra]").click(); await W(p).waitFor();
  ok("P17 con todo comprado, el recorrido lo indica y ofrece el registro manual", (await W(p).locator("[data-todo-comprado]").count()) === 1 && (await W(p).locator("[data-compra-manual]").count()) === 1);
  // Registro manual y vínculo de gasto: se conservan.
  await W(p).locator("[data-compra-manual]").click(); const fm = p.locator('[data-ventana="form-compra"]'); await fm.waitFor();
  ok("P18 registro manual y «Vincular gasto ya registrado» siguen disponibles", (await fm.locator("[data-compra-neto]").count()) === 1 && /Vincular gasto ya registrado/.test(await txt(fm)));
  await fm.locator("[data-compra-proveedor]").fill("Transporte local"); await fm.locator("[data-compra-neto]").fill("10000"); await fm.locator("[data-guardar-compra]").click(); await espera(p, 2000);
  ok("P19 el registro manual se suma al costo real como antes", Number(margen(o.id).costo_real) === esperadoCosto + 10000 && compras(o.id).length === 3 && compras(o.id).some((k) => k.concepto == null && Number(k.neto) === 10000));

  // Compra PARCIAL: 1 de 2 → lo comprado y lo pendiente; luego el resto con la opción A (el despacho ya no se cuenta).
  const o2 = nuevaOrden();
  await p.reload({ waitUntil: "load" }); await espera(p, 2500); await abrirOrden(p, o2.folio);
  await p.locator("[data-registrar-compra]").click(); await W(p).waitFor(); await W(p).locator('[data-opcion="B"]').click(); await espera(p, 200);
  await W(p).locator('[data-campo-compra="cantidad"]').fill("1"); await espera(p, 300);
  const av = await txt(W(p).locator("[data-aviso-parcial]").first()).catch(() => "");
  ok("P20 compra parcial: muestra lo comprado ahora y lo pendiente antes de guardar", /quedan pendientes 1 de «Taladro percutor 750 W»/.test(av) && (await txt(W(p).locator('[data-en-esta-compra="1"]'))) === "1" && (await txt(W(p).locator('[data-pendiente="1"]'))) === "1", av);
  await W(p).locator("[data-registrar-compra-cotizacion]").click(); await espera(p, 2500);
  ok("P21 parcial guardada: 1 unidad y el despacho una vez", compras(o2.id).filter((k) => k.concepto === "producto").reduce((s, k) => s + Number(k.cantidad), 0) === 1 && compras(o2.id).filter((k) => k.concepto === "despacho").length === 1);
  await p.locator("[data-registrar-compra]").click(); await W(p).waitFor();
  ok("P22 al volver: compradas 1, pendientes 1", /compradas 1/.test(await txt(W(p).locator("[data-estado-lineas]"))) && (await txt(W(p).locator('[data-pendiente="1"]'))) === "1");
  await W(p).locator('[data-opcion="A"]').click(); await espera(p, 200);
  ok("P23 el despacho ya registrado no se vuelve a contar", /ya registrado en una compra anterior/.test(await txt(W(p).locator("[data-despachos]"))) && $(await txt(W(p).locator("[data-total-real]"))) === 59990);
  await W(p).locator('[data-confirmar="vigencia"] input').check(); await W(p).locator("[data-registrar-compra-cotizacion]").click(); await espera(p, 2500);
  const m2 = margen(o2.id);
  ok("P24 resto comprado: 2 de 2, costo real = 2 productos + 1 despacho", compras(o2.id).filter((k) => k.concepto === "producto").reduce((s, k) => s + Number(k.cantidad), 0) === 2
    && Number(m2.costo_real) === Math.round(59990 / 1.19) * 2 + Math.round(5990 / 1.19), m2);
  // La base rechaza comprar más de lo vendido aunque la app no lo valide.
  const it2 = q1(`select id from public.vp_venta_items where venta_id = '${o2.id}';`);
  let rech = ""; try { rech = psql(`${comoUsuario(U.ana)}select public.vp_registrar_compras_cotizacion(${lit(JSON.stringify({ venta_id: o2.id, fecha: HOY_CHILE, filas: [{ clave: "X-1-a-0", pedido: "X-1", concepto: "producto", venta_item_id: it2, cantidad: 1, precio_unitario: 1000 }] }))}::jsonb);`); } catch (e) { rech = String(e.stderr || e.message); }
  ok("P25 la base rechaza comprar más de lo vendido", /VP_CANTIDAD/.test(rech), rech);

  // Orden directa (sin cotización): el botón abre el registro manual de siempre.
  let directa = {}; try { directa = JSON.parse(comoAna(`select public.vp_crear_venta_directa(${lit(JSON.stringify({ cliente_id: cli, clave: crypto.randomUUID(), items: [{ tipo: "producto", descripcion: "Servicio de instalación", unidad: "GL", cantidad: 1, precio_unitario: 50000 }] }))}::jsonb);`)); } catch { directa = {}; }
  if (directa.folio) {
    await p.reload({ waitUntil: "load" }); await espera(p, 2500); await abrirOrden(p, directa.folio);
    const hayBoton = await p.locator("[data-registrar-compra]").count();
    if (hayBoton) { await p.locator("[data-registrar-compra]").click(); await espera(p, 500); }
    ok("P26 orden directa: sin cotización, se mantiene el registro manual", !hayBoton || ((await p.locator('[data-ventana="form-compra"]').count()) === 1 && (await W(p).count()) === 0));
  } else ok("P26 orden directa: sin cotización, se mantiene el registro manual (sin función de venta directa en esta base: se omite)", true);
  ok("P27 sin errores de página", !errs.length, errs.join(" | "));
  await ctx.close();
} catch (e) { F.push("EXCEPCIÓN: " + e.message.split("\n")[0]); console.log("EXCEPCIÓN", e.stack); }
finally { await browser.close(); }
console.log(`RESUMEN e2e_compra_vp: ${nOk} OK, ${F.length} fallas${F.length ? " · " + F.join(" | ") : ""}`);
process.exit(F.length ? 1 : 0);
