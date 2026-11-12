// Integración de Ventas privadas con Inicio y Finanzas, con filtro de canal.
// Regla de no duplicar: cada canal se calcula con sus propios registros (OCs de Mercado Público / órdenes de venta
// privadas); una cotización nunca se suma como ingreso; un anticipo y su aplicación a una factura cuentan una sola vez
// (el cobro es el pago, no la aplicación). Solo se totalizan entre canales los montos con la MISMA definición
// (ventas, facturado, cobrado y saldo, todos con IVA). Los márgenes se muestran por canal y no se suman (criterios distintos).
import { useMemo, useState } from "react";
import { C, MONO, R, S, T, cardStyle } from "../../lib/theme";
import { Seccion, AvisoLinea, Ayuda, ControlRotulado } from "../ui/Sistema";
import { Selector } from "../proyectos/Comunes";
import { Kpi, RejillaKpi, Fila, NoInstalado } from "./Comunes";
import { indicadoresVP, alertasVP, pesos, pct, hoyISO } from "../../lib/ventasPrivadas";
import { esVenta, fechaOC, cobradoDelCliente, ingresoPendienteOC } from "../../lib/ocs";
import { gananciaReal } from "../../lib/calculos";
import { indicadoresPorVendedor, totalesFinanciamiento } from "../../lib/vpFinanciamiento";

export const PERIODOS = [{ v: "mes", l: "Este mes" }, { v: "mes_anterior", l: "Mes anterior" }, { v: "anio", l: "Año en curso" }, { v: "todo", l: "Todo el historial" }];
export function rangoPeriodo(p, hoy = new Date()) {
  const y = hoy.getFullYear(), m = hoy.getMonth();
  const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  if (p === "mes") return { desde: iso(new Date(y, m, 1)), hasta: iso(new Date(y, m + 1, 0)) };
  if (p === "mes_anterior") return { desde: iso(new Date(y, m - 1, 1)), hasta: iso(new Date(y, m, 0)) };
  if (p === "anio") return { desde: `${y}-01-01`, hasta: `${y}-12-31` };
  return { desde: null, hasta: null };
}

// Mercado Público: mismas definiciones que el resto de la app (lib/ocs.js, lib/calculos.js), por fecha de la OC.
export function indicadoresMP(ocs, { desde, hasta } = {}) {
  const enRango = (f) => (!desde || String(f).slice(0, 10) >= desde) && (!hasta || String(f).slice(0, 10) <= hasta);
  const vs = (ocs || []).filter((o) => !o.archivada && esVenta(o) && enRango(fechaOC(o).valor || ""));
  let vendido = 0, facturado = 0, cobrado = 0, saldo = 0, margen = 0;
  for (const o of vs) { vendido += Number(o.monto_total) || 0; facturado += Number(o.monto_facturado) || 0; cobrado += cobradoDelCliente(o); saldo += ingresoPendienteOC(o); margen += gananciaReal(o).pesos; }
  return { n: vs.length, vendido, facturado, cobrado, saldo, margen, pctMargen: vendido > 0 ? margen / vendido : null };
}

export function ResumenVentasPrivadas({ vp, periodo, onIr, compacto }) {
  const r = rangoPeriodo(periodo);
  const k = useMemo(() => indicadoresVP(vp, r), [vp, periodo]); // eslint-disable-line react-hooks/exhaustive-deps
  const alertas = useMemo(() => alertasVP(vp), [vp]);
  const porVend = useMemo(() => (vp?.finInstalado && !compacto ? indicadoresPorVendedor(vp, r) : []), [vp, periodo, compacto]); // eslint-disable-line react-hooks/exhaustive-deps
  const fin = useMemo(() => (vp?.finInstalado ? totalesFinanciamiento(vp.finResumen || [], vp.finAportantes || []) : null), [vp]);
  if (!vp?.instalado) return compacto ? null : <NoInstalado />;
  // «Todos los canales» (Inicio): una sola franja rotulada en vez de cinco tarjetas; el detalle completo está en «Ventas privadas».
  if (compacto) {
    const sinMovimientos = !k.nVentas && !k.nCotizado && !k.facturado && !k.cobrado && !k.saldo;
    return (
      <div data-resumen-vp style={{ ...cardStyle, borderRadius: R.md, padding: "10px 14px", marginBottom: S.lg }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: sinMovimientos ? 0 : 6 }}>
          <span style={{ fontSize: T.small, fontWeight: 700, color: C.inkMuted, textTransform: "uppercase", letterSpacing: 0.6 }}>Ventas privadas</span>
          {sinMovimientos && <span style={{ fontSize: T.small, color: C.inkFaint }}>Sin ventas ni cotizaciones vigentes</span>}
        </div>
        <div style={{ display: sinMovimientos ? "none" : "grid", gridTemplateColumns: "repeat(auto-fit,minmax(128px,1fr))", gap: "6px 16px" }}>
          <Kpi plano dato="vp-cotizado" et="Cotizado vigente" v={pesos(k.cotizado)} n={`${k.nCotizado} cotizaci${k.nCotizado === 1 ? "ón enviada" : "ones enviadas"} sin venta (no es ingreso)`} onClick={onIr && (() => onIr("vp_cotizaciones"))} />
          <Kpi plano dato="vp-vendido" et="Ventas confirmadas" v={pesos(k.vendido)} n={`${k.nVentas} orden${k.nVentas === 1 ? "" : "es"} de venta · neto ${pesos(k.vendidoNeto)}`} onClick={onIr && (() => onIr("vp_ordenes"))} />
          <Kpi plano dato="vp-facturado" et="Facturado" v={pesos(k.facturado)} n={`Por facturar ${pesos(k.porFacturar)}`} />
          <Kpi plano dato="vp-cobrado" et="Cobros recibidos" v={pesos(k.cobrado)} n={k.anticipos ? `Incluye anticipos ${pesos(k.anticipos)}` : null} />
          <Kpi plano dato="vp-saldo" et="Saldo por cobrar" v={pesos(k.saldo)} tono={k.vencido ? "danger" : k.saldo ? "warn" : "ok"} n={k.vencido ? `${pesos(k.vencido)} vencido` : null} />
        </div>
        {alertas.length > 0 && <div style={{ marginTop: 8 }}><AvisoLinea tono={alertas.some((a) => a.nivel === "alto") ? "danger" : "warn"} icono="⚠" dato="alertas-vp" accion="Ver alertas" onClick={onIr && (() => onIr("notif"))}>
          {alertas.length} alerta{alertas.length > 1 ? "s" : ""} de ventas privadas</AvisoLinea></div>}
      </div>
    );
  }
  return (
    <div data-resumen-vp>
      <RejillaKpi>
        <Kpi dato="vp-cotizado" et="Cotizado vigente (no es ingreso)" v={pesos(k.cotizado)} n={`${k.nCotizado} cotizaci${k.nCotizado === 1 ? "ón enviada" : "ones enviadas"} sin venta`} onClick={onIr && (() => onIr("vp_cotizaciones"))} />
        <Kpi dato="vp-vendido" et="Ventas confirmadas" v={pesos(k.vendido)} n={`${k.nVentas} orden${k.nVentas === 1 ? "" : "es"} de venta · neto ${pesos(k.vendidoNeto)}`} onClick={onIr && (() => onIr("vp_ordenes"))} />
        <Kpi dato="vp-facturado" et="Facturado" v={pesos(k.facturado)} n={`Por facturar ${pesos(k.porFacturar)}`} />
        <Kpi dato="vp-cobrado" et="Cobros recibidos" v={pesos(k.cobrado)} n={k.anticipos ? `Incluye anticipos ${pesos(k.anticipos)}` : null} />
        <Kpi dato="vp-saldo" et="Saldo por cobrar" v={pesos(k.saldo)} tono={k.vencido ? "danger" : k.saldo ? "warn" : "ok"} n={k.vencido ? `${pesos(k.vencido)} vencido` : null} />
        {!compacto && <Kpi dato="vp-utilidad" et="Utilidad estimada (costos registrados)" v={k.costosVisibles ? pesos(k.utilidadEstimada) : "—"} tono={k.utilidadEstimada < 0 ? "danger" : "marca"}
          n={k.costosVisibles ? `Margen ${pct(k.margenEstimado)} sobre venta neta${k.ventasSinCostoVisible ? ` · ${k.ventasSinCostoVisible} venta(s) sin costos visibles para ti` : ""}` : "Sin costos visibles para tu usuario"} />}
        {!compacto && k.ventasConCostoReal > 0 && <Kpi dato="vp-utilidad-real" et="Utilidad real (con compras registradas)" v={pesos(k.utilidadReal)} tono={k.utilidadReal < 0 ? "danger" : "ok"} n={`${k.ventasConCostoReal} venta(s) · margen ${pct(k.margenReal)}`} />}
        {!compacto && fin && fin.totalCompras > 0 && <Kpi dato="vp-fin-pendiente" et="Financiamiento: pendiente de devolver" v={pesos(fin.pendienteDevolucion)} tono={fin.pendienteDevolucion > 0 ? "warn" : "ok"}
          n={`${fin.sinInformar ? `${pesos(fin.sinInformar)} sin informar · ` : ""}BFK ${pesos(fin.financiadoBfk)} (no es deuda)`} onClick={onIr && (() => onIr("financiamiento"))} />}
      </RejillaKpi>
      {porVend.length > 0 && <PorVendedor filas={porVend} />}
      {alertas.length > 0 && <AvisoLinea tono={alertas.some((a) => a.nivel === "alto") ? "danger" : "warn"} icono="⚠" dato="alertas-vp" accion="Ver alertas" onClick={onIr && (() => onIr("notif"))}>
        {alertas.length} alerta{alertas.length > 1 ? "s" : ""} de ventas privadas (cotizaciones por vencer, entregas o pagos vencidos)</AvisoLinea>}
    </div>
  );
}

// Ventas privadas por vendedor (11/11/2026): misma definición que los totales (ventas vigentes del período; cotizaciones no
// convertidas no cuentan). Cada venta está en un solo grupo: la suma de las filas es el total. BFK = la empresa: sin comisión personal.
function PorVendedor({ filas }) {
  const tot = filas.reduce((s, f) => ({ n: s.n + f.nVentas, v: s.v + f.vendido, neto: s.neto + f.vendidoNeto }), { n: 0, v: 0, neto: 0 });
  const met = (et, v, extra = {}) => <div>{et}<br /><b {...extra} style={{ fontFamily: MONO, color: C.ink, fontSize: T.sm, ...(extra.style || {}) }}>{v}</b></div>;
  return (
    <div data-vp-por-vendedor style={{ marginBottom: S.md }}>
      <div style={{ fontSize: T.small, fontWeight: 700, color: C.inkMuted, padding: "4px 0 6px" }}>POR VENDEDOR</div>
      {filas.map((f) => (
        <div key={f.clave || "sin"} data-vendedor-fila={f.clave || "sin"} style={{ ...cardStyle, borderRadius: R.md, padding: "9px 12px", marginBottom: 6 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}><b style={{ flex: 1, fontSize: T.sm }}>{f.nombre}</b>
            <span style={{ fontSize: T.small, color: C.inkFaint }}>{f.nVentas} venta{f.nVentas === 1 ? "" : "s"}{f.clave === "bfk" ? " · empresa, sin comisión personal" : ""}</span></div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(105px,1fr))", gap: 6, marginTop: 6, fontSize: T.small, color: C.inkMuted }}>
            {met("Total (con IVA)", pesos(f.vendido), { "data-vendedor-total": "" })}
            {met("Neto", pesos(f.vendidoNeto))}
            {met("Utilidad estimada", f.costosVisibles ? pesos(f.utilidadEstimada) : "—", { "data-vendedor-utilidad-estimada": "" })}
            {met("Utilidad real", f.ventasConCostoReal ? `${pesos(f.utilidadReal)}${f.ventasConCostoReal < f.nVentas ? ` (${f.ventasConCostoReal} de ${f.nVentas})` : ""}` : "—", { "data-vendedor-utilidad": "" })}
          </div>
        </div>
      ))}
      <div data-vendedor-fila="total" style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", padding: "6px 12px", fontSize: T.sm, fontWeight: 700 }}>
        <span>Total Ventas privadas · {tot.n} venta{tot.n === 1 ? "" : "s"}</span><span style={{ fontFamily: MONO }}><span data-vendedor-total-general>{pesos(tot.v)}</span> · neto {pesos(tot.neto)}</span>
      </div>
      <div style={{ fontSize: T.small, color: C.inkFaint, padding: "0 2px", lineHeight: 1.5 }}>Utilidad sobre venta neta, como en el resto de Ventas privadas: estimada con los costos de la cotización y real con las compras registradas (solo ventas con costos visibles para ti). Ventas privadas no genera comisiones automáticamente.</div>
    </div>
  );
}

// Finanzas › Resumen: filtro de canal. «Mercado Público» muestra el resumen existente sin cambios.
export function FinanzasPorCanal({ canal, ocs, vp, onIr, children }) {
  const [periodo, setPeriodo] = useState("mes");
  const r = rangoPeriodo(periodo);
  const mp = useMemo(() => indicadoresMP(ocs, r), [ocs, periodo]); // eslint-disable-line react-hooks/exhaustive-deps
  const priv = useMemo(() => (vp?.instalado ? indicadoresVP(vp, r) : null), [vp, periodo]); // eslint-disable-line react-hooks/exhaustive-deps
  if (canal === "mp") return children;
  // Este período solo filtra el cuadro de ventas por canal (y sus márgenes). El «Resultado del mes» del informe financiero tiene su propio mes.
  const selector = <ControlRotulado dato="periodo-canales" rotulo={canal === "vp" ? "Período de este resumen" : "Período de este cuadro"}><Selector aria-label={canal === "vp" ? "Período del resumen de Ventas privadas" : "Período del cuadro de ventas por canal"} data-periodo value={periodo} onChange={(e) => setPeriodo(e.target.value)} opciones={PERIODOS} style={{ width: "auto", minHeight: 36 }} /></ControlRotulado>;
  if (canal === "vp") return (
    <Seccion titulo={<>Ventas privadas<Ayuda>Ventas del período por fecha de la orden de venta, con su estado de facturación y cobro. Lo cotizado se informa aparte y nunca se suma como ingreso.</Ayuda></>} accion={selector}>
      <ResumenVentasPrivadas vp={vp} periodo={periodo} onIr={onIr} />
    </Seccion>
  );
  const col = { fontFamily: MONO, fontWeight: 700, textAlign: "right", padding: "7px 6px", fontSize: T.sm, whiteSpace: "nowrap" };
  const filas = [
    ["Ventas confirmadas (con IVA)", mp.vendido, priv?.vendido, true, "venta"],
    ["Facturado", mp.facturado, priv?.facturado, true, "facturado"],
    ["Cobros recibidos", mp.cobrado, priv?.cobrado, true, "cobrado"],
    ["Saldo por cobrar", mp.saldo, priv?.saldo, true, "saldo"],
    ["Cotizado vigente (no es ingreso)", null, priv?.cotizado, false, "cotizado"],
  ];
  return (<>
    <Seccion titulo={<>Todos los canales<Ayuda>Ventas del período por fecha de la OC (Mercado Público) o de la orden de venta (privadas), con su facturación y cobro. Cada monto proviene de un solo registro: no se suman cotizaciones como ingresos ni un anticipo dos veces. Los márgenes usan criterios distintos por canal y no se suman.</Ayuda></>} accion={selector}>
      <div data-consolidado style={{ ...cardStyle, borderRadius: R.md, padding: "6px 12px", overflowX: "auto" }}>
        {/* Sin ancho mínimo fijo: en el celular las cuatro columnas caben a la vista (los encabezados ocupan dos líneas); solo se
            desliza si los montos son muy largos. */}
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr style={{ fontSize: T.small, color: C.inkMuted, textAlign: "right", verticalAlign: "bottom" }}><th style={{ textAlign: "left", padding: "6px 4px", fontWeight: 600 }}>Concepto</th><th style={{ padding: "6px 4px", fontWeight: 600 }}>Mercado Público</th><th style={{ padding: "6px 4px", fontWeight: 600 }}>Ventas privadas</th><th style={{ padding: "6px 4px", fontWeight: 600 }}>Total</th></tr></thead>
          <tbody>
            {filas.map(([k, a, b, suma, dato]) => (
              <tr key={k} data-consolidado-fila={dato} style={{ borderTop: `1px solid ${C.border}` }}>
                <td style={{ fontSize: T.sm, color: C.ink, fontWeight: 600, padding: "7px 4px" }}>{k}</td>
                <td style={col}>{a == null ? "—" : pesos(a)}</td><td style={col}>{b == null ? "—" : pesos(b)}</td>
                <td data-total={dato} style={{ ...col, color: C.tealDark }}>{suma && b != null ? pesos(a + b) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ fontSize: T.small, color: C.inkFaint, padding: "6px 4px" }}>{mp.n} OC de Mercado Público · {priv ? `${priv.nVentas} venta(s) privada(s)` : "Ventas privadas no activado"} en el período.</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: S.sm, marginTop: S.sm }}>
        <div style={{ ...cardStyle, borderRadius: R.md, padding: "8px 12px" }}>
          <div style={{ fontSize: T.small, fontWeight: 700, color: C.inkMuted, marginBottom: 2 }}>MARGEN MERCADO PÚBLICO</div>
          <Fila k="Venta − costo − postventa" v={pesos(mp.margen)} /><Fila k="Sobre la venta" v={pct(mp.pctMargen)} />
        </div>
        {priv && <div style={{ ...cardStyle, borderRadius: R.md, padding: "8px 12px" }}>
          <div style={{ fontSize: T.small, fontWeight: 700, color: C.inkMuted, marginBottom: 2 }}>UTILIDAD VENTAS PRIVADAS (sobre venta neta)</div>
          <Fila k="Estimada (costos de la cotización)" v={priv.costosVisibles ? `${pesos(priv.utilidadEstimada)} · ${pct(priv.margenEstimado)}` : "—"} />
          <Fila k="Real (compras registradas)" v={priv.ventasConCostoReal ? `${pesos(priv.utilidadReal)} · ${pct(priv.margenReal)}` : "Sin compras registradas"} />
          {priv.costoRealDesdeGastos > 0 && <div style={{ fontSize: T.small, color: C.inkFaint, paddingTop: 4 }}>{pesos(priv.costoRealDesdeGastos)} del costo real son gastos ya registrados en Gastos (vinculados, no se descuentan dos veces).</div>}
          {priv.ventasSinCostoVisible > 0 && <div style={{ fontSize: T.small, color: C.inkFaint, paddingTop: 4 }}>{priv.ventasSinCostoVisible} venta(s) sin costos visibles para tu usuario (no se suponen en cero).</div>}
        </div>}
      </div>
    </Seccion>
    {children}
  </>);
}

export { hoyISO };
