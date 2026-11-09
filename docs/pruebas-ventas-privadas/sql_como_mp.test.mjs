// Pruebas de BORRADOR-2026-11-08-vp-cotizacion-como-mp.sql (y su recuperación) contra bases DESECHABLES locales (nunca producción).
//   A. Base como quedó en producción el 07/11 (solo la migración del 06/11) CON datos creados por las funciones anteriores
//      (cotización enviada y aceptada, venta, EETT emitida) → se aplica la migración → nada histórico cambia.
//   B. Persistencia con la versión nueva: ficha técnica y datos internos de compra al guardar, nueva revisión, duplicar y
//      convertir en venta; permisos sobre costos; márgenes con la misma fórmula; EETT emitida desde las fichas.
//   C. Recuperación: restituye las funciones exactas del 07/11, conserva los datos nuevos y se niega a quitar columnas con datos;
//      sin datos nuevos deja el catálogo idéntico al del 07/11. La migración se puede volver a aplicar después.
// Uso: VP_PLANTILLA_URL=postgresql://postgres@127.0.0.1:5499/bfk_vp_plantilla node docs/pruebas-ventas-privadas/sql_como_mp.test.mjs
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const PLANTILLA = process.env.VP_PLANTILLA_URL || "postgresql://postgres@127.0.0.1:5499/bfk_vp_plantilla";
const SERVIDOR = PLANTILLA.replace(/\/[^/]+$/, "");
const NOMBRE_PLANTILLA = PLANTILLA.split("/").pop();
const MIG = resolve(dirname(fileURLToPath(import.meta.url)), "../migraciones");
const U = { admin: "11111111-1111-1111-1111-111111111111", ana: "22222222-2222-2222-2222-222222222222", beto: "33333333-3333-3333-3333-333333333333" };
let ok = 0, fallas = 0;
const check = (c, n, det = "") => { if (c) ok++; else { fallas++; console.log("FALLA:", n, det); } };
const lit = (s) => { const t = "q" + Math.random().toString(36).slice(2, 8); return `$${t}$${s}$${t}$`; };
const j = (o) => `${lit(JSON.stringify(o))}::jsonb`;
// jsonb ordena las claves: se compara en forma canónica (claves ordenadas).
const canon = (o) => JSON.stringify(o, (k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((x) => [x, v[x]])) : v));
const psqlEn = (db, sql, extra = []) => { try { return { out: execFileSync("psql", [`${SERVIDOR}/${db}`, "-X", "-At", "-q", "-v", "ON_ERROR_STOP=1", ...extra], { input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim() }; } catch (e) { return { err: String(e.stderr || e.message).trim() }; } };
const archivo = (db, f, extra = []) => { try { return { out: execFileSync("psql", [`${SERVIDOR.replace("postgres@", "bfk_owner@")}/${db}`, "-X", "-q", "-v", "ON_ERROR_STOP=1", ...extra, "-f", `${MIG}/${f}`], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }) }; } catch (e) { return { err: String(e.stderr || e.message).trim() }; } };
const nuevaBase = (db) => { psqlEn("postgres", `drop database if exists ${db} with (force);`); const r = psqlEn("postgres", `create database ${db} template ${NOMBRE_PLANTILLA};`); if (r.err) throw new Error(r.err); };
const prefijo = (u) => `set role authenticated;\nselect set_config('request.jwt.claims', ${lit(JSON.stringify({ sub: u, role: "authenticated" }))}, false) \\g /dev/null\n`;
let DB = "";
const como = (u, sql) => psqlEn(DB, prefijo(u) + sql);
const valor = (u, sql) => { const r = como(u, sql); if (r.err) throw new Error(r.err); return r.out; };
const rpc = (u, fn, ...a) => como(u, `select public.${fn}(${a.join(", ")});`);
const rpcJ = (u, fn, ...a) => { const r = rpc(u, fn, ...a); if (r.err) throw new Error(`${fn}: ${r.err}`); return JSON.parse(r.out); };
const root = (sql) => { const r = psqlEn(DB, sql); if (r.err) throw new Error(r.err); return r.out; };
const falla = (r, patron, n) => check(!!r.err && new RegExp(patron).test(r.err), n, r.err ? r.err.split("\n")[0] : `sin error (${r.out})`);
const FUNCIONES = "('vp_reemplazar_lineas','vp_cotizacion_nueva_revision','vp_duplicar_cotizacion','vp_crear_venta_desde_cotizacion')";
const huellaFunciones = () => root(`select string_agg(proname||':'||md5(prosrc), ',' order by proname) from pg_proc where pronamespace='public'::regnamespace and proname in ${FUNCIONES};`);
const ORIGINAL = "vp_cotizacion_nueva_revision:0a6f789953c184ffef2fbd0d9356b6cc,vp_crear_venta_desde_cotizacion:3bf7ee0c8ca77dfdbe3abf96dcbbdb79,vp_duplicar_cotizacion:c6dde132a6ed8526526cf2a643dadb2f,vp_reemplazar_lineas:1b2f0a7b2e3b063a45d5e9dfdbf56211";
const HUELLA_CATALOGO = "select md5(string_agg(t,'|' order by t)) from (select 'c:'||c.relname::text||c.relkind::text||coalesce(c.relacl::text,'') t from pg_class c where c.relnamespace in ('public'::regnamespace,'storage'::regnamespace) union all select 'a:'||attrelid::regclass::text||attname||atttypid::regtype::text||attnotnull from pg_attribute where attrelid in (select oid from pg_class where relnamespace='public'::regnamespace and relname like 'vp\\_%') and attnum > 0 and not attisdropped union all select 'k:'||conrelid::regclass::text||pg_get_constraintdef(oid) from pg_constraint where connamespace='public'::regnamespace and conrelid::regclass::text like 'vp\\_%' union all select 'f:'||p.oid::regprocedure::text||md5(p.prosrc)||coalesce(p.proacl::text,'') from pg_proc p where p.pronamespace='public'::regnamespace union all select 'v:'||viewname||md5(definition) from pg_views where schemaname='public' union all select 'p:'||schemaname||tablename||policyname||coalesce(qual,'')||coalesce(with_check,'') from pg_policies) x";

// Fichas de prueba (modelo de Mercado Público). Rutas de imagen del depósito cz-productos (no se guardan imágenes en la ficha).
const FICHA_BOMBA = { nombre: "Bomba centrífuga 2 HP", marca: "Pedrollo", modelo: "CPm 680", color: "Azul", generales: [{ etiqueta: "Material", valor: "Hierro fundido" }],
  especificaciones: [{ etiqueta: "Potencia", valor: "2 HP" }, { etiqueta: "Caudal máximo", valor: "160 L/min" }], descripcion: "Bomba para riego.", imagenes: ["img/abc.jpg", "img/def.jpg"] };
const FICHA_MANGUERA = { nombre: "Manguera 1 pulgada", marca: "Flexi", modelo: "PVC-1", color: "", generales: [], especificaciones: [{ etiqueta: "Diámetro", valor: "1\"" }], descripcion: "", imagenes: [] };
const FICHA_SERV = { nombre: "Instalación y puesta en marcha", marca: "", modelo: "", color: "", generales: [{ etiqueta: "Alcance", valor: "Instalación en planta" }], especificaciones: [], descripcion: "", imagenes: [] };
const DESP = { key: "e1", proveedor: "Ferretería Sur", monto: 23800, con_factura: true, estado: "confirmado", destino: "Planta km 5, Laja", evidencia: "Simulación de compra", fecha_cotizacion: "2026-11-08" };
const itemsNuevos = () => [
  { tipo: "producto", codigo: "BOM-01", descripcion: "Bomba centrífuga 2 HP · Pedrollo CPm 680", unidad: "UN", cantidad: 2, precio_unitario: 350000, descuento_pct: 5, ficha: FICHA_BOMBA, ficha_aprobada: true,
    costo_unitario: 210000, proveedor: "Ferretería Sur", enlace: "https://tienda.invalid/bomba", precio_compra: 238000, precio_incluye_iva: true, con_factura: true, despacho: DESP },
  { tipo: "producto", descripcion: "Manguera 1 pulgada · Flexi PVC-1", unidad: "M", cantidad: 12.5, precio_unitario: 3990, ficha: FICHA_MANGUERA,
    costo_unitario: null, proveedor: "Ferretería Sur", enlace: "https://tienda.invalid/manguera", precio_compra: null, precio_incluye_iva: true, con_factura: true, despacho: DESP },
  { tipo: "servicio", descripcion: "Instalación y puesta en marcha", unidad: "GL", cantidad: 1, precio_unitario: 180000, descuento_pct: 10, ficha: FICHA_SERV,
    costo_unitario: 80000, proveedor: "Técnico externo", precio_compra: 80000, precio_incluye_iva: false, con_factura: true, costo_nota: "Subcontrato" },
];

try {
  // ═══ A. Migración sobre una base con datos del 07/11 ═══════════════════════════════════════════════════════════════════
  DB = "bfk_vpmp_a"; nuevaBase(DB);
  check(!archivo(DB, "BORRADOR-2026-11-06-ventas-privadas.sql").err, "A0 base del 07/11 instalada");
  check(huellaFunciones() === ORIGINAL, "A0b funciones del 07/11 con la huella que exige la migración");
  const cli = rpcJ(U.ana, "vp_guardar_cliente", j({ rut: "76086428-5", razon_social: "Maderas del Sur SpA", tipo_persona: "empresa", direccion_entrega: "Planta km 5", comuna_entrega: "Laja", plazo_pago_dias: 30 }));
  const viejos = [
    { tipo: "producto", codigo: "BOM-01", descripcion: "Bomba centrífuga 2 HP", unidad: "UN", cantidad: 2, precio_unitario: 350000, descuento_pct: 5, costo_unitario: 240000 },
    { tipo: "producto", descripcion: "Manguera", unidad: "M", cantidad: 12.5, precio_unitario: 3990, costo_unitario: 2100.5 },
    { tipo: "servicio", descripcion: "Instalación", unidad: "GL", cantidad: 1, precio_unitario: 180000, descuento_pct: 10 },
  ];
  const cv = rpcJ(U.ana, "vp_guardar_cotizacion", j({ cliente_id: cli.id, vigencia_dias: 15, items: viejos }));
  rpcJ(U.ana, "vp_cotizacion_estado", `'${cv.id}'`, `'enviada'`, j({}), String(Number(valor(U.ana, `select version from public.vp_cotizaciones where id='${cv.id}';`))));
  const cv2 = rpcJ(U.ana, "vp_cotizacion_estado", `'${cv.id}'`, `'aceptada'`, j({}), String(Number(valor(U.ana, `select version from public.vp_cotizaciones where id='${cv.id}';`))));
  const lineasV = JSON.parse(valor(U.ana, `select json_agg(json_build_object('id', id, 'orden', orden, 'cantidad', cantidad, 'unidad', unidad) order by orden) from public.vp_cotizacion_items where revision_id = '${cv.revision_id}';`));
  const ee = rpcJ(U.ana, "vp_guardar_eett", j({ cotizacion_id: cv.id, contenido: { objeto: "Suministro", items: lineasV.slice(0, 1).map((l) => ({ item_id: l.id, orden: l.orden, cantidad: Number(l.cantidad), unidad: l.unidad, nombre: "Bomba", caracteristicas: [{ caracteristica: "Potencia", valor: "2", unidad: "HP" }] })) } }));
  rpcJ(U.ana, "vp_emitir_eett", `'${ee.id}'`, String(ee.version));
  const venta = rpcJ(U.ana, "vp_crear_venta_desde_cotizacion", `'${cv.id}'`, `'${randomUUID()}'`, j({}));
  const FOTO = `select md5(string_agg(x, '|' order by x)) from (
      select 'r'||id||coalesce(documento::text,'')||coalesce(cliente::text,'')||neto||iva||total||estado as x from public.vp_cotizacion_revisiones
      union all select 'i'||id||descripcion||cantidad||precio_unitario||descuento_pct||subtotal_neto from public.vp_cotizacion_items
      union all select 'k'||item_id||costo_unitario||coalesce(nota,'') from public.vp_cotizacion_item_costos
      union all select 'v'||id||neto||iva||total||estado from public.vp_ventas
      union all select 'vi'||id||descripcion||subtotal_neto from public.vp_venta_items
      union all select 'vk'||item_id||costo_unitario_estimado from public.vp_venta_item_costos
      union all select 'e'||id||estado||coalesce(hash,'')||contenido::text from public.vp_eett
      union all select 'm'||revision_id||coalesce(costo::text,'-')||coalesce(lineas_sin_costo::text,'-') from public.vp_margen_revisiones
      union all select 'mv'||venta_id||coalesce(costo_estimado::text,'-')||coalesce(lineas_sin_costo::text,'-') from public.vp_margen_ventas) t;`;
  const antes = root(FOTO); const nHist = root("select count(*) from public.vp_historial;");
  const mig = archivo(DB, "BORRADOR-2026-11-08-vp-cotizacion-como-mp.sql");
  check(!mig.err, "A1 migración aplicada sobre datos existentes", mig.err);
  check(root(FOTO) === antes, "A2 cotizaciones, documentos congelados, EETT emitida, venta y márgenes idénticos tras migrar");
  check(root("select count(*) from public.vp_historial;") === nHist, "A3 la migración no reescribe filas (historial sin entradas nuevas)");
  check(root("select count(*) from public.vp_cotizacion_items where ficha is not null or ficha_aprobada;") === "0", "A4 líneas antiguas sin ficha (no se inventa información)");
  falla(archivo(DB, "BORRADOR-2026-11-08-vp-cotizacion-como-mp.sql"), "no es la versión del 07/11", "A5 aplicarla dos veces se detiene sin cambios");
  const nr = rpcJ(U.ana, "vp_cotizacion_nueva_revision", `'${cv.id}'`, String(Number(valor(U.ana, `select version from public.vp_cotizaciones where id='${cv.id}';`))));
  check(valor(U.ana, `select costo||'|'||lineas_sin_costo from public.vp_margen_revisiones where revision_id = '${nr.revision_id}';`) === "506256|1", "A6 revisión nueva de una cotización antigua: mismos costos y margen");
  check(rpc(U.ana, "vp_crear_venta_desde_cotizacion", `'${cv.id}'`, `'${randomUUID()}'`, j({})).out.includes(venta.id), "A7 sigue sin duplicar la venta (devuelve la existente)");

  // ═══ B. Persistencia con la versión nueva ═════════════════════════════════════════════════════════════════════════════
  falla(rpc(U.ana, "vp_guardar_cotizacion", j({ cliente_id: cli.id, items: [{ ...itemsNuevos()[0], ficha: { ...FICHA_BOMBA, precio: 1000 } }] })), "ficha técnica no puede contener costos", "B1 la ficha técnica no admite claves comerciales");
  falla(rpc(U.ana, "vp_guardar_cotizacion", j({ cliente_id: cli.id, items: [{ ...itemsNuevos()[0], precio_compra: -1 }] })), "precio de compra inválido", "B2 precio de compra negativo rechazado");
  falla(rpc(U.ana, "vp_guardar_cotizacion", j({ cliente_id: cli.id, items: [{ ...itemsNuevos()[0], despacho: { ...DESP, monto: -5 } }] })), "despacho no puede ser negativo", "B3 despacho negativo rechazado");
  const c = rpcJ(U.ana, "vp_guardar_cotizacion", j({ cliente_id: cli.id, contacto_nombre: "Rosa", direccion_entrega: "Planta km 5, Laja", vigencia_dias: 10, afecta_iva: true, items: itemsNuevos() }));
  const filas = JSON.parse(valor(U.ana, `select json_agg(json_build_object('orden', i.orden, 'ficha', i.ficha, 'apr', i.ficha_aprobada, 'k', to_jsonb(k) - 'item_id') order by i.orden) from public.vp_cotizacion_items i left join public.vp_cotizacion_item_costos k on k.item_id = i.id where i.revision_id = '${c.revision_id}';`));
  check(canon(filas[0].ficha) === canon(FICHA_BOMBA) && filas[0].apr === true, "B4 ficha técnica completa guardada (marca, modelo, color, generales, especificaciones, imágenes)");
  check(filas[0].k.proveedor === "Ferretería Sur" && filas[0].k.enlace === "https://tienda.invalid/bomba" && Number(filas[0].k.precio_compra) === 238000 && filas[0].k.precio_incluye_iva === true && filas[0].k.con_factura === true && canon(filas[0].k.despacho) === canon(DESP) && Number(filas[0].k.costo_unitario) === 210000,
    "B5 datos internos de compra y despacho guardados", JSON.stringify(filas[0].k));
  check(filas[1].k && filas[1].k.costo_unitario == null && filas[1].k.proveedor === "Ferretería Sur" && filas[1].k.despacho?.key === "e1", "B6 ítem sin precio de compra: proveedor, enlace y despacho compartido se conservan (costo vacío)");
  check(filas[2].k.costo_nota === undefined && filas[2].k.nota === "Subcontrato" && filas[2].k.precio_incluye_iva === false, "B7 servicio con costo de subcontrato y nota");
  check(valor(U.ana, `select costo||'|'||lineas_sin_costo from public.vp_margen_revisiones where revision_id = '${c.revision_id}';`) === "500000|1", "B8 margen con la misma fórmula: 2×210000 + 1×80000; la línea sin precio de compra cuenta como «sin costo»");
  check(valor(U.beto, `select count(*) from public.vp_cotizacion_item_costos k join public.vp_cotizacion_items i on i.id = k.item_id where i.revision_id = '${c.revision_id}';`) === "0", "B9 otro usuario no ve proveedor, enlace, precio de compra ni despacho");
  check(valor(U.beto, `select count(*) from public.vp_cotizacion_items where revision_id = '${c.revision_id}' and ficha is not null;`) === "3", "B10 la ficha técnica sí es visible para el equipo (no es dato comercial)");
  falla(rpc(U.beto, "vp_guardar_cotizacion", j({ id: c.id, version: 1, cliente_id: cli.id, items: itemsNuevos() })), "VP_PERMISO", "B11 otro usuario no modifica la cotización");
  check(valor(U.ana, `select count(*) from public.vp_historial where tabla = 'vp_cotizacion_item_costos' and cotizacion_id = '${c.id}' and sensible;`) === "3", "B12 historial de costos marcado como sensible");
  // Rama «quien guarda no ve costos» (se conservan los datos internos por posición): se ejercita directamente.
  const kAntes = root(`select string_agg((to_jsonb(k) - 'item_id')::text, '|' order by i.orden) from public.vp_cotizacion_items i join public.vp_cotizacion_item_costos k on k.item_id = i.id where i.revision_id = '${c.revision_id}';`);
  root(`select public.vp_reemplazar_lineas('${c.revision_id}', ${j(itemsNuevos().map(({ costo_unitario, costo_nota, proveedor, enlace, precio_compra, precio_incluye_iva, con_factura, despacho, ...r }) => r))}, false);`);
  check(root(`select string_agg((to_jsonb(k) - 'item_id')::text, '|' order by i.orden) from public.vp_cotizacion_items i join public.vp_cotizacion_item_costos k on k.item_id = i.id where i.revision_id = '${c.revision_id}';`) === kAntes, "B13 guardar sin ver costos conserva TODOS los datos internos (no los borra ni los expone)");
  // Envío, nueva revisión, duplicar.
  const ver = () => String(Number(valor(U.ana, `select version from public.vp_cotizaciones where id='${c.id}';`)));
  rpcJ(U.ana, "vp_cotizacion_estado", `'${c.id}'`, `'enviada'`, j({}), ver());
  const docEnv = valor(U.ana, `select md5(documento::text) from public.vp_cotizacion_revisiones where id = '${c.revision_id}';`);
  falla(rpc(U.ana, "vp_guardar_cotizacion", j({ id: c.id, version: Number(ver()), cliente_id: cli.id, items: itemsNuevos() })), "ya fue enviada", "B14 revisión enviada: fichas y costos protegidos");
  check(!/costo|proveedor|enlace|precio_compra|despacho|ficha/.test(valor(U.ana, `select documento::text from public.vp_cotizacion_revisiones where id = '${c.revision_id}';`)), "B15 documento para el cliente sin costos, proveedor, enlaces ni despachos");
  const r1 = rpcJ(U.ana, "vp_cotizacion_nueva_revision", `'${c.id}'`, ver());
  const copiaR = (rev) => valor(U.ana, `select md5(string_agg(coalesce(i.ficha::text,'')||i.ficha_aprobada||coalesce((to_jsonb(k) - 'item_id')::text,''), '|' order by i.orden)) from public.vp_cotizacion_items i left join public.vp_cotizacion_item_costos k on k.item_id = i.id where i.revision_id = '${rev}';`);
  check(copiaR(r1.revision_id) === copiaR(c.revision_id), "B16 nueva revisión copia fichas, aprobación y todos los datos de compra");
  check(valor(U.ana, `select md5(documento::text) from public.vp_cotizacion_revisiones where id = '${c.revision_id}';`) === docEnv, "B17 la revisión enviada queda intacta");
  const dupA = rpcJ(U.ana, "vp_duplicar_cotizacion", `'${c.id}'`);
  check(copiaR(dupA.revision_id) === copiaR(r1.revision_id), "B18 duplicar (responsable) copia fichas y datos de compra");
  const dupB = rpcJ(U.beto, "vp_duplicar_cotizacion", `'${c.id}'`);
  check(root(`select count(*) from public.vp_cotizacion_items where revision_id = '${dupB.revision_id}' and ficha is not null;`) === "3" && root(`select count(*) from public.vp_cotizacion_item_costos k join public.vp_cotizacion_items i on i.id = k.item_id where i.revision_id = '${dupB.revision_id}';`) === "0", "B19 duplicar (otro usuario) copia las fichas pero NO los datos internos");
  // EETT emitida desde las fichas y conversión a venta.
  rpcJ(U.ana, "vp_cotizacion_estado", `'${c.id}'`, `'enviada'`, j({}), ver());
  rpcJ(U.ana, "vp_cotizacion_estado", `'${c.id}'`, `'aceptada'`, j({}), ver());
  const { itemEETTDesde, tieneDatosComerciales } = await import("../../src/lib/ventasPrivadas.js");
  const lin = JSON.parse(valor(U.ana, `select json_agg(to_jsonb(i) order by orden) from public.vp_cotizacion_items i where revision_id = '${r1.revision_id}';`));
  const contenido = { objeto: "Suministro e instalación", items: lin.map((l) => itemEETTDesde(l, null, null)) };
  check(!tieneDatosComerciales(contenido) && contenido.items[0].marca === "Pedrollo" && contenido.items[0].caracteristicas.some((k) => k.grupo === "generales" && k.caracteristica === "Material") && contenido.items[0].imagenes.length === 2,
    "B20 la EETT toma marca, modelo, características e imágenes de la ficha, sin datos comerciales");
  const e2 = rpcJ(U.ana, "vp_guardar_eett", j({ cotizacion_id: c.id, contenido }));
  const em = rpcJ(U.ana, "vp_emitir_eett", `'${e2.id}'`, String(e2.version));
  check(em.items === 3, "B21 EETT emitida con los 3 ítems (sin «No informado» al venir de fichas completas)");
  const v2 = rpcJ(U.ana, "vp_crear_venta_desde_cotizacion", `'${c.id}'`, `'${randomUUID()}'`, j({}));
  const vi = JSON.parse(valor(U.ana, `select json_agg(json_build_object('ficha', i.ficha, 'k', to_jsonb(k) - 'item_id') order by i.orden) from public.vp_venta_items i left join public.vp_venta_item_costos k on k.item_id = i.id where i.venta_id = '${v2.id}';`));
  check(canon(vi[0].ficha) === canon(FICHA_BOMBA) && vi[0].k.proveedor === "Ferretería Sur" && vi[0].k.enlace === "https://tienda.invalid/bomba" && Number(vi[0].k.precio_compra) === 238000 && vi[0].k.despacho?.key === "e1" && Number(vi[0].k.costo_unitario_estimado) === 210000,
    "B22 la venta conserva la ficha técnica y los datos de compra del ítem aceptado");
  check(vi[1].k && vi[1].k.costo_unitario_estimado == null && vi[1].k.enlace === "https://tienda.invalid/manguera", "B23 ítem sin costo: la venta guarda proveedor y enlace con costo estimado vacío");
  check(valor(U.ana, `select costo_estimado||'|'||lineas_sin_costo from public.vp_margen_ventas where venta_id = '${v2.id}';`) === "500000|1", "B24 margen de la venta con la misma fórmula (costo vacío = sin costo)");
  check(valor(U.ana, `select total from public.vp_ventas where id = '${v2.id}';`) === valor(U.ana, `select total from public.vp_cotizacion_revisiones where id = '${r1.revision_id}';`), "B25 total de la venta = total de la revisión aceptada");
  check(valor(U.beto, `select count(*) from public.vp_venta_item_costos k join public.vp_venta_items i on i.id = k.item_id where i.venta_id = '${v2.id}';`) === "0", "B26 otro usuario no ve los datos de compra de la venta");
  check(rpcJ(U.ana, "vp_crear_venta_desde_cotizacion", `'${c.id}'`, `'${randomUUID()}'`, j({})).ya_existia === true, "B27 una segunda conversión devuelve la misma venta");

  // ═══ C. Recuperación ══════════════════════════════════════════════════════════════════════════════════════════════════
  falla(archivo(DB, "BORRADOR-2026-11-08-vp-cotizacion-como-mp-deshacer.sql", ["-v", "quitar_columnas=si"]), "no se quitaron columnas ni se cambió nada", "C1 con datos nuevos no quita columnas (y no cambia nada)");
  check(huellaFunciones() !== ORIGINAL, "C1b tras la negativa siguen las funciones nuevas");
  const fichasAntes = root("select md5(string_agg(coalesce(ficha::text,''), '|' order by id)) from public.vp_cotizacion_items;");
  const rec = archivo(DB, "BORRADOR-2026-11-08-vp-cotizacion-como-mp-deshacer.sql");
  check(!rec.err && huellaFunciones() === ORIGINAL, "C2 recuperación: funciones exactamente iguales a las del 07/11", rec.err);
  check(root("select md5(string_agg(coalesce(ficha::text,''), '|' order by id)) from public.vp_cotizacion_items;") === fichasAntes, "C3 recuperación sin borrar fichas ni datos de compra");
  check(root("select attnotnull from pg_attribute where attrelid = 'public.vp_cotizacion_item_costos'::regclass and attname = 'costo_unitario';") === "f", "C4 con costos vacíos el costo sigue opcional (nada se borra ni se falsea)");
  const cOld = rpcJ(U.ana, "vp_guardar_cotizacion", j({ cliente_id: cli.id, items: viejos }));
  check(valor(U.ana, `select costo||'|'||lineas_sin_costo from public.vp_margen_revisiones where revision_id = '${cOld.revision_id}';`) === "506256|1", "C5 tras recuperar, la aplicación anterior guarda y calcula igual");
  const re = archivo(DB, "BORRADOR-2026-11-08-vp-cotizacion-como-mp.sql");
  check(!re.err && huellaFunciones() !== ORIGINAL && root("select md5(string_agg(coalesce(ficha::text,''), '|' order by id)) from public.vp_cotizacion_items where revision_id <> '" + cOld.revision_id + "';") === fichasAntes, "C6 la migración se vuelve a aplicar y reutiliza los datos conservados", re.err);

  DB = "bfk_vpmp_c"; nuevaBase(DB);
  archivo(DB, "BORRADOR-2026-11-06-ventas-privadas.sql");
  const catalogo0611 = root(HUELLA_CATALOGO);
  check(!archivo(DB, "BORRADOR-2026-11-08-vp-cotizacion-como-mp.sql").err && root(HUELLA_CATALOGO) !== catalogo0611, "C7 base sin datos: migración aplicada");
  const q = archivo(DB, "BORRADOR-2026-11-08-vp-cotizacion-como-mp-deshacer.sql", ["-v", "quitar_columnas=si"]);
  check(!q.err && root(HUELLA_CATALOGO) === catalogo0611, "C8 sin datos nuevos, la recuperación completa deja el catálogo idéntico al del 07/11 (columnas, restricciones, funciones, vistas, permisos)", q.err);
} catch (e) { fallas++; console.log("EXCEPCIÓN:", e.message.split("\n").slice(0, 3).join(" | ")); }
finally { for (const db of ["bfk_vpmp_a", "bfk_vpmp_c"]) psqlEn("postgres", `drop database if exists ${db} with (force);`); }
console.log(`RESUMEN sql_como_mp: ${ok} OK, ${fallas} fallas`);
process.exit(fallas ? 1 : 0);
