// Construccion unica de enlaces de correo (14/10/2026). Nunca envia nada: solo deja el mensaje listo para que
// el usuario lo revise y lo envie. Los textos de cada aviso no cambian.
//   · PC: ventana de redaccion de Gmail en una pestaña nueva (no depende del programa de correo de Windows),
//     con la cuenta prevista bfklimitada@gmail.com. Si Google pide iniciar sesion, el usuario entra con esa
//     cuenta: no se puede forzar una sesion de Google desde BFK.
//   · Telefono: mailto: (abre la app de correo del telefono).
export const CUENTA_REMITENTE = "bfklimitada@gmail.com";

const limpiarLista = (s) => String(s || "").split(/[,;]/).map((x) => x.trim()).filter(Boolean).join(",");

export function construirMailto({ correo, cc = "", asunto = "", cuerpo = "" }) {
  const ccLimpio = limpiarLista(cc);
  const partes = [];
  if (ccLimpio) partes.push(`cc=${encodeURIComponent(ccLimpio)}`);
  partes.push(`subject=${encodeURIComponent(asunto)}`);
  partes.push(`body=${encodeURIComponent(cuerpo)}`);
  return `mailto:${encodeURIComponent(String(correo || "").trim())}?${partes.join("&")}`;
}

// Redaccion de Gmail con destinatario, CC, asunto y cuerpo completos. authuser elige la cuenta prevista si ya
// tiene sesion en el navegador; si no, Google muestra su propio inicio de sesion o selector de cuentas.
export function construirGmail({ correo, cc = "", asunto = "", cuerpo = "" }, cuenta = CUENTA_REMITENTE) {
  const q = new URLSearchParams();
  if (cuenta) q.set("authuser", cuenta);
  q.set("view", "cm"); q.set("fs", "1");
  q.set("to", limpiarLista(correo));
  const ccLimpio = limpiarLista(cc); if (ccLimpio) q.set("cc", ccLimpio);
  q.set("su", asunto); q.set("body", cuerpo);
  return `https://mail.google.com/mail/?${q.toString().replace(/\+/g, "%20")}`;
}

export const esTelefono = () => {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /Android|iPhone|iPod|Mobile/i.test(ua) || /iPad/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
};

// Debe llamarse DIRECTAMENTE dentro del clic (sin await antes), o el navegador bloquea la pestaña nueva.
// Devuelve false si el navegador la bloqueo (se ofrecen entonces los botones de copiar).
export function abrirGmail(datos) {
  let w = null;
  try { w = window.open(construirGmail(datos), "_blank"); } catch { w = null; }
  if (!w) return false;
  try { w.opener = null; } catch { /* sin acceso */ }
  return true;
}
export function abrirMailto(datos) {
  try { window.location.href = construirMailto(datos); return true; } catch { return false; }
}
// PC → Gmail; telefono → app de correo. Devuelve { medio, abierto }.
export function abrirCorreo(datos) {
  return esTelefono() ? { medio: "app", abierto: abrirMailto(datos) } : { medio: "gmail", abierto: abrirGmail(datos) };
}

export async function copiarTexto(t) {
  try { await navigator.clipboard.writeText(t); return true; } catch { /* alternativa */ }
  try {
    const a = document.createElement("textarea"); a.value = t; a.setAttribute("readonly", ""); a.style.position = "fixed"; a.style.opacity = "0";
    document.body.appendChild(a); a.select(); const ok = document.execCommand("copy"); a.remove(); return ok;
  } catch { return false; }
}
