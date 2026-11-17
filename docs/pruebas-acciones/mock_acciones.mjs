// Centro de Acciones (17/11/2026) · Supabase simulado CON la migración instalada, para pruebas de interfaz.
// Toma la base simulada de siempre (docs/pruebas-oc/mock_estado.mjs) y le agrega, como en la base real
// (docs/migraciones/2026-11-17-centro-acciones.sql): catálogo de categorías, acciones con o sin OC, autor/fechas/responsable
// fijados por la base, reapertura, historial escrito por la base, aviso al responsable y acciones automáticas
// (postventa y entrega fallida). Las reglas de la base se prueban de verdad en PostgreSQL (sql_acciones.test.mjs).
import { crearBase } from "../pruebas-oc/mock_estado.mjs";
import { CATEGORIAS_BASE } from "../../src/lib/acciones.js";
const clon = (x) => JSON.parse(JSON.stringify(x));
const PRI = { alta: "Alta", media: "Media", baja: "Baja" }; const EST = { pendiente: "Pendiente", en_gestion: "En gestión", resuelto: "Resuelta" };
const fechaTxt = (d) => (d ? `${String(d).slice(8, 10)}/${String(d).slice(5, 7)}/${String(d).slice(0, 4)}` : "—");

export function crearBaseAcciones(datos, opciones = {}) {
  const b = crearBase(datos, opciones); const db = b.db;
  db.acciones_categorias = db.acciones_categorias || CATEGORIAS_BASE.map((c) => ({ ...c, creado_en: "2026-11-17T00:00:00Z", creado_por: null }));
  db.oc_seguimientos = db.oc_seguimientos || []; db.notificaciones = db.notificaciones || []; db.eventos_postventa = db.eventos_postventa || [];
  const leer0 = b.leer, escribir0 = b.escribir, rpc0 = b.rpc;
  let reloj = Date.now();
  const ahora = () => { reloj = Math.max(Date.now(), reloj + 1); return new Date(reloj).toISOString(); };   // reloj real, estrictamente creciente
  const perfil = (yo) => (db.perfiles || []).find((p) => p.id === yo) || null;
  const esAdmin = (yo) => perfil(yo)?.rol === "admin";
  const err = (message, status = 400) => ({ status, json: { message } });
  const catEt = (id) => db.acciones_categorias.find((c) => c.id === id)?.etiqueta || id;
  const numOC = (id) => (id ? db.ordenes_compra_v2.find((o) => o.id === id)?.numero_oc || null : null);
  let nH = 0;
  const hist = (s, yo, accion, antes, despues, sistema) => db.historial_cambios.push({ id: `hc_acc_${++nH}`, oc_id: s.oc_id || null, oc_numero: numOC(s.oc_id), usuario_id: yo || null,
    usuario_nombre: sistema ? `Automático${perfil(yo) ? ` (${perfil(yo).nombre})` : ""}` : perfil(yo)?.nombre || null, accion, campo: "seguimiento:" + s.id,
    valor_anterior: antes ?? null, valor_nuevo: despues ?? null, creadoEn: ahora() });
  const avisar = (s, yo) => { if (s.responsable_id && s.responsable_id !== yo && s.estado !== "resuelto")
    db.notificaciones.push({ id: "ntf_acc_" + (++nH), usuario_id: s.responsable_id, tipo: "asignacion", oc_id: s.oc_id || null, oc_numero: numOC(s.oc_id), leida: false, creadoEn: ahora(),
      mensaje: `Te asignaron la acción «${(s.titulo || catEt(s.categoria)).slice(0, 80)}»${numOC(s.oc_id) ? ` de la OC ${numOC(s.oc_id)}` : ""}` }); };
  const limpiar = (f) => { f.titulo = String(f.titulo ?? "").trim() || null; f.cliente = String(f.cliente ?? "").trim() || null; if (f.oc_id) f.cliente = null;
    f.responsable_nombre = f.responsable_id ? perfil(f.responsable_id)?.nombre || null : null; };

  // Réplica de seg_antes_guardar + acc_historial (sistema = funciones automáticas de la base)
  const insertar = (cuerpo, yo, sistema = false) => {
    const f = { prioridad: "media", estado: "pendiente", oc_id: null, titulo: null, cliente: null, origen: null, origen_id: null, responsable_id: null, fecha_revision: null, sobrecosto_estimado: null, ...cuerpo };
    if (!sistema && !perfil(yo)) return err("new row violates row-level security policy for table \"oc_seguimientos\"", 403);
    if (!sistema && f.origen) return err("Las acciones automáticas solo las genera el sistema");
    limpiar(f);
    if (!f.oc_id && !f.titulo) return err("Una acción sin OC necesita un título");
    if (!db.acciones_categorias.some((c) => c.id === f.categoria && c.activa !== false)) return err(`La categoría «${f.categoria}» no está disponible`);
    if (!String(f.descripcion || "").trim()) return err('new row violates check constraint "oc_seguimientos_descripcion_check"');
    if (f.estado === "resuelto") return err("Un seguimiento se crea abierto (Pendiente o En gestión)");
    if (db.oc_seguimientos.some((x) => x.id === f.id)) return { status: 409, json: { code: "23505", message: "duplicate key" } };
    Object.assign(f, { creado_por: yo || null, creado_por_nombre: sistema ? "Automático" : perfil(yo)?.nombre || "", creado_en: ahora(), actualizado_por: null, actualizado_en: null, solucion: null, resuelto_por: null, resuelto_por_nombre: null, resuelto_en: null });
    db.oc_seguimientos.push(f);
    hist(f, yo, `${f.origen ? "Acción: creada automáticamente" : "Acción: creada"} (${catEt(f.categoria)} · prioridad ${PRI[f.prioridad].toLowerCase()})`, null, `${f.titulo ? f.titulo + ": " : ""}${f.descripcion.slice(0, 300)}`, sistema);
    avisar(f, yo);
    return { status: 201, json: [clon(f)] };
  };
  const actualizar = (id, cambios, yo, sistema = false) => {
    const f = db.oc_seguimientos.find((x) => x.id === id);
    if (!f || (!sistema && !perfil(yo))) return { status: 200, json: [] };
    const c = { ...cambios };
    if (["oc_id", "creado_por", "creado_en", "origen", "origen_id"].some((k) => k in c && String(c[k] ?? "") !== String(f[k] ?? ""))) return err("No se puede cambiar la OC, el origen, el autor ni la fecha de creación de un seguimiento");
    const n = { ...f, ...c }; limpiar(n);
    if (!n.oc_id && !n.titulo) return err("Una acción sin OC necesita un título");
    if (n.categoria !== f.categoria && !db.acciones_categorias.some((x) => x.id === n.categoria && x.activa !== false)) return err(`La categoría «${n.categoria}» no está disponible`);
    const datos = ["titulo", "descripcion", "categoria", "prioridad", "responsable_id", "fecha_revision", "sobrecosto_estimado", "cliente"];
    if (f.estado === "resuelto" && !sistema && !esAdmin(yo) && (n.estado === "resuelto" || datos.some((k) => String(n[k] ?? "") !== String(f[k] ?? ""))))
      return err("Este seguimiento ya está resuelto: queda como historial (para modificarlo, reábralo primero; solo un administrador puede editarlo resuelto)");
    if (n.estado === "resuelto" && f.estado !== "resuelto") {
      if (!String(n.solucion || "").trim()) return err("Para resolver, describe brevemente la solución");
      Object.assign(n, { solucion: n.solucion.trim(), resuelto_por: yo || null, resuelto_por_nombre: sistema ? "Automático" : perfil(yo)?.nombre || "", resuelto_en: ahora() });
    } else if (n.estado !== "resuelto") Object.assign(n, { solucion: null, resuelto_por: null, resuelto_por_nombre: null, resuelto_en: null });
    else Object.assign(n, { resuelto_por: f.resuelto_por, resuelto_por_nombre: f.resuelto_por_nombre, resuelto_en: f.resuelto_en });
    const antes = { ...f };
    Object.assign(f, n, { actualizado_por: yo || null, actualizado_en: ahora() });
    const L = [
      ["titulo", "Acción: título cambiado", antes.titulo, f.titulo], ["descripcion", "Acción: descripción cambiada", antes.descripcion, f.descripcion],
      ["categoria", "Acción: categoría cambiada", catEt(antes.categoria), catEt(f.categoria)], ["prioridad", "Acción: prioridad cambiada", PRI[antes.prioridad], PRI[f.prioridad]],
      ["responsable_id", "Acción: responsable cambiado", antes.responsable_nombre || "Sin asignar", f.responsable_nombre || "Sin asignar"],
      ["fecha_revision", "Acción: vencimiento cambiado", fechaTxt(antes.fecha_revision), fechaTxt(f.fecha_revision)], ["cliente", "Acción: cliente cambiado", antes.cliente, f.cliente],
    ];
    for (const [k, accion, a, d] of L) if (String(antes[k] ?? "") !== String(f[k] ?? "")) hist(f, yo, accion, a, d, sistema);
    if (antes.estado !== "resuelto" && f.estado !== "resuelto" && antes.estado !== f.estado) hist(f, yo, "Acción: estado cambiado", EST[antes.estado], EST[f.estado], sistema);
    if (antes.estado !== "resuelto" && f.estado === "resuelto") hist(f, yo, "Acción: resuelta", EST[antes.estado], f.solucion, sistema);
    if (antes.estado === "resuelto" && f.estado !== "resuelto") hist(f, yo, "Acción: reabierta", "Solución anterior: " + (antes.solucion || "—"), EST[f.estado], sistema);
    if (f.responsable_id && f.responsable_id !== antes.responsable_id) avisar(f, yo);
    return { status: 200, json: [clon(f)] };
  };
  // Disparadores de postventa y entrega (acc_trg_postventa / acc_trg_entrega)
  const TIPOS = { falla: "Falla del producto", faltante: "Faltante", cambio: "Cambio / reposición", devolucion: "Devolución", otro: "Otro" };
  const trgPostventa = (op, nuevo, viejo, yo) => {
    if (op === "DELETE") { const s = db.oc_seguimientos.find((x) => x.origen === "postventa" && x.origen_id === viejo.id && x.estado !== "resuelto"); if (s) actualizar(s.id, { estado: "resuelto", solucion: "El incidente de postventa de origen se eliminó de la OC. Cierre automático." }, yo, true); return; }
    const s = db.oc_seguimientos.find((x) => x.origen === "postventa" && x.origen_id === nuevo.id);
    if ((nuevo.estado || "abierto") === "resuelto") { if (s && s.estado !== "resuelto") actualizar(s.id, { estado: "resuelto", solucion: `Incidente de postventa cerrado en la OC${nuevo.solucion ? ": " + nuevo.solucion : ""}. Cierre automático.` }, yo, true); return; }
    if (s) { if (s.estado === "resuelto" && op === "UPDATE" && (viejo?.estado || "abierto") === "resuelto") actualizar(s.id, { estado: "pendiente" }, yo, true); return; }
    const oc = db.ordenes_compra_v2.find((o) => o.id === nuevo.oc_id); if (!oc || oc.archivada) return;
    insertar({ id: "seg_pv_" + nuevo.id, oc_id: nuevo.oc_id, categoria: "postventa", titulo: `Gestionar reclamo de postventa · ${TIPOS[nuevo.tipo] || "Otro"}`,
      descripcion: `Reclamo del ${fechaTxt(nuevo.fecha)}: ${nuevo.descripcion || "sin descripción"}`, prioridad: "media", origen: "postventa", origen_id: nuevo.id }, yo, true);
  };
  const filtrarAcc = (filas, params) => {
    let r = filas;
    for (const [k, v] of params) {
      if (["select", "order", "limit", "offset"].includes(k)) continue;
      if (k === "or") { const conds = decodeURIComponent(v).replace(/^\(|\)$/g, "").split(",").map((c) => c.split(".gte.")); r = r.filter((f) => conds.some(([c, x]) => f[c] && String(f[c]) >= x)); continue; }
      if (v.startsWith("gte.")) { const x = decodeURIComponent(v.slice(4)); r = r.filter((f) => String(f[k] ?? "") >= x); continue; }
      if (v.startsWith("eq.")) { const x = decodeURIComponent(v.slice(3)); r = r.filter((f) => String(f[k]) === x); continue; }
      if (v === "is.null") { r = r.filter((f) => f[k] == null); continue; }
      if (v.startsWith("like.")) { const re = new RegExp("^" + decodeURIComponent(v.slice(5)).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$"); r = r.filter((f) => re.test(String(f[k]))); continue; }
      if (v.startsWith("in.(")) { const xs = v.slice(4, -1).split(",").map((x) => decodeURIComponent(x.replace(/^"|"$/g, ""))); r = r.filter((f) => xs.includes(String(f[k]))); continue; }
    }
    return clon(r);
  };
  b.leer = (tabla, params) => {
    if (tabla === "acciones_categorias") return clon([...db.acciones_categorias].sort((a, c) => a.orden - c.orden));
    if (tabla === "oc_seguimientos" || (tabla === "historial_cambios" && [...params.keys()].some((k) => k === "creadoEn" || k === "campo"))) {
      const f = filtrarAcc(db[tabla] || [], params);
      const ord = params.get("order") || ""; const campo = ord.split(".")[0];
      if (campo) f.sort((a, c) => (ord.endsWith(".desc") ? -1 : 1) * String(a[campo] ?? "").localeCompare(String(c[campo] ?? "")));
      return f.slice(0, Number(params.get("limit")) || 5000);
    }
    return leer0(tabla, params);
  };
  b.escribir = (metodo, tabla, params, cuerpo, yo) => {
    const id = (params.get("id") || "").startsWith("eq.") ? decodeURIComponent(params.get("id").slice(3)) : null;
    if (tabla === "oc_seguimientos") {
      b.escr.push({ metodo, tabla, id, cuerpo: clon(cuerpo ?? null), n: b.escr.length });
      if (metodo === "POST") return insertar(Array.isArray(cuerpo) ? cuerpo[0] : cuerpo, yo);
      if (metodo === "PATCH") return actualizar(id, cuerpo, yo);
      if (metodo === "DELETE") { const f = db.oc_seguimientos.find((x) => x.id === id); if (!f || !esAdmin(yo)) return { status: 200, json: [] };
        db.oc_seguimientos = db.oc_seguimientos.filter((x) => x.id !== id); hist(f, yo, "Acción: eliminada (administrador)", f.titulo || f.descripcion, null); return { status: 200, json: [clon(f)] }; }
    }
    if (tabla === "acciones_categorias") {
      b.escr.push({ metodo, tabla, id, cuerpo: clon(cuerpo ?? null), n: b.escr.length });
      if (!esAdmin(yo)) return metodo === "PATCH" ? { status: 200, json: [] } : err('new row violates row-level security policy for table "acciones_categorias"', 403);
      if (metodo === "POST") { const f = { activa: true, orden: 100, ...cuerpo, creado_por: yo, creado_en: ahora() }; if (db.acciones_categorias.some((c) => c.id === f.id)) return { status: 409, json: { code: "23505", message: "duplicate key" } }; db.acciones_categorias.push(f); return { status: 201, json: [clon(f)] }; }
      if (metodo === "PATCH") { const f = db.acciones_categorias.find((c) => c.id === id); if (!f) return { status: 200, json: [] }; Object.assign(f, cuerpo); return { status: 200, json: [clon(f)] }; }
    }
    if (tabla === "eventos_postventa") {
      const previa = id ? clon(db.eventos_postventa.find((x) => x.id === id) || null) : null;
      const r = escribir0(metodo, tabla, params, cuerpo, yo);
      if (r.status < 300) {
        if (metodo === "POST") for (const f of r.json || []) trgPostventa("INSERT", f, null, yo);
        if (metodo === "PATCH" && previa) trgPostventa("UPDATE", db.eventos_postventa.find((x) => x.id === id), previa, yo);
        if (metodo === "DELETE" && previa) trgPostventa("DELETE", null, previa, yo);
      }
      return r;
    }
    const r = escribir0(metodo, tabla, params, cuerpo, yo);
    if (tabla === "eventos_entrega" && metodo === "POST" && r.status < 300)
      for (const e of r.json || []) for (const s of db.oc_seguimientos.filter((x) => x.origen === "entrega_fallida" && x.oc_id === e.oc_id && x.estado !== "resuelto"))
        actualizar(s.id, { estado: "resuelto", solucion: `Entrega registrada el ${fechaTxt(e.fecha)}${e.persona_recibe ? ` (recibe: ${e.persona_recibe})` : ""}. Cierre automático.` }, yo, true);
    return r;
  };
  b.rpc = (fn, cuerpo, yo, interno) => {
    if (fn !== "acc_registrar_entrega_fallida") return rpc0(fn, cuerpo, yo, interno);
    if (!perfil(yo)) return err("ACC: se requiere un perfil BFK", 403);
    const motivo = String(cuerpo.p_motivo || "").trim(), lugar = String(cuerpo.p_lugar || "").trim();
    if (!motivo) return err("Indica el motivo de la entrega fallida");
    const oc = db.ordenes_compra_v2.find((o) => o.id === cuerpo.p_oc_id); if (!oc) return err("ACC: la OC no existe"); if (oc.archivada) return err("ACC: la OC está archivada");
    const abierta = db.oc_seguimientos.find((x) => x.origen === "entrega_fallida" && x.oc_id === oc.id && x.estado !== "resuelto");
    if (abierta) { hist(abierta, yo, "Acción: nuevo intento de entrega fallido", null, `${lugar ? `Lugar: ${lugar} · ` : ""}Motivo: ${motivo}`); return { status: 200, json: { id: abierta.id, nueva: false } }; }
    const hoy = new Date(); const dow = hoy.getDay() || 7; const v = new Date(hoy); if (dow <= 5) v.setDate(v.getDate() + (5 - dow));
    const z = (n) => String(n).padStart(2, "0"); const vence = `${v.getFullYear()}-${z(v.getMonth() + 1)}-${z(v.getDate())}`;
    const r = insertar({ id: "seg_ef_" + (++nH), oc_id: oc.id, categoria: "entrega", titulo: "Reprogramar entrega fallida", prioridad: "alta", fecha_revision: vence, origen: "entrega_fallida", origen_id: oc.id,
      descripcion: `Entrega fallida${lugar ? ` en ${lugar}` : ""}. Motivo: ${motivo}. Se informó al cliente un nuevo intento durante la semana.` }, yo, true);
    return { status: 200, json: { id: r.json[0].id, nueva: true } };
  };
  b.acc = { insertar, actualizar, trgPostventa };
  return b;
}
