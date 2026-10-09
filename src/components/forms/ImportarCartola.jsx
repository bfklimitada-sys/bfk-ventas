import { anioMesDe } from "../../lib/calculos";
import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { C, MONO, SANS, btnP, btnG, fmt } from "../../lib/theme";
import { Ic, I } from "../ui/Iconos";
import { leerCartolaBancoEstado, totalesPorMes, unirCartolas } from "../../lib/cartolas";
import { CIERRE_CONCILIACION, ESTADOS, conciliarMovimientos, opcionesAbono } from "../../lib/conciliacion";

// ═══════════════════════════════════════════════════════════════
// Cartola BancoEstado · conciliación (2026-10)
//  Etapa 1 (consulta): lee y valida ambos formatos, deduplica entre archivos, avisa cartolas faltantes y muestra
//    TODOS los movimientos con su estado (Conciliado · Posible registrado · Pendiente · Neutro). No preselecciona nada.
//  Etapa 2 (registro seguro): solo movimientos PENDIENTES posteriores al cierre (07/10/2026), uno a la vez, con
//    destino elegido a mano y confirmación explícita. Antes de escribir se vuelve a conciliar: si el movimiento ya
//    tiene un registro, no se registra. Lo anterior al cierre es solo consulta (ya está en saldos y FIFO históricos).
// ═══════════════════════════════════════════════════════════════

// ── Clasificación sugerida de un cargo (solo como SUGERENCIA, nunca se aplica sola) ──
// Compara el texto del banco con los nombres de financiadores y vendedores. Exige al menos dos palabras en común
// para no confundir, por ejemplo, a Byron Vegas con Matías Vegas.
const PALABRAS_IGNORADAS = new Set(["TEF", "BANCOESTADO", "RUT", "PAGO", "PAGOS", "GIRO", "CAJERO"]);

function coincidencias(nombre, descripcion) {
  const palabras = String(nombre || "").toUpperCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .split(/[^A-Z]+/).filter(p => p.length >= 4 && !PALABRAS_IGNORADAS.has(p));
  const descSinTilde = String(descripcion || "").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  return palabras.filter(p => descSinTilde.includes(p)).length;
}

export function clasificarCargo(mov, financiadores, vendedores) {
  const desc = String(mov.descripcion || "").toUpperCase();
  let mejorFin = null, puntosFin = 0;
  // Fondos propios (Cuenta BFK) no son un financista al que se le devuelva dinero (regla 2, Fase 4B).
  for (const f of (financiadores || []).filter(x => x.tipo !== "propio")) {
    const n = coincidencias(f.nombre, desc);
    if (n > puntosFin) { puntosFin = n; mejorFin = f; }
  }
  let mejorVen = null, puntosVen = 0;
  for (const v of vendedores || []) {
    const n = coincidencias(v.nombre, desc);
    if (n > puntosVen) { puntosVen = n; mejorVen = v; }
  }
  // Si la persona figura como financista Y como vendedor, no se puede saber si es devolución o comisión.
  if (puntosFin >= 2 && puntosVen >= 2) return { tipo: "vendedor", destinoId: mejorVen.id, nombre: mejorVen.nombre, seguro: false };
  if (puntosFin >= 2) return { tipo: "financiador", destinoId: mejorFin.id, nombre: mejorFin.nombre, seguro: true };
  if (puntosVen >= 2) return { tipo: "vendedor", destinoId: mejorVen.id, nombre: mejorVen.nombre, seguro: true };
  if (/COMISION|IMPUESTO|MANTENCION|CARGO POR/.test(desc)) return { tipo: "gasto", categoriaId: "cat_otros", nombre: "Comisión bancaria", seguro: true };
  return { tipo: "gasto", categoriaId: "cat_otros", nombre: "Por clasificar", seguro: false };
}

const TONO = {
  conciliado: { fondo: C.okLight, borde: C.ok, texto: C.okText },
  posible: { fondo: C.infoLight, borde: C.info, texto: C.info },
  pendiente: { fondo: C.warnLight, borde: C.warn, texto: C.warnText },
  neutro: { fondo: C.paper, borde: C.border, texto: C.inkMuted },
};
const TIPO_REG = { cobro: "Cobro", pago_financiador: "Pago a financiador", pago_vendedor: "Pago a vendedor", gasto: "Gasto", retiro_capital: "Retiro de capital", aporte_capital: "Aporte de capital" };
const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const caja = (extra) => ({ width: "100%", padding: "7px 9px", borderRadius: 8, fontSize: 12.5, border: `1px solid ${C.border}`, background: C.card, color: C.ink, fontFamily: SANS, ...extra });

export function ImportarCartola({ ocs, financiadores, vendedores, categorias, gastos = [], pagosVendedor = [], pagoFinSueltos = [], aportes = [],
  onRegistrar, onRegistrarEgresos, onRegistrarRetiro, cierre = CIERRE_CONCILIACION }) {
  const [cartolas, setCartolas] = useState([]);
  const [leyendo, setLeyendo] = useState(false);
  const [err, setErr] = useState("");
  const [filtro, setFiltro] = useState("todos");     // todos | conciliado | posible | pendiente | neutro | registrable
  const [sentido, setSentido] = useState("ambos");   // ambos | entra | sale
  const [abierto, setAbierto] = useState(null);      // clave del movimiento con el registro en preparación
  const [borrador, setBorrador] = useState({});      // datos del registro en preparación (sin preselección)
  const [confirmo, setConfirmo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [confirmaTotales, setConfirmaTotales] = useState(false);

  const datos = useMemo(() => ({ ocs, financiadores, vendedores, gastos, pagosVendedor, pagoFinSueltos, aportes }),
    [ocs, financiadores, vendedores, gastos, pagosVendedor, pagoFinSueltos, aportes]);
  const union = useMemo(() => unirCartolas(cartolas), [cartolas]);
  const conc = useMemo(() => conciliarMovimientos(union.movs, datos, { cierre }), [union, datos, cierre]);

  const procesar = async (files) => {
    if (!files?.length) return;
    setLeyendo(true); setErr("");
    try {
      const nuevas = [];
      for (const file of files) {
        try { nuevas.push(leerCartolaBancoEstado(XLSX.read(await file.arrayBuffer(), { type: "array" }), file.name)); }
        catch (e) { nuevas.push({ nombre: file.name, movs: [], errores: ["No se pudo abrir el archivo: " + e.message] }); }
      }
      setCartolas((prev) => [...prev, ...nuevas]);
    } finally { setLeyendo(false); }
  };

  const movs = union.movs;
  const lista = conc.movimientos.filter((x) => (sentido === "ambos" || x.dir === sentido)
    && (filtro === "todos" || (filtro === "registrable" ? x.registrable : x.estado === filtro)));
  const cuenta = (e, dir) => conc.movimientos.filter((x) => x.estado === e && (!dir || x.dir === dir)).length;
  const nRegistrables = conc.movimientos.filter((x) => x.registrable).length;

  const resumenCartola = () => {
    if (!movs.length) return null;
    const ultimo = movs[movs.length - 1];
    return { desde: movs[0].fecha, hasta: ultimo.fecha, movimientos: movs.length, saldoFinal: ultimo.saldo ?? null, meses: totalesPorMes(movs) };
  };

  const abrir = (x) => {
    setErr(""); setConfirmo(false); setAbierto(x.m.clave);
    setBorrador(x.dir === "entra" ? { opcionId: "" } : { tipo: "", destinoId: "", categoriaId: "", mesCom: "", anioCom: "", socio: "" });
  };
  const cerrar = () => { setAbierto(null); setBorrador({}); setConfirmo(false); };

  // Validación del borrador: todo elegido a mano, sin valores por defecto.
  const problemaBorrador = (x) => {
    if (x.dir === "entra") return borrador.opcionId ? null : "Elige a qué corresponde el abono";
    if (!borrador.tipo) return "Elige qué tipo de egreso es";
    if (borrador.tipo === "financiador" && !borrador.destinoId) return "Elige el financiador";
    if (borrador.tipo === "vendedor") {
      if (!borrador.destinoId) return "Elige el vendedor";
      if (!(Number(borrador.mesCom) >= 1 && Number(borrador.mesCom) <= 12) || !(Number(borrador.anioCom) >= 2020)) return "Indica el mes y el año de la comisión";
    }
    if (borrador.tipo === "gasto" && !borrador.categoriaId) return "Elige la categoría del gasto";
    if (borrador.tipo === "retiro" && !String(borrador.socio || "").trim()) return "Indica el socio";
    return null;
  };

  // Registro de UN movimiento, con confirmación explícita y verificación final contra duplicados.
  const registrar = async (x) => {
    const p = problemaBorrador(x);
    if (p) { setErr(p); return; }
    if (!confirmo) { setErr("Marca la confirmación antes de registrar"); return; }
    // Verificación final: se vuelve a conciliar con los datos actuales. Si ya no está pendiente, NO se registra.
    const actual = conciliarMovimientos(union.movs, datos, { cierre }).movimientos.find((y) => y.m.clave === x.m.clave);
    if (!actual || !actual.registrable) { setErr("Este movimiento ya tiene un registro en BFK o es anterior al cierre: no se registra de nuevo."); return; }
    const m = x.m, ref = m.operacion ? ` (op. ${m.operacion})` : "";
    setErr(""); setGuardando(true);
    try {
      if (x.dir === "entra") {
        const op = opcionesAbono(m, ocs).find((o) => o.id === borrador.opcionId);
        if (!op) throw new Error("La opción elegida ya no está disponible");
        const cobros = (op.asignaciones || []).map((a) => ({ ocId: a.ocId, numeroOc: a.numeroOc, monto: a.monto, parcial: a.parcial, tipo: op.tipo,
          fecha: m.fecha, descripcion: `${m.descripcion}${ref}` }));
        const valeVistas = op.valeVista ? [{ ...op.valeVista, fecha: m.fecha, monto: m.abono, descripcion: m.descripcion }] : [];
        await onRegistrar(cobros, resumenCartola(), valeVistas);
      } else if (borrador.tipo === "retiro") {
        if (!onRegistrarRetiro) throw new Error("El registro de retiros de capital no está disponible");
        await onRegistrarRetiro({ socio: String(borrador.socio).trim(), monto: m.cargo, fecha: m.fecha, notas: `Desde cartola${ref}: ${m.descripcion}` });
      } else {
        await onRegistrarEgresos([{ tipo: borrador.tipo, destinoId: borrador.destinoId, categoriaId: borrador.categoriaId, monto: m.cargo, fecha: m.fecha,
          descripcion: `${m.descripcion}${ref}`, operacion: m.operacion || "", mesCom: Number(borrador.mesCom), anioCom: Number(borrador.anioCom) }], resumenCartola());
      }
      cerrar();
    } catch (e) { setErr(e.message || String(e)); }
    finally { setGuardando(false); }
  };

  // ── Pantalla inicial ──
  if (!cartolas.length) {
    return (
      <div style={{ fontFamily: SANS }}>
        <div style={{ background: C.tealLight, borderRadius: 10, padding: "12px 14px", marginBottom: 16 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: C.tealDark, marginBottom: 5 }}>Cómo obtener la cartola</div>
          <div style={{ fontSize: 12, color: C.inkMuted, lineHeight: 1.55 }}>
            En BancoEstado Empresas descarga la Cartola en Línea o las Históricas de Chequera Electrónica. Se leen ambos formatos;
            puedes subir varias a la vez (un archivo repetido no duplica nada).
          </div>
        </div>
        <label style={{ ...btnG, display: "block", textAlign: "center", cursor: "pointer", padding: "16px" }}>
          {leyendo ? "Leyendo…" : <I t={"📄 Elegir cartola(s)"} />}
          <input data-cartola-archivos type="file" accept=".xlsx,.xls" multiple disabled={leyendo}
            onChange={e => procesar(Array.from(e.target.files || []))} style={{ display: "none" }} />
        </label>
        {err && <div style={{ background: C.dangerLight, color: C.dangerText, borderRadius: 8, padding: "8px 12px", fontSize: 12.5, marginTop: 12, fontWeight: 600 }}>{err}</div>}
        <div style={{ fontSize: 12, color: C.inkFaint, marginTop: 14, lineHeight: 1.5 }}>
          Primero es solo consulta: cada movimiento muestra si ya está registrado en BFK. Nada se registra sin tu confirmación,
          y lo anterior al {fmt.date(cierre)} no se puede registrar desde aquí.
        </div>
      </div>
    );
  }

  return (
    <div data-cartola-conciliacion style={{ fontFamily: SANS }}>
      {/* Archivos leídos y validaciones */}
      <div style={{ background: C.paper, borderRadius: 10, padding: "10px 13px", marginBottom: 10 }}>
        {cartolas.map((c, k) => (
          <div key={k} data-archivo={c.errores.length ? "rechazado" : "ok"} style={{ fontSize: 12, color: c.errores.length ? C.dangerText : C.inkMuted, marginBottom: 3 }}>
            {c.errores.length ? <><Ic n="⚠" /> {c.nombre}: rechazado — {c.errores.slice(0, 2).join(" · ")}</>
              : <>{c.formato === "linea" ? "En línea" : `Histórica N° ${c.numero || "—"}`} · {fmt.date(c.desde)} a {fmt.date(c.hasta)} · {c.movs.length} mov. · saldo {fmt.money(c.saldoInicial)} → {fmt.money(c.saldoFinal)}</>}
          </div>
        ))}
        {movs.length > 0 && (
          <div data-cartola-resumen style={{ fontSize: 12.5, color: C.ink, fontWeight: 700, marginTop: 6 }}>
            {movs.length} movimientos únicos · {fmt.date(movs[0].fecha)} a {fmt.date(movs[movs.length - 1].fecha)} · saldo al cierre <span style={{ fontFamily: MONO }}>{fmt.money(movs[movs.length - 1].saldo)}</span>
            {union.duplicadosQuitados > 0 && <span data-duplicados style={{ display: "block", fontWeight: 600, color: C.inkMuted }}>{union.duplicadosQuitados} línea(s) repetida(s) entre archivos no se cuentan dos veces{union.archivosRepetidos ? ` (${union.archivosRepetidos} archivo(s) repetido(s))` : ""}.</span>}
          </div>
        )}
      </div>
      {union.faltantes.length > 0 && (
        <div data-cartolas-faltantes style={{ background: C.dangerLight, border: `1px solid ${C.danger}`, borderRadius: 9, padding: "9px 12px", marginBottom: 10, fontSize: 12, color: C.dangerText, fontWeight: 600, lineHeight: 1.45 }}>
          Falta(n) cartola(s): {union.faltantes.map((g) => `entre el ${fmt.date(g.despuesDe)} y el ${fmt.date(g.antesDe)} (el saldo pasa de ${fmt.money(g.saldoEsperado)} a ${fmt.money(g.saldoEncontrado)})`).join("; ")}. Los movimientos de ese tramo no se ven.
        </div>
      )}

      {/* Estados */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, marginBottom: 8 }}>
        {Object.keys(ESTADOS).map((e) => (
          <button key={e} data-filtro={e} onClick={() => setFiltro(filtro === e ? "todos" : e)}
            style={{ padding: "7px 4px", borderRadius: 9, cursor: "pointer", border: `1.5px solid ${filtro === e ? TONO[e].borde : C.border}`, background: filtro === e ? TONO[e].fondo : C.card, color: TONO[e].texto, fontSize: 11.5, fontWeight: 700, lineHeight: 1.3 }}>
            {ESTADOS[e]}<br /><span data-cuenta={e} style={{ fontFamily: MONO, fontSize: 13 }}>{cuenta(e)}</span>
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        {[["ambos", `Todo · ${conc.movimientos.length}`], ["entra", `Entra · ${conc.movimientos.filter(x => x.dir === "entra").length}`], ["sale", `Sale · ${conc.movimientos.filter(x => x.dir === "sale").length}`]].map(([k, t]) => (
          <button key={k} data-sentido={k} onClick={() => setSentido(k)} style={{ flex: 1, padding: "7px", borderRadius: 9, cursor: "pointer", fontSize: 12, fontWeight: 700, border: `1.5px solid ${sentido === k ? C.tealDark : C.border}`, background: sentido === k ? C.paper : C.card, color: sentido === k ? C.tealDark : C.inkMuted }}>{t}</button>
        ))}
        <button data-filtro="registrable" onClick={() => setFiltro(filtro === "registrable" ? "todos" : "registrable")} style={{ flex: 1, padding: "7px", borderRadius: 9, cursor: "pointer", fontSize: 12, fontWeight: 700, border: `1.5px solid ${filtro === "registrable" ? C.warn : C.border}`, background: filtro === "registrable" ? C.warnLight : C.card, color: C.warnText }}>Por registrar · {nRegistrables}</button>
      </div>
      <div style={{ fontSize: 12, color: C.inkFaint, marginBottom: 10, lineHeight: 1.5 }}>
        Consulta: nada viene marcado ni se registra solo. Lo anterior al {fmt.date(cierre)} ya está en los saldos y en el FIFO histórico y no se registra desde aquí.
        {conc.sinLinea.length > 0 && <span data-control-inverso style={{ display: "block", color: C.dangerText, fontWeight: 700 }}>Hay {conc.sinLinea.length} registro(s) BFK posterior(es) al cierre sin movimiento bancario: revisa si están duplicados ({conc.sinLinea.slice(0, 3).map((r) => `${TIPO_REG[r.tipo] || r.tipo} ${fmt.date(r.fecha)} ${fmt.money(r.monto)}`).join("; ")}).</span>}
      </div>

      {err && <div data-error style={{ background: C.dangerLight, color: C.dangerText, borderRadius: 8, padding: "8px 12px", fontSize: 12.5, margin: "0 0 10px", fontWeight: 600 }}>{err}</div>}

      {/* Movimientos */}
      {lista.length === 0 && <div style={{ textAlign: "center", padding: "20px 0", color: C.inkFaint, fontSize: 13 }}>Sin movimientos con este filtro</div>}
      {lista.map((x) => {
        const m = x.m, t = TONO[x.estado], esAbierto = abierto === m.clave;
        return (
          <div key={m.clave + "|" + x.i} data-mov={m.clave} data-estado={x.estado} style={{ background: C.card, border: `1px solid ${esAbierto ? C.tealDark : C.border}`, borderLeft: `4px solid ${t.borde}`, borderRadius: 10, padding: "9px 12px", marginBottom: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontSize: 12, color: C.inkMuted, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {fmt.date(m.fecha)}{m.operacion ? ` · op. ${m.operacion}` : ""} · {m.descripcion}
              </span>
              <span style={{ fontFamily: MONO, fontWeight: 800, fontSize: 12.5, color: x.dir === "entra" ? C.okText : C.dangerText, flexShrink: 0 }}>
                {x.dir === "entra" ? "+" : "−"}{fmt.money(x.monto)}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 3, fontSize: 11.5 }}>
              <span style={{ color: t.texto, fontWeight: 700 }}>{ESTADOS[x.estado]}{x.evidencia.length ? ` · ${x.evidencia.join(", ")}` : ""}</span>
              <span style={{ color: C.inkFaint, fontFamily: MONO, flexShrink: 0 }}>saldo {fmt.money(m.saldo)}</span>
            </div>
            {x.registros.length > 0 && (
              <div style={{ fontSize: 11.5, color: C.inkMuted, marginTop: 3 }}>
                {x.registros.slice(0, 4).map((r) => `${TIPO_REG[r.tipo] || r.tipo}${r.oc ? " " + r.oc : ""} ${fmt.date(r.fecha)} ${fmt.money(r.monto)}`).join(" · ")}{x.registros.length > 4 ? ` · y ${x.registros.length - 4} más` : ""}
              </div>
            )}
            {x.estado !== "conciliado" && x.nota && <div style={{ fontSize: 11.5, color: C.inkFaint, marginTop: 2 }}>{x.nota}</div>}
            {x.anteriorCierre && x.estado === "pendiente" && <div style={{ fontSize: 11.5, color: C.inkFaint, marginTop: 2 }}>Anterior al cierre: queda visible como pendiente; no se registra desde la cartola.</div>}
            {x.registrable && !esAbierto && (
              <button data-preparar={m.clave} onClick={() => abrir(x)} style={{ ...btnG, width: "100%", marginTop: 7, fontSize: 12, padding: "7px" }}>Preparar registro…</button>
            )}
            {x.registrable && esAbierto && (
              <PrepararRegistro x={x} ocs={ocs} financiadores={financiadores} vendedores={vendedores} categorias={categorias}
                borrador={borrador} setBorrador={(p) => { setBorrador((b) => ({ ...b, ...p })); setConfirmo(false); }}
                confirmo={confirmo} setConfirmo={setConfirmo} problema={problemaBorrador(x)} guardando={guardando}
                onCancelar={cerrar} onRegistrar={() => registrar(x)} />
            )}
          </div>
        );
      })}

      {/* Totales del banco: también requieren confirmación (escriben banco_mensual y el registro de la cartola) */}
      {movs.length > 0 && onRegistrar && (
        <div style={{ background: C.paper, borderRadius: 10, padding: "10px 12px", marginTop: 12 }}>
          <label style={{ display: "flex", gap: 8, fontSize: 12, color: C.inkMuted, alignItems: "flex-start", cursor: "pointer" }}>
            <input data-confirmar-totales type="checkbox" checked={confirmaTotales} onChange={(e) => setConfirmaTotales(e.target.checked)} style={{ marginTop: 2 }} />
            <span>Confirmo guardar los totales mensuales del banco de este período (no registra cobros, pagos ni gastos).</span>
          </label>
          <button data-guardar-totales disabled={guardando || !confirmaTotales} onClick={async () => {
              setGuardando(true); setErr("");
              try { await onRegistrar([], resumenCartola()); setConfirmaTotales(false); } catch (e) { setErr(e.message); } finally { setGuardando(false); }
            }}
            style={{ ...btnG, width: "100%", marginTop: 8, fontSize: 12, borderColor: C.info, color: C.info, opacity: confirmaTotales ? 1 : 0.5 }}>
            Guardar solo los totales del banco
          </button>
        </div>
      )}

      <label style={{ ...btnG, display: "block", textAlign: "center", cursor: "pointer", marginTop: 12, fontSize: 12 }}>
        {leyendo ? "Leyendo…" : "Agregar otra cartola"}
        <input type="file" accept=".xlsx,.xls" multiple disabled={leyendo} onChange={e => procesar(Array.from(e.target.files || []))} style={{ display: "none" }} />
      </label>
      <button onClick={() => { setCartolas([]); cerrar(); setFiltro("todos"); setSentido("ambos"); setErr(""); }} style={{ ...btnG, width: "100%", marginTop: 8, fontSize: 12 }}>
        Empezar de nuevo
      </button>
    </div>
  );
}

// Preparación del registro de UN movimiento pendiente posterior al cierre. Nada viene elegido por defecto.
function PrepararRegistro({ x, ocs, financiadores, vendedores, categorias, borrador, setBorrador, confirmo, setConfirmo, problema, guardando, onCancelar, onRegistrar }) {
  const m = x.m;
  const opciones = x.dir === "entra" ? opcionesAbono(m, ocs) : [];
  const sugerencia = x.dir === "sale" ? clasificarCargo(m, financiadores, vendedores) : null;
  const am = anioMesDe(m.fecha);
  const resumen = (() => {
    if (problema) return null;
    if (x.dir === "entra") { const op = opciones.find((o) => o.id === borrador.opcionId); return op ? `Cobro de ${fmt.money(m.abono)} · ${op.etiqueta}` : null; }
    const nombre = (l, id) => (l || []).find((y) => y.id === id)?.nombre || id;
    if (borrador.tipo === "financiador") return `Devolución a ${nombre(financiadores, borrador.destinoId)} por ${fmt.money(m.cargo)} (se reparte por FIFO entre sus OC pendientes)`;
    if (borrador.tipo === "vendedor") return `Pago a ${nombre(vendedores, borrador.destinoId)} por ${fmt.money(m.cargo)} · comisión de ${MESES[Number(borrador.mesCom) - 1]} ${borrador.anioCom} (el excedente sobre la comisión pendiente queda como apoyo en gestión)`;
    if (borrador.tipo === "gasto") return `Gasto «${nombre(categorias, borrador.categoriaId)}» por ${fmt.money(m.cargo)}`;
    if (borrador.tipo === "retiro") return `Retiro de capital de ${borrador.socio} por ${fmt.money(m.cargo)} (patrimonio, no es gasto)`;
    return null;
  })();
  return (
    <div data-preparacion style={{ marginTop: 8, borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
      {x.dir === "entra" ? (
        opciones.length === 0
          ? <div style={{ fontSize: 12, color: C.warnText, fontWeight: 600 }}>No hay facturas pendientes compatibles (con factura anterior al abono). Queda pendiente: regístralo desde la OC cuando se identifique.</div>
          : <select data-opcion-abono value={borrador.opcionId} onChange={(e) => setBorrador({ opcionId: e.target.value })} style={caja()}>
              <option value="">— Elige a qué corresponde (nada viene elegido) —</option>
              {opciones.map((o) => <option key={o.id} value={o.id}>{({ exacto: "Factura", varias: "Varias facturas", parcial: "Abono parcial", vale_vista: "Vale vista" })[o.tipo]} · {o.etiqueta}</option>)}
            </select>
      ) : (<>
        {sugerencia && <div style={{ fontSize: 11.5, color: C.inkFaint, marginBottom: 5 }}>Sugerencia (no se aplica sola): {sugerencia.nombre}</div>}
        <select data-tipo-egreso value={borrador.tipo} onChange={(e) => setBorrador({ tipo: e.target.value, destinoId: "", categoriaId: "", socio: "", mesCom: e.target.value === "vendedor" ? am.mes : "", anioCom: e.target.value === "vendedor" ? am.anio : "" })} style={caja()}>
          <option value="">— Elige qué es este egreso —</option>
          <option value="financiador">Devolución a financiador</option>
          <option value="vendedor">Pago a vendedor (comisión)</option>
          <option value="gasto">Gasto</option>
          <option value="retiro">Retiro de capital de un socio (no es gasto)</option>
        </select>
        {(borrador.tipo === "financiador" || borrador.tipo === "vendedor") && (
          <select data-destino value={borrador.destinoId} onChange={(e) => setBorrador({ destinoId: e.target.value })} style={caja({ marginTop: 6 })}>
            <option value="">Elige…</option>
            {(borrador.tipo === "financiador" ? (financiadores || []).filter((f) => f.tipo !== "propio") : (vendedores || [])).map((y) => <option key={y.id} value={y.id}>{y.nombre}</option>)}
          </select>
        )}
        {borrador.tipo === "vendedor" && borrador.destinoId && (
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            <select data-mes-comision value={borrador.mesCom} onChange={(e) => setBorrador({ mesCom: Number(e.target.value) })} style={caja({ flex: 1 })}>
              <option value="">Mes de las ventas…</option>
              {MESES.map((n, k) => <option key={k} value={k + 1}>{n}</option>)}
            </select>
            <input data-anio-comision type="number" value={borrador.anioCom} onChange={(e) => setBorrador({ anioCom: Number(e.target.value) })} style={caja({ width: 84, fontFamily: MONO })} />
          </div>
        )}
        {borrador.tipo === "gasto" && (
          <select data-categoria value={borrador.categoriaId} onChange={(e) => setBorrador({ categoriaId: e.target.value })} style={caja({ marginTop: 6 })}>
            <option value="">Categoría…</option>
            {(categorias || []).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        )}
        {borrador.tipo === "retiro" && (
          <input data-socio list="socios-cartola" placeholder="Socio (ej.: Kevin Vergara)" value={borrador.socio} onChange={(e) => setBorrador({ socio: e.target.value })} style={caja({ marginTop: 6 })} />
        )}
        <datalist id="socios-cartola">{(financiadores || []).filter((f) => f.tipo !== "propio").map((f) => <option key={f.id} value={f.nombre} />)}</datalist>
      </>)}
      {resumen && (
        <div data-confirmacion style={{ background: C.warnLight, border: `1px solid ${C.warn}`, borderRadius: 9, padding: "9px 11px", marginTop: 8, fontSize: 12, color: C.ink, lineHeight: 1.45 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Se registrará en BFK:</div>
          <div>{resumen}</div>
          <div style={{ color: C.inkMuted, marginTop: 3 }}>Fecha {fmt.date(m.fecha)}{m.operacion ? ` · operación ${m.operacion}` : ""} · movimiento bancario (no fuera del banco).</div>
          <label style={{ display: "flex", gap: 8, marginTop: 7, alignItems: "flex-start", cursor: "pointer" }}>
            <input data-confirmo type="checkbox" checked={confirmo} onChange={(e) => setConfirmo(e.target.checked)} style={{ marginTop: 2 }} />
            <span>Confirmo que este movimiento no está registrado en BFK y quiero registrarlo.</span>
          </label>
        </div>
      )}
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <button onClick={onCancelar} disabled={guardando} style={{ ...btnG, flex: 1, fontSize: 12, padding: "8px" }}>Cancelar</button>
        <button data-registrar disabled={guardando || !!problema || !confirmo} onClick={onRegistrar}
          style={{ ...btnP(guardando || problema || !confirmo ? C.inkFaint : C.ok), flex: 2, fontSize: 12.5, padding: "8px" }}>
          {guardando ? "Registrando…" : "Registrar este movimiento"}
        </button>
      </div>
    </div>
  );
}
