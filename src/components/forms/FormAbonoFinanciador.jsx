import { useState, useMemo } from "react";
import { Field } from "../ui/Basicos";
import { C, MONO, SANS, btnP, fmt, iStyle, iMono, selStyle } from "../../lib/theme";

// Reparte un abono entre las OCs pendientes del financiador,
// de la más antigua a la más nueva (FIFO). La última puede quedar parcial.
export function repartirFIFO(monto, ocsPendientes) {
  let resto = Number(monto) || 0;
  const reparto = [];
  for (const oc of ocsPendientes) {
    if (resto <= 0) break;
    const debe = Math.max(0, (Number(oc.costo_total) || 0) - (Number(oc.monto_pagado_fin) || 0));
    if (debe <= 0) continue;
    const asignado = Math.min(resto, debe);
    reparto.push({ oc, asignado, debe, completa: asignado >= debe });
    resto -= asignado;
  }
  return { reparto, sobrante: resto };
}

export function FormAbonoFinanciador({ ocs, financiadores, onSave }) {
  const [finId, setFinId] = useState(financiadores[0]?.id || "");
  const [monto, setMonto] = useState("");
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [referencia, setReferencia] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const fin = financiadores.find(f => f.id === finId);

  // Pendientes de ese financiador, de la más antigua a la más nueva
  const pendientes = useMemo(() => {
    return ocs
      .filter(o => o.financiador_id === finId
        && o.estado_pago_financiamiento !== "pagado"
        && (Number(o.costo_total) || 0) > (Number(o.monto_pagado_fin) || 0))
      .sort((a, b) => {
        const fa = (a.eventos_compra || [])[0]?.fecha || a.creadoEn || "";
        const fb = (b.eventos_compra || [])[0]?.fecha || b.creadoEn || "";
        return String(fa).localeCompare(String(fb));
      });
  }, [ocs, finId]);

  const totalAdeudado = pendientes.reduce(
    (s, o) => s + Math.max(0, (Number(o.costo_total) || 0) - (Number(o.monto_pagado_fin) || 0)), 0);

  const { reparto, sobrante } = useMemo(
    () => repartirFIFO(monto, pendientes), [monto, pendientes]);

  const guardar = async () => {
    const m = Number(monto) || 0;
    if (!finId) { setErr("Selecciona el financiador"); return; }
    if (m <= 0) { setErr("Indica el monto del abono"); return; }
    if (!reparto.length) { setErr("Ese financiador no tiene OCs pendientes"); return; }
    setErr(""); setSaving(true);
    try {
      await onSave({
        financiadorId: finId, fecha, referencia: referencia.trim(),
        montoTotal: m, sobrante,
        asignaciones: reparto.map(r => ({
          ocId: r.oc.id, numeroOc: r.oc.numero_oc,
          monto: r.asignado, completa: r.completa,
        })),
      });
    } catch (e) { setErr(e.message); setSaving(false); }
  };

  return (
    <div style={{ fontFamily: SANS }}>
      <Field label="Financiador" required>
        <select style={selStyle} value={finId} onChange={e => { setFinId(e.target.value); setErr(""); }}>
          {financiadores.map(f => <option key={f.id} value={f.id}>{f.nombre}</option>)}
        </select>
      </Field>

      {fin && (
        <div style={{ background: C.paper, borderRadius: 9, padding: "10px 12px", marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: C.inkMuted }}>
            <span>{pendientes.length} OC{pendientes.length !== 1 ? "s" : ""} por devolver</span>
            <span style={{ fontFamily: MONO, fontWeight: 800, color: C.danger }}>{fmt.money(totalAdeudado)}</span>
          </div>
        </div>
      )}

      <Field label="Monto del abono ($)" required hint="Se reparte de la OC más antigua a la más nueva">
        <input style={iMono} type="number" inputMode="numeric" value={monto}
          onChange={e => { setMonto(e.target.value); setErr(""); }} placeholder="0" />
      </Field>

      <Field label="Fecha" required>
        <input style={iStyle} type="date" value={fecha} onChange={e => setFecha(e.target.value)} />
      </Field>

      <Field label="Referencia" hint="Opcional — n° de transferencia, comentario">
        <input style={iStyle} value={referencia} onChange={e => setReferencia(e.target.value)} />
      </Field>

      {/* Vista previa del reparto */}
      {reparto.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: C.inkMuted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>
            Cubre {reparto.length} OC{reparto.length !== 1 ? "s" : ""}
          </div>
          <div style={{ maxHeight: 230, overflowY: "auto", border: `1px solid ${C.border}`, borderRadius: 10 }}>
            {reparto.map((r, i) => (
              <div key={r.oc.id} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8,
                padding: "8px 11px", borderBottom: i < reparto.length - 1 ? `1px solid ${C.border}` : "none",
                background: r.completa ? C.card : C.warnLight,
              }}>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontFamily: MONO, fontSize: 11.5, fontWeight: 700, color: C.ink }}>{r.oc.numero_oc}</span>
                  <span style={{ display: "block", fontSize: 10.5, color: r.completa ? C.inkFaint : C.warn }}>
                    {r.completa ? "Queda saldada" : `Parcial · quedan ${fmt.money(r.debe - r.asignado)}`}
                  </span>
                </span>
                <span style={{ fontFamily: MONO, fontWeight: 800, fontSize: 12.5, color: r.completa ? C.ok : C.warn, flexShrink: 0 }}>
                  {fmt.money(r.asignado)}
                </span>
              </div>
            ))}
          </div>

          {sobrante > 0 && (
            <div style={{ background: C.infoLight, borderRadius: 9, padding: "9px 12px", marginTop: 8, fontSize: 11.5, color: C.info, fontWeight: 600 }}>
              Sobran {fmt.money(sobrante)} — el abono supera lo adeudado. Se registrará como pago sin OC asociada.
            </div>
          )}
        </div>
      )}

      {err && <div style={{ background: C.dangerLight, color: C.danger, borderRadius: 8, padding: "8px 12px", fontSize: 12.5, marginBottom: 10, fontWeight: 600 }}>{err}</div>}

      <button onClick={guardar} disabled={saving} style={btnP(saving ? C.inkFaint : C.purple)}>
        {saving ? "Registrando…" : `✓ Abonar ${fmt.money(Number(monto) || 0)}`}
      </button>
    </div>
  );
}
