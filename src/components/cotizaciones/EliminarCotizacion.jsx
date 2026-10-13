import { useState } from "react";
import { C, T, iStyle } from "../../lib/theme";
import { Modal } from "../ui/Basicos";
import { AvisoLinea, BotonSecundario } from "../ui/Sistema";
import { normalNombre } from "../../lib/cotizacionesDatos";

// Confirmación de «Eliminar cotización» (solo administradores; el servidor vuelve a validar permisos y reglas).
// Nunca con un solo clic: hay que escribir el código o el nombre. Bloqueado para adjudicadas o con OC vinculada.
export function EliminarCotizacion({ cot, nEett = 0, onCancelar, onEliminar }) {
  const [texto, setTexto] = useState(""); const [eliminando, setEliminando] = useState(false); const [error, setError] = useState("");
  const idInterno = String(cot.id || "").slice(0, 8).toUpperCase();
  const sinCodigoNiNombre = !String(cot.id_externo || "").trim() && !String(cot.nombre || "").trim();
  const referencia = sinCodigoNiNombre ? idInterno : cot.id_externo || cot.nombre || "";
  // Sin código ni nombre se confirma con el identificador interno corto (también lo exige el servidor).
  const coincide = !!normalNombre(texto) && (sinCodigoNiNombre ? normalNombre(texto) === idInterno : [cot.id_externo, cot.nombre].some((x) => x && normalNombre(x) === normalNombre(texto)));
  const bloqueada = cot.estado === "adjudicada" || !!String(cot.oc_codigo || "").trim();
  const eliminar = async () => {
    setEliminando(true); setError("");
    try { await onEliminar(texto.trim()); } catch (e) { setError(e.message); setEliminando(false); }
  };
  return (
    <Modal title="Eliminar cotización" onClose={() => { if (!eliminando) onCancelar(); }}>
      <div data-modal-eliminar>
        <div style={{ fontSize: T.body, fontWeight: 800, color: C.ink }}>{cot.id_externo || "Sin código"}{cot.nombre ? ` · ${cot.nombre}` : ""}{sinCodigoNiNombre ? ` · ID ${idInterno}` : ""}</div>
        <div style={{ fontSize: T.sm, color: C.inkMuted, marginBottom: 10 }}>{cot.institucion || "Sin institución"}</div>
        {bloqueada ? <AvisoLinea tono="danger" dato="eliminar-bloqueada">Esta cotización está adjudicada o vinculada a una OC: no se puede eliminar.</AvisoLinea> : <>
          <AvisoLinea tono="danger" icono="⚠" dato="eliminar-irreversible">Esta acción es definitiva y no se puede deshacer.</AvisoLinea>
          <div style={{ fontSize: T.sm, color: C.ink, lineHeight: 1.5, margin: "8px 0" }}>
            Se eliminarán: la cotización, sus {cot.items?.length || 0} producto(s) ofrecido(s) con sus datos comerciales, sus despachos, su historial de versiones y {nEett} registro(s) de EETT generadas.<br />
            <b>No se eliminan</b>: las fichas de la biblioteca compartida, las imágenes compartidas, los PDF ya descargados ni almacenados anteriormente, ni ninguna OC u otro módulo. Queda registro de quién la eliminó y cuándo.
          </div>
          <div style={{ fontSize: T.small, color: C.inkMuted, marginBottom: 6 }}>Si solo quieres sacarla del trabajo diario, usa el estado «Descartada».</div>
          <label style={{ fontSize: T.sm, fontWeight: 700, color: C.ink }}>Para confirmar, escribe {sinCodigoNiNombre ? "el identificador interno" : cot.id_externo && cot.nombre ? "el código o el nombre" : cot.id_externo ? "el código" : "el nombre"}: <span style={{ fontFamily: "monospace" }}>{referencia}</span></label>
          <input data-confirmar-eliminar value={texto} onChange={(e) => setTexto(e.target.value)} autoComplete="off" style={{ ...iStyle, marginTop: 6 }} />
        </>}
        {error && <AvisoLinea tono="danger" dato="error-eliminar">{error}</AvisoLinea>}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <BotonSecundario data-cancelar-eliminar onClick={onCancelar} disabled={eliminando} style={{ flex: 1, justifyContent: "center", minHeight: 44 }}>Cancelar</BotonSecundario>
          {!bloqueada && <button type="button" data-eliminar-definitivamente onClick={eliminar} disabled={!coincide || eliminando}
            style={{ flex: 1, minHeight: 44, borderRadius: 10, border: "none", fontWeight: 800, fontSize: T.sm, cursor: coincide && !eliminando ? "pointer" : "not-allowed", background: coincide ? C.danger : C.dangerLight, color: coincide ? "#fff" : C.dangerText }}>
            {eliminando ? "Eliminando…" : "Eliminar definitivamente"}
          </button>}
        </div>
      </div>
    </Modal>
  );
}
