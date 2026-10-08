// Empaqueta y ejecuta las pruebas unitarias de la pagos a vendedores (resuelve imports de src/ y JSX con esbuild).
// Ejecutar: node docs/pruebas-pagos-vendedor/ejecutar.mjs
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
const D = path.dirname(fileURLToPath(import.meta.url));
const salida = path.join(process.env.TMPDIR || "/tmp", "reglas_pagos.bundle.mjs");
await build({ entryPoints: [path.join(D, "reglas_pagos.test.mjs")], bundle: true, platform: "node", format: "esm", outfile: salida, logLevel: "error", banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" }, jsx: "automatic", loader: { ".js": "jsx" } });
execFileSync(process.execPath, [salida], { stdio: "inherit" });
