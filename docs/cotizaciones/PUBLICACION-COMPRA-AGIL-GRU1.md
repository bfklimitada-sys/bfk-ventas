# Publicación: Compra Ágil automática + funciones en São Paulo (gru1)

Preparado el 13/10/2026. **No ejecutado**: requiere autorización de Kevin.

## Qué cambia
| Cambio | Detalle |
|---|---|
| `vercel.json` | `"regions": ["gru1"]` para **todas** las funciones (Vercel Hobby admite una sola región). Sin `ignoreCommand` (solo existe en la rama de vista previa). |
| `api/compra-agil.mjs` | Consulta el **listado oficial** `GET /v2/compra-agil?id=<código>` (paginación predeterminada) y exige `payload.items`. Autocompleta solo cabecera; dirección, plazo, productos y documentos quedan manuales. Diagnóstico solo para administradores. |
| Cotizaciones | Eliminación de cotizaciones sin código ni nombre con el identificador interno corto; fechas de Compra Ágil en hora de Chile. |
| Supabase | Migración **v3** (`BORRADOR-2026-10-cotizaciones-v3-eliminar.sql`): solo reemplaza `cz_eliminar_cotizacion`. Sin cambios de tablas ni datos. Validada localmente (`validar_sql_v3.sh`). |
| Variables | `MP_TICKET` de Production ya existe y fue aceptado por ChileCompra desde gru1. No se crean credenciales. La variable de Preview limitada a la rama de prueba puede quedar o eliminarse. |

## Procedimiento (mismo esquema que la v2)
1. Respaldo cifrado nuevo (`respaldo.yml`) con su prueba de restauración.
2. Rama temporal en `bfk-respaldos`: restaurar ese respaldo en base desechable → aplicar v3 con huella (todo lo existente y los datos del módulo idénticos) → pruebas con ROLLBACK → deshacer → reaplicar.
3. Producción: guardia (commit, sha256 del SQL, respaldo) → preflight → ensayo con ROLLBACK → instalar en una transacción (COMMIT solo si nada existente cambia) → verificación → pruebas con ROLLBACK.
4. Integrar `compra-agil-region` en `main` con push normal (sin `--force`); Vercel publica.
5. Verificación solo lectura: `x-vercel-id` de `/api/oc` y `/api/compra-agil` termina en `gru1`; ambas exigen sesión (401 sin ella); bundle publicado; huella de las tablas fuera del módulo igual al respaldo.
6. Kevin (sesión admin): consultar una Compra Ágil (autocompleta cabecera, sin guardar) y una OC existente en Compras.

## Reversión
- Código y región: `git revert` del merge en `main` (push normal) → vuelve a iad1 y a la consulta anterior. Producción previa: `974f96e`.
- Supabase: `BORRADOR-2026-10-cotizaciones-v3-eliminar-deshacer.sql` (restaura exactamente la función v2).
- Ninguna reversión toca OC, finanzas, cotizaciones ni la biblioteca.

## Impacto de gru1
- La app (navegador) habla directo con Supabase: sin cambios para OC, finanzas, cotizaciones.
- Cada función valida la sesión contra Supabase (EE. UU., Ohio): ~0,5–0,8 s adicionales por llamada desde São Paulo.
- `/api/oc` (Mercado Público v1, en Google con balanceo global): sin pérdida esperada; a confirmar con la prueba 4 de la vista previa.
- `/api/producto`: tiendas chilenas más cerca; ya está fuera del flujo principal.
- `/api/interpretar`: inactiva (sin clave).
- Hora del servidor: las funciones corren en UTC en cualquier región; no hay cálculos dependientes de la región.
