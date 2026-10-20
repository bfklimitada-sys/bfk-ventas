# Plan de aplicación y reversión — Desarrollo A: ventas exentas fase 3

Independiente del Desarrollo B. Requiere la corrección de permisos de la fase 2 (ya aplicada el 20/10/2026).

## Condiciones para autorizar
1. Autorización expresa de Kevin para: guardas en producción y publicación de la app en `main`.
2. Respaldo cifrado nuevo del día, con prueba de restauración OK.
3. Ensayo conjunto en copia del respaldo más reciente en verde (16 pruebas de guardas + API 9/9).
4. Verificación de solo lectura el mismo día: 0 cotizaciones con impuestos = 0 y subtotal > 0 sin clasificación
   exenta (si aparece alguna, revisarla antes: la guarda impediría editar su precio sin clasificarla).

## Aplicación (en este orden)
1. Huellas previas (total y financiera).
2. Ensayo con ROLLBACK en producción de `BORRADOR-2026-10-20-fase3-guardas-exentas.sql`.
3. Instalación real en una transacción REPEATABLE READ (`instalar.sql`): COMMIT solo con huellas idénticas.
4. Verificación: 2 funciones trib3_*, 2 disparadores trib_v_*; prueba permanente de permisos de la API 9/9.
5. Publicar la app (`fase3-exentas` → `main`), confirmar Vercel READY.

Orden alternativo seguro: app primero (sin guardas, las reglas igual se aplican en la app) y guardas después.

## Reversión
- App: revertir el commit en `main`.
- Base: `...-fase3-guardas-exentas-deshacer.sql` (elimina solo los 2 disparadores y las 2 funciones; verificado sin
  rastro y huella idéntica). No toca facturas, cotizaciones, F29, costos, comisiones ni FIFO.
