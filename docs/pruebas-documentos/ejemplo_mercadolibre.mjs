// Ficha pegada «tal cual» desde Mercado Libre (25/11/2026): etiqueta y valor en líneas separadas, títulos de sección y una
// característica sin valor. Debe imprimirse ordenada por categorías (reordenamiento automático). Datos SIMULADOS.
import fs from "node:fs";
import { jsPDF } from "jspdf";
import { calcularCotizacion, cotizacionVacia, itemVacio, envioVacio } from "../../src/lib/cotizaciones.js";
import { modeloOfertaMP } from "../../src/lib/modeloOferta.js";
import { generarDocumentoOferta } from "../../src/lib/documentosOferta.js";
import { IMG, LOGO, FUENTES } from "./casos.mjs";
const [entrada, salida = "/tmp/ejemplo-ml"] = process.argv.slice(2); fs.mkdirSync(salida, { recursive: true });
const texto = fs.readFileSync(entrada, "utf8");
const cot = { ...cotizacionVacia(), id_externo: "956-659-COT26", institucion: "SERVICIO DE SALUD VALPARAISO SAN ANTONIO", nombre: "TELEVISOR FOLIO 3883", rut: "61.606.500-9",
  direccion_entrega: "AVENIDA BRASIL 1435", comuna: "Valparaíso", fecha: "2026-11-25", vendedor_nombre: "Kevin Vergara" };
cot.envios = [{ ...envioVacio("Tienda"), key: "e1", monto: 0, estado: "confirmado", destino: "Valparaíso", evidencia: "simulación" }];
cot.items = [{ ...itemVacio(), key: "i1", cantidad: 9, precio_origen: 299990, envio_key: "e1",
  ficha: { nombre: "Televisor Qled 55 Negro 55q6qv 4k Hisense", marca: "Hisense", modelo: "55q6qv", color: "Negro", generales: [], especificaciones: [], descripcion: texto, imagenes: [IMG.tv_frente],
    condiciones_producto: { plazo_dias: 1, plazo_tipo: "habiles", plazo_entrega: "1 día hábil", garantia: "12 meses" } } }];
const calc = calcularCotizacion(cot);
const modelo = modeloOfertaMP(cot, calc, { version: 1, fecha: cot.fecha, vendedor: cot.vendedor_nombre, condiciones: { garantia: "12 meses", vigencia: "30 días", forma_pago: "Transferencia" }, matriz: [] });
for (const tipo of ["oferta", "eett"]) {
  const r = await generarDocumentoOferta(tipo, modelo, { jsPDF, fuentes: FUENTES, logo: LOGO });
  fs.writeFileSync(`${salida}/${r.nombre}`, Buffer.from(r.bytes)); console.log(r.nombre, r.paginas, "págs");
}
