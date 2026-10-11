import { useMemo, useState } from "react";
import { C, MONO, fmt } from "../../lib/theme";
import { resumenCaja } from "../../lib/caja";
import { registrosConAlerta } from "../../lib/registroCartola";
import { Ic } from "../ui/Iconos";
import { Seccion, Tarjeta, Monto, Pestanas, PanelPestana, Indicador, Indicadores, BotonPrincipal, BotonSecundario, Desplegable, Ayuda } from "../ui/Sistema";
import { AlertasCartola } from "./AlertasCartola";

// Banco (rediseño 2026-10): saldo de BancoEstado, conciliación, importación de cartola y registros por revisar.
// Solo presentación: usa la misma caja y conciliación del Panel (lib/caja.js) y abre la misma ventana de cartola.
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export function PanelBanco({ ocs, financiadores, gastos, pagosVendedor, ivaMensual, vendedores, pagoFinSueltos, aportes, saldoBanco, ultimaCartola, bancoMensual = [], onEditarSaldo, onImportarCartola, onQuitarAlertaCartola }) {
  const [pestana, setPestana] = useState("conciliacion");
  const r = useMemo(() => resumenCaja({ ocs, financiadores, gastos, pagosVendedor, ivaMensual, vendedores, pagoFinSueltos, aportes, saldoBanco }),
    [ocs, financiadores, gastos, pagosVendedor, ivaMensual, vendedores, pagoFinSueltos, aportes, saldoBanco]);
  const nAlertas = registrosConAlerta({ ocs, gastos, pagosVendedor, pagoFinSueltos, aportes }).length;
  const conciliado = Math.abs(r.diferenciaBancoCaja) <= 0.5;
  return (
    <div>
      <Indicadores columnas={2}>
        <Indicador dato="saldo-banco" destacado etiqueta={r.conciliacion.hayCorte ? `Saldo BancoEstado al ${fmt.date(r.conciliacion.corte)}` : "Saldo BancoEstado"} valor={r.conciliacion.hayCorte ? fmt.money(r.conciliacion.saldoBancoCorte) : "Sin registrar"} tono={r.conciliacion.hayCorte ? "marca" : "warn"} onClick={onEditarSaldo} nota={saldoBanco ? "Toca para actualizar" : "Toca para registrar"} />
        <Indicador dato="diferencia" etiqueta={conciliado ? "Conciliación" : "Diferencia banco − caja"} valor={r.conciliacion.hayCorte ? (conciliado ? "Conciliado" : fmt.money(r.diferenciaBancoCaja)) : "—"} tono={!r.conciliacion.hayCorte ? "neutro" : conciliado ? "ok" : "warn"} onClick={() => setPestana("conciliacion")} />
      </Indicadores>
      <Pestanas etiqueta="Banco" activa={pestana} onCambiar={setPestana} items={[
        { key: "conciliacion", label: "Conciliación" },
        { key: "cartola", label: "Cartola" },
        { key: "revisar", label: "Por revisar", n: nAlertas || null, tono: nAlertas ? "warn" : null },
      ]} />

      <PanelPestana visible={pestana === "conciliacion"} titulo="Conciliación bancaria">
        {/* Conciliación bancaria: el saldo esperado usa EXACTAMENTE los mismos movimientos que la caja */}
        <Tarjeta padding="12px 14px">
          <div data-conciliacion style={{ fontSize: 13, color: C.ink }}>
            {r.conciliacion.hayCorte ? (<>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, color: C.inkMuted, padding: "4px 0" }}><span>Saldo informado del banco al {fmt.date(r.conciliacion.corte)}</span><Monto tam="sm">{fmt.money(r.conciliacion.saldoBancoCorte)}</Monto></div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, color: C.inkMuted, padding: "4px 0" }}><span>+ Movimientos registrados después de esa fecha ({r.conciliacion.nPosteriores})</span><Monto tam="sm">{fmt.money(r.conciliacion.movPosteriores)}</Monto></div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontWeight: 700, padding: "4px 0" }}><span>= Saldo esperado en el banco</span><Monto tam="sm">{fmt.money(r.conciliacion.esperado)}</Monto></div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontWeight: 700, padding: "4px 0" }}><span>Caja registrada BFK</span><Monto tam="sm">{fmt.money(r.caja)}</Monto></div>
              <div data-pendiente-conciliacion style={{ display: "flex", justifyContent: "space-between", gap: 8, fontWeight: 800, color: conciliado ? C.okText : C.warnText, marginTop: 4, paddingTop: 6, borderTop: `1px solid ${C.border}` }}>
                <span>{conciliado ? "Conciliado" : "Diferencia banco − caja registrada"}{!conciliado && <Ayuda etiqueta="Qué significa la diferencia">La caja registrada incluye operaciones que no pasaron por BancoEstado (compras anteriores a la apertura o pagadas por un socio, pagos compensados fuera del banco) y movimientos del banco sin registro en BFK. No es pérdida ni ganancia ni dinero adicional: se explica con el expediente de conciliación. El saldo proyectado parte del saldo del banco.</Ayuda>}</span>
                <Monto tam="sm">{fmt.money(r.diferenciaBancoCaja)}</Monto>
              </div>
            </>) : <div style={{ fontSize: 12, color: C.inkMuted }}>Sin saldo del banco registrado: no se puede conciliar.</div>}
          </div>
        </Tarjeta>
        <BotonSecundario onClick={onEditarSaldo} style={{ width: "100%", justifyContent: "space-between", minHeight: 44 }}>
          <span>{saldoBanco ? "Actualizar saldo de la cuenta" : "Registrar saldo de la cuenta"}</span><Ic n="chevR" />
        </BotonSecundario>
      </PanelPestana>

      <PanelPestana visible={pestana === "cartola"} titulo="Cartola">
        <Seccion nota="Importa la cartola de BancoEstado (Excel) para registrar cobros, egresos y retiros que aún no están en BFK.">
          <BotonPrincipal data-importar-cartola onClick={onImportarCartola} style={{ width: "100%", justifyContent: "center", marginBottom: 12 }}><Ic n="🏦" /> Importar y conciliar cartola</BotonPrincipal>
          <Tarjeta padding="12px 14px">
            <div style={{ fontSize: 12, fontWeight: 800, color: C.inkMuted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Última cartola importada</div>
            {ultimaCartola
              ? <div data-ultima-cartola style={{ fontSize: 13, color: C.ink }}>Del {fmt.date(String(ultimaCartola.fecha_desde || "").slice(0, 10))} al {fmt.date(String(ultimaCartola.fecha_hasta || "").slice(0, 10))}{ultimaCartola.n_movimientos != null ? ` · ${ultimaCartola.n_movimientos} movimientos` : ""}</div>
              : <div style={{ fontSize: 13, color: C.inkFaint }}>Aún no se ha importado ninguna cartola.</div>}
          </Tarjeta>
          {bancoMensual.length > 0 && (
            <Desplegable dato="banco-mensual" titulo="Movimiento mensual de la cuenta" resumen={`${bancoMensual.length} mes${bancoMensual.length > 1 ? "es" : ""}`}>
              {bancoMensual.map((m) => (
                <div key={m.id} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 4, padding: "7px 0", borderBottom: `1px solid ${C.border}`, fontSize: 12 }}>
                  <span style={{ fontWeight: 700, color: C.ink }}>{m.mes ? `${MESES[m.mes - 1]}-${m.anio}` : m.id}</span>
                  <span style={{ fontFamily: MONO, color: C.inkMuted, textAlign: "right" }}>entró {fmt.money(m.entro)} · salió {fmt.money(m.salio)}{m.saldo_cierre != null ? ` · cierre ${fmt.money(m.saldo_cierre)}` : ""}</span>
                </div>
              ))}
            </Desplegable>
          )}
        </Seccion>
      </PanelPestana>

      <PanelPestana visible={pestana === "revisar"} titulo="Registros por revisar">
        {nAlertas === 0 && <Tarjeta><span style={{ fontSize: 14, color: C.okText, fontWeight: 700 }}>✓ Sin posibles duplicados con la cartola</span></Tarjeta>}
        <AlertasCartola ocs={ocs} gastos={gastos} pagosVendedor={pagosVendedor} pagoFinSueltos={pagoFinSueltos} aportes={aportes} onQuitar={onQuitarAlertaCartola} />
      </PanelPestana>
    </div>
  );
}
