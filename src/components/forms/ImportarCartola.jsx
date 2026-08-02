import { useState } from "react";
import * as XLSX from "xlsx";
import { C, MONO, SANS, btnP, btnG, fmt } from "../../lib/theme";

const aNumero = (v) => {
  if (v === null || v === undefined) return 0;
  const s = String(v).replace(/\$/g, "").replace(/\./g, "").replace(/,/g, "").trim();
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};
const soloDigitos = (s) => String(s || "").replace(/[^0-9kK]/g, "").toUpperCase();

// ── Lectura de cartolas de BancoEstado ──────────────────────
// Vienen en dos formatos:
//  · "Cartola en Línea"  → hoja Registros,   fecha completa (20/07/2026)
//  · "Cartola Histórica" → hoja Movimientos, fecha sin año (15/07)
export function leerCartola(workbook) {
  const movimientos = [];

  // ── Formato en línea ──
  const registros = workbook.Sheets["Registros"];
  if (registros) {
    const filas = XLSX.utils.sheet_to_json(registros, { header: 1 });
    for (let i = 1; i < filas.length; i++) {
      const f = filas[i];
      if (!f || !f[0]) continue;
      const p = String(f[0]).split("/");
      if (p.length < 3) continue;
      movimientos.push({
        fecha: `${p[2]}-${p[1].padStart(2, "0")}-${p[0].padStart(2, "0")}`,
        descripcion: String(f[3] || "").trim(),
        cargo: aNumero(f[4]),
        abono: aNumero(f[5]),
        saldo: aNumero(f[6]),
      });
    }
    return movimientos;
  }

  // ── Formato histórico ──
  const hoja = workbook.Sheets["Movimientos"];
  if (!hoja) return movimientos;

  let anioIni = null, anioFin = null, mesIni = null;
  const resumen = workbook.Sheets["Resumen"];
  if (resumen) {
    for (const f of XLSX.utils.sheet_to_json(resumen, { header: 1 })) {
      const k = String(f[0] || ""), v = String(f[4] || "");
      if (k === "Fecha Inicio" && v.includes("/")) { const p = v.split("/"); mesIni = Number(p[1]); anioIni = Number(p[2]); }
      if (k === "Fecha Final" && v.includes("/")) anioFin = Number(v.split("/")[2]);
    }
  }

  for (const f of XLSX.utils.sheet_to_json(hoja, { header: 1 }).slice(1)) {
    if (!f || !f[0]) continue;
    const p = String(f[0]).split("/");
    if (p.length < 2) continue;
    const dia = Number(p[0]), mes = Number(p[1]);
    const anio = (anioIni === anioFin || !anioFin) ? anioIni : (mes >= mesIni ? anioIni : anioFin);
    if (!anio) continue;
    movimientos.push({
      fecha: `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`,
      descripcion: String(f[6] || "").trim(),
      cargo: aNumero(f[7]),
      abono: aNumero(f[8]),
    });
  }
  return movimientos;
}

// ── Puntaje de coincidencia entre un abono y una factura ────
// El monto siempre debe calzar. El RUT y el nombre desempatan.
function puntuar(abono, oc) {
  let puntos = 0;
  const desc = abono.descripcion.toUpperCase();

  const rutOC = soloDigitos(oc.rut_cliente);
  if (rutOC.length > 6) {
    const rutsEnDesc = (desc.match(/\d{7,9}\s*-?\s*[0-9K]/g) || []).map(soloDigitos);
    if (rutsEnDesc.some(r => r === rutOC)) puntos += 100;
  }

  // Palabras distintivas del cliente que aparezcan en la descripción
  const ignorar = new Set(["ILUSTRE", "MUNICIPALIDAD", "MUNIC", "DE", "DEL", "LA", "EL", "SERVICIO", "SALUD", "DEPARTAMENTO"]);
  const palabras = String(oc.cliente || "").toUpperCase().split(/[^A-ZÁÉÍÓÚÑ]+/)
    .filter(p => p.length >= 5 && !ignorar.has(p));
  if (palabras.some(p => desc.includes(p))) puntos += 40;

  // Cercanía con la fecha de la factura: lo normal es cobrar después de emitir
  const evF = (oc.eventos_factura || [])[0];
  if (evF?.fecha) {
    const dias = (new Date(abono.fecha) - new Date(String(evF.fecha).slice(0, 10))) / 86400000;
    if (dias >= 0 && dias <= 90) puntos += 10;
    if (dias < 0) puntos -= 50;   // un cobro anterior a la factura es improbable
  }
  return puntos;
}

// ── Clasificación de un cargo (plata que sale) ──────────────
// Compara el texto del banco con los nombres de financiadores y
// vendedores. Exige al menos dos palabras en común para no
// confundir, por ejemplo, a Byron Vegas con Matías Vegas.
const PALABRAS_IGNORADAS = new Set(["TEF", "BANCOESTADO", "RUT", "PAGO", "PAGOS", "GIRO", "CAJERO"]);

function coincidencias(nombre, descripcion) {
  const desc = descripcion.toUpperCase();
  const palabras = String(nombre || "").toUpperCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .split(/[^A-Z]+/).filter(p => p.length >= 4 && !PALABRAS_IGNORADAS.has(p));
  const descSinTilde = desc.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return palabras.filter(p => descSinTilde.includes(p)).length;
}

export function clasificarCargo(mov, financiadores, vendedores) {
  const desc = mov.descripcion.toUpperCase();

  let mejorFin = null, puntosFin = 0;
  for (const f of financiadores || []) {
    const n = coincidencias(f.nombre, desc);
    if (n > puntosFin) { puntosFin = n; mejorFin = f; }
  }
  let mejorVen = null, puntosVen = 0;
  for (const v of vendedores || []) {
    const n = coincidencias(v.nombre, desc);
    if (n > puntosVen) { puntosVen = n; mejorVen = v; }
  }

  // Si la persona figura como financista Y como vendedor, no se puede
  // saber si el pago es devolución o comisión: queda para revisión.
  if (puntosFin >= 2 && puntosVen >= 2)
    return { tipo: "vendedor", destinoId: mejorVen.id, nombre: mejorVen.nombre, seguro: false };

  // Dos o más palabras en común es una coincidencia confiable
  if (puntosFin >= 2)
    return { tipo: "financiador", destinoId: mejorFin.id, nombre: mejorFin.nombre, seguro: true };
  if (puntosVen >= 2)
    return { tipo: "vendedor", destinoId: mejorVen.id, nombre: mejorVen.nombre, seguro: true };

  if (/COMISION|IMPUESTO|MANTENCION|CARGO POR/.test(desc))
    return { tipo: "gasto", categoriaId: "cat_otros", nombre: "Comisión bancaria", seguro: true };

  return { tipo: "gasto", categoriaId: "cat_otros", nombre: "Por clasificar", seguro: false };
}

// ── Detección de movimientos ya registrados ────────────────
// Compara fecha y monto contra lo que ya existe en la base para
// no volver a cargar un pago que ya está. Acepta una holgura de
// unos días, porque la fecha contable no siempre calza con la
// del banco.
function yaRegistrado(mov, registrados, tolerancia = 3) {
  const monto = Number(mov.cargo || mov.abono);
  const f = new Date(mov.fecha).getTime();
  const cerca = (r) => Math.abs(new Date(r.fecha).getTime() - f) <= tolerancia * 86400000;

  // 1) Un movimiento registrado con el mismo monto
  const exacto = registrados.find(r => Number(r.monto) === monto && cerca(r));
  if (exacto) return exacto;

  // 2) Un abono repartido entre varias OCs no deja un evento por el
  //    total, sino varios fragmentos. Sumamos lo registrado de ese
  //    día por cada destino: si ya cubre el monto, está registrado.
  const porDestino = {};
  for (const r of registrados) {
    if (!cerca(r)) continue;
    const k = r.destino || "sin_destino";
    porDestino[k] = (porDestino[k] || 0) + Number(r.monto || 0);
  }
  for (const [destino, total] of Object.entries(porDestino)) {
    if (Math.abs(total - monto) <= 1) {
      return { fecha: mov.fecha, monto, destino, agrupado: true };
    }
  }
  return null;
}

// Los movimientos anteriores a esta fecha ya estaban contabilizados
// en la planilla, así que no deben cargarse: duplicarían los saldos.
const CORTE_EGRESOS = "2026-08-01";

export function ImportarCartola({ ocs, financiadores, vendedores, categorias, registrados = [], onRegistrar, onRegistrarEgresos }) {
  const [movs, setMovs] = useState([]);
  const [items, setItems] = useState([]);      // un item por abono con calce posible
  const [elegido, setElegido] = useState({});  // idx -> ocId seleccionado ("" = ninguno)
  const [egresos, setEgresos] = useState([]);   // cargos clasificados
  const [vista, setVista] = useState("cobros"); // cobros | egresos
  const [leyendo, setLeyendo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [err, setErr] = useState("");

  const procesar = async (files) => {
    if (!files?.length) return;
    setLeyendo(true); setErr("");
    try {
      let todos = [];
      for (const file of files) {
        const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
        todos = todos.concat(leerCartola(wb));
      }
      const vistos = new Set();
      const unicos = todos.filter(m => {
        const k = `${m.fecha}|${m.descripcion}|${m.abono}|${m.cargo}`;
        if (vistos.has(k)) return false;
        vistos.add(k); return true;
      }).sort((a, b) => a.fecha.localeCompare(b.fecha));
      setMovs(unicos);
      calzar(unicos);
      setEgresos(unicos.filter(m => m.cargo > 0).map(m => {
        const c = clasificarCargo(m, financiadores, vendedores);
        const dup = yaRegistrado(m, registrados);
        const antiguo = m.fecha < CORTE_EGRESOS;
        return { mov: m, ...c, duplicado: dup || null, antiguo,
                 incluir: (dup || antiguo) ? false : c.seguro };
      }));
    } catch (e) {
      setErr("No se pudo leer el archivo: " + e.message);
    } finally { setLeyendo(false); }
  };

  const calzar = (movimientos) => {
    const pendientes = ocs
      .filter(o => (o.tipo_registro || "venta") === "venta"
        && o.estado_factura_propia === "emitida"
        && o.estado_pago_cliente !== "pagado")
      .map(o => ({ oc: o, saldo: (Number(o.monto_facturado) || 0) - (Number(o.monto_cobrado) || 0) }))
      .filter(x => x.saldo > 0);

    const resultado = [];
    const yaPropuestas = new Set();

    for (const mov of movimientos.filter(m => m.abono > 0)) {
      const candidatos = pendientes
        .filter(p => p.saldo === mov.abono && !yaPropuestas.has(p.oc.id))
        .map(p => ({ ...p, puntos: puntuar(mov, p.oc) }))
        .sort((a, b) => b.puntos - a.puntos);

      if (!candidatos.length) continue;
      if (yaRegistrado(mov, registrados)) continue;   // ese cobro ya está en la base

      const mejor = candidatos[0];
      const segundo = candidatos[1];
      // Es claro si hay un solo candidato, o si el primero saca ventaja
      const claro = candidatos.length === 1 || (mejor.puntos - (segundo?.puntos ?? 0)) >= 40;

      if (claro) yaPropuestas.add(mejor.oc.id);
      resultado.push({ mov, candidatos, sugerido: claro ? mejor.oc.id : "", claro });
    }

    setItems(resultado);
    setElegido(Object.fromEntries(resultado.map((r, i) => [i, r.sugerido])));
  };

  const registrar = async () => {
    const cobros = items
      .map((it, i) => ({ it, ocId: elegido[i] }))
      .filter(x => x.ocId)
      .map(({ it, ocId }) => {
        const c = it.candidatos.find(c => c.oc.id === ocId);
        return { ocId, numeroOc: c.oc.numero_oc, monto: c.saldo,
                 fecha: it.mov.fecha, descripcion: it.mov.descripcion };
      });
    if (!cobros.length) { setErr("No hay ningún cobro seleccionado"); return; }
    const ids = cobros.map(c => c.ocId);
    if (new Set(ids).size !== ids.length) { setErr("Hay una OC asignada a dos abonos distintos"); return; }
    setErr(""); setGuardando(true);
    try { await onRegistrar(cobros, resumenCartola()); }
    catch (e) { setErr(e.message); setGuardando(false); }
  };

  const registrarEgresos = async () => {
    const sel = egresos.filter(e => e.incluir);
    if (!sel.length) { setErr("No hay ningún egreso marcado"); return; }
    if (sel.some(e => e.tipo !== "gasto" && !e.destinoId)) {
      setErr("Falta elegir el destino en alguno de los egresos"); return;
    }
    setErr(""); setGuardando(true);
    try {
      await onRegistrarEgresos(sel.map(e => ({
        tipo: e.tipo, destinoId: e.destinoId, categoriaId: e.categoriaId || "cat_otros",
        monto: e.mov.cargo, fecha: e.mov.fecha, descripcion: e.mov.descripcion,
      })), resumenCartola());
    } catch (er) { setErr(er.message); setGuardando(false); }
  };

  // Totales por mes: la base de la conciliación
  const totalesPorMes = () => {
    const meses = {};
    for (const m of movs) {
      const k = String(m.fecha).slice(0, 7);   // AAAA-MM
      if (!meses[k]) meses[k] = { entro: 0, salio: 0, saldo: null };
      meses[k].entro += m.abono || 0;
      meses[k].salio += m.cargo || 0;
      if (m.saldo != null) meses[k].saldo = m.saldo;   // el último del mes
    }
    return Object.entries(meses).map(([k, v]) => ({
      id: k, anio: Number(k.slice(0, 4)), mes: Number(k.slice(5, 7)),
      entro: v.entro, salio: v.salio, saldo_cierre: v.saldo,
    }));
  };

  // Datos de la cartola para dejar registro de qué se subió
  const resumenCartola = () => {
    if (!movs.length) return null;
    const ultimo = movs[movs.length - 1];
    return {
      desde: movs[0].fecha,
      hasta: ultimo.fecha,
      movimientos: movs.length,
      saldoFinal: ultimo.saldo ?? null,
      meses: totalesPorMes(),
    };
  };

  const nSel = Object.values(elegido).filter(Boolean).length;
  const totalSel = items.reduce((s, it, i) => {
    const c = it.candidatos.find(c => c.oc.id === elegido[i]);
    return s + (c ? c.saldo : 0);
  }, 0);

  if (!movs.length) {
    return (
      <div style={{ fontFamily: SANS }}>
        <div style={{ background: C.tealLight, borderRadius: 10, padding: "12px 14px", marginBottom: 16 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: C.tealDark, marginBottom: 5 }}>Cómo obtener la cartola</div>
          <div style={{ fontSize: 12, color: C.inkMuted, lineHeight: 1.55 }}>
            En BancoEstado Empresas descarga la Cartola en Línea o la Histórica de
            Chequera Electrónica. Lee ambos formatos y puedes subir varias a la vez.
          </div>
        </div>
        <label style={{ ...btnG, display: "block", textAlign: "center", cursor: "pointer", padding: "16px" }}>
          {leyendo ? "Leyendo…" : "📄 Elegir cartola(s)"}
          <input type="file" accept=".xlsx,.xls" multiple disabled={leyendo}
            onChange={e => procesar(Array.from(e.target.files || []))} style={{ display: "none" }} />
        </label>
        {err && <div style={{ background: C.dangerLight, color: C.danger, borderRadius: 8, padding: "8px 12px", fontSize: 12.5, marginTop: 12, fontWeight: 600 }}>{err}</div>}
        <div style={{ fontSize: 11.5, color: C.inkFaint, marginTop: 14, lineHeight: 1.5 }}>
          Los abonos se cruzan por monto, y el RUT o el nombre del pagador
          desempatan cuando hay varias facturas del mismo valor.
        </div>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: SANS }}>
      <div style={{ background: C.paper, borderRadius: 10, padding: "10px 13px", marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: C.inkMuted }}>
          {movs.length} movimientos · {fmt.date(movs[0].fecha)} a {fmt.date(movs[movs.length-1].fecha)}
        </div>
        {movs[movs.length-1].saldo != null && (
          <div style={{ fontSize: 12.5, color: C.ink, fontWeight: 700, marginTop: 3 }}>
            Saldo al cierre: <span style={{ fontFamily: MONO }}>{fmt.money(movs[movs.length-1].saldo)}</span>
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        {[
          { k: "cobros", t: `Entra · ${items.length}`, c: C.ok },
          { k: "egresos", t: `Sale · ${egresos.length}`, c: C.danger },
        ].map(b => (
          <button key={b.k} onClick={() => setVista(b.k)}
            style={{ flex: 1, padding: "8px", borderRadius: 9, cursor: "pointer", fontSize: 12, fontWeight: 700,
              border: `1.5px solid ${vista === b.k ? b.c : C.border}`,
              background: vista === b.k ? C.paper : C.card, color: vista === b.k ? b.c : C.inkMuted }}>
            {b.t}
          </button>
        ))}
      </div>

      {vista === "cobros" && (<>
      {items.length === 0 ? (
        <div style={{ textAlign: "center", padding: "24px 0", color: C.inkFaint, fontSize: 13 }}>
          Ningún abono calza con una factura pendiente
        </div>
      ) : (
        <>
          {items.map((it, i) => {
            const sel = elegido[i];
            return (
              <div key={i} style={{
                background: sel ? C.okLight : C.card,
                border: `1px solid ${sel ? C.ok : it.claro ? C.border : C.warn}`,
                borderRadius: 10, padding: "10px 12px", marginBottom: 7,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontSize: 11.5, color: C.inkMuted, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {fmt.date(it.mov.fecha)} · {it.mov.descripcion}
                  </span>
                  <span style={{ fontFamily: MONO, fontWeight: 800, fontSize: 12.5, color: C.ok, flexShrink: 0 }}>
                    {fmt.money(it.mov.abono)}
                  </span>
                </div>

                {!it.claro && (
                  <div style={{ fontSize: 10.5, color: C.warn, fontWeight: 700, margin: "5px 0 3px" }}>
                    ⚠ {it.candidatos.length} facturas de ese monto — elige cuál corresponde
                  </div>
                )}

                <select value={sel || ""} onChange={e => setElegido(m => ({ ...m, [i]: e.target.value }))}
                  style={{ width: "100%", marginTop: 6, padding: "7px 9px", borderRadius: 8, fontSize: 12,
                    border: `1px solid ${C.border}`, background: C.card, color: C.ink, fontFamily: SANS }}>
                  <option value="">— No registrar este abono —</option>
                  {it.candidatos.map(c => (
                    <option key={c.oc.id} value={c.oc.id}>
                      {c.oc.numero_oc}{c.oc.cliente ? ` · ${String(c.oc.cliente).slice(0, 28)}` : ""}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}

          {err && <div style={{ background: C.dangerLight, color: C.danger, borderRadius: 8, padding: "8px 12px", fontSize: 12.5, margin: "10px 0", fontWeight: 600 }}>{err}</div>}

          <button onClick={registrar} disabled={guardando || !nSel} style={{ ...btnP(guardando || !nSel ? C.inkFaint : C.ok), marginTop: 8 }}>
            {guardando ? "Registrando…" : `✓ Registrar ${nSel} cobro${nSel !== 1 ? "s" : ""} · ${fmt.money(totalSel)}`}
          </button>
        </>
      )}
      </>)}

      {vista === "egresos" && (
        egresos.length === 0 ? (
          <div style={{ textAlign: "center", padding: "24px 0", color: C.inkFaint, fontSize: 13 }}>
            No hay cargos en estas cartolas
          </div>
        ) : (
          <>
            {egresos.filter(e => e.antiguo).length > 0 && (
              <div style={{ background: C.warnLight, border: `1px solid ${C.warn}`, borderRadius: 9, padding: "10px 12px", marginBottom: 10, fontSize: 11.5, color: C.warn, fontWeight: 600, lineHeight: 1.45 }}>
                {egresos.filter(e => e.antiguo).length} movimiento(s) anteriores al {fmt.date(CORTE_EGRESOS)} vienen desmarcados.
                Los saldos de los financistas ya los incluyen — cargarlos los descuadraría.
              </div>
            )}
            {egresos.filter(e => e.duplicado).length > 0 && (
              <div style={{ background: C.infoLight, borderRadius: 9, padding: "9px 12px", marginBottom: 10, fontSize: 11.5, color: C.info, fontWeight: 600 }}>
                {egresos.filter(e => e.duplicado).length} movimiento(s) ya estaban registrados — vienen desmarcados
              </div>
            )}
            <div style={{ fontSize: 11.5, color: C.inkFaint, marginBottom: 10, lineHeight: 1.5 }}>
              Plata que salió de la cuenta. Las devoluciones a financistas se reparten
              entre sus OCs pendientes; el resto queda como gasto.
            </div>

            {egresos.map((e, i) => (
              <div key={i} style={{
                background: e.incluir ? C.card : C.paper,
                border: `1px solid ${e.incluir ? (e.seguro ? C.border : C.warn) : C.border}`,
                borderRadius: 10, padding: "10px 12px", marginBottom: 7, opacity: e.incluir ? 1 : 0.6,
              }}>
                <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer" }}>
                  <input type="checkbox" checked={e.incluir} style={{ marginTop: 3 }}
                    onChange={ev => setEgresos(l => l.map((x, ix) => ix === i ? { ...x, incluir: ev.target.checked } : x))} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 11.5, color: C.inkMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {fmt.date(e.mov.fecha)} · {e.mov.descripcion}
                    </span>
                    {e.antiguo ? (
                      <span style={{ display: "block", fontSize: 10.5, color: C.inkFaint, fontWeight: 600, marginTop: 2 }}>
                        Anterior al {fmt.date(CORTE_EGRESOS)} — ya está en los saldos históricos
                      </span>
                    ) : e.duplicado ? (
                      <span style={{ display: "block", fontSize: 10.5, color: C.info, fontWeight: 700, marginTop: 2 }}>
                        {e.duplicado.agrupado
                          ? "Ya registrado (repartido entre varias OCs) — no se volverá a cargar"
                          : `Ya registrado el ${fmt.date(String(e.duplicado.fecha).slice(0, 10))} — no se volverá a cargar`}
                      </span>
                    ) : !e.seguro && (
                      <span style={{ display: "block", fontSize: 10.5, color: C.warn, fontWeight: 700, marginTop: 2 }}>
                        ⚠ No se pudo identificar — revisa el destino
                      </span>
                    )}
                  </span>
                  <span style={{ fontFamily: MONO, fontWeight: 800, fontSize: 12.5, color: C.danger, flexShrink: 0 }}>
                    −{fmt.money(e.mov.cargo)}
                  </span>
                </label>

                {e.incluir && (
                  <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                    <select value={e.tipo}
                      onChange={ev => setEgresos(l => l.map((x, ix) => ix === i ? { ...x, tipo: ev.target.value, destinoId: "" } : x))}
                      style={{ flex: 1, padding: "6px 8px", borderRadius: 8, fontSize: 11.5, border: `1px solid ${C.border}`, background: C.card, color: C.ink, fontFamily: SANS }}>
                      <option value="financiador">Devolución a financista</option>
                      <option value="vendedor">Pago a vendedor</option>
                      <option value="gasto">Gasto</option>
                    </select>

                    {e.tipo === "gasto" ? (
                      <select value={e.categoriaId || "cat_otros"}
                        onChange={ev => setEgresos(l => l.map((x, ix) => ix === i ? { ...x, categoriaId: ev.target.value } : x))}
                        style={{ flex: 1, padding: "6px 8px", borderRadius: 8, fontSize: 11.5, border: `1px solid ${C.border}`, background: C.card, color: C.ink, fontFamily: SANS }}>
                        {(categorias || []).map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                      </select>
                    ) : (
                      <select value={e.destinoId || ""}
                        onChange={ev => setEgresos(l => l.map((x, ix) => ix === i ? { ...x, destinoId: ev.target.value } : x))}
                        style={{ flex: 1, padding: "6px 8px", borderRadius: 8, fontSize: 11.5, border: `1px solid ${C.border}`, background: C.card, color: C.ink, fontFamily: SANS }}>
                        <option value="">Elige…</option>
                        {(e.tipo === "financiador" ? (financiadores || []) : (vendedores || []))
                          .map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}
                      </select>
                    )}
                  </div>
                )}
              </div>
            ))}

            <button onClick={registrarEgresos} disabled={guardando}
              style={{ ...btnP(guardando ? C.inkFaint : C.danger), marginTop: 8 }}>
              {guardando ? "Registrando…" :
                `✓ Registrar ${egresos.filter(e => e.incluir).length} egreso(s) · ${fmt.money(egresos.filter(e => e.incluir).reduce((s, e) => s + e.mov.cargo, 0))}`}
            </button>
          </>
        )
      )}

      {err && <div style={{ background: C.dangerLight, color: C.danger, borderRadius: 8, padding: "8px 12px", fontSize: 12.5, marginTop: 10, fontWeight: 600 }}>{err}</div>}

      <button onClick={async () => {
          setGuardando(true);
          try { await onRegistrar([], resumenCartola()); }
          catch (e) { setErr(e.message); }
          finally { setGuardando(false); }
        }}
        disabled={guardando}
        style={{ ...btnG, width: "100%", marginTop: 12, fontSize: 12, borderColor: C.info, color: C.info }}>
        Guardar solo los totales del banco
      </button>

      <button onClick={() => { setMovs([]); setItems([]); setElegido({}); setEgresos([]); setVista("cobros"); setErr(""); }}
        style={{ ...btnG, width: "100%", marginTop: 12, fontSize: 12 }}>
        Subir otra cartola
      </button>
    </div>
  );
}
