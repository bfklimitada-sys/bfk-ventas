import { aporteEnCaja, cobroEnCaja, esValeVistaPendiente, gastoEnCaja } from "./mediosPago.js";
import { facturaVigente, pagoVigente, totalTransferido } from "./calculos.js";
import { calzarAbonos } from "./cobranza.js";

// ═══════════════════════════════════════════════════════════════
// Conciliación bancaria · cuatro estados (2026-10)
//
//  · conciliado ... la línea del banco corresponde a registros BFK con evidencia además del monto
//                   (RUT o nombre del cliente en la glosa, persona en la glosa con fecha cercana, o todos los
//                   registros de esa persona en la fecha suman exacto).
//  · posible ...... hay registros BFK que podrían corresponder (mismo monto, o la persona tiene registros
//                   agrupados cerca), pero sin evidencia suficiente: se muestra, no se asigna nada.
//  · pendiente .... no hay registro BFK: queda visible.
//  · neutro ....... abono y cargo del mismo monto, el mismo día y con la misma contraparte (se anulan).
//
// Reglas:
//  · Cada registro BFK se usa para UNA sola línea bancaria (nunca dos transferencias con el mismo registro).
//  · Solo se comparan registros que pasaron por el banco (cobros en caja, gastos con cargo, aportes con movimiento):
//    lo registrado fuera de BancoEstado nunca se trata como error ni se usa para conciliar.
//  · Nada se preselecciona. Hasta la fecha de cierre (07/10/2026) nada es registrable desde la cartola: lo anterior
//    ya está en los saldos y FIFO históricos. Después del cierre solo se propone registrar lo PENDIENTE.
//  · Funciones puras: no modifican los datos de entrada ni escriben nada.
//
// Simplificación 21/10/2026 (sin duplicaciones):
//  · Certeza primero: un registro creado desde la cartola lleva la marca del movimiento (marca_cartola) y una
//    decisión confirmada por el usuario (conciliacion_decisiones, «es este registro») vincula sin tocar el registro.
//    Esos movimientos quedan «Ya registrado» y sus registros no se usan para ningún otro movimiento.
//  · «No corresponde»: el registro rechazado deja de proponerse para ESE movimiento.
//  · Un mismo monto y fecha no bastan: dos movimientos o dos registros iguales nunca se dan por duplicados.
// ═══════════════════════════════════════════════════════════════

export const CIERRE_CONCILIACION = "2026-10-07";
export const ESTADOS = {
  conciliado: "Ya registrado",
  posible: "Por revisar",
  pendiente: "Sin registrar",
  neutro: "Se compensa",
};

// Tabla de la base de cada tipo de registro (para decisiones de conciliación).
export const TABLA_REGISTRO = { cobro: "eventos_pago_cliente", pago_financiador: "eventos_pago_financiamiento", pago_vendedor: "pagos_vendedor",
  gasto: "gastos_indirectos", aporte_capital: "aportes_socios", retiro_capital: "aportes_socios", compra: "eventos_compra" };
export const CATEGORIA_IMPUESTO_SII = "cat_impuesto";
export const claveRegistro = (r) => `${r.tabla || TABLA_REGISTRO[r.tipo]}:${r.id}`;

// Marca del movimiento: cart:AAAAMMDD:cargo:abono:saldo:ocurrencia. La ocurrencia distingue dos líneas idénticas
// (mismo día, monto y saldo), que al unir cartolas se conservan las dos. Es la misma al volver a cargar la cartola.
export function marcaCartola(movs, i) {
  const m = movs?.[i];
  if (!m) return null;
  const clave = m.clave || `${m.fecha}|${m.cargo}|${m.abono}|${m.saldo}`;
  const ocurrencia = movs.slice(0, i).filter((x) => (x.clave || `${x.fecha}|${x.cargo}|${x.abono}|${x.saldo}`) === clave).length + 1;
  return `cart:${String(m.fecha).replace(/-/g, "")}:${Number(m.cargo) || 0}:${Number(m.abono) || 0}:${Number(m.saldo)}:${ocurrencia}`;
}

const dias = (a, b) => Math.round((Date.parse(String(a).slice(0, 10)) - Date.parse(String(b).slice(0, 10))) / 86400000);
const norm = (s) => String(s || "").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const soloRut = (s) => norm(s).replace(/[^0-9K]/g, "").replace(/K$/, "");
const f10 = (v) => (v ? String(v).slice(0, 10) : "");
// Palabras de instituciones que no identifican a un cliente por sí solas.
const GENERICAS = new Set(["ILUSTRE", "MUNICIPALIDAD", "MUNIC", "SERVICIO", "SERVICIOS", "DEPARTAMENTO", "DELEGACION", "PRESIDENCIAL", "PROVINCIAL",
  "REGIONAL", "GOBIERNO", "CORPORACION", "HOSPITAL", "UNIVERSIDAD", "DIRECCION", "EDUCACION", "FONDOS", "MUNICIPAL", "NACIONAL", "SALUD", "GENERAL",
  "BIENESTAR", "SOCIAL", "ABASTECIMIENTO", "EJERCITO", "ARMADA", "CARABINEROS", "MINISTERIO", "SUBSECRETARIA", "PUBLICA", "PUBLICAS", "OBRAS",
  "LOGISTICA", "DIVISION", "COMANDO", "ZONA", "CHILE"]);

// Personas que pueden aparecer en una glosa: financiadores externos y vendedores (clave = primer nombre).
function personasDe(financiadores, vendedores) {
  const m = new Map();
  for (const p of [...(financiadores || []).filter((f) => f.tipo !== "propio"), ...(vendedores || [])]) {
    const clave = norm(p.nombre).split(/\s+/)[0];
    if (clave && !m.has(clave)) m.set(clave, norm(p.nombre).split(/[^A-Z]+/).filter((t) => t.length >= 4));
  }
  return [...m].map(([clave, tokens]) => ({ clave, tokens }));
}

// Universo de registros BFK que pasaron por la cuenta, con dirección (entra/sale) y persona cuando aplica.
export function registrosBancarios({ ocs, financiadores, vendedores, gastos, pagosVendedor, pagoFinSueltos, aportes }) {
  const personas = personasDe(financiadores, vendedores);
  const personaTexto = (t) => { const T = norm(t); const p = personas.filter((x) => T.includes(x.clave)); return p.length === 1 ? p[0].clave : null; };
  const primer = (nombre) => norm(nombre).split(/\s+/)[0] || null;
  const finP = Object.fromEntries((financiadores || []).map((f) => [f.id, f.tipo === "propio" ? null : primer(f.nombre)]));
  const propio = new Set((financiadores || []).filter((f) => f.tipo === "propio").map((f) => f.id));
  const venP = Object.fromEntries((vendedores || []).map((v) => [v.id, primer(v.nombre)]));
  const R = [];
  for (const o of ocs || []) {
    if (o.archivada) continue;
    for (const e of o.eventos_pago_cliente || []) if (cobroEnCaja(e))
      R.push({ id: e.id, dir: "entra", tipo: "cobro", fecha: f10(e.fecha), monto: Number(e.monto) || 0, rut: soloRut(o.rut_cliente), cliente: norm(o.cliente), clienteNombre: o.cliente || "", oc: o.numero_oc, ocId: o.id, nota: e.notas || "", marca: e.marca_cartola || null });
    // Compra pagada con fondos propios (Cuenta BFK): sale del banco. Solo se usa como coincidencia POR REVISAR
    // (nunca se concilia sola) para que el cargo al proveedor no se registre como un gasto nuevo.
    for (const e of o.eventos_compra || []) if (propio.has(e.financiador_id || o.financiador_id))
      R.push({ id: e.id, dir: "sale", tipo: "compra", fecha: f10(e.fecha), monto: Number(e.costo_compra) || 0, persona: null, oc: o.numero_oc, ocId: o.id, nota: e.proveedor || "", marca: null });
    for (const e of o.eventos_pago_financiamiento || [])
      R.push({ id: e.id, dir: "sale", tipo: "pago_financiador", fecha: f10(e.fecha), monto: Number(e.monto) || 0, persona: finP[e.financiador_id || o.financiador_id] || null, oc: o.numero_oc, nota: e.notas || "", marca: e.marca_cartola || null });
  }
  for (const e of pagoFinSueltos || []) R.push({ id: e.id, dir: "sale", tipo: "pago_financiador", fecha: f10(e.fecha), monto: Number(e.monto) || 0, persona: finP[e.financiador_id] || null, nota: e.notas || "", marca: e.marca_cartola || null });
  for (const p of pagosVendedor || []) if (pagoVigente(p))
    R.push({ id: p.id, dir: "sale", tipo: "pago_vendedor", fecha: f10(p.fecha), monto: totalTransferido(p), persona: venP[p.vendedor_id] || null, nota: p.notas || "", marca: p.marca_cartola || null });
  for (const g of gastos || []) if (gastoEnCaja(g))
    R.push({ id: g.id, dir: "sale", tipo: "gasto", fecha: f10(g.fecha), monto: Number(g.monto) || 0, persona: personaTexto(g.detalle), cat: g.categoria_id, nota: g.detalle || "", marca: g.marca_cartola || null });
  for (const a of aportes || []) if (aporteEnCaja(a))
    R.push({ id: a.id, dir: a.tipo === "retiro" ? "sale" : "entra", tipo: a.tipo === "retiro" ? "retiro_capital" : "aporte_capital", fecha: f10(a.fecha), monto: Number(a.monto) || 0, persona: personaTexto(a.socio), nota: a.notas || a.socio || "", marca: a.marca_cartola || null });
  return R.filter((r) => r.fecha && r.monto > 0).map((r) => ({ ...r, tabla: TABLA_REGISTRO[r.tipo] }));
}

// Concilia las líneas bancarias (ya unidas y deduplicadas) contra los datos de BFK.
export function conciliarMovimientos(movs, datos, { cierre = CIERRE_CONCILIACION } = {}) {
  const personas = personasDe(datos.financiadores, datos.vendedores);
  const personaGlosa = (g) => {
    const G = norm(g);
    const p = personas.map((x) => ({ x, n: x.tokens.filter((t) => G.includes(t)).length })).filter((y) => y.n >= 2).sort((a, b) => b.n - a.n);
    return p.length === 1 || (p[0] && p[0].n > (p[1]?.n || 0)) ? p[0].x.clave : null;
  };
  const banco = registrosBancarios(datos);
  const usados = new Set();
  const libre0 = (r) => !usados.has(r.id);
  const fechaEnNota = (r, f) => { const [y, mo, da] = f.split("-"); return r.nota.includes(`${da}/${mo}/${y}`); };
  const res = (movs || []).map((m, i) => ({ i, m, marca: marcaCartola(movs, i), dir: m.abono > 0 ? "entra" : "sale", monto: m.abono || m.cargo, estado: "pendiente", evidencia: [], registros: [], nota: "" }));
  const tomar = (x, regs, estado, ev, nota = "") => { regs.forEach((r) => usados.add(r.id)); Object.assign(x, { estado, registros: regs, evidencia: ev, nota }); };

  // Pasada 0 (certeza): registros con la marca del movimiento y vínculos confirmados por el usuario.
  const decisiones = (datos.decisiones || []).filter((d) => !d.anulado_en);
  const porMarca = new Map(res.map((x) => [x.marca, x]));
  const rechazos = new Map();
  for (const d of decisiones.filter((d) => d.decision === "rechazado")) (rechazos.get(d.marca) || rechazos.set(d.marca, new Set()).get(d.marca)).add(`${d.tabla}:${d.registro_id}`);
  const libreX = (x) => (r) => libre0(r) && !rechazos.get(x.marca)?.has(claveRegistro(r));
  const conMarca = new Map();
  for (const r of banco.filter((r) => r.marca)) (conMarca.get(r.marca) || conMarca.set(r.marca, []).get(r.marca)).push(r);
  for (const [marca, regs] of conMarca) {
    regs.forEach((r) => usados.add(r.id));   // un registro con marca pertenece a SU movimiento, nunca a otro
    const x = porMarca.get(marca);
    if (x && x.estado === "pendiente") Object.assign(x, { estado: "conciliado", registros: regs, evidencia: ["registrado desde la cartola"], origen: "cartola" });
  }
  const vinculos = new Map();
  for (const d of decisiones.filter((d) => d.decision === "vinculado")) (vinculos.get(d.marca) || vinculos.set(d.marca, []).get(d.marca)).push(d);
  for (const [marca, ds] of vinculos) {
    const claves = new Set(ds.map((d) => `${d.tabla}:${d.registro_id}`));
    const regs = banco.filter((r) => claves.has(claveRegistro(r)));
    regs.forEach((r) => usados.add(r.id));
    const x = porMarca.get(marca);
    if (!x || x.estado !== "pendiente") continue;
    if (regs.length === claves.size) Object.assign(x, { estado: "conciliado", registros: regs, evidencia: ["vínculo confirmado"], origen: "decision", decisiones: ds,
      nota: `confirmado por ${ds[0].usuario_nombre || "un usuario"}${ds[0].creado_en ? ` el ${String(ds[0].creado_en).slice(8, 10)}/${String(ds[0].creado_en).slice(5, 7)}` : ""}` });
    else x.vinculoRoto = ds;   // el registro vinculado ya no existe o fue anulado: se vuelve a revisar
  }

  // Pasada 1: correspondencias con evidencia además del monto.
  for (const x of res.filter((y) => y.estado === "pendiente")) {
    const libre = libreX(x);
    const m = x.m, P = personaGlosa(m.descripcion), ruts = (norm(m.descripcion).match(/\d{7,8}-?[\dK]/g) || []).map(soloRut);
    if (x.dir === "entra") {
      const c = banco.filter((r) => libre(r) && r.dir === "entra" && r.monto === x.monto);
      const ev = (r) => [Math.abs(dias(m.fecha, r.fecha)) <= 3 && "fecha ±3 días", r.rut && ruts.includes(r.rut) && "RUT del cliente en la glosa",
        r.cliente && r.cliente.split(/[^A-Z]+/).some((w) => w.length >= 5 && !GENERICAS.has(w) && norm(m.descripcion).includes(w)) && "nombre del cliente en la glosa",
        fechaEnNota(r, m.fecha) && "la nota del registro cita esta fecha bancaria", P && r.persona === P && "persona en la glosa"].filter(Boolean);
      const fuertes = c.map((r) => ({ r, e: ev(r) })).filter((y) => y.e.length);
      if (fuertes.length === 1) { tomar(x, [fuertes[0].r], "conciliado", ["monto exacto", ...fuertes[0].e]); continue; }
      for (const rut of ruts) {
        const g = banco.filter((r) => libre(r) && r.dir === "entra" && r.rut === rut && Math.abs(dias(m.fecha, r.fecha)) <= 150);
        if (g.length > 1 && g.reduce((a, r) => a + r.monto, 0) === x.monto) { tomar(x, g, "conciliado", ["RUT del pagador", `suma exacta de ${g.length} cobros`]); break; }
      }
    } else if (P) {
      const u = banco.filter((r) => libre(r) && r.dir === "sale" && r.persona === P && r.monto === x.monto && Math.abs(dias(r.fecha, m.fecha)) <= 3);
      if (u.length === 1) { tomar(x, u, "conciliado", ["persona en la glosa", "monto exacto", "fecha ±3 días"]); continue; }
      // Pagos agrupados: TODOS los registros de la persona en la ventana [−5, +1] días deben sumar exacto (sin subconjuntos).
      const g = banco.filter((r) => libre(r) && r.dir === "sale" && r.persona === P && dias(r.fecha, m.fecha) >= -5 && dias(r.fecha, m.fecha) <= 1);
      if (g.length && g.reduce((a, r) => a + r.monto, 0) === x.monto)
        tomar(x, g, "conciliado", ["persona en la glosa", g.length > 1 ? `todos sus registros de la fecha suman exacto (${g.length})` : "registro único de la persona", "fecha −5/+1"]);
    } else {
      // Una compra con fondos propios nunca concilia sola, pero sí impide dar por único a otro registro del mismo monto.
      const g = banco.filter((r) => libre(r) && r.dir === "sale" && r.monto === x.monto && Math.abs(dias(r.fecha, m.fecha)) <= 3);
      if (g.length === 1 && g[0].tipo !== "compra") { tomar(x, g, "conciliado", ["monto exacto", "fecha ±3 días", "registro único"]); continue; }
      // Pago al SII (F29): IVA y PPM registrados como gastos «Impuesto SII» que juntos suman el cargo. Una sola
      // combinación posible → ya registrado; varias → por revisar (pasada 2). Nunca se propone un gasto nuevo.
      if (!g.length) {
        const imp = banco.filter((r) => libre(r) && r.tipo === "gasto" && r.cat === CATEGORIA_IMPUESTO_SII && Math.abs(dias(r.fecha, m.fecha)) <= 5 && r.monto < x.monto);
        const sub = subconjuntosExactos(imp, x.monto, 4);
        if (sub.length === 1) tomar(x, sub[0], "conciliado", ["pago al SII", `${sub[0].length} gastos «Impuesto SII» suman exacto`, "fecha ±5 días"]);
        else if (sub.length > 1) x.siiAmbiguo = sub[0];
      }
    }
  }
  // Pasada 2: coincidencias sin respaldo suficiente (posible) o nada (pendiente).
  for (const x of res.filter((y) => y.estado === "pendiente")) {
    const libre = libreX(x);
    const m = x.m, P = personaGlosa(m.descripcion);
    const c = banco.filter((r) => libre(r) && r.dir === x.dir && r.monto === x.monto && dias(m.fecha, r.fecha) >= -45 && dias(m.fecha, r.fecha) <= 150 && (!P || !r.persona || r.persona === P));
    if (c.length) {
      Object.assign(x, { estado: "posible", evidencia: ["solo monto"], candidatos: c.slice(0, 5), nota: `${c.length} registro(s) del mismo monto` });
      if (c.length === 1) usados.add(c[0].id);
      continue;
    }
    if (x.dir === "entra") {
      const porCliente = {};
      for (const r of banco.filter((r) => libre(r) && r.dir === "entra" && r.cliente && dias(m.fecha, r.fecha) >= -45 && dias(m.fecha, r.fecha) <= 150)) (porCliente[r.cliente] ||= []).push(r);
      const sub = (l) => { for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) { if (l[i].monto + l[j].monto === x.monto) return [l[i], l[j]];
        for (let k = j + 1; k < l.length; k++) if (l[i].monto + l[j].monto + l[k].monto === x.monto) return [l[i], l[j], l[k]]; } return null; };
      const g = Object.values(porCliente).map(sub).find(Boolean);
      if (g) { Object.assign(x, { estado: "posible", evidencia: ["suma exacta de cobros de un mismo cliente", "sin RUT ni documento"], candidatos: g, nota: g.map((r) => r.oc).join(" + ") }); continue; }
    }
    if (x.siiAmbiguo) { Object.assign(x, { estado: "posible", evidencia: ["suma exacta de gastos sin persona identificada"], candidatos: x.siiAmbiguo, nota: "más de una combinación de gastos «Impuesto SII» suma este monto" }); continue; }
    if (x.dir === "sale" && !P) {
      const antes = m.fecha <= cierre ? -120 : -10;
      const l = banco.filter((r) => libre(r) && r.tipo === "gasto" && dias(r.fecha, m.fecha) >= antes && dias(r.fecha, m.fecha) <= 5 && r.monto < x.monto);
      let hit = null;
      const busca = (i, acc, sel) => { if (hit || sel.length > 4) return; if (acc === x.monto && sel.length > 1) { hit = sel; return; }
        for (let k = i; k < l.length && !hit; k++) if (acc + l[k].monto <= x.monto) busca(k + 1, acc + l[k].monto, [...sel, l[k]]); };
      busca(0, 0, []);
      if (hit) { Object.assign(x, { estado: "posible", evidencia: ["suma exacta de gastos sin persona identificada", "sin documento"], candidatos: hit, nota: hit.map((r) => `${r.cat} ${r.fecha}`).join(" + ") }); continue; }
    }
    if (P && m.fecha <= cierre) {
      const g = banco.filter((r) => libre(r) && r.dir === x.dir && r.persona === P && Math.abs(dias(r.fecha, m.fecha)) <= 45);
      if (g.length) Object.assign(x, { estado: "posible", evidencia: ["persona", "registros cercanos que no suman exacto"], nota: `registrado en forma agregada: ${g.length} registro(s) de la misma persona` });
    }
  }
  // Neutro: abono y cargo del mismo monto, mismo día y misma contraparte, ambos sin registro.
  for (const a of res.filter((x) => x.estado === "pendiente" && x.dir === "entra")) {
    const b = res.find((x) => x.estado === "pendiente" && x.dir === "sale" && x.monto === a.monto && x.m.fecha === a.m.fecha
      && norm(x.m.descripcion).split(/\s+/).filter((w) => w.length >= 6).some((w) => norm(a.m.descripcion).includes(w)));
    if (b) { a.estado = b.estado = "neutro"; a.nota = b.nota = "abono y cargo compensados el mismo día"; }
  }
  for (const x of res) { x.anteriorCierre = x.m.fecha <= cierre; x.registrable = x.estado === "pendiente" && !x.anteriorCierre && !x.vinculoRoto; x.preseleccionado = false; }
  // Pistas (solo informativas, nunca deciden): movimiento igual el mismo día (dos operaciones legítimas, no un
  // duplicado) y depósito que coincide con un vale vista o cheque recibido y aún no marcado como cobrado.
  const vales = (datos.ocs || []).filter((o) => !o.archivada).flatMap((o) => (o.eventos_pago_cliente || []).filter(esValeVistaPendiente).map((e) => ({ e, o })));
  for (const x of res) {
    const gemelos = res.filter((y) => y !== x && y.dir === x.dir && y.monto === x.monto && y.m.fecha === x.m.fecha);
    if (gemelos.length) x.gemelos = gemelos.map((y) => y.m.operacion || "").filter(Boolean);
    if (x.estado === "pendiente" && x.dir === "entra") {
      const vv = vales.filter(({ e }) => Number(e.monto) === x.monto && dias(x.m.fecha, f10(e.fecha)) >= -5 && dias(x.m.fecha, f10(e.fecha)) <= 90);
      if (vv.length) x.valeVista = vv.map(({ e, o }) => ({ id: e.id, oc: o.numero_oc, ocId: o.id, fecha: f10(e.fecha), monto: Number(e.monto), medio: e.medio_pago }));
    }
  }
  // Registrado en BFK, pendiente de verificar en banco: registros posteriores al cierre que ninguna línea bancaria
  // explica (no se llaman duplicados: se explica el posible motivo con pistaSinLinea).
  const desde = res.length ? res[0].m.fecha : null, hasta = res.length ? res[res.length - 1].m.fecha : null;
  const sinLinea = banco.filter((r) => r.fecha > cierre && desde && r.fecha >= desde && r.fecha <= hasta && !usados.has(r.id)
    && !res.some((x) => (x.candidatos || []).some((c) => c.id === r.id)));
  for (const r of sinLinea) r.pista = pistaSinLinea(r, res, datos);
  return { movimientos: res, usados, sinLinea, resumen: resumirEstados(res) };
}

// Subconjuntos (2..max registros) que suman exacto; corta en 3 resultados (basta saber si hay uno o varios).
function subconjuntosExactos(l, monto, max) {
  const out = [];
  const busca = (i, acc, sel) => { if (out.length >= 3) return; if (acc === monto && sel.length > 1) { out.push(sel); return; } if (sel.length >= max) return;
    for (let k = i; k < l.length && out.length < 3; k++) if (acc + l[k].monto <= monto) busca(k + 1, acc + l[k].monto, [...sel, l[k]]); };
  busca(0, 0, []);
  return out;
}

export function resumirEstados(res) {
  const r = {};
  for (const dir of ["entra", "sale"]) for (const e of Object.keys(ESTADOS)) {
    const l = res.filter((x) => x.dir === dir && x.estado === e);
    r[`${dir}_${e}`] = { n: l.length, monto: l.reduce((s, x) => s + x.monto, 0) };
  }
  return r;
}

// Por qué un registro BFK no tiene movimiento bancario en esta cartola (solo explica; nunca lo llama duplicado).
//  · cobro pagado junto con otras facturas del mismo cliente: un abono sin registrar del mismo cliente (RUT o nombre
//    en el detalle) o cuyo monto = este cobro + saldo de 1 o 2 facturas pendientes del mismo RUT;
//  · abono del mismo cliente con otro monto;
//  · si nada calza: no aparece con ese monto (puede no haberse acreditado aún, o haberse pagado de otra forma).
export function pistaSinLinea(r, res, datos) {
  const libres = res.filter((x) => x.estado === "pendiente" && x.dir === r.dir);
  if (r.tipo === "cobro") {
    const otras = (datos.ocs || []).filter((o) => !o.archivada && o.id !== r.ocId && r.rut && soloRut(o.rut_cliente) === r.rut)
      .map((o) => ({ oc: o.numero_oc, saldo: Math.max(0, (Number(o.monto_facturado) || 0) - (Number(o.monto_cobrado) || 0)) })).filter((o) => o.saldo > 0);
    const combos = [...otras.map((o) => [o]), ...otras.flatMap((a, i) => otras.slice(i + 1).map((b) => [a, b]))];
    for (const x of libres) {
      const c = combos.find((k) => r.monto + k.reduce((s, o) => s + o.saldo, 0) === x.monto);
      if (c) return { tipo: "agrupado", mov: x.i, monto: x.monto, fecha: x.m.fecha, otras: c,
        texto: `El banco muestra un abono de ${pesos(x.monto)} el ${dmy(x.m.fecha)} = este cobro + ${c.map((o) => `${o.oc} (${pesos(o.saldo)} pendiente)`).join(" + ")}: puede ser un pago conjunto. Revisa ese abono.` };
    }
    const palabras = String(r.cliente || "").split(/[^A-Z]+/).filter((w) => w.length >= 5 && !GENERICAS.has(w));
    const mismo = libres.find((x) => { const G = norm(x.m.descripcion); return (r.rut && (G.match(/\d{7,8}-?[\dK]/g) || []).map(soloRut).includes(r.rut)) || palabras.some((w) => G.includes(w)); });
    if (mismo) return { tipo: "mismo_cliente", mov: mismo.i, monto: mismo.monto, fecha: mismo.m.fecha,
      texto: `Hay un abono sin registrar del mismo cliente por ${pesos(mismo.monto)} el ${dmy(mismo.m.fecha)} (monto distinto). Revisa si corresponde a este cobro.` };
  }
  return { tipo: "sin_movimiento", texto: `No aparece en esta cartola un ${r.dir === "entra" ? "abono" : "cargo"} de ${pesos(r.monto)} cercano a esa fecha. Puede no haberse acreditado aún, tener otra fecha u otro monto. No es necesariamente un duplicado.` };
}
const pesos = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("es-CL");
const dmy = (f) => { const [y, m, d] = String(f).slice(0, 10).split("-"); return `${d}/${m}/${y}`; };

// Opciones para registrar un ABONO pendiente posterior al cierre: las del calce de facturas, SIN preselección y sin
// facturas emitidas después del abono (un pago no puede ser anterior a su factura vigente).
export function opcionesAbono(mov, ocs) {
  const item = calzarAbonos([mov], ocs || [], [])[0];
  if (!item) return [];
  const fechaFactura = (ocId) => { const o = (ocs || []).find((x) => x.id === ocId); return f10(facturaVigente(o)?.fecha); };
  return item.opciones.filter((op) => op.tipo === "vale_vista" || (op.asignaciones || []).every((a) => { const ff = fechaFactura(a.ocId); return ff && ff <= mov.fecha; }));
}
