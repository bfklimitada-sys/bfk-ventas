// Empaqueta y ejecuta las pruebas unitarias de la Fase 4A (resuelve imports de src/ y JSX con esbuild).
// Ejecutar: node docs/pruebas-oc/ejecutar.mjs
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
const D = path.dirname(fileURLToPath(import.meta.url));
const salida = path.join(process.env.TMPDIR || "/tmp", "reglas_oc.bundle.mjs");
await build({ entryPoints: [path.join(D, "reglas_oc.test.mjs")], bundle: true, platform: "node", format: "esm", outfile: salida, logLevel: "error", jsx: "automatic", loader: { ".js": "jsx" } });
execFileSync(process.execPath, [salida], { stdio: "inherit" });
