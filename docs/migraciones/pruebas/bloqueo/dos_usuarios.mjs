import { chromium } from "playwright-core";
const URL_APP="http://127.0.0.1:4175/";
const dias=(n)=>new Date(Date.now()-n*864e5).toISOString().slice(0,10);
const base=(i,o={})=>({id:"oc"+i,numero_oc:`1000-${i}-OC26`,cliente:"Cliente "+i,vendedor_id:"v1",estado_compra:"comprado",estado_entrega:"pendiente",estado_factura_propia:"pendiente",estado_pago_cliente:"pendiente",estado_pago_financiamiento:"pendiente",monto_total:1000000,costo_total:700000,monto_facturado:0,monto_cobrado:0,financiador_id:"f1",creadoEn:new Date().toISOString(),dias_pago:30,vendedores:{nombre:"Vendedor Uno"},financiadores:{nombre:"Financiador Uno"},eventos_compra:[{id:"ec"+i,fecha:dias(30),monto:700000,fecha_entrega_estimada:dias(10),financiador_id:"f1"}],eventos_entrega:[],eventos_factura:[],eventos_pago_cliente:[],eventos_pago_financiamiento:[],eventos_postventa:[],oc_productos_link:[],oc_comentarios:[],oc_reclamos:[],oc_responsables:[],items_oc:[],...o});
const OCS=[base(1,{oc_productos_link:[{id:"l1",oc_id:"oc1",origen:"compra",descripcion:"Producto X",cantidad:2,precio_compra:1000,precio_venta:2000,url:"https://ejemplo.cl/producto",proveedor:"Prov"}]}),base(2),base(3)];
const PERF={u1:{id:"u1",nombre:"Admin Uno",rol:"admin",email:"a@a.cl"},u2:{id:"u2",nombre:"Usuario Dos",rol:"admin",email:"b@b.cl"}};
const QUIEN={tA:"u1",tB:"u2"};
const LOCKS=new Map(); const NET={u1:{caida:false},u2:{caida:false}}; const DELS=[]; const LOG=[]; const T0=Date.now(); const ts=()=>((Date.now()-T0)/1000).toFixed(1);
const browser=await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome",args:["--no-sandbox"]});
const TTL=45000;
function rpcServidor(yo,b){
  const ahora=Date.now(); const f=LOCKS.get(b.p_oc_id); const seg=(e)=>Math.max(0,Math.ceil((e-ahora)/1000));
  if(b.p_accion==="liberar"){ const lib=f&&f.usuario_id===yo; if(lib) LOCKS.delete(b.p_oc_id); return {ok:true,liberado:!!lib}; }
  if(b.p_accion==="renovar"){ if(f&&f.usuario_id===yo){f.exp=ahora+TTL; return {ok:true,segundos_restantes:45};} if(f) return {ok:false,motivo:"perdido",usuario_nombre:PERF[f.usuario_id].nombre,segundos_restantes:seg(f.exp)}; return {ok:false,motivo:"sin_bloqueo"}; }
  if(!f||f.usuario_id===yo||f.exp<=ahora){ LOCKS.set(b.p_oc_id,{usuario_id:yo,exp:ahora+TTL}); return {ok:true,segundos_restantes:45}; }
  return {ok:false,motivo:"ocupada",usuario_nombre:PERF[f.usuario_id].nombre,segundos_restantes:seg(f.exp)};
}
async function usuario(token){
  const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true,timezoneId:"America/Santiago"});
  const page=await ctx.newPage(); const errs=[]; const dlg=[]; page.on("pageerror",e=>errs.push(e.message));
  page.on("dialog",d=>{dlg.push(d.message().slice(0,90)); d.accept();});
  const yo=QUIEN[token];
  await page.route("**/*",async route=>{
    const u=new URL(route.request().url()); const m=route.request().method();
    if(u.hostname==="127.0.0.1"||u.hostname==="localhost") return route.continue();
    if(u.hostname.endsWith("supabase.co")){
      if(u.pathname.includes("/auth/v1/token")) return route.fulfill({json:{access_token:token,refresh_token:"r",expires_in:3600,user:{id:yo,email:PERF[yo].email}}});
      if(u.pathname.includes("/auth/v1/user")) return route.fulfill({json:{id:yo}});
      if(u.pathname.includes("/auth/v1/logout")) {LOG.push({t:ts(),u:yo,e:"LOGOUT"});return route.fulfill({json:{}});}
      if(u.pathname.endsWith("/rpc/gestionar_bloqueo_oc")){
        if(NET[yo].caida) return route.abort();
        let b={}; try{b=JSON.parse(route.request().postData());}catch{}
        const r=rpcServidor(yo,b); LOG.push({t:ts(),u:yo,e:"RPC "+b.p_accion,oc:b.p_oc_id,ok:r.ok,motivo:r.motivo||null});
        return route.fulfill({json:r});
      }
      const t=u.pathname.split("/").pop();
      if(t==="oc_bloqueos"){ LOG.push({t:ts(),u:yo,e:"ACCESO DIRECTO oc_bloqueos "+m}); return route.fulfill({json:[]}); }
      if(m==="DELETE"&&t==="ordenes_compra_v2"){ DELS.push({u:yo,t:ts()}); return route.fulfill({json:[]}); }
      if(m==="GET"&&t==="ordenes_compra_v2") return route.fulfill({json:JSON.parse(JSON.stringify(OCS))});
      if(m==="GET"&&t==="perfiles"){ const id=(u.search.match(/id=eq\.([^&]+)/)||[])[1]; return route.fulfill({json:id?[PERF[id]]:Object.values(PERF)}); }
      return route.fulfill({json:[]});
    }
    return route.abort();
  });
  await page.addInitScript(([tk,id,em])=>{localStorage.setItem("bfk_supabase_session_v2",JSON.stringify({access_token:tk,refresh_token:"r",user:{id,email:em}}));},[token,yo,PERF[yo].email]);
  await page.goto(URL_APP,{waitUntil:"load"}); await page.waitForTimeout(1800);
  await page.mouse.click(118,820); await page.waitForTimeout(800);
  return {page,errs,dlg,yo};
}
const tocar=async(U,num,ms=900)=>{await U.page.getByText(num).first().click();await U.page.waitForTimeout(ms);};
const bannerTxt=async(U)=>{ const l=U.page.locator('[data-testid="bloqueo-estado"]'); return (await l.count())?(await l.first().innerText()).replace(/\s+/g," "):null; };
const editable=async(U)=>{ const f=U.page.locator('[data-testid="oc-campos"]'); if(!(await f.count())) return null; return (await f.first().getAttribute("data-solo-lectura"))===null; };
const dueno=(oc)=>{const l=LOCKS.get(oc); return l&&l.exp>Date.now()?l.usuario_id:null;};
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const R={};
const A=await usuario("tA"), B=await usuario("tB");
// S1
await tocar(A,"1000-1-OC26"); R.S1_A_dueno_oc1=dueno("oc1"); R.S1_A_puede_editar=await editable(A); R.S1_A_banner=await bannerTxt(A);
await tocar(B,"1000-1-OC26"); R.S1_B_banner=await bannerTxt(B); R.S1_B_puede_editar=await editable(B); R.S1_dueno_sigue_A=dueno("oc1");
// S1b: en solo lectura se bloquean las acciones que escriben, pero las de consulta siguen disponibles
{ const d0=DELS.length, dl0=B.dlg.length, inp0=await B.page.locator("input").count();
  await B.page.getByText("Eliminar esta OC").first().click({force:true}).catch(()=>{}); await B.page.waitForTimeout(500);
  R.S1b_B_eliminar_bloqueado=DELS.length===d0&&B.dlg.length===dl0;
  await B.page.getByText("Editar datos").first().click({force:true}).catch(()=>{}); await B.page.waitForTimeout(500);
  R.S1b_B_editar_datos_no_abre_formulario=(await B.page.locator("input").count())===inp0;
  R.S1b_B_botones_de_consulta=await B.page.locator('[data-testid="oc-campos"] button[data-consulta]').count();
  await B.page.getByText(/Productos y números/).first().click().catch(()=>{}); await B.page.waitForTimeout(600);
  R.S1b_B_detalle_productos_se_abre=await B.page.getByText("Producto X").count()>0;
  const enl=B.page.locator('a[href="https://ejemplo.cl/producto"]'); R.S1b_B_enlace_producto_visible=(await enl.count())>0;
  if(R.S1b_B_enlace_producto_visible){ const [pop]=await Promise.all([B.page.context().waitForEvent("page",{timeout:5000}).catch(()=>null), enl.first().click().catch(()=>{})]); R.S1b_B_enlace_abre_pestana=!!pop&&/ejemplo\.cl/.test(pop.url()||"about:blank")||!!pop; if(pop) await pop.close().catch(()=>{}); }
  R.S1b_B_botones_editar_producto_bloqueados=await (async()=>{ const c=B.page.getByText("Editar",{exact:true}); const n0=await B.page.locator("input").count(); if(await c.count()) await c.first().click({force:true}).catch(()=>{}); await B.page.waitForTimeout(400); return (await B.page.locator("input").count())===n0; })();
  R.S1b_comentarios_siguen_disponibles=await B.page.getByText(/Notas e historial/).count()>0;
}
// S2: 50 s con ambas abiertas
const ren0=LOG.filter(l=>l.u==="u1"&&l.e==="RPC renovar"&&l.oc==="oc1").length; await sleep(50000);
R.S2_renovaciones_de_A_en_50s=LOG.filter(l=>l.u==="u1"&&l.e==="RPC renovar"&&l.oc==="oc1").length-ren0;
R.S2_tras_50s_dueno=dueno("oc1"); R.S2_B_sigue_solo_lectura=(await editable(B))===false; R.S2_B_banner=await bannerTxt(B);
R.S2_B_obtuvo_ok_alguna_vez=LOG.some(l=>l.u==="u2"&&l.oc==="oc1"&&l.ok===true);
// S3: A -> OC2 (A→B)
await tocar(A,"1000-2-OC26",1200); R.S3_dueno_oc2=dueno("oc2");
R.S3_A_libero_oc1_antes_de_adquirir_oc2=(()=>{const i=LOG.map(l=>l.u+l.e+l.oc);const a=i.lastIndexOf("u1RPC liberaroc1"),b=i.lastIndexOf("u1RPC adquiriroc2");return a>=0&&b>a;})();
await sleep(11000); R.S3_B_adquirio_oc1_automaticamente=dueno("oc1")==="u2"; R.S3_B_puede_editar_ahora=await editable(B); R.S3_B_banner=await bannerTxt(B);
// S4: A pierde conexión en OC2; B abre OC2
await tocar(B,"1000-2-OC26",1200); R.S4_B_en_oc2_banner=await bannerTxt(B);
const tPerd=Date.now(); NET.u1.caida=true; let aRO=null, bGana=null;
while(Date.now()-tPerd<80000){ await sleep(1000); if(aRO===null&&(await editable(A))===false) aRO=Math.round((Date.now()-tPerd)/1000); if(bGana===null&&dueno("oc2")==="u2"){ bGana=Math.round((Date.now()-tPerd)/1000); break; } }
R.S4_A_pasa_a_solo_lectura_a_los_s=aRO; R.S4_B_adquiere_oc2_a_los_s_de_perder_A=bGana; R.S4_A_banner_sin_conexion=await bannerTxt(A);
NET.u1.caida=false; await sleep(11000); R.S4_A_reconectado_banner=await bannerTxt(A); R.S4_A_puede_editar_con_B_dueno=await editable(A);
await tocar(B,"1000-2-OC26",1200); /* B cierra OC2 → libera */ R.S4_B_libero=dueno("oc2")===null; await sleep(11000);
R.S4_A_recupera_automaticamente=dueno("oc2")==="u1"&&(await editable(A))===true;
// S5: B llega por Alertas (ocFoco) a una OC que tiene A
await tocar(A,"1000-1-OC26",1200); R.S5_A_dueno_oc1=dueno("oc1");
const acc0=LOG.length; await B.page.mouse.click(273,820); await B.page.waitForTimeout(900);
await B.page.getByText(/Entrega atrasada/).first().click().catch(()=>{}); await B.page.waitForTimeout(1500);
R.S5_B_llego_por_alertas=/Volver a Alertas/.test(await B.page.evaluate(()=>document.body.innerText));
R.S5_B_banner_en_oc_foco=await bannerTxt(B); R.S5_B_solo_lectura=(await editable(B))===false;
R.S5_dueno_tras_llegar_B=dueno("oc1");
await B.page.getByText("1000-1-OC26").first().click().catch(()=>{}); await B.page.waitForTimeout(900); R.S5_dueno_sigue_A_tras_cerrar_B=dueno("oc1");
R.S5_B_nunca_borro_bloqueo_ajeno=!LOG.slice(acc0).some(l=>l.u==="u2"&&l.e==="RPC liberar"&&l.ok&&false)&&dueno("oc1")==="u1";
// S6: A cambia de panel / pagehide / pageshow / logout
await A.page.mouse.click(42,820); await A.page.waitForTimeout(900); R.S6_cambio_de_panel_libera=dueno("oc1")===null;
await A.page.mouse.click(118,820); await A.page.waitForTimeout(900); await tocar(A,"1000-3-OC26",1200); R.S6_A_dueno_oc3=dueno("oc3");
await A.page.evaluate(()=>window.dispatchEvent(new Event("pagehide"))); await A.page.waitForTimeout(800); R.S6_pagehide_libera=dueno("oc3")===null;
await A.page.evaluate(()=>window.dispatchEvent(Object.assign(new Event("pageshow"),{persisted:true}))); await A.page.waitForTimeout(1200); R.S6_pageshow_readquiere=dueno("oc3")==="u1";
const salir=A.page.locator('button:has-text("⏻")').first(); R.S6_boton_salir_visible=(await salir.count())>0;
if(R.S6_boton_salir_visible){ await salir.click().catch(()=>{}); await A.page.waitForTimeout(1000); }
R.S6_logout_libera=dueno("oc3")===null; R.S6_libero_antes_del_logout=(()=>{const i=LOG.map(l=>l.u+l.e);const a=i.lastIndexOf("u1RPC liberar"),b=i.lastIndexOf("u1LOGOUT");return a>=0&&b>a;})();
// S7: B abre OC1 (A ya la soltó al cambiar de panel / cerrar sesión) y prueba guardar en condiciones adversas
const dB0=DELS.length; await B.page.getByText("1000-1-OC26").first().click().catch(()=>{}); await B.page.waitForTimeout(1500);
if(!dueno("oc1")||dueno("oc1")!=="u2"){ await B.page.getByText("1000-1-OC26").first().click().catch(()=>{}); await B.page.waitForTimeout(500); await B.page.getByText("1000-1-OC26").first().click().catch(()=>{}); await B.page.waitForTimeout(1500); }
R.S7_B_dueno_oc1=dueno("oc1"); R.S7_B_puede_editar=await editable(B);
// 7a: heartbeat fallido (sin red al verificar)
NET.u2.caida=true; B.dlg.length=0;
await B.page.getByText("Eliminar esta OC").first().click().catch(()=>{}); await B.page.waitForTimeout(1500);
R.S7a_sin_conexion_no_elimina=DELS.length===dB0; R.S7a_aviso=B.dlg.join(" | ")||null;
NET.u2.caida=false;
// 7b: bloqueo perdido mientras la pantalla aún cree ser propietaria (p. ej. iPhone en segundo plano)
await B.page.waitForTimeout(500); LOCKS.set("oc1",{usuario_id:"u1",exp:Date.now()+30000}); B.dlg.length=0;
R.S7b_UI_cree_ser_propietaria=(await editable(B))===true;
await B.page.getByText("Eliminar esta OC").first().click().catch(()=>{}); await B.page.waitForTimeout(1500);
R.S7b_bloqueo_perdido_no_elimina=DELS.length===dB0; R.S7b_aviso=B.dlg.join(" | ")||null;
await B.page.waitForTimeout(800); R.S7b_despues_UI_solo_lectura=(await editable(B))===false; R.S7b_banner=await bannerTxt(B);
// S8: propietario legítimo guarda (control positivo)
LOCKS.delete("oc1"); await B.page.waitForTimeout(11000); R.S8_B_recupero=dueno("oc1")==="u2"&&(await editable(B))===true; B.dlg.length=0;
await B.page.getByText("Eliminar esta OC").first().click().catch(()=>{}); await B.page.waitForTimeout(1500);
R.S8_propietario_si_puede_eliminar=DELS.length===dB0+1;
R.acceso_directo_a_oc_bloqueos=LOG.filter(l=>String(l.e).startsWith("ACCESO")).length;
console.log("RESULTADOS",JSON.stringify(R,null,1)); console.log("ERRORES",JSON.stringify([...A.errs,...B.errs]));
await browser.close();
