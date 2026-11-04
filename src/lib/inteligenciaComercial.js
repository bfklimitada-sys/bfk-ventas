// ═══════════════════════════════════════════════════════════════
// Inteligencia Comercial de Compra Ágil (04/11/2026). SOLO ANÁLISIS: no modifica cotizaciones, OCs ni finanzas.
//
// Unidad de análisis: la OPORTUNIDAD = un código de Compra Ágil (id_externo de la cotización). Una cotización con
// varios productos cuenta UNA vez; si hay varias cotizaciones con el mismo código se toma una sola (la más avanzada:
// adjudicada > no adjudicada > presentada; luego la última actualizada). Sin código, cada cotización es su propia
// oportunidad (no se puede consultar en ChileCompra).
// Ofertas efectivamente presentadas: cotizaciones en estado presentada, adjudicada o no adjudicada. Borradores, listas y
// descartadas NO cuentan. Si ChileCompra informa (detalle) que BFK no figura entre las ofertas recibidas, la
// oportunidad queda como «sin_oferta_bfk» y no se cuenta como presentada.
// Resultado comercial (analítico; nunca reemplaza el estado de la cotización):
//   1) cotización adjudicada → ganada · 2) cotización no adjudicada → perdida (registro BFK)
//   3) resultado externo verificado (ganada, perdida, desierta, cancelada, sin_oferta_bfk) · 4) si no → pendiente.
// Tasa de éxito = ganadas / (ganadas + perdidas) × 100. Pendientes, desiertas y canceladas no cuentan como pérdidas.
// Comparación de precios: solo oportunidades PERDIDAS con adjudicatario y monto conocidos, en CLP y con la MISMA base
// tributaria (afecta/afecta o exenta/exenta). Se compara el TOTAL a pagar por el comprador: BFK (neto + IVA, despacho
// incluido en los unitarios, modalidad A) vs adjudicado (neto + impuesto + despacho informado por ChileCompra).
// Nunca se usa el presupuesto del comprador.
//
// Esta lógica es la MISMA que la vista ic_oportunidades y la función ic_resumen de
// docs/migraciones/BORRADOR-2026-11-04-inteligencia-comercial.sql (la prueba sql_vs_js lo comprueba). La versión en
// JavaScript se usa (a) en el servidor para normalizar la respuesta de ChileCompra y (b) en el navegador cuando la
// migración todavía no está instalada (solo con los estados de las cotizaciones: sin resultados externos).
// ═══════════════════════════════════════════════════════════════

export const RUT_BFK = "77.322.317-3";
export const ESTADOS_PRESENTADOS = ["presentada", "adjudicada", "no_adjudicada"];
// Colores validados (dataviz validate_palette: claridad, croma, daltonismo y separación normal). Desierta y cancelada
// comparten el gris neutro «otras» y siempre llevan etiqueta (el color nunca es la única señal).
export const RESULTADOS = {
  ganada: { label: "Ganada", tono: "ok", color: "#059669" },
  perdida: { label: "Perdida", tono: "danger", color: "#DC2626" },
  pendiente: { label: "Pendiente", tono: "warn", color: "#CA8A04" },
  desierta: { label: "Desierta", tono: "neutro", color: "#64748B" },
  cancelada: { label: "Cancelada", tono: "neutro", color: "#64748B" },
  sin_oferta_bfk: { label: "BFK no figura entre las ofertas", tono: "info", color: "#2A78D6" },
};
export const ESTADOS_PROCESO = ["publicada", "cerrada", "proveedor_seleccionado", "oc_emitida", "desierta", "cancelada", "no_encontrada", "sin_informacion"];
export const RESULTADOS_EXTERNOS = ["pendiente", "ganada", "perdida", "desierta", "cancelada", "sin_informacion", "sin_oferta_bfk"];
export const FINALES = ["ganada", "perdida", "desierta", "cancelada", "sin_oferta_bfk"];
export const NO_DISPONIBLE = "Información no disponible";
export const POR_VERIFICAR = "Resultado pendiente de verificar";
export const FUENTE_OFICIAL = "API Compra Ágil v2 (ChileCompra)";

// RUT sin puntos ni guion, en mayúsculas ("77.322.317-3" → "773223173"). Igual que ic_rut_norm() en SQL.
export const rutNorm = (r) => String(r ?? "").replace(/[^0-9kK]/g, "").toUpperCase();
export const RUT_BFK_NORM = rutNorm(RUT_BFK);
export const codigoNorm = (c) => String(c ?? "").trim().toUpperCase();
export const esCodigoCompraAgil = (c) => /^\d{1,10}-\d{1,6}-COT\d{2}$/.test(codigoNorm(c));
export const enlaceMP = (codigo) => (esCodigoCompraAgil(codigo) ? `https://buscador.mercadopublico.cl/ficha?code=${encodeURIComponent(codigoNorm(codigo))}` : "");
const num = (v) => { if (v === null || v === undefined || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const txt = (v) => (v === null || v === undefined ? "" : String(v).trim());

// ── Normalización de la respuesta oficial (servidor) ─────────────────────────
const POR_ID = { 2: "publicada", 3: "cerrada", 4: "proveedor_seleccionado", 5: "desierta", 6: "cancelada", 7: "oc_emitida" };
export function estadoProcesoDe(estado) {
  if (estado === null || estado === undefined) return "sin_informacion";
  if (typeof estado === "number") return POR_ID[estado] || "sin_informacion";
  const id = num(estado.id_estado ?? estado.id); const cod = txt(estado.codigo ?? estado.glosa ?? (typeof estado === "string" ? estado : "")).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[\s/]+/g, "_");
  if (/^oc_?emitida$|orden_de_compra/.test(cod)) return "oc_emitida";
  if (/proveedor_seleccionado|adjudicada/.test(cod)) return "proveedor_seleccionado";
  for (const e of ["publicada", "cerrada", "desierta", "cancelada"]) if (cod.startsWith(e)) return e;
  return (id && POR_ID[id]) || "sin_informacion";
}
const seleccionada = (q) => q?.proveedor_seleccionado === 1 || q?.proveedor_seleccionado === true || q?.proveedor_seleccionado === "1" || q?.seleccion?.proveedor_seleccionado === true || q?.seleccion?.proveedor_seleccionado === 1;
export function baseTributariaDe(impuesto, porcentaje) {
  const i = num(impuesto), p = num(porcentaje);
  if (i === null && p === null) return "desconocida";
  if ((i ?? 0) > 0 || (p ?? 0) > 0) return "afecta";
  return "exenta";
}

// item: elemento de payload.items del LISTADO oficial (siempre). detalle: payload del DETALLE (o null si no respondió).
// Devuelve el parámetro de ic_registrar_resultado. Lo que ChileCompra no entrega queda null (no se inventa).
export function normalizarResultadoMP(codigo, item, detalle = null, { detalleError = "" } = {}) {
  const fuente = item?.estado !== undefined || item?.codigo ? item : (detalle || {});
  const estado_proceso = estadoProcesoDe(fuente?.estado ?? detalle?.estado);
  const fec = { ...(detalle?.fechas || {}), ...(item?.fechas || {}) };
  const mot = { ...(detalle?.motivos || {}), ...(item?.motivos || {}) };
  const res = { ...(detalle?.resumen || {}), ...(item?.resumen || {}) };
  const p = {
    codigo: codigoNorm(codigo), consulta_estado: "ok", consulta_error: null, estado_proceso,
    total_ofertas: num(res.total_ofertas_recibidas), detalle_consultado: !!detalle,
    bfk_oferto: null, bfk_monto_neto: null, bfk_monto_total: null,
    adjudicatario_rut: null, adjudicatario_nombre: null, monto_neto: null, monto_impuesto: null, monto_despacho: null, monto_total: null,
    moneda: txt(detalle?.presupuesto?.moneda || item?.montos?.moneda || detalle?.montos?.moneda) || null, impuesto_nombre: null, impuesto_pct: null,
    base_tributaria: "desconocida", id_orden_compra: null, fecha_resultado: null, fecha_resultado_fuente: null,
    motivo: txt(estado_proceso === "cancelada" ? mot.motivo_cancelacion : estado_proceso === "desierta" ? mot.motivo_desierta : mot.motivo_seleccion) || null,
    fuente: `${FUENTE_OFICIAL} · ${detalle ? "listado y detalle" : "listado"}`,
    resultado: "sin_informacion",
  };
  if (["proveedor_seleccionado", "oc_emitida", "desierta", "cancelada"].includes(estado_proceso)) {
    const f = estado_proceso === "cancelada" ? (fec.fecha_cancelacion || fec.fecha_ultimo_cambio) : fec.fecha_ultimo_cambio;
    if (f) { p.fecha_resultado = txt(f); p.fecha_resultado_fuente = estado_proceso === "cancelada" && fec.fecha_cancelacion ? "fecha_cancelacion" : "fecha_ultimo_cambio"; }
  }
  const idoc = num(detalle?.id_orden_compra ?? detalle?.orden_compra?.id_orden_compra); if (idoc !== null) p.id_orden_compra = idoc;
  if (detalle) {
    const qs = Array.isArray(detalle.proveedores_cotizando) ? detalle.proveedores_cotizando : Array.isArray(detalle.cotizaciones) ? detalle.cotizaciones : [];
    const bfk = qs.find((q) => rutNorm(q?.rut_proveedor ?? q?.rut) === RUT_BFK_NORM);
    p.bfk_oferto = !!bfk;
    if (bfk) { p.bfk_monto_neto = num(bfk.valor_neto); p.bfk_monto_total = num(bfk.monto_total); }
    const sel = qs.filter(seleccionada);
    if (sel.length === 1) {
      const s = sel[0];
      p.adjudicatario_rut = txt(s.rut_proveedor ?? s.rut) || null; p.adjudicatario_nombre = txt(s.razon_social ?? s.nombre) || null;
      p.monto_neto = num(s.valor_neto); p.monto_impuesto = num(s.total_impuesto); p.monto_despacho = num(s.monto_despacho); p.monto_total = num(s.monto_total);
      p.impuesto_nombre = txt(s.nombre_impuesto) || null; p.impuesto_pct = num(s.porcentaje_impuesto);
      p.base_tributaria = baseTributariaDe(s.total_impuesto, s.porcentaje_impuesto);
    }
    if (["proveedor_seleccionado", "oc_emitida"].includes(estado_proceso)) {
      // Una sola seleccionada con RUT: ganada si es BFK; perdida si BFK ofertó y ganó otro; si BFK no figura, sin_oferta_bfk.
      // Sin seleccionada (o más de una) no se deduce nada: queda por verificar.
      p.resultado = sel.length === 1 && p.adjudicatario_rut ? (rutNorm(p.adjudicatario_rut) === RUT_BFK_NORM ? "ganada" : bfk ? "perdida" : "sin_oferta_bfk") : "sin_informacion";
    }
  }
  if (["publicada", "cerrada"].includes(estado_proceso)) p.resultado = "pendiente";
  else if (estado_proceso === "desierta" || estado_proceso === "cancelada") p.resultado = estado_proceso;
  if (!detalle && detalleError) p.consulta_error = `Detalle no disponible: ${String(detalleError).slice(0, 180)}`;
  return p;
}

// ── Oportunidades (misma lógica que la vista ic_oportunidades) ───────────────
const PRIORIDAD = { adjudicada: 1, no_adjudicada: 2, presentada: 3 };
export function fechaChile(iso) {
  if (!iso) return null;
  const d = new Date(iso); if (Number.isNaN(d.getTime())) return null;
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
// cotizaciones: filas de cotizaciones; versiones: [{cotizacion_id, estado, guardado_en}]; resultados: filas de ic_resultados.
export function construirOportunidades(cotizaciones = [], versiones = [], resultados = []) {
  const primera = {};
  for (const v of versiones) if (ESTADOS_PRESENTADOS.includes(v.estado)) { const k = v.cotizacion_id; if (!primera[k] || String(v.guardado_en) < String(primera[k])) primera[k] = v.guardado_en; }
  const porCod = new Map(resultados.map((r) => [codigoNorm(r.codigo), r]));
  const grupos = new Map();
  for (const c of cotizaciones) {
    if (!ESTADOS_PRESENTADOS.includes(c.estado)) continue;
    const cod = codigoNorm(c.id_externo); const clave = cod || `cz:${c.id}`;
    (grupos.get(clave) || grupos.set(clave, []).get(clave)).push(c);
  }
  const out = [];
  for (const [clave, lista] of grupos) {
    lista.sort((a, b) => (PRIORIDAD[a.estado] - PRIORIDAD[b.estado]) || String(b.actualizado_en || "").localeCompare(String(a.actualizado_en || "")) || String(a.id).localeCompare(String(b.id)));
    const u = lista[0]; const cod = codigoNorm(u.id_externo) || null; const r = cod ? porCod.get(cod) : null;
    const neto = Number(u.subtotal_neto) || 0, imp = Number(u.impuestos) || 0, tot = Number(u.total) || 0;
    const oferta_base = imp > 0 ? "afecta" : neto > 0 ? "exenta" : "desconocida";
    const rex = r?.resultado ?? null;
    const resultado = u.estado === "adjudicada" ? "ganada" : u.estado === "no_adjudicada" ? "perdida" : FINALES.includes(rex) ? rex : "pendiente";
    const fuente_resultado = u.estado === "adjudicada" ? "Cotización BFK (adjudicada)" : u.estado === "no_adjudicada" ? "Cotización BFK (no adjudicada)" : FINALES.includes(rex) ? r.fuente : "Sin resultado verificado";
    const ep = r?.estado_proceso ?? null;
    const verificacion = !cod ? "sin_codigo" : !esCodigoCompraAgil(cod) ? "no_compra_agil" : !r ? "sin_consultar"
      : FINALES.includes(rex) ? "verificado" : ["proveedor_seleccionado", "oc_emitida"].includes(ep) ? "por_verificar" : ["publicada", "cerrada"].includes(ep) ? "en_proceso" : "por_verificar";
    const aviso = u.estado === "adjudicada" && ["perdida", "desierta", "cancelada", "sin_oferta_bfk"].includes(rex) ? `ChileCompra informa: ${RESULTADOS[rex].label.toLowerCase()}. La cotización figura adjudicada.`
      : u.estado === "no_adjudicada" && rex === "ganada" ? "ChileCompra informa a BFK como proveedor seleccionado. La cotización figura no adjudicada."
      : u.estado === "presentada" && rex === "ganada" ? "ChileCompra informa a BFK como proveedor seleccionado: la cotización sigue «presentada» (regularizar en Cotizaciones)."
      : null;
    const adjTot = r?.monto_total == null ? null : Number(r.monto_total);
    const comparable = resultado === "perdida" && adjTot > 0 && tot > 0 && ["", "CLP"].includes(String(r?.moneda || "").toUpperCase()) && oferta_base !== "desconocida"
      && oferta_base === (r?.base_tributaria || "desconocida") && !!r?.adjudicatario_rut && rutNorm(r.adjudicatario_rut) !== RUT_BFK_NORM;
    const motivo_no_comparable = resultado !== "perdida" ? null : !r?.adjudicatario_rut || adjTot == null ? NO_DISPONIBLE
      : !["", "CLP"].includes(String(r?.moneda || "").toUpperCase()) ? "Moneda distinta" : oferta_base === "desconocida" || (r?.base_tributaria || "desconocida") === "desconocida" ? "Base tributaria desconocida"
      : oferta_base !== r.base_tributaria ? "Base tributaria distinta (afecta/exenta)" : !(adjTot > 0) || !(tot > 0) ? "Monto en cero" : null;
    const fp = primera[u.id] ? fechaChile(primera[u.id]) : null;
    out.push({
      clave, codigo: cod, cotizacion_id: u.id, n_cotizaciones: lista.length,
      fecha_presentacion: fp || (u.fecha ? String(u.fecha).slice(0, 10) : null), fecha_presentacion_registrada: !!fp,
      institucion: u.institucion || null, rut_institucion: u.rut || null, descripcion: u.nombre || null,
      vendedor_id: u.vendedor_id || null, vendedor_nombre: u.vendedor_nombre || null, estado_cotizacion: u.estado, oc_codigo: u.oc_codigo || null,
      oferta_neto: neto, oferta_impuesto: imp, oferta_total: tot, oferta_base,
      estado_proceso: ep, resultado_externo: rex, total_ofertas: r?.total_ofertas ?? null, bfk_oferto: r?.bfk_oferto ?? null,
      adjudicatario_rut: r?.adjudicatario_rut ?? null, adjudicatario_nombre: r?.adjudicatario_nombre ?? null,
      adjudicado_neto: r?.monto_neto == null ? null : Number(r.monto_neto), adjudicado_impuesto: r?.monto_impuesto == null ? null : Number(r.monto_impuesto),
      adjudicado_despacho: r?.monto_despacho == null ? null : Number(r.monto_despacho), adjudicado_total: adjTot, moneda: r?.moneda ?? null, adjudicado_base: r?.base_tributaria ?? null,
      fecha_resultado: r?.fecha_resultado ?? null, fuente: r?.fuente ?? null, detalle_consultado: r?.detalle_consultado ?? null, consultado_en: r?.consultado_en ?? null,
      verificado_en: r?.verificado_en ?? null, consulta_estado: r?.consulta_estado ?? null, consulta_error: r?.consulta_error ?? null, motivo: r?.motivo ?? null,
      resultado, fuente_resultado, verificacion, aviso, comparable,
      motivo_no_comparable: comparable ? null : motivo_no_comparable,
      diferencia: comparable ? tot - adjTot : null,
      diferencia_pct: comparable ? r1(((tot - adjTot) * 100) / adjTot) : null,
      enlace_mp: cod ? enlaceMP(cod) || null : null,
    });
  }
  return out.sort((a, b) => String(b.fecha_presentacion || "").localeCompare(String(a.fecha_presentacion || "")) || a.clave.localeCompare(b.clave));
}

// ── Filtros y período ─────────────────────────────────────────────────────────
const dosDig = (n) => String(n).padStart(2, "0");
const ultimoDia = (a, m) => new Date(Date.UTC(a, m, 0)).getUTCDate();
// { tipo: "mes", anio, mes } | { tipo: "anio", anio } | { tipo: "rango", desde, hasta } → { desde, hasta } (AAAA-MM-DD, inclusivo)
export function periodoDe(p) {
  if (p?.tipo === "mes") return { desde: `${p.anio}-${dosDig(p.mes)}-01`, hasta: `${p.anio}-${dosDig(p.mes)}-${dosDig(ultimoDia(p.anio, p.mes))}` };
  if (p?.tipo === "anio") return { desde: `${p.anio}-01-01`, hasta: `${p.anio}-12-31` };
  const ok = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
  let desde = ok(p?.desde) ? p.desde : null, hasta = ok(p?.hasta) ? p.hasta : null;
  if (desde && hasta && desde > hasta) [desde, hasta] = [hasta, desde];
  return { desde, hasta };
}
// Igual que cz_clave_nombre() en SQL: sin tildes, sin distinguir mayúsculas, espacios simples.
const normalTexto = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
// filtros: { desde, hasta, institucion, vendedor ("" | nombre | "__sin__"), resultado }
export function filtrarOportunidades(filas, f = {}) {
  const inst = normalTexto(f.institucion), vend = f.vendedor || "", res = f.resultado || "";
  return filas.filter((o) => (!f.desde || (o.fecha_presentacion && o.fecha_presentacion >= f.desde)) && (!f.hasta || (o.fecha_presentacion && o.fecha_presentacion <= f.hasta))
    && (!inst || normalTexto(o.institucion).includes(inst))
    && (!vend || (vend === "__sin__" ? !o.vendedor_nombre : normalTexto(o.vendedor_nombre) === normalTexto(vend)))
    && (!res || o.resultado === res));
}
export function mediana(xs) {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b); if (!v.length) return null;
  const k = (v.length - 1) / 2, i = Math.floor(k); return i === k ? v[i] : v[i] + (v[i + 1] - v[i]) * (k - i);
}
// Redondeo a 1 decimal «alejándose de cero» (igual que round(numeric, 1) de PostgreSQL), con tolerancia de coma flotante.
export const r1 = (x) => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.sign(x) * Math.round(Math.abs(x) * 10 + 1e-9) / 10);
const mesDe = (f) => (f ? String(f).slice(0, 7) : null);

// Resumen del período (misma forma que ic_resumen). filas: oportunidades YA filtradas.
export function resumirOportunidades(filas, { desde = null, hasta = null } = {}) {
  const cuenta = (r) => filas.filter((o) => o.resultado === r).length;
  const pres = filas.filter((o) => o.resultado !== "sin_oferta_bfk");
  const gan = filas.filter((o) => o.resultado === "ganada"), per = filas.filter((o) => o.resultado === "perdida");
  const comp = filas.filter((o) => o.comparable);
  const suma = (xs, k) => xs.reduce((s, o) => s + (Number(o[k]) || 0), 0);
  const G = gan.length, P = per.length;
  const sumAdj = suma(comp, "adjudicado_total");
  const indicadores = {
    presentadas: pres.length, monto_ofertado_neto: suma(pres, "oferta_neto"), monto_ofertado_impuesto: suma(pres, "oferta_impuesto"), monto_ofertado_total: suma(pres, "oferta_total"),
    ganadas: G, monto_ganado_neto: suma(gan, "oferta_neto"), monto_ganado_total: suma(gan, "oferta_total"),
    perdidas: P, pendientes: cuenta("pendiente"), pendientes_por_verificar: filas.filter((o) => o.resultado === "pendiente" && o.verificacion === "por_verificar").length,
    desiertas: cuenta("desierta"), canceladas: cuenta("cancelada"), sin_oferta_bfk: cuenta("sin_oferta_bfk"),
    tasa_exito: G + P > 0 ? r1((G / (G + P)) * 100) : null,
    comparables: comp.length, comparables_ofertado_total: suma(comp, "oferta_total"), comparables_adjudicado_total: sumAdj,
    diferencia_total: comp.length ? suma(comp, "diferencia") : null,
    diferencia_pct_ponderada: comp.length && sumAdj > 0 ? r1((suma(comp, "diferencia") / sumAdj) * 100) : null,
    diferencia_pct_mediana: r1(mediana(comp.map((o) => o.diferencia_pct))),
    perdidas_sin_adjudicatario: per.filter((o) => !o.adjudicatario_rut).length,
    avisos: filas.filter((o) => o.aviso).length,
  };
  const meses = [...new Set(filas.map((o) => mesDe(o.fecha_presentacion)).filter(Boolean))].sort();
  const por_mes = meses.map((m) => {
    const xs = filas.filter((o) => mesDe(o.fecha_presentacion) === m); const cs = xs.filter((o) => o.comparable);
    const n = (r) => xs.filter((o) => o.resultado === r).length;
    return { mes: m, presentadas: xs.filter((o) => o.resultado !== "sin_oferta_bfk").length, ganadas: n("ganada"), perdidas: n("perdida"), pendientes: n("pendiente"),
      otras: n("desierta") + n("cancelada"), ofertado_neto: suma(xs.filter((o) => o.resultado !== "sin_oferta_bfk"), "oferta_neto"), ganado_neto: suma(xs.filter((o) => o.resultado === "ganada"), "oferta_neto"),
      comp_ofertado_total: suma(cs, "oferta_total"), comp_adjudicado_total: suma(cs, "adjudicado_total"), comparables: cs.length };
  });
  // Agrupado por RUT; RUT y nombre de la oportunidad más reciente (igual que ic_resumen).
  const g = new Map();
  const recientes = per.filter((o) => o.adjudicatario_rut).sort((a, b) => (b.fecha_presentacion || "").localeCompare(a.fecha_presentacion || "") || (a.clave < b.clave ? -1 : a.clave > b.clave ? 1 : 0));
  for (const o of recientes) {
    const k = rutNorm(o.adjudicatario_rut); const x = g.get(k) || { k, rut: o.adjudicatario_rut, nombre: null, n: 0, monto_total: 0 };
    if (!x.nombre && o.adjudicatario_nombre) x.nombre = o.adjudicatario_nombre;
    x.n += 1; x.monto_total += Number(o.adjudicado_total) || 0; g.set(k, x);
  }
  const competidores = [...g.values()].sort((a, b) => b.n - a.n || b.monto_total - a.monto_total || (a.k < b.k ? -1 : a.k > b.k ? 1 : 0)).slice(0, 10)
    .map(({ k, ...c }) => ({ ...c, nombre: c.nombre || NO_DISPONIBLE }));
  const distribucion = Object.keys(RESULTADOS).map((r) => ({ resultado: r, n: cuenta(r) })).filter((x) => x.n > 0);
  const ult = filas.map((o) => o.consultado_en).filter(Boolean).sort().slice(-1)[0] || null;
  return { periodo: { desde, hasta }, indicadores, por_mes, competidores, distribucion, ultima_consulta: ult, fuente: FUENTE_OFICIAL };
}

// ── Orden y paginación del detalle (modo sin migración) ───────────────────────
export const COLUMNAS_ORDEN = ["fecha_presentacion", "codigo", "institucion", "vendedor_nombre", "oferta_total", "resultado", "adjudicatario_nombre", "adjudicado_total", "diferencia", "diferencia_pct"];
export function ordenarPaginar(filas, { q = "", orden = "fecha_presentacion", desc = true, pagina = 0, porPagina = 15 } = {}) {
  const t = normalTexto(q);
  const xs = t ? filas.filter((o) => [o.codigo, o.institucion, o.descripcion, o.adjudicatario_nombre, o.adjudicatario_rut, o.vendedor_nombre].some((v) => normalTexto(v).includes(t))) : filas.slice();
  const col = COLUMNAS_ORDEN.includes(orden) ? orden : "fecha_presentacion";
  xs.sort((a, b) => {
    const va = a[col], vb = b[col];
    if (va == null && vb == null) return a.clave.localeCompare(b.clave);
    if (va == null) return 1; if (vb == null) return -1;   // vacíos siempre al final (igual que nullslast)
    const c = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), "es");
    return (desc ? -c : c) || a.clave.localeCompare(b.clave);
  });
  return { total: xs.length, filas: xs.slice(pagina * porPagina, (pagina + 1) * porPagina) };
}

// ── Exportación (Excel / CSV) ─────────────────────────────────────────────────
const pesos = (n) => (n === null || n === undefined ? "" : Math.round(Number(n)));
export function filasDetalleExport(filas) {
  return filas.map((o) => ({
    "Código Compra Ágil": o.codigo || "(sin código)", "Fecha de presentación": o.fecha_presentacion || "", "Institución compradora": o.institucion || "", "Descripción": o.descripcion || "",
    "Vendedor BFK": o.vendedor_nombre || "(sin vendedor)", "Ofertado BFK neto": pesos(o.oferta_neto), "Ofertado BFK IVA": pesos(o.oferta_impuesto), "Ofertado BFK total": pesos(o.oferta_total),
    "Base tributaria BFK": o.oferta_base, "Estado cotización": o.estado_cotizacion, "Estado del proceso (ChileCompra)": o.estado_proceso || NO_DISPONIBLE,
    "Resultado": RESULTADOS[o.resultado]?.label || o.resultado, "Fuente del resultado": o.fuente_resultado,
    "Empresa adjudicada": o.adjudicatario_nombre || (o.resultado === "perdida" || o.verificacion === "por_verificar" ? NO_DISPONIBLE : ""), "RUT adjudicatario": o.adjudicatario_rut || "",
    "Adjudicado neto": pesos(o.adjudicado_neto), "Adjudicado impuesto": pesos(o.adjudicado_impuesto), "Adjudicado despacho": pesos(o.adjudicado_despacho), "Adjudicado total": pesos(o.adjudicado_total),
    "Base tributaria adjudicado": o.adjudicado_base || "", "Diferencia total (BFK − adjudicado)": o.comparable ? pesos(o.diferencia) : "", "Diferencia %": o.comparable ? o.diferencia_pct : "",
    "Comparación": o.comparable ? "Comparable (misma base tributaria, total a pagar)" : o.motivo_no_comparable || "", "Aviso": o.aviso || "",
    "Enlace Mercado Público": o.enlace_mp || "", "Última consulta ChileCompra": o.consultado_en || "",
  }));
}
export function hojasInforme(resumen, filas, { generado = new Date().toISOString(), ultimaSincronizacion = null, modo = "base" } = {}) {
  const i = resumen.indicadores; const p = resumen.periodo;
  const res = [
    ["Informe", "Inteligencia Comercial de Compra Ágil — BFK"], ["Período desde", p.desde || "(inicio)"], ["Período hasta", p.hasta || "(hoy)"],
    ["Generado", generado], ["Última sincronización con ChileCompra", ultimaSincronizacion || NO_DISPONIBLE], ["Fuente oficial", FUENTE_OFICIAL],
    ["Modo", modo === "base" ? "Base de datos (resultados verificados)" : "Solo estados de las cotizaciones (migración no instalada)"], [],
    ["Cotizaciones presentadas", i.presentadas], ["Monto ofertado neto", pesos(i.monto_ofertado_neto)], ["Monto ofertado IVA", pesos(i.monto_ofertado_impuesto)], ["Monto ofertado total", pesos(i.monto_ofertado_total)],
    ["Ganadas", i.ganadas], ["Monto ganado neto (precio ofertado)", pesos(i.monto_ganado_neto)], ["Monto ganado total", pesos(i.monto_ganado_total)],
    ["Perdidas", i.perdidas], ["Pendientes", i.pendientes], ["  de ellas por verificar", i.pendientes_por_verificar], ["Desiertas", i.desiertas], ["Canceladas", i.canceladas], ["BFK no figura entre las ofertas", i.sin_oferta_bfk],
    ["Tasa de éxito % = ganadas / (ganadas + perdidas)", i.tasa_exito ?? "Sin ganadas ni perdidas"],
    ["Perdidas comparables (misma base tributaria)", i.comparables], ["Diferencia total (BFK − adjudicado)", i.diferencia_total == null ? NO_DISPONIBLE : pesos(i.diferencia_total)],
    ["Diferencia % ponderada", i.diferencia_pct_ponderada ?? NO_DISPONIBLE], ["Diferencia % mediana", i.diferencia_pct_mediana ?? NO_DISPONIBLE],
    [], ["Nota", "Una diferencia positiva significa que la oferta de BFK fue más cara que la adjudicada. No se asume que BFK perdió solo por precio."],
  ];
  const emp = resumen.competidores.map((c) => ({ "Empresa adjudicada": c.nombre, "RUT": c.rut, "Oportunidades ganadas frente a BFK": c.n, "Monto adjudicado total": pesos(c.monto_total) }));
  const mes = resumen.por_mes.map((m) => ({ "Mes": m.mes, "Presentadas": m.presentadas, "Ganadas": m.ganadas, "Perdidas": m.perdidas, "Pendientes": m.pendientes, "Desiertas o canceladas": m.otras,
    "Ofertado neto": pesos(m.ofertado_neto), "Ganado neto": pesos(m.ganado_neto), "Comparables: ofertado total BFK": pesos(m.comp_ofertado_total), "Comparables: adjudicado total": pesos(m.comp_adjudicado_total) }));
  return { Resumen: res, "Por mes": mes, Oportunidades: filasDetalleExport(filas), "Empresas adjudicadas": emp };
}
const csvCampo = (v) => { const s = v === null || v === undefined ? "" : String(v); return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
// CSV con separador «;» (Excel en español) y BOM UTF-8. Encabezado con el período y las fechas.
export function csvInforme(resumen, filas, meta = {}) {
  const h = hojasInforme(resumen, filas, meta); const det = h.Oportunidades;
  const cab = h.Resumen.filter((r) => r.length).slice(0, 7).map((r) => r.map(csvCampo).join(";"));
  const cols = det.length ? Object.keys(det[0]) : Object.keys(filasDetalleExport([{ resultado: "pendiente" }])[0]);
  return "﻿" + [...cab, "", cols.map(csvCampo).join(";"), ...det.map((f) => cols.map((c) => csvCampo(f[c])).join(";"))].join("\r\n");
}
export const nombreArchivo = (p, ext) => `inteligencia-comercial_${p?.desde || "inicio"}_${p?.hasta || "hoy"}.${ext}`;
