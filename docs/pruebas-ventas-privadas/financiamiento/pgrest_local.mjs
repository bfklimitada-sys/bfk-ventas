// Servidor local con el SUBCONJUNTO del protocolo de PostgREST 12 que usa Ventas privadas, para las pruebas de interfaz en la
// base DESECHABLE (nunca producción). Se usa solo donde el binario de PostgREST no se puede descargar. Igual que PostgREST:
//   · JWT HS256 verificado con el secreto; sin token válido → rol anon. Cada solicitud corre en su transacción con
//     SET LOCAL ROLE (authenticated | anon) y request.jwt.claims, así RLS, privilegios, disparadores y funciones aplican de verdad.
//   · GET /<tabla|vista>?select=a,b&col=eq.x&col=in.(a,b)&col=neq.x&col=ilike.*x*&col=gt|gte|lt|lte.x&col=is.null&or=(…)&order=a.desc,b&limit=n
//   · POST /rpc/<función> con argumentos por nombre (JSON) → resultado JSON de la función.
//   · Errores como PostgREST: {code, message, details, hint} con 400/401/403/404/409.
// Uso: PGRST_DB=postgresql://authenticator@127.0.0.1:5499/bfk_vpfin JWT_SECRET=… PGRST_PORT=3912 node pgrest_local.mjs
import http from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../../package.json", import.meta.url));
const pg = require("pg");

const { PGRST_DB, JWT_SECRET, PGRST_PORT = "3912" } = process.env;
if (!PGRST_DB || !JWT_SECRET) { console.error("Faltan PGRST_DB y JWT_SECRET"); process.exit(2); }
const pool = new pg.Pool({ connectionString: PGRST_DB, max: 8 });
const qi = (s) => { if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) throw Object.assign(new Error(`identificador inválido: ${s}`), { http: 400, code: "PGRST100" }); return `"${s}"`; };

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
// Filtro PostgREST → SQL con parámetros.
function filtro(col, expr, vals) {
  const add = (v) => { vals.push(v); return `$${vals.length}`; };
  let neg = false; if (expr.startsWith("not.")) { neg = true; expr = expr.slice(4); }
  const i = expr.indexOf("."); const op = expr.slice(0, i); const v = expr.slice(i + 1);
  let sql;
  if (op === "eq") sql = `${qi(col)}::text = ${add(v)}`;
  else if (op === "neq") sql = `${qi(col)}::text is distinct from ${add(v)}`;
  else if (["gt", "gte", "lt", "lte"].includes(op)) sql = `${qi(col)} ${{ gt: ">", gte: ">=", lt: "<", lte: "<=" }[op]} ${add(v)}`;
  else if (op === "in") { const xs = v.replace(/^\(|\)$/g, "").split(",").map((x) => x.replace(/^"|"$/g, "")); sql = `${qi(col)}::text = any(${add(xs)}::text[])`; }
  else if (op === "ilike" || op === "like") sql = `${qi(col)}::text ${op} ${add(v.replace(/\*/g, "%"))}`;
  else if (op === "is") sql = `${qi(col)} is ${v === "null" ? "null" : v === "true" ? "true" : "false"}`;
  else throw Object.assign(new Error(`operador no soportado: ${op}`), { http: 400, code: "PGRST100" });
  return neg ? `not (${sql})` : sql;
}
function partirOr(s) { const out = []; let d = 0, a = ""; for (const ch of s) { if (ch === "(") d++; if (ch === ")") d--; if (ch === "," && d === 0) { out.push(a); a = ""; } else a += ch; } if (a) out.push(a); return out; }
function leerSQL(obj, params) {
  const vals = []; const where = []; let orden = ""; let limite = ""; let cols = "*";
  for (const [k, v] of params) {
    if (k === "select") cols = v === "*" ? "*" : v.split(",").map((c) => qi(c.trim())).join(", ");
    else if (k === "order") orden = " order by " + v.split(",").map((o) => { const [c, ...m] = o.split("."); return `${qi(c)}${m.includes("desc") ? " desc" : ""}${m.includes("nullsfirst") ? " nulls first" : m.includes("nullslast") ? " nulls last" : ""}`; }).join(", ");
    else if (k === "limit") limite = ` limit ${Number(v) | 0}`;
    else if (k === "offset") limite += ` offset ${Number(v) | 0}`;
    else if (k === "or") where.push("(" + partirOr(v.replace(/^\(|\)$/g, "")).map((x) => { const i = x.indexOf("."); return filtro(x.slice(0, i), x.slice(i + 1), vals); }).join(" or ") + ")");
    else where.push(filtro(k, v, vals));
  }
  return { sql: `select coalesce(json_agg(t), '[]'::json) as r from (select ${cols} from public.${qi(obj)}${where.length ? " where " + where.join(" and ") : ""}${orden}${limite}) t`, vals };
}
async function rpcSQL(cli, fn, args) {
  const { rows } = await cli.query(`select p.proargnames as nombres, array(select format_type(t, null) from unnest(p.proargtypes) t) as tipos, format_type(p.prorettype, null) as ret
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = $1`, [fn]);
  const f = rows.find((r) => Object.keys(args).every((k) => (r.nombres || []).includes(k))) || rows[0];
  if (!f) throw Object.assign(new Error(`Could not find the function public.${fn} in the schema cache`), { http: 404, code: "PGRST202" });
  const vals = []; const partes = [];
  (f.nombres || []).slice(0, f.tipos.length).forEach((n, i) => {
    if (!(n in args)) return;
    const v = args[n]; vals.push(v === null || v === undefined ? null : typeof v === "object" ? JSON.stringify(v) : String(v));
    partes.push(`${qi(n)} => $${vals.length}::${f.tipos[i]}`);
  });
  const llamada = `public.${qi(fn)}(${partes.join(", ")})`;
  return { sql: f.ret === "void" ? `select ${llamada}, null::json as r` : `select to_json(${llamada}) as r`, vals };
}
const estado = (e, rol) => {
  if (e.http) return e.http;
  const c = e.code || "";
  if (c === "42501") return rol === "anon" ? 401 : 403;
  if (c === "23505" || c === "23503" || c === "40001") return 409;
  if (c === "42883" || c === "42P01" || c === "P0002") return c === "P0002" ? 400 : 404;
  return 400;
};
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
    await cli.query(`set local role ${rol}`);
    await cli.query("select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true), set_config('request.jwt.claim.role', $3, true)",
      [JSON.stringify(claims || { role: "anon" }), claims?.sub || "", rol]);
    const obj = decodeURIComponent(u.pathname.replace(/^\/+/, ""));
    let q;
    if (obj.startsWith("rpc/")) { let a = {}; try { a = cuerpo ? JSON.parse(cuerpo) : {}; } catch { throw Object.assign(new Error("cuerpo inválido"), { http: 400, code: "PGRST102" }); } q = await rpcSQL(cli, obj.slice(4), a); }
    else if (req.method === "GET") q = leerSQL(obj, [...u.searchParams]);
    else throw Object.assign(new Error("Ventas privadas no escribe tablas directamente"), { http: 405, code: "PGRST" });
    const r = await cli.query(q.sql, q.vals);
    await cli.query("commit");
    return enviar(200, r.rows[0]?.r ?? null);
  } catch (e) {
    await cli.query("rollback").catch(() => {});
    return enviar(estado(e, rol), { code: e.code || "PGRST000", details: e.detail || null, hint: e.hint || null, message: e.message });
  } finally { cli.release(); }
});
servidor.listen(Number(PGRST_PORT), "127.0.0.1", () => console.log(`pgrest_local en http://127.0.0.1:${PGRST_PORT}`));
