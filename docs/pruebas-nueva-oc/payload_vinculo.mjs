// Lee {c, items, envios, numero} (filas tal como las entrega la base) por la entrada estándar y escribe el parámetro de
// cz_guardar_cotizacion_v2 que arma «Nueva OC» para vincular (lib/nuevaOCCotizacion.js → payloadVinculo).
// Uso (solo pruebas locales): node payload_vinculo.mjs < filas.json > p.json
import { payloadVinculo } from "../../src/lib/nuevaOCCotizacion.js";
let txt = ""; for await (const ch of process.stdin) txt += ch;
const { c, items, envios, numero } = JSON.parse(txt);
process.stdout.write(JSON.stringify(payloadVinculo(c, items || [], envios || [], numero)));
