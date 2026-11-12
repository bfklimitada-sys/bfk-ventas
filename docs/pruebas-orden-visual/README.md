# Orden visual — 11/11/2026 (rama `orden-visual`, desde main d4095b6)

Alcance: solo presentación y organización de la interfaz. No cambia cálculos, permisos, datos, integraciones, SQL ni los
generadores de documentos (`eettPdf.js`, `vpPdf.js`, `exportacionVista.js` no se tocaron).

## Base compartida
* `lib/theme.js`: tarjetas planas (solo borde), `btnP` con un único color de marca (se conserva rojo para acciones destructivas),
  estado ocupado/no disponible apagado, `estiloEtiqueta`, `estiloCerrar`, `btnMini`.
* `lib/EstilosGlobales.jsx`: aspecto base de campos y listas desplegables (flecha única), foco, pestañas internas de ancho natural en
  escritorio, día de la Agenda de alto fijo en escritorio.
* `ui/Sistema.jsx`: `Chips` y `estiloChip` (canal, nivel de alerta, filtros de lista), `Pestanas variante="chips"`, `Indicador linea`,
  `NotaEnlace`; `Kpi`/`Fila` (Ventas privadas), `Campo`/`Ventana`/`estiloBoton` (Proyectos) y `Field`/`Modal` usan los mismos estilos.
* Pesos de letra un escalón más livianos en toda la interfaz (800→700, 700→600, 600→500); bordes de 1px; sin sombras decorativas.

## Por pantalla
* Inicio: Ventas privadas como una franja rotulada bajo los indicadores; «Caja y compromisos» ya no repite el saldo proyectado y parte
  cerrado; en escritorio, Prioridades a la izquierda y Registrar · Mercado Público · Caja a la derecha; avisos de MP sin tarjeta interna.
* Alertas: una sola lista (patrón de «Prioridades de hoy»), chips de nivel compartidos, sin el texto que repetía el total.
* Agenda: días sin recuadro, mes completo visible en escritorio.
* Compras / ficha de OC: vendedor y financiador una sola vez en el cuerpo (tarjeta con «Editar»); unidad, contacto y fechas solo en
  «Datos» y «Fechas»; resumen financiero en un contenedor.
* Finanzas: el encabezado no repite la pestaña; «El IVA y el F29 se registran en Impuestos» pasa a enlace discreto en Gastos y Comisiones.
* Cotizaciones MP y privadas: conteos en una línea; el de la biblioteca queda solo en su pestaña; misma barra de acción + búsqueda.
* Órdenes de venta y Proyectos: filtros con el estilo de chips.
* Administración: la configuración de Ventas privadas tiene su propia pestaña.

## Verificación
* `recorrido.mjs <url> <carpeta>`: captura todas las pantallas en escritorio (1440) y celular (390) con la base simulada.
* `detalle.mjs <url> <carpeta> [pc|cel]`: ficha de OC, ventanas y pestañas internas.
* Pruebas existentes con el mismo resultado que `main`: e2e_fase4a (108), e2e_vista_compras (27), e2e_filtros_compras (28),
  e2e_seguimiento (56), e2e_registrar_compra (21), e2e_compras_movil (20; las 2 fallas de índice ya existían), nav_fase3 (las 4 de
  Agenda ya existían: esperan «Octubre»).
* `mp_byte_a_byte.mjs` main vs. rama: los 4 PDF de EETT de Mercado Público son idénticos byte a byte (las capturas de pantalla
  difieren, como corresponde a un cambio visual).

## Segunda pasada — cierre de pendientes (11/11/2026, noche)

Mismo alcance: solo presentación. Sin cambios en cálculos, permisos, datos, integraciones, SQL ni generadores de documentos.

### Cambios
* **Botón pequeño único** (`btnMini` en `lib/theme.js`): Editar, Quitar, Ver, Anular, Eliminar… dentro de filas y tarjetas, en Mercado
  Público, Ventas privadas y Proyectos (58 botones). Normal = borde gris; avanza el registro = borde y texto de marca; destructiva =
  borde y texto rojos. Alto mínimo 36 px.
* **Ventas privadas y Proyectos** (revisados con datos): encabezado de lista con la acción principal primero; conteo «Por entregar»
  solo en los filtros; `Fila` muestra nombres en letra normal y cifras/folios en monoespaciada, sin cortar textos largos; fila de la
  orden de venta con folio y total en la primera línea; «Sin vendedor asignado» sin el prefijo «vendedor»; indicadores de Proyectos
  en dos columnas en el celular.
* **Editores de cotización** (misma estructura, pasos y pestañas): `cotizaciones/PasosCotizacion.jsx` compartido por ambos editores,
  en tamaño reducido y siempre con todos los pasos a la vista; el campo dentro de «Dirección de entrega del cliente» pasa a llamarse
  «Calle y número» (no repetía el título).
* **Finanzas › Resumen**: «Financiadores» y «Comisiones y apoyo en gestión» parten cerrados (son resúmenes de sus pestañas) con una
  línea de resumen; la tabla «Todos los canales» ya no fuerza 420 px de ancho en el celular.
* **Agenda**: una sola leyenda dentro del calendario (siempre visible, con la explicación de cada color); cada día indica cuántos
  eventos hay de cada tipo y lo describe para lectores de pantalla.
* **Celular**: los campos lado a lado (dos fechas) ya no desbordan en pantallas de 360 px (defecto que existía en `main`); las
  pestañas internas usan menos relleno y, con dos o tres pestañas, un rótulo largo ocupa dos líneas en vez de cortarse.

### Pruebas corregidas (no eran defectos de la app)
* `pruebas-navegacion/nav_fase3.mjs` (4): esperaba el mes «Octubre» fijo; ahora espera el mes en curso (hora de Chile).
* `pruebas-ui-movil/e2e_compras_movil.mjs` (2): esperaba 9 accesos en el índice de la ficha; hay 10 desde que existe «Clasificación
  tributaria». Ahora exige un acceso por cada sección presente y que estén las nueve permanentes.
* `pruebas-ventas-privadas/e2e_compra_vp.mjs` (P25): usaba la fecha UTC; después de las 21:00 de Chile la base la rechazaba por futura.
* `pruebas-cierre/e2e_panel.mjs`: daba por abierto «Caja y compromisos» en escritorio; ahora lo abre antes de validar los mismos
  conceptos y montos (el desglose parte cerrado desde la primera pasada).

### Defecto real detectado
Los formularios de Mercado Público proponían la fecha UTC (el día siguiente entre las 21:00/20:00 y la medianoche de Chile). Existía
en `main`. Corregido el 12/11/2026 en un commit aparte; detalle y pruebas en `docs/pruebas-fechas/README.md`.

### Cómo se verificó
* `entorno.sh` + `semilla_vp.mjs`: base desechable local con datos representativos. `modulos.mjs`: listas, fichas y formularios de
  Ventas privadas y Proyectos en 1440, 390 y 360 px. `detalle.mjs`: ficha de OC (3 estados), ventanas y pestañas internas de
  Mercado Público en los mismos anchos. `revisar.mjs`: desplazamiento horizontal, controles fuera del ancho, contenido cortado y
  controles inalcanzables dentro de una ventana. `agenda.mjs`: leyenda única, meses de seis filas y días con varios eventos.
* Corrección (12/11/2026): lo anotado aquí antes —«`e2e_proyectos.mjs` falla igual en `main` (2 de 23)»— era un error del entorno
  de pruebas, no de la suite ni de la app: el sustituto local de PostgREST no escribía tablas. Con el entorno corregido
  (`pgrest_nucleo.mjs`) la suite completa da 97 OK · 0 FALLA en la rama y en la versión publicada, sin modificar sus pruebas.

### Resultado (12/11/2026, compilación final de la rama)
* Recorridos propios, sin problemas de maquetación ni errores de página: `detalle.mjs` 53 + 55 + 56 capturas (1440 · 390 · 360 px),
  `modulos.mjs` 49 + 52 + 58, `recorrido.mjs` 16 pantallas × 2, `agenda.mjs` 42 comprobaciones.
* Mercado Público, mismo resultado en `main` y en la rama: e2e_fase4a 108 · vista_compras 27 · filtros_compras 28 · seguimiento 56 ·
  registrar_compra 21 · compras_movil 22 · nav_fase3 218 · cierre/e2e_panel 12 · cotizaciones (borradores 38, definitiva 73,
  eett_version_nueva 27, filtro_sin_vendedor 59, recargos 23, vendedor_responsable 25) · comisiones (estados 20, confirmaciones 13,
  periodo 24) · nueva_oc 61 · pagos_vendedor 17 · vendfin 58 · enlace_iva 24 · correos 46 · conciliación (cartola 32, simple 43,
  solo_revision 28) · iva_unificado OK.
* Ventas privadas, sobre base desechable: e2e_ventas_privadas 85 · cotizacion_como_mp 110 · compra_vp 28 · financiamiento 66 ·
  eett_cp_2026_0001 23 (escritorio) + 23 (celular).
* `mp_byte_a_byte.mjs`: los 4 PDF de EETT de Mercado Público, idénticos byte a byte entre `main` y la rama.

## Tercera pasada (12/11/2026)

### Cambios de interfaz
* **Ficha de OC en celular y tableta vertical:** el índice de cinco filas de botones (que repetía los títulos de las secciones que
  están justo debajo) pasa a ser un solo control «Ir a una sección · N secciones» que despliega la lista completa, con la marca
  «Requiere atención» donde corresponde. Todas las secciones siguen accesibles. En computador sigue la fila de accesos.
* **Finanzas › Resumen:** se mantienen los dos selectores porque filtran cosas distintas, y cada uno dice qué controla:
  «Período de este cuadro» (ventas por canal y sus márgenes; en Ventas privadas, «Período de este resumen») y «Mes de este
  resultado» (Resultado del mes del informe financiero).
* **Compras en tableta horizontal (1024–1150 px):** con la barra lateral, la fila de una línea cortaba el cliente («CORPORACIÓN
  EDUCACIO…») y la dirección («Direcci…»). La fila decide ahora según el ancho del contenido, no de la ventana, y en ese tramo
  usa la distribución apilada, sin cortar información.

### Pruebas ajustadas (comportamiento, no distribución)
* `pruebas-oc/indice_ficha.mjs` (nuevo): ir a una sección por su título, abriendo antes la lista si el índice es compacto. Lo usan
  las 16 suites que navegaban por los botones del índice; funcionan igual con la versión publicada y con la rama.
* `pruebas-ui-movil/e2e_compras_movil.mjs`: ya no cuenta botones; exige un acceso por sección, que cada acceso lleve a su sección
  y la abra, y que la lista se cierre al elegir.
* `pruebas-4c/e2e_fase4c.mjs` (C5): abre «Caja y compromisos» antes de leer el desglose (parte cerrado desde la primera pasada).
* `pruebas-financieras/e2e_fase4b.mjs` (B13): llenaba un «precio de venta» que, con una OC existente, el formulario no pide (la
  venta viene de la OC); fallaba igual en `main`. Ahora lo llena solo si aparece.

### Tableta
`tableta.mjs` recorre, sobre la demostración aislada, las 16 pantallas, los menús «+ Nuevo» y «Más», los formularios de compra,
entrega, factura, pago y gasto, filtros, la ficha de OC con su índice, cotizaciones, cliente, cotización y venta privadas con sus
pestañas y formularios, y la ficha y el alta de un proyecto: 768×1024, 820×1180, 1024×768 y 1180×820. Resultado: 188 capturas sin
desplazamiento horizontal, contenido cortado ni controles fuera de pantalla; revisión visual de una muestra en cada ancho.
