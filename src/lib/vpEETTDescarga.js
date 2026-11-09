// Ventas privadas — descarga del PDF de una EETT ya emitida (pestaña EETT de la cotización y ficha de la venta).
// El PDF se genera desde el contenido congelado de la EETT (vp_eett.contenido) con el generador de Mercado Público
// (lib/eettPdf.js, vía lib/vpEETT.js): las EETT nuevas con su plantilla; las anteriores al 09/11/2026 tal como se emitieron.
import { leerEETT, leerProductos, imagenComoDataURL } from "./ventasPrivadasDatos";
import { mensajeVP } from "./ventasPrivadas";
import { generarPdfEETTVP } from "./vpEETT";
import { descargarBlob } from "./eettPdf";
import { logoBFK } from "./cotizacionesDatos";
import logoUrl from "../assets/bfk-logo.jpg";

// Imágenes para el PDF: las de la ficha técnica del ítem en la cotización (cz-productos, las 2 primeras, como en Mercado
// Público); si el ítem no trae ficha, las fotos adjuntas al producto (vp-documentos) o las de la biblioteca (cz-productos).
export async function imagenesDe(token, contenido) {
  const out = {};
  for (const it of contenido.items || []) {
    if (!Array.isArray(it.imagenes) || !it.imagenes.length) continue;
    out[it.item_id] = (await Promise.all(it.imagenes.slice(0, 2).map((r) => (typeof r === "string" ? imagenComoDataURL(token, { bucket: "cz-productos", ruta: r }) : null)))).filter(Boolean);
  }
  const ids = (contenido.items || []).filter((i) => !out[i.item_id]).map((i) => i.producto_id).filter(Boolean);
  if (!ids.length) return out;
  const { productos, documentos } = await leerProductos(token, ids);
  for (const it of contenido.items) {
    if (!it.producto_id || out[it.item_id]) continue;
    const fotos = documentos.filter((d) => d.producto_id === it.producto_id && d.categoria === "foto" && /^image\/(jpe?g|png)/i.test(d.tipo_mime || "")).slice(0, 2);
    let imgs = (await Promise.all(fotos.map((f) => imagenComoDataURL(token, { bucket: "vp-documentos", ruta: f.ruta, sha256: f.sha256 })))).filter(Boolean);
    if (!imgs.length) {
      const p = productos.find((x) => x.id === it.producto_id);
      imgs = (await Promise.all((p?.imagenes || []).slice(0, 2).map((r) => (typeof r === "string" ? imagenComoDataURL(token, { bucket: "cz-productos", ruta: r }) : null)))).filter(Boolean);
    }
    out[it.item_id] = imgs;
  }
  return out;
}

export async function descargarEETT(token, id, empresa, showToast) {
  try {
    const e = await leerEETT(token, id); if (!e) throw new Error("EETT no encontrada");
    const r = await generarPdfEETTVP(e, { logo: await logoBFK(logoUrl), empresa, imagenes: await imagenesDe(token, e.contenido) });
    descargarBlob(r.blob, r.nombre);
  } catch (x) { showToast?.(`No se pudo generar el PDF de la EETT: ${mensajeVP(x)}`, "error"); }
}
