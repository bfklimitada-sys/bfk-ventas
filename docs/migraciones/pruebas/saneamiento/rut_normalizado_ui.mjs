import { chromium } from "playwright-core";
const URL_APP="http://127.0.0.1:4175/";
const dias=(n)=>new Date(Date.now()-n*864e5).toISOString().slice(0,10);
const base=(i,o={})=>({id:"oc"+i,numero_oc:`1000-${i}-OC26`,cliente:"Cliente "+i,vendedor_id:"v1",estado_compra:"comprado",estado_entrega:"pendiente",estado_factura_propia:"pendiente",estado_pago_cliente:"pendiente",estado_pago_financiamiento:"pendiente",monto_total:1000000,costo_total:700000,monto_facturado:0,monto_cobrado:0,financiador_id:"f1",creadoEn:new Date().toISOString(),dias_pago:30,vendedores:{nombre:"Vendedor Uno"},financiadores:{nombre:"Financiador Uno"},eventos_compra:[{id:"ec"+i,fecha:dias(30),monto:700000,fecha_entrega_estimada:dias(10),financiador_id:"f1"}],eventos_entrega:[],eventos_factura:[],eventos_pago_cliente:[],eventos_pago_financiamiento:[],eventos_postventa:[],oc_productos_link:[],oc_comentarios:[],oc_reclamos:[],oc_responsables:[],items_oc:[],...o});
const OCS=[base(1),base(2),base(3)];
const PERF={u1:{id:"u1",nombre:"Admin Uno",rol:"admin",email:"a@a.cl"}};
let ENT=[{id:"e1",rut:"76.123.456-0",nombre_entidad:"MUNICIPALIDAD X",comuna:"LAJA",contacto:"Ana",correo:"ana@x.cl"},
 {id:"d1",rut:"11.111.111-1",nombre_entidad:"DUP UNO",comuna:"",contacto:"",correo:""},{id:"d2",rut:"11111111-1",nombre_entidad:"DUP DOS",comuna:"",contacto:"",correo:""}];
const ESCR=[]; const browser=await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome",args:["--no-sandbox"]});
const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,timezoneId:"America/Santiago"});
const page=await ctx.newPage(); const errs=[]; page.on("pageerror",e=>errs.push(e.message)); page.on("dialog",d=>d.accept());
await page.route("**/*",async route=>{
  const u=new URL(route.request().url()); const m=route.request().method();
  if(u.hostname==="127.0.0.1") return route.continue();
  if(u.hostname.endsWith("supabase.co")){
    if(u.pathname.includes("/auth/v1/token")) return route.fulfill({json:{access_token:"tA",refresh_token:"r",expires_in:3600,user:{id:"u1",email:"a@a.cl"}}});
    if(u.pathname.includes("/auth/v1/user")) return route.fulfill({json:{id:"u1"}});
    if(u.pathname.endsWith("/rpc/gestionar_bloqueo_oc")) return route.fulfill({json:{ok:true,segundos_restantes:45,liberado:true}});
    const t=u.pathname.split("/").pop();
    if(t==="entidades_catalogo"){
      if(m==="GET") return route.fulfill({json:JSON.parse(JSON.stringify(ENT))});
      const b=JSON.parse(route.request().postData()||"{}"); const id=(u.search.match(/id=eq\.([^&]+)/)||[])[1]||null;
      ESCR.push({m,id,b});
      if(m==="POST") ENT.push(b); if(m==="PATCH"){ const e=ENT.find(x=>x.id===id); Object.assign(e,b); }
      return route.fulfill({json:[b]});
    }
    if(t==="ordenes_compra_v2"&&m==="PATCH"){ const id=(u.search.match(/id=eq\.([^&]+)/)||[])[1]; const b=JSON.parse(route.request().postData()||"{}"); Object.assign(OCS.find(o=>o.id===id),b); return route.fulfill({json:[b]}); }
    if(m==="GET"&&t==="ordenes_compra_v2") return route.fulfill({json:JSON.parse(JSON.stringify(OCS))});
    if(m==="GET"&&t==="perfiles") return route.fulfill({json:[PERF.u1]});
    return route.fulfill({json:[]});
  }
  return route.abort();
});
await page.addInitScript(()=>{localStorage.setItem("bfk_supabase_session_v2",JSON.stringify({access_token:"tA",refresh_token:"r",user:{id:"u1",email:"a@a.cl"}}));});
await page.goto(URL_APP,{waitUntil:"load"}); await page.waitForTimeout(1800);
await page.mouse.click(118,820); await page.waitForTimeout(800);
const R={};
async function editar(num, rut, cambios={}){
  await page.getByText(num).first().click(); await page.waitForTimeout(900);
  await page.getByText("Editar datos").first().click(); await page.waitForTimeout(600);
  const rutInp=page.locator('input[placeholder="ej: 12.345.678-9"]').first();
  await rutInp.fill(""); await rutInp.pressSequentially(rut,{delay:5}); await page.waitForTimeout(300);
  const vals=await page.evaluate(()=>[...document.querySelectorAll("input")].map(i=>i.value));
  for(const [ph,v] of Object.entries(cambios)){ const i=page.locator(`input[placeholder="${ph}"]`).first(); await i.fill(v); }
  const n0=ESCR.length;
  await page.getByText("✓ Guardar datos").first().click(); await page.waitForTimeout(1500);
  await page.getByText(num).first().click().catch(()=>{}); await page.waitForTimeout(500);
  return {vals,escr:ESCR.slice(n0)};
}
let r=await editar("1000-1-OC26","76123456-0");
R.c1_autocompleta_sin_puntos=r.vals.includes("MUNICIPALIDAD X")&&r.vals.includes("LAJA")&&r.vals.includes("ana@x.cl");
R.c1_no_crea_duplicado=!r.escr.some(e=>e.m==="POST"); R.c1_escrituras=r.escr; R.c1_entidades=ENT.length;
r=await editar("1000-2-OC26","6000000-k");
R.c2_nueva_con_rut_canonico=r.escr.length===1&&r.escr[0].m==="POST"&&r.escr[0].b.rut==="6.000.000-K"; R.c2=r.escr.map(e=>({m:e.m,rut:e.b.rut}));
r=await editar("1000-3-OC26","11111111-1");
R.c3_ambiguo_no_escribe_catalogo=r.escr.length===0; R.c3_autocompleta_exacto=r.vals.includes("DUP DOS");
// parcial no autocompleta: ent 7.612.345-6 no existe, pero probar que '7612345' no rellena con e1
const ph=await page.evaluate(()=>0);
r=await editar("1000-1-OC26","76.123.456-0",{});
R.c4_mismo_rut_con_puntos_sin_cambios=r.escr.length===0;
console.log(JSON.stringify(R,null,1)); console.log("ERRORES",JSON.stringify(errs));
await browser.close();
