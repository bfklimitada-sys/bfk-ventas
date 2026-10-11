// Se ejecuta al abrir la app, ANTES de App (igual que retornoAuth.js): si la dirección trae una captura
// del atajo de Safari, la guarda como pendiente y deja la dirección limpia en #/cotizaciones.
// También atiende el caso en que BFK Datos ya está abierto en esa pestaña (cambia solo la parte "#"):
// se guarda la captura y se avisa a Cotizaciones con el evento "bfk-captura".
// No guarda nada en la base de datos: la captura se revisa en el módulo Cotizaciones y EETT.
import { capturaDeHash, guardarPendiente } from "./captura.js";

export const EVENTO_CAPTURA = "bfk-captura";

function revisar() {
  const r = capturaDeHash(window.location.hash);
  if (!r) return false;
  guardarPendiente(r);
  try { window.history.replaceState(null, "", window.location.pathname + window.location.search + "#/cotizaciones"); } catch { /* la app normaliza la dirección */ }
  return true;
}

if (typeof window !== "undefined") {
  revisar();
  // App escucha "popstate" para seguir la dirección; este oyente se registra antes, así que la captura se guarda
  // y la dirección queda en #/cotizaciones cuando App la lee (App abre Cotizaciones sin cambios propios).
  const alCambiar = () => { if (revisar()) window.dispatchEvent(new Event(EVENTO_CAPTURA)); };
  window.addEventListener("popstate", alCambiar);
  window.addEventListener("hashchange", alCambiar);
}
