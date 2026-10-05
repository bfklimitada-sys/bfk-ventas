// Alimenta el catálogo de entidades desde los datos de una OC (única lógica para todos los flujos de OC).
// - Busca por RUT normalizado (con o sin puntos, k/K): nunca crea un duplicado por formato.
// - Si el RUT corresponde a más de una entidad (duplicado histórico pendiente de revisión): no toca el catálogo.
// - Si existe: actualiza SOLO los campos que traen un valor distinto; nunca borra un dato con un vacío ni cambia el RUT.
// - Si no existe: la crea con el RUT en formato 76.123.456-0 (si es válido).
import { ins, upd, genId } from "./supabase";
import { entidadPorRut, rutParaGuardar } from "./rut";

const CAMPOS = ["nombre_entidad", "comuna", "contacto", "correo"];
const txt = (v) => String(v ?? "").trim();

export async function alimentarCatalogoDesdeOC({ catalogo, token, usuarioId, rut, datos }) {
  if (!txt(rut)) return { accion: "sin_rut" };
  const { entidad, ambigua } = entidadPorRut(catalogo, rut);
  if (ambigua) return { accion: "ambigua" };
  if (entidad) {
    const cambios = {};
    for (const c of CAMPOS) if (txt(datos[c]) && txt(datos[c]) !== txt(entidad[c])) cambios[c] = txt(datos[c]);
    if (!Object.keys(cambios).length) return { accion: "sin_cambios" };
    await upd("entidades_catalogo", token, entidad.id, cambios);
    return { accion: "actualizada", cambios };
  }
  const fila = { id: genId("ent"), rut: rutParaGuardar(rut), creado_por: usuarioId };
  for (const c of CAMPOS) fila[c] = txt(datos[c]);
  await ins("entidades_catalogo", token, fila);
  return { accion: "creada" };
}
