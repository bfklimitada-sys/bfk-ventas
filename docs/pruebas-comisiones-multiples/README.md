# Comisión ordinaria del período con varios vendedores (Etapa 4, 28/10/2026)

**Estado: desarrollada y probada en local (rama `comisiones-multiples`). NO publicada ni aplicada a producción.**

## Problema
`calcularPagoVendedor()` calculaba cada vendedor con su propia utilidad, pero descontaba el descuento tributario COMPLETO
del período (IVA neto con signo + retenciones del F29 desde agosto 2026) en cada cálculo. Con dos o más vendedores en un
mismo mes, el IVA y el PPM se descontaban (o, si el IVA neto era negativo, se sumaban) una vez por vendedor.

## Regla (lib/calculos.js, una sola para Vendedores, Panel, informes, caja y registro de pagos)
- Comisión ordinaria total del período = `max(0, redondeo((Σ utilidad ordinaria − descuento tributario único) / 2))`.
- Reparto entre los vendedores con ventas ordinarias del período en proporción a su utilidad ordinaria **positiva**, en pesos
  enteros por el método del mayor resto: las partes suman exactamente el total (empates por id del vendedor).
- Vigencia: desde `COMISION_PERIODO_DESDE` (octubre 2026). Los períodos anteriores conservan el cálculo anterior.

## Casos definidos
| Caso | Tratamiento |
|---|---|
| Un solo vendedor ordinario | Idéntico al cálculo anterior (probado en 120 combinaciones) |
| Utilidad de un vendedor negativa o cero | Entra en la utilidad total del período (es de BFK); su parte es $0 |
| Utilidad total ≤ descuento | Comisión total $0; nadie recibe |
| Ningún vendedor con utilidad positiva y total > 0 (solo por IVA negativo) | Partes iguales |
| Vendedor con solo ventas propias en el período | No participa del total ordinario ni del descuento |
| Ventas propias | Aparte, como antes: 100% de su utilidad − IVA de su factura |
| Monto verificado, pagos parciales/completos, extra por gestión, anulaciones | Sin cambios |
| Comisión excluida, capitalización, venta externa, sin vendedor, factura anulada | No entran al período |

## Pruebas
- `node docs/pruebas-comisiones-multiples/ejecutar.mjs` — reglas (43 comprobaciones, incluida la propiedad de suma exacta
  en 400 períodos aleatorios de 2 a 7 vendedores y la equivalencia con la regla anterior para un vendedor).
- `comparar_copia.mjs` — compara, con los datos de una copia restaurada, la regla anterior (`anterior/calculos.js`,
  congelada de `cfedaf0`) con la nueva, por período y vendedor, separando períodos cerrados y abiertos.
