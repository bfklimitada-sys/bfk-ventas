# «Nueva OC» con la cotización BFK (03/11/2026)

**Estado: desarrollado y probado en local (rama `nueva-oc-cotizacion`). NO publicado. Sin migraciones.**

## Qué cambia
«Nueva OC» concentra en una pantalla la importación de la OC desde Mercado Público, la asociación con la cotización BFK y,
solo si el usuario confirma que compró, el registro del costo real. No hace falta pasar por Cotizaciones ni por Compras.

1. **Sugerencias (nunca automáticas).** Al traer la OC se buscan cotizaciones *presentadas* o *adjudicadas* sin OC (o ya
   vinculadas a esta OC) y se puntúan por señales verificables: vínculo ya registrado, código de la compra en Mercado
   Público (si la API lo informa), RUT del comprador, monto total, nombre, institución y productos. Cada tarjeta muestra los
   motivos y el nivel de coincidencia; el vínculo exige pulsar «Usar esta cotización». Las vinculadas a otra OC no se
   sugieren; las que la base no permitiría adjudicar (sin vendedor responsable) se muestran como no vinculables.
2. **Búsqueda manual** por código, nombre o institución (mismo listado del módulo Cotizaciones) y «Continuar sin cotización»
   (flujo anterior, sin cambios).
3. **Carga de la cotización** (solo lectura): productos, cantidades, enlaces, proveedores, costos y despachos. Los enlaces de
   compra de la OC se completan desde la cotización, por producto (no se vuelven a escribir).
4. **¿Qué guardar?**
   - *Solo la OC*: muestra lo cotizado y la utilidad estimada; crea la OC y vincula la cotización. No registra compra ni deuda.
   - *OC y compra*: el formulario de «Registrar compra» (el mismo de Compras) con los datos cargados y editables: precio real
     por producto, proveedor, enlace, cantidad (compras parciales), dirección y despacho real o adicional; dividir una línea
     entre proveedores (un pedido por proveedor, despacho una sola vez). Compara costo cotizado vs real y la utilidad
     actualizada (o proyectada si es parcial). Exige el **financiador** (salvo venta propia) y la **confirmación explícita**
     de que la compra se realizó.
5. **La cotización no se modifica**: el vínculo se hace con la función existente `cz_guardar_cotizacion_v2` reenviando
   exactamente lo guardado (líneas con su identificador, cantidades, precios, costos, unitarios de venta, despachos,
   fórmula y totales). Solo cambian el estado (presentada → adjudicada) y el código de la OC. El monto de la OC y sus
   productos vendidos vienen de Mercado Público, como antes.
6. **Sin duplicados y reintentos seguros**: la OC se crea una sola vez por formulario (un reintento no la vuelve a crear);
   el vínculo ya hecho no se repite; la compra lleva su marca «Pedido» fija (no se duplica la compra, la deuda ni el
   despacho). Un doble toque no crea nada dos veces. Si un paso falla, el mensaje dice qué quedó hecho y qué falta.
7. **Casos bloqueados**: OC cancelada en Mercado Público (no se registra compra), cotización de otra OC (solo un
   administrador cambia ese vínculo, en Cotizaciones), cotización sin vendedor responsable, falta de financiador o de la
   confirmación.

## Lógica reutilizada (no hay una segunda lógica financiera)
- Crear la OC: `handleNuevaOCRapida` (misma inserción, productos de Mercado Público, catálogo de entidades y contactos).
- Vincular: `cz_guardar_cotizacion_v2` (validaciones de la base: versión, adjudicadas protegidas, vendedor responsable,
  guardas tributarias).
- Comprar: `CompraDesdeCotizacion` + `lib/compraCotizacion.js` + `handleCompraDesdeCotizacion` → `registrar_compra_oc`
  (evento de compra, costo y deuda del financiador calculados por la base). IVA, F29, FIFO, comisiones e historia no se tocan.

## Archivos
- `src/lib/nuevaOCCotizacion.js` (nuevo, puro): puntaje y sugerencias, elegibilidad, diferencias OC ↔ cotización, enlaces por
  producto y `payloadVinculo`.
- `src/lib/cotizacionesDatos.js`: `cotizacionesCandidatasOC`, `buscarCotizacionesTexto`, `vincularCotizacionOC`.
- `src/components/forms/CotizacionNuevaOC.jsx` (nuevo): selector de cotización y resumen «solo OC».
- `src/components/forms/NuevaOCRapida.jsx`: sección de cotización, enlaces desde la cotización, modo de guardado.
- `src/components/forms/CompraDesdeCotizacion.jsx`: modo «Nueva OC» (financiador obligatorio, confirmación, marca fija).
- `src/App.jsx`: `handleNuevaOCConCotizacion`; `handleCompraDesdeCotizacion` acepta la OC recién creada (`ocDatos`).
- `api/oc.mjs`: entrega además `codigo_licitacion` (si Mercado Público lo informa), solo para sugerir.

## Pruebas
- `node docs/pruebas-nueva-oc/reglas.test.mjs` — reglas puras (39).
- `bash docs/pruebas-nueva-oc/validar_vinculo_sql.sh` — el vínculo contra la función REAL `cz_guardar_cotizacion_v2` y sus
  disparadores en un PostgreSQL local desechable (28): cotización, líneas y despachos idénticos; exenta aprobada; sin
  fórmula; rechazos de otra OC, sin vendedor, versión antigua y cambio de lo ofertado.
- `node docs/pruebas-nueva-oc/e2e_nueva_oc.mjs <url>` — interfaz en escritorio y celular con base simulada (57). Con
  `CAPTURAS=<carpeta>` guarda imágenes de los pasos.
