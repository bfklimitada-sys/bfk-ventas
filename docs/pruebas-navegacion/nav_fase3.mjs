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
// Rediseño 2026-10: Financiamiento, Comisiones (vendedores), Gastos, Impuestos y Banco viven en el centro Finanzas (pestañas).
const EN_FINANZAS=["finanzas","financiamiento","vendedores","gastos","impuestos","banco"];
async function ir(p,k,escritorio){
  if(EN_FINANZAS.includes(k)){
    if(!(await visible(p,`[data-tab="${k}"]`))){ await p.locator(escritorio?'aside [data-nav="finanzas"]':'nav [data-nav="finanzas"]').first().click(); await espera(p,400); }
    await p.locator(`[data-tab="${k}"]`).first().click(); await espera(p,450); return;
  }
  if(escritorio){ await p.locator(`aside [data-nav="${k}"]`).click(); }
  else if(await visible(p,`nav [data-nav="${k}"]`)){ await p.locator(`nav [data-nav="${k}"]`).click(); }
  else { await p.locator('[data-nav="mas"]').click(); await espera(p,250); await p.locator(`[role=dialog] [data-nav="${k}"]`).click(); }
  await espera(p,450);
}
// Funciones que deben poder alcanzarse desde cada pantalla (texto visible de botones/campos)
const FUNCIONES={
  panel:["Compra","Entrega","Factura","Pago","Cartola","Caja y compromisos","Mercado Público","Buscar OC, cliente, factura o monto"],
  finanzas:["Resultado del mes","Margen comercial"],
  impuestos:["IVA mensual","F29","Registrar IVA de otro mes","Ver historial"],
  banco:["Actualizar saldo de la cuenta","Conciliación","Cartola","Por revisar"],
  compras:["Buscar OC, cliente, RUT, comuna, factura...","Por comprar","Por entregar","Por facturar","Por cobrar","Financiamiento pendiente","Vale vista pendiente","Filtros"],
  agenda:["Octubre","Ver alertas"],
  notif:["Urgente","Atención","Informativas"],
  financiamiento:["Abonar a un financiador","Ver cartola","Registrar"],
  vendedores:["+ Pago a vendedor","Ir a Impuestos"],
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
    const pantallas=["panel","compras","agenda","notif","finanzas","financiamiento","vendedores","gastos","impuestos","banco",...(admin?["usuarios"]:[])];
    const titulos={panel:null,compras:"Compras",agenda:"Agenda",notif:"Alertas",finanzas:"Finanzas",financiamiento:"Finanzas",vendedores:"Finanzas",gastos:"Finanzas",impuestos:"Finanzas",banco:"Finanzas",usuarios:"Administración"};
    const rutas={panel:"#/panel",compras:"#/compras",agenda:"#/agenda",notif:"#/alertas",finanzas:"#/finanzas",financiamiento:"#/financiamiento",vendedores:"#/vendedores",gastos:"#/gastos",impuestos:"#/impuestos",banco:"#/banco",usuarios:"#/administracion"};
    for(const k of pantallas){
      await ir(p,k,esc);
      const t=await titulo(p); const h=await hash(p);
      const faltan=[];
      if(k==="usuarios"){ // Rediseño 2026-10: Administración en pestañas; cada función debe existir en alguna pestaña
        const pend=new Set(FUNCIONES[k]);
        for(const t of ["usuarios","datos","mp","archivadas","correcciones"]){ await p.locator(`[role=tablist][aria-label="Administración"] [data-tab="${t}"]`).click(); await espera(p,250); for(const f of [...pend]) if(await tieneTexto(p,f)) pend.delete(f); }
        faltan.push(...pend); await p.locator('[role=tablist][aria-label="Administración"] [data-tab="usuarios"]').click(); await espera(p,200);
      } else for(const f of FUNCIONES[k]) if(!(await tieneTexto(p,f))) faltan.push(f);
      ok(`${tag}_${k}_accesible`, h===rutas[k] && (titulos[k]===null ? /Buen/.test(t) : t===titulos[k]));
      ok(`${tag}_${k}_funciones`, faltan.length===0); if(faltan.length) console.log("FALTAN",tag,k,faltan);
      ok(`${tag}_${k}_marcada_activa`, (await p.locator(`[data-nav="${k}"][aria-current="page"]`).count())>=(esc||["panel","compras","notif",...EN_FINANZAS].includes(k)?1:0));
    }
    // Administración solo para administrador
    ok(`${tag}_admin_visible_segun_rol`, admin ? true : (await p.locator('[data-nav="usuarios"]').count())===0);
    if(!esc){ await p.locator('[data-nav="mas"]').click(); await espera(p,250); }
    ok(`${tag}_admin_en_menu_segun_rol`, ((await p.locator('[data-nav="usuarios"]').count())>0)===admin);
    ok(`${tag}_pdf_segun_rol`, ((await p.locator('button[aria-label^="Imprimir"]').count())>0)===admin);
    ok(`${tag}_cerrar_sesion_disponible`, (await p.locator('[data-nav="salir"]').count())>0);
    if(!esc){ await p.keyboard.press("Escape"); await espera(p,250); ok(`${tag}_escape_cierra_menu`, (await p.locator('[role=dialog]').count())===0); }
    // Atrás / adelante
    await ir(p,"panel",esc); await ir(p,"compras",esc); await ir(p,"agenda",esc);
    await p.goBack(); await espera(p); const a1=await hash(p), t1=await titulo(p);
    await p.goBack(); await espera(p); const a2=await hash(p);
    await p.goForward(); await espera(p); const a3=await hash(p), t3=await titulo(p);
    ok(`${tag}_atras_adelante`, a1==="#/compras"&&t1==="Compras"&&a2==="#/panel"&&a3==="#/compras"&&t3==="Compras"); if(!R[`${tag}_atras_adelante`]) console.log("atras",a1,t1,a2,a3,t3);
    // Recarga conserva la pantalla
    await ir(p,"gastos",esc); await p.reload({waitUntil:"load"}); await espera(p,1800);
    ok(`${tag}_recarga_conserva`, (await hash(p))==="#/gastos" && (await titulo(p))==="Finanzas" && (await p.locator('[data-tab="gastos"][aria-selected="true"]').count())===1);
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
    const acciones=[["Compra","Ingresar compra"],["Entrega","Ingresar entrega"],["Factura","Ingresar factura"],["Pago","Ingresar pago"]];
    // Rediseño 2026-10: el saldo de la cuenta se actualiza desde Finanzas › Banco
    await ir(p,"banco",esc); await p.getByText("Actualizar saldo de la cuenta",{exact:true}).first().click(); await espera(p,350);
    { const t=await p.locator('[role=dialog] [id]').first().innerText().catch(()=>""); if(!t.includes("Saldo de la cuenta del banco")){accOk=false; console.log("accion saldo ->",t);} await p.keyboard.press("Escape"); await espera(p,250); await ir(p,"panel",esc); }
    let accOk=true; for(const [b,tit] of acciones){ await p.getByText(b,{exact:true}).first().click(); await espera(p,350); const t=await p.locator('[role=dialog] [id]').first().innerText().catch(()=>""); if(!t.includes(tit)){accOk=false; console.log("accion",b,"->",t);} await p.keyboard.press("Escape"); await espera(p,250);}
    ok(`${tag}_acciones_panel_abren`, accOk);
    // Pestañas dentro de una pantalla (Impuestos → F29) y acceso desde Comisiones a Impuestos
    await ir(p,"vendedores",esc); await p.locator('[data-aviso-linea="ir-impuestos"]').click(); await espera(p,500);
    const enImp=(await hash(p))==="#/impuestos";
    await p.locator('[role=tablist][aria-label="Impuestos"] [data-tab="f29"]').click(); await espera(p,400);
    ok(`${tag}_indice_vendedores`, enImp && (await p.getByText("Total pendiente").count())>0);
    if(admin){ await ir(p,"usuarios",esc); await p.locator('[role=tablist][aria-label="Administración"] [data-tab="archivadas"]').click(); await espera(p,500);
      ok(`${tag}_indice_administracion`, (await p.locator('[data-oc-archivada]').count())===1 && await p.locator('[data-oc-archivada]').first().isVisible());
      ok(`${tag}_archivada_listada`, (await p.locator('[data-oc-archivada]').count())===1);
      await p.locator('[role=tablist][aria-label="Administración"] [data-tab="datos"]').click(); await espera(p,400);
      ok(`${tag}_exportar_unico`, (await p.getByText(/Exportar Excel completo/).count())===1 && (await p.getByText("Exportar todo a Excel").count())===0);
    }
    // Enlace directo a Administración
    await p.goto(URL_APP+"#/administracion",{waitUntil:"load"}); await espera(p,1800);
    const hA=await hash(p), tA=await titulo(p);
    ok(`${tag}_enlace_administracion`, admin ? (hA==="#/administracion"&&tA==="Administración") : (hA==="#/panel"&&/Buen/.test(tA)));
    // Dirección desconocida
    await p.goto(URL_APP+"#/no-existe",{waitUntil:"load"}); await espera(p,1800);
    ok(`${tag}_direccion_desconocida_a_panel`, (await hash(p))==="#/panel");
    // Enlace de recuperación (correo de Supabase): abre "Nueva contraseña", borra los tokens de la dirección
    // y, al cancelar, vuelve a la app con la sesión que ya existía (ver docs/pruebas-recuperacion).
    await p.goto("about:blank"); await p.goto(URL_APP+"#access_token=prueba&type=recovery",{waitUntil:"load"}); await espera(p,1800);
    const enRecuperacion=(await p.locator("text=Guardar nueva contraseña").count())>0 && !/access_token/.test(await p.evaluate(()=>location.href));
    await p.locator("text=Cancelar y volver a iniciar sesión").click(); await espera(p,900);
    ok(`${tag}_hash_con_datos_intacto`, enRecuperacion && (await hash(p))==="#/panel" && /Buen/.test(await titulo(p)));
    // Título de la pestaña
    await ir(p,"compras",esc); ok(`${tag}_titulo_pestana`, (await p.title())==="Compras · BFK Ltda");
    // Cerrar sesión desde el menú / barra lateral
    if(!esc){ await p.locator('[data-nav="mas"]').click(); await espera(p,250); }
    await p.locator('[data-nav="salir"]').click(); await espera(p,900);
    ok(`${tag}_cerrar_sesion`, (await p.locator('input[type="password"]').count())>0);
    // Fase 4C: la revisión automática de Mercado Público escribe solo en tablas técnicas de caché (mp_cache_avisos, mp_uso_diario).
    ok(`${tag}_sin_escrituras`, escr.filter(e=>!/oc_bloqueos|mp_cache_avisos|mp_uso_diario/.test(e)).length===0); if(escr.length) console.log("ESCRITURAS",tag,escr);
    ok(`${tag}_sin_errores`, errs.length===0); if(errs.length) console.log("ERRORES",tag,errs.slice(0,3));
    await p.context().close();
  }
}
await browser.close();
console.log(JSON.stringify(R,null,0));
console.log(F.length?`FALLAS (${F.length}): ${F.join(", ")}`:`RESULT|navegacion_fase3|OK (${Object.keys(R).length} comprobaciones)`);
process.exit(F.length?1:0);
