# Retiro de Inteligencia Comercial

Preparado sobre main `7c97248`. No publicado ni aplicado a producción.

- Se elimina el módulo ejecutable completo: endpoint, componentes, librerías, pestaña de Administración y configuración de su función en Vercel.
- `api/compra-agil.mjs` se restaura exactamente desde `367254a`, anterior a la introducción del módulo. Consulta normal: listado filtrado por código, un intento de 20 segundos; función Vercel de 30 segundos.
- Se conservan las variables compartidas `MP_TICKET_COMPRA_AGIL` / `MP_TICKET`. No se conoce ni se ha restaurado su valor histórico: Git no contiene secretos de Vercel.
- No cambia ningún editor de cotizaciones, cálculo, PDF o EETT de Mercado Público ni de Ventas privadas.
- Las migraciones históricas quedan como registro de lo instalado, no como código ejecutable. Los respaldos existentes deben conservarse.

Validación local: compilación correcta, listado 8/8, cotizaciones 43/43 y 9 escenarios del endpoint con red simulada. El endpoint es idéntico byte a byte al de `367254a`. Sin consultas reales a ChileCompra. La compilación mantiene advertencias previas (fontSize duplicado, eval de pdfjs y tamaño de bundles).

Pendiente operativo:

1. Publicar el código validado en main y comprobar el despliegue.
2. Obtener acceso al repositorio de respaldos para inventariar y retirar exclusivamente flujos/ramas temporales de IC. Conservar los respaldos diarios de base y adjuntos y las credenciales compartidas de Compra Ágil.
3. Crear y restaurar un respaldo nuevo; ensayar `migraciones/BORRADOR-2026-11-10-retirar-ic.sql` contra esa copia. El SQL es un borrador SIN ensayo: elimina solo objetos explícitos de IC, sin CASCADE, en transacción. Revisar dependencias reales antes de aplicarlo. Conservar el respaldo como recuperación de los históricos eliminados.
4. Aplicar el SQL verificado y comprobar que no cambian datos comerciales, políticas ni permisos ajenos a IC.
5. Comprobar una consulta autenticada. El retiro no demuestra que la respuesta externa HTTP 504 esté resuelta.

Bloqueos observados: GitHub create_tree responde 403 «Resource not accessible by integration». El repositorio bfk-respaldos no es accesible mediante el conector ni el clon local. No hay una sesión de navegador abierta. No se ha modificado producción.
