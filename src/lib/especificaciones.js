// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// Procesamiento del texto técnico que el vendedor copia y pega desde la página del proveedor (25/11/2026).
// Función pura (sin red ni datos). Acepta tablas, listados, párrafos, pares «Característica: valor», pares en dos
// líneas (etiqueta en una línea y valor en la siguiente), columnas separadas por tabulador, «|» o varios espacios.
//
// Reglas (documento «Mejora integral del módulo de Cotizaciones y EETT», §5 y §6):
//   · El texto original se conserva SIEMPRE tal como se pegó (resultado.original).
//   · No se inventa, completa ni modifica ninguna característica: solo se separa, se ordena y se normaliza la forma
//     (espacios, mayúscula inicial de la etiqueta, número y unidad de medida separados). Los valores conservan sus unidades.
//   · Valores negativos («No», «Sin», «No incluye») se conservan.
//   · Duplicados exactos se eliminan; la misma característica con valores distintos se conserva entera y queda marcada
//     como CONTRADICTORIA para revisión (nunca se elige un valor).
//   · Datos incompletos («-», «N/A», «Consultar», etiqueta sin valor) se conservan y quedan marcados.
//   · Contenido publicitario o comercial (precios, cuotas, despacho, stock, vendedor, SKU del proveedor, enlaces,
//     calificaciones) se descarta de la ficha, pero queda listado en «descartados» y en el original.
//   · Lo ambiguo (líneas que podrían ser título o característica) se conserva como texto y se marca para revisar.
//   · Las secciones se generan según lo que traiga el producto: sin categorías vacías ni categorías forzadas.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

const sinTildes = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
export const claveTexto = (s) => sinTildes(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const espacios = (s) => String(s ?? "").replace(/[   ]/g, " ").replace(/[ \t]+/g, " ").trim();

// ── Publicidad y datos comerciales (no pertenecen a una ficha técnica) ──
const PUBLICIDAD = [
  /\$\s?\d/, /\bclp\b/i, /https?:\/\/|www\./i, /\bcuotas?\b/i, /\bsin inter[eé]s\b/i, /\b\d{1,2}\s?%\s?(dcto|desc|off)\b/i, /\bdescuento\b/i,
  /\b(env[ií]o|despacho)s?\s+(gratis|gratuito|express|a domicilio|en \d|hoy|mañana)\b/i, /\bretiro en tienda\b/i, /\bagregar al carro\b/i,
  /\bcomprar ahora\b/i, /\bver m[aá]s\b/i, /\bver menos\b/i, /\bopiniones?\b/i, /\bcalificaci[oó]n/i, /\brese[ñn]as?\b/i, /\b\d(,\d)?\s?(de 5|estrellas?)\b/i,
  /\bstock\b/i, /\bdisponible(s)? (en|para) (tienda|despacho)/i, /\bvendido por\b/i, /\bdespachado por\b/i, /\bexclusivo (internet|online|web)\b/i,
  /\bcyber\b/i, /\bblack friday\b/i, /\boferta\b/i, /\bprecio\b/i, /\bcmr\b/i, /\bpuntos\b/i, /\bgarant[ií]a extendida\b/i, /\bcomparar\b/i,
  /\bcompartir\b/i, /\bseguir comprando\b/i, /\bunidades? disponibles?\b/i, /\b(sku|c[oó]digo (falabella|sodimac|paris|ripley|lider|interno|de producto del vendedor))\b/i,
];
const ETIQUETAS_COMERCIALES = /^(sku|c[oó]digo (falabella|sodimac|paris|ripley|lider|interno)|vendido por|despachado por|precio.*|stock|despacho|env[ií]o|retiro|cuotas|tienda|vendedor|cmr)$/i;
export const esPublicidad = (linea) => PUBLICIDAD.some((re) => re.test(linea));

// ── Valores incompletos y negativos ──
const INCOMPLETO = /^(-+|—|–|n\/?a|no aplica|s\/i|sin informaci[oó]n|consultar|por confirmar|por definir|\?+|\.+)$/i;
export const valorIncompleto = (v) => !espacios(v) || INCOMPLETO.test(espacios(v));
export const valorNegativo = (v) => /^(no|sin|ninguno|ninguna|no incluye|no posee|no aplica)\b/i.test(espacios(v));

// ── Unidades: solo se separa el número de la unidad y se escribe la unidad con su forma habitual ──
const UNIDADES = [["v", "V"], ["vac", "VAC"], ["vdc", "VDC"], ["w", "W"], ["kw", "kW"], ["hz", "Hz"], ["mhz", "MHz"], ["ghz", "GHz"], ["mah", "mAh"], ["ah", "Ah"],
  ["a", "A"], ["ma", "mA"], ["gb", "GB"], ["tb", "TB"], ["mb", "MB"], ["kg", "kg"], ["g", "g"], ["mm", "mm"], ["cm", "cm"], ["m", "m"], ["lts", "L"], ["lt", "L"], ["l", "L"],
  ["ml", "ml"], ["db", "dB"], ["rpm", "rpm"], ["bar", "bar"], ["psi", "psi"], ["btu", "BTU"], ["ppm", "ppm"], ["dpi", "dpi"], ["nits", "nits"], ["mp", "MP"], ["fps", "fps"]];
const MAPA_UNIDAD = new Map(UNIDADES);
export function normalizarUnidades(valor) {
  return espacios(valor).replace(/(\d)(?:\s?)([a-zA-Z]{1,4})(?![A-Za-zÀ-ÿ0-9])/g, (todo, d, u) => {
    const ok = MAPA_UNIDAD.get(u.toLowerCase());
    return ok ? `${d} ${ok}` : todo;
  }).replace(/(\d)\s*["”]\s*(?=\s|$|,|;)/g, '$1"').replace(/\s+([,;])/g, "$1");
}

// ── Nombres de características (sinónimos conservadores; el resto solo con mayúscula inicial) ──
const SINONIMOS = [
  [/^(tama[nñ]o( de( la)?)? pantalla|pulgadas|tama[nñ]o pulgadas|pantalla \(pulgadas\))$/, "Tamaño de pantalla"],
  [/^(resoluci[oó]n( de pantalla)?|resoluci[oó]n pantalla)$/, "Resolución"],
  [/^(memoria ram|ram|memoria \(ram\)|capacidad (de )?memoria ram)$/, "Memoria RAM"],
  [/^(almacenamiento|capacidad (de )?almacenamiento|disco duro|capacidad disco|ssd)$/, "Almacenamiento"],
  [/^(procesador|cpu|modelo (del )?procesador)$/, "Procesador"],
  [/^(sistema operativo|so|s\.o\.)$/, "Sistema operativo"],
  [/^(peso( neto)?|peso del producto)$/, "Peso"],
  [/^(dimensiones|medidas|dimensiones del producto|medidas del producto)$/, "Dimensiones"],
  [/^(voltaje|tensi[oó]n|tensi[oó]n de alimentaci[oó]n|voltaje de entrada)$/, "Voltaje"],
  [/^(potencia|potencia nominal|potencia \(w\))$/, "Potencia"],
  [/^(garant[ií]a|garant[ií]a del fabricante|garant[ií]a del proveedor)$/, "Garantía"],
  [/^(pa[ií]s de origen|origen|hecho en|fabricado en)$/, "País de origen"],
  [/^(conectividad|conexiones|conectores)$/, "Conectividad"],
  [/^(material|materiales|material principal)$/, "Material"],
  [/^(capacidad|capacidad m[aá]xima)$/, "Capacidad"],
  [/^(incluye|contenido de la caja|accesorios|accesorios incluidos|qu[eé] incluye)$/, "Accesorios incluidos"],
];
const SIGLAS = /\b(ram|ssd|hdd|usb|hdmi|led|lcd|oled|qled|uhd|hd|wifi|wi-fi|ip|cpu|gpu|vga|lan|nfc|gps|dpi|ppm|btu|ac|dc|ups|tv|pc|ce|iso|nch|sec|ul|rohs)\b/gi;
export function normalizarEtiqueta(etq) {
  let e = espacios(etq).replace(/^[•·▪◦●○■□►▶✓✔\-–—*]+\s*/, "").replace(/\s*[:：]+\s*$/, "").trim();
  const k = claveTexto(e);
  for (const [re, nombre] of SINONIMOS) if (re.test(k)) return nombre;
  if (e === e.toUpperCase() && /[A-ZÁÉÍÓÚÑ]{4,}/.test(e)) e = e.toLowerCase();   // ETIQUETA EN MAYÚSCULAS → Etiqueta
  e = e.charAt(0).toUpperCase() + e.slice(1);
  return e.replace(SIGLAS, (s) => (s.toLowerCase() === "wi-fi" || s.toLowerCase() === "wifi" ? "Wi-Fi" : s.toUpperCase()));
}

// ── Categorías dinámicas (referenciales: solo aparecen las que tienen datos; lo no clasificado va a «Otras características») ──
export const CATEGORIAS = [
  { id: "general", titulo: "Identificación", re: /\b(marca|modelo|color|tipo|linea|serie|pais de origen|origen|ano|año|version|codigo de fabricante|numero de parte|part number|uso)\b/ },
  { id: "pantalla", titulo: "Pantalla e imagen", re: /\b(pantalla|resolucion|pulgadas|panel|hdr|brillo|nits|contraste|tasa de refresco|refresco|hz de pantalla|imagen|smart tv|tactil|display|tamano de pantalla)\b/ },
  { id: "procesamiento", titulo: "Procesamiento", re: /\b(procesador|cpu|nucleos|nucleo|hilos|frecuencia|ghz|chipset|tarjeta grafica|grafica|gpu|video integrado)\b/ },
  { id: "memoria", titulo: "Memoria y almacenamiento", re: /\b(memoria|ram|almacenamiento|ssd|hdd|disco|emmc|ranura|expansion)\b/ },
  { id: "conectividad", titulo: "Conectividad", re: /\b(conectividad|conexion|conexiones|puerto|puertos|usb|hdmi|wi ?fi|bluetooth|ethernet|lan|rj45|nfc|inalambric\w*|red|entrada|salida|vga|displayport|thunderbolt|gps)\b/ },
  { id: "audio", titulo: "Audio", re: /\b(audio|sonido|parlante|parlantes|altavoz|altavoces|potencia de audio|dolby|microfono|auricular)\b/ },
  { id: "software", titulo: "Software y funciones", re: /\b(sistema operativo|software|aplicaciones|asistente|funciones|modo|control por voz|app)\b/ },
  { id: "impresion", titulo: "Impresión y rendimiento", re: /\b(impresion|imprime|tinta|toner|cartucho|ppm|paginas por minuto|ciclo de trabajo|escaneo|copiado|duplex|rendimiento)\b/ },
  { id: "electrica", titulo: "Características eléctricas", re: /\b(voltaje|tension|potencia|consumo|corriente|amperaje|frecuencia de red|alimentacion|bateria|autonomia|carga|cargador|fase|monofasic\w*|trifasic\w*|enchufe|cable de poder|watts|vatios)\b/ },
  { id: "proteccion", titulo: "Protecciones y seguridad", re: /\b(proteccion|protecciones|sobrecarga|cortocircuito|termico|fusible|seguridad|ip\d{2}|grado de proteccion|aislacion|tierra)\b/ },
  { id: "operacion", titulo: "Operación y capacidad", re: /\b(velocidad|rpm|caudal|presion|capacidad|torque|golpes|carrera|rendimiento|ciclo|tiempo de|rango|alcance|nivel de ruido|db)\b/ },
  { id: "ergonomia", titulo: "Ergonomía y ajustes", re: /\b(ergonom\w*|respaldo|apoyabrazos|apoya brazos|apoyacabezas|apoyapies|reclinacion|reclinable|altura regulable|ajuste|soporte lumbar|lumbar|apoyo lumbar|cabecero|mecanismo|giratori\w*|ruedas|asiento)\b/ },
  { id: "materiales", titulo: "Materiales y construcción", re: /\b(material|materiales|estructura|tapiz|tapizado|malla|acabado|base|cuerpo|carcasa|madera|metal|acero|aluminio|plastico|polipropileno|nylon|cuero|tela|espuma|vidrio)\b/ },
  { id: "dimensiones", titulo: "Dimensiones y peso", re: /\b(dimension|dimensiones|medida|medidas|alto|ancho|profundidad|largo|diametro|espesor|peso|altura)\b/ },
  { id: "ambiente", titulo: "Condiciones ambientales", re: /\b(temperatura|humedad|ambiente|altitud|operacion a|almacenamiento a|intemperie)\b/ },
  { id: "normas", titulo: "Certificaciones y normas", re: /\b(certificacion|certificaciones|certificado|norma|normas|sec|iso|ce|ul|rohs|energy star|eficiencia energetica)\b/ },
  { id: "accesorios", titulo: "Accesorios incluidos", re: /\b(incluye|incluido|incluidos|accesorio|accesorios|contenido de la caja|control remoto|manual)\b/ },
  { id: "garantia", titulo: "Garantía", re: /\b(garantia)\b/ },
];
const OTRAS = { id: "otras", titulo: "Otras características" };
export function categoriaDe(etiqueta) {
  const k = claveTexto(etiqueta);
  // La etiqueta manda (p. ej. «Peso máximo soportado» es capacidad, no dimensiones): se prueba en orden con prioridad a las más específicas.
  if (/\bgarantia\b/.test(k)) return "garantia";
  if (/\b(incluye|accesorios|contenido de la caja)\b/.test(k)) return "accesorios";
  if (/\b(peso maximo|capacidad|soporta)\b/.test(k)) return "operacion";
  if (/\b(material|materiales|tapiz|tapizado|acabado)\b/.test(k)) return "materiales";
  if (/\b(actualizacion|refresco|tasa de refresco|resolucion|retroiluminacion|pantalla|hdr|contraste|3d|curvo)\b/.test(k)) return "pantalla";
  if (/\b(sistema operativo|asistentes?|apps?|aplicaciones|smart)\b/.test(k)) return "software";
  if (/\b(vesa|montaje|soporte)\b/.test(k) && !/\b(ancho|alto|altura|profundidad|peso)\b/.test(k)) return "materiales";
  if (/\b(apoyacabezas|apoya cabezas|cabecero|apoyapies|apoya pies|apoyabrazos|reposabrazos)\b/.test(k)) return "ergonomia";
  for (const c of CATEGORIAS) if (c.re.test(k)) return c.id;
  return "otras";
}
export const tituloCategoria = (id) => (CATEGORIAS.find((c) => c.id === id) || OTRAS).titulo;

// ── Lectura de líneas ──
const VINETA = /^[•·▪◦●○■□►▶✓✔\-–—*]\s*/;
const pareceEtiqueta = (l) => l.length <= 45 && !/[.;!?]$/.test(l) && /[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(l) && l.split(/\s+/).length <= 6 && !/[:\t|]/.test(l);
function parDeLinea(l) {
  let m = l.match(/^([^:：\t|]{1,70}?)\s*[:：]\s*(\S.*)$/);
  if (m && /[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(m[1]) && !/^https?$/i.test(m[1]) && m[1].split(/\s+/).length <= 8) return [m[1], m[2], "dos_puntos"];
  m = l.match(/^([^\t]{1,70})\t+(\S.*)$/); if (m) return [m[1], m[2], "tabulador"];
  m = l.match(/^\|?\s*([^|]{1,70}?)\s*\|\s*([^|]+?)\s*\|?$/); if (m) return [m[1], m[2], "tabla"];
  m = l.match(/^(.{1,60}?\S) {3,}(\S.*)$/); if (m) return [m[1], m[2], "columnas"];
  return null;
}

// Formato «ficha en dos líneas» (25/11/2026, p. ej. Mercado Libre): títulos de sección («Conectividad», «Pantalla»,
// «Peso y dimensiones»…) seguidos de pares etiqueta / valor en líneas separadas, a veces con una etiqueta sin valor.
const SECCIONES = new Set(["caracteristicas principales", "caracteristicas generales", "otras caracteristicas", "otros", "tecnologia", "conectividad",
  "conexiones", "puertos", "accesorios", "pantalla", "imagen", "video", "audio", "sonido", "peso y dimensiones", "dimensiones", "medidas",
  "diseno", "energia", "bateria", "alimentacion", "memoria", "almacenamiento", "procesador", "procesamiento", "camara", "camaras", "sistema",
  "generales", "general", "seguridad", "garantia", "rendimiento", "materiales", "especificaciones generales", "informacion general",
  "otras especificaciones", "funciones", "caracteristicas", "ergonomia", "ajustes", "uso", "certificaciones"]);
const SECCION_CATEGORIA = { tecnologia: "software", conectividad: "conectividad", conexiones: "conectividad", puertos: "conectividad", accesorios: "accesorios",
  pantalla: "pantalla", imagen: "pantalla", video: "pantalla", audio: "audio", sonido: "audio", "peso y dimensiones": "dimensiones", dimensiones: "dimensiones",
  medidas: "dimensiones", energia: "electrica", bateria: "electrica", alimentacion: "electrica", memoria: "memoria", almacenamiento: "memoria",
  procesador: "procesamiento", procesamiento: "procesamiento", seguridad: "proteccion", garantia: "garantia", materiales: "materiales",
  funciones: "software", ergonomia: "ergonomia", ajustes: "ergonomia", certificaciones: "normas" };
const esSeccion = (l) => SECCIONES.has(claveTexto(l)) || CATEGORIAS.some((c) => claveTexto(c.titulo) === claveTexto(l));
// Valor inequívoco: sí/no o empieza con un número o comillas («55 "», «4K», «9,3 kg», «2»).
const valorClaro = (x) => /^(s[ií]|no|ninguno|ninguna)$/i.test(x) || /^[\d"'”(]/.test(x);
// Comienzo típico de una etiqueta de ficha («Con HDMI», «Es smart», «Tipo de pantalla», «Cantidad de puertos USB»…).
const INICIO_ETIQUETA = /^(con|es|tiene|tipo|cantidad|n[uú]mero|tama[nñ]o|resoluci[oó]n|relaci[oó]n|frecuencia|ancho|alto|altura|profundidad|peso|largo|di[aá]metro|modelo|marca|color|material(es)?|capacidad|potencia|voltaje|tensi[oó]n|consumo|apps?|aplicaciones|asistentes?|sistema|accesorios|incluye|duraci[oó]n|velocidad|formato|versi[oó]n|compatib\w*|garant[ií]a|memoria|almacenamiento|procesador|bater[ií]a|puertos?|entradas?|salidas?|dimensiones|medidas|origen|l[ií]nea|serie|a[nñ]o|certific\w*|nivel|rango|temperatura|cantidad)\b/i;

// Procesa el texto pegado. Devuelve una PROPUESTA para revisar; nada se guarda hasta que el vendedor la acepta.
export function procesarTextoTecnico(texto, { marca = "", modelo = "", nombre = "" } = {}) {
  const original = String(texto ?? "");
  // Los tabuladores se conservan para reconocer columnas (tablas copiadas); el resto de espacios se normaliza.
  const linea = (l) => String(l).replace(/[\u00a0\u2007\u202f]/g, " ").replace(/ +/g, " ").replace(/ *\t */g, "\t").replace(VINETA, "").trim();
  const lineas = original.replace(/\r/g, "").split("\n").map(linea).filter(Boolean);
  const pares = []; const textos = []; const descartados = []; const avisos = []; const sinValor = [];
  const dosLineas = new Set();   // índices de líneas usadas por el formato en dos líneas (títulos, pares y etiquetas sin valor)
  let seccion = "";
  const oracion = (x) => /[.!?]$/.test(x) || x.length > 80;
  const corta = (x) => x && !parDeLinea(x) && !esPublicidad(x) && !oracion(x);
  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i];
    if (/^(caracter[ií]sticas|especificaciones( t[eé]cnicas)?|ficha t[eé]cnica|descripci[oó]n|detalles?( del producto)?|informaci[oó]n adicional|especificaciones del producto)\s*:?$/i.test(l)) { seccion = ""; continue; } // títulos de la página
    if (esPublicidad(l)) { descartados.push(l); continue; }
    const p = parDeLinea(l);
    if (p) { pares.push({ etiqueta: espacios(p[0]), valor: espacios(p[1]), origen: p[2], linea: i + 1, seccion }); continue; }
    const sig = lineas[i + 1], sig2 = lineas[i + 2];
    // Título de sección: va seguido de una etiqueta (no de un valor). Sirve de pista de categoría y no se imprime.
    if (esSeccion(l) && corta(sig) && !valorClaro(sig) && (INICIO_ETIQUETA.test(sig) || (corta(sig2) && valorClaro(sig2)))) { seccion = claveTexto(l); dosLineas.add(i); continue; }
    if (sig && pareceEtiqueta(l) && !valorClaro(l) && corta(sig) && !esSeccion(sig)) {
      // Etiqueta + valor inequívoco, o + un texto que no parece etiqueta («Control remoto», «Vidaa», «QLED»).
      if (valorClaro(sig) || !INICIO_ETIQUETA.test(sig)) { pares.push({ etiqueta: espacios(l), valor: espacios(sig), origen: "dos_lineas", linea: i + 1, seccion }); dosLineas.add(i).add(i + 1); i++; continue; }
      // La siguiente es otra etiqueta con su valor: esta etiqueta vino sin valor (no se inventa; queda para revisar).
      if (corta(sig2) && (valorClaro(sig2) || !INICIO_ETIQUETA.test(sig2)) && INICIO_ETIQUETA.test(l)) { sinValor.push(espacios(l)); dosLineas.add(i); continue; }
    }
    // Dos líneas: etiqueta corta seguida de un valor (tablas copiadas como columnas). Si la siguiente también parece
    // etiqueta y la que sigue a esa no, la interpretación es ambigua: se conserva como texto y se pide revisar.
    if (sig && pareceEtiqueta(l) && !parDeLinea(sig) && !esPublicidad(sig) && !oracion(sig)) {
      const sig2 = lineas[i + 2];
      const ambigua = pareceEtiqueta(sig) && sig2 && !pareceEtiqueta(sig2) && !parDeLinea(sig2) && !oracion(sig2) && !esPublicidad(sig2);
      if (!ambigua) { pares.push({ etiqueta: espacios(l), valor: espacios(sig), origen: "dos_lineas", linea: i + 1, seccion }); dosLineas.add(i).add(i + 1); i++; continue; }
    }
    textos.push({ texto: espacios(l), linea: i + 1 });
  }
  // Normalización, comerciales, duplicados y contradicciones.
  const vistos = new Map(); const filas = [];
  for (const p of pares) {
    const etiqueta = normalizarEtiqueta(p.etiqueta); const valor = normalizarUnidades(p.valor);
    if (ETIQUETAS_COMERCIALES.test(claveTexto(etiqueta)) || esPublicidad(`${etiqueta} ${valor}`) && !/^garant/i.test(claveTexto(etiqueta))) { descartados.push(`${p.etiqueta}: ${p.valor}`); continue; }
    const k = claveTexto(etiqueta);
    const previos = vistos.get(k) || [];
    if (previos.some((f) => claveTexto(f.valor) === claveTexto(valor))) continue;              // duplicado exacto
    // Categoría por la etiqueta; si no se reconoce, por el título de sección de la página (p. ej. «Conectividad»).
    const cat = categoriaDe(etiqueta);
    const fila = { etiqueta, valor, categoria: cat === "otras" && SECCION_CATEGORIA[p.seccion] ? SECCION_CATEGORIA[p.seccion] : cat, original: `${p.etiqueta}${p.origen === "dos_lineas" ? " / " : ": "}${p.valor}`, origen: p.origen };
    if (valorIncompleto(valor)) fila.incompleto = true;
    if (previos.length) { fila.contradictorio = true; previos.forEach((f) => { f.contradictorio = true; }); }
    previos.push(fila); vistos.set(k, previos); filas.push(fila);
  }
  // Marca y modelo de la ficha frente a los del texto (solo aviso; no se corrige).
  for (const [campo, actual] of [["Marca", marca], ["Modelo", modelo]]) {
    const enTexto = vistos.get(claveTexto(campo)); const a = espacios(actual);
    if (a && enTexto?.length && !enTexto.some((f) => claveTexto(f.valor) === claveTexto(a)))
      avisos.push({ tipo: "contradiccion", etiqueta: campo, mensaje: `${campo}: la ficha dice «${a}» y el texto pegado dice «${enTexto.map((f) => f.valor).join(" / ")}». Revisa cuál es el correcto.` });
  }
  filas.filter((f) => f.contradictorio).reduce((acc, f) => acc.add(f.etiqueta), new Set()).forEach((e) => {
    avisos.push({ tipo: "contradiccion", etiqueta: e, mensaje: `«${e}» aparece con valores distintos (${filas.filter((f) => f.etiqueta === e).map((f) => `«${f.valor}»`).join(", ")}). Se conservan todos hasta que elijas.` });
  });
  filas.filter((f) => f.incompleto).forEach((f) => avisos.push({ tipo: "incompleto", etiqueta: f.etiqueta, mensaje: `«${f.etiqueta}» no tiene un valor informado («${f.valor || "vacío"}»).` }));
  // Textos sueltos: frases descriptivas → descripción original; líneas cortas sin pareja → ambiguas (se conservan para revisar).
  const parrafos = []; const ambiguos = [];
  for (const t of textos) {
    if (t.texto.length >= 45 || /[.;!?]$/.test(t.texto)) parrafos.push(t.texto);
    else ambiguos.push(t.texto);
  }
  if (sinValor.length) avisos.push({ tipo: "incompleto", mensaje: `${sinValor.length === 1 ? "Una característica vino" : `${sinValor.length} características vinieron`} sin valor y no se incluye${sinValor.length === 1 ? "" : "n"}: ${sinValor.map((x) => `«${x}»`).join(", ")}.` });
  sinValor.forEach((x) => descartados.push(`${x}: (sin valor)`));
  if (ambiguos.length) avisos.push({ tipo: "ambiguo", mensaje: `${ambiguos.length} línea${ambiguos.length === 1 ? "" : "s"} sin un valor claro: se conservan como texto para que decidas (${ambiguos.slice(0, 3).map((x) => `«${x}»`).join(", ")}${ambiguos.length > 3 ? "…" : ""}).` });
  if (!filas.length && !parrafos.length) avisos.push({ tipo: "vacio", mensaje: "No se reconocieron características en el texto pegado." });
  const categorias = agruparPorCategoria(filas);
  return { original, filas, categorias, parrafos, ambiguos, descartados, avisos, descripcion: descripcionTecnica({ nombre, marca, modelo, filas }), lineas, dosLineas };
}

// Agrupa las filas en las categorías que tienen datos (orden fijo de CATEGORIAS; «Otras características» al final).
export function agruparPorCategoria(filas) {
  const grupos = new Map();
  for (const f of filas || []) { const id = f.categoria || categoriaDe(f.etiqueta); if (!grupos.has(id)) grupos.set(id, []); grupos.get(id).push(f); }
  const orden = [...CATEGORIAS.map((c) => c.id), "otras"];
  return orden.filter((id) => grupos.get(id)?.length).map((id) => ({ id, titulo: tituloCategoria(id), filas: grupos.get(id) }));
}

// Descripción técnica breve, objetiva y respaldada: solo datos presentes en la ficha (identificación + hasta 4 datos
// principales en el orden de las categorías). Sin adjetivos ni afirmaciones que no estén en la información.
const PRINCIPALES = ["pantalla", "procesamiento", "memoria", "impresion", "electrica", "operacion", "materiales", "ergonomia", "conectividad", "dimensiones"];
export function descripcionTecnica({ nombre = "", marca = "", modelo = "", filas = [] } = {}) {
  const util = (filas || []).filter((f) => !f.incompleto && !f.contradictorio && f.valor && !["general", "garantia", "accesorios", "otras", "normas"].includes(f.categoria));
  const elegidas = [];
  for (const cat of PRINCIPALES) { const f = util.find((x) => x.categoria === cat && !elegidas.includes(x)); if (f) elegidas.push(f); if (elegidas.length >= 4) break; }
  const ident = [espacios(nombre), marca && !claveTexto(nombre).includes(claveTexto(marca)) ? `marca ${espacios(marca)}` : "", modelo && !claveTexto(nombre).includes(claveTexto(modelo)) ? `modelo ${espacios(modelo)}` : ""].filter(Boolean).join(", ");
  if (!ident && !elegidas.length) return "";
  const datos = elegidas.map((f) => `${f.etiqueta.charAt(0).toLowerCase()}${f.etiqueta.slice(1)}: ${f.valor}`).join("; ");
  return [ident ? `${ident}.` : "", datos ? `${datos.charAt(0).toUpperCase()}${datos.slice(1)}.` : ""].filter(Boolean).join(" ");
}

// Ficha técnica (modelo del editor: generales / especificaciones) → filas con categoría. Lo que el vendedor ya revisó en la
// ficha manda: este paso solo agrupa para el documento.
export function filasDeFicha(ficha) {
  const f = ficha || {};
  const filas = [];
  const vistos = new Set();
  const push = (etiqueta, valor) => {
    const e = espacios(etiqueta), v = espacios(valor);
    if (!e && !v) return;
    const k = `${claveTexto(e)}|${claveTexto(v)}`; if (vistos.has(k)) return null; vistos.add(k);
    const fila = { etiqueta: e ? normalizarEtiqueta(e) : "", valor: v, categoria: e ? categoriaDe(e) : "otras" };
    filas.push(fila); return fila;
  };
  if (f.marca) push("Marca", f.marca);
  if (f.modelo) push("Modelo", f.modelo);
  if (f.color) push("Color", f.color);
  for (const p of [...(f.generales || []), ...(f.especificaciones || [])]) {
    if (/^(marca|modelo|color)$/i.test(espacios(p?.etiqueta)) && filas.some((x) => claveTexto(x.etiqueta) === claveTexto(p.etiqueta) && claveTexto(x.valor) === claveTexto(p.valor))) continue;
    const fila = push(p?.etiqueta, p?.valor);
    // Categoría elegida por el vendedor al revisar (si existe) manda sobre la automática.
    if (fila && p?.categoria && CATEGORIAS.concat([OTRAS]).some((c) => c.id === p.categoria)) fila.categoria = p.categoria;
  }
  // Misma característica con valores distintos → contradictoria; sin valor informado → incompleta (solo se marcan).
  const porEtq = new Map();
  for (const x of filas) { if (!x.etiqueta) continue; const k = claveTexto(x.etiqueta); porEtq.set(k, [...(porEtq.get(k) || []), x]); }
  for (const lista of porEtq.values()) if (lista.length > 1) lista.forEach((x) => { x.contradictorio = true; });
  for (const x of filas) if (x.etiqueta && valorIncompleto(x.valor)) x.incompleto = true;
  return filas;
}

// ── Reordenamiento automático de una ficha (25/11/2026) ──
// Cuando la ficha técnica se pegó «tal cual» (p. ej. desde Mercado Libre, con la etiqueta en una línea y el valor en la
// siguiente), las líneas quedan sin valor y terminaban todas en la descripción. Aquí, cada bloque de líneas sin valor
// (en Características generales, en Especificaciones o en la Descripción) se vuelve a leer con procesarTextoTecnico: si
// forma al menos dos pares claros, esos pares pasan a Especificaciones (con su categoría) y los párrafos quedan en la
// descripción. Si un bloque no forma pares, queda exactamente como estaba. No se inventa ningún valor; las etiquetas sin
// valor y los textos publicitarios de un bloque reordenado no se imprimen.
export function reestructurarFicha(ficha) {
  const f = ficha || {};
  const conValor = (lista) => (lista || []).filter((p) => espacios(p?.valor));
  const sueltas = (lista) => (lista || []).filter((p) => !espacios(p?.valor) && espacios(p?.etiqueta)).map((p) => espacios(p.etiqueta));
  const bloques = { generales: sueltas(f.generales), especificaciones: sueltas(f.especificaciones),
    descripcion: String(f.descripcion || "").replace(/\r/g, "").split("\n").map(espacios).filter(Boolean) };
  const nuevas = []; const textos = []; const cambiado = {};
  for (const [k, lineas] of Object.entries(bloques)) {
    if (lineas.length < 4) continue;
    const r = procesarTextoTecnico(lineas.join("\n"));
    const claras = r.filas.filter((x) => x.origen === "dos_lineas" && !x.incompleto);
    if (claras.length < 2) continue;
    cambiado[k] = true;
    nuevas.push(...claras.map((x) => ({ etiqueta: x.etiqueta, valor: x.valor, categoria: x.categoria })));
    // Lo que no vino en dos líneas (párrafos, «Etiqueta: valor», códigos…) se conserva tal cual, en su orden.
    textos.push(...r.lineas.filter((_, i) => !r.dosLineas.has(i)));
  }
  if (!Object.keys(cambiado).length) return f;
  const descripcion = cambiado.descripcion ? textos.join("\n") : [f.descripcion, ...textos].filter((x) => espacios(x)).join("\n");
  return {
    ...f,
    generales: cambiado.generales ? conValor(f.generales) : f.generales,
    especificaciones: [...(cambiado.especificaciones ? conValor(f.especificaciones) : f.especificaciones || []), ...nuevas],
    descripcion,
  };
}
