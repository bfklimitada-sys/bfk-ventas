# Comisión ligada a la OC y a su liquidación original (13/11/2026)

**Vigente desde noviembre 2026** (Kevin, 13/11/2026 15:42). Octubre 2026 y los meses anteriores quedan como estaban
(octubre: Matías $846.880, Kevin $92.637, con el descuento F29 total de $31.656).

Regla (`liquidacionComision` en `src/lib/calculos.js`, misma en Comisiones, pago manual y cartola; en la base, `fin_periodo_comision`):
la cobranza sigue a la factura vigente, pero la comisión no se mueve al mes de una nueva factura. Mes de la comisión:
liquidación anclada (OC pagada) → si no, primera factura de una OC refacturada → si no, factura vigente más reciente.
Pago parcial: el mes original reconoce lo abonado y conserva el saldo. «Por revisar»: no se incluye en ningún pago hasta
revisarla. Cambio de utilidad después de pagar: diferencia aparte, sin tocar el saldo.

| Archivo | Qué prueba |
|---|---|
| `reglas.test.mjs` | OC pagada en junio refacturada dos veces (hacia noviembre), pago parcial, no pagada, varios vendedores, por revisar, ajuste de utilidad, enero–octubre idénticos a la versión anterior — `node docs/pruebas-comision-liquidacion/ejecutar.mjs /tmp/bfk-3ac3a64` |
| `e2e_ui.mjs` | Interfaz con Supabase simulado: meses, detalle, pago de noviembre, revisión |
| `comparar_real.mjs` | Datos reales de una copia: versión anterior (3ac3a64) vs nueva por vendedor y mes; nada distinto antes de noviembre (`empaquetar.mjs`) |
| `verificar_sitio.mjs` | Navegación de solo lectura; octubre en pantalla igual a lo esperado |

Historial: el 13/11/2026 se publicó primero con vigencia desde octubre (1f14796; octubre Matías $783.968, Kevin $92.527).
Ese mismo día Kevin pidió dejar octubre como estaba y aplicar la regla desde noviembre (migración
`2026-11-13-comision-vigencia-noviembre.sql`).
