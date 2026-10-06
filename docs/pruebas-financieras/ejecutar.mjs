// Empaqueta y ejecuta las pruebas unitarias de la Fase 4B (resuelve imports de src/ y JSX con esbuild).
// Ejecutar: node docs/pruebas-financieras/ejecutar.mjs
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
const D = path.dirname(fileURLToPath(import.meta.url));
const salida = path.join(process.env.TMPDIR || "/tmp", "reglas_4b.bundle.mjs");
await build({ entryPoints: [path.join(D, "reglas_4b.test.mjs")], bundle: true, platform: "node", format: "esm", outfile: salida, logLevel: "error", jsx: "automatic", loader: { ".js": "jsx" } });
execFileSync(process.execPath, [salida], { stdio: "inherit" });
