import { useMemo } from "react";
import { C, MONO, fmt } from "../../lib/theme";
import { utilidadPorMes } from "../../lib/ocs";
import { Seccion, Tarjeta, Ayuda } from "../ui/Sistema";
import { InformeFinanciero } from "./InformeFinanciero";

// Margen comercial: promedio histórico, mes pasado cerrado y mes en curso, con UN criterio
// (lib/ocs.js, utilidadPorMes: fecha de la OC, ganancia con postventa). Movido desde el Panel sin cambios de cálculo.
export function MargenComercial({ ocs }) {
  const utilidad = useMemo(() => {
    const porMes = utilidadPorMes(ocs);
    const h = new Date(); const clave = (a, m) => `${a}-${String(m).padStart(2, "0")}`;
    const kActual = clave(h.getFullYear(), h.getMonth() + 1);
    const aAnt = h.getMonth() === 0 ? h.getFullYear() - 1 : h.getFullYear(), mAnt = h.getMonth() === 0 ? 12 : h.getMonth();
    const kAnt = clave(aAnt, mAnt);
    const hasta = Object.keys(porMes).filter((k) => k <= kActual);
    const venta = hasta.reduce((s, k) => s + porMes[k].venta, 0), util = hasta.reduce((s, k) => s + porMes[k].util, 0);
    const meses = Math.max(1, hasta.length);
    return {
      historico: { v: Math.round(util / meses), pct: venta > 0 ? Math.round(util / venta * 100) : 0 },
      anterior: { v: porMes[kAnt]?.util || 0, pct: porMes[kAnt]?.pct || 0, nombre: new Date(aAnt, mAnt - 1, 1).toLocaleDateString("es-CL", { month: "long" }) },
      actual: { v: porMes[kActual]?.util || 0, pct: porMes[kActual]?.pct || 0 },
    };
  }, [ocs]);
  const barras = [
    { label: "Promedio histórico", v: utilidad.historico.v, pct: utilidad.historico.pct },
    { label: utilidad.anterior.nombre, v: utilidad.anterior.v, pct: utilidad.anterior.pct },
    { label: "Este mes", v: utilidad.actual.v, pct: utilidad.actual.pct },
  ];
  const max = Math.max(1, ...barras.map((b) => Math.abs(b.v)));
  return (
    <Seccion titulo={<>Margen comercial del mes<Ayuda>Venta − costo − postventa, por fecha de la OC. No descuenta comisiones ni gastos: ver «Resultado del mes» en el informe financiero.</Ayuda></>}>
      <Tarjeta padding="16px 16px 14px">
        <div data-margen-comercial style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 110 }}>
          {barras.map((b) => (
            <div key={b.label} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%" }}>
              <span style={{ fontSize: 12, fontWeight: 800, fontFamily: MONO, color: b.v >= 0 ? C.ink : C.danger, marginBottom: 4, textAlign: "center" }}>{fmt.money(b.v)}</span>
              <div style={{ width: "64%", minHeight: 4, height: `${Math.max(4, Math.min(100, Math.abs(b.v) / max * 100))}%`, background: b.v >= 0 ? C.teal : C.danger, borderRadius: "6px 6px 2px 2px" }} />
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          {barras.map((b) => (
            <div key={b.label} style={{ flex: 1, textAlign: "center" }}>
              <div style={{ fontSize: 12, color: C.inkFaint, lineHeight: 1.3 }}>{b.label}</div>
              {b.pct > 0 && <div style={{ fontSize: 12, fontWeight: 700, color: C.inkMuted }}>{b.pct}%</div>}
            </div>
          ))}
        </div>
      </Tarjeta>
    </Seccion>
  );
}

// Finanzas › Resumen: margen comercial e informe financiero (solo lectura).
export function PanelResumenFinanzas(props) {
  return (
    <div>
      <MargenComercial ocs={props.ocs} />
      <InformeFinanciero {...props} onIrImpuestos={props.onIrImpuestos} />
    </div>
  );
}
