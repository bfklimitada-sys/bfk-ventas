# Pruebas de OCs — Fase 4A

Correcciones sin cambios de base de datos (ni migraciones, ni datos históricos). Cada error corregido tiene su prueba.

| Archivo | Qué prueba | Cómo se ejecuta |
|---|---|---|
| `reglas_oc.test.mjs` | Lógica pura: normalización de códigos (igual o más estricta que el índice único de la base), duplicados activos y archivados, respuesta de `/api/oc` (404 / 502 / cancelada / no aceptada), criterio único de "entregada", fechas de OC vs. compra, contadores exactos del Panel, alertas, edición parcial y reparto de productos, borrado confirmado. | `node docs/pruebas-oc/ejecutar.mjs` |
| `e2e_fase4a.mjs` | Interfaz completa con Supabase y `/api/oc` simulados con estado (12 escenarios, S0–S12): sincronización sin tocar la fecha de compra ni lo comprado, "Actualizar desde MP", "Corregir fechas", edición de la fecha de la OC, nueva OC con 404/caída/cancelada/no aceptada/duplicada, carga masiva con vendedor, contadores del Panel = listas exactas, OCs sin vendedor, criterio de "entregada" en filtros/Agenda/Alertas, reparto de inversión, Agenda sin compra fantasma, borrados que solo ajustan con confirmación, alta manual y regresión del ciclo completo de una OC. | `npx vite build --outDir <dir>` y `npx vite preview --outDir <dir> --port 4178`; luego `node docs/pruebas-oc/e2e_fase4a.mjs http://127.0.0.1:4178/` (opcional: `SOLO=S4,S8`) |

Requiere `playwright-core` y Chromium (en el entorno de pruebas: `/opt/pw-browsers/chromium-1194`, o `CHROME=<ruta>`).
Nada sale a la red: las escrituras quedan en la base simulada (`mock_estado.mjs`) con datos ficticios (`datos_oc.mjs`).
