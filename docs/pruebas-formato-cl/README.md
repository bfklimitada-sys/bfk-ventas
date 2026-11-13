# Formato numérico chileno en Cotizaciones (13/11/2026)

Regla (Kevin): punto = solo miles (grupos de 3), coma = solo decimales; un punto nunca es decimal; se valida la estructura
antes de convertir y lo ambiguo o incorrecto se rechaza con mensaje, sin guardar. La base guarda el número; el formato es solo
para mostrar. `src/lib/numeroCL.js` (lectura y presentación) y `src/components/ui/CampoNumeroCL.jsx` (mismo campo al escribir,
pegar y editar).

Campos: Mercado Público (precio de compra, cantidad, despacho, presupuesto del comprador, recargo general y por producto),
Cotizaciones privadas (además precio unitario de venta, descuento y recargo) y «Comprar desde la cotización» en ambos canales
(cantidad, precio de compra unitario, despacho real y adicional). Un valor inválido deja la línea pendiente (no se copia ni se
calcula como 0) y bloquea guardar. Despachos: pesos enteros (la base de ventas privadas los guarda sin decimales).

| Archivo | Qué prueba |
|---|---|
| `numero.test.mjs` | Las 6 pruebas obligatorias, pegado desde tiendas, estructuras inválidas, presentación, ida y vuelta, costos/IVA/márgenes/totales idénticos, bloqueo de valores inválidos (56) |
| `e2e_formato.mjs` | Pantalla (escritorio y celular): edición de una cotización existente, escribir, pegar con el portapapeles, rechazo de «1250.50» y «25.99», bloqueo de guardar, valores guardados (38) |
