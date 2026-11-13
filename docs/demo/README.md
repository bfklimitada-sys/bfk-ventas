# Demostración aislada de BFK Ventas (12/11/2026)

Dos formatos, con el mismo código y los mismos datos:
- **Un solo archivo** (`dist-archivo/BFK-Ventas-demo.zip` → `BFK-Ventas-demo.html` + `LEEME.txt`): se abre con doble clic en un
  computador, sin servidor, sin sesión y sin internet (código, base y fuentes van dentro, ≈ 27 MB). Diálogos y descargas son los
  del navegador, como en la app real. Para compartirla fuera de Claude.
- **Alojada en Claude** (`dist/`): requiere iniciar sesión en Claude; ahí diálogos y descargas se resuelven dentro de la página.

Una copia de la app de la rama `orden-visual` que funciona **sin servidor y sin conexión con la base real**, para revisar las
pantallas y probar sus acciones con datos ficticios. No es la app publicada: se compila aparte con `docs/demo/vite.config.mjs`;
la compilación de producción (`vite.config.js` de la raíz) no cambia.

## Cómo está aislada

- La dirección de Supabase y su clave se reemplazan al compilar por `https://base-demo.invalid` (un dominio que no existe) y
  la palabra `demo`. `construir.sh` falla si el resultado contiene una dirección `supabase.co`.
- `entrada.js` reemplaza `window.fetch` antes de cargar la app: toda solicitud a la base, al depósito de archivos, a la sesión
  o a `/api/*` se responde dentro de la página (`servidor.js`). Cualquier otra dirección externa se rechaza y se registra.
- **Mercado Público, Finanzas y el resto de BFK**: el simulador con estado de las pruebas (`docs/pruebas-oc/mock_estado.mjs`),
  con los datos de `datos_mp.mjs` (todas las etapas de una OC, gastos, vale vista, financiamiento). La consulta a Mercado Público
  responde con OCs de ejemplo: `4005-5-SE26` y `3001-1-SE26` existen; `4001-1-SE26` no; `4002-2-SE26` simula una caída.
- **Ventas privadas, Proyectos, Cotizaciones, perfiles y catálogos**: PostgreSQL real compilado para el navegador (PGlite),
  cargado con las migraciones, funciones, permisos (RLS) y datos ficticios de las pruebas (`generado/base.sql`), atendido por el
  mismo núcleo que usan las pruebas (`pgrest_nucleo.mjs`). Pagos, ventas, cotizaciones y proyectos pasan por las funciones reales.
- Usuario: «Administrador Demo». Vendedores, financiadores y usuarios tienen nombres ficticios (`ajustes_demo.sql`).
- Todo vive en la memoria de la pestaña: **al recargar, la demostración vuelve a su estado inicial**.

## Limitaciones propias de la demostración

En el archivo único: la vista previa de archivos de un teléfono no ejecuta la app (hay que abrirla en un computador o subirla a un
sitio de páginas estáticas); probado en Chrome/Chromium, no en Safari ni Firefox.

En la versión alojada en Claude:

- El alojamiento no permite descargas, impresión ni ventanas emergentes del navegador. Los PDF generados (ficha de OC,
  cotización, EETT) se muestran en un visor dentro de la página; Excel y otros archivos solo avisan que se generaron.
- Las confirmaciones del navegador («¿Seguro que…?») se aceptan solas y se avisa en pantalla; las preguntas con texto se
  responden con «Motivo de demostración».
- Correos, el SII, la cartola del banco por servicio externo y la sincronización con Mercado Público no salen de la página:
  responden «no disponible en la demostración».
- La primera carga descarga unos 20 MB (la base de Ventas privadas y Proyectos) y tarda unos segundos en iniciar.

## Construir y probar

```bash
export PGHOST=/var/tmp/pgl PGPORT=5499 POSTGREST=…   # base desechable local, como en docs/pruebas-orden-visual/entorno.sh
bash docs/demo/construir.sh                           # genera la base ficticia y compila en docs/demo/dist
npx vite preview --config docs/demo/vite.config.mjs --outDir docs/demo/dist --port 4190
node docs/demo/prueba_demo.mjs http://127.0.0.1:4190/ /tmp/capturas   # computador, tableta y celular
node docs/demo/prueba_demo.mjs file:///…/docs/demo/dist-archivo/BFK-Ventas-demo.html   # el archivo único, sin servidor
node docs/pruebas-orden-visual/tableta.mjs http://127.0.0.1:4190/ /tmp/tableta
```

`prueba_demo.mjs` bloquea toda solicitud que salga del equipo (salvo fuentes y la biblioteca de gráficos, como la app real) y
comprueba que la página no intentó llegar a ningún servidor de datos.
