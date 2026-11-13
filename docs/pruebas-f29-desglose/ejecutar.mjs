// Empaqueta y ejecuta las pruebas del F29 con desglose.  node docs/pruebas-f29-desglose/ejecutar.mjs [ruta de la versión anterior]
// La versión anterior (main antes del cambio) se usa para comprobar que los registros históricos dan EXACTAMENTE lo mismo.
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
const D = path.dirname(fileURLToPath(import.meta.url));
const anterior = path.resolve(process.argv[2] || process.env.BFK_ANTERIOR || "/tmp/bfk-main");
const salida = path.join(process.env.TMPDIR || "/tmp", "reglas_f29_desglose.bundle.mjs");
await build({ entryPoints: [path.join(D, "reglas.test.mjs")], bundle: true, platform: "node", format: "esm", outfile: salida, logLevel: "error",
  alias: { "@anterior": path.join(anterior, "src/lib") } });
execFileSync(process.execPath, [salida], { stdio: "inherit" });
