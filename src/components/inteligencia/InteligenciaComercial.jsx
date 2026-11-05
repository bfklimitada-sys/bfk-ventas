// Inteligencia Comercial de Compra Ágil (04/11/2026). Se carga bajo demanda desde el Panel Principal (al abrir su
// desplegable): no afecta la apertura del Panel aunque ChileCompra o la base no respondan. Solo análisis: no modifica
// cotizaciones, OCs ni finanzas. Indicadores y detalle salen de la base (ic_resumen / ic_detalle) o, si la migración
// aún no está instalada, del cálculo local equivalente con los estados de las cotizaciones.
// 05/11/2026: criterio de fecha (presentación o adjudicación), avance real de la sincronización con pausas, cancelación
// y reanudación, indicadores de cobertura (sin consultar / en proceso / por verificar) y avisos separados por tipo.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { C, MONO, SANS, fmt, iStyle, selStyle } from "../../lib/theme";
import { Tarjeta, Badge, Indicador, Indicadores, AvisoLinea, BotonSecundario, Ayuda, Desplegable } from "../ui/Sistema";
import { RESULTADOS, NO_DISPONIBLE, POR_VERIFICAR, FUENTE_OFICIAL, periodoDe, hojasInforme, csvInforme, nombreArchivo } from "../../lib/inteligenciaComercial";
import { crearFuente, controlSincronizacion } from "../../lib/inteligenciaDatos";
import { plural, textoConteo, textoCola, mensajeFinal } from "../../lib/inteligenciaMensajes";
import { BarrasResultado, Dona, LineaMensual, BarrasCompetidores, ComparacionMontos } from "./Graficos";
import { importarModulo } from "../../lib/cargaModulos";

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const POR_PAGINA = 15; const AUTO_HORAS = 12; const CLAVE_AUTO = "bfk_ic_auto_sinc";
const SINC_AUTO = { maxRondas: 40, maxMinutos: 15, maxPausasSeguidas: 4, maxSinAvance: 2, maxFallasRed: 1, maxEnCurso: 1, pausaMaxMs: 120_000, esperaRedMs: 5_000, esperaEnCursoMs: 15_000 };   // automática: más acotada
const hoyChile = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(new Date());
const pct = (x) => (x === null || x === undefined ? "—" : `${String(x).replace(".", ",")}%`);
const ESTADO_PROCESO = { publicada: "Publicada", cerrada: "Cerrada (en evaluación)", proveedor_seleccionado: "Proveedor seleccionado", oc_emitida: "OC emitida", desierta: "Desierta", cancelada: "Cancelada", no_encontrada: "No encontrada en ChileCompra", sin_informacion: "Sin información" };
const VERIF = { sin_consultar: "Sin consultar en ChileCompra", sin_codigo: "Sin código de Compra Ágil", no_compra_agil: "No es Compra Ágil", en_proceso: "Proceso abierto o en evaluación", por_verificar: POR_VERIFICAR, verificado: "Verificado" };
const hace = (iso) => { if (!iso) return null; const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000); return m < 1 ? "recién" : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.floor(m / 60)} h` : `hace ${Math.floor(m / 1440)} d`; };
const lbl = { fontSize: 12, fontWeight: 800, color: C.inkMuted, display: "block", marginBottom: 3 };

export default function InteligenciaComercial({ token, perfil, escritorio }) {
  const esAdmin = perfil?.rol === "admin";
  const tokenRef = useRef(token); tokenRef.current = token;
  const fuente = useMemo(() => crearFuente(() => (typeof tokenRef.current === "function" ? tokenRef.current() : tokenRef.current)), []);
  const hoy = hoyChile(); const [anioHoy, mesHoy] = [Number(hoy.slice(0, 4)), Number(hoy.slice(5, 7))];
  const [per, setPer] = useState({ tipo: "anio", anio: anioHoy, mes: mesHoy, desde: "2026-10-01", hasta: hoy });
  const [fil, setFil] = useState({ institucion: "", vendedor: "", resultado: "", criterio: "presentacion" });
  const [res, setRes] = useState(null); const [cargando, setCargando] = useState(true); const [error, setError] = useState("");
  const [det, setDet] = useState({ q: "", orden: "fecha_presentacion", desc: true, pagina: 0 }); const [detalle, setDetalle] = useState({ filas: [], total: 0 }); const [cargandoDet, setCargandoDet] = useState(false);
  const [opc, setOpc] = useState({ instituciones: [], vendedores: [], sinVendedor: false });
  const [sincEst, setSincEst] = useState(controlSincronizacion.estado); const [msjSinc, setMsjSinc] = useState(null); const [exportando, setExportando] = useState(""); const [recarga, setRecarga] = useState(0);
  const [, setReloj] = useState(0);   // cuenta regresiva de la pausa
  const sinc = sincEst.activa ? sincEst.progreso || {} : null;
  const [verTabla, setVerTabla] = useState(false);
  const periodo = useMemo(() => periodoDe(per), [per]);
  const filtros = useMemo(() => ({ ...periodo, ...fil }), [periodo, fil]);
  const anios = useMemo(() => { const xs = []; for (let a = Math.max(anioHoy, 2026); a >= 2026; a--) xs.push(a); return xs; }, [anioHoy]);

  // Indicadores y gráficos: se recalculan al cambiar cualquier filtro (con espera breve y cancelación de la consulta anterior).
  useEffect(() => {
    const ctrl = new AbortController(); setCargando(true); setError("");
    const t = setTimeout(() => {
      fuente.resumen(filtros, { signal: ctrl.signal }).then((r) => { if (!ctrl.signal.aborted) { setRes(r); setCargando(false); } })
        .catch((e) => { if (e?.name !== "AbortError" && !ctrl.signal.aborted) { setError(e.message || "No se pudieron cargar los indicadores."); setCargando(false); } });
    }, 250);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [filtros, recarga, fuente]);
  useEffect(() => { setDet((d) => ({ ...d, pagina: 0 })); }, [filtros]);
  // Al cambiar el criterio, el detalle se ordena por la fecha de ese criterio.
  useEffect(() => { setDet((d) => ({ ...d, orden: fil.criterio === "adjudicacion" ? "fecha_adjudicacion" : d.orden === "fecha_adjudicacion" ? "fecha_presentacion" : d.orden, desc: true, pagina: 0 })); }, [fil.criterio]);
  // Detalle paginado (solo si la tabla está abierta).
  useEffect(() => {
    if (!verTabla) return undefined;
    const ctrl = new AbortController(); setCargandoDet(true);
    const t = setTimeout(() => {
      fuente.detalle(filtros, { ...det, porPagina: POR_PAGINA }, { signal: ctrl.signal }).then((d) => { if (!ctrl.signal.aborted) { setDetalle(d); setCargandoDet(false); } })
        .catch((e) => { if (e?.name !== "AbortError" && !ctrl.signal.aborted) { setDetalle({ filas: [], total: 0, error: e.message }); setCargandoDet(false); } });
    }, 250);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [verTabla, filtros, det, recarga, fuente]);
  useEffect(() => { const ctrl = new AbortController(); fuente.opciones({ signal: ctrl.signal }).then(setOpc).catch(() => {}); return () => ctrl.abort(); }, [fuente, recarga]);

  // Sincronización: una sola por pestaña (sigue aunque se cierre el desplegable). Se refrescan los indicadores durante el
  // avance (cada 20 s como máximo) y al terminar se muestra el resultado diferenciado.
  const ultimoResultado = useRef(controlSincronizacion.estado.resultado); const ultimoRefresco = useRef(0);
  useEffect(() => controlSincronizacion.suscribir((e) => {
    setSincEst(e);
    if (e.resultado && e.resultado !== ultimoResultado.current) { ultimoResultado.current = e.resultado; setMsjSinc(mensajeFinal(e.resultado)); fuente.invalidar(); setRecarga((n) => n + 1); }
    else if (e.activa && e.progreso?.procesados && Date.now() - ultimoRefresco.current > 20_000) { ultimoRefresco.current = Date.now(); fuente.invalidar(); setRecarga((n) => n + 1); }
  }), [fuente]);
  useEffect(() => { if (sinc?.fase !== "pausa") return undefined; const t = setInterval(() => setReloj((n) => n + 1), 1000); return () => clearInterval(t); }, [sinc?.fase]);
  const sincronizar = useCallback(({ forzar = false, origen = "manual" } = {}) => {
    if (controlSincronizacion.estado.activa) return; setMsjSinc(null); ultimoRefresco.current = Date.now();
    controlSincronizacion.iniciar(() => tokenRef.current && (typeof tokenRef.current === "function" ? tokenRef.current() : tokenRef.current),
      { forzar, origen, ...(origen === "automatica" ? { lim: { ...SINC_AUTO } } : {}) });
  }, []);
  // Sincronización automática (solo administradores, en segundo plano, una vez por sesión si la última tiene más de 12 h).
  useEffect(() => {
    if (!esAdmin || !res || !["base", "base_v1"].includes(fuente.modo)) return;
    const ult = res.ultima_sincronizacion; let ya = false; try { ya = sessionStorage.getItem(CLAVE_AUTO) === "1"; } catch { /* sin almacenamiento */ }
    if (ya || (ult && Date.now() - new Date(ult).getTime() < AUTO_HORAS * 3600_000)) return;
    try { sessionStorage.setItem(CLAVE_AUTO, "1"); } catch { /* sin almacenamiento */ }
    sincronizar({ origen: "automatica" });
  }, [esAdmin, res, fuente, sincronizar]);

  const exportar = async (tipo) => {
    setExportando(tipo);
    try {
      const filas = await fuente.todas(filtros); const meta = { generado: new Date().toISOString(), ultimaSincronizacion: res?.ultima_sincronizacion || null, modo: fuente.modo };
      if (tipo === "csv") {
        const b = new Blob([csvInforme(res, filas, meta)], { type: "text/csv;charset=utf-8" }); const a = document.createElement("a");
        a.href = URL.createObjectURL(b); a.download = nombreArchivo(periodo, "csv", res?.criterio); document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      } else {
        const XLSX = await importarModulo(() => import("xlsx")); const h = hojasInforme(res, filas, meta); const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(h.Resumen), "Resumen");
        for (const k of ["Por mes", "Oportunidades", "Empresas adjudicadas"]) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(h[k].length ? h[k] : [{ "": "Sin datos en el período" }]), k);
        XLSX.writeFile(wb, nombreArchivo(periodo, "xlsx", res?.criterio));
      }
    } catch (e) { setMsjSinc({ tono: "danger", texto: `No se pudo exportar: ${e.message}` }); }
    finally { setExportando(""); }
  };

  const I = res?.indicadores; const filtrar = (k) => setFil((f) => ({ ...f, resultado: f.resultado === k ? "" : k }));
  const adj = (res?.criterio || I?.criterio) === "adjudicacion"; const critDisp = fuente.criterioAdjudicacionDisponible;
  const faltan = I ? (I.sin_consultar || 0) + (I.pendientes_por_verificar || 0) : 0;   // sin resultado de ChileCompra aún
  const pausaSeg = sinc?.fase === "pausa" && sinc.pausa_hasta ? Math.max(0, Math.ceil((sinc.pausa_hasta - Date.now()) / 1000)) : 0;
  const textoPausa = { chilecompra: `ChileCompra pidió bajar la velocidad: se reanuda en ${pausaSeg} s`, bfk: `Pausa breve para respetar el límite de BFK: se reanuda en ${pausaSeg} s`,
    red: `Sin conexión: se reintenta en ${pausaSeg} s`, en_curso: `Otra sincronización en curso: se reintenta en ${pausaSeg} s`,
    reintento: `Esperando para reintentar los resultados que ChileCompra no entregó: ${pausaSeg} s` }[sinc?.motivo_pausa] || `Pausa: se reanuda en ${pausaSeg} s`;
  const barras = I ? [
    { k: "ganada", label: "Ganadas", corto: "Ganadas", n: I.ganadas, color: RESULTADOS.ganada.color },
    { k: "perdida", label: "Perdidas", corto: "Perdidas", n: I.perdidas, color: RESULTADOS.perdida.color },
    { k: "pendiente", label: "Pendientes", corto: "Pendientes", n: I.pendientes, color: RESULTADOS.pendiente.color },
    { k: "desierta", label: "Desiertas o canceladas", corto: "Desier./canc.", n: I.desiertas + I.canceladas, color: RESULTADOS.desierta.color },
  ] : [];
  const dona = I ? [...barras, { k: "sin_oferta_bfk", label: "BFK no figura entre las ofertas", n: I.sin_oferta_bfk, color: RESULTADOS.sin_oferta_bfk.color }] : [];
  const etiquetaPeriodo = (adj ? "Por fecha de adjudicación · " : "Por fecha de presentación · ") + (per.tipo === "mes" ? `${MESES[per.mes - 1]} ${per.anio}` : per.tipo === "anio" ? `Año ${per.anio}` : `${periodo.desde ? fmt.date(periodo.desde) : "inicio"} – ${periodo.hasta ? fmt.date(periodo.hasta) : "hoy"}`);
  const local = fuente.modo === "local";

  return (
    <div data-inteligencia style={{ fontFamily: SANS }}>
      {/* ── Filtros (una fila en escritorio) ── */}
      <Tarjeta padding="12px" style={{ marginBottom: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: escritorio ? "repeat(auto-fit,minmax(140px,1fr))" : "repeat(2,minmax(0,1fr))", gap: 8, alignItems: "end" }}>
          <label><span style={lbl}>Fecha según</span>
            <select data-filtro="criterio" value={critDisp ? fil.criterio : "presentacion"} disabled={!critDisp} title={critDisp ? "" : "Disponible al instalar la actualización de la base (05/11/2026)"}
              onChange={(e) => setFil((f) => ({ ...f, criterio: e.target.value, resultado: e.target.value === "adjudicacion" && f.resultado === "pendiente" ? "" : f.resultado }))} style={selStyle}>
              <option value="presentacion">Presentación</option><option value="adjudicacion">Adjudicación</option></select></label>
          <label><span style={lbl}>Período</span>
            <select data-filtro="tipo" value={per.tipo} onChange={(e) => setPer((p) => ({ ...p, tipo: e.target.value }))} style={selStyle}>
              <option value="mes">Mes</option><option value="anio">Año</option><option value="rango">Personalizado</option></select></label>
          {per.tipo !== "rango" && <label><span style={lbl}>Año</span>
            <select data-filtro="anio" value={per.anio} onChange={(e) => setPer((p) => ({ ...p, anio: Number(e.target.value) }))} style={selStyle}>{anios.map((a) => <option key={a} value={a}>{a}</option>)}</select></label>}
          {per.tipo === "mes" && <label><span style={lbl}>Mes</span>
            <select data-filtro="mes" value={per.mes} onChange={(e) => setPer((p) => ({ ...p, mes: Number(e.target.value) }))} style={selStyle}>{MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></label>}
          {per.tipo === "rango" && <><label><span style={lbl}>Desde</span><input data-filtro="desde" type="date" value={per.desde} onChange={(e) => setPer((p) => ({ ...p, desde: e.target.value }))} style={iStyle} /></label>
            <label><span style={lbl}>Hasta</span><input data-filtro="hasta" type="date" value={per.hasta} onChange={(e) => setPer((p) => ({ ...p, hasta: e.target.value }))} style={iStyle} /></label></>}
          <label><span style={lbl}>Institución</span>
            <input data-filtro="institucion" list="ic-instituciones" value={fil.institucion} placeholder="Todas" onChange={(e) => setFil((f) => ({ ...f, institucion: e.target.value }))} style={iStyle} />
            <datalist id="ic-instituciones">{opc.instituciones.map((i) => <option key={i} value={i} />)}</datalist></label>
          <label><span style={lbl}>Vendedor BFK</span>
            <select data-filtro="vendedor" value={fil.vendedor} onChange={(e) => setFil((f) => ({ ...f, vendedor: e.target.value }))} style={selStyle}>
              <option value="">Todos</option>{opc.vendedores.map((v) => <option key={v} value={v}>{v}</option>)}{opc.sinVendedor && <option value="__sin__">Sin vendedor</option>}</select></label>
          <label><span style={lbl}>Adjudicación</span>
            <select data-filtro="resultado" value={fil.resultado} onChange={(e) => setFil((f) => ({ ...f, resultado: e.target.value }))} style={selStyle}>
              <option value="">Todas</option>{Object.entries(RESULTADOS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
          {esAdmin && !local && <BotonSecundario data-sincronizar onClick={() => sincronizar({ origen: "manual" })} disabled={!!sinc} activo>{sinc ? `Sincronizando… ${sinc.procesados || 0}` : "↻ Actualizar resultados"}</BotonSecundario>}
          {esAdmin && sinc && <BotonSecundario data-cancelar-sinc onClick={() => controlSincronizacion.cancelar()}>Cancelar</BotonSecundario>}
          {!esAdmin && !local && <span style={{ fontSize: 12, color: C.inkFaint }}>La consulta a ChileCompra la hace un administrador.</span>}
          <BotonSecundario data-recalcular onClick={() => { fuente.invalidar(); setRecarga((n) => n + 1); }} disabled={cargando}>Recalcular</BotonSecundario>
          <BotonSecundario data-exportar="xlsx" onClick={() => exportar("xlsx")} disabled={!res || !!exportando}>{exportando === "xlsx" ? "Exportando…" : "Excel"}</BotonSecundario>
          <BotonSecundario data-exportar="csv" onClick={() => exportar("csv")} disabled={!res || !!exportando}>{exportando === "csv" ? "Exportando…" : "CSV"}</BotonSecundario>
          {(fil.institucion || fil.vendedor || fil.resultado) && <BotonSecundario data-limpiar onClick={() => setFil((f) => ({ ...f, institucion: "", vendedor: "", resultado: "" }))}>Quitar filtros</BotonSecundario>}
        </div>
        <div data-estado-sinc style={{ fontSize: 12, color: C.inkFaint, marginTop: 8, lineHeight: 1.45 }}>
          {etiquetaPeriodo} · Fuente oficial: {FUENTE_OFICIAL} · Última sincronización: {res?.ultima_sincronizacion ? `${fmt.datetime(res.ultima_sincronizacion)} (${hace(res.ultima_sincronizacion)})` : NO_DISPONIBLE}
          <Ayuda>Fecha según: «Fecha de presentación» agrupa por el día en que BFK presentó la cotización (incluye pendientes). «Fecha de adjudicación» agrupa por la fecha del resultado informada por ChileCompra (último cambio de estado al quedar seleccionado, desierto o cancelado) y cuenta solo oportunidades con resultado; las pendientes no tienen fecha de adjudicación. Los dos criterios no se mezclan. Se cuentan solo cotizaciones presentadas, adjudicadas o no adjudicadas (no borradores, listas ni descartadas). Una Compra Ágil con varios productos o varias cotizaciones cuenta una vez. Tasa de éxito = ganadas ÷ (ganadas + perdidas) × 100: pendientes, desiertas y canceladas no son pérdidas. El resultado analítico no cambia el estado de las cotizaciones ni crea OCs. La comparación de precios usa el total a pagar por el comprador y solo cuando ambas ofertas tienen la misma base tributaria (afecta o exenta); no se asume que BFK perdió solo por precio.</Ayuda>
        </div>
      </Tarjeta>
      {local && <AvisoLinea dato="ic-local" tono="info" icono="ℹ">Módulo pendiente de instalación en la base: se muestran solo los estados registrados en Cotizaciones (sin resultados de ChileCompra).</AvisoLinea>}
      {sinc && <AvisoLinea dato="ic-sinc-avance" tono={sinc.fase === "pausa" ? "warn" : "info"} icono={sinc.fase === "pausa" ? "⚠" : "ℹ"}>
        {sinc.fase === "pausa" ? `${textoPausa}. ` : "Consultando ChileCompra… "}{textoConteo(sinc)}{textoCola(sinc.cola)}{sincEst.origen === "automatica" ? " (automática)" : ""}</AvisoLinea>}
      {msjSinc && !sinc && <AvisoLinea dato="ic-sinc" tono={msjSinc.tono}>{msjSinc.texto}</AvisoLinea>}
      {adj && I && <AvisoLinea dato="ic-criterio" tono="info" icono="ℹ">Criterio: fecha de adjudicación informada por ChileCompra. Solo se cuentan oportunidades con resultado en el período; las pendientes no tienen fecha de adjudicación{I.sin_fecha_adjudicacion ? ` (${plural(I.sin_fecha_adjudicacion, "resultado", "resultados")} sin fecha informada no se incluyen)` : ""}.</AvisoLinea>}
      {!adj && I && faltan > 0 && !local && <AvisoLinea dato="ic-cobertura" tono="warn" accion={esAdmin && !sinc ? "Actualizar" : undefined} onClick={esAdmin && !sinc ? () => sincronizar({ origen: "manual" }) : undefined}>
        Indicadores parciales: {plural(faltan, "oportunidad", "oportunidades")} del período aún sin resultado de ChileCompra ({I.sin_consultar || 0} sin consultar · {I.pendientes_por_verificar || 0} por verificar). Las ganadas, perdidas y la tasa consideran solo las ya resueltas.</AvisoLinea>}
      {error && <AvisoLinea dato="ic-error" tono="danger" accion="Reintentar" onClick={() => { fuente.invalidar(); setRecarga((n) => n + 1); }}>{error}</AvisoLinea>}
      {(I?.ganadas_sin_regularizar ?? 0) > 0 && <AvisoLinea dato="ic-avisos-ganadas" tono="warn" onClick={() => { setFil((f) => ({ ...f, resultado: "ganada" })); setVerTabla(true); }} accion="Ver">
        {plural(I.ganadas_sin_regularizar, "adjudicación ganada", "adjudicaciones ganadas")} según ChileCompra {I.ganadas_sin_regularizar === 1 ? "sigue" : "siguen"} «presentada{I.ganadas_sin_regularizar === 1 ? "" : "s"}» en Cotizaciones (regularizar allí; este módulo no la cambia)</AvisoLinea>}
      {(I?.otros_avisos ?? (I?.ganadas_sin_regularizar === undefined ? I?.avisos : 0)) > 0 && <AvisoLinea dato="ic-avisos" tono="warn" onClick={() => { setFil((f) => ({ ...f, resultado: "" })); setVerTabla(true); }} accion="Ver">
        {plural(I.otros_avisos ?? I.avisos, "oportunidad", "oportunidades")} donde ChileCompra informa un resultado distinto del registrado en Cotizaciones</AvisoLinea>}

      {/* ── Indicadores principales ── */}
      <div style={{ opacity: cargando && res ? 0.55 : 1, transition: "opacity .15s" }} aria-busy={cargando}>
        {!res && cargando ? <Tarjeta><div style={{ fontSize: 13, color: C.inkMuted }}>Calculando indicadores…</div></Tarjeta> : I && (<>
          <Indicadores columnas={escritorio ? 4 : 2}>
            <Indicador dato="ic-presentadas" etiqueta={adj ? "Oportunidades resueltas" : "Cotizaciones presentadas"} valor={I.presentadas} nota={adj ? "Con resultado informado en el período · una por Compra Ágil" : "Efectivamente enviadas · una por Compra Ágil"} />
            <Indicador dato="ic-ofertado" etiqueta="Monto ofertado (neto)" valor={fmt.money(I.monto_ofertado_neto)} nota={`IVA ${fmt.money(I.monto_ofertado_impuesto)} · total ${fmt.money(I.monto_ofertado_total)}`} />
            <Indicador dato="ic-ganadas" etiqueta="Adjudicaciones ganadas" valor={I.ganadas} tono="ok" onClick={() => filtrar("ganada")} nota={I.ganadas_sin_regularizar ? `${I.ganadas_sin_regularizar} aún «presentada${I.ganadas_sin_regularizar === 1 ? "" : "s"}» en Cotizaciones · tocar para filtrar` : "Tocar para filtrar"} />
            <Indicador dato="ic-adjudicado" etiqueta="Monto adjudicado a BFK (neto)" valor={fmt.money(I.monto_ganado_neto)} tono="ok" nota={`Precio ofertado en las ganadas · total ${fmt.money(I.monto_ganado_total)}`} />
            <Indicador dato="ic-perdidas" etiqueta="Oportunidades perdidas" valor={I.perdidas} tono={I.perdidas ? "danger" : "neutro"} onClick={() => filtrar("perdida")} nota={I.perdidas_sin_adjudicatario ? `${I.perdidas_sin_adjudicatario} sin adjudicatario conocido` : "Con resultado verificado o registrado"} />
            {adj ? <Indicador dato="ic-pendientes" etiqueta="Oportunidades pendientes" valor="—" tono="neutro" nota={`Sin fecha de adjudicación: ver «Fecha de presentación» · ${I.desiertas + I.canceladas} desierta${I.desiertas + I.canceladas === 1 ? "" : "s"} o cancelada${I.desiertas + I.canceladas === 1 ? "" : "s"} aparte`} />
              : <Indicador dato="ic-pendientes" etiqueta="Oportunidades pendientes" valor={I.pendientes} tono={I.pendientes ? "warn" : "neutro"} onClick={() => filtrar("pendiente")}
                nota={[I.sin_consultar ? `${I.sin_consultar} sin consultar` : "", I.en_proceso ? `${I.en_proceso} en proceso` : "", I.pendientes_por_verificar ? `${I.pendientes_por_verificar} por verificar` : "",
                  `${I.desiertas + I.canceladas} desierta${I.desiertas + I.canceladas === 1 ? "" : "s"} o cancelada${I.desiertas + I.canceladas === 1 ? "" : "s"} aparte`].filter(Boolean).join(" · ")} />}
            <Indicador dato="ic-tasa" destacado etiqueta="Tasa de éxito comercial" valor={I.tasa_exito === null ? "—" : pct(I.tasa_exito)} tono="marca" nota={I.tasa_exito === null ? "Sin ganadas ni perdidas en el período" : `${I.ganadas} ÷ (${I.ganadas} + ${I.perdidas})${!adj && faltan ? " · parcial" : ""}`} />
            <Indicador dato="ic-diferencia" etiqueta="Diferencia vs precio adjudicado" valor={I.comparables ? pct(I.diferencia_pct_ponderada) : "—"} tono={I.comparables ? (I.diferencia_pct_ponderada > 0 ? "danger" : "ok") : "neutro"}
              nota={I.comparables ? `${I.comparables} comparable${I.comparables > 1 ? "s" : ""} · ${fmt.money(I.diferencia_total)} · mediana ${pct(I.diferencia_pct_mediana)}` : "Sin perdidas comparables (misma base tributaria)"} />
          </Indicadores>
          {/* ── Gráficos ── */}
          <div style={{ display: "grid", gridTemplateColumns: escritorio ? "repeat(2,minmax(0,1fr))" : "minmax(0,1fr)", gap: 10, marginBottom: 12 }}>
            <BarrasResultado datos={barras} activo={fil.resultado} onSeleccionar={filtrar} />
            <Dona datos={dona} activo={fil.resultado} onSeleccionar={filtrar} />
            <LineaMensual meses={res.por_mes} series={[{ k: "presentadas", label: adj ? "Resueltas" : "Presentadas", color: "#2A78D6" }, { k: "ganadas", label: "Ganadas", color: RESULTADOS.ganada.color }, { k: "perdidas", label: "Perdidas", color: RESULTADOS.perdida.color }]}
              nota={adj ? "Oportunidades resueltas por mes de adjudicación (fecha informada por ChileCompra)" : undefined} />
            <BarrasCompetidores items={res.competidores} />
            <div style={{ gridColumn: escritorio ? "1 / -1" : undefined }}><ComparacionMontos meses={res.por_mes} /></div>
          </div>
        </>)}
      </div>

      {/* ── Detalle de oportunidades y competidores ── */}
      <Desplegable dato="ic-detalle" titulo="Detalle de oportunidades" resumen={`${I ? I.presentadas + I.sin_oferta_bfk : "…"} en el período · búsqueda, orden y páginas`} onAbrir={() => setVerTabla(true)} abiertoInicial={verTabla}>
        <TablaDetalle det={det} setDet={setDet} detalle={detalle} cargando={cargandoDet} escritorio={escritorio} adj={adj} />
      </Desplegable>
    </div>
  );
}

const COLS = [
  { k: "fecha_presentacion", t: "Fecha" }, { k: "codigo", t: "Código" }, { k: "institucion", t: "Institución" }, { k: "vendedor_nombre", t: "Vendedor" },
  { k: "oferta_total", t: "Ofertado BFK", num: true }, { k: "resultado", t: "Resultado" }, { k: "adjudicatario_nombre", t: "Empresa adjudicada" },
  { k: "adjudicado_total", t: "Adjudicado", num: true }, { k: "diferencia", t: "Diferencia", num: true }, { k: "diferencia_pct", t: "Dif. %", num: true },
];
function Adjudicatario({ o }) {
  if (o.adjudicatario_nombre) return <><span style={{ display: "block", fontWeight: 700 }}>{o.adjudicatario_nombre}</span>{o.adjudicatario_rut && <span style={{ fontSize: 12, color: C.inkFaint, fontFamily: MONO }}>{o.adjudicatario_rut}</span>}</>;
  if (o.resultado === "ganada") return <span style={{ color: C.okText, fontWeight: 700 }}>BFK</span>;
  if (o.resultado === "perdida" || o.verificacion === "por_verificar") return <span data-no-disponible style={{ color: C.warnText }}>{o.verificacion === "por_verificar" ? POR_VERIFICAR : NO_DISPONIBLE}</span>;
  return <span style={{ color: C.inkFaint }}>—</span>;
}
const Dif = ({ o }) => o.comparable ? <span style={{ fontFamily: MONO, fontWeight: 800, color: o.diferencia > 0 ? C.dangerText : C.okText }}>{o.diferencia > 0 ? "+" : ""}{fmt.money(o.diferencia)}</span>
  : <span style={{ fontSize: 12, color: C.inkFaint }}>{o.motivo_no_comparable || "—"}</span>;
const Res = ({ o }) => <span style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}><Badge tono={RESULTADOS[o.resultado]?.tono}>{RESULTADOS[o.resultado]?.label || o.resultado}</Badge>
  <span style={{ fontSize: 11, color: C.inkFaint }}>{o.estado_proceso ? ESTADO_PROCESO[o.estado_proceso] : VERIF[o.verificacion] || ""}</span></span>;
const Codigo = ({ o }) => o.enlace_mp ? <a href={o.enlace_mp} target="_blank" rel="noopener noreferrer" data-enlace-mp style={{ fontFamily: MONO, fontWeight: 700, color: C.tealDark }}>{o.codigo} ↗</a>
  : <span style={{ fontFamily: MONO, fontWeight: 700 }}>{o.codigo || "(sin código)"}</span>;

function TablaDetalle({ det, setDet, detalle, cargando, escritorio, adj }) {
  const COLS_V = adj ? [{ k: "fecha_adjudicacion", t: "Adjudicación" }, ...COLS] : COLS;
  const paginas = Math.max(1, Math.ceil((detalle.total || 0) / POR_PAGINA));
  const ordenar = (k) => setDet((d) => ({ ...d, orden: k, desc: d.orden === k ? !d.desc : k !== "codigo" && k !== "institucion", pagina: 0 }));
  return (
    <div data-tabla-detalle>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <input data-buscar type="search" value={det.q} onChange={(e) => setDet((d) => ({ ...d, q: e.target.value, pagina: 0 }))} placeholder="Buscar código, institución, empresa o RUT" style={{ ...iStyle, flex: "1 1 220px" }} />
        {!escritorio && <select data-orden value={`${det.orden}:${det.desc ? "d" : "a"}`} onChange={(e) => { const [k, s] = e.target.value.split(":"); setDet((d) => ({ ...d, orden: k, desc: s === "d", pagina: 0 })); }} style={{ ...selStyle, flex: "1 1 160px" }}>
          {COLS_V.flatMap((c) => [<option key={c.k + "d"} value={`${c.k}:d`}>{c.t} ↓</option>, <option key={c.k + "a"} value={`${c.k}:a`}>{c.t} ↑</option>])}</select>}
      </div>
      {detalle.error && <AvisoLinea tono="danger">{detalle.error}</AvisoLinea>}
      <div style={{ opacity: cargando ? 0.55 : 1 }} aria-busy={cargando}>
        {!detalle.filas.length ? <div style={{ fontSize: 13, color: C.inkFaint, padding: "14px 2px" }}>{cargando ? "Cargando…" : "Sin oportunidades con estos filtros"}</div>
          : escritorio ? (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead><tr>{COLS_V.map((c) => <th key={c.k} data-columna={c.k} onClick={() => ordenar(c.k)} style={{ textAlign: c.num ? "right" : "left", padding: "8px 6px", borderBottom: `2px solid ${C.border}`, color: C.inkMuted, fontSize: 12, fontWeight: 800, cursor: "pointer", whiteSpace: "nowrap", userSelect: "none" }}>
                  {c.t}{det.orden === c.k ? (det.desc ? " ↓" : " ↑") : ""}</th>)}</tr></thead>
                <tbody>{detalle.filas.map((o) => (
                  <tr key={o.clave} data-fila-ic={o.clave} style={{ borderBottom: `1px solid ${C.border}`, verticalAlign: "top" }}>
                    {adj && <td data-fecha-adjudicacion style={{ padding: "8px 6px", whiteSpace: "nowrap" }}>{o.fecha_adjudicacion ? fmt.date(o.fecha_adjudicacion) : "—"}</td>}
                    <td style={{ padding: "8px 6px", whiteSpace: "nowrap" }}>{fmt.date(o.fecha_presentacion)}</td>
                    <td style={{ padding: "8px 6px" }}><Codigo o={o} />{o.n_cotizaciones > 1 && <span style={{ display: "block", fontSize: 11, color: C.inkFaint }}>{o.n_cotizaciones} cotizaciones</span>}</td>
                    <td style={{ padding: "8px 6px", maxWidth: 240 }}><span style={{ display: "block", fontWeight: 700 }}>{o.institucion || "—"}</span><span style={{ fontSize: 12, color: C.inkFaint }}>{o.descripcion}</span></td>
                    <td style={{ padding: "8px 6px" }}>{o.vendedor_nombre || <span style={{ color: C.inkFaint }}>Sin vendedor</span>}</td>
                    <td style={{ padding: "8px 6px", textAlign: "right", fontFamily: MONO, whiteSpace: "nowrap" }}>{fmt.money(o.oferta_total)}<span style={{ display: "block", fontSize: 11, color: C.inkFaint }}>neto {fmt.money(o.oferta_neto)}{o.oferta_base === "exenta" ? " · exenta" : ""}</span></td>
                    <td style={{ padding: "8px 6px" }}><Res o={o} />{o.aviso && <span style={{ display: "block", fontSize: 11, color: C.warnText, marginTop: 3, maxWidth: 200 }}>⚠ {o.aviso}</span>}</td>
                    <td style={{ padding: "8px 6px", maxWidth: 200 }}><Adjudicatario o={o} /></td>
                    <td style={{ padding: "8px 6px", textAlign: "right", fontFamily: MONO, whiteSpace: "nowrap" }}>{o.adjudicado_total == null ? "—" : fmt.money(o.adjudicado_total)}</td>
                    <td style={{ padding: "8px 6px", textAlign: "right" }}><Dif o={o} /></td>
                    <td style={{ padding: "8px 6px", textAlign: "right", fontFamily: MONO }}>{o.comparable ? pct(o.diferencia_pct) : "—"}</td>
                  </tr>))}</tbody>
              </table>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {detalle.filas.map((o) => (
                <div key={o.clave} data-fila-ic={o.clave} style={{ border: `1px solid ${C.border}`, borderRadius: 12, padding: "10px 12px", background: C.card }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}><span style={{ minWidth: 0 }}><Codigo o={o} /><span style={{ display: "block", fontSize: 12, color: C.inkFaint }}>{adj && o.fecha_adjudicacion ? <span data-fecha-adjudicacion>Adjudicación {fmt.date(o.fecha_adjudicacion)} · </span> : null}Presentada {fmt.date(o.fecha_presentacion)} · {o.vendedor_nombre || "Sin vendedor"}</span></span><Res o={o} /></div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, marginTop: 6 }}>{o.institucion || "—"}</div>
                  {o.descripcion && <div style={{ fontSize: 12, color: C.inkMuted }}>{o.descripcion}</div>}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 8, fontSize: 12 }}>
                    <span><span style={{ color: C.inkFaint, display: "block" }}>Ofertado BFK (total)</span><b style={{ fontFamily: MONO }}>{fmt.money(o.oferta_total)}</b></span>
                    <span><span style={{ color: C.inkFaint, display: "block" }}>Adjudicado (total)</span><b style={{ fontFamily: MONO }}>{o.adjudicado_total == null ? "—" : fmt.money(o.adjudicado_total)}</b></span>
                    <span style={{ gridColumn: "1 / -1" }}><span style={{ color: C.inkFaint, display: "block" }}>Empresa adjudicada</span><Adjudicatario o={o} /></span>
                    <span style={{ gridColumn: "1 / -1" }}><span style={{ color: C.inkFaint, display: "block" }}>Diferencia</span><Dif o={o} />{o.comparable ? <span style={{ fontFamily: MONO, color: C.inkMuted }}> · {pct(o.diferencia_pct)}</span> : null}</span>
                  </div>
                  {o.aviso && <div style={{ fontSize: 12, color: C.warnText, marginTop: 6 }}>⚠ {o.aviso}</div>}
                </div>))}
            </div>
          )}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 10 }}>
        <BotonSecundario data-pagina="anterior" disabled={det.pagina <= 0} onClick={() => setDet((d) => ({ ...d, pagina: d.pagina - 1 }))}>‹ Anterior</BotonSecundario>
        <span data-paginacion style={{ fontSize: 12, color: C.inkMuted }}>Página {det.pagina + 1} de {paginas} · {detalle.total} oportunidad{detalle.total === 1 ? "" : "es"}</span>
        <BotonSecundario data-pagina="siguiente" disabled={det.pagina + 1 >= paginas} onClick={() => setDet((d) => ({ ...d, pagina: d.pagina + 1 }))}>Siguiente ›</BotonSecundario>
      </div>
    </div>
  );
}
