# Conciliación bancaria simple y sin duplicaciones (21/10/2026)

Rama local `conciliacion-simple` (no publicada). Reutiliza la arquitectura actual: lectura de cartolas, unión sin
duplicados, marca del movimiento, registro atómico en la base, cierre del 07/10/2026 y FIFO.

## A. Diagnóstico

### Lo que funciona y se reutiliza
- **Lectura de cartolas** (`cartolas.js`):
  - Lee los dos formatos de BancoEstado, valida la cadena de saldo y el Resumen, y rechaza el archivo completo si algo falla.
  - Une las cartolas por multiconjunto: un archivo repetido o un período superpuesto no duplica nada.
- **Marca del movimiento** (`cart:fecha:cargo:abono:saldo:n`): es estable al recargar la cartola y distingue dos líneas iguales del mismo día.
- **Registro desde la cartola** (`registrar_movimiento_cartola` y `registrar_pago_financiador_cartola`):
  - Un movimiento se registra una sola vez, aunque sea desde dos sesiones (23505).
  - Avisa de un posible duplicado manual (BFK01).
  - Impide el doble clic.
  - Antes de escribir, verifica contra datos recién leídos.
  - Mantiene el FIFO y el cierre del 07/10/2026.
- **Opciones de abono** (`calzarAbonos` / `opcionesAbono`): factura exacta, varias facturas del mismo RUT, abono parcial o depósito de vale vista.

### Problemas reales encontrados
| # | Problema | Riesgo |
|---|---|---|
| 1 | La conciliación **no usaba la marca** de los registros hechos desde la cartola: los emparejaba por monto y fecha, como cualquier otro. | Con dos líneas iguales, un registro podía quedar asociado al movimiento equivocado. |
| 2 | **Pago al SII con IVA y PPM en un solo cargo**: después del cierre quedaba «Pendiente» y se podía registrar. La suma de gastos solo se buscaba antes del cierre. | Registrar otra vez el F29 como un gasto nuevo (**duplicación**). |
| 3 | Las **compras pagadas con fondos propios** (Cuenta BFK) no se comparaban con el banco. | Registrar el pago al proveedor como un gasto nuevo además de la compra (**duplicación**). |
| 4 | «Posible registrado» **no tenía acción**: no había cómo confirmar ni descartar. El único vínculo existente escribe `marca_cartola` en la fila financiera (cambia la huella) y solo aparece al intentar registrar. | Las 14 «posibles» quedan para siempre. Hay que adivinar si registrar o no. |
| 5 | **Pago conjunto** (un abono = un cobro ya registrado + una factura pendiente del mismo cliente): no se podía conciliar. Registrar desde la cartola exige el monto completo. | Registrar el abono completo y **duplicar** el cobro ya registrado. |
| 6 | **Pantalla**: 4 estados y 3 sentidos con todo mezclado (73 movimientos). Usaba lenguaje técnico («control inverso», «Posible registrado») y el aviso de registros sin banco decía «revisa si están duplicados». | Confusión. Riesgo de eliminar o volver a registrar algo correcto. |
| 7 | Dos movimientos iguales el mismo día se conservan (bien), pero **sin aviso**. | Darlos por duplicados. |
| 8 | El **depósito de un vale vista** aparecía como pendiente registrable, mezclado con los cobros nuevos. | Registrar un cobro nuevo en vez de marcar cobrado el vale vista. |

## B. Propuesta y desarrollo

### Interfaz («Cartola del banco: conciliar»)
- **Tres grupos con contador:** **Por revisar**, **Sin registrar** y **Ya registrados**.
- **Qué se ve por defecto:** solo «Por revisar» y «Sin registrar». El botón **«Ver conciliados»** muestra el resto.
- **Secciones aparte:**
  - **«Registrado en BFK, pendiente de verificar en banco»**: explica el posible motivo y nunca lo llama duplicado.
  - **Lo anterior al 07/10/2026**: botón propio, solo consulta.
- **Cada movimiento muestra:**
  - fecha, N° de operación, descripción del banco y monto;
  - posible OC o categoría;
  - registro BFK relacionado;
  - motivo de la coincidencia, en palabras simples;
  - acción recomendada.
- **«Por revisar»** tiene dos botones:
  - **«Es este registro»**: concilia sin crear nada.
  - **«No corresponde»**: ese registro deja de proponerse para ese movimiento. Hay también «Ninguno corresponde».
  - Cualquier decisión se puede deshacer.
- **«Sin registrar»**: el mismo registro seguro de hoy (nada preseleccionado, con confirmación).
- **Avisos:**
  - Dos movimientos iguales el mismo día: «el banco los informa como operaciones distintas; verifica el N° de operación».
  - Depósito de vale vista: se propone **marcarlo como cobrado**, no un cobro nuevo.
  - Pago conjunto: indica que el cobro ya registrado existe y que **solo se registre desde la OC la parte pendiente**. Después el abono queda conciliado solo, como suma exacta del mismo cliente.

### Controles contra duplicaciones (`conciliacion.js`)
1. **Certeza primero:**
   - un registro con la marca del movimiento queda «Ya registrado» con ese movimiento;
   - un vínculo confirmado por un usuario hace lo mismo;
   - esos registros nunca se usan para otro movimiento.
2. **Pago al SII:** si los gastos «Impuesto SII» de ±5 días suman exactamente el cargo con una sola combinación, queda «Ya registrado». Si hay varias combinaciones, queda «Por revisar». Nunca se ofrece como gasto nuevo.
3. **Compras con fondos propios:** aparecen como coincidencia «Por revisar» y nunca se concilian solas. También impiden dar por único otro registro del mismo monto.
4. **Decisiones guardadas aparte:** «No corresponde» excluye ese registro para ese movimiento. Un vínculo con un registro que ya no existe vuelve a «Por revisar».
5. **Antes de registrar:** se vuelven a leer las decisiones. Un movimiento ya vinculado no se registra.
6. **Mismo monto y fecha no bastan:** se mantiene la regla actual (hace falta otra evidencia o un registro único) y no se deduplican líneas reales.

### Migración necesaria (borrador, NO aplicada)
- **Archivos:** `docs/migraciones/BORRADOR-2026-10-21-conciliacion-decisiones.sql`, con su reversión `…-deshacer.sql`.
- **Por qué es necesaria:** confirmar o descartar sin tocar los registros financieros. Hoy el único vínculo escribe en la fila del cobro, gasto o pago, y cambia la huella.
- **Tabla `conciliacion_decisiones`** (vinculado / rechazado, quién y cuándo; se anula, no se borra):
  - un registro solo puede estar vinculado a un movimiento;
  - un movimiento, a un solo grupo de registros de un mismo tipo.
- **`conciliacion_decidir`** es la única vía de escritura. Para vincular exige que:
  - el movimiento sea posterior al cierre y no futuro;
  - los registros pasen por el banco (no retención, no «fuera del banco», no vale vista sin cobrar, no compra de un financiador externo);
  - tengan el mismo sentido y estén a ±45 días;
  - sumen exacto;
  - no tengan marca ni vínculo de otro movimiento.

  Usa la misma llave de bloqueo que el registro desde la cartola.
- **`conciliacion_anular`**: deshace una decisión y deja constancia.
- **Disparador `conciliacion_guardia`** en las 5 tablas de la cartola:
  - solo actúa cuando se escribe `marca_cartola`;
  - impide registrar desde la cartola un movimiento ya vinculado, o marcar un registro vinculado a otro movimiento;
  - los registros manuales no cambian.
- **No modifica:** OC, compras, facturas, cobros, pagos a financiadores, comisiones, F29, saldos, FIFO ni las funciones actuales de la cartola.
- **Sin la migración:** la app funciona igual. Consulta y registra lo «Sin registrar»; los botones de decisión quedan inactivos con un aviso.

### Pruebas
| Prueba | Resultado |
|---|---|
| SQL en base desechable, cada caso en su conexión y con ROLLBACK (`docs/migraciones/pruebas/conciliacion/ejecutar.sh`) | 23/23 |
| — la huella financiera no cambia al vincular (cobro, IVA+PPM) | incluido |
| — un registro no se vincula a dos movimientos; un movimiento no se vincula dos veces | incluido |
| — dos operaciones iguales se vinculan por separado | incluido |
| — suma distinta, sentido incorrecto, cierre, fecha futura | incluido |
| — vale vista sin cobrar, retención, compra externa | incluido |
| — rechazo y anulación; registro desde la cartola de un movimiento vinculado → bloqueado | incluido |
| — vínculo antiguo contra registro vinculado → bloqueado; registro manual sin cambios | incluido |
| — permisos; reversión que se detiene si hay decisiones | incluido |
| Reglas: los 15 escenarios pedidos + caso real (pago conjunto) + huella de los datos (`simple.test.mjs`) | 34/34 |
| Reglas existentes (`reglas.test.mjs`) | 69/69 |
| Interfaz PC 1280 px y celular 390 px (`e2e_conciliacion_simple.mjs`), sin escrituras financieras al vincular, rechazar o deshacer | 41/41 |
| Interfaz existente: cartola | 32/32 |
| Interfaz existente: concurrencia | 30/30 |
| Batería completa (unitarias + e2e) | sin regresiones nuevas; solo las 2 fallas conocidas que también fallan en `main` (fase 4B B13 y compras celular M360/M390). `e2e_fase4c` ajustada (elige el abono por monto, porque el vale vista ahora va en «Por revisar»): 52/52 |

## Caso real (solo lectura, 21/10/2026)
- La base **no guarda la cartola**: `cartolas_importadas` y `banco_mensual` están vacías. Los 73 movimientos solo existieron en la pantalla.
- **El cobro de la advertencia:**
  - id `evp_1792070555991_xg5ji`, de la OC **1058758-200-AG26**, Universidad de Tarapacá (RUT 70.770.800-K);
  - corresponde a la factura N° 303 del 19/08/2026 por $124.798;
  - fue **registrado a mano** el 15/10 a las 10:22 (transferencia, sin marca de cartola), después del correo de cobranza enviado el 15/10 a las 01:42.
- **Por qué aparece:** es posterior al cierre, cae dentro del período de la cartola y en esa cartola no hay ningún abono de exactamente $124.798 cerca de esa fecha. Por eso ninguna línea lo explica. No es evidencia de duplicado.
- **Hipótesis principal:** el mismo cliente tiene la OC **1058758-276-AG26** (factura N° 338 del 07/10 por **$676.001, sin cobrar**). Si la universidad pagó ambas juntas, en el banco hay un abono de **$800.799**; ese sería el «1 pendiente».
- **Cómo verificar en la cartola:** buscar un abono de la Universidad de Tarapacá o del RUT 70770800 alrededor del 15–17/10.
  - Si es de $800.799: registrar **solo** $676.001 en 1058758-276-AG26 desde la OC. El abono queda conciliado solo y no se toca el cobro de la factura 303.
  - Si no hay abono: el pago aún no llega; el cobro se registró antes de tiempo. No se elimina; se verifica cuando llegue.
- **Movimientos posteriores al cierre:** 9 cobros, 1 gasto y 2 pagos a vendedor, todos manuales (ninguno registrado desde la cartola).

## Publicación (cuando se autorice) y reversión
1. **Respaldo nuevo** y comprobación de su restauración.
2. **Ensayo en la copia:** migración, `ejecutar.sh` (23/23), huella financiera igual y reversión sin rastro.
3. **Producción:**
   - guardia (sha256 y último respaldo) y ensayo con ROLLBACK;
   - instalación en una transacción REPEATABLE READ, con COMMIT solo si la huella total y la financiera quedan idénticas;
   - pruebas con ROLLBACK en sesiones independientes;
   - API de OC 9/9.
4. **App:** push normal a `main` y confirmación de Vercel READY. La base va primero: la app funciona con o sin la migración.
5. **Reversión:**
   - revertir el commit de la app;
   - `…-deshacer.sql`, que se detiene si ya hay decisiones: exportarlas antes y usar `set bfk.conc_descartar = 'si'`.

   Ningún registro financiero cambia en ningún paso.
