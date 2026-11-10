import assert from 'node:assert/strict';
import handler from '../../api/compra-agil.mjs';

// Red simulada: nunca utiliza el ticket ni los servicios de producción.
const originalFetch = globalThis.fetch;
const originalTicket = process.env.MP_TICKET_COMPRA_AGIL;
const originalFallback = process.env.MP_TICKET;
const codigo = '1062018-144-COT26';
let caso = 0;
async function ejecutar(status, fallo) {
  const llamadas = [];
  const id = `prueba-anterior-${caso++}`;
  globalThis.fetch = async (url, init) => {
    if (url.includes('/auth/v1/user')) return Response.json({ id });
    if (url.includes('/rest/v1/perfiles')) return Response.json([{ id, rol: 'usuario' }]);
    assert.equal(url, `https://api2.mercadopublico.cl/v2/compra-agil?id=${codigo}`);
    assert.equal(init.headers.ticket, 'solo-prueba');
    llamadas.push(url);
    if (fallo) throw new DOMException('simulado', 'TimeoutError');
    return Response.json(status === 200 ? { payload: { items: [{ codigo, nombre: 'Producto de prueba' }] } } : {}, { status });
  };
  const out = {};
  const res = { setHeader() {}, status(s) { out.status = s; return this; }, json(b) { out.body = b; return this; } };
  await handler({ query: { codigo }, headers: { authorization: 'Bearer prueba' } }, res);
  assert.equal(llamadas.length, 1, 'una sola consulta, sin reintento ni detalle');
  return out;
}
try {
  process.env.MP_TICKET_COMPRA_AGIL = 'solo-prueba';
  delete process.env.MP_TICKET;
  const ok = await ejecutar(200);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.datos.codigo, codigo);
  for (const [status, expected, code] of [[401,502,'TICKET_INVALIDO'],[403,502,'TICKET_INVALIDO'],[404,404,'NO_ENCONTRADA'],[429,429,'CUOTA'],[504,502,'ERROR_API']]) {
    const r = await ejecutar(status); assert.equal(r.status, expected); assert.equal(r.body.codigo, code);
  }
  assert.equal((await ejecutar(200, true)).body.codigo, 'DEMORA_API');
  delete process.env.MP_TICKET_COMPRA_AGIL;
  process.env.MP_TICKET = 'solo-prueba';
  assert.equal((await ejecutar(200)).status, 200, 'conserva el ticket compartido anterior');
  globalThis.fetch = async () => { throw new Error('no debe llamar sin sesión'); };
  const out = {};
  await handler({ query: { codigo }, headers: {} }, { status(s) { out.status=s; return this; }, json(b) { out.body=b; return this; } });
  assert.equal(out.status, 401);
  console.log('9 escenarios correctos; cero consultas reales');
} finally {
  globalThis.fetch = originalFetch;
  if (originalTicket === undefined) delete process.env.MP_TICKET_COMPRA_AGIL; else process.env.MP_TICKET_COMPRA_AGIL=originalTicket;
  if (originalFallback === undefined) delete process.env.MP_TICKET; else process.env.MP_TICKET=originalFallback;
}
