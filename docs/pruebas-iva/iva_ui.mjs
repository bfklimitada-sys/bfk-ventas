import { chromium } from "playwright-core";
const URLS={nueva:"http://127.0.0.1:4175/",anterior:"http://127.0.0.1:4176/"};
const oc=(i,fecha,util)=>({id:"oc"+i,numero_oc:`2000-${i}-SE26`,cliente:"Cliente "+i,vendedor_id:"v1",estado_compra:"comprado",estado_entrega:"confirmada",estado_factura_propia:"emitida",estado_pago_cliente:"pendiente",estado_pago_financiamiento:"pendiente",monto_total:1190000,costo_total:1190000-util,monto_facturado:1190000,monto_cobrado:0,vendedor_pagado:false,financiador_id:"f1",creadoEn:"2026-01-01T00:00:00Z",vendedores:{nombre:"Vendedor Uno"},financiadores:{nombre:"Financiador Uno"},eventos_compra:[{id:"ec"+i,fecha,monto:1190000-util}],eventos_entrega:[],eventos_factura:[{id:"fa"+i,fecha,numero_factura:String(i),monto:1190000}],eventos_pago_cliente:[],eventos_pago_financiamiento:[],eventos_postventa:[],oc_productos_link:[],oc_comentarios:[],oc_reclamos:[],oc_responsables:[],items_oc:[]});
const TABLAS={ordenes_compra_v2:[oc(1,"2026-03-10",1000000),oc(2,"2026-02-10",1000000),oc(3,"2026-01-10",1000000),oc(4,"2025-12-10",100000)],
  iva_mensual:[{id:"i3",anio:2026,mes:3,iva_ventas:20000,iva_compras:80000,iva_pagado:0},{id:"i2",anio:2026,mes:2,iva_ventas:190000,iva_compras:50000,iva_pagado:140000},{id:"i1",anio:2026,mes:1,iva_ventas:80000,iva_compras:80000,iva_pagado:0},{id:"i0",anio:2025,mes:12,iva_ventas:400000,iva_compras:100000,iva_pagado:300000}],
  perfiles:[{id:"u1",nombre:"Admin",rol:"admin",email:"a@a.cl"}],vendedores:[{id:"v1",nombre:"Vendedor Uno",comision_pct:10}],financiadores:[{id:"f1",nombre:"Financiador Uno",saldo_deuda:0}],gastos_indirectos:[],pagos_vendedor:[],categorias_gasto:[{id:"cat_impuesto",nombre:"Impuesto SII"}]};
const browser=await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome",args:["--no-sandbox"]});
const out={};
for(const [nom,url] of Object.entries(URLS)){
  const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,timezoneId:"America/Santiago"});
  const page=await ctx.newPage(); const errs=[]; const escr=[]; page.on("pageerror",e=>errs.push(e.message));
  await page.route("**/*",async route=>{ const u=new URL(route.request().url()); const m=route.request().method();
    if(u.hostname==="127.0.0.1") return route.continue();
    if(u.hostname.endsWith("supabase.co")){
      if(u.pathname.includes("/auth/v1/token")) return route.fulfill({json:{access_token:"t",refresh_token:"r",expires_in:3600,user:{id:"u1"}}});
      if(u.pathname.includes("/auth/v1/user")) return route.fulfill({json:{id:"u1"}});
      if(m!=="GET"){escr.push(m);return route.fulfill({json:[]});}
      const t=u.pathname.split("/").pop(); return route.fulfill({json:JSON.parse(JSON.stringify(TABLAS[t]||[]))}); }
    return route.abort(); });
  await page.addInitScript(()=>{localStorage.setItem("bfk_supabase_session_v2",JSON.stringify({access_token:"t",refresh_token:"r",user:{id:"u1",email:"a@a.cl"}}));});
  await page.goto(url,{waitUntil:"load"}); await page.waitForTimeout(1800);
  await page.mouse.click(348,820); await page.waitForTimeout(500); await page.getByText("Vendedores",{exact:true}).first().click(); await page.waitForTimeout(900);
  await page.getByText("Vendedor Uno").first().click(); await page.waitForTimeout(700);
  const ver=page.getByText(/Ver historial/); if(await ver.count()) { await ver.first().click(); await page.waitForTimeout(400); }
  const b=await page.evaluate(()=>document.body.innerText);
  const bloque=(lbl)=>{const i=b.indexOf(lbl,b.search(/comisión mes a mes/i)); if(i<0) return ""; const j=b.indexOf("= Comisión del mes",i); return b.slice(i,j+40);};
  const com=(lbl)=>(bloque(lbl).match(/= Comisión del mes: (\$[\d.]+)/)||[])[1]||null;
  out[nom]={mar26:com("Mar/2026"),feb26:com("Feb/2026"),ene26:com("Ene/2026"),dic25:com("Dic/2025"),
    desglose_neg:/IVA neto del período \(débito \$20\.000 − crédito \$80\.000\): \+\$60\.000 \(crédito mayor que débito: suma\)/.test(b),
    desglose_pos:/IVA neto del período \(débito \$190\.000 − crédito \$50\.000\): −\$140\.000/.test(b),
    desglose_cero:/IVA neto del período \(débito \$80\.000 − crédito \$80\.000\): \$0/.test(b),
    resultado_negativo_cuenta_0:/negativo: cuenta como \$0/.test(b),
    historial_neto_negativo:/neto −\$60\.000 · a pagar \$0/.test(b),
    historial_neto_positivo:/neto \$140\.000 · a pagar \$140\.000/.test(b),
    escrituras:escr.length,errores:errs.length};
  await ctx.close();
}
console.log(JSON.stringify(out,null,1));
const n=out.nueva,a=out.anterior;
const ok=n.mar26==="$530.000"&&n.feb26==="$430.000"&&n.ene26==="$500.000"&&n.dic25==="$0"&&a.mar26==="$500.000"&&a.feb26==="$430.000"&&a.ene26==="$500.000"&&a.dic25==="$0"
  &&n.desglose_neg&&n.desglose_pos&&n.desglose_cero&&n.resultado_negativo_cuenta_0&&n.historial_neto_negativo&&n.historial_neto_positivo&&n.escrituras===0&&n.errores===0&&a.errores===0;
console.log(ok?"RESULT|iva_ui|OK":"FALLA|iva_ui");
await browser.close();
