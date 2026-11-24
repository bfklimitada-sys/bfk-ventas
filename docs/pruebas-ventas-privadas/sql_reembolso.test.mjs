// Pruebas de BORRADOR-2026-11-24-vp-compra-reembolso.sql (y su recuperación) contra una base DESECHABLE local (nunca producción).
// Caso real (24/11/2026): compra de una venta privada que no llegó → se cancela con el proveedor (devuelve el dinero) → se
// compra en otro lado más barato. Anular con reembolso, gasto vinculado anulado solo, reembolso recibido (cartola o a mano),
// marca de cartola única en toda la base, permisos, sin reembolso el gasto no se toca, recuperación.
// Uso: eval "$(bash docs/pruebas-ventas-privadas/entorno.sh instalar)"; node docs/pruebas-ventas-privadas/sql_reembolso.test.mjs
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const DB = process.env.VP_DB_URL;
if (!DB) { console.error("Falta VP_DB_URL (entorno.sh instalar)"); process.exit(2); }
const MIG = resolve(dirname(fileURLToPath(import.meta.url)), "../migraciones");
const U = { admin: "11111111-1111-1111-1111-111111111111", ana: "22222222-2222-2222-2222-222222222222", beto: "33333333-3333-3333-3333-333333333333" };
let ok = 0, fallas = 0;
const check = (c, n, det = "") => { if (c) { ok++; console.log("OK   ", n); } else { fallas++; console.log("FALLA:", n, det); } };
const lit = (s) => { const t = "q" + Math.random().toString(36).slice(2, 8); return `$${t}$${s}$${t}$`; };
const j = (o) => `${lit(JSON.stringify(o))}::jsonb`;
const psqlEn = (url, sql, extra = []) => { try { return { out: execFileSync("psql", [url, "-X", "-At", "-q", "-v", "ON_ERROR_STOP=1", ...extra], { input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim() }; } catch (e) { return { err: String(e.stderr || e.message) }; } };
const owner = DB.replace("postgres@", "bfk_owner@");
const archivo = (f, extra = []) => psqlEn(owner, "", [...extra, "-f", `${MIG}/${f}`]);
const prefijo = (u) => `set role authenticated;\nselect set_config('request.jwt.claims', ${lit(JSON.stringify({ sub: u, role: "authenticated" }))}, false) \\g /dev/null\n`;
const como = (u, sql) => psqlEn(DB, prefijo(u) + sql);
const rpc = (u, fn, ...a) => como(u, `select public.${fn}(${a.join(", ")});`);
const rpcJ = (u, fn, ...a) => { const r = rpc(u, fn, ...a); if (r.err) throw new Error(`${fn}: ${r.err}`); return JSON.parse(r.out); };
const valor = (u, sql) => { const r = como(u, sql); if (r.err) throw new Error(r.err); return r.out; };
const root = (sql) => { const r = psqlEn(DB, sql); if (r.err) throw new Error(r.err); return r.out; };
const falla = (r, patron, n) => check(!!r.err && new RegExp(patron).test(r.err), n, r.err ? r.err.split("\n").find((l) => /ERROR/.test(l)) : `sin error (${r.out})`);
const q = (s) => `'${s}'`;

try {
  // ── 0. Base como producción: perfiles, una columna marca_cartola en gastos (existe en producción) y datos previos ──────
  root(`insert into public.perfiles (id, nombre, rol) values ('${U.beto}', 'Beto Prueba', 'usuario') on conflict (id) do nothing;
        alter table public.gastos_indirectos add column if not exists marca_cartola text;`);
  const cli = rpcJ(U.ana, "vp_guardar_cliente", j({ rut: "76086428-5", razon_social: "Maderas del Sur SpA", tipo_persona: "empresa", giro: "Aserradero" }));
  const venta = rpcJ(U.ana, "vp_crear_venta_directa", j({ clave: randomUUID(), cliente_id: cli.id, afecta_iva: true, plazo_pago_dias: 30,
    items: [{ descripcion: "Taladro percutor", unidad: "UN", cantidad: 1, precio_unitario: 200000, costo_unitario: 100000 }] }));
  const venta2 = rpcJ(U.ana, "vp_crear_venta_directa", j({ clave: randomUUID(), cliente_id: cli.id, items: [{ descripcion: "Otra", cantidad: 1, precio_unitario: 50000 }] }));
  root(`insert into public.gastos_indirectos (id, categoria_id, monto, mes, anio, fecha, descripcion) values
        ('gas_fal', 'cat1', 119000, 11, 2026, '2026-11-02', 'Falabella taladro'),
        ('gas_per', 'cat1', 50000, 11, 2026, '2026-11-03', 'Compra perdida (sin devolución)'),
        ('gas_otro', 'cat1', 30000, 11, 2026, '2026-11-04', 'Otro gasto');
        update public.gastos_indirectos set marca_cartola = 'cart:20261104:30000:0:1000:1' where id = 'gas_otro';`);
  const compraFal = rpcJ(U.ana, "vp_registrar_compra", j({ venta_id: venta.id, origen: "registro", proveedor: "Falabella", fecha: "2026-11-02",
    documento_tipo: "factura", documento_numero: "F-1", neto: 100000, iva: 19000, iva_recuperable: true }));
  const compraGasto = rpcJ(U.ana, "vp_registrar_compra", j({ venta_id: venta.id, origen: "gasto_existente", gasto_id: "gas_fal" }));
  const compraPerdida = rpcJ(U.ana, "vp_registrar_compra", j({ venta_id: venta.id, origen: "gasto_existente", gasto_id: "gas_per" }));
  const antes = root(`select md5(string_agg(to_jsonb(k)::text, ',' order by id)) from public.vp_compras k;`) + "|" + root(`select md5(string_agg(to_jsonb(g)::text, ',' order by id)) from public.gastos_indirectos g;`);
  const costoAntes = Number(valor(U.ana, `select costo_real from public.vp_margen_ventas where venta_id = '${venta.id}';`));

  // ── 1. Migración: aditiva, nada histórico cambia ─────────────────────────────────────────────────────────────────
  const m = archivo("BORRADOR-2026-11-24-vp-compra-reembolso.sql");
  check(!m.err, "1.1 migración aplicada", m.err);
  const despues = root(`select md5(string_agg((to_jsonb(k) - array['reembolso_estado','reembolso_monto','reembolso_fecha','reembolso_marca','reembolso_registrado_por','reembolso_registrado_en'])::text, ',' order by id)) from public.vp_compras k;`)
    + "|" + root(`select md5(string_agg((to_jsonb(g) - array['anulado_en','anulado_por','anulacion_motivo','anulacion_ref'])::text, ',' order by id)) from public.gastos_indirectos g;`);
  check(despues === antes, "1.2 compras y gastos existentes idénticos tras aplicar (columnas nuevas nulas)");
  check(root(`select count(*) from public.vp_compras where reembolso_estado is not null;`) === "0" && root(`select count(*) from public.gastos_indirectos where anulado_en is not null;`) === "0", "1.3 columnas nuevas vacías");
  falla(archivo("BORRADOR-2026-11-24-vp-compra-reembolso.sql"), "ya está aplicada", "1.4 no se aplica dos veces");

  // ── 2. Permisos y validaciones ───────────────────────────────────────────────────────────────────────────────────
  falla(psqlEn(DB, `set role anon;\nselect public.vp_anular_compra('${compraFal.id}', 'x', true, null);`), "permission denied", "2.1 anónimo no anula");
  falla(rpc(U.beto, "vp_anular_compra", q(compraFal.id), "'No llegó el producto'", "true", "null"), "VP_PERMISO", "2.2 quien no es responsable no anula");
  falla(rpc(U.ana, "vp_anular_compra", q(compraFal.id), "'no'", "true", "null"), "motivo", "2.3 exige motivo");
  falla(rpc(U.ana, "vp_anular_compra", q(compraFal.id), "'No llegó el producto'", "true", "200000"), "no puede superar lo pagado", "2.4 reembolso mayor que lo pagado");
  falla(rpc(U.ana, "vp_anular_compra", q(compraFal.id), "'No llegó el producto'", "false", "1000"), "solo se indica si el proveedor devolverá", "2.5 monto sin reembolso");
  check(root(`select estado from public.vp_compras where id = '${compraFal.id}';`) === "vigente", "2.6 un intento rechazado no deja nada a medias");

  // ── 3. El caso de Kevin: compra registrada en la venta, no llegó, Falabella devuelve ─────────────────────────────────
  const a = rpcJ(U.ana, "vp_anular_compra", q(compraFal.id), "'Producto nunca llegó, compra cancelada en Falabella'", "true", "null");
  check(a.estado === "anulada" && a.reembolso === "pendiente" && a.reembolso_monto === 119000 && a.gasto_anulado === null && a.documento_tipo === "factura", "3.1 anulada con reembolso pendiente por el total", JSON.stringify(a));
  check(root(`select estado||'|'||reembolso_estado||'|'||reembolso_monto from public.vp_compras where id = '${compraFal.id}';`) === "anulada|pendiente|119000", "3.2 guardado en la compra");
  falla(rpc(U.ana, "vp_anular_compra", q(compraFal.id), "'otra vez'", "true", "null"), "ya está anulado", "3.3 no se anula dos veces");
  check(Number(valor(U.ana, `select costo_real from public.vp_margen_ventas where venta_id = '${venta.id}';`)) === costoAntes - 100000, "3.4 deja de ser costo de la venta (neto con IVA recuperable)");
  check(Number(root(`select count(*) from public.vp_historial where tabla = 'vp_compras' and registro_id = '${compraFal.id}';`)) >= 2, "3.5 queda en el historial de la venta");

  // ── 4. Compra que venía de Gastos: con reembolso el gasto se anula solo; sin reembolso NO se toca ────────────────────
  const b = rpcJ(U.ana, "vp_anular_compra", q(compraGasto.id), "'Cancelada en Falabella'", "true", "null");
  check(b.gasto_anulado === "gas_fal", "4.1 gasto vinculado anulado automáticamente", JSON.stringify(b));
  const g = root(`select (anulado_en is not null)||'|'||anulado_por||'|'||anulacion_ref||'|'||anulacion_motivo from public.gastos_indirectos where id = 'gas_fal';`);
  check(g === `true|${U.ana}|vp_compras:${compraGasto.id}|Compra de venta privada anulada con reembolso: Cancelada en Falabella`, "4.2 con autor, referencia a la compra y motivo", g);
  check(root(`select monto||'|'||fecha from public.gastos_indirectos where id = 'gas_fal';`) === "119000|2026-11-02", "4.3 el gasto no se borra ni cambia su monto/fecha");
  const c = rpcJ(U.ana, "vp_anular_compra", q(compraPerdida.id), "'Proveedor no devuelve el dinero'", "false", "null");
  check(c.gasto_anulado === null && c.reembolso === null, "4.4 sin reembolso: el gasto sigue (el dinero se perdió)");
  check(root(`select anulado_en is null from public.gastos_indirectos where id = 'gas_per';`) === "t", "4.5 gasto sin reembolso intacto");
  falla(rpc(U.ana, "vp_registrar_compra", j({ venta_id: venta2.id, origen: "gasto_existente", gasto_id: "gas_fal" })), "está anulado en Gastos", "4.6 un gasto anulado no se vuelve a vincular");
  check(!rpc(U.ana, "vp_registrar_compra", j({ venta_id: venta2.id, origen: "gasto_existente", gasto_id: "gas_per" })).err, "4.7 el gasto sin reembolso se puede volver a usar (quedó libre)");

  // ── 5. Compra nueva más barata en otro proveedor ─────────────────────────────────────────────────────────────────
  check(!rpc(U.ana, "vp_registrar_compra", j({ venta_id: venta.id, origen: "registro", proveedor: "Sodimac", fecha: "2026-11-10", documento_tipo: "factura",
    documento_numero: "S-9", neto: 84034, iva: 15966, iva_recuperable: true })).err, "5.1 compra nueva registrada");
  check(Number(valor(U.ana, `select costo_real from public.vp_margen_ventas where venta_id = '${venta.id}';`)) === 84034, "5.2 costo real = solo la compra vigente (más barata)");

  // ── 6. Reembolso recibido desde la cartola (marca del abono) ────────────────────────────────────────────────────
  const MARCA = "cart:20261120:0:119000:700000:1";
  falla(rpc(U.beto, "vp_registrar_reembolso", q(compraFal.id), "'2026-11-20'", "119000", `'${MARCA}'`), "VP_PERMISO", "6.1 quien no es responsable no lo registra");
  falla(rpc(U.ana, "vp_registrar_reembolso", q(compraFal.id), "'2030-01-01'", "119000", `'${MARCA}'`), "no futura", "6.2 fecha futura");
  falla(rpc(U.ana, "vp_registrar_reembolso", q(compraFal.id), "'2026-11-20'", "0", `'${MARCA}'`), "mayor que", "6.3 monto 0");
  falla(rpc(U.ana, "vp_registrar_reembolso", q(compraFal.id), "'2026-11-20'", "30000", "'cart:20261104:30000:0:1000:1'"), "VP_DUPLICADO", "6.4 abono ya usado por un gasto (marca_cartola)");
  const r1 = rpcJ(U.ana, "vp_registrar_reembolso", q(compraFal.id), "'2026-11-20'", "119000", `'${MARCA}'`);
  check(r1.reembolso === "recibido" && r1.marca === MARCA, "6.5 reembolso recibido con la marca del abono");
  falla(rpc(U.ana, "vp_registrar_reembolso", q(compraGasto.id), "'2026-11-20'", "119000", `'${MARCA}'`), "VP_DUPLICADO", "6.6 el mismo abono no sirve para dos reembolsos");
  falla(rpc(U.ana, "vp_registrar_reembolso", q(compraFal.id), "'2026-11-21'", "119000", "'cart:otra'"), "ya está registrado", "6.7 no se registra dos veces");
  const sinRe = rpcJ(U.ana, "vp_registrar_compra", j({ venta_id: venta2.id, origen: "registro", proveedor: "X", fecha: "2026-11-05", neto: 1000, iva: 0, iva_recuperable: false }));
  falla(rpc(U.ana, "vp_registrar_reembolso", q(sinRe.id), "'2026-11-20'", "1000", "null"), "no tiene un reembolso esperado", "6.8 una compra sin reembolso esperado no lo recibe");

  // ── 7. Reembolso a mano (sin cartola) y después se le asigna el abono ───────────────────────────────────────────
  const r2 = rpcJ(U.ana, "vp_registrar_reembolso", q(compraGasto.id), "'2026-11-18'", "119000", "null");
  check(r2.reembolso === "recibido" && r2.marca === null, "7.1 recibido a mano, sin marca");
  falla(rpc(U.ana, "vp_registrar_reembolso", q(compraGasto.id), "null", "100000", "'cart:20261118:0:119000:1:1'"), "mismo monto", "7.2 al vincular el abono, el monto debe ser el mismo");
  const r3 = rpcJ(U.ana, "vp_registrar_reembolso", q(compraGasto.id), "null", "119000", "'cart:20261118:0:119000:1:1'");
  check(r3.solo_marca === true && root(`select reembolso_fecha||'|'||reembolso_marca from public.vp_compras where id = '${compraGasto.id}';`) === "2026-11-18|cart:20261118:0:119000:1:1", "7.3 se asigna la marca sin cambiar la fecha");
  falla(rpc(U.ana, "vp_registrar_reembolso", q(compraGasto.id), "null", "119000", "'cart:z'"), "ya está registrado", "7.4 con marca ya no se cambia");

  // ── 8. Deshacer un reembolso confirmado por error ───────────────────────────────────────────────────────────────
  falla(rpc(U.beto, "vp_deshacer_reembolso", q(compraFal.id), "'Abono equivocado'"), "VP_PERMISO", "8.1 quien no es responsable no lo deshace");
  const d = rpcJ(U.ana, "vp_deshacer_reembolso", q(compraFal.id), "'Abono equivocado'");
  check(d.reembolso === "pendiente" && root(`select coalesce(reembolso_marca,'-')||'|'||coalesce(reembolso_fecha::text,'-')||'|'||reembolso_monto from public.vp_compras where id = '${compraFal.id}';`) === "-|-|119000", "8.2 vuelve a pendiente y libera la marca");
  check(!rpc(U.ana, "vp_registrar_reembolso", q(compraFal.id), "'2026-11-20'", "119000", `'${MARCA}'`).err, "8.3 la marca liberada se puede volver a usar");
  falla(rpc(U.ana, "vp_deshacer_reembolso", q(compraPerdida.id), "'x x x'"), "no está registrado como recibido", "8.4 solo se deshace un reembolso recibido");

  // ── 9. Reglas de la base (aunque alguien escriba directo) ────────────────────────────────────────────────────────
  falla(como(U.admin, `update public.vp_compras set reembolso_estado = 'pendiente', reembolso_monto = 1 where id = '${sinRe.id}';`), "vp_compras_reembolso_coherente|permission denied|violates", "9.1 una compra vigente no puede tener reembolso");
  falla(psqlEn(DB, `update public.gastos_indirectos set anulado_en = now() where id = 'gas_otro';`), "gastos_anulacion_coherente", "9.2 un gasto no se anula sin motivo");
  falla(psqlEn(DB, `update public.vp_compras set reembolso_monto = 999999 where id = '${compraFal.id}';`), "vp_compras_reembolso_coherente", "9.3 reembolso nunca mayor que lo pagado");

  // ── 10. Recuperación ───────────────────────────────────────────────────────────────────────────────────────────
  falla(archivo("BORRADOR-2026-11-24-vp-compra-reembolso-deshacer.sql"), "respalda y usa -v forzar=1", "10.1 con datos nuevos, deshacer se detiene");
  check(root(`select count(*) from public.vp_compras where reembolso_estado is not null;`) === "2", "10.2 …y no cambió nada");
  const dz = archivo("BORRADOR-2026-11-24-vp-compra-reembolso-deshacer.sql", ["-v", "forzar=1"]);
  check(!dz.err, "10.3 deshacer forzado", dz.err);
  check(root(`select count(*) from information_schema.columns where table_schema='public' and ((table_name='vp_compras' and column_name like 'reembolso%') or (table_name='gastos_indirectos' and column_name in ('anulado_en','anulado_por','anulacion_motivo','anulacion_ref')));`) === "0"
    && root(`select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('vp_anular_compra','vp_registrar_reembolso','vp_deshacer_reembolso','vp_marca_cartola_usada','vp_gasto_no_anulado');`) === "0", "10.4 sin columnas ni funciones nuevas");
  check(root(`select count(*) from public.vp_compras where estado = 'anulada';`) === "3", "10.5 las anulaciones hechas siguen (son de vp_anular)");
  check(!archivo("BORRADOR-2026-11-24-vp-compra-reembolso.sql").err, "10.6 la migración se puede volver a aplicar");
} catch (e) { fallas++; console.log("EXCEPCIÓN:", e.message); }
console.log(`\nRESUMEN sql_reembolso: ${ok} OK, ${fallas} FALLA(S)`);
process.exit(fallas ? 1 : 0);
