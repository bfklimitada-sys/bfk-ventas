import { useEffect, useMemo, useRef, useState } from "react";
import { Field } from "../ui/Basicos";
import { C, btnP, fmt, iMono, iStyle, selStyle } from "../../lib/theme";
import { FormIngresarCompra } from "./FormIngresarCompra";
import { cotizacionesVinculadas, baseCotizacion, compradoEnOC, estadoLineas, filasIniciales, filaDesde, cambiosFila, armarPedidos, comparar, validarCompra, nuevoPedido } from "../../lib/compraCotizacion";

const m = (x) => fmt.money(Math.round(Number(x) || 0));
const hoy = () => { const d = new Date(); const z = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`; }; // fecha local (Chile)
const signo = (x) => (x > 0 ? `+${m(x)}` : x < 0 ? `−${m(-x)}` : m(0));

// «Registrar compra» de una OC existente (15/10/2026).
// Busca una cotización ADJUDICADA vinculada explícitamente por el código de la OC. Sin vínculo → formulario actual.
// Con varias → el usuario elige. Con una → opción A (igual a lo cotizado) u opción B (modificar datos).
export function RegistrarCompraOC(props) {
  const { oc, onBuscarCotizacionOC, onCargarCotizacionOC } = props;
  const [estado, setEstado] = useState({ fase: onBuscarCotizacionOC ? "buscando" : "sin" });
  useEffect(() => {
    if (!onBuscarCotizacionOC) return;
    let vivo = true;
    (async () => {
      try {
        const lista = cotizacionesVinculadas(await onBuscarCotizacionOC(oc.numero_oc), oc.numero_oc);
        if (!vivo) return;
        if (!lista.length) setEstado({ fase: "sin" });
        else if (lista.length === 1) setEstado({ fase: "cargando", id: lista[0].id });
        else setEstado({ fase: "elegir", lista });
      } catch (e) { if (vivo) setEstado({ fase: "sin", aviso: `No se pudo revisar si hay una cotización vinculada (${e.message}). Se usa el formulario normal.` }); }
    })();
    return () => { vivo = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (estado.fase !== "cargando") return;
    let vivo = true;
    onCargarCotizacionOC(estado.id).then((cot) => { if (vivo) setEstado({ fase: "cotizacion", cot }); })
      .catch((e) => { if (vivo) setEstado({ fase: "sin", aviso: `No se pudo cargar la cotización vinculada (${e.message}). Se usa el formulario normal.` }); });
    return () => { vivo = false; };
  }, [estado.fase, estado.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const normal = (aviso) => (
    <div data-compra-normal>
      {aviso && <div style={{ background: C.warnLight, color: C.warnText, borderRadius: 8, padding: "8px 12px", fontSize: 12, marginBottom: 10, fontWeight: 600 }}>{aviso}</div>}
      <FormIngresarCompra {...props} ocExistente={oc} />
    </div>
  );
  if (estado.fase === "buscando" || estado.fase === "cargando") return <div data-buscando-cotizacion style={{ fontSize: 13, color: C.inkMuted, padding: "12px 0" }}>Buscando cotización adjudicada vinculada a {oc.numero_oc}…</div>;
  if (estado.fase === "sin") return normal(estado.aviso);
  if (estado.fase === "manual") return normal("Registro sin usar la cotización vinculada.");
  if (estado.fase === "elegir") return (
    <div data-elegir-cotizacion>
      <div style={{ fontSize: 13, color: C.ink, marginBottom: 10 }}>Hay <b>{estado.lista.length}</b> cotizaciones adjudicadas vinculadas a la OC {oc.numero_oc}. Elige la correcta:</div>
      {estado.lista.map((c) => (
        <button key={c.id} data-cotizacion-opcion={c.id} onClick={() => setEstado({ fase: "cargando", id: c.id })} style={{ display: "block", width: "100%", textAlign: "left", border: `1px solid ${C.border}`, background: C.card, borderRadius: 10, padding: "10px 12px", marginBottom: 8, cursor: "pointer" }}>
          <b>{c.id_externo || c.nombre || "Cotización sin código"}</b> · {c.institucion || "—"}<br />
          <span style={{ fontSize: 12, color: C.inkMuted }}>{c.nombre || ""}{c.fecha ? ` · ${fmt.date(c.fecha)}` : ""}{c.total ? ` · ${m(c.total)}` : ""}</span>
        </button>
      ))}
      <button data-sin-cotizacion onClick={() => setEstado({ fase: "manual" })} style={{ ...btnP(C.inkFaint), marginTop: 4 }}>Registrar sin usar una cotización</button>
    </div>
  );
  return <CompraDesdeCotizacion {...props} cot={estado.cot} onSinCotizacion={() => setEstado({ fase: "manual" })} />;
}

function CompraDesdeCotizacion({ oc, cot, financiadores, perfil, onCompraDesdeCotizacion, onSinCotizacion }) {
  const base = useMemo(() => baseCotizacion(cot), [cot]);
  const comprado = useMemo(() => compradoEnOC(oc), [oc]);
  const lineas = useMemo(() => estadoLineas(base, comprado), [base, comprado]);
  const [opcion, setOpcion] = useState(null);
  const [filas, setFilas] = useState(() => filasIniciales(base, lineas));
  const [despReal, setDespReal] = useState({}); const [extras, setExtras] = useState({});
  const [conf, setConf] = useState({ vigencia: false, especificaciones: false, direccion: false });
  const tieneCompras = (oc.eventos_compra || []).length > 0;
  const [financiadorId, setFinanciadorId] = useState(oc.financiador_id || perfil?.financiador_default || financiadores[0]?.id || "");
  const [fecha, setFecha] = useState(hoy()); const [fechaEst, setFechaEst] = useState("");
  const [errores, setErrores] = useState([]); const [guardando, setGuardando] = useState(false);
  const pedido = useRef(nuevoPedido()); const enCurso = useRef(false);

  const grupos = useMemo(() => armarPedidos({ filas, base, comprado, despachosReales: opcion === "B" ? despReal : {}, extras: opcion === "B" ? extras : {} }), [filas, base, comprado, despReal, extras, opcion]);
  const costoPrevio = (oc.eventos_compra || []).reduce((s, e) => s + (Number(e.costo_compra) || 0), 0);
  const comp = useMemo(() => comparar({ base, lineas, grupos, ventaOC: Number(oc.monto_total) || 0, costoPrevio, comprado }), [base, lineas, grupos, oc.monto_total, costoPrevio, comprado]);
  const val = useMemo(() => validarCompra({ opcion, filas, lineas, base, confirmaciones: conf }), [opcion, filas, lineas, base, conf]);
  const todoComprado = lineas.every((l) => l.pendiente === 0);

  const elegir = (o) => { setOpcion(o); setErrores([]); if (o === "A") { setFilas(filasIniciales(base, lineas)); setDespReal({}); setExtras({}); } };
  const setF = (rid, k, v) => setFilas((fs) => fs.map((f) => (f.rid === rid ? { ...f, [k]: v } : f)));
  const dividir = (f) => { const l = lineas.find((x) => x.key === f.itemKey); if (l) setFilas((fs) => { const i = fs.findIndex((x) => x.rid === f.rid); const n = [...fs]; n.splice(i + 1, 0, filaDesde({ ...l, pendiente: 0 }, base, { proveedor: "", enlace: "" })); return n; }); };

  const registrar = async () => {
    if (enCurso.current) return;
    if (val.errores.length) { setErrores(val.errores); return; }
    if (!tieneCompras && !financiadorId && !oc.es_venta_propia) { setErrores(["Selecciona el financiador."]); return; }
    enCurso.current = true; setGuardando(true); setErrores([]);
    try {
      await onCompraDesdeCotizacion({ ocId: oc.id, pedido: pedido.current, grupos, fecha, fechaEst, financiadorId, codigoCotizacion: base.codigo });
    } catch (e) { setErrores([`No se completó el registro: ${e.message}. Puedes reintentar: lo ya registrado no se duplica.`]); enCurso.current = false; setGuardando(false); }
  };

  const caja = { background: C.paper, borderRadius: 12, padding: "10px 12px", marginBottom: 12, border: `1px solid ${C.border}` };
  const tit = (t) => <div style={{ fontSize: 12, fontWeight: 700, color: C.inkMuted, textTransform: "uppercase", marginBottom: 6 }}>{t}</div>;
  const marcado = (c) => (c ? { borderColor: C.warn, background: C.warnLight } : {});
  const ref = (c, t) => (c ? <div data-cotizado style={{ fontSize: 11, color: C.warnText, marginTop: 2 }}>Cotizado: {t || "—"}</div> : null);

  return (
    <div data-compra-cotizacion>
      <div style={{ background: C.tealLight, borderRadius: 10, padding: "10px 12px", marginBottom: 12, fontSize: 13 }}>
        <b>Cotización adjudicada vinculada: {base.codigo}</b>{cot.institucion ? ` · ${cot.institucion}` : ""}
        <div style={{ fontSize: 12, color: C.inkMuted, marginTop: 2 }}>La cotización, el monto adjudicado y los productos vendidos no se modifican. La compra se guarda aparte.</div>
      </div>

      <div style={caja} data-estado-lineas>
        {tit("Cantidades")}
        {lineas.map((l) => (
          <div key={l.key} data-linea={l.key} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, padding: "3px 0", borderBottom: `1px solid ${C.border}` }}>
            <span style={{ minWidth: 0 }}>{l.nombre}</span>
            <span style={{ flexShrink: 0, color: C.inkMuted }}>cotizadas <b style={{ color: C.ink }}>{l.cantidad}</b> · compradas <b style={{ color: C.ink }}>{l.comprada}</b> · pendientes <b data-pendiente={l.key} style={{ color: l.pendiente ? C.warnText : C.okText }}>{l.pendiente}</b></span>
          </div>
        ))}
      </div>

      {todoComprado ? (
        <div data-todo-comprado style={{ background: C.okLight, color: C.okText, borderRadius: 8, padding: "10px 12px", fontSize: 13, marginBottom: 10, fontWeight: 600 }}>Todo lo cotizado ya está comprado. Si hubo una compra adicional, usa el formulario normal.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
          <button data-opcion="A" onClick={() => elegir("A")} style={{ ...btnP(opcion === "A" ? C.teal : C.inkFaint), minHeight: 56 }}>A · La compra es igual a lo cotizado</button>
          <button data-opcion="B" onClick={() => elegir("B")} style={{ ...btnP(opcion === "B" ? C.teal : C.inkFaint), minHeight: 56 }}>B · Modificar datos de la compra</button>
        </div>
      )}
      <button data-sin-cotizacion onClick={onSinCotizacion} style={{ background: "none", border: "none", color: C.tealDark, textDecoration: "underline", cursor: "pointer", fontSize: 12, padding: 0, marginBottom: 12, minHeight: 32 }}>Registrar sin usar la cotización (formulario normal)</button>

      {opcion && !todoComprado && <>
        <div style={caja} data-filas-compra>
          {tit(opcion === "A" ? "Resumen de lo que se compra (igual a lo cotizado)" : "Datos de la compra · lo modificado se destaca")}
          {filas.map((f) => {
            const l = base.lineas.find((x) => x.key === f.itemKey); const lp = lineas.find((x) => x.key === f.itemKey);
            const c = cambiosFila(f, l && lp ? { ...l, pendiente: lp.pendiente } : l, base);
            if (opcion === "A") return (
              <div key={f.rid} data-fila-compra={f.rid} style={{ fontSize: 12, padding: "6px 0", borderBottom: `1px solid ${C.border}` }}>
                <b>{f.producto}</b>{f.marca || f.modelo ? ` · ${[f.marca, f.modelo].filter(Boolean).join(" ")}` : ""} × {f.cantidad}<br />
                <span style={{ color: C.inkMuted }}>{f.proveedor || "Sin proveedor"} · {m(f.unitario)} c/u · subtotal {m(f.unitario * f.cantidad)}{f.enlace ? ` · ${f.enlace.slice(0, 50)}${f.enlace.length > 50 ? "…" : ""}` : ""}</span>
              </div>
            );
            return (
              <div key={f.rid} data-fila-compra={f.rid} style={{ background: C.card, borderRadius: 10, padding: "10px 10px 4px", marginBottom: 8, border: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.tealDark, marginBottom: 6 }}>{l?.nombre || "Producto"} <span style={{ color: C.inkMuted, fontWeight: 400 }}>· pendientes {lp?.pendiente ?? 0}</span></div>
                <Field label="Producto adquirido"><input data-campo-compra="producto" style={{ ...iStyle, ...marcado(c.producto) }} value={f.producto} onChange={(e) => setF(f.rid, "producto", e.target.value)} />{ref(c.producto, l?.nombre)}</Field>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <Field label="Marca"><input data-campo-compra="marca" style={{ ...iStyle, ...marcado(c.marca) }} value={f.marca} onChange={(e) => setF(f.rid, "marca", e.target.value)} />{ref(c.marca, l?.marca)}</Field>
                  <Field label="Modelo"><input data-campo-compra="modelo" style={{ ...iStyle, ...marcado(c.modelo) }} value={f.modelo} onChange={(e) => setF(f.rid, "modelo", e.target.value)} />{ref(c.modelo, l?.modelo)}</Field>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <Field label="Cantidad a comprar"><input data-campo-compra="cantidad" type="number" min="0" step="1" style={{ ...iMono, ...marcado(c.cantidad) }} value={f.cantidad} onChange={(e) => setF(f.rid, "cantidad", e.target.value === "" ? "" : Number(e.target.value))} /></Field>
                  <Field label="P. compra unit. con IVA ($)"><input data-campo-compra="unitario" type="number" min="0" style={{ ...iMono, ...marcado(c.unitario) }} value={f.unitario} onChange={(e) => setF(f.rid, "unitario", e.target.value === "" ? "" : Number(e.target.value))} />{ref(c.unitario, l ? m(l.unitario) : "")}</Field>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <Field label="Proveedor"><input data-campo-compra="proveedor" style={{ ...iStyle, ...marcado(c.proveedor) }} value={f.proveedor} onChange={(e) => setF(f.rid, "proveedor", e.target.value)} />{ref(c.proveedor, l?.proveedor)}</Field>
                  <Field label="Enlace"><input data-campo-compra="enlace" style={{ ...iStyle, ...marcado(c.enlace) }} value={f.enlace} onChange={(e) => setF(f.rid, "enlace", e.target.value)} placeholder="https://…" />{ref(c.enlace, l?.enlace)}</Field>
                </div>
                <Field label="Dirección de entrega efectiva"><input data-campo-compra="direccion" style={{ ...iStyle, ...marcado(c.direccion) }} value={f.direccion} onChange={(e) => setF(f.rid, "direccion", e.target.value)} />{ref(c.direccion, base.direccion)}</Field>
                {(c.producto || c.marca || c.modelo) && <div data-aviso-especificaciones style={{ fontSize: 12, color: C.warnText, fontWeight: 600, marginBottom: 6 }}>⚠ Cambió el producto, la marca o el modelo: comprueba que cumple las especificaciones ofertadas.</div>}
                {c.unitario && Number(f.unitario) > (l?.unitario || 0) && <div data-aviso-costo style={{ fontSize: 12, color: C.dangerText, fontWeight: 600, marginBottom: 6 }}>Costo mayor al cotizado: {signo((Number(f.unitario) - l.unitario) * Number(f.cantidad || 0))} en este producto.</div>}
                <button data-dividir onClick={() => dividir(f)} style={{ background: "none", border: "none", color: C.tealDark, textDecoration: "underline", cursor: "pointer", fontSize: 12, padding: 0, minHeight: 30 }}>+ Comprar parte de esta línea con otro proveedor</button>
              </div>
            );
          })}
        </div>

        <div style={caja} data-despachos>
          {tit("Despacho (una sola vez por pedido)")}
          {grupos.map((g) => (
            <div key={g.clave} data-pedido={g.n} style={{ fontSize: 12, padding: "4px 0", borderBottom: `1px solid ${C.border}` }}>
              <b>Pedido {g.n} · {g.proveedor || "sin proveedor"}</b>
              {g.despachos.filter((d) => !d.adicional).map((d) => (
                <div key={d.envioSan} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                  <span style={{ flex: "1 1 160px", color: C.inkMuted }}>{d.yaRegistrado ? "Despacho cotizado: ya registrado en una compra anterior" : `Despacho cotizado ${m(d.original)}`}</span>
                  {opcion === "B" && !d.yaRegistrado
                    ? <input data-despacho-real={d.envioKey} type="number" min="0" style={{ ...iMono, width: 120, ...marcado(Number(despReal[d.envioKey] ?? d.original) !== d.original) }} value={despReal[d.envioKey] ?? d.original} onChange={(e) => setDespReal((x) => ({ ...x, [d.envioKey]: e.target.value }))} />
                    : <b>{m(d.real)}</b>}
                </div>
              ))}
              {opcion === "B" && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                  <span style={{ flex: 1, color: C.inkMuted }}>Despacho adicional de este pedido</span>
                  <input data-despacho-extra={g.n} type="number" min="0" style={{ ...iMono, width: 120 }} value={extras[g.clave] ?? ""} placeholder="0" onChange={(e) => setExtras((x) => ({ ...x, [g.clave]: e.target.value }))} />
                </div>
              )}
              <div style={{ textAlign: "right", marginTop: 4 }}>Costo del pedido: <b data-costo-pedido={g.n}>{m(g.costo)}</b></div>
            </div>
          ))}
        </div>

        <div style={caja}>
          {tit("Datos de la compra")}
          <Field label="Financiador" hint={tieneCompras ? "La OC ya tiene compras: se usa el mismo financiador." : ""}>
            <select style={selStyle} value={financiadorId} disabled={tieneCompras} onChange={(e) => setFinanciadorId(e.target.value)}>
              {financiadores.map((f) => <option key={f.id} value={f.id}>{f.nombre}{f.tipo === "propio" ? " — fondos propios (no genera deuda)" : ""}</option>)}
            </select>
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label="Fecha de compra"><input style={iStyle} type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></Field>
            <Field label="Fecha de entrega estimada"><input data-campo-compra="fecha-entrega" style={iStyle} type="date" value={fechaEst} onChange={(e) => setFechaEst(e.target.value)} /></Field>
          </div>
        </div>

        <div data-comparacion style={{ background: C.tealLight, borderRadius: 12, padding: "10px 12px", marginBottom: 12, fontSize: 13 }}>
          {tit("Comparación económica · montos con IVA (lo que se paga)")}
          {comp.filas.map((f) => (
            <div key={f.rid} data-dif-producto style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12 }}>
              <span style={{ minWidth: 0 }}>{f.producto} × {f.cantidad}</span>
              <span style={{ flexShrink: 0 }}>{m(f.original)} → {m(f.real)} <b style={{ color: f.diferencia > 0 ? C.dangerText : f.diferencia < 0 ? C.okText : C.inkMuted }}>({signo(f.diferencia)})</b></span>
            </div>
          ))}
          <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 6, paddingTop: 6, display: "grid", gridTemplateColumns: "1fr auto auto", gap: "2px 12px", fontSize: 12 }}>
            <span /><b>Cotizado</b><b>Real</b>
            <span>Productos</span><span data-prod-original>{m(comp.productosOriginal)}</span><span data-prod-real>{m(comp.productosReal)}</span>
            <span>Despacho</span><span data-desp-original>{m(comp.despachoOriginal)}</span><span data-desp-real>{m(comp.despachoReal)}</span>
            <b>Total de esta compra</b><b data-total-original>{m(comp.totalOriginal)}</b><b data-total-real>{m(comp.totalReal)}</b>
          </div>
          <div style={{ marginTop: 4, fontSize: 12 }}>Diferencia total: <b data-diferencia-total style={{ color: comp.diferencia > 0 ? C.dangerText : comp.diferencia < 0 ? C.okText : C.ink }}>{signo(comp.diferencia)}</b></div>
          <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 6, paddingTop: 6, fontSize: 12, lineHeight: 1.6 }}>
            Venta (monto adjudicado con IVA): <b>{m(oc.monto_total)}</b><br />
            Utilidad estimada original (todo a costo cotizado): <b data-utilidad-original>{m(comp.utilidadOriginal)}</b><br />
            {comp.parcial ? "Utilidad proyectada (compra parcial: lo pendiente a costo cotizado)" : "Utilidad actualizada según la compra real"}: <b data-utilidad-actualizada style={{ color: comp.utilidadActualizada < comp.utilidadOriginal ? C.dangerText : C.okText }}>{m(comp.utilidadActualizada)}</b>
            {comp.utilidadActualizada !== comp.utilidadOriginal && <> ({signo(comp.utilidadActualizada - comp.utilidadOriginal)} frente a lo cotizado)</>}
            {comp.parcial && <div data-aviso-parcial style={{ color: C.warnText, fontWeight: 600, marginTop: 4 }}>Compra parcial: la rentabilidad no es definitiva hasta comprar lo pendiente ({m(comp.costoPendiente)} a costo cotizado).</div>}
          </div>
        </div>

        <div style={{ marginBottom: 10 }}>
          {val.requiere.vigencia && <label data-confirmar="vigencia" style={{ display: "flex", gap: 8, fontSize: 13, marginBottom: 6, fontWeight: 600 }}><input type="checkbox" checked={conf.vigencia} onChange={(e) => setConf((c) => ({ ...c, vigencia: e.target.checked }))} /> Confirmo que los precios, la disponibilidad, las condiciones y el despacho siguen vigentes.</label>}
          {val.requiere.especificaciones && <label data-confirmar="especificaciones" style={{ display: "flex", gap: 8, fontSize: 13, marginBottom: 6, fontWeight: 600 }}><input type="checkbox" checked={conf.especificaciones} onChange={(e) => setConf((c) => ({ ...c, especificaciones: e.target.checked }))} /> Comprobé que el producto cumple las especificaciones ofertadas.</label>}
          {val.requiere.direccion && <label data-confirmar="direccion" style={{ display: "flex", gap: 8, fontSize: 13, marginBottom: 6, fontWeight: 600 }}><input type="checkbox" checked={conf.direccion} onChange={(e) => setConf((c) => ({ ...c, direccion: e.target.checked }))} /> Verifiqué nuevamente el despacho para la nueva dirección.</label>}
        </div>
        {errores.length > 0 && <div data-errores-compra style={{ background: C.dangerLight, color: C.dangerText, borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 10, fontWeight: 600 }}>{errores.map((e, i) => <div key={i}>• {e}</div>)}</div>}
        <button data-registrar-compra-cotizacion onClick={registrar} disabled={guardando} style={btnP(guardando ? C.inkFaint : C.ok)}>{guardando ? "Registrando…" : `✓ Registrar compra (${grupos.length} pedido${grupos.length === 1 ? "" : "s"} · ${m(comp.totalReal)})`}</button>
      </>}
    </div>
  );
}
