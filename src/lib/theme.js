
export const C = {
  night:"#0B1120", nightSoft:"#141B2E", paper:"#F7F8FA", card:"#FFFFFF",
  border:"#E2E5EB", borderDark:"#232C42", ink:"#0F172A", inkMuted:"#475569", inkFaint:"#64748B", inkOnDark:"#94A3B8", okText:"#047857", warnText:"#B45309", dangerText:"#DC2626",
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
export const R = { sm:8, md:10, lg:14, xl:18, pill:999 };
export const T = { min:12, small:12, body:14, title:15, h2:18, h1:22 };
export const TOUCH = 44;

export const sombra = {
  card:"0 1px 2px rgba(15,23,42,0.04), 0 1px 3px rgba(15,23,42,0.06)",
  flotante:"0 8px 24px rgba(0,0,0,0.25)",
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

export const iStyle = { width:"100%", padding:"10px 12px", minHeight:42, borderRadius:R.md, border:`1.5px solid ${C.border}`, fontSize:14, color:C.ink, background:C.card, boxSizing:"border-box", fontFamily:SANS };

export const iMono = { ...iStyle, fontFamily:MONO };

export const selStyle = { ...iStyle, cursor:"pointer" };

export const btnP = (bg=C.teal) => ({ padding:"11px 16px", minHeight:TOUCH, borderRadius:R.md, border:"none", background:bg, color:"#fff", fontWeight:700, fontSize:14, cursor:"pointer", width:"100%" });

export const btnG = { padding:"11px 16px", minHeight:TOUCH, borderRadius:R.md, border:`1.5px solid ${C.border}`, background:C.card, color:C.ink, fontWeight:600, fontSize:14, cursor:"pointer" };
