// Pruebas unitarias de la lógica de presentación de contactos institucionales (src/lib/contactosInstitucionales.js).
import { claveInstitucion, contactosDeInstitucion, correoSugerido, avisosConciliacion, validarContacto, ordenarContactos, mensajeErrorContacto } from "../../src/lib/contactosInstitucionales.js";
let nOk = 0; const F = [];
const ok = (k, v, d) => { if (v) { nOk++; console.log("OK    " + k); } else { F.push(k); console.log("FALLA " + k + (d !== undefined ? " :: " + JSON.stringify(d).slice(0, 300) : "")); } };
const A = "991112227";
const c = (o) => ({ id: o.id, rut_clave: A, rut: "99.111.222-7", nombre: "", correo: "", estado: "vigente", origen: "mp", alcance: "institucion", confirmado_manual: false, es_principal: false, ...o });
const L = [
  c({ id: "1", nombre: "Ana", correo: "ana.vieja@a.cl", estado: "obsoleto", reemplazado_por: "2" }),
  c({ id: "2", nombre: "Ana", correo: "ana@a.cl", confirmado_manual: true, ultima_oc_fecha: "2026-05-01" }),
  c({ id: "3", nombre: "Bruno", correo: "bruno@a.cl", ultima_oc_fecha: "2026-06-01" }),
  c({ id: "4", nombre: "Ana", correo: "ana@otro.cl", estado: "pendiente", motivo_pendiente: "contradice_manual", conflicto_con: "2" }),
  c({ id: "5", nombre: "Elena", correo: "elena@a.cl", alcance: "oc", oc_exclusiva: "ocX", confirmado_manual: true }),
  c({ id: "6", rut_clave: "991113339", nombre: "Otra", correo: "otra@b.cl" }),
];
ok("U01_clave_institucion_formatos", claveInstitucion("99.111.222-7") === A && claveInstitucion("99111222-7") === A && claveInstitucion("991112227") === A);
ok("U02_clave_rut_invalido_null", claveInstitucion("99.111.222-1") === null && claveInstitucion("") === null);
const deA = contactosDeInstitucion(L, "99111222-7", "ocY");
ok("U03_solo_la_institucion_y_sin_exclusivos_ajenos", deA.length === 4 && !deA.some((x) => x.id === "5" || x.id === "6"));
ok("U04_exclusivo_visible_en_su_oc", contactosDeInstitucion(L, "99111222-7", "ocX").some((x) => x.id === "5"));
ok("U05_orden_vigentes_confirmados_primero_obsoletos_al_final", deA[0].id === "2" && deA.at(-1).id === "1");
ok("U06_oc_con_su_correo_vigente_lo_conserva", correoSugerido(L, { id: "ocY", rut_cliente: "99.111.222-7", correo_cliente: "Bruno@A.cl" }).correo === "bruno@a.cl");
const s7 = correoSugerido(L, { id: "ocY", rut_cliente: "99.111.222-7", correo_cliente: "ana.vieja@a.cl" });
ok("U07_correo_obsoleto_usa_su_reemplazo_y_avisa", s7.correo === "ana@a.cl" && s7.motivo === "reemplaza_obsoleto" && s7.obsoleto?.id === "1");
const s8 = correoSugerido(L, { id: "ocY", rut_cliente: "99.111.222-7", correo_cliente: "ana@otro.cl" });
ok("U08_correo_pendiente_contra_confirmado_usa_el_confirmado", s8.correo === "ana@a.cl" && s8.motivo === "pendiente_usa_confirmado");
ok("U09_oc_sin_correo_usa_confirmado", correoSugerido(L, { id: "ocY", rut_cliente: "99.111.222-7", correo_cliente: "" }).correo === "ana@a.cl");
ok("U10_exclusivo_tiene_prioridad_en_su_oc", correoSugerido(L, { id: "ocX", rut_cliente: "99.111.222-7", correo_cliente: "bruno@a.cl" }).correo === "elena@a.cl");
ok("U11_correo_desconocido_de_la_oc_se_respeta", correoSugerido(L, { id: "ocY", rut_cliente: "99.111.222-7", correo_cliente: "nuevo@a.cl" }).correo === "nuevo@a.cl");
ok("U12_otra_institucion_no_mezcla", correoSugerido(L, { id: "ocZ", rut_cliente: "99.111.333-9", correo_cliente: "" }).correo === "otra@b.cl");
ok("U13_sin_rut_valido_solo_el_de_la_oc", correoSugerido(L, { id: "ocZ", rut_cliente: "", correo_cliente: "x@y.cl" }).correo === "x@y.cl");
const av = avisosConciliacion({ resultados: [{ accion: "conflicto_manual", correo: "ana@otro.cl" }, { accion: "existente", difiere_de_manual: true }, { accion: "nuevo" }] });
ok("U14_avisos_conflicto_y_difiere", av.length === 2 && /confirmado manualmente/.test(av[0]) && /se conserva el manual/.test(av[1]));
ok("U15_sin_avisos_si_todo_normal", avisosConciliacion({ resultados: [{ accion: "existente" }, { accion: "nuevo" }] }).length === 0 && avisosConciliacion(null).length === 0);
ok("U16_validacion", validarContacto({}) !== "" && validarContacto({ correo: "a@b.cl, c@d.cl" }) !== "" && validarContacto({ correo: "a@b.cl" }) === "" && validarContacto({ nombre: "Solo nombre" }) === "");
ok("U17_mensaje_error_legible", mensajeErrorContacto(new Error("CONTACTO_DUPLICADO: ese correo ya está registrado para esta institución")) === "Ese correo ya está registrado para esta institución");
ok("U18_ordenar_no_muta", (() => { const x = [L[0], L[1]]; ordenarContactos(x); return x[0].id === "1"; })());
console.log(`RESUMEN pruebas contactos institucionales (unitarias): ${nOk} OK, ${F.length} FALLA(S)`);
process.exit(F.length ? 1 : 0);
