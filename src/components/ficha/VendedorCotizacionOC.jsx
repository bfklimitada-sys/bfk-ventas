// Vendedor responsable de la cotización adjudicada vinculada a esta OC (21/10/2026).
// Nunca se sobrescribe un vendedor ya asignado en la OC: si difiere, solo se avisa. Si la OC no tiene vendedor y la
// asignación es inequívoca, se ofrece pasarlo con un toque (la base vuelve a validar y usa asignar_vendedor_oc).
// No modifica comisiones ni pagos: el cálculo de comisiones sigue las reglas actuales de la OC.
import { useState } from "react";
import { C } from "../../lib/theme";
import { Ic } from "../ui/Iconos";
import { vendedorCotizacionParaOC, mensajeVendedor } from "../../lib/vendedorCotizacion";

export function VendedorCotizacionOC({ oc, cotizaciones, vendedores, onTransferir }) {
  const [ocupado, setOcupado] = useState(false); const [error, setError] = useState("");
  const r = vendedorCotizacionParaOC(oc, cotizaciones, vendedores);
  if (r.estado === "sin_cotizacion" || r.estado === "igual") return null;
  const cod = r.cot?.id_externo || r.cot?.nombre || "cotización adjudicada";
  const nombreOC = (vendedores || []).find((v) => String(v.id) === String(oc.vendedor_id))?.nombre || (oc.capitalizacion_bfk ? "BFK Ltda. · Capitalización" : "");
  const caja = (tono, contenido) => (
    <div data-vendedor-cotizacion={r.estado} style={{ background: tono === "warn" ? C.warnLight : C.infoLight, border: `1px solid ${tono === "warn" ? C.warn : C.info}55`, borderRadius: 8, padding: "8px 10px", fontSize: 12, color: tono === "warn" ? C.warnText : C.ink, margin: "6px 0 10px", lineHeight: 1.45 }}>{contenido}</div>);
  if (r.estado === "ambigua") return caja("warn", <><Ic n="⚠" /> Hay {r.n} cotizaciones adjudicadas vinculadas a esta OC: el vendedor no se transfiere automáticamente.</>);
  if (r.estado === "sin_vendedor") return caja("warn", <><Ic n="⚠" /> La cotización {cod} vinculada no tiene vendedor responsable.</>);
  if (r.estado === "diferente") return caja("warn", <><Ic n="⚠" /> La cotización {cod} indica como vendedor a <b>{r.cot.vendedor_nombre}</b>, pero la OC tiene a <b>{nombreOC || "otro"}</b>. No se cambia automáticamente; revísalo en «Vendedor».</>);
  if (r.estado === "solo_cotizaciones") return caja("warn", <><Ic n="⚠" /> La cotización {cod} tiene como vendedor a <b>{r.cot.vendedor_nombre}</b>, registrado solo en Cotizaciones: asígnalo manualmente en «Vendedor».</>);
  return caja("info", <>
    La cotización adjudicada {cod} tiene como vendedor responsable a <b>{r.cot.vendedor_nombre}</b> y esta OC aún no tiene vendedor.
    <div style={{ marginTop: 6 }}>
      <button data-transferir-vendedor disabled={ocupado} onClick={async () => { setOcupado(true); setError(""); try { await onTransferir(r.cot.id); } catch (e) { setError(mensajeVendedor(e)); } setOcupado(false); }}
        style={{ border: `1.5px solid ${C.info}`, background: C.card, color: C.ink, borderRadius: 8, padding: "6px 12px", minHeight: 36, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
        {ocupado ? "Asignando…" : `Asignar a ${r.cot.vendedor_nombre} como vendedor de la OC`}</button>
    </div>
    {error && <div role="alert" style={{ color: C.dangerText, marginTop: 6 }}>{error}</div>}
  </>);
}
