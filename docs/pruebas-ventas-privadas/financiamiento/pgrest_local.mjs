// Servidor local con el SUBCONJUNTO del protocolo de PostgREST 12 que usa Ventas privadas, para las pruebas de interfaz en la
// base DESECHABLE (nunca producción). Se usa solo donde el binario de PostgREST no se puede descargar. Igual que PostgREST:
//   · JWT HS256 verificado con el secreto; sin token válido → rol anon. Cada solicitud corre en su transacción con
//     SET LOCAL ROLE (authenticated | anon) y request.jwt.claims, así RLS, privilegios, disparadores y funciones aplican de verdad.
//   · GET /<tabla|vista>?select=a,b&col=eq.x&col=in.(a,b)&col=neq.x&col=ilike.*x*&col=gt|gte|lt|lte.x&col=is.null&or=(…)&order=a.desc,b&limit=n
//   · POST /rpc/<función> con argumentos por nombre (JSON) → resultado JSON de la función.
//   · POST / PATCH / DELETE sobre tablas (los usa Proyectos industriales). La traducción a SQL vive en pgrest_nucleo.mjs.
//   · Errores como PostgREST: {code, message, details, hint} con 400/401/403/404/409.
// Uso: PGRST_DB=postgresql://authenticator@127.0.0.1:5499/bfk_vpfin JWT_SECRET=… PGRST_PORT=3912 node pgrest_local.mjs
import http from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../../package.json", import.meta.url));
const pg = require("pg");
import { atender } from "./pgrest_nucleo.mjs";

const { PGRST_DB, JWT_SECRET, PGRST_PORT = "3912" } = process.env;
if (!PGRST_DB || !JWT_SECRET) { console.error("Faltan PGRST_DB y JWT_SECRET"); process.exit(2); }
const pool = new pg.Pool({ connectionString: PGRST_DB, max: 8 });

function verificar(cab) {
  const t = String(cab || "").replace(/^Bearer\s+/i, "");
  const [h, p, f] = t.split(".");
  if (!h || !p || !f) return null;
  const esperada = createHmac("sha256", JWT_SECRET).update(`${h}.${p}`).digest();
  const dada = Buffer.from(f, "base64url");
  if (dada.length !== esperada.length || !timingSafeEqual(dada, esperada)) throw Object.assign(new Error("JWSError JWSInvalidSignature"), { http: 401, code: "PGRST301" });
  const c = JSON.parse(Buffer.from(p, "base64url").toString());
  if (c.exp && c.exp * 1000 <= Date.now()) throw Object.assign(new Error("JWT expired"), { http: 401, code: "PGRST301" });
  return c;
}
const servidor = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x"); let cuerpo = "";
  for await (const ch of req) cuerpo += ch;
  const enviar = (st, j) => { res.writeHead(st, { "content-type": "application/json; charset=utf-8" }); res.end(j === undefined ? "" : JSON.stringify(j)); };
  if (u.pathname === "/") return enviar(200, { ok: true });
  let rol = "anon", claims = null;
  try { claims = verificar(req.headers.authorization); if (claims?.role) rol = claims.role === "authenticated" ? "authenticated" : "anon"; }
  catch (e) { return enviar(e.http || 401, { code: e.code || "PGRST301", details: null, hint: null, message: e.message }); }
  const cli = await pool.connect();
  try {
    await cli.query("begin");
    const r = await atender(cli, { metodo: req.method, ruta: u.pathname, params: [...u.searchParams], cuerpo, prefer: String(req.headers.prefer || ""), rol, claims });
    await cli.query(r.error ? "rollback" : "commit").catch(() => {});
    return enviar(r.status, r.json);
  } catch (e) {
    await cli.query("rollback").catch(() => {});
    return enviar(500, { code: "PGRST000", details: null, hint: null, message: e.message });
  } finally { cli.release(); }
});
servidor.listen(Number(PGRST_PORT), "127.0.0.1", () => console.log(`pgrest_local en http://127.0.0.1:${PGRST_PORT}`));
