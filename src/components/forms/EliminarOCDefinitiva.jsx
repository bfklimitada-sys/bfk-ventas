// Eliminación DEFINITIVA de una OC (solo administradores; 23/10/2026). La base decide: esta pantalla muestra lo que la
// base revisó (registros asociados, movimientos financieros, bloqueos y advertencias) y pide el motivo y el N° de la OC.
// Si hay movimientos financieros, solo se elimina como duplicado de una OC original con los mismos movimientos.
import { useEffect, useMemo, useState } from "react";
import { Field } from "../ui/Basicos";
import { C, MONO, btnP, fmt, iStyle, selStyle } from "../../lib/theme";
import { rpcEliminarOC, rpcRevisarEliminacionOC } from "../../lib/supabase";
import { NOMBRE_MOVIMIENTO, NOMBRE_REGISTRO, mensajeErrorEliminar, puedeEliminar, sugerirOriginales } from "../../lib/eliminarOC";

const caja = (fondo, borde) => ({ background: fondo, border: `1px solid ${borde}`, borderRadius: 10, padding: "10px 12px", marginBottom: 12, fontSize: 13, lineHeight: 1.5 });

export function EliminarOCDefinitiva({ token, oc, todas, onEliminada }) {
  const sugeridas = useMemo(() => sugerirOriginales(oc, todas), [oc, todas]);
  const [originalId, setOriginalId] = useState(sugeridas[0]?.oc.id || "");
  const [rev, setRev] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [motivo, setMotivo] = useState("");
  const [codigo, setCodigo] = useState("");
  const [eliminando, setEliminando] = useState(false);

  useEffect(() => {
    let vivo = true;
    setCargando(true); setError("");
    rpcRevisarEliminacionOC(token, oc.id, originalId || null)
      .then((r) => { if (vivo) setRev(r); })
      .catch((e) => { if (vivo) { setRev(null); setError(mensajeErrorEliminar(e)); } })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [token, oc.id, originalId]);

  const otras = useMemo(() => (todas || []).filter((o) => o.id !== oc.id && !sugeridas.some((s) => s.oc.id === o.id))
    .sort((a, b) => String(a.numero_oc).localeCompare(String(b.numero_oc))), [todas, oc.id, sugeridas]);
  const listo = puedeEliminar(rev, codigo, motivo) && !eliminando && !cargando;
  const registros = Object.entries(rev?.registros || {});
  const movs = rev?.movimientos || [];

  const eliminar = async () => {
    if (!listo) return;
    setEliminando(true); setError("");
    try {
      await rpcEliminarOC(token, { ocId: oc.id, confirmacion: codigo.trim(), motivo: motivo.trim(), originalId: originalId || null });
      await onEliminada?.(oc);
    } catch (e) { setError(mensajeErrorEliminar(e)); setEliminando(false); }
  };

  return (
    <div data-eliminar-oc={oc.numero_oc}>
      <div style={caja(C.dangerLight, C.danger + "55")}>
        <b style={{ color: C.dangerText }}>Eliminación definitiva de la OC {oc.numero_oc}</b>
        <div style={{ color: C.ink }}>{oc.cliente || "—"} · {fmt.money(oc.monto_total || 0)} · {oc.archivada ? "archivada" : "activa"}</div>
        <div style={{ color: C.inkMuted, marginTop: 4 }}>Se borran la OC y sus registros. Queda una copia completa en la auditoría (quién, cuándo, motivo y todo lo borrado).</div>
      </div>

      <Field label="OC original (si esta es un duplicado)" hint="Obligatoria si la OC tiene cobros, facturas, compras o devoluciones: cada uno debe existir también en la original.">
        <select value={originalId} onChange={(e) => setOriginalId(e.target.value)} style={selStyle} data-original>
          <option value="">— Ninguna (OC sin movimientos financieros) —</option>
          {sugeridas.length > 0 && <optgroup label="Sugeridas">{sugeridas.map((s) => <option key={s.oc.id} value={s.oc.id}>{s.oc.numero_oc} · {s.oc.cliente || "—"} ({s.motivo})</option>)}</optgroup>}
          <optgroup label="Otras OC">{otras.map((o) => <option key={o.id} value={o.id}>{o.numero_oc} · {o.cliente || "—"}{o.archivada ? " (archivada)" : ""}</option>)}</optgroup>
        </select>
      </Field>

      {cargando && <div style={{ fontSize: 13, color: C.inkMuted, marginBottom: 12 }}>Revisando lo asociado a la OC…</div>}
      {!cargando && rev && (<>
        <div style={{ fontSize: 12, fontWeight: 800, color: C.inkMuted, textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 6 }}>Registros asociados</div>
        <div data-registros-asociados style={{ fontSize: 13, color: C.ink, marginBottom: 12 }}>
          {registros.length ? registros.map(([t, n]) => <span key={t} style={{ display: "inline-block", marginRight: 10 }}>{n} {NOMBRE_REGISTRO[t] || t}</span>) : "Ninguno."}
        </div>
        {movs.length > 0 && (
          <div data-movimientos style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: C.inkMuted, textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 6 }}>Movimientos financieros</div>
            {movs.map((m) => (
              <div key={m.id} data-mov-financiero={m.id} data-equivalente={m.equivalente ? "1" : "0"} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13, padding: "6px 0", borderTop: `1px solid ${C.border}` }}>
                <span>{NOMBRE_MOVIMIENTO[m.tipo] || m.tipo} · {fmt.date(m.fecha)}{m.tipo === "factura" && m.detalle ? ` · folio ${m.detalle}` : ""}</span>
                <span style={{ textAlign: "right" }}><span style={{ fontFamily: MONO, whiteSpace: "nowrap" }}>{fmt.money(m.monto)}</span>
                  {rev.original ? <span style={{ display: "block", fontSize: 12, fontWeight: 700, color: m.equivalente ? C.okText : C.dangerText }}>{m.equivalente ? "✓ igual en la original" : "✗ sin igual en la original"}</span> : null}</span>
              </div>
            ))}
          </div>
        )}
        {(rev.bloqueos || []).length > 0 && (
          <div data-bloqueos style={caja(C.dangerLight, C.danger + "55")}>
            <b style={{ color: C.dangerText }}>No se puede eliminar:</b>
            <ul style={{ margin: "4px 0 0 18px", padding: 0 }}>{rev.bloqueos.map((b, i) => <li key={i} data-bloqueo={b.codigo}>{b.texto}</li>)}</ul>
          </div>
        )}
        {(rev.advertencias || []).length > 0 && (
          <div data-advertencias style={caja(C.warnLight, C.warn + "66")}>
            <b style={{ color: C.warnText }}>Antes de eliminar, tenga en cuenta:</b>
            <ul style={{ margin: "4px 0 0 18px", padding: 0 }}>{rev.advertencias.map((a, i) => <li key={i} data-advertencia={a.codigo}>{a.texto}</li>)}</ul>
          </div>
        )}
      </>)}
      {error && <div role="alert" data-error-eliminar style={caja(C.dangerLight, C.danger + "55")}>{error}</div>}

      {rev?.eliminable && (<>
        <Field label="Motivo" required>
          <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} placeholder="Ej.: OC duplicada por la importación del 29/07" style={{ ...iStyle, minHeight: 64, resize: "vertical" }} data-motivo />
        </Field>
        <Field label={`Escriba el N° de la OC para confirmar: ${oc.numero_oc}`} required>
          <input value={codigo} onChange={(e) => setCodigo(e.target.value)} autoComplete="off" spellCheck={false} style={{ ...iStyle, fontFamily: MONO }} data-confirmar-codigo />
        </Field>
        <button type="button" onClick={eliminar} disabled={!listo} data-eliminar-definitivo
          style={{ ...btnP(C.danger), opacity: listo ? 1 : 0.5, cursor: listo ? "pointer" : "default" }}>
          {eliminando ? "Eliminando…" : "Eliminar definitivamente"}
        </button>
      </>)}
    </div>
  );
}
