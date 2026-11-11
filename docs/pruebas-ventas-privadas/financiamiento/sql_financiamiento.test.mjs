// Financiamiento de compras y vendedor «BFK» de Ventas privadas (11/11/2026) — pruebas de la base DESECHABLE (nunca producción).
// Cada llamada corre en una sesión psql propia con el rol «authenticated» y el usuario del JWT (igual que PostgREST): RLS,
// privilegios, disparadores y funciones se aplican de verdad. Concurrencia real con dos sesiones simultáneas.
// Uso: VP_DB_URL=postgresql://postgres@127.0.0.1:5499/bfk_vp_e2e node docs/pruebas-ventas-privadas/financiamiento/sql_financiamiento.test.mjs
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

const DB = process.env.VP_DB_URL;
if (!DB) { console.error("Falta VP_DB_URL"); process.exit(2); }
const U = { admin: "11111111-1111-1111-1111-111111111111", ana: "22222222-2222-2222-2222-222222222222", beto: "33333333-3333-3333-3333-333333333333", sinPerfil: "99999999-9999-9999-9999-999999999999" };
let ok = 0, fallas = 0;
const check = (cond, nombre, detalle = "") => { if (cond) { ok++; if (process.env.VERBOSO) console.log("OK   ", nombre); } else { fallas++; console.log("FALLA:", nombre, String(detalle).slice(0, 400)); } };
const lit = (s) => { const t = "q" + Math.random().toString(36).slice(2, 8); return `$${t}$${s}$${t}$`; };
const j = (o) => `${lit(JSON.stringify(o))}::jsonb`;
function psql(sql, db = DB) {
  try { return { out: execFileSync("psql", [db, "-X", "-At", "-q", "-v", "ON_ERROR_STOP=1"], { input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim() }; }
  catch (e) { return { err: String(e.stderr || e.message).trim() }; }
}
const prefijo = (u) => u === "anon" ? "set role anon;\n" : `set role authenticated;\nselect set_config('request.jwt.claims', ${lit(JSON.stringify({ sub: u, role: "authenticated" }))}, false) \\g /dev/null\n`;
const como = (u, sql) => psql(prefijo(u) + sql);
const valor = (u, sql) => { const r = como(u, sql); if (r.err) throw new Error(r.err); return r.out; };
const rpc = (u, fn, ...args) => como(u, `select public.${fn}(${args.join(", ")});`);
const rpcJ = (u, fn, ...args) => { const r = rpc(u, fn, ...args); if (r.err) throw new Error(`${fn}: ${r.err}`); return JSON.parse(r.out); };
const falla = (r, patron, nombre) => check(!!r.err && new RegExp(patron).test(r.err), nombre, r.err ? r.err.split("\n")[0] : `sin error (${r.out})`);
const root = (sql) => { const r = psql(sql); if (r.err) throw new Error(r.err); return r.out; };
const hoy = root("select public.vp_hoy();");
const ayer = root("select (public.vp_hoy() - 1)::text;");
const manana = root("select (public.vp_hoy() + 1)::text;");

// Huella de Mercado Público y de lo que el financiamiento NO debe tocar.
const HUELLA_MP = `select md5(coalesce((select string_agg(to_jsonb(o)::text, '|' order by id) from public.ordenes_compra_v2 o), '')
  || coalesce((select string_agg(to_jsonb(f)::text, '|' order by id) from public.financiadores f), '')
  || coalesce((select string_agg(to_jsonb(v)::text, '|' order by id) from public.vendedores v), '')
  || coalesce((select string_agg(to_jsonb(g)::text, '|' order by id) from public.gastos_indirectos g), ''))`;
const huellaMP0 = root(HUELLA_MP);

// ── Datos: cliente, cotización aceptada con costos de compra, orden de venta ───────────────────────────────
const cliPrevio = root(`select id from public.pi_clientes where regexp_replace(rut, '[^0-9kK]', '', 'g') = '770001110' limit 1;`);
const cli = cliPrevio || rpcJ(U.ana, "vp_guardar_cliente", j({ rut: "77000111-0", razon_social: "Forestal Laja SpA (prueba financiamiento)", tipo_persona: "empresa", direccion_entrega: "Los Boldos 1, Laja" })).id;
const DESP = { key: "e-fin", proveedor: "Ferretería Sur", monto: 4990, con_factura: true, estado: "confirmado", destino: "Los Boldos 1, Laja", evidencia: "correo" };
function nuevaOrden({ vendedor, usuario = U.ana, cantidad = 2, precio = 79990, compra = 69990 } = {}) {
  const item = { tipo: "producto", descripcion: "Motosierra 45 cc", unidad: "UN", cantidad, precio_unitario: precio, ficha: { nombre: "Motosierra 45 cc", marca: "Stihl", modelo: "MS 250" }, ficha_aprobada: true,
    costo_unitario: Math.round((compra / 1.19) * 100) / 100 + 2097, proveedor: "Ferretería Sur", enlace: "https://ferreteria.example/ms250", precio_compra: compra, precio_incluye_iva: true, con_factura: true, despacho: DESP };
  const p = { cliente_id: cli, plazo_entrega: "3 días", vigencia_dias: 15, items: [item] };
  if (vendedor !== undefined) p.vendedor = vendedor;
  const cot = rpcJ(usuario, vendedor !== undefined ? "vp_guardar_cotizacion_v2" : "vp_guardar_cotizacion", j(p));
  const ver = () => Number(root(`select version from public.vp_cotizaciones where id = '${cot.id}';`));
  rpcJ(usuario, "vp_cotizacion_estado", `'${cot.id}'`, "'enviada'", "'{}'::jsonb", ver());
  rpcJ(usuario, "vp_cotizacion_estado", `'${cot.id}'`, "'aceptada'", "'{}'::jsonb", ver());
  const v = rpcJ(usuario, "vp_crear_venta_desde_cotizacion", `'${cot.id}'`, "gen_random_uuid()", "'{}'::jsonb");
  const it = root(`select id from public.vp_venta_items where venta_id = '${v.id}' order by orden limit 1;`);
  return { cot: cot.id, id: v.id, folio: v.folio, item: it };
}
// Filas de compra como las arma la interfaz (lib/compraVentaPrivada.js · filasParaGuardar).
const filasCompra = (o, { cantidad = 2, unitario = 69990, despacho = 4990, pedido = randomUUID().replace(/-/g, "") } = {}) => ({ venta_id: o.id, fecha: hoy, filas: [
  { clave: `${pedido}-1-it-0`, pedido: `${pedido}-1`, concepto: "producto", venta_item_id: o.item, cantidad, precio_unitario: unitario, proveedor: "Ferretería Sur", documento_tipo: "factura", descripcion: "Motosierra × " + cantidad },
  ...(despacho ? [{ clave: `${pedido}-1-desp-0`, pedido: `${pedido}-1`, concepto: "despacho", envio_clave: "e-fin", monto: despacho, proveedor: "Ferretería Sur", documento_tipo: "factura", descripcion: "Despacho" }] : [])] });
const aporte = (o) => ({ clave: randomUUID(), fecha: hoy, medio: "transferencia", ...o });
const resumen = (u, id) => JSON.parse(valor(u, `select coalesce(to_jsonb(r), 'null') from public.vp_fin_resumen r where venta_id = '${id}';`));
const margen = (u, id) => JSON.parse(valor(u, `select to_jsonb(m) from public.vp_margen_ventas m where venta_id = '${id}';`));
const huellaCostos = (id) => root(`select md5(coalesce((select string_agg(to_jsonb(k)::text, '|' order by id) from public.vp_compras k where venta_id = '${id}'), '')
  || (select to_jsonb(v)::text from (select neto, iva, total, bruto, descuento from public.vp_ventas where id = '${id}') v)
  || coalesce((select string_agg(to_jsonb(i)::text, '|' order by orden) from public.vp_venta_items i where venta_id = '${id}'), '')
  || coalesce((select string_agg(to_jsonb(p)::text, '|' order by id) from public.vp_pagos p where venta_id = '${id}'), ''))`);
const historialFin = (id) => Number(root(`select count(*) from public.vp_historial where venta_id = '${id}' and tabla in ('vp_fin_aportes','vp_fin_devoluciones');`));

// Compras «anteriores» a la migración: registradas con la función existente, sin financiamiento.
const previa = nuevaOrden();
rpcJ(U.ana, "vp_registrar_compras_cotizacion", j(filasCompra(previa)));

// ═══ 1. Vendedor BFK ═══════════════════════════════════════════════════════════════════════════════════════
const sinVend = nuevaOrden();
check(root(`select vendedor_tipo is null and vendedor_id is null and vendedor_nombre is null from public.vp_ventas where id = '${sinVend.id}';`) === "t", "V01 cotización y venta sin vendedor: quedan «sin asignar» (no se atribuyen a nadie)");
const cBfk = rpcJ(U.ana, "vp_guardar_cotizacion_v2", j({ cliente_id: cli, plazo_entrega: "3 días", items: [{ tipo: "producto", descripcion: "Guantes", unidad: "UN", cantidad: 1, precio_unitario: 1000 }], vendedor: "bfk" }));
check(cBfk.vendedor_tipo === "bfk" && cBfk.vendedor_nombre === "BFK" && cBfk.vendedor_id === null, "V02 cotización con vendedor «BFK» sin cuenta de acceso ficticia", JSON.stringify(cBfk));
check(root(`select responsable_id from public.vp_cotizaciones where id = '${cBfk.id}';`) === U.ana, "V03 el responsable sigue siendo el usuario que gestiona (Ana)");
const cBfk2 = rpcJ(U.ana, "vp_guardar_cotizacion_v2", j({ id: cBfk.id, version: cBfk.version, cliente_id: cli, plazo_entrega: "3 días", items: [{ tipo: "producto", descripcion: "Guantes", unidad: "UN", cantidad: 2, precio_unitario: 1000 }], vendedor: "vend_kevin" }));
check(cBfk2.vendedor_tipo === "vendedor" && cBfk2.vendedor_nombre === "Kevin Vergara" && cBfk2.version === cBfk.version + 1, "V04 cambiar vendedor al guardar el borrador: una sola versión por guardado", JSON.stringify(cBfk2));
const cBfk3 = rpcJ(U.ana, "vp_guardar_cotizacion_v2", j({ id: cBfk.id, version: cBfk2.version, cliente_id: cli, plazo_entrega: "4 días", items: [{ tipo: "producto", descripcion: "Guantes", unidad: "UN", cantidad: 2, precio_unitario: 1000 }] }));
check(cBfk3.vendedor_id === "vend_kevin", "V05 guardar sin la clave «vendedor» conserva el vendedor");
falla(rpc(U.ana, "vp_guardar_cotizacion_v2", j({ id: cBfk.id, version: cBfk3.version, cliente_id: cli, items: [{ tipo: "producto", descripcion: "x", unidad: "UN", cantidad: 1, precio_unitario: 1 }], vendedor: "vend_inactivo" })), "VP_VENDEDOR", "V06 vendedor inactivo o inexistente: rechazado");
falla(rpc(U.ana, "vp_guardar_cotizacion_v2", j({ id: cBfk.id, version: cBfk3.version, cliente_id: cli, items: [{ tipo: "producto", descripcion: "x", unidad: "UN", cantidad: 1, precio_unitario: 1 }], vendedor: "Kevin" })), "VP_VENDEDOR", "V07 no se puede escribir un nombre libre como vendedor");
falla(rpc(U.beto, "vp_asignar_vendedor", "'cotizacion'", `'${cBfk.id}'`, "'bfk'", cBfk3.version), "VP_PERMISO", "V08 otro usuario no asigna vendedor");
// Venta con vendedor BFK desde una cotización: se conserva al convertir (con la función de conversión existente).
const vBfk = nuevaOrden({ vendedor: "bfk" });
check(root(`select vendedor_tipo||'|'||vendedor_nombre||'|'||coalesce(vendedor_id,'-') from public.vp_ventas where id = '${vBfk.id}';`) === "bfk|BFK|-", "V09 al convertir la cotización en venta se conserva el vendedor BFK");
check(root(`select responsable_id from public.vp_ventas where id = '${vBfk.id}';`) === U.ana, "V10 la venta BFK mantiene un usuario responsable (Ana)");
const vKev = nuevaOrden({ vendedor: "vend_kevin" });
check(root(`select vendedor_id from public.vp_ventas where id = '${vKev.id}';`) === "vend_kevin", "V11 venta con vendedor personal desde la cotización");
// Venta directa con vendedor.
const vd = rpcJ(U.ana, "vp_crear_venta_directa_v2", j({ clave: randomUUID(), cliente_id: cli, items: [{ tipo: "servicio", descripcion: "Mantención", unidad: "UN", cantidad: 1, precio_unitario: 50000, costo_unitario: 20000 }], vendedor: "bfk" }));
check(root(`select vendedor_tipo from public.vp_ventas where id = '${vd.id}';`) === "bfk", "V12 venta directa con vendedor BFK");
// Asignar en ventas existentes: solo cuando no tiene; cambiar uno asignado, solo administrador. Nada automático.
const verV = (id) => Number(root(`select version from public.vp_ventas where id = '${id}';`));
const a1 = rpcJ(U.ana, "vp_asignar_vendedor", "'venta'", `'${sinVend.id}'`, "'bfk'", verV(sinVend.id));
check(a1.vendedor_tipo === "bfk", "V13 el responsable asigna vendedor a una venta sin vendedor");
falla(rpc(U.ana, "vp_asignar_vendedor", "'venta'", `'${sinVend.id}'`, "'vend_kevin'", verV(sinVend.id)), "solo un administrador", "V14 cambiar un vendedor ya asignado en una venta: solo administrador");
falla(rpc(U.admin, "vp_asignar_vendedor", "'venta'", `'${sinVend.id}'`, "'vend_kevin'", verV(sinVend.id) - 1), "VP409", "V15 control de versión al asignar");
const a2 = rpcJ(U.admin, "vp_asignar_vendedor", "'venta'", `'${sinVend.id}'`, "'vend_kevin'", verV(sinVend.id));
check(a2.vendedor_nombre === "Kevin Vergara", "V16 el administrador cambia el vendedor");
const a3 = rpcJ(U.admin, "vp_asignar_vendedor", "'venta'", `'${sinVend.id}'`, "'vend_kevin'", verV(sinVend.id));
check(a3.sin_cambios === true && a3.version === verV(sinVend.id), "V17 asignar el mismo vendedor no crea versión ni historial");
check(Number(root(`select count(*) from public.vp_historial where tabla = 'vp_ventas' and registro_id = '${sinVend.id}' and accion = 'modificar' and cambios ? 'vendedor_nombre';`)) === 2, "V18 cada cambio de vendedor queda en el historial");
const hVenta = root(`select md5(to_jsonb(v)::text) from (select neto, total, responsable_id, estado from public.vp_ventas where id = '${sinVend.id}') v;`);
rpcJ(U.ana, "vp_actualizar_venta", `'${sinVend.id}'`, verV(sinVend.id), j({ plazo_entrega: "1 semana" }));
check(root(`select vendedor_id from public.vp_ventas where id = '${sinVend.id}';`) === "vend_kevin", "V19 editar la venta con la función existente no borra el vendedor");
check(root(`select md5(to_jsonb(v)::text) from (select neto, total, responsable_id, estado from public.vp_ventas where id = '${sinVend.id}') v;`) === hVenta, "V20 asignar vendedor no cambia montos, responsable ni estado");
const dup = rpcJ(U.ana, "vp_duplicar_cotizacion", `'${vBfk.cot}'`);
check(root(`select vendedor_tipo from public.vp_cotizaciones where id = '${dup.id}';`) === "bfk", "V21 duplicar una cotización conserva su vendedor");
falla(como(U.ana, `update public.vp_ventas set vendedor_tipo = 'bfk', vendedor_nombre = 'BFK' where id = '${sinVend.id}';`), "permission denied", "V22 no hay UPDATE directo del vendedor");

// ═══ 2. Financiamiento: compras previas «sin informar» ══════════════════════════════════════════════════════
const rp = resumen(U.ana, previa.id);
check(Number(rp.total_compras) === 2 * 69990 + 4990 && Number(rp.financiado) === 0 && Number(rp.sin_informar) === Number(rp.total_compras), "F01 compra anterior: «Financiamiento sin informar» por el total, sin atribuirla a BFK ni al responsable", JSON.stringify(rp));
check(Number(root(`select count(*) from public.vp_fin_aportes where venta_id = '${previa.id}';`)) === 0, "F02 no se creó ningún aporte automático para compras anteriores");

// ═══ 3. Compra financiada completamente por Kevin (en «Registrar compra», una transacción) ═════════════════
const o1 = nuevaOrden({ vendedor: "bfk" });
const hc1 = huellaCostos(o1.id);
const m1a = margen(U.ana, o1.id);
const pedido1 = randomUUID().replace(/-/g, "");
const compra1 = filasCompra(o1, { pedido: pedido1 });
const totalPagado1 = 2 * 69990 + 4990;
const ap1 = aporte({ aportante_tipo: "persona", financiador_id: "fin_kevin", monto: totalPagado1, comprobante: "TRX-1001", observacion: "Tarjeta personal" });
const r1 = rpcJ(U.ana, "vp_registrar_compra_financiada", j({ compra: compra1, aportes: [ap1] }));
check(r1.ya_existia === false && r1.aportes.length === 1, "F03 compra + aporte de Kevin registrados juntos", JSON.stringify(r1));
const s1 = resumen(U.ana, o1.id);
check(Number(s1.financiado_personas) === totalPagado1 && Number(s1.sin_informar) === 0 && Number(s1.pendiente_devolucion) === totalPagado1, "F04 sección Financiamiento: total, financiado 100 %, falta 0, pendiente de devolución a Kevin", JSON.stringify(s1));
const ap1row = JSON.parse(root(`select to_jsonb(a) from public.vp_fin_aportes a where clave_idempotencia = '${ap1.clave}';`));
check(ap1row.creado_por === U.ana && ap1row.aportante_nombre === "Kevin Vergara" && ap1row.financiador_id === "fin_kevin", "F05 se distingue quien registra (Ana) de quien aporta (Kevin)", JSON.stringify(ap1row));
check(ap1row.compra_grupo === pedido1, "F06 el aporte queda asociado a la compra con la que se registró");
// Reintento idéntico (respuesta perdida): nada se duplica.
const r1b = rpcJ(U.ana, "vp_registrar_compra_financiada", j({ compra: compra1, aportes: [ap1] }));
check(r1b.ya_existia === true && r1b.aportes[0].ya_existia === true, "F07 reintento: la compra y el aporte ya existían (no se duplica)");
check(Number(root(`select count(*) from public.vp_fin_aportes where venta_id = '${o1.id}';`)) === 1 && Number(root(`select count(*) from public.vp_compras where venta_id = '${o1.id}';`)) === 2, "F08 sigue habiendo 1 aporte y 2 filas de compra");
const m1b = margen(U.ana, o1.id);
check(Number(m1b.costo_real) === Math.round(2 * 69990 / 1.19) + Math.round(4990 / 1.19), "F09 el costo de compra se registra una sola vez (neto con factura)", JSON.stringify(m1b));

// ═══ 4. Devoluciones parciales y totales; rechazo de devoluciones superiores al saldo ═══════════════════════
const idAp1 = ap1row.id; const hcAntesDev = huellaCostos(o1.id); const m1c = margen(U.ana, o1.id);
const d1 = rpcJ(U.ana, "vp_fin_registrar_devolucion", j({ clave: randomUUID(), aporte_id: idAp1, monto: 50000, fecha: hoy, medio: "transferencia", comprobante: "DEV-1" }));
check(d1.pendiente === totalPagado1 - 50000, "D01 devolución parcial: queda pendiente el resto", JSON.stringify(d1));
falla(rpc(U.ana, "vp_fin_registrar_devolucion", j({ clave: randomUUID(), aporte_id: idAp1, monto: totalPagado1 - 50000 + 1, fecha: hoy, medio: "transferencia" })), "VP_DEVOLUCION: se devolvería más que el saldo", "D02 devolver más que el saldo pendiente: rechazado");
falla(rpc(U.ana, "vp_fin_registrar_devolucion", j({ clave: randomUUID(), aporte_id: idAp1, monto: 1000, fecha: manana, medio: "transferencia" })), "VP_FECHA", "D03 devolución con fecha futura: rechazada");
falla(rpc(U.beto, "vp_fin_registrar_devolucion", j({ clave: randomUUID(), aporte_id: idAp1, monto: 1000, fecha: hoy, medio: "transferencia" })), "VP_PERMISO", "D04 otro usuario no registra devoluciones");
const kd2 = randomUUID();
const d2 = rpcJ(U.ana, "vp_fin_registrar_devolucion", j({ clave: kd2, aporte_id: idAp1, monto: totalPagado1 - 50000, fecha: hoy, medio: "deposito", comprobante: "DEV-2" }));
check(d2.pendiente === 0, "D05 devolución total: pendiente 0");
const d2b = rpcJ(U.ana, "vp_fin_registrar_devolucion", j({ clave: kd2, aporte_id: idAp1, monto: totalPagado1 - 50000, fecha: hoy, medio: "deposito" }));
check(d2b.ya_existia === true && Number(root(`select count(*) from public.vp_fin_devoluciones where aporte_id = '${idAp1}';`)) === 2, "D06 reintento de una devolución: no se duplica");
falla(rpc(U.ana, "vp_fin_registrar_devolucion", j({ clave: randomUUID(), aporte_id: idAp1, monto: 1, fecha: hoy, medio: "transferencia" })), "le quedan \\$0", "D07 con el aporte devuelto, cualquier devolución adicional se rechaza");
const s1d = resumen(U.ana, o1.id);
check(Number(s1d.devuelto) === totalPagado1 && Number(s1d.pendiente_devolucion) === 0, "D08 resumen: devuelto total, pendiente 0");
check(huellaCostos(o1.id) === hcAntesDev && JSON.stringify(margen(U.ana, o1.id)) === JSON.stringify(m1c), "D09 aportes y devoluciones no alteran costo, utilidad, ítems, precios ni pagos del cliente");
// Anulaciones: aporte con devoluciones vigentes no se anula; la devolución sí (vuelve el saldo); historial completo.
falla(rpc(U.ana, "vp_fin_anular", "'aporte'", `'${idAp1}'`, "'Error de digitación'"), "devoluciones vigentes", "D10 un aporte con devoluciones vigentes no se anula");
const idD2 = root(`select id from public.vp_fin_devoluciones where clave_idempotencia = '${kd2}';`);
falla(rpc(U.ana, "vp_fin_anular", "'devolucion'", `'${idD2}'`, "'x'"), "motivo", "D11 anular exige motivo");
rpcJ(U.ana, "vp_fin_anular", "'devolucion'", `'${idD2}'`, "'Transferencia rechazada por el banco'");
check(Number(resumen(U.ana, o1.id).pendiente_devolucion) === totalPagado1 - 50000, "D12 anular una devolución repone el saldo pendiente (se conserva anulada)");
check(root(`select estado||'|'||anulacion_motivo from public.vp_fin_devoluciones where id = '${idD2}';`) === "anulada|Transferencia rechazada por el banco", "D13 la devolución anulada se conserva con su motivo");
falla(como(U.admin, `update public.vp_fin_aportes set monto = 1 where id = '${idAp1}';`), "permission denied", "D14 no hay UPDATE directo de aportes (ni para el administrador)");
falla(psql(`update public.vp_fin_aportes set monto = 1 where id = '${idAp1}';`), "no se modifican", "D15 ni el dueño de la base modifica el monto de un aporte (solo anular)");
falla(psql(`delete from public.vp_fin_devoluciones where id = '${idD2}';`), "no se eliminan", "D16 las devoluciones no se eliminan");
check(historialFin(o1.id) >= 4, "D17 historial: aporte, devoluciones y anulación registrados", historialFin(o1.id));
check(root(`select bool_and(sensible) from public.vp_historial where venta_id = '${o1.id}' and tabla in ('vp_fin_aportes','vp_fin_devoluciones');`) === "t", "D18 el historial de financiamiento es sensible");

// ═══ 5. Compra financiada con fondos de BFK ════════════════════════════════════════════════════════════════
const o2 = nuevaOrden({ vendedor: "vend_kevin" });
const r2 = rpcJ(U.ana, "vp_registrar_compra_financiada", j({ compra: filasCompra(o2), aportes: [aporte({ aportante_tipo: "bfk", monto: totalPagado1 })] }));
const s2 = resumen(U.ana, o2.id);
check(Number(s2.financiado_bfk) === totalPagado1 && Number(s2.pendiente_devolucion) === 0 && Number(s2.sin_informar) === 0, "B01 BFK con fondos propios: financiado y sin deuda con una persona", JSON.stringify(s2));
const apBfk = JSON.parse(root(`select to_jsonb(a) from public.vp_fin_aportes a where venta_id = '${o2.id}';`));
check(apBfk.financiador_id === "fin_cuenta_bfk" && apBfk.aportante_nombre === "BFK (fondos propios)", "B02 el aporte BFK usa la Cuenta BFK (fondos propios) del catálogo de Mercado Público");
falla(rpc(U.ana, "vp_fin_registrar_devolucion", j({ clave: randomUUID(), aporte_id: apBfk.id, monto: 1000, fecha: hoy, medio: "transferencia" })), "no genera deuda", "B03 un aporte de BFK no admite devoluciones");
falla(rpc(U.ana, "vp_fin_registrar_aportes", j({ venta_id: o2.id, aportes: [aporte({ aportante_tipo: "persona", financiador_id: "fin_cuenta_bfk", monto: 1 })] })), "fondos propios", "B04 Cuenta BFK no puede elegirse como persona");
falla(rpc(U.ana, "vp_fin_registrar_aportes", j({ venta_id: o2.id, aportes: [aporte({ aportante_tipo: "persona", aportante_nombre: "BFK Ltda.", monto: 1 })] })), "elige «BFK con fondos propios»", "B05 «BFK» escrito como otra persona: se pide elegir fondos propios");
check(r2.aportes.length === 1, "B06 respuesta con el aporte registrado");

// ═══ 6. Aportes mixtos y financiamiento parcial ════════════════════════════════════════════════════════════
const o3 = nuevaOrden();
rpcJ(U.ana, "vp_registrar_compras_cotizacion", j(filasCompra(o3)));   // compra registrada sin financiamiento (opcional)
check(Number(resumen(U.ana, o3.id).sin_informar) === totalPagado1, "M01 compra sin informar financiamiento: todo «sin informar»");
const k3a = aporte({ aportante_tipo: "persona", financiador_id: "fin_kevin", monto: 60000, medio: "tarjeta" });
const k3b = aporte({ aportante_tipo: "bfk", monto: 40000 });
const k3c = aporte({ aportante_tipo: "persona", aportante_nombre: "Pedro Soto (amigo)", monto: 10000, medio: "efectivo", observacion: "Préstamo" });
const r3 = rpcJ(U.ana, "vp_fin_registrar_aportes", j({ venta_id: o3.id, aportes: [k3a, k3b, k3c] }));
check(r3.aportes.length === 3 && r3.ya_existia === false, "M02 varios aportantes en una misma compra");
const s3 = resumen(U.ana, o3.id);
check(Number(s3.financiado) === 110000 && Number(s3.financiado_bfk) === 40000 && Number(s3.financiado_personas) === 70000 && Number(s3.sin_informar) === totalPagado1 - 110000,
  "M03 parcial: financiado $110.000 (BFK $40.000 + personas $70.000), falta el resto", JSON.stringify(s3));
falla(rpc(U.ana, "vp_fin_registrar_aportes", j({ venta_id: o3.id, aportes: [aporte({ aportante_tipo: "bfk", monto: totalPagado1 - 110000 + 1 })] })), "superaría el total pagado", "M04 lo financiado no puede superar lo pagado");
check(Number(resumen(U.ana, o3.id).financiado) === 110000, "M05 el rechazo no deja nada a medias");
const r3b = rpcJ(U.ana, "vp_fin_registrar_aportes", j({ venta_id: o3.id, aportes: [k3a, k3b, k3c] }));
check(r3b.ya_existia === true, "M06 reintento del mismo registro: ya existía");
const otraP = JSON.parse(root(`select to_jsonb(a) from public.vp_fin_aportes a where clave_idempotencia = '${k3c.clave}';`));
check(otraP.financiador_id === null && otraP.aportante_nombre === "Pedro Soto (amigo)", "M07 «otra persona» se registra por nombre (no se crea en el catálogo de Mercado Público)");
const kev2 = JSON.parse(rpc(U.ana, "vp_fin_registrar_aportes", j({ venta_id: o3.id, aportes: [aporte({ aportante_tipo: "persona", aportante_nombre: "kevin vergara", monto: 1000 })] })).out);
check(root(`select financiador_id from public.vp_fin_aportes where id = '${kev2.aportes[0].id}';`) === "fin_kevin", "M08 un nombre igual a una persona del catálogo se vincula a ella (sin duplicarla)");
falla(rpc(U.ana, "vp_fin_registrar_aportes", j({ venta_id: o3.id, aportes: [aporte({ aportante_tipo: "persona", financiador_id: "fin_kevin", monto: 1000, fecha: manana })] })), "VP_FECHA", "M09 aporte con fecha futura: rechazado");
falla(rpc(U.ana, "vp_fin_registrar_aportes", j({ venta_id: o3.id, aportes: [aporte({ aportante_tipo: "persona", financiador_id: "fin_kevin", monto: 0 })] })), "mayor que cero", "M10 aporte de $0: rechazado");
falla(rpc(U.ana, "vp_fin_registrar_aportes", j({ venta_id: o3.id, aportes: [{ aportante_tipo: "bfk", monto: 1, fecha: hoy }] })), "clave", "M11 sin clave de idempotencia: rechazado");
falla(rpc(U.beto, "vp_fin_registrar_aportes", j({ venta_id: o3.id, aportes: [aporte({ aportante_tipo: "bfk", monto: 1 })] })), "VP_PERMISO", "M12 otro usuario no registra financiamiento");
check(valor(U.beto, `select count(*) from public.vp_fin_aportes where venta_id = '${o3.id}';`) === "0" && valor(U.beto, `select count(*) from public.vp_fin_resumen where venta_id = '${o3.id}';`) === "0",
  "M13 otro usuario no ve aportes ni el resumen (información financiera)");
check(Number(valor(U.admin, `select count(*) from public.vp_fin_aportes where venta_id = '${o3.id}';`)) === 4, "M14 el administrador ve los aportes");
check(valor("anon", "select 1;") === "1" && !!como("anon", "select count(*) from public.vp_fin_aportes;").err, "M15 anónimo: sin acceso");
check(valor(U.beto, `select count(*) from public.vp_historial where venta_id = '${o3.id}' and tabla = 'vp_fin_aportes';`) === "0", "M16 otro usuario no ve el historial de financiamiento");
// Anular una compra que dejaría lo financiado por encima de lo pagado: rechazado. Anular el aporte primero: permitido.
const idCompraO3 = root(`select id from public.vp_compras where venta_id = '${o3.id}' and concepto = 'producto';`);
falla(rpc(U.ana, "vp_anular", "'compra'", `'${idCompraO3}'`, "'Proveedor anuló el pedido'"), "está financiada", "M17 anular una compra financiada: primero los aportes");
for (const k of [k3a, k3b, k3c]) rpcJ(U.ana, "vp_fin_anular", "'aporte'", `'${root(`select id from public.vp_fin_aportes where clave_idempotencia = '${k.clave}';`)}'`, "'Compra anulada por el proveedor'");
rpcJ(U.ana, "vp_fin_anular", "'aporte'", `'${kev2.aportes[0].id}'`, "'Compra anulada por el proveedor'");
check(!rpc(U.ana, "vp_anular", "'compra'", `'${idCompraO3}'`, "'Proveedor anuló el pedido'").err, "M18 con los aportes anulados, la compra se anula");
check(Number(root(`select count(*) from public.vp_fin_aportes where venta_id = '${o3.id}';`)) === 4, "M19 los aportes anulados se conservan (trazabilidad)");

// ═══ 7. Compra manual financiada (con clave: reintento sin duplicar) ═══════════════════════════════════════
const o4 = nuevaOrden();
const km = randomUUID();
const manual = { clave: km, compra: { venta_id: o4.id, origen: "registro", proveedor: "Sodimac", fecha: hoy, documento_tipo: "boleta", neto: 20000, iva: 0, iva_recuperable: false, descripcion: "Repuesto" },
  aportes: [aporte({ aportante_tipo: "persona", financiador_id: "fin_byron", monto: 20000 })] };
const rm1 = rpcJ(U.ana, "vp_registrar_compra_manual_financiada", j(manual));
const rm2 = rpcJ(U.ana, "vp_registrar_compra_manual_financiada", j(manual));
check(rm1.ya_existia === false && rm2.ya_existia === true && rm2.id === rm1.id && Number(root(`select count(*) from public.vp_compras where venta_id = '${o4.id}';`)) === 1
  && Number(root(`select count(*) from public.vp_fin_aportes where venta_id = '${o4.id}';`)) === 1, "R01 compra manual + aporte: el reintento no duplica la compra ni el aporte");
falla(rpc(U.ana, "vp_registrar_compra_manual_financiada", j({ clave: randomUUID(), compra: { venta_id: o4.id, origen: "gasto_existente", gasto_id: "g-no-existe" }, aportes: [aporte({ aportante_tipo: "bfk", monto: 1 })] })), "Gastos no se financia", "R02 un gasto ya registrado en Gastos no se financia aquí (no se duplica)");

// ═══ 8. Doble clic / operaciones simultáneas (dos sesiones a la vez) ═══════════════════════════════════════
function enParalelo(sqls) {
  return Promise.all(sqls.map((s) => new Promise((res) => {
    const p = spawn("psql", [DB, "-X", "-At", "-q", "-v", "ON_ERROR_STOP=1"]); let out = "", err = "";
    p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (err += d)); p.on("close", (c) => res({ c, out: out.trim(), err: err.trim() }));
    p.stdin.end(s);
  })));
}
const o5 = nuevaOrden();
rpcJ(U.ana, "vp_registrar_compras_cotizacion", j(filasCompra(o5)));
const misma = aporte({ aportante_tipo: "persona", financiador_id: "fin_kevin", monto: 30000 });
const espera = "select pg_sleep(0.3);\n";
const par = await enParalelo([1, 2].map(() => prefijo(U.ana) + espera + `select public.vp_fin_registrar_aportes(${j({ venta_id: o5.id, aportes: [misma] })});`));
check(par.every((x) => x.c === 0) && Number(root(`select count(*) from public.vp_fin_aportes where venta_id = '${o5.id}';`)) === 1, "C01 doble clic simultáneo (misma clave): un solo aporte", JSON.stringify(par.map((x) => x.err)));
// Dos personas a la vez, cada una por el 60 % del total: solo una cabe.
const grande = Math.round(totalPagado1 * 0.6);
const par2 = await enParalelo([U.ana, U.admin].map((u) => prefijo(u) + espera + `select public.vp_fin_registrar_aportes(${j({ venta_id: o5.id, aportes: [aporte({ aportante_tipo: "bfk", monto: grande })] })});`));
check(par2.filter((x) => x.c === 0).length === 1 && par2.some((x) => /superaría/.test(x.err)), "C02 dos aportes simultáneos que juntos superan lo pagado: uno se rechaza (bloqueo de la venta)", JSON.stringify(par2.map((x) => x.err.split("\n")[0])));
check(Number(resumen(U.ana, o5.id).financiado) <= totalPagado1, "C03 lo financiado nunca supera lo pagado");
// Dos devoluciones simultáneas que juntas superan el saldo.
const idMisma = root(`select id from public.vp_fin_aportes where clave_idempotencia = '${misma.clave}';`);
const par3 = await enParalelo([1, 2].map(() => prefijo(U.ana) + espera + `select public.vp_fin_registrar_devolucion(${j({ clave: randomUUID(), aporte_id: idMisma, monto: 20000, fecha: hoy, medio: "transferencia" })});`));
check(par3.filter((x) => x.c === 0).length === 1 && Number(resumen(U.ana, o5.id).devuelto) === 20000, "C04 dos devoluciones simultáneas por más del saldo: una se rechaza", JSON.stringify(par3.map((x) => x.err.split("\n")[0])));

// ═══ 9. Totales e indicadores: utilidad sin cambios, ventas una sola vez, cotizaciones no cuentan ══════════
const cotSinVenta = rpcJ(U.ana, "vp_guardar_cotizacion_v2", j({ cliente_id: cli, plazo_entrega: "1 día", items: [{ tipo: "producto", descripcion: "Casco", unidad: "UN", cantidad: 1, precio_unitario: 99999 }], vendedor: "bfk" }));
check(root(`select count(*) from public.vp_ventas where cotizacion_id = '${cotSinVenta.id}';`) === "0", "T01 una cotización BFK aún no convertida no es una venta");
const ventasBfk = JSON.parse(root(`select jsonb_build_object('n', count(*), 'total', coalesce(sum(total),0)) from public.vp_ventas where estado = 'vigente' and vendedor_tipo = 'bfk';`));
const todas = JSON.parse(root(`select jsonb_build_object('n', count(*), 'total', sum(total)) from public.vp_ventas where estado = 'vigente';`));
const grupos = JSON.parse(root(`select jsonb_agg(x) from (select coalesce(vendedor_tipo,'-')||':'||coalesce(vendedor_id,'') g, count(*) n, sum(total) t from public.vp_ventas where estado = 'vigente' group by 1) x;`));
check(grupos.reduce((s, g) => s + Number(g.n), 0) === Number(todas.n) && grupos.reduce((s, g) => s + Number(g.t), 0) === Number(todas.total), "T02 cada venta pertenece a un solo vendedor: la suma por vendedor es el total (sin duplicar)");
check(Number(ventasBfk.n) >= 3, "T03 las ventas BFK se pueden filtrar y consultar como las de cualquier vendedor", JSON.stringify(ventasBfk));
check(root(`select count(*) from public.vp_ventas where vendedor_id = 'vend_kevin' and id = '${vBfk.id}';`) === "0", "T04 una venta BFK no se atribuye a Kevin");
check(JSON.stringify(margen(U.ana, o1.id)) === JSON.stringify(m1c) && Number(m1a.costo_real) === 0, "T05 utilidad de la venta financiada por Kevin: igual antes y después de aportes y devoluciones");
check(root(HUELLA_MP) === huellaMP0, "T06 Mercado Público intacto: OCs, financiadores (saldos), vendedores y gastos sin cambios");
check(root(`select count(*) from public.vp_pagos;`) === "0", "T07 ningún aporte ni devolución se registró como pago del cliente");

// ═══ 10. Anulación de la venta: lo aportado y lo devuelto se conservan ═════════════════════════════════════
falla(rpc(U.ana, "vp_fin_registrar_aportes", j({ venta_id: randomUUID(), aportes: [aporte({ aportante_tipo: "bfk", monto: 1 })] })), "no encontrada", "X01 venta inexistente");
falla(rpc(U.sinPerfil, "vp_fin_registrar_aportes", j({ venta_id: o1.id, aportes: [aporte({ aportante_tipo: "bfk", monto: 1 })] })), "VP_PERFIL", "X02 cuenta sin perfil BFK");
falla(como("anon", `select public.vp_fin_registrar_aportes('{}'::jsonb);`), "permission denied", "X03 anónimo no ejecuta las funciones");
for (const f of ["vp_fin_aporte_interno(uuid,jsonb,text)", "vp_marcar_vendedor(text)", "vp_fin_bloquear_venta(uuid)"]) {
  falla(como(U.admin, `select public.${f.replace(/\(.*\)/, "")}(${f.includes("uuid,jsonb") ? `'${o1.id}', '{}'::jsonb, null` : f.includes("text)") ? "'bfk'" : `'${o1.id}'`});`), "permission denied", `X04 función interna no expuesta: ${f}`);
}

console.log(`RESUMEN sql_financiamiento: ${ok} OK, ${fallas} FALLAS`);
process.exit(fallas ? 1 : 0);
