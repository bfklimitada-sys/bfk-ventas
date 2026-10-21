// ═══════════════════════════════════════════════════════════════
// Modelo tributario (Fase SII, 2026-10-07). Regla única para la app;
// la base aplica la misma en fin_facturas_vigentes / fin_monto_tributario.
//
// Cada fila de eventos_factura es UN documento tributario (DTE):
//   tipo_dte 33 factura afecta · 34 factura exenta · 56 nota de débito · 61 nota de crédito
//   (filas antiguas sin tipo = 33).
// Referencia SII de NC/ND: ref_folio (documento corregido) + ref_codigo:
//   1 = anula el documento · 2 = corrige texto (SIN efecto en monto ni vigencia)
//   3 = corrige montos (resta su monto al documento referenciado).
// Compatibilidad: una factura con factura_anulada_numero (reemisión antigua) anula
// a la factura de ese folio de la misma OC, como antes (equivale a código 1).
// ═══════════════════════════════════════════════════════════════

export const TIPOS_DTE = { 33: "Factura", 34: "Factura exenta", 56: "Nota de débito", 61: "Nota de crédito" };
export const CODIGOS_REF = { 1: "Anula documento", 2: "Corrige texto", 3: "Corrige montos" };

const txt = (v) => String(v ?? "").trim();
export const tipoDte = (e) => Number(e?.tipo_dte) || 33;
export const esNotaCredito = (e) => tipoDte(e) === 61;
export const esNotaDebito = (e) => tipoDte(e) === 56;
export const esFactura = (e) => !esNotaCredito(e) && !esNotaDebito(e);
export const codigoRef = (e) => Number(e?.ref_codigo) || null;

const documentos = (oc) => oc?.eventos_factura || [];

// Una factura está anulada si una NC código 1 la referencia, o si OTRA factura
// de la misma OC la declara anulada (reemisión antigua).
export const facturaEstaAnulada = (oc, f) => {
  if (!esFactura(f)) return false;
  const folio = txt(f.numero_factura);
  if (!folio) return false;
  return documentos(oc).some((d) =>
    (esNotaCredito(d) && codigoRef(d) === 1 && txt(d.ref_folio) === folio) ||
    (esFactura(d) && d.id !== f.id && txt(d.factura_anulada_numero) === folio));
};

export const facturasVigentesDe = (oc) => documentos(oc).filter((d) => esFactura(d) && !facturaEstaAnulada(oc, d));

// NC código 3 que corrigen montos de una factura vigente de la OC.
export const ncMontoAplicables = (oc) => {
  const vig = new Set(facturasVigentesDe(oc).map((f) => txt(f.numero_factura)));
  return documentos(oc).filter((d) => esNotaCredito(d) && codigoRef(d) === 3 && vig.has(txt(d.ref_folio)));
};
export const notasDebito = (oc) => documentos(oc).filter(esNotaDebito);

// Monto tributario vigente = facturas vigentes + notas de débito − NC que corrigen montos.
// Las NC código 1 ya quitaron la factura anulada; las código 2 no tienen efecto.
export const montoTributarioVigente = (oc) => {
  const fac = facturasVigentesDe(oc).reduce((s, f) => s + (Number(f.monto) || 0), 0);
  const nd = notasDebito(oc).reduce((s, d) => s + (Number(d.monto) || 0), 0);
  const nc = ncMontoAplicables(oc).reduce((s, d) => s + (Number(d.monto) || 0), 0);
  return fac + nd - nc;
};

// Estado visual de un documento dentro de su OC.
//  factura: vigente | anulada · NC: nc_anula | nc_texto | nc_monto | nc_sin_codigo · ND: nd
export const estadoDocumento = (oc, d) => {
  if (esNotaCredito(d)) {
    const c = codigoRef(d);
    return c === 1 ? "nc_anula" : c === 2 ? "nc_texto" : c === 3 ? "nc_monto" : "nc_sin_codigo";
  }
  if (esNotaDebito(d)) return "nd";
  return facturaEstaAnulada(oc, d) ? "anulada" : "vigente";
};

export const ETIQUETA_ESTADO = {
  vigente: "Vigente", anulada: "Anulada", nc_anula: "Anula factura", nc_texto: "Corrección de texto",
  nc_monto: "Corrección de monto", nc_sin_codigo: "NC sin código SII", nd: "Nota de débito",
};

// Efecto en monto de cada documento (para la cadena documental).
export const efectoMonto = (oc, d) => {
  const e = estadoDocumento(oc, d);
  if (e === "vigente" || e === "nd") return Number(d.monto) || 0;
  if (e === "nc_monto") return ncMontoAplicables(oc).some((x) => x.id === d.id) ? -(Number(d.monto) || 0) : 0;
  return 0; // anulada, nc_anula (el efecto es quitar la factura), nc_texto, nc_sin_codigo
};

// Cadena documental: cada factura seguida de las NC/ND que la referencian y de la
// factura que la reemplazó (si la hay). Documentos sueltos al final.
export const cadenaDocumental = (oc) => {
  const docs = documentos(oc).slice().sort((a, b) =>
    String(a.fecha || "").localeCompare(String(b.fecha || "")) ||
    txt(a.numero_factura).localeCompare(txt(b.numero_factura), "es", { numeric: true }));
  const usados = new Set();
  const grupos = [];
  for (const f of docs.filter(esFactura)) {
    if (usados.has(f.id)) continue;
    const grupo = [];
    let actual = f;
    while (actual && !usados.has(actual.id)) {
      usados.add(actual.id);
      grupo.push(actual);
      const folio = txt(actual.numero_factura);
      for (const r of docs) if (!usados.has(r.id) && !esFactura(r) && txt(r.ref_folio) === folio) { usados.add(r.id); grupo.push(r); }
      actual = docs.find((x) => esFactura(x) && !usados.has(x.id) && txt(x.factura_anulada_numero) === folio) || null;
    }
    grupos.push(grupo);
  }
  const sueltos = docs.filter((d) => !usados.has(d.id));
  if (sueltos.length) grupos.push(sueltos);
  return grupos;
};

// Etiqueta corta de un documento: "Factura 203", "NC 44".
export const nombreDocumento = (d) =>
  `${esNotaCredito(d) ? "NC" : esNotaDebito(d) ? "ND" : tipoDte(d) === 34 ? "Factura exenta" : "Factura"} ${txt(d.numero_factura) || "s/n"}`;

// ── Fase 1 de ventas exentas (20/10/2026): IVA por documento, sin suponer 19% donde el documento dice otra cosa ──
// Se reconoce una venta exenta SOLO por sus documentos ya registrados (DTE 34). Esto no habilita registrar
// facturas exentas nuevas: eso requiere la clasificación tributaria respaldada y aprobada (fase 2).
export const TASA_IVA = 0.19;
export const esFacturaExenta = (d) => tipoDte(d) === 34;
// IVA de UN documento (comisión de venta propia):
//  · DTE 33 o sin tipo (todo el historial): monto − monto/1,19, exactamente el cálculo anterior, aunque más
//    adelante se registre monto_iva (así ninguna comisión afecta pasada o futura cambia por este ajuste).
//  · DTE 34: el IVA registrado en el documento (monto_iva) si existe; si no, 0 (una factura exenta no lleva IVA).
export const ivaDeDocumento = (d) => {
  const m = Number(d?.monto) || 0;
  if (!esFacturaExenta(d)) return m - m / (1 + TASA_IVA);
  const iva = d?.monto_iva;
  return iva !== null && iva !== undefined && iva !== "" && Number.isFinite(Number(iva)) ? Number(iva) : 0;
};
// Tipo de venta según las facturas VIGENTES de la OC: "exenta" (todas DTE 34), "mixta" (33 y 34), "afecta" (sin DTE 34)
// o null (sin facturas vigentes: no se puede saber todavía; se mantiene el supuesto histórico de venta afecta).
export const tipoVentaPorDocumentos = (oc) => {
  const vig = facturasVigentesDe(oc);
  if (!vig.length) return null;
  const ex = vig.filter(esFacturaExenta).length;
  return ex === 0 ? "afecta" : ex === vig.length ? "exenta" : "mixta";
};
export const ventaExentaPorDocumentos = (oc) => tipoVentaPorDocumentos(oc) === "exenta";
// Neto de un monto de venta de la OC: si sus documentos la muestran exenta, el monto ya es neto (sin IVA).
export const netoDeVenta = (oc, monto) => (ventaExenta(oc) ? Number(monto) || 0 : (Number(monto) || 0) / (1 + TASA_IVA));
// ── Fase 3 (20/10/2026): facturación según la clasificación tributaria APROBADA de la OC ──
// OC exenta aprobada (tratamiento exento + clasificacion_id, copiados por la base al aprobar) → solo DTE 34.
// OC afecta (o sin clasificación: todo el historial) → solo DTE 33, registrada exactamente como antes.
export const esOCExentaAprobada = (oc) => ["exenta_fora", "exenta_otra"].includes(oc?.tratamiento_iva) && !!oc?.clasificacion_id;
export const tipoFacturaDeOC = (oc) => (esOCExentaAprobada(oc) ? 34 : 33);
// Venta exenta para pantallas: por su clasificación aprobada o (historial) por sus facturas DTE 34 vigentes.
export const ventaExenta = (oc) => esOCExentaAprobada(oc) || ventaExentaPorDocumentos(oc);
// Motivo por el que NO se puede registrar una factura nueva en la OC con el tipo que le corresponde (null = se puede).
export const bloqueoFacturaPorExenta = (oc) => {
  const vig = facturasVigentesDe(oc);
  if (esOCExentaAprobada(oc)) {
    const af = vig.filter((f) => !esFacturaExenta(f)).map((f) => f.numero_factura).filter(Boolean);
    return af.length ? `La OC está clasificada exenta pero tiene factura afecta vigente (N.º ${af.join(", ")}): anúlala con nota de crédito antes de registrar la factura exenta.` : null;
  }
  const t = tipoVentaPorDocumentos(oc);
  return t === "exenta" || t === "mixta"
    ? "Esta OC tiene una factura exenta (DTE 34) vigente pero no tiene una clasificación exenta aprobada: registrar otra factura la dejaría inconsistente. Solicita y aprueba la clasificación tributaria primero."
    : null;
};
// Validación del registro de una factura (la usa el formulario y, otra vez, el guardado). null = válido.
export function validarRegistroFactura(oc, { tipoDte = 33, numero, fecha, monto, confirmaEmitida } = {}) {
  const b = bloqueoFacturaPorExenta(oc); if (b) return b;
  const esperado = tipoFacturaDeOC(oc);
  if (Number(tipoDte) === 34 && esperado !== 34) return "Esta OC no tiene una clasificación exenta aprobada: no se puede registrar una factura exenta (DTE 34).";
  if (Number(tipoDte) !== 34 && esperado === 34) return "Esta OC está clasificada exenta: solo admite factura exenta (DTE 34).";
  if (!String(numero || "").trim()) return "Indica el número de factura";
  if (esperado === 34 && !String(fecha || "").trim()) return "Indica la fecha de emisión de la factura exenta";
  if (!(Number(monto) > 0)) return "Indica el monto";
  if (esperado === 34 && !confirmaEmitida) return "Confirma que la factura exenta ya fue emitida en el SII (BFK solo la registra; no la emite).";
  return null;
}
// Fila a insertar en eventos_factura para una factura exenta (DTE 34): monto exento = monto, IVA de venta = 0 y la
// referencia a la clasificación tributaria de la OC (fundamento y respaldo quedan en la clasificación aprobada).
export const camposFacturaExenta = (oc, monto) => ({
  tipo_dte: 34, monto_exento: Number(monto) || 0, monto_iva: 0,
  notas: `DTE 34 exenta · ${oc?.fundamento_iva || "clasificación aprobada"} · clasificación ${oc?.clasificacion_id || "—"}`.slice(0, 500),
});
