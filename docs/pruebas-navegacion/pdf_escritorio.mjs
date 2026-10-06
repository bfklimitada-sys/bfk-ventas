// PDF de todas las pantallas desde la barra lateral (escritorio) y desde "Más" (celular), sin escrituras.
import { chromium } from "playwright-core"; import { abrir, CHROME } from "./mock.mjs";
const URL_APP=process.argv[2]||"http://127.0.0.1:4177/";
const browser=await chromium.launch({executablePath:CHROME,args:["--no-sandbox"]});
const R={};
for(const [modo,ancho,alto,movil] of [["escritorio",1440,900,false],["movil",390,844,true]]){
  const {page:p,errs,escr}=await abrir(browser,{url:URL_APP,usuario:"u1",ancho,alto,movil});
  if(!movil) await p.locator('aside button[aria-label^="Imprimir"]').click();
  else { await p.locator('[data-nav="mas"]').click(); await p.waitForTimeout(300); await p.locator('[role=dialog] button[aria-label^="Imprimir"]').click(); }
  await p.getByText("PDF listo",{exact:false}).waitFor({timeout:120000}).catch(()=>{});
  const hojas=await p.locator("[data-hoja]").count();
  const indices=await p.locator(".bfk-indice").evaluateAll(els=>els.filter(e=>getComputedStyle(e).display!=="none").length);
  const bytes=await p.evaluate(async()=>{const a=document.querySelector('a[href^="blob:"]'); if(!a) return 0; const r=await fetch(a.href); return (await r.arrayBuffer()).byteLength;});
  R[modo]={listo:(await p.getByText("PDF listo",{exact:false}).count())>0,hojas,indices_visibles_en_pdf:indices,pdf_bytes:bytes,escrituras:escr.filter(e=>!/oc_bloqueos|mp_cache_avisos|mp_uso_diario/.test(e)).length,errores:errs.length};   // Fase 4C: caché técnica de Mercado Público aparte
  await p.getByText("Volver",{exact:true}).click(); await p.waitForTimeout(500);
  R[modo].volvio=(await p.locator("[data-hoja]").count())===0;
  await p.context().close();
}
await browser.close();
console.log(JSON.stringify(R,null,1));
const ok=Object.values(R).every(x=>x.listo&&x.hojas===8&&x.indices_visibles_en_pdf===0&&x.pdf_bytes>100000&&x.escrituras===0&&x.errores===0&&x.volvio);
console.log(ok?"RESULT|pdf_todas_las_pantallas|OK":"FALLA|pdf_todas_las_pantallas"); process.exit(ok?0:1);
