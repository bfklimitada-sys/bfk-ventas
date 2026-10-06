import { useState } from "react";
import { Field } from "../ui/Basicos";
import { C, btnP, fmt, selStyle } from "../../lib/theme";
import { TIPOS_FINANCIAMIENTO, esFondosPropios, tipoFinanciamiento } from "../../lib/finanzas";

// Cambio de financiamiento de una OC (Fase 4B, M2): financiador externo, fondos propios o venta propia.
// Lo ejecuta la base en una sola operación: recalcula la deuda del financiador anterior y del nuevo y la
// etapa de financiamiento. Si la OC ya tiene pagos al financiador, la base lo rechaza (no reasigna pagos en silencio).
export function FormCambiarFinanciamiento({ oc, financiadores, onSave, onCancel }) {
  const actual = tipoFinanciamiento(oc, financiadores);
  const externos = (financiadores || []).filter((f) => !esFondosPropios(f));
  const propios = (financiadores || []).filter(esFondosPropios);
  const [tipo, setTipo] = useState(actual);
  const [finId, setFinId] = useState(oc.financiador_id || "");
  const [err, setErr] = useState(""); const [saving, setSaving] = useState(false);
  const lista = tipo === "externo" ? externos : tipo === "fondos_propios" ? propios : [];
  const finValido = tipo === "venta_propia" || lista.some((f) => f.id === finId);
  const pagado = Number(oc.monto_pagado_fin) || 0;

  const guardar = async () => {
    if (!finValido) { setErr("Elige el financiador"); return; }
    setErr(""); setSaving(true);
    try { await onSave({ tipo, financiadorId: tipo === "venta_propia" ? (oc.financiador_id || null) : finId }); }
    catch (e) { setErr(e.message); setSaving(false); }
  };

  return (
    <div data-form="cambiar-financiamiento" style={{ background: C.paper, borderRadius: 10, padding: "10px 12px", marginTop: 8 }}>
      <Field label="Tipo de financiamiento" required>
        <select style={selStyle} value={tipo} onChange={(e) => {
          const t = e.target.value; setTipo(t); setErr("");
          const l = t === "externo" ? externos : t === "fondos_propios" ? propios : [];
          if (!l.some((f) => f.id === finId)) setFinId(l[0]?.id || "");
        }}>
          {Object.entries(TIPOS_FINANCIAMIENTO).map(([k, v]) => <option key={k} value={k}>{v.etiqueta}</option>)}
        </select>
      </Field>
      {tipo !== "venta_propia" && (
        <Field label={tipo === "externo" ? "Financiador" : "Cuenta"} required>
          <select style={selStyle} value={finId} onChange={(e) => { setFinId(e.target.value); setErr(""); }}>
            <option value="">Elige…</option>
            {lista.map((f) => <option key={f.id} value={f.id}>{f.nombre}</option>)}
          </select>
        </Field>
      )}
      <div style={{ fontSize: 12, color: C.inkMuted, lineHeight: 1.45, marginBottom: 10 }}>
        {TIPOS_FINANCIAMIENTO[tipo].detalle} La base recalcula la deuda del financiador anterior y del nuevo
        (costo de la compra: <b>{fmt.money(oc.costo_total)}</b>).
        {pagado > 0 && <> <b style={{ color: C.warnText }}>Esta OC tiene {fmt.money(pagado)} pagados al financiador:</b> el cambio no se permite hasta corregir esos pagos.</>}
        {tipo === "venta_propia" && !oc.vendedor_id && <> <b style={{ color: C.warnText }}>La venta propia requiere un vendedor asignado.</b></>}
      </div>
      {err && <div style={{ background: C.dangerLight, color: C.dangerText, borderRadius: 8, padding: "8px 12px", fontSize: 12.5, marginBottom: 10, fontWeight: 600 }}>{err}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={guardar} disabled={saving || (tipo === actual && (tipo === "venta_propia" || finId === oc.financiador_id))}
          style={{ ...btnP(saving ? C.inkFaint : C.purple), flex: 1 }}>{saving ? "Guardando…" : "✓ Cambiar financiamiento"}</button>
        {onCancel && <button onClick={onCancel} style={{ ...btnP(C.inkFaint), flex: "0 0 auto", width: "auto", padding: "0 14px" }}>Cancelar</button>}
      </div>
    </div>
  );
}
