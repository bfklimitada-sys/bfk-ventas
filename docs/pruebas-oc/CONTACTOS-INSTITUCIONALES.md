# Contactos institucionales (Desarrollo B) — preparado y probado, NO publicado

Estado: rama local `contactos-institucionales` (desde `main` 0bbca75). Migración en borrador, **no aplicada** en producción.

## Diagnóstico inicial (producción, solo lectura, 20/10/2026)
- `entidades_catalogo`: 1 contacto y 1 correo por RUT (204 entidades, 73 con correo). La RPC `registrar_entidad_desde_oc`
  **sobrescribía** contacto y correo con los de cada OC nueva (gana la última OC; se perdía lo escrito a mano).
- Resincronizar una OC desde la ficha reemplazaba el contacto escrito en la OC por el de Mercado Público.
- `contactos_cobranza`: correos de reclamos, separados (52 filas, 1 correo repetido por mayúsculas, 2 RUT con varios correos).
- OC: 102 con correo, 5 RUT con varios correos en distintas OC, 32 OC cuyo correo difiere del catálogo, 1 OC con varios correos en el campo.
- `cargo_contacto` de Mercado Público no se guardaba. No existían historial de correos, pendientes ni varios contactos por institución.

## Qué se agregó
- Tablas `contactos_institucionales` (por RUT validado; estado vigente / pendiente / obsoleto; origen; confirmado manual;
  principal; exclusivo de una OC), `contactos_institucionales_oc` (qué OC respaldó cada contacto) y
  `contactos_institucionales_historial` (bitácora inalterable, por disparador).
- RPC: `conciliar_contactos_oc`, `guardar_contacto_institucional`, `resolver_contacto_pendiente`, `marcar_contacto_obsoleto`.
- `registrar_entidad_desde_oc`: contacto y correo del catálogo solo se completan si están vacíos (reversible).
- App: bloque «Contactos de la institución» en Información OC (PC y celular), selector para reutilizar un contacto en los
  correos (reclamo, entrega fallida, fecha de entrega), tarjeta en Administración → Datos, hojas nuevas en el Excel de respaldo.

## Reglas (resumen)
- Prioridad: confirmado manualmente > Mercado Público > registrado en OC > carga inicial / cobranza > pendiente. Obsoleto nunca se usa.
- Mismo correo en la misma institución = mismo contacto (sin distinguir mayúsculas); resincronizar no duplica ni ensucia la bitácora.
- Correo nuevo de la MISMA persona → pendiente (candidato), nunca reemplazo automático; contra uno confirmado → aviso de conflicto.
- Otra persona → contacto adicional. Sin nombre y con contactos previos → pendiente de verificación.
- Confirmar el reemplazo deja el anterior OBSOLETO (con motivo, fecha, usuario y OC); una OC con ese correo no lo revive.
- El contacto que vino en cada OC no se modifica nunca (`ordenes_compra_v2` intacta).
- Solo lectura con RLS para usuarios con perfil; toda escritura por RPC; nada se borra (ni el dueño de la base).

## Pruebas
- SQL, 66 casos en sesiones independientes: `docs/migraciones/pruebas/contactos/` (`ejecutar.sh`), local y en copia restaurada.
- Unitarias: `docs/pruebas-contactos/` (18). Interfaz contra la base real desechable: `docs/pruebas-oc/e2e_contactos.mjs` (36).
