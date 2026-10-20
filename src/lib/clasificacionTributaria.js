// ═══════════════════════════════════════════════════════════════
// Clasificación tributaria de cotizaciones y OC (fase 2 de ventas exentas, 20/10/2026).
// La base (migración 2026-10-20-clasificacion-tributaria, aplicada el 20/10/2026) es la única que decide: guarda el historial en
// trib_clasificaciones y copia a la cotización/OC SOLO lo aprobado por un administrador. Aquí: lectura, textos y
// validaciones previas (las mismas reglas que la base, para avisar antes de enviar).
//  · Sin clasificación (null) = afecta histórica: todas las OC y cotizaciones existentes.
//  · Un impuesto $0 en Mercado Público nunca clasifica nada (solo puede impedir una exención si informa impuestos).
//  · Esta fase NO habilita facturas DTE 34 ni cambia la fórmula de las cotizaciones.
// ═══════════════════════════════════════════════════════════════
import { facturasVigentesDe, tipoDte } from "./tributario.js";

export const TRATAMIENTOS = {
  afecta: { etiqueta: "Afecta (IVA 19%)", corta: "Afecta", factura: "DTE 33", exenta: false },
  exenta_fora: { etiqueta: "Exenta FO.R.A. (art. 101, Ley 18.948)", corta: "Exenta FO.R.A.", factura: "DTE 34", exenta: true,
    fundamentoSugerido: "Art. 101 de la Ley N.º 18.948 (Fondo Rotativo de Abastecimiento)",
    respaldoAyuda: "Bases u OC que indiquen pago con FO.R.A. y acreditación de la institución (certificado, resolución o mención en la OC)." },
  exenta_otra: { etiqueta: "Exenta (otra exención legal)", corta: "Exenta (otra)", factura: "DTE 34", exenta: true,
    respaldoAyuda: "Norma citada y documento que la acredita; requiere visto bueno del contador." },
};
export const ESTADOS_SOLICITUD = { pendiente: "Pendiente de aprobación", aprobada: "Aprobada", rechazada: "Rechazada", anulada: "Anulada", reemplazada: "Reemplazada" };

export const tratamientoDe = (obj) => obj?.tratamiento_iva || "afecta";
export const esClasificacionHistorica = (obj) => !obj?.tratamiento_iva;
export const esExentaClasificada = (obj) => !!TRATAMIENTOS[obj?.tratamiento_iva]?.exenta;
export const etiquetaTratamiento = (obj) => esClasificacionHistorica(obj) ? "Afecta (sin clasificación: registro histórico)" : TRATAMIENTOS[tratamientoDe(obj)]?.etiqueta || obj.tratamiento_iva;

// Historial de un objetivo (más reciente primero) y su solicitud pendiente.
export const historialDe = (lista, ambito, id) => (lista || [])
  .filter((h) => h.ambito === ambito && String(ambito === "oc" ? h.oc_id : h.cotizacion_id) === String(id))
  .sort((a, b) => String(b.solicitado_en).localeCompare(String(a.solicitado_en)));
export const pendienteDe = (lista, ambito, id) => historialDe(lista, ambito, id).find((h) => h.estado === "pendiente") || null;

// Mismas reglas que trib_motivo_incompatible (la base vuelve a comprobarlas al solicitar y al aprobar).
export function motivoIncompatibleOC(oc, tratamiento, procedimiento) {
  const vig = facturasVigentesDe(oc);
  const af = vig.filter((f) => tipoDte(f) === 33).map((f) => f.numero_factura).filter(Boolean);
  const ex = vig.filter((f) => tipoDte(f) === 34).map((f) => f.numero_factura).filter(Boolean);
  if (oc?.archivada) return "La OC está archivada.";
  if (TRATAMIENTOS[tratamiento]?.exenta && af.length) return `La OC tiene factura afecta vigente (N.º ${af.join(", ")}). Anúlala con nota de crédito (código 1) antes de clasificarla como exenta.`;
  if (tratamiento === "afecta" && ex.length) return `La OC tiene factura exenta vigente (N.º ${ex.join(", ")}). Anúlala con nota de crédito (código 1) antes de clasificarla como afecta.`;
  if ((oc?.eventos_factura || []).length && String(procedimiento || "").trim().length < 10) return "La OC ya tiene documentos SII: describe el procedimiento documental (notas de crédito y facturas que respaldan el cambio).";
  const ivaMP = Number(oc?.mp?.iva);
  if (TRATAMIENTOS[tratamiento]?.exenta && ivaMP > 0) return `Mercado Público informa impuestos de $${ivaMP.toLocaleString("es-CL")} en esta OC: no corresponde una exención.`;
  return null;
}

// Validación del formulario antes de enviar (la base aplica las mismas restricciones).
export function validarSolicitud(f, { actual = null, ambito, oc = null } = {}) {
  const t = TRATAMIENTOS[f?.tratamiento];
  if (!t) return "Elige el tratamiento tributario.";
  if ((actual || "afecta") === f.tratamiento) return "Ese ya es el tratamiento vigente.";
  if (t.exenta) {
    if (String(f.fundamento_legal || "").trim().length < 10) return "Indica el fundamento legal de la exención (mínimo 10 caracteres).";
    if (String(f.respaldo_descripcion || "").trim().length < 10) return "Describe qué acredita el respaldo (mínimo 10 caracteres).";
    if (String(f.respaldo_documento || "").trim().length < 3) return "Adjunta el documento de respaldo o indica su referencia.";
  }
  if (ambito === "oc" && oc) return motivoIncompatibleOC(oc, f.tratamiento, f.procedimiento_documental);
  return null;
}

// Cotización adjudicada vinculada a una OC (mismo vínculo explícito oc_codigo que usa Compras).
const normalCodigo = (t) => String(t || "").replace(/^[Nn][ºo°]\s*/, "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
export const cotizacionVinculadaA = (oc, cotizaciones) => {
  const c = (cotizaciones || []).filter((x) => x.estado === "adjudicada" && normalCodigo(x.oc_codigo) && normalCodigo(x.oc_codigo) === normalCodigo(oc?.numero_oc));
  return c.length === 1 ? c[0] : null;
};

