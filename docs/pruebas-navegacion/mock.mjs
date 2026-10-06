// Navegador con Supabase simulado. Las escrituras se registran y no salen a la red.
import { chromium } from "playwright-core";
import { crear } from "./datos.mjs";
export const CHROME=process.env.CHROME||"/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
export async function abrir(browser,{url,usuario="u1",ancho=390,alto=844,movil=true,datos}){
  const T=datos||crear(); const yo=usuario;
  const ctx=await browser.newContext({viewport:{width:ancho,height:alto},deviceScaleFactor:1,isMobile:movil,hasTouch:movil,timezoneId:"America/Santiago"});
  const page=await ctx.newPage(); const errs=[]; const escr=[]; const dlg=[];
  page.on("pageerror",e=>errs.push(e.message)); page.on("dialog",d=>{dlg.push(d.message().slice(0,80)); d.dismiss();});
  await page.route("**/*",async route=>{
    const u=new URL(route.request().url()); const m=route.request().method();
    if(u.hostname==="127.0.0.1"||u.hostname==="localhost") return route.continue();
    if(u.hostname.endsWith("supabase.co")){
      if(u.pathname.includes("/auth/v1/token")) return route.fulfill({json:{access_token:"t"+yo,refresh_token:"r",expires_in:3600,user:{id:yo}}});
      if(u.pathname.includes("/auth/v1/user")) return route.fulfill({json:{id:yo}});
      if(u.pathname.includes("/auth/v1/logout")) return route.fulfill({json:{}});
      if(u.pathname.endsWith("/rpc/gestionar_bloqueo_oc")) return route.fulfill({json:{ok:true,segundos_restantes:45}});
      if(m!=="GET"){ escr.push(m+" "+u.pathname.split("/").pop()); return route.fulfill({json:[]}); }
      const t=u.pathname.split("/").pop();
      let filas=JSON.parse(JSON.stringify(T[t]||[]));
      const idq=(u.search.match(/[?&]id=eq\.([^&]+)/)||[])[1]; if(idq) filas=filas.filter(r=>String(r.id)===decodeURIComponent(idq));
      return route.fulfill({json:filas});
    }
    return route.abort();
  });
  await page.addInitScript((id)=>{ try{ if(location.protocol.startsWith("http")) localStorage.setItem("bfk_supabase_session_v2",JSON.stringify({access_token:"t"+id,refresh_token:"r",user:{id,email:"x@x.cl"}})); }catch{} },yo);
  await page.goto(url,{waitUntil:"load"}); await page.waitForTimeout(1800);
  return {page,ctx,errs,escr,dlg};
}
