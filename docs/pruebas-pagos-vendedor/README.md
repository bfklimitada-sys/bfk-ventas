# Pagos a vendedores con extra por gestión (08/10/2026)

Una transferencia = una fila de `pagos_vendedor` con dos componentes:
- `monto_pagado`: pago de comisión = mínimo(transferido, comisión pendiente del período).
- `monto_extra_gestion`: extra por gestión = máximo(transferido − comisión pendiente, 0), del mismo período.
- `monto_transferido` = comisión + extra (restricción en la base). Pagos históricos: null → total = `monto_pagado`.

Comisión y saldo pendiente usan solo `monto_pagado` de pagos vigentes; la caja resta una vez el total transferido.
Anulación: solo administrador, con motivo; el pago se conserva y deja de contar. La base impide borrar o modificar pagos.
Comisión provisoria (IVA sin registrar): se advierte; si luego baja, la diferencia se muestra como saldo por regularizar.

Pruebas: `node docs/pruebas-pagos-vendedor/ejecutar.mjs` (unitarias), `e2e_pagos.mjs <url>` (interfaz),
`docs/migraciones/pruebas/pagos-vendedor/pruebas.sql` (base local desechable).
Migración: `docs/migraciones/2026-10-08-pago-vendedor-gestion.sql` · deshacer: `...-deshacer.sql`.
