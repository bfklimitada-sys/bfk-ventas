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
- `2026-10-20-hotfix-permisos-trib.sql` — **APLICADA en producción el 20/10/2026** (solo `authenticated`; anon sigue sin permiso).
  Es la versión exacta aplicada (sha256 5122053f…). Su prueba permanente está en bfk-respaldos `scripts/prueba-permisos-api.sh` (9/9).
- `BORRADOR-2026-10-20-fase3-guardas-exentas.sql` — recomendada: la base exige las reglas de DTE 34 y de
  cotizaciones exentas aunque un cliente escriba directo. Requiere el hotfix (usa trib_escritura_api).

## Ensayo de las guardas en copia restaurada (20/10/2026)
Copia del respaldo bfk-20261020T1734Z con los permisos exactos de producción (fase 2 + corrección): 76 tablas iguales;
guardas instaladas con huella idéntica; **16/16 pruebas en sesiones independientes** (`docs/migraciones/pruebas/exentas/sesiones/`,
cada prueba en su propia conexión con el rol fijado); prueba permanente de la API 9/9 antes y después de las guardas;
huella financiera igual; deshacer sin rastro; reinstalar y deshacer de nuevo. Ejecución 39470617050.

Verificación de borde en producción (solo lectura): 0 cotizaciones con impuestos = 0 y subtotal > 0 (la guarda no
bloquearía la edición de ninguna cotización existente); 0 facturas DTE 34; 0 clasificaciones aprobadas.
