# Pruebas de OCs — Fase 4A

Correcciones sin cambios de base de datos (ni migraciones, ni datos históricos). Cada error corregido tiene su prueba.

| Archivo | Qué prueba | Cómo se ejecuta |
|---|---|---|
| `reglas_oc.test.mjs` | Lógica pura: normalización de códigos (igual o más estricta que el índice único de la base), duplicados activos y archivados, respuesta de `/api/oc` (404 / 502 / cancelada / no aceptada), criterio único de "entregada", fechas de OC vs. compra, contadores exactos del Panel, alertas, edición parcial y reparto de productos, borrado confirmado. | `node docs/pruebas-oc/ejecutar.mjs` |
| `e2e_fase4a.mjs` | Interfaz completa con Supabase y `/api/oc` simulados con estado (12 escenarios, S0–S12): sincronización sin tocar la fecha de compra ni lo comprado, "Actualizar desde MP", "Corregir fechas", edición de la fecha de la OC, nueva OC con 404/caída/cancelada/no aceptada/duplicada, carga masiva con vendedor, contadores del Panel = listas exactas, OCs sin vendedor, criterio de "entregada" en filtros/Agenda/Alertas, reparto de inversión, Agenda sin compra fantasma, borrados que solo ajustan con confirmación, alta manual y regresión del ciclo completo de una OC. | `npx vite build --outDir <dir>` y `npx vite preview --outDir <dir> --port 4178`; luego `node docs/pruebas-oc/e2e_fase4a.mjs http://127.0.0.1:4178/` (opcional: `SOLO=S4,S8`) |
| `e2e_seguimiento.mjs` | Seguimiento especial (15/10/2026): las 17 pruebas acordadas en PC y celular — crear (autor y fecha automáticos), categorías, validación, alertas de prioridad alta y «Seguimiento atrasado» sin duplicados, filtro de Compras que cuenta OC, indicador en la lista, búsqueda combinada, prioridad/responsable, avance, «En gestión», solución obligatoria, historial de resueltos, sobrecosto solo informativo, permisos y bloqueo de la OC. | `NODE_PATH=$PWD/node_modules node docs/pruebas-oc/e2e_seguimiento.mjs <url>` |
| `e2e_subsanacion.mjs` | Contador de productos vendidos (desglose BFK o, si no hay, ítems de Mercado Público; nunca líneas de compra ni doble conteo) y subsanación de facturas como Seguimiento especial (desde la factura, preselección, duplicados, varias gestiones, alertas, filtro, resolución, permisos, bloqueo y sin cambios financieros), en PC y celular. | `NODE_PATH=$PWD/node_modules node docs/pruebas-oc/e2e_subsanacion.mjs <url>` |

Requiere `playwright-core` y Chromium (en el entorno de pruebas: `/opt/pw-browsers/chromium-1194`, o `CHROME=<ruta>`).
Nada sale a la red: las escrituras quedan en la base simulada (`mock_estado.mjs`) con datos ficticios (`datos_oc.mjs`).
