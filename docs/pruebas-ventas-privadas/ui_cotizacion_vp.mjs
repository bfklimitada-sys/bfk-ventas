// Acciones de interfaz de la cotización privada (misma experiencia que Mercado Público), compartidas por las pruebas e2e.
// Solo usan selectores del editor y de la ventana «Ingresar/Editar producto» (EditorFicha), los mismos de Mercado Público.
export const hoja = (p) => p.locator('[data-hoja-lateral="ficha-cotizacion"]');
export const ventanaFicha = (p) => p.locator("[data-editor-ficha]");
export const pestana = async (p, k) => { await hoja(p).locator(`[role="tab"][data-tab="${k}"]`).click(); await p.waitForTimeout(250); };
export const dinero = async (loc) => Number((await loc.innerText()).replace(/[^\d-]/g, ""));
export const fila = (p, dato) => hoja(p).locator(`[data-fila="${dato}"] > *`).last();
// Imagen PNG mínima válida (1×1) para probar «Agregar foto» (se normaliza a JPEG en el navegador).
export const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC", "base64");

export async function elegirCliente(p, texto, rut) {
  const h = hoja(p);
  await h.locator("[data-buscar-cliente]").fill(texto); await p.waitForTimeout(150);
  await h.locator(`[data-opcion-cliente="${rut}"]`).click(); await p.waitForTimeout(200);
}

// Llena la ventana del ítem. d: {tipo, nombre, marca, modelo, color, generales, especificaciones, descripcion, foto, enlace, proveedor,
// cantidad, unidad, codigo, precio, incluyeIva, conFactura, despacho: {modo:"propio"|"existente", monto, estado, evidencia, indice}, biblioteca}
export async function llenarFicha(p, d) {
  const v = ventanaFicha(p); await v.waitFor();
  if (d.tipo) { await v.locator(`[data-tipo="${d.tipo}"]`).click(); await p.waitForTimeout(150); }
  const campo = (k) => v.locator(`[data-campo="${k}"]`);
  for (const k of ["nombre", "marca", "modelo", "color", "generales", "especificaciones", "descripcion", "enlace", "proveedor", "cantidad", "unidad", "codigo"]) {
    if (d[k] !== undefined) await campo(k).fill(String(d[k]));
  }
  if (d.precio !== undefined) await campo("precio").fill(String(d.precio));
  if (d.foto) { await v.locator('input[type="file"]').setInputFiles({ name: "foto.png", mimeType: "image/png", buffer: PNG }); await v.locator("[data-imagen-ficha]").first().waitFor({ timeout: 8000 }); }
  if (d.incluyeIva !== undefined) { const cb = v.getByLabel("El precio publicado incluye IVA"); if ((await cb.isChecked()) !== d.incluyeIva) await cb.click(); }
  if (d.conFactura !== undefined) { const cb = v.getByLabel("Se compra con factura"); if ((await cb.isChecked()) !== d.conFactura) await cb.click(); }
  if (d.despacho) {
    const x = d.despacho;
    if (x.modo === "existente") { await v.locator('[data-despacho-modo="existente"]').click(); await p.waitForTimeout(150); }
    if (x.monto !== undefined) await campo("monto-despacho").fill(String(x.monto));
    if (x.estado) await campo("estado-despacho").selectOption(x.estado);
    if (x.evidencia !== undefined) await campo("evidencia-despacho").fill(x.evidencia);
  }
  if (d.biblioteca === false) { const cb = v.locator("[data-guardar-biblioteca] input"); if (await cb.count() && await cb.isChecked()) await cb.uncheck(); }
}
export async function guardarFicha(p) {
  await ventanaFicha(p).locator("[data-guardar-ficha]").click(); await p.waitForTimeout(400);
  const err = await ventanaFicha(p).locator('[data-aviso-linea="error-ficha"]').count().catch(() => 0);
  return !(await ventanaFicha(p).count()) || !err;
}
export async function ingresarManual(p, d) {
  await hoja(p).locator("[data-ingreso-manual]").click(); await llenarFicha(p, d); return guardarFicha(p);
}
export async function desdeBiblioteca(p, nombre, d) {
  await hoja(p).locator("[data-desde-biblioteca]").click();
  await p.locator(`[data-producto-biblioteca="${nombre}"]`).first().click(); await p.waitForTimeout(300);
  await llenarFicha(p, d); return guardarFicha(p);
}
export async function fijarPrecio(p, i, precio, descuento) {
  const t = hoja(p).locator(`[data-precio-item="${i}"]`);
  await t.locator(`[data-precio-unitario="${i}"]`).fill(String(precio));
  if (descuento !== undefined) await t.locator(`[data-campo="descuento-${i}"]`).fill(String(descuento));
}
export async function guardarCotizacion(p) { await hoja(p).locator("[data-guardar-cotizacion]").click(); await p.waitForTimeout(2200); }
export async function registrarEstado(p, accion) {
  await hoja(p).locator(`[data-accion-cot="${accion}"]`).click();
  await p.locator('[data-ventana="modal-estado"] [data-confirmar-estado]').click(); await p.waitForTimeout(1600);
}
