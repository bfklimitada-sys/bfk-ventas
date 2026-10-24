# Seguridad · Perfil BFK obligatorio (interfaz)

Reconstrucción de la interfaz de la rama perdida `seguridad-perfil-bfk` (commit `4476ca3`, nunca publicado) sobre la
migración recuperada sin cambios desde `bfk-respaldos`, rama `seguridad-mp-temporal`, commit `8a6479c`:

| Archivo | SHA-256 |
| --- | --- |
| `docs/migraciones/BORRADOR-2026-10-23-seguridad-perfil-bfk.sql` | `8fc00e7f01848c74e85a50c0a55b4f601e9d4799519812bae2defa7d0c579342` |
| `docs/migraciones/BORRADOR-2026-10-23-seguridad-perfil-bfk-deshacer.sql` | `51529111bfb26d9a3621da14fe374cab002a533ef67be7bedf48c5fd303d5c77` |

## Qué hace la interfaz

- **Cuenta por autorizar** (`src/components/auth/CuentaPorAutorizar.jsx`): toda cuenta con sesión y sin perfil BFK ve solo
  esta pantalla. La aplicación no se monta y no se pide ningún dato, cualquiera sea la dirección (`#/finanzas`,
  `#/administracion`…), el historial del navegador o el celular. Estados: por autorizar, cuenta aislada (`bfk_tipo`) y
  «no se pudo comprobar» (un error de red nunca abre la aplicación).
- **La app ya no crea perfiles**: se eliminó el alta automática en el inicio de sesión (antes: `usuario`, o `admin` si era
  la primera cuenta).
- **Administración → Usuarios** (`src/components/panels/AutorizacionCuentas.jsx`): lista `bfk_cuentas_por_autorizar()`,
  autoriza con `bfk_autorizar_cuenta(id, nombre, rol)` tras marcar una confirmación (la lista se lee por GET), muestra el registro
  `perfiles_autorizaciones`. Las cuentas aisladas se listan sin botón. Si la migración no está instalada, la sección lo
  informa y no ofrece acciones.
- **Gestión de roles**: igual que antes (PATCH de `perfiles.rol` por un administrador), con confirmación, sin permitir
  quitar el rol al único administrador y con el mensaje legible de la base si rechaza el cambio.
- **Desautorización en sesión**: en cada recarga de datos se relee el perfil propio; si ya no existe, la cuenta sale a la
  pantalla de acceso.

## Pruebas

- `e2e_cuentas.mjs` — 44 pruebas de interfaz (escritorio 1280×800 y celular 390×844) sobre una base simulada con el
  contrato de la migración (`mock_seguridad.mjs`), incluida la compatibilidad con producción SIN la migración (grupo D).
  Control negativo: contra la interfaz de `main` (fbc74e8) fallan 34 de 44.
  `node docs/pruebas-seguridad/e2e_cuentas.mjs http://127.0.0.1:4178/` (build servido con `vite preview`).
- `e2e_compat_postgrest.mjs` — la interfaz contra PostgREST real sobre una copia restaurada con la migración instalada
  (se ejecuta en el ensayo de `bfk-respaldos`; nunca contra producción).
