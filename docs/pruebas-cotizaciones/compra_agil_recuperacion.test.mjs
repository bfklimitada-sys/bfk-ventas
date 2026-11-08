import assert from 'node:assert/strict';
import { consultarListadoConRecuperacion as consultar } from '../../api/compra-agil.mjs';
const codigo='1062018-144-COT26';
let total=0;
async function caso(nombre, pasos, verificar, opciones={}) {
  let llamadas=0, pausas=[];
  const f=async (url,init)=>{assert.equal(url,`https://api2.mercadopublico.cl/v2/compra-agil?id=${codigo}`);assert.equal(init.headers.ticket,'prueba');return pasos[llamadas++](init);};
  const r=await consultar(codigo,'prueba',{f,esperar:async(ms)=>pausas.push(ms),...opciones});
  verificar(r,llamadas,pausas); total++; console.log('OK',nombre);
}
const ok=()=>new Response(JSON.stringify({payload:{items:[{codigo}]}}));
const demora=()=>{throw new DOMException('demora','TimeoutError');};
await caso('éxito sin duplicar',[ok],(r,n)=>{assert.equal(n,1);assert.equal(r.cuerpo.payload.items[0].codigo,codigo);});
await caso('recupera timeout',[demora,ok],(r,n)=>{assert.equal(n,2);assert.equal(r.status,200);});
await caso('corta tras dos timeouts',[demora,demora],(r,n)=>{assert.equal(n,2);assert.equal(r.falla,'demora');});
await caso('recupera cuerpo interrumpido',[()=>({text:async()=>{throw new DOMException('body','AbortError');}}),ok],r=>assert.equal(r.status,200));
for (const status of [401,403,404]) await caso(`no reintenta ${status}`,[()=>new Response('{}',{status})],(r,n)=>{assert.equal(n,1);assert.equal(r.status,status);});
await caso('recupera 503',[()=>new Response('{}',{status:503}),ok],r=>assert.equal(r.status,200));
await caso('respeta Retry-After',[()=>new Response('{}',{status:429,headers:{'retry-after':'3'}}),ok],(r,n,p)=>{assert.equal(n,2);assert.deepEqual(p,[3000]);});
await caso('no ignora Retry-After largo',[()=>new Response('{}',{status:429,headers:{'retry-after':'120'}})],(r,n,p)=>{assert.equal(n,1);assert.equal(r.status,429);assert.deepEqual(p,[]);});
await caso('fecha HTTP Retry-After',[()=>new Response('{}',{status:429,headers:{'retry-after':new Date(5000).toUTCString()}}),ok],(r,n,p)=>assert.deepEqual(p,[5000]),{ahora:()=>0});
await caso('JSON inválido no se inventa',[()=>new Response('no json')],(r,n)=>{assert.equal(r.cuerpo,null);assert.equal(n,1);});
await caso('error de red recuperable',[()=>{throw new TypeError('network');},ok],r=>assert.equal(r.status,200));
await caso('agotamiento presupuesto impide reintento',[demora],(r,n)=>assert.equal(n,1),{presupuestoMs:500});
console.log(`${total} pruebas correctas`);

// 08/11/2026: tiempos por intento y la respuesta 504 de la pasarela de ChileCompra («Endpoint request timed out»).
{
  let t = 0; const reloj = () => t;
  const lento = (ms, status, cuerpo) => async () => { t += ms; return { status, headers: new Headers(), text: async () => { t += 5; return cuerpo; } }; };
  const r = await consultar(codigo, 'prueba', { f: (() => { const p = [lento(29500, 504, '{"message": "Endpoint request timed out"}'), lento(100, 200, JSON.stringify({ payload: { items: [{ codigo }] } }))]; let i = 0; return async () => p[i++](); })(), ahora: reloj, esperar: async (ms) => { t += ms; } });
  assert.equal(r.status, 200); assert.equal(r.intentos, 2); assert.equal(r.detalle.length, 2);
  assert.deepEqual(r.detalle[0], { ruta: 'listado', http: 504, ms_cabeceras: 29500, ms_cuerpo: 29505, pasarela: 'Endpoint request timed out' });
  assert.equal(r.detalle[1].http, 200); assert.equal(r.detalle[1].ms_cabeceras, 100);
  total++; console.log('OK tiempos por intento y 504 de la pasarela, recupera en el segundo');
}
{
  const r = await consultar(codigo, 'prueba', { f: async () => { throw new DOMException('demora', 'TimeoutError'); }, esperar: async () => {} });
  assert.equal(r.falla, 'demora'); assert.equal(r.detalle.length, 2); assert.equal(r.detalle[0].falla, 'sin_cabeceras_demora');
  total++; console.log('OK demora sin cabeceras registrada por intento (dos intentos como máximo)');
}
{
  let llamadas = 0;
  const r = await consultar(codigo, 'prueba', { f: async () => { llamadas++; return new Response('{"message": "Endpoint request timed out"}', { status: 504 }); }, esperar: async () => {} });
  assert.equal(llamadas, 2); assert.equal(r.status, 504); assert.equal(r.detalle[1].pasarela, 'Endpoint request timed out');
  total++; console.log('OK dos 504 seguidos: se detiene en dos consultas');
}
// Manejador publicado con la red simulada: dos 504 de la pasarela → mensaje claro, sin una tercera consulta.
{
  const { default: handler } = await import('../../api/compra-agil.mjs');
  process.env.MP_TICKET_COMPRA_AGIL = 'prueba'; const orig = globalThis.fetch; let aCC = 0; const logs = []; const info = console.info; console.info = (...a) => logs.push(a.join(' '));
  globalThis.fetch = async (url) => { const u = String(url);
    if (u.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: 'u-prueba' }));
    if (u.includes('/rest/v1/perfiles')) return new Response(JSON.stringify([{ id: 'u-prueba', rol: 'usuario' }]));
    if (u.includes('mercadopublico.cl')) { aCC++; return new Response('{"message": "Endpoint request timed out"}', { status: 504 }); }
    throw new Error('inesperado ' + u); };
  const out = {}; const res = { setHeader() {}, status(c) { out.code = c; return this; }, json(b) { out.body = b; return this; } };
  try { await handler({ query: { q: codigo }, headers: { authorization: 'Bearer x' } }, res); } finally { globalThis.fetch = orig; console.info = info; }
  assert.equal(aCC, 2); assert.equal(out.code, 502); assert.equal(out.body.codigo, 'CHILECOMPRA_SIN_RESPUESTA');
  const reg = JSON.parse(logs.find((l) => l.startsWith('compra_agil_consulta')).slice('compra_agil_consulta '.length));
  assert.equal(reg.http, 504); assert.equal(reg.por_intento.length, 2); assert.equal(reg.por_intento[0].pasarela, 'Endpoint request timed out'); assert.ok('ms_cabeceras' in reg.por_intento[0] && 'ms_cuerpo' in reg.por_intento[0]);
  total++; console.log('OK manejador: 504 de ChileCompra informado, registrado por intento, máximo dos consultas');
}
// Caso real del 08/11/2026: primer intento 504 de la pasarela, segundo cortado por plazo → mensaje de ChileCompra caído.
{
  const { default: handler } = await import('../../api/compra-agil.mjs');
  process.env.MP_TICKET_COMPRA_AGIL = 'prueba'; const orig = globalThis.fetch; let aCC = 0; const info = console.info; console.info = () => {};
  globalThis.fetch = async (url, init) => { const u = String(url);
    if (u.includes('/auth/v1/user')) return new Response(JSON.stringify({ id: 'u-prueba-2' }));
    if (u.includes('/rest/v1/perfiles')) return new Response(JSON.stringify([{ id: 'u-prueba-2', rol: 'usuario' }]));
    if (u.includes('mercadopublico.cl')) { aCC++;
      if (aCC === 1) return new Response('{"message": "Endpoint request timed out"}', { status: 504 });
      throw new DOMException('demora', 'TimeoutError'); }
    throw new Error('inesperado ' + u); };
  const out = {}; const res = { setHeader() {}, status(c) { out.code = c; return this; }, json(b) { out.body = b; return this; } };
  try { await handler({ query: { q: codigo }, headers: { authorization: 'Bearer y' } }, res); } finally { globalThis.fetch = orig; console.info = info; }
  assert.equal(aCC, 2); assert.equal(out.code, 502); assert.equal(out.body.codigo, 'CHILECOMPRA_SIN_RESPUESTA'); assert.match(out.body.error, /servidor de ChileCompra/);
  total++; console.log('OK 504 y luego plazo: informa que el servidor de ChileCompra no responde');
}
console.log(`${total} pruebas correctas (con las de tiempos por intento)`);
