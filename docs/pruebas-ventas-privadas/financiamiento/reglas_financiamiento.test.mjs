// Financiamiento y vendedor (11/11/2026): reglas puras de la interfaz (lib/vpFinanciamiento.js) y comparación con la base
// (vp_fin_resumen / vp_fin_aportantes) sobre datos generados en una base DESECHABLE (nunca producción).
// Uso: VP_DB_URL=… node reglas_financiamiento.test.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resumenFinanciamiento, validarAportes, aportesParaGuardar, opcionesAportante, opcionesVendedor, claveVendedor, nombreVendedor, gruposVendedor,
  indicadoresPorVendedor, totalesFinanciamiento, validarDevolucion, filaAporte } from "../../../src/lib/vpFinanciamiento.js";
import { indicadoresVP } from "../../../src/lib/ventasPrivadas.js";

let n = 0, f = 0; const t = (nombre, fn) => { try { fn(); n++; } catch (e) { f++; console.log("FALLA", nombre, e.message.slice(0, 300)); } };
const FIN = [{ id: "fin_cuenta_bfk", nombre: "Cuenta BFK", tipo: "propio" }, { id: "fin_kevin", nombre: "Kevin Vergara", tipo: "externo" }, { id: "fin_x", nombre: "Inactivo", tipo: "externo", activo: false }];
const VEND = [{ id: "vend_kevin", nombre: "Kevin Vergara", activo: true }, { id: "vend_old", nombre: "Retirado", activo: false }];

// ── Puras ──────────────────────────────────────────────────────────────────────────────────────────────
t("opciones de aportante: BFK, personas activas del catálogo (sin Cuenta BFK) y otra persona", () => {
  const o = opcionesAportante(FIN).map((x) => x.v); assert.deepEqual(o, ["bfk", "fin_kevin", "otra"]);
});
t("opciones de vendedor: BFK primero, activos; el asignado inactivo se muestra", () => {
  assert.deepEqual(opcionesVendedor(VEND).map((x) => x.v), ["bfk", "vend_kevin"]);
  assert.ok(opcionesVendedor(VEND, { vendedor_tipo: "vendedor", vendedor_id: "vend_old", vendedor_nombre: "Retirado" }).some((x) => x.v === "vend_old"));
});
t("clave y nombre de vendedor", () => {
  assert.equal(claveVendedor({ vendedor_tipo: "bfk" }), "bfk"); assert.equal(claveVendedor({ vendedor_tipo: "vendedor", vendedor_id: "vend_kevin" }), "vend_kevin"); assert.equal(claveVendedor({}), "");
  assert.equal(nombreVendedor({ vendedor_tipo: "bfk" }), "BFK"); assert.equal(nombreVendedor({}), "Sin vendedor asignado");
});
t("validar aportes: faltantes, $0, futuro, nombre, BFK escrito como persona y exceso", () => {
  const hoy = "2026-11-11";
  const e = validarAportes([filaAporte({ aportante: "", monto: "0", fecha: "2026-11-12" }), filaAporte({ aportante: "otra", nombre: "BFK Ltda.", monto: "1000", fecha: hoy })], { disponible: 500, hoy }).errores.join(" | ");
  assert.match(e, /indica quién financia/); assert.match(e, /mayor que cero/); assert.match(e, /no futura/); assert.match(e, /fondos propios/); assert.match(e, /supera lo que falta/);
  assert.equal(validarAportes([filaAporte({ aportante: "fin_kevin", monto: "$1.000", fecha: hoy })], { disponible: 1000, hoy }).errores.length, 0);
});
t("aportes para guardar: BFK, persona del catálogo y otra persona", () => {
  const g = aportesParaGuardar([filaAporte({ aportante: "bfk", monto: "100", fecha: "2026-11-11" }), filaAporte({ aportante: "fin_kevin", monto: "200", fecha: "2026-11-11" }), filaAporte({ aportante: "otra", nombre: " Pedro ", monto: "300", fecha: "2026-11-11" })]);
  assert.deepEqual(g.map((a) => [a.aportante_tipo, a.financiador_id ?? null, a.aportante_nombre ?? null, a.monto]), [["bfk", null, null, 100], ["persona", "fin_kevin", null, 200], ["persona", null, "Pedro", 300]]);
  assert.ok(g.every((a) => /^[0-9a-f-]{36}$/.test(a.clave)));
});
t("validar devolución: saldo, BFK y fechas", () => {
  const ap = { estado: "vigente", aportante_tipo: "persona", monto: 1000, devuelto: 400, pendiente: 600, fecha: "2026-11-01" };
  assert.match(validarDevolucion({ aporte: ap, monto: "601", fecha: "2026-11-05", hoy: "2026-11-11" }).errores.join(), /más que el saldo/);
  assert.equal(validarDevolucion({ aporte: ap, monto: "600", fecha: "2026-11-05", hoy: "2026-11-11" }).errores.length, 0);
  assert.match(validarDevolucion({ aporte: { ...ap, aportante_tipo: "bfk" }, monto: "1", fecha: "2026-11-05", hoy: "2026-11-11" }).errores.join(), /no admite/);
  assert.match(validarDevolucion({ aporte: ap, monto: "1", fecha: "2026-10-30", hoy: "2026-11-11" }).errores.join(), /anterior al aporte/);
});
t("resumen: gastos vinculados no se financian; anulados no cuentan; BFK no es deuda", () => {
  const r = resumenFinanciamiento({ compras: [{ estado: "vigente", origen: "registro", total: 1000 }, { estado: "anulada", origen: "registro", total: 500 }, { estado: "vigente", origen: "gasto_existente", total: 300 }],
    aportes: [{ id: "a", estado: "vigente", aportante_tipo: "bfk", financiador_id: "fin_cuenta_bfk", aportante_nombre: "BFK (fondos propios)", monto: 200 },
      { id: "b", estado: "vigente", aportante_tipo: "persona", financiador_id: "fin_kevin", aportante_nombre: "Kevin", monto: 500 }, { id: "c", estado: "anulado", aportante_tipo: "persona", aportante_nombre: "X", monto: 999 }],
    devoluciones: [{ aporte_id: "b", estado: "vigente", monto: 100 }, { aporte_id: "b", estado: "anulada", monto: 400 }] });
  assert.deepEqual([r.totalCompras, r.gastosVinculados, r.financiado, r.sinInformar, r.devuelto, r.pendienteDevolucion, r.estado], [1000, 300, 700, 300, 100, 400, "parcial"]);
  assert.equal(r.porAportante.find((g) => g.tipo === "bfk").pendiente, 0);
});
t("por vendedor: cada venta en un grupo; la suma es el total de Ventas privadas", () => {
  const ventas = [{ id: 1, estado: "vigente", fecha: "2026-11-01", total: 100, neto: 84, vendedor_tipo: "bfk" }, { id: 2, estado: "vigente", fecha: "2026-11-02", total: 200, neto: 168, vendedor_tipo: "vendedor", vendedor_id: "vend_kevin", vendedor_nombre: "Kevin" },
    { id: 3, estado: "vigente", fecha: "2026-11-03", total: 50, neto: 42 }, { id: 4, estado: "anulada", fecha: "2026-11-03", total: 999, neto: 999, vendedor_tipo: "bfk" }];
  const g = indicadoresPorVendedor({ ventas, margenes: [] }, {}); const tot = indicadoresVP({ ventas, margenes: [] }, {});
  assert.equal(g.reduce((s, x) => s + x.vendido, 0), tot.vendido); assert.equal(g.reduce((s, x) => s + x.nVentas, 0), tot.nVentas);
  assert.deepEqual(g.map((x) => x.clave), ["bfk", "vend_kevin", ""]); assert.equal(g[0].comisionPersonal, false);
  assert.deepEqual(gruposVendedor(ventas).map((x) => x.nombre), ["BFK", "Kevin", "Sin vendedor asignado"]);
});

// ── Comparación con la base (datos generados) ─────────────────────────────────────────────────────────
const DB = process.env.VP_DB_URL;
if (DB) {
  const lit = (s) => { const q = "q" + Math.random().toString(36).slice(2, 8); return `$${q}$${s}$${q}$`; };
  const psql = (sql) => execFileSync("psql", [DB, "-X", "-At", "-q", "-v", "ON_ERROR_STOP=1"], { input: sql, encoding: "utf8" }).trim().split("\n").pop();
  const como = (u, sql) => psql(`set role authenticated;\nselect set_config('request.jwt.claims', ${lit(JSON.stringify({ sub: u, role: "authenticated" }))}, false) \\g /dev/null\n${sql}`);
  const rpcJ = (u, fn, a) => JSON.parse(como(u, `select public.${fn}(${lit(JSON.stringify(a))}::jsonb);`));
  const ADMIN = "11111111-1111-1111-1111-111111111111", ANA = "22222222-2222-2222-2222-222222222222";
  const hoy = psql("select public.vp_hoy();");
  const cli = psql(`select id from public.pi_clientes order by creado_en limit 1;`) || rpcJ(ANA, "vp_guardar_cliente", { rut: "77000111-0", razon_social: "Cliente reglas" }).id;
  let semilla = 7; const azar = () => ((semilla = (semilla * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let k = 0; k < 8; k++) {
    const vend = ["bfk", "vend_kevin", undefined][k % 3];
    const v = rpcJ(ANA, "vp_crear_venta_directa_v2", { clave: randomUUID(), cliente_id: cli, ...(vend ? { vendedor: vend } : {}), items: [{ tipo: "producto", descripcion: `Ítem ${k}`, unidad: "UN", cantidad: 1, precio_unitario: 100000 + k * 1000, costo_unitario: 60000 }] });
    const compras = 1 + Math.floor(azar() * 3); let total = 0;
    for (let c = 0; c < compras; c++) { const m = 10000 + Math.floor(azar() * 50000); total += m;
      rpcJ(ANA, "vp_registrar_compra_manual_financiada", { clave: randomUUID(), compra: { venta_id: v.id, origen: "registro", proveedor: "P", fecha: hoy, documento_tipo: c % 2 ? "boleta" : "factura", neto: m, iva: 0, iva_recuperable: c % 2 === 0 }, aportes: [] }); }
    let resto = total; const ids = [];
    for (const tipo of ["bfk", "fin_kevin", "otra"]) { if (azar() < 0.3 || resto <= 0) continue; const m = Math.max(1, Math.floor(resto * azar())); resto -= m;
      const a = rpcJ(ANA, "vp_fin_registrar_aportes", { venta_id: v.id, aportes: [{ clave: randomUUID(), aportante_tipo: tipo === "bfk" ? "bfk" : "persona", ...(tipo === "fin_kevin" ? { financiador_id: "fin_kevin" } : tipo === "otra" ? { aportante_nombre: "Pedro Soto" } : {}), monto: m, fecha: hoy, medio: "transferencia" }] });
      ids.push({ id: a.aportes[0].id, tipo, m }); }
    for (const a of ids.filter((x) => x.tipo !== "bfk")) { if (azar() < 0.5) continue; const d = Math.max(1, Math.floor(a.m * azar()));
      const r = rpcJ(ANA, "vp_fin_registrar_devolucion", { clave: randomUUID(), aporte_id: a.id, monto: d, fecha: hoy, medio: "deposito" });
      if (azar() < 0.3) como(ANA, `select public.vp_fin_anular('devolucion', '${r.id}', 'corrección de prueba');`); }
    if (ids.length && azar() < 0.2) { const a = ids[0]; if (!JSON.parse(psql(`select count(*) from public.vp_fin_devoluciones where aporte_id = '${a.id}' and estado = 'vigente';`))) como(ANA, `select public.vp_fin_anular('aporte', '${a.id}', 'corrección de prueba');`); }
  }
  const leerJ = (sql) => JSON.parse(como(ADMIN, sql));
  const resumenes = leerJ("select coalesce(jsonb_agg(to_jsonb(r)), '[]') from public.vp_fin_resumen r;");
  let iguales = 0;
  for (const r of resumenes) {
    const d = { compras: leerJ(`select coalesce(jsonb_agg(to_jsonb(k)), '[]') from public.vp_compras k where venta_id = '${r.venta_id}';`),
      aportes: leerJ(`select coalesce(jsonb_agg(to_jsonb(a)), '[]') from public.vp_fin_aportes a where venta_id = '${r.venta_id}';`),
      devoluciones: leerJ(`select coalesce(jsonb_agg(to_jsonb(a)), '[]') from public.vp_fin_devoluciones a where venta_id = '${r.venta_id}';`) };
    const j = resumenFinanciamiento(d);
    const ok = j.totalCompras === Number(r.total_compras) && j.financiado === Number(r.financiado) && j.financiadoBfk === Number(r.financiado_bfk) && j.financiadoPersonas === Number(r.financiado_personas)
      && j.sinInformar === Number(r.sin_informar) && j.devuelto === Number(r.devuelto) && j.pendienteDevolucion === Number(r.pendiente_devolucion) && j.gastosVinculados === Number(r.gastos_vinculados);
    if (ok) iguales++; else console.log("DIFERENCIA", r.folio, JSON.stringify({ j: { ...j, porAportante: undefined }, r }).slice(0, 400));
  }
  t(`la interfaz calcula igual que la base (vp_fin_resumen) en ${resumenes.length} órdenes`, () => assert.equal(iguales, resumenes.length));
  const aportantes = leerJ("select coalesce(jsonb_agg(to_jsonb(a)), '[]') from public.vp_fin_aportantes a;");
  const tot = totalesFinanciamiento(resumenes, aportantes);
  t("Finanzas: el pendiente por persona suma el pendiente por orden", () => assert.equal(tot.personas.reduce((s, p) => s + p.pendiente, 0), tot.pendienteDevolucion));
  t("Finanzas: BFK por persona = BFK por orden", () => assert.equal(tot.bfk, tot.financiadoBfk));
  t("nunca se financia más de lo pagado ni se devuelve más de lo aportado", () => assert.ok(resumenes.every((r) => Number(r.financiado) <= Number(r.total_compras) && Number(r.pendiente_devolucion) >= 0)));
}
console.log(`RESUMEN reglas_financiamiento: ${n} OK, ${f} FALLAS`);
process.exit(f ? 1 : 0);
