# Resultados de las pruebas — Inteligencia Comercial (04/11/2026)

| Prueba | Resultado |
|---|---|
| `reglas.test.mjs` (reglas, normalización, sincronización simulada: reintentos, 429, ticket, plazo, concurrencia) | 68/68 |
| `validar_sql.sh` (migración en PostgreSQL 16 desechable: RLS, permisos, escritura, historial, rendimiento, integridad, reversión) | 73/73 |
| `sql_vs_js.mjs` (vista y funciones SQL = lógica JavaScript: 18 oportunidades, 15 combinaciones de filtros, 9 de detalle) | 26/26 |
| `e2e_inteligencia.mjs` (interfaz escritorio 1280 px y celular 390 px) | 94/94 |
| Ensayo en copia restaurada del respaldo `bfk-20261103T1419Z` (bfk-respaldos, run 41770280895) | 16/16 comprobaciones |
| Rendimiento: `ic_resumen` con 5.000 oportunidades (local) / datos reales (copia) | 250 ms / 55 ms |
| Panel: indicadores del módulo visibles tras abrirlo (incluye descarga del módulo) | ~1,1 s |

## Regresión main (`367254a`) vs rama (misma máquina, mismas suites)
```
Suites comparadas: 74 · idénticas: 74
Fallas PREEXISTENTES (iguales en main y en la rama): 11
  - docs/migraciones/pruebas/financiero/e2e_postgrest.mjs: salida 1, 0 fallas · Node.js v22.23.4
  - docs/pruebas-conciliacion/e2e_medios.mjs: salida 1, 0 fallas · Node.js v22.23.4
  - docs/pruebas-correos/e2e_correos.mjs: salida 1, 0 fallas · Node.js v22.23.4
  - docs/pruebas-financieras/e2e_fase4b.mjs: salida 1, 1 fallas · RESUMEN pruebas Fase 4B (interfaz): 63 OK, 1 FALLA(S) → B13_sin_excepcion
  - docs/pruebas-iva-unificado/e2e_ui.mjs: salida 1, 0 fallas · Node.js v22.23.4
  - docs/pruebas-oc/e2e_contactos.mjs: salida 1, 0 fallas · Node.js v22.23.4
  - docs/pruebas-proyectos/e2e_proyectos.mjs: salida 1, 0 fallas · Node.js v22.23.4
  - docs/pruebas-recuperacion/recuperacion.e2e.mjs: salida 1, 0 fallas · Node.js v22.23.4
  - docs/pruebas-seguridad/e2e_compat_postgrest.mjs: salida 1, 0 fallas · Node.js v22.23.4
  - docs/pruebas-sii/e2e_ficha.mjs: salida 1, 0 fallas · Node.js v22.23.4
  - docs/pruebas-ui-movil/e2e_compras_movil.mjs: salida 1, 2 fallas · 20 OK · 2 fallas
Fallas NUEVAS en la rama: 0
Solo en la rama (suites nuevas): docs/pruebas-inteligencia/e2e_inteligencia.mjs [salida 0, 94 OK, 0 fallas], docs/pruebas-inteligencia/reglas.test.mjs [salida 0, 68 OK, 0 fallas]
```
Las 11 fallas preexistentes son idénticas en main: suites que necesitan PostgREST/PostgreSQL o servicios propios en el
entorno (salen antes de probar) y las fallas ya documentadas e2e_fase4b B13 y e2e_compras_movil (2).

## Tamaño de la compilación
| | main | rama |
|---|---|---|
| `index` (carga inicial) | 1.630,04 kB (492,70 kB gzip) | 1.636,14 kB (494,69 kB gzip) |
| `InteligenciaComercial` (solo al abrir el desplegable) | — | 52,07 kB (17,01 kB gzip) |

---

# Resultados — corrección de la sincronización y criterio de fecha (05/11/2026)

| Prueba | Resultado |
|---|---|
| `reglas.test.mjs` (reglas, 429 con reintentos y ritmo, pausa, `Retry-After`, sin tiempo/demora/error, manejador HTTP, estados reales, criterio de fecha, cobertura, mensajes) | 115/115 |
| `sincronizacion.test.mjs` (ciclo del navegador + servidor real: pausas, cancelar, reanudar, topes, límite BFK, en curso, sin conexión) | 24/24 |
| `validar_sql.sh` (migración del 04/11 sin cambios; `sql_vs_js` en modo original 26/26) | 73/73 |
| `validar_sql_sincronizacion.sh` (migración del 05/11: ninguna fila cambia, permisos, cola, esperas, estado, reversión exacta; `sql_vs_js` v2 39/39) | 68/68 |
| `e2e_inteligencia.mjs` (escritorio 1280 px y celular 390 px: criterio, avance con pausa, cancelar, avisos, cobertura, base sin corrección) | 122/122 |

## Ensayo real (bfk-respaldos, rama `correccion-inteligencia-temporal`, run 41970535966)
Respaldo nuevo `bfk-20261105T0453Z` (SHA-256 OK, descifrado idéntico, restauración: 99 tablas iguales), restaurado en una
base desechable; ChileCompra real con el código nuevo completo (navegador → servidor → base), solo lectura, 54 códigos.
- Migración: instala en una transacción, **ninguna fila cambia** (todas las tablas, incluidas ic_), nada fuera del
  módulo cambia, `ic_resumen`/`ic_detalle` intactas; deshacer restaura exactamente las funciones (md5) y reinstala.
- Antes (octubre, como producción): 440 presentadas · 4 ganadas · 61 perdidas · 365 pendientes · 9 desiertas + 1 cancelada · 6,2 %.
- Sincronización normal: 4 rondas, 47 códigos, 85 consultas, **un 429 real de ChileCompra (detalle) manejado con un
  reintento a los 2 s, sin detener nada**; 0 «por verificar» al terminar; 151 s.
- Las **11 adjudicaciones faltantes recuperadas como ganadas** (monto BFK = monto de su OC): 1063796-37, 2042-356,
  696027-78, 550574-46, 4559-244, 4452-517, 2886-126, 551505-10, 3762-283, 3704-225, 2292-914 (+ 1346284-138 verificada).
- Reconsulta forzada a ritmo agresivo (3 simultáneas, 300 ms): 44 consultas, sin 429 en esa ventana; los 15 resultados
  finales reconsultados quedaron idénticos (0 cambios de resultado o adjudicatario). Estados reales: 2, 4, 5 = cancelada, 6 = desierta.
- Después (octubre, presentación): 439 · **15 ganadas** · 85 perdidas · 328 pendientes (293 sin consultar, 35 en
  proceso, 0 por verificar) · 10 desiertas · 1 cancelada · 1 sin oferta BFK · 15,0 % (parcial). Por adjudicación: 78
  resueltas · 14 ganadas · 60 perdidas · 18,9 %. Filtros (vendedor, institución, estado) correctos. ~60 ms por consulta.

## Regresión main (`6a2ef4d`) vs rama (misma máquina, mismas suites, 05/11/2026)
```
Suites comparadas: 76 · idénticas: 74
Fallas PREEXISTENTES (iguales en main y en la rama): 12
  - docs/migraciones/pruebas/financiero/e2e_postgrest.mjs: salida 1, 0 fallas · Node.js v22.23.4
  - docs/pruebas-conciliacion/e2e_medios.mjs: salida 1, 0 fallas · Node.js v22.23.4
  - docs/pruebas-correos/e2e_correos.mjs: salida 1, 0 fallas · Node.js v22.23.4
  - docs/pruebas-cotizaciones/exentas_fase3.test.mjs: salida 1, 0 fallas · Node.js v22.23.4
  - docs/pruebas-financieras/e2e_fase4b.mjs: salida 1, 1 fallas · RESUMEN pruebas Fase 4B (interfaz): 63 OK, 1 FALLA(S) → B13_sin_excepcion
  - docs/pruebas-iva-unificado/e2e_ui.mjs: salida 1, 0 fallas · Node.js v22.23.4
  - docs/pruebas-oc/e2e_contactos.mjs: salida 1, 0 fallas · Node.js v22.23.4
  - docs/pruebas-proyectos/e2e_proyectos.mjs: salida 1, 0 fallas · Node.js v22.23.4
  - docs/pruebas-recuperacion/recuperacion.e2e.mjs: salida 1, 0 fallas · Node.js v22.23.4
  - docs/pruebas-seguridad/e2e_compat_postgrest.mjs: salida 1, 0 fallas · Node.js v22.23.4
  - docs/pruebas-sii/e2e_ficha.mjs: salida 1, 0 fallas · Node.js v22.23.4
  - docs/pruebas-ui-movil/e2e_compras_movil.mjs: salida 1, 2 fallas · 20 OK · 2 fallas
Fallas NUEVAS en la rama: 0
Mejoran en la rama: docs/pruebas-inteligencia/e2e_inteligencia.mjs
Distinto conteo de OK sin fallas nuevas: docs/pruebas-inteligencia/reglas.test.mjs (68→115)
Solo en la rama (suites nuevas): docs/pruebas-inteligencia/sincronizacion.test.mjs [salida 0, 24 OK, 0 fallas]
```
Las 12 fallas preexistentes son idénticas en main (suites que necesitan PostgREST/PostgreSQL o servicios propios en el
entorno y las ya documentadas e2e_fase4b B13 y e2e_compras_movil). En main, `e2e_inteligencia` falla S01/S03 (90/94) por
depender de la fecha del día (corrección F); en la rama pasa 122/122.

| Compilación | main | rama |
|---|---|---|
| `index` (carga inicial) | 1.636,14 kB (494,69 kB gzip) | 1.636,14 kB (494,69 kB gzip) — sin cambios |
| `InteligenciaComercial` (solo al abrir el desplegable) | 52,07 kB (17,01 kB gzip) | 65,20 kB (21,09 kB gzip) |
