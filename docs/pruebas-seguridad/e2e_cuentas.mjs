// Seguridad 23/10/2026 · Perfil BFK obligatorio: pruebas de interfaz (escritorio 1280×800 y celular 390×844).
// Reconstruye las pruebas de la rama perdida seguridad-perfil-bfk (4476ca3) sobre el contrato de la migración
// recuperada (bfk-respaldos, rama seguridad-mp-temporal, resultados/migracion.sql). Base simulada; nada sale a la red.
// Uso: node docs/pruebas-seguridad/e2e_cuentas.mjs http://127.0.0.1:4178/   (build servido con vite preview)
import { chromium, CHROME, crearBaseSegura, abrirSeguro, solicitudesDatos } from "./mock_seguridad.mjs";
import { crearDatos, RESPUESTAS_MP } from "../pruebas-oc/datos_oc.mjs";

const URL_APP = process.argv[2] || "http://127.0.0.1:4178/";
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const F = []; let nOk = 0;
const ok = (k, v, d) => { if (!v) { F.push(k); console.log("FALLA " + k + (d !== undefined ? " :: " + JSON.stringify(d).slice(0, 500) : "")); } else { nOk++; console.log("OK    " + k); } };
const NUM = "2001-101-SE26";
const ESC = { ancho: 1280, alto: 800, movil: false }, CEL = { ancho: 390, alto: 844, movil: true };
const CUENTAS = [
  { id: "n1", email: "nueva@prueba.cl", creada_en: "2026-10-23T10:00:00Z", confirmada: true, ultimo_ingreso: "2026-10-23T10:05:00Z" },
  { id: "r1", email: "respaldo-documental@bfk.cl", creada_en: "2026-10-22T10:00:00Z", confirmada: true, bfk_tipo: "respaldo_documental" },
];
const nueva = (o = {}) => crearBaseSegura(crearDatos(), { cuentas: CUENTAS, mp: RESPUESTAS_MP, ...o });
const pantalla = (p) => p.locator("[data-cuenta-por-autorizar]");
// Lecturas seguras: si el elemento no existe devuelven un valor vacío (la prueba falla, no se interrumpe).
const attr = async (loc, a) => ((await loc.count()) ? loc.first().getAttribute(a) : null);
const texto = async (loc) => ((await loc.count()) ? loc.first().innerText() : "");
const deshabilitado = async (loc) => ((await loc.count()) ? loc.first().isDisabled() : null);
const clic = async (loc) => { if (await loc.count()) await loc.first().click(); };
const llenar = async (loc, v) => { if (await loc.count()) await loc.first().fill(v); };
const confirmar = async (p) => { const c = p.locator("[data-autorizar-confirmacion] input"); if (await c.count()) await c.first().check(); };
// Cada escenario corre aislado: un error inesperado se registra como FALLA y se sigue con el siguiente.
const escenario = async (nombre, fn) => { try { await fn(); } catch (e) { ok(nombre + "_sin_excepcion", false, String(e.message).split("\n")[0]); } };
const sinDesborde = (p) => p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const appMontada = async (p) => (await p.locator("[data-nav]").count()) > 0;
const cerrar = async (r) => { await r.ctx.close(); };

// ── A. Cuenta sin perfil (migración instalada) ─────────────────────────────────────────────────────────
await escenario("E01", async () => { const b = nueva(); const r = await abrirSeguro(browser, b, { url: URL_APP, usuario: "n1", ...ESC }); const p = r.page;
  ok("A01_esc_pantalla_por_autorizar", (await attr(pantalla(p), "data-cuenta-por-autorizar")) === "sin_perfil");
  ok("A02_esc_muestra_correo_de_la_sesion", (await texto(p.locator("[data-correo-sesion]"))).includes("nueva@prueba.cl"));
  ok("A03_esc_ninguna_solicitud_de_datos", solicitudesDatos(b, "n1").length === 0, solicitudesDatos(b, "n1"));
  ok("A04_esc_no_intenta_crear_perfil", !b.log.some((l) => l.ruta === "perfiles" && l.m !== "GET"));
  ok("A05_esc_app_no_montada_y_sin_errores", !(await appMontada(p)) && r.errs.length === 0, r.errs);
  await cerrar(r); });
for (const [i, hash] of [["A06", "#/finanzas"], ["A07", "#/administracion"], ["A08", "#/compras"], ["A09", "#/banco"]]) await escenario(i, async () => {
  const b = nueva(); const r = await abrirSeguro(browser, b, { url: URL_APP, usuario: "n1", hash, ...(i === "A09" ? CEL : ESC) }); const p = r.page;
  ok(`${i}_${i === "A09" ? "cel" : "esc"}_direccion_${hash.slice(2)}_no_muestra_datos`, (await pantalla(p).count()) === 1 && !(await appMontada(p))
    && solicitudesDatos(b, "n1").length === 0 && !(await p.locator(`[data-oc="${NUM}"]`).count()), solicitudesDatos(b, "n1"));
  await cerrar(r);});

await escenario("E02", async () => { const b = nueva(); const r = await abrirSeguro(browser, b, { url: URL_APP, usuario: "n1", ...CEL }); const p = r.page;
  ok("A10_cel_pantalla_sin_desborde", (await pantalla(p).count()) === 1 && await sinDesborde(p));
  // Atrás/adelante del celular hacia otra dirección: sigue bloqueada.
  await p.evaluate(() => { history.pushState(null, "", "#/finanzas"); dispatchEvent(new PopStateEvent("popstate")); }); await p.waitForTimeout(600);
  ok("A11_cel_historial_no_abre_pantallas", (await pantalla(p).count()) === 1 && solicitudesDatos(b, "n1").length === 0);
  await clic(p.locator("[data-cerrar-sesion]")); await p.waitForTimeout(800);
  const ses = await p.evaluate(() => localStorage.getItem("bfk_supabase_session_v2"));
  ok("A12_cel_cerrar_sesion_vuelve_al_inicio", !ses && (await p.getByText("Iniciar sesión").count()) > 0, ses);
  await cerrar(r); });
await escenario("E03", async () => { const b = nueva(); const r = await abrirSeguro(browser, b, { url: URL_APP, usuario: "n1", ...ESC }); const p = r.page;
  b.autorizarDirecto("n1", "Cuenta Nueva", "usuario");   // un administrador la autoriza mientras espera
  await clic(p.locator("[data-comprobar-acceso]")); await p.waitForTimeout(2500);
  ok("A13_esc_comprobar_de_nuevo_entra_tras_autorizar", (await pantalla(p).count()) === 0 && await appMontada(p) && solicitudesDatos(b, "n1").length > 0);
  await cerrar(r); });
await escenario("E04", async () => { const b = nueva(); const r = await abrirSeguro(browser, b, { url: URL_APP, usuario: "r1", ...ESC }); const p = r.page;
  ok("A14_esc_cuenta_aislada_sin_acceso_ni_reintento", (await attr(pantalla(p), "data-cuenta-por-autorizar")) === "aislada"
    && (await p.locator("[data-comprobar-acceso]").count()) === 0 && solicitudesDatos(b, "r1").length === 0);
  await cerrar(r); });
await escenario("E05", async () => { const b = nueva({ fallaPerfil: true }); const r = await abrirSeguro(browser, b, { url: URL_APP, usuario: "u1", ...ESC }); const p = r.page;
  ok("A15_esc_error_al_comprobar_no_monta_app", (await attr(pantalla(p), "data-cuenta-por-autorizar")) === "error" && !(await appMontada(p))
    && solicitudesDatos(b, "u1").length === 0);
  await cerrar(r); });
await escenario("E06", async () => { const b = nueva(); const r = await abrirSeguro(browser, b, { url: URL_APP, usuario: null, signup: { id: "n9" }, ...CEL }); const p = r.page;
  await clic(p.getByRole("button", { name: "Crear cuenta" }).first()); await p.waitForTimeout(300);
  await llenar(p.getByPlaceholder("Tu nombre"), "Persona Nueva"); await llenar(p.getByPlaceholder("correo@ejemplo.com"), "persona@prueba.cl");
  await llenar(p.getByPlaceholder("••••••••"), "secreta123"); await clic(p.getByRole("button", { name: "Crear cuenta" }).last()); await p.waitForTimeout(2500);
  ok("A16_cel_registro_nuevo_queda_por_autorizar", (await attr(pantalla(p), "data-cuenta-por-autorizar")) === "sin_perfil"
    && !b.log.some((l) => l.ruta === "perfiles" && l.m !== "GET") && solicitudesDatos(b, "n9").length === 0 && !b.db.perfiles.some((x) => x.id === "n9"),
    b.log.filter((l) => l.yo === "n9"));
  await cerrar(r); });
await escenario("E07", async () => { const b = nueva(); const r = await abrirSeguro(browser, b, { url: URL_APP, usuario: null, ...ESC }); const p = r.page;
  await llenar(p.getByPlaceholder("correo@ejemplo.com"), "nueva@prueba.cl"); await llenar(p.getByPlaceholder("••••••••"), "x123456");
  await clic(p.getByRole("button", { name: "Ingresar" })); await p.waitForTimeout(2500);
  ok("A17_esc_inicio_de_sesion_sin_perfil_queda_bloqueado", (await pantalla(p).count()) === 1 && solicitudesDatos(b, "n1").length === 0);
  await cerrar(r); });

// ── B. Administrador: Administración → Usuarios ─────────────────────────────────────────────────────────
await escenario("E08", async () => { const b = nueva(); const r = await abrirSeguro(browser, b, { url: URL_APP, usuario: "u1", hash: "#/administracion", ...ESC }); const p = r.page;
  const sec = p.locator("[data-por-autorizar]");
  ok("B01_esc_seccion_cuentas_por_autorizar", (await attr(sec, "data-por-autorizar")) === "ok" && (await p.locator('[data-cuenta-pendiente="nueva@prueba.cl"]').count()) === 1);
  const ais = p.locator('[data-cuenta-pendiente="respaldo-documental@bfk.cl"]');
  ok("B02_esc_aislada_listada_sin_boton_autorizar", (await ais.count()) === 1 && (await ais.locator("[data-autorizar-abrir]").count()) === 0 && (await texto(ais)).includes("Aislada"));
  const fila = p.locator('[data-cuenta-pendiente="nueva@prueba.cl"]');
  await clic(fila.locator("[data-autorizar-abrir]")); await p.waitForTimeout(200);
  await llenar(p.locator("[data-autorizar-nombre]"), ""); const antes = b.log.filter((l) => l.ruta === "rpc/bfk_autorizar_cuenta").length;
  await clic(p.locator("[data-autorizar-confirmar]")); await p.waitForTimeout(300);
  ok("B03_esc_nombre_obligatorio_sin_llamar_a_la_base", (await p.locator("[data-autorizar-error]").count()) === 1 && b.log.filter((l) => l.ruta === "rpc/bfk_autorizar_cuenta").length === antes);
  await llenar(p.locator("[data-autorizar-nombre]"), "Cuenta Nueva");
  await clic(p.locator("[data-autorizar-confirmar]")); await p.waitForTimeout(300);
  ok("B03b_esc_sin_marcar_confirmacion_no_autoriza", (await p.locator("[data-autorizar-error]").count()) === 1 && !b.log.some((l) => l.ruta === "rpc/bfk_autorizar_cuenta"));
  await confirmar(p); await clic(p.locator("[data-autorizar-confirmar]")); await p.waitForTimeout(2000);
  const llamada = b.log.find((l) => l.ruta === "rpc/bfk_autorizar_cuenta");
  ok("B04_esc_autoriza_como_usuario_con_la_funcion", JSON.stringify(llamada?.cuerpo) === JSON.stringify({ p_id: "n1", p_nombre: "Cuenta Nueva", p_rol: "usuario" }), llamada);
  ok("B05_esc_desaparece_de_pendientes_y_aparece_en_usuarios", (await p.locator('[data-cuenta-pendiente="nueva@prueba.cl"]').count()) === 0
    && (await texto(p.locator("#adm-usuarios"))).includes("Cuenta Nueva"));
  ok("B06_esc_registro_de_autorizaciones", (await texto(p.locator("[data-registro-autorizaciones]"))).includes("Cuenta Nueva"));
  ok("B07_esc_unico_admin_no_puede_quitarse", (await deshabilitado(p.locator('[data-cambiar-rol="u1"]'))) === true);
  ok("B08_esc_sin_errores_y_lista_por_lectura_get", r.errs.length === 0 && b.log.filter((l) => l.ruta === "rpc/bfk_cuentas_por_autorizar").every((l) => l.m === "GET"), r.errs);
  await cerrar(r); });
await escenario("E_B09", async () => { const b = nueva(); const r = await abrirSeguro(browser, b, { url: URL_APP, usuario: "u1", hash: "#/administracion", ...ESC }); const p = r.page;
  await clic(p.locator('[data-cuenta-pendiente="nueva@prueba.cl"] [data-autorizar-abrir]'));
  await confirmar(p); if (await p.locator("[data-autorizar-rol]").count()) await p.locator("[data-autorizar-rol]").selectOption("admin");
  const txt = await texto(p.locator("[data-autorizar-confirmacion]")); await clic(p.locator("[data-autorizar-confirmar]")); await p.waitForTimeout(400);
  ok("B09_esc_cambiar_a_admin_exige_nueva_confirmacion", /administrador/i.test(txt) && !b.log.some((l) => l.ruta === "rpc/bfk_autorizar_cuenta"), txt);
  await confirmar(p); await clic(p.locator("[data-autorizar-confirmar]")); await p.waitForTimeout(1800);
  ok("B09b_esc_autoriza_como_administrador_confirmado", b.db.perfiles.some((x) => x.id === "n1" && x.rol === "admin"));
  await cerrar(r); });
await escenario("E10", async () => { const b = nueva(); b.usuarios.find((u) => u.id === "n1").bfk_tipo = null;
  const r = await abrirSeguro(browser, b, { url: URL_APP, usuario: "u1", hash: "#/administracion", ...ESC }); const p = r.page;
  b.usuarios.find((u) => u.id === "n1").bfk_tipo = "respaldo_documental";   // la base la aisló entre la lectura y la autorización
  await clic(p.locator('[data-cuenta-pendiente="nueva@prueba.cl"] [data-autorizar-abrir]')); await confirmar(p); await clic(p.locator("[data-autorizar-confirmar]")); await p.waitForTimeout(1200);
  const t = await p.locator("[data-autorizar-error]").innerText().catch(() => "");
  ok("B10_esc_rechazo_de_la_base_legible", /aislada/.test(t) && !/BFK_PERFIL/.test(t) && !b.db.perfiles.some((x) => x.id === "n1"), t);
  await cerrar(r); });
await escenario("E11", async () => { const b = nueva(); b.db.perfiles.push({ id: "a2", nombre: "Otra Admin", rol: "admin", email: "a2@prueba.cl" });
  const r = await abrirSeguro(browser, b, { url: URL_APP, usuario: "u1", hash: "#/administracion", ...ESC }); const p = r.page;
  await clic(p.locator('[data-cambiar-rol="u2"]')); await p.waitForTimeout(1500);
  const patch = b.log.find((l) => l.ruta === "perfiles" && l.m === "PATCH");
  ok("B11_esc_admin_cambia_rol_como_antes", JSON.stringify(patch?.cuerpo) === JSON.stringify({ rol: "admin" }) && b.db.perfiles.find((x) => x.id === "u2").rol === "admin", patch);
  ok("B12_esc_con_dos_admins_se_puede_quitar_admin", (await deshabilitado(p.locator('[data-cambiar-rol="a2"]'))) === false);
  await cerrar(r); });
await escenario("E12", async () => { const b = nueva(); const r = await abrirSeguro(browser, b, { url: URL_APP, usuario: "u1", hash: "#/administracion", ...CEL }); const p = r.page;
  ok("B13_cel_seccion_visible_sin_desborde", (await p.locator('[data-cuenta-pendiente="nueva@prueba.cl"]').count()) === 1 && await sinDesborde(p));
  await clic(p.locator('[data-cuenta-pendiente="nueva@prueba.cl"] [data-autorizar-abrir]')); await p.waitForTimeout(200);
  ok("B14_cel_formulario_sin_desborde", (await p.locator("[data-form-autorizar]").count()) === 1 && await sinDesborde(p));
  await confirmar(p); await clic(p.locator("[data-autorizar-confirmar]")); await p.waitForTimeout(2000);
  ok("B15_cel_autoriza_con_nombre_sugerido", b.db.perfiles.some((x) => x.id === "n1" && x.nombre === "Nueva" && x.rol === "usuario"));
  await cerrar(r); });

// ── C. Usuario autorizado y administrador: sin cambios de acceso ──────────────────────────────────────────
await escenario("E13", async () => { const b = nueva(); const r = await abrirSeguro(browser, b, { url: URL_APP, usuario: "u2", ...ESC }); const p = r.page;
  await clic(p.locator('aside [data-nav="compras"]')); await p.waitForTimeout(900);
  ok("C01_esc_usuario_ve_sus_datos", (await p.locator(`[data-oc="${NUM}"]`).count()) >= 1);
  ok("C02_esc_usuario_sin_administracion", (await p.locator('[data-nav="usuarios"]').count()) === 0);
  await p.evaluate(() => { location.hash = "#/administracion"; }); await p.waitForTimeout(800);
  ok("C03_esc_usuario_direccion_admin_vuelve_al_inicio", !(await p.locator("[data-por-autorizar]").count()) && !/administracion/.test(await p.evaluate(() => location.hash)));
  ok("C04_esc_usuario_no_consulta_cuentas_por_autorizar", !b.log.some((l) => l.ruta.startsWith("rpc/bfk_")));
  await cerrar(r); });
await escenario("E14", async () => { const b = nueva(); const r = await abrirSeguro(browser, b, { url: URL_APP, usuario: "u2", ...CEL }); const p = r.page;
  await clic(p.locator('[data-nav="compras"]').last()); await p.waitForTimeout(900);
  ok("C05_cel_usuario_ve_compras", (await p.locator(`[data-oc="${NUM}"]`).count()) >= 1 && r.errs.length === 0, r.errs);
  await cerrar(r); });
await escenario("E15", async () => { const b = nueva(); const r = await abrirSeguro(browser, b, { url: URL_APP, usuario: "u1", ...ESC }); const p = r.page;
  const tablas = new Set(solicitudesDatos(b, "u1").map((l) => l.ruta));
  ok("C06_esc_admin_carga_completa", ["ordenes_compra_v2", "financiadores", "gastos_indirectos", "iva_mensual", "pagos_vendedor"].every((t) => tablas.has(t)), [...tablas]);
  await cerrar(r); });
await escenario("E16", async () => { const b = nueva(); const r = await abrirSeguro(browser, b, { url: URL_APP, usuario: "u2", ...ESC }); const p = r.page;
  b.quitarPerfil("u2");   // un administrador quita el perfil durante la sesión
  await p.evaluate(() => document.dispatchEvent(new Event("visibilitychange"))); await p.waitForTimeout(2500);
  ok("C07_esc_cuenta_desautorizada_sale_al_recargar_datos", (await attr(pantalla(p), "data-cuenta-por-autorizar")) === "sin_perfil" && !(await appMontada(p)));
  await cerrar(r); });

// ── D. Compatibilidad: interfaz publicada ANTES de instalar la migración ─────────────────────────────────
await escenario("E17", async () => { const b = nueva({ instalada: false }); const r = await abrirSeguro(browser, b, { url: URL_APP, usuario: "u1", hash: "#/administracion", ...ESC }); const p = r.page;
  ok("D01_esc_sin_migracion_admin_informa_y_sin_acciones", (await p.locator("[data-por-autorizar-no-instalada]").count()) === 1 && (await p.locator("[data-autorizar-abrir]").count()) === 0
    && (await texto(p.locator("#adm-usuarios"))).includes("Usuario Prueba") && r.errs.length === 0, r.errs);
  await cerrar(r); });
await escenario("E18", async () => { const b = nueva({ instalada: false }); const r = await abrirSeguro(browser, b, { url: URL_APP, usuario: "u2", ...CEL }); const p = r.page;
  await clic(p.locator('[data-nav="compras"]').last()); await p.waitForTimeout(900);
  ok("D02_cel_sin_migracion_usuario_igual_que_hoy", (await p.locator(`[data-oc="${NUM}"]`).count()) >= 1 && r.errs.length === 0, r.errs);
  await cerrar(r); });
await escenario("E19", async () => { const b = nueva({ instalada: false }); const r = await abrirSeguro(browser, b, { url: URL_APP, usuario: "n1", ...ESC }); const p = r.page;
  ok("D03_esc_sin_migracion_cuenta_sin_perfil_ya_bloqueada_en_la_app", (await pantalla(p).count()) === 1 && solicitudesDatos(b, "n1").length === 0
    && !b.log.some((l) => l.ruta === "perfiles" && l.m !== "GET"));
  await cerrar(r); });

await browser.close();
console.log(`\n${nOk} OK · ${F.length} FALLA`);
if (F.length) process.exit(1);
