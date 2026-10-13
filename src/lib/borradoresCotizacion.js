// ═══════════════════════════════════════════════════════════════
// Borradores de RECUPERACIÓN LOCAL de Cotizaciones (13/10/2026).
// Copia de seguridad en este dispositivo (IndexedDB) mientras se escribe, para no perder datos si el
// navegador recarga la pestaña, el sistema la cierra por memoria o la ventana se cierra por error.
//   · NO es un guardado en BFK: nada se envía a Supabase hasta presionar «Guardar».
//   · Aislado por usuario y por cotización: clave = <usuario>:<id de la cotización | nueva-…>.
//     Solo se listan los borradores del usuario con sesión iniciada.
//   · Guarda la versión de BFK sobre la que se trabajó (versionBase) para detectar si alguien guardó
//     una versión más reciente: el borrador nunca la sobrescribe en silencio (el servidor además rechaza
//     guardar sobre una versión distinta, CZ409).
// Si IndexedDB no está disponible (algunos modos privados), se usa localStorage como respaldo.
// ═══════════════════════════════════════════════════════════════
const DB = "bfk-borradores", ST = "cotizaciones", VER = 1, LS = "bfk_borradores_cot_v1";

let dbP = null;
function abrirDB() {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB no disponible"));
  if (!dbP) dbP = new Promise((res, rej) => {
    let r; try { r = indexedDB.open(DB, VER); } catch (e) { rej(e); return; }
    r.onupgradeneeded = () => { const s = r.result.createObjectStore(ST, { keyPath: "clave" }); s.createIndex("usuario", "usuario"); };
    r.onsuccess = () => { const db = r.result; db.onversionchange = () => { db.close(); dbP = null; }; res(db); };
    r.onerror = () => rej(r.error); r.onblocked = () => rej(new Error("IndexedDB bloqueada"));
  }).catch((e) => { dbP = null; throw e; });
  return dbP;
}
const operar = async (modo, fn) => {
  const db = await abrirDB();
  return new Promise((res, rej) => {
    const t = db.transaction(ST, modo); const s = t.objectStore(ST); let out;
    const r = fn(s); if (r) r.onsuccess = () => { out = r.result; };
    t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error("Transacción cancelada"));
  });
};
// Respaldo en localStorage (sin IndexedDB).
const leerLS = () => { try { return JSON.parse(localStorage.getItem(LS) || "{}") || {}; } catch { return {}; } };
const escribirLS = (d) => { try { localStorage.setItem(LS, JSON.stringify(d)); return true; } catch { return false; } };

export const claveBorrador = (usuario, idLocal) => `${usuario}:${idLocal}`;

// Guarda (reemplaza) el borrador. rec: { usuario, idLocal, cotId, versionBase, cot, pestana, ficha, abierto }
export async function guardarBorrador(rec) {
  if (!rec?.usuario || !rec?.idLocal) return false;
  const fila = { ...rec, clave: claveBorrador(rec.usuario, rec.idLocal), actualizado: Date.now() };
  try { await operar("readwrite", (s) => s.put(fila)); return true; }
  catch { const d = leerLS(); d[fila.clave] = fila; return escribirLS(d); }
}

// Borradores SOLO del usuario indicado, del más reciente al más antiguo.
export async function listarBorradores(usuario) {
  if (!usuario) return [];
  let filas;
  try { filas = await operar("readonly", (s) => s.index("usuario").getAll(usuario)); }
  catch { filas = Object.values(leerLS()); }
  return (filas || []).filter((f) => f && f.usuario === usuario && f.cot).sort((a, b) => b.actualizado - a.actualizado);
}

export async function leerBorrador(usuario, idLocal) {
  if (!usuario || !idLocal) return null;
  const clave = claveBorrador(usuario, idLocal);
  try { return (await operar("readonly", (s) => s.get(clave))) || null; } catch { return leerLS()[clave] || null; }
}

export async function borrarBorrador(usuario, idLocal) {
  if (!usuario || !idLocal) return;
  const clave = claveBorrador(usuario, idLocal);
  try { await operar("readwrite", (s) => s.delete(clave)); } catch { /* respaldo abajo */ }
  const d = leerLS(); if (d[clave]) { delete d[clave]; escribirLS(d); }
}

// Identificador local estable de una cotización abierta: su id en BFK o, si aún no se guarda, «nueva-…».
export const idLocalDe = (cot) => cot?.id || cot?._idLocal || "";
export const nuevoIdLocal = () => `nueva-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
