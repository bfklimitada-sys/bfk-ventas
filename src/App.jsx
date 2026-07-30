import { useState, useEffect } from "react";
import { LoginScreen } from "./components/auth/LoginScreen";
import { FormIngresarCompra } from "./components/forms/FormIngresarCompra";
import { NuevaOCRapida } from "./components/forms/NuevaOCRapida";
import { PanelCalendario } from "./components/panels/PanelCalendario";
import { PanelCompras } from "./components/panels/PanelCompras";
import { PanelDashboard } from "./components/panels/PanelDashboard";
import { PanelFinanciamiento } from "./components/panels/PanelFinanciamiento";
import { PanelGastos } from "./components/panels/PanelGastos";
import { PanelUsuarios } from "./components/panels/PanelUsuarios";
import { PanelVendedores } from "./components/panels/PanelVendedores";
import { Modal, NotifBadge, Toast } from "./components/ui/Basicos";
import { PanelNotificaciones } from "./components/ui/Multiusuario";
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

export const ACCIONES=[
  {key:"compra",label:"Ingresar compra",icon:"📦",color:C.teal},
  {key:"entrega",label:"Confirmar entrega",icon:"🚚",color:C.transit},
  {key:"factura",label:"Emitir factura",icon:"🧾",color:C.info},
  {key:"pago_cliente",label:"Pago de factura",icon:"💰",color:C.ok},
  {key:"pago_financ",label:"Pago financiamiento",icon:"🏦",color:C.purple},
];

export default function App() {
  const [session,setSession]=useState(null); const [perfil,setPerfil]=useState(null); const [loadingApp,setLoadingApp]=useState(true);
  const [tab,setTab]=useState("panel"); const [filtroCompras,setFiltroCompras]=useState(null); const [accion,setAccion]=useState(null);
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

  const cargarTodo=async()=>{
    if(!session) return;
    const t=session.access_token;
    try {
      const [ocsD,finD,vendD,catD,gastD,ivaD,pagVD,ajuD,perfD,contD,entD,pagoFinSueltosD,notifD,histD,reclamosD,respD,pvD]=await Promise.all([
        selOCs(t), sel("financiadores",t,"&order=nombre"), sel("vendedores",t,"&order=nombre"),
        sel("categorias_gasto",t,"&order=nombre"), sel("gastos_indirectos",t,"&order=fecha.desc"),
        sel("iva_mensual",t), sel("pagos_vendedor",t), sel("ajustes_saldo_financiador",t,"&order=creadoEn.desc"),
        selPerfiles(t), sel("contactos_cobranza",t).catch(()=>[]), sel("entidades_catalogo",t).catch(()=>[]),
        sel("eventos_pago_financiamiento",t,"&oc_id=is.null").catch(()=>[]),
        sel("notificaciones",t,`&usuario_id=eq.${session.user.id}&order=creadoEn.desc&limit=50`).catch(()=>[]),
        sel("historial_cambios",t,"&order=creadoEn.desc&limit=200").catch(()=>[]),
        sel("oc_reclamos",t,"&order=fecha.desc").catch(()=>[]),
        sel("oc_responsables",t).catch(()=>[]),
        sel("eventos_postventa",t,"&order=creadoEn.desc").catch(()=>[]),
      ]);
      const reclamosPorOC={}, respPorOC={}, pvPorOC={};
      for(const r of reclamosD){ if(!reclamosPorOC[r.oc_id]) reclamosPorOC[r.oc_id]=[]; reclamosPorOC[r.oc_id].push(r); }
      for(const r of respD){ if(!respPorOC[r.oc_id]) respPorOC[r.oc_id]=[]; respPorOC[r.oc_id].push(r); }
      for(const r of pvD){ if(!pvPorOC[r.oc_id]) pvPorOC[r.oc_id]=[]; pvPorOC[r.oc_id].push(r); }
      const ocsConReclamos=ocsD.map(oc=>({...oc,oc_reclamos:reclamosPorOC[oc.id]||[],oc_responsables:respPorOC[oc.id]||[],eventos_postventa:pvPorOC[oc.id]||[]}));
      setOcs(ocsConReclamos); setFinanciadores(finD); setVendedores(vendD); setCategoriasGasto(catD);
      setGastos(gastD); setIvaMensual(ivaD); setPagosVendedor(pagVD); setAjustesSaldo(ajuD); setPerfiles(perfD);
      setContactos(contD); setEntidadesCatalogo(entD); setPagoFinSueltos(pagoFinSueltosD);
      setNotificaciones(notifD); setHistorialCambios(histD);
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
          dias_pago:oc.dias_pago||30, sync_pendiente:false,
          estado_compra:"pendiente", creado_por:session.user.id };

    const nueva=await ins("ordenes_compra_v2",t,fila);
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

  const handleEntrega=async(data)=>{
    const t=session.access_token;
    await ins("eventos_entrega",t,{id:genId("eve"),oc_id:data.ocId,fecha:data.fecha,persona_recibe:data.personaRecibe,creado_por:session.user.id});
    await upd("ordenes_compra_v2",t,data.ocId,{estado_entrega:"confirmada"});
    showToast("Entrega confirmada"); setAccion(null); await cargarTodo();
  };
  const handleFactura=async(data)=>{
    const t=session.access_token;
    await ins("eventos_factura",t,{id:genId("evf"),oc_id:data.ocId,fecha:data.fecha,numero_factura:data.numeroFactura,monto:data.monto,nota_credito:data.notaCredito||null,factura_anulada_numero:data.facturaAnuladaNumero||null,creado_por:session.user.id});
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
  const handleGuardarLink=async(ocId,{descripcion,url,orden})=>{
    await ins("oc_productos_link",session.access_token,{id:genId("lnk"),oc_id:ocId,descripcion,url,orden,creado_por:session.user.id});
    await cargarTodo();
  };
  const handleEliminarLink=async(linkId)=>{
    await fetch(`${SUPABASE_URL}/rest/v1/oc_productos_link?id=eq.${linkId}`,{method:"DELETE",headers:hdrs(session.access_token)});
    await cargarTodo();
  };
  const handleEditarLink=async(linkId,{descripcion,url})=>{
    await upd("oc_productos_link",session.access_token,linkId,{descripcion,url});
    await cargarTodo();
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
    const fila={oc_id:d.ocId,fecha:d.fecha,tipo:d.tipo,descripcion:d.descripcion,estado:d.estado,solucion:d.solucion,fecha_resolucion:d.fecha_resolucion};
    if(d.id) await upd("eventos_postventa",t,d.id,fila);
    else await ins("eventos_postventa",t,{id:genId("pv"),...fila,creado_por:session.user.id});
    await upd("ordenes_compra_v2",t,d.ocId,{estado_postventa:d.estado==="resuelto"?"resuelta":"con_incidencia"});
    await registrarCambio(t,{ocId:d.ocId,ocNumero:oc?.numero_oc,usuarioId:perfil.id,usuarioNombre:perfil.nombre,accion:d.id?"Post-venta actualizada":"Post-venta registrada",campo:"estado",valorNuevo:d.estado});
    showToast(d.estado==="resuelto"?"Incidencia resuelta":"Incidencia registrada"); await cargarTodo();
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
  const handleEliminarEvento=async(tabla, eventoId, ocId, etapaKey)=>{
    const t=session.access_token;
    await fetch(`${SUPABASE_URL}/rest/v1/${tabla}?id=eq.${eventoId}`,{method:"DELETE",headers:hdrs(t)});
    const reversiones={
      entrega:{estado_entrega:"pendiente"},
      cobro:{estado_pago_cliente:"pendiente",monto_cobrado:0},
      financ:{estado_pago_financiamiento:"pendiente"},
    };
    if(reversiones[etapaKey]) await upd("ordenes_compra_v2",t,ocId,reversiones[etapaKey]);
    showToast("Registro eliminado"); await cargarTodo();
  };
  const handleEliminarFactura=async(ocId, facturaId)=>{
    const t=session.access_token;
    await fetch(`${SUPABASE_URL}/rest/v1/eventos_factura?id=eq.${facturaId}`,{method:"DELETE",headers:hdrs(t)});
    const oc=ocs.find(o=>o.id===ocId);
    const otrasFacturas=(oc?.eventos_factura||[]).filter(f=>f.id!==facturaId);
    if(otrasFacturas.length===0){
      await upd("ordenes_compra_v2",t,ocId,{estado_factura_propia:"pendiente",monto_facturado:0});
    }
    showToast("Factura eliminada"); await cargarTodo();
  };
  const handleEliminarOC=async(ocId)=>{
    const t=session.access_token;
    await fetch(`${SUPABASE_URL}/rest/v1/oc_productos_link?oc_id=eq.${ocId}`,{method:"DELETE",headers:hdrs(t)});
    await fetch(`${SUPABASE_URL}/rest/v1/oc_comentarios?oc_id=eq.${ocId}`,{method:"DELETE",headers:hdrs(t)});
    await fetch(`${SUPABASE_URL}/rest/v1/historial_cambios?oc_id=eq.${ocId}`,{method:"DELETE",headers:hdrs(t)});
    await fetch(`${SUPABASE_URL}/rest/v1/ordenes_compra_v2?id=eq.${ocId}`,{method:"DELETE",headers:hdrs(t)});
    showToast("OC eliminada");
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
  const handleGuardarDatosOC=async(ocId,{cliente,entidad,comuna,contacto,rutCliente,correo,fechaOC})=>{
    const t=session.access_token;
    await upd("ordenes_compra_v2",t,ocId,{cliente,entidad,comuna,contacto,rut_cliente:rutCliente,correo_cliente:correo,ultimo_editor:session.user.id,ultima_edicion:new Date().toISOString()});
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

  // ─── RENDER ───────────────────────────────────
  if(loadingApp) return <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",color:C.inkMuted,fontFamily:SANS}}>Cargando…</div>;
  if(!session) return <LoginScreen onLogin={handleLogin} />;
  const visTabs=TABS.filter(t=>!t.adminOnly||perfil?.rol==="admin");

  return (
    <div style={{minHeight:"100vh",background:C.paper,fontFamily:SANS,paddingBottom:76}}>
      {/* HEADER */}
      <div style={{background:`linear-gradient(135deg,${C.night} 0%,#16213E 100%)`,padding:"16px 16px 14px",color:"#fff",boxShadow:"0 2px 12px rgba(11,17,32,0.25)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{width:38,height:38,background:"rgba(20,184,166,0.15)",border:`1.5px solid ${C.teal}`,borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:MONO,color:C.teal,fontWeight:800,fontSize:13}}>BFK</div>
            <div>
              {tab==="panel"?(
                <>
                  <div style={{fontWeight:800,fontSize:15,letterSpacing:-0.3}}>
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
            <button onClick={()=>setAccion("compra")} style={{background:C.teal,border:"none",color:"#fff",borderRadius:10,padding:"9px 14px",fontSize:12.5,fontWeight:700,cursor:"pointer",boxShadow:"0 3px 10px rgba(20,184,166,0.35)"}}>+ Nueva OC</button>
            <button onClick={handleLogout} style={{background:"rgba(255,255,255,0.07)",border:"1px solid rgba(255,255,255,0.12)",color:"#B8C4D9",borderRadius:9,padding:"8px 10px",fontSize:12,fontWeight:600,cursor:"pointer"}}>⏻</button>
          </div>
        </div>
      </div>

      {/* CONTENIDO */}
      <div style={{padding:16}}>
        {tab==="panel"&&<PanelDashboard ocs={ocs} financiadores={financiadores} gastos={gastos} pagosVendedor={pagosVendedor} ivaMensual={ivaMensual} vendedores={vendedores} pagoFinSueltos={pagoFinSueltos} onNavigate={(t,filtro)=>{setFiltroCompras(filtro||null);setTab(t);}} />}
        {tab==="compras"&&<PanelCompras ocs={ocs} perfiles={perfiles} filtroInicial={filtroCompras} contactos={contactos} onEnviarReclamo={handleEnviarReclamo} onGuardarContacto={handleGuardarContacto} onGuardarDatosOC={handleGuardarDatosOC} onEditarEvento={handleEditarEvento} financiadores={financiadores} onConfirmarEntrega={handleEntrega} onEmitirFactura={handleFactura} onPagoCliente={handlePagoCliente} onPagoFinanciamiento={handlePagoFin} entidadesCatalogo={entidadesCatalogo} onGuardarLink={handleGuardarLink} onEliminarLink={handleEliminarLink} onEditarLink={handleEditarLink} bloqueos={bloqueos} perfil={perfil} historialCambios={historialCambios} onAgregarComentario={handleAgregarComentario} onEliminarComentario={handleEliminarComentario} onBloquear={handleBloquear} onLiberar={handleLiberar} onEliminarOC={handleEliminarOC} onEliminarFactura={handleEliminarFactura} onEliminarEvento={handleEliminarEvento} vendedores={vendedores} onIngresarCompra={handleIngresarCompra} onAsignarResponsable={handleAsignarResponsable} onGuardarPostventa={handleGuardarPostventa} />}
        {tab==="notif"&&<PanelNotificaciones notificaciones={notificaciones} onMarcarLeidas={handleMarcarNotificacionesLeidas} />}
        {tab==="agenda"&&<PanelCalendario ocs={ocs} onMarcarFecha={handleMarcarFecha} />}
        {tab==="financiamiento"&&<PanelFinanciamiento financiadores={financiadores} ocs={ocs} ajustes={ajustesSaldo} perfiles={perfiles} onAjustar={handleAjusteSaldo} />}
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
                      <button key={t.key} onClick={()=>{setTab(t.key);setFiltroCompras(null);setMenuMas(false);}} style={{background:tab===t.key?C.tealLight:C.paper,border:"none",borderRadius:12,padding:"12px 6px",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:5}}>
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
                  <button key={t.key} onClick={()=>{setTab(t.key);setFiltroCompras(null);setMenuMas(false);}} style={{flex:1,background:"none",border:"none",padding:"6px 1px",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
                    <span style={{fontSize:17,position:"relative",display:"flex",alignItems:"center",justifyContent:"center",width:44,height:28,borderRadius:14,background:activo?C.tealLight:"transparent",transition:"all 0.18s"}}>
                      {t.icon}
                      {t.key==="notif"&&<NotifBadge notificaciones={notificaciones} />}
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
      {accion==="compra"&&(
        <Modal title="Nueva OC" onClose={()=>setAccion(null)}>
          <NuevaOCRapida perfil={perfil} vendedores={vendedores} entidadesCatalogo={entidadesCatalogo}
            onGuardar={handleNuevaOCRapida} onCerrar={()=>setAccion(null)} />
          <button onClick={()=>setAccion("compra_manual")}
            style={{width:"100%",background:"none",border:"none",color:C.inkFaint,fontSize:11.5,cursor:"pointer",marginTop:14,textDecoration:"underline"}}>
            Ingresar manualmente (formulario completo)
          </button>
        </Modal>
      )}
      {accion==="compra_manual"&&<Modal title="Nueva OC — manual" onClose={()=>setAccion(null)}><FormIngresarCompra ocs={ocs} financiadores={financiadores} vendedores={vendedores} entidadesCatalogo={entidadesCatalogo} onSave={handleIngresarCompra} /></Modal>}

      <Toast toast={toast} />
    </div>
  );
}
