# Plan de aplicación y reversión — Desarrollo B: contactos institucionales

Independiente del Desarrollo A (se puede publicar antes, después o sin él). No requiere las guardas de la fase 3.

## Condiciones para autorizar
1. Autorización expresa de Kevin para: migración + carga inicial en producción, y publicación de la app en `main`.
2. Respaldo cifrado nuevo del día, con prueba de restauración OK.
3. Ensayo conjunto en copia del respaldo más reciente en verde (bfk-respaldos `ensayo-contactos-temporal`).
4. Sin usuarios trabajando en OC durante la ventana (la carga inicial toma un bloqueo corto por institución).

## Aplicación (en este orden)
1. Huellas previas: huella total (`ci/pruebas/huella.sql`) y huella financiera (`trib/huella_financiera.sql`).
2. Ensayo con ROLLBACK en producción: migración + carga inicial dentro de una transacción que se revierte; verificar
   resultados y que ambas huellas no cambian.
3. Aplicación real en UNA transacción REPEATABLE READ: `BORRADOR-2026-10-21-contactos-institucionales.sql` +
   `...-carga-inicial.sql`; COMMIT solo si las dos huellas quedan idénticas (si no, ROLLBACK automático).
4. Verificación: 3 tablas, 18 funciones, 3 políticas, anon sin acceso, authenticated solo lectura; prueba permanente de
   permisos de la API 9/9 (crear y editar OC en conexiones independientes).
5. Actualizar en bfk-respaldos `trib/permisos_produccion.sql` (las restauraciones vienen sin permisos) para que las
   pruebas de restauración incluyan las tablas nuevas.
6. Publicar la app (`contactos-institucionales` → `main`), confirmar Vercel READY.
7. El administrador revisa los contactos pendientes desde Administración → Datos → Contactos institucionales.
   Nada se confirma automáticamente.

La app es compatible en ambos órdenes: sin la migración, el bloque de contactos simplemente no aparece.

## Reversión
- App: revertir el commit en `main` (la base puede quedar con la migración: no afecta a la versión anterior).
- Base: exportar las 3 tablas (Excel de respaldo, hojas Contactos*) y ejecutar
  `set bfk.ci_descartar = 'si';` + `...-deshacer.sql`. Restaura `registrar_entidad_desde_oc` exactamente como estaba
  (verificado por md5) y elimina solo lo nuevo. Sin la confirmación explícita, la reversión se detiene si hay datos.
- OC, catálogo, cobranza y datos financieros no se tocan en ningún paso.
