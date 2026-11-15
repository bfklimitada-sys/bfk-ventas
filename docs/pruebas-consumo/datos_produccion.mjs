// Consumo de Supabase, fase 1 — datos de prueba con el VOLUMEN de producción (medido el 15/11/2026, solo lectura):
// 317 OCs y sus eventos con el peso medio real por fila, una línea con un enlace de 317 kB, 232 correos, 310 contactos
// institucionales, 324 vínculos, 736 cambios de historial, 77 fotos de Mercado Público y 223 entidades.
// Son datos FICTICIOS (copias de datos_oc.mjs con relleno); solo reproducen tamaños y cantidades.
import { crearDatos } from "../pruebas-oc/datos_oc.mjs";

const PESO = { ordenes_compra_v2: 1716, eventos_compra: 290, eventos_entrega: 193, eventos_factura: 553, eventos_pago_cliente: 358,
  eventos_pago_financiamiento: 299, oc_productos_link: 554, correos_bfk: 870, contactos_institucionales: 829, contactos_institucionales_oc: 182,
  historial_cambios: 350, mp_cache_avisos: 1200, entidades_catalogo: 290 };
const rellenar = (fila, tabla) => { const falta = (PESO[tabla] || 0) - JSON.stringify(fila).length - 14; return falta > 0 ? { ...fila, _relleno: "·".repeat(Math.floor(falta / 2)) } : fila; };
const HIJAS = ["eventos_compra", "eventos_entrega", "eventos_factura", "eventos_pago_cliente", "eventos_pago_financiamiento", "oc_productos_link", "oc_comentarios", "eventos_postventa"];
const iso = (d) => new Date(d).toISOString();

export function datosProduccion({ ocs = 317 } = {}) {
  const d = crearDatos();
  const base = d.ordenes_compra_v2.slice();
  const ahora = Date.now();
  // OCs: copias de las de datos_oc.mjs (número no MP, para no disparar sincronizaciones) hasta llegar a `ocs`.
  for (let k = 1; d.ordenes_compra_v2.length < ocs; k++) {
    for (const o of base) {
      if (d.ordenes_compra_v2.length >= ocs) break;
      const id = `${o.id}_k${k}`;
      d.ordenes_compra_v2.push({ ...o, id, numero_oc: `BFK-${k}-${o.id}`, no_en_mp: true, sync_pendiente: false, creadoEn: iso(Date.parse(o.creadoEn || "2026-06-01") - k * 86400000) });
      for (const t of HIJAS) for (const e of (d[t] || []).filter((x) => x.oc_id === o.id)) d[t].push({ ...e, id: `${e.id}_k${k}`, oc_id: id });
    }
  }
  for (const t of Object.keys(PESO)) if (Array.isArray(d[t])) d[t] = d[t].map((f) => rellenar(f, t));
  // Una línea con un enlace extenso (como la de producción, 317 kB)
  d.oc_productos_link.push({ id: "lnk_extensa", oc_id: "oc1", descripcion: "Producto con enlace extenso", url: "https://proveedor.example/p?" + "q".repeat(317000), orden: 9, origen: "compra", cantidad: 1, precio_compra: 0, precio_venta: 0 });
  const ocIds = d.ordenes_compra_v2.map((o) => o.id);
  d.correos_bfk = Array.from({ length: 232 }, (_, i) => rellenar({ id: 9000 + i, message_id: `<m${i}@bfk>`, buzon: "INBOX", remitente_nombre: "Remitente " + i, remitente_correo: `r${i}@cliente.cl`,
    asunto: "Consulta por OC " + i, fecha: iso(ahora - (i % 28) * 86400000 - i * 60000), resumen: "Resumen del correo " + i, categoria: "consulta", prioridad: 2, oc_id: ocIds[i % ocIds.length],
    asociacion: "oc", estado: "pendiente", gestionado_en: null, sincronizado_en: iso(ahora - (i % 28) * 86400000) }, "correos_bfk"));
  d.contactos_institucionales = Array.from({ length: 310 }, (_, i) => rellenar({ id: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`, rut_clave: `69${100 + (i % 120)}000${(100 + (i % 120)) % 10}`, rut: `69.${100 + (i % 120)}.000-${(100 + (i % 120)) % 10}`,
    nombre: "Contacto " + i, cargo: "Encargado", correo: `c${i}@muni.cl`, correo_clave: `c${i}@muni.cl`, estado: i % 9 ? "confirmado" : "pendiente", origen: "oc", es_principal: i % 3 === 0, alcance: "institucion", creado_en: iso(ahora - i * 3600000) }, "contactos_institucionales"));
  d.contactos_institucionales_oc = Array.from({ length: 324 }, (_, i) => rellenar({ contacto_id: d.contactos_institucionales[i % 310].id, oc_id: ocIds[i % ocIds.length], correo_en_oc: `c${i % 310}@muni.cl`, origen: "oc", creado_en: iso(ahora - i * 3600000) }, "contactos_institucionales_oc"));
  d.historial_cambios = Array.from({ length: 736 }, (_, i) => rellenar({ id: `hc${i}`, oc_id: ocIds[i % ocIds.length], oc_numero: "", usuario_id: "u1", usuario_nombre: "Admin Prueba", accion: "Cambio de prueba " + i,
    campo: "notas", valor_anterior: "a", valor_nuevo: "b", creadoEn: iso(ahora - (i + 1) * 3600000) }, "historial_cambios"));
  d.mp_cache_avisos = [...(d.mp_cache_avisos || []), ...ocIds.filter((id) => id.includes("_k")).slice(0, 77).map((id) => rellenar({ id: `oc_mp:${id}`, datos: { origen: "prueba" }, actualizado_en: iso(ahora - 86400000) }, "mp_cache_avisos"))];
  d.entidades_catalogo = Array.from({ length: 223 }, (_, i) => rellenar({ rut: `69.${100 + i}.000-${i % 10}`, nombre: "Entidad " + i }, "entidades_catalogo"));
  return d;
}
