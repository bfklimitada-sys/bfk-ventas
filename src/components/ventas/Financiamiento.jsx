// Ventas privadas — financiamiento de compras (11/11/2026). Quién financió la compra de una orden de venta (BFK con fondos
// propios, una persona del catálogo de financiadores u otra persona), cuánto aportó cada uno, lo devuelto y lo pendiente.
// Las reglas las aplica la base (BORRADOR-2026-11-11-vp-financiamiento-vendedor.sql); el cálculo que se muestra es el de
// lib/vpFinanciamiento.js (misma definición que vp_fin_resumen). Los aportes y devoluciones NO cambian el costo de compra, la
// utilidad, las comisiones ni los cobros del cliente: cobrar una venta no devuelve nada a quien la financió.
import { useMemo, useRef, useState } from "react";
import { C, MONO, R, T, cardStyle } from "../../lib/theme";
import { Seccion, AvisoLinea, Badge } from "../ui/Sistema";
import { Ventana, Campo, Rejilla, Entrada, Selector, ErrorForm, PedirMotivo } from "../proyectos/Comunes";
import { estiloBoton, Fila, Kpi, RejillaKpi, Vacio } from "./Comunes";
import { MEDIOS_PAGO, pesos, fechaTxt, hoyISO, mensajeVP, nuevaClave, aPesos } from "../../lib/ventasPrivadas";
import { subirDocumento, registrarAportes, registrarDevolucion, anularFinanciamiento } from "../../lib/ventasPrivadasDatos";
import { opcionesAportante, filaAporte, validarAportes, aportesParaGuardar, resumenFinanciamiento, ESTADOS_FINANCIAMIENTO, OTRA_PERSONA, validarDevolucion,
  totalesFinanciamiento } from "../../lib/vpFinanciamiento";

const registradoPor = (d, a) => (d.historial || []).find((h) => h.tabla === "vp_fin_aportes" && h.registro_id === a.id && h.accion === "crear")?.usuario_nombre;
const medioTxt = (m) => MEDIOS_PAGO.find((x) => x.v === m)?.l || m || "—";

// Sube (una sola vez) el comprobante de cada fila que lo tenga y deja su documento_id en la fila (un reintento no lo repite).
export async function subirComprobantes(token, ventaId, filas, setFilas, prefijo = "Comprobante de aporte") {
  const out = [];
  for (const f of filas) {
    if (f.archivo && !f.documento_id) {
      const doc = await subirDocumento(token, { ambito: "venta", id: ventaId, categoria: "compra", titulo: `${prefijo} · ${f.nombre || f.aportante} · ${f.fecha}`, archivo: f.archivo });
      f.documento_id = doc.id; setFilas?.((fs) => fs.map((x) => (x._k === f._k ? { ...x, documento_id: doc.id } : x)));
    }
    out.push(f);
  }
  return out;
}

// Filas de aportantes (se usa en «Registrar compra», en el registro manual y en «Registrar aporte»).
// disponible: lo que aún se puede financiar con este registro. totalCompra: total pagado (para el resumen).
export function EditorAportes({ filas, setFilas, financiadores, disponible, documentosHabilitados, dato = "aportes" }) {
  const opciones = useMemo(() => opcionesAportante(financiadores), [financiadores]);
  const set = (k, campo, val) => setFilas((fs) => fs.map((f) => (f._k === k ? { ...f, [campo]: val } : f)));
  const total = filas.reduce((s, f) => s + (aPesos(f.monto) > 0 ? aPesos(f.monto) : 0), 0);
  const resto = Math.max(0, disponible - total);
  return (
    <div data-editor-aportes={dato}>
      {filas.map((f, i) => (
        <div key={f._k} data-aporte-fila={i + 1} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: R.md, padding: "10px 10px 2px", marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <b style={{ flex: 1, fontSize: T.small, color: C.tealDark }}>Aportante {i + 1}</b>
            {filas.length > 1 && <button type="button" data-quitar-aporte={i + 1} onClick={() => setFilas((fs) => fs.filter((x) => x._k !== f._k))} style={{ background: "none", border: "none", color: C.dangerText, cursor: "pointer", fontSize: T.small, minHeight: 32 }}>Quitar</button>}
          </div>
          <Rejilla>
            <Campo etiqueta="Quién financia"><Selector data-aporte-campo="aportante" vacio="— Elige —" opciones={opciones} value={f.aportante} onChange={(e) => set(f._k, "aportante", e.target.value)} /></Campo>
            {f.aportante === OTRA_PERSONA && <Campo etiqueta="Nombre de la persona"><Entrada data-aporte-campo="nombre" value={f.nombre} maxLength={150} onChange={(e) => set(f._k, "nombre", e.target.value)} placeholder="Nombre y apellido" /></Campo>}
            <Campo etiqueta="Monto aportado ($)" ayuda={i === 0 || resto > 0 ? <button type="button" data-usar-resto={i + 1} onClick={() => set(f._k, "monto", String((aPesos(f.monto) > 0 ? aPesos(f.monto) : 0) + resto))} style={{ background: "none", border: "none", color: C.tealDark, textDecoration: "underline", cursor: "pointer", padding: 0, fontSize: T.small }}>Usar lo que falta ({pesos(resto + (aPesos(f.monto) > 0 ? aPesos(f.monto) : 0))})</button> : null}>
              <Entrada data-aporte-campo="monto" inputMode="numeric" value={f.monto} onChange={(e) => set(f._k, "monto", e.target.value)} style={{ fontFamily: MONO }} /></Campo>
            <Campo etiqueta="Fecha"><Entrada data-aporte-campo="fecha" type="date" max={hoyISO()} value={f.fecha} onChange={(e) => set(f._k, "fecha", e.target.value)} /></Campo>
            <Campo etiqueta="Medio de pago"><Selector data-aporte-campo="medio" opciones={MEDIOS_PAGO} value={f.medio} onChange={(e) => set(f._k, "medio", e.target.value)} /></Campo>
            <Campo etiqueta="Comprobante (n° de operación)"><Entrada data-aporte-campo="comprobante" value={f.comprobante} maxLength={120} onChange={(e) => set(f._k, "comprobante", e.target.value)} /></Campo>
          </Rejilla>
          {documentosHabilitados && <Campo etiqueta="Archivo del comprobante (opcional)">{f.documento_id ? <span style={{ fontSize: T.small, color: C.okText }}>✓ Archivo adjunto</span> : <input data-aporte-campo="archivo" type="file" onChange={(e) => set(f._k, "archivo", e.target.files?.[0] || null)} />}</Campo>}
          <Campo etiqueta="Observación (opcional)"><Entrada data-aporte-campo="observacion" value={f.observacion} maxLength={1000} onChange={(e) => set(f._k, "observacion", e.target.value)} /></Campo>
        </div>
      ))}
      <button type="button" data-agregar-aporte onClick={() => setFilas((fs) => [...fs, filaAporte()])} style={{ ...estiloBoton(), minHeight: 40, marginBottom: 8 }}>+ Agregar otro aportante</button>
      <div data-resumen-aportes style={{ fontSize: T.small, color: C.inkMuted, lineHeight: 1.6 }}>
        Por financiar: <b style={{ color: C.ink }}>{pesos(disponible)}</b> · en este registro: <b data-financiado-registro style={{ color: C.ink }}>{pesos(total)}</b> ·
        quedará sin informar: <b data-quedara-sin-informar style={{ color: total > disponible ? C.dangerText : C.ink }}>{pesos(Math.max(0, disponible - total))}</b>
        {total > disponible && <div style={{ color: C.dangerText, fontWeight: 700 }}>Lo financiado supera lo que falta financiar.</div>}
      </div>
    </div>
  );
}

// Bloque «Financiamiento» de «Registrar compra»: opcional. Si no se informa, la compra queda «Financiamiento sin informar».
export function BloqueFinanciamientoCompra({ activo, setActivo, filas, setFilas, financiadores, disponible, documentosHabilitados }) {
  return (
    <div data-financiamiento-compra style={{ background: C.paper, borderRadius: R.md, padding: "10px 12px", marginBottom: 12, border: `1px solid ${C.border}` }}>
      <div style={{ fontSize: T.small, fontWeight: 700, color: C.inkMuted, textTransform: "uppercase", marginBottom: 6 }}>Financiamiento de esta compra</div>
      <div style={{ fontSize: T.small, color: C.inkMuted, marginBottom: 8, lineHeight: 1.5 }}>Quién puso el dinero (puede ser más de uno). No cambia el costo ni la utilidad. Si lo dejas para después, la compra queda como «Financiamiento sin informar».</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: activo ? 10 : 0 }}>
        <button type="button" data-financiamiento-ahora onClick={() => { setActivo(true); if (!filas.length) setFilas([filaAporte({ monto: String(disponible) })]); }} style={{ ...estiloBoton(activo ? "pri" : undefined), minHeight: 44 }}>Indicar quién financia</button>
        <button type="button" data-financiamiento-despues onClick={() => setActivo(false)} style={{ ...estiloBoton(!activo ? "pri" : undefined), minHeight: 44 }}>Informar después</button>
      </div>
      {activo && <EditorAportes filas={filas} setFilas={setFilas} financiadores={financiadores} disponible={disponible} documentosHabilitados={documentosHabilitados} dato="compra" />}
    </div>
  );
}

// ── Sección «Financiamiento» de la orden de venta ─────────────────────────────────────────────────────
export function SeccionFinanciamiento({ token, d, v, vp, esResp, showToast, refrescar }) {
  const r = useMemo(() => resumenFinanciamiento(d), [d]);
  const [form, setForm] = useState(null);   // {t:'aportes'} | {t:'devolucion', aporte} | {t:'anular', tabla, id, titulo}
  const est = ESTADOS_FINANCIAMIENTO[r.estado];
  const anulados = d.aportes.filter((a) => a.estado !== "vigente"); const devAnul = d.devoluciones.filter((x) => x.estado !== "vigente");
  return (
    <Seccion titulo="Financiamiento" accion={esResp && r.totalCompras > 0 && <button type="button" data-registrar-aporte onClick={() => setForm({ t: "aportes" })} style={estiloBoton()}>Registrar aporte</button>}>
      <div data-financiamiento-venta>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}><Badge tono={est.tono}><span data-estado-financiamiento={r.estado}>{est.l}</span></Badge></div>
        <RejillaKpi>
          <Kpi dato="fin-total" et="Total de la compra (pagado, con IVA)" v={pesos(r.totalCompras)} n={r.gastosVinculados ? `Además ${pesos(r.gastosVinculados)} de gastos vinculados (ya registrados en Gastos)` : null} />
          <Kpi dato="fin-financiado" et="Financiado" v={pesos(r.financiado)} n={r.financiado ? `BFK ${pesos(r.financiadoBfk)} · personas ${pesos(r.financiadoPersonas)}` : null} />
          <Kpi dato="fin-falta" et="Falta financiar (sin informar)" v={pesos(r.sinInformar)} tono={r.sinInformar > 0 ? "warn" : "ok"} />
          <Kpi dato="fin-pendiente" et="Pendiente de devolución" v={pesos(r.pendienteDevolucion)} tono={r.pendienteDevolucion > 0 ? "warn" : "ok"} n={r.devuelto ? `Devuelto ${pesos(r.devuelto)}` : null} />
        </RejillaKpi>
        {r.sinInformar > 0 && r.totalCompras > 0 && <AvisoLinea tono="warn" icono="ℹ" dato="fin-sin-informar">{pesos(r.sinInformar)} de la compra con <b>financiamiento sin informar</b>: no se atribuyen a BFK ni al responsable hasta que alguien los registre.</AvisoLinea>}
        {!r.porAportante.length && <Vacio dato="sin-aportes">{r.totalCompras ? "Aún no se informa quién financió esta compra." : "Sin compras registradas: el financiamiento se indica al registrar la compra."}</Vacio>}
        {r.porAportante.map((g) => (
          <div key={g.clave} data-aportante={g.financiador_id || g.nombre} style={{ ...cardStyle, borderRadius: R.md, padding: "9px 12px", marginBottom: 8 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <b style={{ flex: 1, minWidth: 140 }}>{g.nombre}</b>
              <Badge tono={g.tipo === "bfk" ? "info" : g.pendiente > 0 ? "warn" : "ok"}>{g.tipo === "bfk" ? "Fondos propios · no es deuda" : g.pendiente > 0 ? "Aporte personal · pendiente" : "Aporte personal · devuelto"}</Badge>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: g.tipo === "bfk" ? "1fr" : "repeat(3, minmax(0,1fr))", gap: 6, marginTop: 6, fontSize: T.small }}>
              <div>Aportado<br /><b data-aportado style={{ fontFamily: MONO, fontSize: T.sm }}>{pesos(g.aportado)}</b></div>
              {g.tipo === "persona" && <><div>Devuelto<br /><b data-devuelto style={{ fontFamily: MONO, fontSize: T.sm }}>{pesos(g.devuelto)}</b></div>
                <div>Pendiente<br /><b data-pendiente-devolucion style={{ fontFamily: MONO, fontSize: T.sm, color: g.pendiente > 0 ? C.warnText : C.okText }}>{pesos(g.pendiente)}</b></div></>}
            </div>
            {g.aportes.map((a) => (
              <div key={a.id} data-aporte={a.id} style={{ borderTop: `1px solid ${C.border}`, marginTop: 8, paddingTop: 6 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: T.small }}>
                  <span style={{ flex: 1, minWidth: 160, color: C.inkMuted }}><b style={{ color: C.ink, fontFamily: MONO }}>{pesos(a.monto)}</b> · {fechaTxt(a.fecha)} · {medioTxt(a.medio)}{a.comprobante ? ` · ${a.comprobante}` : ""}{a.documento_id ? " · con archivo" : ""}{a.observacion ? ` · ${a.observacion}` : ""}</span>
                  {esResp && a.aportante_tipo === "persona" && a.pendiente > 0 && <button type="button" data-registrar-devolucion={a.id} onClick={() => setForm({ t: "devolucion", aporte: a })} style={estiloBoton("pri")}>Registrar devolución</button>}
                  {esResp && <button type="button" data-anular-aporte={a.id} onClick={() => setForm({ t: "anular", tabla: "aporte", id: a.id, titulo: `Anular aporte de ${a.aportante_nombre} (${pesos(a.monto)})`, texto: "El aporte se conserva en el historial y deja de contar. Si tiene devoluciones vigentes, anúlalas primero." })} style={estiloBoton("peligro")}>Anular</button>}
                </div>
                <div data-registrado-por style={{ fontSize: T.small, color: C.inkFaint }}>Registrado por {registradoPor(d, a) || (a.creado_por === v.responsable_id ? v.responsable_nombre : "otro usuario")}</div>
                {d.devoluciones.filter((x) => x.aporte_id === a.id && x.estado === "vigente").map((x) => (
                  <div key={x.id} data-devolucion={x.id} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: T.small, marginTop: 4, paddingLeft: 10, borderLeft: `3px solid ${C.ok}` }}>
                    <span style={{ flex: 1, minWidth: 160 }}>Devolución <b style={{ fontFamily: MONO }}>{pesos(x.monto)}</b> · {fechaTxt(x.fecha)} · {medioTxt(x.medio)}{x.comprobante ? ` · ${x.comprobante}` : ""}{x.documento_id ? " · con archivo" : ""}</span>
                    {esResp && <button type="button" data-anular-devolucion={x.id} onClick={() => setForm({ t: "anular", tabla: "devolucion", id: x.id, titulo: `Anular devolución de ${pesos(x.monto)}`, texto: "La devolución se conserva en el historial y el saldo pendiente vuelve a subir." })} style={estiloBoton("peligro")}>Anular</button>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))}
        {(anulados.length > 0 || devAnul.length > 0) && <details style={{ fontSize: T.small, color: C.inkMuted, marginTop: 4 }}><summary style={{ cursor: "pointer", minHeight: 32 }}>Anulados ({anulados.length + devAnul.length})</summary>
          {anulados.map((a) => <div key={a.id} data-aporte-anulado style={{ padding: "3px 0" }}>Aporte de {a.aportante_nombre} · {pesos(a.monto)} · {fechaTxt(a.fecha)} · anulado: {a.anulacion_motivo}</div>)}
          {devAnul.map((x) => <div key={x.id} data-devolucion-anulada style={{ padding: "3px 0" }}>Devolución de {pesos(x.monto)} · {fechaTxt(x.fecha)} · anulada: {x.anulacion_motivo}</div>)}
        </details>}
        <div style={{ fontSize: T.small, color: C.inkFaint, marginTop: 6, lineHeight: 1.5 }}>Los aportes y devoluciones no cambian el costo de compra ni la utilidad, ni generan comisiones. El pago del cliente se registra aparte: cobrar la venta no devuelve automáticamente el dinero a quien la financió.</div>
      </div>
      {form?.t === "aportes" && <FormAportes token={token} v={v} vp={vp} disponible={r.sinInformar} showToast={showToast} onCerrar={() => setForm(null)} onListo={async () => { setForm(null); await refrescar(); }} />}
      {form?.t === "devolucion" && <FormDevolucion token={token} v={v} vp={vp} aporte={form.aporte} showToast={showToast} onCerrar={() => setForm(null)} onListo={async () => { setForm(null); await refrescar(); }} />}
      {form?.t === "anular" && <PedirMotivo titulo={form.titulo} texto={form.texto} etiquetaBoton="Anular" peligro onCancelar={() => setForm(null)}
        onConfirmar={async (m) => { try { await anularFinanciamiento(token, form.tabla, form.id, m); showToast?.("Anulado (se conserva en el historial)"); setForm(null); await refrescar(); } catch (e) { showToast?.(mensajeVP(e), "error"); } }} />}
    </Seccion>
  );
}

function FormAportes({ token, v, vp, disponible, showToast, onCerrar, onListo }) {
  const [filas, setFilas] = useState(() => [filaAporte({ monto: disponible > 0 ? String(disponible) : "" })]);
  const [err, setErr] = useState([]); const [ocupado, setOcupado] = useState(false); const enCurso = useRef(false);
  const ok = async () => {
    if (enCurso.current) return;
    const val = validarAportes(filas, { disponible });
    if (val.errores.length) { setErr(val.errores); return; }
    enCurso.current = true; setOcupado(true); setErr([]);
    try {
      const fs = await subirComprobantes(token, v.id, filas, setFilas);
      const r = await registrarAportes(token, v.id, aportesParaGuardar(fs));
      showToast?.(r?.ya_existia ? "El aporte ya estaba registrado (no se duplicó)" : "Financiamiento registrado"); onListo();
    } catch (e) { setErr([e.status === 0 ? `Se perdió la conexión: ${mensajeVP(e)} Puedes reintentar: no se duplicará.` : mensajeVP(e)]); enCurso.current = false; setOcupado(false); }
  };
  return (
    <Ventana titulo={`Registrar aporte · ${v.folio}`} onCerrar={onCerrar} dato="form-aportes" ancho={640}
      pie={<><button type="button" onClick={onCerrar} style={estiloBoton()}>Cancelar</button><button type="button" data-guardar-aportes disabled={ocupado} onClick={ok} style={{ ...estiloBoton("pri"), minHeight: 44 }}>{ocupado ? "Guardando…" : "Registrar"}</button></>}>
      <p style={{ marginTop: 0, fontSize: T.sm, color: C.inkMuted }}>Quién financió la compra de esta venta. El usuario que registra queda en el historial; el aportante es quien puso el dinero.</p>
      <EditorAportes filas={filas} setFilas={setFilas} financiadores={vp?.financiadores || []} disponible={disponible} documentosHabilitados={vp?.documentosHabilitados} dato="registrar" />
      {err.length > 0 && <div data-errores-aportes><ErrorForm>{err.map((e, i) => <div key={i}>• {e}</div>)}</ErrorForm></div>}
    </Ventana>
  );
}

function FormDevolucion({ token, v, vp, aporte, showToast, onCerrar, onListo }) {
  const [f, setF] = useState({ monto: String(aporte.pendiente), fecha: hoyISO(), medio: "transferencia", comprobante: "", observacion: "", archivo: null });
  const [err, setErr] = useState([]); const [ocupado, setOcupado] = useState(false); const clave = useRef(nuevaClave()); const docId = useRef(null); const enCurso = useRef(false);
  const ok = async () => {
    if (enCurso.current) return;
    const val = validarDevolucion({ aporte, monto: f.monto, fecha: f.fecha });
    if (val.errores.length) { setErr(val.errores); return; }
    enCurso.current = true; setOcupado(true); setErr([]);
    try {
      if (f.archivo && !docId.current) docId.current = (await subirDocumento(token, { ambito: "venta", id: v.id, categoria: "compra", titulo: `Comprobante de devolución · ${aporte.aportante_nombre} · ${f.fecha}`, archivo: f.archivo })).id;
      const r = await registrarDevolucion(token, { clave: clave.current, aporte_id: aporte.id, monto: val.monto, fecha: f.fecha, medio: f.medio, comprobante: f.comprobante || null, observacion: f.observacion || null, documento_id: docId.current });
      showToast?.(r?.ya_existia ? "La devolución ya estaba registrada (no se duplicó)" : `Devolución registrada · pendiente ${pesos(r?.pendiente)}`); onListo();
    } catch (e) { setErr([e.status === 0 ? `Se perdió la conexión: ${mensajeVP(e)} Puedes reintentar: no se duplicará.` : mensajeVP(e)]); enCurso.current = false; setOcupado(false); }
  };
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === "file" ? e.target.files?.[0] || null : e.target.value }));
  return (
    <Ventana titulo={`Devolución a ${aporte.aportante_nombre}`} onCerrar={onCerrar} dato="form-devolucion" ancho={520}
      pie={<><button type="button" onClick={onCerrar} style={estiloBoton()}>Cancelar</button><button type="button" data-guardar-devolucion disabled={ocupado} onClick={ok} style={{ ...estiloBoton("pri"), minHeight: 44 }}>{ocupado ? "Guardando…" : "Registrar devolución"}</button></>}>
      <div style={{ ...cardStyle, borderRadius: R.md, padding: "8px 12px", marginBottom: 12 }}>
        <Fila k="Aporte" v={`${pesos(aporte.monto)} · ${fechaTxt(aporte.fecha)}`} /><Fila k="Ya devuelto" v={pesos(aporte.devuelto)} /><Fila k="Pendiente de devolución" v={pesos(aporte.pendiente)} fuerte tono="warn" dato="saldo-aporte" />
      </div>
      <Rejilla>
        <Campo etiqueta="Monto devuelto ($)" ayuda="Parcial o total; nunca más que el pendiente."><Entrada data-devolucion-campo="monto" inputMode="numeric" value={f.monto} onChange={set("monto")} style={{ fontFamily: MONO }} /></Campo>
        <Campo etiqueta="Fecha"><Entrada data-devolucion-campo="fecha" type="date" max={hoyISO()} value={f.fecha} onChange={set("fecha")} /></Campo>
        <Campo etiqueta="Medio de pago"><Selector data-devolucion-campo="medio" opciones={MEDIOS_PAGO} value={f.medio} onChange={set("medio")} /></Campo>
        <Campo etiqueta="Comprobante (n° de operación)"><Entrada data-devolucion-campo="comprobante" value={f.comprobante} maxLength={120} onChange={set("comprobante")} /></Campo>
      </Rejilla>
      {vp?.documentosHabilitados && <Campo etiqueta="Archivo del comprobante (opcional)"><input data-devolucion-campo="archivo" type="file" onChange={set("archivo")} /></Campo>}
      <Campo etiqueta="Observación (opcional)"><Entrada value={f.observacion} maxLength={1000} onChange={set("observacion")} /></Campo>
      {err.length > 0 && <div data-errores-devolucion><ErrorForm>{err.map((e, i) => <div key={i}>• {e}</div>)}</ErrorForm></div>}
    </Ventana>
  );
}

// ── Finanzas › Financiamiento: Ventas privadas (solo lo que el usuario puede ver: administrador y responsables) ──
// La deuda de Mercado Público (saldo de cada financiador) no cambia ni se mezcla: se muestra al lado, por persona.
export function FinanciamientoVentasPrivadas({ vp, financiadores = [], onAbrirVenta }) {
  const t = useMemo(() => totalesFinanciamiento(vp?.finResumen || [], vp?.finAportantes || []), [vp]);
  if (!vp?.instalado || !vp?.finInstalado || (!t.totalCompras && !(vp.finAportantes || []).length)) return null;
  const deudaMP = (id) => Number(financiadores.find((f) => f.id === id)?.saldo_deuda || 0);
  const sinInf = (vp.finResumen || []).filter((r) => Number(r.sin_informar) > 0 && r.estado === "vigente");
  return (
    <Seccion titulo="Ventas privadas · financiamiento de compras">
      <div data-fin-vp>
        <RejillaKpi>
          <Kpi dato="finvp-pendiente" et="Pendiente de devolver a personas" v={pesos(t.pendienteDevolucion)} tono={t.pendienteDevolucion > 0 ? "warn" : "ok"} n={`Aportado ${pesos(t.financiadoPersonas)} · devuelto ${pesos(t.devuelto)}`} />
          <Kpi dato="finvp-bfk" et="Financiado por BFK (fondos propios)" v={pesos(t.financiadoBfk)} n="No es deuda" />
          <Kpi dato="finvp-sin-informar" et="Financiamiento sin informar" v={pesos(t.sinInformar)} tono={t.sinInformar > 0 ? "warn" : "ok"} n={t.ventasSinInformar ? `${t.ventasSinInformar} orden(es) de venta` : null} />
        </RejillaKpi>
        {t.personas.length > 0 && <div data-fin-vp-personas style={{ marginBottom: 10 }}>
          {t.personas.map((p) => (
            <div key={p.clave} data-fin-vp-persona={p.financiador_id || p.nombre} style={{ ...cardStyle, borderRadius: R.md, padding: "9px 12px", marginBottom: 6 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}><b style={{ flex: 1, fontSize: T.sm }}>{p.nombre}</b><span style={{ fontSize: T.small, color: C.inkFaint }}>{p.n_ventas} venta(s)</span></div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(105px,1fr))", gap: 6, marginTop: 6, fontSize: T.small, color: C.inkMuted }}>
                <div>Aportado<br /><b style={{ fontFamily: MONO, color: C.ink, fontSize: T.sm }}>{pesos(p.aportado)}</b></div>
                <div>Devuelto<br /><b style={{ fontFamily: MONO, color: C.ink, fontSize: T.sm }}>{pesos(p.devuelto)}</b></div>
                <div>Pendiente VP<br /><b data-fin-vp-pendiente style={{ fontFamily: MONO, fontSize: T.sm, color: p.pendiente > 0 ? C.warnText : C.okText }}>{pesos(p.pendiente)}</b></div>
                <div>Deuda Mercado Público<br /><b style={{ fontFamily: MONO, color: C.inkMuted, fontSize: T.sm }}>{p.financiador_id ? pesos(deudaMP(p.financiador_id)) : "—"}</b></div>
              </div>
            </div>
          ))}
          <div style={{ fontSize: T.small, color: C.inkFaint, padding: "2px 0 6px", lineHeight: 1.5 }}>«Pendiente VP» es lo aportado a compras de Ventas privadas menos lo devuelto. La deuda de Mercado Público es el saldo de siempre (compras − pagos al financiador) y no incluye Ventas privadas: cada monto viene de un solo registro.</div>
        </div>}
        {sinInf.length > 0 && <div style={{ fontSize: T.small, color: C.inkMuted }}>Con financiamiento sin informar: {sinInf.slice(0, 12).map((r, i) => <span key={r.venta_id}>{i ? ", " : ""}{onAbrirVenta ? <button type="button" data-fin-vp-abrir={r.folio} onClick={() => onAbrirVenta(r.venta_id)} style={{ background: "none", border: "none", color: C.tealDark, textDecoration: "underline", cursor: "pointer", padding: 0, fontSize: T.small }}>{r.folio}</button> : r.folio} ({pesos(r.sin_informar)})</span>)}{sinInf.length > 12 ? "…" : ""}</div>}
      </div>
    </Seccion>
  );
}
