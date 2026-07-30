import { useState, useMemo } from "react";
import { Field, BuscadorOC } from "../ui/Basicos";
import { C, MONO, SANS, btnP, fmt, iStyle, iMono, selStyle } from "../../lib/theme";

export function FormCompraRapida({ ocs, financiadores, perfil, onSave, ocPreseleccionada }) {
  // Solo OCs que todavía no tienen compra registrada
  const disponibles = useMemo(
    () => ocs.filter(o => (o.eventos_compra || []).length === 0),
    [ocs]
  );

  const [ocId, setOcId] = useState(ocPreseleccionada || null);
  const [costo, setCosto] = useState("");
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [fechaEst, setFechaEst] = useState("");
  const [financiadorId, setFinanciadorId] = useState(
    perfil?.financiador_default || financiadores[0]?.id || ""
  );
  const [proveedor, setProveedor] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const oc = ocs.find(o => o.id === ocId);
  const venta = Number(oc?.monto_total) || 0;
  const c = Number(costo) || 0;
  const utilidad = venta - c;
  const margenPct = venta > 0 ? Math.round((utilidad / venta) * 100) : 0;
  const colorMargen = margenPct >= 20 ? C.ok : margenPct >= 10 ? C.warn : C.danger;

  const guardar = async () => {
    if (!ocId) { setErr("Selecciona la OC"); return; }
    if (!costo || c <= 0) { setErr("Indica cuánto costó la compra"); return; }
    if (!financiadorId) { setErr("Indica quién financió"); return; }
    setErr(""); setSaving(true);
    try {
      await onSave({
        ocId, costoCompra: c, fecha,
        fechaEst: fechaEst || null,
        financiadorId, proveedor: proveedor.trim(),
      });
    } catch (e) { setErr(e.message); setSaving(false); }
  };

  return (
    <div style={{ fontFamily: SANS }}>
      {!ocPreseleccionada && (
        <Field label="Orden de compra" required hint={`${disponibles.length} OC sin compra registrada`}>
          <BuscadorOC ocs={disponibles} ocId={ocId} setOcId={setOcId} />
        </Field>
      )}

      {oc && (
        <div style={{ background: C.paper, borderRadius: 10, padding: "10px 14px", marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: C.inkMuted }}>{oc.cliente}{oc.comuna ? ` · ${oc.comuna}` : ""}</div>
          <div style={{ fontSize: 12.5, color: C.inkMuted, marginTop: 4 }}>
            Venta: <b style={{ color: C.ink, fontFamily: MONO }}>{fmt.money(venta)}</b>
          </div>
        </div>
      )}

      <Field label="¿Cuánto nos costó?" required hint="Lo que se pagó al proveedor">
        <input style={iMono} type="number" value={costo} inputMode="numeric"
          onChange={e => { setCosto(e.target.value); setErr(""); }} placeholder="0" />
      </Field>

      {/* Margen en vivo, para detectar al tiro una compra mala */}
      {oc && c > 0 && (
        <div style={{
          background: margenPct >= 20 ? C.okLight : margenPct >= 10 ? C.warnLight : C.dangerLight,
          borderRadius: 10, padding: "10px 14px", marginBottom: 14,
          display: "flex", justifyContent: "space-between", alignItems: "center"
        }}>
          <div>
            <div style={{ fontSize: 10.5, color: C.inkMuted, fontWeight: 700, textTransform: "uppercase" }}>Utilidad</div>
            <div style={{ fontFamily: MONO, fontWeight: 800, fontSize: 16, color: colorMargen }}>{fmt.money(utilidad)}</div>
          </div>
          <div style={{ fontFamily: MONO, fontWeight: 800, fontSize: 20, color: colorMargen }}>{margenPct}%</div>
        </div>
      )}
      {oc && c > venta && venta > 0 && (
        <div style={{ background: C.dangerLight, color: C.danger, borderRadius: 8, padding: "8px 12px", fontSize: 12, marginBottom: 12, fontWeight: 600 }}>
          ⚠ El costo es mayor que la venta — revisa el monto
        </div>
      )}

      <Field label="¿Quién financió?" required
        hint={perfil?.financiador_default ? "Precargado según tu usuario — cámbialo si fue otro" : ""}>
        <select style={selStyle} value={financiadorId} onChange={e => setFinanciadorId(e.target.value)}>
          <option value="">Selecciona…</option>
          {financiadores.map(f => <option key={f.id} value={f.id}>{f.nombre}</option>)}
        </select>
      </Field>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field label="Fecha de compra" required>
          <input style={iStyle} type="date" value={fecha} onChange={e => setFecha(e.target.value)} />
        </Field>
        <Field label="Entrega estimada" hint="Aparece en la agenda">
          <input style={iStyle} type="date" value={fechaEst} onChange={e => setFechaEst(e.target.value)} />
        </Field>
      </div>

      <Field label="Proveedor / nota" hint="Opcional">
        <input style={iStyle} value={proveedor} onChange={e => setProveedor(e.target.value)}
          placeholder="ej: MercadoLibre, Sodimac…" />
      </Field>

      {err && <div style={{ background: C.dangerLight, color: C.danger, borderRadius: 8, padding: "8px 12px", fontSize: 12.5, marginBottom: 10, fontWeight: 600 }}>{err}</div>}

      <button onClick={guardar} disabled={saving} style={btnP(saving ? C.inkFaint : C.teal)}>
        {saving ? "Guardando…" : "✓ Registrar compra"}
      </button>
    </div>
  );
}
