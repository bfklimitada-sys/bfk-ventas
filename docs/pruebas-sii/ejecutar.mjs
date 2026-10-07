// Empaqueta las pruebas con esbuild y las ejecuta.  node docs/pruebas-iva-unificado/ejecutar.mjs
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
const D = path.dirname(fileURLToPath(import.meta.url));
const salida = path.join(process.env.TMPDIR || "/tmp", "reglas_sii.bundle.mjs");
await build({ entryPoints: [path.join(D, "reglas.test.mjs")], bundle: true, platform: "node", format: "esm", outfile: salida, logLevel: "error" });
execFileSync(process.execPath, [salida], { stdio: "inherit" });
