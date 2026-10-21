// Vendedor responsable de una cotización (21/10/2026). Reglas de PRESENTACIÓN; la base las vuelve a exigir
// (disparador cz_vendedor_responsable, migración BORRADOR-2026-10-21-vendedor-responsable).
//  · Borrador / lista: el vendedor es opcional.
//  · Presentar o adjudicar exige vendedor responsable (las presentadas históricas sin vendedor se pueden seguir editando).
//  · En una cotización presentada o adjudicada con vendedor, solo un administrador lo cambia (queda en la bitácora).
//  · Nunca se asigna solo: el usuario lo elige.
export const ESTADOS_CON_VENDEDOR = ["presentada", "adjudicada"];
export const exigeVendedor = (estado) => ESTADOS_CON_VENDEDOR.includes(estado);
const vacio = (v) => !String(v ?? "").trim();

// Mensaje si el guardado debe bloquearse (null si se puede guardar). guardada = lo último guardado ({estado, vendedor_id}).
export function bloqueoPorVendedor(cot, guardada = null) {
  if (!exigeVendedor(cot?.estado) || !vacio(cot?.vendedor_id)) return null;
  const cambiaEstado = !guardada || guardada.estado !== cot.estado;
  const quitaVendedor = !!guardada && !vacio(guardada.vendedor_id);
  if (!cambiaEstado && !quitaVendedor) return null;   // histórica presentada sin vendedor: se puede seguir editando
  return `No se puede ${cot.estado === "adjudicada" ? "adjudicar" : "presentar"} una cotización sin vendedor responsable. Elígelo en Datos.`;
}

// ¿El selector de vendedor queda bloqueado para este usuario?
export const vendedorProtegido = (guardada, esAdmin) => !esAdmin && !!guardada && exigeVendedor(guardada.estado) && !vacio(guardada.vendedor_id);

// Mensaje legible de los errores del servidor (CZ_VENDEDOR: …).
export const mensajeVendedor = (e) => String(e?.message || e || "").replace(/^CZ_VENDEDOR:\s*/, "");

// Relación entre la OC y su cotización adjudicada (vínculo explícito oc_codigo = número de la OC).
// vendedoresBFK: catálogo de vendedores de BFK (los de Cotizaciones «cz:…» no existen en las OC).
export function vendedorCotizacionParaOC(oc, cotizaciones, vendedoresBFK = []) {
  const norm = (x) => String(x || "").trim().toUpperCase();
  const vinc = (cotizaciones || []).filter((c) => c.estado === "adjudicada" && norm(c.oc_codigo) && norm(c.oc_codigo) === norm(oc?.numero_oc));
  if (!vinc.length) return { estado: "sin_cotizacion" };
  if (vinc.length > 1) return { estado: "ambigua", n: vinc.length };
  const cot = vinc[0];
  if (vacio(cot.vendedor_id)) return { estado: "sin_vendedor", cot };
  if (oc?.vendedor_id) return { estado: String(oc.vendedor_id) === String(cot.vendedor_id) ? "igual" : "diferente", cot };
  if (oc?.capitalizacion_bfk) return { estado: "diferente", cot };
  if (!(vendedoresBFK || []).some((v) => String(v.id) === String(cot.vendedor_id))) return { estado: "solo_cotizaciones", cot };
  return { estado: "transferible", cot };
}
