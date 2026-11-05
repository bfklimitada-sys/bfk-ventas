# Inteligencia Comercial de Compra Ágil (04/11/2026)

**Estado: desarrollado y probado en local (rama `inteligencia-comercial`). NO publicado. Migración preparada, NO aplicada.**

## Qué hace
Desplegable «Inteligencia Comercial» al final del Panel Principal (no desplaza ni cambia los indicadores actuales). Se
descarga y consulta solo al abrirlo.

- **Filtros**: mes, año o período personalizado; institución; vendedor BFK (o «Sin vendedor»); estado de adjudicación;
  «Actualizar resultados» (consulta ChileCompra, solo administradores), «Recalcular», exportar a Excel o CSV.
- **8 indicadores**: presentadas · monto ofertado (neto, con IVA y total) · ganadas · monto adjudicado a BFK (neto y total,
  precio ofertado) · perdidas · pendientes (y por verificar; desiertas/canceladas aparte) · tasa de éxito ·
  diferencia ponderada vs precio adjudicado (comparables, total y mediana).
- **5 gráficos SVG** (sin dependencias nuevas): barras de resultados y dona (tocar = filtrar), línea mensual,
  barras horizontales de empresas que ganaron frente a BFK, comparación de montos ofertado vs adjudicado por mes.
- **Detalle** con búsqueda, orden y paginación (tabla en escritorio, tarjetas en celular): código con enlace a Mercado
  Público, fecha, institución, descripción, vendedor, ofertado (neto/total), estado del proceso, resultado, empresa y RUT
  adjudicados, monto adjudicado, diferencia en $ y %, avisos. «Información no disponible» / «Resultado pendiente de
  verificar» cuando ChileCompra no lo entrega.

## Reglas (una sola definición: `src/lib/inteligenciaComercial.js` = vista `ic_oportunidades` + `ic_resumen`)
- Unidad de análisis: **un código de Compra Ágil**. Varios productos o varias cotizaciones con el mismo código cuentan una
  vez (se toma la más avanzada: adjudicada > no adjudicada > presentada, luego la más reciente).
- Presentadas: estados *presentada, adjudicada, no adjudicada*. Borradores, listas y descartadas no cuentan. Si el detalle
  oficial muestra que BFK no figura entre las ofertas, queda «BFK no figura entre las ofertas» y no se cuenta.
- Fecha de presentación: primera versión guardada en estado presentado (hora de Chile); si no hay versiones, la fecha de
  la cotización.
- Resultado: cotización adjudicada → ganada; no adjudicada → perdida; si no, el resultado oficial verificado; si no,
  pendiente. **Nunca** cambia el estado de la cotización ni crea OCs: si ChileCompra difiere, se muestra un aviso.
- Tasa = ganadas / (ganadas + perdidas) × 100. Pendientes, desiertas y canceladas no son pérdidas.
- Comparación: solo perdidas con adjudicatario y monto conocidos, en CLP y con la **misma base tributaria** (afecta/afecta
  o exenta/exenta). Se compara el total a pagar por el comprador (BFK: neto + IVA, despacho incluido en los unitarios;
  adjudicado: neto + impuesto + despacho). Nunca se usa el presupuesto del comprador. No se asume que se perdió por precio.

## Archivos
| Archivo | Qué es |
|---|---|
| `src/lib/inteligenciaComercial.js` | Reglas, normalización de la respuesta oficial, resumen, exportación |
| `src/lib/inteligenciaDatos.js` | Lectura (RPC o cálculo local sin migración), caché 60 s, cancelación, sincronización por rondas |
| `src/components/inteligencia/InteligenciaComercial.jsx`, `Graficos.jsx` | Interfaz (carga diferida) |
| `src/components/panels/PanelDashboard.jsx`, `src/App.jsx` | Desplegable al final del Panel (+ token de sesión) |
| `api/inteligencia.mjs`, `vercel.json` | Sincronización en el servidor (60 s, gru1) |
| `docs/migraciones/BORRADOR-2026-11-04-inteligencia-comercial.sql` (+ `-deshacer.sql`) | Migración |

## Sincronización (`/api/inteligencia`, solo administradores)
Consulta **solo** los códigos BFK pendientes (`ic_pendientes_sincronizar`, máx. 40 por llamada): listado oficial por id
y, si hay proveedor seleccionado, el detalle (cotizaciones recibidas). Hasta 3 consultas simultáneas, iniciadas con
350 ms de separación (< 3/s), un reintento ante fallas transitorias, detención ante 429 o ticket rechazado, plazo de
48 s por llamada; el navegador repite rondas (máx. 30). En la base: espera creciente por código (15 min → 24 h; 429 ≥ 1 h),
pendientes cada 6 h, finales no se vuelven a consultar salvo forzado. Una falla nunca borra lo verificado. Automática:
al abrir el módulo un administrador, si la última sincronización tiene más de 12 h (una vez por sesión). No hay tarea
programada en servidor: requeriría credenciales nuevas de escritura (no autorizadas).

## Limitaciones reales de la API de ChileCompra (Compra Ágil v2, Beta)
- El **listado** (`/v2/compra-agil?id=`) entrega estado (publicada, cerrada, proveedor_seleccionado, desierta, cancelada),
  n.º de ofertas, motivos y fecha del último cambio; **no** entrega adjudicatario ni montos.
- El **detalle** (`/v2/compra-agil/{código}`) entrega `proveedores_cotizando[]` (RUT, razón social, neto, impuesto,
  despacho, total, `proveedor_seleccionado`) e `id_orden_compra`, pero responde lento (12–20 s) y con **504 frecuentes**
  (ya observado en `api/compra-agil.mjs`). Sin detalle, el resultado queda «pendiente de verificar».
- No hay **fecha de adjudicación** explícita: se guarda `fecha_ultimo_cambio` (o `fecha_cancelacion`) indicando la fuente.
- No informa la moneda por cotización (se toma la del proceso) ni si el despacho es neto o bruto: se compara el total.
- `id_orden_compra` es un número interno; el código de la OC suele venir vacío.
- Cuota de 10.000 consultas/día por ticket (compartida con el resto de BFK); 429 sobre ~4 consultas/s.
- Compra Ágil no está en la API OCDS de ChileCompra. No se usa scraping.
- Referencia de campos: guía oficial v2 (resumida en «Guía de Uso de la API de Mercado Público», soykoda.cloud, v3.0 mayo
  2026) y comportamiento observado. Debe confirmarse con la primera sincronización real.

## Datos de octubre de 2026 (copia restaurada de `bfk-20261103T1419Z`, solo conteos)
485 cotizaciones (446 de octubre, 39 de noviembre; ninguna anterior a octubre): 480 presentadas, 1 adjudicada,
4 borradores. Las 481 presentadas/adjudicadas tienen código COT y fecha de presentación en sus versiones; 2 códigos se
repiten → **479 oportunidades**. Hoy: 1 ganada, 0 perdidas, 478 pendientes (aún sin resultados de ChileCompra: se obtienen
con la primera sincronización, ~12 rondas). No se reconstruye ninguna cotización histórica.

## Pruebas
```
node docs/pruebas-inteligencia/reglas.test.mjs                     # reglas + sincronización simulada (68)
bash docs/pruebas-inteligencia/validar_sql.sh                      # migración en PostgreSQL desechable (73) + SQL = JS (26)
npx vite build --outDir /tmp/dist && npx vite preview --outDir /tmp/dist --port 4302
node docs/pruebas-inteligencia/e2e_inteligencia.mjs http://127.0.0.1:4302/   # interfaz escritorio y celular (94)
bash docs/pruebas-inteligencia/regresion.sh rama http://127.0.0.1:4302/ /tmp/reg-rama.tsv   # todas las suites
python3 docs/pruebas-inteligencia/comparar_regresion.py /tmp/reg-main.tsv /tmp/reg-rama.tsv
```
Ensayo en copia restaurada del último respaldo: rama temporal `ensayo-inteligencia-temporal` de `bfk-respaldos`
(instalar, leer como administrador, rechazo sin perfil, escritura de prueba, huellas idénticas, deshacer, reinstalar).

## Para publicar (requiere autorización expresa de Kevin)
1. Respaldo cifrado nuevo con restauración verificada.
2. Instalar la migración en producción en una transacción (mismo procedimiento ensayado; `MIGRACION_DB_URL` temporal).
3. `git push origin <commit>:main` (push normal) → Vercel publica; verificar `/api/inteligencia` 401 sin sesión y en gru1.
4. Kevin (administrador): abrir Inteligencia Comercial y pulsar «Actualizar resultados» (primera sincronización).
Reversión: `git revert` del commit en main; `BORRADOR-2026-11-04-inteligencia-comercial-deshacer.sql` (solo objetos ic_).
Sin migración instalada la interfaz funciona en modo local (solo estados de las cotizaciones).

---

# Corrección de la sincronización y criterio de fecha (05/11/2026)

**Estado: desarrollada y probada en local y en una copia restaurada (rama `correccion-inteligencia-sync`). NO publicada.
Migración preparada, NO aplicada en producción.** Diagnóstico de origen: `bfk-respaldos`, rama
`diagnostico-inteligencia-temporal`, `docs/registro-operaciones/diagnostico-inteligencia-temporal/EVIDENCIA.md`.

## Qué cambia
| | Antes | Ahora |
|---|---|---|
| HTTP 429 de ChileCompra | Detenía toda la sincronización («límite alcanzado») | Restricción temporal: espera y reintenta la misma consulta (2, 5, 10 s o `Retry-After`), baja el ritmo (×2, máx. 8 s) y, si insiste, pausa sugerida de 30 s y **continúa** |
| Ritmo | 3 simultáneas, una cada 350 ms (hasta ~1,7/s) | 2 simultáneas, una cada 1,2 s (≈ 50/min), adaptativo (no es un límite oficial) |
| Detalle «sin tiempo» / 429 / demora | Guardado «sin información», espera 30 min × 2ⁿ (máx. 24 h) | «Sin tiempo»: de inmediato; 429/demora/error: 1, 2, 4 … min (máx. 1 h); los por verificar van primero |
| Navegador | Se detenía al primer 429 o error; máx. 30 rondas | Continúa tras pausas, espera reintentos próximos, cancelar/reanudar, topes (rondas, tiempo, pausas, sin avance) |
| Mensajes | «N revisados, N con resultado nuevo» | Revisadas · ganadas · perdidas · en proceso · desiertas/canceladas · por verificar · sin respuesta; lo que queda |
| Indicadores | Pendientes sin desglose; un aviso mezclado | Pendientes: sin consultar · en proceso · por verificar; «indicadores parciales»; ganadas sin regularizar aparte |
| Fecha | Solo presentación | Presentación o adjudicación (fecha informada por ChileCompra), sin mezclar |
| Estados (F) | id 5 = desierta, 6 = cancelada (no usado: el texto manda) | 6 = desierta (observado); cancelada según lo observado; un id no observado no se adivina |

## Archivos
| Archivo | Cambio |
|---|---|
| `api/inteligencia.mjs` | 429 con reintentos y ritmo adaptativo; pausa sugerida; `reintento_detalle`; conteo y ganadas nuevas; estado de la cola; `crearManejador` (dependencias reemplazables en pruebas) |
| `src/lib/inteligenciaDatos.js` | Funciones v2 con respaldo a v1 y a modo local; ciclo de sincronización con pausas, cancelación y topes; control único por pestaña |
| `src/lib/inteligenciaComercial.js` | Fecha de adjudicación, criterio, indicadores de cobertura y de avisos, exportación con criterio, estados (F) |
| `src/lib/inteligenciaMensajes.js` (nuevo) | Textos del avance y del resultado |
| `src/components/inteligencia/InteligenciaComercial.jsx`, `Graficos.jsx` | Selector «Fecha según», avance con pausa y «Cancelar», avisos separados, indicadores por criterio |
| `docs/migraciones/BORRADOR-2026-11-05-inteligencia-sincronizacion.sql` (+ `-deshacer.sql`) | Solo funciones (ver encabezado). Sin cambios de tablas ni de filas |

## Pruebas
```
node docs/pruebas-inteligencia/reglas.test.mjs                 # reglas, 429, ritmo, manejador HTTP, criterio, mensajes
node docs/pruebas-inteligencia/sincronizacion.test.mjs         # ciclo del navegador con el servidor real (simulado)
bash docs/pruebas-inteligencia/validar_sql.sh                  # migración del 04/11 (sin cambios)
bash docs/pruebas-inteligencia/validar_sql_sincronizacion.sh   # migración del 05/11 + SQL = JS con ambos criterios
node docs/pruebas-inteligencia/e2e_inteligencia.mjs http://127.0.0.1:4302/   # interfaz escritorio y celular
```
Ensayo real (copia restaurada del respaldo nuevo + ChileCompra real, solo lectura): `bfk-respaldos`, rama
`correccion-inteligencia-temporal`.

## Publicación (requiere autorización expresa de Kevin) y reversión
1. Respaldo cifrado nuevo, verificado (SHA-256, descifrado, restauración).
2. Migración `BORRADOR-2026-11-05-inteligencia-sincronizacion.sql` en una transacción (no cambia filas).
3. Push normal del commit a `main` → Vercel; verificar READY.
4. Kevin pulsa «Actualizar resultados» con el panel abierto (≈ 15 min la primera vez; se puede cancelar y reanudar).

El orden 2 ↔ 3 es indiferente: la app nueva funciona con la base sin la corrección (usa las funciones del 04/11) y la
app publicada hoy funciona con la base corregida (sus funciones no cambian).
**Reversión**: app → `git revert` del commit (o «Instant Rollback» al despliegue anterior en Vercel); base →
`BORRADOR-2026-11-05-inteligencia-sincronizacion-deshacer.sql` en una transacción (restaura exactamente las dos funciones
del 04/11, elimina las cuatro nuevas, conserva todos los resultados). Debe ir antes de un eventual deshacer del 04/11
(este falla mientras exista la corrección: protección intencional). Ningún dato se pierde en la reversión.
