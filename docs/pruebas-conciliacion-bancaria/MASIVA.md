# Conciliación masiva segura (23/10/2026)

Regla: **conciliar no es registrar**. El lote solo guarda vínculos con registros que ya existen; nada se crea solo.

## Qué cambia en la pantalla de la cartola
- **Coincidencias seguras para confirmar** (sección nueva, visible por defecto): movimientos que BFK ya reconoce con
  evidencia propia del banco (RUT, nombre del cliente, persona en el detalle, nota con la fecha, glosa del SII o una
  referencia ya confirmada), posteriores al cierre, sin decisión ni marca, con registros de un solo tipo que suman exacto.
  - Casilla por movimiento y botón «Seleccionar coincidencias seguras».
  - Atajo «Revisar todas las coincidencias seguras (N)»: marca solo las coincidencias seguras ya identificadas y abre
    directamente el resumen del lote, con la confirmación final desmarcada. No guarda decisiones ni crea registros:
    nada se escribe hasta marcar la confirmación y pulsar «Confirmar».
  - «Revisar y confirmar» muestra un resumen: cada movimiento con fecha, detalle, monto, registro de BFK y evidencia,
    más totales de abonos y cargos. Hay que marcar la confirmación antes de guardar.
  - Al confirmar, cada movimiento se vuelve a validar con datos recién leídos de la base; si otra persona lo confirmó,
    si su registro cambió o si apareció otra alternativa, se omite y se explica. La base además rechaza cualquier
    vínculo duplicado (dos usuarios a la vez): el resto del lote sigue.
  - Resultado con lo guardado y lo no guardado, y «Deshacer este lote» (anula solo las decisiones creadas por el lote).
  - Cada una conserva «No corresponde» para descartarla sin confirmar.
- **Por revisar**, **Sin registrar** y los conflictos quedan separados y nunca entran al lote.
- **Registro en serie de movimientos nuevos**: casillas en «Sin registrar» y «Registrar N seleccionados, uno por uno».
  Cada movimiento se abre con el formulario de siempre (sin preselección, con confirmación explícita); al registrarlo
  la cartola sigue abierta y se abre el siguiente. «Saltar este» y «Terminar». Cada registro usa el camino existente
  (marca de cartola, verificación con datos frescos, aviso de duplicado manual, reparto FIFO de financistas).

## Sin migración
Usa `conciliacion_decidir` / `conciliacion_anular` (ya instaladas). No cambia cobros, gastos, pagos, devoluciones,
cierres, F29 ni saldos del banco.

## Pruebas
| Prueba | Resultado |
|---|---|
| `lote.test.mjs` (selección segura, cierre, revalidación, conflictos, deshacer, huella) | 19/19 |
| `e2e_conciliacion_masiva.mjs` (PC 1280 y celular 390: lote, resumen, dos usuarios, deshacer, serie, sin base de decisiones) (incluye «Revisar todas»: abrir el resumen no escribe en la base) | 56/56 |
| `docs/migraciones/pruebas/conciliacion/concurrencia_lote.sh` (dos lotes cruzados a la vez, base desechable) | 4/4 |
| SQL de decisiones y concurrencia existentes | 30/30 y 4/4 |
| e2e existentes de la cartola (simple, automática, cartola, concurrencia, solo revisión) | 43, 20, 32, 30, 28 |
