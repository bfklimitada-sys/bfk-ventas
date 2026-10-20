# Ventas exentas — Fase 3 (20/10/2026, NO publicada)

Rama local `fase3-exentas` (sin subir: la vista previa de Vercel usaría la base de producción).

## Fórmulas
| Caso | Costo real | Base del recargo | Unitario | IVA de venta | Total |
|---|---|---|---|---|---|
| Afecta (sin cambios) | costo neto (IVA de compras con factura = crédito) | costo neto | ⌈costo neto × (1+r) / q⌉ | 19% del neto | neto + IVA |
| Exenta aprobada | costo bruto (el IVA de compras no se recupera, art. 23 N.º 2) | costo bruto (productos + despacho asignado una vez) | ⌈costo bruto × (1+r) / q⌉ | $0 | total exento |

Exenta solo con clasificación aprobada (tratamiento exento + clasificacion_id). Cotización adjudicada: conserva la
fórmula con que se guardaron sus precios (`formula.exenta`), aunque la clasificación cambie después.

## Facturación
OC exenta aprobada → solo DTE 34 (monto_exento = monto, monto_iva = 0, notas con fundamento y clasificación),
número, fecha y confirmación de emisión en el SII obligatorios. OC afecta o histórica → DTE 33, fila idéntica a la
actual. NC y refacturación con las reglas vigentes. BFK no emite facturas.

## Rentabilidad y comisiones
Sin cambios de fórmula: utilidad = venta − costo real registrado (con IVA) − postventa. Venta propia con DTE 34:
IVA 0 (regla de la fase 1). Comisión general, F29 e IVA mensual sin cambios.

## Migraciones
- `BORRADOR-2026-10-20-hotfix-permisos-trib.sql` — URGENTE, corrige la fase 2 (escrituras de OC bloqueadas).
- `BORRADOR-2026-10-20-fase3-guardas-exentas.sql` — recomendada: la base exige las reglas de DTE 34 y de
  cotizaciones exentas aunque un cliente escriba directo. Requiere el hotfix (usa trib_escritura_api).
