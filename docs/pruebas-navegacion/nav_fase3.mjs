// Prueba de interfaz (Chromium + Playwright, Supabase simulado; sin escrituras). Uso: node nav_fase3.mjs URL
// Prueba de navegación Fase 3 (interfaz simulada, sin escrituras): rutas, atrás/adelante, recarga,
// enlaces directos, permisos admin/usuario, celular/escritorio, ventanas, Escape y accesos a funciones.
import { chromium } from "playwright-core";
import { abrir, CHROME } from "./mock.mjs";
const URL_APP=process.argv[2]||"http://127.0.0.1:4177/";
const browser=await chromium.launch({executablePath:CHROME,args:["--no-sandbox"]});
const R={}; const F=[]; const ok=(k,v)=>{R[k]=!!v; if(!v) F.push(k);};
const espera=(p,ms=500)=>p.waitForTimeout(ms);
const hash=(p)=>p.evaluate(()=>location.hash);
const titulo=async(p)=>(await p.locator("h1").first().innerText()).trim();
const visible=async(p,sel)=>{const l=p.locator(sel); return (await l.count())>0&&await l.first().isVisible();};
async function ir(p,k,escritorio){
  if(escritorio){ await p.locator(`aside [data-nav="${k}"]`).click(); }
  else if(await visible(p,`nav [data-nav="${k}"]`)){ await p.locator(`nav [data-nav="${k}"]`).click(); }
  else { await p.locator('[data-nav="mas"]').click(); await espera(p,250); await p.locator(`[role=dialog] [data-nav="${k}"]`).click(); }
  await espera(p,450);
}
// Funciones que deben poder alcanzarse desde cada pantalla (texto visible de botones/campos)
const FUNCIONES={
  panel:["Compra","Entrega","Factura","Pago","Cartola","Actualizar saldo de la cuenta","Buscar OC, cliente, factura o monto"],
  compras:["Buscar OC, cliente, RUT, comuna, factura...","Por comprar","Por entregar","Por facturar","Por cobrar","Por pagar","Filtros avanzados"],
  agenda:["Octubre","Ver alertas"],
  notif:["Urgente","Atención","Informativas"],
  financiamiento:["Abonar a un financiador","Ver cartola","Registrar"],
  vendedores:["+ Pago a vendedor","Registrar IVA de otro mes","Ver historial"],
  gastos:["+ Registrar gasto"],
  usuarios:["Hacer admin","Exportar Excel completo","Subir Excel editado","Importar entidades","Validar todas mis OC contra Mercado Público","Corregir fechas de todas contra Mercado Público","OCs archivadas"],
};
const tieneTexto=async(p,t)=>{ if(/^Buscar/.test(t)) return (await p.locator(`input[placeholder*="${t.slice(0,18)}"]`).count())>0; return (await p.getByText(t,{exact:false}).count())>0; };

for(const [modo,ancho,alto,movil] of [["movil",390,844,true],["escritorio",1440,900,false]]){
  const esc=modo==="escritorio";
  for(const u of ["u1","u2"]){
    const admin=u==="u1"; const tag=`${modo}_${admin?"admin":"usuario"}`;
    const {page:p,errs,escr}=await abrir(browser,{url:URL_APP,usuario:u,ancho,alto,movil});
    ok(`${tag}_inicio_en_panel`,(await hash(p))==="#/panel");
    ok(`${tag}_barra_correcta`, esc ? (await visible(p,"aside"))&&!(await visible(p,'[data-nav="mas"]')) : (await visible(p,'[data-nav="mas"]'))&&!(await visible(p,"aside")));
    const pantallas=["panel","compras","agenda","notif","financiamiento","vendedores","gastos",...(admin?["usuarios"]:[])];
    const titulos={panel:null,compras:"Compras",agenda:"Agenda",notif:"Alertas",financiamiento:"Financiamiento",vendedores:"Vendedores",gastos:"Gastos",usuarios:"Administración"};
    const rutas={panel:"#/panel",compras:"#/compras",agenda:"#/agenda",notif:"#/alertas",financiamiento:"#/financiamiento",vendedores:"#/vendedores",gastos:"#/gastos",usuarios:"#/administracion"};
    for(const k of pantallas){
      await ir(p,k,esc);
      const t=await titulo(p); const h=await hash(p);
      const faltan=[]; for(const f of FUNCIONES[k]) if(!(await tieneTexto(p,f))) faltan.push(f);
      ok(`${tag}_${k}_accesible`, h===rutas[k] && (titulos[k]===null ? /Buen/.test(t) : t===titulos[k]));
      ok(`${tag}_${k}_funciones`, faltan.length===0); if(faltan.length) console.log("FALTAN",tag,k,faltan);
      ok(`${tag}_${k}_marcada_activa`, (await p.locator(`[data-nav="${k}"][aria-current="page"]`).count())>=(esc||["panel","compras","agenda","notif"].includes(k)?1:0));
    }
    // Administración solo para administrador
    ok(`${tag}_admin_visible_segun_rol`, admin ? true : (await p.locator('[data-nav="usuarios"]').count())===0);
    if(!esc){ await p.locator('[data-nav="mas"]').click(); await espera(p,250); }
    ok(`${tag}_admin_en_menu_segun_rol`, ((await p.locator('[data-nav="usuarios"]').count())>0)===admin);
    ok(`${tag}_pdf_segun_rol`, ((await p.locator('button[aria-label^="Imprimir"]').count())>0)===admin);
    ok(`${tag}_cerrar_sesion_disponible`, (await p.locator('[data-nav="salir"]').count())>0);
    if(!esc){ await p.keyboard.press("Escape"); await espera(p,250); ok(`${tag}_escape_cierra_menu`, (await p.locator('[role=dialog]').count())===0); }
    // Atrás / adelante
    await ir(p,"panel",esc); await ir(p,"compras",esc); await ir(p,"vendedores",esc);
    await p.goBack(); await espera(p); const a1=await hash(p), t1=await titulo(p);
    await p.goBack(); await espera(p); const a2=await hash(p);
    await p.goForward(); await espera(p); const a3=await hash(p), t3=await titulo(p);
    ok(`${tag}_atras_adelante`, a1==="#/compras"&&t1==="Compras"&&a2==="#/panel"&&a3==="#/compras"&&t3==="Compras");
    // Recarga conserva la pantalla
    await ir(p,"gastos",esc); await p.reload({waitUntil:"load"}); await espera(p,1800);
    ok(`${tag}_recarga_conserva`, (await hash(p))==="#/gastos" && (await titulo(p))==="Gastos");
    // Desplazamiento: al cambiar de pantalla vuelve arriba
    await ir(p,"panel",esc); await p.evaluate(()=>window.scrollTo(0,600)); await espera(p,200); await ir(p,"compras",esc);
    ok(`${tag}_pantalla_nueva_arriba`, (await p.evaluate(()=>window.scrollY))===0);
    // Ventana + atrás: se cierra la ventana y se queda en la pantalla
    await ir(p,"agenda",esc);
    await p.getByText("+ Nueva OC").first().click(); await espera(p,400);
    const conVentana=(await p.locator('[role=dialog][aria-modal="true"]').count())>0;
    await p.goBack(); await espera(p,500);
    ok(`${tag}_atras_cierra_ventana`, conVentana && (await p.locator('[role=dialog]').count())===0 && (await hash(p))==="#/agenda");
    // Escape cierra ventana
    await p.getByText("+ Nueva OC").first().click(); await espera(p,400);
    await p.keyboard.press("Escape"); await espera(p,300);
    ok(`${tag}_escape_cierra_ventana`, (await p.locator('[role=dialog]').count())===0);
    // Ventana: posición según dispositivo
    await ir(p,"panel",esc); await p.getByText("Cartola",{exact:true}).first().click(); await espera(p,500);
    const caja=await p.locator('[role=dialog]').first().boundingBox();
    ok(`${tag}_ventana_ubicada`, esc ? Math.abs((caja.y+caja.height/2)-alto/2)<60 : Math.abs((caja.y+caja.height)-alto)<4);
    await p.locator('[role=dialog] button[aria-label="Cerrar"]').click(); await espera(p,300);
    // Acciones rápidas del Panel abren su ventana
    const acciones=[["Compra","Ingresar compra"],["Entrega","Ingresar entrega"],["Factura","Ingresar factura"],["Pago","Ingresar pago"],["Actualizar saldo de la cuenta","Saldo de la cuenta del banco"]];
    let accOk=true; for(const [b,tit] of acciones){ await p.getByText(b,{exact:true}).first().click(); await espera(p,350); const t=await p.locator('[role=dialog] [id]').first().innerText().catch(()=>""); if(!t.includes(tit)){accOk=false; console.log("accion",b,"->",t);} await p.keyboard.press("Escape"); await espera(p,250);}
    ok(`${tag}_acciones_panel_abren`, accOk);
    // Índice dentro de pantalla (Vendedores → IVA mensual; Administración → OCs archivadas)
    await ir(p,"vendedores",esc); await p.locator('.bfk-indice button',{hasText:"IVA mensual"}).click(); await espera(p,900);
    const ivaTop=await p.evaluate(()=>{const r=document.getElementById("ven-iva").getBoundingClientRect(); const fin=Math.abs(window.scrollY+innerHeight-document.documentElement.scrollHeight)<4; return {top:r.top, fin, alto:innerHeight};});
    ok(`${tag}_indice_vendedores`, ivaTop.top>=0 && (ivaTop.top<220 || (ivaTop.fin && ivaTop.top<ivaTop.alto-120))); if(!R[`${tag}_indice_vendedores`]) console.log("ivaTop",ivaTop);
    if(admin){ await ir(p,"usuarios",esc); await p.locator('.bfk-indice button',{hasText:"OCs archivadas"}).click(); await espera(p,900);
      const t=await p.evaluate(()=>{const r=document.getElementById("adm-archivadas").getBoundingClientRect(); const fin=Math.abs(window.scrollY+innerHeight-document.documentElement.scrollHeight)<4; return {top:r.top, fin, alto:innerHeight};});
      ok(`${tag}_indice_administracion`, t.top>=0 && (t.top<220 || (t.fin && t.top<t.alto-120))); if(!R[`${tag}_indice_administracion`]) console.log("admTop",t);
      ok(`${tag}_exportar_unico`, (await p.getByText(/Exportar Excel completo/).count())===1 && (await p.getByText("Exportar todo a Excel").count())===0);
      ok(`${tag}_archivada_listada`, (await p.locator('[data-oc-archivada]').count())===1);
    }
    // Enlace directo a Administración
    await p.goto(URL_APP+"#/administracion",{waitUntil:"load"}); await espera(p,1800);
    const hA=await hash(p), tA=await titulo(p);
    ok(`${tag}_enlace_administracion`, admin ? (hA==="#/administracion"&&tA==="Administración") : (hA==="#/panel"&&/Buen/.test(tA)));
    // Dirección desconocida
    await p.goto(URL_APP+"#/no-existe",{waitUntil:"load"}); await espera(p,1800);
    ok(`${tag}_direccion_desconocida_a_panel`, (await hash(p))==="#/panel");
    // Dirección con datos de autenticación (correo de Supabase): no se borra al abrir
    await p.goto("about:blank"); await p.goto(URL_APP+"#access_token=prueba&type=recovery",{waitUntil:"load"}); await espera(p,1800);
    ok(`${tag}_hash_con_datos_intacto`, (await hash(p))==="#access_token=prueba&type=recovery" && /Buen/.test(await titulo(p)));
    // Título de la pestaña
    await ir(p,"compras",esc); ok(`${tag}_titulo_pestana`, (await p.title())==="Compras · BFK Ltda");
    // Cerrar sesión desde el menú / barra lateral
    if(!esc){ await p.locator('[data-nav="mas"]').click(); await espera(p,250); }
    await p.locator('[data-nav="salir"]').click(); await espera(p,900);
    ok(`${tag}_cerrar_sesion`, (await p.locator('input[type="password"]').count())>0);
    ok(`${tag}_sin_escrituras`, escr.filter(e=>!/oc_bloqueos/.test(e)).length===0); if(escr.length) console.log("ESCRITURAS",tag,escr);
    ok(`${tag}_sin_errores`, errs.length===0); if(errs.length) console.log("ERRORES",tag,errs.slice(0,3));
    await p.context().close();
  }
}
await browser.close();
console.log(JSON.stringify(R,null,0));
console.log(F.length?`FALLAS (${F.length}): ${F.join(", ")}`:`RESULT|navegacion_fase3|OK (${Object.keys(R).length} comprobaciones)`);
process.exit(F.length?1:0);
