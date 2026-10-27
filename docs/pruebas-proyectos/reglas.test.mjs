// Pruebas de las reglas de pantalla de Proyectos Industriales (src/lib/proyectos.js y el enlace directo de navegación).
// Comprueban que las listas y transiciones de la pantalla coincidan con la migración (texto del SQL) y, si se indica una
// base desechable con el módulo instalado (PI_DB_URL), con las funciones reales de la base.
// Ejecutar: node docs/pruebas-proyectos/reglas.test.mjs        (opcional: PI_DB_URL=postgresql://…  )
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import * as L from "../../src/lib/proyectos.js";
import { detalleDesdeHash, hashProyecto, hashEsDe, pantallaDesdeHash, hashDe, PANTALLAS, GRUPOS, PRINCIPALES, entradasPara } from "../../src/lib/navegacion.js";

const SQL = readFileSync(new URL("../migraciones/BORRADOR-2026-10-22-proyectos-industriales.sql", import.meta.url), "utf8");
let ok = 0, fallas = 0;
const eq = (n, a, b) => { const v = JSON.stringify(a) === JSON.stringify(b); v ? ok++ : fallas++; console.log((v ? "OK    " : "FALLA ") + n + (v ? "" : ` :: esperado ${JSON.stringify(b)} · obtenido ${JSON.stringify(a)}`)); };
const vals = (lista) => lista.map((x) => x.v);
// Valores de un CHECK «col in ('a','b',…)» o «col <@ array['a',…]» en la tabla indicada.
function checkDe(tabla, col) {
  const t = SQL.slice(SQL.indexOf(`create table public.${tabla} (`)); const fin = t.indexOf("\n);");
  const cuerpo = t.slice(0, fin);
  const re = new RegExp(`${col}[^\\n]*?(?:in \\(|array\\[)([^\\])]+)[\\])]`);
  const m = re.exec(cuerpo); if (!m) return null;
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

// ── 1. Listas iguales a los CHECK de la migración ──
eq("estados de proyecto = CHECK pi_proyectos.estado", vals(L.ESTADOS), checkDe("pi_proyectos", "estado text"));
eq("tipos de proyecto = CHECK", vals(L.TIPOS), checkDe("pi_proyectos", "tipo text"));
eq("especialidades de proyecto = CHECK", vals(L.ESPECIALIDADES), checkDe("pi_proyectos", "check \\(especialidades"));
eq("especialidades de actividad = CHECK", [...vals(L.ESPECIALIDADES_CONTENIDO)].sort(), [...checkDe("pi_actividades", "especialidad text")].sort());
eq("especialidades de entregable = CHECK", [...vals(L.ESPECIALIDADES_CONTENIDO)].sort(), [...checkDe("pi_entregables", "especialidad text")].sort());
eq("rubros de cliente = CHECK", vals(L.RUBROS), checkDe("pi_clientes", "rubro text"));
eq("monedas = CHECK", vals(L.MONEDAS), checkDe("pi_proyectos_economia", "moneda text"));
eq("roles = CHECK pi_equipo", vals(L.ROLES), checkDe("pi_equipo", "rol_proyecto text"));
eq("estados de actividad = CHECK", vals(L.ESTADOS_ACTIVIDAD), checkDe("pi_actividades", "estado text"));
eq("tipos de hito = CHECK", vals(L.TIPOS_HITO), checkDe("pi_hitos", "tipo text"));
eq("estados de hito = CHECK", vals(L.ESTADOS_HITO), checkDe("pi_hitos", "estado text"));
eq("tipos de entregable = CHECK", vals(L.TIPOS_ENTREGABLE), checkDe("pi_entregables", "tipo text"));
eq("estados de entregable = CHECK", vals(L.ESTADOS_ENTREGABLE), checkDe("pi_entregables", "estado text"));
eq("categorías de documento = CHECK", vals(L.CATEGORIAS_DOC), checkDe("pi_documentos", "categoria text"));
eq("estados de documento = CHECK", vals(L.ESTADOS_DOC), checkDe("pi_documentos", "estado text"));
eq("tamaño máximo = CHECK pi_documentos.tamano", L.MAX_ARCHIVO, Number(/tamano bigint not null check \(tamano > 0 and tamano <= (\d+)\)/.exec(SQL)[1]));
eq("activos = los que la vista cuenta para atraso", L.ACTIVOS, [.../p\.estado in \(([^)]+)\) and \(/.exec(SQL)[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));
eq("entregables abiertos = los que la vista cuenta como pendientes", L.ENTREGABLE_ABIERTO, [.../estado in \(([^)]+)\)\) as n_entregables_pendientes/.exec(SQL)[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));

// ── 2. Transiciones iguales a pi_transicion_valida ──
const fn = SQL.slice(SQL.indexOf("create function public.pi_transicion_valida"), SQL.indexOf("create function public.pi_validar_proyecto"));
const [general, admin] = fn.split("or (es_admin");
const pares = (txt) => [...txt.matchAll(/\('([a-z_]+)','([a-z_]+)'\)/g)].map((m) => [m[1], m[2]]);
eq("transiciones generales = SQL", L.TRANSICIONES, pares(general));
eq("transiciones solo administrador = SQL", L.TRANSICIONES_ADMIN, pares(admin));
eq("propuesta → por iniciar solo administrador", [L.transicionValida("propuesta", "por_iniciar", false), L.transicionValida("propuesta", "por_iniciar", true)], [false, true]);
eq("finalizado → cerrado solo administrador", [L.transicionValida("finalizado", "cerrado", false), L.transicionValida("finalizado", "cerrado", true)], [false, true]);
eq("cerrado → en ejecución no existe ni para administrador", L.transicionValida("cerrado", "en_ejecucion", true), false);
eq("mismo estado siempre válido", L.transicionValida("suspendido", "suspendido", false), true);
eq("motivo obligatorio al anular y suspender (CHECK)", ["anulado", "suspendido", "finalizado"].map(L.requiereMotivo), [true, true, false]);

// ── 3. Permisos de pantalla (espejo de pi_rol_en / pi_puede_editar / pi_es_jefe / pi_edita_economia) ──
const P = (mi_rol, estado, extra = {}) => L.permisos({ mi_rol, estado, responsable_id: "R", _yo: "Y", ...extra });
eq("lector: solo consulta", (({ editarDatos, editarContenido, cambiarEstado, gestionarEquipo }) => [editarDatos, editarContenido, cambiarEstado, gestionarEquipo])(P("lector", "en_ejecucion")), [false, false, false, false]);
eq("editor: contenido sí, datos y equipo no", (({ editarDatos, editarContenido, gestionarEquipo }) => [editarDatos, editarContenido, gestionarEquipo])(P("editor", "en_ejecucion")), [false, true, false]);
eq("jefe: datos, equipo, estados y contenido", (({ editarDatos, editarContenido, cambiarEstado, gestionarEquipo }) => [editarDatos, editarContenido, cambiarEstado, gestionarEquipo])(P("jefe", "por_iniciar")), [true, true, true, true]);
eq("jefe en proyecto cerrado: solo lectura", (({ editarDatos, editarContenido, cambiarEstado }) => [editarDatos, editarContenido, cambiarEstado])(P("jefe", "cerrado")), [false, false, false]);
eq("editor en proyecto anulado: solo lectura", P("editor", "anulado").editarContenido, false);
eq("administrador edita aun cerrado", (({ editarDatos, editarContenido, eliminarContenido }) => [editarDatos, editarContenido, eliminarContenido])(P("admin", "cerrado")), [true, true, true]);
eq("solo administrador elimina contenido", ["jefe", "editor", "lector"].map((r) => P(r, "en_ejecucion").eliminarContenido), [false, false, false]);
eq("sin rol: sin acceso", P(null, "en_ejecucion").ver, false);
eq("responsable edita presupuesto en propuesta y por iniciar", [P("jefe", "propuesta", { responsable_id: "Y" }).editarEconomia, P("jefe", "por_iniciar", { responsable_id: "Y" }).editarEconomia], [true, true]);
eq("responsable NO edita presupuesto tras iniciar", P("jefe", "en_ejecucion", { responsable_id: "Y" }).editarEconomia, false);
eq("jefe que no es responsable no edita presupuesto", P("jefe", "propuesta").editarEconomia, false);
eq("administrador corrige presupuesto iniciado", P("admin", "en_ejecucion").editarEconomia, true);
eq("autorizar datos económicos: admin o responsable", [P("admin", "en_ejecucion").autorizarEconomia, P("jefe", "en_ejecucion", { responsable_id: "Y" }).autorizarEconomia, P("jefe", "en_ejecucion").autorizarEconomia], [true, true, false]);
eq("ver economía la decide la base (ve_economia)", [P("lector", "en_ejecucion", { ve_economia: false }).verEconomia, P("lector", "en_ejecucion", { ve_economia: true }).verEconomia], [false, true]);

// ── 4. Acciones de estado ofrecidas ──
const acc = (rol, estado) => L.accionesEstado({ mi_rol: rol, estado }).map((a) => a.estado);
eq("jefe en propuesta: solo rechazar (anular)", acc("jefe", "propuesta"), ["anulado"]);
eq("administrador en propuesta: autorizar o rechazar", acc("admin", "propuesta"), ["por_iniciar", "anulado"]);
eq("jefe en ejecución: finalizar, suspender, anular", acc("jefe", "en_ejecucion"), ["finalizado", "suspendido", "anulado"]);
eq("jefe en finalizado: reabrir ejecución (no cerrar)", acc("jefe", "finalizado"), ["en_ejecucion"]);
eq("administrador en finalizado: reabrir o cerrar", acc("admin", "finalizado"), ["en_ejecucion", "cerrado"]);
eq("administrador en anulado: restaurar como propuesta", acc("admin", "anulado"), ["propuesta"]);
eq("editor y lector: sin acciones de estado", [acc("editor", "en_ejecucion"), acc("lector", "por_iniciar")], [[], []]);
eq("nombres de acciones", L.accionesEstado({ mi_rol: "admin", estado: "propuesta" }).map((a) => a.etiqueta), ["Autorizar activación", "Rechazar propuesta"]);
eq("anular exige motivo y es peligrosa", L.accionesEstado({ mi_rol: "jefe", estado: "por_iniciar" }).find((a) => a.estado === "anulado"), { estado: "anulado", etiqueta: "Anular", motivo: true, peligro: true, soloAdmin: false });

// ── 5. RUT (mismo algoritmo que pi_rut_normalizado) ──
eq("RUT con dígito verificador incorrecto", L.normalizarRut("76.123.456-1"), { ok: false, error: "Dígito verificador incorrecto" });
eq("RUT válido normalizado", L.normalizarRut("76123456-0").rut, "76.123.456-0");
eq("RUT 77.123.456-9 válido", L.normalizarRut("771234569").rut, "77.123.456-9");
eq("RUT con K", L.normalizarRut("10.000.013-k").rut, "10.000.013-K");
eq("RUT vacío permitido", L.normalizarRut("  "), { ok: true, rut: null });
eq("RUT corto rechazado", L.normalizarRut("123-4").ok, false);

// ── 6. Formatos ──
eq("monto CLP", L.formatoMonto(25000000, "CLP"), "$25.000.000");
eq("monto UF con 2 decimales", L.formatoMonto(1250.75, "UF"), "UF 1.250,75");
eq("monto USD", L.formatoMonto(32000, "USD"), "US$ 32.000");
eq("monto vacío", L.formatoMonto(null, "CLP"), "—");
eq("leer monto chileno", [L.leerMonto("25.000.000"), L.leerMonto("1.250,75"), L.leerMonto("1250.75"), L.leerMonto(""), Number.isNaN(L.leerMonto("abc"))], [25000000, 1250.75, 1250.75, null, true]);
eq("porcentaje", [L.formatoPct(23.3), L.formatoPct(100), L.formatoPct(null)], ["23,3", "100", "—"]);
eq("tamaños", [L.formatoTamano(92), L.formatoTamano(2048), L.formatoTamano(6 * 1048576)], ["92 B", "2,0 KB", "6,0 MB"]);
eq("fecha", L.formatoFecha("2026-10-23"), "23/10/2026");
eq("hoy en Chile (UTC−3 a las 01:30 UTC sigue siendo ayer)", L.hoyChile(new Date("2026-10-24T01:30:00Z")), "2026-10-23");

// ── 7. Lectura de la vista resumen ──
const base = { estado: "en_ejecucion", fecha_termino_prevista: "2026-12-31", fecha_inicio_prevista: "2026-01-01", n_actividades_atrasadas: 0, n_hitos_vencidos: 0, n_entregables_vencidos: 0, avance_real: 50, avance_planificado: 55 };
eq("sin razones de atraso", L.razonesAtraso(base, "2026-10-23"), []);
eq("razones de atraso (mismos criterios que la vista)", L.razonesAtraso({ ...base, n_actividades_atrasadas: 1, n_entregables_vencidos: 1, avance_real: 23.3, avance_planificado: 55.9 }, "2026-10-23"),
  ["1 actividad con fin previsto vencido.", "1 entregable con fecha comprometida vencida.", "Avance real 23,3 % bajo el planificado 55,9 % (más de 10 puntos)."]);
eq("10 puntos exactos no es atraso", L.razonesAtraso({ ...base, avance_real: 45, avance_planificado: 55 }, "2026-10-23"), []);
eq("por iniciar con inicio vencido", L.razonesAtraso({ ...base, estado: "por_iniciar", fecha_inicio_prevista: "2026-10-01" }, "2026-10-23").length, 1);
eq("propuesta nunca está atrasada", L.razonesAtraso({ ...base, estado: "propuesta", n_actividades_atrasadas: 3 }, "2026-10-23"), []);
eq("plazo", [L.textoPlazo({ estado: "en_ejecucion", dias_restantes: 15 }), L.textoPlazo({ estado: "en_ejecucion", dias_restantes: 0 }), L.textoPlazo({ estado: "en_ejecucion", dias_restantes: -3 }), L.textoPlazo({ estado: "finalizado", dias_restantes: 4 })],
  ["15 días para el término", "Vence hoy", "Vencido hace 3 días", null]);
const filas = [
  { codigo: "PI-2026-001", estado: "en_ejecucion", atrasado: false, ve_economia: true, presupuesto_inicial: 48500000, moneda: "CLP", nombre: "Ingeniería de control", cliente_nombre: "Constructora EPC", responsable_id: "J" },
  { codigo: "PI-2026-002", estado: "en_ejecucion", atrasado: true, ve_economia: true, presupuesto_inicial: 1250.75, moneda: "UF", nombre: "Montaje eléctrico", cliente_nombre: "Celulosa del Sur", ubicacion: "Planta Laja", responsable_id: "I" },
  { codigo: "PI-2026-003", estado: "por_iniciar", atrasado: false, ve_economia: false, presupuesto_inicial: null, moneda: null, nombre: "Mantención molino", cliente_nombre: "Minera Andina", responsable_id: "J" },
  { codigo: "PI-2026-004", estado: "finalizado", atrasado: false, ve_economia: true, presupuesto_inicial: 18900000, moneda: "CLP", nombre: "Suministro CCM", responsable_id: "I" },
  { codigo: "PI-2026-005", estado: "propuesta", atrasado: false, ve_economia: true, presupuesto_inicial: 5000000, moneda: "CLP", nombre: "Propuesta bombeo", responsable_id: "J" },
];
const ind = L.indicadores(filas);
eq("indicadores: activos, con atraso, finalizados, propuestas", [ind.activos, ind.enEjecucion, ind.porIniciar, ind.conAtraso, ind.finalizados, ind.propuestas], [3, 2, 1, 1, 1, 1]);
eq("presupuesto de activos por moneda, sin sumar monedas ni propuestas ni finalizados", ind.presupuesto, [{ moneda: "CLP", monto: 48500000 }, { moneda: "UF", monto: 1250.75 }]);
eq("activos con datos reservados", ind.reservados, 1);
eq("filtro activos", L.filtrar(filas, { filtro: "activos" }).map((p) => p.codigo), ["PI-2026-001", "PI-2026-002", "PI-2026-003"]);
eq("filtro con atraso", L.filtrar(filas, { filtro: "atraso" }).map((p) => p.codigo), ["PI-2026-002"]);
eq("filtro propuestas", L.filtrar(filas, { filtro: "propuestas" }).map((p) => p.codigo), ["PI-2026-005"]);
eq("búsqueda sin tildes por ubicación", L.filtrar(filas, { texto: "planta laja" }).map((p) => p.codigo), ["PI-2026-002"]);
eq("búsqueda por cliente con tilde", L.filtrar(filas, { texto: "INGENIERIA" }).map((p) => p.codigo), ["PI-2026-001"]);
eq("filtro por responsable y estado", L.filtrar(filas, { responsable: "J", estado: "por_iniciar" }).map((p) => p.codigo), ["PI-2026-003"]);
eq("orden: atraso, activos, propuestas, finalizados", L.ordenar(filas).map((p) => p.codigo), ["PI-2026-002", "PI-2026-003", "PI-2026-001", "PI-2026-005", "PI-2026-004"]);

// ── 8. EDT, documentos, rutas ──
const acts = [{ id: "a", padre_id: null, orden: 2 }, { id: "b", padre_id: null, orden: 1 }, { id: "c", padre_id: "b", orden: 1 }, { id: "d", padre_id: "c", orden: 1 }, { id: "e", padre_id: "b", orden: 2 }];
eq("numeración EDT por árbol y orden", L.numerarEDT(acts).map((a) => `${a.id}:${a.edt}`), ["b:1", "c:1.1", "d:1.1.1", "e:1.2", "a:2"]);
eq("nivel máximo = SQL (3 niveles)", L.nivelMaximo, Number(/máximo (\d) niveles/.exec(SQL)[1]));
const docs = [{ id: "1", documento_base_id: null, numero_version: 1, estado: "reemplazado", subido_en: "2026-10-01" }, { id: "2", documento_base_id: "1", numero_version: 2, estado: "vigente", subido_en: "2026-10-05" },
  { id: "3", documento_base_id: null, numero_version: 1, estado: "anulado", subido_en: "2026-10-03" }];
const g = L.agruparDocumentos(docs);
eq("documentos agrupados por versión (vigente primero)", g.map((x) => [x.id, x.actual.id, x.versiones.length, x.anulado]), [["1", "2", 2, false], ["3", "3", 1, true]]);
const pid = "0f0e1d2c-3b4a-4958-8776-655443322110";
const ruta = L.rutaArchivo(pid, "Filosofía de control Rev B.pdf", "abc123");
const reRuta = new RegExp(/new\.ruta !~ '([^']+)'/.exec(SQL)[1]);
eq("ruta del archivo: carpeta del proyecto, nombre seguro sin tildes", ruta, `${pid}/abc123-Filosofia_de_control_Rev_B.pdf`);
eq("ruta cumple la validación de pi_validar_documento", [reRuta.test(ruta), ruta.length <= 340], [true, true]);
eq("ruta con nombre muy largo sigue siendo válida", (() => { const r = L.rutaArchivo(pid, "x".repeat(500) + ".pdf"); return reRuta.test(r) && r.length <= 340; })(), true);
eq("extensión", [L.extension("plano.DWG"), L.extension("sin")], ["DWG", ""]);

// ── 9. Historial legible ──
eq("historial: creación", L.describirHistorial({ tabla: "pi_actividades", accion: "crear", cambios: { nombre: "Montaje de tableros" } }).titulo, "Actividad creada: Montaje de tableros");
eq("historial: documento versión 2", L.describirHistorial({ tabla: "pi_documentos", accion: "crear", cambios: { titulo: "Filosofía de control", numero_version: 2 } }).titulo, "Documento creado: Filosofía de control (versión 2)");
eq("historial: cambio de estado y fecha", L.describirHistorial({ tabla: "pi_proyectos", accion: "modificar", cambios: { estado: { antes: "por_iniciar", despues: "en_ejecucion" }, fecha_inicio_real: { antes: null, despues: "2026-10-23" } } }).detalles,
  [{ campo: "Estado", antes: "Por iniciar", despues: "En ejecución" }, { campo: "Inicio real", antes: "—", despues: "23/10/2026" }]);
eq("historial: responsable por nombre", L.describirHistorial({ tabla: "pi_proyectos", accion: "modificar", cambios: { responsable_id: { antes: "a", despues: "b" } } }, { a: "Ana", b: "Bruno" }).detalles[0], { campo: "Responsable", antes: "Ana", despues: "Bruno" });
eq("historial: reemplazo de versión", L.describirHistorial({ tabla: "pi_documentos", accion: "modificar", cambios: { estado: { antes: "vigente", despues: "reemplazado" } } }).detalles[0].despues, "Reemplazado por una versión nueva");

// ── 10. Mensajes de error ──
eq("conflicto de versión", L.mensajeError(new Error("PI409: otra persona guardó")).startsWith("Otra persona guardó"), true);
eq("código de entregable duplicado no se confunde con conflicto", L.mensajeError(new Error('duplicate key value violates unique constraint "pi_entregables_codigo"')), "Ya existe un entregable con ese código en el proyecto.");
eq("mensaje de la base sin prefijo técnico", L.mensajeError(new Error("PI_FECHA: las fechas reales no pueden ser futuras")), "las fechas reales no pueden ser futuras");
eq("RLS legible", L.mensajeError(new Error("new row violates row-level security policy for table pi_hitos")), "No tienes permiso para hacer este cambio.");

// ── 11. Navegación: pantalla y enlace directo ──
eq("pantalla proyectos con su grupo", [pantallaDesdeHash("#/proyectos"), PANTALLAS.find((p) => p.key === "proyectos").grupo, GRUPOS.map((g) => g.key)], ["proyectos", "proyectos", ["operacion", "proyectos", "finanzas", "admin"]]);
eq("enlace directo #/proyectos/PI-2026-005", [detalleDesdeHash("#/proyectos/PI-2026-005"), pantallaDesdeHash("#/proyectos/PI-2026-005")], ["PI-2026-005", "proyectos"]);
eq("enlace directo acepta minúsculas y barra final", detalleDesdeHash("#/proyectos/pi-2026-012/"), "PI-2026-012");
eq("enlace directo inválido", [detalleDesdeHash("#/proyectos/OC-1"), detalleDesdeHash("#/compras/PI-2026-001")], [null, null]);
eq("la dirección con código cuenta como de la pantalla (no se reescribe)", [hashEsDe("#/proyectos/PI-2026-001", "proyectos"), hashEsDe("#/proyectos", "proyectos"), hashEsDe("#/proyectos/PI-2026-001", "compras"), hashEsDe(hashDe("compras"), "compras")], [true, true, false, true]);
eq("hash del proyecto", [hashProyecto("PI-2026-001"), hashProyecto(null)], ["#/proyectos/PI-2026-001", "#/proyectos"]);
eq("no está en la barra inferior del celular (va en Más)", PRINCIPALES.includes("proyectos"), false);
eq("visible para usuario y administrador", [entradasPara(false).some((p) => p.key === "proyectos"), entradasPara(true).some((p) => p.key === "proyectos")], [true, true]);

// ── 12. Contra la base real (opcional): transiciones y RUT evaluados por las funciones de la migración ──
if (process.env.PI_DB_URL) {
  const psql = (sql) => execFileSync("psql", [process.env.PI_DB_URL, "-X", "-At", "-c", sql], { encoding: "utf8" }).trim();
  const est = vals(L.ESTADOS);
  const filasSql = psql(`select string_agg(d || '>' || h || '>' || a || '=' || public.pi_transicion_valida(d, h, a), ',' order by d, h, a)
    from unnest(array[${est.map((e) => `'${e}'`).join(",")}]) d, unnest(array[${est.map((e) => `'${e}'`).join(",")}]) h, unnest(array[false, true]) a`).split(",");
  const dif = filasSql.filter((x) => { const [d, h, a, v] = x.split(/[>=]/); return L.transicionValida(d, h, a === "true") !== (v === "true"); });
  eq(`transiciones: ${filasSql.length} combinaciones idénticas a pi_transicion_valida()`, dif, []);
  const ruts = ["77.123.456-9", "10.000.013-K", "76.123.456-0", "123-4", "", "9.999.999-3"];
  const err = ruts.map((r) => { try { return execFileSync("psql", [process.env.PI_DB_URL, "-X", "-At", "-c", `select coalesce(public.pi_rut_normalizado('${r}'), '∅')`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return "ERROR"; } });
  eq("RUT: mismo resultado que pi_rut_normalizado()", ruts.map((r) => { const x = L.normalizarRut(r); return x.ok ? (x.rut ?? "∅") : "ERROR"; }), err);
} else console.log("INFO  sin PI_DB_URL: se omiten las comparaciones contra la base real");

console.log(`\nRESUMEN reglas Proyectos Industriales: ${ok} OK, ${fallas} FALLA(S)`);
process.exit(fallas ? 1 : 0);
