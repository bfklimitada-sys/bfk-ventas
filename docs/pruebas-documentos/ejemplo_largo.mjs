// Prueba de estrés visual (25/11/2026): 15 productos, nombres largos (producto, marca, modelo, institución, adquisición),
// 0 a 4 fotos, especificaciones cortas y extensas, garantías distintas y matriz. Datos SIMULADOS; montos del cálculo real.
import fs from "node:fs";
import path from "node:path";
import { jsPDF } from "jspdf";
import { calcularCotizacion, cotizacionVacia, itemVacio, envioVacio } from "../../src/lib/cotizaciones.js";
import { modeloOfertaMP } from "../../src/lib/modeloOferta.js";
import { generarDocumentoOferta } from "../../src/lib/documentosOferta.js";
import { IMG, LOGO, FUENTES } from "./casos.mjs";

const salida = process.argv[2] || "/tmp/ejemplo-largo"; fs.mkdirSync(salida, { recursive: true });
const fotos = [IMG.tv_frente, IMG.tv_medidas, IMG.silla_rd_1, IMG.silla_rd_2, IMG.silla_syra];
const NOMBRES = [
  "Estación de trabajo modular con escritorio en L, cajonera móvil de tres cajones, repisa superior y pasacables integrado",
  "Smart TV Samsung 65\" Neo QLED 4K con soporte de pared articulado y control remoto solar",
  "Silla ergonómica de malla con apoyo lumbar ajustable, apoyabrazos 4D, cabezal regulable y base de aluminio pulido",
  "Notebook empresarial 14\" Intel Core Ultra 7, 32 GB RAM, SSD 1 TB, Windows 11 Pro y garantía en sitio",
  "Impresora multifuncional láser color dúplex automático con alimentador de 50 hojas y conexión de red",
  "Taladro percutor inalámbrico 20 V con dos baterías de 4 Ah, cargador rápido y maletín",
  "Proyector láser 5.000 lúmenes WUXGA para salas de reuniones",
  "Bolso paramédico mediano 47 L de tela RipStop impermeable con estuche transparente desmontable",
  "Hervidor eléctrico 1,7 L",
  "Generador eléctrico inverter 3.500 W a gasolina con partida eléctrica, ruedas y panel con dos tomas 220 V y una salida 12 V",
  "Mouse inalámbrico",
  "Router Wi-Fi 6 de doble banda con cuatro puertos Gigabit y control parental",
  "Locker metálico de seis puertas con chapa y ventilación, color gris",
  "Monitor 27\" QHD IPS 165 Hz con altura regulable",
  "Kit de primeros auxilios industrial para 25 personas según norma",
];
const cot = { ...cotizacionVacia(), id_externo: "1057480-1082-COT26", institucion: "Servicio de Salud Biobío — Hospital Clínico Regional Dr. Guillermo Grant Benavente, Unidad de Abastecimiento",
  nombre: "Adquisición de equipamiento tecnológico, mobiliario ergonómico y herramientas para la habilitación de nuevas dependencias administrativas", rut: "61.607.700-5",
  direccion_entrega: "Avenida Roosevelt 1550, bodega central, acceso por calle San Martín, segundo piso", comuna: "Concepción", fecha: "2026-11-25", vendedor_nombre: "María Fernanda Pérez Sotomayor", recargo: 0.3 };
const env = (k, p, m) => ({ ...envioVacio(p), key: k, monto: m, estado: "confirmado", destino: "Concepción", evidencia: "simulación" });
cot.envios = [env("e1", "Tienda A", 15000), env("e2", "Tienda B", 22000)];
cot.items = NOMBRES.map((nombre, i) => {
  const n = i % 4 === 3 ? 34 : i % 3 === 0 ? 14 : 6;   // especificaciones extensas, medias y cortas
  const esp = Array.from({ length: n }, (_, k) => ({ etiqueta: ["Material", "Dimensiones", "Peso", "Voltaje", "Potencia", "Conectividad", "Color", "Capacidad", "Garantía del fabricante", "Certificación"][k % 10] + (k >= 10 ? ` ${Math.floor(k / 10) + 1}` : ""),
    valor: k % 7 === 2 ? "Valor descriptivo extenso que ocupa más de una línea en la columna de valores para revisar el ajuste de filas y la paginación del documento" : `Valor ${k + 1}` }));
  return { ...itemVacio(), key: `i${i + 1}`, cantidad: (i % 5) + 1, precio_origen: 15000 + i * 23000, envio_key: i % 2 ? "e2" : "e1",
    ficha: { nombre, marca: i % 4 === 0 ? "Fabricante Internacional de Equipamiento Profesional" : ["Samsung", "Ergo Pro", "Lenovo"][i % 3], modelo: i % 3 === 0 ? "MOD-ULTRA-2026-XL-PRO-EDICIÓN-EMPRESARIAL-0001" : `M-${100 + i}`,
      generales: [], especificaciones: esp, descripcion: i % 2 ? "" : "Equipo de uso profesional. Incluye manual en español y servicio técnico en Chile.",
      imagenes: fotos.slice(0, i % 5).concat(i % 5 === 4 ? [fotos[4]] : []).slice(0, 4), condiciones_producto: i % 3 === 0 ? { garantia: `${(i % 4) * 6 + 6} meses`, plazo_entrega: "10 días hábiles" } : {} } };
});
const calc = calcularCotizacion(cot);
const matriz = NOMBRES.slice(0, 6).map((_, i) => ({ item: i + 1, requisito: `Requisito técnico solicitado número ${i + 1} con descripción larga del comprador para revisar el ajuste de la tabla`, ofertado: "Cumple según ficha técnica del fabricante", estado: ["cumple", "por_verificar", "no_cumple"][i % 3] }));
const condiciones = { plazo_entrega: "10 días hábiles desde la aceptación de la orden de compra, salvo productos con plazo particular", tipo_dias: "habiles", garantia: "12 meses salvo indicación por producto", despacho: "Incluido en los precios unitarios, entrega en bodega central", vigencia: "30 días corridos desde la emisión", forma_pago: "30 días desde la recepción conforme de la factura", observaciones: "Entrega coordinada con la Unidad de Abastecimiento con 48 horas de anticipación." };
const m = modeloOfertaMP(cot, calc, { version: 1, fecha: "2026-11-25", condiciones, matriz });
for (const tipo of ["oferta", "cotizacion", "eett"]) { const r = await generarDocumentoOferta(tipo, m, { jsPDF, fuentes: FUENTES, logo: LOGO }); fs.writeFileSync(path.join(salida, r.nombre), Buffer.from(r.bytes)); console.log(r.nombre, r.paginas, "pág.", Math.round(r.bytes.byteLength / 1024), "KB"); }
