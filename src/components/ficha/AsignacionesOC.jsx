// Vendedor y financiador de la OC, visibles y editables en pocos toques (ficha de OC).
// La validación definitiva la hace la base (asignar_vendedor_oc / asignar_financiador_oc).
import { useState } from "react";
import { C, R, TOUCH, selStyle } from "../../lib/theme";
import { Ic } from "../ui/Iconos";
import { SIN_DEFINIR, evaluarCambioFinanciador, evaluarCambioVendedor, faltaFinanciador, faltaVendedor, nombreFinanciador, nombreVendedor } from "../../lib/asignaciones";
import { tipoFinanciamiento, TIPOS_FINANCIAMIENTO } from "../../lib/finanzas";

function Fila({ etiqueta, rol, nombre, falta, detalle, opciones, valor, evaluar, onGuardar, deshabilitado }) {
  const [editando, setEditando] = useState(false);
  const [sel, setSel] = useState(valor || "");
  const [err, setErr] = useState(""); const [guardando, setGuardando] = useState(false);
  const ev = editando ? evaluar(sel || null) : null;
  const abrir = () => { setSel(valor || ""); setErr(""); setEditando(true); };
  const guardar = async () => {
    if (!ev || ev.sinCambios) { setEditando(false); return; }
    if (ev.bloqueado) return;
    setGuardando(true); setErr("");
    try { await onGuardar(sel || null); setEditando(false); }
    catch (e) { setErr(e.message || String(e)); }
    finally { setGuardando(false); }
  };
  return (
    <div data-asignacion={rol} data-asignacion-valor={valor || ""} style={{ padding: "8px 0", borderBottom: `1px solid ${C.border}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 36 }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: C.inkMuted, textTransform: "uppercase", letterSpacing: 0.4, width: 92, flexShrink: 0 }}>{etiqueta}</span>
        <span data-asignacion-nombre style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 800, color: falta ? C.warnText : C.ink }}>
          {falta ? <><Ic n="⚠" /> {SIN_DEFINIR}</> : nombre}
          {detalle && <span style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.inkFaint }}>{detalle}</span>}
        </span>
        {!editando && !deshabilitado && (
          <button data-asignacion-editar onClick={abrir}
            style={{ border: `1px solid ${C.border}`, background: C.card, color: C.tealDark, borderRadius: R.sm, padding: "6px 12px", fontSize: 12.5, fontWeight: 800, cursor: "pointer", minHeight: TOUCH - 8 }}>
            Editar
          </button>
        )}
      </div>
      {editando && (
        <div data-asignacion-form style={{ marginTop: 6 }}>
          <select data-asignacion-select autoFocus style={selStyle} value={sel} onChange={(e) => { setSel(e.target.value); setErr(""); }}>
            <option value="">{SIN_DEFINIR}</option>
            {opciones.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
          </select>
          {ev?.bloqueado && <div data-asignacion-bloqueo style={{ background: C.dangerLight, color: C.dangerText, borderRadius: 8, padding: "8px 10px", fontSize: 12, fontWeight: 700, marginTop: 8, lineHeight: 1.45 }}><Ic n="⚠" /> {ev.motivo}</div>}
          {!ev?.bloqueado && (ev?.avisos || []).map((a, i) => <div key={i} data-asignacion-aviso style={{ background: C.warnLight, color: C.warnText, borderRadius: 8, padding: "8px 10px", fontSize: 12, fontWeight: 600, marginTop: 8, lineHeight: 1.45 }}>{a}</div>)}
          {err && <div style={{ background: C.dangerLight, color: C.dangerText, borderRadius: 8, padding: "8px 10px", fontSize: 12, fontWeight: 700, marginTop: 8 }}>{err}</div>}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button data-asignacion-guardar onClick={guardar} disabled={guardando || ev?.bloqueado || ev?.sinCambios}
              style={{ flex: 1, border: "none", borderRadius: R.sm, padding: "10px 12px", fontSize: 13, fontWeight: 800, minHeight: TOUCH, cursor: guardando || ev?.bloqueado || ev?.sinCambios ? "not-allowed" : "pointer",
                background: guardando || ev?.bloqueado || ev?.sinCambios ? C.inkFaint : (ev?.requiereConfirmacion ? C.warn : C.tealDark), color: "#fff" }}>
              {guardando ? "Guardando…" : ev?.requiereConfirmacion ? "Confirmar cambio" : "✓ Guardar"}
            </button>
            <button data-asignacion-cancelar onClick={() => setEditando(false)}
              style={{ border: `1px solid ${C.border}`, background: C.card, color: C.inkMuted, borderRadius: R.sm, padding: "0 14px", fontSize: 13, fontWeight: 700, minHeight: TOUCH, cursor: "pointer" }}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function AsignacionesOC({ oc, vendedores, financiadores, pagosVendedor, onAsignarVendedor, onAsignarFinanciador }) {
  const tipoFin = oc.financiador_id || oc.es_venta_propia ? tipoFinanciamiento(oc, financiadores) : null;
  const detalleFin = tipoFin === "venta_propia" ? "Venta propia · no genera deuda" : tipoFin === "fondos_propios" ? TIPOS_FINANCIAMIENTO.fondos_propios.etiqueta : null;
  const mismaPersona = !faltaVendedor(oc) && !faltaFinanciador(oc)
    && String(nombreVendedor(oc, vendedores)).trim().toLowerCase() === String(nombreFinanciador(oc, financiadores)).trim().toLowerCase();
  return (
    <div data-asignaciones-oc style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: R.md, padding: "2px 12px 4px", marginBottom: 12 }}>
      <Fila etiqueta="Vendedor" rol="vendedor" nombre={nombreVendedor(oc, vendedores)} falta={faltaVendedor(oc)}
        detalle={(oc.tipo_registro || "venta") === "externa" ? "Venta externa · no genera comisión" : (oc.es_venta_propia ? "Venta propia del vendedor" : null)}
        opciones={(vendedores || []).filter((v) => v.activo !== false || v.id === oc.vendedor_id)} valor={oc.vendedor_id}
        evaluar={(id) => evaluarCambioVendedor(oc, id, pagosVendedor)} onGuardar={(id) => onAsignarVendedor(oc.id, id)} deshabilitado={!onAsignarVendedor} />
      <Fila etiqueta="Financiador" rol="financiador" nombre={nombreFinanciador(oc, financiadores)} falta={faltaFinanciador(oc)} detalle={detalleFin}
        opciones={(financiadores || []).filter((f) => f.activo !== false || f.id === oc.financiador_id)} valor={oc.financiador_id}
        evaluar={(id) => evaluarCambioFinanciador(oc, id)} onGuardar={(id) => onAsignarFinanciador(oc.id, id)} deshabilitado={!onAsignarFinanciador} />
      {mismaPersona && <div data-misma-persona style={{ fontSize: 12, color: C.inkFaint, padding: "6px 0 2px" }}>La misma persona vende y financia esta OC.</div>}
    </div>
  );
}
