
export const C = {
  night:"#0B1120", nightSoft:"#141B2E", paper:"#F7F8FA", card:"#FFFFFF",
  border:"#E2E5EB", borderFuerte:"#CFD5DE", borderDark:"#232C42", relleno:"#EEF1F5", ink:"#0F172A", inkMuted:"#475569", inkFaint:"#64748B", inkOnDark:"#94A3B8", okText:"#047857", warnText:"#B45309", dangerText:"#DC2626",
  teal:"#14B8A6", tealLight:"#E6FBF8", tealDark:"#0D9488",
  ok:"#10B981", okLight:"#E7F8F0", warn:"#F59E0B", warnLight:"#FEF3E2",
  danger:"#EF4444", dangerLight:"#FEEAEA", transit:"#6366F1", transitLight:"#EEEDFC",
  info:"#3B82F6", infoLight:"#EAF2FF", purple:"#A855F7", purpleLight:"#F6EEFE",
};

export const MONO = "'JetBrains Mono','SF Mono',Menlo,Consolas,monospace";

export const SANS = "'Inter',system-ui,-apple-system,sans-serif";

// ─── Reglas visuales únicas (Fase 4) ─────────────────────────
// Escala de espaciado, radios, tamaños de texto y zona táctil mínima.
export const S = { xs:4, sm:8, md:12, lg:16, xl:24 };
// Escala única (rediseño 2026-10): letra 12/13/14/16/20/28 · radios 8/12/16.
export const R = { sm:8, md:12, lg:12, xl:16, pill:999 };
export const T = { min:12, small:12, sm:13, body:14, title:16, h2:20, h1:28 };
export const TOUCH = 44;

// Orden visual (11/2026): las tarjetas son planas (solo borde). La sombra queda para lo que flota sobre la pantalla.
export const sombra = {
  card:"none",
  panel:"-12px 0 40px rgba(15,23,42,0.18)",
  flotante:"0 8px 24px rgba(0,0,0,0.25)",
  ventana:"0 24px 60px rgba(11,17,32,0.28)",
};

// Estilo de tarjeta reutilizable
export const cardStyle = { background:C.card, border:`1px solid ${C.border}`, borderRadius:R.lg, boxShadow:sombra.card };

export const fmt = {
  money: (n) => "$"+Math.round(Number(n)||0).toLocaleString("es-CL"),
  date: (d) => { if(!d) return "—"; const[y,m,dd]=d.split("-"); return `${dd}/${m}/${y.slice(2)}`; },
  // "lunes 12 de octubre de 2026" (para textos de correo). Se arma con el texto AAAA-MM-DD, sin zona horaria.
  dateLong: (d) => { if(!d) return ""; const[y,m,dd]=String(d).slice(0,10).split("-").map(Number); const dt=new Date(y,m-1,dd);
    const DS=["domingo","lunes","martes","miércoles","jueves","viernes","sábado"], MS=["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
    return `${DS[dt.getDay()]} ${dd} de ${MS[m-1]} de ${y}`; },
  monthYear: (mes,anio) => { const M=["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"]; return `${M[mes-1]}/${anio}`; },
  datetime: (iso) => { if(!iso) return "—"; const d=new Date(iso); return d.toLocaleDateString("es-CL")+" "+d.toLocaleTimeString("es-CL",{hour:"2-digit",minute:"2-digit"}); },
  diasDesde: (fechaStr) => { if(!fechaStr) return null; const hoy=new Date(); hoy.setHours(0,0,0,0); const f=new Date(fechaStr+"T00:00:00"); return Math.floor((hoy-f)/(1000*60*60*24)); },
};

export const iStyle = { width:"100%", padding:"10px 12px", minHeight:42, borderRadius:R.sm, border:`1px solid ${C.borderFuerte}`, fontSize:14, color:C.ink, background:C.card, boxSizing:"border-box", fontFamily:SANS };

export const iMono = { ...iStyle, fontFamily:MONO };

export const selStyle = { ...iStyle, cursor:"pointer" };

// Botón principal de un formulario. Un solo color de marca: el color ya no distingue formularios (antes verde, azul,
// índigo, ámbar o morado según la ventana). Se conservan el rojo (acción destructiva) y el azul noche;
// el gris (ocupado o no disponible) se muestra apagado en vez de un bloque oscuro.
const ACENTOS_A_MARCA = new Set([C.info, C.ok, C.purple, C.transit, C.tealDark, C.warn]);
const APAGADOS = new Set([C.inkFaint, C.inkMuted]);
export const btnP = (bg=C.teal) => {
  const apagado = APAGADOS.has(bg);
  return { padding:"11px 16px", minHeight:TOUCH, borderRadius:R.sm, border:"none", background:apagado?C.relleno:ACENTOS_A_MARCA.has(bg)?C.teal:bg, color:apagado?C.inkFaint:"#fff", fontWeight:600, fontSize:14, cursor:apagado?"default":"pointer", width:"100%" };
};

export const btnG = { padding:"11px 16px", minHeight:TOUCH, borderRadius:R.sm, border:`1px solid ${C.borderFuerte}`, background:C.card, color:C.ink, fontWeight:500, fontSize:14, cursor:"pointer" };

// Botón pequeño dentro de una fila o tarjeta (Editar, Quitar, Ver, Anular…): UN solo tamaño y aspecto en toda la app.
//   "sec" (por defecto): acción normal · "marca": acción que hace avanzar el registro · "peligro": elimina, anula o deshace.
// La destructiva se distingue por el texto y el borde rojos (no por un relleno), igual en Mercado Público, Ventas privadas y Proyectos.
export const btnMini = (tipo="sec") => ({ minHeight:36, padding:"5px 10px", borderRadius:R.sm, fontSize:12, fontWeight:500, lineHeight:1.2, cursor:"pointer", whiteSpace:"nowrap",
  display:"inline-flex", alignItems:"center", justifyContent:"center", gap:5, boxSizing:"border-box",
  border:`1px solid ${tipo==="peligro"?"#F3C5C5":tipo==="marca"?C.teal:C.borderFuerte}`, background:C.card, color:tipo==="peligro"?C.dangerText:tipo==="marca"?C.tealDark:C.ink });

// Etiqueta de un campo de formulario y botón de cerrar de una ventana: los mismos en Mercado Público, Ventas privadas y Proyectos.
export const estiloEtiqueta = { display:"block", fontSize:13, fontWeight:600, color:C.inkMuted, marginBottom:5, lineHeight:1.3 };
export const estiloCerrar = { width:40, height:40, minHeight:40, flexShrink:0, borderRadius:R.sm, border:"none", background:"transparent", color:C.inkMuted, cursor:"pointer", fontSize:16, display:"flex", alignItems:"center", justifyContent:"center" };
