// «Registrar compra» de una orden de venta privada desde su cotización aprobada (10/11/2026): el mismo recorrido de
// «Registrar compra» de una OC de Mercado Público con cotización vinculada (A · igual a lo cotizado / B · modificar datos),
// con la utilidad neta de Ventas privadas. Lo calcula lib/compraVentaPrivada.js; guarda vp_registrar_compras_cotizacion.
// La cotización aprobada, los ítems y los precios de venta no se modifican. El registro manual y el vínculo con un gasto
// existente siguen disponibles (onManual).
import { useMemo, useRef, useState } from "react";
import { C, MONO, R, T } from "../../lib/theme";
import { iStyle } from "../../lib/theme";
import CampoNumeroCL from "../ui/CampoNumeroCL";
import { esInvalido } from "../../lib/numeroCL";
import { Ventana, Campo, Rejilla, Entrada, Selector, ErrorForm } from "../proyectos/Comunes";
import { estiloBoton } from "./Comunes";
import { pesos, hoyISO, cantidadTxt, mensajeVP } from "../../lib/ventasPrivadas";
import { registrarComprasCotizacion, registrarCompraFinanciada } from "../../lib/ventasPrivadasDatos";
import { BloqueFinanciamientoCompra, subirComprobantes } from "./Financiamiento";
import { validarAportes, aportesParaGuardar } from "../../lib/vpFinanciamiento";
import { baseVenta, compradoEnVenta, estadoLineas, filasIniciales, filaDesde, cambiosFila, armarPedidos, compararVP, validarCompraVP, filasParaGuardar, nuevoPedido } from "../../lib/compraVentaPrivada";

const signo = (x) => (x > 0 ? `+${pesos(x)}` : x < 0 ? `−${pesos(-x)}` : pesos(0));
const n0 = (v) => (v === "" ? "" : Number(v));

export function CompraVentaPrivada({ token, v, d, vp, showToast, onCerrar, onListo, onManual }) {
  const base = useMemo(() => baseVenta(v, d), [v, d]);
  const comprado = useMemo(() => compradoEnVenta(d), [d]);
  const lineas = useMemo(() => estadoLineas(base, comprado), [base, comprado]);
  const [opcion, setOpcion] = useState(null);
  const [filas, setFilas] = useState(() => filasIniciales(base, lineas));
  const [despReal, setDespReal] = useState({}); const [extras, setExtras] = useState({}); const [docs, setDocs] = useState({});
  const [conf, setConf] = useState({ vigencia: false, especificaciones: false, direccion: false });
  const [fecha, setFecha] = useState(hoyISO()); const [errores, setErrores] = useState([]); const [ocupado, setOcupado] = useState(false);
  const pedido = useRef(nuevoPedido()); const enCurso = useRef(false);
  // Financiamiento (11/11/2026): opcional; solo si la base lo tiene instalado. Sin informar → «Financiamiento sin informar».
  const conFin = !!(vp?.finInstalado && d.finInstalado); const [finActivo, setFinActivo] = useState(false); const [finFilas, setFinFilas] = useState([]);
  const B = opcion === "B";

  const grupos = useMemo(() => armarPedidos({ filas, base, comprado, despachosReales: B ? despReal : {}, extras: B ? extras : {} }), [filas, base, comprado, despReal, extras, B]);
  const m = d.margen || {};
  const comp = useMemo(() => compararVP({ base, lineas, grupos, ventaNeta: Number(v.neto) || 0, costoEstimado: Number(m.costo_estimado) || 0, costoPrevio: Number(m.costo_real) || 0, comprado, docs: B ? docs : {} }),
    [base, lineas, grupos, v.neto, m.costo_estimado, m.costo_real, comprado, docs, B]);
  const val = useMemo(() => validarCompraVP({ opcion, filas, lineas, base, confirmaciones: conf }), [opcion, filas, lineas, base, conf]);
  const todoComprado = lineas.every((l) => l.pendiente === 0);

  const elegir = (o) => { setOpcion(o); setErrores([]); if (o === "A") { setFilas(filasIniciales(base, lineas)); setDespReal({}); setExtras({}); setDocs({}); } };
  const setF = (rid, k, val2) => setFilas((fs) => fs.map((f) => (f.rid === rid ? { ...f, [k]: val2 } : f)));
  // Formato chileno (13/11/2026): un campo con formato incorrecto conserva el último valor válido y bloquea el registro.
  const [invalidos, setInvalidos] = useState({});
  const numero = (clave, aplicar) => (v) => { setInvalidos((x) => ({ ...x, [clave]: esInvalido(v) })); if (!esInvalido(v)) aplicar(v); };
  const dividir = (f) => { const l = lineas.find((x) => x.key === f.itemKey); if (l) setFilas((fs) => { const i = fs.findIndex((x) => x.rid === f.rid); const n = [...fs]; n.splice(i + 1, 0, filaDesde({ ...l, pendiente: 0 }, base, { proveedor: "", enlace: "" })); return n; }); };

  const registrar = async () => {
    if (enCurso.current) return;
    const faltan = [...val.errores];
    if (Object.values(invalidos).some(Boolean)) faltan.unshift("Corrige los montos o cantidades con formato incorrecto (punto para miles, coma para decimales; ej.: 1.250.000,75).");
    if (!fecha || fecha > hoyISO()) faltan.push("Indica la fecha de la compra (no futura).");
    if (conFin && finActivo) faltan.push(...validarAportes(finFilas, { disponible: comp.totalReal }).errores);
    if (faltan.length) { setErrores(faltan); return; }
    enCurso.current = true; setOcupado(true); setErrores([]);
    try {
      const compra = { venta_id: v.id, fecha, filas: filasParaGuardar({ grupos, base, pedido: pedido.current, docs: B ? docs : {} }) };
      const r = conFin
        ? await registrarCompraFinanciada(token, compra, finActivo ? aportesParaGuardar(await subirComprobantes(token, v.id, finFilas, setFinFilas)) : [])
        : await registrarComprasCotizacion(token, compra);
      showToast?.(r?.ya_existia ? "La compra ya estaba registrada (no se duplicó)" : conFin && finActivo && finFilas.length ? "Compra y financiamiento registrados" : "Compra registrada como costo real");
      onListo();
    } catch (e) {
      setErrores([e.status === 0 ? `Se perdió la conexión: ${mensajeVP(e)} Puedes reintentar: la misma compra no se registra dos veces.` : `No se registró la compra: ${mensajeVP(e)}`]);
      enCurso.current = false; setOcupado(false);
    }
  };

  const caja = { background: C.paper, borderRadius: R.md, padding: "10px 12px", marginBottom: 12, border: `1px solid ${C.border}` };
  const tit = (t) => <div style={{ fontSize: T.small, fontWeight: 600, color: C.inkMuted, textTransform: "uppercase", marginBottom: 6 }}>{t}</div>;
  const marcado = (c) => (c ? { borderColor: C.warn, background: C.warnLight } : {});
  const ref = (c, t) => (c ? <div data-cotizado style={{ fontSize: 11, color: C.warnText, marginTop: 2 }}>Cotizado: {t || "—"}</div> : null);
  const pie = <>
    <button type="button" onClick={onCerrar} style={estiloBoton()}>Cancelar</button>
    {opcion && !todoComprado && <button type="button" data-registrar-compra-cotizacion disabled={ocupado} onClick={registrar} style={{ ...estiloBoton("pri"), minHeight: 44 }}>
      {ocupado ? "Registrando…" : `✓ Registrar compra (${grupos.length} pedido${grupos.length === 1 ? "" : "s"} · ${pesos(comp.totalReal)})`}</button>}
  </>;

  return (
    <Ventana titulo="Registrar compra" onCerrar={onCerrar} dato="compra-cotizacion-vp" ancho={720} pie={pie}>
      <div style={{ background: C.tealLight, borderRadius: R.md, padding: "10px 12px", marginBottom: 12, fontSize: T.sm }}>
        <b>Cotización aprobada: {base.codigo}</b>{v.cliente_nombre ? ` · ${v.cliente_nombre}` : ""}
        <div style={{ fontSize: T.small, color: C.inkMuted, marginTop: 2 }}>La cotización aprobada, los ítems y los precios de venta no se modifican. La compra se guarda como costo real de la orden.</div>
      </div>

      <div style={caja} data-estado-lineas>
        {tit("Cantidades")}
        {comp.pendientes.map((l) => (
          <div key={l.key} data-linea={l.orden} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: T.small, padding: "3px 0", borderBottom: `1px solid ${C.border}`, flexWrap: "wrap" }}>
            <span style={{ minWidth: 0 }}>{l.orden}. {l.nombre}</span>
            <span style={{ flexShrink: 0, color: C.inkMuted }}>vendidas <b style={{ color: C.ink }}>{cantidadTxt(l.cantidad)}</b> · compradas <b data-comprada={l.orden} style={{ color: C.ink }}>{cantidadTxt(l.comprada)}</b>
              {opcion && l.ahora > 0 && <> · en esta compra <b data-en-esta-compra={l.orden} style={{ color: C.tealDark }}>{cantidadTxt(l.ahora)}</b></>}
              {" "}· pendientes <b data-pendiente={l.orden} style={{ color: (opcion ? l.queda : l.pendiente) ? C.warnText : C.okText }}>{cantidadTxt(opcion ? l.queda : l.pendiente)}</b></span>
          </div>
        ))}
      </div>

      {todoComprado ? (
        <div data-todo-comprado style={{ background: C.okLight, color: C.okText, borderRadius: R.sm, padding: "10px 12px", fontSize: T.sm, marginBottom: 10, fontWeight: 500 }}>Todo lo vendido ya está comprado. Si hubo un costo adicional, usa el registro manual.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
          <button type="button" data-opcion="A" onClick={() => elegir("A")} style={{ ...estiloBoton(opcion === "A" ? "pri" : undefined), minHeight: 56 }}>A · La compra es igual a lo cotizado</button>
          <button type="button" data-opcion="B" onClick={() => elegir("B")} style={{ ...estiloBoton(opcion === "B" ? "pri" : undefined), minHeight: 56 }}>B · Modificar datos de la compra</button>
        </div>
      )}
      <button type="button" data-compra-manual onClick={onManual} style={{ background: "none", border: "none", color: C.tealDark, textDecoration: "underline", cursor: "pointer", fontSize: T.small, padding: 0, marginBottom: 12, minHeight: 32 }}>Registro manual o vincular un gasto existente</button>

      {opcion && !todoComprado && <>
        <div style={caja} data-filas-compra>
          {tit(opcion === "A" ? "Resumen de lo que se compra (igual a lo cotizado)" : "Datos de la compra · lo modificado se destaca")}
          {filas.map((f) => {
            const l = base.lineas.find((x) => x.key === f.itemKey); const lp = lineas.find((x) => x.key === f.itemKey);
            const c = cambiosFila(f, l && lp ? { ...l, pendiente: lp.pendiente } : l, base);
            if (opcion === "A") return (
              <div key={f.rid} data-fila-compra={f.rid} style={{ fontSize: T.small, padding: "6px 0", borderBottom: `1px solid ${C.border}` }}>
                <b>{f.producto}</b>{f.marca || f.modelo ? ` · ${[f.marca, f.modelo].filter(Boolean).join(" ")}` : ""} × {cantidadTxt(f.cantidad)}<br />
                <span style={{ color: C.inkMuted }}>{f.proveedor || "Sin proveedor"} · {pesos(f.unitario)} c/u con IVA · subtotal {pesos(Math.round(f.unitario * f.cantidad))}{f.enlace ? ` · ${f.enlace.slice(0, 50)}${f.enlace.length > 50 ? "…" : ""}` : ""}</span>
                {l?.sinPrecio && <div style={{ color: C.dangerText, fontWeight: 500 }}>La cotización no tiene precio de compra para esta línea: usa «Modificar datos de la compra».</div>}
              </div>
            );
            return (
              <div key={f.rid} data-fila-compra={f.rid} style={{ background: C.card, borderRadius: R.md, padding: "10px 10px 4px", marginBottom: 8, border: `1px solid ${C.border}` }}>
                <div style={{ fontSize: T.small, fontWeight: 600, color: C.tealDark, marginBottom: 6 }}>{l?.nombre || "Producto"} <span style={{ color: C.inkMuted, fontWeight: 400 }}>· pendientes {cantidadTxt(lp?.pendiente ?? 0)}</span></div>
                <Campo etiqueta="Producto adquirido"><Entrada data-campo-compra="producto" style={marcado(c.producto)} value={f.producto} onChange={(e) => setF(f.rid, "producto", e.target.value)} />{ref(c.producto, l?.nombre)}</Campo>
                <Rejilla>
                  <Campo etiqueta="Cantidad a comprar"><CampoNumeroCL data-campo-compra="cantidad" decimales={3} style={{ ...iStyle, ...marcado(c.cantidad) }} valor={f.cantidad} onCambiar={numero(`c-${f.rid}`, (v) => setF(f.rid, "cantidad", v))} /></Campo>
                  <Campo etiqueta="P. compra unit. con IVA ($)"><CampoNumeroCL data-campo-compra="unitario" decimales={2} style={{ ...iStyle, ...marcado(c.unitario) }} valor={f.unitario} onCambiar={numero(`u-${f.rid}`, (v) => setF(f.rid, "unitario", v))} />{ref(c.unitario, l ? pesos(l.unitario) : "")}</Campo>
                  <Campo etiqueta="Proveedor"><Entrada data-campo-compra="proveedor" style={marcado(c.proveedor)} value={f.proveedor} onChange={(e) => setF(f.rid, "proveedor", e.target.value)} />{ref(c.proveedor, l?.proveedor)}</Campo>
                  <Campo etiqueta="Enlace"><Entrada data-campo-compra="enlace" style={marcado(c.enlace)} value={f.enlace} onChange={(e) => setF(f.rid, "enlace", e.target.value)} placeholder="https://…" />{ref(c.enlace, l?.enlace)}</Campo>
                  <Campo etiqueta="Marca"><Entrada data-campo-compra="marca" style={marcado(c.marca)} value={f.marca} onChange={(e) => setF(f.rid, "marca", e.target.value)} />{ref(c.marca, l?.marca)}</Campo>
                  <Campo etiqueta="Modelo"><Entrada data-campo-compra="modelo" style={marcado(c.modelo)} value={f.modelo} onChange={(e) => setF(f.rid, "modelo", e.target.value)} />{ref(c.modelo, l?.modelo)}</Campo>
                </Rejilla>
                {(c.producto || c.marca || c.modelo) && <div data-aviso-especificaciones style={{ fontSize: T.small, color: C.warnText, fontWeight: 500, marginBottom: 6 }}>⚠ Cambió el producto, la marca o el modelo: comprueba que cumple las especificaciones ofertadas.</div>}
                {c.unitario && Number(f.unitario) > (l?.unitario || 0) && <div data-aviso-costo style={{ fontSize: T.small, color: C.dangerText, fontWeight: 500, marginBottom: 6 }}>Costo mayor al cotizado: {signo(Math.round((Number(f.unitario) - l.unitario) * Number(f.cantidad || 0)))} en este producto.</div>}
                <button type="button" data-dividir onClick={() => dividir(f)} style={{ background: "none", border: "none", color: C.tealDark, textDecoration: "underline", cursor: "pointer", fontSize: T.small, padding: 0, minHeight: 30 }}>+ Comprar parte de esta línea con otro proveedor</button>
              </div>
            );
          })}
        </div>

        <div style={caja} data-despachos>
          {tit("Pedidos y despacho (una sola vez por pedido)")}
          {grupos.map((g) => (
            <div key={g.clave} data-pedido={g.n} style={{ fontSize: T.small, padding: "4px 0", borderBottom: `1px solid ${C.border}` }}>
              <b>Pedido {g.n} · {g.proveedor || "sin proveedor"}</b>
              {B && <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                <span style={{ flex: 1, color: C.inkMuted }}>Documento de compra</span>
                <Selector data-documento-pedido={g.n} value={docs[g.clave] || g.documento} onChange={(e) => setDocs((x) => ({ ...x, [g.clave]: e.target.value }))}
                  opciones={[{ v: "factura", l: "Factura (IVA crédito fiscal)" }, { v: "boleta", l: "Boleta (el IVA es costo)" }]} />
              </div>}
              {!B && <div style={{ color: C.inkMuted, marginTop: 2 }}>Documento: {g.documento === "factura" ? "factura (IVA crédito fiscal)" : "boleta (el IVA es costo)"}</div>}
              {g.despachos.filter((x) => !x.adicional).map((x) => (
                <div key={x.envioSan} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                  <span style={{ flex: "1 1 160px", color: C.inkMuted }}>{x.yaRegistrado ? "Despacho cotizado: ya registrado en una compra anterior" : `Despacho cotizado ${pesos(x.original)}`}</span>
                  {B && !x.yaRegistrado
                    ? <CampoNumeroCL data-despacho-real={x.envioSan} decimales={0} style={{ ...iStyle, width: 130, fontFamily: MONO, ...marcado(Number(despReal[x.envioKey] ?? x.original) !== x.original) }} contenedor={{ display: "inline-block" }} valor={despReal[x.envioKey] ?? x.original} onCambiar={numero(`d-${x.envioKey}`, (v) => setDespReal((y) => ({ ...y, [x.envioKey]: v })))} />
                    : <b>{pesos(x.real)}</b>}
                </div>
              ))}
              {B && <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                <span style={{ flex: 1, color: C.inkMuted }}>Despacho adicional de este pedido</span>
                <CampoNumeroCL data-despacho-extra={g.n} decimales={0} style={{ ...iStyle, width: 130, fontFamily: MONO }} contenedor={{ display: "inline-block" }} valor={extras[g.clave] ?? ""} placeholder="0" onCambiar={numero(`e-${g.clave}`, (v) => setExtras((y) => ({ ...y, [g.clave]: v })))} />
              </div>}
              <div style={{ textAlign: "right", marginTop: 4 }}>Total del pedido (con IVA): <b data-costo-pedido={g.n}>{pesos(g.costo)}</b></div>
            </div>
          ))}
          <Campo etiqueta="Fecha de compra"><Entrada data-campo-compra="fecha" type="date" max={hoyISO()} value={fecha} onChange={(e) => setFecha(e.target.value)} /></Campo>
        </div>

        <div data-comparacion style={{ background: C.tealLight, borderRadius: R.md, padding: "10px 12px", marginBottom: 12, fontSize: T.sm }}>
          {tit("Total a pagar · montos con IVA")}
          {comp.filas.map((f) => (
            <div key={f.rid} data-dif-producto style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: T.small }}>
              <span style={{ minWidth: 0 }}>{f.producto} × {cantidadTxt(f.cantidad)}</span>
              <span style={{ flexShrink: 0 }}>{pesos(f.original)} → {pesos(f.real)} <b style={{ color: f.diferencia > 0 ? C.dangerText : f.diferencia < 0 ? C.okText : C.inkMuted }}>({signo(f.diferencia)})</b></span>
            </div>
          ))}
          <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 6, paddingTop: 6, display: "grid", gridTemplateColumns: "1fr auto auto", gap: "2px 12px", fontSize: T.small }}>
            <span /><b>Cotizado</b><b>Real</b>
            <span>Productos</span><span data-prod-original>{pesos(comp.productosOriginal)}</span><span data-prod-real>{pesos(comp.productosReal)}</span>
            <span>Despacho</span><span data-desp-original>{pesos(comp.despachoOriginal)}</span><span data-desp-real>{pesos(comp.despachoReal)}</span>
            <b>Total a pagar</b><b data-total-original>{pesos(comp.totalOriginal)}</b><b data-total-real>{pesos(comp.totalReal)}</b>
          </div>
          <div style={{ marginTop: 4, fontSize: T.small }}>Diferencia: <b data-diferencia-total style={{ color: comp.diferencia > 0 ? C.dangerText : comp.diferencia < 0 ? C.okText : C.ink }}>{signo(comp.diferencia)}</b></div>
          <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 6, paddingTop: 6, fontSize: T.small, lineHeight: 1.6 }}>
            Venta neta de la orden: <b>{pesos(v.neto)}</b><br />
            Costo real de esta compra ({base.exenta ? "venta exenta: el IVA es costo" : "neto si hay factura; con boleta, el total"}): <b data-costo-esta-compra>{pesos(comp.costoCompra)}</b>
            {Number(m.costo_real) > 0 && <> · costo real ya registrado: <b>{pesos(m.costo_real)}</b></>}<br />
            Utilidad estimada (cotización): <b data-utilidad-original>{pesos(comp.utilidadOriginal)}</b><br />
            {comp.parcial ? "Utilidad proyectada (compra parcial: lo pendiente a costo cotizado)" : "Utilidad actualizada según la compra real"}: <b data-utilidad-actualizada style={{ color: comp.utilidadActualizada < comp.utilidadOriginal ? C.dangerText : C.okText }}>{pesos(comp.utilidadActualizada)}</b>
            {comp.utilidadActualizada !== comp.utilidadOriginal && <> ({signo(comp.utilidadActualizada - comp.utilidadOriginal)} frente a lo cotizado)</>}
            {comp.parcial && <div data-aviso-parcial style={{ color: C.warnText, fontWeight: 500, marginTop: 4 }}>Compra parcial: quedan pendientes {comp.pendientes.filter((l) => l.queda > 0).map((l) => `${cantidadTxt(l.queda)} de «${l.nombre}»`).join(", ")} ({pesos(comp.costoPendiente)} a costo cotizado). La utilidad no es definitiva hasta comprarlo.</div>}
          </div>
        </div>

        {conFin && <BloqueFinanciamientoCompra activo={finActivo} setActivo={setFinActivo} filas={finFilas} setFilas={setFinFilas} financiadores={vp.financiadores || []}
          disponible={comp.totalReal} documentosHabilitados={vp.documentosHabilitados} />}

        <div style={{ marginBottom: 10 }}>
          {val.requiere.vigencia && <label data-confirmar="vigencia" style={{ display: "flex", gap: 8, fontSize: T.sm, marginBottom: 6, fontWeight: 500 }}><input type="checkbox" checked={conf.vigencia} onChange={(e) => setConf((c) => ({ ...c, vigencia: e.target.checked }))} /> Confirmo que los precios, la disponibilidad, las condiciones y el despacho siguen vigentes.</label>}
          {val.requiere.especificaciones && <label data-confirmar="especificaciones" style={{ display: "flex", gap: 8, fontSize: T.sm, marginBottom: 6, fontWeight: 500 }}><input type="checkbox" checked={conf.especificaciones} onChange={(e) => setConf((c) => ({ ...c, especificaciones: e.target.checked }))} /> Comprobé que el producto cumple las especificaciones ofertadas.</label>}
        </div>
        {errores.length > 0 && <div data-errores-compra><ErrorForm>{errores.map((e, i) => <div key={i}>• {e}</div>)}</ErrorForm></div>}
      </>}
    </Ventana>
  );
}
