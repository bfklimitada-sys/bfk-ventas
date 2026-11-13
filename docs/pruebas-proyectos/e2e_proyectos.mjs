// Proyectos Industriales — pruebas de punta a punta con navegador real, en PC (1440×900) y celular (390×844),
// con 5 usuarios (administrador, jefa de proyecto, ingeniero, visitante y un usuario ajeno) contra la base desechable
// REAL (PostgREST 12 + migración + datos ficticios de semilla.sql). Ver arnes_pi.mjs.
// Uso: eval "$(bash docs/pruebas-proyectos/entorno.sh)"; PGRST_SIN_MODULO=… node docs/pruebas-proyectos/e2e_proyectos.mjs http://127.0.0.1:4178/
import { chromium, CHROME, U, abrir, irAProyectos, sinDesborde, psql, marca, desde, archivos, crearMP, calma } from "./arnes_pi.mjs";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const URL_APP = process.argv[2] || "http://127.0.0.1:4178/";
// Configuración regional UTF-8 (como cualquier equipo real): sin ella Chrome cambia los nombres de descarga con tildes por «download».
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"], env: { ...process.env, LANG: "C.UTF-8", LC_ALL: "C.UTF-8" } });
const F = []; let nOk = 0;
const ok = (k, v, d) => { if (!v) { F.push(k); console.log("FALLA " + k + (d !== undefined ? " :: " + JSON.stringify(d).slice(0, 500) : "")); } else { nOk++; console.log("OK    " + k); } };
const escenario = async (n, fn) => { try { await fn(); } catch (e) { ok(n + "_sin_excepcion", false, String(e.message).split("\n")[0]); } };
const ESC = { ancho: 1440, alto: 900 }, CEL = { ancho: 390, alto: 844, movil: true };
const cod = (nombre) => psql(`select codigo from public.pi_proyectos where nombre = '${nombre}'`);
const A = cod("Ingeniería de control planta concentradora"), B = cod("Montaje eléctrico subestación caldera"), C = cod("Suministro tableros CCM"), D = cod("Mantención mayor molino SAG");
const txt = async (loc) => ((await loc.count()) ? (await loc.first().innerText()).replace(/\s+/g, " ").trim() : "");
const ficha = (p, c) => p.locator(`[data-ficha-proyecto="${c}"]`);
async function abrirFicha(p, c) { await p.locator(`[data-proyecto="${c}"]`).click(); await ficha(p, c).waitFor(); await p.waitForTimeout(500); }
async function pest(p, k) { await p.locator(`[data-pestanas="Ficha del proyecto"] [data-tab="${k}"]`).click(); await p.waitForTimeout(900); }
async function confirmarMotivo(p, motivo) { if (motivo !== undefined) await p.locator("[data-motivo]").fill(motivo); await p.locator("[data-confirmar-motivo]").click(); await p.waitForTimeout(1200); }
const huellaMP = () => psql(`select md5(string_agg(t || ':' || n, ',' order by t)) from (
  select 'oc' t, count(*)::text || md5(coalesce(string_agg(x::text, ',' order by x.id), '')) n from public.ordenes_compra_v2 x union all
  select 'perfiles', count(*)::text || md5(coalesce(string_agg(x::text, ',' order by x.id), '')) from public.perfiles x union all
  select 'storage_cz', count(*)::text from storage.objects where bucket_id <> 'pi-documentos') z`);
const HMP0 = huellaMP();
const inicio = marca();
// Escrituras fuera de las tablas pi_* hechas MIENTRAS se trabaja en el módulo (tras la carga inicial de la app).
const fueraPI = []; let tramos = 0;
async function enModulo(fn) { await calma(); const m = marca(); await fn(); fueraPI.push(...desde(m, (x) => x.destino === "mp" && x.m !== "GET")); tramos++; }
console.log(`INFO  proyectos: A=${A} B=${B} C=${C} D=${D}`);

// ── 1. Administrador · PC: navegación, indicadores, propuestas, filtros ────────────────────────
await escenario("E01", async () => {
  const r = await abrir(browser, { usuario: U.admin, url: URL_APP, ...ESC }); const p = r.page;
  ok("P01_pc_grupo_propio_en_la_barra_lateral", (await txt(p.locator("aside"))).includes("PROYECTOS INDUSTRIALES") || (await txt(p.locator("aside"))).toLowerCase().includes("proyectos industriales"));
  const m0 = marca();
  await irAProyectos(p, false);
  const kv = async (k) => txt(p.locator(`[data-kpi-pi="${k}"] [data-kpi-valor]`));
  ok("P02_indicadores_activos_atraso_finalizados", [await kv("activos"), await kv("atraso"), await kv("finalizados")].join("|") === "2|1|1", [await kv("activos"), await kv("atraso"), await kv("finalizados")]);
  ok("P03_presupuesto_activos_por_moneda_sin_sumar", (await kv("presupuesto")) === "$48.500.000" && (await txt(p.locator('[data-kpi-pi="presupuesto"]'))).includes("UF 1.250,75"), await txt(p.locator('[data-kpi-pi="presupuesto"]')));
  ok("P04_aviso_propuestas_para_el_administrador", (await txt(p.locator('[data-aviso-linea="propuestas"]'))).includes("1 propuesta esperando tu autorización"));
  // 12/11/2026: la configuración de la carga de documentos ya no ocupa la lista; está en la sección Documentos de cada ficha (P64a).
  ok("P05_lista_sin_configuracion_de_documentos", (await p.locator("[data-config-documentos]").count()) === 0);
  ok("P06_listado_con_atrasado_primero", (await p.locator("[data-proyecto]").first().getAttribute("data-proyecto")) === B && (await p.locator("[data-proyecto]").count()) === 4);
  await p.locator('[data-pestanas="Filtro de proyectos"] [data-tab="atraso"]').click(); await p.waitForTimeout(300);
  ok("P07_filtro_con_atraso", (await p.locator("[data-proyecto]").count()) === 1 && (await p.locator(`[data-proyecto="${B}"]`).count()) === 1);
  await p.locator('[data-pestanas="Filtro de proyectos"] [data-tab="todos"]').click();
  await p.locator("[data-buscar-proyectos]").fill("concentradora"); await p.waitForTimeout(300);
  ok("P08_busqueda_por_nombre", (await p.locator("[data-proyecto]").count()) === 1 && (await p.locator(`[data-proyecto="${A}"]`).count()) === 1);
  await p.locator("[data-buscar-proyectos]").fill(""); await p.locator("[data-filtro-estado]").selectOption("finalizado"); await p.waitForTimeout(300);
  ok("P09_filtro_por_estado", (await p.locator("[data-proyecto]").count()) === 1 && (await p.locator(`[data-proyecto="${C}"]`).count()) === 1);
  ok("P10_el_modulo_no_consulta_mercado_publico", desde(m0, (x) => x.destino === "mp").length === 0, desde(m0, (x) => x.destino === "mp").slice(0, 5));
  ok("P11_sin_errores", r.errs.length === 0, r.errs); await r.ctx.close();
});

// ── 2. Jefa · PC: solo sus proyectos; propuesta; ficha con economía; acciones según estado ─────
await escenario("E02", async () => {
  const r = await abrir(browser, { usuario: U.jefa, url: URL_APP, ...ESC }); const p = r.page;
  await irAProyectos(p, false);
  const vis = await p.locator("[data-proyecto]").evaluateAll((xs) => xs.map((x) => x.getAttribute("data-proyecto")).sort());
  ok("P12_jefa_ve_solo_sus_proyectos", JSON.stringify(vis) === JSON.stringify([A, D].sort()), vis);
  ok("P13_aviso_propuesta_espera_administrador", (await txt(p.locator('[data-aviso-linea="propuestas"]'))).includes("esperando la autorización de un administrador"));
  ok("P14_sin_configuracion_de_documentos_para_no_admin", (await p.locator("[data-config-documentos]").count()) === 0);
  await abrirFicha(p, A);
  ok("P15_rol_jefe_en_la_ficha", (await p.locator('[data-mi-rol="jefe"]').count()) === 1);
  ok("P16_presupuesto_visible_para_responsable", (await txt(p.locator('[data-kpi="presupuesto"] [data-kpi-valor]'))) === "$48.500.000");
  const acc = await p.locator("[data-accion-estado]").evaluateAll((xs) => xs.map((x) => x.getAttribute("data-accion-estado")));
  ok("P17_acciones_jefe_en_ejecucion", JSON.stringify(acc) === JSON.stringify(["finalizado", "suspendido", "anulado"]) && (await p.locator('[data-accion="editar"]').count()) === 1, acc);
  ok("P18_presupuesto_no_editable_tras_iniciar", (await p.locator('[data-accion="editar-presupuesto"]').count()) === 0);
  await p.locator("[data-cerrar-hoja]").click(); await p.waitForTimeout(400); await abrirFicha(p, D);
  ok("P19_propuesta_sin_autorizar_para_no_admin", (await p.locator('[data-accion-estado="por_iniciar"]').count()) === 0 && (await p.locator('[data-aviso-linea="propuesta"]').count()) === 1 && (await p.locator('[data-accion="editar-presupuesto"]').count()) === 1);
  ok("P20_presupuesto_USD", (await txt(p.locator('[data-kpi="presupuesto"] [data-kpi-valor]'))) === "US$ 32.000");
  await r.ctx.close();
});

// ── 3. Usuario ajeno · PC: no ve proyectos ni por enlace directo ───────────────────────────────
await escenario("E03", async () => {
  const r = await abrir(browser, { usuario: U.ajeno, url: URL_APP, hash: `#/proyectos/${A}`, ...ESC }); const p = r.page;
  await p.locator("[data-panel-proyectos]").waitFor();
  ok("P21_ajeno_sin_proyectos", (await p.locator("[data-proyecto]").count()) === 0 && (await p.locator('[data-vacio="sin-proyectos"]').count()) === 1);
  ok("P22_enlace_directo_no_abre_proyecto_ajeno", (await ficha(p, A).count()) === 0);
  await r.ctx.close();
});

// ── 4. Ingeniero · celular: editor en A (economía reservada), jefe en B (atraso explicado) ─────
await escenario("E04", async () => {
  const r = await abrir(browser, { usuario: U.ing, url: URL_APP, ...CEL }); const p = r.page;
  await irAProyectos(p, true);
  ok("P23_celular_panel_sin_desborde", await sinDesborde(p));
  ok("P24_celular_tarjeta_economia_reservada", (await txt(p.locator(`[data-proyecto="${A}"] [data-presupuesto-tarjeta]`))) === "Datos económicos reservados");
  await abrirFicha(p, A);
  ok("P25_editor_sin_editar_datos_ni_estados", (await p.locator('[data-accion="editar"]').count()) === 0 && (await p.locator("[data-accion-estado]").count()) === 0);
  ok("P26_editor_presupuesto_reservado", (await txt(p.locator('[data-kpi="presupuesto-reservado"] [data-kpi-valor]'))) === "Reservados");
  await pest(p, "actividades");
  ok("P27_editor_puede_agregar_actividades", (await p.locator("[data-nueva-actividad]").count()) === 1 && (await p.locator("[data-eliminar-actividad]").count()) === 0);
  ok("P28_edt_numerada_y_subtarea", (await p.locator('[data-actividad="2.1"]').count()) === 1 && (await txt(p.locator('[data-actividad="2"]'))).includes("avance calculado de sus subtareas"));
  ok("P29_celular_ficha_sin_desborde", await sinDesborde(p));
  await p.locator("[data-cerrar-hoja]").click(); await p.waitForTimeout(400); await abrirFicha(p, B);
  const razones = await p.locator('[data-aviso-linea="razon-atraso"]').allInnerTexts();
  ok("P30_celular_ficha_explica_el_atraso", razones.length === 3 && razones.join(" ").includes("1 actividad con fin previsto vencido") && razones.join(" ").includes("23,3 % bajo el planificado 55,9 %"), razones);
  ok("P31_presupuesto_UF", (await txt(p.locator('[data-kpi="presupuesto"] [data-kpi-valor]'))) === "UF 1.250,75");
  await r.ctx.close();
});

// ── 5. Jefa · PC: editar datos (queda en el historial) ─────────────────────────────────────────
await escenario("E05", async () => {
  const r = await abrir(browser, { usuario: U.jefa, url: URL_APP, hash: `#/proyectos/${A}`, ...ESC }); const p = r.page;
  await enModulo(async () => {
  await ficha(p, A).waitFor();
  ok("P32_enlace_directo_abre_la_ficha", (await ficha(p, A).count()) === 1);
  await p.locator('[data-accion="editar"]').click(); await p.locator('[data-ventana="editar-proyecto"]').waitFor();
  await p.locator('[data-ventana="editar-proyecto"] [data-campo="ubicacion"]').fill("Planta concentradora, área flotación");
  await p.locator("[data-guardar-proyecto]").click(); await p.waitForTimeout(1500);
  ok("P33_datos_guardados", (await p.locator('[data-ventana="editar-proyecto"]').count()) === 0 && psql(`select ubicacion from public.pi_proyectos where codigo = '${A}'`) === "Planta concentradora, área flotación");
  await pest(p, "historial");
  const h = await txt(p.locator('[data-historial="pi_proyectos"]'));
  ok("P34_historial_quien_que_antes_despues", h.includes("Proyecto modificado") && h.includes("Jefa Proyecto Prueba") && h.includes("Ubicación: Planta concentradora, área molienda → Planta concentradora, área flotación"), h.slice(0, 300));
    });
  await r.ctx.close();
});

// ── 6. Edición simultánea: la segunda persona recibe el aviso y no pisa el cambio ──────────────
await escenario("E06", async () => {
  const a = await abrir(browser, { usuario: U.admin, url: URL_APP, hash: `#/proyectos/${A}`, ...ESC });
  const j = await abrir(browser, { usuario: U.jefa, url: URL_APP, hash: `#/proyectos/${A}`, ...ESC });
  for (const r of [a, j]) { await ficha(r.page, A).waitFor(); await r.page.locator('[data-accion="editar"]').click(); await r.page.locator('[data-ventana="editar-proyecto"]').waitFor(); }
  await a.page.locator('[data-campo="nombre"]').fill("Ingeniería de control planta concentradora (rev. admin)"); await a.page.locator("[data-guardar-proyecto]").click(); await a.page.waitForTimeout(1500);
  await j.page.locator('[data-campo="region"]').fill("Antofagasta"); await j.page.locator("[data-guardar-proyecto]").click(); await j.page.waitForTimeout(1500);
  ok("P35_conflicto_avisa_otra_persona_guardo", (await txt(j.page.locator("[data-error-form]"))).startsWith("Otra persona guardó"), await txt(j.page.locator("[data-error-form]")));
  ok("P36_conflicto_no_pisa_el_cambio", psql(`select nombre || '|' || coalesce(region, '') from public.pi_proyectos where codigo = '${A}'`) === "Ingeniería de control planta concentradora (rev. admin)|Coquimbo");
  psql(`update public.pi_proyectos set nombre = 'Ingeniería de control planta concentradora' where codigo = '${A}'`);
  await a.ctx.close(); await j.ctx.close();
});

// ── 7. Administrador · PC: nuevo proyecto con cliente nuevo, equipo y presupuesto; autoriza su activación ─
let E = null;
await escenario("E07", async () => {
  const r = await abrir(browser, { usuario: U.admin, url: URL_APP, ...ESC }); const p = r.page;
  await irAProyectos(p, false);
  await p.locator("[data-nuevo-proyecto]").click(); const v = p.locator('[data-ventana="nuevo-proyecto"]'); await v.waitFor();
  await v.locator("[data-guardar-proyecto]").click(); await p.waitForTimeout(300);
  ok("P37_validaciones_del_formulario", (await txt(v)).includes("Elige el cliente.") && (await txt(v)).includes("El nombre debe tener al menos 3 caracteres."));
  await v.locator('[data-nuevo-cliente="cliente"]').click();
  await v.locator('[data-cliente="rut"]').fill("76.123.456-1"); await v.locator('[data-cliente="razon_social"]').fill("Pesquera Austral Prueba S.A."); await v.locator('[data-cliente="rubro"]').selectOption("pesca");
  await v.locator("[data-guardar-cliente]").click(); await p.waitForTimeout(400);
  ok("P38_rut_invalido_rechazado", (await txt(v.locator("[data-form-cliente]"))).includes("Dígito verificador incorrecto"));
  await v.locator('[data-cliente="rut"]').fill("761234560"); await v.locator("[data-guardar-cliente]").click(); await p.waitForTimeout(1200);
  ok("P39_cliente_creado_rut_normalizado", psql("select rut from public.pi_clientes where razon_social = 'Pesquera Austral Prueba S.A.'") === "76.123.456-0" && (await v.locator("[data-form-cliente]").count()) === 0);
  await v.locator('[data-campo="nombre"]').fill("Automatización estación de bombeo EB-2");
  await v.locator('[data-campo="tipo"]').selectOption("ingenieria");
  await v.locator('[data-campo="responsable_id"]').selectOption(U.jefa);
  await v.locator('[data-especialidad="automatizacion"]').click(); await v.locator('[data-especialidad="electrica"]').click();
  await v.locator('[data-campo="ubicacion"]').fill("Estación de bombeo EB-2, tranque de relaves");
  await v.locator('[data-campo="fecha_inicio_prevista"]').fill(psql("select (public.pi_hoy())::text"));
  await v.locator('[data-campo="fecha_termino_prevista"]').fill(psql("select (public.pi_hoy() + 90)::text"));
  await v.locator('[data-campo="presupuesto"]').fill("25.000.000");
  await v.locator("[data-agregar-integrante]").selectOption(U.vis);
  await v.locator(`[data-integrante-form="${U.vis}"] select`).selectOption("lector");
  await v.locator("[data-guardar-proyecto]").click(); await p.waitForTimeout(2500);
  E = psql("select codigo from public.pi_proyectos where nombre = 'Automatización estación de bombeo EB-2'");
  ok("P40_proyecto_creado_con_codigo_PI", /^PI-\d{4}-\d{3}$/.test(E) && (await ficha(p, E).count()) === 1, E);
  const fila = psql(`select p.estado || '|' || e.presupuesto_inicial || '|' || e.moneda || '|' || array_to_string(p.especialidades, ',') from public.pi_proyectos p join public.pi_proyectos_economia e on e.proyecto_id = p.id where p.codigo = '${E}'`);
  ok("P41_nace_como_propuesta_con_presupuesto_neto", fila === "propuesta|25000000.00|CLP|automatizacion,electrica", fila);
  ok("P42_equipo_responsable_jefe_y_lector", psql(`select string_agg(rol_proyecto, ',' order by rol_proyecto) from public.pi_equipo e join public.pi_proyectos p on p.id = e.proyecto_id where p.codigo = '${E}'`) === "jefe,lector");
  await p.locator('[data-accion-estado="por_iniciar"]').click(); await confirmarMotivo(p);
  ok("P43_administrador_autoriza_activacion", psql(`select estado || '|' || (autorizado_por = '${U.admin}') from public.pi_proyectos where codigo = '${E}'`) === "por_iniciar|true"
    && (await txt(ficha(p, E))).includes("Activación autorizada"));
  ok("P44_direccion_con_codigo", await p.evaluate(() => location.hash) === `#/proyectos/${E}`);
  await r.ctx.close();
});

// ── 8. Ingeniero · celular: crea una propuesta propia (no puede autorizarla) ───────────────────
await escenario("E08", async () => {
  const r = await abrir(browser, { usuario: U.ing, url: URL_APP, ...CEL }); const p = r.page;
  await irAProyectos(p, true);
  await p.locator("[data-nuevo-proyecto]").click(); const v = p.locator('[data-ventana="nuevo-proyecto"]'); await v.waitFor();
  ok("P45_celular_formulario_sin_desborde", await sinDesborde(p));
  await v.locator('[data-campo="cliente_id"]').selectOption({ label: "Relaves del Norte Prueba SpA · 76.888.777-2" });
  await v.locator('[data-campo="nombre"]').fill("Puesta en marcha espesador"); await v.locator('[data-campo="tipo"]').selectOption("puesta_en_marcha");
  ok("P46_presupuesto_solo_si_es_responsable", (await v.locator('[data-campo="presupuesto"]').count()) === 1);
  await v.locator('[data-campo="responsable_id"]').selectOption(U.jefa); await p.waitForTimeout(200);
  ok("P47_otro_responsable_presupuesto_reservado", (await v.locator('[data-campo="presupuesto"]').count()) === 0 && (await v.locator("[data-presupuesto-reservado]").count()) === 1);
  await v.locator('[data-campo="responsable_id"]').selectOption(U.ing); await v.locator('[data-campo="presupuesto"]').fill("1.500,5"); await v.locator('[data-campo="moneda"]').selectOption("UF");
  await v.locator("[data-guardar-proyecto]").click(); await p.waitForTimeout(2500);
  const c = psql("select codigo from public.pi_proyectos where nombre = 'Puesta en marcha espesador'");
  ok("P48_propuesta_de_usuario_sin_autorizar", psql(`select p.estado || '|' || e.presupuesto_inicial || ' ' || e.moneda from public.pi_proyectos p join public.pi_proyectos_economia e on e.proyecto_id = p.id where p.codigo = '${c}'`) === "propuesta|1500.50 UF"
    && (await ficha(p, c).count()) === 1 && (await p.locator('[data-accion-estado="por_iniciar"]').count()) === 0);
  await r.ctx.close();
});

// ── 9. Jefa · PC: presupuesto antes de iniciar, inicio de ejecución, actividades y subtareas ───
await escenario("E09", async () => {
  const r = await abrir(browser, { usuario: U.jefa, url: URL_APP, hash: `#/proyectos/${E}`, ...ESC }); const p = r.page;
  await enModulo(async () => {
  await ficha(p, E).waitFor();
  await p.locator('[data-accion="editar-presupuesto"]').click(); await p.locator('[data-ventana="presupuesto"] [data-campo="presupuesto"]').fill("26.000.000");
  await p.locator("[data-guardar-presupuesto]").click(); await p.waitForTimeout(1500);
  ok("P49_responsable_corrige_presupuesto_por_iniciar", psql(`select e.presupuesto_inicial from public.pi_proyectos_economia e join public.pi_proyectos p on p.id = e.proyecto_id where p.codigo = '${E}'`) === "26000000.00");
  await p.locator('[data-accion-estado="en_ejecucion"]').click(); await p.waitForTimeout(1500);
  ok("P50_inicio_de_ejecucion_registra_inicio_real", psql(`select estado || '|' || (fecha_inicio_real = public.pi_hoy()) from public.pi_proyectos where codigo = '${E}'`) === "en_ejecucion|true");
  ok("P51_presupuesto_bloqueado_tras_iniciar", (await p.locator('[data-accion="editar-presupuesto"]').count()) === 0);
  await pest(p, "actividades");
  await p.locator("[data-nueva-actividad]").click(); let v = p.locator('[data-ventana="actividad"]'); await v.waitFor();
  await v.locator('[data-campo="nombre"]').fill("Ingeniería conceptual"); await v.locator('[data-campo="responsable_id"]').selectOption(U.jefa);
  await v.locator('[data-campo="fecha_inicio_prevista"]').fill(psql("select (public.pi_hoy())::text")); await v.locator('[data-campo="fecha_fin_prevista"]').fill(psql("select (public.pi_hoy() + 30)::text"));
  await v.locator('[data-campo="peso"]').fill("2"); await v.locator("[data-guardar-actividad]").click(); await p.waitForTimeout(1500);
  await p.locator('[data-subtarea="1"]').click(); v = p.locator('[data-ventana="actividad"]'); await v.waitFor();
  ok("P52_subtarea_no_hereda_datos_del_padre", (await v.locator('[data-campo="nombre"]').inputValue()) === "" && (await v.locator('[data-campo="responsable_id"]').inputValue()) === "" && (await v.locator('[data-campo="fecha_inicio_prevista"]').inputValue()) === "");
  await v.locator('[data-campo="nombre"]').fill("Planos P&ID"); await v.locator("[data-guardar-actividad]").click(); await p.waitForTimeout(1500);
  ok("P53_edt_con_subtarea", (await p.locator('[data-actividad="1.1"]').count()) === 1 && (await txt(p.locator('[data-actividad="1"]'))).includes("avance calculado de sus subtareas"));
  await p.locator('[data-actividad="1.1"] [data-avance-input]').fill("50"); await p.locator('[data-actividad="1.1"] [data-guardar-avance]').click(); await p.waitForTimeout(1800);
  ok("P54_avance_de_subtarea_sube_al_padre", (await p.locator('[data-actividad="1"] [data-avance]').getAttribute("data-avance-real")) === "50" && (await p.locator('[data-estado-actividad="en_curso"]').count()) >= 1);
  await pest(p, "resumen");
  ok("P55_avance_del_proyecto_desde_la_vista", (await p.locator('[data-avance="ficha"]').getAttribute("data-avance-real")) === "50");
  ok("P56_jefa_no_elimina", (await p.locator("[data-eliminar-actividad]").count()) === 0);
  await p.locator('[data-pestanas="Ficha del proyecto"] [data-tab="actividades"]').click(); await p.waitForTimeout(700);
  await p.locator('[data-editar-actividad="1.1"]').click(); v = p.locator('[data-ventana="actividad"]'); await v.waitFor();
  await v.locator('[data-campo="fecha_fin_real"]').fill(psql("select (public.pi_hoy() + 3)::text")); await v.locator("[data-guardar-actividad]").click(); await p.waitForTimeout(500);
  ok("P57_fecha_real_futura_rechazada", (await txt(v)).includes("No puede ser una fecha futura."));
    });
  await r.ctx.close();
});

// ── 10. Jefa · PC: hitos y entregables (código duplicado con su mensaje propio) ────────────────
await escenario("E10", async () => {
  const r = await abrir(browser, { usuario: U.jefa, url: URL_APP, hash: `#/proyectos/${A}`, ...ESC }); const p = r.page;
  await enModulo(async () => {
  await ficha(p, A).waitFor(); await pest(p, "entregables");
  await p.locator("[data-nuevo-hito]").click(); let v = p.locator('[data-ventana="hito"]'); await v.waitFor();
  await v.locator('[data-campo="nombre"]').fill("Entrega ingeniería básica"); await v.locator('[data-campo="tipo"]').selectOption("entrega");
  await v.locator('[data-campo="fecha_prevista"]').fill(psql("select (public.pi_hoy() - 2)::text")); await v.locator("[data-guardar-hito]").click(); await p.waitForTimeout(1500);
  ok("P58_hito_vencido_marcado", (await txt(p.locator('[data-hito="Entrega ingeniería básica"]'))).includes("Vencido"));
  await p.locator('[data-cumplir-hito="Entrega ingeniería básica"]').click(); await p.waitForTimeout(1500);
  ok("P59_hito_cumplido_con_fecha_real", psql("select estado || '|' || (fecha_real = public.pi_hoy()) from public.pi_hitos where nombre = 'Entrega ingeniería básica'") === "cumplido|true");
  await p.locator("[data-nuevo-entregable]").click(); v = p.locator('[data-ventana="entregable"]'); await v.waitFor();
  await v.locator('[data-campo="codigo"]').fill("epc-aut-001"); await v.locator('[data-campo="nombre"]').fill("Otra filosofía"); await v.locator("[data-guardar-entregable]").click(); await p.waitForTimeout(1200);
  ok("P60_codigo_duplicado_mensaje_propio_no_conflicto", (await txt(v.locator("[data-error-form]"))) === "Ya existe un entregable con ese código en el proyecto.", await txt(v.locator("[data-error-form]")));
  await v.locator('[data-campo="codigo"]').fill("EPC-AUT-002"); await v.locator('[data-campo="estado"]').selectOption("emitido"); await v.locator("[data-guardar-entregable]").click(); await p.waitForTimeout(1500);
  ok("P61_entregable_emitido_registra_fecha_entrega", psql("select estado || '|' || (fecha_entrega = public.pi_hoy()) from public.pi_entregables where codigo = 'EPC-AUT-002'") === "emitido|true");
    });
  await r.ctx.close();
});

// ── 11. Documentos: deshabilitados al instalar; el administrador habilita; versiones, descarga y anulación ─
const PDF1 = Buffer.from("%PDF-1.4\n% Filosofía de control, revisión A (prueba ficticia)\n");
const PDF2 = Buffer.from("%PDF-1.4\n% Filosofía de control, revisión B (prueba ficticia)\n");
const MEM = Buffer.from("Memoria de cálculo de prueba — contenido ficticio\n".repeat(20));
await escenario("E11", async () => {
  let r = await abrir(browser, { usuario: U.jefa, url: URL_APP, hash: `#/proyectos/${A}`, ...ESC }); let p = r.page;
  await ficha(p, A).waitFor(); await pest(p, "documentos");
  ok("P62_carga_deshabilitada_sin_boton_subir", (await p.locator('[data-aviso-linea="documentos-deshabilitados"]').count()) === 1 && (await p.locator("[data-subir-documento]").count()) === 0
    && (await p.locator("[data-config-documentos]").count()) === 0);   // la jefa ve el aviso, no el control de configuración
  await r.ctx.close();
  // La carga se configura desde la sección Documentos de un proyecto (aplica a todos), con explicación y acción.
  const a = await abrir(browser, { usuario: U.admin, url: URL_APP, hash: `#/proyectos/${A}`, ...ESC }); await ficha(a.page, A).waitFor(); await pest(a.page, "documentos");
  ok("P64a_configuracion_en_documentos_con_explicacion", (await a.page.locator('[data-config-documentos="deshabilitada"]').count()) === 1
    && /respaldo diario/.test(await txt(a.page.locator("[data-config-documentos]"))));
  await a.page.locator('[data-aviso-accion-boton="alternar-documentos"]').click(); await a.page.locator("[data-confirmar-motivo]").click(); await a.page.waitForTimeout(300);
  ok("P63_habilitar_exige_motivo", (await txt(a.page.locator('[data-ventana="motivo"]'))).includes("Indica el motivo"));
  await confirmarMotivo(a.page, "Respaldo diario de documentos activo y verificado (prueba)");
  ok("P64_administrador_habilita_la_carga", (await a.page.locator('[data-config-documentos="habilitada"]').count()) === 1 && psql("select valor::text from public.pi_configuracion") === "true");
  await a.ctx.close();
  r = await abrir(browser, { usuario: U.jefa, url: URL_APP, hash: `#/proyectos/${A}`, ...ESC }); p = r.page;
  await ficha(p, A).waitFor(); await pest(p, "documentos");
  await p.locator("[data-subir-documento]").click(); let v = p.locator('[data-ventana="subir-documento"]'); await v.waitFor();
  await v.locator('[data-campo="archivo"]').setInputFiles({ name: "Filosofía de control Rev A.pdf", mimeType: "application/pdf", buffer: PDF1 });
  await v.locator('[data-campo="categoria"]').selectOption("especificacion"); await v.locator("[data-confirmar-subida]").click(); await p.waitForTimeout(2000);
  ok("P65_documento_subido_v1", (await p.locator('[data-documento="Filosofía de control Rev A"] [data-estado-documento="vigente"]').count()) === 1);
  const sha1 = createHash("sha256").update(PDF1).digest("hex");
  ok("P66_huella_registrada_y_archivo_en_carpeta_del_proyecto", psql(`select sha256 || '|' || (split_part(ruta, '/', 1) = proyecto_id::text) from public.pi_documentos where titulo = 'Filosofía de control Rev A'`) === `${sha1}|true`);
  await p.locator('[data-nueva-version="Filosofía de control Rev A"]').click(); v = p.locator('[data-ventana="subir-documento"]'); await v.waitFor();
  await v.locator('[data-campo="archivo"]').setInputFiles({ name: "Filosofía de control Rev B.pdf", mimeType: "application/pdf", buffer: PDF2 }); await v.locator("[data-confirmar-subida]").click(); await p.waitForTimeout(2000);
  ok("P67_nueva_version_v2_y_anterior_reemplazada", (await txt(p.locator('[data-documento="Filosofía de control Rev A"][data-documento-version="2"]'))).includes("v2 vigente")
    && psql("select string_agg(numero_version || ':' || estado, ',' order by numero_version) from public.pi_documentos where titulo = 'Filosofía de control Rev A'") === "1:reemplazado,2:vigente");
  const [dl] = await Promise.all([p.waitForEvent("download"), p.locator('[data-descargar="Filosofía de control Rev A"][data-descargar-version="2"]').click()]);
  const contenido = readFileSync(await dl.path());
  ok("P68_descarga_verificada_con_nombre_con_tilde", dl.suggestedFilename() === "Filosofía de control Rev B.pdf" && contenido.equals(PDF2), dl.suggestedFilename());
  await p.locator("[data-subir-documento]").click(); v = p.locator('[data-ventana="subir-documento"]'); await v.waitFor();
  await v.locator('[data-campo="archivo"]').setInputFiles({ name: "memoria.txt", mimeType: "text/plain", buffer: MEM }); await v.locator('[data-campo="titulo"]').fill("Memoria de cálculo soportes");
  await v.locator("[data-confirmar-subida]").click(); await p.waitForTimeout(2000);
  await p.locator('[data-anular-documento="Filosofía de control Rev A"]').click(); await p.locator("[data-confirmar-motivo]").click(); await p.waitForTimeout(300);
  ok("P69_anular_documento_exige_motivo", (await p.locator('[data-ventana="motivo"]').count()) === 1);
  await confirmarMotivo(p, "Reemplazado por documento del cliente");
  ok("P70_documento_anulado_con_motivo_sin_borrar_archivo", psql("select estado || '|' || motivo_anulacion from public.pi_documentos where titulo = 'Filosofía de control Rev A' and numero_version = 2") === "anulado|Reemplazado por documento del cliente"
    && archivos.size >= 3);
  await r.ctx.close();
});

// ── 12. Visitante (lector) · celular: solo consulta y descarga ─────────────────────────────────
await escenario("E12", async () => {
  const r = await abrir(browser, { usuario: U.vis, url: URL_APP, ...CEL }); const p = r.page;
  await irAProyectos(p, true);
  const vis = await p.locator("[data-proyecto]").evaluateAll((xs) => xs.map((x) => x.getAttribute("data-proyecto")).sort());
  ok("P71_lector_ve_sus_proyectos", JSON.stringify(vis) === JSON.stringify([A, E].sort()), vis);
  await abrirFicha(p, A);
  ok("P72_lector_sin_acciones", (await p.locator('[data-accion="editar"], [data-accion-estado]').count()) === 0 && (await p.locator('[data-mi-rol="lector"]').count()) === 1);
  await pest(p, "actividades");
  ok("P73_lector_sin_editar_actividades", (await p.locator("[data-nueva-actividad], [data-editar-actividad], [data-avance-rapido]").count()) === 0);
  await pest(p, "documentos");
  ok("P74_lector_no_sube_ni_anula", (await p.locator("[data-subir-documento], [data-anular-documento], [data-nueva-version]").count()) === 0);
  const [dl] = await Promise.all([p.waitForEvent("download"), p.locator('[data-descargar="Memoria de cálculo soportes"]').click()]);
  ok("P75_lector_descarga_integro", readFileSync(await dl.path()).equals(MEM));
  ok("P76_celular_documentos_sin_desborde", await sinDesborde(p));
  await r.ctx.close();
});

// ── 13. Datos económicos: el responsable autoriza al ingeniero, que ahora los ve ───────────────
await escenario("E13", async () => {
  const j = await abrir(browser, { usuario: U.jefa, url: URL_APP, hash: `#/proyectos/${A}`, ...ESC });
  await ficha(j.page, A).waitFor(); await pest(j.page, "equipo");
  await j.page.locator('[data-economia="Ingeniero Prueba"]').click(); await j.page.waitForTimeout(1500);
  ok("P77_responsable_autoriza_datos_economicos", psql(`select ve_economia from public.pi_equipo e join public.pi_proyectos p on p.id = e.proyecto_id where p.codigo = '${A}' and e.usuario_id = '${U.ing}'`) === "t");
  await j.ctx.close();
  const r = await abrir(browser, { usuario: U.ing, url: URL_APP, hash: `#/proyectos/${A}`, ...CEL });
  await ficha(r.page, A).waitFor();
  ok("P78_ingeniero_autorizado_ve_presupuesto", (await txt(r.page.locator('[data-kpi="presupuesto"] [data-kpi-valor]'))) === "$48.500.000");
  await pest(r.page, "equipo");
  ok("P79_editor_no_gestiona_equipo", (await r.page.locator("[data-agregar-integrante], [data-cambiar-rol], [data-economia]").count()) === 0);
  await r.ctx.close();
});

// ── 14. Administrador: cierra un proyecto finalizado; luego queda en solo lectura para su jefe ─
await escenario("E14", async () => {
  const a = await abrir(browser, { usuario: U.admin, url: URL_APP, hash: `#/proyectos/${C}`, ...ESC });
  await ficha(a.page, C).waitFor();
  await a.page.locator('[data-accion-estado="cerrado"]').click(); await confirmarMotivo(a.page);
  ok("P80_administrador_cierra_proyecto", psql(`select estado from public.pi_proyectos where codigo = '${C}'`) === "cerrado");
  await a.ctx.close();
  const r = await abrir(browser, { usuario: U.ing, url: URL_APP, hash: `#/proyectos/${C}`, ...ESC });
  await ficha(r.page, C).waitFor();
  ok("P81_cerrado_solo_lectura_para_el_jefe", (await r.page.locator('[data-accion="editar"], [data-accion-estado]').count()) === 0);
  await pest(r.page, "actividades");
  ok("P82_cerrado_sin_editar_contenido", (await r.page.locator("[data-nueva-actividad], [data-editar-actividad]").count()) === 0);
  await r.ctx.close();
});

// ── 15. Administrador: rechaza una propuesta con motivo y la restaura ───────────────────────────
await escenario("E15", async () => {
  const r = await abrir(browser, { usuario: U.admin, url: URL_APP, hash: `#/proyectos/${D}`, ...ESC }); const p = r.page;
  await ficha(p, D).waitFor();
  await p.locator('[data-accion-estado="anulado"]').click(); await p.locator("[data-confirmar-motivo]").click(); await p.waitForTimeout(300);
  ok("P83_rechazo_exige_motivo", (await p.locator('[data-ventana="motivo"]').count()) === 1);
  await confirmarMotivo(p, "El cliente postergó la mantención");
  ok("P84_propuesta_rechazada_con_motivo", psql(`select estado || '|' || motivo_estado from public.pi_proyectos where codigo = '${D}'`) === "anulado|El cliente postergó la mantención"
    && (await txt(p.locator('[data-aviso-linea="motivo-estado"]'))).includes("El cliente postergó"));
  // Restaurar no exige motivo (pi_cambiar_estado lo limpia): se ejecuta directo, sin ventana.
  await p.locator('[data-accion-estado="propuesta"]').click(); await p.waitForTimeout(1200);
  ok("P85_administrador_restaura_como_propuesta", psql(`select estado || '|' || coalesce(motivo_estado, '-') from public.pi_proyectos where codigo = '${D}'`) === "propuesta|-"
    && (await p.locator('[data-ventana="motivo"]').count()) === 0 && (await p.locator('[data-aviso-linea="motivo-estado"]').count()) === 0);
  await r.ctx.close();
});

// ── 16. Enlace directo y navegación: abrir deja #/proyectos/CÓDIGO; recargar la mantiene; atrás y adelante ─────
await escenario("E16", async () => {
  const r = await abrir(browser, { usuario: U.admin, url: URL_APP, ...ESC }); const p = r.page;
  await irAProyectos(p, false); await abrirFicha(p, B);
  ok("P86_abrir_ficha_deja_la_direccion_del_proyecto", (await p.evaluate(() => location.hash)) === `#/proyectos/${B}`);
  await p.reload({ waitUntil: "load" }); await p.waitForTimeout(3500);
  ok("P87_recargar_mantiene_la_ficha", (await ficha(p, B).count()) === 1 && (await p.evaluate(() => location.hash)) === `#/proyectos/${B}`);
  await p.goBack(); await p.waitForTimeout(900);
  ok("P88_atras_cierra_la_ficha_y_queda_en_proyectos", (await ficha(p, B).count()) === 0 && (await p.evaluate(() => location.hash)) === "#/proyectos" && (await p.locator("[data-panel-proyectos]").count()) === 1);
  await p.goForward(); await p.waitForTimeout(900);
  ok("P89_adelante_vuelve_a_abrirla", (await ficha(p, B).count()) === 1);
  await r.ctx.close();
});

// ── 17. Historial completo de la ficha ─────────────────────────────────────────────────────────
await escenario("E17", async () => {
  const r = await abrir(browser, { usuario: U.jefa, url: URL_APP, hash: `#/proyectos/${A}`, ...ESC }); const p = r.page;
  await ficha(p, A).waitFor(); await pest(p, "historial");
  const h = await txt(p.locator("[data-ficha-proyecto]"));
  ok("P90_historial_documentos_y_versiones", h.includes("Documento creado: Filosofía de control Rev A (versión 2)") && h.includes("Estado: Vigente → Reemplazado por una versión nueva"), h.slice(0, 400));
  ok("P91_historial_estado_y_equipo", h.includes("Estado: Por iniciar → En ejecución") && h.includes("Ve datos económicos: No → Sí"));
  await r.ctx.close();
});

// ── 18. Mercado Público intacto ─────────────────────────────────────────────────────────────────
await escenario("E18", async () => {
  ok("P92_trabajando_en_el_modulo_no_se_escribe_fuera_de_pi", tramos >= 3 && fueraPI.length === 0, { tramos, fuera: fueraPI.slice(0, 5) });
  const otras = desde(inicio, (x) => x.destino === "pi" && !x.obj.startsWith("pi_") && !x.obj.startsWith("rpc/pi_") && x.obj !== "perfiles");
  ok("P93_solo_objetos_pi_perfiles_y_su_deposito", otras.length === 0, otras.slice(0, 5));
  ok("P94_huella_de_mercado_publico_identica", huellaMP() === HMP0);
  const r = await abrir(browser, { usuario: U.admin, url: URL_APP, ...ESC });
  await r.page.locator('aside [data-nav="compras"]').click(); await r.page.waitForTimeout(1200);
  ok("P95_compras_de_mercado_publico_sigue_funcionando", (await r.page.locator("[data-oc]").count()) > 0 && r.errs.length === 0, r.errs);
  await r.ctx.close();
});

// ── 19. Antes de instalar la migración: «aún no está activado» (PC y celular) ──────────────────
await escenario("E19", async () => {
  if (!process.env.PGRST_SIN_MODULO) { ok("P96_sin_modulo_requiere_PGRST_SIN_MODULO", false); return; }
  for (const [n, vista] of [["pc", ESC], ["cel", CEL]]) {
    const r = await abrir(browser, { usuario: U.admin, url: URL_APP, pgrst: process.env.PGRST_SIN_MODULO, mp: crearMP(), ...vista }); const p = r.page;
    await irAProyectos(p, !!vista.movil);
    ok(`P${n === "pc" ? 96 : 97}_${n}_sin_migracion_aun_no_activado_sin_acciones`, (await p.locator("[data-pi-no-instalado]").count()) === 1 && (await p.locator("[data-nuevo-proyecto]").count()) === 0 && r.errs.length === 0, r.errs);
    await r.ctx.close();
  }
});

await browser.close();
console.log(`\nRESUMEN e2e Proyectos Industriales: ${nOk} OK · ${F.length} FALLA`);
process.exit(F.length ? 1 : 0);
