// Pruebas del controlador de bloqueo (src/lib/bloqueoOC.js) contra un servidor simulado con la misma semántica que la RPC.
// Tiempo virtual: nada espera de verdad. Uso: node docs/migraciones/pruebas/bloqueo/controlador.mjs
import { crearControlador, TTL_SEGUNDOS, HEARTBEAT_MS } from "../../../../src/lib/bloqueoOC.js";

let T = 0; const timers = []; let idT = 0;
const reloj = { ahora: () => T, setT: (fn, ms) => { const id = ++idT; timers.push({ id, t: T + (ms || 0), fn }); return id; }, clearT: (id) => { const i = timers.findIndex(x => x.id === id); if (i >= 0) timers.splice(i, 1); } };
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); await new Promise(r => setImmediate(r)); };
async function avanzar(ms, controlados = []) { const fin = T + ms; for (;;) { timers.sort((a, b) => a.t - b.t); const n = timers[0]; if (!n || n.t > fin) break; timers.shift(); T = Math.max(T, n.t); n.fn(); await flush(); } T = fin; await flush(); }

// Servidor simulado: misma lógica que gestionar_bloqueo_oc (tiempo del servidor = T; dueño = identidad de la sesión)
const filas = new Map(); const log = [];
function servidor(uid, nombre, red) {
  return async (oc, accion) => {
    if (red.caida) throw new Error("sin red");
    const f = filas.get(oc); const ttl = TTL_SEGUNDOS * 1000; log.push(`${uid}:${accion}:${oc}`);
    const seg = (x) => Math.max(0, Math.ceil((x - T) / 1000));
    if (accion === "liberar") { const lib = f && f.uid === uid; if (lib) filas.delete(oc); return { ok: true, liberado: !!lib }; }
    if (accion === "renovar") {
      if (f && f.uid === uid) { f.exp = T + ttl; return { ok: true, segundos_restantes: TTL_SEGUNDOS }; }
      if (f) return { ok: false, motivo: "perdido", usuario_nombre: f.nombre, segundos_restantes: seg(f.exp) };
      return { ok: false, motivo: "sin_bloqueo" };
    }
    if (!f || f.uid === uid || f.exp <= T) { filas.set(oc, { uid, nombre, exp: T + ttl }); return { ok: true, segundos_restantes: TTL_SEGUNDOS }; }
    return { ok: false, motivo: "ocupada", usuario_nombre: f.nombre, segundos_restantes: seg(f.exp) };
  };
}
function usuario(uid, nombre) { const red = { caida: false }; const c = crearControlador({ rpc: servidor(uid, nombre, red), ...reloj }); return { c, red, uid }; }

let fallos = 0; const ok = (cond, msg) => { console.log(`${cond ? "OK  " : "FALLA"} ${msg}`); if (!cond) fallos++; };
const reset = () => { T = 0; timers.length = 0; filas.clear(); log.length = 0; };

// 1. A adquiere → B solo lectura
reset(); { const A = usuario("A", "Ana"), B = usuario("B", "Beto");
  await A.c.abrir("oc1"); await B.c.abrir("oc1");
  ok(A.c.obtener().fase === "propietario" && A.c.puedeEditar("oc1"), "1. A adquiere y puede editar");
  ok(B.c.obtener().fase === "ocupada" && B.c.obtener().dueno === "Ana" && !B.c.puedeEditar("oc1"), "1. B queda en solo lectura (En edición por Ana)");
  // 2. A renueva > 45 s: B sigue bloqueado
  await avanzar(130000);
  ok(A.c.obtener().fase === "propietario" && B.c.obtener().fase === "ocupada", "2. A renueva durante 130 s; B continúa bloqueado");
  ok(log.filter(l => l === "A:renovar:oc1").length >= 8, `2. A renovó cada ~15 s (${log.filter(l => l === "A:renovar:oc1").length} renovaciones en 130 s)`);
  ok(B.c.obtener().fase === "ocupada" && !log.some(l => l === "B:liberar:oc1"), "2. B nunca libera ni toma el bloqueo de A");
  // 6'. verificación de B
  const vB = await B.c.verificar("oc1"); ok(!vB.ok, "5. B no puede verificar/modificar (no es propietario)");
  // 3. A cierra la OC → B la obtiene en el siguiente reintento (≤ 10 s)
  await A.c.cerrar(); ok(!filas.has("oc1"), "3. A cierra: la fila se libera");
  await avanzar(11000); ok(B.c.obtener().fase === "propietario", "3. B adquiere automáticamente tras la liberación (≤ 11 s)");
  await A.c.cerrar(); await B.c.cerrar(); }

// 3b. A→B (cambio de OC)
reset(); { const A = usuario("A", "Ana"); await A.c.abrir("ocA"); await A.c.abrir("ocB");
  ok(!filas.has("ocA") && filas.get("ocB")?.uid === "A", "3b. A→B libera la OC A y adquiere la OC B"); 
  const orden = log.filter(l => l.startsWith("A:liberar") || l.startsWith("A:adquirir:ocB")); ok(orden[0] === "A:liberar:ocA" && orden[1] === "A:adquirir:ocB", "3b. orden: liberar A → adquirir B");
  await A.c.cerrar(); }

// 4. A pierde la conexión → B adquiere tras el vencimiento
reset(); { const A = usuario("A", "Ana"), B = usuario("B", "Beto");
  await A.c.abrir("oc1"); await B.c.abrir("oc1"); await avanzar(20000);
  A.red.caida = true; const t0 = T;
  await avanzar(38000);
  ok(!A.c.puedeEditar("oc1"), `4. sin respuesta del servidor A pierde la capacidad de editar (heartbeat fallido): fase=${A.c.obtener().fase}`);
  ok(B.c.obtener().fase === "ocupada", "4. antes del vencimiento B sigue en solo lectura");
  await avanzar(40000);
  ok(B.c.obtener().fase === "propietario", `4. B adquiere tras el vencimiento (a ${Math.round((T - t0) / 1000)} s de perder la conexión A)`);
  A.red.caida = false; await avanzar(20000);
  ok(A.c.obtener().fase === "perdida" || A.c.obtener().fase === "ocupada", `4. A reconectado no recupera mientras B es propietario (fase ${A.c.obtener().fase})`);
  const v = await A.c.verificar("oc1"); ok(!v.ok, "11. A no puede guardar: verificación negativa");
  await B.c.cerrar(); await avanzar(11000);
  ok(A.c.obtener().fase === "propietario" && A.c.puedeEditar("oc1"), "4. A recupera la edición automáticamente cuando B libera"); await A.c.cerrar(); }

// 8. iPhone/background: timers congelados, el servidor sigue; al volver se revalida
reset(); { const A = usuario("A", "Ana"), B = usuario("B", "Beto");
  await A.c.abrir("oc1"); await B.c.abrir("oc1");
  // A congelada 120 s: sus temporizadores no corren; B (activo) toma el bloqueo al vencer
  const congelados = timers.filter(t => true).map(t => t.id); T += 0;
  const guardados = timers.splice(0, timers.length);
  const propios = guardados; // se descartan los de A y B; se reponen los de B reiniciando su ciclo
  T += 120000; filas.get("oc1").exp = Math.min(filas.get("oc1").exp, T - 70000);
  await B.c.reintentar(); ok(B.c.obtener().fase === "propietario", "8. B (activo) toma la OC vencida de A");
  await A.c.reintentar();
  ok(A.c.obtener().fase === "perdida" && !A.c.puedeEditar("oc1"), `8. A vuelve del segundo plano: se revalida y queda en solo lectura (${A.c.obtener().fase})`);
  await A.c.cerrar(); await B.c.cerrar(); }

// 8b. A congelada, nadie más toma: al volver conserva (propio vencido) o readquiere
reset(); { const A = usuario("A", "Ana"); await A.c.abrir("oc1"); T += 200000; timers.length = 0; await A.c.reintentar();
  ok(A.c.obtener().fase === "propietario", "8b. A vuelve del segundo plano y nadie había tomado la OC: sigue siendo propietario"); await A.c.cerrar(); }

// 12. apertura simultánea → exactamente un ganador
reset(); { const A = usuario("A", "Ana"), B = usuario("B", "Beto");
  await Promise.all([A.c.abrir("oc1"), B.c.abrir("oc1")]);
  const g = [A, B].filter(x => x.c.obtener().fase === "propietario").length;
  ok(g === 1, `12. apertura simultánea: ganadores=${g} (debe ser 1)`);
  await A.c.cerrar(); await B.c.cerrar(); }

// 7. heartbeat fallido: verificar() niega y no se permite guardar
reset(); { const A = usuario("A", "Ana"); await A.c.abrir("oc1"); A.red.caida = true;
  const v = await A.c.verificar("oc1"); ok(!v.ok && v.motivo === "sin_conexion", "7. sin conexión: verificar() niega la modificación (sin_conexion)");
  A.red.caida = false; const v2 = await A.c.verificar("oc1"); ok(v2.ok, "7. con conexión de vuelta, verificar() vuelve a permitir"); await A.c.cerrar(); }

// 9. pagehide (suspender) libera, y al volver desde bfcache readquiere; cerrar (logout) libera
reset(); { const A = usuario("A", "Ana"); await A.c.abrir("oc1"); await A.c.suspender({ keepalive: true });
  ok(!filas.has("oc1") && A.c.obtener().ocId === "oc1" && !A.c.puedeEditar("oc1"), "9. pagehide: libera y queda sin edición hasta revalidar");
  await A.c.reintentar(); ok(A.c.puedeEditar("oc1"), "9. pageshow (bfcache): readquiere");
  await A.c.cerrar(); ok(!filas.has("oc1") && A.c.obtener().fase === "ninguna", "9. logout/cambio de panel: libera"); }

// 13. pagehide sin red: no se libera, el TTL recupera la OC
reset(); { const A = usuario("A", "Ana"), B = usuario("B", "Beto"); await A.c.abrir("oc1"); await B.c.abrir("oc1"); A.red.caida = true; await A.c.suspender();
  ok(filas.has("oc1"), "13. liberación fallida (sin red): la fila sigue"); await avanzar(60000);
  ok(B.c.obtener().fase === "propietario", "13. el vencimiento recupera la OC aunque la liberación falló"); await B.c.cerrar(); }

// 14. respuesta tardía de una adquisición superada (A→B rápido): no deja bloqueos colgados
reset(); { const A = usuario("A", "Ana"); const p1 = A.c.abrir("ocX"); const p2 = A.c.abrir("ocY"); await Promise.all([p1, p2]);
  ok(!filas.has("ocX") && filas.get("ocY")?.uid === "A", "14. cambios rápidos X→Y: no queda bloqueo colgado en X"); await A.c.cerrar(); }

console.log(fallos ? `\n${fallos} FALLO(S)` : "\nTODAS LAS PRUEBAS DEL CONTROLADOR OK");
process.exit(fallos ? 1 : 0);
