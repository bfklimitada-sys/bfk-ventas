# Documentación de la oferta (25/11/2026) — rama `cotizaciones-documentos`

Pedido: «Mejora integral del módulo de Cotizaciones y EETT — BFK Datos» + PDF de referencia de diseño entregados por Kevin
(`BFK_Ejemplo_Cotizacion.pdf`, `BFK_Ejemplo_EETT.pdf`, `BFK_Ejemplo_Oferta_Tecnica_Economica.pdf`). Sin publicar ni migrar en
producción sin su aprobación.

## Qué cambia

| Tema | Qué hace | Dónde |
|---|---|---|
| Tipografía | Título principal 16 negrita, título de cada producto 13 negrita (la barra crece si el nombre es largo), subtítulos 11 negrita, características 10 negrita, valores 10, pie 8 | `documentosOferta.js` |
| Generador único | Cotización económica, EETT y Oferta técnica y económica consolidada con el diseño de las referencias (A4, márgenes 9,9 mm, banda azul #355B85 con título y logo, barras #3E3E3E, filas de categoría #E8EEF5, líneas #CFD3D8, pie con línea y banda azul). Mismo generador para Mercado Público y Ventas privadas: solo cambian los datos | `src/lib/documentosOferta.js` |
| Fuente | Liberation Sans 2.1 (métricas idénticas a Arial, SIL OFL 1.1), incorporada al PDF; servida sin modificar desde `/fuentes/` con su licencia | `src/lib/fuentesDocumento.js`, `public/fuentes/` |
| Modelo público | Lista blanca: identificación, cliente, productos, precios de VENTA ya calculados por la app, totales, condiciones y matriz. Nunca costos, recargos, márgenes, proveedores, enlaces, despachos internos, financiamiento ni el texto original pegado | `src/lib/modeloOferta.js` |
| Interpretación de fichas | Antes de armar el documento se aplica la misma interpretación que ya usaban ambos canales (`normalizarFichaEETT`): pares «Etiqueta: valor» como características y textos sin valor como descripción técnica (cada texto en su fila) | `modeloOferta.js` |
| Texto técnico pegado | Pares en una o dos líneas, «:», tabulador, «\|», columnas; quita publicidad y datos comerciales; normaliza etiquetas y unidades (60hz → 60 Hz); conserva «No»; marca contradicciones e incompletos; agrupa en categorías dinámicas (sin categorías vacías); descripción breve solo con datos presentes; el original se guarda en la ficha | `src/lib/especificaciones.js`, `ProcesarTextoTecnico.jsx` |
| Paginación | Fichas completas comparten página si caben; si no, empiezan en página nueva; fotos se reducen (mín. 30 mm, sin deformar) antes de partir una ficha; títulos con al menos dos filas; sin filas huérfanas; «(continuación)»; encabezados de tabla repetidos; numeración «n / N» y versión en el pie; líneas idénticas → una ficha con la cantidad total | `documentosOferta.js` |
| Oferta consolidada | Cotización + condiciones + fichas + matriz, numeración continua; cada producto del detalle cita «Ficha técnica: pág. N» (dos pasadas) | `crearDocumentoOferta("oferta")` |
| Vista previa | El MISMO PDF (pdf.js): todas las páginas, navegación, zoom 50–200 %, avisos (faltantes, contradicciones, «Por verificar»), Volver a editar, Descargar PDF (sin emitir) y Emitir versión definitiva | `VisorDocumento.jsx` |
| Emisión | Guarda la cotización si hay cambios, reconstruye el documento desde lo guardado y exige que sea idéntico a la vista previa (huella del modelo y del PDF); registra el modelo congelado; descarga | `DocumentacionOferta.jsx` |
| Versiones | Misma información → mismo número en los tres documentos (COT_MP_x_v1, EETT_MP_x_v1, OFERTA_MP_x_v1; en ventas privadas COT_CP-…_v1, etc.); información distinta → la siguiente. Historial inalterable con fecha, hora y usuario; cualquier versión se vuelve a descargar idéntica (se regenera desde el modelo congelado y se compara la huella) | `documentosOfertaDatos.js`, migración |
| Condiciones | Plazo (y días hábiles/corridos), garantía, vigencia, despacho, forma de pago, disponibilidad confirmada y observaciones, sin valores predeterminados; las que la cotización ya tiene (plazo en MP; plazo, forma de pago y vigencia en ventas privadas) se reutilizan. Condiciones particulares por producto en su ficha | `modeloOferta.js`, `EditorFicha.jsx` |
| Matriz de cumplimiento | Requisito / ofertado / Cumple · No cumple · Por verificar; propuesta desde los requerimientos de Compra Ágil siempre «Por verificar»; sin requisitos no hay matriz | `modeloOferta.js` |
| Interfaz | La pestaña «EETT» pasa a «Documentos» con la sección «Documentación de la oferta» (tres documentos; la oferta consolidada es la principal), idéntica en Mercado Público y Ventas privadas: solo cambia el canal en el nombre del archivo (MP / PRIVADA). La EETT con folio ET-… de ventas privadas se retiró de la pestaña (las ya emitidas siguen en la base y se descargan desde la orden de venta, junto con los documentos de la oferta emitidos) | `EditorCotizacion.jsx`, `EditorCotizacionPrivada.jsx`, `PanelOrdenesVenta.jsx` |

Sin cambios: fórmulas de precios y despacho (los montos vienen de `calcularCotizacion` / totales de Ventas privadas), OC,
finanzas, comisiones, liquidaciones, financiamiento, pagos, sincronización con Mercado Público, EETT ya emitidas (el generador
anterior `eettPdf.js` sigue igual, byte a byte).

## Base de datos (BORRADOR, no aplicada)

`docs/migraciones/BORRADOR-2026-11-25-documentos-oferta.sql` (+ `-deshacer.sql`): dos tablas nuevas (`oferta_condiciones`,
`oferta_documentos`) y tres funciones (`oferta_puede`, `oferta_guardar_condiciones`, `oferta_emitir_documento`). Aditiva: no
modifica ninguna tabla, función ni dato existente. Sin escritura directa ni UPDATE/DELETE del historial. Sin la migración, la app
permite vista previa y descarga sin emitir y lo informa.

## Pruebas

| Prueba | Qué cubre |
|---|---|
| `docs/pruebas-documentos/documentos.test.mjs` (56) | Texto pegado (formatos, publicidad, negativos, contradicciones, incompletos, unidades, categorías), modelo = cálculo, privacidad, tres PDF, fuente, A4, numeración, página de cada ficha, determinismo byte a byte, versiones, 12 productos, extensos, sin fotos, 4 fotos, agrupación de líneas idénticas, avisos, Ventas privadas |
| `docs/pruebas-documentos/sql_documentos.test.mjs` (32) | Migración aditiva, permisos (anónimo, sin perfil, responsable), versiones, sin duplicar, inalterable, recuperación |
| `docs/pruebas-documentos/e2e_documentos.mjs` (36) | Interfaz Mercado Público (PC, celular, sin migración): texto pegado → condiciones → matriz → vista previa (páginas, navegación, zoom) → emisión idéntica → historial → v2 → cambio tras la vista previa |
| `docs/pruebas-documentos/e2e_documentos_vp.mjs` (20) | Interfaz Ventas privadas con PostgreSQL + PostgREST reales y la migración (PC y celular) |
| `docs/pruebas-documentos/generar_ejemplos.mjs` | Genera los tres PDF de ejemplo (con `IMAGENES_DIR` se usan otras fotografías; las del repositorio son figuras sintéticas) |

## Ventas privadas: PDF de la cotización (25/11/2026)

El botón «Descargar PDF de la cotización» / «Vista previa de la cotización» de la pestaña Precios y «PDF cotización aprobada»
de la orden de venta generan la **Cotización económica** con este mismo generador (`cotizacionEconomica` en
`lib/documentosOfertaDescarga.js`): mismas condiciones guardadas, misma regla de versión y mismo diseño que la sección
«Documentos». No emiten ni registran nada. Si ese contenido ya fue emitido como cotización, el PDF es idéntico al emitido y
lleva su nombre (`COT_<folio>_vN.pdf`); si no, el archivo termina en `_sin-emitir.pdf`. Una revisión ya enviada o
la aprobada usan su documento congelado y las fichas de esa revisión. El formato antiguo (`lib/vpPdf.js`) se conserva en el
código, pero la app ya no lo usa.
