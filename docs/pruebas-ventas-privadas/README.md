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
