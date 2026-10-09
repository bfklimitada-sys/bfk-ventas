// Supabase y /api/oc simulados CON ESTADO (en memoria) para pruebas de interfaz de OCs (Fase 4A, modelo financiero de la Fase 4B).
// Las escrituras se aplican a la base simulada y se registran; nada sale a la red.
import { chromium } from "playwright-core";
export const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
export { chromium };

const HIJAS = ["eventos_compra", "eventos_entrega", "eventos_factura", "eventos_pago_cliente", "eventos_pago_financiamiento", "oc_productos_link", "oc_comentarios"];
const clon = (x) => JSON.parse(JSON.stringify(x));

// db: { tabla: [filas] }. mp: { codigo: {status, body} | (n)=>({status,body}) }, listar: {modo: [...]}
// borrado: { tabla: "rls" | "error" } para simular que la base NO elimina.
// Fase 4B: la base simulada se comporta como la real: los totales de la OC y el saldo del financiador los
// calcula la base desde los eventos (el navegador no puede escribirlos), con las diferencias iniciales
// congeladas (igual que el corte de la migración) y las mismas operaciones atómicas (RPC).
const DERIVADAS = ["costo_total", "estado_compra", "monto_pagado_fin", "estado_pago_financiamiento", "monto_facturado", "estado_factura_propia", "monto_cobrado", "estado_pago_cliente"];
const MONTOS = ["costo_total", "monto_pagado_fin", "monto_facturado", "monto_cobrado"];
const num = (v) => Number(v) || 0;
export function crearBase(inicial, { mp = {}, borrado = {} } = {}) {
  const db = clon(inicial); const escr = []; const llamadasMP = [];
  for (const t of HIJAS) db[t] = db[t] || [];
  db.ajustes_saldo_financiador = db.ajustes_saldo_financiador || []; db.historial_cambios = db.historial_cambios || [];
  for (const f of db.financiadores || []) if (!f.tipo) f.tipo = /cuenta\s*bfk/i.test(f.nombre || "") ? "propio" : "externo";
  const difs = { oc: {}, fin: {} };   // diferencias congeladas al crear la base (como fin_diferencias_historicas)
  const nAnul = (v) => String(v ?? "").trim();
  const vigentes = (ocId) => { const fs = db.eventos_factura.filter((f) => f.oc_id === ocId); return fs.filter((f) => !fs.some((a) => a.id !== f.id && nAnul(a.factura_anulada_numero) !== "" && nAnul(a.factura_anulada_numero) === nAnul(f.numero_factura))); };
  const tipoFin = (oc) => oc.es_venta_propia ? "venta_propia" : (db.financiadores || []).find((f) => f.id === oc.financiador_id)?.tipo === "propio" ? "fondos_propios" : "externo";
  const calcOC = (oc, conDifs = true) => {
    const d = conDifs ? (difs.oc[oc.id] || {}) : {};
    const compras = db.eventos_compra.filter((e) => e.oc_id === oc.id);
    const costo = compras.reduce((s, e) => s + num(e.costo_compra), 0) + num(d.costo_total);
    const pagado = db.eventos_pago_financiamiento.filter((e) => e.oc_id === oc.id).reduce((s, e) => s + num(e.monto), 0) + num(d.monto_pagado_fin);
    const vig = vigentes(oc.id); const fact = vig.reduce((s, e) => s + num(e.monto), 0) + num(d.monto_facturado);
    const cobrado = db.eventos_pago_cliente.filter((e) => e.oc_id === oc.id).reduce((s, e) => s + num(e.monto), 0) + num(d.monto_cobrado);
    const t = tipoFin(oc);
    const r = { costo_total: costo, estado_compra: compras.length ? "comprado" : "pendiente", monto_pagado_fin: pagado,
      estado_pago_financiamiento: t !== "externo" ? "no_aplica" : costo <= 0 ? "pendiente" : pagado >= costo ? "pagado" : pagado > 0 ? "parcial" : "pendiente",
      monto_facturado: fact, estado_factura_propia: vig.length ? "emitida" : "pendiente", monto_cobrado: cobrado,
      estado_pago_cliente: cobrado <= 0 ? "pendiente" : fact > 0 && cobrado >= fact ? "pagado" : "parcial" };
    for (const k of DERIVADAS) if (!MONTOS.includes(k) && d["e_" + k] !== undefined) r[k] = d["e_" + k];
    return r;
  };
  const calcFin = (f, conDifs = true) => {
    const dif = conDifs ? num(difs.fin[f.id]) : 0;
    if (f.tipo === "propio") return dif;
    const compras = db.ordenes_compra_v2.filter((o) => o.financiador_id === f.id && !o.es_venta_propia)
      .reduce((s, o) => s + db.eventos_compra.filter((e) => e.oc_id === o.id).reduce((a, e) => a + num(e.costo_compra), 0) + num(difs.oc[o.id]?.costo_total), 0);
    const pagos = db.eventos_pago_financiamiento.filter((e) => e.financiador_id === f.id).reduce((s, e) => s + num(e.monto), 0);
    const ajustes = db.ajustes_saldo_financiador.filter((a) => a.financiador_id === f.id).reduce((s, a) => s + num(a.monto_ajuste), 0);
    return compras - pagos + ajustes + dif;
  };
  // Corte inicial: montos congelados como diferencia y estados registrados como valor fijo (si difieren).
  for (const oc of db.ordenes_compra_v2) {
    const c = calcOC(oc, false); const d = {};
    for (const k of MONTOS) if (num(oc[k]) !== c[k]) d[k] = num(oc[k]) - c[k];
    difs.oc[oc.id] = d;
    const c2 = calcOC(oc, true);
    for (const k of DERIVADAS) if (!MONTOS.includes(k) && (oc[k] ?? "pendiente") !== c2[k]) d["e_" + k] = oc[k] ?? "pendiente";
  }
  for (const f of db.financiadores || []) { const c = calcFin(f, false); if (num(f.saldo_deuda) !== c) difs.fin[f.id] = num(f.saldo_deuda) - c; }
  const recalcular = () => {
    for (const oc of db.ordenes_compra_v2) Object.assign(oc, calcOC(oc));
    for (const f of db.financiadores || []) f.saldo_deuda = calcFin(f);
  };
  recalcular();
  const bloqueada = (ocId, dominio) => { const d = difs.oc[ocId] || {}; return dominio === "financiamiento" ? ["costo_total", "monto_pagado_fin", "e_estado_compra", "e_estado_pago_financiamiento"].some((k) => d[k] !== undefined) : dominio === "facturacion" ? ["monto_facturado", "e_estado_factura_propia"].some((k) => d[k] !== undefined) : dominio === "cobro" ? ["monto_cobrado", "e_estado_pago_cliente"].some((k) => d[k] !== undefined) : false; };
  const esAdmin = (yo) => (db.perfiles || []).some((p) => p.id === yo && p.rol === "admin");
  const filtrar = (filas, params) => {
    let r = filas;
    for (const [k, v] of params) {
      if (["select", "order", "limit", "offset"].includes(k)) continue;
      if (v.startsWith("eq.")) { const x = decodeURIComponent(v.slice(3)); r = r.filter((f) => String(f[k]) === x); }
      else if (v === "is.null") r = r.filter((f) => f[k] === null || f[k] === undefined);
      else if (v.startsWith("like.")) { const re = new RegExp("^" + decodeURIComponent(v.slice(5)).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$"); r = r.filter((f) => re.test(String(f[k]))); }
      else if (v.startsWith("in.(")) { const xs = decodeURIComponent(v.slice(4, -1)).split(","); r = r.filter((f) => xs.includes(String(f[k]))); }
    }
    return r;
  };
  const leer = (tabla, params) => {
    if (tabla === "fin_diferencias_historicas") {
      // Igual que la tabla real: una fila por campo congelado (montos con diferencia; estados con su valor registrado).
      const filas = []; let n = 0;
      const nombreOC = (id) => db.ordenes_compra_v2.find((o) => o.id === id)?.numero_oc;
      for (const [id, d] of Object.entries(difs.oc)) for (const [k, v] of Object.entries(d)) {
        const campo = k.replace(/^e_/, ""); const esEstado = k.startsWith("e_");
        const oc = db.ordenes_compra_v2.find((o) => o.id === id); const c = calcOC(oc, false);
        filas.push({ id: ++n, entidad: "oc", entidad_id: id, etiqueta: nombreOC(id), campo, valor_registrado: String(esEstado ? v : num(c[campo]) + v),
          valor_eventos: String(c[campo]), diferencia: esEstado ? null : v, estado: "pendiente", clasificacion: "decision", causa: "Diferencia de prueba",
          bloquea: ["costo_total", "monto_pagado_fin", "estado_compra", "estado_pago_financiamiento"].includes(campo) ? ["financiamiento"] : ["monto_facturado", "estado_factura_propia"].includes(campo) ? ["facturacion"] : ["cobro"], filas: [] });
      }
      for (const [id, v] of Object.entries(difs.fin)) {
        const f = db.financiadores.find((x) => x.id === id);
        filas.push({ id: ++n, entidad: "financiador", entidad_id: id, etiqueta: f?.nombre, campo: "saldo_deuda", valor_registrado: String(num(calcFin(f, false)) + v),
          valor_eventos: String(calcFin(f, false)), diferencia: v, estado: "pendiente", clasificacion: "decision", causa: "Saldo de prueba", bloquea: [], filas: [] });
      }
      return filas;
    }
    const filas = filtrar(db[tabla] || [], params);
    if (tabla !== "ordenes_compra_v2" || !String(params.get("select") || "").includes("eventos_compra")) return clon(filas);
    return clon(filas).map((o) => {
      for (const t of HIJAS) o[t] = clon((db[t] || []).filter((e) => e.oc_id === o.id));
      o.vendedores = o.vendedor_id ? { nombre: (db.vendedores || []).find((v) => v.id === o.vendedor_id)?.nombre } : null;
      o.financiadores = o.financiador_id ? { nombre: (db.financiadores || []).find((f) => f.id === o.financiador_id)?.nombre } : null;
      return o;
    });
  };
  const dominioDe = (t) => ({ eventos_compra: "financiamiento", eventos_pago_financiamiento: "financiamiento", eventos_factura: "facturacion", eventos_pago_cliente: "cobro" })[t];
  const escribir = (metodo, tabla, params, cuerpo) => {
    const id = (params.get("id") || "").startsWith("eq.") ? decodeURIComponent(params.get("id").slice(3)) : null;
    escr.push({ metodo, tabla, id, cuerpo: clon(cuerpo ?? null), n: escr.length });
    db[tabla] = db[tabla] || [];
    // Protección (Fase 4B): el navegador no fija totales derivados.
    const proteger = (f, previa) => {
      if (tabla === "ordenes_compra_v2") for (const k of DERIVADAS) { if (previa) delete f[k]; else f[k] = MONTOS.includes(k) ? 0 : "pendiente"; }
      if (tabla === "financiadores") { if (previa) delete f.saldo_deuda; else f.saldo_deuda = 0; }
      return f;
    };
    if (dominioDe(tabla)) {
      const ocId = metodo === "POST" ? (Array.isArray(cuerpo) ? cuerpo[0] : cuerpo)?.oc_id : db[tabla].find((f) => String(f.id) === String(id))?.oc_id;
      if (ocId && bloqueada(ocId, dominioDe(tabla))) return { status: 400, json: { message: "La OC tiene una corrección histórica pendiente de aprobación. No se registró ningún cambio." } };
    }
    if (metodo === "POST") {
      const filas = (Array.isArray(cuerpo) ? cuerpo : [cuerpo]).map((f) => proteger({ creadoEn: new Date().toISOString(), ...f }));
      // Clave primaria «id», como en PostgreSQL: un id repetido rechaza TODA la inserción (409 / 23505).
      const ids = filas.map((f) => f.id).filter((x) => x != null).map(String);
      if (new Set(ids).size !== ids.length || db[tabla].some((f) => ids.includes(String(f.id))))
        return { status: 409, json: { code: "23505", message: `duplicate key value violates unique constraint "${tabla}_pkey"` } };
      db[tabla].push(...clon(filas)); recalcular(); return { status: 201, json: clon(db[tabla].filter((f) => filas.some((x) => x.id === f.id))) };
    }
    if (metodo === "PATCH") {
      const afectadas = db[tabla].filter((f) => String(f.id) === String(id));
      for (const f of afectadas) Object.assign(f, proteger(clon(cuerpo), true));
      recalcular(); return { status: 200, json: clon(afectadas) };
    }
    if (metodo === "DELETE") {
      if (borrado[tabla] === "error") return { status: 403, json: { message: "permission denied (simulado)" } };
      if (borrado[tabla] === "rls") return { status: 200, json: [] };
      const fuera = db[tabla].filter((f) => String(f.id) === String(id));
      db[tabla] = db[tabla].filter((f) => String(f.id) !== String(id));
      recalcular(); return { status: 200, json: clon(fuera) };
    }
    return { status: 405, json: {} };
  };
  const err = (message, status = 400) => ({ status, json: { message } });
  const hist = (yo, ocId, accion) => db.historial_cambios.push({ id: "hc_" + db.historial_cambios.length, oc_id: ocId, usuario_id: yo, accion, creadoEn: new Date().toISOString() });
  const resumen = (ocId) => { const o = db.ordenes_compra_v2.find((x) => x.id === ocId); return o ? { oc_id: o.id, costo_total: o.costo_total, monto_pagado_fin: o.monto_pagado_fin, estado_pago_financiamiento: o.estado_pago_financiamiento, saldo_financiador: (db.financiadores || []).find((f) => f.id === o.financiador_id)?.saldo_deuda } : {}; };
  const rpc = (fn, b, yo) => {
    escr.push({ metodo: "RPC", tabla: fn, id: null, cuerpo: clon(b), n: escr.length });
    const ok = (j) => { recalcular(); return { status: 200, json: { ok: true, ...j } }; };
    if (fn === "gestionar_bloqueo_oc") return { status: 200, json: { ok: true, segundos_restantes: 45 } };
    if (fn === "registrar_entidad_desde_oc") return { status: 200, json: { accion: "sin_cambios" } };
    if (fn === "archivar_oc" || fn === "restaurar_oc") {
      const oc = db.ordenes_compra_v2.find((o) => o.id === b.p_oc_id);
      if (oc) Object.assign(oc, fn === "archivar_oc" ? { archivada: true, archivada_en: new Date().toISOString(), archivada_por: yo, archivo_motivo: b.p_motivo || null } : { archivada: false, archivada_en: null, archivada_por: null, archivo_motivo: null });
      return { status: 200, json: { ok: true, oc_id: b.p_oc_id } };
    }
    if (fn === "registrar_compra_oc") {
      const oc = db.ordenes_compra_v2.find((o) => o.id === b.p_oc_id); if (!oc) return err("La OC no existe");
      if (bloqueada(oc.id, "financiamiento")) return err(`La OC ${oc.numero_oc} tiene una corrección histórica pendiente de aprobación. No se registró ningún cambio.`);
      if (!b.p_fecha) return err("Falta la fecha de compra");
      const tiene = db.eventos_compra.some((e) => e.oc_id === oc.id);
      if (b.p_financiador_id && b.p_financiador_id !== oc.financiador_id) { if (tiene) return err(`La OC ${oc.numero_oc} ya tiene compras financiadas por otro financiador.`); oc.financiador_id = b.p_financiador_id; }
      if (!oc.financiador_id && !oc.es_venta_propia) return err("Indique el financiador de la compra");
      db.eventos_compra.push({ id: "evc_" + db.eventos_compra.length + "_" + escr.length, oc_id: oc.id, fecha: b.p_fecha, costo_compra: num(b.p_costo), monto_venta: b.p_monto_venta ?? oc.monto_total, fecha_entrega_estimada: b.p_fecha_entrega_estimada, financiador_id: oc.financiador_id, proveedor: b.p_proveedor || "", creado_por: yo, creadoEn: new Date().toISOString() });
      hist(yo, oc.id, "Compra registrada"); return ok(resumen(oc.id));
    }
    if (fn === "editar_compra_oc" || fn === "eliminar_compra_oc") {
      const ev = db.eventos_compra.find((e) => e.id === b.p_evento_id); if (!ev) return err("La compra no existe");
      if (bloqueada(ev.oc_id, "financiamiento")) return err("La OC tiene una corrección histórica pendiente de aprobación. No se registró ningún cambio.");
      if (fn === "eliminar_compra_oc") {
        if (!esAdmin(yo)) return err("Solo un administrador puede eliminar una compra");
        if (db.eventos_pago_financiamiento.some((p) => p.oc_id === ev.oc_id) && !db.eventos_compra.some((e) => e.oc_id === ev.oc_id && e.id !== ev.id)) return err("La OC tiene pagos al financiador registrados: elimínelos antes de eliminar su única compra");
        db.eventos_compra = db.eventos_compra.filter((e) => e.id !== ev.id); hist(yo, ev.oc_id, "Eliminó registro de compra"); return ok(resumen(ev.oc_id));
      }
      const oc = db.ordenes_compra_v2.find((o) => o.id === ev.oc_id);
      if (num(b.p_costo) < num(oc.monto_pagado_fin)) return err(`El costo de la OC ${oc.numero_oc} no puede quedar bajo lo ya pagado al financiador`);
      if (b.p_monto_venta !== null && b.p_monto_venta !== undefined && num(b.p_monto_venta) !== num(ev.monto_venta)) oc.monto_total = Math.max(0, num(oc.monto_total) + num(b.p_monto_venta) - num(ev.monto_venta));
      Object.assign(ev, { fecha: b.p_fecha, costo_compra: num(b.p_costo), ...(b.p_monto_venta !== null && b.p_monto_venta !== undefined ? { monto_venta: num(b.p_monto_venta) } : {}) });
      hist(yo, ev.oc_id, "Compra corregida"); return ok(resumen(ev.oc_id));
    }
    if (fn === "registrar_pago_financiador") {
      const fin = (db.financiadores || []).find((f) => f.id === b.p_financiador_id); if (!fin) return err("El financiador no existe");
      if (fin.tipo === "propio") return err(`Los fondos propios (${fin.nombre}) no son deuda con un financiador: no corresponde registrar pagos`);
      let total = 0;
      for (const a of b.p_asignaciones || []) {
        const oc = db.ordenes_compra_v2.find((o) => o.id === a.oc_id); if (!oc) return err("La OC no existe");
        if (oc.financiador_id !== fin.id) return err(`La OC ${oc.numero_oc} no pertenece a este financiador`);
        if (bloqueada(oc.id, "financiamiento")) return err(`La OC ${oc.numero_oc} tiene una corrección histórica pendiente de aprobación. No se registró ningún cambio.`);
        if (tipoFin(oc) !== "externo") return err(`La OC ${oc.numero_oc} no tiene financiamiento externo: su etapa de financiamiento no aplica`);
        if (oc.estado_pago_financiamiento === "pagado") return err(`La OC ${oc.numero_oc} ya figura con el financiamiento pagado`);
        if (num(a.monto) > num(oc.costo_total) - num(oc.monto_pagado_fin)) return err(`La asignación a la OC ${oc.numero_oc} supera lo que se adeuda`);
        total += num(a.monto);
      }
      if (total > num(b.p_monto)) return err("Las asignaciones superan el monto del pago");
      for (const a of b.p_asignaciones || []) { db.eventos_pago_financiamiento.push({ id: "pf_" + db.eventos_pago_financiamiento.length + "_" + escr.length, oc_id: a.oc_id, financiador_id: fin.id, fecha: b.p_fecha, monto: num(a.monto), creado_por: yo, creadoEn: new Date().toISOString() }); hist(yo, a.oc_id, "Abono de financiamiento"); }
      const resto = num(b.p_monto) - total;
      if (resto > 0) db.eventos_pago_financiamiento.push({ id: "pf_s" + db.eventos_pago_financiamiento.length + "_" + escr.length, oc_id: null, financiador_id: fin.id, fecha: b.p_fecha, monto: resto, creado_por: yo, creadoEn: new Date().toISOString() });
      const r = ok({ ocs: (b.p_asignaciones || []).length, asignado: total, sobrante: resto }); r.json.saldo_financiador = fin.saldo_deuda; return r;
    }
    if (fn === "editar_pago_financiador" || fn === "eliminar_pago_financiador") {
      const ev = db.eventos_pago_financiamiento.find((e) => e.id === b.p_evento_id); if (!ev) return err("El pago no existe");
      if (ev.oc_id && bloqueada(ev.oc_id, "financiamiento")) return err("La OC tiene una corrección histórica pendiente de aprobación. No se registró ningún cambio.");
      if (fn === "eliminar_pago_financiador") {
        if (borrado.eventos_pago_financiamiento === "error") return err("permission denied (simulado)", 403);
        if (borrado.eventos_pago_financiamiento === "rls" || !esAdmin(yo)) return err("Solo un administrador puede eliminar un pago");
        db.eventos_pago_financiamiento = db.eventos_pago_financiamiento.filter((e) => e.id !== ev.id); hist(yo, ev.oc_id, "Eliminó pago a financiador"); return ok(resumen(ev.oc_id));
      }
      if (ev.oc_id) { const oc = db.ordenes_compra_v2.find((o) => o.id === ev.oc_id); const otros = db.eventos_pago_financiamiento.filter((e) => e.oc_id === ev.oc_id && e.id !== ev.id).reduce((s, e) => s + num(e.monto), 0); if (otros + num(b.p_monto) > num(oc.costo_total)) return err(`Con ese monto los pagos de la OC ${oc.numero_oc} superarían su costo`); }
      Object.assign(ev, { fecha: b.p_fecha, monto: num(b.p_monto) }); hist(yo, ev.oc_id, "Pago a financiador corregido"); return ok(resumen(ev.oc_id));
    }
    if (fn === "cambiar_financiamiento_oc") {
      const oc = db.ordenes_compra_v2.find((o) => o.id === b.p_oc_id); if (!oc) return err("La OC no existe");
      if (bloqueada(oc.id, "financiamiento")) return err(`La OC ${oc.numero_oc} tiene una corrección histórica pendiente de aprobación. No se registró ningún cambio.`);
      if (db.eventos_pago_financiamiento.some((p) => p.oc_id === oc.id)) return err(`La OC ${oc.numero_oc} tiene pagos al financiador registrados: corríjalos o elimínelos antes de cambiar el financiamiento`);
      if (b.p_tipo === "venta_propia") { if (!oc.vendedor_id) return err("La venta propia requiere un vendedor asignado a la OC"); oc.es_venta_propia = true; }
      else {
        let fid = b.p_financiador_id; if (b.p_tipo === "fondos_propios" && !fid) fid = (db.financiadores || []).find((f) => f.tipo === "propio")?.id;
        const f = (db.financiadores || []).find((x) => x.id === fid); if (!f) return err("Indique el financiador");
        if ((b.p_tipo === "externo") !== (f.tipo === "externo")) return err("El financiador no corresponde al tipo de financiamiento");
        oc.es_venta_propia = false; oc.financiador_id = fid;
      }
      for (const e of db.eventos_compra.filter((x) => x.oc_id === oc.id)) e.financiador_id = oc.financiador_id;
      const nomFin = (db.financiadores || []).find((f) => f.id === oc.financiador_id)?.nombre || "—";
      hist(yo, oc.id, "Financiamiento cambiado");
      return ok({ despues: { venta_propia: "Venta propia", fondos_propios: "Fondos propios · " + nomFin, externo: "Financiador externo · " + nomFin }[tipoFin(oc)], ...resumen(oc.id) });
    }
    return { status: 200, json: { ok: true } };
  };
  const respuestaMP = (u) => {
    if (u.searchParams.get("listar")) return { status: 200, body: { ok: true, ocs: [] } };
    const cod = u.searchParams.get("codigo"); llamadasMP.push(cod);
    const r = mp[cod];
    if (!r) return { status: 404, body: { ok: false, error: "OC no encontrada en Mercado Público" } };
    return typeof r === "function" ? r(llamadasMP.filter((c) => c === cod).length) : r;
  };
  return { db, escr, llamadasMP, leer, escribir, rpc, respuestaMP, difs };
}

export async function abrir(browser, base, { url, usuario = "u1", ancho = 390, alto = 844, movil = true, espera = 1800, dialogos = "aceptar", prompt = "" } = {}) {
  const yo = usuario;
  const ctx = await browser.newContext({ viewport: { width: ancho, height: alto }, deviceScaleFactor: 1, isMobile: movil, hasTouch: movil, timezoneId: "America/Santiago" });
  const page = await ctx.newPage(); const errs = []; const dlg = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && /Warning|Each child|unique "key"/i.test(m.text())) errs.push("consola: " + m.text().slice(0, 160)); });
  page.on("dialog", (d) => { dlg.push(d.type() + ": " + d.message().slice(0, 90)); if (dialogos === "aceptar") d.type() === "prompt" ? d.accept(prompt) : d.accept(); else d.dismiss(); });
  await page.route("**/*", async (route) => {
    const req = route.request(); const u = new URL(req.url()); const m = req.method();
    if ((u.hostname === "127.0.0.1" || u.hostname === "localhost") && u.pathname.startsWith("/api/oc")) {
      const r = base.respuestaMP(u); return route.fulfill({ status: r.status, json: r.body });
    }
    if (u.hostname === "127.0.0.1" || u.hostname === "localhost") return route.continue();
    if (u.hostname.endsWith("supabase.co")) {
      if (u.pathname.includes("/auth/v1/token")) return route.fulfill({ json: { access_token: "t" + yo, refresh_token: "r", expires_in: 3600, user: { id: yo } } });
      if (u.pathname.includes("/auth/v1/user")) return route.fulfill({ json: { id: yo } });
      if (u.pathname.includes("/auth/v1/logout")) return route.fulfill({ json: {} });
      let cuerpo = null; try { cuerpo = JSON.parse(req.postData() || "null"); } catch {}
      if (u.pathname.includes("/rest/v1/rpc/")) { const r = base.rpc(u.pathname.split("/").pop(), cuerpo || {}, yo); return route.fulfill({ status: r.status, json: r.json }); }
      const tabla = u.pathname.split("/").pop();
      if (m === "GET") return route.fulfill({ json: base.leer(tabla, u.searchParams) });
      const r = base.escribir(m, tabla, u.searchParams, cuerpo);
      return route.fulfill({ status: r.status, json: r.json });
    }
    return route.abort();
  });
  await page.addInitScript((id) => { try { if (location.protocol.startsWith("http")) localStorage.setItem("bfk_supabase_session_v2", JSON.stringify({ access_token: "t" + id, refresh_token: "r", user: { id, email: id + "@prueba.cl" } })); } catch {} }, yo);
  await page.goto(url, { waitUntil: "load" }); await page.waitForTimeout(espera);
  return { page, ctx, errs, dlg };
}
