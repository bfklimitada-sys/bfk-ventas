# Centro de Acciones Pendientes (17/11/2026)

Bandeja de trabajo en Inicio: qué falta hacer, por qué, quién es responsable y qué se hizo, con o sin OC.

## Diseño

- **Un solo sistema.** El Centro amplía el *Seguimiento especial* de la OC (`public.oc_seguimientos`); no hay una segunda tabla.
  Lo que se crea en la ficha de una OC aparece en el Centro y al revés.
- **Acciones sin OC:** `oc_id` pasa a ser opcional (exige título). Con OC, el cliente es el de la OC; sin OC se puede indicar uno.
- **Columnas nuevas:** `titulo`, `cliente`, `origen` y `origen_id` (acciones automáticas). `fecha_revision` es el vencimiento.
- **Categorías** en `public.acciones_categorias` (12 iniciales; se agregan o desactivan sin tocar registros; solo administradores).
  Se conservan los códigos anteriores (`proveedor` = «Compras y proveedores», `entrega` = «Entregas y despachos», etc.).
- **Historial en la base** (`historial_cambios`, campo `seguimiento:<id>`): creación, título, descripción, categoría, prioridad,
  responsable, vencimiento, cliente, estado, resolución, reapertura y eliminación, con fecha y usuario. La app agrega los
  comentarios/avances. Al asignar responsable la base avisa «Para ti» al asignado.
- **Reglas de la base:** autor y fechas los fija la base; resolver exige la solución (quién y cuándo, automático); lo resuelto
  queda como historial (solo un administrador lo edita); **cualquier usuario BFK puede reabrir** (solo el cambio de estado, con
  motivo en la app; la solución anterior queda en el historial); solo un administrador elimina.
- **Resolver una acción no cambia la OC** (estado comercial, entrega, factura, cobro, postventa) ni nada financiero.

## Acciones automáticas (solo con registros reales, sin duplicados)

| Origen | Se crea | Se resuelve sola |
|---|---|---|
| Incidente de postventa abierto (`eventos_postventa`) en OC no archivada | 1 acción por incidente (índice único) | al cerrar el incidente; se reabre si el incidente se reabre; si el incidente se elimina, se resuelve con esa nota |
| Aviso de entrega fallida confirmado en la app (lugar y motivo) | 1 acción abierta por OC (índice único parcial); un nuevo intento se anota en la misma | al registrar la entrega de la OC |

Al instalar solo se crean acciones para los incidentes de postventa **abiertos hoy** en OC no archivadas (producción 17/11/2026:
2). No se recorre ninguna otra OC histórica. Seguimientos especiales y subsanaciones de factura ya son acciones (misma tabla).

**Registro manual:** compras y proveedores, instalaciones y servicios técnicos, cobranza, gestiones comerciales, tareas
administrativas, documentación y cualquier caso que no tenga un registro estructurado en BFK Datos.

## Sincronización y consumo

Carga completa: +1 consulta liviana (catálogo). Con la app visible, cada 2 minutos y al volver a la app se piden solo las acciones
y registros de historial nuevos o modificados (normalmente respuestas vacías), con 2 minutos de margen y mezcla por id.

## Archivos

`docs/migraciones/2026-11-17-centro-acciones.sql` (+ `-deshacer.sql`), `src/lib/acciones.js`, `src/components/acciones/*`,
`src/App.jsx`, `src/components/panels/PanelDashboard.jsx`, `src/components/ficha/SeguimientoEspecial.jsx`,
`src/lib/seguimientos.js`, `src/components/forms/FormulariosCorreo.jsx`, `src/lib/supabase.jsx`.

## Pruebas

- `ACC_DB_URL=… node docs/pruebas-acciones/sql_acciones.test.mjs` — base real (PostgreSQL): 52 pruebas (RLS, permisos, historial,
  reapertura, automáticas, duplicados, concurrencia, protección de la OC y de lo financiero). `--sin-base` sobre una copia restaurada.
- `bash docs/pruebas-acciones/deshacer_local.sh` — deshacer sin datos (estructura idéntica) y con datos (se conserva todo) y volver a aplicar.
- `CHROME=… node docs/pruebas-acciones/e2e_acciones.mjs <url>` — interfaz en computador y celular (Supabase simulado con la migración).
- Regresión: `docs/pruebas-oc/e2e_seguimiento.mjs` y `e2e_subsanacion.mjs` (sin la migración), `docs/pruebas-oc/ejecutar.mjs`,
  `docs/pruebas-consumo/*`.

## Reversión

1. App: volver a publicar el commit anterior (la app anterior funciona con la base migrada).
2. Base: `2026-11-17-centro-acciones-deshacer.sql` — retira lo automático y el historial automático y vuelve a las reglas del
   15/10/2026 **sin borrar ninguna acción, comentario ni historial**; si no hay datos que dependan de la estructura nueva, la deja
   exactamente como antes.
