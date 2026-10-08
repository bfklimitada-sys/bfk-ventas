# Cuadratura financiera (07/10/2026)

Definiciones del Panel (`src/lib/caja.js`, `resumenCaja`):

| Indicador | Fórmula | Observación |
|---|---|---|
| Saldo BancoEstado | saldo informado al corte + movimientos BFK registrados después del corte | Único dinero disponible |
| Caja registrada BFK | suma de `movimientosCaja` (cobros en banco, pagos a financiadores, compras con fondos propios, gastos con banco, comisiones pagadas, aportes con banco) | Control: incluye operaciones que nunca pasaron por BancoEstado |
| Diferencia banco − caja registrada | saldo BancoEstado − caja registrada | Se explica en el expediente de conciliación (bfk-respaldos) |
| Facturas por cobrar | Σ (factura vigente − cobrado que salda al cliente − vale vista pendiente) | Igual a Compras, ficha y Excel (facturado − cobrado) |
| Ventas compradas sin facturar | Σ monto OC sin factura vigente − cobrado | No es cuenta por cobrar hasta facturarse |
| Saldo proyectado | saldo BancoEstado + por cobrar + vale vista − deuda financiadores − comisiones − F29 − fondos externos | Proyección, no dinero disponible. Antes partía de la caja registrada y restaba dos veces lo pagado fuera del banco |

Utilidad del mes: `utilidadPorMes` (`src/lib/ocs.js`): fecha de la OC, ganancia con postventa, margen agregado; sin ventas externas.

Pruebas: `node docs/pruebas-cuadratura/ejecutar.mjs` (unitarias) y `docs/pruebas-cierre/panel-produccion.mjs` sobre una exportación de solo lectura.
