# Proyectos Industriales — interfaz y pruebas de interfaz

Estado: **reconstrucción local, no publicada.** La migración `docs/migraciones/BORRADOR-2026-10-22-proyectos-industriales.sql`
(recuperada desde bfk-respaldos, sin cambios) **no está instalada en producción** y su instalación no está autorizada.
Mientras no se instale, la pantalla muestra «Proyectos Industriales aún no está activado» y no ofrece ninguna acción.

## Origen

El módulo original (commits a0a655b, 4ec1d68, 4dc31d8, 70a0c3e y cedd2de) se perdió junto con su rama local.
De bfk-respaldos se recuperaron, byte a byte, la migración (sha256 `787f2f78…`), su reversión (`5ba45407…`), el script
de Storage (`aad3f78d…`) y las pruebas SQL (`docs/migraciones/pruebas/proyectos/`). La interfaz React y estas pruebas se
reconstruyeron a partir de la migración y de los dos informes de especificación:
«BFK Datos — Proyectos Industriales: informe de la primera etapa» y
«Proyectos Industriales — Revisión previa a activación: resultados».

## Archivos

| Archivo | Contenido |
|---|---|
| `src/lib/proyectos.js` | Reglas puras: listas (iguales a los CHECK del SQL), transiciones (iguales a `pi_transicion_valida`), permisos de pantalla, RUT (igual a `pi_rut_normalizado`), montos en formato chileno, atrasos, indicadores, filtros, EDT, historial y mensajes de error. |
| `src/lib/proyectosDatos.js` | Acceso a PostgREST y al depósito privado `pi-documentos`. Escrituras con versión (`version=eq.N`): si la fila cambió, avisa «otra persona modificó…» y no pisa el cambio. Subida de documentos con `x-upsert: false` y SHA-256; la descarga verifica la huella. |
| `src/components/proyectos/` | `PanelProyectos` (indicadores, filtros, tarjetas, enlace directo `#/proyectos/PI-AAAA-NNN`), `FichaProyecto` (resumen, acciones de estado, presupuesto), pestañas Actividades (EDT), Entregables (hitos y entregables), Documentos, Equipo e Historial; `FormProyecto` y `Comunes`. |
| `src/lib/navegacion.js`, `src/App.jsx`, `Iconos.jsx` | Nueva pantalla «Proyectos Industriales» (grupo propio, ícono 🏭) y enlace directo a la ficha. |

La pantalla solo lee y escribe tablas `pi_*` (y lee `perfiles` para mostrar nombres). No toca Mercado Público, FIFO,
IVA, F29, comisiones ni conciliación. Los permisos reales los decide la base (RLS, disparadores y funciones de la
migración); la interfaz solo oculta lo que el usuario no puede hacer.

## Pruebas

```bash
# Requisitos: PostgreSQL local (PGHOST/PGPORT con superusuario postgres), postgrest 12 (POSTGREST=ruta),
#             Chromium (CHROME=ruta), npm install y playwright-core en NODE_PATH.
bash docs/pruebas-proyectos/ejecutar.sh
```

* `reglas.test.mjs` — 105 comprobaciones: listas, transiciones, permisos de pantalla, acciones, RUT, formatos y vista
  resumen, comparadas con el texto del SQL y, con `PI_DB_URL`, con las funciones reales de una base desechable.
* `e2e_proyectos.mjs` — 97 comprobaciones en navegador real (PC 1440 px y celular 390 px), cinco usuarios ficticios
  (administrador, jefa, ingeniero, visitante y usuario ajeno) contra **PostgREST real** sobre una base desechable con la
  migración instalada sin superusuario: navegación, aislamiento por equipo, enlace directo, propuestas y autorización,
  presupuesto y datos económicos reservados, EDT, hitos y entregables, documentos (deshabilitados al instalar, versiones,
  descarga con verificación, anulación), lector en celular, edición simultánea, cierre y solo lectura, rechazo con motivo y
  restauración, historial, Mercado Público intacto y la pantalla sin la migración instalada.
* `entorno.sh` crea la base desechable (réplica + base Supabase de prueba + migración + `semilla.sql` con datos
  ficticios) y levanta PostgREST; `arnes_pi.mjs` firma un JWT por usuario y emula el depósito `pi-documentos` sobre
  `storage.objects` con la sesión del usuario (deciden las políticas `pi_storage_*`).

Nada de esto se conecta a producción.

## Compatibilidad con la Fase 1 (seguridad perfil BFK)

* Orden obligatorio: **Fase 1 primero.** La migración de la Fase 1 comprueba la huella de todas las políticas de
  `public`; si el módulo estuviera instalado antes, se detendría sin aplicar nada.
* Reversión: con el módulo instalado, la reversión de la Fase 1 se detiene sola (sin cambios). Para revertir ambas:
  primero el módulo (`…-proyectos-industriales-deshacer.sql`), después la Fase 1.
* Cuenta de respaldo documental: con la Fase 1, se crea marcada como aislada
  (`auth.users.raw_app_meta_data.bfk_tipo = 'respaldo_documentos'`), no recibe perfil y no ve datos de Mercado Público;
  se registra en `pi_cuentas_respaldo`. Ya no corresponde el paso anterior de «borrar su perfil automático».
