// Índice de secciones de la ficha de una OC, para las pruebas de navegador.
// En computador el índice es una fila de accesos; en celular y tableta angosta es un solo control «Ir a una sección» que despliega
// la lista completa (12/11/2026). Las pruebas validan el comportamiento —se llega a cada sección desde el índice—, no su distribución.
// «ambito» es la página o cualquier contenedor de la ficha (Locator).
const pagina = (ambito) => (typeof ambito.page === "function" ? ambito.page() : ambito);

export async function abrirIndiceFicha(ambito) {
  const b = ambito.locator("[data-indice-abrir]").first();
  if ((await b.count()) && (await b.getAttribute("aria-expanded")) !== "true") { await b.click(); await pagina(ambito).waitForTimeout(150); }
  return ambito.locator("[data-indice-ficha]").first();
}

// Va a una sección por su título (texto o expresión regular), abriendo antes la lista si el índice está en su forma compacta.
export async function irSeccionFicha(ambito, titulo) {
  const indice = await abrirIndiceFicha(ambito);
  await indice.locator("button:not([data-indice-abrir])", { hasText: titulo }).first().click();
}

// Títulos de las secciones que ofrece el índice (abre la lista compacta para leerlos y la vuelve a cerrar).
export async function seccionesDelIndice(ambito) {
  const b = ambito.locator("[data-indice-abrir]").first(); const compacto = (await b.count()) > 0;
  const indice = await abrirIndiceFicha(ambito);
  const titulos = await indice.locator("button:not([data-indice-abrir])").evaluateAll((els) => els.map((e) => e.innerText.replace(/Requiere atención/g, "").trim()));
  if (compacto && (await b.getAttribute("aria-expanded")) === "true") { await b.click(); await pagina(ambito).waitForTimeout(120); }
  return titulos;
}
