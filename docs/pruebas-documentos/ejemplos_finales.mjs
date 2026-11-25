// Ejemplos para la presentación (25/11/2026): oferta multiproducto de Mercado Público (5 productos distintos, 2 proveedores,
// garantías distintas) y oferta de venta privada. Datos SIMULADOS; los montos salen de los cálculos de la app.
// Uso: npx esbuild … --outfile=/tmp/ef.mjs && IMAGENES_DIR=… node /tmp/ef.mjs <carpeta>
import fs from "node:fs";
import path from "node:path";
import { jsPDF } from "jspdf";
import { calcularCotizacion, itemVacio } from "../../src/lib/cotizaciones.js";
import { procesarTextoTecnico } from "../../src/lib/especificaciones.js";
import { modeloOfertaMP, modeloOfertaVP } from "../../src/lib/modeloOferta.js";
import { generarDocumentoOferta } from "../../src/lib/documentosOferta.js";
import { documentoDesdeEditor } from "../../src/lib/ventasPrivadas.js";
import { IMG, LOGO, FUENTES } from "./casos.mjs";
import { cotizacionEjemplo } from "./generar_ejemplos.mjs";

const salida = process.argv[2] || "/tmp/ejemplos-finales"; fs.mkdirSync(salida, { recursive: true });
const pares = (t) => procesarTextoTecnico(t).filas.map((f) => ({ etiqueta: f.etiqueta, valor: f.valor }));
const cot = cotizacionEjemplo();
cot.envios.push({ key: "e2", proveedor: "Tienda B", monto: 12000, con_factura: true, estado: "confirmado", destino: "Av. Ejemplo 123, Laja", evidencia: "cotización", fecha_cotizacion: "2026-11-25" });
cot.items.push(
  { ...itemVacio(), key: "i4", cantidad: 2, precio_origen: 89990, envio_key: "e2", ficha: { nombre: "Impresora multifuncional tinta continua", marca: "Epson", modelo: "EcoTank L3250", generales: [], descripcion: "",
    especificaciones: pares("Tecnología de impresión: Inyección de tinta continua\nVelocidad de impresión: 33 ppm\nResolución máxima: 5760 x 1440 dpi\nConectividad: Wi-Fi, USB 2.0\nDúplex automático: No\nVoltaje: 220v"),
    imagenes: [], condiciones_producto: { garantia: "12 meses o 30.000 páginas" } } },
  { ...itemVacio(), key: "i5", cantidad: 4, precio_origen: 54990, envio_key: "e2", ficha: { nombre: "Taladro percutor inalámbrico 20V", marca: "Bauker", modelo: "CID20V", generales: [], descripcion: "",
    especificaciones: pares("Potencia: 450w\nAlimentación: Batería 20 V, 2 Ah\nVelocidad sin carga: 0-1500 rpm\nMandril: 13 mm\nIncluye: Batería, cargador y maletín"),
    imagenes: [], condiciones_producto: { garantia: "6 meses" } } });
cot.requerimientos = [{ nombre: "Televisor", descripcion: "Pantalla de 43 pulgadas, resolución 4K" }, { nombre: "Silla ergonómica", descripcion: "Soporta al menos 120 kg" }];
const calc = calcularCotizacion(cot);
const condiciones = { plazo_entrega: "5 días desde la aceptación de la OC", tipo_dias: "habiles", garantia: "12 meses salvo indicación por producto", despacho: "Incluido en los precios unitarios", vigencia: "30 días desde la emisión", forma_pago: "30 días desde la recepción conforme de la factura" };
const matriz = [{ item: 1, requisito: "Pantalla de 43 pulgadas, resolución 4K", ofertado: "43 pulgadas, 4K UHD (3840 x 2160)", estado: "cumple" }, { item: 2, requisito: "Soporta al menos 120 kg", ofertado: "Peso máximo soportado: 120 kg", estado: "cumple" }, { item: 2, requisito: "Apoyapiés", ofertado: "No incluye", estado: "no_cumple" }];
const mp = modeloOfertaMP(cot, calc, { version: 1, fecha: "2026-11-25", condiciones, matriz });
const op = { jsPDF, fuentes: FUENTES, logo: LOGO };
for (const tipo of ["oferta", "cotizacion", "eett"]) { const r = await generarDocumentoOferta(tipo, mp, op); fs.writeFileSync(path.join(salida, r.nombre), Buffer.from(r.bytes)); console.log(r.nombre, r.paginas); }
const doc = documentoDesdeEditor({ folio: "CP-2026-0007", revision: 0, cab: { fecha_emision: "2026-11-25", vigencia_hasta: "2026-12-10", plazo_entrega: "10 días hábiles", condiciones_pago: "50% anticipo y saldo a 30 días", contacto_nombre: "Rosa Pérez", contacto_correo: "rosa@ejemplo.cl", direccion_entrega: "Planta km 5, Laja", afecta_iva: true },
  cliente: { razon_social: "Maderas del Sur SpA", rut: "76.086.428-5", giro: "Aserradero" },
  items: [{ tipo: "producto", descripcion: "Silla ergonómica RD", unidad: "UN", cantidad: 6, precio_unitario: 95000, descuento_pct: 5 }, { tipo: "producto", descripcion: "Silla de escritorio Syra", unidad: "UN", cantidad: 2, precio_unitario: 89000, descuento_pct: 0 }, { tipo: "servicio", descripcion: "Armado e instalación en planta", unidad: "UN", cantidad: 1, precio_unitario: 45000, descuento_pct: 0 }],
  empresa: { razon_social: "Ingeniería y Servicios BFK Limitada", correo: "bfklimitada@gmail.com" }, responsable: "Vendedor de prueba" });
const vp = modeloOfertaVP(doc, [cot.items[1].ficha, cot.items[2].ficha, {}], { version: 1, vendedor: "Vendedor de prueba", condiciones: { garantia: "6 meses por defectos de fabricación", despacho: "Incluido, en planta del cliente" } });
const r = await generarDocumentoOferta("oferta", vp, op); fs.writeFileSync(path.join(salida, r.nombre), Buffer.from(r.bytes)); console.log(r.nombre, r.paginas);
