// Construccion unica de enlaces de correo. Solo abre el programa de correo del usuario con el
// mensaje listo; no envia nada por si misma. Los textos de cada aviso no cambian.
export function construirMailto({ correo, cc = "", asunto = "", cuerpo = "" }) {
  const ccLimpio = String(cc || "").split(",").map(s => s.trim()).filter(Boolean).join(",");
  const partes = [];
  if (ccLimpio) partes.push(`cc=${encodeURIComponent(ccLimpio)}`);
  partes.push(`subject=${encodeURIComponent(asunto)}`);
  partes.push(`body=${encodeURIComponent(cuerpo)}`);
  return `mailto:${encodeURIComponent(String(correo || "").trim())}?${partes.join("&")}`;
}
export function abrirCorreo(datos) {
  window.location.href = construirMailto(datos);
}
