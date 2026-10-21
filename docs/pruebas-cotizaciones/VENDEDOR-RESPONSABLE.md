# Vendedor responsable obligatorio en Cotizaciones (21/10/2026) — preparado, NO publicado

## Diagnóstico (código de main a45617f y producción, solo lectura)
- Vendedores: catálogo `vendedores` de BFK (5, todos activos) y `cotizacion_vendedores` (registrados desde Cotizaciones,
  id «cz:<uuid>»; hoy 0). La cotización guarda `vendedor_id` y `vendedor_nombre` (migración v2, ya en producción).
- El vendedor era opcional en todos los estados; el nombre lo enviaba el navegador; no había bitácora de cambios.
  En adjudicadas solo el administrador podía cambiarlo (regla de interfaz, no de la base).
- Nada asignaba al usuario conectado automáticamente (se mantiene).
- Presentar = cambiar el estado a «Presentada» en Datos y guardar (cz_guardar_cotizacion_v2). Adjudicar = estado
  «Adjudicada» + código de OC (`oc_codigo` = número de la OC, vínculo explícito).
- OC: vendedor con `asignar_vendedor_oc` (historial y protección de comisiones pagadas por disparador).
- Producción: 178 cotizaciones; 174 presentadas (4 sin vendedor), 4 borradores (1 sin vendedor), 0 adjudicadas;
  0 vendedores inválidos.

## Cambios
- Migración `BORRADOR-2026-10-21-vendedor-responsable.sql` (aditiva, reversible; NO modifica cz_guardar_cotizacion_v2 ni
  datos): disparador `cz_vendedor_responsable` en cotizaciones (solo escrituras de la app):
  presentar/adjudicar exige vendedor; vendedor del catálogo y activo; nombre del catálogo; en presentada/adjudicada con
  vendedor solo un administrador lo cambia; bitácora `cotizacion_vendedor_historial` (quién, cuándo, anterior, nuevo,
  estado, si fue administrador). RPC `cz_transferir_vendedor_a_oc`: pasa el vendedor a la OC solo si la asignación es
  inequívoca, el vendedor es de BFK y la OC no tiene vendedor (usa asignar_vendedor_oc). Las presentadas históricas sin
  vendedor siguen editables (se exige al cambiar el estado o al quitarlo).
- App: `src/lib/vendedorCotizacion.js` (mismas reglas), `EditorCotizacion.jsx` (aviso, bloqueo al guardar, selector
  bloqueado para no administradores en presentadas/adjudicadas, confirmación del administrador, bitácora visible),
  `VendedorCotizacionOC.jsx` en la ficha de la OC (aviso de diferencia o botón «Asignar … como vendedor de la OC»),
  carga de cotizaciones adjudicadas con OC en `App.jsx`, `historialVendedor` en `cotizacionesDatos.js`.
- No cambia comisiones, pagos, F29, costos, FIFO ni fórmulas tributarias.

## Pruebas
- SQL en sesiones independientes (`docs/migraciones/pruebas/vendedor`): 23/23 local y en copia restaurada de
  bfk-20261021T1152Z (con contactos y guardas), más 3 con cotizaciones reales (ROLLBACK), API de OC 9/9, guardas y
  contactos 19/19 antes y después, huella financiera igual, deshacer sin rastro.
- Interfaz `e2e_vendedor_responsable.mjs` (PC y celular) 25/25; unitarias `vendedor.test.mjs` 17/17; batería completa.

## Publicación (una sola, cuando se autorice) y reversión
1. Respaldo nuevo → ensayo en copia → migración en una transacción REPEATABLE READ con huellas idénticas →
   pruebas en producción con ROLLBACK (sesiones independientes) → API 9/9.
2. Publicar la app en `main` (push normal) → Vercel READY.
3. Reversión: revertir el commit de la app; `set bfk.vend_descartar = 'si'` + `...-deshacer.sql` (exportar antes la
   bitácora). Los vendedores ya asignados se conservan.

## Vista general: cotizaciones sin vendedor (rama `vendedor-filtros`, 21/10/2026)
- Filtro **«Sin vendedor asignado»** (casilla junto al estado): muestra TODAS las cotizaciones sin vendedor
  (`vendedor_id` vacío), incluidas las históricas presentadas y los borradores. Se combina con el estado: «Presentada» +
  «Sin vendedor asignado» = las que requieren regularización.
- Etiqueta **«Sin vendedor»** en cada tarjeta sin responsable.
- Indicador **«Presentadas sin vendedor»** (cuenta en el servidor: `estado=eq.presentada&vendedor_id=is.null`); al
  tocarlo abre directamente esa combinación de filtros.
- El campo de texto del vendedor se llama **«Filtrar por vendedor»** (antes «Vendedor») y queda deshabilitado mientras
  está marcado «Sin vendedor asignado».
- Resumen «N cotizaciones con estos filtros» y botón «Quitar filtros».
- Todos los filtros y la búsqueda (código, institución, nombre) van en la consulta paginada de PostgREST, no sobre la
  página cargada. Solo lectura: no asigna ni modifica vendedores, comisiones ni cotizaciones. Sin cambios en Supabase.
- Prueba `e2e_filtro_sin_vendedor.mjs` (PC 1280 px y celular 390 px) 59/59, con las 4 históricas de producción
  (mismos códigos, instituciones y montos), el borrador sin vendedor y 26 con vendedor (paginación).
