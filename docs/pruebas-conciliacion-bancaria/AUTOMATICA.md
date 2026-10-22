# Conciliación automática sin duplicaciones (22/10/2026)

Regla: **conciliar no es registrar**. Nada se crea solo; lo reconocido se puede descartar («No corresponde») sin tocar el registro.

## Qué cambia
- **Referencias aprendidas** (solo de vínculos confirmados por el usuario o de registros hechos desde la cartola):
  - código de pagador de «Abono pago a proveedores» (el banco repite el código por institución) → cliente (RUT);
  - destinatario de una transferencia («TEF A …») → categoría de gasto, persona o tipo de registro.
  - Si una referencia apuntó a dos destinos distintos, se ignora.
- **Ya registrado automático** solo con referencia aprendida + registro único del mismo monto (cobro −10/+60 días; cargo ±5 días; IVA+PPM con combinación única).
- **Propuestas** de factura pendiente con la evidencia usada; «pagador identificado» solo con RUT, nombre o referencia aprendida. Una factura del mismo monto, sola, se propone como «no identificada» y se explica qué falta.
- **Filtros de contradicción**: no se ofrece un cobro cuyo RUT contradice el RUT del detalle, ni un registro de una persona cuando el detalle nombra a otro destinatario.
- **Candidatos antiguos**: ventana posterior al cierre −10/+60 días; un registro candidato en varias líneas queda solo en la más cercana.
- **Pantalla**: «Evidencia», «Falta», «Antecedentes» (otros movimientos anteriores del mismo destinatario; no son prueba) y «Sucursal» (indicio). «No corresponde» en lo reconocido automáticamente.
- Mensaje simple cuando otra persona acaba de vincular el mismo registro o movimiento.

## Sin migración
Usa la tabla `conciliacion_decisiones` existente (`mov_operacion`, `mov_descripcion`). Nada cambia en la base.

## Pruebas
| Prueba | Resultado |
|---|---|
| `automatica.test.mjs` (reglas, sección 7, huella) | 27/27 |
| `e2e_automatica.mjs` (PC 1280 y celular 390) | 20/20 |
| `docs/migraciones/pruebas/conciliacion/concurrencia.sh` (dos sesiones simultáneas, base desechable) | 4/4 |
| SQL de decisiones (`ejecutar.sh`) | 30/30 + instalación/reversión |
| Reglas, simple, solo revisión | 69, 51, 19 |
| e2e cartola, concurrencia, simple, solo revisión | 32, 30, 43, 28 |
| Batería completa | sin regresiones; solo las fallas conocidas de `main` (fase4b B13, compras celular M360/M390, fase4a S10 intermitente) |
