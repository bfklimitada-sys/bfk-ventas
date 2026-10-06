# Pruebas de la Fase 4B — Integridad financiera de OCs

| Archivo | Qué prueba | Cómo se ejecuta |
|---|---|---|
| `reglas_4b.test.mjs` | Reglas puras: tipo de financiamiento (externo / fondos propios / venta propia), deuda por OC, saldo con signo, facturas vigentes (regla 4), comisiones solo con la factura vigente, llamadas a las RPC y sus mensajes de error. | `node docs/pruebas-financieras/ejecutar.mjs` |
| `e2e_fase4b.mjs` | Interfaz con Supabase simulado con estado (la base simulada calcula los totales como la real): venta propia y Cuenta BFK sin deuda, cambio de financiamiento, bloqueos por corrección histórica pendiente, saldo a favor, Administración, edición y borrado de compras y pagos por RPC, re-emisión de factura, pago mayor que la deuda, dos dispositivos con pantalla desactualizada, teléfono de 390 px. | `node docs/pruebas-financieras/e2e_fase4b.mjs http://127.0.0.1:4178/` (build servido con `vite preview`) |
| `../migraciones/pruebas/financiero/pruebas.sql` | Pruebas SQL de la migración en una transacción con ROLLBACK (protección de totales, RPC, permisos, bloqueos, consistencia). | `begin; \i pruebas.sql; rollback;` en una base DESECHABLE |
| `../migraciones/pruebas/financiero/concurrencia.py` | Dos sesiones reales y carga concurrente; `--modelo-anterior` reproduce el pago perdido. | Variables `PG*` de una base DESECHABLE |
| `../migraciones/pruebas/financiero/e2e_postgrest.mjs` | Punta a punta: navegador → PostgREST → base con la migración; dos usuarios en dos dispositivos y un cliente con la versión anterior de la app. | Ver encabezado del archivo |

Nada de esto se ejecuta contra producción.
