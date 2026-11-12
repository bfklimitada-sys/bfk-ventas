// Núcleo del sustituto local de PostgREST: traduce una solicitud REST (subconjunto de PostgREST 12) a SQL y la ejecuta en una
// transacción con el rol y la sesión del usuario, de modo que RLS, privilegios, disparadores y funciones aplican de verdad.
// No depende de Node: lo usan el servidor de pruebas (pgrest_local.mjs, con «pg») y la demostración aislada (PGlite en el navegador).
//   · GET    /<tabla|vista>?select=a,b&col=eq.x&col=in.(a,b)&…&or=(…)&order=a.desc,b&limit=n
//   · POST   /<tabla>            cuerpo: objeto o lista      (Prefer: return=representation | minimal)
//   · PATCH  /<tabla>?filtros    cuerpo: objeto con los cambios
//   · DELETE /<tabla>?filtros
//   · POST   /rpc/<función>      argumentos por nombre (JSON)
//   · Errores como PostgREST: {code, message, details, hint} con 400/401/403/404/409.
// cli: objeto con query(sql, valores) → { rows } (una conexión de «pg» o una transacción de PGlite).
const qi = (s) => { if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) throw Object.assign(new Error(`identificador inválido: ${s}`), { http: 400, code: "PGRST100" }); return `"${s}"`; };
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

function filtrosSQL(params, vals) {
  const where = [];
  for (const [k, v] of params) {
    if (["select", "order", "limit", "offset", "on_conflict", "columns"].includes(k)) continue;
    if (k === "or") where.push("(" + partirOr(v.replace(/^\(|\)$/g, "")).map((x) => { const i = x.indexOf("."); return filtro(x.slice(0, i), x.slice(i + 1), vals); }).join(" or ") + ")");
    else where.push(filtro(k, v, vals));
  }
  return where.length ? " where " + where.join(" and ") : "";
}
// Escritura directa en una tabla (la usa Proyectos industriales; Ventas privadas solo usa funciones).
function escribirSQL(metodo, obj, params, cuerpo) {
  const t = `public.${qi(obj)}`; const vals = [];
  const fin = (dml) => ({ sql: `with x as (${dml} returning *) select coalesce(json_agg(x), '[]'::json) as r from x`, vals });
  if (metodo === "DELETE") return fin(`delete from ${t}${filtrosSQL(params, vals)}`);
  if (cuerpo === null || typeof cuerpo !== "object") throw Object.assign(new Error("cuerpo inválido"), { http: 400, code: "PGRST102" });
  const lista = Array.isArray(cuerpo); const filas = lista ? cuerpo : [cuerpo];
  const cols = [...new Set(filas.flatMap((f) => Object.keys(f)))].map(qi).join(", ");
  if (!cols) throw Object.assign(new Error("sin columnas"), { http: 400, code: "PGRST102" });
  vals.push(JSON.stringify(lista ? cuerpo : [cuerpo]));
  if (metodo === "POST") return fin(`insert into ${t} (${cols}) select ${cols} from json_populate_recordset(null::${t}, $1::json)`);
  if (metodo === "PATCH") { if (lista) throw Object.assign(new Error("PATCH espera un objeto"), { http: 400, code: "PGRST102" }); return fin(`update ${t} set (${cols}) = (select ${cols} from json_populate_recordset(null::${t}, $1::json) limit 1)${filtrosSQL(params, vals)}`); }
  throw Object.assign(new Error(`método no soportado: ${metodo}`), { http: 405, code: "PGRST" });
}

// Atiende una solicitud. cli ya debe estar dentro de una transacción propia; devuelve { status, json }.
// rol: "authenticated" | "anon" · claims: contenido del JWT (sub, role…).
export async function atender(cli, { metodo, ruta, params, cuerpo, prefer = "", rol = "anon", claims = null }) {
  try {
    await cli.query(`set local role ${rol === "authenticated" ? "authenticated" : "anon"}`);
    await cli.query("select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true), set_config('request.jwt.claim.role', $3, true)",
      [JSON.stringify(claims || { role: "anon" }), claims?.sub || "", rol]);
    const obj = decodeURIComponent(String(ruta).replace(/^\/+/, ""));
    let q; let st = 200; const escribe = !obj.startsWith("rpc/") && metodo !== "GET" && metodo !== "HEAD";
    if (obj.startsWith("rpc/")) { let a = cuerpo; if (typeof a === "string") { try { a = a ? JSON.parse(a) : {}; } catch { throw Object.assign(new Error("cuerpo inválido"), { http: 400, code: "PGRST102" }); } } q = await rpcSQL(cli, obj.slice(4), a || {}); }
    else if (!escribe) q = leerSQL(obj, params);
    else { let c = cuerpo; if (typeof c === "string") { try { c = c ? JSON.parse(c) : null; } catch { throw Object.assign(new Error("cuerpo inválido"), { http: 400, code: "PGRST102" }); } } q = escribirSQL(metodo, obj, params, c); if (metodo === "POST") st = 201; }
    const r = await cli.query(q.sql, q.vals);
    if (escribe && /return=minimal/.test(prefer)) return { status: metodo === "POST" ? 201 : 204, json: undefined };
    return { status: st, json: r.rows[0]?.r ?? null };
  } catch (e) {
    return { status: estado(e, rol), json: { code: e.code || "PGRST000", details: e.detail || null, hint: e.hint || null, message: e.message }, error: true };
  }
}
