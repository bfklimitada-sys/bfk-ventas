import { useState } from "react";
import { Field } from "../ui/Basicos";
import { C, MONO, SANS, btnP, fmt, iStyle, iMono } from "../../lib/theme";

// El saldo no se reconstruye sumando dos años de operación: se ancla al
// número real del banco en una fecha, y desde ahí la app suma y resta
// solo lo que se registre después.
export function FormSaldoBanco({ actual, onSave }) {
  const [saldo, setSaldo] = useState(actual?.saldo ?? "");
  const [fecha, setFecha] = useState(
    actual?.fecha_corte ? String(actual.fecha_corte).slice(0, 10)
                        : new Date().toISOString().slice(0, 10));
  const [nota, setNota] = useState(actual?.nota || "");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  const guardar = async () => {
    if (saldo === "" || isNaN(Number(saldo))) { setErr("Indica el saldo"); return; }
    setErr(""); setSaving(true);
    try { await onSave({ saldo: Number(saldo), fecha, nota: nota.trim() }); }
    catch (e) { setErr(e.message); setSaving(false); }
  };

  return (
    <div style={{ fontFamily: SANS }}>
      <div style={{ background: C.tealLight, borderRadius: 10, padding: "12px 14px", marginBottom: 16 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: C.tealDark, marginBottom: 5 }}>
          Cómo funciona
        </div>
        <div style={{ fontSize: 12, color: C.inkMuted, lineHeight: 1.55 }}>
          Entra a BancoEstado, mira el saldo de la cuenta y escríbelo aquí.
          Desde esa fecha, la app le suma los cobros y le resta los pagos que
          se vayan registrando. Así el número no depende de reconstruir años
          de movimientos.
        </div>
      </div>

      {actual && (
        <div style={{ background: C.paper, borderRadius: 9, padding: "9px 12px", marginBottom: 14, fontSize: 12, color: C.inkMuted }}>
          Actual: <b style={{ color: C.ink, fontFamily: MONO }}>{fmt.money(actual.saldo)}</b>
          {" "}al {fmt.date(String(actual.fecha_corte).slice(0, 10))}
        </div>
      )}

      <Field label="Saldo en la cuenta ($)" required hint="El que muestra BancoEstado ahora">
        <input style={iMono} type="number" inputMode="numeric" value={saldo} autoFocus
          onChange={e => { setSaldo(e.target.value); setErr(""); }} placeholder="0" />
      </Field>

      <Field label="Fecha del saldo" required hint="Los movimientos posteriores se suman sobre esta base">
        <input style={iStyle} type="date" value={fecha} onChange={e => setFecha(e.target.value)} />
      </Field>

      <Field label="Nota" hint="Opcional">
        <input style={iStyle} value={nota} onChange={e => setNota(e.target.value)}
          placeholder="ej: revisado con la cartola del día" />
      </Field>

      {err && <div style={{ background: C.dangerLight, color: C.danger, borderRadius: 8, padding: "8px 12px", fontSize: 12.5, marginBottom: 10, fontWeight: 600 }}>{err}</div>}

      <button onClick={guardar} disabled={saving} style={btnP(saving ? C.inkFaint : C.teal)}>
        {saving ? "Guardando…" : "✓ Fijar este saldo"}
      </button>

      <div style={{ fontSize: 11, color: C.inkFaint, marginTop: 12, lineHeight: 1.5 }}>
        Conviene actualizarlo cada vez que subas una cartola, para que la base
        siempre esté al día.
      </div>
    </div>
  );
}
