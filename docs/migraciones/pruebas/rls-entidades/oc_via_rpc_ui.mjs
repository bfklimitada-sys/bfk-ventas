import { chromium } from "playwright-core";
const URL_APP="http://127.0.0.1:4175/";
const dias=(n)=>new Date(Date.now()-n*864e5).toISOString().slice(0,10);
const base=(i,o={})=>({id:"oc"+i,numero_oc:`1000-${i}-OC26`,cliente:"Cliente "+i,vendedor_id:"v1",estado_compra:"comprado",estado_entrega:"pendiente",estado_factura_propia:"pendiente",estado_pago_cliente:"pendiente",estado_pago_financiamiento:"pendiente",monto_total:1000000,costo_total:700000,monto_facturado:0,monto_cobrado:0,financiador_id:"f1",creadoEn:new Date().toISOString(),dias_pago:30,vendedores:{nombre:"Vendedor Uno"},financiadores:{nombre:"Financiador Uno"},eventos_compra:[{id:"ec"+i,fecha:dias(30),monto:700000,fecha_entrega_estimada:dias(10),financiador_id:"f1"}],eventos_entrega:[],eventos_factura:[],eventos_pago_cliente:[],eventos_pago_financiamiento:[],eventos_postventa:[],oc_productos_link:[],oc_comentarios:[],oc_reclamos:[],oc_responsables:[],items_oc:[],...o});
const OCS=[base(1),base(2),base(3)];
const PERF={u1:{id:"u1",nombre:"Admin Uno",rol:"admin",email:"a@a.cl"}};
let ENT=[{id:"e1",rut:"76.123.456-0",nombre_entidad:"MUNICIPALIDAD X",comuna:"LAJA",contacto:"Ana",correo:"ana@x.cl"},
 {id:"d1",rut:"11.111.111-1",nombre_entidad:"DUP UNO",comuna:"",contacto:"",correo:""},{id:"d2",rut:"11111111-1",nombre_entidad:"DUP DOS",comuna:"",contacto:"",correo:""}];
const ESCR=[]; const RPC=[]; const browser=await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome",args:["--no-sandbox"]});
const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,timezoneId:"America/Santiago"});
const page=await ctx.newPage(); const errs=[]; page.on("pageerror",e=>errs.push(e.message)); page.on("dialog",d=>d.accept());
await page.route("**/*",async route=>{
  const u=new URL(route.request().url()); const m=route.request().method();
  if(u.hostname==="127.0.0.1") return route.continue();
  if(u.hostname.endsWith("supabase.co")){
    if(u.pathname.includes("/auth/v1/token")) return route.fulfill({json:{access_token:"tA",refresh_token:"r",expires_in:3600,user:{id:"u1",email:"a@a.cl"}}});
    if(u.pathname.includes("/auth/v1/user")) return route.fulfill({json:{id:"u1"}});
    if(u.pathname.endsWith("/rpc/gestionar_bloqueo_oc")) return route.fulfill({json:{ok:true,segundos_restantes:45,liberado:true}});
    if(u.pathname.endsWith("/rpc/registrar_entidad_desde_oc")){
      const b=JSON.parse(route.request().postData()||"{}"); RPC.push(b);
      if(globalThis.FALLA_RPC) return route.fulfill({status:500,json:{message:"falla simulada"}});
      const cl=(x)=>String(x||"").toUpperCase().replace(/[^0-9K]/g,"").replace(/^0+(?=.)/,"");
      const l=String(b.p_rut||"").toUpperCase().replace(/[\s.\-]/g,""); const cu=l.slice(0,-1).replace(/^0+/,""), d=l.slice(-1);
      const dvf=(c)=>{let s=0,f=2;for(let i=c.length-1;i>=0;i--){s+=+c[i]*f;f=f===7?2:f+1;}const r=11-s%11;return r===11?"0":r===10?"K":String(r);};
      if(!/^[0-9]{7,8}$/.test(cu)||dvf(cu)!==d) return route.fulfill({json:{ok:true,accion:"rut_invalido"}});
      const m=ENT.filter(e=>cl(e.rut)===cu+d); if(m.length>1) return route.fulfill({json:{ok:true,accion:"ambigua"}});
      const campos={nombre_entidad:b.p_nombre_entidad,comuna:b.p_comuna,contacto:b.p_contacto,correo:b.p_correo};
      if(m.length===1){ let c=false; for(const [k,v] of Object.entries(campos)) if(v&&v.trim()&&v.trim()!==(m[0][k]||"").trim()){m[0][k]=v.trim();c=true;} return route.fulfill({json:{ok:true,accion:c?"actualizada":"sin_cambios"}}); }
      ENT.push({id:"ent_rpc"+ENT.length,rut:cu.replace(/\B(?=(\d{3})+(?!\d))/g,".")+"-"+d,...Object.fromEntries(Object.entries(campos).map(([k,v])=>[k,(v||"").trim()]))});
      return route.fulfill({json:{ok:true,accion:"creada"}});
    }
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
async function editar(num, rut){
  await page.getByText(num).first().click(); await page.waitForTimeout(900);
  await page.getByText("Editar datos").first().click(); await page.waitForTimeout(600);
  const rutInp=page.locator('input[placeholder="ej: 12.345.678-9"]').first();
  await rutInp.fill(""); await rutInp.pressSequentially(rut,{delay:5}); await page.waitForTimeout(300);
  const vals=await page.evaluate(()=>[...document.querySelectorAll("input")].map(i=>i.value));
  const n0=ESCR.length, r0=RPC.length, oc0=JSON.stringify(OCS.find(o=>o.numero_oc===num));
  await page.getByText("✓ Guardar datos").first().click(); await page.waitForTimeout(1500);
  const ocCambio=JSON.stringify(OCS.find(o=>o.numero_oc===num))!==oc0;
  await page.getByText(num).first().click().catch(()=>{}); await page.waitForTimeout(500);
  return {vals,escr:ESCR.slice(n0),rpc:RPC.slice(r0),ocCambio};
}
let r=await editar("1000-1-OC26","76123456-0");
R.c1_autocompleta_sin_puntos=r.vals.includes("MUNICIPALIDAD X")&&r.vals.includes("LAJA");
R.c1_usa_RPC_sin_escritura_directa=r.escr.length===0&&r.rpc.length===1&&r.rpc[0].p_rut==="76123456-0"; R.c1_entidades=ENT.length===3;
r=await editar("1000-2-OC26","6000000-k");
R.c2_nueva_por_RPC_rut_canonico=r.escr.length===0&&r.rpc.length===1&&ENT.some(e=>e.rut==="6.000.000-K");
r=await editar("1000-3-OC26","11111111-1");
R.c3_ambiguo_sin_escritura_directa=r.escr.length===0&&r.rpc.length===1&&ENT.length===4; R.c3_autocompleta_exacto=r.vals.includes("DUP DOS");
r=await editar("1000-1-OC26","76.123.456-9");
R.c4_rut_invalido_OC_se_guarda_y_catalogo_intacto=r.ocCambio&&r.escr.length===0&&ENT.length===4&&OCS.find(o=>o.id==="oc1").rut_cliente==="76.123.456-9";
globalThis.FALLA_RPC=true;
r=await editar("1000-2-OC26","76123456-0");
R.c5_falla_RPC_OC_se_guarda_igual=r.ocCambio&&r.rpc.length===1&&r.escr.length===0&&OCS.find(o=>o.id==="oc2").rut_cliente==="76123456-0";
globalThis.FALLA_RPC=false;
R.payload_campos=Object.keys(RPC[0]||{}).sort().join(",");
R.escrituras_directas_totales=ESCR.length;
console.log(JSON.stringify(R,null,1)); console.log("ERRORES",JSON.stringify(errs));
await browser.close();
