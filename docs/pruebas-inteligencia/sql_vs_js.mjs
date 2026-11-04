// Comprueba que la vista ic_oportunidades y la función ic_resumen (PostgreSQL) dan EXACTAMENTE lo mismo que
// construirOportunidades / filtrarOportunidades / resumirOportunidades (src/lib/inteligenciaComercial.js) sobre los
// mismos datos. Una sola regla de negocio: si alguna difiere, la prueba falla.
// Uso (lo llama validar_sql.sh): PGHOST=<dir> PGPORT=<puerto> node sql_vs_js.mjs <uid-admin>
import { execFileSync } from "node:child_process";
import { construirOportunidades, filtrarOportunidades, resumirOportunidades, periodoDe } from "../../src/lib/inteligenciaComercial.js";

const UID = process.argv[2];
const q = (sql, comoUsuario = true) => {
  const pre = comoUsuario ? `set role authenticated; set prueba.uid = '${UID}'; set request.jwt.claims = '{"sub":"${UID}","role":"authenticated"}';` : "";
  const r = execFileSync("psql", ["-U", "postgres", "-d", "postgres", "-qAt", "-v", "ON_ERROR_STOP=1", "-c", pre + sql], { encoding: "utf8" });
  return JSON.parse(r.trim() || "null");
};
let F = 0, N = 0;
const ok = (k, c, d) => { N++; if (c) console.log("OK    " + k); else { F++; console.log("FALLA " + k + (d ? " :: " + JSON.stringify(d).slice(0, 900) : "")); } };
const norm = (v) => {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v.map(norm);
  if (typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, norm(v[k])]));
  if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return new Date(v).toISOString();
  return v;
};
const igual = (a, b) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));
const difs = (a, b) => Object.keys({ ...a, ...b }).filter((k) => !igual(a[k], b[k])).map((k) => ({ k, sql: a[k], js: b[k] }));

const cot = q("select coalesce(json_agg(c), '[]') from public.cotizaciones c");
const ver = q("select coalesce(json_agg(json_build_object('cotizacion_id', v.cotizacion_id, 'estado', v.contenido->>'estado', 'guardado_en', v.guardado_en)), '[]') from public.cotizacion_versiones v");
const res = q("select coalesce(json_agg(r), '[]') from public.ic_resultados r");
const js = construirOportunidades(cot, ver, res);
const sql = q("select coalesce(json_agg(o order by o.clave), '[]') from public.ic_oportunidades o");
ok("V01_misma_cantidad_de_oportunidades", sql.length === js.length, { sql: sql.length, js: js.length });
const porClave = new Map(js.map((o) => [o.clave, o]));
let iguales = 0;
for (const s of sql) { const j = porClave.get(s.clave); const d = j ? difs(s, j) : [{ k: "falta_en_js" }]; if (!d.length) iguales++; else ok(`V02_oportunidad_${s.clave}`, false, d); }
ok(`V02_oportunidades_identicas_${iguales}_de_${sql.length}`, iguales === sql.length && sql.length === js.length);

const casos = [
  { n: "todo", f: {} },
  { n: "octubre_2026", f: periodoDe({ tipo: "mes", anio: 2026, mes: 10 }) },
  { n: "noviembre_2026", f: periodoDe({ tipo: "mes", anio: 2026, mes: 11 }) },
  { n: "anio_2026", f: periodoDe({ tipo: "anio", anio: 2026 }) },
  { n: "anio_2025_vacio", f: periodoDe({ tipo: "anio", anio: 2025 }) },
  { n: "rango_10_al_25_oct", f: periodoDe({ tipo: "rango", desde: "2026-10-10", hasta: "2026-10-25" }) },
  { n: "rango_invertido", f: periodoDe({ tipo: "rango", desde: "2026-10-25", hasta: "2026-10-10" }) },
  { n: "institucion_hospital_sin_tilde", f: { institucion: "hospital de los angeles" } },
  { n: "institucion_espacios", f: { institucion: "  municipalidad   de laja " } },
  { n: "vendedor_uno", f: { vendedor: "vendedor uno" } },
  { n: "vendedora_dos_octubre", f: { vendedor: "Vendedora Dos", ...periodoDe({ tipo: "mes", anio: 2026, mes: 10 }) } },
  { n: "sin_vendedor", f: { vendedor: "__sin__" } },
  { n: "solo_perdidas", f: { resultado: "perdida" } },
  { n: "solo_pendientes", f: { resultado: "pendiente" } },
  { n: "solo_ganadas_noviembre", f: { resultado: "ganada", ...periodoDe({ tipo: "mes", anio: 2026, mes: 11 }) } },
];
const lit = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);
for (const c of casos) {
  const f = c.f;
  const s = q(`select public.ic_resumen(${lit(f.desde)}::date, ${lit(f.hasta)}::date, ${lit(f.institucion || "")}, ${lit(f.vendedor || "")}, ${lit(f.resultado || "")})`);
  const j = resumirOportunidades(filtrarOportunidades(js, f), { desde: f.desde || null, hasta: f.hasta || null });
  const sComp = { ...s }; delete sComp.ultima_sincronizacion; delete sComp.ultima_consulta;
  const jComp = { ...j }; delete jComp.ultima_consulta;
  const d = ["periodo", "indicadores", "por_mes", "competidores", "distribucion", "fuente"].filter((k) => !igual(sComp[k], jComp[k]));
  ok(`R_${c.n}`, !d.length, d.map((k) => ({ k, sql: sComp[k], js: jComp[k] })));
}

// Detalle paginado: mismo total, mismas filas y mismo orden (columnas numéricas y de fecha; el orden de textos depende
// de la intercalación de la base y se comprueba solo por pertenencia).
const detalles = [
  { n: "fecha_desc_p1", f: {}, o: { orden: "fecha_presentacion", desc: true, pagina: 0, porPagina: 5 } },
  { n: "fecha_desc_p2", f: {}, o: { orden: "fecha_presentacion", desc: true, pagina: 1, porPagina: 5 } },
  { n: "oferta_asc_octubre", f: periodoDe({ tipo: "mes", anio: 2026, mes: 10 }), o: { orden: "oferta_total", desc: false, pagina: 0, porPagina: 50 } },
  { n: "diferencia_desc_nulos_al_final", f: {}, o: { orden: "diferencia", desc: true, pagina: 0, porPagina: 50 } },
  { n: "adjudicado_asc", f: {}, o: { orden: "adjudicado_total", desc: false, pagina: 0, porPagina: 50 } },
  { n: "busqueda_competidor", f: {}, o: { q: "comercial  sur", orden: "fecha_presentacion", desc: true, pagina: 0, porPagina: 50 } },
  { n: "busqueda_rut_y_resultado", f: { resultado: "perdida" }, o: { q: "77.888", orden: "fecha_presentacion", desc: false, pagina: 0, porPagina: 50 } },
  { n: "busqueda_institucion_tilde", f: {}, o: { q: "angeles", orden: "fecha_presentacion", desc: true, pagina: 0, porPagina: 50 } },
  { n: "columna_no_permitida", f: {}, o: { orden: "cotizacion_id; drop table x", desc: true, pagina: 0, porPagina: 50 } },
];
const { ordenarPaginar } = await import("../../src/lib/inteligenciaComercial.js");
for (const c of detalles) {
  const f = c.f, o = c.o;
  const s = q(`select public.ic_detalle(${lit(f.desde)}::date, ${lit(f.hasta)}::date, ${lit(f.institucion || "")}, ${lit(f.vendedor || "")}, ${lit(f.resultado || "")}, ${lit(o.q || "")}, ${lit(o.orden)}, ${o.desc}, ${o.porPagina}, ${o.pagina * o.porPagina})`);
  const j = ordenarPaginar(filtrarOportunidades(js, f), o);
  const okFilas = s.filas.length === j.filas.length && s.filas.every((x, i) => igual(x, j.filas[i]));
  ok(`D_${c.n}`, s.total === j.total && okFilas, { total: [s.total, j.total], sql: s.filas.map((x) => x.clave), js: j.filas.map((x) => x.clave) });
}
console.log(`sql_vs_js: ${N - F}/${N} correctas`);
process.exit(F ? 1 : 0);
