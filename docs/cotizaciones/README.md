# Módulo Cotizaciones y EETT — BFK Datos

Rama `modulo-cotizaciones` (desde `main` 4cb5f92). Sin cambios en producción, sin migraciones aplicadas, sin merge ni despliegue sin autorización expresa.
Fuente principal: *BFK Datos — Especificación inicial: Cotizaciones y EETT* (octubre 2026), con el formato de referencia `1525570-33-COT26.pdf` y el Excel histórico `Master_MercadoPublico2020250121.xlsx`.

## 1. Alcance y corte histórico

> **Nota de alcance:** la biblioteca de productos, las cotizaciones y las EETT **parten vacías en octubre de 2026**. No se migran, reconstruyen ni importan fichas ni productos de operaciones anteriores. Las OC históricas permanecen sin modificación ni eliminación.

El módulo es independiente: tablas nuevas, una pantalla nueva (`Cotizaciones`) y una función de servidor nueva (`/api/producto`). No modifica OCs, eventos, financiamiento/FIFO, IVA mensual, F29, comisiones, banco ni entidades. La vinculación con una OC adjudicada guarda solo el código de la OC (texto) y no altera el flujo existente.

## 2. Reglas confirmadas por Kevin (11/10/2026)

| # | Regla | Dónde se cumple |
|---|---|---|
| 1 | La biblioteca comienza vacía; no se importan productos anteriores | SQL: tablas nuevas sin carga inicial (prueba S4) |
| 2 | Una cotización admite varios productos y proveedores | `cotizacion_items` + `cotizacion_envios` por proveedor/pedido |
| 3 | Un único PDF EETT, con una ficha independiente por producto | `lib/eettPdf.js` (pruebas P1–P5) |
| 4 | Precios de compra, despachos, enlaces y utilidades son solo internos | `fichaPublica()` / `cabeceraPublica()` son la única entrada del PDF (prueba P10); la biblioteca no guarda datos comerciales (S17) |
| 5 | Modalidad A: el despacho va en los unitarios; campo Despacho = $0 | `calcularCotizacion().totales.despacho_mercado_publico = 0` |
| 6 | Recargo configurable; 30% sugerido, nunca obligatorio | Recargo por cotización y por línea; `RECARGO_SUGERIDO = 0.30` solo como valor inicial |
| 7 | Compras con factura: distinguir IVA recuperable, costo neto y desembolso | Desglose: costo bruto, costo neto, IVA crédito, neto, IVA débito, total, utilidad neta, IVA a pagar |
| 8 | Productos aprobados quedan en la biblioteca compartida | `cz_guardar_producto` (solo datos técnicos) |

Reglas adicionales del documento: nunca asumir despacho gratis (una línea sin envío confirmado deja la cotización "pendiente"); marcar procedencia y fecha de consulta; edición manual donde falle la extracción; detectar discrepancias de modelo/marca sin corregirlas (caso de referencia: *Smart Tank 520* en el título y *580* en el modelo); reparto visible del envío compartido con redondeo que cuadre.

## 3. Datos (borrador, no aplicado)

`docs/migraciones/BORRADOR-2026-10-cotizaciones.sql` y su `-deshacer.sql`. Validado en un PostgreSQL local desechable (`docs/pruebas-cotizaciones/validar_sql.sh`, 24 comprobaciones): aplica en una transacción, no toca tablas existentes, lectura solo para perfiles BFK, sin escritura ni borrado directo (solo RPC), control de versiones con rechazo de guardados concurrentes, depósitos de archivos privados con nombre propio (`cz-productos`, `cz-eett`) que no adoptan ni modifican depósitos existentes, deshacer completo.

Adaptaciones al esquema real respecto de la especificación: `cliente` → `institucion` + `rut`; versiones completas en `cotizacion_versiones`; ficha congelada por línea en `cotizacion_items.especificaciones_aprobadas`; `productos_catalogo.fuente` guarda solo el dominio (el enlace comercial vive en la línea).

## 4. Fórmula de precio (CONFIRMADA por Kevin el 11/10/2026)

Por línea, con recargo *r*:
1. Costo bruto = cantidad × precio con IVA + envío asignado.
2. Costo neto = bruto ÷ 1,19 si hay factura; sin factura, el IVA no recuperable queda como costo.
3. IVA crédito = bruto − neto.
4. Venta neta = costo neto × (1 + r).
5. Unitario neto Mercado Público = venta neta ÷ cantidad, redondeado hacia arriba al peso.
6. Despacho Mercado Público = $0.

Totales: neto = Σ unitario × cantidad; IVA débito = 19% del neto; total = neto + IVA débito; utilidad neta = neto − costo neto; IVA neto estimado de la operación = débito − crédito.

> El IVA neto que muestra la cotización es una **estimación referencial de esa operación**. No es el F29 ni el IVA a pagar del mes, que se determina con todas las compras y ventas del período (módulo Impuestos).
Con todo comprado con factura, el resultado es idéntico al método histórico del Excel (`(gastos × 1,3) ÷ cantidad ÷ 1,19`).
Valores vigentes en `FORMULA` (`src/lib/cotizaciones.js`): `base: "neto"`, `redondeo: "arriba"`, `prorrateo: "valor"`.

Controles: no se pueden copiar precios a Mercado Público mientras existan costos o despachos pendientes de confirmar.

## 4b. Conexión con la base

El "modo prueba" (guardar solo en el dispositivo) se activa **únicamente** si Supabase confirma que las tablas del módulo no existen (HTTP 404 con código PGRST205/42P01). Cualquier otra falla (sin conexión, tiempo agotado, error 5xx, sesión vencida) muestra un error con "Reintentar" y no guarda nada, ni en la base ni en el dispositivo.

## 5. Casos de prueba (datos simulados)

| Caso del documento | Prueba |
|---|---|
| Productos múltiples / ficha por producto | `pdf_eett.test.mjs` P1–P5, `cotizaciones.test.mjs` |
| Envíos compartidos y redondeo que cuadra | `cotizaciones.test.mjs` (reparto exacto) |
| Dirección desconocida / envío sin confirmar | `cotizaciones.test.mjs` (pendientes, nunca gratis) |
| Precio sin IVA / IVA incluido | `cotizaciones.test.mjs` |
| Decimales y redondeo | `cotizaciones.test.mjs` |
| Enlaces caídos / páginas sin datos | `extraer.test.mjs` |
| PDF sin datos comerciales | `pdf_eett.test.mjs` P10 |
| Permisos entre usuarios / anónimos | `validar_sql.sh` S7–S11, S18 |
| Vinculación futura a OC | `cotizaciones.oc_codigo` (texto), sin tocar OCs (S3, S24) |

## 6. Pendientes

1. Diseño del PDF: se mantiene el actual, basado en la referencia 1525570-33-COT26 (la plantilla Excel no se requiere por ahora).
2. Qué proveedores entregan costo de envío confiable por dirección: por ahora **todo envío se verifica manualmente** y queda "por verificar" hasta confirmarlo.
3. Autorización para aplicar el SQL en Supabase (con respaldo cifrado previo) y para el merge/despliegue.
