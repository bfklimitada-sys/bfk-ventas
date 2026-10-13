# Módulo Cotizaciones y EETT — BFK Datos

## 0. Actualización definitiva (octubre 2026) — rama `cotizaciones-definitiva`

Flujo principal: **Datos → Productos → Precios → EETT**. Sin merge, despliegue ni migración sin autorización de Kevin.

| Tema | Qué hace | Dónde |
|---|---|---|
| Compra Ágil | «Enlace o código de Compra Ágil» + «Consultar y completar». La API oficial se consulta desde el servidor; vista previa; lo que reemplazaría un dato ya escrito queda sin marcar; no toca fecha de emisión, estado, productos ni precios; los productos importados quedan como *requerimientos del comprador* | `api/compra-agil.mjs`, `ImportarCompraAgil.jsx`, `propuestaCompraAgil()` |
| Productos | «Ingresar manual» es la acción principal; «Desde la biblioteca de fichas» se mantiene. Capturas/OCR, atajo de Safari, lectura de enlaces, IA y pegar texto quedan fuera del flujo (su código y sus datos se conservan). Sin campo Disponibilidad (el dato guardado no se borra) | `EditorCotizacion.jsx`, `EditorFicha.jsx` |
| Enlace de compra | Se conserva toda la vida de la cotización: «Abrir publicación» / «Sin enlace registrado»; en adjudicadas, «Ir a comprar». Si se cambia, el primero queda como `enlace_original`. Nunca va al PDF | `EditorCotizacion.jsx` |
| Despacho | En el mismo formulario del producto: individual, compartido (se ingresa una vez y se reparte según valor), «Sin costo (confirmado)», cómo se verificó y dirección verificada (si cambia, pide verificar de nuevo). Nunca se asume gratis ni se duplica | `EditorFicha.jsx` |
| Precios | Tarjeta grande «VALOR UNITARIO NETO PARA MERCADO PÚBLICO» por producto con «Copiar valor» (solo dígitos). Resumen: costo total de adquisición, recargo, unitarios, total neto, total con IVA y ganancia neta. Sin IVA crédito/débito ni estimaciones de F29. Fórmulas sin cambios | `EditorCotizacion.jsx`, `calcularCotizacion()` |
| Vendedor | Vendedor responsable en Datos: catálogo existente de BFK (solo lectura) + registro sin duplicados en `cotizacion_vendedores` (no toca comisiones) | `cz_registrar_vendedor` |
| EETT | Reproduce la plantilla Excel «Pág.1» (banda azul, logo, tabla del proceso en la 1.ª página, franja gris del nombre, 2 fotos, CARACTERÍSTICAS, dos columnas con renglones, pie azul) + bloque discreto «Elaboración de especificaciones técnicas» (empresa, vendedor, elaborado por = cuenta autenticada, fecha, cotización, versión) | `src/lib/eettPdf.js` |
| Vista previa | Mismo generador, todas las páginas (pdf.js bajo demanda), PC y celular; no guarda nada. Alternativa: visor del navegador | `VistaPreviaEETT.jsx` |
| Generar y descargar | Valida → guarda (solo si hay cambios; sin versiones vacías; control de concurrencia) → genera desde lo guardado → descarga en el dispositivo → registra **solo metadatos**. Si la descarga falla, avisa que los datos sí quedaron guardados y permite reintentar | `EditorCotizacion.jsx` |
| Adjudicadas | Lo ofertado queda protegido también en el servidor: cada línea conserva su identificador y no se puede quitar, agregar ni sustituir (marca y modelo bloqueados), ni cambiar cantidad o unitario; el vínculo con la OC solo lo cambia un administrador. Se pueden corregir datos técnicos, actualizar enlaces de compra y regenerar la EETT | `cz_guardar_cotizacion_v2` |
| Rendimiento | Listado paginado (20) con búsqueda y filtros por código, nombre, institución, vendedor y estado; biblioteca paginada sin descargar imágenes; miniaturas progresivas; imágenes comprimidas (1000 px, JPEG 0,8) y nunca re-subidas | `cotizacionesDatos.js`, `ImagenFicha.jsx` |
| Eliminar | Solo administradores; confirmación escrita (código o nombre); «Cancelar» / «Eliminar definitivamente»; bloqueado en adjudicadas o con OC; borra solo lo asociado; auditoría (quién/cuándo); no toca biblioteca, imágenes, PDF ni otros módulos | `EliminarCotizacion.jsx`, `cz_eliminar_cotizacion` |

### Ticket de ChileCompra (API de Compra Ágil)
La API oficial (Beta) es `GET https://api2.mercadopublico.cl/v2/compra-agil/{codigo}` con la cabecera `ticket`. Sin ticket responde 401.
1. Solicitar el ticket en https://www.chilecompra.cl/api/ → «Pide tu ticket» (Clave Única). Llega por correo.
2. Guardarlo en Vercel (proyecto `bfk-ventas`) como variable de entorno **`MP_TICKET_COMPRA_AGIL`** (si no existe, la función prueba con el `MP_TICKET` actual de las OC).
3. Diagnóstico sin sesión: `GET /api/compra-agil?diagnostico=1` responde solo si hay ticket y el código HTTP de ChileCompra (nunca el ticket ni datos).
4. Nunca se expone al navegador. Sin ticket válido, la pantalla lo informa y el ingreso manual sigue disponible. No hay respuestas simuladas.
Comuna y ciudad no vienen en la API: se completan a mano.

### Migración v2 (preparada, NO aplicada)
`docs/migraciones/BORRADOR-2026-10-cotizaciones-v2.sql` (+ `-deshacer.sql`). Validada en PostgreSQL local con `docs/pruebas-cotizaciones/validar_sql_v2.sh` (39 comprobaciones).
Hasta aplicarla, la app funciona con la base actual: guarda la cotización y registra cada EETT **sin subir el PDF**; avisa que el vendedor y los datos importados de Compra Ágil se guardarán cuando se instale; la eliminación no se muestra.

### Pruebas
`cotizaciones.test.mjs` (fórmulas + caso «Mesa plegable» 56.669), `pdf_eett.test.mjs` (formato y privacidad del PDF), `validar_sql_v2.sh` (migración) y `e2e_definitiva.mjs` (interfaz completa con servicios simulados; reemplaza a `e2e_cotizaciones.mjs`, que probaba el flujo anterior de capturas).

---

## Historial (versión inicial, octubre 2026)

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

1. Diseño del PDF: reemplazado por la plantilla Excel oficial (ver §0).
2. Qué proveedores entregan costo de envío confiable por dirección: por ahora **todo envío se verifica manualmente** y queda "por verificar" hasta confirmarlo.
3. Autorización para aplicar el SQL en Supabase (con respaldo cifrado previo) y para el merge/despliegue.

## 7. Captura universal de productos (iPhone, Android y PC)

Sin instalar atajos ni extensiones:
1. **Enlace**: se pega el enlace del producto y BFK intenta leer la publicación (`/api/producto`). Si la tienda lo bloquea (hoy Falabella y Mercado Libre desde servidores), se informa sin prometer lectura automática.
2. **Capturas de pantalla**: botón «Desde capturas de pantalla» (hasta 4 imágenes). Se leen con **OCR en el propio dispositivo** (Tesseract.js, gratuito, sin credenciales; las imágenes no salen del equipo; el lector y el modelo de español se sirven desde el propio dominio de BFK Datos, copiados al compilar por `vite.config.js`).
3. **IA opcional** (`/api/interpretar`, Claude): queda preparada pero **inactiva** hasta que exista la variable `ANTHROPIC_API_KEY` en Vercel (servicio de pago por uso; requiere autorización). Con IA activa se usa primero la IA y, si falla, el OCR.
4. La ficha se muestra para revisión y corrección antes de guardar; luego se agrega a una cotización nueva o existente y se genera la EETT.

Reglas (iguales para OCR e IA, `src/lib/capturaImagen.js`): solo lo visible; si se leen varios precios no se elige ninguno; un precio leído queda marcado para verificar; la disponibilidad nunca se supone; los atributos comerciales no pasan a la ficha; el despacho queda por verificar según la dirección del cliente. Los cálculos, IVA, recargo y reparto de despacho no cambian.

El acceso destacado al atajo de Safari se retiró de la pantalla; las capturas que aún lleguen desde el atajo se siguen recibiendo (docs/cotizaciones/ATAJO-SAFARI.md).
