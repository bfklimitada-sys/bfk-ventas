# Ensayo de la migración «perfil BFK obligatorio» (solo en copia restaurada)

Herramientas del ensayo de `BORRADOR-2026-10-23-seguridad-perfil-bfk.sql`, copiadas sin cambios de `bfk-respaldos`
(rama `seguridad-mp-temporal`, carpeta `seg/`, commit `8a6479c`), donde se ejecutan con GitHub Actions sobre una base
desechable restaurada del respaldo cifrado. A producción solo se le lee el catálogo en transacción de solo lectura.

- `ejecutar_copia.sh` — ensayo original: matriz SQL y REST antes/después, suites financieras, huellas, reversión.
  Su paso 3 generaba la migración con `generar.py` a partir del catálogo de producción.
- `ejecutar_copia_ui.sh` — repetición del 24/10/2026: instala el archivo recuperado (SHA-256 verificado), comprueba que
  regenerarlo da el mismo archivo y prueba la interfaz contra PostgREST (`docs/pruebas-seguridad/e2e_compat_postgrest.mjs`).
- `matriz.sql`, `rest.mjs`, `comparar.py`, `huella_*.sql`, `muestra*.sql`, `acl_catalogo.sql`, `catalogo*.sql` — piezas
  del ensayo. `cabecera_*`/`pie_*` y `generar.py` — generador de la migración y su reversión.

Las rutas relativas (`$D/../catalogo/…`) corresponden a la estructura de `bfk-respaldos`.
