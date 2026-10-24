// Supabase simulado CON la regla de seguridad del 23/10/2026 (perfil BFK obligatorio), para pruebas de interfaz.
// Reutiliza la base con estado de las pruebas de OC (docs/pruebas-oc/mock_estado.mjs) y le agrega, solo si
// `instalada` es verdadero, el mismo contrato que la migración BORRADOR-2026-10-23-seguridad-perfil-bfk.sql:
//   · RLS: sin perfil no se lee ni se escribe ninguna tabla (perfiles: solo la fila propia, que no existe).
//   · perfiles: nadie inserta por la API salvo un administrador; solo un administrador cambia el rol; queda ≥ 1 admin.
//   · bfk_cuentas_por_autorizar() y bfk_autorizar_cuenta() solo para administrador; una cuenta aislada no recibe perfil.
//   · Toda otra función RPC pedida por una cuenta sin perfil responde BFK_SIN_PERFIL (42501).
// Con `instalada` falso se comporta como producción actual (sin la migración): las funciones y la tabla de
// autorizaciones no existen (PGRST202 / 404). Nada sale a la red: cada solicitud queda registrada en `log`.
import { crearBase, chromium, CHROME } from "../pruebas-oc/mock_estado.mjs";
export { chromium, CHROME };

const clon = (x) => JSON.parse(JSON.stringify(x));

export function crearBaseSegura(datos, { instalada = true, cuentas = [], mp = {}, fallaPerfil = false } = {}) {
  const base = crearBase(datos, { mp });
  const db = base.db; db.perfiles_autorizaciones = db.perfiles_autorizaciones || [];
  // Cuentas de auth.users: las de los perfiles más las indicadas (sin perfil, aisladas…).
  const usuarios = [...(db.perfiles || []).map((p) => ({ id: p.id, email: p.email || p.id + "@prueba.cl", creada_en: "2026-09-01T12:00:00Z", confirmada: true })), ...clon(cuentas)];
  const log = [];
  const perfilDe = (yo) => (db.perfiles || []).find((p) => p.id === yo) || null;
  const esUsuario = (yo) => !!perfilDe(yo);
  const esAdmin = (yo) => perfilDe(yo)?.rol === "admin";
  const err = (status, code, message) => ({ status, json: { code, message } });

  const leer = (tabla, params, yo) => {
    if (tabla === "perfiles" && fallaPerfil) return { status: 500, json: { message: "falla simulada" } };
    if (tabla === "perfiles_autorizaciones") {
      if (!instalada) return { status: 404, json: { code: "PGRST205", message: "relation does not exist" } };
      return { status: 200, json: esAdmin(yo) ? clon(db.perfiles_autorizaciones).reverse() : [] };
    }
    if (instalada && !esUsuario(yo)) {
      if (tabla === "perfiles") return { status: 200, json: base.leer(tabla, params).filter((p) => p.id === yo) };
      return { status: 200, json: [] };   // RLS: sin perfil no hay filas visibles
    }
    return { status: 200, json: base.leer(tabla, params) };
  };

  const escribir = (m, tabla, params, cuerpo, yo) => {
    if (instalada && tabla === "perfiles") {
      if (m === "POST") return esAdmin(yo) ? base.escribir(m, tabla, params, cuerpo, yo)
        : err(403, "42501", "BFK_PERFIL: solo un administrador puede autorizar cuentas");
      if (m === "PATCH") {
        const id = decodeURIComponent((params.get("id") || "").replace(/^eq\./, ""));
        const p = perfilDe(id); if (!p) return { status: 200, json: [] };
        if (!esAdmin(yo) && cuerpo && ("rol" in cuerpo) && cuerpo.rol !== p.rol)
          return err(403, "42501", "BFK_PERFIL: solo puedes cambiar tu nombre; rol, vendedor y financiador los cambia un administrador");
        if (p.rol === "admin" && cuerpo?.rol && cuerpo.rol !== "admin" && !(db.perfiles || []).some((x) => x.rol === "admin" && x.id !== p.id))
          return err(403, "42501", "BFK_PERFIL: debe quedar al menos un administrador");
      }
    }
    if (instalada && !esUsuario(yo)) return err(403, "42501", "new row violates row-level security policy");
    return base.escribir(m, tabla, params, cuerpo, yo);
  };

  const rpc = (fn, b, yo) => {
    if (fn === "bfk_cuentas_por_autorizar" || fn === "bfk_autorizar_cuenta") {
      if (!instalada) return err(404, "PGRST202", `Could not find the function public.${fn}`);
      if (!esAdmin(yo)) return err(403, "42501", "BFK_PERFIL: solo un administrador puede " + (fn === "bfk_autorizar_cuenta" ? "autorizar cuentas" : "ver las cuentas por autorizar"));
      if (fn === "bfk_cuentas_por_autorizar") {
        return { status: 200, json: usuarios.filter((u) => !perfilDe(u.id)).map((u) => ({ id: u.id, correo: u.email, creada_en: u.creada_en || null,
          confirmada: u.confirmada !== false, ultimo_ingreso: u.ultimo_ingreso || null, aislada: u.bfk_tipo || null })) };
      }
      const u = usuarios.find((x) => x.id === b.p_id); const nombre = String(b.p_nombre || "").trim(); const rol = b.p_rol || "usuario";
      if (!["usuario", "admin"].includes(rol)) return err(400, "22023", `BFK_PERFIL: rol no válido (${rol})`);
      if (!nombre) return err(400, "22023", "BFK_PERFIL: falta el nombre");
      if (!u) return err(400, "22023", "BFK_PERFIL: la cuenta no existe");
      if (u.bfk_tipo) return err(403, "42501", `BFK_PERFIL: la cuenta ${u.email} está aislada (${u.bfk_tipo}) y no puede recibir acceso a BFK`);
      if (perfilDe(u.id)) return { status: 200, json: { ok: true, accion: "ya_autorizada" } };
      db.perfiles.push({ id: u.id, nombre, rol, email: u.email });
      db.perfiles_autorizaciones.push({ id: db.perfiles_autorizaciones.length + 1, perfil_id: u.id, correo: u.email, nombre, rol, autorizado_por: yo,
        autorizado_por_nombre: perfilDe(yo)?.nombre || null, autorizado_en: new Date().toISOString() });
      return { status: 200, json: { ok: true, accion: "autorizada", rol } };
    }
    if (instalada && !esUsuario(yo)) return err(403, "42501", "BFK_SIN_PERFIL: esta cuenta no tiene un perfil BFK autorizado");
    return base.rpc(fn, b, yo);
  };

  // Utilidades para las pruebas
  const quitarPerfil = (id) => { db.perfiles = db.perfiles.filter((p) => p.id !== id); };
  const autorizarDirecto = (id, nombre, rol = "usuario") => { const u = usuarios.find((x) => x.id === id); db.perfiles.push({ id, nombre, rol, email: u?.email }); };
  return { ...base, db, usuarios, log, leer, escribir, rpc, quitarPerfil, autorizarDirecto, esUsuario };
}

// Abre la app con la sesión de `usuario` (o sin sesión con usuario=null) en una dirección dada.
export async function abrirSeguro(browser, base, { url, usuario, hash = "", ancho = 1280, alto = 800, movil = false, espera = 2500, dialogos = "aceptar", signup = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: ancho, height: alto }, deviceScaleFactor: 1, isMobile: movil, hasTouch: movil, timezoneId: "America/Santiago" });
  const page = await ctx.newPage(); const errs = []; const dlg = [];
  page.setDefaultTimeout(6000);
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("dialog", (d) => { dlg.push(d.message().slice(0, 120)); dialogos === "aceptar" ? d.accept() : d.dismiss(); });
  const est = { yo: usuario };   // la cuenta de la sesión puede cambiar (inicio de sesión / registro)
  const userDe = (id) => { const u = base.usuarios.find((x) => x.id === id) || { id, email: id + "@prueba.cl" };
    return { id: u.id, email: u.email, app_metadata: u.bfk_tipo ? { provider: "email", bfk_tipo: u.bfk_tipo } : { provider: "email" }, user_metadata: { nombre: u.nombre_registro || "" } }; };
  await page.route("**/*", async (route) => {
    const req = route.request(); const u = new URL(req.url()); const m = req.method();
    if ((u.hostname === "127.0.0.1" || u.hostname === "localhost") && u.pathname.startsWith("/api/oc")) {
      base.log.push({ yo: est.yo, m, ruta: "api/oc" }); const r = base.respuestaMP(u); return route.fulfill({ status: r.status, json: r.body });
    }
    if (u.hostname === "127.0.0.1" || u.hostname === "localhost") return route.continue();
    if (!u.hostname.endsWith("supabase.co")) return route.abort();
    let cuerpo = null; try { cuerpo = JSON.parse(req.postData() || "null"); } catch {}
    if (u.pathname.includes("/auth/v1/signup") && signup) {
      base.usuarios.push({ id: signup.id, email: cuerpo?.email, creada_en: new Date().toISOString(), confirmada: true, nombre_registro: cuerpo?.data?.nombre });
      est.yo = signup.id; base.log.push({ yo: est.yo, m, ruta: "auth/signup" });
      return route.fulfill({ json: { access_token: "t" + est.yo, refresh_token: "r", expires_in: 3600, user: userDe(est.yo) } });
    }
    if (u.pathname.includes("/auth/v1/token")) {
      if (u.searchParams.get("grant_type") === "password") { const x = base.usuarios.find((z) => z.email === cuerpo?.email); if (x) est.yo = x.id; }
      base.log.push({ yo: est.yo, m, ruta: "auth/token" });
      return route.fulfill({ json: { access_token: "t" + est.yo, refresh_token: "r", expires_in: 3600, user: userDe(est.yo) } });
    }
    if (u.pathname.includes("/auth/v1/user")) return route.fulfill({ json: userDe(est.yo) });
    if (u.pathname.includes("/auth/v1/logout")) { base.log.push({ yo: est.yo, m, ruta: "auth/logout" }); return route.fulfill({ status: 204, body: "" }); }
    const yo = est.yo;
    if (u.pathname.includes("/rest/v1/rpc/")) {
      const fn = u.pathname.split("/").pop(); base.log.push({ yo, m, ruta: "rpc/" + fn, cuerpo });
      const r = base.rpc(fn, cuerpo || {}, yo); return route.fulfill({ status: r.status, json: r.json });
    }
    const tabla = u.pathname.split("/").pop(); base.log.push({ yo, m, ruta: tabla, cuerpo });
    if (m === "GET") { const r = base.leer(tabla, u.searchParams, yo); return route.fulfill({ status: r.status, json: r.json }); }
    const r = base.escribir(m, tabla, u.searchParams, cuerpo, yo);
    return route.fulfill({ status: r.status, json: r.json });
  });
  if (usuario) await page.addInitScript((s) => { try { if (!sessionStorage.getItem("__ini")) { localStorage.setItem("bfk_supabase_session_v2", JSON.stringify(s)); sessionStorage.setItem("__ini", "1"); } } catch {} },
    { access_token: "t" + usuario, refresh_token: "r", user: userDe(usuario) });
  await page.goto(url + hash, { waitUntil: "load" }); await page.waitForTimeout(espera);
  return { page, ctx, errs, dlg, est };
}

// Solicitudes de datos (tablas o funciones) hechas por una cuenta, excluyendo autenticación y la lectura de su perfil.
export const solicitudesDatos = (base, yo) => base.log.filter((l) => l.yo === yo && !l.ruta.startsWith("auth/") && l.ruta !== "perfiles");
