// Se evalúa una sola vez al cargar la app (antes de App): lee el retorno del enlace de
// recuperación y borra de inmediato los tokens de la barra de direcciones y del historial.
// Los tokens quedan solo en memoria; nunca se guardan en localStorage.
import { direccionLimpia, leerRetornoRecuperacion } from "./recuperacion.js";

let retorno = null;
try {
  retorno = leerRetornoRecuperacion(window.location.href);
  if (retorno) window.history.replaceState(null, "", direccionLimpia(window.location.href));
} catch { retorno = null; }

export const RETORNO_RECUPERACION = retorno;
