// Empaqueta y ejecuta las pruebas de liquidaciones cerradas (algunos módulos importan .jsx).
import { build } from "esbuild"; import { execFileSync } from "node:child_process"; import { fileURLToPath } from "node:url"; import path from "node:path";
const D = path.dirname(fileURLToPath(import.meta.url)); const salida = path.join(process.env.TMPDIR || "/tmp", "reglas_liq_cerradas.bundle.mjs");
await build({ entryPoints: [path.join(D, "reglas.test.mjs")], bundle: true, platform: "node", format: "esm", outfile: salida, logLevel: "error", loader: { ".jsx": "jsx", ".jpg": "dataurl" }, jsx: "automatic" });
execFileSync(process.execPath, [salida], { stdio: "inherit" });
