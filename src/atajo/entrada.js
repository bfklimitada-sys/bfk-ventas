// Código que el Atajo de iPhone ejecuta en la página del proveedor abierta en Safari ("Ejecutar JavaScript en página web").
// Lee la página que el usuario ya está viendo (no hace consultas nuevas al proveedor ni elude bloqueos),
// extrae los datos con el mismo extractor del módulo y abre BFK Datos con la captura en la dirección.
// No se importa en la app: se empaqueta con `node scripts/generar-atajo.mjs`.
import { extraerProducto } from "../lib/extraerProducto.js";
import { codificarCaptura, validarCaptura, VERSION_CAPTURA } from "../lib/captura.js";

const APP = "__BFK_APP__";
try {
  const r = extraerProducto(document.documentElement.outerHTML, location.href);
  const d = validarCaptura({ v: VERSION_CAPTURA, enlace: location.href, ficha: r.ficha, precio_origen: r.precio_origen, moneda: r.moneda,
    precio_incluye_iva: r.precio_incluye_iva, disponibilidad: r.disponibilidad, fuente: r.fuente, fecha_consulta: r.fecha_consulta, metodos: r.metodos, advertencias: r.advertencias });
  completion(APP + "/#/cotizaciones?captura=" + codificarCaptura(d));
} catch (e) {
  completion(APP + "/#/cotizaciones?captura_error=" + encodeURIComponent(String((e && e.message) || e).slice(0, 160)));
}
