# Consumo de Supabase — fase 1 (15/11/2026)

Supabase restringió el proyecto por exceso de transferencia (`exceed_egress_quota`). La auditoría del 15/11/2026
(solo lectura) mostró que la app descargaba la base completa (≈ 2,69 MB) unas 229 veces al día: al renovar la sesión,
en cada regreso a la pestaña y después de cada guardado. Esta fase corrige eso **sin cambios en la base de datos**
(sin migraciones), sin tocar cálculos, reglas de negocio, permisos ni respaldos.

## Qué cambió

| # | Antes | Ahora |
|---|---|---|
| 1 | Cada renovación del token recargaba todo | Solo se relee el perfil propio (rol y autorización, ≈ 0,3 kB); si el rol cambió se recarga todo; si la cuenta fue desautorizada sale de la app, como antes |
| 2 | Cada regreso a la pestaña recargaba todo | Solo si pasaron 15 minutos desde la última carga; antes de eso solo se confirma el perfil propio (≈ 0,3 kB), así una cuenta desautorizada sigue saliendo al volver a la app. Botón «Actualizar datos» (barra lateral y menú «Más») |
| 3–4 | Cada guardado recargaba todo | 28 operaciones de una OC releen solo esa OC (eventos, productos, comentarios, reclamos, responsables, post-venta, seguimientos, foto MP) y lo que la base recalcula (deuda de financiadores, pagos sin OC, cartola y saldo cuando hay dinero), más notificaciones e historial nuevo. Tras la relectura se ejecuta el mismo cierre de comisiones pagadas que tras la carga completa |
| — | — | Las operaciones con efectos amplios **siguen con la recarga completa**: creación de OC, sincronización con Mercado Público, cartola y conciliación, abonos, gastos, aportes, IVA, pagos y anulación de pagos a vendedores, decisiones de comisión, roles, clasificación tributaria, archivar / restaurar / eliminar OC, datos generales de la OC |
| 5 | Enlaces de producto y contactos institucionales en cada carga | Los enlaces de 2.000 caracteres o más (hoy uno de 317 kB) se descargan al abrir su OC; mientras tanto el campo no se puede editar (no se puede borrar sin verlo). Los contactos institucionales se descargan la primera vez que algo los muestra (ficha de OC, correos, catálogo) |
| 6 | Correos: los últimos 30 días completos cada 5 minutos | Solo los nuevos o gestionados desde lo último que se tiene, cada 5 minutos y con la app visible |
| 7 | Cargas simultáneas o repetidas | Una sola carga completa a la vez (las pedidas mientras corre se juntan en una); efectos que dependían del token ahora dependen de la cuenta |
| — | Abrir una OC no leía nada | Abrir una OC relee esa OC (≈ 6–10 kB): se ven los cambios recientes de otros usuarios antes de editar |

Archivos: `src/App.jsx`, `src/lib/recargaParcial.js` (nuevo), `src/lib/supabase.jsx`, `src/components/panels/PanelCompras.jsx`,
`src/components/forms/CorregirCompra.jsx`, `src/components/ficha/ContactosInstitucion.jsx`, `src/components/ui/Navegacion.jsx`,
`src/components/ui/Iconos.jsx`; pruebas en `docs/pruebas-consumo/`; `docs/pruebas-oc/mock_estado.mjs` acepta valores entre
comillas en `in.(…)` (como PostgREST).

## Pruebas

- `node docs/pruebas-consumo/recarga.test.mjs` — funciones de la recarga parcial (20).
- `node docs/pruebas-consumo/e2e_consumo.mjs <url antes> <url después>` — mismos escenarios en ambas versiones con el volumen
  de producción (`datos_produccion.mjs`): apertura, renovación de sesión, cambio de pestaña repetido y tras 16 min, correos,
  abrir OC, pago a financiador, refacturación, cambio de vendedor, pago de cliente, un segundo usuario. Compara las pantallas
  de comisiones (incluidas liquidaciones cerradas), F29, financiamiento, banco y gastos entre versiones, y en la optimizada que
  el estado tras cada recarga parcial sea idéntico al de una carga completa.
- Todas las suites E2E existentes contra la versión optimizada (y la publicada como referencia).

## Reversión

No hay cambios en la base: revertir es volver a publicar la versión anterior.

1. Vercel → proyecto bfk-ventas → Deployments → la publicación de `8ea74b0` → «Promote to Production» (inmediato), **o**
2. `git revert <commit de esta fase>` en `main` y `git push` (Vercel publica solo).
3. Comprobar: el paquete servido vuelve a ser el de `8ea74b0`; ingreso, carga de datos y una OC abierta.

## Verificación tras publicar (con Supabase operativo)

Medir 24 h con las estadísticas de la base (solo lectura): los recorridos de `eventos_entrega` crecen en una unidad por OC en
cada carga completa, así que cargas completas por día ≈ Δ`seq_scan(eventos_entrega)` / número de OCs (referencia: 229/día).
Además, el egress diario del panel de uso de Supabase.
