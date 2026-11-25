// Genera PDF de ejemplo con el generador documental, desde una cotización de Mercado Público SIMULADA pasando por el
// cálculo real (calcularCotizacion) y el modelo público (modeloOfertaMP). Uso:
//   npx esbuild docs/pruebas-documentos/generar_ejemplos.mjs --bundle --platform=node --format=esm --outfile=/tmp/gen.mjs \
//     --loader:.jsx=jsx --define:import.meta.env='{}' && node /tmp/gen.mjs <carpeta de salida>
import fs from "node:fs";
import path from "node:path";
import { jsPDF } from "jspdf";
import { calcularCotizacion, cotizacionVacia, itemVacio, envioVacio } from "../../src/lib/cotizaciones.js";
import { procesarTextoTecnico } from "../../src/lib/especificaciones.js";
import { modeloOfertaMP, propuestaMatrizMP } from "../../src/lib/modeloOferta.js";
import { generarDocumentoOferta } from "../../src/lib/documentosOferta.js";
import { IMG, LOGO, FUENTES, TEXTO_TV, TEXTO_SILLA } from "./casos.mjs";

const salida = process.argv[2] || "/tmp/docs-oferta"; fs.mkdirSync(salida, { recursive: true });
const pares = (r) => r.filas.map((f) => ({ etiqueta: f.etiqueta, valor: f.valor, categoria: f.categoria }));

export function cotizacionEjemplo() {
  const cot = { ...cotizacionVacia(), id_externo: "1540-1372-COT26", nombre: "Equipamiento institucional", institucion: "Municipalidad de Ejemplo", rut: "69.000.000-0",
    direccion_entrega: "Av. Ejemplo 123", comuna: "Laja", fecha: "2026-11-25", vendedor_nombre: "Vendedor de prueba", recargo: 0.3 };
  const env = { ...envioVacio("Tienda A"), key: "e1", monto: 10000, estado: "confirmado", destino: "Av. Ejemplo 123, Laja", evidencia: "simulación" };
  cot.envios = [env];
  const tv = procesarTextoTecnico(TEXTO_TV, { nombre: "Smart TV Samsung 43\" UHD 4K" });
  const silla = procesarTextoTecnico(TEXTO_SILLA, { nombre: "Silla ergonómica RD" });
  cot.items = [
    { ...itemVacio(), key: "i1", cantidad: 2, precio_origen: 160000, envio_key: "e1",
      ficha: { nombre: "Smart TV Samsung 43\" UHD 4K", marca: "Samsung", modelo: "UN43U8000HGXPE", color: "", generales: [], especificaciones: pares(tv), descripcion: tv.descripcion, imagenes: [IMG.tv_frente, IMG.tv_medidas] } },
    { ...itemVacio(), key: "i2", cantidad: 3, precio_origen: 70000, envio_key: "e1",
      ficha: { nombre: "Silla ergonómica RD", marca: "RD", modelo: "PR96015", color: "Negro", generales: [], especificaciones: pares(silla), descripcion: silla.descripcion, imagenes: [IMG.silla_rd_1, IMG.silla_rd_2], condiciones_producto: { garantia: "6 meses por defectos de fabricación" } } },
    { ...itemVacio(), key: "i3", cantidad: 1, precio_origen: 65000, envio_key: "e1",
      ficha: { nombre: "Silla de escritorio Syra", marca: "Syra", modelo: "", generales: [], especificaciones: [
        { etiqueta: "Respaldo", valor: "Tela mesh y polipropileno; 50 × 66 cm" }, { etiqueta: "Apoyacabezas", valor: "Ajustable en ángulo, altura (10 cm) y profundidad" },
        { etiqueta: "Apoyo lumbar", valor: "Incluido" }, { etiqueta: "Asiento", valor: "Tela mesh, espuma y polywood; 50 × 50 cm" },
        { etiqueta: "Apoyabrazos", valor: "Acolchados, abatibles; polipropileno negro" }, { etiqueta: "Base", valor: "Estrella de 5 aspas; polipropileno negro; Ø 60 cm" },
        { etiqueta: "Ruedas", valor: "Doble carrete, nylon negro" }, { etiqueta: "Peso máximo soportado", valor: "120 kg" }, { etiqueta: "Altura total", valor: "120–130 cm" },
      ], descripcion: "", imagenes: [IMG.silla_syra] } },
  ];
  cot.requerimientos = [{ nombre: "Televisor", descripcion: "Pantalla de 43 pulgadas, resolución 4K" }];
  return cot;
}

if (process.argv[1] && process.argv[1].endsWith("gen.mjs") || process.env.GENERAR) {
  const cot = cotizacionEjemplo(); const calc = calcularCotizacion(cot);
  const matriz = propuestaMatrizMP(cot); matriz[0].ofertado = "43 pulgadas, 4K UHD (3840 x 2160)"; matriz[0].estado = "cumple";
  const condiciones = { plazo_entrega: "5 días desde la aceptación de la OC", tipo_dias: "habiles", garantia: "12 meses", despacho: "Incluido en los precios unitarios", vigencia: "30 días desde la emisión", forma_pago: "30 días desde la recepción conforme de la factura" };
  const modelo = modeloOfertaMP(cot, calc, { version: 1, fecha: "2026-11-25", condiciones, matriz });
  const refs = {};
  for (const tipo of ["cotizacion", "eett", "oferta"]) {
    const r = await generarDocumentoOferta(tipo, modelo, { jsPDF, fuentes: FUENTES, logo: LOGO });
    fs.writeFileSync(path.join(salida, r.nombre), Buffer.from(r.bytes)); refs[tipo] = r;
    console.log(tipo, r.nombre, r.paginas, "pág.", r.bytes.byteLength, "bytes");
  }
  fs.writeFileSync(path.join(salida, "modelo.json"), JSON.stringify(modelo, (k, v) => (typeof v === "string" && v.startsWith("data:") ? "[imagen]" : v), 2));
}
