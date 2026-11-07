// Ejemplos de EETT de ambos canales con el MISMO generador (lib/eettPdf.js): Mercado Público y Ventas privadas
// (adaptador lib/vpEETT.js). Datos de ejemplo LOCALES (no son registros de producción). Varios productos y textos largos.
// Uso: SALIDA=carpeta node docs/pruebas-ventas-privadas/ejemplos_eett.mjs   (requiere pdftotext)
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { jsPDF } from "jspdf";
import { crearPdfEETT } from "../../src/lib/eettPdf.js";
import { crearPdfEETTVP, nombreArchivoEETTVP } from "../../src/lib/vpEETT.js";

const AQUI = dirname(fileURLToPath(import.meta.url));
const F = []; let nOk = 0;
const ok = (k, v, d) => { if (!v) { F.push(k); console.log("FALLA " + k + (d !== undefined ? " :: " + JSON.stringify(d).slice(0, 300) : "")); } else { nOk++; console.log("OK    " + k); } };
const logo = "data:image/jpeg;base64," + readFileSync(join(AQUI, "../../src/assets/bfk-logo.jpg")).toString("base64");
const dir = process.env.SALIDA || mkdtempSync(join(tmpdir(), "eett-ej-"));
const texto = (ruta) => execFileSync("pdftotext", ["-layout", ruta, "-"]).toString();
const LARGO = "El equipo opera en régimen continuo de 24 horas con arranque suave y protección térmica del motor. La carcasa es de hierro fundido con impulsor de bronce y sello mecánico de carbón cerámico. Se entrega probado en fábrica con curva de rendimiento certificada y manual de operación en español. ";

// ── Mercado Público (mismo uso que EditorCotizacion) ──
{
  const cot = { id_externo: "5602-269-COT26", nombre: "ADQUISICIÓN DE BOMBAS Y TABLERO PARA PLANTA DE AGUA", fecha: "2026-10-13", plazo: "10 DÍAS HÁBILES", institucion: "ILUSTRE MUNICIPALIDAD DE EJEMPLO", rut: "69.000.000-0" };
  const items = [
    { ficha: { nombre: "BOMBA CENTRÍFUGA 5,5 KW", marca: "Pedrollo", modelo: "F 40/200A", especificaciones: [{ etiqueta: "Potencia", valor: "5,5 kW" }, { etiqueta: "Caudal máximo", valor: "36 m³/h" }, { etiqueta: "Altura máxima", valor: "56 m" }, { etiqueta: "Detalle", valor: LARGO.repeat(3) }], imagenes: [logo, logo] } },
    { ficha: { nombre: "TABLERO DE CONTROL CON VARIADOR", marca: "Schneider", modelo: "ATV320", generales: [{ etiqueta: "Grado de protección", valor: "IP55" }], especificaciones: Array.from({ length: 18 }, (_, i) => ({ etiqueta: `Parámetro ${i + 1}`, valor: `Valor ${i + 1}` })), descripcion: LARGO.repeat(4), imagenes: [logo] } },
  ];
  const doc = crearPdfEETT(cot, items, { jsPDF, logo, elaboracion: { vendedor: "Vendedor de ejemplo", elaborado_por: "Usuario de ejemplo", fecha: "2026-10-13", cotizacion: "5602-269-COT26", version: 2 } });
  const ruta = join(dir, "EJEMPLO_EETT_Mercado_Publico.pdf"); writeFileSync(ruta, Buffer.from(doc.output("arraybuffer")));
  const t = texto(ruta);
  ok("MP_formato_y_tabla_de_licitacion", /INFORMACI.N\s+T.CNICA DE/.test(t) && /ID LICITACI.N/.test(t) && /INSTITUCI.N SOLICITANTE/.test(t) && /5602-269-COT26/.test(t));
  console.log(`MP: ${ruta} (${doc.getNumberOfPages()} páginas)`);
}

// ── Ventas privadas (contenido congelado de una EETT emitida) ──
{
  const item = (orden, nombre, extra = {}) => ({ item_id: `i${orden}`, orden, cantidad: orden === 2 ? 1 : 2, unidad: "UN", tipo: "producto", producto_id: `p${orden}`, nombre, marca: "", modelo: "", codigo: "", descripcion: "",
    caracteristicas: [], condiciones_operacion: "", condiciones_instalacion: "", accesorios: [], exclusiones: [], garantia: "", normas: [], requisitos: [], anexos: [], ...extra });
  const eett = { folio: "ET-2026-0001", revision: 1, estado: "emitida", emitida_en: "2026-11-07T15:00:00Z", hash: "c".repeat(64), contenido: {
    fecha: "2026-11-07", cliente: { razon_social: "Empresa Cliente de Ejemplo SpA", rut: "76.000.000-0" }, cotizacion: { folio: "CP-2026-0007", revision: 2 },
    plazo_entrega: "15 días hábiles desde la OC", oc_cliente: { numero: "4500098765", fecha: "2026-11-06" }, responsable: "Vendedor de ejemplo",
    empresa: { razon_social: "BFK Limitada", correo: "bfklimitada@gmail.com", telefonos: "+56 9 97141822 / +56 9 57322538", comuna: "Laja" },
    objeto: "Suministro, instalación y puesta en marcha de dos bombas centrífugas y un tablero de control con variador de frecuencia para la planta de agua industrial del cliente.",
    alcance: "Incluye suministro de equipos, montaje mecánico sobre base existente, conexionado eléctrico desde el tablero hasta los motores, pruebas de funcionamiento y capacitación de 2 horas al personal de operación. " + LARGO,
    observaciones: "Los valores de caudal y altura corresponden a la curva del fabricante a 2.900 rpm.",
    items: [
      item(1, "Bomba centrífuga 5,5 kW", { marca: "Pedrollo", modelo: "F 40/200A", codigo: "BC-55", descripcion: LARGO.repeat(2),
        caracteristicas: [{ caracteristica: "Potencia", valor: "5,5", unidad: "kW" }, { caracteristica: "Caudal máximo", valor: "36", unidad: "m³/h" }, { caracteristica: "Altura máxima", valor: "56", unidad: "m" },
          { caracteristica: "Tensión", valor: "380", unidad: "V" }, { caracteristica: "Peso", valor: "No informado", unidad: "" }, { caracteristica: "Ruido", valor: "70", unidad: "dB", excluir: true }],
        condiciones_operacion: "Agua limpia sin sólidos abrasivos, temperatura máxima 90 °C.", condiciones_instalacion: "Sobre base de hormigón nivelada, con válvulas de corte en succión y descarga.",
        accesorios: ["Manual de operación", "Curva de rendimiento"], exclusiones: ["Obras civiles", "Tablero eléctrico general"], garantia: "12 meses desde la puesta en marcha",
        normas: [{ norma: "CE", respaldo_texto: "Ficha técnica del fabricante, pág. 2" }],
        requisitos: [{ requisito: "Caudal mínimo 30 m³/h a 40 m", ofrecido: "36 m³/h máx.; 32 m³/h a 40 m según curva", cumplimiento: "cumple", respaldo: "Curva del fabricante, pág. 3" },
          { requisito: "Motor IE3", ofrecido: "Motor IE2", cumplimiento: "no_cumple" }, { requisito: "Sello mecánico doble", ofrecido: "Sello mecánico simple", cumplimiento: "sin_declarar" }] }),
      item(2, "Tablero de control con variador de frecuencia", { marca: "Schneider", modelo: "ATV320", caracteristicas: Array.from({ length: 22 }, (_, i) => ({ caracteristica: `Parámetro técnico ${i + 1}`, valor: `Valor ${i + 1}`, unidad: "" })),
        condiciones_operacion: LARGO, garantia: "12 meses" }),
      item(3, "Servicio de puesta en marcha", { tipo: "servicio", unidad: "GL", cantidad: 1, descripcion: "Puesta en marcha, pruebas y capacitación al personal de operación." }),
    ] } };
  const doc = crearPdfEETTVP(eett, { jsPDF, logo, imagenes: { i1: [logo, logo], i2: [logo] } });
  const ruta = join(dir, "EJEMPLO_" + nombreArchivoEETTVP(eett).replace(/ /g, "_")); writeFileSync(ruta, Buffer.from(doc.output("arraybuffer")));
  const t = texto(ruta);
  ok("VP_mismo_formato_que_MP", /INFORMACI.N\s+T.CNICA DE/.test(t) && /PRODUCTOS/.test(t) && /CARACTER.STICAS/.test(t) && /Caracter.sticas Generales/.test(t) && /bfklimitada@gmail\.com/.test(t));
  ok("VP_tabla_con_cotizacion_cliente_y_OC", /COTIZACI.N/.test(t) && /CP-2026-0007 Rev\. 2/.test(t) && /OC DEL CLIENTE/.test(t) && /4500098765/.test(t) && /Empresa Cliente de Ejemplo/.test(t));
  ok("VP_sin_campos_solo_de_MP", !/LICITACI.N/.test(t) && !/INSTITUCI.N SOLICITANTE/.test(t));
  ok("VP_sin_no_informado_ni_excluidas", !/Peso\s+No informado/.test(t) && !/Ruido/.test(t));
  ok("VP_requisitos_aparte_y_sin_cumplimiento_no_declarado", /Requisitos del cliente/.test(t) && /Sello mec.nico doble/.test(t) && /Cumplimiento: Cumple \(respaldo: Curva/.test(t) && (t.match(/Cumplimiento:/g) || []).length === 2);
  ok("VP_sin_precios", !/\$\s?\d/.test(t) && !/precio|costo|margen/i.test(t));
  ok("VP_elaboracion", /ELABORACI.N DE ESPECIFICACIONES/.test(t) && /Vendedor de ejemplo/.test(t) && /CP-2026-0007 Rev\. 2/.test(t));
  console.log(`VP: ${ruta} (${doc.getNumberOfPages()} páginas)`);
}
console.log(`RESUMEN ejemplos EETT: ${nOk} OK, ${F.length} FALLA(S)  ·  carpeta ${dir}`);
process.exit(F.length ? 1 : 0);
