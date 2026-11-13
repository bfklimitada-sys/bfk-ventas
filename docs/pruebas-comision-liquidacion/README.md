# Comisión ligada a la OC y a su liquidación original (13/11/2026)

## Regla definitiva (Kevin, 13/11/2026 16:15) — vigente desde el 1 de noviembre de 2026, sin término

- **Hasta octubre 2026, intacto:** la migración `2026-11-13-comision-periodo-cerrado.sql` registra (no recalcula) el mes en que
  cada OC con comisión cuenta hoy si es octubre 2026 o antes (`comision_cierre_anio/mes`). Ese mes es definitivo: aunque la
  OC se anule y refacture una o varias veces, en cualquier mes o año, no sale de su mes ni genera una comisión nueva.
- **Desde noviembre 2026:** la OC conserva para siempre el mes de su liquidación original (primera factura o mes en que se pagó).
- **Nunca considerada:** con liquidación anterior a noviembre y refacturada después → mes de su primera factura desde noviembre
  (fijo). OC creada después del cierre (`comision_tras_cierre`, la marca la base) con factura de un período cerrado → noviembre 2026.
- **Pagos:** totales y parciales quedan en la obligación original; un pago adicional a un mes ya pagado va a extra de gestión.
- **Cobranza:** sigue a la factura vigente. **Pantalla:** el mes de la nueva factura lista la OC con su período original y el motivo.
- Misma regla en Comisiones, pago manual, cartola y base (`fin_periodo_comision`).
- `comparar_real.mjs` simula con los datos reales refacturar TODAS las OC en marzo 2027 y febrero 2028: ningún mes cambia.

**Vigente desde noviembre 2026** (Kevin, 13/11/2026 15:42). Octubre 2026 y los meses anteriores quedan como estaban
(octubre: Matías $846.880, Kevin $92.637, con el descuento F29 total de $31.656).

Regla (`liquidacionComision` en `src/lib/calculos.js`, misma en Comisiones, pago manual y cartola; en la base, `fin_periodo_comision`):
la cobranza sigue a la factura vigente, pero la comisión no se mueve al mes de una nueva factura. Mes de la comisión:
liquidación anclada (OC pagada) → si no, primera factura de una OC refacturada → si no, factura vigente más reciente.
Pago parcial: el mes original reconoce lo abonado y conserva el saldo. «Por revisar»: no se incluye en ningún pago hasta
revisarla. Cambio de utilidad después de pagar: diferencia aparte, sin tocar el saldo.

| Archivo | Qué prueba |
|---|---|
| `reglas.test.mjs` | Ejemplo obligatorio (nov-2026 → mar-2027), refacturaciones entre meses y años (2026–2028) de OC liquidadas antes y después de noviembre, pagadas, no pagadas y con pago parcial, OC nueva con factura de un período cerrado, por revisar — `node docs/pruebas-comision-liquidacion/ejecutar.mjs /tmp/bfk-3ac3a64` (usa también `/tmp/bfk-460951e`) |
| `e2e_ui.mjs` | Interfaz con Supabase simulado: meses, detalle, pago de noviembre, revisión |
| `comparar_real.mjs` | Datos reales de una copia: versión anterior (3ac3a64) vs nueva por vendedor y mes; nada distinto antes de noviembre (`empaquetar.mjs`) |
| `verificar_sitio.mjs` | Navegación de solo lectura; octubre en pantalla igual a lo esperado |

Historial: el 13/11/2026 se publicó primero con vigencia desde octubre (1f14796; octubre Matías $783.968, Kevin $92.527).
Ese mismo día Kevin pidió dejar octubre como estaba y aplicar la regla desde noviembre (migración
`2026-11-13-comision-vigencia-noviembre.sql`).
