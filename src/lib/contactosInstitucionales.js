// Contactos institucionales (21/10/2026): varios contactos por institución, vinculados por RUT VALIDADO.
// La base de datos (RPC conciliar_contactos_oc / guardar_contacto_institucional / resolver_contacto_pendiente /
// marcar_contacto_obsoleto) decide y guarda; aquí solo hay lógica de PRESENTACIÓN y elección del correo sugerido.
// Prioridad: confirmado manualmente > Mercado Público > registrado en OC > importado / cobranza > pendiente. Obsoleto nunca.
import { analizarRut } from "./rut";

// Clave de institución: igual que ci_rut_clave() en la base (cuerpo sin ceros a la izquierda + DV). null si no es válido.
export function claveInstitucion(rut) {
  const a = analizarRut(rut);
  return a.ok ? a.cuerpo.replace(/^0+(?=.)/, "") + a.dv : null;
}

export const ORIGENES = {
  manual: "Ingresado a mano",
  mp: "Mercado Público",
  oc: "Registrado en una OC",
  importado: "Carga inicial",
  cobranza: "Correo de cobranza",
};
export const MOTIVOS_PENDIENTE = {
  cambio_correo: "Correo distinto para la misma persona en una OC más reciente",
  correo_de_oc_anterior: "Correo distinto para la misma persona en una OC más antigua",
  contradice_manual: "Una OC contradice un correo confirmado manualmente",
  sin_nombre: "Correo sin nombre de contacto: verificar a quién pertenece",
};
const RANGO_ORIGEN = { manual: 0, mp: 1, oc: 2, importado: 3, cobranza: 3 };

const fechaNum = (v) => { const t = Date.parse(v || ""); return Number.isFinite(t) ? t : 0; };

// Orden de uso: principal, confirmados, vigentes por prioridad de origen y OC más reciente; luego pendientes; obsoletos al final.
export function ordenarContactos(lista) {
  const rangoEstado = { vigente: 0, pendiente: 1, obsoleto: 2 };
  return [...(lista || [])].sort((a, b) =>
    (rangoEstado[a.estado] ?? 3) - (rangoEstado[b.estado] ?? 3)
    || Number(!!b.es_principal) - Number(!!a.es_principal)
    || Number(!!b.confirmado_manual) - Number(!!a.confirmado_manual)
    || (RANGO_ORIGEN[a.origen] ?? 9) - (RANGO_ORIGEN[b.origen] ?? 9)
    || fechaNum(b.ultima_oc_fecha) - fechaNum(a.ultima_oc_fecha)
    || String(a.nombre || a.correo).localeCompare(String(b.nombre || b.correo), "es"));
}

// Contactos de la institución de la OC. Los exclusivos de OTRA OC no se ofrecen (no se pasan a toda la institución).
export function contactosDeInstitucion(contactos, rut, ocId = null) {
  const clave = claveInstitucion(rut);
  if (!clave) return [];
  return ordenarContactos((contactos || []).filter(c => c.rut_clave === clave && (c.alcance !== "oc" || c.oc_exclusiva === ocId)));
}

// Correo sugerido para escribir a la institución desde una OC (reclamos, avisos). No se reemplaza el contacto
// particular de la OC por uno general, salvo que ese correo esté obsoleto o pendiente frente a uno confirmado:
// 1) contacto exclusivo de esta OC; 2) correo de la OC obsoleto → su reemplazo vigente; 3) correo de la OC pendiente
// frente a un confirmado → el confirmado; 4) el correo de la OC; 5) confirmado/principal; 6) vigente más reciente.
export function correoSugerido(contactos, oc) {
  const lista = contactosDeInstitucion(contactos, oc?.rut_cliente, oc?.id);
  const correoOC = String(oc?.correo_cliente || "").split(/[,;\s]+/).map(s => s.trim().toLowerCase()).filter(Boolean)[0] || "";
  const conCorreo = lista.filter(c => c.correo);
  const vig = conCorreo.filter(c => c.estado === "vigente");
  const delOC = correoOC ? conCorreo.find(c => c.correo === correoOC) : null;
  const exclusivo = vig.find(c => c.alcance === "oc" && c.oc_exclusiva === oc?.id);
  const obsoletoOC = delOC?.estado === "obsoleto" ? delOC : null;
  if (exclusivo) return { correo: exclusivo.correo, contacto: exclusivo, motivo: "exclusivo_oc", obsoleto: delOC?.estado === "obsoleto" ? delOC : null };
  if (obsoletoOC) {
    const reemplazo = vig.find(c => c.id === obsoletoOC.reemplazado_por) || vig.find(c => c.confirmado_manual || c.es_principal) || vig[0];
    return { correo: reemplazo?.correo || "", contacto: reemplazo || null, motivo: reemplazo ? "reemplaza_obsoleto" : "ninguno", obsoleto: obsoletoOC };
  }
  if (delOC?.estado === "pendiente") {
    const confirmado = vig.find(c => c.id === delOC.conflicto_con && c.confirmado_manual);
    if (confirmado) return { correo: confirmado.correo, contacto: confirmado, motivo: "pendiente_usa_confirmado", pendiente: delOC };
  }
  if (correoOC) return { correo: correoOC, contacto: delOC || null, motivo: "oc", pendiente: delOC?.estado === "pendiente" ? delOC : null };
  const confirmado = vig.find(c => c.es_principal) || vig.find(c => c.confirmado_manual);
  if (confirmado) return { correo: confirmado.correo, contacto: confirmado, motivo: "confirmado" };
  if (vig[0]) return { correo: vig[0].correo, contacto: vig[0], motivo: "vigente" };
  return { correo: "", contacto: null, motivo: "ninguno" };
}

export const textoSugerencia = (s) => ({
  exclusivo_oc: "Contacto exclusivo de esta OC",
  reemplaza_obsoleto: "El correo de esta OC quedó obsoleto: se usa su reemplazo vigente",
  pendiente_usa_confirmado: "El correo de esta OC contradice uno confirmado: se usa el confirmado (revisar en la ficha)",
  confirmado: "Contacto confirmado de la institución",
  oc: "Correo guardado en esta OC",
  vigente: "Contacto vigente de la institución",
  ninguno: "",
}[s?.motivo] ?? "");

// Resumen para avisar al usuario tras conciliar una OC (respuesta de conciliar_contactos_oc).
export function avisosConciliacion(res) {
  const r = Array.isArray(res?.resultados) ? res.resultados : [];
  const n = (acc) => r.filter(x => x?.accion === acc).length;
  const avisos = [];
  if (n("conflicto_manual")) avisos.push(`⚠ La OC trae un correo distinto a uno confirmado manualmente (${r.filter(x => x.accion === "conflicto_manual").map(x => x.correo).join(", ")}). Quedó pendiente de revisión.`);
  if (n("cambio_detectado")) avisos.push(`Correo nuevo para un contacto existente (${r.filter(x => x.accion === "cambio_detectado").map(x => x.correo).join(", ")}): revisar en Contactos de la institución.`);
  if (n("correo_obsoleto")) avisos.push("La OC trae un correo marcado como obsoleto; se mantiene el vigente.");
  if (n("pendiente_verificacion")) avisos.push("La OC trae un correo sin nombre de contacto: quedó pendiente de verificación.");
  if (r.some(x => x?.difiere_de_manual)) avisos.push("La OC trae un teléfono o nombre distinto al confirmado manualmente; se conserva el manual.");
  return avisos;
}

// Validación previa (la base vuelve a validar).
const CORREO_RE = /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/;
export function validarContacto(d) {
  const correo = String(d?.correo || "").trim();
  if (!correo && !String(d?.nombre || "").trim() && !String(d?.telefono || "").trim()) return "Indica al menos un nombre, correo o teléfono";
  if (correo && !CORREO_RE.test(correo)) return "El correo no es válido (un correo por contacto)";
  for (const k of ["nombre", "cargo", "departamento", "correo"]) if (String(d?.[k] || "").length > 200) return `${k} demasiado largo`;
  if (String(d?.telefono || "").length > 60) return "teléfono demasiado largo";
  return "";
}

// Mensaje legible de los errores de las RPC (CONTACTO_RECHAZADO / CONTACTO_DUPLICADO).
export function mensajeErrorContacto(e) {
  const m = String(e?.message || e || "");
  const limpio = m.replace(/^CONTACTO_(RECHAZADO|DUPLICADO):\s*/, "");
  return limpio ? limpio.charAt(0).toUpperCase() + limpio.slice(1) : "No se pudo guardar el contacto";
}
