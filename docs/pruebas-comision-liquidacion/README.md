# Comisión ligada a la OC y a su liquidación original (13/11/2026)

Regla (`liquidacionComision` en `src/lib/calculos.js`, misma en Comisiones, pago manual y cartola; en la base, `fin_periodo_comision`):
la cobranza sigue a la factura vigente, pero la comisión no se mueve al mes de una nueva factura. Mes de la comisión:
liquidación anclada (OC pagada) → si no, primera factura de una OC refacturada → si no, factura vigente más reciente.
Pago parcial: el mes original reconoce lo abonado y conserva el saldo. «Por revisar»: no se incluye en ningún pago hasta
revisarla. Cambio de utilidad después de pagar: diferencia aparte, sin tocar el saldo.

| Archivo | Qué prueba |
|---|---|
| `reglas.test.mjs` | OC pagada en junio refacturada dos veces, pago parcial, no pagada, varios vendedores, por revisar, ajuste de utilidad (40 casos) — `node docs/pruebas-comision-liquidacion/ejecutar.mjs` |
| `e2e_ui.mjs` | Interfaz con Supabase simulado: meses, detalle, pago de octubre, revisión (9 casos) |
| `comparar_real.mjs` | Datos reales de una copia: versión publicada vs nueva por vendedor y mes (`empaquetar.mjs`) |

Ensayo con datos reales (13/11/2026, copia de producción, ejecución 43473…): julio 2026 vuelve a calcular $669.909 (lo pagado);
octubre deja de contar 3 OC pagadas en julio; 2 OC quedan «Por revisar» (posible pago en dos liquidaciones).
