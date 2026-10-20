# Ventas exentas — Fase 1 (20/10/2026)

Compatibilidad de lectura con facturas exentas (DTE 34) ya registradas. **No habilita** registrar ni emitir
operaciones exentas nuevas. Sin migraciones ni cambios en Supabase.

## Qué cambia

| Lugar | Antes | Ahora |
|---|---|---|
| Comisión de venta propia (`calculos.js`) | IVA = facturado − facturado/1,19 | IVA por documento vigente: DTE 33 o sin tipo → igual que antes; DTE 34 → `monto_iva` registrado o 0 |
| Total vendido en la ficha (`PanelCompras.jsx`) | Compara con monto/1,19 y rotula «con IVA» | Si todas las facturas vigentes son DTE 34, compara con el monto y rotula «exento (sin IVA)» |
| Registrar compra (`FormIngresarCompra.jsx`) | «Venta con IVA = neto + IVA» | En OC exenta por documentos: «Venta exenta: sin IVA» |
| Desglose por producto (`productosOC.js`) | base «neto» o «con IVA» | además base «exento» para OC exenta por documentos |
| Vista de Compras (`vistaCompras.js`) | «Factura N.º X» | «Factura exenta N.º X» si la vigente es DTE 34 |
| Registrar factura (`FormulariosRapidos.jsx`, `App.jsx`) | Sin aviso | Nota «se registra como afecta (DTE 33)»; bloquea reemitir o agregar factura sobre una OC con DTE 34 vigente |

Reglas de seguridad:
- Una OC se reconoce exenta **solo por sus documentos ya registrados** (DTE 34 vigente). Un impuesto $0 en
  Mercado Público no cambia nada.
- DTE 33 conserva exactamente la fórmula 1,19 aunque más adelante se registre `monto_iva`.
- Sin cambios en rentabilidad (`gananciaReal`), costos, FIFO, F29, IVA mensual ni comisión general.

## Estado de producción (lectura, 20/10/2026)
Tipos de documento: 294 sin tipo, 3 NC (61), **0 DTE 34**; 0 documentos con `monto_iva`, `monto_exento` o
`monto_neto`; 1 OC de venta propia con factura (sin tipo). Por lo tanto ningún valor histórico cambia.

## Pruebas
`docs/pruebas-oc/e2e_exentas_fase1.mjs` (39 comprobaciones, escritorio y celular): DTE 33, DTE 34 con y sin IVA
registrado, NC código 1 y 3 sobre DTE 34, refacturación histórica, comisión venta propia y general, rentabilidad,
bloqueo de reemisión, registro normal de factura afecta, formulario de compra.

## Pendiente para la fase 2 (requiere autorización)
1. Migración: columnas de clasificación tributaria en `cotizaciones` y `ordenes_compra_v2`
   (p. ej. `tratamiento_iva` afecta/exenta, fundamento legal, respaldo/documento, aprobado_por, aprobado_en).
2. Actualizar la RPC `cz_guardar_cotizacion_v2` para guardar la clasificación.
3. Fórmula de cotización exenta (precio sobre costo bruto, sin débito fiscal) y su visualización.
4. Selector DTE 33/34 en «Registrar factura» habilitado solo con clasificación aprobada; guardar `tipo_dte`,
   `monto_exento`, `monto_iva`.
5. Confirmaciones del contador: tratamiento del crédito fiscal de compras asociadas a ventas exentas
   (proporcionalidad), efecto en F29 y en la comisión general (IVA neto del período).
6. Sincronización con Mercado Público: mostrar impuestos $0 solo como alerta para revisar, nunca como clasificación.
