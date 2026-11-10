# Retiro de Inteligencia Comercial (IC)

## Estado (10/11/2026)

- Aplicación: retirada en `8b7fc48` (publicado). La corrección de sesión `39dd6fe` va encima y se conserva.
- Este commit solo devuelve el texto de espera de «Consultar y completar» al de `367254a` (un intento de hasta 20 s; el texto
  «hasta un minuto, con un reintento» correspondía al endpoint de `e733fbf`, ya reemplazado).
- Base de datos: retiro preparado y ensayado en copia restaurada (bfk-respaldos, rama `retiro-ic-ensayo-temporal`,
  ejecución 42839390032, respaldo `bfk-20261110T1455Z`). Pendiente de autorización para producción.

## Inventario de lo incorporado por IC

| Lugar | Elementos | Estado |
|---|---|---|
| bfk-ventas | `api/inteligencia.mjs`, `src/lib/inteligenciaComercial.js`, `src/lib/inteligenciaDatos.js`, `src/components/inteligencia/*`, bloque en `PanelDashboard.jsx`, pestaña de Administración, entrada de `api/inteligencia.mjs` en `vercel.json`, pruebas `docs/pruebas-inteligencia` | Retirado en `8b7fc48` |
| bfk-ventas (registro) | `docs/migraciones/BORRADOR-2026-11-0{4,5,6}-*` y sus «deshacer» | Se conservan como historial (no ejecutables) |
| Supabase | 6 relaciones (`ic_interruptor`, `ic_interruptor_historial`, `ic_sincronizaciones`, `ic_resultados`, `ic_resultados_historial`, vista `ic_oportunidades`), 14 funciones, 3 políticas, 1 disparador y sus índices/secuencias | Pendiente: `operaciones/retiro-ic` en bfk-respaldos |
| Vercel | Solo la función `api/inteligencia.mjs` (retirada; responde 404). Sin cron de Vercel. Sin variables propias: IC usaba `MP_TICKET_COMPRA_AGIL`/`MP_TICKET`, compartidas con Compra Ágil y `/api/oc` | Nada más que retirar; los tickets se conservan |
| bfk-respaldos | 10 ramas temporales IC (todas con su flujo ya deshabilitado), flujo de ejecución `retiro-ic.yml` | Archivar con etiqueta `archivo/<rama>` y borrar tras la ejecución |
| Ejecución automática | Sincronización iniciada desde el navegador (Panel). Sin pg_cron, sin pg_net, sin tareas en la base | Retirada en `9cdce21`/`8b7fc48`; última sincronización registrada 07/11 02:28 UTC |

Dependencias compartidas (se conservan): API `api2.mercadopublico.cl/v2/compra-agil`, tickets, Supabase Auth/PostgREST.
Ningún objeto ajeno a IC depende de objetos IC (inventario de solo lectura: sin dependencias registradas, sin código ni
vistas ajenas que los mencionen, sin disparadores ajenos que usen sus funciones).

## Compra Ágil: anterior a IC (`367254a`) frente a la vigente

| Aspecto | `367254a` | Vigente |
|---|---|---|
| URL y ruta | `GET https://api2.mercadopublico.cl/v2/compra-agil?id=<código>` | Idéntica |
| Cabeceras | `ticket`, `Accept: application/json` | Idénticas |
| Ticket | `MP_TICKET_COMPRA_AGIL` o, en su defecto, `MP_TICKET` | Idéntico |
| Tiempo | un intento, `AbortSignal.timeout(20 s)`; función Vercel 30 s | Idéntico (archivo igual byte a byte) |
| Frecuencia | límite por usuario en memoria; una consulta por clic | Igual, más bloqueo de doble clic (`e733fbf`, no atribuible a IC) |
| Cliente | `fetch('/api/compra-agil?q=…', Authorization: Bearer)` | Igual. La renovación de sesión (`39dd6fe`) solo puede repetir una vez si la función rechaza la sesión, antes de llamar a ChileCompra |

El valor histórico del ticket configurado en Vercel no puede verificarse desde Git ni desde este acceso.

## Relación IC ↔ errores de Compra Ágil (evidencia, sin causa demostrada)

- IC consumió el mismo ticket: 31 sincronizaciones, 200 consultas (04/11: 158; 06/11: 21 automáticas, 42 consultas, 42 errores).
- IC quedó detenida en el servidor el 07/11 00:18 (`1acc99b`). Los 504 se observaron el 08/11, con IC ya detenida.
- 08/11 desde GitHub Actions: el listado de 1062018-144-COT26 respondió 504 «Endpoint request timed out» a ~29,5 s con el
  ticket vigente **y con un segundo ticket independiente**, mientras la API v1 de OC respondía 200 en 1,2 s.
- 10/11 18:13 UTC desde GitHub Actions: 200 en 2,9 s, 1 resultado coincidente (estado «Cancelada»).
- Conclusión limitada: el 504 no fue exclusivo del ticket compartido; no puede atribuirse a IC con esta evidencia, ni descartarse
  un efecto previo de su consumo.
