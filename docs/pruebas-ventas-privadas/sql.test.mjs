// Pruebas de la migración de Ventas privadas contra una base DESECHABLE (nunca producción).
// Cada llamada corre en una sesión psql propia con el rol «authenticated» y el usuario del JWT (igual que PostgREST),
// así que RLS, privilegios, disparadores y funciones se aplican de verdad.
// Uso: VP_DB_URL=postgresql://postgres@127.0.0.1:5499/bfk_vp_e2e VP_PLANTILLA_URL=…/bfk_vp_plantilla node docs/pruebas-ventas-privadas/sql.test.mjs
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

const DB = process.env.VP_DB_URL;
const PLANTILLA = process.env.VP_PLANTILLA_URL;
if (!DB) { console.error("Falta VP_DB_URL"); process.exit(2); }
const U = { admin: "11111111-1111-1111-1111-111111111111", ana: "22222222-2222-2222-2222-222222222222", beto: "33333333-3333-3333-3333-333333333333", sinPerfil: "99999999-9999-9999-9999-999999999999" };
let ok = 0, fallas = 0;
const check = (cond, nombre, detalle = "") => { if (cond) ok++; else { fallas++; console.log("FALLA:", nombre, detalle); } };
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

// ── 0. Accesos sin perfil / anónimo ────────────────────────────────────────────────────────────────────────
falla(como("anon", "select count(*) from public.vp_cotizaciones;"), "permission denied", "anónimo no lee cotizaciones");
falla(como("anon", "select public.vp_guardar_cliente('{}'::jsonb);"), "permission denied", "anónimo no ejecuta RPC");
falla(rpc(U.sinPerfil, "vp_guardar_cliente", j({ rut: "76.086.428-5", razon_social: "X" })), "VP_PERFIL", "cuenta sin perfil BFK no escribe");
check(valor(U.sinPerfil, "select count(*) from public.vp_configuracion;") === "0", "cuenta sin perfil no lee la configuración");
falla(como(U.ana, "insert into public.vp_cotizaciones (folio, cliente_id, responsable_id) values ('CP-2026-9999', gen_random_uuid(), auth.uid());"), "permission denied", "no hay INSERT directo (solo RPC)");
check(valor(U.ana, "select valor->>'rut' from public.vp_configuracion where clave = 'empresa';") === "77.322.317-3", "datos de BFK configurados (RUT)");
falla(rpc(U.ana, "vp_configurar", "'documentos_habilitados'", "'true'::jsonb", "'prueba'"), "VP_PERMISO", "usuario no cambia la configuración");

// ── 1. Clientes ───────────────────────────────────────────────────────────────────────────────────────────
falla(rpc(U.ana, "vp_guardar_cliente", j({ rut: "76.086.428-6", razon_social: "Rut malo" })), "PI_RUT", "RUT con dígito verificador incorrecto");
falla(rpc(U.ana, "vp_guardar_cliente", j({ razon_social: "Sin RUT" })), "RUT es obligatorio", "RUT obligatorio");
const cli = rpcJ(U.ana, "vp_guardar_cliente", j({ rut: "76086428-5", razon_social: "Maderas del Sur SpA", tipo_persona: "empresa", giro: "Aserradero",
  contacto_nombre: "Rosa Pérez", contacto_correo: "rosa@maderas.cl", contacto_telefono: "+56 9 1111 2222", direccion: "Av. Uno 123", comuna: "Laja",
  direccion_entrega: "Planta km 5", comuna_entrega: "Laja", condiciones_pago: "30 días factura", plazo_pago_dias: 30, notas: "Cliente nuevo" }));
check(cli.rut === "76.086.428-5", "RUT normalizado con puntos y guion", cli.rut);
const dup = rpc(U.beto, "vp_guardar_cliente", j({ rut: "76.086.428-5", razon_social: "Otro nombre" }));
falla(dup, "VP_DUPLICADO", "sin duplicados por RUT (con otro formato)");
check(/DETAIL:\s+[0-9a-f-]{36}/.test(dup.err || ""), "el duplicado informa el cliente existente");
falla(rpc(U.beto, "vp_guardar_cliente", j({ id: cli.id, rut: "76.086.428-5", razon_social: "Cambio ajeno" })), "VP_PERMISO", "otro usuario no edita el cliente");
check(!rpc(U.admin, "vp_guardar_cliente", j({ id: cli.id, rut: "76.086.428-5", razon_social: "Maderas del Sur SpA", tipo_persona: "empresa", plazo_pago_dias: 30, condiciones_pago: "30 días factura", contacto_nombre: "Rosa Pérez" })).err, "administrador edita el cliente");
falla(rpc(U.ana, "vp_guardar_cliente", j({ rut: "11.111.111-1", razon_social: "Correo malo", contacto_correo: "no-es-correo" })), "correo", "correo inválido");
const persona = rpcJ(U.ana, "vp_guardar_cliente", j({ rut: "12.345.678-5", razon_social: "Juan Soto", tipo_persona: "persona" }));
check(valor(U.beto, `select tipo_persona||'|'||es_venta_privada from public.vp_clientes_vista where id = '${persona.id}';`) === "persona|true", "persona natural registrada y visible para otros usuarios");
check(valor(U.ana, `select count(*) from public.pi_historial where tabla = 'pi_clientes' and registro_id = '${cli.id}';`) >= "2", "cambios del cliente quedan en la auditoría existente");

// ── 2. Cotización: totales, costos y permisos ─────────────────────────────────────────────────────────────
const items = [
  { tipo: "producto", codigo: "BOM-01", descripcion: "Bomba centrífuga 2 HP", unidad: "UN", cantidad: 2, precio_unitario: 350000, descuento_pct: 5, costo_unitario: 240000 },
  { tipo: "producto", descripcion: "Manguera 1\"", unidad: "M", cantidad: 12.5, precio_unitario: 3990, descuento_pct: 0, costo_unitario: 2100.5 },
  { tipo: "servicio", descripcion: "Instalación y puesta en marcha", unidad: "GL", cantidad: 1, precio_unitario: 180000, descuento_pct: 10 },
];
falla(rpc(U.ana, "vp_guardar_cotizacion", j({ cliente_id: cli.id, items: [{ ...items[0], cantidad: 0 }] })), "cantidad", "cantidad cero rechazada");
falla(rpc(U.ana, "vp_guardar_cotizacion", j({ cliente_id: cli.id, items: [{ ...items[0], descuento_pct: 120 }] })), "descuento", "descuento > 100% rechazado");
falla(rpc(U.ana, "vp_guardar_cotizacion", j({ cliente_id: cli.id, fecha_emision: "2026-11-06", vigencia_hasta: "2026-11-01", items })), "vigencia", "vigencia anterior a la emisión");
const cot = rpcJ(U.ana, "vp_guardar_cotizacion", j({ cliente_id: cli.id, contacto_nombre: "Rosa Pérez", contacto_correo: "rosa@maderas.cl", vigencia_dias: 15,
  plazo_entrega: "10 días hábiles", direccion_entrega: "Planta km 5, Laja", condiciones_pago: "50% anticipo, saldo a 30 días", observaciones: "Incluye flete",
  condiciones_comerciales: "Precios netos en pesos chilenos", afecta_iva: true, items }));
check(/^CP-\d{4}-\d{4}$/.test(cot.folio), "folio automático CP-AAAA-NNNN", cot.folio);
// Esperado: bruto 700000 + 49875 + 180000 = 929875 · descuentos 35000 + 18000 = 53000
//           neto 665000 + 49875 + 162000 = 876875 · IVA 166606 (876875×0,19 = 166606,25) · total 1043481
const tot = valor(U.ana, `select bruto||'|'||descuento||'|'||neto||'|'||iva||'|'||total from public.vp_cotizacion_revisiones where id = '${cot.revision_id}';`);
check(tot === "929875|53000|876875|166606|1043481", "totales calculados por la base (neto, IVA 19%, total)", tot);
const marg = valor(U.ana, `select costo||'|'||lineas_sin_costo from public.vp_margen_revisiones where revision_id = '${cot.revision_id}';`);
check(marg === "506256|1", "costo interno = 2×240000 + round(12,5×2100,5) (sin costo en el servicio)", marg);
check(valor(U.beto, `select count(*) from public.vp_cotizacion_item_costos;`) === "0", "otro usuario NO ve costos");
check(valor(U.beto, `select coalesce(costo::text,'NULO') from public.vp_margen_revisiones where revision_id = '${cot.revision_id}';`) === "NULO", "margen nulo (no cero) para quien no ve costos");
check(valor(U.admin, `select count(*) from public.vp_cotizacion_item_costos;`) === "2", "administrador ve costos");
check(valor(U.beto, `select n_items from public.vp_cotizaciones_vista where id = '${cot.id}';`) === "3", "otro usuario ve la cotización (sin costos)");
falla(rpc(U.beto, "vp_guardar_cotizacion", j({ id: cot.id, version: cot.version, cliente_id: cli.id, items })), "VP_PERMISO", "otro usuario no modifica la cotización");
falla(rpc(U.ana, "vp_guardar_cotizacion", j({ id: cot.id, version: cot.version + 7, cliente_id: cli.id, items })), "VP409", "edición simultánea detectada por versión");
falla(como(U.ana, `update public.vp_cotizacion_items set precio_unitario = 1 where revision_id = '${cot.revision_id}';`), "permission denied", "sin UPDATE directo de líneas");
// Guardar de nuevo (Ana) conserva totales; guardar como admin sin costos en el JSON borra costos? → solo si los ve (admin sí ve; se envían).
const cot2 = rpcJ(U.ana, "vp_guardar_cotizacion", j({ id: cot.id, version: cot.version, cliente_id: cli.id, contacto_nombre: "Rosa Pérez", vigencia_dias: 15,
  plazo_entrega: "10 días hábiles", direccion_entrega: "Planta km 5, Laja", condiciones_pago: "50% anticipo, saldo a 30 días", afecta_iva: true, items }));
check(cot2.version === cot.version + 1, "guardar sube la versión");

// ── 3. Envío (manual), protección y revisiones ────────────────────────────────────────────────────────────
falla(rpc(U.ana, "vp_cotizacion_estado", `'${cot.id}'`, "'aceptada'", j({}), cot2.version), "VP_ESTADO", "no se acepta una cotización en borrador");
const env = rpcJ(U.ana, "vp_cotizacion_estado", `'${cot.id}'`, "'enviada'", j({ medio: "correo", destinatario: "rosa@maderas.cl" }), cot2.version);
check(env.estado === "enviada", "envío registrado manualmente");
const doc0 = valor(U.ana, `select documento::text from public.vp_cotizacion_revisiones where id = '${cot.revision_id}';`);
check(!/costo|margen|utilidad/i.test(doc0) && /Bomba centrífuga/.test(doc0) && /77\.322\.317-3/.test(doc0), "documento congelado sin costos, con datos de BFK");
falla(rpc(U.ana, "vp_guardar_cotizacion", j({ id: cot.id, version: env.version, cliente_id: cli.id, items })), "VP_REVISION", "una revisión enviada no se edita");
falla(como(U.admin, `update public.vp_cotizacion_revisiones set neto = 1 where id = '${cot.revision_id}';`), "permission denied", "ni el administrador edita directo");
const r1 = rpcJ(U.ana, "vp_cotizacion_nueva_revision", `'${cot.id}'`, env.version);
check(r1.revision === 1, "nueva revisión R1");
check(valor(U.ana, `select estado from public.vp_cotizacion_revisiones where id = '${cot.revision_id}';`) === "reemplazada", "R0 queda reemplazada (intacta)");
check(valor(U.ana, `select documento::text = ${lit(doc0)} from public.vp_cotizacion_revisiones where id = '${cot.revision_id}';`) === "t", "el documento de R0 no cambia");
check(valor(U.ana, `select count(*) from public.vp_cotizacion_item_costos k join public.vp_cotizacion_items i on i.id = k.item_id where i.revision_id = '${r1.revision_id}';`) === "2", "R1 copia líneas y costos");
const items1 = items.map((x, i) => (i === 0 ? { ...x, cantidad: 3 } : x));
const g1 = rpcJ(U.ana, "vp_guardar_cotizacion", j({ id: cot.id, version: r1.version, cliente_id: cli.id, contacto_nombre: "Rosa Pérez", vigencia_dias: 20,
  plazo_entrega: "10 días hábiles", direccion_entrega: "Planta km 5, Laja", condiciones_pago: "50% anticipo, saldo a 30 días", afecta_iva: true, items: items1 }));
const e1 = rpcJ(U.ana, "vp_cotizacion_estado", `'${cot.id}'`, "'enviada'", j({ medio: "correo" }), g1.version);
falla(rpc(U.ana, "vp_cotizacion_estado", `'${cot.id}'`, "'rechazada'", j({}), e1.version), "motivo", "rechazo exige motivo");
falla(rpc(U.beto, "vp_cotizacion_estado", `'${cot.id}'`, "'aceptada'", j({}), e1.version), "VP_PERMISO", "otro usuario no registra aceptación");
const a1 = rpcJ(U.ana, "vp_cotizacion_estado", `'${cot.id}'`, "'aceptada'", j({ referencia: "Correo de Rosa Pérez", nota: "Acepta R1" }), e1.version);
const tR1 = valor(U.ana, `select total from public.vp_cotizacion_revisiones where id = '${r1.revision_id}';`);
// R1: 3×350000×0,95 = 997500 + 49875 + 162000 = 1209375 · IVA 229781 (229781,25) · total 1439156
check(tR1 === "1439156", "total R1", tR1);

// ── 4. Conversión a venta: idempotente y sin duplicados bajo concurrencia ─────────────────────────────────
const dupCot = rpcJ(U.beto, "vp_duplicar_cotizacion", `'${cot.id}'`);
check(dupCot.folio !== cot.folio, "duplicar crea folio nuevo");
check(valor(U.beto, `select count(*) from public.vp_cotizacion_item_costos;`) === "0", "duplicar no expone costos a quien no los ve");
const clave = randomUUID();
falla(rpc(U.beto, "vp_crear_venta_desde_cotizacion", `'${cot.id}'`, `'${clave}'`, j({})), "VP_PERMISO", "otro usuario no convierte");
// Dos sesiones a la vez con claves distintas (doble clic en dos dispositivos): una sola venta.
const sql = (k) => prefijo(U.ana) + `select public.vp_crear_venta_desde_cotizacion('${cot.id}', '${k}', '{}'::jsonb);`;
const corre = (k) => new Promise((res) => { const p = spawn("psql", [DB, "-X", "-At", "-q"]); let o = ""; p.stdout.on("data", (d) => (o += d)); p.stderr.on("data", (d) => (o += d)); p.on("close", () => res(o.trim())); p.stdin.end(sql(k)); });
const [s1, s2, s3] = await Promise.all([corre(clave), corre(randomUUID()), corre(randomUUID())]);
const res3 = [s1, s2, s3].map((s) => JSON.parse(s.split("\n").pop()));
check(new Set(res3.map((x) => x.id)).size === 1, "tres conversiones simultáneas → una sola venta", JSON.stringify(res3));
check(res3.filter((x) => !x.ya_existia).length === 1, "solo una conversión crea; las demás devuelven la existente");
const venta = res3[0];
check(valor(U.ana, `select count(*) from public.vp_ventas where cotizacion_id = '${cot.id}';`) === "1", "una venta por cotización");
const reint = rpcJ(U.ana, "vp_crear_venta_desde_cotizacion", `'${cot.id}'`, `'${clave}'`, j({}));
check(reint.id === venta.id && reint.ya_existia, "reintento con la misma clave devuelve la misma venta");
check(/^OV-\d{4}-\d{4}$/.test(venta.folio), "folio interno OV-AAAA-NNNN", venta.folio);
const vv = valor(U.ana, `select total||'|'||origen||'|'||cotizacion_revision||'|'||estado_entrega||'|'||estado_facturacion||'|'||estado_pago from public.vp_ventas_vista where id = '${venta.id}';`);
check(vv === "1439156|cotizacion|1|pendiente|sin_facturar|pendiente", "venta transfiere totales y revisión aceptada", vv);
check(valor(U.ana, `select costo_estimado from public.vp_margen_ventas where venta_id = '${venta.id}';`) === String(3 * 240000 + Math.round(12.5 * 2100.5)), "costo estimado transferido");
// Venta directa
const kd = randomUUID();
const vd = rpcJ(U.beto, "vp_crear_venta_directa", j({ clave: kd, cliente_id: persona.id, afecta_iva: true, plazo_pago_dias: 0,
  items: [{ descripcion: "Visita técnica", unidad: "GL", cantidad: 1, precio_unitario: 100000, costo_unitario: 40000 }] }));
check(rpcJ(U.beto, "vp_crear_venta_directa", j({ clave: kd, cliente_id: persona.id, items: [{ descripcion: "x", cantidad: 1, precio_unitario: 1 }] })).id === vd.id, "venta directa idempotente");
check(valor(U.beto, `select origen||'|'||coalesce(cotizacion_folio,'-')||'|'||total from public.vp_ventas_vista where id = '${vd.id}';`) === "directa|-|119000", "venta directa identificada (sin cotización)");

// ── 5. OC del cliente, entregas ───────────────────────────────────────────────────────────────────────────
check(!rpc(U.beto, "vp_registrar_oc_cliente", j({ venta_id: venta.id, numero: "OC-4512", fecha: "2026-11-05", monto: 1439156 })).err, "OC del cliente registrada (número y fecha)");
falla(rpc(U.ana, "vp_registrar_oc_cliente", j({ venta_id: venta.id, numero: "oc-4512 ", fecha: "2026-11-05" })), "VP_DUPLICADO", "OC del cliente sin duplicados");
const vi = valor(U.ana, `select string_agg(id::text||':'||cantidad, ',' order by orden) from public.vp_venta_items where venta_id = '${venta.id}';`).split(",").map((x) => x.split(":"));
falla(rpc(U.ana, "vp_registrar_entrega", j({ venta_id: venta.id, tipo: "despacho", fecha: "2026-11-06", items: [{ venta_item_id: vi[0][0], cantidad: 4 }] })), "VP_ENTREGA", "no se entrega más de lo vendido");
check(!rpc(U.ana, "vp_registrar_entrega", j({ venta_id: venta.id, tipo: "despacho", fecha: "2026-11-06", guia_numero: "G-1", items: [{ venta_item_id: vi[0][0], cantidad: 2 }, { venta_item_id: vi[1][0], cantidad: 12.5 }] })).err, "entrega parcial");
check(valor(U.ana, `select estado_entrega||'|'||cant_entregada||'/'||cant_total from public.vp_ventas_vista where id = '${venta.id}';`) === "parcial|14.500/16.500", "estado de entrega parcial");
falla(rpc(U.ana, "vp_registrar_entrega", j({ venta_id: venta.id, tipo: "despacho", fecha: "2099-01-01", items: [{ venta_item_id: vi[0][0], cantidad: 1 }] })), "VP_FECHA", "entrega con fecha futura rechazada");
check(!rpc(U.ana, "vp_registrar_entrega", j({ venta_id: venta.id, tipo: "servicio", fecha: "2026-11-06", items: [{ venta_item_id: vi[0][0], cantidad: 1 }, { venta_item_id: vi[2][0], cantidad: 1 }] })).err, "entrega final (producto + servicio)");
check(valor(U.ana, `select estado_entrega from public.vp_ventas_vista where id = '${venta.id}';`) === "entregada", "venta entregada");
check(valor(U.ana, `select estado_pago from public.vp_ventas_vista where id = '${venta.id}';`) === "pendiente", "entregada pero pendiente de cobro (estados independientes)");

// ── 6. Facturas y pagos (sin dobles conteos) ──────────────────────────────────────────────────────────────
root(`insert into public.ordenes_compra_v2 (id, numero_oc, cliente) values ('oc-mp-vp', '9999-1-SE26', 'Muni') on conflict do nothing;
      insert into public.eventos_factura (id, oc_id, fecha, numero_factura, monto) values ('ef-vp', 'oc-mp-vp', '2026-10-01', '9001', 1000) on conflict do nothing;`);
const kA = randomUUID();
const ant = rpcJ(U.ana, "vp_registrar_pago", j({ clave: kA, venta_id: venta.id, tipo: "anticipo", fecha: "2026-11-05", monto: 719578, medio: "transferencia", referencia: "TEF 123" }));
check(rpcJ(U.ana, "vp_registrar_pago", j({ clave: kA, venta_id: venta.id, tipo: "anticipo", fecha: "2026-11-05", monto: 719578, medio: "transferencia" })).ya_existia, "pago idempotente (doble clic)");
falla(rpc(U.beto, "vp_registrar_pago", j({ clave: randomUUID(), venta_id: venta.id, tipo: "abono", fecha: "2026-11-05", monto: 1, medio: "efectivo" })), "VP_PERMISO", "pagos: solo responsable o admin");
falla(rpc(U.ana, "vp_registrar_factura", j({ venta_id: venta.id, tipo_documento: "factura_afecta", numero: "9001", fecha: "2026-11-06", neto: 1209375, iva: 229781 })), "Mercado Público", "folio ya usado en una OC de Mercado Público");
falla(rpc(U.ana, "vp_registrar_factura", j({ venta_id: venta.id, tipo_documento: "factura_afecta", numero: "1501", fecha: "2026-11-06", neto: 1209375, iva: 200000 })), "IVA", "IVA inconsistente con el neto");
falla(rpc(U.ana, "vp_registrar_factura", j({ venta_id: venta.id, tipo_documento: "factura_afecta", numero: "1501", fecha: "2026-11-06", neto: 2000000, iva: 380000 })), "superaría", "no se factura más que la venta");
const fac = rpcJ(U.ana, "vp_registrar_factura", j({ venta_id: venta.id, tipo_documento: "factura_afecta", numero: "1501", fecha: "2026-11-06", neto: 1209375, iva: 229781 }));
falla(rpc(U.admin, "vp_registrar_factura", j({ venta_id: vd.id, tipo_documento: "factura_afecta", numero: " 1501", fecha: "2026-11-06", neto: 100000, iva: 19000 })), "VP_DUPLICADO", "folio de factura único");
const imp = rpcJ(U.ana, "vp_imputar_pago", `'${ant.id}'`, `'${fac.id}'`, 719578);
check(!!imp.id, "anticipo aplicado a la factura");
check(valor(U.ana, `select cobrado||'|'||saldo||'|'||facturado||'|'||estado_pago||'|'||estado_facturacion from public.vp_ventas_vista where id = '${venta.id}';`) === "719578|719578|1439156|parcial|facturada",
  "imputar el anticipo NO duplica el cobro");
falla(rpc(U.ana, "vp_registrar_pago", j({ clave: randomUUID(), venta_id: venta.id, tipo: "abono", fecha: "2026-11-06", monto: 719579, medio: "transferencia" })), "superaría", "no se cobra más que el total");
const kS = randomUUID();
const saldo = rpcJ(U.ana, "vp_registrar_pago", j({ clave: kS, venta_id: venta.id, tipo: "abono", fecha: "2026-11-06", monto: 719578, medio: "transferencia", factura_id: fac.id }));
check(valor(U.ana, `select cobrado||'|'||saldo||'|'||estado_pago from public.vp_ventas_vista where id = '${venta.id}';`) === "1439156|0|pagada", "venta pagada (anticipo + saldo)");
falla(rpc(U.ana, "vp_imputar_pago", `'${saldo.id}'`, `'${fac.id}'`, 1), "VP_PAGO|VP_FACTURA", "no se aplica más de lo disponible");
// Anular el saldo: vuelve a quedar pendiente, la aplicación se anula y todo queda trazado.
check(!rpc(U.ana, "vp_anular", "'pago'", `'${saldo.id}'`, "'Transferencia rebotada'").err, "pago anulado con motivo");
check(valor(U.ana, `select cobrado||'|'||saldo from public.vp_ventas_vista where id = '${venta.id}';`) === "719578|719578", "anulación ajusta cobrado y saldo");
check(valor(U.ana, `select estado from public.vp_pagos where id = '${saldo.id}';`) === "anulado", "el pago anulado se conserva");
check(valor(U.ana, `select count(*) from public.vp_pago_imputaciones where pago_id = '${saldo.id}' and estado = 'anulada';`) === "1", "su aplicación queda anulada");
// Pago vencido: venta directa con plazo 0 y factura de ayer (por fecha) → monto vencido
check(!rpc(U.beto, "vp_registrar_factura", j({ venta_id: vd.id, tipo_documento: "factura_afecta", numero: "1502", fecha: "2026-11-01", neto: 100000, iva: 19000 })).err, "factura de la venta directa");
check(valor(U.beto, `select monto_vencido from public.vp_ventas_vista where id = '${vd.id}';`) === "119000", "pago vencido calculado (factura + plazo)");

// ── 7. Costos reales: compras y gastos vinculados ─────────────────────────────────────────────────────────
check(!rpc(U.ana, "vp_registrar_compra", j({ venta_id: venta.id, origen: "registro", proveedor: "Bombas SA", fecha: "2026-11-04", documento_tipo: "factura", documento_numero: "778", neto: 720000, iva: 136800, iva_recuperable: true })).err, "compra registrada");
const gasto = root(`select id from public.gastos_indirectos order by id limit 1;`);
check(!rpc(U.ana, "vp_registrar_compra", j({ venta_id: venta.id, origen: "gasto_existente", gasto_id: gasto })).err, "gasto existente vinculado (sin copiar)");
falla(rpc(U.admin, "vp_registrar_compra", j({ venta_id: vd.id, origen: "gasto_existente", gasto_id: gasto })), "VP_DUPLICADO", "un gasto no se vincula a dos ventas");
const gm = root(`select round(monto) from public.gastos_indirectos where id = '${gasto}';`);
check(valor(U.ana, `select costo_real||'|'||costo_real_desde_gastos from public.vp_margen_ventas where venta_id = '${venta.id}';`) === `${720000 + Number(gm)}|${gm}`, "costo real = compra neta + gasto vinculado");
check(valor(U.beto, `select count(*) from public.vp_compras;`) === "0", "otro usuario no ve compras");
check(valor(U.beto, `select coalesce(costo_real::text,'NULO') from public.vp_margen_ventas where venta_id = '${venta.id}';`) === "NULO", "otro usuario no ve el costo real");

// ── 8. Anulación de venta ─────────────────────────────────────────────────────────────────────────────────
falla(rpc(U.ana, "vp_anular_venta", `'${venta.id}'`, "'prueba'"), "VP_PERMISO", "solo administrador anula ventas");
falla(rpc(U.admin, "vp_anular_venta", `'${venta.id}'`, "'prueba'"), "facturas o pagos vigentes", "no se anula una venta con facturas o pagos vigentes");
const vd2 = rpcJ(U.ana, "vp_crear_venta_directa", j({ clave: randomUUID(), cliente_id: cli.id, items: [{ descripcion: "Repuesto", cantidad: 1, precio_unitario: 5000 }] }));
check(!rpc(U.admin, "vp_anular_venta", `'${vd2.id}'`, "'Ingresada por error'").err, "administrador anula una venta sin movimientos");
check(valor(U.ana, `select estado||'|'||anulacion_motivo from public.vp_ventas where id = '${vd2.id}';`) === "anulada|Ingresada por error", "la venta anulada se conserva con motivo");
falla(rpc(U.ana, "vp_registrar_pago", j({ clave: randomUUID(), venta_id: vd2.id, tipo: "abono", fecha: "2026-11-06", monto: 1, medio: "efectivo" })), "anulada", "venta anulada no admite movimientos");
falla(como(U.admin, `delete from public.vp_ventas where id = '${vd2.id}';`), "permission denied", "no hay borrado de ventas");

// ── 9. Historial ──────────────────────────────────────────────────────────────────────────────────────────
check(Number(valor(U.ana, `select count(*) from public.vp_historial where cotizacion_id = '${cot.id}' and tabla = 'vp_cotizacion_revisiones' and cambios ? 'estado';`)) >= 4, "cambios de estado en el historial");
check(valor(U.ana, `select usuario_nombre from public.vp_historial where venta_id = '${venta.id}' and tabla = 'vp_pagos' and accion = 'modificar' limit 1;`) === "Usuario Normal", "historial registra el usuario");
check(valor(U.beto, `select count(*) from public.vp_historial where sensible and (venta_id = '${venta.id}' or cotizacion_id = '${cot.id}');`) === "0", "otro usuario no ve historial de costos ajenos");
check(Number(valor(U.beto, `select count(*) from public.vp_historial where sensible and venta_id = '${vd.id}';`)) > 0, "el responsable ve el historial de costos de su venta");
check(Number(valor(U.admin, `select count(*) from public.vp_historial where sensible;`)) > 0, "administrador ve historial de costos");
falla(como(U.admin, `update public.vp_historial set accion = 'x';`), "permission denied", "historial inalterable");
falla(psql(`update public.vp_historial set accion = 'eliminar' where id = (select min(id) from public.vp_historial);`), "VP_HISTORIAL", "historial inalterable incluso para el dueño");

// ── 10. Documentos (depósito) ─────────────────────────────────────────────────────────────────────────────
const ruta = `venta/${venta.id}/oc_cliente/${randomUUID()}-oc.pdf`;
falla(como(U.ana, `insert into storage.objects (bucket_id, name) values ('vp-documentos', '${ruta}');`), "row-level security", "carga deshabilitada al instalar");
falla(rpc(U.ana, "vp_registrar_documento", j({ ambito: "venta", id: venta.id, categoria: "oc_cliente", titulo: "OC", nombre_archivo: "oc.pdf", ruta, tamano: 10, sha256: "a".repeat(64) })), "deshabilitada", "registro de archivos deshabilitado al instalar");
check(!rpc(U.admin, "vp_configurar", "'documentos_habilitados'", "'true'::jsonb", "'Prueba en base desechable'").err, "administrador habilita la carga");
check(!como(U.ana, `insert into storage.objects (bucket_id, name) values ('vp-documentos', '${ruta}');`).err, "archivo subido al depósito");
const docOC = rpcJ(U.ana, "vp_registrar_documento", j({ ambito: "venta", id: venta.id, categoria: "oc_cliente", titulo: "OC cliente", nombre_archivo: "oc.pdf", ruta, tipo_mime: "application/pdf", tamano: 10, sha256: "a".repeat(64) }));
falla(rpc(U.ana, "vp_registrar_documento", j({ ambito: "venta", id: venta.id, categoria: "oc_cliente", titulo: "Fantasma", nombre_archivo: "x.pdf", ruta: `venta/${venta.id}/oc_cliente/${randomUUID()}-x.pdf`, tamano: 10, sha256: "b".repeat(64) })), "no está en el depósito", "no se registra un archivo inexistente");
const rutaC = `venta/${venta.id}/compra/${randomUUID()}-factura-proveedor.pdf`;
falla(como(U.beto, `insert into storage.objects (bucket_id, name) values ('vp-documentos', '${rutaC}');`), "row-level security", "otro usuario no sube respaldos de compras");
check(!como(U.ana, `insert into storage.objects (bucket_id, name) values ('vp-documentos', '${rutaC}');`).err, "responsable sube respaldo de compra");
rpcJ(U.ana, "vp_registrar_documento", j({ ambito: "venta", id: venta.id, categoria: "compra", titulo: "Factura proveedor", nombre_archivo: "f.pdf", ruta: rutaC, tamano: 10, sha256: "c".repeat(64) }));
check(valor(U.beto, `select count(*) from public.vp_documentos where venta_id = '${venta.id}';`) === "1", "otro usuario ve la OC pero no el respaldo de compra");
check(valor(U.beto, `select count(*) from storage.objects where bucket_id = 'vp-documentos';`) === "1", "depósito: otro usuario no lee el archivo de compra");
check(valor(U.ana, `select count(*) from storage.objects where bucket_id = 'vp-documentos';`) === "2", "depósito: responsable lee ambos");
check(valor(U.ana, `select count(*) from storage.objects where bucket_id = 'cz-productos';`) === "1", "depósito de Cotizaciones MP intacto");

// ── 11. Producto técnico y EETT ───────────────────────────────────────────────────────────────────────────
falla(rpc(U.ana, "vp_guardar_producto", j({ nombre: "Bomba", normas: [{ norma: "IEC 60034" }] })), "respaldo", "norma sin respaldo rechazada");
const prod = rpcJ(U.ana, "vp_guardar_producto", j({ nombre: "Bomba centrífuga 2 HP", marca: "Pedrollo", modelo: "CPm 680", codigo: "BOM-01", tipo_producto: "equipo",
  caracteristicas: [{ caracteristica: "Potencia", valor: "2", unidad: "HP" }, { caracteristica: "Alimentación", valor: "220", unidad: "V" }, { caracteristica: "Peso", valor: "No informado" }],
  accesorios: ["Manual de usuario"], exclusiones: ["Obras civiles"], garantia: "12 meses", normas: [{ norma: "CE", respaldo_texto: "Ficha del fabricante, pág. 2" }], fuente_tipo: "manual" }));
check(valor(U.ana, `select jsonb_array_length(caracteristicas) from public.vp_productos_tecnicos where producto_id = '${prod.producto_id}';`) === "2", "«No informado» no se guarda en la biblioteca");
check(valor(U.ana, `select marca||'|'||modelo from public.productos_catalogo where id = '${prod.producto_id}';`) === "Pedrollo|CPm 680", "producto en la biblioteca compartida existente");
const itR1 = valor(U.ana, `select string_agg(id::text||'|'||orden||'|'||cantidad||'|'||unidad, ',' order by orden) from public.vp_cotizacion_items where revision_id = '${r1.revision_id}';`).split(",").map((x) => x.split("|"));
const itemEETT = (it, extra = {}) => ({ item_id: it[0], orden: Number(it[1]), cantidad: Number(it[2]), unidad: it[3], nombre: "Bomba centrífuga 2 HP", marca: "Pedrollo", modelo: "CPm 680",
  caracteristicas: [{ caracteristica: "Potencia", valor: "2", unidad: "HP" }, { caracteristica: "Peso", valor: "No informado" }], requisitos: [], normas: [], ...extra });
const contenido = { objeto: "Suministro de bomba e instalación", alcance: "Suministro, instalación y puesta en marcha", items: [itemEETT(itR1[0])] };
const b = rpcJ(U.ana, "vp_guardar_eett", j({ cotizacion_id: cot.id, contenido }));
check(/^ET-\d{4}-\d{4}$/.test(b.folio) && b.revision === 0, "borrador EETT con folio ET y revisión 0", JSON.stringify(b));
falla(rpc(U.ana, "vp_emitir_eett", `'${b.id}'`, b.version), "No informado", "no se emite con campos «No informado»");
const b2 = rpcJ(U.ana, "vp_guardar_eett", j({ id: b.id, version: b.version, cotizacion_id: cot.id, contenido: { ...contenido, items: [itemEETT(itR1[0], { costo_unitario: 1 })] } }));
falla(rpc(U.ana, "vp_emitir_eett", `'${b.id}'`, b2.version), "costos", "una EETT no puede llevar costos ni precios");
const b3 = rpcJ(U.ana, "vp_guardar_eett", j({ id: b.id, version: b2.version, cotizacion_id: cot.id, contenido: { ...contenido, items: [itemEETT(itR1[0], { cantidad: 99 })] } }));
falla(rpc(U.ana, "vp_emitir_eett", `'${b.id}'`, b3.version), "no coincide", "cantidades deben coincidir con la cotización");
const b4 = rpcJ(U.ana, "vp_guardar_eett", j({ id: b.id, version: b3.version, cotizacion_id: cot.id, contenido: { ...contenido, items: [itemEETT(itR1[0], {
  caracteristicas: [{ caracteristica: "Potencia", valor: "2", unidad: "HP" }, { caracteristica: "Peso", valor: "No informado", excluir: true }],
  requisitos: [{ requisito: "Caudal mínimo 100 L/min", ofrecido: "Según curva del fabricante", cumplimiento: "cumple" }] })] } }));
falla(rpc(U.ana, "vp_emitir_eett", `'${b.id}'`, b4.version), "sin respaldo", "no se declara cumplimiento sin respaldo");
const contenidoOk = { ...contenido, items: [itemEETT(itR1[0], { caracteristicas: [{ caracteristica: "Potencia", valor: "2", unidad: "HP" }, { caracteristica: "Peso", valor: "No informado", excluir: true }],
  requisitos: [{ requisito: "Caudal mínimo 100 L/min", ofrecido: "Según curva del fabricante", cumplimiento: "sin_declarar" }] }), itemEETT(itR1[2], { nombre: "Instalación", marca: "", modelo: "", caracteristicas: [] })] };
const b5 = rpcJ(U.ana, "vp_guardar_eett", j({ id: b.id, version: b4.version, cotizacion_id: cot.id, contenido: contenidoOk }));
const em = rpcJ(U.ana, "vp_emitir_eett", `'${b.id}'`, b5.version);
check(/^[0-9a-f]{64}$/.test(em.hash) && em.items === 2, "EETT emitida con huella", JSON.stringify(em));
check(valor(U.ana, `select eett_id from public.vp_ventas where id = '${venta.id}';`) === b.id, "la venta queda vinculada a la EETT emitida de su revisión");
falla(como(U.admin, `update public.vp_eett set contenido = '{}' where id = '${b.id}';`), "permission denied", "EETT emitida no se modifica (sin privilegio)");
falla(psql(`update public.vp_eett set contenido = '{"x":1}' where id = '${b.id}';`), "VP_EETT", "EETT emitida no se modifica (ni el dueño)");
// Cambio posterior en el catálogo: la EETT emitida no cambia.
const hashAntes = valor(U.ana, `select hash from public.vp_eett where id = '${b.id}';`);
rpcJ(U.ana, "vp_guardar_producto", j({ producto_id: prod.producto_id, nombre: "Bomba centrífuga 2 HP (rev)", marca: "Pedrollo", modelo: "CPm 680-B", caracteristicas: [{ caracteristica: "Potencia", valor: "2.5", unidad: "HP" }], fuente_tipo: "manual" }));
check(valor(U.ana, `select hash = '${hashAntes}' and contenido->'items'->0->>'modelo' = 'CPm 680' from public.vp_eett where id = '${b.id}';`) === "t", "cambios del catálogo no alteran EETT emitidas");
const n1 = rpcJ(U.ana, "vp_guardar_eett", j({ cotizacion_id: cot.id, contenido: contenidoOk }));
check(n1.folio === b.folio && n1.revision === 1, "actualización = nueva revisión del mismo folio");
rpcJ(U.ana, "vp_emitir_eett", `'${n1.id}'`, n1.version);
check(valor(U.ana, `select string_agg(revision||':'||estado, ',' order by revision) from public.vp_eett where folio = '${b.folio}';`) === "0:reemplazada,1:emitida", "la revisión anterior se conserva como reemplazada");
falla(rpc(U.beto, "vp_guardar_eett", j({ cotizacion_id: cot.id, contenido: contenidoOk })), "VP_PERMISO", "otro usuario no prepara EETT de una cotización ajena");

// ── 12. Extracción asistida: pendiente de revisión ───────────────────────────────────────────────────────
const rutaF = `producto/${prod.producto_id}/ficha_tecnica/${randomUUID()}-ficha.pdf`;
como(U.ana, `insert into storage.objects (bucket_id, name) values ('vp-documentos', '${rutaF}');`);
const docF = rpcJ(U.ana, "vp_registrar_documento", j({ ambito: "producto", id: prod.producto_id, categoria: "ficha_tecnica", titulo: "Ficha fabricante", nombre_archivo: "ficha.pdf", ruta: rutaF, tamano: 99, sha256: "d".repeat(64) }));
const ex = rpcJ(U.ana, "vp_registrar_extraccion", j({ producto_id: prod.producto_id, documento_id: docF.id, metodo: "texto_pdf", propuesta: [{ caracteristica: "Caudal máximo", valor: "120", unidad: "L/min", pagina: 2 }, { caracteristica: "Altura", valor: "45", unidad: "m", pagina: 2 }] }));
check(valor(U.ana, `select estado from public.vp_extracciones where id = '${ex.id}';`) === "pendiente", "la propuesta extraída queda pendiente");
check(!/Caudal/.test(valor(U.ana, `select caracteristicas::text from public.vp_productos_tecnicos where producto_id = '${prod.producto_id}';`)), "lo extraído no entra a la ficha sin revisión");
rpcJ(U.ana, "vp_resolver_extraccion", `'${ex.id}'`, j([{ caracteristica: "Caudal máximo", valor: "120", unidad: "L/min", pagina: 2 }]));
const car = valor(U.ana, `select caracteristicas::text from public.vp_productos_tecnicos where producto_id = '${prod.producto_id}';`);
check(/Caudal/.test(car) && !/Altura/.test(car) && new RegExp(docF.id).test(car) && /"pagina": "2"/.test(car), "solo lo aceptado entra, con archivo y página de origen", car);

// ── 13. Mercado Público y otros módulos intactos ──────────────────────────────────────────────────────────
if (PLANTILLA) {
  const huellaMP = `select md5(string_agg(t, '|' order by t)) from (
      select 'pol:'||schemaname||'.'||tablename||'.'||policyname||':'||coalesce(qual,'')||':'||coalesce(with_check,'') t from pg_policies where policyname not like 'vp\\_%'
      union all select 'fn:'||p.oid::regprocedure::text||':'||md5(p.prosrc) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname not like 'vp\\_%'
      union all select 'col:'||table_name||'.'||column_name||':'||data_type from information_schema.columns where table_schema = 'public' and table_name not like 'vp\\_%'
      union all select 'trg:'||tgrelid::regclass::text||'.'||tgname from pg_trigger where not tgisinternal and tgrelid::regclass::text not like '%vp\\_%'
      union all select 'acl:'||c.relname||':'||coalesce(c.relacl::text,'') from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname not like 'vp\\_%' and c.relkind in ('r','v')
    ) x;`;
  check(psql(huellaMP).out === psql(huellaMP, PLANTILLA).out, "políticas, funciones, columnas, disparadores y permisos existentes sin cambios");
  const datosMP = `select md5(string_agg(t, '|' order by t)) from (select 'oc:'||md5(string_agg(to_jsonb(o)::text, ',' order by id)) t from public.ordenes_compra_v2 o where id <> 'oc-mp-vp'
      union all select 'ec:'||md5(string_agg(to_jsonb(e)::text, ',' order by id)) from public.eventos_compra e
      union all select 'g:'||md5(string_agg(to_jsonb(g)::text, ',' order by id)) from public.gastos_indirectos g
      union all select 'cz:'||md5(coalesce(string_agg(to_jsonb(c)::text, ',' order by id), '')) from public.cotizaciones c) x;`;
  check(psql(datosMP).out === psql(datosMP, PLANTILLA).out, "datos de Mercado Público, gastos y cotizaciones MP sin cambios");
}

console.log(`RESUMEN sql: ${ok} correctas, ${fallas} fallas`);
process.exit(fallas ? 1 : 0);
