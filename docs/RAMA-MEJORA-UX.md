# Rama mejora-ux

Rama de trabajo para las mejoras de BFK Ventas. Parte de `main` en el commit cd4b178.

Reglas:
- No se trabaja sobre `main`. Lo que se apruebe se une a `main` solo con autorizacion expresa.
- La vista previa de esta rama usa la MISMA base de datos real que produccion: solo para lectura.
- No crear ni modificar OC, compras, entregas, facturas, pagos, financiamiento, gastos, usuarios ni roles desde la vista previa.
- Las pruebas que escriben datos se haran en una base Supabase separada restaurada desde el respaldo.
