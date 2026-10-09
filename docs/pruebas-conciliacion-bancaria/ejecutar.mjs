// Empaqueta y ejecuta las pruebas unitarias de la conciliación bancaria (Etapas 1-3) (resuelve imports de src/ y JSX con esbuild).
// Ejecutar: node docs/pruebas-conciliacion-bancaria/ejecutar.mjs
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
const D = path.dirname(fileURLToPath(import.meta.url));
const salida = path.join(process.env.TMPDIR || "/tmp", "reglas_conciliacion_bancaria.bundle.mjs");
await build({ entryPoints: [path.join(D, "reglas.test.mjs")], bundle: true, platform: "node", format: "esm", outfile: salida, logLevel: "error", banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" }, jsx: "automatic", loader: { ".js": "jsx" } });
execFileSync(process.execPath, [salida], { stdio: "inherit" });
