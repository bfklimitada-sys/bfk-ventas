# Fecha de Chile en los valores predeterminados (12/11/2026)

**Defecto corregido.** Los formularios de Mercado Público proponían la fecha con `new Date().toISOString().slice(0,10)`, que es el
día **UTC**. Entre las 21:00 y la medianoche de Chile en horario de verano (20:00 en invierno) UTC ya va en el día siguiente, así
que «Ingresar compra», «Entrega», «Factura», «Pago», «Registrar gasto», abonos y aportes a financiadores, saldo del banco, IVA
mensual, incidentes de post-venta, documentos SII y la OC manual proponían **mañana**. Proyectos y Ventas privadas no tenían el
problema (ya usaban la fecha de Chile o la del equipo).

**Corrección.** `src/lib/fechaChile.js` → `hoyChile()` entrega AAAA-MM-DD en `America/Santiago` con `Intl.DateTimeFormat`
(sin restar horas a mano: el cambio de hora lo resuelve la base de zonas del navegador). Los períodos rápidos de Compras
(«Este mes», «Mes pasado», «90 días», «Este año») ahora se cuentan desde ese mismo día.

**Qué no cambia.**
- Ningún registro existente: solo cambia el valor que el formulario **propone**; la persona puede seguir eligiendo otra fecha.
- Los timestamps completos (`created_at`, `updated_at`, `fecha_hora`, auditoría) siguen en UTC con `toISOString()`.
- La clave del contador diario de la API de Mercado Público (`mp_uso_diario`) sigue siendo el día UTC, igual que en el servidor.
- La aritmética de fechas puras (sumar días en Agenda, vencimientos) no usa zona y no se tocó.

**Pruebas.**
- `fecha_chile.test.mjs` — 31 casos: 23:30 / 23:59:59 / medianoche en verano (UTC−3) e invierno (UTC−4); el fin del horario de
  verano (sábado 4 de abril de 2026, la hora 23:00 se repite) y su inicio (domingo 6 de septiembre, la hora 00:00 no existe);
  fin de mes, fin de año y 29 de febrero. Se ejecuta con el reloj del equipo en UTC, Santiago, Tokio y Honolulu:
  `for z in UTC America/Santiago Asia/Tokyo Pacific/Honolulu; do TZ=$z node docs/pruebas-fechas/fecha_chile.test.mjs; done`
- `e2e_fecha_formularios.mjs` — en el navegador, con el reloj fijado en ocho instantes (incluidos los dos cambios de hora y un
  equipo configurado en otra zona), abre Compra, Entrega, Factura, Pago y Registrar gasto y lee la fecha propuesta. Supabase
  simulado. En esta rama: 48 de 48. En la versión publicada (antes de la corrección): 25 fallas, todas «propone el día siguiente».
