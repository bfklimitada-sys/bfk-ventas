// ═══════════════════════════════════════════════════════════════
// Captura de productos desde Safari (iPhone) → módulo Cotizaciones y EETT.
// El Atajo ejecuta el extractor en la página que el usuario está viendo y abre BFK Datos con
//   #/cotizaciones?captura=<base64url(JSON)>
// La parte después de "#" nunca se envía a ningún servidor. Aquí se codifica, decodifica y
// valida (solo campos conocidos y con límites), sin guardar nada: la captura queda pendiente
// de revisión en el módulo. Precios y disponibilidad son datos internos; el envío nunca viene
// en la captura y queda por verificar.
// ═══════════════════════════════════════════════════════════════

export const VERSION_CAPTURA = 1;
export const CLAVE_CAPTURA = "bfk_captura_pendiente_v1";
const MAX = { texto: 300, desc: 3000, pares: 80, etiqueta: 80, valor: 300, imagenes: 6, url: 2000 };

const b64urlDeTexto = (t) => {
  const bytes = new TextEncoder().encode(t); let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const textoDeB64url = (s) => {
  const b = String(s).replace(/-/g, "+").replace(/_/g, "/"); const bin = atob(b + "===".slice((b.length + 3) % 4));
  const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(u);
};

const txt = (v, n) => (typeof v === "string" || typeof v === "number" ? String(v).replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, n) : "");
const urlOk = (u) => { try { const x = new URL(String(u)); return /^https?:$/.test(x.protocol) && String(u).length <= MAX.url ? x.href : ""; } catch { return ""; } };
const pares = (lista) => (Array.isArray(lista) ? lista : []).slice(0, MAX.pares)
  .map((p) => ({ etiqueta: txt(p?.etiqueta, MAX.etiqueta), valor: txt(p?.valor, MAX.valor) })).filter((p) => p.etiqueta || p.valor);

// Deja solo lo conocido y dentro de límites. Lanza error si no es una captura válida.
export function validarCaptura(d) {
  if (!d || typeof d !== "object" || d.v !== VERSION_CAPTURA) throw new Error("La captura no es válida o es de una versión distinta del atajo.");
  const f = d.ficha || {};
  const enlace = urlOk(d.enlace);
  if (!enlace) throw new Error("La captura no trae el enlace del proveedor.");
  const precio = Number(d.precio_origen);
  return {
    v: VERSION_CAPTURA, enlace,
    ficha: {
      nombre: txt(f.nombre, MAX.texto), marca: txt(f.marca, MAX.texto), modelo: txt(f.modelo, MAX.texto), color: txt(f.color, MAX.texto),
      descripcion: txt(f.descripcion, MAX.desc), generales: pares(f.generales), especificaciones: pares(f.especificaciones),
      imagenes: (Array.isArray(f.imagenes) ? f.imagenes : []).map(urlOk).filter(Boolean).slice(0, MAX.imagenes),
    },
    precio_origen: Number.isFinite(precio) && precio > 0 ? Math.round(precio) : null, // dato interno
    moneda: txt(d.moneda, 8) || null, precio_incluye_iva: d.precio_incluye_iva !== false,
    disponibilidad: txt(d.disponibilidad, 60), fuente: txt(d.fuente, 120),
    fecha_consulta: (() => { const t = Date.parse(d.fecha_consulta); return Number.isFinite(t) ? new Date(t).toISOString() : new Date().toISOString(); })(),
    metodos: (Array.isArray(d.metodos) ? d.metodos : []).map((m) => txt(m, 30)).filter(Boolean).slice(0, 6),
    advertencias: (Array.isArray(d.advertencias) ? d.advertencias : []).map((a) => txt(a, 200)).filter(Boolean).slice(0, 8),
  };
}

export const codificarCaptura = (d) => b64urlDeTexto(JSON.stringify(d));
export const decodificarCaptura = (s) => validarCaptura(JSON.parse(textoDeB64url(s)));

// Lee "#/cotizaciones?captura=…" (o "?captura_error=…" si el atajo falló en la página).
export function capturaDeHash(hash) {
  const m = String(hash || "").match(/[?&]captura=([A-Za-z0-9_-]+)/);
  if (m) { try { return { ok: true, captura: decodificarCaptura(m[1]) }; } catch (e) { return { ok: false, error: e.message || "No se pudo leer la captura." }; } }
  const e = String(hash || "").match(/[?&]captura_error=([^&]*)/);
  if (e) { let msg = "El atajo no pudo leer la página."; try { msg = `El atajo no pudo leer la página: ${decodeURIComponent(e[1]).slice(0, 160)}`; } catch { /* */ } return { ok: false, error: msg }; }
  return null;
}

// Pendiente en esta pestaña del navegador (sessionStorage): se usa al abrir Cotizaciones y se descarta al usarla.
export function guardarPendiente(r) { try { sessionStorage.setItem(CLAVE_CAPTURA, JSON.stringify(r)); } catch { /* sin almacenamiento: se pierde la captura */ } }
export function leerPendiente() { try { const x = JSON.parse(sessionStorage.getItem(CLAVE_CAPTURA) || "null"); return x && (x.captura || x.error) ? x : null; } catch { return null; } }
export function descartarPendiente() { try { sessionStorage.removeItem(CLAVE_CAPTURA); } catch { /* */ } }
