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
