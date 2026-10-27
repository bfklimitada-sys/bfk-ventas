// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Proyectos Industriales (línea de negocio PI) — reglas de pantalla.
// La fuente de verdad es la base (docs/migraciones/BORRADOR-2026-10-22-proyectos-industriales.sql):
// disparadores, RLS y las vistas pi_proyectos_resumen / pi_actividades_vista. Aquí solo están las
// listas, etiquetas y transiciones que la pantalla necesita para ofrecer lo que la base permitirá;
// docs/pruebas-proyectos/reglas.test.mjs comprueba que coincidan con el SQL. Ningún cálculo de avance
// o atraso se hace en el navegador: se muestran los de las vistas.
// Este módulo no lee ni escribe nada de Mercado Público.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

export const LINEA = "PI";

// ── Listas (mismos valores que los CHECK de la migración) ──────────────────────────────────────
export const ESTADOS = [
  { v: "propuesta", l: "Propuesta", tono: "info" },
  { v: "por_iniciar", l: "Por iniciar", tono: "info" },
  { v: "en_ejecucion", l: "En ejecución", tono: "ok" },
  { v: "suspendido", l: "Suspendido", tono: "warn" },
  { v: "finalizado", l: "Finalizado", tono: "neutro" },
  { v: "cerrado", l: "Cerrado", tono: "neutro" },
  { v: "anulado", l: "Anulado", tono: "danger" },
];
export const ACTIVOS = ["por_iniciar", "en_ejecucion", "suspendido"];          // cuentan como activos (no la propuesta)
export const SOLO_LECTURA = ["cerrado", "anulado"];                              // jefe y editor ya no editan

export const TIPOS = [
  { v: "ingenieria", l: "Ingeniería" }, { v: "montaje", l: "Montaje" }, { v: "fabricacion", l: "Fabricación" },
  { v: "suministro", l: "Suministro" }, { v: "mantencion", l: "Mantención" }, { v: "puesta_en_marcha", l: "Puesta en marcha" },
  { v: "servicios", l: "Servicios" }, { v: "mixto", l: "Mixto" }, { v: "otro", l: "Otro" },
];
export const ESPECIALIDADES = [
  { v: "mecanica", l: "Mecánica" }, { v: "electrica", l: "Eléctrica" }, { v: "instrumentacion", l: "Instrumentación" },
  { v: "automatizacion", l: "Automatización y control" }, { v: "civil", l: "Civil" }, { v: "estructural", l: "Estructural" },
  { v: "piping", l: "Piping" }, { v: "procesos", l: "Procesos" }, { v: "otra", l: "Otra" },
];
// Actividades y entregables admiten además «gestión».
export const ESPECIALIDADES_CONTENIDO = [...ESPECIALIDADES.slice(0, -1), { v: "gestion", l: "Gestión" }, ESPECIALIDADES[ESPECIALIDADES.length - 1]];
export const RUBROS = [
  { v: "mineria", l: "Minería" }, { v: "celulosa", l: "Celulosa" }, { v: "energia", l: "Energía" }, { v: "manufactura", l: "Manufactura" },
  { v: "construccion", l: "Construcción" }, { v: "agroindustria", l: "Agroindustria" }, { v: "pesca", l: "Pesca" },
  { v: "sanitaria", l: "Sanitaria" }, { v: "otro", l: "Otro" },
];
export const MONEDAS = [
  { v: "CLP", l: "Pesos chilenos (CLP)", corto: "$" }, { v: "UF", l: "Unidades de fomento (UF)", corto: "UF" },
  { v: "USD", l: "Dólares (USD)", corto: "US$" }, { v: "EUR", l: "Euros (EUR)", corto: "€" },
];
export const ROLES = [
  { v: "jefe", l: "Jefe de proyecto", d: "Edita datos, equipo, estados y contenido del proyecto" },
  { v: "editor", l: "Editor", d: "Edita actividades, hitos y entregables; sube documentos" },
  { v: "lector", l: "Lector", d: "Solo consulta y descarga" },
];
export const ESTADOS_ACTIVIDAD = [
  { v: "pendiente", l: "Pendiente", tono: "neutro" }, { v: "en_curso", l: "En curso", tono: "info" },
  { v: "completada", l: "Completada", tono: "ok" }, { v: "bloqueada", l: "Bloqueada", tono: "warn" }, { v: "anulada", l: "Anulada", tono: "danger" },
];
export const TIPOS_HITO = [
  { v: "contractual", l: "Contractual" }, { v: "pago", l: "Pago" }, { v: "entrega", l: "Entrega" }, { v: "interno", l: "Interno" },
];
export const ESTADOS_HITO = [
  { v: "pendiente", l: "Pendiente", tono: "neutro" }, { v: "cumplido", l: "Cumplido", tono: "ok" }, { v: "anulado", l: "Anulado", tono: "danger" },
];
export const TIPOS_ENTREGABLE = [
  { v: "plano", l: "Plano" }, { v: "memoria_calculo", l: "Memoria de cálculo" }, { v: "especificacion", l: "Especificación" },
  { v: "listado_materiales", l: "Listado de materiales" }, { v: "informe", l: "Informe" }, { v: "procedimiento", l: "Procedimiento" },
  { v: "dossier", l: "Dossier" }, { v: "protocolo", l: "Protocolo" }, { v: "otro", l: "Otro" },
];
export const ESTADOS_ENTREGABLE = [
  { v: "pendiente", l: "Pendiente", tono: "neutro" }, { v: "en_elaboracion", l: "En elaboración", tono: "info" },
  { v: "en_revision", l: "En revisión", tono: "info" }, { v: "aprobado", l: "Aprobado", tono: "ok" }, { v: "emitido", l: "Emitido", tono: "ok" },
  { v: "rechazado", l: "Rechazado", tono: "warn" }, { v: "anulado", l: "Anulado", tono: "danger" },
];
export const ENTREGABLE_ABIERTO = ["pendiente", "en_elaboracion", "en_revision", "rechazado"];   // cuentan como pendientes
export const CATEGORIAS_DOC = [
  { v: "contractual", l: "Contractual" }, { v: "tecnico", l: "Técnico" }, { v: "plano", l: "Plano" }, { v: "memoria", l: "Memoria" },
  { v: "especificacion", l: "Especificación" }, { v: "informe", l: "Informe" }, { v: "calidad", l: "Calidad" },
  { v: "seguridad", l: "Seguridad" }, { v: "fotografia", l: "Fotografía" }, { v: "otro", l: "Otro" },
];
export const ESTADOS_DOC = [
  { v: "vigente", l: "vigente", tono: "ok" }, { v: "reemplazado", l: "reemplazada", tono: "neutro" }, { v: "anulado", l: "anulado", tono: "danger" },
];
export const MAX_ARCHIVO = 52428800;   // 50 MB (CHECK de pi_documentos.tamano)

const de = (lista) => (v) => lista.find((x) => x.v === v) || null;
export const estadoDe = de(ESTADOS);
export const tipoDe = de(TIPOS);
export const especialidadDe = de(ESPECIALIDADES_CONTENIDO);
export const rubroDe = de(RUBROS);
export const monedaDe = de(MONEDAS);
export const rolDe = (v) => (v === "admin" ? { v: "admin", l: "Administrador", d: "Ve y edita todos los proyectos" } : de(ROLES)(v));
export const estadoActividadDe = de(ESTADOS_ACTIVIDAD);
export const tipoHitoDe = de(TIPOS_HITO);
export const estadoHitoDe = de(ESTADOS_HITO);
export const tipoEntregableDe = de(TIPOS_ENTREGABLE);
export const estadoEntregableDe = de(ESTADOS_ENTREGABLE);
export const categoriaDocDe = de(CATEGORIAS_DOC);
export const etiqueta = (fn, v) => fn(v)?.l || (v ? String(v) : "—");

// ── Estados del proyecto: transiciones (igual que pi_transicion_valida) ─────────────────────────
export const TRANSICIONES = [
  ["propuesta", "anulado"],
  ["por_iniciar", "en_ejecucion"], ["por_iniciar", "suspendido"], ["por_iniciar", "anulado"],
  ["en_ejecucion", "suspendido"], ["en_ejecucion", "finalizado"], ["en_ejecucion", "anulado"],
  ["suspendido", "en_ejecucion"], ["suspendido", "por_iniciar"], ["suspendido", "anulado"],
  ["finalizado", "en_ejecucion"],
];
export const TRANSICIONES_ADMIN = [["propuesta", "por_iniciar"], ["finalizado", "cerrado"], ["cerrado", "finalizado"], ["anulado", "propuesta"]];
export const transicionValida = (desde, hasta, esAdmin) =>
  desde === hasta || TRANSICIONES.some(([a, b]) => a === desde && b === hasta) || (!!esAdmin && TRANSICIONES_ADMIN.some(([a, b]) => a === desde && b === hasta));
export const requiereMotivo = (hasta) => hasta === "anulado" || hasta === "suspendido";

// Nombre de la acción que lleva a un estado (botones de la ficha).
const ACCION = {
  "propuesta>por_iniciar": "Autorizar activación", "propuesta>anulado": "Rechazar propuesta",
  "por_iniciar>en_ejecucion": "Iniciar ejecución", "suspendido>en_ejecucion": "Reanudar ejecución", "finalizado>en_ejecucion": "Reabrir ejecución",
  "suspendido>por_iniciar": "Volver a por iniciar",
  ">suspendido": "Suspender", "en_ejecucion>finalizado": "Finalizar ejecución", "finalizado>cerrado": "Cerrar proyecto",
  "cerrado>finalizado": "Reabrir (volver a finalizado)", "anulado>propuesta": "Restaurar como propuesta", ">anulado": "Anular",
};
export const nombreAccion = (desde, hasta) => ACCION[`${desde}>${hasta}`] || ACCION[`>${hasta}`] || `Pasar a ${etiqueta(estadoDe, hasta)}`;

// ── Permisos de pantalla (los aplica la base; aquí solo se decide qué ofrecer) ──────────────────
// rol: 'admin' · 'jefe' · 'editor' · 'lector' · null (lo entrega pi_proyectos_resumen.mi_rol).
export function permisos(proyecto) {
  const rol = proyecto?.mi_rol || null;
  const admin = rol === "admin";
  const abierto = !SOLO_LECTURA.includes(proyecto?.estado);
  const jefe = admin || (rol === "jefe" && abierto);
  const edita = admin || ((rol === "jefe" || rol === "editor") && abierto);
  const yo = proyecto?._yo;
  return {
    rol, admin, ver: !!rol,
    editarDatos: jefe,                       // cabecera del proyecto (pi_proyectos: admin o jefe, no cerrado/anulado)
    gestionarEquipo: jefe,                   // pi_equipo: pi_es_jefe
    cambiarEstado: jefe,                     // pi_cambiar_estado: jefe o admin
    editarContenido: edita,                  // actividades, hitos, entregables, documentos
    eliminarContenido: admin,                // DELETE solo administrador
    verEconomia: !!proyecto?.ve_economia,    // pi_ve_economia (calculado por la base)
    // pi_edita_economia: admin siempre; responsable principal solo en propuesta o por iniciar.
    editarEconomia: admin || (!!yo && proyecto?.responsable_id === yo && ["propuesta", "por_iniciar"].includes(proyecto?.estado)),
    // pi_validar_equipo: solo admin o responsable principal otorga/retira «ve_economia».
    autorizarEconomia: admin || (!!yo && proyecto?.responsable_id === yo),
  };
}

// Estados a los que el usuario puede llevar el proyecto (acciones de la ficha), en orden de uso.
export function accionesEstado(proyecto) {
  const p = permisos(proyecto);
  if (!p.cambiarEstado && !p.admin) return [];
  const orden = ["por_iniciar", "en_ejecucion", "finalizado", "cerrado", "suspendido", "propuesta", "anulado"];
  return orden.filter((h) => h !== proyecto.estado && transicionValida(proyecto.estado, h, p.admin))
    .map((h) => ({ estado: h, etiqueta: nombreAccion(proyecto.estado, h), motivo: requiereMotivo(h), peligro: h === "anulado", soloAdmin: !transicionValida(proyecto.estado, h, false) }));
}

// ── RUT chileno (mismo algoritmo que pi_rut_normalizado) ────────────────────────────────────────
// Devuelve { ok, rut } con el formato «76.123.456-7», { ok:true, rut:null } si está vacío, o { ok:false, error }.
export function normalizarRut(txt) {
  const l = String(txt || "").replace(/[^0-9kK]/g, "").toUpperCase();
  if (!l) return { ok: true, rut: null };
  const c = l.slice(0, -1), dv = l.slice(-1);
  if (!/^[0-9]{7,8}$/.test(c) || Number(c) < 1000000) return { ok: false, error: "RUT con largo no válido" };
  let s = 0, f = 2;
  for (let i = c.length - 1; i >= 0; i--) { s += Number(c[i]) * f; f = f === 7 ? 2 : f + 1; }
  const r = 11 - (s % 11);
  const esperado = r === 11 ? "0" : r === 10 ? "K" : String(r);
  if (dv !== esperado) return { ok: false, error: "Dígito verificador incorrecto" };
  return { ok: true, rut: c.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + "-" + dv };
}

// ── Formatos ────────────────────────────────────────────────────────────────────────────────────
const nf = (dec) => new Intl.NumberFormat("es-CL", { minimumFractionDigits: dec, maximumFractionDigits: dec });
export function formatoMonto(monto, moneda = "CLP") {
  if (monto === null || monto === undefined || monto === "") return "—";
  const n = Number(monto);
  if (!Number.isFinite(n)) return "—";
  if (moneda === "CLP") return "$" + nf(0).format(Math.round(n));
  const dec = Math.round(n * 100) % 100 === 0 && moneda !== "UF" ? 0 : 2;
  return `${monedaDe(moneda)?.corto || moneda} ${nf(moneda === "UF" ? 2 : dec).format(n)}`;
}
// «25.000.000» o «1.250,75» → número (null si vacío; NaN si no es número).
export function leerMonto(txt) {
  const t = String(txt ?? "").trim();
  if (!t) return null;
  const limpio = t.replace(/[$\sA-Za-z€]/g, "");
  if (!/^[0-9.,]+$/.test(limpio)) return NaN;
  // Formato chileno: punto = miles, coma = decimales. «1250.75» (un solo punto y 1–2 decimales) se acepta como decimal.
  const n = /^\d+\.\d{1,2}$/.test(limpio) ? Number(limpio) : Number(limpio.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}
export const formatoPct = (v) => (v === null || v === undefined ? "—" : nf(Number(v) % 1 === 0 ? 0 : 1).format(Number(v)));
export function formatoFecha(d) { if (!d) return "—"; const [y, m, dd] = String(d).slice(0, 10).split("-"); return `${dd}/${m}/${y}`; }
export function formatoTamano(b) {
  const n = Number(b) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${nf(n < 10240 ? 1 : 0).format(n / 1024)} KB`;
  return `${nf(1).format(n / 1048576)} MB`;
}
// Fecha de hoy en Chile (AAAA-MM-DD), igual que pi_hoy().
export function hoyChile(ahora = new Date()) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(ahora);
  const g = (t) => p.find((x) => x.type === t)?.value;
  return `${g("year")}-${g("month")}-${g("day")}`;
}

// ── Lectura de la vista pi_proyectos_resumen ───────────────────────────────────────────────────
// Razones del atraso, en el mismo orden y con los mismos criterios que la columna «atrasado» de la vista.
export function razonesAtraso(p, hoy = hoyChile()) {
  if (!p || !ACTIVOS.includes(p.estado)) return [];
  const r = [];
  if (p.fecha_termino_prevista && p.fecha_termino_prevista < hoy) r.push(`Término previsto vencido (${formatoFecha(p.fecha_termino_prevista)}).`);
  if (p.estado === "por_iniciar" && p.fecha_inicio_prevista && p.fecha_inicio_prevista < hoy) r.push(`Inicio previsto vencido (${formatoFecha(p.fecha_inicio_prevista)}) y aún no inicia.`);
  const n = (v) => Number(v) || 0;
  if (n(p.n_actividades_atrasadas)) r.push(`${n(p.n_actividades_atrasadas)} ${n(p.n_actividades_atrasadas) === 1 ? "actividad con fin previsto vencido" : "actividades con fin previsto vencido"}.`);
  if (n(p.n_hitos_vencidos)) r.push(`${n(p.n_hitos_vencidos)} ${n(p.n_hitos_vencidos) === 1 ? "hito pendiente vencido" : "hitos pendientes vencidos"}.`);
  if (n(p.n_entregables_vencidos)) r.push(`${n(p.n_entregables_vencidos)} ${n(p.n_entregables_vencidos) === 1 ? "entregable con fecha comprometida vencida" : "entregables con fecha comprometida vencida"}.`);
  if (p.avance_planificado !== null && p.avance_planificado !== undefined && Number(p.avance_planificado) - n(p.avance_real) > 10)
    r.push(`Avance real ${formatoPct(p.avance_real)} % bajo el planificado ${formatoPct(p.avance_planificado)} % (más de 10 puntos).`);
  return r;
}

// Texto del plazo: «15 días para el término», «Vence hoy», «Vencido hace 3 días».
export function textoPlazo(p) {
  if (!p || p.dias_restantes === null || p.dias_restantes === undefined) return null;
  const d = Number(p.dias_restantes);
  if (["finalizado", "cerrado", "anulado"].includes(p.estado)) return null;
  if (d > 1) return `${d} días para el término`;
  if (d === 1) return "1 día para el término";
  if (d === 0) return "Vence hoy";
  return `Vencido hace ${-d} ${d === -1 ? "día" : "días"}`;
}

// Indicadores del panel a partir de las filas visibles (la base ya filtró por permisos).
export function indicadores(filas) {
  const act = filas.filter((p) => ACTIVOS.includes(p.estado));
  const porMoneda = {};
  for (const p of act) if (p.ve_economia && p.presupuesto_inicial !== null && p.presupuesto_inicial !== undefined)
    porMoneda[p.moneda || "CLP"] = (porMoneda[p.moneda || "CLP"] || 0) + Number(p.presupuesto_inicial);
  return {
    activos: act.length,
    enEjecucion: act.filter((p) => p.estado === "en_ejecucion").length,
    porIniciar: act.filter((p) => p.estado === "por_iniciar").length,
    suspendidos: act.filter((p) => p.estado === "suspendido").length,
    conAtraso: filas.filter((p) => p.atrasado).length,
    finalizados: filas.filter((p) => p.estado === "finalizado" || p.estado === "cerrado").length,
    propuestas: filas.filter((p) => p.estado === "propuesta").length,
    presupuesto: MONEDAS.map((m) => m.v).filter((m) => porMoneda[m] !== undefined).map((m) => ({ moneda: m, monto: porMoneda[m] })),
    reservados: act.filter((p) => !p.ve_economia).length,
  };
}

// Filtros del listado.
export const FILTROS = [
  { v: "todos", l: "Todos" }, { v: "propuestas", l: "Propuestas" }, { v: "activos", l: "Activos" },
  { v: "atraso", l: "Con atraso" }, { v: "finalizados", l: "Finalizados" },
];
const sinTildes = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export function filtrar(filas, { filtro = "todos", texto = "", estado = "", responsable = "" } = {}) {
  const q = sinTildes(texto).trim();
  return filas.filter((p) => {
    if (filtro === "propuestas" && p.estado !== "propuesta") return false;
    if (filtro === "activos" && !ACTIVOS.includes(p.estado)) return false;
    if (filtro === "atraso" && !p.atrasado) return false;
    if (filtro === "finalizados" && !["finalizado", "cerrado"].includes(p.estado)) return false;
    if (estado && p.estado !== estado) return false;
    if (responsable && p.responsable_id !== responsable) return false;
    if (q && ![p.codigo, p.nombre, p.cliente_nombre, p.mandante_nombre, p.ubicacion, p.comuna, p.region].some((v) => sinTildes(v).includes(q))) return false;
    return true;
  });
}
// Orden del listado: con atraso primero, luego activos, propuestas, y el resto; dentro, por código descendente.
export function ordenar(filas) {
  const peso = (p) => (p.atrasado ? 0 : ACTIVOS.includes(p.estado) ? 1 : p.estado === "propuesta" ? 2 : p.estado === "finalizado" ? 3 : 4);
  return [...filas].sort((a, b) => peso(a) - peso(b) || String(b.codigo).localeCompare(String(a.codigo)));
}

// ── Actividades (vista pi_actividades_vista) ───────────────────────────────────────────────────
// Numeración EDT (1, 1.1, 1.1.1) según el árbol y el orden; la vista entrega nivel y ruta_orden.
export function numerarEDT(actividades) {
  const porPadre = new Map();
  for (const a of actividades) { const k = a.padre_id || ""; if (!porPadre.has(k)) porPadre.set(k, []); porPadre.get(k).push(a); }
  for (const l of porPadre.values()) l.sort((x, y) => (x.orden - y.orden) || String(x.creado_en || "").localeCompare(String(y.creado_en || "")) || String(x.id).localeCompare(String(y.id)));
  const out = [];
  const recorrer = (padre, prefijo) => (porPadre.get(padre) || []).forEach((a, i) => {
    const edt = prefijo ? `${prefijo}.${i + 1}` : String(i + 1);
    out.push({ ...a, edt }); recorrer(a.id, edt);
  });
  recorrer("", "");
  return out;
}
export const nivelMaximo = 3;

// ── Documentos ──────────────────────────────────────────────────────────────────────────────────
// Agrupa por documento (primera versión + sus versiones). Devuelve la versión vigente (o la última) y el resto.
export function agruparDocumentos(docs) {
  const grupos = new Map();
  for (const d of docs) { const k = d.documento_base_id || d.id; if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(d); }
  return [...grupos.values()].map((vs) => {
    vs.sort((a, b) => b.numero_version - a.numero_version);
    const actual = vs.find((v) => v.estado === "vigente") || vs[0];
    return { id: vs[vs.length - 1].id, actual, versiones: vs, anulado: actual.estado === "anulado" };
  }).sort((a, b) => String(b.actual.subido_en).localeCompare(String(a.actual.subido_en)));
}
// Ruta del archivo en el depósito: <proyecto_id>/<marca>-<nombre seguro> (lo valida pi_validar_documento).
export function rutaArchivo(proyectoId, nombre, marca = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`) {
  const base = String(nombre || "archivo").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/_+/g, "_").replace(/^[_.]+/, "").slice(-120) || "archivo";
  return `${proyectoId}/${marca}-${base}`;
}
export const extension = (nombre) => (String(nombre || "").match(/\.([A-Za-z0-9]{1,5})$/)?.[1] || "").toUpperCase();

// ── Historial (pi_historial) ───────────────────────────────────────────────────────────────────
const TABLAS = {
  pi_proyectos: "Proyecto", pi_proyectos_economia: "Datos económicos", pi_equipo: "Integrante", pi_actividades: "Actividad",
  pi_hitos: "Hito", pi_entregables: "Entregable", pi_documentos: "Documento", pi_clientes: "Cliente", pi_configuracion: "Configuración",
};
const ACCIONES = { crear: "creado", modificar: "modificado", eliminar: "eliminado" };
const FEM = new Set(["pi_actividades", "pi_configuracion"]);
export const CAMPOS = {
  nombre: "Nombre", descripcion: "Descripción", alcance_tecnico: "Alcance técnico", tipo: "Tipo", especialidades: "Especialidades",
  especialidad: "Especialidad", ubicacion: "Ubicación", comuna: "Comuna", region: "Región", responsable_id: "Responsable",
  estado: "Estado", motivo_estado: "Motivo", fecha_inicio_prevista: "Inicio previsto", fecha_termino_prevista: "Término previsto",
  fecha_inicio_real: "Inicio real", fecha_termino_real: "Término real", fecha_fin_prevista: "Fin previsto", fecha_fin_real: "Fin real",
  autorizado_por: "Autorizado por", autorizado_en: "Autorizado el", cliente_id: "Cliente", mandante_id: "Mandante",
  presupuesto_inicial: "Presupuesto inicial", moneda: "Moneda", rol_proyecto: "Rol", funcion: "Función", activo: "Activo",
  ve_economia: "Ve datos económicos", avance: "Avance", peso: "Peso", padre_id: "Actividad padre", orden: "Orden",
  fecha_prevista: "Fecha prevista", fecha_real: "Fecha real", actividad_id: "Actividad", codigo: "Código", revision: "Revisión",
  fecha_comprometida: "Fecha comprometida", fecha_entrega: "Fecha de entrega", hito_id: "Hito", titulo: "Título",
  categoria: "Categoría", motivo_anulacion: "Motivo de anulación", entregable_id: "Entregable", valor: "Valor", motivo: "Motivo",
};
const OMITIR = new Set(["id", "proyecto_id", "linea_negocio", "centro_costo", "creado_por", "creado_en", "subido_por", "subido_en", "ruta", "sha256", "tamano", "tipo_mime", "nombre_archivo", "documento_base_id", "numero_version", "oportunidad_id", "usuario_id", "clave"]);
const ESTADO_DOC_HISTORIAL = { vigente: "Vigente", reemplazado: "Reemplazado por una versión nueva", anulado: "Anulado" };
function valorLegible(campo, v, nombres, tabla) {
  if (v === null || v === undefined || v === "") return "—";
  if (tabla === "pi_documentos" && campo === "estado") return ESTADO_DOC_HISTORIAL[v] || String(v);
  if (typeof v === "boolean") return v ? "Sí" : "No";
  if (Array.isArray(v)) return v.map((x) => etiqueta(especialidadDe, x)).join(", ") || "—";
  if (campo === "estado") {
    const lista = { pi_proyectos: estadoDe, pi_actividades: estadoActividadDe, pi_entregables: estadoEntregableDe, pi_hitos: estadoHitoDe }[tabla];
    return (lista ? lista(v)?.l : null) || estadoDe(v)?.l || estadoActividadDe(v)?.l || estadoEntregableDe(v)?.l || estadoHitoDe(v)?.l || String(v);
  }
  if (campo === "tipo") return tipoDe(v)?.l || tipoEntregableDe(v)?.l || tipoHitoDe(v)?.l || String(v);
  if (campo === "rol_proyecto") return rolDe(v)?.l || String(v);
  if (campo === "categoria") return etiqueta(categoriaDocDe, v);
  if (campo === "especialidad") return etiqueta(especialidadDe, v);
  if (campo === "moneda") return v;
  if (campo === "presupuesto_inicial") return formatoMonto(v, "CLP").replace(/^\$/, "");
  if (["responsable_id", "autorizado_por"].includes(campo)) return nombres?.[v] || "otra persona";
  if (/^fecha|_en$/.test(campo) && /^\d{4}-\d{2}-\d{2}/.test(String(v))) return String(v).length > 10 ? new Date(v).toLocaleString("es-CL") : formatoFecha(v);
  if (["avance"].includes(campo)) return `${formatoPct(v)} %`;
  if (typeof v === "object") return JSON.stringify(v);
  const s = String(v);
  return s.length > 140 ? s.slice(0, 137) + "…" : s;
}
// Describe una fila del historial: { titulo, detalles: [{campo, antes, despues}] }.
export function describirHistorial(h, nombres = {}) {
  const sujeto = TABLAS[h.tabla] || h.tabla;
  const acc = ACCIONES[h.accion] || h.accion;
  const verbo = FEM.has(h.tabla) ? acc.replace(/o$/, "a") : acc;
  const c = h.cambios || {};
  if (h.accion === "crear" || h.accion === "eliminar") {
    const nombre = c.nombre || c.titulo || (h.tabla === "pi_equipo" ? nombres[c.usuario_id] : null) || c.codigo;
    const extra = h.tabla === "pi_documentos" && Number(c.numero_version) > 1 ? ` (versión ${c.numero_version})` : "";
    return { titulo: `${sujeto} ${verbo}${nombre ? `: ${nombre}` : ""}${extra}`, detalles: [] };
  }
  const detalles = Object.entries(c).filter(([k]) => !OMITIR.has(k)).map(([k, d]) => ({
    campo: CAMPOS[k] || k, antes: valorLegible(k, d?.antes, nombres, h.tabla), despues: valorLegible(k, d?.despues, nombres, h.tabla),
  }));
  return { titulo: `${sujeto} ${verbo}`, detalles };
}

// ── Mensajes de error de la base, legibles ──────────────────────────────────────────────────────
export function mensajeError(e) {
  const m = String(e?.message || e || "");
  if (/PI409|version_conflicto/.test(m)) return "Otra persona guardó cambios en este registro. Se recargaron los datos: revisa y vuelve a intentar.";
  if (/row-level security|permission denied|42501/.test(m) && !/PI|BFK/.test(m)) return "No tienes permiso para hacer este cambio.";
  if (/duplicate key.*pi_entregables_codigo|pi_entregables_codigo/.test(m)) return "Ya existe un entregable con ese código en el proyecto.";
  if (/pi_clientes_rut_unico/.test(m)) return "Ya existe un cliente con ese RUT.";
  if (/check constraint/.test(m)) return "Algún dato no cumple las reglas del proyecto. Revisa fechas, montos y textos.";
  return m.replace(/^.*?\bPI(?:_[A-Z]+)?:\s*/, "").replace(/^PI_[A-Z]+:\s*/, "") || "No se pudo guardar.";
}
