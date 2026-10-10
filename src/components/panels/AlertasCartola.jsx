import { C, MONO, SANS, btnG, fmt } from "../../lib/theme";
import { registrosConAlerta } from "../../lib/registroCartola";

// Registros MANUALES que la base marcó como posible duplicado de un movimiento ya registrado desde la cartola.
// No bloquean nada: se revisan y se quita la alerta (o se corrige el registro por la vía habitual).
export function AlertasCartola({ ocs, gastos, pagosVendedor, pagoFinSueltos, aportes, onQuitar }) {
  const lista = registrosConAlerta({ ocs, gastos, pagosVendedor, pagoFinSueltos, aportes });
  if (!lista.length) return null;
  return (
    <div data-alertas-cartola style={{ fontFamily: SANS, background: C.warnLight, border: `1px solid ${C.warn}`, borderRadius: 12, padding: "12px 14px", marginBottom: 14 }}>
      <div style={{ fontWeight: 700, color: C.warnText, fontSize: 13.5 }}>Posibles duplicados con la cartola ({lista.length})</div>
      <div style={{ fontSize: 12, color: C.inkMuted, margin: "2px 0 8px" }}>Registros manuales que coinciden con un movimiento bancario ya registrado. Revíselos; si es la misma operación, anule o elimine el registro manual.</div>
      {lista.map((r) => (
        <div key={r.tabla + r.id} data-alerta={r.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderTop: `1px solid ${C.border}`, fontSize: 12.5 }}>
          <span style={{ flex: 1 }}>{r.tipo} · {r.fecha ? fmt.date(r.fecha) : ""}{r.detalle ? ` · ${r.detalle}` : ""}<br /><span style={{ color: C.inkMuted, fontSize: 11.5 }}>{r.alerta}</span></span>
          <span style={{ fontFamily: MONO }}>{fmt.money(r.monto)}</span>
          {onQuitar && <button data-quitar-alerta={r.id} onClick={() => onQuitar(r.tabla, r.id)} style={{ ...btnG, fontSize: 11.5, padding: "5px 9px" }}>Revisado</button>}
        </div>
      ))}
    </div>
  );
}
