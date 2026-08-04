import { useState, useEffect, useRef } from "react";
import { LoginScreen } from "./components/auth/LoginScreen";
import { FormIngresarCompra } from "./components/forms/FormIngresarCompra";
import { NuevaOCRapida } from "./components/forms/NuevaOCRapida";
import { FormCompraRapida } from "./components/forms/FormCompraRapida";
import { FormAbonoFinanciador, repartirFIFO } from "./components/forms/FormAbonoFinanciador";
import { ImportarCartola } from "./components/forms/ImportarCartola";
import { FormSaldoBanco } from "./components/forms/FormSaldoBanco";
import { FormConfirmarEntrega, FormEmitirFactura, FormPagoCliente } from "./components/forms/FormulariosRapidos";
import { PanelCalendario } from "./components/panels/PanelCalendario";
import { PanelCompras } from "./components/panels/PanelCompras";
import { PanelDashboard } from "./components/panels/PanelDashboard";
import { PanelFinanciamiento } from "./components/panels/PanelFinanciamiento";
import { PanelGastos } from "./components/panels/PanelGastos";
import { PanelUsuarios } from "./components/panels/PanelUsuarios";
import { PanelVendedores } from "./components/panels/PanelVendedores";
import { Modal, NotifBadge, Toast } from "./components/ui/Basicos";
import { PanelNotificaciones, calcularAlertas } from "./components/ui/Multiusuario";
import { SESSION_KEY, SUPABASE_URL, bloquearOC, crearNotificacion, del, genId, getBloqueosVigentes, getPerfil, hdrs, ins, liberarOC, registrarCambio, sel, selOCs, selPerfiles, storageGet, storageSet, supaRefresh, supaSignOut, upd, updRol } from "./lib/supabase";
import { C, MONO, SANS, fmt } from "./lib/theme";

export const TABS=[
  {key:"panel",label:"Panel",icon:"📊"},
  {key:"compras",label:"Compras",icon:"📦"},
  {key:"agenda",label:"Agenda",icon:"📅"},
  {key:"financiamiento",label:"Financ.",icon:"🏦"},
  {key:"gastos",label:"Gastos",icon:"🧾"},
  {key:"vendedores",label:"Vendedores",icon:"🧑‍💼"},
  {key:"notif",label:"Alertas",icon:"🔔"},
  {key:"usuarios",label:"Usuarios",icon:"👥",adminOnly:true},
];

export default function App() {
  const [session,setSession]=useState(null); const [perfil,setPerfil]=useState(null); const [loadingApp,setLoadingApp]=useState(true);
  const [tab,setTab]=useState("panel"); const [filtroCompras,setFiltroCompras]=useState(null); const [ocFoco,setOcFoco]=useState(null);
  // OCs ya consultadas a la API en esta sesión (para no reintentar en bucle)
  const intentadas=useRef(new Set());
  const [accion,setAccion]=useState(null);
  const [menuMas,setMenuMas]=useState(false);
  const [toast,setToast]=useState(null);
  const [ocs,setOcs]=useState([]); const [financiadores,setFinanciadores]=useState([]); const [vendedores,setVendedores]=useState([]);
  const [categoriasGasto,setCategoriasGasto]=useState([]); const [gastos,setGastos]=useState([]); const [ivaMensual,setIvaMensual]=useState([]);
  const [pagosVendedor,setPagosVendedor]=useState([]); const [ajustesSaldo,setAjustesSaldo]=useState([]); const [perfiles,setPerfiles]=useState([]);
  const [contactos,setContactos]=useState([]);
  const [entidadesCatalogo,setEntidadesCatalogo]=useState([]);
  const [pagoFinSueltos,setPagoFinSueltos]=useState([]);
  const [bloqueos,setBloqueos]=useState([]);
  const [notificaciones,setNotificaciones]=useState([]);
  const [historialCambios,setHistorialCambios]=useState([]);
  const [aportes,setAportes]=useState([]);
  const [porAceptar,setPorAceptar]=useState([]); // OCs enviadas y sin aceptar en MP
  const [aceptadasSinCargar,setAceptadasSinCargar]=useState([]); // OCs ya aceptadas en MP, pendientes de cargar
  const [codigoOcRapida,setCodigoOcRapida]=useState(""); // prefill al cargar desde el aviso
  const [ultimaCartola,setUltimaCartola]=useState(null);
  const [saldoBanco,setSaldoBanco]=useState(null);
  const [bancoMensual,setBancoMensual]=useState([]);

  const showToast=(msg,type="success")=>{ setToast({msg,type}); setTimeout(()=>setToast(null),3000); };

  useEffect(()=>{
    (async()=>{
      const saved=storageGet(SESSION_KEY);
      if(saved){ try {
        let s=JSON.parse(saved);
        try{ s=await supaRefresh(s.refresh_token); storageSet(SESSION_KEY,JSON.stringify(s)); } catch{}
        setSession(s); const p=await getPerfil(s.access_token,s.user.id); setPerfil(p);
      } catch{} }
      setLoadingApp(false);
    })();
  },[]);

  const handleLogin=async(s)=>{
    setSession(s); storageSet(SESSION_KEY,JSON.stringify(s));
    let p=await getPerfil(s.access_token,s.user.id);
    if(!p){ const all=await selPerfiles(s.access_token); const esPrimero=all.length===0;
      p=await ins("perfiles",s.access_token,{id:s.user.id,nombre:s.user.user_metadata?.nombre||s.user.email,rol:esPrimero?"admin":"usuario"});
      p=Array.isArray(p)?p[0]:p; }
    setPerfil(p);
  };
  const handleLogout=async()=>{ await supaSignOut(session.access_token); setSession(null); setPerfil(null); storageSet(SESSION_KEY,""); };

  // Reintenta una función asíncrona hasta 2 veces antes de rendirse.
  // Para datos críticos (OCs, perfiles) que no queremos dejar vacíos
  // solo porque Supabase tuvo un mal momento con tantas conexiones.
  const conReintento=async(fn)=>{
    try{ return await fn(); }
    catch(e){
      await new Promise(res=>setTimeout(res,1200));
      return await fn(); // si falla la segunda vez, el error sube tal cual
    }
  };

  // Ejecuta las consultas en grupos chicos en vez de las 21 a la vez:
  // disparar tantas conexiones simultáneas puede superar el límite del
  // plan de Supabase, y ahí fallan al azar las que no alcanzan a entrar.
  const enLotes=async(tareas,tamano=6)=>{
    const resultados=[];
    for(let i=0;i<tareas.length;i+=tamano){
      const lote=tareas.slice(i,i+tamano).map(fn=>fn());
      resultados.push(...await Promise.all(lote));
    }
    return resultados;
  };

  // ─── Contador de uso diario de Mercado Público ───────────────
  // Su API tiene un límite de 10.000 solicitudes por día por ticket.
  // Como el ticket vive del lado del servidor (no en el navegador),
  // la app no puede leer cuánto consumió — así que lleva su propia
  // cuenta estimada, sumando lo que ella misma dispara en cada acción.
  const [usoMP,setUsoMP]=useState(null); // {id,solicitudes}
  const hoyISO=()=>new Date().toISOString().slice(0,10);

  const cargarUsoMP=async()=>{
    try{
      const r=await sel("mp_uso_diario",session.access_token,`&id=eq.${hoyISO()}`);
      setUsoMP((r||[])[0]||{id:hoyISO(),solicitudes:0});
    }catch{ /* si falla, simplemente no se muestra el contador */ }
  };

  const registrarUsoMP=async(cantidad)=>{
    if(!cantidad||!session) return;
    const t=session.access_token, dia=hoyISO();
    try{
      const actualizadas=await upd("mp_uso_diario",t,dia,
        {solicitudes:(usoMP?.id===dia?usoMP.solicitudes:0)+cantidad,actualizado_en:new Date().toISOString()}
      ).catch(()=>[]);
      if(Array.isArray(actualizadas)&&actualizadas.length){
        setUsoMP(actualizadas[0]);
      }else{
        const nueva=await ins("mp_uso_diario",t,{id:dia,solicitudes:cantidad}).catch(()=>null);
        if(nueva) setUsoMP(Array.isArray(nueva)?nueva[0]:nueva);
      }
    }catch{ /* que falle esto no debe frenar la acción real */ }
  };

  useEffect(()=>{ if(session) cargarUsoMP(); },[session]);

  // Antes de una acción pesada (cientos de solicitudes de una vez),
  // avisa si eso acercaría al límite diario de 10.000 de Mercado Público.
  const confirmarSiCercaDelLimite=(estimado)=>{
    const usado=usoMP?.solicitudes||0;
    if(usado+estimado>9000){
      return window.confirm(
        `Ya van ~${usado.toLocaleString("es-CL")} solicitudes hoy a Mercado Público.\n\n`+
        `Esto sumaría ~${estimado} más, acercándose al límite diario de 10.000 (después de eso, Mercado Público puede dejar de responder por el resto del día).\n\n`+
        `¿Continuar de todas formas?`
      );
    }
    return true;
  };

  const cargarTodo=async()=>{
    if(!session) return;
    const t=session.access_token;
    try {
      const [ocsD,finD,vendD,catD,gastD,ivaD,pagVD,ajuD,perfD,contD,entD,pagoFinSueltosD,notifD,histD,reclamosD,respD,pvD,aporD,cartD,sbD,bmD]=await enLotes([
        ()=>conReintento(()=>selOCs(t)),
        ()=>sel("financiadores",t,"&order=nombre").catch(()=>[]),
        ()=>sel("vendedores",t,"&order=nombre").catch(()=>[]),
        ()=>sel("categorias_gasto",t,"&order=nombre").catch(()=>[]),
        ()=>sel("gastos_indirectos",t,"&order=fecha.desc").catch(()=>[]),
        ()=>sel("iva_mensual",t).catch(()=>[]),
        ()=>sel("pagos_vendedor",t).catch(()=>[]),
        ()=>sel("ajustes_saldo_financiador",t,"&order=creadoEn.desc").catch(()=>[]),
        ()=>conReintento(()=>selPerfiles(t)),
        ()=>sel("contactos_cobranza",t).catch(()=>[]),
        ()=>sel("entidades_catalogo",t).catch(()=>[]),
        ()=>sel("eventos_pago_financiamiento",t,"&oc_id=is.null").catch(()=>[]),
        ()=>sel("notificaciones",t,`&usuario_id=eq.${session.user.id}&order=creadoEn.desc&limit=50`).catch(()=>[]),
        ()=>sel("historial_cambios",t,"&order=creadoEn.desc&limit=200").catch(()=>[]),
        ()=>sel("oc_reclamos",t,"&order=fecha.desc").catch(()=>[]),
        ()=>sel("oc_responsables",t).catch(()=>[]),
        ()=>sel("eventos_postventa",t,"&order=creadoEn.desc").catch(()=>[]),
        ()=>sel("aportes_socios",t,"&order=fecha.desc").catch(()=>[]),
        ()=>sel("cartolas_importadas",t,"&order=fecha_hasta.desc&limit=1").catch(()=>[]),
        ()=>sel("saldo_banco",t,"&id=eq.actual").catch(()=>[]),
        ()=>sel("banco_mensual",t,"&order=id.desc&limit=24").catch(()=>[]),
      ]);
      const reclamosPorOC={}, respPorOC={}, pvPorOC={};
      for(const r of reclamosD){ if(!reclamosPorOC[r.oc_id]) reclamosPorOC[r.oc_id]=[]; reclamosPorOC[r.oc_id].push(r); }
      for(const r of respD){ if(!respPorOC[r.oc_id]) respPorOC[r.oc_id]=[]; respPorOC[r.oc_id].push(r); }
      for(const r of pvD){ if(!pvPorOC[r.oc_id]) pvPorOC[r.oc_id]=[]; pvPorOC[r.oc_id].push(r); }
      const ocsConReclamos=ocsD.map(oc=>({...oc,oc_reclamos:reclamosPorOC[oc.id]||[],oc_responsables:respPorOC[oc.id]||[],eventos_postventa:pvPorOC[oc.id]||[]}));
      setOcs(ocsConReclamos); setFinanciadores(finD); setVendedores(vendD); setCategoriasGasto(catD);
      setGastos(gastD); setIvaMensual(ivaD); setPagosVendedor(pagVD); setAjustesSaldo(ajuD); setPerfiles(perfD);
      setContactos(contD); setEntidadesCatalogo(entD); setPagoFinSueltos(pagoFinSueltosD);
      setNotificaciones(notifD); setHistorialCambios(histD); setAportes(aporD); setUltimaCartola((cartD||[])[0]||null); setSaldoBanco((sbD||[])[0]||null); setBancoMensual(bmD||[]);

      // Reintentar completar las OCs que se guardaron antes de ser aceptadas
      const faltanDatos=ocsConReclamos.some(o=>esCodigoMP(o.numero_oc)&&!o.no_en_mp&&(o.sync_pendiente||!o.rut_cliente||!o.fecha_emision_mp||String(o.cliente||"").toUpperCase().includes("POR COMPLETAR")));
      if(faltanDatos){
        sincronizarPendientes(ocsConReclamos).then(n=>{
          if(n>0){ showToast(`${n} OC${n>1?"s":""} completada${n>1?"s":""} desde Mercado Público`); cargarTodo(); }
        }).catch(()=>{});
      }
    } catch(e){ showToast(e.message,"error"); }
  };
  useEffect(()=>{ if(session) cargarTodo(); },[session]);

  useEffect(()=>{
    if(!session) return;
    const handleVisible=()=>{ if(document.visibilityState==="visible") cargarTodo(); };
    document.addEventListener("visibilitychange",handleVisible);
    return()=>document.removeEventListener("visibilitychange",handleVisible);
  },[session]);

  useEffect(()=>{
    if(!session) return;
    const tick=async()=>{
      try { const b=await getBloqueosVigentes(session.access_token); setBloqueos(b); } catch{}
    };
    tick();
    const id=setInterval(tick,10000);
    return()=>clearInterval(id);
  },[session]);

  // ─── HANDLERS ─────────────────────────────────
  const handleIngresarCompra=async(data)=>{
    const t=session.access_token; let ocId=data.ocId;
    if(data.esNueva){
      const nOc=await ins("ordenes_compra_v2",t,{id:genId("ocv2"),numero_oc:data.numNueva,cliente:data.cliente,rut_cliente:data.rutCliente||"",correo_cliente:data.correo||"",entidad:data.entidad||"",comuna:data.comuna||"",contacto:data.contacto||"",vendedor_id:data.vendedorId,financiador_id:data.financiadorId,monto_total:data.montoVenta,costo_total:data.costoCompra,estado_compra:"comprado",creado_por:session.user.id});
      ocId=(Array.isArray(nOc)?nOc[0]:nOc).id;
      if(data.productos?.length){
        for(let i=0;i<data.productos.length;i++){
          const p=data.productos[i];
          const desc=`${p.descripcion} × ${p.cantidad} | Compra: $${(p.precioCompra*p.cantidad).toLocaleString("es-CL")} | Venta: $${(p.precioVenta*p.cantidad).toLocaleString("es-CL")}`;
          await ins("oc_productos_link",t,{id:genId("lnk"),oc_id:ocId,descripcion:desc,url:p.url||"sin-link",orden:i,creado_por:session.user.id});
        }
      }
      if(data.rutCliente?.trim()){
        try{
          const existente=entidadesCatalogo.find(e=>e.rut===data.rutCliente.trim());
          const datosEnt={rut:data.rutCliente.trim(),nombre_entidad:data.entidad||data.cliente||"",comuna:data.comuna||"",contacto:data.contacto||"",correo:data.correo||""};
          if(existente) await upd("entidades_catalogo",t,existente.id,datosEnt);
          else await ins("entidades_catalogo",t,{id:genId("ent"),...datosEnt,creado_por:session.user.id});
        }catch{}
      }
    } else {
      await upd("ordenes_compra_v2",t,ocId,{estado_compra:"comprado",monto_total:data.montoVenta,costo_total:data.costoCompra,financiador_id:data.financiadorId,cliente:data.cliente,rut_cliente:data.rutCliente||"",correo_cliente:data.correo||"",entidad:data.entidad||"",comuna:data.comuna||"",contacto:data.contacto||"",vendedor_id:data.vendedorId});
      if(data.productos?.length){
        const existentes=(ocs.find(o=>o.id===ocId)?.oc_productos_link||[]).length;
        for(let i=0;i<data.productos.length;i++){
          const p=data.productos[i];
          const desc=`${p.descripcion} × ${p.cantidad} | Compra: $${(p.precioCompra*p.cantidad).toLocaleString("es-CL")} | Venta: $${(p.precioVenta*p.cantidad).toLocaleString("es-CL")}`;
          await ins("oc_productos_link",t,{id:genId("lnk"),oc_id:ocId,descripcion:desc,url:p.url||"sin-link",orden:existentes+i,creado_por:session.user.id});
        }
      }
      if(data.rutCliente?.trim()){
        try{
          const existente=entidadesCatalogo.find(e=>e.rut===data.rutCliente.trim());
          const datosEnt={rut:data.rutCliente.trim(),nombre_entidad:data.entidad||data.cliente||"",comuna:data.comuna||"",contacto:data.contacto||"",correo:data.correo||""};
          if(existente) await upd("entidades_catalogo",t,existente.id,datosEnt);
          else await ins("entidades_catalogo",t,{id:genId("ent"),...datosEnt,creado_por:session.user.id});
        }catch{}
      }
    }
    await ins("eventos_compra",t,{id:genId("evc"),oc_id:ocId,fecha:data.fecha,monto_venta:data.montoVenta,costo_compra:data.costoCompra,fecha_entrega_estimada:data.fechaEst,financiador_id:data.financiadorId,proveedor:data.proveedor,creado_por:session.user.id});
    const fin=financiadores.find(f=>f.id===data.financiadorId);
    if(fin) await upd("financiadores",t,fin.id,{saldo_deuda:Number(fin.saldo_deuda)+data.costoCompra});
    showToast(data.esNueva?"OC creada correctamente":"Compra registrada"); setAccion(null); await cargarTodo();
  };
  // ─── NUEVA OC RÁPIDA (datos desde Mercado Público) ───────────
  const handleNuevaOCRapida=async({pendienteSync, oc, links, direccion_entrega, correo_cliente})=>{
    const t=session.access_token;
    const numero=oc.numero_oc;

    // No permitir duplicados
    const yaExiste=ocs.find(o=>String(o.numero_oc).toUpperCase().replace(/[^A-Z0-9]/g,"")===String(numero).toUpperCase().replace(/[^A-Z0-9]/g,""));
    if(yaExiste) throw new Error(`La OC ${numero} ya está cargada`);

    // Vendedor: el del perfil que está creando, si tiene uno asociado
    const vendedorId = perfil?.vendedor_id || null;

    const fila = pendienteSync
      ? { id:genId("ocv2"), numero_oc:numero, cliente:"POR COMPLETAR",
          vendedor_id:vendedorId, sync_pendiente:true,
          estado_compra:"pendiente", creado_por:session.user.id }
      : { id:genId("ocv2"), numero_oc:numero,
          cliente:oc.cliente||"", entidad:oc.entidad||"", rut_cliente:oc.rut_cliente||"",
          comuna:oc.comuna||"", contacto:oc.contacto||"", correo_cliente:correo_cliente||"",
          monto_total:oc.monto_total||0, vendedor_id:vendedorId,
          tipo_despacho:oc.tipo_despacho||"", direccion_entrega:direccion_entrega||"",
          fecha_emision_mp:String(oc.fecha_envio||oc.fecha_creacion||"").slice(0,10)||null,
          fecha_hora_emision_mp:oc.fecha_envio||oc.fecha_creacion||null,
          dias_pago:oc.dias_pago||30, sync_pendiente:false,
          estado_compra:"pendiente", creado_por:session.user.id };

    let nueva;
    try{
      nueva=await ins("ordenes_compra_v2",t,fila);
    }catch(e){
      // La restricción única de la base es la protección real contra dos
      // personas creando la misma OC al mismo tiempo — el chequeo de
      // arriba solo mira lo que este celular ya tenía cargado.
      if(String(e.message||"").toLowerCase().includes("duplicate")||String(e.message||"").toLowerCase().includes("unique"))
        throw new Error(`La OC ${numero} ya la cargó alguien más justo ahora`);
      throw e;
    }
    const ocId=(Array.isArray(nueva)?nueva[0]:nueva).id;

    // Productos: uno por cada ítem de la OC, con su link
    const productos = (oc.productos||[]);
    if(productos.length){
      for(let i=0;i<productos.length;i++){
        const p=productos[i];
        const desc=`${p.descripcion} × ${p.cantidad} | Venta: ${fmt.money(p.total_linea)}${p.categoria?` | ${p.categoria}`:""}`;
        await ins("oc_productos_link",t,{id:genId("lnk"),oc_id:ocId,descripcion:desc,
          url:links[i]||links[0]||"sin-link",orden:i,creado_por:session.user.id});
      }
    } else {
      // OC pendiente de sincronizar: guardamos solo los links
      for(let i=0;i<links.length;i++){
        await ins("oc_productos_link",t,{id:genId("lnk"),oc_id:ocId,
          descripcion:"Producto por completar",url:links[i],orden:i,creado_por:session.user.id});
      }
    }

    // Guardar/actualizar el catálogo de entidades para autocompletar la próxima vez
    if(!pendienteSync && oc.rut_cliente){
      try{
        const existente=entidadesCatalogo.find(e=>e.rut===oc.rut_cliente);
        const datosEnt={rut:oc.rut_cliente,nombre_entidad:oc.cliente||"",comuna:oc.comuna||"",
          contacto:oc.contacto||"",correo:correo_cliente||""};
        if(existente) await upd("entidades_catalogo",t,existente.id,datosEnt);
        else await ins("entidades_catalogo",t,{id:genId("ent"),...datosEnt,creado_por:session.user.id});
      }catch{}
    }

    showToast(pendienteSync
      ? `OC ${numero} guardada — se completará al ser aceptada`
      : `OC ${numero} creada con datos de Mercado Público`);
    setAccion(null);
    await cargarTodo();
  };

  // ─── SINCRONIZAR CON MERCADO PÚBLICO ─────────────────────────
  // Completa dos tipos de OC:
  //  · las guardadas antes de ser aceptadas (sync_pendiente)
  //  · las históricas que quedaron sin datos de cliente
  // Nunca pisa un dato que ya tenga contenido: solo rellena vacíos.
  // Los códigos de Mercado Público tienen forma 1234-567-AG26.
  // Todo lo demás (ventas directas, otras plataformas) no existe allá.
  const esCodigoMP=(numero)=>
    /^\s*N?[ºo°]?\s*\d+\s*-\s*\d+\s*-\s*[A-Za-z]{2}\d{2}\s*$/.test(String(numero||""));

  const sincronizarPendientes=async(listaOcs,forzar=false)=>{
    const sinDatos=(o)=>
      esCodigoMP(o.numero_oc) && !o.no_en_mp && (
        o.sync_pendiente ||
        !o.rut_cliente ||
        !o.fecha_emision_mp ||
        !o.fecha_hora_emision_mp ||
        String(o.cliente||"").toUpperCase().includes("POR COMPLETAR"));

    // Si viene una lista explícita se procesa tal cual (sincronización manual).
    // Si no, se eligen las que faltan, de a pocas, para no demorar el arranque.
    const candidatas = forzar
      ? (listaOcs||[])
      : (listaOcs||[]).filter(o=>sinDatos(o)&&!intentadas.current.has(o.id)).slice(0,6);

    if(!candidatas.length) return 0;
    const t=session.access_token;
    let completadas=0;

    for(const oc of candidatas){
      if(!forzar) intentadas.current.add(oc.id); // en modo automático, no reintentar
      try{
        const r=await fetch(`/api/oc?codigo=${encodeURIComponent(oc.numero_oc)}`);
        if(!r.ok){
          // La API no la tiene: sin código de Mercado Público o no aceptada.
          // Se marca para dejar de reintentarla en cada carga.
          if(r.status===404&&!oc.sync_pendiente){
            try{ await upd("ordenes_compra_v2",t,oc.id,{sync_pendiente:false,no_en_mp:true}); }catch{}
          }
          continue;
        }
        const j=await r.json();
        if(!j.ok||!j.oc) continue;
        const d=j.oc;

        // Solo rellenamos lo que está vacío
        const cambios={sync_pendiente:false, no_en_mp:false};
        const vacio=(v)=>!v||String(v).trim()===""||String(v).toUpperCase().includes("POR COMPLETAR");
        if(vacio(oc.cliente))        cambios.cliente=d.cliente||"";
        if(vacio(oc.entidad))        cambios.entidad=d.entidad||"";
        if(vacio(oc.rut_cliente))    cambios.rut_cliente=d.rut_cliente||"";
        if(vacio(oc.comuna))         cambios.comuna=d.comuna||"";
        if(vacio(oc.contacto))       cambios.contacto=d.contacto||"";
        if(vacio(oc.correo_cliente)) cambios.correo_cliente=d.correo_cliente||"";
        if(vacio(oc.tipo_despacho))  cambios.tipo_despacho=d.tipo_despacho||"";
        // La fecha de emisión no es un dato editable como el cliente o el
        // contacto: Mercado Público es la única fuente de verdad, así que
        // siempre se sincroniza (no solo cuando está vacía), para que una
        // fecha vieja o mal cargada se autocorrija en la próxima pasada.
        // Se prioriza fecha_envio (la que Mercado Público muestra en
        // pantalla junto al código) sobre fecha_creacion (la del proceso
        // interno, que puede ser bastante anterior en compras ágiles).
        const fechaHoraMP=d.fecha_envio||d.fecha_creacion||"";
        const fechaMP=String(fechaHoraMP).slice(0,10);
        if(fechaMP&&fechaMP!==oc.fecha_emision_mp) cambios.fecha_emision_mp=fechaMP;
        if(fechaHoraMP&&fechaHoraMP!==oc.fecha_hora_emision_mp) cambios.fecha_hora_emision_mp=fechaHoraMP;
        if(!oc.tipo_despacho&&d.tipo_despacho) cambios.tipo_despacho=d.tipo_despacho;
        if(!oc.dias_pago)            cambios.dias_pago=d.dias_pago||30;
        if(!Number(oc.monto_total))  cambios.monto_total=d.monto_total||0;

        await upd("ordenes_compra_v2",t,oc.id,cambios);

        // La fecha del evento de compra debe reflejar la emisión real
        const evC=(oc.eventos_compra||[])[0];
        if(fechaMP&&evC&&!String(evC.fecha||"").startsWith(fechaMP)){
          try{ await upd("eventos_compra",t,evC.id,{fecha:fechaMP}); }catch{}
        }

        // Completar descripciones de productos que quedaron en blanco
        const links=(oc.oc_productos_link||[]).slice().sort((a,b)=>a.orden-b.orden);
        for(let i=0;i<(d.productos||[]).length;i++){
          const p=d.productos[i];
          const fila={descripcion:p.descripcion,cantidad:p.cantidad||null,
            precio_venta:p.total_linea||null,categoria:p.categoria||null,origen:"venta"};
          if(links[i]){
            if(!links[i].descripcion||links[i].descripcion==="Producto por completar"||!links[i].cantidad)
              await upd("oc_productos_link",t,links[i].id,fila);
          } else {
            // No duplicar: si ya existe uno igual, no se inserta de nuevo
            const yaEsta=(oc.oc_productos_link||[]).some(x=>
              (x.origen||"venta")==="venta" &&
              x.descripcion===p.descripcion &&
              Number(x.cantidad||0)===Number(p.cantidad||0));
            if(!yaEsta){
              await ins("oc_productos_link",t,{id:genId("lnk"),oc_id:oc.id,...fila,
                url:"sin-link",orden:i,creado_por:session.user.id});
            }
          }
        }

        // Alimentar el catálogo de entidades
        if(d.rut_cliente){
          try{
            const ex=entidadesCatalogo.find(e=>e.rut===d.rut_cliente);
            const datos={rut:d.rut_cliente,nombre_entidad:d.cliente||"",comuna:d.comuna||"",
              contacto:d.contacto||"",correo:oc.correo_cliente||d.correo_cliente||""};
            if(ex) await upd("entidades_catalogo",t,ex.id,datos);
            else await ins("entidades_catalogo",t,{id:genId("ent"),...datos,creado_por:session.user.id});
          }catch{}
        }
        completadas++;
      }catch{ /* si una falla, seguimos con el resto */ }
    }
    return completadas;
  };

  // Sincronización masiva a pedido (para completar el histórico de una vez)
  const [sincronizando,setSincronizando]=useState(null); // {hechas,total}
  const completarTodasDesdeMP=async()=>{
    const pendientes=ocs.filter(o=>
      esCodigoMP(o.numero_oc) && !o.no_en_mp &&
      (o.sync_pendiente||!o.rut_cliente||!o.fecha_emision_mp||!o.fecha_hora_emision_mp||
       String(o.cliente||"").toUpperCase().includes("POR COMPLETAR")));
    if(!pendientes.length){ showToast("No hay OCs por completar"); return; }
    if(!confirmarSiCercaDelLimite(pendientes.length)) return;
    intentadas.current.clear();
    setSincronizando({hechas:0,total:pendientes.length});
    let ok=0;
    for(let i=0;i<pendientes.length;i+=4){
      const lote=pendientes.slice(i,i+4);
      ok+=await sincronizarPendientes(lote,true);   // forzar: procesa el lote completo
      setSincronizando({hechas:Math.min(i+4,pendientes.length),total:pendientes.length,ok});
    }
    setSincronizando(null);
    const fallaron=pendientes.length-ok;
    showToast(fallaron>0
      ? `${ok} completadas · ${fallaron} no están en Mercado Público`
      : `${ok} OCs completadas`);
    registrarUsoMP(pendientes.length);
    await cargarTodo();
  };

  // A diferencia de completarTodasDesdeMP (solo las que les falta algo),
  // esta pasa por TODAS las OC de Mercado Público, tengan o no ya una
  // fecha guardada, para que cualquier fecha vieja o mal cargada se
  // corrija contra lo que diga Mercado Público hoy. No se filtra por
  // no_en_mp: si antes falló la búsqueda por algo transitorio, acá se
  // le da otra oportunidad en vez de dejarla marcada para siempre.
  const corregirFechasTodas=async()=>{
    const candidatas=ocs.filter(o=>esCodigoMP(o.numero_oc));
    if(!candidatas.length){ showToast("No hay OCs de Mercado Público para revisar"); return; }
    if(!confirmarSiCercaDelLimite(candidatas.length)) return;
    // Toast inmediato: no depende de que el botón esté a la vista en pantalla.
    showToast(`Revisando ${candidatas.length} OC contra Mercado Público…`);
    intentadas.current.clear();
    setSincronizando({hechas:0,total:candidatas.length});
    let ok=0;
    try{
      for(let i=0;i<candidatas.length;i+=4){
        const lote=candidatas.slice(i,i+4);
        ok+=await sincronizarPendientes(lote,true);
        setSincronizando({hechas:Math.min(i+4,candidatas.length),total:candidatas.length,ok});
      }
    } finally {
      setSincronizando(null); // pase lo que pase, el botón no debe quedar trabado
    }
    const fallaron=candidatas.length-ok;
    showToast(fallaron>0
      ? `${ok} fechas revisadas · ${fallaron} no están en Mercado Público`
      : `${ok} fechas revisadas y corregidas contra Mercado Público`);
    registrarUsoMP(candidatas.length);
    await cargarTodo();
  };

  const handleGuardarAporte=async({id,socio,tipo,monto,fecha,medio,notas})=>{
    const t=session.access_token;
    const fila={socio,tipo,monto,fecha,medio:medio||null,notas:notas||null};
    if(id){
      await upd("aportes_socios",t,id,fila);
      showToast("Movimiento actualizado");
    } else {
      await ins("aportes_socios",t,{id:genId("ap"),...fila,creado_por:session.user.id});
      showToast(tipo==="retiro"?"Retiro registrado":"Aporte registrado");
    }
    await cargarTodo();
  };

  const handleEliminarAporte=async(id)=>{
    await del("aportes_socios",session.access_token,id);
    showToast("Movimiento eliminado");
    await cargarTodo();
  };

  // ─── CONCILIACIÓN BANCARIA: registrar cobros detectados ──────
  // Deja constancia del período importado y su saldo de cierre
  const registrarCartola=async(info,{cobros=0,egresos=0}={})=>{
    if(!info) return;
    // Totales del banco por mes: son la base de la conciliación.
    // Igual que con saldo_banco: un PATCH a un id que no existe
    // todavía (mes recién importado) responde 200 OK sin filas,
    // no lanza error — hay que revisar el resultado, no solo el catch.
    for(const m of (info.meses||[])){
      const fila={...m,actualizado:new Date().toISOString()};
      const actualizadas=await upd("banco_mensual",session.access_token,m.id,fila).catch(()=>[]);
      if(!Array.isArray(actualizadas)||actualizadas.length===0){
        try{ await ins("banco_mensual",session.access_token,fila); }catch{}
      }
    }
    try{
      await ins("cartolas_importadas",session.access_token,{
        id:genId("cart"), fecha_desde:info.desde, fecha_hasta:info.hasta,
        n_movimientos:info.movimientos, n_cobros:cobros, n_egresos:egresos,
        saldo_final:info.saldoFinal, creado_por:session.user.id});
    }catch{}
  };

  const handleCobrosDesdeCartola=async(cobros,infoCartola)=>{
    const t=session.access_token;
    for(const c of cobros){
      const oc=ocs.find(o=>o.id===c.ocId);
      await ins("eventos_pago_cliente",t,{id:genId("evp"),oc_id:c.ocId,fecha:c.fecha,
        monto:c.monto,creado_por:session.user.id});
      const nuevoCobrado=Number(oc?.monto_cobrado||0)+c.monto;
      await upd("ordenes_compra_v2",t,c.ocId,{monto_cobrado:nuevoCobrado,
        estado_pago_cliente:nuevoCobrado>=(Number(oc?.monto_facturado)||0)?"pagado":"parcial"});
      await registrarCambio(t,{ocId:c.ocId,ocNumero:c.numeroOc,usuarioId:perfil?.id,
        usuarioNombre:perfil?.nombre,accion:"Cobro registrado desde la cartola del banco",
        campo:"estado_pago_cliente",valorAnterior:"pendiente",valorNuevo:"pagado"});
    }
    const total=cobros.reduce((s,c)=>s+c.monto,0);
    await registrarCartola(infoCartola,{cobros:cobros.length});
    showToast(cobros.length
      ? `${cobros.length} cobro${cobros.length!==1?"s":""} registrado${cobros.length!==1?"s":""} · ${fmt.money(total)}`
      : `Totales del banco guardados · ${(infoCartola?.meses||[]).length} mes(es)`);
    setAccion(null); await cargarTodo();
  };

  // Mercado Público es inestable (ellos mismos la marcan "Beta"): si
  // falla una vez, se reintenta antes de dejar el aviso vacío en silencio.
  const fetchConReintento=async(url)=>{
    for(let intento=0;intento<2;intento++){
      try{
        const r=await fetch(url);
        if(r.ok) return r;
      }catch{ /* reintenta */ }
      if(intento===0) await new Promise(res=>setTimeout(res,1500));
    }
    return null;
  };

  // ─── OCs esperando aceptación en Mercado Público ─────────────
  // Se consultan al abrir la app: son ventas que todavía no
  // entran al sistema porque nadie las aceptó en el portal.
  const [verificandoPorAceptar,setVerificandoPorAceptar]=useState(false);
  const revisarPorAceptar=async()=>{
    setVerificandoPorAceptar(true);
    try{
      const r=await fetchConReintento("/api/oc?listar=enviadaproveedor&dias=30");
      if(!r) return;
      const j=await r.json();
      if(!j.ok) return;
      const norm=(v)=>String(v||"").toUpperCase().replace(/[^A-Z0-9]/g,"").replace(/^N(?=\d)/,"");
      const cargadas=new Set(ocs.map(o=>norm(o.numero_oc)));
      setPorAceptar((j.ocs||[]).filter(o=>!cargadas.has(norm(o.numero_oc))));
      registrarUsoMP(30); // aproximado: 1 solicitud por día escaneado
    }catch{ /* si falla, simplemente no se muestra el aviso */ }
    finally{ setVerificandoPorAceptar(false); }
  };


  // ─── OCs ya aceptadas en Mercado Público, pero aún no cargadas ──
  // A diferencia de revisarPorAceptar (informativo), estas ya se
  // pueden traer — solo falta que Kevin las revise y confirme una a una.
  const [verificandoAceptadas,setVerificandoAceptadas]=useState(false);
  const revisarAceptadasSinCargar=async()=>{
    setVerificandoAceptadas(true);
    try{
      const r=await fetchConReintento("/api/oc?listar=aceptadas&dias=30");
      if(!r) return;
      const j=await r.json();
      if(!j.ok) return;
      const norm=(v)=>String(v||"").toUpperCase().replace(/[^A-Z0-9]/g,"").replace(/^N(?=\d)/,"");
      const cargadas=new Set(ocs.map(o=>norm(o.numero_oc)));
      setAceptadasSinCargar((j.ocs||[]).filter(o=>!cargadas.has(norm(o.numero_oc))));
      registrarUsoMP(30);
    }catch{ /* si falla, simplemente no se muestra el aviso */ }
    finally{ setVerificandoAceptadas(false); }
  };


  // ─── OCs que YA están cargadas en la app pero se cancelaron en MP ──
  // Compara el estado actual en Mercado Público contra lo que tenemos.
  // Ojo: solo alcanza a ver órdenes cuya fecha de emisión cae dentro de
  // la ventana de 90 días (limitación de la API pública de MP, que solo
  // permite buscar día por día).
  const [canceladasEnMP,setCanceladasEnMP]=useState([]);
  const [verificandoCanceladas,setVerificandoCanceladas]=useState(false);
  const revisarCanceladasEnMP=async()=>{
    setVerificandoCanceladas(true);
    try{
      const r=await fetchConReintento("/api/oc?listar=todas&dias=90");
      if(!r) return;
      const j=await r.json();
      if(!j.ok) return;
      const norm=(v)=>String(v||"").toUpperCase().replace(/[^A-Z0-9]/g,"").replace(/^N(?=\d)/,"");
      const canceladasMP=new Map();
      for(const o of (j.ocs||[])) if(Number(o.codigo_estado)===9) canceladasMP.set(norm(o.numero_oc),o);
      const encontradas=[];
      for(const oc of ocs){
        if(!esCodigoMP(oc.numero_oc)||oc.no_en_mp) continue;
        const enMP=canceladasMP.get(norm(oc.numero_oc));
        if(enMP) encontradas.push({id:oc.id,numero_oc:oc.numero_oc,cliente:oc.cliente,nombre:enMP.nombre});
      }
      setCanceladasEnMP(encontradas);
      registrarUsoMP(90);
    }catch{ /* si falla, simplemente no se muestra el aviso */ }
    finally{ setVerificandoCanceladas(false); }
  };


  // ─── Validación exhaustiva: TODAS las OC cargadas, una por una ──
  // A diferencia de revisarCanceladasEnMP (que depende de una ventana de
  // 90 días por fecha de emisión), esto consulta cada OC directamente por
  // su código — sin importar cuán vieja sea — así que encuentra
  // cancelaciones que el escaneo por fecha no puede ver. De paso corrige
  // el estado "no_en_mp" si había quedado mal marcado.
  const [validandoTodo,setValidandoTodo]=useState(null); // {hechas,total}
  const validarTodoContraMP=async()=>{
    const candidatas=ocs.filter(o=>esCodigoMP(o.numero_oc));
    if(!candidatas.length){ showToast("No hay OCs de Mercado Público para validar"); return; }
    if(!confirmarSiCercaDelLimite(candidatas.length)) return;
    showToast(`Validando ${candidatas.length} OC contra Mercado Público…`);
    setValidandoTodo({hechas:0,total:candidatas.length});
    const canceladas=[];
    const t=session.access_token;
    for(let i=0;i<candidatas.length;i+=4){
      const lote=candidatas.slice(i,i+4);
      await Promise.all(lote.map(async(oc)=>{
        try{
          const r=await fetch(`/api/oc?codigo=${encodeURIComponent(oc.numero_oc)}`);
          if(r.status===404){
            if(!oc.no_en_mp) await upd("ordenes_compra_v2",t,oc.id,{no_en_mp:true}).catch(()=>{});
            return;
          }
          const j=await r.json();
          if(!j.ok||!j.oc) return;
          if(oc.no_en_mp) await upd("ordenes_compra_v2",t,oc.id,{no_en_mp:false}).catch(()=>{});
          if(Number(j.oc.codigo_estado)===9){
            canceladas.push({id:oc.id,numero_oc:oc.numero_oc,cliente:oc.cliente,nombre:j.oc.nombre_oc});
          }
        }catch{ /* esta OC queda sin validar, se sigue con el resto */ }
      }));
      setValidandoTodo({hechas:Math.min(i+4,candidatas.length),total:candidatas.length});
      if(i+4<candidatas.length) await new Promise(res=>setTimeout(res,200));
    }
    setValidandoTodo(null);
    setCanceladasEnMP(canceladas);
    showToast(canceladas.length>0
      ? `${canceladas.length} OC cancelada${canceladas.length>1?"s":""} encontrada${canceladas.length>1?"s":""}`
      : "Ninguna cancelada — todo al día");
    registrarUsoMP(candidatas.length);
    await cargarTodo();
  };

  // ─── Cargar de una vez todas las aceptadas que faltan ───────────
  // Reutiliza exactamente la misma lógica de creación que el flujo
  // manual (handleNuevaOCRapida), solo que sin pedir el link uno a uno:
  // queda "sin-link" y se completa después desde el detalle de la OC.
  const [cargandoAceptadas,setCargandoAceptadas]=useState(null); // {hechas,total}
  const handleCargarTodasAceptadas=async()=>{
    const pendientes=[...aceptadasSinCargar];
    if(!pendientes.length){ showToast("No hay OCs aceptadas por cargar"); return; }
    setCargandoAceptadas({hechas:0,total:pendientes.length});
    let ok=0;
    for(let i=0;i<pendientes.length;i++){
      const item=pendientes[i];
      try{
        const r=await fetch(`/api/oc?codigo=${encodeURIComponent(item.numero_oc)}`);
        const j=await r.json();
        if(j.ok&&j.oc){
          const links=(j.oc.productos||[]).length ? j.oc.productos.map(()=>"sin-link") : ["sin-link"];
          await handleNuevaOCRapida({pendienteSync:false, oc:j.oc, links,
            direccion_entrega:j.oc.direccion||"", correo_cliente:j.oc.correo_cliente||""});
          ok++;
        }
      }catch{ /* si una falla, seguimos con el resto */ }
      setCargandoAceptadas({hechas:i+1,total:pendientes.length});
    }
    setCargandoAceptadas(null);
    showToast(`${ok} OC${ok!==1?"s":""} cargada${ok!==1?"s":""} desde Mercado Público`);
    await cargarTodo();
  };


  // ─── EGRESOS DE LA CARTOLA ───────────────────────────────────
  // Cada cargo del banco se registra según lo que sea: devolución
  // a un financista (con reparto FIFO), pago a vendedor o gasto.
  const handleEgresosDesdeCartola=async(egresos,infoCartola)=>{
    const t=session.access_token;
    let nFin=0,nVen=0,nGas=0;

    for(const e of egresos){
      if(e.tipo==="financiador"){
        const pendientes=ocs
          .filter(o=>o.financiador_id===e.destinoId&&o.estado_pago_financiamiento!=="pagado")
          .sort((a,b)=>{
            const fa=(a.eventos_compra||[])[0]?.fecha||a.creadoEn||"";
            const fb=(b.eventos_compra||[])[0]?.fecha||b.creadoEn||"";
            return String(fa).localeCompare(String(fb));
          });
        const {reparto,sobrante}=repartirFIFO(e.monto,pendientes);
        for(const r of reparto){
          await ins("eventos_pago_financiamiento",t,{id:genId("evpf"),financiador_id:e.destinoId,
            oc_id:r.oc.id,fecha:e.fecha,monto:r.asignado,creado_por:session.user.id});
          await upd("ordenes_compra_v2",t,r.oc.id,{
            monto_pagado_fin:Number(r.oc.monto_pagado_fin||0)+r.asignado,
            estado_pago_financiamiento:r.completa?"pagado":"parcial"});
        }
        if(sobrante>0){
          await ins("eventos_pago_financiamiento",t,{id:genId("evpf"),financiador_id:e.destinoId,
            oc_id:null,fecha:e.fecha,monto:sobrante,creado_por:session.user.id});
        }
        const fin=financiadores.find(f=>f.id===e.destinoId);
        if(fin) await upd("financiadores",t,fin.id,{saldo_deuda:Math.max(0,Number(fin.saldo_deuda||0)-e.monto)});
        nFin++;
      }

      if(e.tipo==="vendedor"){
        const d=new Date(e.fecha);
        await ins("pagos_vendedor",t,{id:genId("pv"),vendedor_id:e.destinoId,
          anio:d.getFullYear(),mes:d.getMonth()+1,monto_calculado:e.monto,monto_pagado:e.monto,
          fecha:e.fecha,estado:"pagado",notas:`Desde cartola: ${e.descripcion}`,creado_por:session.user.id});
        nVen++;
      }

      if(e.tipo==="gasto"){
        const d=new Date(e.fecha);
        await ins("gastos_indirectos",t,{id:genId("gas"),categoria_id:e.categoriaId,
          subcategoria:null,monto:e.monto,mes:d.getMonth()+1,anio:d.getFullYear(),
          fecha:e.fecha,detalle:`Desde cartola: ${e.descripcion}`,creado_por:session.user.id});
        nGas++;
      }
    }

    const partes=[];
    if(nFin) partes.push(`${nFin} a financistas`);
    if(nVen) partes.push(`${nVen} a vendedores`);
    if(nGas) partes.push(`${nGas} gastos`);
    await registrarCartola(infoCartola,{egresos:egresos.length});
    showToast(`Egresos registrados: ${partes.join(" · ")}`);
    setAccion(null); await cargarTodo();
  };

  // ─── ABONO A FINANCIADOR con reparto FIFO ────────────────────
  const handleAbonoFinanciador=async({financiadorId,fecha,referencia,montoTotal,sobrante,asignaciones})=>{
    const t=session.access_token;
    const fin=financiadores.find(f=>f.id===financiadorId);

    for(const a of asignaciones){
      const oc=ocs.find(o=>o.id===a.ocId);
      await ins("eventos_pago_financiamiento",t,{id:genId("evpf"),financiador_id:financiadorId,
        oc_id:a.ocId,fecha,monto:a.monto,creado_por:session.user.id});

      const pagadoAntes=Number(oc?.monto_pagado_fin||0);
      const nuevoPagado=pagadoAntes+a.monto;
      await upd("ordenes_compra_v2",t,a.ocId,{
        monto_pagado_fin:nuevoPagado,
        estado_pago_financiamiento:a.completa?"pagado":"parcial",
      });

      await registrarCambio(t,{ocId:a.ocId,ocNumero:a.numeroOc,usuarioId:perfil?.id,
        usuarioNombre:perfil?.nombre,
        accion:a.completa?`Financiamiento saldado (abono a ${fin?.nombre||""})`
                         :`Abono parcial de financiamiento (${fmt.money(a.monto)})`,
        campo:"monto_pagado_fin",valorAnterior:pagadoAntes,valorNuevo:nuevoPagado});
    }

    // Si el abono supera lo adeudado, el resto queda sin OC asociada
    if(sobrante>0){
      await ins("eventos_pago_financiamiento",t,{id:genId("evpf"),financiador_id:financiadorId,
        oc_id:null,fecha,monto:sobrante,creado_por:session.user.id});
    }

    if(fin) await upd("financiadores",t,fin.id,{saldo_deuda:Math.max(0,Number(fin.saldo_deuda||0)-montoTotal)});

    const completas=asignaciones.filter(a=>a.completa).length;
    showToast(`Abono de ${fmt.money(montoTotal)} · ${completas} OC${completas!==1?"s":""} saldada${completas!==1?"s":""}`);
    setAccion(null); await cargarTodo();
  };

  const handleGuardarSaldoBanco=async({saldo,fecha,nota})=>{
    const t=session.access_token;
    const fila={saldo:Number(saldo),fecha_corte:fecha,nota:nota||null,actualizado_por:session.user.id};
    // upd() hace PATCH ?id=eq.actual: si esa fila no existe todavía,
    // Supabase responde 200 OK con un arreglo vacío (no lanza error),
    // así que hay que revisar si realmente actualizó algo antes de
    // decidir si corresponde crear la fila con insert.
    const actualizadas=await upd("saldo_banco",t,"actual",fila).catch(()=>[]);
    if(!Array.isArray(actualizadas)||actualizadas.length===0){
      await ins("saldo_banco",t,{id:"actual",...fila});
    }
    showToast(`Saldo del banco fijado en ${fmt.money(saldo)}`);
    setAccion(null); await cargarTodo();
  };

  // ─── COMPRA RÁPIDA sobre una OC ya creada ────────────────────
  const handleCompraRapida=async({ocId,costoCompra,fecha,fechaEst,financiadorId,proveedor})=>{
    const t=session.access_token;
    const oc=ocs.find(o=>o.id===ocId);

    await ins("eventos_compra",t,{id:genId("evc"),oc_id:ocId,fecha,
      monto_venta:oc?.monto_total||0, costo_compra:costoCompra,
      fecha_entrega_estimada:fechaEst, financiador_id:financiadorId,
      proveedor:proveedor||"", creado_por:session.user.id});

    await upd("ordenes_compra_v2",t,ocId,{estado_compra:"comprado",costo_total:costoCompra,financiador_id:financiadorId});

    const fin=financiadores.find(f=>f.id===financiadorId);
    if(fin) await upd("financiadores",t,fin.id,{saldo_deuda:Number(fin.saldo_deuda||0)+costoCompra});

    await registrarCambio(t,{ocId,ocNumero:oc?.numero_oc,usuarioId:perfil?.id,
      usuarioNombre:perfil?.nombre,accion:"Compra registrada",campo:"costo_total",
      valorNuevo:costoCompra});

    showToast("Compra registrada"); setAccion(null); await cargarTodo();
  };

  const handleEntrega=async(data)=>{
    const t=session.access_token;
    await ins("eventos_entrega",t,{id:genId("eve"),oc_id:data.ocId,fecha:data.fecha,persona_recibe:data.personaRecibe,creado_por:session.user.id});
    await upd("ordenes_compra_v2",t,data.ocId,{estado_entrega:"confirmada"});
    showToast("Entrega confirmada"); setAccion(null); await cargarTodo();
  };
  const handleFactura=async(data)=>{
    const t=session.access_token;
    await ins("eventos_factura",t,{id:genId("evf"),oc_id:data.ocId,fecha:data.fecha,numero_factura:data.numeroFactura,monto:data.monto,nota_credito:data.notaCredito||null,factura_anulada_numero:data.facturaAnuladaNumero||null,motivo_diferencia:data.motivoDiferencia||null,creado_por:session.user.id});
    await upd("ordenes_compra_v2",t,data.ocId,{estado_factura_propia:"emitida",monto_facturado:data.monto});
    showToast(data.esReemision?`Factura reemitida (anula N°${data.facturaAnuladaNumero} con NC ${data.notaCredito})`:"Factura registrada"); setAccion(null); await cargarTodo();
  };
  const handlePagoCliente=async(data)=>{
    const t=session.access_token; const oc=ocs.find(o=>o.id===data.ocId);
    await ins("eventos_pago_cliente",t,{id:genId("evp"),oc_id:data.ocId,fecha:data.fecha,monto:data.monto,creado_por:session.user.id});
    const nuevoCobrado=(oc?.monto_cobrado||0)+data.monto;
    await upd("ordenes_compra_v2",t,data.ocId,{monto_cobrado:nuevoCobrado,estado_pago_cliente:nuevoCobrado>=(oc?.monto_facturado||0)?"pagado":"parcial"});
    showToast("Pago registrado"); setAccion(null); await cargarTodo();
  };
  const handlePagoFin=async(data)=>{
    const t=session.access_token;
    await ins("eventos_pago_financiamiento",t,{id:genId("evpf"),financiador_id:data.financiadorId,oc_id:data.ocId,fecha:data.fecha,monto:data.monto,creado_por:session.user.id});
    const fin=financiadores.find(f=>f.id===data.financiadorId);
    if(fin) await upd("financiadores",t,fin.id,{saldo_deuda:Math.max(0,Number(fin.saldo_deuda)-data.monto)});
    if(data.ocId) await upd("ordenes_compra_v2",t,data.ocId,{estado_pago_financiamiento:"pagado"});
    showToast("Pago a financiador registrado"); setAccion(null); await cargarTodo();
  };
  const handleAjusteSaldo=async({financiadorId,fecha,montoAjuste,motivo})=>{
    const t=session.access_token;
    await ins("ajustes_saldo_financiador",t,{id:genId("ajf"),financiador_id:financiadorId,fecha,monto_ajuste:montoAjuste,motivo,creado_por:session.user.id});
    const fin=financiadores.find(f=>f.id===financiadorId);
    if(fin) await upd("financiadores",t,fin.id,{saldo_deuda:Number(fin.saldo_deuda)+montoAjuste});
    showToast("Saldo ajustado"); await cargarTodo();
  };
  const handleNuevoGasto=async(data)=>{
    await ins("gastos_indirectos",session.access_token,{id:genId("gas"),categoria_id:data.categoriaId,subcategoria:data.subcategoria,monto:data.monto,mes:data.mes,anio:data.anio,fecha:data.fecha,detalle:data.detalle,creado_por:session.user.id});
    showToast("Gasto registrado"); await cargarTodo();
  };
  const handlePagoVendedorSimple=async(data)=>{
    await ins("pagos_vendedor",session.access_token,{id:genId("pv"),vendedor_id:data.vendedorId,anio:data.anio,mes:data.mes,monto_calculado:data.monto,monto_pagado:data.monto,fecha:data.fecha,estado:"pagado",notas:data.label,creado_por:session.user.id});
    if (data.ocIdsAMarcar && data.ocIdsAMarcar.length) {
      for (const ocId of data.ocIdsAMarcar) {
        await upd("ordenes_compra_v2", session.access_token, ocId, { vendedor_pagado: true });
      }
    }
    showToast(`Pago a vendedor registrado${data.ocIdsAMarcar?.length?` · ${data.ocIdsAMarcar.length} OCs marcadas como pagadas`:""}`); await cargarTodo();
  };
  const handleGuardarIva=async(data)=>{
    const t=session.access_token; const existe=ivaMensual.find(i=>i.mes===data.mes&&i.anio===data.anio);
    const row={anio:data.anio,mes:data.mes,ventas_netas:data.ventasNetas,iva_ventas:data.ivaVentas,compras_netas:data.comprasNetas,iva_compras:data.ivaCompras,iva_pagado:data.ivaPagado};
    if(existe) await upd("iva_mensual",t,existe.id,row); else await ins("iva_mensual",t,{id:genId("iva"),...row});
    showToast("IVA guardado"); await cargarTodo();
  };
  const handleChangeRol=async(uid,rol)=>{ await updRol(session.access_token,uid,rol); showToast("Rol actualizado"); await cargarTodo(); };
  const handleGuardarLink=async(ocId,{descripcion,url,orden,direccion_entrega,cantidad,precio_compra,precio_venta,origen},oc)=>{
    const t=session.access_token;
    await ins("oc_productos_link",t,{id:genId("lnk"),oc_id:ocId,descripcion,url,orden,
      direccion_entrega:direccion_entrega||null,cantidad:cantidad??null,
      precio_compra:precio_compra??null,precio_venta:precio_venta??null,
      origen:origen||"compra",creado_por:session.user.id});
    await registrarCambio(t,{ocId,ocNumero:oc?.numero_oc,usuarioId:perfil?.id,usuarioNombre:perfil?.nombre,
      accion:"Producto agregado",campo:"producto",valorNuevo:descripcion});
    showToast("Producto agregado"); await cargarTodo();
  };
  const handleEliminarLink=async(linkId,oc)=>{
    const t=session.access_token;
    const l=(oc?.oc_productos_link||[]).find(x=>x.id===linkId);
    await fetch(`${SUPABASE_URL}/rest/v1/oc_productos_link?id=eq.${linkId}`,{method:"DELETE",headers:hdrs(t)});
    if(oc) await registrarCambio(t,{ocId:oc.id,ocNumero:oc.numero_oc,usuarioId:perfil?.id,
      usuarioNombre:perfil?.nombre,accion:"Producto eliminado",campo:"producto",
      valorAnterior:l?.descripcion||""});
    showToast("Producto eliminado"); await cargarTodo();
  };
  const handleEditarLink=async(linkId,{descripcion,url,direccion_entrega,cantidad,precio_compra,precio_venta},oc)=>{
    const t=session.access_token;
    const antes=(oc?.oc_productos_link||[]).find(x=>x.id===linkId);
    await upd("oc_productos_link",t,linkId,{descripcion,url,direccion_entrega:direccion_entrega||null,
      cantidad:cantidad??null,precio_compra:precio_compra??null,precio_venta:precio_venta??null});
    if(oc&&(antes?.direccion_entrega||"")!==(direccion_entrega||""))
      await registrarCambio(t,{ocId:oc.id,ocNumero:oc.numero_oc,usuarioId:perfil?.id,
        usuarioNombre:perfil?.nombre,accion:"Dirección de despacho del producto",campo:"dirección",
        valorAnterior:antes?.direccion_entrega||"(la de la OC)",valorNuevo:direccion_entrega||"(la de la OC)"});
    if(oc){
      if(antes?.descripcion!==descripcion)
        await registrarCambio(t,{ocId:oc.id,ocNumero:oc.numero_oc,usuarioId:perfil?.id,
          usuarioNombre:perfil?.nombre,accion:"Producto editado",campo:"descripción",
          valorAnterior:antes?.descripcion||"",valorNuevo:descripcion});
      if(antes?.url!==url)
        await registrarCambio(t,{ocId:oc.id,ocNumero:oc.numero_oc,usuarioId:perfil?.id,
          usuarioNombre:perfil?.nombre,accion:"Link de compra cambiado",campo:"link",
          valorAnterior:antes?.url||"",valorNuevo:url});
    }
    showToast("Producto actualizado"); await cargarTodo();
  };

  // ─── Traer fecha y datos reales desde Mercado Público ────────
  const handleSincronizarFecha=async(oc)=>{
    const t=session.access_token;
    try{
      const r=await fetch(`/api/oc?codigo=${encodeURIComponent(oc.numero_oc)}`);
      const j=await r.json();
      if(!j.ok||!j.oc){ showToast("No se encontró en Mercado Público","error"); return; }
      const d=j.oc;
      // Se prioriza fecha_envio (la que Mercado Público muestra en pantalla
      // junto al código) sobre fecha_creacion (la del proceso interno).
      const fechaHoraMP=d.fecha_envio||d.fecha_creacion||"";
      const fechaMP=String(fechaHoraMP).slice(0,10);

      // La fecha de la OC vive en su evento de compra
      const evC=(oc.eventos_compra||[])[0];
      if(fechaMP&&evC&&String(evC.fecha).slice(0,10)!==fechaMP){
        await upd("eventos_compra",t,evC.id,{fecha:fechaMP});
        await registrarCambio(t,{ocId:oc.id,ocNumero:oc.numero_oc,usuarioId:perfil?.id,
          usuarioNombre:perfil?.nombre,accion:"Fecha actualizada desde Mercado Público",
          campo:"fecha",valorAnterior:String(evC.fecha).slice(0,10),valorNuevo:fechaMP});
      }

      await upd("ordenes_compra_v2",t,oc.id,{
        cliente:d.cliente||oc.cliente, entidad:d.entidad||oc.entidad,
        rut_cliente:d.rut_cliente||oc.rut_cliente, comuna:d.comuna||oc.comuna,
        contacto:d.contacto||oc.contacto,
        correo_cliente:oc.correo_cliente||d.correo_cliente||"",
        tipo_despacho:d.tipo_despacho||oc.tipo_despacho,
        fecha_emision_mp:fechaMP||oc.fecha_emision_mp,
        fecha_hora_emision_mp:fechaHoraMP||oc.fecha_hora_emision_mp,
        dias_pago:d.dias_pago||oc.dias_pago||30});

      showToast(fechaMP?`Actualizado · fecha ${fmt.date(fechaMP)}`:"Datos actualizados");
      await cargarTodo();
    }catch{ showToast("No se pudo consultar Mercado Público","error"); }
  };

  // ─── HANDLERS MULTIUSUARIO ────────────────────
  const handleAsignarResponsable=async(ocId,etapa,usuarioId)=>{
    const t=session.access_token;
    const oc=ocs.find(o=>o.id===ocId);
    const existente=(oc?.oc_responsables||[]).find(r=>r.etapa===etapa);
    if(!usuarioId){
      if(existente) await del("oc_responsables",t,existente.id);
    } else {
      const p=perfiles.find(x=>x.id===usuarioId);
      const datos={oc_id:ocId,etapa,usuario_id:usuarioId,usuario_nombre:p?.nombre||"",asignado_por:session.user.id};
      if(existente) await upd("oc_responsables",t,existente.id,datos);
      else await ins("oc_responsables",t,{id:genId("resp"),...datos});
      try{ await crearNotificacion(t,{usuarioId,tipo:"asignacion",ocId,ocNumero:oc?.numero_oc,mensaje:`Te asignaron la etapa ${etapa} de la OC ${oc?.numero_oc}`}); }catch{}
    }
    await registrarCambio(t,{ocId,ocNumero:oc?.numero_oc,usuarioId:perfil.id,usuarioNombre:perfil.nombre,accion:`Responsable de ${etapa}`,campo:"responsable",valorAnterior:existente?.usuario_nombre||"—",valorNuevo:perfiles.find(x=>x.id===usuarioId)?.nombre||"—"});
    showToast("Responsable actualizado"); await cargarTodo();
  };
  const handleGuardarPostventa=async(d)=>{
    const t=session.access_token;
    const oc=ocs.find(o=>o.id===d.ocId);
    const fila={oc_id:d.ocId,fecha:d.fecha,tipo:d.tipo,descripcion:d.descripcion,estado:d.estado,
      solucion:d.solucion,fecha_resolucion:d.fecha_resolucion,
      costo_extra:d.costo_extra||0,detalle_costo:d.detalle_costo||null};
    if(d.id) await upd("eventos_postventa",t,d.id,fila);
    else await ins("eventos_postventa",t,{id:genId("pv"),...fila,creado_por:session.user.id});
    await upd("ordenes_compra_v2",t,d.ocId,{estado_postventa:d.estado==="resuelto"?"resuelta":"con_incidencia"});
    await registrarCambio(t,{ocId:d.ocId,ocNumero:oc?.numero_oc,usuarioId:perfil.id,usuarioNombre:perfil.nombre,accion:d.id?"Post-venta actualizada":"Post-venta registrada",campo:"estado",valorNuevo:d.estado});
    showToast(Number(d.costo_extra)>0
      ? `Incidencia registrada · ${fmt.money(d.costo_extra)} de costo extra`
      : (d.estado==="resuelto"?"Incidencia resuelta":"Incidencia registrada")); await cargarTodo();
  };
  const handleMarcarFecha=async(codigoOC,fecha)=>{
    const t=session.access_token;
    const oc=ocs.find(o=>o.numero_oc.toLowerCase()===codigoOC.toLowerCase());
    if(!oc) throw new Error(`No se encontró la OC "${codigoOC}"`);
    const evC=(oc.eventos_compra||[])[0];
    if(evC){
      await upd("eventos_compra",t,evC.id,{fecha_entrega_estimada:fecha});
    } else {
      await ins("eventos_compra",t,{id:genId("evc"),oc_id:oc.id,fecha:null,monto_venta:oc.monto_total,costo_compra:oc.costo_total,fecha_entrega_estimada:fecha,financiador_id:oc.financiador_id,proveedor:"",creado_por:session.user.id});
    }
    showToast(`Entrega estimada de ${oc.numero_oc} marcada para ${fmt.date(fecha)}`);
    await cargarTodo();
  };
  // Ajusta el saldo de un financiador por un delta (positivo sube la deuda)
  const ajustarSaldoFin=async(finId,delta)=>{
    if(!finId||!delta) return;
    const fin=financiadores.find(f=>f.id===finId);
    if(!fin) return;
    await upd("financiadores",session.access_token,finId,
      {saldo_deuda:Math.max(0,Number(fin.saldo_deuda||0)+delta)});
  };

  const handleEliminarEvento=async(tabla, eventoId, ocId, etapaKey)=>{
    const t=session.access_token;
    const oc=ocs.find(o=>o.id===ocId);
    const ev=(oc?.[tabla]||[]).find(e=>e.id===eventoId);

    await fetch(`${SUPABASE_URL}/rest/v1/${tabla}?id=eq.${eventoId}`,{method:"DELETE",headers:hdrs(t)});

    // Revertir el efecto que ese evento había producido
    if(tabla==="eventos_compra"){
      const costo=Number(ev?.costo_compra)||0;
      await ajustarSaldoFin(ev?.financiador_id||oc?.financiador_id, -costo);
      await upd("ordenes_compra_v2",t,ocId,{estado_compra:"pendiente",costo_total:0});
    }
    if(tabla==="eventos_pago_financiamiento"){
      const monto=Number(ev?.monto)||0;
      await ajustarSaldoFin(ev?.financiador_id||oc?.financiador_id, +monto); // vuelve a deber
      await upd("ordenes_compra_v2",t,ocId,{estado_pago_financiamiento:"pendiente"});
    }
    if(tabla==="eventos_pago_cliente"){
      const monto=Number(ev?.monto)||0;
      const nuevoCobrado=Math.max(0,Number(oc?.monto_cobrado||0)-monto);
      await upd("ordenes_compra_v2",t,ocId,{monto_cobrado:nuevoCobrado,
        estado_pago_cliente:nuevoCobrado>=(oc?.monto_facturado||0)&&nuevoCobrado>0?"pagado":(nuevoCobrado>0?"parcial":"pendiente")});
    }
    if(tabla==="eventos_entrega"){
      await upd("ordenes_compra_v2",t,ocId,{estado_entrega:"pendiente"});
    }

    await registrarCambio(t,{ocId,ocNumero:oc?.numero_oc,usuarioId:perfil?.id,
      usuarioNombre:perfil?.nombre,accion:`Eliminó registro de ${etapaKey}`});
    showToast("Registro eliminado y saldos corregidos"); await cargarTodo();
  };

  const handleEliminarFactura=async(ocId, facturaId)=>{
    const t=session.access_token;
    const oc=ocs.find(o=>o.id===ocId);
    const ev=(oc?.eventos_factura||[]).find(f=>f.id===facturaId);

    await fetch(`${SUPABASE_URL}/rest/v1/eventos_factura?id=eq.${facturaId}`,{method:"DELETE",headers:hdrs(t)});

    const otras=(oc?.eventos_factura||[]).filter(f=>f.id!==facturaId);
    const facturadoRestante=otras.reduce((s,f)=>s+(Number(f.monto)||0),0);
    await upd("ordenes_compra_v2",t,ocId,{
      estado_factura_propia: otras.length?"emitida":"pendiente",
      monto_facturado: facturadoRestante,
      // si ya no hay factura, tampoco puede haber cobro válido
      ...(otras.length?{}:{estado_pago_cliente:"pendiente"}),
    });

    await registrarCambio(t,{ocId,ocNumero:oc?.numero_oc,usuarioId:perfil?.id,
      usuarioNombre:perfil?.nombre,accion:`Eliminó factura N°${ev?.numero_factura||""}`});
    showToast("Factura eliminada y montos corregidos"); await cargarTodo();
  };

  const handleEliminarOC=async(ocId)=>{
    const t=session.access_token;
    const oc=ocs.find(o=>o.id===ocId);

    // Lo que esta OC le sumó a la deuda del financiador, menos lo que ya se le pagó
    const sumaCompras=(oc?.eventos_compra||[]).reduce((s,e)=>s+(Number(e.costo_compra)||0),0)
      || Number(oc?.costo_total)||0;
    const sumaPagosFin=(oc?.eventos_pago_financiamiento||[]).reduce((s,e)=>s+(Number(e.monto)||0),0);
    const deltaDeuda=-(sumaCompras-sumaPagosFin); // negativo = baja la deuda
    if(oc?.financiador_id) await ajustarSaldoFin(oc.financiador_id, deltaDeuda);

    // Borrar todo lo que cuelga de la OC
    const tablas=["eventos_compra","eventos_entrega","eventos_factura","eventos_pago_cliente",
      "eventos_pago_financiamiento","eventos_postventa","oc_productos_link","oc_comentarios",
      "oc_reclamos","oc_responsables","historial_cambios","oc_bloqueos"];
    for(const tabla of tablas){
      try{ await fetch(`${SUPABASE_URL}/rest/v1/${tabla}?oc_id=eq.${ocId}`,{method:"DELETE",headers:hdrs(t)}); }catch{}
    }
    await fetch(`${SUPABASE_URL}/rest/v1/ordenes_compra_v2?id=eq.${ocId}`,{method:"DELETE",headers:hdrs(t)});

    showToast(deltaDeuda
      ? `OC eliminada · se devolvieron ${fmt.money(Math.abs(deltaDeuda))} a ${financiadores.find(f=>f.id===oc?.financiador_id)?.nombre||"el financiador"}`
      : "OC eliminada");
    await cargarTodo();
  };

  const handleBloquear=async(ocId)=>{
    if(!perfil) return;
    await bloquearOC(session.access_token,ocId,perfil.id,perfil.nombre);
  };
  const handleLiberar=async(ocId)=>{
    await liberarOC(session.access_token,ocId);
  };
  const handleAgregarComentario=async(ocId,texto)=>{
    const t=session.access_token;
    const oc=ocs.find(o=>o.id===ocId);
    await ins("oc_comentarios",t,{id:genId("cmt"),oc_id:ocId,usuario_id:perfil.id,usuario_nombre:perfil.nombre,texto});
    await registrarCambio(t,{ocId,ocNumero:oc?.numero_oc,usuarioId:perfil.id,usuarioNombre:perfil.nombre,accion:"Comentario agregado"});
    await cargarTodo();
  };
  const handleEliminarComentario=async(comentarioId)=>{
    await del("oc_comentarios",session.access_token,comentarioId);
    await cargarTodo();
  };
  const handleMarcarNotificacionesLeidas=async()=>{
    const t=session.access_token;
    const noLeidas=notificaciones.filter(n=>!n.leida);
    await Promise.all(noLeidas.map(n=>upd("notificaciones",t,n.id,{leida:true})));
    setNotificaciones(prev=>prev.map(n=>({...n,leida:true})));
  };

  const handleImportarEntidades=async(filas)=>{
    const t=session.access_token;
    for(const fila of filas){
      if(!fila.rut?.trim()) continue;
      const existente=entidadesCatalogo.find(e=>e.rut===fila.rut.trim());
      if(existente) await upd("entidades_catalogo",t,existente.id,fila);
      else await ins("entidades_catalogo",t,{id:genId("ent"),...fila,creado_por:session.user.id});
    }
    showToast(`${filas.length} entidades importadas al catálogo`);
    await cargarTodo();
  };
  const handleGuardarDatosOC=async(ocId,{numeroOc,resincronizar,cliente,entidad,comuna,contacto,rutCliente,correo,fechaOC})=>{
    const t=session.access_token;
    const oc=ocs.find(o=>o.id===ocId);

    // Si cambió el código, dejarlo en el historial: es un dato sensible
    if(numeroOc&&numeroOc!==oc?.numero_oc){
      await registrarCambio(t,{ocId,ocNumero:numeroOc,usuarioId:perfil?.id,usuarioNombre:perfil?.nombre,
        accion:"Código de OC corregido",campo:"numero_oc",
        valorAnterior:oc?.numero_oc,valorNuevo:numeroOc});
    }

    await upd("ordenes_compra_v2",t,ocId,{...(numeroOc?{numero_oc:numeroOc}:{}),cliente,entidad,comuna,contacto,rut_cliente:rutCliente,correo_cliente:correo,ultimo_editor:session.user.id,ultima_edicion:new Date().toISOString()});

    // Volver a traer los datos con el código corregido
    if(resincronizar&&numeroOc){
      try{
        const r=await fetch(`/api/oc?codigo=${encodeURIComponent(numeroOc)}`);
        const j=await r.json();
        if(j.ok&&j.oc){
          const d=j.oc;
          await upd("ordenes_compra_v2",t,ocId,{
            cliente:d.cliente||cliente, entidad:d.entidad||entidad,
            rut_cliente:d.rut_cliente||rutCliente, comuna:d.comuna||comuna,
            contacto:d.contacto||contacto, correo_cliente:correo||d.correo_cliente||"",
            monto_total:d.monto_total||oc?.monto_total, tipo_despacho:d.tipo_despacho||"",
            dias_pago:d.dias_pago||30, sync_pendiente:false});
          showToast(`Datos actualizados desde Mercado Público`);
        } else {
          showToast("El código no se encontró en Mercado Público","error");
        }
      }catch{ showToast("No se pudo consultar Mercado Público","error"); }
    }
    if(fechaOC){
      const oc=ocs.find(o=>o.id===ocId);
      const evC=(oc?.eventos_compra||[])[0];
      if(evC) await upd("eventos_compra",t,evC.id,{fecha:fechaOC});
    }
    if (rutCliente?.trim()) {
      try {
        const existente = entidadesCatalogo.find(e=>e.rut===rutCliente.trim());
        const datos = { rut: rutCliente.trim(), nombre_entidad: entidad||cliente||"", comuna: comuna||"", contacto: contacto||"", correo: correo||"" };
        if (existente) await upd("entidades_catalogo", session.access_token, existente.id, datos);
        else await ins("entidades_catalogo", session.access_token, { id: genId("ent"), ...datos, creado_por: session.user.id });
      } catch {}
    }
    showToast("Datos actualizados"); await cargarTodo();
  };
  const handleEditarEvento=async(oc, tabla, eventoOriginal, cambios)=>{
    const t=session.access_token;
    await upd(tabla, t, eventoOriginal.id, cambios);

    if (tabla==="eventos_compra") {
      const difVenta = (cambios.monto_venta??eventoOriginal.monto_venta) - (eventoOriginal.monto_venta||0);
      const difCosto = (cambios.costo_compra??eventoOriginal.costo_compra) - (eventoOriginal.costo_compra||0);
      if (difVenta || difCosto) {
        await upd("ordenes_compra_v2", t, oc.id, {
          monto_total: Number(oc.monto_total||0) + difVenta,
          costo_total: Number(oc.costo_total||0) + difCosto,
        });
      }
      if (difCosto && oc.financiador_id) {
        const fin = financiadores.find(f=>f.id===oc.financiador_id);
        if (fin) await upd("financiadores", t, fin.id, { saldo_deuda: Math.max(0, Number(fin.saldo_deuda||0) + difCosto) });
      }
    }
    if (tabla==="eventos_factura") {
      const difMonto = (cambios.monto??eventoOriginal.monto) - (eventoOriginal.monto||0);
      if (difMonto) await upd("ordenes_compra_v2", t, oc.id, { monto_facturado: Math.max(0, Number(oc.monto_facturado||0) + difMonto) });
    }
    if (tabla==="eventos_pago_cliente") {
      const difMonto = (cambios.monto??eventoOriginal.monto) - (eventoOriginal.monto||0);
      if (difMonto) {
        const nuevoCobrado = Math.max(0, Number(oc.monto_cobrado||0) + difMonto);
        await upd("ordenes_compra_v2", t, oc.id, { monto_cobrado: nuevoCobrado, estado_pago_cliente: nuevoCobrado>=(oc.monto_facturado||0) ? "pagado" : (nuevoCobrado>0 ? "parcial" : "pendiente") });
      }
    }
    if (tabla==="eventos_pago_financiamiento") {
      const difMonto = (cambios.monto??eventoOriginal.monto) - (eventoOriginal.monto||0);
      const finId = eventoOriginal.financiador_id;
      if (difMonto && finId) {
        const fin = financiadores.find(f=>f.id===finId);
        if (fin) await upd("financiadores", t, fin.id, { saldo_deuda: Math.max(0, Number(fin.saldo_deuda||0) - difMonto) });
      }
    }
    showToast("Evento corregido y totales actualizados"); await cargarTodo();
  };
  const handleGuardarContacto=async({rut,nombreCliente,correo})=>{
    try { await ins("contactos_cobranza",session.access_token,{id:genId("cob"),rut,nombre_cliente:nombreCliente,correo,creado_por:session.user.id}); await cargarTodo(); }
    catch(e){ /* si ya existe el RUT (unique), no es un error fatal */ }
  };
  const handleEnviarReclamo=async({correo,asunto,cuerpo,ocId,rut})=>{
    const url=`mailto:${encodeURIComponent(correo)}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`;
    const ahora=new Date().toISOString();
    const t=session.access_token;
    const oc=ocs.find(o=>o.id===ocId);
    try {
      await upd("ordenes_compra_v2",t,ocId,{
        correo_cliente:correo, rut_cliente:rut||undefined,
        ultimo_reclamo_fecha:ahora, ultimo_reclamo_por:session.user.id,
      });
      await ins("oc_reclamos",t,{
        id:genId("rec"),oc_id:ocId,oc_numero:oc?.numero_oc,
        correo,fecha:ahora,
        usuario_id:session.user.id,usuario_nombre:perfil?.nombre||"",
      });
    } catch {}
    window.location.href=url;
    showToast(`Correo abierto para ${correo}`);
    setOcs([]);
    await cargarTodo();
  };

  const handleRegistrarRespuestaReclamo=async({reclamoId,fechaPrometida,notas})=>{
    const t=session.access_token;
    await upd("oc_reclamos",t,reclamoId,{
      fecha_prometida:fechaPrometida||null,
      respuesta_notas:notas||null,
      respondido_en:new Date().toISOString(),
    });
    showToast("Respuesta registrada");
    await cargarTodo();
  };

  // ─── RENDER ───────────────────────────────────
  if(loadingApp) return <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",color:C.inkMuted,fontFamily:SANS}}>Cargando…</div>;
  if(!session) return <LoginScreen onLogin={handleLogin} />;
  const visTabs=TABS.filter(t=>!t.adminOnly||perfil?.rol==="admin");
  const alertasUrgentes=calcularAlertas(ocs).filter(a=>a.nivel==="alto").length;

  // Todo lo que ya está registrado, para que la cartola no lo duplique
  // El destino permite sumar los fragmentos de un abono repartido
  const movimientosRegistrados=[
    ...ocs.flatMap(o=>(o.eventos_pago_cliente||[]).map(e=>({fecha:e.fecha,monto:e.monto,destino:`cli_${o.id}`}))),
    ...ocs.flatMap(o=>(o.eventos_pago_financiamiento||[]).map(e=>({fecha:e.fecha,monto:e.monto,destino:`fin_${e.financiador_id||o.financiador_id}`}))),
    ...(pagoFinSueltos||[]).map(e=>({fecha:e.fecha,monto:e.monto,destino:`fin_${e.financiador_id}`})),
    ...(gastos||[]).map(g=>({fecha:g.fecha,monto:g.monto,destino:`gas_${g.categoria_id}`})),
    ...(pagosVendedor||[]).map(p=>({fecha:p.fecha,monto:p.monto_pagado,destino:`ven_${p.vendedor_id}`})),
    ...(aportes||[]).map(a=>({fecha:a.fecha,monto:a.monto,destino:`ap_${a.socio}`})),
  ].filter(m=>m.fecha&&m.monto);

  return (
    <div style={{minHeight:"100vh",background:C.paper,fontFamily:SANS,paddingBottom:76}}>
      {/* HEADER */}
      <div style={{background:`linear-gradient(135deg,${C.night} 0%,#16213E 100%)`,padding:"calc(16px + env(safe-area-inset-top)) 16px 14px",color:"#fff",boxShadow:"0 2px 12px rgba(11,17,32,0.25)",position:"sticky",top:0,zIndex:30}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={{display:"flex",alignItems:"center",gap:10,minWidth:0,flex:1}}>
            <div style={{width:38,height:38,background:"rgba(20,184,166,0.15)",border:`1.5px solid ${C.teal}`,borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:MONO,color:C.teal,fontWeight:800,fontSize:13}}>BFK</div>
            <div>
              {tab==="panel"?(
                <>
                  <div style={{fontWeight:800,fontSize:15,letterSpacing:-0.3,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                    {(()=>{ const h=new Date().getHours(); return h<12?"Buenos días":h<19?"Buenas tardes":"Buenas noches"; })()}, {perfil?.nombre?.split(" ")[0]||""} 👋
                  </div>
                  <div style={{fontSize:10.5,color:"#8B9AB5"}}>
                    {new Date().toLocaleDateString("es-CL",{weekday:"long",day:"numeric",month:"long"})}
                  </div>
                </>
              ):(
                <>
                  <div style={{fontWeight:800,fontSize:15,letterSpacing:-0.3}}>{TABS.find(t=>t.key===tab)?.label||"BFK Ltda"}</div>
                  <div style={{fontSize:10.5,color:"#8B9AB5"}}>{perfil?.nombre} · {perfil?.rol==="admin"?"Administrador":"Usuario"}</div>
                </>
              )}
            </div>
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <button onClick={()=>setAccion("compra_oc")} style={{background:C.teal,border:"none",color:"#fff",borderRadius:10,padding:"9px 14px",fontSize:12.5,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0,boxShadow:"0 3px 10px rgba(20,184,166,0.35)"}}>+ Nueva OC</button>
            <button onClick={handleLogout} style={{background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.12)",color:"#B8C4D9",borderRadius:9,padding:"8px 10px",fontSize:12,fontWeight:600,cursor:"pointer"}}>⏻</button>
          </div>
        </div>
      </div>

      {/* CONTENIDO */}
      <div style={{padding:16}}>
        {tab==="panel"&&<PanelDashboard ocs={ocs} financiadores={financiadores} gastos={gastos} pagosVendedor={pagosVendedor} ivaMensual={ivaMensual} vendedores={vendedores} pagoFinSueltos={pagoFinSueltos} aportes={aportes} onNavigate={(t,filtro,ocId)=>{setFiltroCompras(filtro||null);setOcFoco(ocId||null);setTab(t);}} onAccion={(k)=>setAccion(k)} onSincronizar={completarTodasDesdeMP} onCorregirFechas={corregirFechasTodas} sincronizando={sincronizando} porAceptar={porAceptar} onActualizarPorAceptar={revisarPorAceptar} verificandoPorAceptar={verificandoPorAceptar} aceptadasSinCargar={aceptadasSinCargar} onCargarOC={(numero)=>{setCodigoOcRapida(numero);setAccion("compra_oc");}} onCargarTodasAceptadas={handleCargarTodasAceptadas} cargandoAceptadas={cargandoAceptadas} onActualizarAceptadas={revisarAceptadasSinCargar} verificandoAceptadas={verificandoAceptadas} canceladasEnMP={canceladasEnMP} onEliminarCancelada={handleEliminarOC} onActualizarCanceladas={revisarCanceladasEnMP} verificandoCanceladas={verificandoCanceladas} onValidarTodo={validarTodoContraMP} validandoTodo={validandoTodo} usoMP={usoMP} esCodigoMP={esCodigoMP} ultimaCartola={ultimaCartola} saldoBanco={saldoBanco} bancoMensual={bancoMensual} onEditarSaldo={()=>setAccion("saldo_banco")} />}
        {tab==="compras"&&<PanelCompras ocs={ocs} perfiles={perfiles} filtroInicial={filtroCompras} ocFoco={ocFoco} contactos={contactos} onEnviarReclamo={handleEnviarReclamo} onRegistrarRespuestaReclamo={handleRegistrarRespuestaReclamo} onGuardarContacto={handleGuardarContacto} onGuardarDatosOC={handleGuardarDatosOC} onEditarEvento={handleEditarEvento} financiadores={financiadores} onConfirmarEntrega={handleEntrega} onEmitirFactura={handleFactura} onPagoCliente={handlePagoCliente} onPagoFinanciamiento={handlePagoFin} entidadesCatalogo={entidadesCatalogo} onGuardarLink={handleGuardarLink} onEliminarLink={handleEliminarLink} onEditarLink={handleEditarLink} onSincronizarFecha={handleSincronizarFecha} bloqueos={bloqueos} perfil={perfil} historialCambios={historialCambios} onAgregarComentario={handleAgregarComentario} onEliminarComentario={handleEliminarComentario} onBloquear={handleBloquear} onLiberar={handleLiberar} onEliminarOC={handleEliminarOC} onEliminarFactura={handleEliminarFactura} onEliminarEvento={handleEliminarEvento} vendedores={vendedores} onIngresarCompra={handleIngresarCompra} onAsignarResponsable={handleAsignarResponsable} onGuardarPostventa={handleGuardarPostventa} />}
        {tab==="notif"&&<PanelNotificaciones notificaciones={notificaciones} ocs={ocs} onMarcarLeidas={handleMarcarNotificacionesLeidas} onNavigate={(t,filtro,ocId)=>{setFiltroCompras(filtro||null);setOcFoco(ocId||null);setTab(t);}} />}
        {tab==="agenda"&&<PanelCalendario ocs={ocs} onMarcarFecha={handleMarcarFecha} />}
        {tab==="financiamiento"&&<PanelFinanciamiento financiadores={financiadores} ocs={ocs} ajustes={ajustesSaldo} perfiles={perfiles} onAjustar={handleAjusteSaldo} aportes={aportes} onGuardarAporte={handleGuardarAporte} onEliminarAporte={handleEliminarAporte} onAbonar={()=>setAccion("abono_fin")} />}
        {tab==="gastos"&&<PanelGastos gastos={gastos} categorias={categoriasGasto} vendedores={vendedores} pagosVendedor={pagosVendedor} ocs={ocs} onNuevoGasto={handleNuevoGasto} onPagoVendedor={handlePagoVendedorSimple} />}
        {tab==="vendedores"&&<PanelVendedores vendedores={vendedores} ocs={ocs} ivaMensual={ivaMensual} pagosVendedor={pagosVendedor} onGuardarIva={handleGuardarIva} onPagoVendedor={handlePagoVendedorSimple} />}
        {tab==="usuarios"&&perfil?.rol==="admin"&&<PanelUsuarios perfiles={perfiles} ocs={ocs} onChangeRol={handleChangeRol} session={session} showToast={showToast} entidadesCatalogo={entidadesCatalogo} onImportarEntidades={handleImportarEntidades} />}
      </div>

      {/* NAV BOTTOM — 5 principales + Más */}
      {(()=>{
        const principales=visTabs.filter(t=>["panel","compras","agenda","notif"].includes(t.key));
        const secundarias=visTabs.filter(t=>!["panel","compras","agenda","notif"].includes(t.key));
        const enMas=secundarias.some(t=>t.key===tab);
        return (
          <>
            {menuMas&&(
              <div onClick={()=>setMenuMas(false)} style={{position:"fixed",inset:0,background:"rgba(15,23,42,0.35)",zIndex:40}}>
                <div onClick={e=>e.stopPropagation()} style={{position:"fixed",bottom:"calc(64px + env(safe-area-inset-bottom))",left:12,right:12,background:C.card,borderRadius:16,padding:"12px",boxShadow:"0 -10px 40px rgba(15,23,42,0.2)",zIndex:41}}>
                  <div style={{width:36,height:4,background:C.border,borderRadius:2,margin:"0 auto 12px"}} />
                  <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8}}>
                    {secundarias.map(t=>(
                      <button key={t.key} onClick={()=>{setTab(t.key);setFiltroCompras(null);setOcFoco(null);setMenuMas(false);}} style={{background:tab===t.key?C.tealLight:C.paper,border:"none",borderRadius:12,padding:"12px 6px",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:5}}>
                        <span style={{fontSize:20}}>{t.icon}</span>
                        <span style={{fontSize:10,fontWeight:700,color:tab===t.key?C.tealDark:C.inkMuted}}>{t.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
            <div style={{position:"fixed",bottom:0,left:0,right:0,background:"rgba(255,255,255,0.96)",backdropFilter:"blur(12px)",borderTop:`1px solid ${C.border}`,display:"flex",padding:"6px 4px calc(6px + env(safe-area-inset-bottom))",boxShadow:"0 -4px 20px rgba(15,23,42,0.06)",zIndex:42}}>
              {principales.map(t=>{
                const activo=tab===t.key;
                return (
                  <button key={t.key} onClick={()=>{setTab(t.key);setFiltroCompras(null);setOcFoco(null);setMenuMas(false);}} style={{flex:1,background:"none",border:"none",padding:"6px 1px",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
                    <span style={{fontSize:17,position:"relative",display:"flex",alignItems:"center",justifyContent:"center",width:44,height:28,borderRadius:14,background:activo?C.tealLight:"transparent",transition:"all 0.18s"}}>
                      {t.icon}
                      {t.key==="notif"&&<NotifBadge notificaciones={notificaciones} urgentes={alertasUrgentes} />}
                    </span>
                    <span style={{fontSize:9.5,fontWeight:activo?800:600,color:activo?C.tealDark:C.inkFaint}}>{t.label}</span>
                  </button>
                );
              })}
              {secundarias.length>0&&(
                <button onClick={()=>setMenuMas(v=>!v)} style={{flex:1,background:"none",border:"none",padding:"6px 1px",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
                  <span style={{fontSize:17,display:"flex",alignItems:"center",justifyContent:"center",width:44,height:28,borderRadius:14,background:enMas||menuMas?C.tealLight:"transparent",transition:"all 0.18s"}}>☰</span>
                  <span style={{fontSize:9.5,fontWeight:enMas||menuMas?800:600,color:enMas||menuMas?C.tealDark:C.inkFaint}}>Más</span>
                </button>
              )}
            </div>
          </>
        );
      })()}

      {/* MODAL NUEVA OC */}
      {accion==="compra_oc"&&(
        <Modal title="Nueva OC" onClose={()=>{setAccion(null);setCodigoOcRapida("");}}>
          <NuevaOCRapida perfil={perfil} vendedores={vendedores} entidadesCatalogo={entidadesCatalogo}
            codigoInicial={codigoOcRapida}
            onGuardar={handleNuevaOCRapida} onCerrar={()=>{setAccion(null);setCodigoOcRapida("");}} />
          <button onClick={()=>setAccion("compra_manual")}
            style={{width:"100%",background:"none",border:"none",color:C.inkFaint,fontSize:11.5,cursor:"pointer",marginTop:14,textDecoration:"underline"}}>
            Ingresar manualmente (formulario completo)
          </button>
        </Modal>
      )}
      {accion==="compra"&&<Modal title="Ingresar compra" onClose={()=>setAccion(null)}><FormCompraRapida ocs={ocs} financiadores={financiadores} perfil={perfil} onSave={handleCompraRapida} /></Modal>}
      {accion==="entrega"&&<Modal title="Ingresar entrega" onClose={()=>setAccion(null)}><FormConfirmarEntrega ocs={ocs} onSave={handleEntrega} /></Modal>}
      {accion==="factura"&&<Modal title="Ingresar factura" onClose={()=>setAccion(null)}><FormEmitirFactura ocs={ocs} onSave={handleFactura} /></Modal>}
      {accion==="saldo_banco"&&(
        <Modal title="Saldo real del banco" onClose={()=>setAccion(null)}>
          <FormSaldoBanco actual={saldoBanco} onSave={handleGuardarSaldoBanco} />
        </Modal>
      )}
      {accion==="cartola"&&<Modal title="Conciliar con el banco" onClose={()=>setAccion(null)}><ImportarCartola ocs={ocs} financiadores={financiadores} vendedores={vendedores} categorias={categoriasGasto} registrados={movimientosRegistrados} onRegistrar={handleCobrosDesdeCartola} onRegistrarEgresos={handleEgresosDesdeCartola} /></Modal>}
      {accion==="abono_fin"&&<Modal title="Abonar a financiador" onClose={()=>setAccion(null)}><FormAbonoFinanciador ocs={ocs} financiadores={financiadores} onSave={handleAbonoFinanciador} /></Modal>}
      {accion==="pago_cliente"&&<Modal title="Ingresar pago" onClose={()=>setAccion(null)}><FormPagoCliente ocs={ocs} onSave={handlePagoCliente} /></Modal>}
      {accion==="compra_manual"&&<Modal title="Nueva OC — manual" onClose={()=>setAccion(null)}><FormIngresarCompra ocs={ocs} financiadores={financiadores} vendedores={vendedores} entidadesCatalogo={entidadesCatalogo} onSave={handleIngresarCompra} /></Modal>}

      <Toast toast={toast} />
    </div>
  );
}
