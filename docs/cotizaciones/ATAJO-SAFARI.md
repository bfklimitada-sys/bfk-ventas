# Atajo "Enviar a BFK": captura de productos desde Safari (iPhone)

Comparte una publicación de Falabella, Mercado Libre u otra tienda desde Safari y llega a **BFK Datos → Cotizaciones** lista para revisar: nombre, marca, modelo, descripción, especificaciones, imágenes y el enlace original. El precio y la disponibilidad quedan como datos internos; el envío siempre queda **por verificar** para la dirección del cliente.

## Instalar (una sola vez)
1. En BFK Datos → **Cotizaciones** → **Captura desde Safari (iPhone)** → toca **Copiar código del atajo**.
2. Abre **Atajos** → **+** → nombre: **Enviar a BFK**.
3. Toca **ⓘ** → activa **Mostrar en hoja para compartir** → tipos: deja solo **Páginas web de Safari**.
4. Agrega la acción **Ejecutar JavaScript en página web**, borra el texto de ejemplo y **pega** el código.
5. Agrega la acción **Abrir URL** (toma el resultado del JavaScript). Guarda.
6. **Ajustes → Atajos → Avanzado** → activa **Permitir ejecutar scripts**.

## Usar
Safari → producto → **Compartir** → **Enviar a BFK**. BFK Datos se abre en Cotizaciones con el aviso **Producto capturado en Safari**: crea una cotización nueva con él o toca una existente para agregarlo. Se abre la ficha para revisión; nada se guarda hasta que tú lo confirmes.

## Cómo funciona y límites
- El atajo **lee la página que tú ya estás viendo** en Safari; no hace consultas nuevas al proveedor ni elude bloqueos. Si la página muestra una verificación, primero complétala en Safari como siempre.
- Usa el mismo extractor del módulo (datos estructurados, datos de la página, Open Graph y tablas de especificaciones).
- Los datos viajan en la parte de la dirección después de `#`, que el navegador **no envía a ningún servidor**.
- Las imágenes se traen por su enlace; si una no llega, agrégala con **Agregar foto** (por ejemplo, una captura de pantalla).
- BFK Datos debe estar con sesión iniciada **en Safari** (si usas BFK Datos como app de pantalla de inicio, inicia sesión también en Safari una vez).
- Si cambia el extractor, se regenera el código con `node scripts/generar-atajo.mjs` y hay que volver a copiarlo en el atajo.
