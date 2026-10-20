// Contactos institucionales (21/10/2026) — interfaz en PC y celular contra la BASE REAL DESECHABLE (PostgreSQL local con la
// migración BORRADOR-2026-10-21-contactos-institucionales instalada). El resto de Supabase es el simulado de siempre.
// Las RPC y lecturas de contactos se ejecutan en la base local como rol authenticated con el usuario de la sesión (RLS real).
// Uso: NODE_PATH=$PWD/node_modules node docs/pruebas-oc/e2e_contactos.mjs http://127.0.0.1:4190/
// Requiere: PostgreSQL local en /var/tmp/pgl:5499 con la base plantilla «bfk» (ver docs/migraciones/pruebas/contactos).
import { execFileSync } from "node:child_process";
import { chromium, CHROME, crearBase, abrir } from "./mock_estado.mjs";
import { crearDatos, RESPUESTAS_MP } from "./datos_oc.mjs";

const URL_APP = process.argv[2] || "http://127.0.0.1:4190/";
const DBN = process.env.CI_E2E_DB || "bfk_e2e_contactos";
const PG = ["-h", process.env.PGHOST_CI || "/var/tmp/pgl", "-p", process.env.PGPORT_CI || "5499", "-U", "postgres", "-X", "-At", "-q", "-v", "ON_ERROR_STOP=1"];
const MIG = new URL("../migraciones/BORRADOR-2026-10-21-contactos-institucionales.sql", import.meta.url).pathname;
const UID = { u1: "11111111-1111-1111-1111-111111111111", u2: "22222222-2222-2222-2222-222222222222" };
const F = []; let nOk = 0;
const ok = (k, v, d) => { if (!v) { F.push(k); console.log("FALLA " + k + (d !== undefined ? " :: " + JSON.stringify(d).slice(0, 400) : "")); } else { nOk++; console.log("OK    " + k); } };
const espera = (p, ms = 600) => p.waitForTimeout(ms);

// ── base desechable ──
const psql = (sql, { db = DBN, yo = null } = {}) => {
  const pre = yo ? `set role authenticated;\nselect set_config('request.jwt.claims', '${JSON.stringify({ sub: UID[yo], role: "authenticated" })}', false) \\gset _\n` : "";
  return execFileSync("psql", [...PG, "-d", db], { input: pre + sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
};
psql(`drop database if exists ${DBN}`, { db: "postgres" }); psql(`create database ${DBN} template bfk`, { db: "postgres" });
execFileSync("psql", [...PG, "-d", DBN, "-q", "-f", MIG], { stdio: ["ignore", "ignore", "pipe"] });
const lit = (v) => v === null || v === undefined ? "null" : `$v$${String(v)}$v$`;
const espejoOC = (o) => psql(`insert into public.ordenes_compra_v2 (id, numero_oc, cliente, entidad, rut_cliente, contacto, correo_cliente, fecha_hora_emision_mp)
  values (${lit(o.id)}, ${lit(o.numero_oc)}, ${lit(o.cliente)}, ${lit(o.entidad)}, ${lit(o.rut_cliente || "")}, ${lit(o.contacto || "")}, ${lit(o.correo_cliente || "")}, ${lit(o.fecha_hora_emision_mp || null)})
  on conflict (id) do update set rut_cliente = excluded.rut_cliente, contacto = excluded.contacto, correo_cliente = excluded.correo_cliente,
    fecha_hora_emision_mp = excluded.fecha_hora_emision_mp, cliente = excluded.cliente, entidad = excluded.entidad;`);

// ── datos: institución A (3 OC), institución B con nombre parecido y otro RUT, y una OC por completar desde MP ──
const RUT_A = "99.111.222-7", RUT_B = "99.111.333-9";
const datos = crearDatos();
const fijar = (id, o) => Object.assign(datos.ordenes_compra_v2.find((x) => x.id === id), o);
const hace = (n) => new Date(Date.now() - n * 864e5).toISOString();
fijar("oc1", { rut_cliente: RUT_A, cliente: "MUNICIPALIDAD DE PRUEBA ALFA", contacto: "Ana Pérez · +56 9 1111 1111", correo_cliente: "Ana.Perez@muni-alfa.cl", fecha_hora_emision_mp: hace(40) });
fijar("oc2", { rut_cliente: RUT_A, cliente: "MUNICIPALIDAD DE PRUEBA ALFA", contacto: "", correo_cliente: "", fecha_hora_emision_mp: hace(30) });
fijar("oc3", { rut_cliente: RUT_A, cliente: "MUNICIPALIDAD DE PRUEBA ALFA", contacto: "Bruno Soto · 22 333 4444", correo_cliente: "bruno@muni-alfa.cl", fecha_hora_emision_mp: hace(20) });
fijar("oc4", { rut_cliente: RUT_B, cliente: "MUNICIPALIDAD DE PRUEBA ALFA.", contacto: "Carla Ruiz", correo_cliente: "carla@alfa-b.cl", fecha_hora_emision_mp: hace(25) });
fijar("oc9", { rut_cliente: "", contacto: "", correo_cliente: "", sync_pendiente: true, cliente: "OC POR COMPLETAR" });
for (const o of datos.ordenes_compra_v2) espejoOC(o);
datos.entidades_catalogo = [{ id: "ent_a", rut: RUT_A, nombre_entidad: "MUNICIPALIDAD DE PRUEBA ALFA", comuna: "LAJA", contacto: "", correo: "" },
  { id: "ent_b", rut: RUT_B, nombre_entidad: "MUNICIPALIDAD DE PRUEBA ALFA.", comuna: "LAJA", contacto: "", correo: "" }];
// Carga inicial (la misma de producción) para las OC existentes
execFileSync("psql", [...PG, "-d", DBN, "-q", "-f", new URL("../migraciones/BORRADOR-2026-10-21-contactos-institucionales-carga-inicial.sql", import.meta.url).pathname], { stdio: ["ignore", "ignore", "pipe"] });
// MP: la OC 9 viene de la institución A con Ana y OTRO correo (más reciente)
const mp = { ...RESPUESTAS_MP };
mp["2009-109-SE26"] = { status: 200, body: { ok: true, oc: { ...RESPUESTAS_MP["2009-109-SE26"].body.oc, rut_cliente: RUT_A, cliente: "MUNICIPALIDAD DE PRUEBA ALFA", entidad: "ADQUISICIONES",
  contacto: "Ana Pérez · +56 9 1111 1111", cargo_contacto: "Encargada de compras", correo_cliente: "ana.perez@alfa.gob.cl", fecha_envio: hace(2).slice(0, 19) } } };

// ── puente: contactos → base local; OC escritas → espejo en la base local ──
const TABLAS_CI = ["contactos_institucionales", "contactos_institucionales_oc", "contactos_institucionales_historial"];
const RPC_CI = {
  conciliar_contactos_oc: "public.conciliar_contactos_oc(j->>'p_oc_id', coalesce(j->>'p_origen','mp'), j->>'p_cargo')",
  guardar_contacto_institucional: "public.guardar_contacto_institucional((j->>'p_id')::uuid, j->>'p_rut', j->'p_datos', j->>'p_oc_id')",
  resolver_contacto_pendiente: "public.resolver_contacto_pendiente((j->>'p_id')::uuid, j->>'p_decision', j->>'p_motivo')",
  marcar_contacto_obsoleto: "public.marcar_contacto_obsoleto((j->>'p_id')::uuid, j->>'p_motivo', (j->>'p_reemplazo')::uuid)",
  resolver_propuesta_contacto: "public.resolver_propuesta_contacto((j->>'p_id')::uuid, (j->>'p_aprobar')::boolean)",
  fusionar_contactos: "public.fusionar_contactos((j->>'p_conservar')::uuid, (j->>'p_absorber')::uuid, j->>'p_motivo')",
  registrar_correo_cobranza: "public.registrar_correo_cobranza(j->>'p_oc_id', j->>'p_correos')",
};
const llamadasCI = [];
function conectar(base) {
  const rpc0 = base.rpc, leer0 = base.leer, escribir0 = base.escribir;
  base.rpc = (fn, b, yo, interno) => {
    if (!RPC_CI[fn]) return rpc0(fn, b, yo, interno);
    llamadasCI.push({ fn, b });
    try { return { status: 200, json: JSON.parse(psql(`with x as (select $b$${JSON.stringify(b)}$b$::jsonb j) select ${RPC_CI[fn]}::text from x;`, { yo })) }; }
    catch (e) { const m = String(e.stderr || e.message).match(/ERROR:\s+(.*)/); return { status: 400, json: { message: m ? m[1] : "error" } }; }
  };
  base.leer = (tabla, params) => {
    if (!TABLAS_CI.includes(tabla)) return leer0(tabla, params);
    const filtros = []; let orden = "", limite = "";
    for (const [k, v] of params) {
      if (k === "select") continue;
      if (k === "order") { orden = " order by " + v.split(",").map((s) => { const [c, d] = s.split("."); return `"${c}" ${d === "desc" ? "desc" : "asc"}`; }).join(", "); continue; }
      if (k === "limit") { limite = " limit " + Number(v); continue; }
      if (v.startsWith("eq.")) filtros.push(`"${k}"::text = ${lit(decodeURIComponent(v.slice(3)))}`);
    }
    return JSON.parse(psql(`select coalesce(json_agg(t), '[]')::text from (select * from public.${tabla}${filtros.length ? " where " + filtros.join(" and ") : ""}${orden}${limite}) t;`, { yo: "u1" }));
  };
  base.escribir = (metodo, tabla, params, cuerpo, yo) => {
    const r = escribir0(metodo, tabla, params, cuerpo, yo);
    if (tabla === "ordenes_compra_v2") for (const o of base.db.ordenes_compra_v2) espejoOC(o);
    return r;
  };
  return base;
}
const contactos = (where = "true") => JSON.parse(psql(`select coalesce(json_agg(c order by correo), '[]')::text from public.contactos_institucionales c where ${where};`));
const ocLocal = (id) => psql(`select contacto || '|' || correo_cliente from public.ordenes_compra_v2 where id = '${id}'`);

async function abrirOC(p, numero) {
  await p.locator('aside [data-nav="compras"], [data-nav="compras"]').first().click(); await espera(p, 900);
  await p.locator(`[data-oc="${numero}"] > div`).first().click(); await espera(p, 1400);
}
const cerrarFicha = async (p) => { await p.keyboard.press("Escape"); await espera(p, 500); };
const bloque = (p) => p.locator("[data-contactos-oc]").last();

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });

// ═════ A. PC ═════
{
  const b = conectar(crearBase(datos, { mp }));
  const ocHistOC1 = ocLocal("oc1");
  const { page: p, errs } = await abrir(browser, b, { url: URL_APP, ancho: 1440, alto: 900, movil: false, espera: 2600, usuario: "u2", prompt: "Correo rebota" });
  ok("A00_carga_inicial_ana_y_bruno", contactos(`rut_clave = '991112227' and estado = 'vigente'`).length === 2);
  await abrirOC(p, "2001-101-SE26");
  const t1 = await bloque(p).innerText().catch(() => "");
  ok("A01_ficha_muestra_contactos_de_la_institucion", /Contactos de la institución/i.test(t1) && /ana\.perez@muni-alfa\.cl/.test(t1) && /Bruno Soto/.test(t1), t1.slice(0, 300));
  ok("A02_contacto_historico_de_la_oc_tal_cual", /En esta OC vino: Ana Pérez · \+56 9 1111 1111 · Ana\.Perez@muni-alfa\.cl/.test(t1));
  ok("A03_tarjeta_identifica_correo_telefono_y_origen", await bloque(p).locator('[data-contacto="ana.perez@muni-alfa.cl"]').count() === 1
    && /\+56 9 1111 1111/.test(await bloque(p).locator('[data-contacto="ana.perez@muni-alfa.cl"]').innerText()) && /Carga inicial/.test(t1));
  // 4/5: añadir un contacto de la institución y otro exclusivo de esta OC
  await bloque(p).locator("[data-agregar-contacto]").click(); await espera(p, 300);
  const f = bloque(p).locator("[data-form-contacto]");
  await f.locator('[data-campo-contacto="nombre"]').fill("Diego Mora"); await f.locator('[data-campo-contacto="cargo"]').fill("Jefe de Bodega");
  await f.locator('[data-campo-contacto="departamento"]').fill("Bodega"); await f.locator('[data-campo-contacto="correo"]').fill("Diego.Mora@muni-alfa.cl");
  await f.locator('[data-campo-contacto="telefono"]').fill("22 444 5555");
  await f.locator("[data-guardar-contacto]").click(); await espera(p, 1200);
  ok("A04_contacto_nuevo_guardado_en_supabase_confirmado", contactos(`correo_clave = 'diego.mora@muni-alfa.cl' and confirmado_manual and origen = 'manual' and departamento = 'Bodega'`).length === 1);
  await bloque(p).locator("[data-agregar-contacto]").click(); await espera(p, 300);
  const f2 = bloque(p).locator("[data-form-contacto]");
  await f2.locator('[data-campo-contacto="nombre"]').fill("Elena Ríos"); await f2.locator('[data-campo-contacto="correo"]').fill("elena@muni-alfa.cl");
  await f2.locator("[data-solo-oc]").check(); await f2.locator("[data-guardar-contacto]").click(); await espera(p, 1200);
  ok("A05_contacto_exclusivo_de_la_oc", contactos(`correo_clave = 'elena@muni-alfa.cl' and alcance = 'oc' and oc_exclusiva = 'oc1'`).length === 1
    && /Solo esta OC/.test(await bloque(p).locator('[data-contacto="elena@muni-alfa.cl"]').innerText()));
  // 7: duplicado (mayúsculas) → mensaje claro y nada nuevo
  const n0 = contactos(`rut_clave = '991112227'`).length;
  await bloque(p).locator("[data-agregar-contacto]").click(); await espera(p, 300);
  const f3 = bloque(p).locator("[data-form-contacto]");
  await f3.locator('[data-campo-contacto="nombre"]').fill("Bruno S."); await f3.locator('[data-campo-contacto="correo"]').fill("BRUNO@MUNI-ALFA.CL");
  await f3.locator("[data-guardar-contacto]").click(); await espera(p, 1000);
  ok("A06_correo_duplicado_rechazado_con_mensaje", /ya está registrado para esta institución/.test(await f3.innerText()) && contactos(`rut_clave = '991112227'`).length === n0);
  await f3.getByRole("button", { name: "Cancelar" }).click(); await espera(p, 300);
  // 10 (regla): corregir el correo de Bruno desde la ficha → el anterior queda obsoleto con historial
  await bloque(p).locator('[data-contacto="bruno@muni-alfa.cl"] [data-editar-contacto]').click(); await espera(p, 300);
  const f4 = bloque(p).locator("[data-form-contacto]");
  await f4.locator('[data-campo-contacto="correo"]').fill("bruno.soto@muni-alfa.cl"); await f4.locator("[data-guardar-contacto]").click(); await espera(p, 1300);
  ok("A07a_usuario_propone_y_el_contacto_no_cambia", contactos(`correo_clave = 'bruno@muni-alfa.cl' and estado = 'vigente' and propuesta->>'correo' = 'bruno.soto@muni-alfa.cl'`).length === 1
    && contactos(`correo_clave = 'bruno.soto@muni-alfa.cl'`).length === 0);
  ok("A07b_ficha_muestra_propuesta_pendiente", /Pendiente de aprobación del administrador/.test(await bloque(p).locator('[data-contacto="bruno@muni-alfa.cl"] [data-propuesta]').innerText().catch(() => "")));
  ok("A07c_usuario_sin_acciones_de_administrador", await p.locator('[data-resolver="reemplaza"], [data-resolver="descartar"], [data-marcar-obsoleto], [data-fusionar], [data-hacer-principal], [data-aprobar-propuesta], [data-es-principal]').count() === 0);
  ok("A10_oc_historica_no_modificada", ocLocal("oc1") === ocHistOC1 && ocLocal("oc3") === "Bruno Soto · 22 333 4444|bruno@muni-alfa.cl");
  {
    const A = await abrir(browser, b, { url: URL_APP, ancho: 1440, alto: 900, movil: false, espera: 2600, usuario: "u1" });
    await abrirOC(A.page, "2001-101-SE26");
    await A.page.waitForFunction(() => !document.querySelector('[data-solo-lectura="1"] [data-contactos-oc]'), null, { timeout: 15000 }).catch(() => {});
    await bloque(A.page).locator('[data-contacto="bruno@muni-alfa.cl"] [data-aprobar-propuesta]').click(); await espera(A.page, 1300);
    ok("A07d_admin_aprueba_anterior_obsoleto", contactos(`correo_clave = 'bruno.soto@muni-alfa.cl' and estado = 'vigente' and confirmado_manual`).length === 1
      && contactos(`correo_clave = 'bruno@muni-alfa.cl' and estado = 'obsoleto'`).length === 1);
    await bloque(A.page).locator("[data-ver-obsoletos]").click(); await espera(A.page, 300);
    ok("A08_correos_anteriores_visibles", await bloque(A.page).locator('[data-contacto="bruno@muni-alfa.cl"][data-estado="obsoleto"]').count() === 1);
    await bloque(A.page).locator('[data-contacto="bruno.soto@muni-alfa.cl"] [data-ver-historial]').click(); await espera(A.page, 1000);
    const h = await bloque(A.page).locator('[data-contacto="bruno.soto@muni-alfa.cl"] [data-historial-contacto]').innerText().catch(() => "");
    ok("A09_historial_propuesta_aprobacion_y_correo_anterior", /propuesta usuario/.test(h) && /correccion manual/.test(h) && /correo: bruno@muni-alfa\.cl → bruno\.soto@muni-alfa\.cl/.test(h), h);
    ok("A09b_errores_js_admin", A.errs.length === 0, A.errs);
    await A.ctx.close();
  }
  await p.reload({ waitUntil: "load" }); await espera(p, 2500);
  // 3: otra OC de la misma institución (sin correo propio) reutiliza los contactos; el exclusivo de oc1 no aparece
  await abrirOC(p, "2002-102-SE26");
  const t2 = await bloque(p).innerText().catch(() => "");
  ok("A11_otra_oc_misma_institucion_reutiliza", /diego\.mora@muni-alfa\.cl/.test(t2) && /bruno\.soto@muni-alfa\.cl/.test(t2) && !/elena@muni-alfa\.cl/.test(t2), t2.slice(0, 300));
  await p.locator("[data-indice-ficha] button", { hasText: "Cobranza" }).first().click(); await espera(p, 450);
  await p.getByRole("button", { name: /Reclamar pago de factura/ }).first().click(); await espera(p, 600);
  const modal = p.locator('[role="dialog"]').last();
  const correoReclamo = await modal.locator('input[type="email"]').first().inputValue();
  ok("A12_correo_sugerido_confirmado_sin_reescribir", /@muni-alfa\.cl$/.test(correoReclamo) && await modal.locator("[data-elegir-contacto] [data-usar-contacto]").count() >= 2, correoReclamo);
  await modal.locator('[data-usar-contacto="diego.mora@muni-alfa.cl"]').click(); await espera(p, 200);
  ok("A13_reutilizar_contacto_guardado_en_un_clic", (await modal.locator('input[type="email"]').first().inputValue()) === "diego.mora@muni-alfa.cl");
  await p.keyboard.press("Escape"); await espera(p, 400); await cerrarFicha(p);
  // 8: institución con nombre parecido y RUT distinto: solo sus contactos
  await abrirOC(p, "2004-104-SE26");
  const t4 = await bloque(p).innerText().catch(() => "");
  ok("A14_rut_distinto_no_mezcla", /carla@alfa-b\.cl/.test(t4) && !/muni-alfa\.cl/.test(t4), t4.slice(0, 200));
  await cerrarFicha(p);
  ok("A15_errores_js", errs.length === 0, errs);
}

// ═════ B. Sincronización con Mercado Público: correo nuevo de la misma persona → aviso y pendiente; resolver ═════
{
  const b = conectar(crearBase(datos, { mp }));
  const { page: p, errs } = await abrir(browser, b, { url: URL_APP, ancho: 1440, alto: 900, movil: false, espera: 4500, usuario: "u1" });
  await espera(p, 2500);
  ok("B00_otra_sesion_recupera_lo_guardado_en_A", contactos(`correo_clave = 'diego.mora@muni-alfa.cl'`).length === 1);
  const pend = contactos(`correo_clave = 'ana.perez@alfa.gob.cl'`);
  ok("B01_sincronizacion_detecta_cambio_de_correo", pend.length === 1 && pend[0].estado === "pendiente" && pend[0].motivo_pendiente === "cambio_correo" && pend[0].cargo === "Encargada de compras", pend);
  ok("B02_sin_perdida_el_anterior_sigue_vigente", contactos(`correo_clave = 'ana.perez@muni-alfa.cl' and estado = 'vigente'`).length === 1);
  ok("B03_oc_sincronizada_vinculada", JSON.parse(psql(`select count(*) from public.contactos_institucionales_oc where oc_id = 'oc9'`)) === 1);
  // resincronizar varias veces: sin duplicados
  for (let i = 0; i < 3; i++) psql(`select public.conciliar_contactos_oc('oc9','mp')`, { yo: "u2" });
  ok("B04_resincronizar_no_duplica", contactos(`rut_clave = '991112227' and correo_clave like 'ana.perez@%'`).length === 2);
  await abrirOC(p, "2009-109-SE26");
  const tarjeta = bloque(p).locator('[data-contacto="ana.perez@alfa.gob.cl"]');
  ok("B05_pendiente_visible_con_motivo_y_correo_actual", /Pendiente de verificación/.test(await tarjeta.innerText()) && /hoy se usa ana\.perez@muni-alfa\.cl/.test(await tarjeta.innerText()));
  ok("B06_aviso_de_pendientes_en_la_ficha", await bloque(p).locator("[data-aviso-pendientes]").count() === 1);
  await tarjeta.locator('[data-resolver="reemplaza"]').click(); await espera(p, 1300);
  ok("B07_reemplazo_confirmado_y_anterior_obsoleto", contactos(`correo_clave = 'ana.perez@alfa.gob.cl' and estado = 'vigente' and confirmado_manual`).length === 1
    && contactos(`correo_clave = 'ana.perez@muni-alfa.cl' and estado = 'obsoleto'`).length === 1);
  await cerrarFicha(p);
  // la OC antigua (oc1) trae el correo que quedó obsoleto: aviso y se sugiere el vigente
  await abrirOC(p, "2001-101-SE26");
  ok("B08_oc_antigua_avisa_correo_obsoleto_y_sugiere_vigente", await bloque(p).locator("[data-aviso-correo-obsoleto]").count() === 1
    && !/ana\.perez@muni-alfa\.cl/.test(await bloque(p).locator("[data-correo-sugerido]").getAttribute("data-correo-sugerido")));
  ok("B09_oc_antigua_conserva_su_contacto_historico", ocLocal("oc1") === "Ana Pérez · +56 9 1111 1111|Ana.Perez@muni-alfa.cl");
  await cerrarFicha(p);
  // 9: una OC nueva contradice un correo CONFIRMADO → aviso de conflicto (la conciliación no lo sobrescribe)
  b.db.ordenes_compra_v2.push({ ...b.db.ordenes_compra_v2.find((o) => o.id === "oc2"), id: "oc12", numero_oc: "2012-112-SE26", contacto: "Ana Pérez", correo_cliente: "ana@otro-alfa.cl", fecha_hora_emision_mp: hace(1) });
  espejoOC(b.db.ordenes_compra_v2.at(-1));
  const r = JSON.parse(psql(`select public.conciliar_contactos_oc('oc12','mp')::text`, { yo: "u2" }));
  ok("B10_conflicto_con_manual_avisa_y_no_sobrescribe", r.resultados[0].accion === "conflicto_manual" && contactos(`correo_clave = 'ana.perez@alfa.gob.cl' and estado = 'vigente'`).length === 1, r);
  ok("B11_errores_js", errs.length === 0, errs);
}

// ═════ C. Celular (390 px): ficha y catálogo sin desbordar ═════
{
  const b = conectar(crearBase(datos, { mp }));
  const { page: p, errs } = await abrir(browser, b, { url: URL_APP, ancho: 390, alto: 844, movil: true, espera: 3000, usuario: "u2" });
  await abrirOC(p, "2001-101-SE26");
  ok("C00_celular_aviso_en_seccion_cerrada", /contacto(s)? por verificar|99\.111\.222-7/.test(await p.locator('[data-seccion-ficha^="info-"]').first().innerText()));
  await p.locator("[data-indice-ficha] button", { hasText: "Información OC" }).first().click(); await espera(p, 600);
  await bloque(p).scrollIntoViewIfNeeded().catch(() => {});
  const vis = await bloque(p).isVisible().catch(() => false);
  const desborde = await p.evaluate(() => { const e = document.querySelector("[data-contactos-oc]"); if (!e) return 999; let m = 0; for (const n of e.querySelectorAll("*")) { const r = n.getBoundingClientRect(); if (r.right > window.innerWidth + 1) m = Math.max(m, r.right - window.innerWidth); } return m; });
  ok("C01_celular_contactos_visibles_sin_desbordar", vis && desborde === 0, { vis, desborde });
  const btn = await bloque(p).locator("[data-agregar-contacto]").boundingBox();
  ok("C02_botones_tactiles", btn && btn.height >= 32, btn);
  await bloque(p).locator("[data-agregar-contacto]").click(); await espera(p, 300);
  const anchoForm = await p.evaluate(() => { const f = document.querySelector("[data-form-contacto]"); return f ? f.getBoundingClientRect().right <= window.innerWidth + 1 : false; });
  ok("C03_formulario_cabe_en_celular", anchoForm);
  ok("C04_errores_js", errs.length === 0, errs);
}

// ═════ D. Catálogo (Administración, admin) ═════
{
  const b = conectar(crearBase(datos, { mp }));
  const { page: p, errs } = await abrir(browser, b, { url: URL_APP, ancho: 1440, alto: 900, movil: false, espera: 3000, usuario: "u1" });
  await p.locator('aside [data-nav="usuarios"], [data-nav="usuarios"]').first().click(); await espera(p, 900);
  const tabDatos = p.getByRole("tab", { name: /Datos|Respaldo/ }).first();
  if (await tabDatos.count()) { await tabDatos.click(); await espera(p, 500); }
  const cat = p.locator("[data-contactos-catalogo]");
  ok("D01_catalogo_de_contactos_visible", await cat.count() === 1, await p.locator("body").innerText().then((t) => t.slice(0, 200)));
  await cat.locator("[data-buscar-institucion]").fill("99.111.222-7"); await espera(p, 400);
  await cat.getByRole("button", { name: /99\.111\.222-7/ }).first().click().catch(() => {}); await espera(p, 600);
  ok("D02_catalogo_muestra_contactos_de_la_institucion", await cat.locator('[data-contactos-institucion="991112227"] [data-contacto]').count() >= 3);
  const tarjetaAna = cat.locator('[data-contacto="ana.perez@alfa.gob.cl"]');
  await tarjetaAna.locator("[data-fusionar]").click(); await espera(p, 300);
  const opt = await tarjetaAna.locator("[data-absorber] option").evaluateAll((os) => os.find((o) => /ana@otro-alfa\.cl/.test(o.textContent))?.value || "");
  await tarjetaAna.locator("[data-absorber]").selectOption(opt); await tarjetaAna.locator("[data-confirmar-fusion]").click(); await espera(p, 1300);
  ok("D03_admin_fusiona_absorbido_obsoleto_sin_borrar", contactos(`correo_clave = 'ana@otro-alfa.cl' and estado = 'obsoleto' and reemplazado_por is not null`).length === 1
    && JSON.parse(psql(`select count(*) from public.contactos_institucionales_oc v join public.contactos_institucionales c on c.id = v.contacto_id where c.correo_clave = 'ana.perez@alfa.gob.cl' and v.oc_id = 'oc12'`)) === 1);
  ok("D04_errores_js", errs.length === 0, errs);
}

await browser.close();
psql(`drop database if exists ${DBN}`, { db: "postgres" });
console.log(`RESUMEN e2e contactos institucionales: ${nOk} OK, ${F.length} FALLA(S)`);
process.exit(F.length ? 1 : 0);
