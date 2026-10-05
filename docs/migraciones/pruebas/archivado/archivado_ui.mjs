import { chromium } from "playwright-core";
const URL_APP="http://127.0.0.1:4175/";
const dias=(n)=>new Date(Date.now()-n*864e5).toISOString().slice(0,10);
const base=(i,o={})=>({id:"oc"+i,numero_oc:`1000-${i}-OC26`,cliente:"Cliente "+i,rut_cliente:"61.000.00"+i+"-0",vendedor_id:"v1",estado_compra:"comprado",estado_entrega:"pendiente",estado_factura_propia:"pendiente",estado_pago_cliente:"pendiente",estado_pago_financiamiento:"pendiente",monto_total:1000000*i,costo_total:700000*i,monto_facturado:0,monto_cobrado:0,financiador_id:"f1",creadoEn:new Date().toISOString(),dias_pago:30,archivada:false,archivada_en:null,archivada_por:null,archivada_por_nombre:null,archivo_motivo:null,vendedores:{nombre:"Vendedor Uno"},financiadores:{nombre:"Financiador Uno"},eventos_compra:[{id:"ec"+i,oc_id:"oc"+i,fecha:dias(30),monto:700000*i,costo_compra:700000*i,fecha_entrega_estimada:dias(10),financiador_id:"f1"}],eventos_entrega:[],eventos_factura:[],eventos_pago_cliente:[],eventos_pago_financiamiento:[],eventos_postventa:[],oc_productos_link:[],oc_comentarios:[],oc_reclamos:[],oc_responsables:[],items_oc:[],...o});
const OCS=[base(1,{eventos_factura:[{id:"fa1",oc_id:"oc1",fecha:dias(5),numero_factura:"77",monto:1000000}],eventos_pago_cliente:[{id:"pc1",oc_id:"oc1",fecha:dias(2),monto:400000}],oc_comentarios:[{id:"cm1",oc_id:"oc1",texto:"nota"}]}),base(2),base(3)];
const PERF={u1:{id:"u1",nombre:"Admin Uno",rol:"admin",email:"a@a.cl"},u2:{id:"u2",nombre:"Usuario Dos",rol:"usuario",email:"b@b.cl"}};
const FIN=[{id:"f1",nombre:"Financiador Uno",saldo_deuda:1234567}];
const clone=x=>JSON.parse(JSON.stringify(x));
const ESCR=[]; const RPCS=[];
const browser=await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome",args:["--no-sandbox"]});
async function usuario(yo){
  const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true,timezoneId:"America/Santiago"});
  const page=await ctx.newPage(); const errs=[]; const dlg=[]; page.on("pageerror",e=>errs.push(e.message));
  let respuestaPrompt="Duplicada por error"; page.on("dialog",d=>{dlg.push(d.type()+": "+d.message().slice(0,70)); d.type()==="prompt"?d.accept(respuestaPrompt):d.accept();});
  await page.route("**/*",async route=>{
    const u=new URL(route.request().url()); const m=route.request().method();
    if(u.hostname==="127.0.0.1"||u.hostname==="localhost") return route.continue();
    if(u.hostname.endsWith("supabase.co")){
      if(u.pathname.includes("/auth/v1/token")) return route.fulfill({json:{access_token:"t"+yo,refresh_token:"r",expires_in:3600,user:{id:yo,email:PERF[yo].email}}});
      if(u.pathname.includes("/auth/v1/user")) return route.fulfill({json:{id:yo}});
      if(u.pathname.endsWith("/rpc/gestionar_bloqueo_oc")) return route.fulfill({json:{ok:true,segundos_restantes:45}});
      let b={}; try{b=JSON.parse(route.request().postData()||"{}");}catch{}
      if(u.pathname.endsWith("/rpc/archivar_oc")||u.pathname.endsWith("/rpc/restaurar_oc")){
        const fn=u.pathname.split("/").pop(); RPCS.push({yo,fn,b});
        if(PERF[yo].rol!=="admin") return route.fulfill({status:403,json:{message:"ARCHIVO_RECHAZADO: solo un administrador"}});
        const oc=OCS.find(o=>o.id===b.p_oc_id);
        if(fn==="archivar_oc") Object.assign(oc,{archivada:true,archivada_en:new Date().toISOString(),archivada_por:yo,archivada_por_nombre:PERF[yo].nombre,archivo_motivo:(b.p_motivo||"").trim()||null});
        else Object.assign(oc,{archivada:false,archivada_en:null,archivada_por:null,archivada_por_nombre:null,archivo_motivo:null});
        return route.fulfill({json:{ok:true,oc_id:oc.id}});
      }
      const t=u.pathname.split("/").pop();
      if(m!=="GET"){ ESCR.push({yo,m,t}); return route.fulfill({json:[]}); }
      if(t==="ordenes_compra_v2") return route.fulfill({json:clone(OCS)});
      if(t==="financiadores") return route.fulfill({json:clone(FIN)});
      if(t==="vendedores") return route.fulfill({json:[{id:"v1",nombre:"Vendedor Uno",comision_pct:10}]});
      if(t==="perfiles"){ const id=(u.search.match(/id=eq\.([^&]+)/)||[])[1]; return route.fulfill({json:id?[PERF[id]]:Object.values(PERF)}); }
      return route.fulfill({json:[]});
    }
    return route.abort();
  });
  await page.addInitScript(([id,em])=>{localStorage.setItem("bfk_supabase_session_v2",JSON.stringify({access_token:"t"+id,refresh_token:"r",user:{id,email:em}}));},[yo,PERF[yo].email]);
  await page.goto(URL_APP,{waitUntil:"load"}); await page.waitForTimeout(1800);
  return {page,errs,dlg,setPrompt:(v)=>{respuestaPrompt=v;}};
}
const body=async(U)=>(await U.page.evaluate(()=>document.body.innerText)).split("\n").filter(l=>!/ archivada · puede| restaurada$/.test(l)).join("\n");
const ocTxt=async(U)=>(await body(U)).replace(/\d{1,2}:\d{2}(:\d{2})?/g,"").replace(/quedan? \d+ ?s|\d+ ?s\b/g,"");
const tab=async(U,x)=>{await U.page.mouse.click(x,820); await U.page.waitForTimeout(900);};
const mas=async(U,txt)=>{await U.page.mouse.click(348,820);await U.page.waitForTimeout(500);await U.page.getByText(txt,{exact:true}).first().click();await U.page.waitForTimeout(900);};
const panelTxt=async(U)=>{await tab(U,42); return (await body(U)).replace(/\d{1,2}:\d{2}/g,"");};
const R={};
const A=await usuario("u1");
const P0=await panelTxt(A);
await tab(A,118); const C0=await body(A);
R.compras_muestra_3=["1000-1-OC26","1000-2-OC26","1000-3-OC26"].every(n=>C0.includes(n));
// Archivar desde la zona administrativa de la OC
await A.page.getByText("1000-1-OC26").first().click(); await A.page.waitForTimeout(1200);
const E0=await ocTxt(A);
R.boton_archivar_visible_admin=(await A.page.getByText("Archivar esta OC").count())>0;
R.boton_eliminar_ya_no_existe=(await A.page.getByText(/Eliminar esta OC/).count())===0;
// Cancelar el prompt no archiva
A.setPrompt(null);
A.page.removeAllListeners("dialog"); A.page.on("dialog",d=>{A.dlg.push(d.type()); d.dismiss();});
await A.page.getByText("Archivar esta OC").first().click(); await A.page.waitForTimeout(1200);
R.cancelar_no_archiva=RPCS.length===0;
A.page.removeAllListeners("dialog"); A.page.on("dialog",d=>{A.dlg.push(d.type()+": "+d.message().slice(0,200)); d.type()==="prompt"?d.accept("Duplicada por error"):d.accept();});
await A.page.getByText("Archivar esta OC").first().click(); await A.page.waitForTimeout(2500);
R.rpc_archivar_llamada=JSON.stringify(RPCS.map(r=>[r.fn,r.b]));
R.dialogo_explica_que_no_borra=A.dlg.some(d=>/sin borrar ningún dato/.test(d));
const C1=await body(A); R.toast=/archivada · puede restaurarla/.test(await A.page.evaluate(()=>document.body.innerText));
R.oc_archivada_sale_de_compras=!C1.includes("1000-1-OC26")&&C1.includes("1000-2-OC26")&&C1.includes("1000-3-OC26");
R.toast=/archivada · puede restaurarla/.test(await A.page.evaluate(()=>document.body.innerText));
// Búsqueda en Compras no la encuentra
const bus=A.page.locator('input[placeholder*="Buscar"]').first();
if(await bus.count()){ await bus.fill("1000-1"); await A.page.waitForTimeout(700); R.busqueda_no_la_encuentra=!(await body(A)).includes("1000-1-OC26"); await bus.fill(""); }
const P1=await panelTxt(A);
R.panel_estadisticas_excluyen_archivada=P1!==P0;
// Administración: listado, detalle y restauración
await mas(A,"Administración"); let AD=await body(A);
R.admin_lista_archivada=/OCs archivadas/i.test(AD)&&AD.includes("1000-1-OC26")&&/por Admin Uno/.test(AD)&&/Duplicada por error/.test(AD);
const filtro=A.page.locator('input[aria-label="Buscar OCs archivadas"]');
await filtro.fill("no-coincide"); await A.page.waitForTimeout(300); R.filtro_oculta=!(await body(A)).includes("1000-1-OC26");
await filtro.fill("duplicada"); await A.page.waitForTimeout(300); R.filtro_por_motivo=(await body(A)).includes("1000-1-OC26");
await A.page.locator('[data-oc-archivada="1000-1-OC26"] button').first().click(); await A.page.waitForTimeout(500); AD=await body(A);
R.detalle_muestra_datos_conservados=/1 compras · 0 entregas · 1 facturas · 1 pagos cliente/.test(AD)&&/61\.000\.001-0/.test(AD);
await A.page.getByText("Restaurar esta OC").first().click(); await A.page.waitForTimeout(2500);
R.rpc_restaurar_llamada=JSON.stringify(RPCS.slice(1).map(r=>[r.fn,r.b]));
AD=await body(A); R.admin_ya_no_la_lista=(await A.page.locator("[data-oc-archivada]").count())===0&&/No hay OCs archivadas/.test(AD);
await tab(A,118); const C2=await body(A);
R.restaurada_vuelve_a_compras=C2.includes("1000-1-OC26");
await A.page.getByText("1000-1-OC26").first().click(); await A.page.waitForTimeout(1200);
const E2=await ocTxt(A); R.restaurada_vista_identica_a_antes=E2===E0; if(E2!==E0){const a=E0.split("\n"),b=E2.split("\n");console.log("DIF",JSON.stringify(a.filter(x=>!b.includes(x)).slice(0,5)),JSON.stringify(b.filter(x=>!a.includes(x)).slice(0,5)));}
const P2=await panelTxt(A);
R.panel_identico_tras_restaurar=P2===P0;
R.escrituras_directas=JSON.stringify(ESCR.filter(e=>e.t!=="oc_bloqueos"));
R.borrados_fisicos=ESCR.filter(e=>e.m==="DELETE").length;
R.saldo_financiador_sin_tocar=!ESCR.some(e=>e.t==="financiadores");
// Usuario normal: sin botón de archivar y sin Administración
const B=await usuario("u2"); await tab(B,118);
await B.page.getByText("1000-2-OC26").first().click(); await B.page.waitForTimeout(1200);
R.usuario_normal_sin_boton_archivar=(await B.page.getByText("Archivar esta OC").count())===0;
await B.page.mouse.click(348,820); await B.page.waitForTimeout(500);
R.usuario_normal_sin_administracion=(await B.page.getByText("Administración",{exact:true}).count())===0;
// OC archivada no aparece al usuario normal
OCS[2].archivada=true; OCS[2].archivada_por_nombre="Admin Uno";
await B.page.goto(URL_APP,{waitUntil:"load"}); await B.page.waitForTimeout(1800); await tab(B,118);
const CB=await body(B); R.usuario_normal_no_ve_archivada=!CB.includes("1000-3-OC26")&&CB.includes("1000-2-OC26");
console.log("RESULTADOS",JSON.stringify(R,null,1)); console.log("ERRORES",JSON.stringify([...A.errs,...B.errs]));
await browser.close();
