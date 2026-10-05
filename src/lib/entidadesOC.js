// Alimenta el catálogo de entidades desde los datos de una OC (única lógica para todos los flujos de OC).
// Toda la escritura la hace la RPC registrar_entidad_desde_oc en el servidor (una transacción):
// - Busca por RUT normalizado (con o sin puntos, k/K): nunca crea un duplicado por formato.
// - RUT inválido: no toca el catálogo ('rut_invalido'); no se corrige ni se inventa el dígito verificador.
// - Si el RUT corresponde a más de una entidad: no toca el catálogo ('ambigua').
// - Si existe: actualiza SOLO los campos que traen un valor distinto; nunca borra un dato con un vacío ni cambia el RUT.
// - Si no existe: la crea con el RUT en formato 76.123.456-0.
// La OC se guarda siempre: quien llama envuelve esta función en try/catch.
import { rpcRegistrarEntidadDesdeOC } from "./supabase";

const txt = (v) => String(v ?? "").trim();

// `catalogo` y `usuarioId` se mantienen en la firma por compatibilidad con los 4 flujos de OC; el servidor decide.
export async function alimentarCatalogoDesdeOC({ token, rut, datos }) {
  if (!txt(rut)) return { accion: "sin_rut" };
  return rpcRegistrarEntidadDesdeOC(token, {
    rut: txt(rut),
    nombre_entidad: txt(datos?.nombre_entidad),
    comuna: txt(datos?.comuna),
    contacto: txt(datos?.contacto),
    correo: txt(datos?.correo),
  });
}
