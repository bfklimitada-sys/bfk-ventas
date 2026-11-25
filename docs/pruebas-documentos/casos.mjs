// Casos de prueba del generador documental (25/11/2026). Datos SIMULADOS (no son ofertas reales de BFK): el televisor
// Samsung, la silla ergonómica RD y la silla Syra de los ejemplos de diseño, más casos de 10 productos, información
// incompleta, contradictoria y extensa. Las imágenes de prueba están en ./imagenes.
import fs from "node:fs";
import path from "node:path";

// Se ejecuta empaquetado (esbuild) desde la raíz del repositorio: las rutas se resuelven desde ahí.
const DIR = path.resolve(process.env.RAIZ_BFK || ".", "docs/pruebas-documentos");
const raiz = path.resolve(process.env.RAIZ_BFK || ".");
export const dataUrl = (archivo, tipo = "image/jpeg") => `data:${tipo};base64,${fs.readFileSync(archivo).toString("base64")}`;
// Imágenes de prueba: figuras sintéticas (sin fotos de terceros en el repositorio). Con IMAGENES_DIR se usan otras (p. ej. las
// fotografías de los ejemplos de diseño, solo en el equipo local, para comparar visualmente con las referencias).
const DIR_IMG = process.env.IMAGENES_DIR || path.join(DIR, "imagenes");
export const IMG = Object.fromEntries(fs.readdirSync(DIR_IMG).filter((f) => /\.(jpe?g|png)$/i.test(f)).map((f) => [f.replace(/\.\w+$/, ""), dataUrl(path.join(DIR_IMG, f))]));
export const LOGO = dataUrl(path.join(raiz, "src/assets/bfk-logo.jpg"));
export const FUENTES = { normal: fs.readFileSync(path.join(raiz, "public/fuentes/LiberationSans-Regular.ttf")).toString("base64"), bold: fs.readFileSync(path.join(raiz, "public/fuentes/LiberationSans-Bold.ttf")).toString("base64") };

export const TEXTO_TV = `Especificaciones
Marca
Samsung
Modelo
UN43U8000HGXPE
Color
Negro
Tamaño de la pantalla
43 pulgadas
Resolución
4K UHD (3840 x 2160)
Frecuencia de actualización: 60hz
HDR: No
Conectividad: Wi-Fi, Bluetooth y Ethernet
Puertos HDMI: 3
Puertos USB: 1
VGA: No
Incluye: Control remoto
Envío gratis a todo Chile
Precio: $199.990
12 cuotas sin interés
Vendido por Tienda Ejemplo`;

export const TEXTO_SILLA = `CARACTERÍSTICAS
Material del respaldo	Malla transpirable
Material del asiento	Espuma alta densidad
Apoyabrazos	Regulables
Altura regulable	Sí
Soporte lumbar	Fijo
Reclinable	Sí, 90° a 130°
Mecanismo	Basculante
Apoyacabezas	Incluido
Base	Nylon reforzado
Ruedas	Sí
Peso máximo soportado	120kg
Apoyapiés	No
⭐⭐⭐⭐⭐ 4,8 de 5 (230 opiniones)
Despacho a domicilio en 48 hrs`;
