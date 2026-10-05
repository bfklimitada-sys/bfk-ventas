// Bloqueo cooperativo de edición de OC — controlador (sin dependencias de React ni de Supabase; se prueba en Node).
// El servidor decide: tiempo = now() de PostgreSQL y propietario = auth.uid() (RPC gestionar_bloqueo_oc).
// Aquí solo se programa el ciclo: adquirir → renovar cada 15 s → liberar. La liberación voluntaria es una optimización;
// la garantía de recuperación es el vencimiento del TTL (45 s) en el servidor.
export const TTL_SEGUNDOS = 45;
export const HEARTBEAT_MS = 15000;      // renovación mientras se es propietario
export const REINTENTO_RED_MS = 5000;   // tras un fallo de red
export const REINTENTO_MIN_MS = 3000;   // espera mínima entre intentos de adquisición
export const REINTENTO_MAX_MS = 10000;  // espera máxima entre intentos de adquisición
export const MARGEN_MS = 5000;          // sin confirmación del servidor durante TTL - margen → solo lectura

// Fases: ninguna | adquiriendo | propietario | ocupada | perdida | sin_confirmar
export function crearControlador({ rpc, ahora = () => Date.now(), setT = setTimeout, clearT = clearTimeout }) {
  let estado = { ocId: null, fase: "ninguna", dueno: null, hasta: 0, verificadoEn: 0, perdida: false };
  let seq = 0;
  let timer = null, timerCaduca = null;
  const subs = new Set();

  const emitir = (p) => { estado = { ...estado, ...p }; subs.forEach((f) => { try { f(estado); } catch { /* suscriptor */ } }); };
  const parar = () => { if (timer) clearT(timer); if (timerCaduca) clearT(timerCaduca); timer = null; timerCaduca = null; };
  const programar = (fn, ms) => { if (timer) clearT(timer); timer = setT(fn, ms); };
  const espera = (seg) => Math.min(REINTENTO_MAX_MS, Math.max(REINTENTO_MIN_MS, (Number(seg) || 0) * 1000 + 1000));

  // Sin respuesta del servidor durante demasiado tiempo el propietario deja de poder modificar.
  const caduca = () => TTL_SEGUNDOS * 1000 - MARGEN_MS;
  const programarCaducidad = (miSeq) => {
    if (timerCaduca) clearT(timerCaduca);
    timerCaduca = setT(() => {
      if (miSeq === seq && estado.fase === "propietario" && ahora() - estado.verificadoEn >= caduca()) {
        emitir({ fase: "sin_confirmar", perdida: true });
        programar(() => adquirir(miSeq, estado.ocId), REINTENTO_RED_MS);
      }
    }, caduca() + 50);
  };

  async function adquirir(miSeq, ocId) {
    if (miSeq !== seq) return;
    let r;
    try { r = await rpc(ocId, "adquirir"); }
    catch {
      if (miSeq !== seq) return;
      if (estado.fase !== "propietario") emitir({ fase: estado.perdida ? "sin_confirmar" : "adquiriendo" });
      programar(() => adquirir(miSeq, ocId), REINTENTO_RED_MS);
      return;
    }
    if (miSeq !== seq) { if (r && r.ok) { try { await rpc(ocId, "liberar"); } catch { /* vence solo */ } } return; }
    if (r && r.ok) {
      emitir({ fase: "propietario", dueno: null, hasta: 0, verificadoEn: ahora(), perdida: false });
      programar(() => latido(miSeq, ocId), HEARTBEAT_MS);
      programarCaducidad(miSeq);
    } else if (r && r.motivo === "ocupada") {
      emitir({ fase: estado.perdida ? "perdida" : "ocupada", dueno: r.usuario_nombre || "otro usuario", hasta: ahora() + (r.segundos_restantes || 0) * 1000 });
      programar(() => adquirir(miSeq, ocId), espera(r.segundos_restantes));
    } else {
      programar(() => adquirir(miSeq, ocId), REINTENTO_MIN_MS);
    }
  }

  async function latido(miSeq, ocId) {
    if (miSeq !== seq) return;
    const r = await renovarUnaVez(miSeq, ocId);
    if (miSeq !== seq) return;
    if (r === "ok") { programar(() => latido(miSeq, ocId), HEARTBEAT_MS); }
    else if (r === "red") { programar(() => latido(miSeq, ocId), REINTENTO_RED_MS); }
    // "perdido": renovarUnaVez ya cambió de fase y programó la readquisición
  }

  // Devuelve "ok" | "red" | "perdido". Actualiza el estado.
  async function renovarUnaVez(miSeq, ocId) {
    let r;
    try { r = await rpc(ocId, "renovar"); } catch { return "red"; }
    if (miSeq !== seq) return "perdido";
    if (r && r.ok) { emitir({ verificadoEn: ahora() }); programarCaducidad(miSeq); return "ok"; }
    if (r && r.motivo === "sin_bloqueo") { emitir({ fase: "adquiriendo", perdida: true }); programar(() => adquirir(miSeq, ocId), 0); return "perdido"; }
    emitir({ fase: "perdida", perdida: true, dueno: (r && r.usuario_nombre) || "otro usuario", hasta: ahora() + ((r && r.segundos_restantes) || 0) * 1000 });
    programar(() => adquirir(miSeq, ocId), espera(r && r.segundos_restantes));
    return "perdido";
  }

  const api = {
    obtener: () => estado,
    suscribir(f) { subs.add(f); return () => subs.delete(f); },
    // ¿Puede modificar esta OC ahora? (comprobación local; la definitiva es verificar())
    puedeEditar(ocId) {
      return estado.ocId === ocId && estado.fase === "propietario" && ahora() - estado.verificadoEn < caduca();
    },
    // Cambio de OC (A → B): libera A y luego intenta adquirir B.
    async abrir(ocId) {
      if (!ocId) return api.cerrar();
      if (estado.ocId === ocId && estado.fase !== "ninguna") return;
      const previa = estado.ocId, eraPropia = estado.fase === "propietario";
      const miSeq = ++seq; parar();
      emitir({ ocId, fase: "adquiriendo", dueno: null, hasta: 0, verificadoEn: 0, perdida: false });
      if (previa && eraPropia) { try { await rpc(previa, "liberar"); } catch { /* vence solo */ } }
      await adquirir(miSeq, ocId);
    },
    // Cerrar OC / cambiar de panel / logout. keepalive: para pagehide.
    async cerrar(opts) {
      const previa = estado.ocId, eraPropia = estado.fase === "propietario";
      ++seq; parar();
      emitir({ ocId: null, fase: "ninguna", dueno: null, hasta: 0, verificadoEn: 0, perdida: false });
      if (previa && eraPropia) { try { await rpc(previa, "liberar", opts); } catch { /* vence solo */ } }
    },
    // pagehide: libera (si se puede) pero recuerda la OC, para readquirir si la página vuelve desde la caché (bfcache).
    async suspender(opts) {
      const previa = estado.ocId, eraPropia = estado.fase === "propietario";
      if (!previa) return;
      ++seq; parar();
      emitir({ fase: "adquiriendo", dueno: null, hasta: 0, verificadoEn: 0, perdida: false });
      if (eraPropia) { try { await rpc(previa, "liberar", opts); } catch { /* vence solo */ } }
    },
    // Reintento manual (botón) o al volver a primer plano.
    async reintentar() {
      const ocId = estado.ocId; if (!ocId) return;
      const miSeq = ++seq; parar();
      if (estado.fase === "propietario") { const r = await renovarUnaVez(miSeq, ocId); if (r === "ok") { programar(() => latido(miSeq, ocId), HEARTBEAT_MS); } else if (r === "red") { programar(() => latido(miSeq, ocId), REINTENTO_RED_MS); } return; }
      await adquirir(miSeq, ocId);
    },
    // Antes de una modificación relevante: confirma contra el servidor que sigo siendo propietario.
    async verificar(ocId) {
      if (estado.ocId !== ocId || estado.fase !== "propietario") return { ok: false, motivo: estado.fase === "ocupada" ? "ocupada" : "perdida" };
      const miSeq = seq;
      const r = await renovarUnaVez(miSeq, ocId);
      if (r === "ok") return { ok: true };
      if (r === "red") return { ok: false, motivo: "sin_conexion" };
      return { ok: false, motivo: "perdida" };
    },
  };
  return api;
}

export function mensajeVerificacion(v) {
  if (v && v.motivo === "sin_conexion") return "No se pudo confirmar tu sesión de edición (sin conexión). No se guardó el cambio. Reintenta cuando tengas conexión.";
  return "Perdiste la sesión de edición de esta OC porque otro usuario la tomó o expiró. No se guardó el cambio. La OC está en solo lectura hasta que puedas recuperar la edición.";
}
