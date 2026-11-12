import { C, T } from "../../lib/theme";

// Lista de avance de una cotización (los mismos pasos y el mismo comportamiento en Mercado Público y Ventas privadas): cada paso
// lleva a su pestaña. Es secundaria respecto de las pestañas, por eso va en tamaño reducido (antes cada paso tenía el alto de un
// botón principal). Los pasos pasan a otra fila si no caben: siempre se ven todos, también los pendientes.
// pasos: [[texto, completado, pestaña], …]
export function PasosCotizacion({ pasos, onIr }) {
  return (
    <div data-pasos-cotizacion role="list" aria-label="Avance de la cotización" style={{ display: "flex", flexWrap: "wrap", gap: 4, margin: "-6px 0 12px", fontSize: T.small }}>
      {pasos.map(([t, ok, tab], i) => (
        <button key={t} type="button" role="listitem" data-compact data-paso={ok ? "listo" : "pendiente"} onClick={() => onIr(tab)}
          style={{ flexShrink: 0, minHeight: 30, border: `1px solid ${ok ? "transparent" : C.border}`, background: ok ? C.okLight : C.card, color: ok ? C.okText : C.inkMuted, borderRadius: 999, padding: "3px 10px", cursor: "pointer", fontWeight: 500, whiteSpace: "nowrap" }}>
          {ok ? "✓" : i + 1} {t}
        </button>
      ))}
    </div>
  );
}
