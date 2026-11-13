# Pruebas del F29 con desglose (13/11/2026)

| Archivo | Qué prueba | Cómo |
|---|---|---|
| `reglas.test.mjs` | Prueba de aceptación de octubre 2026 (todos los valores del informe), declaración sin pago, pago único (reenvío y volver a guardar sin duplicar), F29 en $0 frente a dato pendiente, período con IVA a pagar y pagos parciales, registros históricos **idénticos a la versión anterior** (comisiones, F29, retenciones, Caja), lectura de montos del informe | `node docs/pruebas-f29-desglose/ejecutar.mjs /ruta/a/main` |
| `e2e_ui.mjs` | Interfaz con Supabase simulado: Gastos → Impuestos, completar período incompleto, formulario de octubre copiado del informe, vista del período, pago con doble toque, volver a guardar, histórico en su formato, comisión de octubre, F29 en $0 | `npx vite build && npx vite preview --port 4181` y `node docs/pruebas-f29-desglose/e2e_ui.mjs http://127.0.0.1:4181/ celular\|escritorio` |
| `e2e_copia.mjs` | Lo mismo sobre una **copia restaurada** con PostgREST real (RLS y permisos); modo `lectura` para verificar el sitio publicado sin escribir | ver el encabezado del archivo |
| `comparar_real.mjs` | Con los datos reales de la copia: versión anterior vs nueva en comisiones de cada vendedor y mes, F29 por período, Caja e informe mensual; solo se aceptan diferencias en los períodos que la prueba registró | `node empaquetar.mjs /ruta/a/main salida.mjs` y luego `PGRST_URL=… JWT_SECRET=… USUARIO=… node salida.mjs 2026-10,2026-11,2026-12` |

Reglas (ver `src/lib/f29Desglose.js`): IVA neto = débito − crédito; IVA a pagar = máx(0, IVA neto − remanente anterior reajustado);
remanente para el mes siguiente = máx(0, remanente − IVA neto); total F29 = IVA a pagar + PPM + otras retenciones (impuestos y caja);
descuento para comisiones = IVA neto con signo + PPM + otras retenciones, una sola vez antes de dividir. Vacío = pendiente; 0 = $0.
Guardar el F29 nunca crea ni modifica gastos; el pago se registra aparte (un gasto «Impuesto SII» con monto y fecha reales).
