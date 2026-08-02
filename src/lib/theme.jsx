
export const C = {
  night:"#0B1120", nightSoft:"#141B2E", paper:"#F7F8FA", card:"#FFFFFF",
  border:"#E2E5EB", borderDark:"#232C42", ink:"#0F172A", inkMuted:"#64748B", inkFaint:"#94A3B8",
  teal:"#14B8A6", tealLight:"#E6FBF8", tealDark:"#0D9488",
  ok:"#10B981", okLight:"#E7F8F0", warn:"#F59E0B", warnLight:"#FEF3E2",
  danger:"#EF4444", dangerLight:"#FEEAEA", transit:"#6366F1", transitLight:"#EEEDFC",
  info:"#3B82F6", infoLight:"#EAF2FF", purple:"#A855F7", purpleLight:"#F6EEFE",
};

export const MONO = "'JetBrains Mono','SF Mono',Menlo,Consolas,monospace";

export const SANS = "'Inter',system-ui,-apple-system,sans-serif";

export const fmt = {
  money: (n) => "$"+Math.round(Number(n)||0).toLocaleString("es-CL"),
  date: (d) => { if(!d) return "—"; const[y,m,dd]=d.split("-"); return `${dd}/${m}/${y.slice(2)}`; },
  monthYear: (mes,anio) => { const M=["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"]; return `${M[mes-1]}/${anio}`; },
  datetime: (iso) => { if(!iso) return "—"; const d=new Date(iso); return d.toLocaleDateString("es-CL")+" "+d.toLocaleTimeString("es-CL",{hour:"2-digit",minute:"2-digit"}); },
  diasDesde: (fechaStr) => { if(!fechaStr) return null; const hoy=new Date(); hoy.setHours(0,0,0,0); const f=new Date(fechaStr+"T00:00:00"); return Math.floor((hoy-f)/(1000*60*60*24)); },
};

// Ganancia considerando los costos de post-venta.
// El costo extra de reponer o resolver un reclamo sale de la utilidad.
export const costoPostventa=(oc)=>
  (oc?.eventos_postventa||[]).reduce((s,e)=>s+(Number(e.costo_extra)||0),0);

export const gananciaReal=(oc)=>{
  const venta=Number(oc?.monto_total)||0;
  const costo=(Number(oc?.costo_total)||0)+costoPostventa(oc);
  const pesos=venta-costo;
  const pct=venta>0?Math.round(pesos/venta*100):0;
  const color=pct>=20?C.ok:pct>=10?C.warn:C.danger;
  const bg=pct>=20?C.okLight:pct>=10?C.warnLight:C.dangerLight;
  return {venta,costo,pesos,pct,color,bg,extra:costoPostventa(oc)};
};

export const calcMargen=(venta,costo)=>{
  const v=Number(venta)||0; const c=Number(costo)||0;
  if(v<=0) return {pesos:0,pct:0,color:C.danger,bg:C.dangerLight};
  const pesos=v-c; const pct=Math.round((pesos/v)*100);
  const color=pct>=20?C.ok:pct>=10?C.warn:C.danger;
  const bg=pct>=20?C.okLight:pct>=10?C.warnLight:C.dangerLight;
  return {pesos,pct,color,bg};
};

export const iStyle = { width:"100%", padding:"10px 12px", borderRadius:9, border:`1.5px solid ${C.border}`, fontSize:14, color:C.ink, background:C.card, boxSizing:"border-box", fontFamily:SANS };

export const iMono = { ...iStyle, fontFamily:MONO };

export const selStyle = { ...iStyle, cursor:"pointer" };

export const btnP = (bg=C.teal) => ({ padding:"11px 16px", borderRadius:10, border:"none", background:bg, color:"#fff", fontWeight:700, fontSize:13.5, cursor:"pointer", width:"100%" });

export const btnG = { padding:"11px 16px", borderRadius:10, border:`1.5px solid ${C.border}`, background:C.card, color:C.ink, fontWeight:600, fontSize:13.5, cursor:"pointer" };
