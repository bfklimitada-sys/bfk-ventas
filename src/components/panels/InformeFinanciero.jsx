import { useMemo, useState } from "react";
import { C, MONO, fmt } from "../../lib/theme";
import { Seccion, Tarjeta } from "../ui/Sistema";
import { calcularF29, desgloseF29 } from "../../lib/f29";
import { cajaYFueraDelBanco, comisionesYApoyo, resultadoMes, resumenFinanciadores } from "../../lib/informes";

// Informe financiero (Etapa 3, 2026-10): SOLO presentación. Separa margen comercial, comisiones, apoyo en gestión,
// gastos, impuestos, caja bancaria, registros fuera del banco y deuda con financiadores. No cambia ningún monto.
const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const Linea = ({ k, v, signo, fuerte, tono, nota, dato }) => (
  <div data-informe={dato} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "4px 0", borderBottom: fuerte ? "none" : `1px solid ${C.border}`, fontWeight: fuerte ? 800 : 500 }}>
    <span style={{ fontSize: 12.5, color: C.ink, minWidth: 0 }}>{signo && <span style={{ color: C.inkFaint, marginRight: 4 }}>{signo}</span>}{k}
      {nota && <span style={{ display: "block", fontSize: 11.5, color: C.inkFaint, fontWeight: 400 }}>{nota}</span>}</span>
    <span data-monto={dato} style={{ fontFamily: MONO, fontSize: 12.5, color: tono || C.ink, flexShrink: 0 }}>{fmt.money(v)}</span>
  </div>
);

export function InformeFinanciero({ ocs, financiadores, gastos, pagosVendedor, ivaMensual, vendedores, pagoFinSueltos, aportes, ajustes, categorias, hoy = new Date() }) {
  const anioA = hoy.getFullYear(), mesA = hoy.getMonth() + 1;
  const anioP = mesA === 1 ? anioA - 1 : anioA, mesP = mesA === 1 ? 12 : mesA - 1;
  const [periodo, setPeriodo] = useState({ anio: anioP, mes: mesP });
  const datos = { ocs, financiadores, gastos, pagosVendedor, ivaMensual, vendedores, pagoFinSueltos, aportes, categorias };
  const res = useMemo(() => resultadoMes(datos, periodo.anio, periodo.mes), [ocs, gastos, pagosVendedor, ivaMensual, vendedores, categorias, periodo]);
  const f29 = useMemo(() => calcularF29({ ivaMensual, gastos, anioActual: anioA, mesActual: mesA }), [ivaMensual, gastos, anioA, mesA]);
  const cajaInf = useMemo(() => cajaYFueraDelBanco(datos), [ocs, financiadores, gastos, pagosVendedor, pagoFinSueltos, aportes]);
  const fins = useMemo(() => resumenFinanciadores({ ocs, financiadores, pagoFinSueltos, ajustes }), [ocs, financiadores, pagoFinSueltos, ajustes]);
  const com = useMemo(() => comisionesYApoyo({ pagosVendedor, gastos, vendedores }), [pagosVendedor, gastos, vendedores]);
  const T = cajaInf.porTipo, t = (k) => T[k]?.monto || 0;
  const periodosF29 = f29.periodos.filter((p) => p.det > 0 || p.pag > 0).slice(-4);
  const fuera = cajaInf.fuera;

  return (
    <Seccion titulo="Informe financiero" nota="Cada concepto por separado. Solo presentación: no modifica registros.">
      {/* 1. Margen comercial vs. resultado */}
      <Tarjeta padding="12px 14px">
        <div data-informe-resultado style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <span style={{ fontWeight: 800, fontSize: 13 }}>Resultado del mes</span>
          <select data-periodo-resultado value={`${periodo.anio}-${periodo.mes}`} onChange={(e) => { const [a, m] = e.target.value.split("-").map(Number); setPeriodo({ anio: a, mes: m }); }}
            style={{ fontSize: 12, padding: "4px 6px", borderRadius: 7, border: `1px solid ${C.border}` }}>
            {Array.from({ length: 12 }, (_, k) => { const d = new Date(anioA, mesA - 1 - k, 1); return { a: d.getFullYear(), m: d.getMonth() + 1 }; })
              .map(({ a, m }) => <option key={`${a}-${m}`} value={`${a}-${m}`}>{MES[m - 1]}-{a}</option>)}
          </select>
        </div>
        <Linea dato="margen" k="Margen comercial" v={res.margenComercial} nota={`Venta ${fmt.money(res.venta)} − costo ${fmt.money(res.costo)} (por fecha de la OC, con postventa) · ${res.pctMargen}%`} />
        <Linea dato="comisiones" signo="−" k={`Comisiones${res.comisionesProvisorias ? " (provisorias)" : ""}`} v={res.comisiones} nota="Por mes de factura; provisorias mientras falte el IVA o el total del F29" />
        <Linea dato="apoyo" signo="−" k="Apoyo en gestión" v={res.apoyoGestion} nota="Gasto de apoyo + extra incluido en pagos a vendedores (cada monto una vez)" />
        <Linea dato="gastos_operacionales" signo="−" k="Gastos operacionales" v={res.gastosOperacionales} nota="Sin impuestos (IVA/PPM), retenciones, devoluciones a financiadores ni capital" />
        <Linea dato="resultado" fuerte k="= Resultado después de comisiones y gastos" v={res.resultado} tono={res.resultado >= 0 ? C.okText : C.dangerText} />
        {res.impuestosInformativos > 0 && <div style={{ fontSize: 11.5, color: C.inkFaint }}>Impuestos y retenciones del mes (no son gasto operacional): {fmt.money(res.impuestosInformativos)}</div>}
      </Tarjeta>

      {/* 2. F29: IVA + PPM */}
      <Tarjeta padding="12px 14px">
        <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 6 }}>F29 por período (IVA + PPM)</div>
        {periodosF29.length === 0 && <div style={{ fontSize: 12, color: C.inkFaint }}>Sin períodos registrados</div>}
        {periodosF29.map((p) => { const d = desgloseF29(ivaMensual, gastos, p.anio, p.mes); return (
          <div key={`${p.anio}-${p.mes}`} data-f29={`${p.anio}-${p.mes}`} style={{ fontSize: 12, padding: "4px 0", borderBottom: `1px solid ${C.border}` }}>
            <b>{MES[p.mes - 1]}-{p.anio}</b> · IVA {fmt.money(d.iva)} + PPM {fmt.money(d.ppm)} = <b>{fmt.money(d.det)}</b> · pagado {fmt.money(d.pag)} ·{" "}
            <span style={{ color: d.pend > 0 ? C.dangerText : C.okText, fontWeight: 700 }}>pendiente {fmt.money(d.pend)}</span>
            {d.faltaTotalF29 && <span style={{ display: "block", color: C.warnText }}>Falta registrar el total del F29 (PPM): el pendiente puede ser mayor.</span>}
          </div>); })}
        <div style={{ fontSize: 11.5, color: C.inkFaint, marginTop: 4 }}>Total pendiente desde {MES[0]}-2026: {fmt.money(f29.total)}. Los períodos anteriores a agosto 2026 no incluyen PPM (regla vigente; sin cambios retroactivos).</div>
      </Tarjeta>

      {/* 3. Caja bancaria vs. fuera del banco */}
      <Tarjeta padding="12px 14px">
        <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 6 }}>Caja registrada (pasa por BancoEstado)</div>
        <Linea dato="caja_cobros" signo="+" k="Cobros de clientes" v={t("cobro") + t("cobro_externo")} />
        <Linea dato="caja_aportes" signo="±" k="Aportes y retiros de capital" v={t("aporte") + t("retiro")} nota="Capital: no es ingreso ni gasto" />
        <Linea dato="caja_fin" signo="−" k="Devoluciones a financiadores" v={-(t("pago_financiador") + t("pago_externo"))} nota="Reducen deuda: no son gasto" />
        <Linea dato="caja_propios" signo="−" k="Compras con fondos propios (Cuenta BFK)" v={-t("compra_fondos_propios")} />
        <Linea dato="caja_vendedores" signo="−" k="Pagos a vendedores (comisión + apoyo en gestión)" v={-t("pago_vendedor")} />
        <Linea dato="caja_gastos" signo="−" k="Gastos (incluye impuestos pagados)" v={-t("gasto")} />
        <Linea dato="caja_total" fuerte k="= Caja registrada BFK" v={cajaInf.caja} />
        <div style={{ fontWeight: 800, fontSize: 12.5, margin: "8px 0 4px" }}>Registrado fuera de BancoEstado (no suma a la caja)</div>
        <Linea dato="fuera_cobros" k={`Cobros fuera del banco y retenciones (${fuera.cobrosFueraBanco.n})`} v={fuera.cobrosFueraBanco.total} />
        <Linea dato="fuera_valevista" k={`Vale vista / cheques por cobrar (${fuera.valeVistaPorCobrar.n})`} v={fuera.valeVistaPorCobrar.total} />
        <Linea dato="fuera_gastos" k={`Gastos sin cargo bancario (${fuera.gastosSinCargo.n})`} v={fuera.gastosSinCargo.total} />
        <Linea dato="fuera_aportes" k={`Aportes sin movimiento BancoEstado (${fuera.aportesSinMovimiento.n})`} v={fuera.aportesSinMovimiento.total} />
      </Tarjeta>

      {/* 4. Financiadores */}
      <Tarjeta padding="12px 14px">
        <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 6 }}>Financiadores: deuda y devoluciones</div>
        {fins.map((f) => (
          <div key={f.id} data-financiador={f.id} style={{ fontSize: 12, padding: "4px 0", borderBottom: `1px solid ${C.border}` }}>
            <b>{f.nombre}</b> · compras financiadas {fmt.money(f.compras)} − devoluciones {fmt.money(f.devoluciones)}{f.ajustes ? ` ${f.ajustes > 0 ? "+" : "−"} ajustes ${fmt.money(Math.abs(f.ajustes))}` : ""} ={" "}
            <b style={{ color: f.saldo > 0 ? C.dangerText : C.ink }}>saldo {fmt.money(f.saldo)}</b>
            {f.calculado !== f.saldo && <span style={{ display: "block", color: C.warnText }}>El cálculo por OC da {fmt.money(f.calculado)}: revisar en Financiamiento.</span>}
          </div>
        ))}
        <div style={{ fontSize: 11.5, color: C.inkFaint, marginTop: 4 }}>Las devoluciones se reparten por FIFO (OC más antigua primero) y nunca se cuentan como gasto.</div>
      </Tarjeta>

      {/* 5. Comisiones y apoyo en gestión */}
      <Tarjeta padding="12px 14px">
        <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 6 }}>Comisiones y apoyo en gestión (últimos pagos)</div>
        {com.filas.slice(-6).map((r) => (
          <div key={`${r.vendedorId}-${r.anio}-${r.mes}`} data-comision={`${r.vendedorId}-${r.anio}-${r.mes}`} style={{ fontSize: 12, padding: "3px 0", borderBottom: `1px solid ${C.border}` }}>
            {r.vendedor.split(" ")[0]} · ventas de {MES[r.mes - 1]}-{r.anio}: comisión {fmt.money(r.comision)}{r.apoyoEnPago ? ` + apoyo en gestión ${fmt.money(r.apoyoEnPago)}` : ""} = transferido {fmt.money(r.transferido)}
          </div>
        ))}
        {com.apoyoGastos.length > 0 && <div style={{ fontSize: 11.5, color: C.inkFaint, marginTop: 4 }}>Apoyo en gestión registrado como gasto: {com.apoyoGastos.map((g) => `${MES[g.mes - 1]}-${g.anio} ${fmt.money(g.monto)}`).join(" · ")}.</div>}
        <div style={{ fontSize: 11.5, color: C.inkFaint, marginTop: 2 }}>Cada transferencia sale del banco una sola vez; el desglose es solo informativo.</div>
      </Tarjeta>
    </Seccion>
  );
}
