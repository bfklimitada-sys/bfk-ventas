// Compilación de la DEMOSTRACIÓN aislada (no es la app publicada: esa se compila con vite.config.js de la raíz, sin cambios).
// Diferencias con la app real, todas aquí:
//   · La dirección de la base y su clave pública se reemplazan por un dominio inexistente y la palabra «demo».
//   · La página arranca por docs/demo/entrada.js, que instala el servidor simulado antes de cargar la app.
//   · Rutas relativas (base "./") para poder alojarla en cualquier carpeta.
// Dos formatos (DEMO_ARCHIVO=1 elige el segundo):
//   · Alojada (dist/): varios archivos, para el alojamiento de artefactos de Claude (sin diálogos ni descargas del navegador).
//   · Un solo archivo (dist-archivo/index.html): todo dentro de un HTML —código, base, fuentes— que se abre con doble clic,
//     sin servidor y sin internet. Ahí los diálogos, descargas e impresión son los del navegador.
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import react from "@vitejs/plugin-react";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const AQUI = dirname(fileURLToPath(import.meta.url)); const RAIZ = resolve(AQUI, "../..");
const ORIGEN_BD = "https://base-demo.invalid";
const ARCHIVO = process.env.DEMO_ARCHIVO === "1";

const demo = () => ({
  name: "bfk-demo", enforce: "pre",
  transformIndexHtml: { order: "pre", handler: (html) => html.replace('src="/src/main.jsx"', 'src="/docs/demo/entrada.js"').replace(/<title>[^<]*<\/title>/, "<title>BFK Ventas — Demostración con datos ficticios</title>")
    // El alojamiento de la demostración dibuja bajo su propia barra las páginas con viewport-fit=cover: se quita solo aquí.
    .replace(", viewport-fit=cover", "")
    // Un solo archivo: sin recursos de internet. Las fuentes van dentro (entrada.js); Chart.js no lo usa la app (se omite).
    .replace(ARCHIVO ? /\s*<link rel="preconnect"[^>]*>|\s*<link href="https:\/\/fonts\.googleapis\.com[^>]*>|\s*<script src="https:\/\/cdn\.jsdelivr\.net[^>]*><\/script>/g : /$^/, "") },
  transform(codigo, id) {
    if (!/\/src\/lib\/supabase\.jsx$/.test(id.split("?")[0])) return null;
    const nuevo = codigo.replace(/export const SUPABASE_URL = "[^"]+";/, `export const SUPABASE_URL = "${ORIGEN_BD}";`).replace(/export const SUPABASE_ANON_KEY = "[^"]+";/, 'export const SUPABASE_ANON_KEY = "demo";');
    if (nuevo === codigo || /supabase\.co/.test(nuevo.replace(/\/\/.*$/gm, ""))) throw new Error("demo: no se pudo reemplazar la dirección de la base");
    return { code: nuevo, map: null };
  },
});

export default defineConfig({
  root: RAIZ, base: "./", publicDir: false,
  plugins: [demo(), react(), ...(ARCHIVO ? [viteSingleFile({ removeViteModuleLoader: true })] : [])],
  define: { "process.env": "{}", __DEMO_ALOJADA__: JSON.stringify(!ARCHIVO) },
  resolve: { alias: [{ find: "playwright-core", replacement: resolve(AQUI, "vacio.js") }, { find: "node:fs", replacement: resolve(AQUI, "vacio.js") }] },
  optimizeDeps: { exclude: ["@electric-sql/pglite"] },
  build: { outDir: resolve(AQUI, ARCHIVO ? "dist-archivo" : "dist"), emptyOutDir: true, ...(ARCHIVO ? { assetsInlineLimit: 1e9 } : {}), target: "es2022", chunkSizeWarningLimit: 4000,
    // El alojamiento de artefactos no sirve archivos .data ni .bin: el paquete de archivos de PGlite se publica con extensión .wasm
    // (solo cambia el nombre; la página lo lee como bytes, sin interpretarlo como WebAssembly).
    rollupOptions: { output: { ...(ARCHIVO ? { inlineDynamicImports: true } : {}), assetFileNames: (a) => (/\.data$/.test(a.names?.[0] || a.name || "") ? "assets/[name]-archivos-[hash].wasm" : "assets/[name]-[hash][extname]") } } },
});
