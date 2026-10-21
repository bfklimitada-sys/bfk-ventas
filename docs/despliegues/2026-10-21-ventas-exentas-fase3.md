# Despliegue 2 — Ventas exentas fase 3 (21/10/2026, después de publicar y validar contactos)

- Respaldo previo (posterior al despliegue 1): bfk-20261021T0244Z (79 tablas, restauración OK).
- Ensayo en copia restaurada: guardas instaladas con huellas idénticas; 16/16 pruebas (DTE 33/34, NC y refacturación,
  cotizaciones); 9/9 pruebas de producción con ROLLBACK; API 9/9 y contactos 13/13 con las guardas; huella financiera
  igual; deshacer sin rastro (bfk-respaldos run 39534977577).
- Migración aplicada (REPEATABLE READ, COMMIT con huellas idénticas): `BORRADOR-2026-10-20-fase3-guardas-exentas.sql`
  (sha256 317c8932…). Reversión: `...-deshacer.sql` (5bc0b26a…).
- Producción: 2 funciones trib3_*, 2 disparadores trib_v_*; la clasificación exenta exige fundamento y respaldo;
  0 OC/cotizaciones clasificadas, 0 clasificaciones, 0 DTE 34 antes y después (ninguna OC histórica clasificada
  automáticamente). 9/9 rechazos de las guardas en sesiones independientes con ROLLBACK (no se registró ninguna
  factura); contactos 10/10 y API 9/9 con las guardas; sin registros sintéticos.
- Huella financiera antes y después: 671b0cb7189c383cbe6da490d7ab263e (idéntica).
- Integración: merge de `fase3-exentas` sobre `main` (con contactos) sin conflictos; los archivos de contactos no cambian.
  Pruebas conjuntas: 49 OK (incluye contactos 41/41, exentas, cotizaciones 19/19 con 3.000 afectas idénticas a 0bbca75);
  2 fallas conocidas que también fallan en main 0bbca75 (fase 4B B13 e índice móvil de compras).
