// ═══════════════════════════════════════════════════════════════
// Conciliación bancaria · vista simple (21/10/2026)
// Ordena el resultado de conciliarMovimientos en grupos con lenguaje simple. Función pura: no escribe nada.
//
//  · ya ............ Ya registrados (conciliados o que se compensan): solo informativos.
//  · revisar ....... Por revisar: hay un registro BFK que podría ser este movimiento; confirmar o rechazar.
//                    También: depósito que calza con un vale vista recibido y aún no cobrado, y vínculos rotos.
//  · sinRegistrar .. Sin registrar (posteriores al cierre): movimientos nuevos para identificar y registrar.
//  · anteriores .... Antes del cierre (07/10/2026) sin vínculo: solo consulta (ya están en los saldos históricos).
//  · registradosSinBanco: «Registrado en BFK, pendiente de verificar en banco» (nunca se llaman duplicados).
// Cada fila trae: fecha, descripción, monto, posible OC o categoría, registro relacionado, motivo y acción.
// ═══════════════════════════════════════════════════════════════
import { CIERRE_CONCILIACION, TABLA_REGISTRO, destinatarioDe, esPagoProveedores } from "./conciliacion.js";
import { calzarAbonos } from "./cobranza.js";

export const TIPO_REGISTRO = { cobro: "Cobro", pago_financiador: "Devolución a financiador", pago_vendedor: "Pago a vendedor", gasto: "Gasto", retiro_capital: "Retiro de capital", aporte_capital: "Aporte de capital", compra: "Compra con fondos propios" };
const FEMENINO = new Set(["pago_financiador", "compra"]);
const registradoDe = (tipo) => (FEMENINO.has(tipo) ? "registrada" : "registrado");
const pesos = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("es-CL");
const dm = (f) => { const [, m, d] = String(f || "").slice(0, 10).split("-"); return d ? `${d}/${m}` : ""; };
const dias = (a, b) => Math.round((Date.parse(String(a).slice(0, 10)) - Date.parse(String(b).slice(0, 10))) / 86400000);

// Motivo de la coincidencia en palabras simples.
const MOTIVO = {
  "registrado desde la cartola": "se registró desde la cartola con este mismo movimiento",
  "vínculo confirmado": "un usuario confirmó que es este registro",
  "monto exacto": "mismo monto",
  "fecha ±3 días": "fecha cercana (±3 días)",
  "fecha −5/+1": "fecha cercana",
  "registro único": "es el único registro posible",
  "registro único de la persona": "es el único registro de esa persona",
  "RUT del cliente en la glosa": "el RUT del cliente aparece en el detalle del banco",
  "nombre del cliente en la glosa": "el nombre del cliente aparece en el detalle del banco",
  "la nota del registro cita esta fecha bancaria": "la nota del registro menciona esta fecha",
  "persona en la glosa": "el nombre de la persona aparece en el detalle del banco",
  "RUT del pagador": "el RUT del cliente aparece en el detalle del banco",
  "solo monto": "solo coincide el monto (sin otro dato que lo confirme)",
  "suma exacta de cobros de un mismo cliente": "la suma de cobros de un mismo cliente da exacto",
  "sin RUT ni documento": "sin RUT ni documento que lo confirme",
  "suma exacta de gastos sin persona identificada": "la suma de varios gastos da exacto",
  "sin documento": "sin documento que lo confirme",
  "persona": "aparece la misma persona",
  "registros cercanos que no suman exacto": "tiene registros cercanos que no suman exacto",
  "sin otro dato": "sin otro dato que lo confirme",
  "nombre abreviado del cliente en la glosa": "el nombre del cliente aparece abreviado en el detalle del banco",
  "referencia bancaria del pagador ya confirmada en un pago anterior": "el banco usó la misma referencia del pagador que en un pago ya confirmado",
  "destinatario ya confirmado antes con este mismo destino": "este destinatario ya se confirmó antes con el mismo tipo de registro",
  "destinatario ya confirmado antes como pago al SII": "este destinatario ya se confirmó antes como pago al SII",
  "el detalle del banco indica pago al SII": "el detalle del banco indica pago al SII",
  "fecha cercana": "fecha cercana",
};
const normT = (t) => String(t || "").toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const soloRutT = (t) => normT(t).replace(/[^0-9K]/g, "").replace(/K$/, "");
export const motivoSimple = (ev) => [...new Set((ev || []).map((e) => MOTIVO[e] || (/^suma exacta de \d+ cobros$/.test(e) ? "varios cobros suman exacto" : /todos sus registros/.test(e) ? "todos sus registros de esa fecha suman exacto" : e)))].join(" · ");

export function textoRegistro(r, categorias = []) {
  const cat = r.tipo === "gasto" ? (categorias.find((c) => c.id === r.cat)?.nombre || "") : "";
  const quien = r.tipo === "cobro" ? `${r.oc || ""}${r.clienteNombre ? ` · ${String(r.clienteNombre).slice(0, 32)}` : ""}` : r.oc || cat || String(r.nota || "").slice(0, 40);
  return `${TIPO_REGISTRO[r.tipo] || r.tipo}${quien ? ` ${quien}` : ""} · ${dm(r.fecha)} · ${pesos(r.monto)}`;
}

// Candidatos para confirmar (agrupados por tabla: un movimiento se vincula a registros de UN tipo).
function opcionesRevision(x) {
  const cands = x.candidatos || [];
  if (!cands.length) return [];
  const suma = cands.reduce((s, r) => s + r.monto, 0);
  const mismaTabla = cands.every((r) => (r.tabla || TABLA_REGISTRO[r.tipo]) === (cands[0].tabla || TABLA_REGISTRO[cands[0].tipo]));
  if (cands.length > 1 && suma === x.monto && mismaTabla && cands.some((r) => r.monto !== x.monto)) return [{ registros: cands, grupo: true }];
  return cands.filter((r) => r.monto === x.monto).map((r) => ({ registros: [r], grupo: false }));
}

// Qué información falta para identificar el movimiento sin dudas (en palabras simples).
function faltaDe(x) {
  const G = normT(x.m.descripcion);
  const nCand = (x.candidatos || []).length;
  const partes = [];
  if (x.dir === "entra") {
    if (esPagoProveedores(x.m.descripcion)) partes.push("Es un «Abono pago a proveedores»: el banco no indica qué institución pagó. Cuando confirmes uno de esa institución, su código de pagador (op. " + (x.m.operacion || "—") + ") se reconocerá solo en los próximos pagos.");
    else if (!/\d{7,8}-?[0-9K]/.test(G)) partes.push(G.length >= 34 ? "El detalle del banco viene cortado y no identifica con seguridad quién pagó." : "El detalle del banco no trae el RUT ni un nombre que identifique quién pagó.");
  } else if (destinatarioDe(x.m.descripcion)) partes.push(`El banco solo indica el destinatario («${destinatarioDe(x.m.descripcion)}»).`);
  if (nCand > 1) partes.push(`Hay ${nCand} registros posibles: falta saber cuál corresponde.`);
  else if (nCand === 1) partes.push("Solo coincide el monto" + ((x.evidencia || []).includes("fecha ±3 días") ? " y la fecha" : "") + ": falta un dato que lo confirme.");
  return partes.join(" ");
}
function antecedentesDe(x, categorias) {
  const a = x.antecedentes || [];
  if (!a.length) return "";
  const cat = (id) => categorias.find((c) => c.id === id)?.nombre || id;
  const grupos = new Map();
  for (const y of a) { const k = y.tipo === "gasto" ? `gastos «${cat(y.cat)}»` : y.tipo === "cobro" ? `${y.cliente || "el mismo cliente"}` : y.destino; (grupos.get(k) || grupos.set(k, []).get(k)).push(y); }
  const quien = x.dir === "entra" ? "este código de pagador" : "este destinatario";
  return `Antes, ${quien} coincidió con ${[...grupos].map(([k, ys]) => `${k} (${ys.map((y) => `${dm(y.fecha)} ${pesos(y.monto)}`).join(", ")})`).join("; ")}. Es un antecedente, no una prueba.`;
}
// Evidencia de una propuesta de factura pendiente: qué identifica al pagador (y qué falta).
function evidenciaPropuesta(x, op, ocs) {
  const asig = op?.asignaciones || [];
  const oc = asig.length ? ocs.find((o) => o.id === asig[0].ocId) : null;
  if (!oc) return { identificada: false, texto: "" };
  const G = normT(x.m.descripcion), rutOC = soloRutT(oc.rut_cliente);
  const rutsG = (G.match(/\d{7,8}-?[0-9K]/g) || []).map(soloRutT);
  const palabras = normT(oc.cliente).split(/[^A-Z]+/).filter((w) => w.length >= 5 && !["ILUSTRE", "MUNICIPALIDAD", "SERVICIO", "UNIVERSIDAD", "HOSPITAL", "DIRECCION", "REGIONAL", "NACIONAL", "GOBIERNO", "CORPORACION", "DELEGACION", "PRESIDENCIAL"].includes(w));
  const ev = [];
  ev.push(op.tipo === "exacto" ? "el monto es exactamente el saldo pendiente de la factura" : op.tipo === "varias" ? "el monto es exactamente la suma de esas facturas" : "el monto cubre parte del saldo pendiente");
  const porRut = rutsG.includes(rutOC), porNombre = palabras.some((w) => G.includes(w)), porReferencia = !!x.pagadorAprendido && x.pagadorAprendido === rutOC;
  if (porRut) ev.push("el RUT del pagador en el detalle del banco es el del cliente");
  if (porReferencia) ev.push("el banco usó la referencia de pagador ya confirmada para este cliente");
  if (porNombre) ev.push("el nombre del cliente aparece en el detalle del banco");
  const suc = normT(x.m.sucursal || "").replace(/[^A-Z ]+/g, " ");
  const indicio = suc && palabras.some((w) => suc.split(/\s+/).some((t) => t.length >= 4 && w.startsWith(t)));
  if (indicio) ev.push(`indicio: depositado en sucursal ${x.m.sucursal} (coincide con el nombre del cliente; no es prueba)`);
  const identificada = porRut || porNombre || porReferencia;
  return { identificada, texto: ev.join(" · "), falta: identificada ? "" : "El banco no indica quién pagó: una factura pendiente del mismo monto no prueba que este abono sea de ese cliente." };
}

export function vistaConciliacion(conc, { ocs = [], categorias = [], cierre = CIERRE_CONCILIACION } = {}) {
  const ya = [], revisar = [], sinRegistrar = [], anteriores = [];
  const sugerencias = new Map(calzarAbonos(conc.movimientos.filter((x) => x.estado === "pendiente" && x.dir === "entra" && !x.anteriorCierre).map((x) => x.m), ocs, [])
    .map((it) => [it.mov?.clave || `${it.mov?.fecha}|${it.mov?.cargo}|${it.mov?.abono}|${it.mov?.saldo}`, it]));
  for (const x of conc.movimientos) {
    const base = { x, i: x.i, marca: x.marca, fecha: x.m.fecha, descripcion: x.m.descripcion, operacion: x.m.operacion || "", monto: x.monto, dir: x.dir,
      registros: (x.registros || []).map((r) => textoRegistro(r, categorias)), motivo: motivoSimple(x.evidencia), posible: "", accion: "", opciones: [],
      sucursal: x.m.sucursal || "", antecedentes: antecedentesDe(x, categorias) };
    if (x.gemelos?.length) base.aviso = `Hay otro movimiento igual el mismo día${x.gemelos.length ? ` (op. ${x.gemelos.join(", ")})` : ""}: el banco los informa como operaciones distintas. Verifica el N° de operación; no se trata como duplicado.`;
    if (x.estado === "conciliado" || x.estado === "neutro") {
      const r0 = x.registros?.[0];
      ya.push({ ...base, titulo: x.estado === "neutro" ? "Se compensa con otro movimiento del mismo día" : r0 ? `${TIPO_REGISTRO[r0.tipo] || "Registro"} de ${pesos(x.monto)} ya ${registradoDe(r0.tipo)} en BFK` : "Ya registrado",
        motivo: x.estado === "neutro" ? "abono y cargo del mismo monto, el mismo día y la misma contraparte" : base.motivo,
        reconocidoAuto: x.estado === "conciliado" && !x.origen ? "evidencia" : x.origen === "aprendido" ? "aprendido" : "",
        accion: "Nada que hacer: ya está registrado (no se crea otro)." });
      continue;
    }
    if (x.anteriorCierre) {
      anteriores.push({ ...base, titulo: x.estado === "posible" ? "Antes del cierre · podría estar registrado" : "Antes del cierre · sin registro individual",
        registros: (x.candidatos || []).slice(0, 3).map((r) => textoRegistro(r, categorias)),
        accion: `Solo consulta: lo anterior al ${dm(cierre)}/${cierre.slice(0, 4)} ya está incluido en los saldos históricos y no se registra desde aquí.` });
      continue;
    }
    if (x.vinculoRoto) {
      revisar.push({ ...base, tipo: "vinculo_roto", titulo: "El vínculo guardado ya no calza con este movimiento",
        motivo: "el registro vinculado ya no existe, fue anulado o no suma exactamente el monto del banco", accion: "Anula el vínculo y vuelve a revisar el movimiento.", decisiones: x.vinculoRoto });
      continue;
    }
    if (x.estado === "posible") {
      const opciones = opcionesRevision(x);
      const r0 = x.candidatos?.[0];
      revisar.push({ ...base, tipo: "coincidencia", opciones,
        titulo: r0 ? `Podría estar ya registrado en BFK (${(TIPO_REGISTRO[r0.tipo] || "registro").toLowerCase()})` : "Podría estar registrado de forma agrupada",
        posible: [...new Set((x.candidatos || []).map((r) => r.oc || (categorias.find((c) => c.id === r.cat)?.nombre) || "").filter(Boolean))].join(", "),
        registros: opciones.length ? [] : (x.candidatos || []).slice(0, 5).map((r) => textoRegistro(r, categorias)),
        accion: opciones.length ? "Confirma si es este registro (no crea nada) o indica que no corresponde." : "Revísalo: los registros cercanos no suman exacto. Si no corresponde, queda como sin registrar.",
        falta: faltaDe(x), nota: x.nota || "" });
      continue;
    }
    // pendiente posterior al cierre
    if (x.valeVista?.length) {
      revisar.push({ ...base, tipo: "vale_vista", titulo: `Podría ser el depósito de un ${x.valeVista[0].medio === "cheque" ? "cheque" : "vale vista"} ya registrado`,
        posible: x.valeVista.map((v) => v.oc).join(", "), motivo: "mismo monto que un documento recibido y aún no marcado como cobrado",
        registros: x.valeVista.map((v) => `${v.medio === "cheque" ? "Cheque" : "Vale vista"} ${v.oc} · recibido ${dm(v.fecha)} · ${pesos(v.monto)} · sin cobrar`),
        accion: "Si es ese documento, márcalo como cobrado en el banco (no crea otro cobro). Usa «Preparar registro» y elige el depósito del documento." });
      continue;
    }
    // Pago conjunto: este abono = un cobro YA registrado + facturas pendientes del mismo cliente (pista de sinLinea).
    const conjunto = (conc.sinLinea || []).find((r) => r.pista?.tipo === "agrupado" && r.pista.mov === x.i);
    if (conjunto) {
      const otras = conjunto.pista.otras;
      sinRegistrar.push({ ...base, tipo: undefined, conjunto: { registro: conjunto.id, otras }, titulo: "Abono que podría incluir un cobro ya registrado (hipótesis)",
        posible: `Hipótesis: ${conjunto.oc} (ya cobrado, ${pesos(conjunto.monto)}) + ${otras.map((o) => `${o.oc} (${pesos(o.saldo)} pendiente)`).join(" + ")}`,
        registros: [textoRegistro(conjunto, categorias)],
        motivo: "la suma coincide con un cobro ya registrado más facturas pendientes del mismo cliente; la suma sola no es evidencia",
        accion: `No registres ni elimines cobros solo por esta suma. Pide el comprobante o el detalle del pago para saber cómo se reparte entre las facturas. El cobro de ${conjunto.oc} ya existe: no lo registres de nuevo.` });
      continue;
    }
    const sug = x.dir === "entra" ? sugerencias.get(x.m.clave) : null;
    const TIPO_OP = { exacto: "Factura", varias: "Varias facturas", parcial: "Abono parcial", vale_vista: "Vale vista" };
    const op0 = sug?.claro ? sug.opciones.find((o) => o.id === sug.sugerida) : null;
    const evP = op0 ? evidenciaPropuesta(x, op0, ocs) : null;
    sinRegistrar.push({ ...base, propuesta: op0 ? { id: op0.id, identificada: evP.identificada } : null,
      titulo: x.dir === "entra" ? (op0 ? (evP.identificada ? "Cobro de una factura pendiente (pagador identificado)" : "Abono nuevo: posible cobro de una factura pendiente") : "Abono sin registro en BFK") : "Cargo sin registro en BFK",
      posible: op0 ? `${TIPO_OP[op0.tipo] || ""} ${op0.etiqueta}` : sug?.opciones?.length ? `Posibles: ${sug.opciones.slice(0, 2).map((o) => o.etiqueta).join(" o ")}` : "",
      motivo: op0 ? evP.texto : "no hay ningún registro BFK que corresponda",
      falta: op0 ? evP.falta : x.dir === "entra" ? faltaDe(x) : (destinatarioDe(x.m.descripcion) ? `No hay ningún registro BFK de ${pesos(x.monto)} para este destinatario.` : ""),
      accion: x.dir === "entra"
        ? (op0 ? `Regístralo como cobro de esa factura solo si corresponde (se registra únicamente ${pesos(x.monto)}, lo efectivamente abonado; pide confirmación).` : "Identifica la OC y regístralo como cobro (pide confirmación).")
        : "Indica si es gasto, pago a vendedor, devolución a financiador o retiro, y regístralo (pide confirmación)." });
  }
  const registradosSinBanco = (conc.sinLinea || []).map((r) => ({ r, texto: textoRegistro(r, categorias), pista: r.pista?.texto || "", tipoPista: r.pista?.tipo || "sin_movimiento",
    accion: r.pista?.tipo === "agrupado" || r.pista?.tipo === "mismo_cliente" ? "Revisa el abono indicado. No elimines el registro sin verificar." : "Verifica en el banco cuando llegue. No lo elimines ni lo dupliques." }));
  return { ya, revisar, sinRegistrar, anteriores, registradosSinBanco };
}

// Diferencia de días entre la fecha bancaria y la contable (para mostrar «2 días después», etc.).
export const desfase = (fBanco, fRegistro) => { const d = dias(fBanco, fRegistro); return d === 0 ? "" : d > 0 ? `banco ${d} día(s) después` : `banco ${-d} día(s) antes`; };
