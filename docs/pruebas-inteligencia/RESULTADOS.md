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
