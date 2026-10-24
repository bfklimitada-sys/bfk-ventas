// Prueba por la API REST real (PostgREST, como Supabase) contra la COPIA desechable. Nunca contra producción.
// Cada escritura se envía con «Prefer: tx=rollback» (PostgREST la deshace): no queda nada escrito.
// Variables: PGRST_URL, JWT_SECRET, FASE, MUESTRAS (archivo json de muestras_rest.sql), ADM, USR,
//            NUEVA, SINPERFIL, RESPALDO (uuid de las cuentas de prueba ya creadas en auth.users).
// Salida: R|fase|cuenta|objeto|operación|resultado   (solo códigos y conteos; nunca datos de negocio)
import { createHmac } from "node:crypto";
import fs from "node:fs";

const { PGRST_URL, JWT_SECRET, FASE, MUESTRAS, ADM, USR, NUEVA, SINPERFIL, RESPALDO } = process.env;
const muestras = JSON.parse(fs.readFileSync(MUESTRAS, "utf8")) || [];
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (claims) => {
  const h = b64({ alg: "HS256", typ: "JWT" });
  const p = b64({ ...claims, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${h}.${p}.${createHmac("sha256", JWT_SECRET).update(`${h}.${p}`).digest("base64url")}`;
};
const cuentas = {
  anon: jwt({ role: "anon" }),
  nueva: jwt({ sub: NUEVA, role: "authenticated", aud: "authenticated" }),
  sinperfil: jwt({ sub: SINPERFIL, role: "authenticated", aud: "authenticated" }),
  respaldo: jwt({ sub: RESPALDO, role: "authenticated", aud: "authenticated" }),
  usuario: jwt({ sub: USR, role: "authenticated", aud: "authenticated" }),
  admin: jwt({ sub: ADM, role: "authenticated", aud: "authenticated" }),
};
const out = (c, obj, op, r) => console.log(`R|${FASE}|${c}|${obj}|${op}|${r}`);

async function pedir(token, metodo, ruta, cuerpo, prefer) {
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  if (prefer) h.Prefer = prefer;
  const r = await fetch(`${PGRST_URL}${ruta}`, { method: metodo, headers: h, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
  const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch {}
  return { s: r.status, j, rango: r.headers.get("content-range") };
}
const err = (x) => `${x.s} ${x.j?.code || ""} ${String(x.j?.message || "").replace(/\s+/g, " ").slice(0, 70)}`.trim();
const filtro = (m) => (m.pk || []).map((k) => `${encodeURIComponent(k)}=eq.${encodeURIComponent(m.fila?.[k] ?? "")}`).join("&");

for (const [c, tok] of Object.entries(cuentas)) {
  for (const m of muestras) {
    // SELECT (con conteo exacto)
    let x = await pedir(tok, "GET", `/${m.t}?select=*&limit=1`, undefined, "count=exact");
    out(c, m.t, "select", x.s === 200 ? `LEE ${(x.rango || "*/?").split("/")[1]}/${m.total}` : `NO ${err(x)}`);
    if (!m.fila) { for (const op of ["insert", "update", "delete"]) out(c, m.t, op, "SIN_FILAS"); continue; }
    // INSERT de una fila nueva (copia de una real con otra clave), deshecho por PostgREST
    x = await pedir(tok, "POST", `/${m.t}`, m.nueva, "tx=rollback,return=minimal");
    out(c, m.t, "insert", x.s === 201 ? "PERMITE" : `NO ${err(x)}`);
    if (!(m.pk || []).length) { out(c, m.t, "update", "SIN_PK"); out(c, m.t, "delete", "SIN_PK"); continue; }
    // UPDATE (clave = misma clave) y DELETE de la fila real, deshechos por PostgREST
    const set = { [m.pk[0]]: m.fila[m.pk[0]] };
    x = await pedir(tok, "PATCH", `/${m.t}?${filtro(m)}`, set, "tx=rollback,return=representation");
    out(c, m.t, "update", x.s === 200 ? (Array.isArray(x.j) && x.j.length ? `PERMITE ${x.j.length}` : "SIN_EFECTO 0 filas") : `NO ${err(x)}`);
    x = await pedir(tok, "DELETE", `/${m.t}?${filtro(m)}`, undefined, "tx=rollback,return=representation");
    out(c, m.t, "delete", x.s === 200 ? (Array.isArray(x.j) && x.j.length ? `PERMITE ${x.j.length}` : "SIN_EFECTO 0 filas") : `NO ${err(x)}`);
  }
  // RPC: funciones que exponen o escriben datos financieros, y las de autorización de cuentas.
  const oc = muestras.find((m) => m.t === "ordenes_compra_v2")?.fila?.id;
  const fac = muestras.find((m) => m.t === "eventos_factura")?.fila;
  const cob = muestras.find((m) => m.t === "eventos_pago_cliente")?.fila;
  const rpcs = [
    ["fin_calculo_oc", { p_oc_id: oc }], ["fin_facturas_vigentes", { p_oc_id: fac?.oc_id }], ["fin_tipo_financiamiento", { p_oc_id: oc }],
    ["fin_fila_bloqueada", { p_tabla: "eventos_pago_cliente", p_id: cob?.id }], ["fin_dif_monto", { p_entidad: "oc", p_id: oc, p_campo: "costo_total" }],
    ["fin_monto_tributario", { p_oc_id: oc }], ["fin_periodo_comision", { p_oc_id: fac?.oc_id }],
    ["cartola_manuales", { p_tabla: "eventos_pago_cliente", p_destinos: [], p_fecha: cob?.fecha, p_monto: cob?.monto }],
    ["cartola_quitar_alerta", { p_tabla: "eventos_pago_cliente", p_id: cob?.id }],
    ["bfk_cuentas_por_autorizar", {}], ["bfk_es_usuario", {}],
  ];
  for (const [fn, args] of rpcs) {
    const x = await pedir(tok, "POST", `/rpc/${fn}`, args, "tx=rollback");
    const vacio = x.j === null || (Array.isArray(x.j) && x.j.length === 0) || (x.j && typeof x.j === "object" && !Array.isArray(x.j) && Object.values(x.j).every((v) => v === null));
    out(c, `rpc:${fn}`, "call", x.s === 200 ? (vacio ? "EJECUTA (sin datos)" : `EJECUTA DEVUELVE ${JSON.stringify(x.j) === "true" ? "true" : JSON.stringify(x.j) === "false" ? "false" : "datos"}`) : `NO ${err(x)}`);
  }
  // Autopromoción y auto-perfil por REST
  let x = await pedir(tok, "POST", "/perfiles", { id: { anon: null, nueva: NUEVA, sinperfil: SINPERFIL, respaldo: RESPALDO, usuario: USR, admin: ADM }[c], nombre: "Intento", rol: "usuario" }, "tx=rollback,return=minimal");
  out(c, "perfiles", "autoinsertar", x.s === 201 ? "PERMITE" : `NO ${err(x)}`);
  x = await pedir(tok, "PATCH", `/perfiles?id=eq.${{ anon: "00000000-0000-0000-0000-000000000000", nueva: NUEVA, sinperfil: SINPERFIL, respaldo: RESPALDO, usuario: USR, admin: ADM }[c]}`, { rol: "admin" }, "tx=rollback,return=representation");
  out(c, "perfiles", "autopromocion_admin", x.s === 200 ? (Array.isArray(x.j) && x.j.length ? `PERMITE ${x.j.length}` : "SIN_EFECTO 0 filas") : `NO ${err(x)}`);
}
