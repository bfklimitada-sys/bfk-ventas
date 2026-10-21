import { validarRegistroFactura, tipoFacturaDeOC, camposFacturaExenta } from "./lib/tributario";
import { cargarClasificaciones, solicitarClasificacion, resolverClasificacion, anularSolicitud, heredarDeCotizacion, subirRespaldo, abrirRespaldo } from "./lib/clasificacionTributariaApi";
import { useState, useEffect, useRef, useMemo } from "react";
import { LoginScreen } from "./components/auth/LoginScreen";
import { RestablecerContrasena } from "./components/auth/RestablecerContrasena";
import { RETORNO_RECUPERACION } from "./lib/retornoAuth";
import { FormIngresarCompra } from "./components/forms/FormIngresarCompra";
import { NuevaOCRapida } from "./components/forms/NuevaOCRapida";
import { FormCompraRapida } from "./components/forms/FormCompraRapida";
import { FormAbonoFinanciador, ocsPendientesFinanciador, repartirFIFO } from "./components/forms/FormAbonoFinanciador";
import { registrarPagoFinanciador } from "./lib/pagosFinanciador";
import { cambiarFinanciamientoOC, deudaOC, editarCompraOC, editarPagoFinanciador, eliminarCompraOC, eliminarPagoFinanciador, esFondosPropios, registrarCompraOC } from "./lib/finanzas";
import { anioMesDe } from "./lib/calculos";
import { exportarExcelRespaldo } from "./lib/exportacion";
import { anularPagoVendedor, esPagoDuplicado, prepararPagoVendedor, registrarPagoVendedor } from "./lib/pagosVendedor";
import { ImportarCartola } from "./components/forms/ImportarCartola";
import { FormSaldoBanco } from "./components/forms/FormSaldoBanco";
import { FormConfirmarEntrega, FormEmitirFactura, FormPagoCliente } from "./components/forms/FormulariosRapidos";
import { PanelCalendario } from "./components/panels/PanelCalendario";
import { PanelCompras } from "./components/panels/PanelCompras";
import { bloqueoOC, fijarProveedorToken } from "./lib/bloqueoOCUso";
import { PanelDashboard } from "./components/panels/PanelDashboard";
import { PanelFinanciamiento } from "./components/panels/PanelFinanciamiento";
import { PanelGastos } from "./components/panels/PanelGastos";
import { planGuardarIva } from "./lib/ivaUnificado";
import { PanelUsuarios } from "./components/panels/PanelUsuarios";
import { PanelVendedores } from "./components/panels/PanelVendedores";
import { Modal, Toast } from "./components/ui/Basicos";
import { PanelNotificaciones, calcularAlertas } from "./components/ui/Multiusuario";
import { SESSION_KEY, SUPABASE_URL, crearNotificacion, del, delConfirmado, genId, getPerfil, hdrs, ins, registrarCambio, sel, selOCs, selPerfiles, storageGet, storageSet, supaRefresh, supaSignOut, upd, updRol } from "./lib/supabase";
import { buscarOCPorCodigo, esCodigoMP, esErrorDuplicado, estadoMP, fechaOCEditable, mensajeDuplicado, normalizarCodigoOC, resultadoConsultaMP } from "./lib/ocs";
import { cambiosProducto } from "./lib/productosOC";
import { CLAVE_REVISION_AUTO, LIMITE_USO_DIARIO, PREFIJO_FOTO_MP, cambiosOCDesdeMP, claveFotoMP, elegirRevisionAutomatica, fotoMP, lineaVentaDesdeMP, mpCancelada, planProductosVenta, toca } from "./lib/mercadoPublico";
import { alimentarCatalogoDesdeOC } from "./lib/entidadesOC";
import { ContactosContext } from "./components/ficha/ContactosInstitucion";
import { AvisoVersionNueva } from "./components/ui/AvisoVersionNueva";
import { avisosConciliacion } from "./lib/contactosInstitucionales";
import { rpcConciliarContactosOC, rpcGuardarContacto, rpcResolverContacto, rpcContactoObsoleto, rpcResolverPropuesta, rpcFusionarContactos, rpcCorreoCobranza } from "./lib/supabase";
import { rpcCartola, rpcArchivarOC, rpcRestaurarOC, cargarCorreosBfk, rpcMarcarCorreo, rpcAsignarVendedor, rpcAsignarFinanciador } from "./lib/supabase";
import { contarCorreosAccion, desdeCorreos, reemplazarCorreo } from "./lib/correosBfk";
import { C, MONO, SANS, fmt } from "./lib/theme";
import { Ic } from "./components/ui/Iconos";
import { generarPdfPantallas } from "./lib/pdfPantallas";
import { PANTALLAS, PANTALLA_INICIAL, HUBS, pantallaDe, pantallaDesdeHash, hashDe, puedeVer, entradasPara, pestanasDe, tituloDocumento } from "./lib/navegacion";
import { ModoTodoContext, Pestanas } from "./components/ui/Sistema";
import { PanelImpuestos } from "./components/panels/PanelImpuestos";
import { PanelBanco } from "./components/panels/PanelBanco";
import { PanelResumenFinanzas } from "./components/panels/PanelResumenFinanzas";
import { PanelCotizaciones } from "./components/panels/PanelCotizaciones";
import { listarBorradores } from "./lib/borradoresCotizacion";
import { buscarCotizacionesDeOC, cargarCotizacionLectura } from "./lib/cotizacionesDatos";
import { etiquetaCategoria, etiquetaPrioridad, etiquetaEstado, etiquetaSeguimiento } from "./lib/seguimientos";
import { idFilaCompra, idFilaDespacho, marcaPedido, filaProtegida, esEventoDePedido } from "./lib/compraCotizacion";
import { BarraInferior, BarraLateral, MenuMas, contarAlertas, useEsEscritorio } from "./components/ui/Navegacion";

// Pantallas, grupos, direcciones (#/ruta) y permisos: una sola definición en lib/navegacion.js.
export const TABS=PANTALLAS.map(p=>({key:p.key,label:p.label,icon:<Ic n={p.icono}/>,adminOnly:!!p.adminOnly}));
const ANCHO_CONTENIDO=1040; // ancho máximo del contenido en escritorio

export default function App() {
  const [todo,setTodo]=useState(false); // vista de impresión de todas las pantallas
  const [pdfEstado,setPdfEstado]=useState(null); // null | {fase:"generando",txt} | {fase:"listo",url,nombre} | {fase:"error",txt}
  const [session,setSession]=useState(null); const [perfil,setPerfil]=useState(null);
  const sesionRef=useRef(null); sesionRef.current=session; fijarProveedorToken(()=>sesionRef.current?.access_token||null); // token vigente para el ciclo de bloqueo de OC
  const [loadingApp,setLoadingApp]=useState(true);
  // Recuperación de contraseña: si la app se abrió desde el enlace del correo, se muestra primero esa pantalla.
  const [retornoRecuperacion,setRetornoRecuperacion]=useState(RETORNO_RECUPERACION);
  const [avisoLogin,setAvisoLogin]=useState(null); // {email, aviso} al volver al inicio de sesión
  // La pantalla inicial sale de la dirección (#/compras…) para que recargar o abrir un enlace mantenga la pantalla.
  const [tab,setTab]=useState(()=>pantallaDesdeHash(typeof window!=="undefined"?window.location.hash:"")||PANTALLA_INICIAL); const [filtroCompras,setFiltroCompras]=useState(null); const [ocFoco,setOcFoco]=useState(null); const [filtroAlertas,setFiltroAlertas]=useState({nivel:"todas",etapa:null}); const [volverA,setVolverA]=useState(null);
  // OCs ya consultadas a la API en esta sesión (para no reintentar en bucle)
  const intentadas=useRef(new Set());
  const revisionAutoHecha=useRef(false);
  const [accion,setAccion]=useState(null); const [abonoFinId,setAbonoFinId]=useState(null); const [busquedaCompras,setBusquedaCompras]=useState(null);
  const [menuMas,setMenuMas]=useState(false);
  const [reinicio,setReinicio]=useState(0);
  const [toast,setToast]=useState(null);
  const [exportando,setExportando]=useState(false);
  const [clasificaciones,setClasificaciones]=useState(null); const [cotizacionesClasificadas,setCotizacionesClasificadas]=useState([]);   // fase 2 exentas
  const [ocs,setOcs]=useState([]); const [ocsArchivadas,setOcsArchivadas]=useState([]); const [financiadores,setFinanciadores]=useState([]); const [vendedores,setVendedores]=useState([]);
  const [categoriasGasto,setCategoriasGasto]=useState([]); const [gastos,setGastos]=useState([]); const [ivaMensual,setIvaMensual]=useState([]);
  const [pagosVendedor,setPagosVendedor]=useState([]); const [ajustesSaldo,setAjustesSaldo]=useState([]); const [perfiles,setPerfiles]=useState([]);
  const [contactos,setContactos]=useState([]);
  const [entidadesCatalogo,setEntidadesCatalogo]=useState([]);
  const [contactosInst,setContactosInst]=useState(null);   // contactos institucionales (null = migración no instalada)
  const [vinculosInst,setVinculosInst]=useState([]);
  const ciDisponible=useRef(false);   // se lee dentro de flujos que corren antes del re-render (sincronización al cargar)
  const [pagoFinSueltos,setPagoFinSueltos]=useState([]);
  const [difsHistoricas,setDifsHistoricas]=useState([]); // Fase 4B: diferencias históricas pendientes de aprobación (solo lectura)
  const [notificaciones,setNotificaciones]=useState([]);
  const [correosBfk,setCorreosBfk]=useState([]); // Fase Correos: correos del buzón de BFK como notificaciones (solo lectura)
  const [historialCambios,setHistorialCambios]=useState([]);
  const [aportes,setAportes]=useState([]);
  const [porAceptar,setPorAceptar]=useState([]); // OCs enviadas y sin aceptar en MP
  const [aceptadasSinCargar,setAceptadasSinCargar]=useState([]); // OCs ya aceptadas en MP, pendientes de cargar
  const [codigoOcRapida,setCodigoOcRapida]=useState(""); // prefill al cargar desde el aviso
  const [ultimaCartola,setUltimaCartola]=useState(null);
  const [saldoBanco,setSaldoBanco]=useState(null);
  const [bancoMensual,setBancoMensual]=useState([]);

  const showToast=(msg,type="success")=>{ setToast({msg,type}); setTimeout(()=>setToast(null),3000); };
  // Contactos institucionales: tras guardar o sincronizar una OC, la base compara sus correos con los de la institución
  // (por RUT validado). Nunca modifica la OC; si la migración no está instalada no hace nada. Devuelve avisos para el usuario.
  const conciliarContactos=async(token,ocId,origen,cargo)=>{
    if(!ciDisponible.current||!ocId) return "";
    try{ return avisosConciliacion(await rpcConciliarContactosOC(token,ocId,origen,cargo)).join(" "); }
    catch{ return ""; }
  };

  useEffect(()=>{ if(tab!=="compras") setBusquedaCompras(null); },[tab]);

  // ── Navegación (Fase 3) ─────────────────────────────────────────
  // Cada pantalla tiene su dirección (#/compras…): atrás/adelante del navegador o del
  // celular cambian de pantalla, y recargar deja al usuario donde estaba.
  const esEscritorio=useEsEscritorio();
  const modoHistorial=useRef("reemplazar"); // la primera pantalla reemplaza la entrada; las siguientes se agregan
  useEffect(()=>{
    const h=hashDe(tab);
    const actual=window.location.hash;
    // Al abrir, una dirección con datos (p. ej. "#access_token=…" de un correo de Supabase) no se toca.
    const conDatos=modoHistorial.current==="reemplazar"&&/[=&]/.test(actual);
    if(actual!==h&&!conDatos){
      if(modoHistorial.current==="reemplazar") window.history.replaceState(window.history.state,"",h);
      else window.history.pushState(null,"",h);
    }
    modoHistorial.current="agregar";
    window.scrollTo(0,0); // cada pantalla empieza arriba
  },[tab]);
  useEffect(()=>{ document.title=session?tituloDocumento(tab):tituloDocumento(null); },[session,tab]);
  const estadoNav=useRef({}); estadoNav.current={tab,accion,menuMas};
  useEffect(()=>{
    const alNavegarAtras=()=>{
      const {tab:actual,accion:acc,menuMas:mm}=estadoNav.current;
      if(acc||mm){
        // Atrás con una ventana o el menú abiertos: se cierran y se queda en la misma pantalla.
        setAccion(null); setMenuMas(false); setCodigoOcRapida("");
        window.history.pushState(null,"",hashDe(actual));
        return;
      }
      const destino=pantallaDesdeHash(window.location.hash)||PANTALLA_INICIAL;
      // Dirección escrita a mano o desconocida: se corrige sin agregar otra entrada al historial.
      if(window.location.hash!==hashDe(destino)) window.history.replaceState(null,"",hashDe(destino));
      setFiltroCompras(null); setOcFoco(null); setVolverA(null);
      setTab(destino);
    };
    window.addEventListener("popstate",alNavegarAtras);
    return ()=>window.removeEventListener("popstate",alNavegarAtras);
  },[]);
  // Una pantalla solo de administración no se muestra a quien no es administrador (p. ej. un enlace #/administracion).
  useEffect(()=>{
    if(perfil&&!puedeVer(tab,perfil.rol==="admin")){ modoHistorial.current="reemplazar"; setTab(PANTALLA_INICIAL); }
  },[perfil,tab]);
  // Centro Finanzas: su acceso abre la última pestaña usada (o el Resumen si ya se está dentro).
  const ultimaFinanzas=useRef("finanzas");
  useEffect(()=>{ if(pantallaDe(tab)?.hub==="finanzas") ultimaFinanzas.current=tab; },[tab]);
  const irA=(t)=>{
    let destino=t;
    if(t==="finanzas"&&pantallaDe(tab)?.hub!=="finanzas") destino=ultimaFinanzas.current||"finanzas";
    if(destino===tab) setReinicio(n=>n+1); // tocar la pantalla actual vuelve a su vista inicial (p. ej. cierra la ficha abierta)
    setTab(destino); setFiltroCompras(null); setOcFoco(null); setVolverA(null); setMenuMas(false);
  };
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
  const handleLogout=async()=>{ await bloqueoOC.cerrar(); await supaSignOut(session.access_token); setSession(null); setPerfil(null); storageSet(SESSION_KEY,""); };

  // Renovar el token automáticamente cada 45 minutos mientras la app
  // sigue abierta — antes solo se renovaba una vez, al iniciar, y por
  // eso el token expiraba a la hora (limite de Supabase) si se dejaba
  // la app abierta más tiempo, dando error "JWT expired".
  useEffect(()=>{
    if(!session?.refresh_token) return;
    const intervalo=setInterval(async()=>{
      try{
        const s=await supaRefresh(session.refresh_token);
        setSession(s); storageSet(SESSION_KEY,JSON.stringify(s));
      }catch{}
    }, 45*60*1000);
    return ()=>clearInterval(intervalo);
  },[session?.refresh_token]);

  // Cuando el celular estuvo bloqueado o la app en segundo plano, el
  // navegador pausa los temporizadores — por eso el intervalo de arriba
  // solo no basta. Al volver a la pantalla, renovar también ahí.
  useEffect(()=>{
    if(!session?.refresh_token) return;
    const alVolver=async()=>{
      if(document.visibilityState!=="visible") return;
      try{
        const s=await supaRefresh(session.refresh_token);
        setSession(s); storageSet(SESSION_KEY,JSON.stringify(s));
      }catch{}
    };
    document.addEventListener("visibilitychange",alVolver);
    return ()=>document.removeEventListener("visibilitychange",alVolver);
  },[session?.refresh_token]);

  // Si la pestaña se recargó o el sistema la cerró con una cotización sin guardar, al volver el MISMO usuario
  // se abre Cotizaciones, que restaura el borrador local (marcado como «recuperado», no guardado en BFK).
  const revisoBorradores=useRef(false);
  useEffect(()=>{
    const uid=session?.user?.id; if(!uid||revisoBorradores.current) return;
    revisoBorradores.current=true;
    listarBorradores(uid).then(l=>{ if(l.length){ setTab("cotizaciones"); showToast("Se recuperaron cambios de cotización no guardados en este dispositivo (aún no están guardados en BFK)."); } }).catch(()=>{});
  },[session?.user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // ─── Caché del último resultado bueno de Mercado Público ────────
  // Si la consulta de ahora falla, no se borra lo que ya se sabía —
  // se sigue mostrando lo último que sí funcionó, con la hora exacta,
  // para que "no aparece nada" nunca se confunda con "no hay nada".
  const [actMP,setActMP]=useState({porAceptar:null,aceptadas:null,canceladas:null});

  const guardarCacheMP=async(clave,datos)=>{
    if(!session) return;
    const t=session.access_token, iso=new Date().toISOString();
    try{
      const actualizadas=await upd("mp_cache_avisos",t,clave,{datos,actualizado_en:iso}).catch(()=>[]);
      if(!Array.isArray(actualizadas)||!actualizadas.length) await ins("mp_cache_avisos",t,{id:clave,datos,actualizado_en:iso}).catch(()=>{});
      setActMP(a=>({...a,[clave]:iso}));
    }catch{ /* si falla el guardado, el dato igual queda mostrado en esta sesión */ }
  };

  const cargarCacheMP=async()=>{
    try{
      const filas=await sel("mp_cache_avisos",session.access_token,"&id=in.(porAceptar,aceptadas,canceladas)").catch(()=>[]);
      const porId={}; for(const f of (filas||[])) porId[f.id]=f;
      if(porId.porAceptar){ setPorAceptar(porId.porAceptar.datos||[]); setActMP(a=>({...a,porAceptar:porId.porAceptar.actualizado_en})); }
      if(porId.aceptadas){ setAceptadasSinCargar(porId.aceptadas.datos||[]); setActMP(a=>({...a,aceptadas:porId.aceptadas.actualizado_en})); }
      if(porId.canceladas){ setCanceladasEnMP(porId.canceladas.datos||[]); setActMP(a=>({...a,canceladas:porId.canceladas.actualizado_en})); }
    }catch{ /* sin caché disponible, se parte vacío como antes */ }
  };

  useEffect(()=>{ if(session) cargarCacheMP(); },[session]);

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
      const [ocsD,finD,vendD,catD,gastD,ivaD,pagVD,ajuD,perfD,contD,entD,pagoFinSueltosD,notifD,histD,reclamosD,respD,pvD,aporD,cartD,sbD,bmD,difD,fotosD,correosD,segD,segHistD,tribD,tribCotD,ciD,ciOcD]=await enLotes([
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
        ()=>sel("fin_diferencias_historicas",t,"&estado=eq.pendiente").catch(()=>[]),
        ()=>sel("mp_cache_avisos",t,`&id=like.${PREFIJO_FOTO_MP}*`).catch(()=>[]),
        ()=>cargarCorreosBfk(t,desdeCorreos()).catch(()=>[]),
        ()=>sel("oc_seguimientos",t,"&order=creado_en.desc").catch(()=>[]),   // Seguimiento especial (15/10/2026)
        ()=>sel("historial_cambios",t,"&campo=like.seguimiento%3A*&order=creadoEn.desc&limit=2000").catch(()=>[]),   // su bitácora (avances y cambios)
        ()=>cargarClasificaciones(t).catch(()=>null),   // Fase 2 exentas: historial de clasificación tributaria (null = migración no instalada)
        ()=>sel("cotizaciones",t,"&estado=eq.adjudicada&tratamiento_iva=not.is.null&limit=500").catch(()=>[]),   // cotizaciones adjudicadas ya clasificadas (para heredar a la OC)
        ()=>sel("contactos_institucionales",t,"&order=rut_clave").catch(()=>null),   // contactos institucionales (null = no instalado)
        ()=>sel("contactos_institucionales_oc",t).catch(()=>[]),
      ]);
      const reclamosPorOC={}, respPorOC={}, pvPorOC={}, segPorOC={};
      const bitacoraSeg={}; for(const h of (segHistD||[])){ const k=String(h.campo||"").slice(12); if(k) (bitacoraSeg[k]||=[]).push(h); }
      for(const r of (segD||[])){ (segPorOC[r.oc_id]||=[]).push({...r,bitacora:bitacoraSeg[r.id]||[]}); }
      for(const r of reclamosD){ if(!reclamosPorOC[r.oc_id]) reclamosPorOC[r.oc_id]=[]; reclamosPorOC[r.oc_id].push(r); }
      for(const r of respD){ if(!respPorOC[r.oc_id]) respPorOC[r.oc_id]=[]; respPorOC[r.oc_id].push(r); }
      for(const r of pvD){ if(!pvPorOC[r.oc_id]) pvPorOC[r.oc_id]=[]; pvPorOC[r.oc_id].push(r); }
      // Fase 4C: foto de Mercado Público (caché: neto, IVA, estado, aceptación, recepción e ítems) en oc.mp.
      const fotos={}; for(const f of (fotosD||[])) if(String(f?.id||"").startsWith(PREFIJO_FOTO_MP)&&f.datos&&!Array.isArray(f.datos)) fotos[String(f.id).slice(PREFIJO_FOTO_MP.length)]=f.datos;
      const ocsConReclamos=ocsD.map(oc=>({...oc,oc_reclamos:reclamosPorOC[oc.id]||[],oc_responsables:respPorOC[oc.id]||[],eventos_postventa:pvPorOC[oc.id]||[],oc_seguimientos:segPorOC[oc.id]||[],mp:fotos[oc.id]||null}));
      setOcs(ocsConReclamos.filter(o=>!o.archivada)); setOcsArchivadas(ocsConReclamos.filter(o=>o.archivada)); setFinanciadores(finD); setVendedores(vendD); setCategoriasGasto(catD);
      setGastos(gastD); setIvaMensual(ivaD); setPagosVendedor(pagVD); setAjustesSaldo(ajuD); setPerfiles(perfD);
      setContactos(contD); setEntidadesCatalogo(entD); setPagoFinSueltos(pagoFinSueltosD);
      ciDisponible.current=Array.isArray(ciD); setContactosInst(Array.isArray(ciD)?ciD:null); setVinculosInst(Array.isArray(ciOcD)?ciOcD:[]);
      setClasificaciones(Array.isArray(tribD)?tribD:null); setCotizacionesClasificadas(Array.isArray(tribCotD)?tribCotD:[]); setNotificaciones(notifD); setHistorialCambios(histD); setAportes(aporD); setUltimaCartola((cartD||[])[0]||null); setSaldoBanco((sbD||[])[0]||null); setBancoMensual(bmD||[]); setDifsHistoricas(difD||[]); setCorreosBfk(correosD||[]);

      // Reintentar completar las OCs que se guardaron antes de ser aceptadas
      const ocsActivasCarga=ocsConReclamos.filter(o=>!o.archivada);
      const faltanDatos=ocsActivasCarga.some(o=>esCodigoMP(o.numero_oc)&&!o.no_en_mp&&(o.sync_pendiente||!o.rut_cliente||!o.fecha_emision_mp||String(o.cliente||"").toUpperCase().includes("POR COMPLETAR")));
      if(faltanDatos){
        sincronizarPendientes(ocsActivasCarga).then(n=>{
          if(n>0){ showToast(`${n} OC${n>1?"s":""} completada${n>1?"s":""} desde Mercado Público`); cargarTodo(); }
        }).catch(()=>{});
      } else if(!revisionAutoHecha.current){
        // Fase 4C: revisión automática y prudente del estado en Mercado Público (una vez por sesión,
        // y como mucho cada 6 horas entre todos los usuarios; ver lib/mercadoPublico.js).
        revisionAutoHecha.current=true;
        revisionAutomaticaMP(ocsActivasCarga,fotos).catch(()=>{});
      }
    } catch(e){ showToast(e.message,"error"); }
  };
  useEffect(()=>{ if(session) cargarTodo(); },[session]);
  // Correos de BFK: se refrescan cada 5 minutos con la app abierta (la sincronización con Gmail corre aparte, cada hora).
  useEffect(()=>{
    if(!session) return;
    const id=setInterval(()=>{ const t=sesionRef.current?.access_token; if(t) cargarCorreosBfk(t,desdeCorreos()).then(setCorreosBfk).catch(()=>{}); },5*60*1000);
    return()=>clearInterval(id);
  },[session?.user?.id]);

  useEffect(()=>{
    if(!session) return;
    const handleVisible=()=>{ if(document.visibilityState==="visible") cargarTodo(); };
    document.addEventListener("visibilitychange",handleVisible);
    return()=>document.removeEventListener("visibilitychange",handleVisible);
  },[session]);


  // ─── HANDLERS ─────────────────────────────────
  const handleIngresarCompra=async(data)=>{
    const t=session.access_token; let ocId=data.ocId;
    // Venta propia solo si hay vendedor (misma regla de deuda que la compra rápida: no suma deuda al financiador).
    const ventaPropiaNueva=!!(data.esNueva&&data.vendedorId&&data.ventaPropia);
    if(data.esNueva){
      // Código repetido: misma clave normalizada que el índice único de la base, entre activas y archivadas.
      const dup=buscarDuplicadoOC(data.numNueva);
      if(dup) throw new Error(mensajeDuplicado(dup));
      let nOc;
      try{
        nOc=await ins("ordenes_compra_v2",t,{id:genId("ocv2"),numero_oc:data.numNueva,cliente:data.cliente,rut_cliente:data.rutCliente||"",correo_cliente:data.correo||"",entidad:data.entidad||"",comuna:data.comuna||"",contacto:data.contacto||"",vendedor_id:data.vendedorId||null,es_venta_propia:ventaPropiaNueva,fecha_emision_mp:data.fechaOC||null,financiador_id:data.financiadorId,monto_total:data.montoVenta,creado_por:session.user.id});
      }catch(e){
        if(esErrorDuplicado(e)) throw new Error(`La OC ${data.numNueva} ya existe en la base (otra persona pudo cargarla recién). Búsquela en Compras.`);
        throw e;
      }
      ocId=(Array.isArray(nOc)?nOc[0]:nOc).id;
      await registrarCambio(t,{ocId,ocNumero:data.numNueva,usuarioId:perfil?.id,usuarioNombre:perfil?.nombre,
        accion:"OC creada (ingreso manual)",campo:"numero_oc",valorNuevo:data.numNueva});
      if(data.productos?.length){
        // 15/10/2026: el origen se indica SIEMPRE (la columna toma «compra» por defecto). Cada producto de una OC
        // ingresada a mano queda como lo VENDIDO (origen venta, con su precio de venta) y como lo COMPRADO
        // (origen compra, con su precio de compra y el enlace del proveedor). Los montos de la compra siguen
        // viniendo del evento de compra, no de estas líneas.
        const n=data.productos.length;
        for(let i=0;i<n;i++){
          const p=data.productos[i]; const cant=Number(p.cantidad)||1;
          await ins("oc_productos_link",t,{id:genId("lnk"),oc_id:ocId,descripcion:p.descripcion,url:"sin-link",orden:i,origen:"venta",
            cantidad:cant,precio_compra:null,precio_venta:Math.round((Number(p.precioVenta)||0)*cant)||null,creado_por:session.user.id});
          await ins("oc_productos_link",t,{id:genId("lnk"),oc_id:ocId,descripcion:p.descripcion,url:p.url||"sin-link",orden:n+i,origen:"compra",
            cantidad:cant,precio_compra:Math.round((Number(p.precioCompra)||0)*cant)||null,precio_venta:null,creado_por:session.user.id});
        }
      }
      if(data.rutCliente?.trim()){
        try{
          await alimentarCatalogoDesdeOC({catalogo:entidadesCatalogo,token:t,usuarioId:session.user.id,rut:data.rutCliente,
            datos:{nombre_entidad:data.entidad||data.cliente||"",comuna:data.comuna||"",contacto:data.contacto||"",correo:data.correo||""}});
        }catch{}
        const avisoCI=await conciliarContactos(t,ocId,"oc");
        if(avisoCI) setTimeout(()=>showToast(avisoCI,"error"),3200);
      }
    } else {
      // OC existente: el monto adjudicado (monto_total) y los datos del cliente NO se
      // modifican. Se agregan los productos (desglose) y el registro de la compra se
      // delega en handleCompraRapida, para que haya una sola lógica: evento de compra,
      // costo, financiador, saldo del financiador e historial "Compra registrada".
      // Lo comprado se guarda como productos «compra» (14/10/2026): nunca como líneas de venta, para no duplicar
      // lo vendido ni tocar su información original (que viene de Mercado Público). Sin precio de venta.
      if(data.productos?.length){
        const existentes=(ocs.find(o=>o.id===ocId)?.oc_productos_link||[]).length;
        for(let i=0;i<data.productos.length;i++){
          const p=data.productos[i];
          await ins("oc_productos_link",t,{id:genId("lnk"),oc_id:ocId,descripcion:p.descripcion,url:p.url||"sin-link",orden:existentes+i,
            origen:"compra",cantidad:p.cantidad||null,precio_compra:Math.round((Number(p.precioCompra)||0)*(Number(p.cantidad)||1))||null,precio_venta:null,creado_por:session.user.id});
        }
      }
      await handleCompraRapida({ocId,costoCompra:data.costoCompra,fecha:data.fecha,fechaEst:data.fechaEst,financiadorId:data.financiadorId,proveedor:data.proveedor});
      return;
    }
    // Compra (Fase 4B): una sola operación en la base; el costo de la OC y la deuda los calcula la base.
    // Si fallara, la OC queda creada sin compra (sin deuda) y la compra se puede registrar después.
    try{
      await registrarCompraOC(t,{ocId,fecha:data.fecha,costo:data.costoCompra,financiadorId:data.financiadorId,
        proveedor:data.proveedor,fechaEntregaEstimada:data.fechaEst,montoVenta:data.montoVenta});
    }catch(e){
      showToast(`OC creada, pero la compra no se registró: ${e.message}`,"error"); setAccion(null); await cargarTodo(); return;
    }
    showToast("OC creada correctamente"); setAccion(null); await cargarTodo();
  };
  // ─── SEGUIMIENTO ESPECIAL (15/10/2026) ───────────
  // Tabla oc_seguimientos (la base fija autor y fechas, exige solución para resolver y protege lo resuelto).
  // Cada cambio queda además en historial_cambios. El sobrecosto estimado es solo informativo: no toca compras,
  // costos, utilidad ni deuda.
  const handleCrearSeguimiento=async(ocId,d)=>{
    const t=session.access_token; const oc=ocs.find(o=>o.id===ocId);
    const fila={id:genId("seg"),oc_id:ocId,categoria:d.categoria,descripcion:d.descripcion.trim(),prioridad:d.prioridad,estado:d.estado||"pendiente",
      responsable_id:d.responsable_id||null,responsable_nombre:d.responsable_nombre||null,fecha_revision:d.fecha_revision||null,
      sobrecosto_estimado:d.sobrecosto_estimado===""||d.sobrecosto_estimado==null?null:Math.round(Number(d.sobrecosto_estimado))};
    await ins("oc_seguimientos",t,fila);
    await registrarCambio(t,{ocId,ocNumero:oc?.numero_oc,usuarioId:perfil?.id,usuarioNombre:perfil?.nombre,accion:`Seguimiento especial creado (${etiquetaSeguimiento(fila)} · prioridad ${etiquetaPrioridad(d.prioridad)})`,
      campo:`seguimiento:${fila.id}`,valorNuevo:fila.descripcion.replace(/\n?⟦subsanacion[^⟧]*⟧\s*$/,"").slice(0,300)}).catch(()=>{});
    showToast("Seguimiento registrado"); await cargarTodo();
  };
  // patch: campos a cambiar; avance: texto opcional de avance (solo historial).
  const handleActualizarSeguimiento=async(ocId,seg,patch,avance)=>{
    const t=session.access_token; const oc=ocs.find(o=>o.id===ocId);
    const cambios=Object.entries(patch||{}).filter(([k,v])=>String(seg[k]??"")!==String(v??""));
    if(!cambios.length&&!String(avance||"").trim()){ showToast("Sin cambios"); return; }
    if(cambios.length) await upd("oc_seguimientos",t,seg.id,Object.fromEntries(cambios));
    const nombre={prioridad:"prioridad",estado:"estado",responsable_nombre:"responsable",descripcion:"descripción",fecha_revision:"fecha de revisión",sobrecosto_estimado:"sobrecosto estimado",solucion:"solución",categoria:"tipo"};
    const fmtV=(k,v)=>k==="prioridad"?etiquetaPrioridad(v):k==="estado"?etiquetaEstado(v):k==="categoria"?etiquetaCategoria(v):k==="sobrecosto_estimado"?(v==null||v===""?"—":fmt.money(v)):(v==null||v===""?"—":String(v));
    for(const [k,v] of cambios){ if(k==="responsable_id") continue;
      await registrarCambio(t,{ocId,ocNumero:oc?.numero_oc,usuarioId:perfil?.id,usuarioNombre:perfil?.nombre,
        accion:k==="estado"&&v==="resuelto"?"Seguimiento especial resuelto":`Seguimiento especial: ${nombre[k]||k} cambiado`,campo:`seguimiento:${seg.id}`,
        valorAnterior:fmtV(k,seg[k]).slice(0,300),valorNuevo:fmtV(k,v).slice(0,300)}).catch(()=>{}); }
    if(String(avance||"").trim()) await registrarCambio(t,{ocId,ocNumero:oc?.numero_oc,usuarioId:perfil?.id,usuarioNombre:perfil?.nombre,
      accion:`Seguimiento especial: avance (${etiquetaSeguimiento(seg)})`,campo:`seguimiento:${seg.id}`,valorNuevo:String(avance).trim().slice(0,500)}).catch(()=>{});
    showToast(patch?.estado==="resuelto"?"Seguimiento resuelto (queda en el historial)":"Seguimiento actualizado"); await cargarTodo();
  };
  const handleEliminarSeguimiento=async(ocId,seg)=>{
    const t=session.access_token; const oc=ocs.find(o=>o.id===ocId);
    if(perfil?.rol!=="admin") throw new Error("Solo un administrador puede eliminar un seguimiento");
    await delConfirmado("oc_seguimientos",t,seg.id);
    await registrarCambio(t,{ocId,ocNumero:oc?.numero_oc,usuarioId:perfil?.id,usuarioNombre:perfil?.nombre,accion:"Seguimiento especial eliminado (administrador)",campo:`seguimiento:${seg.id}`,valorAnterior:String(seg.descripcion||"").slice(0,300)}).catch(()=>{});
    showToast("Seguimiento eliminado"); await cargarTodo();
  };

  // ─── COMPRA DESDE LA COTIZACIÓN ADJUDICADA (15/10/2026) ───────────
  // Solo lectura de cotizaciones (nunca se modifican). Cada pedido (un proveedor) es UNA compra con la función de
  // siempre (evento, costo y deuda del financiador). Antes de registrarlo se revisa si su marca «Pedido <id>-<n>» ya
  // existe en las compras de la OC: un reintento o un doble toque no crea una segunda compra ni una segunda deuda.
  // Lo comprado se guarda como productos «compra» con id fijo (un reintento no duplica filas).
  const buscarCotizacionOC=(numero)=>buscarCotizacionesDeOC(session.access_token,numero);
  const cargarCotizacionOC=(id)=>cargarCotizacionLectura(session.access_token,id);
  const handleCompraDesdeCotizacion=async({ocId,pedido,grupos,fecha,fechaEst,financiadorId,codigoCotizacion})=>{
    const t=session.access_token; const oc=ocs.find(o=>o.id===ocId);
    let registrados=0, omitidos=0;
    for(const g of grupos){
      const marca=marcaPedido(pedido,g.n);
      const previas=await sel("eventos_compra",t,`&oc_id=eq.${encodeURIComponent(ocId)}`);
      const yaEsta=previas.some(e=>String(e.notas||"").includes(marca));
      if(!yaEsta){
        const tieneCompras=previas.length>0;
        await registrarCompraOC(t,{ocId,fecha,costo:g.costo,financiadorId:tieneCompras?(oc?.financiador_id||null):financiadorId,
          proveedor:g.proveedor,fechaEntregaEstimada:fechaEst||null,montoVenta:oc?.monto_total||0,
          notas:`${marca} · desde cotización ${codigoCotizacion}`});
        registrados++;
      } else omitidos++;
      const existentes=(oc?.oc_productos_link||[]).length;
      const filas=[
        ...g.filas.map((f,k)=>({id:idFilaCompra(pedido,g.n,f.itemKey,k),descripcion:[f.producto,f.marca,f.modelo].filter(Boolean).join(" · "),
          cantidad:Number(f.cantidad),precio_compra:Math.round(Number(f.unitario)*Number(f.cantidad)),url:String(f.enlace||"").trim()||"sin-link",
          direccion_entrega:String(f.direccion||"").trim()||null})),
        ...g.despachos.filter(d=>d.real>0).map(d=>({id:idFilaDespacho(pedido,g.n,d.envioKey||(d.adicional?"extra":"")),descripcion:`Despacho · ${g.proveedor||"proveedor"}`,
          cantidad:1,precio_compra:d.real,url:"sin-link",direccion_entrega:null})),
      ];
      for(let k=0;k<filas.length;k++){
        try{ await ins("oc_productos_link",t,{...filas[k],oc_id:ocId,orden:existentes+k,origen:"compra",precio_venta:null,creado_por:session.user.id}); }
        catch(e){ if(!/duplicate|23505|409/i.test(String(e?.message||""))) throw e; }   // ya guardada en un intento anterior
      }
    }
    await registrarCambio(t,{ocId,ocNumero:oc?.numero_oc,usuarioId:perfil?.id,usuarioNombre:perfil?.nombre,
      accion:`Compra registrada desde cotización ${codigoCotizacion} (pedido ${pedido}: ${grupos.length} proveedor${grupos.length===1?"":"es"})`,campo:"compra",valorNuevo:grupos.map(g=>g.proveedor).join(", ")}).catch(()=>{});
    showToast(omitidos&&!registrados?"Esta compra ya estaba registrada: no se duplicó":"Compra registrada desde la cotización"); setAccion(null); await cargarTodo();
  };

  // «Corregir compra» (15/10/2026): corrige la MISMA compra (editar_compra_oc valida y recalcula costo y deuda; no deja el
  // costo bajo lo pagado al financiador) y después sus productos. Lo comercial no mueve dinero. Pagos y devoluciones FIFO
  // no se tocan. Reintentar es seguro: el costo se fija a un valor final, no se suma.
  const handleCorregirCompra=async({ocId,evento,plan,proveedor,fechaEntrega,motivo,clave})=>{
    const t=session.access_token; const oc=ocs.find(o=>o.id===ocId);
    if(plan.financiero&&perfil?.rol!=="admin") throw new Error("Solo un administrador puede corregir cantidades, precios o despacho de una compra confirmada");
    if(plan.cambiaEvento){
      await editarCompraOC(t,{eventoId:evento.id,fecha:evento.fecha,costo:plan.financiero?plan.costoNuevo:evento.costo_compra,montoVenta:null,
        fechaEntregaEstimada:fechaEntrega||null,proveedor:proveedor||null});
    }
    for(const c of plan.cambiosFilas) await upd("oc_productos_link",t,c.id,c.patch);
    await registrarCambio(t,{ocId,ocNumero:oc?.numero_oc,usuarioId:perfil?.id,usuarioNombre:perfil?.nombre,
      accion:`Compra corregida (Pedido ${clave})${plan.financiero?"":" · sin cambio de dinero"}${motivo?` · motivo: ${motivo}`:""}`,campo:"compra",
      valorAnterior:plan.financiero?fmt.money(evento.costo_compra):null,valorNuevo:[plan.financiero?fmt.money(plan.costoNuevo):null,...plan.detalle].filter(Boolean).join(" · ").slice(0,500)}).catch(()=>{});
    showToast(plan.financiero?"Compra corregida · costo y deuda recalculados":"Datos de la compra actualizados (sin cambio de dinero)"); await cargarTodo();
  };
  const handleAnularCompra=async({ocId,evento,filas,motivo,clave})=>{
    const t=session.access_token; const oc=ocs.find(o=>o.id===ocId);
    if(perfil?.rol!=="admin") throw new Error("Solo un administrador puede anular una compra");
    await eliminarCompraOC(t,evento.id);   // la base valida (pagos al financiador, bloqueos) y recalcula costo y deuda
    // Sus productos se eliminan después; si alguno fallara, queda sin compra asociada y ya no cuenta como comprado.
    let fallidos=0; for(const id of filas){ try{ await delConfirmado("oc_productos_link",t,id); }catch{ fallidos++; } }
    await registrarCambio(t,{ocId,ocNumero:oc?.numero_oc,usuarioId:perfil?.id,usuarioNombre:perfil?.nombre,
      accion:`Compra anulada (Pedido ${clave}) · motivo: ${motivo}`,campo:"compra",valorAnterior:fmt.money(evento.costo_compra),valorNuevo:"anulada"}).catch(()=>{});
    showToast(fallidos?`Compra anulada; ${fallidos} producto(s) no se pudieron quitar y quedaron sin compra asociada`:"Compra anulada · costo y deuda recalculados",fallidos?"error":"success"); await cargarTodo();
  };

  // ─── NUEVA OC RÁPIDA (datos desde Mercado Público) ───────────
  const handleNuevaOCRapida=async({pendienteSync, oc, links, direccion_entrega, correo_cliente, vendedorId: vendedorIdElegido, ventaPropia, silencioso=false})=>{
    const t=session.access_token;
    const numero=oc.numero_oc;

    // No permitir duplicados (misma clave normalizada que el índice único de la base)
    const yaExiste=buscarDuplicadoOC(numero);
    if(yaExiste) throw new Error(mensajeDuplicado(yaExiste));

    // Vendedor: el que se eligió en el formulario. Antes se usaba siempre
    // el del perfil que está logueado creando la OC — eso hacía que
    // cargas masivas quedaran mal atribuidas a quien estuviera con la
    // sesión abierta, sin importar quién hizo la venta de verdad.
    const vendedorId = vendedorIdElegido!==undefined ? (vendedorIdElegido||null) : (perfil?.vendedor_id || null);
    // Venta propia solo tiene sentido con vendedor (evita marcarla sin vendedor por un descuido del formulario).
    const esVentaPropia = !!(vendedorId && ventaPropia);

    const fila = pendienteSync
      ? { id:genId("ocv2"), numero_oc:numero, cliente:"POR COMPLETAR",
          vendedor_id:vendedorId, es_venta_propia:esVentaPropia, sync_pendiente:true,
          estado_compra:"pendiente", creado_por:session.user.id }
      : { id:genId("ocv2"), numero_oc:numero,
          cliente:oc.cliente||"", entidad:oc.entidad||"", rut_cliente:oc.rut_cliente||"",
          comuna:oc.comuna||"", contacto:oc.contacto||"", correo_cliente:correo_cliente||"",
          monto_total:oc.monto_total||0, vendedor_id:vendedorId, es_venta_propia:esVentaPropia,
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
      if(esErrorDuplicado(e))
        throw new Error(`La OC ${numero} ya la cargó alguien más justo ahora`);
      throw e;
    }
    const ocId=(Array.isArray(nueva)?nueva[0]:nueva).id;

    await registrarCambio(t,{ocId,ocNumero:numero,usuarioId:perfil?.id,
      usuarioNombre:perfil?.nombre,accion:"OC creada",campo:"numero_oc",valorNuevo:numero});

    // Productos: uno por cada ítem de la OC, con su link
    const productos = (oc.productos||[]);
    if(productos.length){
      // Fase 4C: ítems estructurados (descripción, cantidad, total de la línea y categoría), como lo vendido.
      for(let i=0;i<productos.length;i++){
        await ins("oc_productos_link",t,{id:genId("lnk"),oc_id:ocId,...lineaVentaDesdeMP(productos[i],i),
          url:links[i]||links[0]||"sin-link",creado_por:session.user.id});
      }
      await guardarFotoMP(ocId,oc);
    } else {
      // OC pendiente de sincronizar: guardamos solo los links
      for(let i=0;i<links.length;i++){
        // Marcador de un producto VENDIDO (origen venta explícito, 15/10/2026): al sincronizar con Mercado Público
        // se completa en la misma línea en vez de agregar otra.
        await ins("oc_productos_link",t,{id:genId("lnk"),oc_id:ocId,
          descripcion:"Producto por completar",url:links[i],orden:i,origen:"venta",creado_por:session.user.id});
      }
    }

    // Guardar/actualizar el catálogo de entidades para autocompletar la próxima vez
    if(!pendienteSync && oc.rut_cliente){
      try{
        await alimentarCatalogoDesdeOC({catalogo:entidadesCatalogo,token:t,usuarioId:session.user.id,rut:oc.rut_cliente,
          datos:{nombre_entidad:oc.cliente||"",comuna:oc.comuna||"",contacto:oc.contacto||"",correo:correo_cliente||""}});
      }catch{}
      const avisoCI=await conciliarContactos(t,ocId,"mp",oc.cargo_contacto);
      if(avisoCI&&!silencioso) setTimeout(()=>showToast(avisoCI,"error"),3200);
    }

    if(silencioso) return ocId;   // carga masiva: avisa y recarga una sola vez al final
    showToast(pendienteSync
      ? `OC ${numero} guardada — se completará sola cuando esté disponible en Mercado Público`
      : `OC ${numero} creada con datos de Mercado Público`);
    setAccion(null);
    await cargarTodo();
  };

  // ─── SINCRONIZAR CON MERCADO PÚBLICO ─────────────────────────
  // Completa dos tipos de OC:
  //  · las guardadas antes de ser aceptadas (sync_pendiente)
  //  · las históricas que quedaron sin datos de cliente
  // Nunca pisa un dato que ya tenga contenido: solo rellena vacíos.
  // Los códigos de Mercado Público tienen forma 1234-567-AG26 (esCodigoMP, lib/ocs.js).
  // Todo lo demás (ventas directas, otras plataformas) no existe allá.
  // Duplicados: misma clave normalizada que el índice único de la base, entre activas y archivadas.
  const buscarDuplicadoOC=(codigo,excluirId=null)=>buscarOCPorCodigo(codigo,[ocs,ocsArchivadas],excluirId);

  // Foto de Mercado Público de una OC (caché en mp_cache_avisos, id "oc_mp:<id>"). Si falla, no afecta la OC.
  const guardarFotoMP=async(ocId,d)=>{
    const foto=fotoMP(d); if(!foto||!session) return null;
    const t=session.access_token, id=claveFotoMP(ocId), iso=new Date().toISOString();
    try{
      const act=await upd("mp_cache_avisos",t,id,{datos:foto,actualizado_en:iso}).catch(()=>[]);
      if(!Array.isArray(act)||!act.length) await ins("mp_cache_avisos",t,{id,datos:foto,actualizado_en:iso}).catch(()=>{});
    }catch{}
    return foto;
  };

  // Productos vendidos desde Mercado Público: completa solo lo vacío y agrega lo que falta (lib/mercadoPublico.js).
  const aplicarProductosMP=async(oc,productos)=>{
    const t=session.access_token;
    const {actualizar,insertar}=planProductosVenta(oc.oc_productos_link||[],productos||[]);
    for(const a of actualizar) await upd("oc_productos_link",t,a.id,a.patch);
    for(const fila of insertar) await ins("oc_productos_link",t,{id:genId("lnk"),oc_id:oc.id,...fila,url:"sin-link",creado_por:session.user.id});
  };

  // ─── Revisión automática del estado en Mercado Público (Fase 4C) ───
  // Prudente: una marca compartida en la base (mp_cache_avisos "revision_auto") evita que cada usuario
  // o cada recarga repita consultas; se revisan pocas OCs por vez, solo las abiertas cuyo estado puede
  // cambiar y que no se revisaron en los últimos días; nunca cerca del tope diario de Mercado Público.
  const revisionAutomaticaMP=async(listaOcs,fotos)=>{
    if(!session) return;
    const t=session.access_token, ahora=new Date();
    const marca=(await sel("mp_cache_avisos",t,`&id=eq.${CLAVE_REVISION_AUTO}`).catch(()=>[]))[0];
    if(!toca(marca?.datos?.ultima,ahora)) return;
    const uso=(await sel("mp_uso_diario",t,`&id=eq.${hoyISO()}`).catch(()=>[]))[0];
    if((uso?.solicitudes||0)>LIMITE_USO_DIARIO) return;
    const elegidas=elegirRevisionAutomatica(listaOcs,fotos,ahora);
    // Se toma la marca ANTES de consultar: otro dispositivo que abra la app ahora no repite la revisión.
    const datosMarca={ultima:ahora.toISOString(),revisadas:elegidas.length};
    const act=await upd("mp_cache_avisos",t,CLAVE_REVISION_AUTO,{datos:datosMarca,actualizado_en:ahora.toISOString()}).catch(()=>[]);
    if(!Array.isArray(act)||!act.length) await ins("mp_cache_avisos",t,{id:CLAVE_REVISION_AUTO,datos:datosMarca,actualizado_en:ahora.toISOString()}).catch(()=>{});
    if(!elegidas.length) return;
    const canceladasNuevas=[];
    for(const oc of elegidas){
      try{
        const r=await fetch(`/api/oc?codigo=${encodeURIComponent(oc.numero_oc)}`);
        if(r.status===429) break;   // límite por minuto: se deja para la próxima revisión
        const j=await r.json().catch(()=>null);
        const res=resultadoConsultaMP(r.status,j);
        if(res.tipo!=="ok") continue;
        const foto=await guardarFotoMP(oc.id,res.oc);
        if(mpCancelada(foto)) canceladasNuevas.push({id:oc.id,numero_oc:oc.numero_oc,cliente:oc.cliente,nombre:res.oc.nombre_oc});
      }catch{ /* esta OC queda para la próxima revisión */ }
      await new Promise(res=>setTimeout(res,300));
    }
    registrarUsoMP(elegidas.length);
    if(canceladasNuevas.length){
      const lista=[...canceladasEnMP.filter(c=>!canceladasNuevas.some(n=>n.id===c.id)),...canceladasNuevas];
      setCanceladasEnMP(lista); guardarCacheMP("canceladas",lista);
      showToast(`${canceladasNuevas.length} OC cancelada${canceladasNuevas.length>1?"s":""} en Mercado Público: revísala${canceladasNuevas.length>1?"s":""} en el Panel`,"error");
    }
    await cargarTodo();
  };

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
          // 404: Mercado Público respondió que no tiene esa OC (código inexistente o aún no publicada).
          // Se marca para dejar de reintentarla en cada carga. Otros errores (MP caído) no marcan nada.
          if(r.status===404&&!oc.sync_pendiente){
            try{ await upd("ordenes_compra_v2",t,oc.id,{sync_pendiente:false,no_en_mp:true}); }catch{}
          }
          continue;
        }
        const j=await r.json();
        if(!j.ok||!j.oc) continue;
        const d=j.oc;

        // Solo se rellena lo vacío; la fecha de emisión siempre viene de Mercado Público (lib/mercadoPublico.js).
        await upd("ordenes_compra_v2",t,oc.id,cambiosOCDesdeMP(oc,d));
        // Fase 4A: la fecha real de compra (evento de compra) es otro dato y Mercado Público nunca la reemplaza.
        // Productos vendidos: solo se completan campos vacíos; los comprados (origen compra) nunca se tocan.
        await aplicarProductosMP(oc,d.productos);
        await guardarFotoMP(oc.id,d);

        // Alimentar el catálogo de entidades
        if(d.rut_cliente){
          try{
            await alimentarCatalogoDesdeOC({catalogo:entidadesCatalogo,token:t,usuarioId:session.user.id,rut:d.rut_cliente,
              datos:{nombre_entidad:d.cliente||"",comuna:d.comuna||"",contacto:d.contacto||"",correo:oc.correo_cliente||d.correo_cliente||""}});
          }catch{}
          await conciliarContactos(t,oc.id,"mp",d.cargo_contacto);   // los pendientes quedan visibles en la ficha
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
      ? `${ok} completadas · ${fallaron} no están en Mercado Público o no hubo respuesta`
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
      ? `${ok} fechas de OC revisadas · ${fallaron} sin respuesta de Mercado Público`
      : `${ok} fechas de OC revisadas contra Mercado Público (la fecha de compra no se modifica)`);
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
    if(perfil?.rol!=="admin"){ showToast("Solo un administrador puede eliminar","error"); return; }
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

  // Fase 4C: un abono puede cubrir una factura, varias del mismo RUT o ser parcial; todos los cobros
  // de la cartola se insertan en UNA sola solicitud (todo o nada). Los depósitos de vale vista ya
  // registrados solo se marcan como cobrados en el banco (no se duplica el cobro).
  const handleCobrosDesdeCartola=async(cobros,infoCartola,valeVistas=[],marca=null)=>{
    const t=session.access_token;
    if(cobros.length&&marca?.marca){
      // Desde la cartola: la base registra el abono una sola vez (marca del movimiento) o lo vincula a un cobro manual.
      await rpcCartola(t,"registrar_movimiento_cartola",{p_marca:marca.marca,p_tipo:"cobro",p_vincular:marca.vincular||null,p_confirmo_distinto:!!marca.confirmoDistinto,
        p_filas:marca.vincular?null:cobros.map(c=>({id:genId("evp"),oc_id:c.ocId,fecha:c.fecha,monto:c.monto,notas:`Desde cartola: ${String(c.descripcion||"").slice(0,120)}`,creado_por:session.user.id}))});
      if(!marca.vincular) for(const c of cobros){
        const oc=ocs.find(o=>o.id===c.ocId);
        await registrarCambio(t,{ocId:c.ocId,ocNumero:c.numeroOc,usuarioId:perfil?.id,usuarioNombre:perfil?.nombre,
          accion:c.parcial?"Abono parcial registrado desde la cartola del banco":c.tipo==="varias"?"Cobro registrado desde la cartola (un abono para varias facturas)":"Cobro registrado desde la cartola del banco",
          campo:"monto_cobrado",valorAnterior:fmt.money(oc?.monto_cobrado||0),valorNuevo:`+${fmt.money(c.monto)}`}).catch(()=>{});
      }
    } else if(cobros.length){
      // El cobrado y su estado los recalcula la base desde los cobros registrados (Fase 4B).
      await ins("eventos_pago_cliente",t,cobros.map(c=>({id:c.id||genId("evp"),oc_id:c.ocId,fecha:c.fecha,monto:c.monto,
        notas:`Desde cartola: ${String(c.descripcion||"").slice(0,120)}`,creado_por:session.user.id})));
      for(const c of cobros){
        const oc=ocs.find(o=>o.id===c.ocId);
        await registrarCambio(t,{ocId:c.ocId,ocNumero:c.numeroOc,usuarioId:perfil?.id,usuarioNombre:perfil?.nombre,
          accion:c.parcial?"Abono parcial registrado desde la cartola del banco":c.tipo==="varias"?"Cobro registrado desde la cartola (un abono para varias facturas)":"Cobro registrado desde la cartola del banco",
          campo:"monto_cobrado",valorAnterior:fmt.money(oc?.monto_cobrado||0),valorNuevo:`+${fmt.money(c.monto)}`}).catch(()=>{});
      }
    }
    for(const v of valeVistas){
      await upd("eventos_pago_cliente",t,v.eventoId,{cobrado_en_banco:true});
      await registrarCambio(t,{ocId:v.ocId,ocNumero:v.numeroOc,usuarioId:perfil?.id,usuarioNombre:perfil?.nombre,
        accion:"Vale vista/cheque cobrado en el banco (cartola)",campo:"cobrado_en_banco",valorAnterior:"no",valorNuevo:`sí · ${fmt.date(v.fecha)}`}).catch(()=>{});
    }
    const total=cobros.reduce((s,c)=>s+c.monto,0);
    await registrarCartola(infoCartola,{cobros:cobros.length});
    showToast(cobros.length||valeVistas.length
      ? [cobros.length&&`${cobros.length} cobro${cobros.length!==1?"s":""} registrado${cobros.length!==1?"s":""} · ${fmt.money(total)}`,
         valeVistas.length&&`${valeVistas.length} vale vista${valeVistas.length!==1?"s":""} cobrado${valeVistas.length!==1?"s":""} en el banco`].filter(Boolean).join(" · ")
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
      const norm=normalizarCodigoOC;   // misma clave que el índice único de la base (lib/ocs.js)
      const cargadas=new Set([...ocs,...ocsArchivadas].map(o=>norm(o.numero_oc)));
      const filtradas=(j.ocs||[]).filter(o=>!cargadas.has(norm(o.numero_oc)));
      setPorAceptar(filtradas);
      guardarCacheMP("porAceptar",filtradas);
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
      const norm=normalizarCodigoOC;   // misma clave que el índice único de la base (lib/ocs.js)
      const cargadas=new Set([...ocs,...ocsArchivadas].map(o=>norm(o.numero_oc)));
      const filtradas=(j.ocs||[]).filter(o=>!cargadas.has(norm(o.numero_oc)));
      setAceptadasSinCargar(filtradas);
      guardarCacheMP("aceptadas",filtradas);
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
      const norm=normalizarCodigoOC;   // misma clave que el índice único de la base (lib/ocs.js)
      const canceladasMP=new Map();
      for(const o of (j.ocs||[])) if(Number(o.codigo_estado)===9) canceladasMP.set(norm(o.numero_oc),o);
      const encontradas=[];
      for(const oc of ocs){
        if(!esCodigoMP(oc.numero_oc)||oc.no_en_mp) continue;
        const enMP=canceladasMP.get(norm(oc.numero_oc));
        if(enMP) encontradas.push({id:oc.id,numero_oc:oc.numero_oc,cliente:oc.cliente,nombre:enMP.nombre});
      }
      setCanceladasEnMP(encontradas);
      guardarCacheMP("canceladas",encontradas);
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
          await guardarFotoMP(oc.id,j.oc);
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
    guardarCacheMP("canceladas",canceladas);
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
  // Fase 4A: el vendedor es obligatorio (se elige una vez para todo el lote) y se puede indicar
  // venta propia. Las que Mercado Público informe canceladas, o que ya existan, no se cargan.
  const handleCargarTodasAceptadas=async({vendedorId,ventaPropia}={})=>{
    if(!vendedorId){ showToast("Elige el vendedor de estas OCs antes de cargarlas","error"); return; }
    const pendientes=aceptadasSinCargar.filter(a=>!buscarDuplicadoOC(a.numero_oc));   // las ya cargadas no se repiten
    if(!pendientes.length){ showToast("No hay OCs aceptadas por cargar"); return; }
    setCargandoAceptadas({hechas:0,total:pendientes.length});
    let ok=0, canceladas=0, noDisponibles=0, existentes=0, fallas=0;
    for(let i=0;i<pendientes.length;i++){
      const item=pendientes[i];
      try{
        if(buscarDuplicadoOC(item.numero_oc)){ existentes++; }
        else{
          const r=await fetch(`/api/oc?codigo=${encodeURIComponent(item.numero_oc)}`);
          const j=await r.json().catch(()=>null);
          const res=resultadoConsultaMP(r.status,j);
          if(res.tipo==="ok"&&res.estado.tipo==="cancelada") canceladas++;
          else if(res.tipo==="ok"){
            const links=(res.oc.productos||[]).length ? res.oc.productos.map(()=>"sin-link") : ["sin-link"];
            await handleNuevaOCRapida({pendienteSync:false, oc:res.oc, links,
              direccion_entrega:res.oc.direccion||"", correo_cliente:res.oc.correo_cliente||"",
              vendedorId, ventaPropia:!!ventaPropia, silencioso:true});
            ok++;
          }
          else if(res.tipo==="no_disponible") noDisponibles++;
          else fallas++;
        }
      }catch{ fallas++; /* si una falla, seguimos con el resto */ }
      setCargandoAceptadas({hechas:i+1,total:pendientes.length});
    }
    setCargandoAceptadas(null);
    const extra=[canceladas&&`${canceladas} cancelada${canceladas!==1?"s":""} en MP (no se cargaron)`,existentes&&`${existentes} ya existía${existentes!==1?"n":""}`,
      noDisponibles&&`${noDisponibles} no disponible${noDisponibles!==1?"s":""} en MP`,fallas&&`${fallas} sin respuesta`].filter(Boolean).join(" · ");
    const vend=vendedores.find(v=>v.id===vendedorId)?.nombre||"el vendedor elegido";
    showToast(`${ok} OC${ok!==1?"s":""} cargada${ok!==1?"s":""} a nombre de ${vend}${ventaPropia?" (venta propia)":""}${extra?` · ${extra}`:""}`,(canceladas||noDisponibles||fallas)?"error":undefined);
    setAccion(null);
    await cargarTodo();
  };


  // ─── EGRESOS DE LA CARTOLA ───────────────────────────────────
  // Cada cargo del banco se registra según lo que sea: devolución
  // a un financista (con reparto FIFO), pago a vendedor o gasto.
  const handleEgresosDesdeCartola=async(egresos,infoCartola)=>{
    const t=session.access_token;
    let nFin=0,nVen=0,nGas=0;
    const repartidoEnLote=new Map();
    const pagosEnLote=[];

    for(const e of egresos){
      const enBase=!!e.marca;   // desde la cartola: la base registra una sola vez (marca) o vincula un registro manual
      const opBase={p_marca:e.marca,p_vincular:e.vincular||null,p_confirmo_distinto:!!e.confirmoDistinto};
      if(e.tipo==="financiador"){
        // Lo ya repartido dentro de esta misma cartola (el estado de pantalla aún no se recarga)
        // Mismo criterio que el abono manual (Fase 4B); lo ya repartido en este lote se descuenta.
        const pendientes=ocsPendientesFinanciador(ocs,e.destinoId,difsHistoricas)
          .map(o=>({...o,monto_pagado_fin:Number(o.monto_pagado_fin||0)+(repartidoEnLote.get(o.id)||0)}));
        const {reparto}=repartirFIFO(e.monto,pendientes);
        // Una sola operación transaccional: pagos, OC, saldo e historial juntos (FIFO global: OC más antigua primero)
        if(enBase) await rpcCartola(t,"registrar_pago_financiador_cartola",{...opBase,p_financiador_id:e.destinoId,p_fecha:e.fecha,p_monto:Number(e.monto),
          p_asignaciones:reparto.map(r=>({oc_id:r.oc.id,monto:Number(r.asignado)}))});
        else await registrarPagoFinanciador(t,{financiadorId:e.destinoId,fecha:e.fecha,monto:e.monto,origen:"cartola",
          asignaciones:reparto.map(r=>({ocId:r.oc.id,monto:r.asignado}))});
        reparto.forEach(r=>repartidoEnLote.set(r.oc.id,(repartidoEnLote.get(r.oc.id)||0)+r.asignado));
        nFin++;
      }

      if(e.tipo==="vendedor"){
        // Misma función y misma regla de saldo que el pago desde Vendedores.
        // Los pagos ya hechos en este mismo lote se acumulan (el estado de pantalla aún no se recarga).
        const datosPago={userId:session.user.id,id:genId("pv"),vendedorId:e.destinoId,
          monto:e.monto,fecha:e.fecha,mes:e.mesCom,anio:e.anioCom,notas:`Desde cartola: ${e.descripcion}`,referencia:e.operacion||"",
          ocs,ivaMensual,pagosVendedor:[...pagosVendedor,...pagosEnLote]};
        let fila;
        if(enBase){
          // Comisión y apoyo en gestión se calculan igual que hoy; la base los valida y escribe pago + OCs en una transacción.
          const p=prepararPagoVendedor(datosPago); fila=p.fila;
          await rpcCartola(t,"registrar_movimiento_cartola",{...opBase,p_tipo:"vendedor",p_filas:e.vincular?null:[p.fila],p_ocs_vendedor_pagado:e.vincular?[]:p.ocIds});
        } else fila=(await registrarPagoVendedor({ins,upd,token:t,...datosPago})).fila;
        pagosEnLote.push(fila);
        nVen++;
      }

      if(e.tipo==="gasto"){
        const {anio:aG,mes:mG}=anioMesDe(e.fecha);   // sin Date: el día 1 no cae en el mes anterior
        const filaGasto={id:genId("gas"),categoria_id:e.categoriaId,subcategoria:null,monto:e.monto,mes:mG,anio:aG,
          fecha:e.fecha,detalle:`Desde cartola: ${e.descripcion}`,creado_por:session.user.id};
        if(enBase) await rpcCartola(t,"registrar_movimiento_cartola",{...opBase,p_tipo:"gasto",p_filas:e.vincular?null:[filaGasto]});
        else await ins("gastos_indirectos",t,filaGasto);
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

  // Retiro de capital desde la cartola (Etapa 2): es patrimonio, nunca gasto. Medio bancario (pasa por la caja).
  // Retiro de capital desde la cartola: la base lo registra una sola vez (marca del movimiento) o lo vincula a un
  // retiro manual. Nunca actualiza un registro existente.
  const handleRetiroDesdeCartola=async({marca,vincular,confirmoDistinto,socio,monto,fecha,notas})=>{
    await rpcCartola(session.access_token,"registrar_movimiento_cartola",{p_marca:marca,p_tipo:"retiro",p_vincular:vincular||null,p_confirmo_distinto:!!confirmoDistinto,
      p_filas:vincular?null:[{id:genId("ap"),socio,tipo:"retiro",monto,fecha,medio:"Transferencia BancoEstado",notas:notas||null,creado_por:session.user.id}]});
    showToast("Retiro registrado");
    setAccion(null); await cargarTodo();
  };

  // Alerta de posible duplicado (la pone la base): el usuario la quita tras revisar.
  const handleQuitarAlertaCartola=async(tabla,id)=>{
    await rpcCartola(session.access_token,"cartola_quitar_alerta",{p_tabla:tabla,p_id:id});
    showToast("Alerta revisada"); await cargarTodo();
  };

  // Registros actuales de la base para la verificación final de la cartola (no usa el estado de pantalla).
  // Si una lectura falla, lanza el error y NO se registra nada.
  const leerDatosConciliacion=async()=>{
    const t=session.access_token;
    const [ocsD,finD,vendD,gastD,pagVD,pagoFinSueltosD,aporD]=await Promise.all([
      selOCs(t), sel("financiadores",t), sel("vendedores",t), sel("gastos_indirectos",t),
      sel("pagos_vendedor",t), sel("eventos_pago_financiamiento",t,"&oc_id=is.null"), sel("aportes_socios",t),
    ]);
    return {ocs:ocsD,financiadores:finD,vendedores:vendD,gastos:gastD,pagosVendedor:pagVD,pagoFinSueltos:pagoFinSueltosD,aportes:aporD};
  };

  // ─── ABONO A FINANCIADOR con reparto FIFO ────────────────────
  const handleAbonoFinanciador=async({financiadorId,fecha,referencia,montoTotal,sobrante,asignaciones})=>{
    const t=session.access_token;
    // Una sola operación transaccional (si algo falla, no se guarda nada). El resto sin OC lo calcula la base.
    await registrarPagoFinanciador(t,{financiadorId,fecha,monto:montoTotal,origen:"abono",
      asignaciones:asignaciones.map(a=>({ocId:a.ocId,monto:a.monto}))});

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

    // Fase 4B: evento de compra, costo de la OC, deuda del financiador e historial en una sola transacción de la base.
    await registrarCompraOC(t,{ocId,fecha,costo:costoCompra,financiadorId,proveedor,fechaEntregaEstimada:fechaEst,montoVenta:oc?.monto_total||0});
    showToast("Compra registrada"); setAccion(null); await cargarTodo();
  };

  const handleExportarTodo=async()=>{
    if(perfil?.rol!=="admin"){ showToast("Solo el administrador puede exportar"); return; }
    setExportando(true);
    try{
      // Misma función que "Exportar Excel completo" (Administración): solo lee, no escribe nada.
      const {errores}=await exportarExcelRespaldo({sel,token:session.access_token});
      showToast(errores.length?`Excel descargado, pero no se pudo leer: ${errores.map(e=>e.Hoja).join(", ")}`:"Excel descargado");
    }catch(e){ showToast("Error al exportar: "+e.message); }
    finally{ setExportando(false); }
  };

  const handleEntrega=async(data)=>{
    const t=session.access_token; const oc=ocs.find(o=>o.id===data.ocId);
    await ins("eventos_entrega",t,{id:genId("eve"),oc_id:data.ocId,fecha:data.fecha,persona_recibe:data.personaRecibe,creado_por:session.user.id});
    await upd("ordenes_compra_v2",t,data.ocId,{estado_entrega:"confirmada"});
    await registrarCambio(t,{ocId:data.ocId,ocNumero:oc?.numero_oc,usuarioId:perfil?.id,
      usuarioNombre:perfil?.nombre,accion:"Entrega confirmada",campo:"estado_entrega",valorNuevo:data.personaRecibe||"confirmada"});
    showToast("Entrega confirmada"); setAccion(null); await cargarTodo();
  };
  const handleFactura=async(data)=>{
    const t=session.access_token; const oc=ocs.find(o=>o.id===data.ocId);
    // Fase 3 exentas: mismas reglas que el formulario. El tipo lo fija la clasificación APROBADA de la OC
    // (exenta → DTE 34 con monto exento e IVA $0; afecta o histórica → DTE 33, fila idéntica a la de siempre).
    if(!oc) throw new Error("OC no encontrada");
    const tipo=tipoFacturaDeOC(oc);
    const v=validarRegistroFactura(oc,{tipoDte:data.tipoDte??33,numero:data.numeroFactura,fecha:data.fecha,monto:data.monto,confirmaEmitida:data.confirmaEmitida}); if(v) throw new Error(v);
    // Lo facturado (solo facturas vigentes) y el estado de cobro los recalcula la base (Fase 4B).
    await ins("eventos_factura",t,{id:genId("evf"),oc_id:data.ocId,fecha:data.fecha,numero_factura:data.numeroFactura,monto:data.monto,nota_credito:data.notaCredito||null,factura_anulada_numero:data.facturaAnuladaNumero||null,motivo_diferencia:data.motivoDiferencia||null,creado_por:session.user.id,
      ...(tipo===34?camposFacturaExenta(oc,data.monto):{})});
    await registrarCambio(t,{ocId:data.ocId,ocNumero:oc?.numero_oc,usuarioId:perfil?.id,
      usuarioNombre:perfil?.nombre,accion:data.esReemision?"Factura reemitida":"Factura registrada",campo:"numero_factura",valorNuevo:`${tipo===34?"DTE 34 ":""}N°${data.numeroFactura} · ${fmt.money(data.monto)}`});
    showToast(data.esReemision?`Factura${tipo===34?" exenta":""} reemitida (anula N°${data.facturaAnuladaNumero} con NC ${data.notaCredito})`:tipo===34?"Factura exenta (DTE 34) registrada":"Factura registrada"); setAccion(null); await cargarTodo();
  };
  // Fase SII: nota de crédito como documento tributario propio (código de referencia 1/2/3).
  // Lo facturado lo recalcula la base con la regla del modelo tributario (una NC código 2 no cambia nada).
  const handleNotaCredito=async(data)=>{
    const t=session.access_token; const oc=ocs.find(o=>o.id===data.ocId);
    await ins("eventos_factura",t,{id:genId("evf"),oc_id:data.ocId,fecha:data.fecha,numero_factura:data.folio,monto:data.monto,
      tipo_dte:61,ref_tipo_dte:data.refTipoDte,ref_folio:data.refFolio,ref_codigo:data.refCodigo,ref_motivo:data.refMotivo,
      rut_receptor:oc?.rut_cliente||null,origen:"manual",creado_por:session.user.id});
    const efecto={1:"anula la factura",2:"corrige texto, sin efecto monetario",3:`corrige montos (${fmt.money(data.monto)})`}[data.refCodigo];
    await registrarCambio(t,{ocId:data.ocId,ocNumero:oc?.numero_oc,usuarioId:perfil?.id,usuarioNombre:perfil?.nombre,
      accion:"Nota de crédito registrada",campo:"documento_tributario",valorNuevo:`NC ${data.folio} → factura ${data.refFolio} · código ${data.refCodigo} · ${efecto}`});
    showToast(`NC ${data.folio} registrada · ${efecto}`); await cargarTodo();
  };
  // Fase 2 exentas: clasificación tributaria (la base valida permisos, respaldo y compatibilidad con los documentos SII).
  const tributario={
    historial:clasificaciones, cotizaciones:cotizacionesClasificadas,
    solicitar:async(p)=>{ await solicitarClasificacion(session.access_token,p); showToast("Solicitud de clasificación tributaria enviada"); await cargarTodo(); },
    resolver:async(id,decision,obs)=>{ await resolverClasificacion(session.access_token,id,decision,obs); showToast(decision==="aprobar"?"Clasificación tributaria aprobada":"Solicitud rechazada"); await cargarTodo(); },
    anular:async(id)=>{ await anularSolicitud(session.access_token,id); showToast("Solicitud anulada"); await cargarTodo(); },
    heredar:async(ocId,proc)=>{ await heredarDeCotizacion(session.access_token,ocId,proc); showToast("Solicitud creada con la clasificación de la cotización (pendiente de aprobación)"); await cargarTodo(); },
    subirRespaldo:(ambito,id,archivo)=>subirRespaldo(session.access_token,ambito,id,archivo),
    abrirRespaldo:(ruta)=>abrirRespaldo(session.access_token,ruta),
  };
  const handlePagoCliente=async(data)=>{
    const t=session.access_token; const oc=ocs.find(o=>o.id===data.ocId);
    await ins("eventos_pago_cliente",t,{id:genId("evp"),oc_id:data.ocId,fecha:data.fecha,monto:data.monto,
      medio_pago:data.medioPago||"transferencia",cobrado_en_banco:data.cobradoEnBanco!==false,institucion:data.institucion||null,
      creado_por:session.user.id});
    await registrarCambio(t,{ocId:data.ocId,ocNumero:oc?.numero_oc,usuarioId:perfil?.id,
      usuarioNombre:perfil?.nombre,accion:"Pago de cliente registrado",campo:"monto_cobrado",valorNuevo:fmt.money(data.monto)});
    showToast("Pago registrado"); setAccion(null); await cargarTodo();
  };
  const handlePagoFin=async(data)=>{
    const t=session.access_token; const oc=data.ocId?ocs.find(o=>o.id===data.ocId):null;
    // Lo que cubre la OC se le asigna; si el pago es mayor, el resto queda como pago sin OC.
    let asignaciones=[];
    if(oc){
      const debe=deudaOC(oc);
      const asig=Math.min(data.monto,debe);
      if(asig>0) asignaciones=[{ocId:oc.id,monto:asig}];
    }
    await registrarPagoFinanciador(t,{financiadorId:data.financiadorId,fecha:data.fecha,monto:data.monto,origen:"pago_oc",asignaciones});
    showToast("Pago a financiador registrado"); setAccion(null); await cargarTodo();
  };
  const handleAjusteSaldo=async({financiadorId,fecha,montoAjuste,motivo})=>{
    const t=session.access_token;
    // El ajuste es dato fuente del saldo: la base lo suma al recalcular la deuda (Fase 4B).
    await ins("ajustes_saldo_financiador",t,{id:genId("ajf"),financiador_id:financiadorId,fecha,monto_ajuste:montoAjuste,motivo,creado_por:session.user.id});
    showToast("Saldo ajustado"); await cargarTodo();
  };
  const handleNuevoGasto=async(data)=>{
    const t=session.access_token;
    await ins("gastos_indirectos",t,{id:genId("gas"),categoria_id:data.categoriaId,subcategoria:data.subcategoria,monto:data.monto,mes:data.mes,anio:data.anio,fecha:data.fecha,detalle:data.detalle,creado_por:session.user.id});
    // El gasto "Impuesto SII" es solo la salida real de caja del período (mes/año).
    // NO escribe en iva_mensual: el IVA determinado (iva_ventas/iva_compras) se
    // registra únicamente desde el flujo de IVA de Vendedores. Así el gasto no puede
    // sumar ni duplicar el IVA que usa la comisión, sin importar el orden de registro.
    showToast("Gasto registrado"); await cargarTodo();
  };
  const handlePagoVendedorSimple=async(data)=>{
    // Una transferencia, dos componentes: comisión (hasta lo pendiente) + extra por gestión (el excedente del mismo período).
    let r;
    try{
      r=await registrarPagoVendedor({ins,upd,token:session.access_token,userId:session.user.id,id:data.id||genId("pv"),
        vendedorId:data.vendedorId,monto:data.monto,fecha:data.fecha,mes:data.mes,anio:data.anio,
        notas:[data.label,data.observacion?.trim(),data.avisoProvisoria].filter(Boolean).join(" · "),referencia:data.referencia,
        ocs,ivaMensual,pagosVendedor});
    }catch(e){
      if(esPagoDuplicado(e)){ showToast("Este pago ya estaba registrado: no se guardó dos veces"); await cargarTodo(); return; }
      throw e;
    }
    const extra=r.extraGestion>0?` · extra por gestión ${fmt.money(r.extraGestion)}`:"";
    showToast(r.completo?`Pago registrado · comisión ${fmt.money(r.pagoComision)}${extra} · período saldado${r.ocIds.length?` · ${r.ocIds.length} OC marcadas como pagadas`:""}`:`Pago parcial registrado · comisión ${fmt.money(r.pagoComision)} · pendiente ${fmt.money(r.pendiente)}`); await cargarTodo();
  };
  const handleAnularPagoVendedor=async(pago,motivo)=>{
    const r=await anularPagoVendedor({upd,token:session.access_token,pago,motivo,ocs,ivaMensual,pagosVendedor});
    showToast(`Pago anulado · queda guardado con su motivo${r.desmarcadas?` · ${r.desmarcadas} OC vuelven a comisión pendiente`:""}`); await cargarTodo();
  };
  // IVA del mes — registro único (lib/ivaUnificado.js): guarda débito/crédito en
  // iva_mensual (comisión) y el pago al SII como gasto "Impuesto SII" (caja).
  const handleGuardarIva=async(data)=>{
    const t=session.access_token;
    const plan=planGuardarIva({data,gastos,ivaMensual});
    if(plan.iva.accion==="actualizar") await upd("iva_mensual",t,plan.iva.id,plan.iva.fila);
    else await ins("iva_mensual",t,{id:genId("iva"),...plan.iva.fila});
    if(plan.gasto.accion==="insertar") await ins("gastos_indirectos",t,{id:genId("gas"),...plan.gasto.fila,creado_por:session.user.id});
    else if(plan.gasto.accion==="actualizar") await upd("gastos_indirectos",t,plan.gasto.id,plan.gasto.fila);
    showToast(plan.aviso?`IVA guardado · ${plan.aviso}`:plan.gasto.accion==="ninguna"?"IVA guardado":"IVA guardado · pago al SII registrado en Gastos");
    await cargarTodo();
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
    // 15/10/2026: una línea de una compra confirmada no se elimina suelta (cambiaría lo comprado sin corregir la compra).
    const prot=l&&filaProtegida(l,oc);
    if(prot){ showToast(`Esta línea pertenece a la compra confirmada (Pedido ${prot.clave}). Usa «Corregir compra».`,"error"); return false; }
    // Fase 4A: el historial y la recarga solo después de confirmar que la base eliminó el producto.
    try{ await delConfirmado("oc_productos_link",t,linkId); }
    catch(e){ showToast(e.message,"error"); await cargarTodo(); return false; }
    if(oc) await registrarCambio(t,{ocId:oc.id,ocNumero:oc.numero_oc,usuarioId:perfil?.id,
      usuarioNombre:perfil?.nombre,accion:"Producto eliminado",campo:"producto",
      valorAnterior:l?.descripcion||""}).catch(()=>{});
    showToast("Producto eliminado"); await cargarTodo(); return true;
  };
  // Valor legible para el historial de productos.
  const valorProducto=(campo,v)=>{
    if(campo==="dirección") return v?String(v):"(la de la OC)";
    if(campo==="link") return v&&v!=="sin-link"?String(v):"(sin link)";
    if(campo==="precio de compra"||campo==="precio de venta") return v===null||v===undefined||v===""?"—":fmt.money(v);
    return v===null||v===undefined||v===""?"—":String(v);
  };
  // Fase 4A: edición PARCIAL. Solo se guardan los campos que vienen y que cambiaron de verdad;
  // los que no vienen (por ejemplo, al repartir la inversión) jamás se borran. El historial
  // registra únicamente los cambios reales.
  const handleEditarLink=async(linkId,campos,oc)=>{
    const t=session.access_token;
    const antes=(oc?.oc_productos_link||[]).find(x=>x.id===linkId)||{};
    const prot=filaProtegida(antes,oc);
    if(prot){ showToast(`Esta línea pertenece a la compra confirmada (Pedido ${prot.clave}). Usa «Corregir compra».`,"error"); return; }
    const {patch,cambios}=cambiosProducto(antes,campos||{});
    if(!Object.keys(patch).length){ showToast("Sin cambios en el producto"); return; }
    if("direccion_entrega" in patch) patch.direccion_entrega=patch.direccion_entrega||null;
    try{ await upd("oc_productos_link",t,linkId,patch); }
    catch(e){ showToast(`No se pudo guardar el producto (${e.message||"error"})`,"error"); return; }
    if(oc){
      for(const c of cambios){
        await registrarCambio(t,{ocId:oc.id,ocNumero:oc.numero_oc,usuarioId:perfil?.id,usuarioNombre:perfil?.nombre,
          accion:c.accion,campo:c.campo,valorAnterior:valorProducto(c.campo,c.anterior),valorNuevo:valorProducto(c.campo,c.nuevo)});
      }
    }
    showToast("Producto actualizado"); await cargarTodo();
  };
  // Repartir la inversión total entre los productos comprados: cambia SOLO el precio de compra
  // de cada línea (cantidad, precio de venta, dirección, link y descripción no se tocan) y deja
  // un único registro en el historial.
  const handleRepartirInversion=async(oc,asignaciones,total)=>{
    const t=session.access_token;
    const lineas=oc?.oc_productos_link||[];
    let n=0;
    try{
      for(const a of (asignaciones||[])){
        const antes=lineas.find(l=>l.id===a.id);
        if(!antes||filaProtegida(antes,oc)||Number(antes.precio_compra)===Number(a.precio_compra)) continue;   // compras confirmadas: no se reparten
        await upd("oc_productos_link",t,a.id,{precio_compra:a.precio_compra});
        n++;
      }
      if(n>0) await registrarCambio(t,{ocId:oc.id,ocNumero:oc.numero_oc,usuarioId:perfil?.id,usuarioNombre:perfil?.nombre,
        accion:`Inversión repartida entre ${(asignaciones||[]).length} productos comprados`,campo:"precio de compra",valorNuevo:`${fmt.money(total)} en total`});
      showToast(n>0?`Inversión repartida · ${n} producto${n!==1?"s":""} actualizado${n!==1?"s":""}`:"Sin cambios: los precios ya estaban así");
    }catch(e){ showToast(`No se pudo terminar el reparto (${e.message||"error"}). Revise los precios de compra.`,"error"); }
    await cargarTodo();
  };

  // ─── Traer fecha y datos reales desde Mercado Público ────────
  const handleSincronizarFecha=async(oc)=>{
    const t=session.access_token;
    try{
      const r=await fetch(`/api/oc?codigo=${encodeURIComponent(oc.numero_oc)}`);
      const j=await r.json().catch(()=>null);
      const res=resultadoConsultaMP(r.status,j);
      if(res.tipo==="no_disponible"){ showToast("Mercado Público no tiene esta OC (código inexistente o aún no publicada). No se cambió nada.","error"); return; }
      if(res.tipo!=="ok"){ showToast(`${res.mensaje} No se cambió nada.`,"error"); return; }
      const d=res.oc;
      // Se prioriza fecha_envio (la que Mercado Público muestra en pantalla
      // junto al código) sobre fecha_creacion (la del proceso interno).
      const fechaHoraMP=d.fecha_envio||d.fecha_creacion||"";
      const fechaMP=String(fechaHoraMP).slice(0,10);

      // Fase 4A: la fecha de la OC vive en fecha_emision_mp. La fecha real de compra
      // (evento de compra) es un dato de BFK y Mercado Público nunca la reemplaza.
      const fechaAntes=String(oc.fecha_emision_mp||"").slice(0,10);
      // Fase 4C: los datos ingresados a mano (cliente, contacto, correo…) no se pisan: solo se completa lo vacío.
      await upd("ordenes_compra_v2",t,oc.id,cambiosOCDesdeMP(oc,d));
      await aplicarProductosMP(oc,d.productos);
      await guardarFotoMP(oc.id,d);
      if(fechaMP&&fechaMP!==fechaAntes){
        await registrarCambio(t,{ocId:oc.id,ocNumero:oc.numero_oc,usuarioId:perfil?.id,
          usuarioNombre:perfil?.nombre,accion:"Fecha de la OC actualizada desde Mercado Público",
          campo:"fecha de la OC",valorAnterior:fechaAntes||"—",valorNuevo:fechaMP});
      }

      const avisoEstado=res.estado.tipo==="cancelada"?" · ⚠ figura CANCELADA en Mercado Público":res.estado.tipo==="sin_aceptar"?" · ⚠ todavía no aceptada en Mercado Público":"";
      showToast(`${fechaMP?`Actualizado · fecha de la OC ${fmt.date(fechaMP)} (la fecha de compra no se modifica)`:"Datos actualizados"}${avisoEstado}`,avisoEstado?"error":undefined);
      await cargarTodo();
    }catch{ showToast("No se pudo consultar Mercado Público","error"); }
  };

  // ─── HANDLERS MULTIUSUARIO ────────────────────
  const handleAsignarResponsable=async(ocId,etapa,usuarioId)=>{
    const t=session.access_token;
    const oc=ocs.find(o=>o.id===ocId);
    const existente=(oc?.oc_responsables||[]).find(r=>r.etapa===etapa);
    if(!usuarioId){
      if(existente){
        try{ await delConfirmado("oc_responsables",t,existente.id); }
        catch(e){ showToast(e.message,"error"); await cargarTodo(); return; }
      }
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
    const lista=oc?.eventos_postventa||[];
    const previo=d.id?lista.find(e=>e.id===d.id):null;
    const fila={oc_id:d.ocId,fecha:d.fecha,tipo:d.tipo,descripcion:d.descripcion,estado:d.estado,
      solucion:d.solucion,fecha_resolucion:d.fecha_resolucion,
      costo_extra:d.costo_extra||0,detalle_costo:d.detalle_costo||null};
    const cerradoAntes=previo?previo.estado==="resuelto":false, cerradoAhora=d.estado==="resuelto";
    // Qué pasó: creado / cerrado / reabierto / editado (solo si hubo cambios reales)
    let accion="Incidente creado", cambios=[];
    if(previo){
      const campos=[["tipo","tipo"],["fecha","fecha del reclamo"],["descripcion","descripción"],["solucion","solución"],["costo_extra","costo extra"],["detalle_costo","detalle del costo"]];
      cambios=campos.filter(([k])=>String(previo[k]??"")!==String(fila[k]??"")).map(([,n])=>n);
      if(!cerradoAntes&&cerradoAhora) accion="Incidente cerrado";
      else if(cerradoAntes&&!cerradoAhora) accion="Incidente reabierto";
      else if(cambios.length) accion="Incidente editado";
      else { showToast("Sin cambios en el incidente"); return; }
    }
    if(d.id) await upd("eventos_postventa",t,d.id,fila);
    else await ins("eventos_postventa",t,{id:genId("pv"),...fila,creado_por:session.user.id});
    // El estado de la OC considera TODOS sus incidentes: queda "resuelta" solo si ninguno sigue abierto.
    const otrosAbiertos=lista.filter(e=>e.id!==d.id&&e.estado!=="resuelto").length;
    await upd("ordenes_compra_v2",t,d.ocId,{estado_postventa:(!cerradoAhora||otrosAbiertos>0)?"con_incidencia":"resuelta"});
    const tipoTxt={falla:"Falla del producto",faltante:"Faltante",cambio:"Cambio / reposición",devolucion:"Devolución",otro:"Otro"}[d.tipo]||d.tipo;
    // Referencia estable (no depende de la numeración visual): tipo + fecha del reclamo, dentro de la OC del registro.
    const ident=`${tipoTxt} · reclamo del ${fmt.date(d.fecha)}`;
    await registrarCambio(t,{ocId:d.ocId,ocNumero:oc?.numero_oc,usuarioId:perfil?.id,usuarioNombre:perfil?.nombre,accion,campo:"incidente",
      valorNuevo:accion==="Incidente editado"?`${ident} (cambió: ${cambios.join(", ")})`:accion==="Incidente cerrado"&&d.solucion?`${ident} · cierre: ${String(d.solucion).slice(0,80)}`:ident});
    showToast(accion==="Incidente cerrado"?"Incidente cerrado":accion==="Incidente reabierto"?"Incidente reabierto":accion==="Incidente editado"?"Incidente actualizado":(Number(d.costo_extra)>0?`Incidente registrado · ${fmt.money(d.costo_extra)} de costo extra`:"Incidente registrado")); await cargarTodo();
  };
  const handleMarcarFecha=async(codigoOC,fecha)=>{
    const t=session.access_token;
    const oc=buscarOCPorCodigo(codigoOC,[ocs]);
    if(!oc) throw new Error(`No se encontró la OC "${codigoOC}"`);
    const evC=(oc.eventos_compra||[])[0];
    // Fase 4A: fijar una fecha NUNCA crea un evento de compra. La entrega estimada vive en la compra:
    // si la OC aún no tiene compra registrada, primero se registra la compra (ahí va la entrega estimada).
    if(!evC) throw new Error(`La OC ${oc.numero_oc} no tiene compra registrada. Registra primero la compra (en Compras › la OC › Registrar compra) e indica ahí la entrega estimada.`);
    await upd("eventos_compra",t,evC.id,{fecha_entrega_estimada:fecha});
    await registrarCambio(t,{ocId:oc.id,ocNumero:oc.numero_oc,usuarioId:perfil?.id,usuarioNombre:perfil?.nombre,
      accion:"Entrega estimada marcada en la Agenda",campo:"entrega estimada",
      valorAnterior:evC.fecha_entrega_estimada?String(evC.fecha_entrega_estimada).slice(0,10):"—",valorNuevo:fecha}).catch(()=>{});
    showToast(`Entrega estimada de ${oc.numero_oc} marcada para ${fmt.date(fecha)}`);
    await cargarTodo();
  };

  // Fase 4A: primero se confirma que la base eliminó el registro; solo entonces se ajustan estados.
  // Fase 4B: compras y pagos al financiador se eliminan con una operación atómica de la base, y en todos
  // los casos los totales (costo, monto pagado, deuda, facturado, cobrado y sus estados) los recalcula la base.
  const handleEliminarEvento=async(tabla, eventoId, ocId, etapaKey)=>{
    const t=session.access_token;
    const oc=ocs.find(o=>o.id===ocId);
    const ev=(oc?.[tabla]||[]).find(e=>e.id===eventoId);
    if(tabla==="eventos_compra"&&esEventoDePedido(ev)){ showToast("Esta compra se registró desde una cotización: anúlala con «Corregir compra» (elimina también sus productos).","error"); return; }

    if(tabla==="eventos_compra"||tabla==="eventos_pago_financiamiento"){
      try{ tabla==="eventos_compra" ? await eliminarCompraOC(t,eventoId) : await eliminarPagoFinanciador(t,eventoId); }
      catch(e){ showToast(e.message,"error"); await cargarTodo(); return false; }
      showToast(tabla==="eventos_compra"?"Compra eliminada · costo y deuda recalculados":"Pago eliminado · monto pagado y deuda recalculados");
      await cargarTodo(); return true;
    }

    try{ await delConfirmado(tabla,t,eventoId); }
    catch(e){ showToast(e.message,"error"); await cargarTodo(); return false; }

    try{
      if(tabla==="eventos_entrega"){
        // Si quedan otras entregas registradas, la OC sigue entregada.
        const quedan=(oc?.eventos_entrega||[]).filter(e=>e.id!==eventoId).length;
        if(!quedan) await upd("ordenes_compra_v2",t,ocId,{estado_entrega:"pendiente"});
      }
      if(tabla==="eventos_postventa"){
        // El estado de post-venta de la OC se recalcula con los incidentes que quedan.
        const restantes=(oc?.eventos_postventa||[]).filter(e=>e.id!==eventoId);
        const estado=!restantes.length?"sin_incidencias":restantes.some(e=>e.estado!=="resuelto")?"con_incidencia":"resuelta";
        await upd("ordenes_compra_v2",t,ocId,{estado_postventa:estado});
      }
      await registrarCambio(t,{ocId,ocNumero:oc?.numero_oc,usuarioId:perfil?.id,
        usuarioNombre:perfil?.nombre,accion:`Eliminó registro de ${etapaKey}`,campo:etapaKey,
        valorAnterior:[ev?.fecha?String(ev.fecha).slice(0,10):null,(ev?.monto??ev?.costo_compra)!=null?fmt.money(ev?.monto??ev?.costo_compra):null].filter(Boolean).join(" · ")||null});
      showToast(tabla==="eventos_pago_cliente"?"Cobro eliminado · cobrado y estado recalculados":"Registro eliminado");
    }catch(e){
      showToast(`El registro se eliminó, pero no se pudo completar la corrección (${e.message||"error"}). Revise la OC.`,"error");
    }
    await cargarTodo(); return true;
  };

  const handleEliminarFactura=async(ocId, facturaId)=>{
    const t=session.access_token;
    const oc=ocs.find(o=>o.id===ocId);
    const ev=(oc?.eventos_factura||[]).find(f=>f.id===facturaId);

    // Fase 4A: solo con el borrado confirmado por la base se corrigen los montos.
    try{ await delConfirmado("eventos_factura",t,facturaId); }
    catch(e){ showToast(e.message,"error"); await cargarTodo(); return false; }

    // Fase 4B: lo facturado (solo facturas vigentes), el estado de la factura y el de cobro los recalcula la base.
    try{
      await registrarCambio(t,{ocId,ocNumero:oc?.numero_oc,usuarioId:perfil?.id,
        usuarioNombre:perfil?.nombre,accion:`Eliminó factura N°${ev?.numero_factura||""}`});
      showToast("Factura eliminada · facturado y cobro recalculados");
    }catch(e){
      showToast(`La factura se eliminó, pero no se pudo registrar en el historial (${e.message||"error"}).`,"error");
    }
    await cargarTodo(); return true;
  };

  // Archivar reemplaza a la eliminación física: no borra eventos, historial ni datos, y no toca saldos.
  // La OC queda fuera de la operación normal y se consulta/restaura desde Administración.
  const handleArchivarOC=async(ocId,motivo)=>{
    const oc=ocs.find(o=>o.id===ocId);
    try{ await rpcArchivarOC(session.access_token,ocId,motivo); }
    catch(e){ showToast("No se pudo archivar: "+(e.message||"error")); return; }
    showToast(`OC ${oc?.numero_oc||""} archivada · puede restaurarla desde Administración`);
    await cargarTodo();
  };
  const handleRestaurarOC=async(ocId)=>{
    const oc=ocsArchivadas.find(o=>o.id===ocId);
    try{ await rpcRestaurarOC(session.access_token,ocId); }
    catch(e){ showToast("No se pudo restaurar: "+(e.message||"error")); return; }
    showToast(`OC ${oc?.numero_oc||""} restaurada`);
    await cargarTodo();
  };

  const handleAgregarComentario=async(ocId,texto)=>{
    const t=session.access_token;
    const oc=ocs.find(o=>o.id===ocId);
    await ins("oc_comentarios",t,{id:genId("cmt"),oc_id:ocId,usuario_id:perfil.id,usuario_nombre:perfil.nombre,texto});
    await registrarCambio(t,{ocId,ocNumero:oc?.numero_oc,usuarioId:perfil.id,usuarioNombre:perfil.nombre,accion:"Comentario agregado"});
    await cargarTodo();
  };
  const handleEliminarComentario=async(comentarioId)=>{
    try{ await delConfirmado("oc_comentarios",session.access_token,comentarioId); showToast("Nota eliminada"); }
    catch(e){ showToast(e.message,"error"); }
    await cargarTodo();
  };
  // Pendiente ⇄ gestionado (solo el estado en BFK; el correo original no se toca).
  const handleMarcarCorreo=async(id,estado)=>{
    try{
      const fila=await rpcMarcarCorreo(session.access_token,id,estado);
      setCorreosBfk(prev=>reemplazarCorreo(prev,fila));
      showToast(estado==="gestionado"?"Correo marcado como gestionado":"Correo pendiente otra vez");
    }catch(e){ showToast(e.message,"error"); }
  };
  const handleMarcarNotificacionesLeidas=async()=>{
    const t=session.access_token;
    const noLeidas=notificaciones.filter(n=>!n.leida);
    await Promise.all(noLeidas.map(n=>upd("notificaciones",t,n.id,{leida:true})));
    setNotificaciones(prev=>prev.map(n=>({...n,leida:true})));
  };

  const handleEntidadesImportadas=async(res)=>{
    showToast(`Entidades importadas: ${res.creadas} nuevas · ${res.actualizadas} actualizadas`);
    await cargarTodo();
  };
  const handleGuardarDatosOC=async(ocId,{numeroOc,resincronizar,cliente,entidad,comuna,contacto,rutCliente,correo,fechaOC,vendedorId,ventaPropia})=>{
    const t=session.access_token;
    const oc=ocs.find(o=>o.id===ocId);
    const cambiaCodigo=!!numeroOc&&numeroOc!==oc?.numero_oc;

    // Código repetido: misma clave que el índice único de la base, entre activas y archivadas (excluye esta OC).
    if(cambiaCodigo&&normalizarCodigoOC(numeroOc)!==normalizarCodigoOC(oc?.numero_oc)){
      const dup=buscarDuplicadoOC(numeroOc,ocId);
      if(dup) throw new Error(mensajeDuplicado(dup));
    }
    // Fecha de la OC (Fase 4A): es fecha_emision_mp. Solo se edita a mano si la OC no viene de
    // Mercado Público; la fecha real de compra se corrige en la etapa Compra, nunca desde aquí.
    const editaFechaOC=fechaOC!==undefined&&fechaOCEditable(oc);
    const fechaOCAntes=String(oc?.fecha_emision_mp||"").slice(0,10);
    const fechaOCNueva=editaFechaOC?(fechaOC||null):undefined;
    const vendedorFinal=vendedorId!==undefined?(vendedorId||null):(oc?.vendedor_id||null);

    try{
      await upd("ordenes_compra_v2",t,ocId,{...(numeroOc?{numero_oc:numeroOc}:{}),cliente,entidad,comuna,contacto,rut_cliente:rutCliente,correo_cliente:correo,
        ...(vendedorId!==undefined?{vendedor_id:vendedorFinal}:{}),
        ...(editaFechaOC?{fecha_emision_mp:fechaOCNueva}:{}),
        ultimo_editor:session.user.id,ultima_edicion:new Date().toISOString()});
    }catch(e){
      if(esErrorDuplicado(e)) throw new Error(`Ya existe otra OC con el código ${numeroOc}.`);
      throw e;
    }

    // Historial (después de guardar, para no registrar cambios que no ocurrieron)
    if(cambiaCodigo){
      await registrarCambio(t,{ocId,ocNumero:numeroOc,usuarioId:perfil?.id,usuarioNombre:perfil?.nombre,
        accion:"Código de OC corregido",campo:"numero_oc",
        valorAnterior:oc?.numero_oc,valorNuevo:numeroOc});
    }
    // Igual con el vendedor: importa quedar con el rastro de quién lo cambió
    if(vendedorId!==undefined&&vendedorFinal!==(oc?.vendedor_id||null)){
      await registrarCambio(t,{ocId,ocNumero:oc?.numero_oc,usuarioId:perfil?.id,usuarioNombre:perfil?.nombre,
        accion:"Vendedor corregido",campo:"vendedor_id",
        valorAnterior:oc?.vendedor_id||"(sin asignar)",valorNuevo:vendedorFinal||"(sin asignar)"});
    }
    if(editaFechaOC&&(fechaOCNueva||"")!==fechaOCAntes){
      await registrarCambio(t,{ocId,ocNumero:oc?.numero_oc,usuarioId:perfil?.id,usuarioNombre:perfil?.nombre,
        accion:"Fecha de la OC corregida",campo:"fecha de la OC",
        valorAnterior:fechaOCAntes||"—",valorNuevo:fechaOCNueva||"—"});
    }

    // Volver a traer los datos con el código corregido (la fecha de compra no se toca)
    let aviso=null;   // {msg,tipo}: un solo mensaje final, para que no lo tape el siguiente
    // Venta propia (Fase 4B): es un cambio de financiamiento; lo hace la base (deuda y etapa se recalculan solas).
    const ventaPropiaFinal=ventaPropia!==undefined?!!(vendedorFinal&&ventaPropia):!!oc?.es_venta_propia;
    if(ventaPropiaFinal!==!!oc?.es_venta_propia){
      try{
        await cambiarFinanciamientoOC(t,{ocId,financiadorId:oc?.financiador_id||null,
          tipo:ventaPropiaFinal?"venta_propia":(esFondosPropios(financiadores.find(f=>f.id===oc?.financiador_id))?"fondos_propios":"externo")});
      }catch(e){ aviso={msg:`Datos guardados, pero no se cambió la venta propia: ${e.message}`,tipo:"error"}; }
    }
    if(resincronizar&&numeroOc){
      try{
        const r=await fetch(`/api/oc?codigo=${encodeURIComponent(numeroOc)}`);
        const j=await r.json().catch(()=>null);
        const res=resultadoConsultaMP(r.status,j);
        if(res.tipo==="ok"){
          const d=res.oc;
          const fechaHoraMP=d.fecha_envio||d.fecha_creacion||"";
          await upd("ordenes_compra_v2",t,ocId,{
            cliente:d.cliente||cliente, entidad:d.entidad||entidad,
            rut_cliente:d.rut_cliente||rutCliente, comuna:d.comuna||comuna,
            contacto:contacto||d.contacto||"", correo_cliente:correo||d.correo_cliente||"",   // lo escrito en la OC no se reemplaza
            monto_total:d.monto_total||oc?.monto_total, tipo_despacho:d.tipo_despacho||"",
            ...(fechaHoraMP?{fecha_emision_mp:String(fechaHoraMP).slice(0,10),fecha_hora_emision_mp:fechaHoraMP}:{}),
            dias_pago:d.dias_pago||30, sync_pendiente:false, no_en_mp:false});
          aviso=res.estado.tipo==="cancelada"?{msg:"Datos actualizados desde Mercado Público · ⚠ figura CANCELADA en MP",tipo:"error"}:{msg:"Datos actualizados desde Mercado Público"};
        } else if(res.tipo==="no_disponible"){
          aviso={msg:"Código guardado, pero Mercado Público no tiene esa OC (código inexistente o aún no publicada)",tipo:"error"};
        } else {
          aviso={msg:`Código guardado, pero ${res.mensaje}`,tipo:"error"};
        }
      }catch{ aviso={msg:"Código guardado, pero no se pudo consultar Mercado Público",tipo:"error"}; }
    }
    if (rutCliente?.trim()) {
      try {
        await alimentarCatalogoDesdeOC({ catalogo: entidadesCatalogo, token: session.access_token, usuarioId: session.user.id, rut: rutCliente,
          datos: { nombre_entidad: entidad||cliente||"", comuna: comuna||"", contacto: contacto||"", correo: correo||"" } });
      } catch {}
      const avisoCI=await conciliarContactos(t,ocId,resincronizar?"mp":"oc");
      if(avisoCI) aviso={msg:`${aviso?.msg||"Datos actualizados"} · ${avisoCI}`,tipo:"error"};
    }
    showToast(aviso?.msg||"Datos actualizados",aviso?.tipo); await cargarTodo();
  };
  // Corrección de eventos (Fase 4B): compras y pagos al financiador con operaciones atómicas de la base; facturas,
  // cobros y entregas actualizan solo el evento. En todos los casos los totales los recalcula la base.
  const handleEditarEvento=async(oc, tabla, eventoOriginal, cambios)=>{
    const t=session.access_token;
    if (tabla==="eventos_compra"&&esEventoDePedido(eventoOriginal)) throw new Error("Esta compra se registró desde una cotización: corrígela con «Corregir compra» para mantener productos, costo y deuda coherentes.");
    if (tabla==="eventos_compra") {
      await editarCompraOC(t,{eventoId:eventoOriginal.id,fecha:cambios.fecha??eventoOriginal.fecha,
        costo:cambios.costo_compra??eventoOriginal.costo_compra,montoVenta:cambios.monto_venta??null});
    } else if (tabla==="eventos_pago_financiamiento") {
      await editarPagoFinanciador(t,{eventoId:eventoOriginal.id,fecha:cambios.fecha??eventoOriginal.fecha,monto:cambios.monto??eventoOriginal.monto});
    } else {
      // Fase 3: en una factura exenta (DTE 34) el monto exento sigue al monto y el IVA de venta queda en $0.
      if(tabla==="eventos_factura"&&Number(eventoOriginal.tipo_dte)===34&&cambios.monto!=null) cambios={...cambios,monto_exento:Number(cambios.monto)||0,monto_iva:0};
      const filas=await upd(tabla, t, eventoOriginal.id, cambios);
      if(!Array.isArray(filas)||!filas.length) throw new Error("La base no guardó la corrección (sin permiso o el registro ya no existe). No se modificó nada.");
      const nombre={eventos_factura:"Factura corregida",eventos_pago_cliente:"Cobro corregido",eventos_entrega:"Entrega corregida"}[tabla];
      if(nombre){
        const antes=[eventoOriginal.fecha?String(eventoOriginal.fecha).slice(0,10):null,eventoOriginal.monto!=null?fmt.money(eventoOriginal.monto):null].filter(Boolean).join(" · ");
        const despues=[cambios.fecha?String(cambios.fecha).slice(0,10):null,cambios.monto!=null?fmt.money(cambios.monto):null].filter(Boolean).join(" · ");
        try{ await registrarCambio(t,{ocId:oc.id,ocNumero:oc.numero_oc,usuarioId:perfil?.id,usuarioNombre:perfil?.nombre,accion:nombre,campo:tabla,valorAnterior:antes||null,valorNuevo:despues||null}); }catch{}
      }
    }
    showToast("Evento corregido · totales recalculados por la base"); await cargarTodo();
  };
  // Vendedor y financiador de la OC (ficha): la base valida y deja el historial. No toca pagos ni comisiones ya realizadas.
  const handleAsignarVendedor=async(ocId,vendedorId)=>{
    const r=await rpcAsignarVendedor(session.access_token,ocId,vendedorId);
    showToast(r?.sin_cambios?"Sin cambios en el vendedor":`Vendedor: ${r?.despues||"Sin definir"}`); await cargarTodo();
  };
  const handleAsignarFinanciador=async(ocId,financiadorId)=>{
    const r=await rpcAsignarFinanciador(session.access_token,ocId,financiadorId);
    showToast(r?.sin_cambios?"Sin cambios en el financiador":`Financiador: ${r?.despues||"Sin definir"} · deuda recalculada por la base`); await cargarTodo();
  };
  // Cambio de financiamiento de una OC (M2): financiador externo, fondos propios o venta propia.
  const handleCambiarFinanciamiento=async(oc,{tipo,financiadorId})=>{
    const r=await cambiarFinanciamientoOC(session.access_token,{ocId:oc.id,tipo,financiadorId});
    showToast(r?.sin_cambios?"Sin cambios en el financiamiento":`Financiamiento actualizado${r?.despues?`: ${r.despues}`:""} · deuda recalculada por la base`); await cargarTodo();
  };
  // ─── CONTACTOS INSTITUCIONALES (21/10/2026) ─────────────────────────
  const recargarContactos=async()=>{
    const t=session.access_token;
    const [c,v]=await Promise.all([sel("contactos_institucionales",t,"&order=rut_clave").catch(()=>null),sel("contactos_institucionales_oc",t).catch(()=>[])]);
    if(Array.isArray(c)) setContactosInst(c); if(Array.isArray(v)) setVinculosInst(v);
  };
  const ctxContactos=useMemo(()=>({
    disponible:Array.isArray(contactosInst), contactos:contactosInst||[], vinculos:vinculosInst,
    numeroOC:(id)=>[...ocs,...ocsArchivadas].find(o=>o.id===id)?.numero_oc||id,
    esAdmin:perfil?.rol==="admin",
    guardar:async({id,rut,datos,ocId})=>{ const r=await rpcGuardarContacto(session.access_token,{id,rut,datos,ocId}); await recargarContactos();
      showToast(r?.propuesta?"Propuesta enviada: el administrador debe aprobarla":"Contacto guardado"); },
    resolverPropuesta:async(id,aprobar)=>{ await rpcResolverPropuesta(session.access_token,id,aprobar); await recargarContactos(); showToast(aprobar?"Actualización aprobada":"Propuesta rechazada"); },
    fusionar:async(conservar,absorber,motivo)=>{ await rpcFusionarContactos(session.access_token,conservar,absorber,motivo); await recargarContactos(); showToast("Contactos fusionados: el absorbido quedó como obsoleto"); },
    resolver:async(id,decision,motivo)=>{ await rpcResolverContacto(session.access_token,id,decision,motivo); await recargarContactos();
      showToast(decision==="reemplaza"?"Correo actualizado: el anterior quedó como obsoleto":decision==="adicional"?"Contacto confirmado":"Contacto descartado"); },
    obsoleto:async(id,motivo)=>{ await rpcContactoObsoleto(session.access_token,id,motivo); await recargarContactos(); showToast("Contacto marcado como obsoleto"); },
    cargarHistorial:(id)=>sel("contactos_institucionales_historial",session.access_token,`&contacto_id=eq.${id}&order=creado_en.desc&limit=50`),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }),[contactosInst,vinculosInst,ocs,ocsArchivadas,session,perfil]);

  const handleGuardarContacto=async({rut,nombreCliente,correo})=>{
    try { await ins("contactos_cobranza",session.access_token,{id:genId("cob"),rut,nombre_cliente:nombreCliente,correo,creado_por:session.user.id}); await cargarTodo(); }
    catch(e){ /* si ya existe el RUT (unique), no es un error fatal */ }
  };
  // Trazabilidad uniforme de correos: una entrada en historial_cambios SOLO cuando el usuario confirma que envió
  // el correo (abrir Gmail o la app de correo no registra nada). No guarda el cuerpo del correo.
  const registrarCorreoOC=async({ocId,tipo,detalle,correo})=>{
    const oc=ocs.find(o=>o.id===ocId);
    try{
      await registrarCambio(session.access_token,{ocId,ocNumero:oc?.numero_oc,usuarioId:perfil?.id,usuarioNombre:perfil?.nombre,
        accion:`Correo enviado (confirmado por el usuario): ${tipo}${detalle?` · ${detalle}`:""}`,campo:"destinatario",valorNuevo:correo});
    }catch{}
  };
  const handleCorreoOC=async(data)=>{ await registrarCorreoOC(data); showToast(`Envío registrado (confirmado por el usuario): ${data.tipo}`); await cargarTodo(); };
  const handleEnviarReclamo=async({correo,cc,asunto,cuerpo,ocId,rut,tipo,detalle})=>{
    const ccLimpio=(cc||"").split(",").map(s=>s.trim()).filter(Boolean).join(",");
    const ahora=new Date().toISOString();
    const t=session.access_token;
    const oc=ocs.find(o=>o.id===ocId);
    try {
      await upd("ordenes_compra_v2",t,ocId,{
        ...(String(oc?.correo_cliente||"").trim()?{}:{correo_cliente:correo}),   // el correo histórico de la OC no se reemplaza
        rut_cliente:rut||undefined,
        ultimo_reclamo_fecha:ahora, ultimo_reclamo_por:session.user.id,
      });
      await ins("oc_reclamos",t,{
        id:genId("rec"),oc_id:ocId,oc_numero:oc?.numero_oc,
        correo,cc:ccLimpio||null,fecha:ahora,
        usuario_id:session.user.id,usuario_nombre:perfil?.nombre||"",
      });
    } catch {}
    // Contactos institucionales: el correo de cobranza queda vinculado a esta OC (no sobrescribe contactos existentes)
    if(ciDisponible.current){ try{ await rpcCorreoCobranza(t,ocId,correo); }catch{} }   // solo el destinatario: las copias suelen ser de BFK
    await registrarCorreoOC({ocId,tipo:tipo||"reclamo de pago",detalle,correo});
    showToast(`Envío del reclamo registrado (confirmado por el usuario) para ${correo}`);
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
  if(retornoRecuperacion) return <RestablecerContrasena retorno={retornoRecuperacion} onSalir={({email,aviso,usuarioId,cambiada})=>{
    // Tras cambiar la contraseña se cerraron todas las sesiones de esa cuenta: si la guardada era suya, se descarta.
    if(cambiada&&(!session||!usuarioId||session.user?.id===usuarioId)){ setSession(null); setPerfil(null); storageSet(SESSION_KEY,""); }
    setAvisoLogin({email:email||"",aviso:aviso||""}); setRetornoRecuperacion(null);
  }} />;
  if(loadingApp) return <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",color:C.inkMuted,fontFamily:SANS}}>Cargando…</div>;
  if(!session) return <LoginScreen onLogin={handleLogin} emailInicial={avisoLogin?.email||""} avisoInicial={avisoLogin?.aviso||""} />;
  const alertasUrgentes=calcularAlertas(ocs).filter(a=>a.nivel==="alto").length;

  // La cartola concilia contra los registros completos (lib/conciliacion.js): ya no usa una lista solo de fecha y monto.

  // Imprimir / guardar como PDF TODAS las pantallas en un solo documento (solo lectura, no toca datos).
  // En iPhone: Compartir > Imprimir, y pellizcar la vista previa para obtener el PDF.
  const hoja=(k,nodo)=>todo?(
    <div key={"hoja_"+k} data-hoja style={{breakBefore:k==="panel"?"auto":"page",pageBreakBefore:k==="panel"?"auto":"always",marginBottom:28}}>
      <div style={{fontWeight:800,fontSize:20,color:C.ink,margin:"4px 0 12px",paddingBottom:6,borderBottom:`2px solid ${C.teal}`}}>{TABS.find(t=>t.key===k)?.label||k}</div>
      {nodo}
    </div>
  ):nodo;
  const cerrarVistaTodo=()=>{
    setPdfEstado(prev=>{ if(prev?.url) URL.revokeObjectURL(prev.url); return null; });
    setTodo(false);
  };
  const generarPdfTodo=async()=>{
    const els=[...document.querySelectorAll("[data-hoja]")];
    if(!els.length){ setPdfEstado({fase:"error",txt:"No hay pantallas para exportar."}); return; }
    setPdfEstado({fase:"generando",txt:"Generando PDF…"});
    try{
      window.scrollTo(0,0);
      const blob=await generarPdfPantallas(els,{fondo:C.paper,alMedida:(n,t)=>setPdfEstado({fase:"generando",txt:`Generando PDF… pantalla ${n} de ${t}`})});
      const nombre=`BFK Ltda - Todas las pantallas - ${new Date().toISOString().slice(0,10)}.pdf`;
      setPdfEstado({fase:"listo",url:URL.createObjectURL(blob),nombre,blob});
    }catch(e){ setPdfEstado({fase:"error",txt:"No se pudo generar el PDF. Intenta de nuevo."}); }
  };
  const compartirPdf=async()=>{
    const e=pdfEstado; if(!e?.blob) return;
    try{
      const f=new File([e.blob],e.nombre,{type:"application/pdf"});
      if(navigator.canShare&&navigator.canShare({files:[f]})){ await navigator.share({files:[f],title:e.nombre}); return; }
    }catch(err){ if(err?.name==="AbortError") return; }
    window.open(e.url,"_blank"); // respaldo: abre el PDF en el visor del navegador
  };
  const imprimirTodo=()=>{
    setMenuMas(false); setTodo(true); setPdfEstado(null);
    window.scrollTo(0,0);
    // Espera a que se dibujen todas las pantallas y genera el PDF.
    setTimeout(()=>{ generarPdfTodo(); },1200);
  };

  // ── Encabezado y estructura (Fase 3) ─────────────────────────────
  const pantalla=pantallaDe(tab)||pantallaDe(PANTALLA_INICIAL);
  const saludo=(()=>{ const h=new Date().getHours(); return h<12?"Buenos días":h<19?"Buenas tardes":"Buenas noches"; })();
  const tituloPantalla=tab==="panel"?`${saludo}, ${perfil?.nombre?.split(" ")[0]||""}`:pantalla.hub?HUBS[pantalla.hub].label:pantalla.label;
  const subtituloPantalla=tab==="panel"?new Date().toLocaleDateString("es-CL",{weekday:"long",day:"numeric",month:"long"}):pantalla.hub?`${pantalla.label} · ${pantalla.desc}`:pantalla.desc;
  const esAdminNav=perfil?.rol==="admin";
  const visibles=entradasPara(esAdminNav);
  const pestanasHub=pantalla.hub?pestanasDe(pantalla.hub,esAdminNav):null;
  const nAlertas=contarAlertas(notificaciones,alertasUrgentes)+contarCorreosAccion(correosBfk);
  const salir=()=>{ setMenuMas(false); handleLogout(); };
  const nuevaOC=()=>{ setMenuMas(false); setAccion("compra_oc"); };

  const contenidoPantallas=(
    <ModoTodoContext.Provider value={todo}><ContactosContext.Provider value={ctxContactos}>
      {pestanasHub&&!todo&&<Pestanas etiqueta={HUBS[pantalla.hub].label} variante="subrayado" activa={tab} onCambiar={irA} items={pestanasHub.map(p=>({key:p.key,label:p.label,attrs:{"data-nav":p.key,"aria-current":tab===p.key?"page":undefined}}))} />}
      {(tab==="panel"||todo)&&hoja("panel",<PanelDashboard onQuitarAlertaCartola={handleQuitarAlertaCartola} onBuscarCompras={(q)=>{setBusquedaCompras(q);setFiltroCompras(null);setOcFoco(null);setVolverA(null);setTab("compras");}} ocs={ocs} financiadores={financiadores} gastos={gastos} pagosVendedor={pagosVendedor} ivaMensual={ivaMensual} vendedores={vendedores} pagoFinSueltos={pagoFinSueltos} aportes={aportes} ajustes={ajustesSaldo} categorias={categoriasGasto} perfil={perfil} onExportarTodo={handleExportarTodo} exportando={exportando} onNavigate={(t,filtro,ocId)=>{setFiltroCompras(filtro||null);setOcFoco(ocId||null);setVolverA(null);setTab(t);}} onAccion={(k)=>setAccion(k)} onSincronizar={completarTodasDesdeMP} onCorregirFechas={corregirFechasTodas} sincronizando={sincronizando} porAceptar={porAceptar.filter(a=>!buscarDuplicadoOC(a.numero_oc))} onActualizarPorAceptar={revisarPorAceptar} verificandoPorAceptar={verificandoPorAceptar} aceptadasSinCargar={aceptadasSinCargar.filter(a=>!buscarDuplicadoOC(a.numero_oc))} onCargarOC={(numero)=>{setCodigoOcRapida(numero);setAccion("compra_oc");}} onCargarTodasAceptadas={handleCargarTodasAceptadas} cargandoAceptadas={cargandoAceptadas} onActualizarAceptadas={revisarAceptadasSinCargar} verificandoAceptadas={verificandoAceptadas} canceladasEnMP={canceladasEnMP.filter(c=>ocs.some(o=>o.id===c.id))} onArchivarCancelada={(id)=>handleArchivarOC(id,"Cancelada en Mercado Público")} onActualizarCanceladas={revisarCanceladasEnMP} verificandoCanceladas={verificandoCanceladas} onValidarTodo={validarTodoContraMP} validandoTodo={validandoTodo} usoMP={usoMP} actMP={actMP} esCodigoMP={esCodigoMP} ultimaCartola={ultimaCartola} saldoBanco={saldoBanco} bancoMensual={bancoMensual} onEditarSaldo={()=>setAccion("saldo_banco")} />)}
      {(tab==="compras"||todo)&&hoja("compras",<>{!todo&&volverA==="notif"&&<button onClick={()=>{setVolverA(null);setTab("notif");}} style={{width:"100%",textAlign:"left",background:C.tealLight,color:C.tealDark,border:"none",borderRadius:12,padding:"10px 12px",marginBottom:10,fontWeight:800,fontSize:13,minHeight:44,cursor:"pointer"}}>← Volver a Alertas</button>}<PanelCompras key={"compras-"+reinicio} pagosVendedor={pagosVendedor} onAsignarVendedor={handleAsignarVendedor} onAsignarFinanciador={handleAsignarFinanciador} correosBfk={correosBfk} onMarcarCorreo={handleMarcarCorreo} difsHistoricas={difsHistoricas} onCambiarFinanciamiento={handleCambiarFinanciamiento} busquedaInicial={busquedaCompras} ocs={ocs} perfiles={perfiles} filtroInicial={filtroCompras} ocFoco={ocFoco} onFocoUsado={()=>setOcFoco(null)} contactos={contactos} onEnviarReclamo={handleEnviarReclamo} onCorreoOC={handleCorreoOC} onRegistrarRespuestaReclamo={handleRegistrarRespuestaReclamo} onGuardarContacto={handleGuardarContacto} onGuardarDatosOC={handleGuardarDatosOC} onEditarEvento={handleEditarEvento} financiadores={financiadores} onConfirmarEntrega={handleEntrega} onEmitirFactura={handleFactura} onPagoCliente={handlePagoCliente} onPagoFinanciamiento={handlePagoFin} entidadesCatalogo={entidadesCatalogo} onGuardarLink={handleGuardarLink} onEliminarLink={handleEliminarLink} onEditarLink={handleEditarLink} onRepartirInversion={handleRepartirInversion} buscarDuplicadoOC={buscarDuplicadoOC} onSincronizarFecha={handleSincronizarFecha} perfil={perfil} historialCambios={historialCambios} onAgregarComentario={handleAgregarComentario} onEliminarComentario={handleEliminarComentario} onArchivarOC={handleArchivarOC} onEliminarFactura={handleEliminarFactura} onRegistrarNC={handleNotaCredito} onEliminarEvento={handleEliminarEvento} vendedores={vendedores} onIngresarCompra={handleIngresarCompra} onCompraDesdeCotizacion={handleCompraDesdeCotizacion} onCorregirCompra={handleCorregirCompra} onCrearSeguimiento={handleCrearSeguimiento} onActualizarSeguimiento={handleActualizarSeguimiento} onEliminarSeguimiento={handleEliminarSeguimiento} onAnularCompra={handleAnularCompra} onBuscarCotizacionOC={buscarCotizacionOC} onCargarCotizacionOC={cargarCotizacionOC} onAsignarResponsable={handleAsignarResponsable} onGuardarPostventa={handleGuardarPostventa} tributario={tributario} /></>)}
      {(tab==="notif"||todo)&&hoja("notif",<PanelNotificaciones correos={correosBfk} onMarcarCorreo={handleMarcarCorreo} notificaciones={notificaciones} ocs={ocs} onMarcarLeidas={handleMarcarNotificacionesLeidas} filtroAlertas={filtroAlertas} onFiltroAlertas={setFiltroAlertas} onNavigate={(t,filtro,ocId)=>{setFiltroCompras(filtro||null);setOcFoco(ocId||null);setVolverA(ocId?"notif":null);setTab(t);}} />)}
      {(tab==="agenda"||todo)&&hoja("agenda",<PanelCalendario ocs={ocs} onMarcarFecha={handleMarcarFecha} onVerAlertas={(f)=>{setFiltroCompras(null);setOcFoco(null);setVolverA(null);setFiltroAlertas({nivel:(f&&f.nivel)||"todas",etapa:(f&&f.etapa)||null});setTab("notif");}} />)}
      {tab==="cotizaciones"&&!todo&&hoja("cotizaciones",<PanelCotizaciones token={session?.access_token} perfil={perfil} tributario={tributario} entidadesCatalogo={entidadesCatalogo} showToast={showToast} />)}
      {(tab==="financiamiento"||todo)&&hoja("financiamiento",<PanelFinanciamiento difsHistoricas={difsHistoricas} financiadores={financiadores} ocs={ocs} ajustes={ajustesSaldo} perfiles={perfiles} onAjustar={handleAjusteSaldo} aportes={aportes} onGuardarAporte={handleGuardarAporte} onEliminarAporte={perfil?.rol==="admin"?handleEliminarAporte:undefined} onAbonar={(finId)=>{setAbonoFinId(typeof finId==="string"||typeof finId==="number"?finId:null);setAccion("abono_fin");}} pagoFinSueltos={pagoFinSueltos} />)}
      {(tab==="gastos"||todo)&&hoja("gastos",<PanelGastos gastos={gastos} categorias={categoriasGasto} ivaMensual={ivaMensual} pagosVendedor={pagosVendedor} vendedores={vendedores} onNuevoGasto={handleNuevoGasto} onGuardarIva={handleGuardarIva} onIrImpuestos={()=>irA("impuestos")} />)}
      {(tab==="finanzas"||todo)&&hoja("finanzas",<PanelResumenFinanzas ocs={ocs} financiadores={financiadores} gastos={gastos} pagosVendedor={pagosVendedor} ivaMensual={ivaMensual} vendedores={vendedores} pagoFinSueltos={pagoFinSueltos} aportes={aportes} ajustes={ajustesSaldo} categorias={categoriasGasto} onIrImpuestos={()=>irA("impuestos")} />)}
      {(tab==="impuestos"||todo)&&hoja("impuestos",<PanelImpuestos ivaMensual={ivaMensual} gastos={gastos} onGuardarIva={handleGuardarIva} />)}
      {(tab==="banco"||todo)&&hoja("banco",<PanelBanco ocs={ocs} financiadores={financiadores} gastos={gastos} pagosVendedor={pagosVendedor} ivaMensual={ivaMensual} vendedores={vendedores} pagoFinSueltos={pagoFinSueltos} aportes={aportes} saldoBanco={saldoBanco} ultimaCartola={ultimaCartola} bancoMensual={bancoMensual} onEditarSaldo={()=>setAccion("saldo_banco")} onImportarCartola={()=>setAccion("cartola")} onQuitarAlertaCartola={handleQuitarAlertaCartola} />)}
      {(tab==="vendedores"||todo)&&hoja("vendedores",<PanelVendedores vendedores={vendedores} ocs={ocs} ivaMensual={ivaMensual} gastos={gastos} pagosVendedor={pagosVendedor} onGuardarIva={handleGuardarIva} onPagoVendedor={handlePagoVendedorSimple} onAnularPago={handleAnularPagoVendedor} esAdmin={perfil?.rol==="admin"} onIrImpuestos={()=>irA("impuestos")} onVerOCs={(filtro)=>{setFiltroCompras(filtro);setOcFoco(null);setVolverA(null);setTab("compras");}} onAbrirOC={(ocId)=>{setFiltroCompras(null);setOcFoco(ocId);setVolverA(null);setTab("compras");}} />)}
      {(tab==="usuarios"||todo)&&perfil?.rol==="admin"&&hoja("usuarios",<PanelUsuarios difsHistoricas={difsHistoricas} perfiles={perfiles} ocs={ocs} ocsArchivadas={ocsArchivadas} onRestaurarOC={handleRestaurarOC} onChangeRol={handleChangeRol} session={session} showToast={showToast} entidadesCatalogo={entidadesCatalogo} onEntidadesImportadas={handleEntidadesImportadas} usoMP={usoMP} sincronizando={sincronizando} validandoTodo={validandoTodo} exportando={exportando} onCorregirFechas={corregirFechasTodas} onValidarTodo={validarTodoContraMP} onExportarTodo={handleExportarTodo} />)}
    </ContactosContext.Provider></ModoTodoContext.Provider>
  );

  // Contenido + ventanas, igual en celular y escritorio
  const ventanas=(
    <>
      {/* MODAL NUEVA OC */}
      {accion==="compra_oc"&&(
        <Modal title="Nueva OC" onClose={()=>{setAccion(null);setCodigoOcRapida("");}}>
          <NuevaOCRapida perfil={perfil} vendedores={vendedores} entidadesCatalogo={entidadesCatalogo}
            codigoInicial={codigoOcRapida} buscarDuplicado={buscarDuplicadoOC}
            onGuardar={handleNuevaOCRapida} onCerrar={()=>{setAccion(null);setCodigoOcRapida("");}} />
          <button onClick={()=>setAccion("compra_manual")}
            style={{width:"100%",background:"none",border:"none",color:C.inkFaint,fontSize:12,cursor:"pointer",marginTop:14,textDecoration:"underline"}}>
            Ingresar manualmente (formulario completo)
          </button>
        </Modal>
      )}
      {accion==="compra"&&<Modal title="Ingresar compra" onClose={()=>setAccion(null)}><FormCompraRapida ocs={ocs} financiadores={financiadores} perfil={perfil} onSave={handleCompraRapida} /></Modal>}
      {accion==="entrega"&&<Modal title="Ingresar entrega" onClose={()=>setAccion(null)}><FormConfirmarEntrega ocs={ocs} onSave={handleEntrega} /></Modal>}
      {accion==="factura"&&<Modal title="Ingresar factura" onClose={()=>setAccion(null)}><FormEmitirFactura ocs={ocs} onSave={handleFactura} /></Modal>}
      {accion==="saldo_banco"&&(
        <Modal title="Saldo de la cuenta del banco" onClose={()=>setAccion(null)}>
          <FormSaldoBanco actual={saldoBanco} onSave={handleGuardarSaldoBanco} />
        </Modal>
      )}
      {accion==="cartola"&&<Modal title="Cartola del banco: conciliar" onClose={()=>setAccion(null)}><ImportarCartola ocs={ocs} financiadores={financiadores} vendedores={vendedores} categorias={categoriasGasto} gastos={gastos} pagosVendedor={pagosVendedor} pagoFinSueltos={pagoFinSueltos} aportes={aportes} onRegistrar={handleCobrosDesdeCartola} onRegistrarEgresos={handleEgresosDesdeCartola} onRegistrarRetiro={handleRetiroDesdeCartola} onLeerDatosFrescos={leerDatosConciliacion} onRecargar={cargarTodo} /></Modal>}
      {accion==="abono_fin"&&<Modal title="Abonar a financiador" onClose={()=>setAccion(null)}><FormAbonoFinanciador ocs={ocs} financiadores={financiadores} financiadorInicial={abonoFinId} onSave={handleAbonoFinanciador} difsHistoricas={difsHistoricas} /></Modal>}
      {accion==="pago_cliente"&&<Modal title="Ingresar pago" onClose={()=>setAccion(null)}><FormPagoCliente ocs={ocs} onSave={handlePagoCliente} /></Modal>}
      {accion==="compra_manual"&&<Modal title="Nueva OC — manual" onClose={()=>setAccion(null)}><FormIngresarCompra perfil={perfil} ocs={ocs} financiadores={financiadores} vendedores={vendedores} entidadesCatalogo={entidadesCatalogo} buscarDuplicado={buscarDuplicadoOC} onSave={handleIngresarCompra} /></Modal>}

      <Toast toast={toast} />
      <AvisoVersionNueva />
    </>
  );

  if(esEscritorio){
    return (
      <div style={{minHeight:"100vh",background:C.paper,fontFamily:SANS,display:"flex",alignItems:"flex-start"}}>
        <BarraLateral visibles={visibles} tab={tab} onIr={irA} nAlertas={nAlertas} perfil={perfil} onNuevaOC={nuevaOC} onImprimir={imprimirTodo} onSalir={salir} />
        <div style={{flex:1,minWidth:0}}>
          <header data-noprint style={{position:"sticky",top:0,zIndex:20,background:"rgba(247,248,250,0.94)",backdropFilter:"blur(10px)",borderBottom:`1px solid ${C.border}`}}>
            <div style={{maxWidth:ANCHO_CONTENIDO,margin:"0 auto",padding:"18px 28px 14px",boxSizing:"border-box"}}>
              <h1 style={{margin:0,fontSize:20,fontWeight:800,color:C.ink,letterSpacing:-0.4,lineHeight:1.2}}>{tituloPantalla}</h1>
              <div style={{fontSize:13,color:C.inkMuted,marginTop:3}}>{subtituloPantalla}</div>
            </div>
          </header>
          {todo&&(
            <div data-noprint style={{position:"sticky",top:0,zIndex:30,background:C.tealLight,borderBottom:`2px solid ${C.teal}`,padding:"12px 16px",display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
              <div style={{flex:1,minWidth:180,fontSize:13,color:C.ink,fontWeight:700,lineHeight:1.35}}>
                {pdfEstado?.fase==="generando"?pdfEstado.txt:pdfEstado?.fase==="listo"?"PDF listo con todas las pantallas.":pdfEstado?.fase==="error"?pdfEstado.txt:"Preparando todas las pantallas…"}
                {pdfEstado?.fase==="listo"&&<span style={{display:"block",fontWeight:500,color:C.inkMuted,fontSize:12}}>Toca "Guardar PDF" y elige "Guardar en Archivos".</span>}
              </div>
              {pdfEstado?.fase==="listo"&&<button onClick={compartirPdf} style={{background:C.tealDark,color:"#fff",border:"none",borderRadius:12,padding:"10px 14px",fontSize:13,fontWeight:700,cursor:"pointer"}}>Guardar PDF</button>}
              {pdfEstado?.fase==="listo"&&<a href={pdfEstado.url} target="_blank" rel="noreferrer" style={{color:C.tealDark,fontSize:13,fontWeight:700,padding:"10px 6px"}}>Abrir</a>}
              {pdfEstado?.fase==="error"&&<button onClick={generarPdfTodo} style={{background:C.tealDark,color:"#fff",border:"none",borderRadius:12,padding:"10px 14px",fontSize:13,fontWeight:700,cursor:"pointer"}}>Reintentar</button>}
              <button onClick={cerrarVistaTodo} style={{background:"transparent",color:C.inkMuted,border:`1px solid ${C.border}`,borderRadius:12,padding:"10px 14px",fontSize:13,fontWeight:600,cursor:"pointer"}}>Volver</button>
            </div>
          )}
          <main id="contenido" className={todo?"bfk-modo-todo":undefined} style={{maxWidth:ANCHO_CONTENIDO,margin:"0 auto",padding:"20px 28px 56px",boxSizing:"border-box"}}>
            {contenidoPantallas}
          </main>
        </div>
        {ventanas}
      </div>
    );
  }

  return (
    <div style={{minHeight:"100vh",background:C.paper,fontFamily:SANS,paddingBottom:"calc(104px + env(safe-area-inset-bottom))"}}>
      {/* ENCABEZADO (celular): título de la pantalla y + Nueva OC. Imprimir y Cerrar sesión están en "Más". */}
      <header data-noprint style={{background:"rgba(255,255,255,0.96)",backdropFilter:"blur(12px)",padding:"calc(10px + env(safe-area-inset-top)) 16px 10px",color:C.ink,borderBottom:`1px solid ${C.border}`,position:"sticky",top:0,zIndex:30}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,maxWidth:760,margin:"0 auto"}}>
          <div style={{display:"flex",alignItems:"center",gap:10,minWidth:0,flex:1}}>
            <div aria-hidden="true" style={{width:34,height:34,background:C.night,borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:MONO,color:C.teal,fontWeight:800,fontSize:12,flexShrink:0}}>BFK</div>
            <div style={{minWidth:0}}>
              <h1 style={{margin:0,fontWeight:800,fontSize:16,letterSpacing:-0.3,lineHeight:1.25,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{tituloPantalla}</h1>
              <div style={{fontSize:12,color:C.inkMuted,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{subtituloPantalla}</div>
            </div>
          </div>
          <button onClick={nuevaOC} style={{background:C.teal,border:"none",color:"#fff",borderRadius:8,padding:"9px 14px",fontSize:13,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap",flexShrink:0}}>+ Nueva OC</button>
        </div>
      </header>

      {todo&&(
        <div data-noprint style={{position:"sticky",top:0,zIndex:30,background:C.tealLight,borderBottom:`2px solid ${C.teal}`,padding:"12px 16px",display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
          <div style={{flex:1,minWidth:180,fontSize:13,color:C.ink,fontWeight:700,lineHeight:1.35}}>
            {pdfEstado?.fase==="generando"?pdfEstado.txt:pdfEstado?.fase==="listo"?"PDF listo con todas las pantallas.":pdfEstado?.fase==="error"?pdfEstado.txt:"Preparando todas las pantallas…"}
            {pdfEstado?.fase==="listo"&&<span style={{display:"block",fontWeight:500,color:C.inkMuted,fontSize:12}}>Toca "Guardar PDF" y elige "Guardar en Archivos".</span>}
          </div>
          {pdfEstado?.fase==="listo"&&<button onClick={compartirPdf} style={{background:C.tealDark,color:"#fff",border:"none",borderRadius:12,padding:"10px 14px",fontSize:13,fontWeight:700,cursor:"pointer"}}>Guardar PDF</button>}
          {pdfEstado?.fase==="listo"&&<a href={pdfEstado.url} target="_blank" rel="noreferrer" style={{color:C.tealDark,fontSize:13,fontWeight:700,padding:"10px 6px"}}>Abrir</a>}
          {pdfEstado?.fase==="error"&&<button onClick={generarPdfTodo} style={{background:C.tealDark,color:"#fff",border:"none",borderRadius:12,padding:"10px 14px",fontSize:13,fontWeight:700,cursor:"pointer"}}>Reintentar</button>}
          <button onClick={cerrarVistaTodo} style={{background:"transparent",color:C.inkMuted,border:`1px solid ${C.border}`,borderRadius:12,padding:"10px 14px",fontSize:13,fontWeight:600,cursor:"pointer"}}>Volver</button>
        </div>
      )}
      <main id="contenido" className={todo?"bfk-modo-todo":undefined} style={{padding:16,maxWidth:760,margin:"0 auto"}}>
        {contenidoPantallas}
      </main>

      {/* NAVEGACIÓN (celular): 4 principales + Más */}
      <MenuMas abierto={menuMas} onCerrar={()=>setMenuMas(false)} visibles={visibles} tab={tab} onIr={irA} perfil={perfil} onImprimir={imprimirTodo} onSalir={salir} />
      <BarraInferior visibles={visibles} tab={tab} onIr={irA} menuAbierto={menuMas} onAlternarMenu={()=>setMenuMas(v=>!v)} nAlertas={nAlertas} />

      {ventanas}
    </div>
  );
}
