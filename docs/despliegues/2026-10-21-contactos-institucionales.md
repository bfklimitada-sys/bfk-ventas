# Despliegue 1 — Contactos institucionales (21/10/2026, autorizado por Kevin el 20/10/2026 23:35)

- Commit publicado en `main`: a07cf93 (push normal, avance rápido desde 0bbca75). Vercel: Production READY.
- Respaldo previo: bfk-20261021T0240Z (prueba de restauración OK; sin aplicar retención).
- Ensayo en copia restaurada de ese respaldo: 88/88 pruebas SQL en sesiones independientes, carga inicial idempotente,
  respaldo/restauración idéntico, deshacer sin rastro, API de OC 9/9, huella financiera igual (bfk-respaldos run 39534361651).
- Migraciones aplicadas (una transacción REPEATABLE READ, COMMIT con huellas idénticas):
  `BORRADOR-2026-10-21-contactos-institucionales.sql` (sha256 fa971559…) + `...-carga-inicial.sql` (ca1f8f7a…).
  Reversión preparada: `...-deshacer.sql` (46125827…).
- Producción: ensayo con ROLLBACK sin rastro; 3 tablas, 18 funciones, 3 políticas; anon sin acceso; usuarios solo lectura
  y RPC; 0 duplicados; 0 confirmados automáticamente; 283 contactos (274 vigentes, 9 pendientes) en 203 instituciones,
  296 vínculos con OC. 13/13 pruebas en sesiones independientes con ROLLBACK (crear, editar y sincronizar OC; protección de
  confirmados; duplicados; permisos; cobranza; persistencia); API 9/9; sin registros sintéticos.
- Huella financiera antes y después: 671b0cb7189c383cbe6da490d7ab263e (idéntica).
- Respaldo posterior: bfk-20261021T0244Z incluye contactos_institucionales (283), _oc (296), _historial (289);
  restauración de 79 tablas coincide.
- Pendientes administrativos: revisar los 9 contactos pendientes (no se confirmaron); validar el RUT de la OC
  1627-375-AG26 (su contacto se conserva solo en la OC).
