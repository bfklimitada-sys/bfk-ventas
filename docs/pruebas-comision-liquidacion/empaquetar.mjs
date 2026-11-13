import { build } from "esbuild"; import path from "node:path"; import { fileURLToPath } from "node:url";
const D = path.dirname(fileURLToPath(import.meta.url));
await build({ entryPoints: [path.join(D, "comparar_real.mjs")], bundle: true, platform: "node", format: "esm", outfile: process.argv[3], logLevel: "error", alias: { "@anterior": path.join(path.resolve(process.argv[2]), "src/lib") } });
console.log("empaquetado", process.argv[3]);
