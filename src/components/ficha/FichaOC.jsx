import { useEffect, useState } from "react";
import { Field } from "../ui/Basicos";
import { Badge } from "../ui/Sistema";
import { Ic } from "../ui/Iconos";
import { C, MONO, btnP, fmt, iMono, iStyle, selStyle } from "../../lib/theme";
import { gananciaReal, estadoVencimiento, plazoPago } from "../../lib/calculos";
import {
  CODIGOS_REF, ETIQUETA_ESTADO, cadenaDocumental, codigoRef, efectoMonto, esFactura, esNotaCredito, esNotaDebito,
  estadoDocumento, facturasVigentesDe, montoTributarioVigente, ncMontoAplicables, nombreDocumento, notasDebito,
} from "../../lib/tributario";

// ═══════════════════════════════════════════════════════════════
// Ficha de OC como expediente (Fase SII): cabecera fija, resumen financiero,
// índice y secciones plegables (acordeones en móvil). Solo presentación:
// las acciones son las mismas de siempre y las reglas viven en lib/.
// ═══════════════════════════════════════════════════════════════

export const ANCHO_ESCRITORIO = 900;
export function useEscritorio() {
  const medir = () => (typeof window !== "undefined" ? window.innerWidth >= ANCHO_ESCRITORIO : false);
  const [es, setEs] = useState(medir);
  useEffect(() => {
    const f = () => setEs(medir());
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);
  return es;
}

// Alto de la barra superior fija de la app (para que la cabecera de la ficha quede debajo).
export function useTopeFijo() {
  const [tope, setTope] = useState(0);
  useEffect(() => {
    const medir = () => {
      const h = [...document.querySelectorAll("header")].find((x) => getComputedStyle(x).position === "sticky");
      setTope(h ? h.getBoundingClientRect().height : 0);
    };
    medir();
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, []);
  return tope;
}

const titulo = { fontSize: 12, fontWeight: 800, color: C.inkMuted, textTransform: "uppercase", letterSpacing: 0.4 };

// ── Sección plegable ───────────────────────────────────────────
export function SeccionFicha({ id, icono, titulo: t, resumen, abierta, onToggle, children, aviso }) {
  return (
    <section id={id} data-seccion-ficha={id} style={{ background: C.card, border: `1px solid ${aviso ? C.warn + "88" : C.border}`, borderRadius: 12, marginBottom: 10, scrollMarginTop: 120, overflow: "hidden" }}>
      <button type="button" data-consulta="1" aria-expanded={abierta} onClick={onToggle}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", minHeight: 48, background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
        <span style={{ fontSize: 15, flexShrink: 0 }}>{icono}</span>
        <span style={{ fontWeight: 800, fontSize: 14, color: C.ink, flexShrink: 0 }}>{t}</span>
        <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: C.inkMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "right" }}>{resumen}</span>
        <span style={{ color: C.inkFaint, fontSize: 12, flexShrink: 0 }}>{abierta ? "▲" : "▼"}</span>
      </button>
      {abierta && <div style={{ padding: "0 14px 14px", borderTop: `1px solid ${C.border}` }}><div style={{ paddingTop: 12 }}>{children}</div></div>}
    </section>
  );
}

// ── Índice de secciones ────────────────────────────────────────
export function IndiceFicha({ items, onIr }) {
  return (
    <nav data-consulta="1" data-indice-ficha aria-label="Secciones de la OC" style={{ display: "flex", gap: 6, overflowX: "auto", padding: "8px 0 2px", WebkitOverflowScrolling: "touch" }}>
      {items.map((it) => (
        <button key={it.id} type="button" data-consulta="1" onClick={() => onIr(it.id)}
          style={{ flexShrink: 0, border: `1px solid ${it.aviso ? C.warn : C.border}`, background: C.card, borderRadius: 999, padding: "6px 12px", fontSize: 12, fontWeight: 700, color: it.aviso ? C.warnText : C.inkMuted, minHeight: 34, cursor: "pointer", whiteSpace: "nowrap" }}>
          <Ic n={it.icono} /> {it.titulo}
        </button>
      ))}
    </nav>
  );
}

// ── Resumen financiero (siempre visible) ───────────────────────
export function ResumenFinanciero({ oc }) {
  const g = gananciaReal(oc);
  const facturado = Number(oc.monto_facturado) || 0, cobrado = Number(oc.monto_cobrado) || 0;
  const pendiente = Math.max(0, facturado - cobrado);
  const tiles = [
    { k: "Venta", v: fmt.money(oc.monto_total), c: C.ink },
    { k: "Costo", v: Number(oc.costo_total) ? fmt.money(oc.costo_total) : "—", c: C.ink },
    { k: "Utilidad", v: Number(oc.costo_total) ? fmt.money(g.pesos) : "—", s: Number(oc.costo_total) ? `${g.pct}%${g.extra > 0 ? " · post-venta" : ""}` : "", c: g.color },
    { k: "Facturado vigente", v: facturado ? fmt.money(facturado) : "—", c: C.info },
    { k: "Cobrado", v: cobrado ? fmt.money(cobrado) : "—", c: C.okText },
    { k: "Pendiente", v: fmt.money(pendiente), c: pendiente > 0 ? C.dangerText : C.inkMuted },
  ];
  return (
    <div data-resumen-financiero style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(104px, 1fr))", gap: 6 }}>
      {tiles.map((t) => (
        <div key={t.k} data-tile={t.k} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "7px 9px", minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.inkFaint, textTransform: "uppercase", letterSpacing: 0.3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.k}</div>
          <div style={{ fontFamily: MONO, fontWeight: 800, fontSize: 14, color: t.c, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.v}</div>
          {t.s && <div style={{ fontSize: 11, color: t.c, opacity: 0.85 }}>{t.s}</div>}
        </div>
      ))}
    </div>
  );
}

// ── Facturación SII: cadena documental ─────────────────────────
const TONO_ESTADO = { vigente: "ok", anulada: "danger", nc_anula: "danger", nc_texto: "neutro", nc_monto: "warn", nc_sin_codigo: "warn", nd: "info" };

function FilaDocumento({ oc, d, primero, perfil, bloqueado, onEditar, onEliminar }) {
  const est = estadoDocumento(oc, d);
  const ef = efectoMonto(oc, d);
  const nc = esNotaCredito(d);
  const anulada = est === "anulada";
  return (
    <div data-documento={nombreDocumento(d)} data-estado={est}
      style={{ position: "relative", marginLeft: primero ? 0 : 18, paddingLeft: primero ? 0 : 14, borderLeft: primero ? "none" : `2px solid ${C.border}`, marginBottom: 8 }}>
      {!primero && <span style={{ position: "absolute", left: -8, top: 10, fontSize: 12, color: C.inkFaint }}>↳</span>}
      <div style={{ background: anulada ? C.paper : C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "9px 11px", opacity: anulada ? 0.8 : 1 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, flexWrap: "wrap" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 13.5, color: C.ink, textDecoration: anulada ? "line-through" : "none" }}>
              <Ic n={nc ? "📋" : esNotaDebito(d) ? "📄" : "🧾"} /> {nombreDocumento(d)}
            </div>
            <div style={{ fontSize: 12, color: C.inkMuted }}>{d.fecha ? fmt.date(String(d.fecha).slice(0, 10)) : "Sin fecha"}{d.rut_receptor ? ` · RUT ${d.rut_receptor}` : ""}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontFamily: MONO, fontWeight: 800, fontSize: 13.5, color: anulada ? C.inkFaint : C.ink }}>{fmt.money(d.monto)}</div>
            {(nc || anulada) && <div style={{ fontSize: 11.5, color: ef < 0 ? C.dangerText : C.inkFaint }}>{ef < 0 ? `efecto ${fmt.money(ef)}` : est === "nc_texto" ? "" : anulada ? "no cuenta" : est === "nc_anula" ? "anula la factura" : ""}</div>}
          </div>
        </div>
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 6 }}>
          <Badge tono={TONO_ESTADO[est] || "neutro"}>{ETIQUETA_ESTADO[est]}</Badge>
          {est === "nc_texto" && <Badge tono="neutro">Sin efecto monetario</Badge>}
          {d.verificado_sii ? <Badge tono="info">✓ Verificada SII</Badge> : <Badge tono="neutro">Pendiente SII</Badge>}
          {d.motivo_diferencia && <Badge tono="warn">Diferencia SII</Badge>}
        </div>
        {(d.ref_folio || codigoRef(d)) && (
          <div style={{ fontSize: 12, color: C.inkMuted, marginTop: 5 }}>
            Corrige factura {d.ref_folio || "—"} · código {codigoRef(d) || "—"} ({CODIGOS_REF[codigoRef(d)] || "sin código"}){d.ref_motivo ? ` · «${d.ref_motivo}»` : ""}
          </div>
        )}
        {esFactura(d) && d.factura_anulada_numero && (
          <div style={{ fontSize: 12, color: C.inkMuted, marginTop: 5 }}>Reemplaza a la factura {d.factura_anulada_numero}{d.nota_credito ? ` (NC ${d.nota_credito}, registro anterior sin monto)` : ""}</div>
        )}
        {d.motivo_diferencia && <div style={{ fontSize: 12, color: C.warnText, marginTop: 4 }}><Ic n="⚠" /> Difiere de la OC: {d.motivo_diferencia}</div>}
        {d.evidencia_sii && <div style={{ fontSize: 11.5, color: C.inkFaint, marginTop: 4 }}>{d.evidencia_sii}</div>}
        {!bloqueado && (
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            {!nc && <button onClick={() => onEditar && onEditar({ tipo: esNotaDebito(d) ? "Nota de débito" : "Factura", e: d, tabla: "eventos_factura" })}
              style={{ fontSize: 12, background: C.tealLight, color: C.tealDark, border: "none", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontWeight: 600 }}><Ic n="✏️" /> Editar</button>}
            {perfil?.rol === "admin" && (
              <button onClick={async () => { if (window.confirm(`¿Eliminar ${nombreDocumento(d)}?\nLo facturado se recalcula según los documentos que queden.`)) await onEliminar(oc.id, d.id); }}
                style={{ fontSize: 12, background: C.dangerLight, color: C.dangerText, border: "none", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontWeight: 600 }}><Ic n="🗑" /> Eliminar</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function FacturacionSII({ oc, perfil, bloqueado, onEmitir, onRegistrarNC, onEditar, onEliminar }) {
  const [copiado, setCopiado] = useState(false);
  const grupos = cadenaDocumental(oc);
  const vig = facturasVigentesDe(oc);
  const nd = notasDebito(oc), nc3 = ncMontoAplicables(oc);
  const totalVig = vig.reduce((s, f) => s + (Number(f.monto) || 0), 0);
  const monto = montoTributarioVigente(oc);
  const difOC = Number(oc.monto_total) - monto;
  const difBase = (Number(oc.monto_facturado) || 0) !== monto;
  const docs = oc.eventos_factura || [];
  const fv = vig.slice().sort((a, b) => String(b.fecha || "").localeCompare(String(a.fecha || "")))[0];
  return (
    <div data-facturacion-sii>
      {bloqueado && (
        <div style={{ background: C.warnLight, borderRadius: 8, padding: "8px 10px", marginBottom: 8, fontSize: 12, color: C.warnText, fontWeight: 600 }}>
          <Ic n="⚠" /> Corrección histórica pendiente de aprobación: no se registran ni corrigen documentos en esta OC hasta resolverla.
        </div>
      )}
      {docs.length === 0 && (
        <div style={{ fontSize: 12, color: oc.estado_factura_propia === "emitida" ? C.warnText : C.inkFaint, marginBottom: 8 }}>
          {oc.estado_factura_propia === "emitida" ? "Factura registrada en el historial sin número ni fecha (registro antiguo)." : "Sin documentos tributarios aún."}
        </div>
      )}
      {grupos.map((g, i) => (
        <div key={i} data-cadena={i} style={{ marginBottom: 6 }}>
          {g.map((d, j) => <FilaDocumento key={d.id} oc={oc} d={d} primero={j === 0} perfil={perfil} bloqueado={bloqueado} onEditar={onEditar} onEliminar={onEliminar} />)}
        </div>
      ))}

      <div data-monto-tributario style={{ background: C.infoLight, border: `1px solid ${C.info}33`, borderRadius: 10, padding: "10px 12px", marginTop: 4 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
          <span style={{ ...titulo, color: C.info }}>Monto tributario vigente</span>
          <span style={{ fontFamily: MONO, fontWeight: 800, fontSize: 17, color: C.ink }}>{fmt.money(monto)}</span>
        </div>
        <div style={{ fontSize: 12, color: C.inkMuted, marginTop: 4, lineHeight: 1.5 }}>
          Facturas vigentes {fmt.money(totalVig)}{vig.length ? ` (${vig.map((f) => f.numero_factura).join(", ")})` : ""}
          {nd.length > 0 && <> · + ND {fmt.money(nd.reduce((s, x) => s + (Number(x.monto) || 0), 0))}</>}
          {nc3.length > 0 && <> · − NC que corrigen montos {fmt.money(nc3.reduce((s, x) => s + (Number(x.monto) || 0), 0))}</>}
        </div>
        {monto > 0 && Math.abs(difOC) > 1 && <div style={{ marginTop: 6 }}><Badge tono="warn">Diferencia SII · venta OC {fmt.money(oc.monto_total)} ({difOC > 0 ? "faltan" : "sobran"} {fmt.money(Math.abs(difOC))})</Badge></div>}
        {difBase && <div style={{ fontSize: 12, color: C.warnText, marginTop: 6 }}><Ic n="⚠" /> El facturado registrado ({fmt.money(oc.monto_facturado)}) incluye una corrección histórica pendiente.</div>}
      </div>

      {!bloqueado && (
        <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
          <button onClick={onEmitir} style={{ ...btnP(C.info), flex: "1 1 160px", width: "auto" }}><Ic n="🧾" /> {vig.length ? "Emitir / re-emitir factura" : "Emitir factura"}</button>
          {docs.some(esFactura) && <button data-accion="registrar-nc" onClick={onRegistrarNC} style={{ ...btnP(C.inkMuted), flex: "1 1 160px", width: "auto" }}><Ic n="📋" /> Registrar nota de crédito</button>}
        </div>
      )}

      {fv?.numero_factura && (
        <div style={{ fontSize: 12, color: C.inkMuted, marginTop: 10, lineHeight: 1.6 }}>
          Verificar en el SII: RUT emisor <b style={{ color: C.ink }}>77.322.317-3</b> · folio{" "}
          <b data-consulta="1" onClick={() => { if (navigator.clipboard) navigator.clipboard.writeText(String(fv.numero_factura)).catch(() => {}); setCopiado(true); setTimeout(() => setCopiado(false), 1500); }}
            style={{ color: C.ink, cursor: "pointer", textDecoration: "underline dotted" }}>{fv.numero_factura}</b>
          {copiado && <span style={{ color: C.okText, fontWeight: 700 }}> ✓ copiado</span>}
          {" · "}<a data-consulta="1" href="https://palena.sii.cl/dte/mn_verif_doc.html" target="_blank" rel="noopener noreferrer" style={{ color: C.info, fontWeight: 700 }}>verificador del SII ↗</a>
        </div>
      )}
    </div>
  );
}

// ── Registrar nota de crédito ──────────────────────────────────
export function FormNotaCredito({ oc, onSave }) {
  const facturas = (oc.eventos_factura || []).filter(esFactura);
  const vigentes = new Set(facturasVigentesDe(oc).map((f) => f.id));
  const orden = facturas.slice().sort((a, b) => (vigentes.has(b.id) ? 1 : 0) - (vigentes.has(a.id) ? 1 : 0));
  const [folio, setFolio] = useState(""); const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [ref, setRef] = useState(orden[0]?.id || ""); const [codigo, setCodigo] = useState(2);
  const [monto, setMonto] = useState(""); const [motivo, setMotivo] = useState("");
  const [err, setErr] = useState(""); const [saving, setSaving] = useState(false);
  const f = facturas.find((x) => x.id === ref);
  const montoFinal = codigo === 2 ? 0 : codigo === 1 ? Number(f?.monto) || 0 : Number(monto) || 0;
  const guardar = async () => {
    if (!folio.trim()) return setErr("Indica el folio de la NC");
    if (!f) return setErr("Elige la factura que corrige");
    if ((oc.eventos_factura || []).some((d) => esNotaCredito(d) && String(d.numero_factura).trim() === folio.trim())) return setErr(`La NC ${folio} ya está registrada en esta OC`);
    if (codigo === 3 && (montoFinal <= 0 || montoFinal > (Number(f.monto) || 0))) return setErr("El monto de una NC que corrige montos debe ser mayor que $0 y no superar la factura");
    if (codigo !== 2 && !motivo.trim()) return setErr("Indica el motivo (razón de referencia del SII)");
    setErr(""); setSaving(true);
    try { await onSave({ ocId: oc.id, folio: folio.trim(), fecha, monto: montoFinal, refFolio: String(f.numero_factura).trim(), refTipoDte: Number(f.tipo_dte) || 33, refCodigo: codigo, refMotivo: motivo.trim() || null }); }
    catch (e) { setErr(e.message); } finally { setSaving(false); }
  };
  const opcion = (c, t, d) => (
    <label key={c} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "8px 10px", border: `1px solid ${codigo === c ? C.info : C.border}`, borderRadius: 9, marginBottom: 6, cursor: "pointer", background: codigo === c ? C.infoLight : C.card }}>
      <input type="radio" name="codigo-ref" checked={codigo === c} onChange={() => setCodigo(c)} style={{ marginTop: 3 }} />
      <span><b style={{ fontSize: 13 }}>Código {c} · {t}</b><br /><span style={{ fontSize: 12, color: C.inkMuted }}>{d}</span></span>
    </label>
  );
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field label="Folio NC" required><input style={iMono} inputMode="numeric" value={folio} onChange={(e) => setFolio(e.target.value)} /></Field>
        <Field label="Fecha" required><input style={iStyle} type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></Field>
      </div>
      <Field label="Factura que corrige" required>
        <select style={selStyle} value={ref} onChange={(e) => setRef(e.target.value)}>
          {orden.map((x) => <option key={x.id} value={x.id}>{nombreDocumento(x)} · {fmt.money(x.monto)}{vigentes.has(x.id) ? "" : " (anulada)"}</option>)}
        </select>
      </Field>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.inkMuted, marginBottom: 6 }}>Código de referencia SII</div>
      {opcion(2, "Corrige texto", "Corrige giro, razón social u otro texto. No anula la factura ni cambia montos.")}
      {opcion(1, "Anula documento", "Anula la factura completa; deja de contar como facturado.")}
      {opcion(3, "Corrige montos", "Rebaja parte del monto de la factura (NC parcial).")}
      {codigo === 3 && <Field label="Monto de la NC ($)" required><input style={iMono} type="number" inputMode="numeric" value={monto} onChange={(e) => setMonto(e.target.value)} /></Field>}
      <Field label="Motivo (razón de referencia)" required={codigo !== 2}><input style={iStyle} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder={codigo === 2 ? "Ej.: Corrección giro de factura" : ""} /></Field>
      <div style={{ background: C.infoLight, borderRadius: 9, padding: "9px 11px", fontSize: 12.5, color: C.info, fontWeight: 700, marginBottom: 12 }}>
        Monto de la NC: {fmt.money(montoFinal)} · {codigo === 2 ? "sin efecto monetario; la factura sigue vigente" : codigo === 1 ? "la factura queda anulada" : `lo facturado baja ${fmt.money(montoFinal)}`}
      </div>
      {err && <div style={{ background: C.dangerLight, color: C.dangerText, borderRadius: 8, padding: "8px 12px", fontSize: 12.5, marginBottom: 10, fontWeight: 600 }}>{err}</div>}
      <button onClick={guardar} disabled={saving} style={btnP(saving ? C.inkFaint : C.info)}>{saving ? "Guardando…" : "✓ Registrar nota de crédito"}</button>
    </div>
  );
}

// ── Cobranza: parte de la facturación tributaria vigente ───────
export function CobranzaFicha({ oc }) {
  const facturado = Number(oc.monto_facturado) || 0, cobrado = Number(oc.monto_cobrado) || 0;
  const porCobrar = Math.max(0, facturado - cobrado);
  const pendientes = porCobrar > 0 ? facturasVigentesDe(oc) : [];
  const plazo = plazoPago(oc);
  return (
    <div data-cobranza-ficha style={{ marginBottom: 10 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginBottom: 8 }}>
        {[["Facturado vigente", facturado, C.info], ["Cobrado", cobrado, C.okText], ["Por cobrar", porCobrar, porCobrar > 0 ? C.dangerText : C.inkMuted]].map(([k, v, c]) => (
          <div key={k} style={{ background: C.paper, borderRadius: 9, padding: "7px 9px" }}>
            <div style={{ fontSize: 11, color: C.inkFaint, fontWeight: 700, textTransform: "uppercase" }}>{k}</div>
            <div style={{ fontFamily: MONO, fontWeight: 800, fontSize: 13.5, color: c }}>{fmt.money(v)}</div>
          </div>
        ))}
      </div>
      {pendientes.length > 0 && (
        <div>
          <div style={{ ...titulo, marginBottom: 4 }}>Documentos pendientes de cobro</div>
          {pendientes.map((f) => {
            const dias = fmt.diasDesde(f.fecha);
            const v = dias != null ? estadoVencimiento(dias, plazo) : null;
            return (
              <div key={f.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12.5, padding: "6px 0", borderBottom: `1px solid ${C.border}` }}>
                <span>{nombreDocumento(f)} · {f.fecha ? fmt.date(String(f.fecha).slice(0, 10)) : "sin fecha"}</span>
                <span style={{ color: v?.vencida ? C.dangerText : v?.porVencer ? C.warnText : C.inkMuted, fontWeight: 700, whiteSpace: "nowrap" }}>
                  {dias == null ? "—" : v.vencida ? `vencida hace ${dias - plazo}d` : `vence en ${v.diasRestantes}d`}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Comunicaciones / pendientes ────────────────────────────────
export function ComunicacionesFicha({ oc, pendientes }) {
  const reclamos = (oc.oc_reclamos || []).slice().sort((a, b) => String(b.fecha || "").localeCompare(String(a.fecha || "")));
  return (
    <div data-comunicaciones>
      <div style={{ ...titulo, marginBottom: 4 }}>Pendientes</div>
      {pendientes.length === 0
        ? <div style={{ fontSize: 12.5, color: C.okText, marginBottom: 10 }}>✓ Sin pendientes.</div>
        : <ul style={{ margin: "0 0 10px", paddingLeft: 18, fontSize: 12.5, color: C.ink, lineHeight: 1.6 }}>{pendientes.map((p, i) => <li key={i}>{p}</li>)}</ul>}
      <div style={{ ...titulo, marginBottom: 4 }}>Correos enviados desde BFK</div>
      {reclamos.length === 0
        ? <div style={{ fontSize: 12, color: C.inkFaint, marginBottom: 10 }}>Ninguno.</div>
        : reclamos.map((r) => (
          <div key={r.id} style={{ fontSize: 12, color: C.inkMuted, padding: "5px 0", borderBottom: `1px solid ${C.border}` }}>
            {r.fecha ? fmt.date(String(r.fecha).slice(0, 10)) : "—"} · {r.tipo || "reclamo de pago"} · {r.correo || "—"}{r.respuesta ? ` · respuesta: ${r.respuesta}` : ""}
          </div>
        ))}
      <div data-correos-pendiente style={{ marginTop: 10, border: `1px dashed ${C.border}`, borderRadius: 10, padding: "10px 12px", fontSize: 12, color: C.inkFaint, lineHeight: 1.5 }}>
        <Ic n="📧" /> Aquí se mostrarán los correos relacionados con esta OC (cliente, proveedor y SII) cuando se conecte el correo. Por ahora no se leen correos.
      </div>
    </div>
  );
}
