import { anioMesDe } from "../../lib/calculos";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { C, MONO, SANS, btnP, btnG, fmt } from "../../lib/theme";
import { Ic, I } from "../ui/Iconos";
import { leerCartolaBancoEstado, totalesPorMes, unirCartolas } from "../../lib/cartolas";
import { CIERRE_CONCILIACION, TABLA_REGISTRO, conciliarMovimientos, opcionesAbono } from "../../lib/conciliacion";
import { textoRegistro, vistaConciliacion } from "../../lib/conciliacionVista";
import { coincidenciasSeguras, decisionesDelLote, ejecutarLote, resumenLote } from "../../lib/conciliacionLote";
import { esConflictoDuplicado, esFuncionNoDisponible, esPosibleDuplicadoManual, idsDelMensaje, marcaCartola, verificarRegistro } from "../../lib/registroCartola";

// ═══════════════════════════════════════════════════════════════
// Cartola BancoEstado · conciliación (2026-10; vista simple 21/10/2026)
//  Tres grupos: «Por revisar» y «Sin registrar» (visibles) y «Ya registrados» (botón «Ver conciliados»). Aparte:
//  «Registrado en BFK, pendiente de verificar en banco» y lo anterior al cierre (solo consulta).
//  «Es este registro» / «No corresponde» guardan una DECISIÓN (conciliacion_decisiones): no crean ni cambian
//  registros financieros. Registrar algo nuevo sigue siendo solo para lo «Sin registrar», con confirmación.
//  Etapa 1 (consulta): lee y valida ambos formatos, deduplica entre archivos, avisa cartolas faltantes y muestra
//    los movimientos en tres grupos (Ya registrados · Por revisar · Sin registrar). No preselecciona nada.
//  Etapa 2 (registro seguro): solo movimientos PENDIENTES posteriores al cierre (07/10/2026), uno a la vez, con
//    destino elegido a mano y confirmación explícita. Antes de escribir se vuelve a conciliar con los registros
//    RECIÉN leídos de la base y la escritura la hace una función de la base con la marca del movimiento: un mismo
//    movimiento queda registrado una sola vez, aun desde dos sesiones o con tipos distintos (23505). Si existe un
//    registro manual parecido (BFK01), el usuario elige vincularlo o confirmar que es otra operación. Un bloqueo
//    inmediato evita el doble envío. Lo anterior al cierre es solo consulta (ya está en saldos y FIFO históricos).
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
const caja = (extra) => ({ width: "100%", padding: "7px 9px", borderRadius: 8, fontSize: 13, border: `1px solid ${C.border}`, background: C.card, color: C.ink, fontFamily: SANS, ...extra });

export function ImportarCartola({ ocs, financiadores, vendedores, categorias, gastos = [], pagosVendedor = [], pagoFinSueltos = [], aportes = [],
  onRegistrar, onRegistrarEgresos, onRegistrarRetiro, onLeerDatosFrescos, onRecargar, onLeerDecisiones, onDecidir, onAnularDecision, cierre = CIERRE_CONCILIACION }) {
  const [cartolas, setCartolas] = useState([]);
  const [leyendo, setLeyendo] = useState(false);
  const [err, setErr] = useState("");
  const [verConciliados, setVerConciliados] = useState(false);
  const [verAnteriores, setVerAnteriores] = useState(false);
  const [decisiones, setDecisiones] = useState(null); // null = la base aún no guarda decisiones (actualización pendiente)
  const [decidiendo, setDecidiendo] = useState(null);
  const lectorDecisiones = useRef(onLeerDecisiones); lectorDecisiones.current = onLeerDecisiones;   // la app recrea la función en cada render
  const leerDecisiones = useCallback(async () => {
    if (!lectorDecisiones.current) { setDecisiones(null); return; }
    try { setDecisiones(await lectorDecisiones.current()); } catch { setDecisiones(null); }
  }, []);
  useEffect(() => { leerDecisiones(); }, [leerDecisiones]);
  const [abierto, setAbierto] = useState(null);      // clave del movimiento con el registro en preparación
  const [borrador, setBorrador] = useState({});      // datos del registro en preparación (sin preselección)
  const [confirmo, setConfirmo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [confirmaTotales, setConfirmaTotales] = useState(false);
  const enCurso = useRef(false);                     // bloqueo inmediato contra doble envío (no espera al re-render)
  const avanzarSerie = useRef(null);                 // registro en serie: avanzar tras recargar los datos
  const [duplicado, setDuplicado] = useState(null);  // { clave, registros }: la base encontró un registro manual parecido
  // Conciliación masiva (23/10/2026): selección de coincidencias seguras y registro en serie de movimientos nuevos.
  const [selSeguras, setSelSeguras] = useState(() => new Set());
  const [revisandoLote, setRevisandoLote] = useState(false);
  const [confirmaLote, setConfirmaLote] = useState(false);
  const [progresoLote, setProgresoLote] = useState(null);   // { hechos, total }
  const [resultadoLote, setResultadoLote] = useState(null); // { res, ids (para deshacer), ok, fallas }
  const [selNuevos, setSelNuevos] = useState(() => new Set());
  const [serie, setSerie] = useState(null);                 // { claves: [...], hechos: n, saltados: n }

  const datos = useMemo(() => ({ ocs, financiadores, vendedores, gastos, pagosVendedor, pagoFinSueltos, aportes, decisiones: decisiones || [] }),
    [ocs, financiadores, vendedores, gastos, pagosVendedor, pagoFinSueltos, aportes, decisiones]);
  const union = useMemo(() => unirCartolas(cartolas), [cartolas]);
  const conc = useMemo(() => conciliarMovimientos(union.movs, datos, { cierre }), [union, datos, cierre]);
  const vista = useMemo(() => vistaConciliacion(conc, { ocs, categorias, cierre }), [conc, ocs, categorias, cierre]);
  // Solo con la base de decisiones instalada se pueden confirmar vínculos (en lote o uno a uno).
  const seguras = useMemo(() => (decisiones === null ? [] : coincidenciasSeguras(vista)), [vista, decisiones]);
  const lote = useMemo(() => seguras.filter((s) => selSeguras.has(s.marca)), [seguras, selSeguras]);
  const marcaSegura = useMemo(() => new Set(seguras.map((s) => s.marca)), [seguras]);

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

  // Decisión del usuario sobre una coincidencia: se guarda aparte (no crea ni cambia registros financieros).
  const decidir = async (item, decision, registros) => {
    if (enCurso.current || !onDecidir) return;
    const grupos = new Map();
    for (const r of registros) { const t = r.tabla || TABLA_REGISTRO[r.tipo]; (grupos.get(t) || grupos.set(t, []).get(t)).push(String(r.id)); }
    if (decision === "vinculado" && grupos.size !== 1) { setErr("Un movimiento se vincula con registros de un solo tipo."); return; }
    enCurso.current = true; setDecidiendo(item.marca); setErr("");
    try {
      for (const [tabla, ids] of grupos) await onDecidir({ marca: item.marca, decision, tabla, ids, operacion: item.operacion || null, descripcion: item.descripcion || null });
      await leerDecisiones();
    } catch (e) { setErr(mensajeDecision(e)); await leerDecisiones(); }
    finally { enCurso.current = false; setDecidiendo(null); }
  };
  const anular = async (ids) => {
    if (enCurso.current || !onAnularDecision) return;
    if (!window.confirm("¿Deshacer esta decisión? El movimiento vuelve a revisarse. No cambia ningún registro de BFK.")) return;
    enCurso.current = true; setErr("");
    try { for (const id of ids) await onAnularDecision(id); await leerDecisiones(); } catch (e) { setErr(mensajeDecision(e)); }
    finally { enCurso.current = false; }
  };

  // ── Lote de coincidencias seguras: revalida cada una con datos frescos y guarda SOLO decisiones (vínculos) ──
  const confirmarLote = async () => {
    if (enCurso.current || !onDecidir || !lote.length || !confirmaLote) return;
    if (!onLeerDatosFrescos) { setErr("No se puede verificar contra la base: no se confirmó nada."); return; }
    enCurso.current = true; setErr(""); setProgresoLote({ hechos: 0, total: lote.length });
    const antes = (await lectorDecisiones.current?.().catch(() => null)) || decisiones || [];
    try {
      const res = await ejecutarLote(lote, {
        leerFrescos: onLeerDatosFrescos,
        conciliar: (f) => conciliarMovimientos(union.movs, { ...f, decisiones: f.decisiones || antes }, { cierre }),
        decidir: (d) => onDecidir({ ...d, silencioso: true }),
        alAvanzar: (hechos, total) => setProgresoLote({ hechos, total }),
      });
      const despues = (await lectorDecisiones.current?.().catch(() => null)) || [];
      const ids = decisionesDelLote(antes, despues, res.filter((r) => r.ok).map((r) => r.marca));
      setResultadoLote({ res, ids, ok: res.filter((r) => r.ok).length, fallas: res.filter((r) => !r.ok) });
      setSelSeguras(new Set()); setRevisandoLote(false); setConfirmaLote(false);
      await leerDecisiones();
    } catch (e) { setErr(mensajeDecision(e)); await leerDecisiones(); }
    finally { enCurso.current = false; setProgresoLote(null); }
  };
  const deshacerLote = async () => {
    if (enCurso.current || !onAnularDecision || !resultadoLote?.ids?.length) return;
    if (!window.confirm(`¿Deshacer los ${resultadoLote.ids.length} vínculos de este lote? Los movimientos vuelven a quedar por confirmar. No cambia ningún registro de BFK.`)) return;
    enCurso.current = true; setErr("");
    try { for (const id of resultadoLote.ids) await onAnularDecision(id, { silencioso: true }); setResultadoLote(null); await leerDecisiones(); }
    catch (e) { setErr(mensajeDecision(e)); await leerDecisiones(); }
    finally { enCurso.current = false; }
  };
  const alternarSegura = (marca) => setSelSeguras((s) => { const n = new Set(s); n.has(marca) ? n.delete(marca) : n.add(marca); return n; });
  const alternarNuevo = (marca) => setSelNuevos((s) => { const n = new Set(s); n.has(marca) ? n.delete(marca) : n.add(marca); return n; });

  // ── Registro en serie: cada movimiento elegido se abre de a uno, con su propia revisión y confirmación ──
  const abrirSiguienteDeSerie = (sr, desde = 0) => {
    const pendientes = vista.sinRegistrar.filter((it) => it.x.registrable && sr.claves.includes(it.x.m.clave));
    const sig = sr.claves.slice(desde).map((c) => pendientes.find((it) => it.x.m.clave === c)).find(Boolean);
    if (sig) abrir(sig.x); else { setSerie((s) => (s ? { ...s, terminada: true } : s)); cerrar(); }
  };
  const iniciarSerie = () => {
    const claves = vista.sinRegistrar.filter((it) => it.x.registrable && selNuevos.has(it.marca)).map((it) => it.x.m.clave);
    if (!claves.length) return;
    const sr = { claves, actual: 0, hechos: 0, saltados: 0 }; setSerie(sr); setSelNuevos(new Set()); abrirSiguienteDeSerie(sr, 0);
  };

  // Tras registrar uno de la serie (datos ya recargados): abrir el siguiente que siga sin registrar.
  useEffect(() => {
    if (!avanzarSerie.current || !serie) return;
    avanzarSerie.current = null;
    const sr = { ...serie, actual: serie.actual + 1, hechos: serie.hechos + 1 };
    setSerie(sr); abrirSiguienteDeSerie(sr, sr.actual);
  }, [vista]);   // eslint-disable-line react-hooks/exhaustive-deps
  const saltarEnSerie = () => { if (!serie) return; const sr = { ...serie, actual: serie.actual + 1, saltados: serie.saltados + 1 }; setSerie(sr); abrirSiguienteDeSerie(sr, sr.actual); };
  const terminarSerie = () => { setSerie(null); cerrar(); };

  const resumenCartola = () => {
    if (!movs.length) return null;
    const ultimo = movs[movs.length - 1];
    return { desde: movs[0].fecha, hasta: ultimo.fecha, movimientos: movs.length, saldoFinal: ultimo.saldo ?? null, meses: totalesPorMes(movs) };
  };

  const abrir = (x) => {
    setErr(""); setConfirmo(false); setAbierto(x.m.clave); setDuplicado(null);
    setBorrador(x.dir === "entra" ? { opcionId: "" } : { tipo: "", destinoId: "", categoriaId: "", mesCom: "", anioCom: "", socio: "" });
  };
  const cerrar = () => { setAbierto(null); setBorrador({}); setConfirmo(false); setDuplicado(null); };

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

  // Registro de UN movimiento, con confirmación explícita. La base garantiza que el movimiento quede registrado una
  // sola vez (marca del movimiento); antes se verifica con datos frescos para avisar temprano.
  //  opc.vincular: ids de registros manuales que SON este movimiento (se marcan; no se crea nada).
  //  opc.confirmoDistinto: el usuario confirma que el registro manual parecido es OTRA operación.
  const registrar = async (x, opc = {}) => {
    if (enCurso.current) return;                     // un segundo clic mientras se guarda no hace nada
    const p = problemaBorrador(x);
    if (p) { setErr(p); return; }
    if (!confirmo) { setErr("Marca la confirmación antes de registrar"); return; }
    enCurso.current = true; setErr(""); setGuardando(true);
    let frescos = null;
    try {
      if (!onLeerDatosFrescos) throw new Error("No se puede verificar contra la base: no se registra.");
      frescos = await onLeerDatosFrescos();
      const v = verificarRegistro(union.movs, x.i, frescos, { cierre, decidido: !!(opc.vincular || opc.confirmoDistinto) });
      if (!v.ok) { setErr(v.motivo); setDuplicado(null); onRecargar?.(); return; }
      const m = x.m, ref = m.operacion ? ` (op. ${m.operacion})` : "";
      const marca = { marca: marcaCartola(union.movs, x.i), vincular: opc.vincular || null, confirmoDistinto: !!opc.confirmoDistinto };
      if (x.dir === "entra") {
        const op = opcionesAbono(m, frescos.ocs || ocs).find((o) => o.id === borrador.opcionId);
        if (!op) throw new Error("La opción elegida ya no está disponible");
        const cobros = (op.asignaciones || []).map((a) => ({ ocId: a.ocId, numeroOc: a.numeroOc, monto: a.monto, parcial: a.parcial, tipo: op.tipo,
          fecha: m.fecha, descripcion: `${m.descripcion}${ref}` }));
        const valeVistas = op.valeVista ? [{ ...op.valeVista, fecha: m.fecha, monto: m.abono, descripcion: m.descripcion }] : [];
        await onRegistrar(cobros, resumenCartola(), valeVistas, marca, { mantenerAbierto: !!serie });
      } else if (borrador.tipo === "retiro") {
        if (!onRegistrarRetiro) throw new Error("El registro de retiros de capital no está disponible");
        await onRegistrarRetiro({ ...marca, socio: String(borrador.socio).trim(), monto: m.cargo, fecha: m.fecha, notas: `Desde cartola${ref}: ${m.descripcion}`, mantenerAbierto: !!serie });
      } else {
        await onRegistrarEgresos([{ ...marca, tipo: borrador.tipo, destinoId: borrador.destinoId, categoriaId: borrador.categoriaId, monto: m.cargo, fecha: m.fecha,
          descripcion: `${m.descripcion}${ref}`, operacion: m.operacion || "", mesCom: Number(borrador.mesCom), anioCom: Number(borrador.anioCom) }], resumenCartola(), { mantenerAbierto: !!serie });
      }
      cerrar();
      if (serie) avanzarSerie.current = { hechos: 1 };   // se abre el siguiente cuando llegan los datos recargados
    } catch (e) {
      if (esPosibleDuplicadoManual(e)) {
        const ids = idsDelMensaje(e);
        setDuplicado({ clave: x.m.clave, registros: registrosPorId(frescos || datos, ids), ids });
        setErr("");
      } else if (esConflictoDuplicado(e)) { setDuplicado(null); setErr("Otra sesión ya registró este movimiento: no se guardó de nuevo."); onRecargar?.(); }
      else if (esFuncionNoDisponible(e)) setErr("La protección de la base para la cartola aún no está activa: no se registró nada. Avise al administrador.");
      else setErr(e.message || String(e));
    } finally { enCurso.current = false; setGuardando(false); }
  };

  const sugerenciaCargo = (it) => {
    if (it.dir !== "sale") return "";
    const sg = clasificarCargo(it.x.m, financiadores, vendedores);
    return sg.seguro ? `${sg.nombre} (sugerencia, no se aplica sola)` : "";
  };
  const renderPreparar = (x) => abierto !== x.m.clave
    ? <button data-preparar={x.m.clave} onClick={() => abrir(x)} style={{ ...btnG, width: "100%", marginTop: 7, fontSize: 12, padding: "7px" }}>Preparar registro…</button>
    : (<>
      <PrepararRegistro x={x} ocs={ocs} financiadores={financiadores} vendedores={vendedores} categorias={categorias}
        borrador={borrador} setBorrador={(p) => { setBorrador((b) => ({ ...b, ...p })); setConfirmo(false); }}
        confirmo={confirmo} setConfirmo={setConfirmo} problema={problemaBorrador(x)} guardando={guardando}
        onCancelar={cerrar} onRegistrar={() => registrar(x)} />
      {duplicado?.clave === x.m.clave && (
        <DuplicadoManual dup={duplicado} guardando={guardando}
          onVincular={() => registrar(x, { vincular: duplicado.ids })} onDistinto={() => registrar(x, { confirmoDistinto: true })} />
      )}
    </>);

  // ── Pantalla inicial ──
  if (!cartolas.length) {
    return (
      <div style={{ fontFamily: SANS }}>
        <div style={{ background: C.tealLight, borderRadius: 12, padding: "12px 14px", marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.tealDark, marginBottom: 5 }}>Cómo obtener la cartola</div>
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
        {err && <div style={{ background: C.dangerLight, color: C.dangerText, borderRadius: 8, padding: "8px 12px", fontSize: 13, marginTop: 12, fontWeight: 600 }}>{err}</div>}
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
      <div style={{ background: C.paper, borderRadius: 12, padding: "10px 13px", marginBottom: 10 }}>
        {cartolas.map((c, k) => (
          <div key={k} data-archivo={c.soloRevision ? "solo-revision" : c.errores.length ? "rechazado" : "ok"} style={{ fontSize: 12, color: c.soloRevision ? C.warnText : c.errores.length ? C.dangerText : C.inkMuted, marginBottom: 3, fontWeight: c.soloRevision ? 700 : 400 }}>
            {c.soloRevision ? <><Ic n="⚠" /> {c.nombre}: no cuadra · Solo revisión (no se usa para conciliar ni registrar)</>
              : c.errores.length ? <><Ic n="⚠" /> {c.nombre}: no se pudo leer — {c.errores.slice(0, 2).join(" · ")}</>
              : <>{c.formato === "linea" ? "En línea" : `Histórica N° ${c.numero || "—"}`} · {fmt.date(c.desde)} a {fmt.date(c.hasta)} · {c.movs.length} mov. · saldo {fmt.money(c.saldoInicial)} → {fmt.money(c.saldoFinal)}</>}
          </div>
        ))}
        {movs.length > 0 && (
          <div data-cartola-resumen style={{ fontSize: 13, color: C.ink, fontWeight: 700, marginTop: 6 }}>
            {movs.length} movimientos únicos · {fmt.date(movs[0].fecha)} a {fmt.date(movs[movs.length - 1].fecha)} · saldo al cierre <span style={{ fontFamily: MONO }}>{fmt.money(movs[movs.length - 1].saldo)}</span>
            {union.duplicadosQuitados > 0 && <span data-duplicados style={{ display: "block", fontWeight: 600, color: C.inkMuted }}>{union.duplicadosQuitados} línea(s) repetida(s) entre archivos no se cuentan dos veces{union.archivosRepetidos ? ` (${union.archivosRepetidos} archivo(s) repetido(s))` : ""}.</span>}
          </div>
        )}
      </div>
      {union.faltantes.length > 0 && (
        <div data-cartolas-faltantes style={{ background: C.dangerLight, border: `1px solid ${C.danger}`, borderRadius: 8, padding: "9px 12px", marginBottom: 10, fontSize: 12, color: C.dangerText, fontWeight: 600, lineHeight: 1.45 }}>
          Falta(n) cartola(s): {union.faltantes.map((g) => `entre el ${fmt.date(g.despuesDe)} y el ${fmt.date(g.antesDe)} (el saldo pasa de ${fmt.money(g.saldoEsperado)} a ${fmt.money(g.saldoEncontrado)})`).join("; ")}. Los movimientos de ese tramo no se ven.
        </div>
      )}

      {union.soloRevision.length > 0 && (
        <div data-aviso-solo-revision style={{ background: C.warnLight, border: `1px solid ${C.warn}`, borderRadius: 10, padding: "10px 12px", marginBottom: 10, fontSize: 13, color: C.ink, lineHeight: 1.5 }}>
          <div style={{ fontWeight: 800, color: C.warnText }}>{union.soloRevision.length === 1 ? "Una cartola no cuadra" : `${union.soloRevision.length} cartolas no cuadran`}: quedaron en «Solo revisión»</div>
          Puedes ver sus movimientos, pero con ellas no se registra, no se concilia ni se guardan saldos.
          {movs.length > 0 ? " La conciliación de abajo usa solo los archivos que sí cuadran." : " Descarga la cartola de nuevo más tarde y vuelve a cargarla: se revisará completa otra vez."}
        </div>
      )}
      {union.soloRevision.map((c) => <SoloRevision key={c.nombre} c={c} />)}

      {movs.length === 0 ? (
        <div data-sin-conciliacion style={{ textAlign: "center", padding: "14px 6px", color: C.inkMuted, fontSize: 13, lineHeight: 1.5 }}>
          No hay cartolas que cuadren, así que todavía no se puede conciliar. Nada se registró ni se guardó.
        </div>
      ) : (<>
      {/* Resumen: tres grupos */}
      <div data-resumen-grupos style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 6, marginBottom: 8 }}>
        <Contador dato="revisar" etiqueta="Por revisar" n={vista.revisar.length} tono={vista.revisar.length ? "posible" : "neutro"} />
        <Contador dato="sin-registrar" etiqueta="Sin registrar" n={vista.sinRegistrar.length} tono={vista.sinRegistrar.length ? "pendiente" : "neutro"} />
        <Contador dato="ya" etiqueta="Ya registrados" n={vista.ya.length} tono="conciliado" />
        {seguras.length > 0 && <Contador dato="seguras" etiqueta="Seguras por confirmar" n={seguras.length} tono="conciliado" />}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        <button data-ver-conciliados onClick={() => setVerConciliados((v) => !v)} style={{ ...btnG, flex: "1 1 160px", fontSize: 12, padding: "7px" }}>
          {verConciliados ? "Ocultar conciliados" : `Ver conciliados (${vista.ya.length})`}
        </button>
        {vista.anteriores.length > 0 && (
          <button data-ver-anteriores onClick={() => setVerAnteriores((v) => !v)} style={{ ...btnG, flex: "1 1 160px", fontSize: 12, padding: "7px" }}>
            {verAnteriores ? "Ocultar anteriores al cierre" : `Antes del ${fmt.date(cierre)} (${vista.anteriores.length})`}
          </button>
        )}
      </div>
      <div style={{ fontSize: 12, color: C.inkFaint, marginBottom: 10, lineHeight: 1.5 }}>
        Nada se registra solo. «Es este registro» y «No corresponde» solo guardan tu decisión: no crean ni cambian cobros, gastos ni pagos.
        {decisiones === null && <span data-decisiones-no-disponibles style={{ display: "block", color: C.warnText, fontWeight: 600 }}>Para guardar estas decisiones falta instalar la actualización de la base (pendiente de autorización). Mientras tanto puedes consultar y registrar lo «Sin registrar».</span>}
      </div>

      {err && <div data-error style={{ background: C.dangerLight, color: C.dangerText, borderRadius: 8, padding: "8px 12px", fontSize: 13, margin: "0 0 10px", fontWeight: 600 }}>{err}</div>}

      {resultadoLote && (
        <div data-resultado-lote role="status" style={{ background: resultadoLote.fallas.length ? C.warnLight : C.okLight, border: `1px solid ${resultadoLote.fallas.length ? C.warn : C.ok}`, borderRadius: 10, padding: "10px 12px", marginBottom: 10, fontSize: 13, color: C.ink, lineHeight: 1.5 }}>
          <b>{resultadoLote.ok} vínculo{resultadoLote.ok === 1 ? "" : "s"} confirmado{resultadoLote.ok === 1 ? "" : "s"}</b>{resultadoLote.fallas.length ? ` · ${resultadoLote.fallas.length} no se guardaron` : ""}. No se creó ni cambió ningún cobro, gasto ni pago.
          {resultadoLote.fallas.map((f) => { const s0 = vista.ya.concat(vista.revisar, vista.sinRegistrar).find((i) => i.marca === f.marca); return (
            <div key={f.marca} data-falla-lote={f.marca} style={{ fontSize: 12, color: C.inkMuted }}>· {s0 ? `${fmt.date(s0.x.m.fecha)} ${s0.x.m.descripcion} ${fmt.money(s0.x.monto)}` : f.marca}: {f.motivo}</div>); })}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
            {resultadoLote.ids.length > 0 && onAnularDecision && <button data-deshacer-lote onClick={deshacerLote} style={{ ...btnG, fontSize: 12, padding: "6px 10px" }}>Deshacer este lote ({resultadoLote.ids.length})</button>}
            <button data-cerrar-resultado-lote onClick={() => setResultadoLote(null)} style={{ ...btnG, fontSize: 12, padding: "6px 10px" }}>Cerrar</button>
          </div>
        </div>
      )}

      {seguras.length > 0 && (
        <Seccion dato="seguras" titulo={`Coincidencias seguras para confirmar (${seguras.length})`} ayuda="Ya están registradas en BFK y el banco trae evidencia propia (RUT, nombre, persona o una referencia ya confirmada). Confirmar solo guarda el vínculo: no crea ni cambia registros.">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
            <button data-seleccionar-seguras onClick={() => setSelSeguras(new Set(seguras.map((x) => x.marca)))} disabled={!!progresoLote}
              style={{ ...btnG, flex: "1 1 200px", fontSize: 12, padding: "7px", borderColor: C.ok, color: C.okText }}>Seleccionar coincidencias seguras</button>
            {selSeguras.size > 0 && <button data-quitar-seleccion onClick={() => { setSelSeguras(new Set()); setRevisandoLote(false); setConfirmaLote(false); }} style={{ ...btnG, flex: "0 1 140px", fontSize: 12, padding: "7px" }}>Quitar selección</button>}
          </div>
          {seguras.map((sg) => (
            <div key={sg.marca} data-segura={sg.marca} data-grupo-seccion-item="seguras" style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <input type="checkbox" data-sel-segura={sg.marca} checked={selSeguras.has(sg.marca)} disabled={!!progresoLote}
                onChange={() => { alternarSegura(sg.marca); setConfirmaLote(false); }} aria-label={`Seleccionar ${sg.descripcion} ${fmt.money(sg.monto)}`} style={{ marginTop: 14, width: 18, height: 18, flexShrink: 0, cursor: "pointer" }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <Movimiento it={sg.item}>
                  <button data-no-corresponde-auto={sg.ids.join(",")} disabled={!!decidiendo || !!progresoLote} onClick={() => { setSelSeguras((x) => { const n = new Set(x); n.delete(sg.marca); return n; }); decidir(sg.item, "rechazado", sg.registros); }}
                    title="Si no es este registro, se descarta para este movimiento (no cambia el registro)." style={{ ...btnG, marginTop: 6, fontSize: 11, padding: "4px 10px" }}>No corresponde</button>
                </Movimiento>
              </div>
            </div>
          ))}
          {lote.length > 0 && !revisandoLote && (
            <button data-revisar-lote onClick={() => { setRevisandoLote(true); setConfirmaLote(false); }} style={{ ...btnP(C.ok), marginTop: 4 }}>Revisar y confirmar {lote.length} seleccionado{lote.length === 1 ? "" : "s"}</button>
          )}
          {lote.length > 0 && revisandoLote && (() => { const r = resumenLote(lote); return (
            <div data-resumen-lote style={{ background: C.paper, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 12px", marginTop: 4 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: C.ink, marginBottom: 4 }}>Resumen antes de confirmar</div>
              <div data-totales-lote style={{ fontSize: 12, color: C.inkMuted, marginBottom: 6 }}>
                {r.n} movimiento{r.n === 1 ? "" : "s"} · {r.abonos} abono{r.abonos === 1 ? "" : "s"} por <b style={{ fontFamily: MONO, color: C.okText }}>{fmt.money(r.totalAbonos)}</b> · {r.cargos} cargo{r.cargos === 1 ? "" : "s"} por <b style={{ fontFamily: MONO, color: C.dangerText }}>{fmt.money(r.totalCargos)}</b> · {r.registros} registro{r.registros === 1 ? "" : "s"} de BFK
              </div>
              {lote.map((sg) => (
                <div key={sg.marca} data-fila-lote={sg.marca} style={{ borderTop: `1px solid ${C.border}`, padding: "6px 0", fontSize: 12, lineHeight: 1.45 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ color: C.ink, fontWeight: 700, minWidth: 0, overflowWrap: "anywhere" }}>{fmt.date(sg.fecha)} · {sg.descripcion}</span>
                    <span style={{ fontFamily: MONO, whiteSpace: "nowrap", color: sg.dir === "entra" ? C.okText : C.dangerText }}>{sg.dir === "entra" ? "+" : "−"}{fmt.money(sg.monto)}</span>
                  </div>
                  <div style={{ color: C.inkMuted }}>Registro BFK: {sg.registros.map((x) => textoRegistro(x, categorias)).join(" + ")}</div>
                  <div style={{ color: C.inkFaint }}>Evidencia: {sg.evidencia || "—"}</div>
                </div>
              ))}
              <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12, color: C.ink, marginTop: 8, cursor: "pointer" }}>
                <input type="checkbox" data-confirmar-lote-check checked={confirmaLote} onChange={(e) => setConfirmaLote(e.target.checked)} style={{ marginTop: 2 }} disabled={!!progresoLote} />
                <span>Confirmo que cada movimiento corresponde al registro indicado. Solo se guarda el vínculo: no se crea ni modifica ningún cobro, gasto, pago ni devolución.</span>
              </label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                <button data-confirmar-lote disabled={!confirmaLote || !!progresoLote} onClick={confirmarLote}
                  style={{ ...btnP(C.ok), flex: "1 1 200px", opacity: confirmaLote && !progresoLote ? 1 : 0.5 }}>{progresoLote ? `Guardando ${progresoLote.hechos} de ${progresoLote.total}…` : `Confirmar ${lote.length} vínculo${lote.length === 1 ? "" : "s"}`}</button>
                <button data-cancelar-lote disabled={!!progresoLote} onClick={() => { setRevisandoLote(false); setConfirmaLote(false); }} style={{ ...btnG, flex: "0 1 120px", fontSize: 12 }}>Volver</button>
              </div>
            </div>); })()}
        </Seccion>
      )}

      <Seccion dato="revisar" titulo="Por revisar" ayuda="Hay un registro en BFK que podría ser este movimiento. Confirma o descarta." vacio="Nada por revisar.">
        {vista.revisar.map((it) => (
          <Movimiento key={it.marca} it={it} abierto={abierto === it.x.m.clave}>
            {it.tipo === "coincidencia" && it.opciones.map((op, k) => (
              <div key={k} data-opcion-revision style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 6, paddingTop: 6, borderTop: `1px dashed ${C.border}` }}>
                <span style={{ flex: "1 1 200px", fontSize: 12, color: C.ink }}>{op.grupo ? `Estos ${op.registros.length} registros juntos` : "Registro"}: {op.registros.map((r) => textoRegistro(r, categorias)).join(" + ")}</span>
                <button data-vincular-registro={op.registros.map((r) => r.id).join(",")} disabled={decisiones === null || !!decidiendo} onClick={() => decidir(it, "vinculado", op.registros)}
                  style={{ ...btnG, fontSize: 12, padding: "6px 10px", borderColor: C.ok, color: C.okText, opacity: decisiones === null ? 0.5 : 1 }}>Es este registro</button>
                <button data-rechazar={op.registros.map((r) => r.id).join(",")} disabled={decisiones === null || !!decidiendo} onClick={() => decidir(it, "rechazado", op.registros)}
                  style={{ ...btnG, fontSize: 12, padding: "6px 10px", opacity: decisiones === null ? 0.5 : 1 }}>No corresponde</button>
              </div>
            ))}
            {it.tipo === "coincidencia" && (it.opciones.length > 1 || !it.opciones.length) && (it.x.candidatos || []).length > 0 && (
              <button data-rechazar-todos disabled={decisiones === null || !!decidiendo} onClick={() => decidir(it, "rechazado", it.x.candidatos)}
                style={{ ...btnG, width: "100%", marginTop: 6, fontSize: 12, padding: "6px", opacity: decisiones === null ? 0.5 : 1 }}>Ninguno corresponde (pasa a «Sin registrar»)</button>
            )}
            {it.tipo === "vinculo_roto" && (
              <button data-anular-vinculo onClick={() => anular(it.decisiones.map((d) => d.id))} style={{ ...btnG, width: "100%", marginTop: 6, fontSize: 12, padding: "6px" }}>Anular el vínculo</button>
            )}
            {it.tipo === "vale_vista" && it.x.registrable && renderPreparar(it.x)}
          </Movimiento>
        ))}
      </Seccion>

      <Seccion dato="sin-registrar" titulo="Sin registrar" ayuda="Movimientos nuevos: identifícalos y regístralos (se pide confirmación)." vacio="No hay movimientos nuevos por registrar.">
        {serie && !serie.terminada && (
          <div data-serie style={{ background: C.tealLight, borderRadius: 10, padding: "9px 12px", marginBottom: 8, fontSize: 13, color: C.ink, lineHeight: 1.45 }}>
            <b>Registro {Math.min(serie.actual + 1, serie.claves.length)} de {serie.claves.length}</b> · {serie.hechos} registrado{serie.hechos === 1 ? "" : "s"}{serie.saltados ? ` · ${serie.saltados} saltado${serie.saltados === 1 ? "" : "s"}` : ""}. Cada uno se revisa y se confirma por separado; nada se crea solo.
            <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
              <button data-serie-saltar onClick={saltarEnSerie} disabled={guardando} style={{ ...btnG, fontSize: 12, padding: "6px 10px" }}>Saltar este</button>
              <button data-serie-terminar onClick={terminarSerie} disabled={guardando} style={{ ...btnG, fontSize: 12, padding: "6px 10px" }}>Terminar</button>
            </div>
          </div>
        )}
        {serie?.terminada && (
          <div data-serie-terminada role="status" style={{ background: C.okLight, borderRadius: 10, padding: "9px 12px", marginBottom: 8, fontSize: 13, color: C.ink }}>
            Serie terminada: {serie.hechos} registrado{serie.hechos === 1 ? "" : "s"}{serie.saltados ? `, ${serie.saltados} saltado${serie.saltados === 1 ? "" : "s"}` : ""}.
            <button data-serie-cerrar onClick={() => setSerie(null)} style={{ ...btnG, fontSize: 12, padding: "4px 10px", marginLeft: 8 }}>Cerrar</button>
          </div>
        )}
        {!serie && vista.sinRegistrar.some((it) => it.x.registrable) && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: C.inkMuted, flex: "1 1 200px" }}>Marca varios para registrarlos en serie: cada uno se revisa y confirma por separado.</span>
            {selNuevos.size > 0 && <button data-registrar-serie onClick={iniciarSerie} style={{ ...btnG, fontSize: 12, padding: "7px 10px", borderColor: C.teal, color: C.tealDark }}>Registrar {selNuevos.size} seleccionado{selNuevos.size === 1 ? "" : "s"}, uno por uno</button>}
          </div>
        )}
        {vista.sinRegistrar.map((it) => (
          <div key={it.marca} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            {!serie && it.x.registrable && (
              <input type="checkbox" data-sel-nuevo={it.marca} checked={selNuevos.has(it.marca)} onChange={() => alternarNuevo(it.marca)}
                aria-label={`Seleccionar ${it.x.m.descripcion} ${fmt.money(it.x.monto)}`} style={{ marginTop: 14, width: 18, height: 18, flexShrink: 0 }} />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <Movimiento it={{ ...it, posible: it.posible || sugerenciaCargo(it) }} abierto={abierto === it.x.m.clave}>
                {it.x.registrable && (!serie || abierto === it.x.m.clave) && renderPreparar(it.x)}
              </Movimiento>
            </div>
          </div>
        ))}
      </Seccion>

      {vista.registradosSinBanco.length > 0 && (
        <Seccion dato="registrado-sin-banco" titulo="Registrado en BFK, pendiente de verificar en banco" ayuda="Registros posteriores al cierre sin un movimiento en esta cartola. No se tratan como duplicados.">
          {vista.registradosSinBanco.map((s) => (
            <div key={s.r.tabla + s.r.id} data-registrado-sin-banco={s.r.id} data-pista={s.tipoPista} style={{ background: C.card, border: `1px solid ${C.border}`, borderLeft: `4px solid ${C.info}`, borderRadius: 12, padding: "9px 12px", marginBottom: 6 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{s.texto}</div>
              <Linea k="Qué pasa" v={s.pista} />
              <Linea k="Acción" v={s.accion} />
            </div>
          ))}
        </Seccion>
      )}

      {verConciliados && (
        <Seccion dato="ya" titulo="Ya registrados" ayuda={`Solo informativo: estos movimientos ya están en BFK y no crean nada nuevo.${seguras.length ? ` Los ${seguras.length} reconocidos aún sin confirmar están arriba, en «Coincidencias seguras».` : ""}`} vacio={seguras.length ? "Todos los reconocidos están arriba, por confirmar." : "Ninguno."}>
          {vista.ya.filter((it) => !marcaSegura.has(it.marca)).map((it) => (
            <Movimiento key={it.marca} it={it}>
              {it.x.origen === "decision" && onAnularDecision && (
                <button data-deshacer-vinculo onClick={() => anular(it.x.decisiones.map((d) => d.id))} style={{ ...btnG, marginTop: 6, fontSize: 11, padding: "4px 10px" }}>Deshacer vínculo</button>
              )}
              {it.reconocidoAuto && !it.x.anteriorCierre && (it.x.registros || []).length > 0 && (
                <button data-no-corresponde-auto={it.x.registros.map((r) => r.id).join(",")} disabled={decisiones === null || !!decidiendo} onClick={() => decidir(it, "rechazado", it.x.registros)}
                  title="Reconocido automáticamente. Si no es este registro, se descarta para este movimiento (no cambia el registro)."
                  style={{ ...btnG, marginTop: 6, fontSize: 11, padding: "4px 10px", opacity: decisiones === null ? 0.5 : 1 }}>No corresponde</button>
              )}
            </Movimiento>
          ))}
        </Seccion>
      )}

      {verAnteriores && (
        <Seccion dato="anteriores" titulo={`Antes del cierre (${fmt.date(cierre)})`} ayuda="Solo consulta: ya están incluidos en los saldos y el FIFO históricos.">
          {vista.anteriores.map((it) => <Movimiento key={it.marca} it={it} />)}
        </Seccion>
      )}

      </>)}

      {/* Totales del banco: también requieren confirmación (escriben banco_mensual y el registro de la cartola).
          Con una cartola en «Solo revisión» cargada no se guardan saldos (podrían quedar incompletos). */}
      {movs.length > 0 && onRegistrar && union.soloRevision.length > 0 && (
        <div data-totales-bloqueados style={{ fontSize: 12, color: C.inkMuted, marginTop: 12, lineHeight: 1.45 }}>No se pueden guardar los totales del banco mientras haya una cartola que no cuadra.</div>
      )}
      {movs.length > 0 && onRegistrar && union.soloRevision.length === 0 && (
        <div style={{ background: C.paper, borderRadius: 12, padding: "10px 12px", marginTop: 12 }}>
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
      <button onClick={() => { setCartolas([]); cerrar(); setVerConciliados(false); setVerAnteriores(false); setErr(""); }} style={{ ...btnG, width: "100%", marginTop: 8, fontSize: 12 }}>
        Empezar de nuevo
      </button>
    </div>
  );
}

// Cartola que no cuadra: diagnóstico en palabras simples y sus movimientos, SOLO para consultar (sin acciones).
function SoloRevision({ c }) {
  const [ver, setVer] = useState(false);
  return (
    <section data-solo-revision={c.nombre} style={{ background: C.card, border: `1px solid ${C.warn}`, borderRadius: 12, padding: "10px 12px", marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: C.ink }}>Solo revisión · {c.formato === "linea" ? "Cartola en línea" : "Cartola histórica"} · {fmt.date(c.desde)} a {fmt.date(c.hasta)}</span>
        <span style={{ fontSize: 11, fontWeight: 800, color: C.warnText, background: C.warnLight, borderRadius: 999, padding: "2px 8px" }}>SOLO REVISIÓN</span>
      </div>
      <div style={{ fontSize: 12, color: C.inkFaint, marginTop: 2 }}>{c.nombre}</div>
      <ul data-diagnostico style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12.5, color: C.ink, lineHeight: 1.5 }}>
        {c.diagnostico.map((d, i) => <li key={i} data-diferencia={d.tipo}>{d.texto}</li>)}
      </ul>
      <button data-ver-movimientos-revision onClick={() => setVer((v) => !v)} style={{ ...btnG, width: "100%", marginTop: 8, fontSize: 12, padding: "7px" }}>
        {ver ? "Ocultar movimientos" : `Ver sus ${c.movs.length} movimientos (solo consulta)`}
      </button>
      {ver && (
        <div data-movimientos-revision style={{ marginTop: 8 }}>
          {c.movs.map((m, i) => {
            const salto = c.diagnostico.find((d) => d.tipo === "salto" && d.fila === m.fila);
            return (
              <div key={i} data-mov-revision={`${m.fecha}|${m.cargo}|${m.abono}|${m.saldo}`} style={{ borderTop: `1px solid ${C.border}`, padding: "6px 0", fontSize: 12 }}>
                {salto && <div data-salto style={{ color: C.warnText, fontWeight: 700, marginBottom: 2 }}>⚠ Aquí el saldo {salto.diferencia < 0 ? "baja" : "sube"} {fmt.money(Math.abs(salto.diferencia))} sin un movimiento que lo explique</div>}
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ color: C.inkMuted, minWidth: 0, overflowWrap: "anywhere" }}>{fmt.date(m.fecha)}{m.operacion ? ` · op. ${m.operacion}` : ""} · {m.descripcion}</span>
                  <span style={{ fontFamily: MONO, fontWeight: 800, color: m.abono ? C.okText : C.dangerText, flexShrink: 0 }}>{m.abono ? "+" : "−"}{fmt.money(m.abono || m.cargo)}</span>
                </div>
                <div style={{ color: C.inkFaint, fontFamily: MONO, textAlign: "right" }}>saldo {fmt.money(m.saldo)}</div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

const mensajeDecision = (e) => {
  const t = String(e?.rpcCuerpo?.message || e?.message || e || "");
  if (/PGRST202|Could not find the function/i.test(t)) return "La base aún no guarda decisiones de conciliación (actualización pendiente): no se guardó nada.";
  // Otra sesión acaba de vincular ese registro o ese movimiento (índice único de la base): se recarga y no se guarda nada.
  if (/conc_dec_|duplicate key|23505|llave duplicada/i.test(t)) return "Otra persona acaba de vincular este registro o este movimiento. No se guardó nada; la lista se actualizó.";
  return t.replace(/^CONC:\s*/, "") || "No se pudo guardar la decisión.";
};

function Contador({ dato, etiqueta, n, tono }) {
  const t = TONO[tono] || TONO.neutro;
  return (
    <div data-contador={dato} style={{ padding: "8px 10px", borderRadius: 10, border: `1.5px solid ${n ? t.borde : C.border}`, background: n ? t.fondo : C.card }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: n ? t.texto : C.inkMuted }}>{etiqueta}</div>
      <div data-cuenta={dato} style={{ fontFamily: MONO, fontWeight: 800, fontSize: 18, color: n ? t.texto : C.inkMuted }}>{n}</div>
    </div>
  );
}

function Seccion({ dato, titulo, ayuda, vacio, children }) {
  const hijos = (Array.isArray(children) ? children.flat() : [children]).filter(Boolean);
  return (
    <section data-grupo-seccion={dato} style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: C.ink }}>{titulo}</div>
      {ayuda && <div style={{ fontSize: 12, color: C.inkFaint, marginBottom: 6 }}>{ayuda}</div>}
      {hijos.length ? hijos : vacio ? <div style={{ fontSize: 12, color: C.inkFaint, padding: "6px 0" }}>{vacio}</div> : null}
    </section>
  );
}

const Linea = ({ k, v, dato }) => v ? (
  <div data-linea={dato} style={{ display: "flex", gap: 6, fontSize: 12, marginTop: 3, lineHeight: 1.4 }}>
    <span style={{ color: C.inkFaint, flexShrink: 0, minWidth: 92 }}>{k}</span><span style={{ color: C.inkMuted, minWidth: 0, overflowWrap: "anywhere" }}>{v}</span>
  </div>) : null;

const TONO_GRUPO = { ya: "conciliado", revisar: "posible", "sin-registrar": "pendiente", anteriores: "neutro" };
function Movimiento({ it, abierto, children }) {
  const x = it.x, m = x.m;
  const grupo = x.estado === "conciliado" || x.estado === "neutro" ? "ya" : x.anteriorCierre ? "anteriores" : it.tipo ? "revisar" : "sin-registrar";
  const t = TONO[TONO_GRUPO[grupo]];
  return (
    <div data-mov={m.clave} data-estado={x.estado} data-grupo={grupo} data-tipo-revision={it.tipo || ""} style={{ background: C.card, border: `1px solid ${abierto ? C.tealDark : C.border}`, borderLeft: `4px solid ${t.borde}`, borderRadius: 12, padding: "9px 12px", marginBottom: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 12, color: C.inkMuted, minWidth: 0, overflowWrap: "anywhere" }}>{fmt.date(m.fecha)}{m.operacion ? ` · op. ${m.operacion}` : ""} · {m.descripcion}</span>
        <span style={{ fontFamily: MONO, fontWeight: 800, fontSize: 13, color: x.dir === "entra" ? C.okText : C.dangerText, flexShrink: 0 }}>{x.dir === "entra" ? "+" : "−"}{fmt.money(x.monto)}</span>
      </div>
      <div data-titulo-mov style={{ fontSize: 13, fontWeight: 700, color: t.texto, marginTop: 3 }}>{it.titulo}</div>
      <Linea dato="posible" k="Posible OC o categoría" v={it.posible} />
      <Linea dato="registro" k="Registro BFK" v={it.registros?.join(" · ")} />
      <Linea dato="motivo" k="Evidencia" v={it.motivo} />
      <Linea dato="falta" k="Falta" v={it.falta} />
      <Linea dato="antecedentes" k="Antecedentes" v={it.antecedentes} />
      {it.sucursal && x.dir === "entra" && /DEPOSITO/i.test(m.descripcion) && <Linea dato="sucursal" k="Sucursal" v={it.sucursal} />}
      {it.nota && it.nota !== it.registros?.join(" · ") && <Linea dato="nota" k="Detalle" v={it.nota} />}
      <Linea dato="accion" k="Acción" v={it.accion} />
      {it.aviso && <div data-aviso-gemelo style={{ fontSize: 12, color: C.warnText, marginTop: 4, fontWeight: 600 }}>{it.aviso}</div>}
      {children}
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
        {sugerencia && <div style={{ fontSize: 12, color: C.inkFaint, marginBottom: 5 }}>Sugerencia (no se aplica sola): {sugerencia.nombre}</div>}
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
        <div data-confirmacion style={{ background: C.warnLight, border: `1px solid ${C.warn}`, borderRadius: 8, padding: "9px 11px", marginTop: 8, fontSize: 12, color: C.ink, lineHeight: 1.45 }}>
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
          style={{ ...btnP(guardando || problema || !confirmo ? C.inkFaint : C.ok), flex: 2, fontSize: 13, padding: "8px" }}>
          {guardando ? "Registrando…" : "Registrar este movimiento"}
        </button>
      </div>
    </div>
  );
}

// Registros (de los datos leídos) cuyos ids informa la base como posible duplicado manual.
function registrosPorId(d, ids) {
  const quiero = new Set(ids || []), r = [];
  const agrega = (tipo, x, detalle) => { if (x && quiero.has(String(x.id))) r.push({ id: x.id, tipo, fecha: x.fecha, monto: Number(x.monto_transferido ?? x.monto) || 0, detalle }); };
  for (const o of d?.ocs || []) {
    (o.eventos_pago_cliente || []).forEach((e) => agrega("Cobro", e, `${o.numero_oc} · ${e.notas || ""}`));
    (o.eventos_pago_financiamiento || []).forEach((e) => agrega("Pago a financiador", e, o.numero_oc));
  }
  (d?.pagoFinSueltos || []).forEach((e) => agrega("Pago a financiador", e, "sin OC"));
  (d?.gastos || []).forEach((g) => agrega("Gasto", g, g.detalle || ""));
  (d?.pagosVendedor || []).forEach((p) => agrega("Pago a vendedor", p, p.notas || ""));
  (d?.aportes || []).forEach((a) => agrega(a.tipo === "retiro" ? "Retiro de capital" : "Aporte", a, a.socio || ""));
  return r;
}

// La base encontró un registro MANUAL que podría ser este mismo movimiento. Nada viene elegido: el usuario decide.
function DuplicadoManual({ dup, guardando, onVincular, onDistinto }) {
  return (
    <div data-duplicado-manual style={{ marginTop: 8, padding: "10px 12px", borderRadius: 12, background: C.warnLight, border: `1px solid ${C.warn}`, fontSize: 13 }}>
      <div style={{ fontWeight: 700, color: C.warnText, marginBottom: 6 }}>Ya existe un registro manual que podría ser este mismo movimiento</div>
      {(dup.registros.length ? dup.registros : dup.ids.map((id) => ({ id, tipo: "Registro", detalle: "" }))).map((r) => (
        <div key={r.id} data-registro-manual={r.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "3px 0" }}>
          <span>{r.tipo} · {r.fecha ? fmt.date(r.fecha) : ""} {r.detalle ? `· ${r.detalle}` : ""}</span>
          <span style={{ fontFamily: MONO }}>{r.monto ? fmt.money(r.monto) : ""}</span>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button data-vincular disabled={guardando} onClick={onVincular} style={{ ...btnG, flex: 1, fontSize: 12, padding: "8px" }}>Es este registro (vincular, no crea nada)</button>
        <button data-distinto disabled={guardando} onClick={onDistinto} style={{ ...btnG, flex: 1, fontSize: 12, padding: "8px" }}>Es otra operación (registrar igual)</button>
      </div>
    </div>
  );
}
