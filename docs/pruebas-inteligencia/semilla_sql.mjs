// Genera el SQL de la semilla ficticia (cotizaciones, productos y versiones) y, con «--resultados», las llamadas a
// ic_registrar_resultado con los parámetros que arma el MISMO código del servidor (normalizarResultadoMP).
// Uso: node semilla_sql.mjs > semilla.sql · node semilla_sql.mjs --resultados > resultados.sql
import { COTIZACIONES, VENDEDORES, filaCotizacion, versionesDe, respuestasMP } from "./fixture.mjs";
import { normalizarResultadoMP } from "../../src/lib/inteligenciaComercial.js";

const lit = (v) => (v === null || v === undefined ? "null" : typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const out = [];
if (process.argv.includes("--resultados")) {
  for (const [codigo, r] of Object.entries(respuestasMP())) {
    const p = normalizarResultadoMP(codigo, r.listado, r.detalle, { detalleError: r.detalleFalla ? "HTTP 504 (simulado)" : "" });
    out.push(`select public.ic_registrar_resultado(${lit(JSON.stringify(p))}::jsonb);`);
  }
} else {
  for (const v of VENDEDORES) out.push(`insert into public.vendedores (id, nombre, comision_pct, activo) values (${lit(v.id)}, ${lit(v.nombre)}, 10, true) on conflict (id) do nothing;`);
  for (const c of COTIZACIONES) {
    const f = filaCotizacion(c);
    out.push(`insert into public.cotizaciones (id, id_externo, nombre, institucion, rut, fecha, estado, subtotal_neto, impuestos, total, oc_codigo, vendedor_id, vendedor_nombre, actualizado_en, version, creado_por)
      values (${lit(f.id)}, ${lit(f.id_externo)}, ${lit(f.nombre)}, ${lit(f.institucion)}, ${lit(f.rut)}, ${lit(f.fecha)}, ${lit(f.estado)}, ${f.subtotal_neto}, ${f.impuestos}, ${f.total}, ${lit(f.oc_codigo)}, ${lit(f.vendedor_id)}, ${lit(f.vendedor_nombre)}, ${lit(f.actualizado_en)}, ${f.version}, '22222222-2222-2222-2222-222222222222');`);
    for (let i = 1; i <= (c.items || 1); i++)
      out.push(`insert into public.cotizacion_items (cotizacion_id, orden, cantidad, unitario_venta_neto, especificaciones_aprobadas) values (${lit(c.id)}, ${i}, 1, ${Math.round(c.neto / (c.items || 1))}, '{"nombre":"Producto ficticio ${i}"}');`);
    for (const v of versionesDe(c))
      out.push(`insert into public.cotizacion_versiones (cotizacion_id, version, contenido, guardado_por, guardado_en) values (${lit(v.cotizacion_id)}, ${v.version}, ${lit(JSON.stringify({ estado: v.estado, id_externo: c.codigo }))}::jsonb, '22222222-2222-2222-2222-222222222222', ${lit(v.guardado_en)});`);
  }
}
console.log(out.join("\n"));
