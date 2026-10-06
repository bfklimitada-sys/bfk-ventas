# Pruebas de la Fase 4C — Mercado Público y operación diaria

Sin cambios de base de datos (ni migraciones, ni datos históricos). La foto de Mercado Público de cada OC se guarda
como caché en `mp_cache_avisos` (id `oc_mp:<id OC>`); la marca de la revisión automática, en `mp_cache_avisos` (id `revision_auto`).

| Archivo | Qué prueba | Cómo se ejecuta |
|---|---|---|
| `reglas_4c.test.mjs` | Lógica pura: foto de Mercado Público (neto/IVA, aceptación, recepción, ítems), sincronización sin pisar datos manuales, plan de productos, selección de la revisión automática, estado único, caja vs. por cobrar (abonos parciales y vale vista), comisión por factura vigente con detalle de OCs, cartola (exacta, varias del mismo RUT, parcial, vale vista), búsqueda y filtros, Excel de la vista, ficha PDF y `/api/oc`. | `node docs/pruebas-4c/ejecutar.mjs` |
| `e2e_fase4c.mjs` | Interfaz con Supabase y `/api/oc` simulados con estado (C1–C8): actualizar desde MP sin pisar datos, revisión automática que no se repite, canceladas en MP con el mismo criterio en Panel/lista/Alertas, filtros y Excel de la vista, ficha PDF, desglose del saldo proyectado, OCs del cálculo de comisión, cartola con cobros en una sola solicitud, teléfono de 390 px. | build servido con `vite preview` en el puerto 4178; luego `node docs/pruebas-4c/e2e_fase4c.mjs http://127.0.0.1:4178/` (opcional `SOLO=C1,C7`) |

Reutiliza la base simulada (`../pruebas-oc/mock_estado.mjs`) y los datos ficticios (`../pruebas-oc/datos_oc.mjs`) de la Fase 4A.
Nada se ejecuta contra producción.
