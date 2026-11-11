# Ventas privadas — financiamiento de compras y vendedor «BFK» (11/11/2026)

Estado: **implementado y probado en entornos aislados. Migración NO aplicada en producción y NO publicado.** Rama local
`vp-financiamiento` de bfk-ventas (sin push: las vistas previas de Vercel apuntan a la base de producción).

## Estándar de Mercado Público que se adapta (Mercado Público no cambia)

| Mercado Público | Ventas privadas |
|---|---|
| Catálogo `financiadores`; «Cuenta BFK» (`tipo = 'propio'`) = fondos propios, no es deuda | El mismo catálogo, solo lectura: «BFK · fondos propios» usa la Cuenta BFK; las personas son los financiadores externos; «Otra persona» se registra por nombre (no se crea en el catálogo) |
| Deuda = compras − pagos al financiador | Pendiente de devolución = aportes personales − devoluciones |
| Venta de capitalización de BFK Ltda.: sin vendedor personal ni comisión | Vendedor «BFK»: sin cuenta de acceso, sin vendedor personal ni comisión |
| Catálogo `vendedores` | El mismo catálogo, solo lectura |
| Vendedor asignado en cotización presentada: solo administrador lo cambia | Igual en cotización enviada y en la orden de venta |

## Separación de conceptos

Vendedor (a quién se atribuye la venta) · responsable (quién la gestiona y registra; no cambia) · proveedor (de la compra) ·
financiador (quién puso el dinero; puede ser más de uno) · cliente. Ejemplo probado: venta de BFK, gestionada por Ana (usuaria
de prueba), financiada parcialmente por Kevin y parcialmente por BFK.

## Reglas (en la base, `BORRADOR-2026-11-11-vp-financiamiento-vendedor.sql`)

* El costo de compra se registra una sola vez (`vp_compras`, sin cambios). Aportes y devoluciones no tocan `vp_compras`, el costo
  real, la utilidad (`vp_margen_ventas`), los precios, las cotizaciones aprobadas, las EETT, los cobros del cliente (`vp_pagos`) ni
  las comisiones (Ventas privadas no entra en el cálculo de comisiones).
* Total a financiar = total pagado (con IVA) de las compras registradas en Ventas privadas. Un gasto ya registrado en Gastos y
  vinculado no se financia aquí (su pago ya está registrado): no se cuenta dos veces.
* Lo financiado nunca supera lo pagado; lo que falta es «Financiamiento sin informar» (también las compras anteriores): no se
  atribuye a BFK ni al responsable.
* Devoluciones solo de aportes personales, parciales o totales, nunca más que el saldo, nunca antes del aporte.
* Doble clic y reintentos: claves de idempotencia (aporte, devolución, compra desde la cotización y compra manual). Operaciones
  simultáneas: bloqueo de la fila de la venta.
* Correcciones: anular con motivo (se conserva) y registrar de nuevo. Un aporte con devoluciones vigentes no se anula; una compra
  financiada no se anula si lo financiado quedaría por encima de lo pagado. Historial sensible en `vp_historial`.
* Permisos: como compras y costos (solo administrador y responsable de la venta leen y registran). Escritura solo por funciones.

## EETT y máximo a financiar (11/11/2026, segunda entrega)

* «Vendedor responsable» de las EETT privadas NUEVAS (vista previa y PDF emitido) muestra el vendedor de la cotización: BFK →
  nombre corto de la empresa («BFK Ltda.»), vendedor personal → su nombre; sin vendedor asignado, el responsable (como antes). El
  contenido de la EETT guarda `vendedor` y conserva `responsable`. Las EETT ya emitidas no tienen `vendedor` y se generan idénticas
  byte a byte a main; Mercado Público usa el mismo generador sin cambios (`eett_vendedor_compat.test.mjs`).
* «Registrar compra»: el máximo a financiar es el total a pagar con despacho y se actualiza si cambia (opción B); el aporte
  precargado lo sigue mientras no se edite a mano (`e2e_eett_vendedor.mjs`, escritorio y celular).

## Recuperación

`BORRADOR-2026-11-11-vp-financiamiento-vendedor-deshacer.sql` quita funciones, disparadores y vistas nuevas. **No borra datos**:
si hay aportes, devoluciones o vendedores asignados, se conservan (solo lectura); si no hay, deja el catálogo idéntico al actual.
Volver a aplicar la migración reutiliza lo conservado.

## Pruebas

| Archivo | Qué prueba |
|---|---|
| `sql_financiamiento.test.mjs` (93) | Vendedor BFK sin cuenta, conversión, permisos, historial; compras anteriores sin informar; Kevin 100 %; devoluciones parcial/total/exceso/anulación; BFK sin deuda; aportes mixtos y parciales; reintentos; doble clic y operaciones simultáneas reales; Mercado Público intacto |
| `reglas_financiamiento.test.mjs` (12) | Reglas de la interfaz y cálculo idéntico a `vp_fin_resumen` sobre datos generados |
| `recuperacion.test.sh` (12) | Deshacer sin datos (catálogo idéntico), con datos (todo conservado), funcionamiento tras deshacer y volver a aplicar |
| `e2e_financiamiento.mjs` (66) | Navegador real en escritorio y celular: «Registrar compra» con financiamiento, sección Financiamiento, devoluciones, BFK, mixtos, respuesta perdida y reintento, filtro y asignación de vendedor, cotización, Finanzas (por vendedor y financiamiento), sin escrituras a Mercado Público |
| `ejecutar.sh` | Todo lo anterior + regresión completa de Ventas privadas, sesión y Mercado Público byte a byte contra `origin/main` |

`pgrest_local.mjs` reproduce el subconjunto de PostgREST que usa el módulo, para correr localmente donde no se puede descargar
PostgREST; el ensayo sobre la copia restaurada del respaldo usa **PostgREST 12.2.3 real** (bfk-respaldos, rama
`vpfin-ensayo-temporal`).
