import { useMemo, useRef, useState } from "react";
import { Field } from "../ui/Basicos";
import { C, btnP, fmt, iMono, iStyle } from "../../lib/theme";
import { pedidoDeEvento, planCorreccion, leerIdCompra } from "../../lib/compraCotizacion";

const m = (x) => fmt.money(Math.round(Number(x) || 0));

// «Corregir compra» (15/10/2026) de una compra confirmada desde una cotización (un pedido = un evento de compra).
//  · Datos comerciales/operativos (producto, enlace, dirección, proveedor, entrega estimada): no mueven dinero.
//  · Datos financieros (cantidad, precio, despacho): solo administrador, con motivo; se corrige la MISMA compra con
//    la función de la base (editar_compra_oc), que recalcula costo y deuda y no deja el costo bajo lo ya pagado al
//    financiador. Nunca se crea una segunda compra. Los pagos y devoluciones (FIFO) no se tocan.
//  · «Anular compra» (administrador): elimina la compra con la función de la base y luego sus productos.
export function CorregirCompra({ oc, evento, perfil, onCorregir, onAnular }) {
  const pedido = useMemo(() => pedidoDeEvento(oc, evento), [oc, evento]);
  const esAdmin = perfil?.rol === "admin";
  const [filas, setFilas] = useState(() => (pedido ? [...pedido.productos, ...pedido.despachos].map((l) => {
    const desp = !!leerIdCompra(l.id)?.envio; const q = Number(l.cantidad) || 0;
    return { id: l.id, desp, nombre: l.descripcion, descripcion: l.descripcion || "", url: l.url && l.url !== "sin-link" ? l.url : "", direccion_entrega: l.direccion_entrega || "",
      cantidad: desp ? 1 : q, unitario: desp ? 0 : (q ? Math.round((Number(l.precio_compra) || 0) / q) : 0), monto: desp ? Number(l.precio_compra) || 0 : 0, cantidadAntes: q };
  }) : []));
  const [proveedor, setProveedor] = useState(evento?.proveedor || "");
  const [fechaEntrega, setFechaEntrega] = useState(String(evento?.fecha_entrega_estimada || "").slice(0, 10));
  const [motivo, setMotivo] = useState(""); const [errores, setErrores] = useState([]); const [guardando, setGuardando] = useState(false);
  const enCurso = useRef(false);

  if (!pedido) return <div style={{ fontSize: 13, color: C.inkMuted }}>Esta compra no tiene productos de pedido asociados.</div>;
  // Para filas cuyo costo no es múltiplo exacto de la cantidad, si no se tocan cantidad ni precio se conserva el total exacto.
  const nuevos = filas.map((f) => {
    const l = [...pedido.productos, ...pedido.despachos].find((x) => x.id === f.id);
    const q = Number(l.cantidad) || 0; const intacta = !f.desp && Number(f.cantidad) === q && Math.round((Number(l.precio_compra) || 0) / (q || 1)) === Number(f.unitario);
    return { ...f, unitario: intacta && q ? (Number(l.precio_compra) || 0) / q : f.unitario };
  });
  const plan = planCorreccion(pedido, nuevos, { proveedor, fechaEntrega });
  const set = (id, k, v) => setFilas((fs) => fs.map((f) => (f.id === id ? { ...f, [k]: v } : f)));
  const pagado = Number(oc.monto_pagado_fin) || 0;

  const guardar = async () => {
    if (enCurso.current) return;
    const errs = [...plan.errores];
    if (!plan.hayCambios) errs.push("No hay cambios para guardar.");
    if (plan.financiero && !esAdmin) errs.push("Solo un administrador puede corregir cantidades, precios o despacho de una compra confirmada.");
    if (plan.financiero && !motivo.trim()) errs.push("Indica el motivo de la corrección financiera.");
    if (errs.length) { setErrores(errs); return; }
    if (plan.financiero && !window.confirm(`Se corregirá ESTA compra: costo ${m(evento.costo_compra)} → ${m(plan.costoNuevo)}. La deuda con el financiador se recalcula; no se crea otra compra ni se tocan pagos ni devoluciones. ¿Continuar?`)) return;
    enCurso.current = true; setGuardando(true); setErrores([]);
    try { await onCorregir({ ocId: oc.id, evento, plan, proveedor: plan.cambiaProveedor ? proveedor.trim() : null, fechaEntrega: plan.cambiaFecha ? fechaEntrega : null, motivo: motivo.trim(), clave: pedido.clave }); }
    catch (e) { setErrores([`No se guardó la corrección: ${e.message}`]); enCurso.current = false; setGuardando(false); }
  };
  const anular = async () => {
    if (enCurso.current) return;
    if (!motivo.trim()) { setErrores(["Indica el motivo para anular la compra."]); return; }
    if (!window.confirm(`¿Anular esta compra (${m(evento.costo_compra)})? Se elimina la compra y sus productos; el costo y la deuda se recalculan. Los pagos y devoluciones no se tocan.`)) return;
    enCurso.current = true; setGuardando(true); setErrores([]);
    try { await onAnular({ ocId: oc.id, evento, filas: [...pedido.productos, ...pedido.despachos].map((l) => l.id), motivo: motivo.trim(), clave: pedido.clave }); }
    catch (e) { setErrores([`No se anuló: ${e.message}`]); enCurso.current = false; setGuardando(false); }
  };

  const caja = { background: C.paper, borderRadius: 12, padding: "10px 12px", marginBottom: 12, border: `1px solid ${C.border}` };
  return (
    <div data-corregir-compra={pedido.clave}>
      <div style={{ background: C.tealLight, borderRadius: 10, padding: "10px 12px", marginBottom: 12, fontSize: 13 }}>
        <b>Compra confirmada · Pedido {pedido.clave}</b> · {evento.proveedor || "sin proveedor"} · {fmt.date(evento.fecha)} · costo <b>{m(evento.costo_compra)}</b>
        <div style={{ fontSize: 12, color: C.inkMuted, marginTop: 2 }}>Pagado al financiador en esta OC: {m(pagado)}. Los pagos y devoluciones (FIFO) no se modifican.</div>
      </div>
      <div style={caja}>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.inkMuted, textTransform: "uppercase", marginBottom: 6 }}>Datos comerciales (no cambian dinero)</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <Field label="Proveedor"><input data-corr="proveedor" style={iStyle} value={proveedor} onChange={(e) => setProveedor(e.target.value)} /></Field>
          <Field label="Entrega estimada"><input data-corr="fecha-entrega" type="date" style={iStyle} value={fechaEntrega} onChange={(e) => setFechaEntrega(e.target.value)} /></Field>
        </div>
        {filas.filter((f) => !f.desp).map((f) => (
          <div key={f.id} data-corr-fila={f.id} style={{ borderTop: `1px solid ${C.border}`, paddingTop: 6, marginTop: 4 }}>
            <Field label="Producto"><input data-corr="descripcion" style={iStyle} value={f.descripcion} onChange={(e) => set(f.id, "descripcion", e.target.value)} /></Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <Field label="Enlace"><input data-corr="url" style={iStyle} value={f.url} onChange={(e) => set(f.id, "url", e.target.value)} placeholder="https://…" /></Field>
              <Field label="Dirección de entrega"><input data-corr="direccion" style={iStyle} value={f.direccion_entrega} onChange={(e) => set(f.id, "direccion_entrega", e.target.value)} /></Field>
            </div>
          </div>
        ))}
      </div>
      <div style={{ ...caja, borderColor: plan.financiero ? C.warn : C.border }} data-corr-financiero>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.inkMuted, textTransform: "uppercase", marginBottom: 6 }}>Datos financieros {esAdmin ? "(corrección autorizada: requiere motivo)" : "(solo administrador)"}</div>
        {filas.map((f) => (
          <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12, padding: "4px 0", borderBottom: `1px solid ${C.border}` }}>
            <span style={{ flex: "1 1 160px", minWidth: 0 }}>{f.nombre}{!f.desp && <span style={{ color: C.inkMuted }}> · comprado {f.cantidadAntes}</span>}</span>
            {f.desp
              ? <input data-corr-monto={f.id} type="number" min="0" disabled={!esAdmin} style={{ ...iMono, width: 120 }} value={f.monto} onChange={(e) => set(f.id, "monto", e.target.value)} />
              : <>
                <input data-corr-cantidad={f.id} type="number" min="0" step="1" disabled={!esAdmin} style={{ ...iMono, width: 70 }} value={f.cantidad} onChange={(e) => set(f.id, "cantidad", e.target.value === "" ? "" : Number(e.target.value))} />
                <span>×</span>
                <input data-corr-unitario={f.id} type="number" min="0" disabled={!esAdmin} style={{ ...iMono, width: 110 }} value={f.unitario} onChange={(e) => set(f.id, "unitario", e.target.value === "" ? "" : Number(e.target.value))} />
              </>}
          </div>
        ))}
        {plan.financiero && (
          <div data-corr-impacto style={{ fontSize: 12, marginTop: 6, color: plan.delta > 0 ? C.dangerText : C.okText, fontWeight: 600 }}>
            Costo de esta compra: {m(evento.costo_compra)} → {m(plan.costoNuevo)} ({plan.delta > 0 ? "+" : "−"}{m(Math.abs(plan.delta))}). La deuda con el financiador se recalcula sobre la misma compra.
            {plan.costoNuevo < pagado && <div style={{ color: C.dangerText }}>El costo quedaría bajo lo ya pagado al financiador ({m(pagado)}): la base lo rechazará.</div>}
          </div>
        )}
      </div>
      <Field label={plan.financiero ? "Motivo de la corrección (obligatorio)" : "Motivo / observación (opcional)"}><input data-corr="motivo" style={iStyle} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="ej: el proveedor cobró menos despacho" /></Field>
      {errores.length > 0 && <div data-corr-errores style={{ background: C.dangerLight, color: C.dangerText, borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 10, fontWeight: 600 }}>{errores.map((e, i) => <div key={i}>• {e}</div>)}</div>}
      <button data-corr-guardar onClick={guardar} disabled={guardando} style={btnP(guardando ? C.inkFaint : C.teal)}>{guardando ? "Guardando…" : plan.financiero ? "✓ Corregir esta compra" : "✓ Guardar datos comerciales"}</button>
      {esAdmin && <button data-corr-anular onClick={anular} disabled={guardando} style={{ ...btnP(C.dangerLight), color: C.dangerText, marginTop: 8 }}>Anular esta compra</button>}
    </div>
  );
}
