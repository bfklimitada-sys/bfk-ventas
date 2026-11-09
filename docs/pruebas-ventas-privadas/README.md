# Cotización privada con la experiencia de Mercado Público — 08/11/2026

Estado: autorizado por Kevin el 09/11/2026 (migración en producción tras respaldo y ensayo en copia; luego integración a `main`).
El registro de la operación queda en `bfk-respaldos` (docs/registro-operaciones).

Ajustes del 09/11/2026 (pedidos al autorizar):
* Ventana compartida de productos: «Cantidad» y «Precio unitario de compra» con el mismo estilo que los demás campos (también en
  Mercado Público; antes un `style: undefined` les quitaba el formato).
* Generador ÚNICO de EETT (`eettPdf.js`, Mercado Público y Ventas privadas): el plazo de entrega se escribe completo y la fila crece lo
  necesario. Con un plazo de una línea el PDF es idéntico byte a byte al anterior (documentos ya emitidos), las demás celdas no cambian
  (`eett_plazo_largo.test.mjs`, 11 comprobaciones en ambos canales).

Criterio: quien ya sabe cotizar en Mercado Público crea una cotización privada sin aprender otra interfaz.

| Área | Implementación |
|---|---|
| Estructura | `EditorCotizacionPrivada.jsx`: misma hoja lateral, botón «Guardar •/Guardado», línea de estado de guardado, pasos y pestañas **Datos · Productos · Precios · EETT** de `EditorCotizacion.jsx`. Los datos se conservan al cambiar de pestaña; cerrar con cambios pide confirmación y hay copia de recuperación local (IndexedDB, espacio `vp:` separado del de Mercado Público). |
| Datos | Cliente del registro compartido (en lugar de institución), razón social y RUT, contacto, correo, teléfono, dirección de entrega (mismo bloque que Mercado Público), responsable, folio automático, emisión, vigencia, plazo, condiciones de pago, IVA, condiciones comerciales y observaciones. Sin código de Compra Ágil, licitación ni consulta a ChileCompra. La OC del cliente se registra al crear la venta. Respaldos e historial al final. |
| Productos | Las mismas «＋ Ingresar manual», «Desde la biblioteca de fichas», tarjetas y ventana `EditorFicha.jsx` (con `vp`: tipo producto/servicio, unidad y código; un servicio no pide marca, modelo, color ni despacho). Foto en `cz-productos`, enlace, proveedor, cantidad, costo y despacho propio o compartido con su verificación contra la dirección. |
| Precios | Costo de adquisición idéntico a Mercado Público (`lib/vpCotizacion.js`, probado contra `calcularCotizacion` en 400 casos). **Diferencia explícita:** el precio unitario de venta y el descuento siguen la fórmula de ventas privadas (la de la base); el «recargo sobre costo» solo escribe el precio (costo × (1 + recargo), hacia arriba) cuando se usa. Nada se recalcula solo ni cambia documentos guardados. Costos, utilidad, margen y recargo solo para el responsable y los administradores. |
| EETT | Revisión de fichas como Mercado Público (aprobación de avisos) y vista previa sin guardar. «Generar EETT» arma la EETT privada desde la ficha de cada ítem (marca, modelo, color, características generales, especificaciones, descripción e imágenes) sin volver a escribirla; se conservan requisitos del cliente, respaldos de cumplimiento, folio ET, revisiones e inmutabilidad. Mismo generador de PDF de Mercado Público (`eettPdf.js`). |
| PDF de la cotización | Vista previa y descarga en Precios. Sin costos, proveedores, enlaces, despachos ni márgenes. Ver o descargar no cambia el estado. |
| Flujo privado | Sin cambios: borrador, registro manual de envío/aceptación/rechazo/vencimiento, revisiones (las enviadas quedan de solo lectura), duplicar, «Crear venta / Registrar OC» idempotente, adjuntos, permisos e historial. Inteligencia Comercial sigue desactivada; no hay sincronizaciones ni IA nuevas. |
| Venta | La venta conserva la ficha técnica y los datos de compra (proveedor, enlace, precio, despacho); la ficha de la venta muestra proveedor e «Ir a comprar» al responsable. |

## Migración del 08/11 (compatible, con recuperación)

* `docs/migraciones/BORRADOR-2026-11-08-vp-cotizacion-como-mp.sql` — columnas nuevas nulas o con valor por defecto
  (`vp_cotizacion_items.ficha/ficha_aprobada`, datos de compra en `vp_cotizacion_item_costos`, `vp_venta_items.ficha`, datos de compra en
  `vp_venta_item_costos`), costo unitario opcional (un ítem puede tener proveedor y enlace antes de su precio), nuevas versiones de
  `vp_reemplazar_lineas`, `vp_cotizacion_nueva_revision`, `vp_duplicar_cotizacion`, `vp_crear_venta_desde_cotizacion` y de las vistas de margen
  (misma fórmula; un costo vacío cuenta como «sin costo»). Antes de cambiar nada exige que las 4 funciones sean exactamente las del 07/11
  (huella del cuerpo). No reescribe filas ni toca documentos congelados, EETT, ventas ni Mercado Público.
* `docs/migraciones/BORRADOR-2026-11-08-vp-cotizacion-como-mp-deshacer.sql` — restituye el texto exacto de las funciones del 07/11 sin borrar
  datos (las columnas nuevas se conservan; `-v quitar_columnas=si` las quita solo si están vacías). Sin datos nuevos deja el catálogo idéntico
  al del 07/11 (probado por huella).
* La interfaz detecta si la migración está instalada; si no, avisa y **no guarda** (para no perder fichas ni datos de compra).

## Pruebas (además de las de abajo)

* `sql_como_mp.test.mjs` (45): migración sobre datos reales del 07/11 sin alterar nada histórico; persistencia al guardar, nueva revisión,
  duplicar y convertir en venta; permisos de costos; márgenes; EETT emitida desde fichas; recuperación y re-aplicación.
* `reglas_como_mp.test.mjs` (21): costos idénticos a Mercado Público, fórmula privada, ida y vuelta sin pérdidas, EETT desde la ficha.
* `eett_plazo_largo.test.mjs` (11): plazo largo completo en ambos canales; plazo corto idéntico a main.
* `e2e_cotizacion_como_mp.mjs` (106): plazo largo en la EETT de ambos canales y en el PDF comercial; estilo de los campos; sin llamadas a
  Inteligencia Comercial, IA ni Compra Ágil; recorrido completo en escritorio y celular (crear, productos y fichas, calcular, guardar, reabrir,
  editar, ambos documentos, revisión, aceptación, EETT emitida y venta), permisos de otro usuario y capturas comparativas
  (`CAPTURAS=carpeta`) del editor de Mercado Público y del privado.

---

# Ventas privadas (línea VP) y EETT de cotizaciones privadas — 06/11/2026

Estado: **implementado y probado en bases desechables locales. NO publicado y migración NO aplicada en producción.**
Rama local `ventas-privadas` (sin push: las vistas previas de Vercel apuntan a la base de producción).

## Qué incluye

| Área | Implementación |
|---|---|
| Menú | Subtítulo «Gestión comercial». Grupos General · Mercado Público · Ventas privadas · Proyectos industriales · Finanzas · Sistema. «+ Nueva OC» → «+ Nuevo» (Cotización privada · Venta privada / Registrar OC de cliente · OC de Mercado Público). Direcciones anteriores intactas; barra inferior del celular sin cambios. |
| Clientes | Reutiliza `pi_clientes` (RUT único) + `vp_clientes_datos` (persona/empresa, entrega, condiciones de pago). Ficha con cotizaciones, ventas y saldos. |
| Cotizaciones privadas | Folio `CP-AAAA-NNNN`, revisiones R0, R1… (la enviada/aceptada queda congelada), costos internos en tabla aparte (solo responsable y administrador), PDF sin costos, envío/aceptación/rechazo/vencimiento **manuales**, duplicar, búsqueda y filtros. |
| Venta | «Crear venta / Registrar OC» idempotente (doble clic, reintento o dos sesiones → una venta). Orden interna `OV-AAAA-NNNN`; OC del cliente aparte (número, fecha, archivo). Venta directa sin cotización. |
| Ficha de venta | Detalle (costos estimados y reales, gastos vinculados sin duplicar) · Entregas (parciales/finales) · Documentos (cotización aprobada, EETT, OC, facturas **registradas**, respaldos) · Pagos (anticipos, abonos, aplicación a facturas sin duplicar cobros). Estados de entrega, facturación y pago independientes. Anulación con motivo y trazabilidad. |
| EETT | Biblioteca técnica (sobre `productos_catalogo`), extracción asistida desde PDF con texto (pendiente de revisión, con página), «Generar EETT» por ítem con numeración de la cotización, «No informado» bloquea la emisión, requisitos del cliente separados de lo ofrecido, folio `ET-AAAA-NNNN` + revisión, contenido congelado con huella SHA-256, vínculo con la venta. |
| Integración | Filtro de canal (Todos · Mercado Público · Ventas privadas) en Inicio, Alertas, Agenda y Finanzas › Resumen. Alertas: cotizaciones por vencer, entregas pendientes/atrasadas, pagos vencidos. |
| Permisos | En la base (RLS + funciones `vp_*`); la interfaz solo los refleja. Historial `vp_historial` inalterable. |

## Migración

* `docs/migraciones/BORRADOR-2026-11-06-ventas-privadas.sql` — solo crea objetos `vp_*`, el depósito `vp-documentos` y la línea `VP`.
  Requiere Proyectos Industriales y Cotizaciones ya instalados (lo verifica y se detiene sin cambios si falta algo o si ya existe).
* `docs/migraciones/BORRADOR-2026-11-06-ventas-privadas-deshacer.sql` — se niega si hay datos del módulo o archivos; sin datos deja el
  catálogo idéntico al anterior (comprobado por huella).
* Carga de archivos **deshabilitada al instalar** (`vp_configuracion.documentos_habilitados = false`) hasta que el respaldo diario de
  archivos incluya `vp-documentos`; se habilita en Administración › Ventas privadas (solo administrador).

## Pruebas

```bash
# PostgreSQL local (superusuario postgres), postgrest 12 (POSTGREST=ruta), Chromium (CHROME=ruta), npm install, playwright-core.
bash docs/pruebas-ventas-privadas/ejecutar.sh
```

* `sql.test.mjs` (132): permisos (anónimo, sin perfil, otro usuario, administrador), RUT y duplicados, totales, costos ocultos, edición
  simultánea, revisiones congeladas, conversión idempotente con 3 sesiones simultáneas, OC duplicada, entregas, facturas (IVA, folio MP,
  sobrefacturación), anticipo + aplicación sin doble cobro, anulaciones, gastos vinculados, depósito, EETT y extracción, y huella de
  Mercado Público (políticas, funciones, columnas, disparadores, permisos y datos) idéntica antes y después.
* `reglas.test.mjs` (50): fórmulas idénticas a la base (60 casos aleatorios), indicadores sin dobles conteos, alertas, agenda, extracción,
  y texto de los PDF (sin costos ni márgenes; EETT sin precios).
* `e2e_ventas_privadas.mjs` (82): recorrido completo en navegador real (escritorio y celular) con PostgREST real.
* Suites existentes de Mercado Público y Proyectos industriales actualizadas al botón «+ Nuevo» y ejecutadas.
