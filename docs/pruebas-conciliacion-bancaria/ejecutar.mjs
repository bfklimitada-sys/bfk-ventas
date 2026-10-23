// Empaqueta y ejecuta las pruebas unitarias de la conciliación bancaria (Etapas 1-3) (resuelve imports de src/ y JSX con esbuild).
// Ejecutar: node docs/pruebas-conciliacion-bancaria/ejecutar.mjs
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
const D = path.dirname(fileURLToPath(import.meta.url));
let fallo = false;
for (const t of ["reglas.test.mjs", "simple.test.mjs", "revision.test.mjs", "automatica.test.mjs", "lote.test.mjs"]) {
  const salida = path.join(process.env.TMPDIR || "/tmp", `${t}.conciliacion.bundle.mjs`);
  await build({ entryPoints: [path.join(D, t)], bundle: true, platform: "node", format: "esm", outfile: salida, logLevel: "error", banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" }, jsx: "automatic", loader: { ".js": "jsx" } });
  try { execFileSync(process.execPath, [salida], { stdio: "inherit" }); } catch { fallo = true; }
}
if (fallo) process.exitCode = 1;
