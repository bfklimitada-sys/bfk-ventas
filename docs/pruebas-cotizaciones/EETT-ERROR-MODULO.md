# EETT: «Failed to fetch dynamically imported module …/jspdf.es.min-DL85aqkw.js» (21/10/2026)

## Causa
- jsPDF se carga bajo demanda (`import("jspdf")` en `src/lib/eettPdf.js`). Vite lo publica como
  `assets/jspdf.es.min-<huella>.js`.
- Ese archivo importaba el archivo principal de la app (`index-<huella>.js`, por el ayudante de precarga de Vite). Por eso su
  nombre cambiaba en CADA publicación aunque jsPDF no cambiara (comprobado: 0bbca75, a07cf93 y e782a1a generan tres
  nombres distintos).
- El 21/10 hubo dos publicaciones seguidas (02:43 y ~03:05 UTC). Una pestaña abierta antes de la última sigue con el
  `index` anterior y pide el jsPDF con el nombre anterior; Vercel solo sirve los archivos de la publicación vigente →
  404 → el navegador informa «Failed to fetch dynamically imported module». No es caché del servidor (no hay service
  worker; `index.html` se revalida y los `assets` son inmutables): es la pestaña con la versión anterior.
- El navegador recuerda el fallo de ese módulo hasta recargar la página: reintentar sin recargar no sirve.
- La cotización 697036-78-COT26 no tiene relación con el error: ocurre con cualquier EETT en esa pestaña.

## Corrección (rama `correccion-eett-modulos`)
1. `vite.config.js`: los ayudantes internos de Vite van en un archivo propio (`vite-ayudantes-*.js`). Los módulos bajo
   demanda (jsPDF, html2canvas, DOMPurify, pdf.js) ya no dependen del archivo principal y conservan su nombre entre
   publicaciones (comprobado: los tres commits generan los mismos nombres). Una pestaña antigua sigue encontrándolos.
2. `src/lib/cargaModulos.js`: los `import()` de jsPDF, html2canvas, pdf.js y el lector de texto pasan por
   `importarModulo`, que reconoce el error (Chrome, Firefox y Safari) y lo convierte en un mensaje claro.
3. Aviso «Hay una versión nueva de BFK Datos» con botón **Actualizar BFK Datos** (también ante `vite:preloadError`).
   **Nunca recarga solo**; como máximo una recarga cada 5 minutos por pestaña. Si tras recargar sigue fallando, pide cerrar
   y volver a abrir (sin bucles).
4. Sin pérdida de datos: la vista previa no guarda nada y, si hay cambios sin guardar, el mensaje lo dice antes de
   actualizar. «Generar y descargar» guarda primero y, si la descarga falla, ofrece «Reintentar descarga» con los datos ya
   guardados. No se modifican cotizaciones, precios ni especificaciones.

## Pruebas
- `docs/pruebas-cotizaciones/e2e_eett_version_nueva.mjs` (PC 1280 px y celular 390 px): archivo de jsPDF de la
  versión anterior → error claro, aviso, sin recarga automática, sin guardar ni cambiar la cotización, descarga con
  reintento; UNA recarga controlada; segundo fallo sin bucle; con el archivo disponible, vista previa y descarga OK;
  precios y especificaciones intactos; cambios sin guardar avisados y conservados. 27/27.
- `docs/pruebas-cotizaciones/carga_modulos.test.mjs` 11/11; `pdf_eett.test.mjs` 20/20; batería completa (e2e de
  cotizaciones y EETT, advertencias de fichas, contactos, exentas).
