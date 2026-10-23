# Eliminación definitiva de OC (23/10/2026)

Borrador: `docs/migraciones/BORRADOR-2026-10-23-eliminar-oc.sql` (reversión: `…-deshacer.sql`). **No aplicado.**

## Reglas (en la base)
- Solo administradores. Confirmación escribiendo el N° de la OC y motivo obligatorio.
- OC sin movimientos financieros: se puede eliminar.
- OC con cobros, facturas, compras o devoluciones: solo como **duplicado** de una OC original indicada, con cada movimiento
  igual en la original (cobro: monto y fecha; factura: folio y monto; compra: costo y financiador; devolución: monto y financiador).
- Siempre bloquea: conciliado con cartola o con decisión de conciliación; devolución parte de un pago repartido (FIFO);
  devoluciones ≠ costo financiado; comisión pagada sin monto verificado; corrección histórica pendiente; seguimiento
  especial; cotización vinculada por código.
- Una transacción; al final verifica que las demás OC, los financiadores, pagos, IVA, gastos y filas ajenas quedaron
  idénticos (si no, revierte todo).
- Auditoría `oc_eliminaciones`: quién, cuándo, motivo, resumen y copia completa (incluido el historial). Inmutable;
  solo la leen administradores. `oc_eliminacion_restaurar` vuelve a insertar exactamente lo eliminado.

## Pruebas
- `ejecutar.sh` (base desechable, cada caso en su conexión con ROLLBACK): 39 casos + dos sesiones a la vez, cobro
  simultáneo, restaurar con huella idéntica, reversión que se detiene si hay eliminaciones, huella final idéntica.
- Interfaz: `docs/pruebas-oc/e2e_eliminar_oc.mjs` (PC y celular, 37) y `docs/pruebas-oc/eliminar_oc.test.mjs` (8).
- Copia restaurada del respaldo de producción (repositorio de respaldos, sin producción): todo lo anterior más el caso real.
