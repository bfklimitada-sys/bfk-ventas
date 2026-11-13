// Empaqueta y ejecuta las pruebas de la comisión ligada a la liquidación de la OC (13/11/2026).
// La versión anterior (main antes del cambio) se usa para comprobar que los registros históricos dan EXACTAMENTE lo mismo.
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
const D = path.dirname(fileURLToPath(import.meta.url));
const anterior = path.resolve(process.argv[2] || process.env.BFK_ANTERIOR || "/tmp/bfk-main");
const salida = path.join(process.env.TMPDIR || "/tmp", "reglas_comision_liquidacion.bundle.mjs");
await build({ entryPoints: [path.join(D, "reglas.test.mjs")], bundle: true, platform: "node", format: "esm", outfile: salida, logLevel: "error",
  alias: { "@anterior": path.join(anterior, "src/lib") } });
execFileSync(process.execPath, [salida], { stdio: "inherit" });
