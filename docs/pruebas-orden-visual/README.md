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
