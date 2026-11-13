import { Pestanas } from "../ui/Sistema";
import { C, T } from "../../lib/theme";

// Navegación de una cotización (misma estructura y comportamiento en Mercado Público y Ventas privadas). Las pestañas ya son los
// pasos: cada una muestra si su parte está completa (✓) o pendiente (○). Debajo, una sola línea «Falta: …» nombra los pasos
// pendientes y cada nombre lleva a su pestaña (acceso directo a cada paso). Antes había pestañas y además una fila de pasos que
// repetía lo mismo, en hasta tres filas en el celular.
// Marca de cada pestaña: ✓ verde (completa) o punto ámbar (pendiente), en la esquina para que las cuatro quepan en 360 px.
// pasos: [[texto, completado, pestaña], …] · conteos: { pestaña: n } — cuántas cosas faltan en esa pestaña; se muestra en la línea
// «Falta», junto al último paso pendiente de esa pestaña (p. ej. «Verificación de despacho (3)», «EETT (2)»).
const PESTANAS = [["datos", "Datos"], ["productos", "Productos"], ["precios", "Precios"], ["eett", "EETT"]];

export function NavegacionCotizacion({ pasos, activa, onCambiar, conteos = {} }) {
  const estadoDe = (tab) => { const p = pasos.filter((x) => x[2] === tab); return !p.length ? null : p.every((x) => x[1]) ? "listo" : "pendiente"; };
  const pendientes = pasos.filter((x) => !x[1]);
  return (
    <>
      <Pestanas etiqueta="Cotización" activa={activa} onCambiar={onCambiar} apretada style={{ marginBottom: pendientes.length ? 6 : undefined }}
        items={PESTANAS.map(([key, label]) => { const e = estadoDe(key);
          return { key, label, estado: e, attrs: { "data-estado-paso": e || "sin-paso", "aria-label": `${label}${e === "listo" ? ", completo" : e === "pendiente" ? ", pendiente" : ""}` } }; })} />
      {pendientes.length > 0 && (
        <div data-pasos-cotizacion role="list" aria-label="Pasos pendientes" style={{ fontSize: T.small, color: C.inkMuted, lineHeight: 1.6, margin: "0 0 12px", paddingLeft: 2 }}>
          <span style={{ fontWeight: 600, color: C.warnText }}>Falta: </span>
          {pendientes.map(([t, , tab], i) => { const ultimoDeSuPestana = !pendientes.slice(i + 1).some((x) => x[2] === tab); const n = ultimoDeSuPestana ? conteos[tab] : 0; return (
            <span key={t} role="listitem">
              <button type="button" data-compact data-paso="pendiente" data-paso-pestana={tab} onClick={() => onCambiar(tab)}
                style={{ background: "none", border: "none", padding: "2px 0", minHeight: 24, color: C.tealDark, fontSize: T.small, fontWeight: 600, textDecoration: "underline", textUnderlineOffset: 2, cursor: "pointer" }}>{t}{n ? ` (${n})` : ""}</button>
              {i < pendientes.length - 1 && <span aria-hidden="true"> · </span>}
            </span>
          ); })}
        </div>
      )}
    </>
  );
}
