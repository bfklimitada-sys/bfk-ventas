import { estadoVencimiento, facturaVigente, plazoPago } from "../../lib/calculos";
import { useState, useEffect } from "react";
import { del } from "../../lib/supabase";
import { C, MONO, SANS, fmt } from "../../lib/theme";
import { Leyenda } from "./Basicos";
import { Ic, I } from "./Iconos";

// Estado del bloqueo cooperativo de la OC abierta. El propietario no ve aviso; los demás ven solo lectura.
export function BloqueoEstado({ estado, onReintentar }) {
  const [,tick]=useState(0);
  useEffect(()=>{ const id=setInterval(()=>tick(n=>n+1),1000); return()=>clearInterval(id); },[]);
  if(!estado||estado.fase==="propietario"||estado.fase==="ninguna") return null;
  const segs=Math.max(0,Math.ceil(((estado.hasta||0)-Date.now())/1000));
  const caja=(titulo,detalle,boton)=>(
    <div data-testid="bloqueo-estado" data-fase={estado.fase} style={{background:C.warnLight,border:`1px solid ${C.warn}`,borderRadius:9,padding:"10px 14px",marginBottom:12,display:"flex",alignItems:"center",gap:10}}>
      <span style={{fontSize:18}}><Ic n="🔒"/></span>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:12.5,fontWeight:700,color:C.warnText}}>{titulo}</div>
        {detalle&&<div style={{fontSize:12,color:C.inkMuted}}>{detalle}</div>}
      </div>
      {boton}
    </div>
  );
  const btn=onReintentar&&<button type="button" onClick={onReintentar} style={{background:"none",border:`1px solid ${C.warn}`,color:C.warnText,borderRadius:8,padding:"6px 10px",fontSize:12,fontWeight:700,minHeight:36,cursor:"pointer"}}>Reintentar</button>;
  if(estado.fase==="adquiriendo") return caja("Verificando disponibilidad de edición…","Solo lectura mientras se confirma.");
  if(estado.fase==="sin_confirmar") return caja("No se pudo confirmar tu sesión de edición","Sin conexión con el servidor. Solo lectura; se reintenta automáticamente.",btn);
  if(estado.fase==="perdida") return caja(`Perdiste la sesión de edición · en edición por ${estado.dueno}`,`Solo lectura · disponible en ~${segs} s. Se recuperará automáticamente si queda libre.`,btn);
  return caja(`En edición por ${estado.dueno} · disponible en ~${segs} s`,"Solo lectura. Se habilitará automáticamente cuando quede libre.",btn);
}

export function HistorialCambiosOC({ ocId, historialCambios }) {
  const items=(historialCambios||[]).filter(h=>h.oc_id===ocId).slice(0,30);
  if(!items.length) return null;
  return (
    <div style={{marginBottom:14}}>
      <div style={{fontSize:12,fontWeight:700,color:C.inkMuted,textTransform:"uppercase",letterSpacing:1,marginBottom:8}}><Ic n="📋"/> Historial de cambios</div>
      {items.map(h=>(
        <div key={h.id} style={{borderLeft:`2px solid ${C.border}`,paddingLeft:10,marginBottom:8}}>
          <div style={{fontSize:12,fontWeight:600,color:C.ink}}>{h.accion}</div>
          {h.campo&&<div style={{fontSize:12,color:C.inkMuted}}>{h.campo}: <span style={{color:C.dangerText,textDecoration:"line-through"}}>{h.valor_anterior||"—"}</span> → <span style={{color:C.okText}}>{h.valor_nuevo||"—"}</span></div>}
          <div style={{fontSize:12,color:C.inkFaint}}>{h.usuario_nombre} · {fmt.datetime(h.creadoEn)}</div>
        </div>
      ))}
    </div>
  );
}

export function ComentariosOC({ oc, perfil, onAgregar, onEliminar, plano }) {
  const [texto,setTexto]=useState(""); const [saving,setSaving]=useState(false);
  const [abiertoPropio,setAbierto]=useState(false);
  const abierto=plano||abiertoPropio; // plano: sin cabecera propia, siempre visible dentro de "Notas e historial"
  const comentarios=(oc.oc_comentarios||[]).slice().sort((a,b)=>(b.creadoEn||"").localeCompare(a.creadoEn||""));
  const handleAgregar=async()=>{
    if(!texto.trim()) return;
    setSaving(true);
    await onAgregar(oc.id,texto.trim());
    setTexto(""); setSaving(false);
  };
  return (
    <div style={plano?{marginBottom:10}:{marginBottom:10,background:C.card,borderRadius:9,overflow:"hidden",border:`1px solid ${C.border}`}}>
      {plano
        ? <div style={{fontSize:12,fontWeight:700,color:C.inkMuted,textTransform:"uppercase",letterSpacing:0.5,marginBottom:8}}><Ic n="💬"/> Notas del equipo {comentarios.length>0&&<span style={{color:C.tealDark}}>({comentarios.length})</span>}</div>
        : <div onClick={()=>setAbierto(v=>!v)} style={{padding:"9px 12px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{fontSize:12,fontWeight:700,color:C.inkMuted,textTransform:"uppercase",letterSpacing:0.5}}>
              <Ic n="💬"/> Notas del equipo {comentarios.length>0&&<span style={{color:C.tealDark}}>({comentarios.length})</span>}
            </span>
            <span style={{color:C.inkFaint,fontSize:12}}>{abierto?"▲":"▼"}</span>
          </div>}
      {abierto&&(
        <div style={plano?{}:{padding:"0 12px 10px"}}>
          {comentarios.map(c=>(
            <div key={c.id} style={{background:C.paper,borderRadius:8,padding:"8px 12px",marginBottom:6}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
                <div style={{flex:1}}>
                  <div style={{fontSize:12,color:C.tealDark,fontWeight:700,marginBottom:3}}>{c.usuario_nombre} · {fmt.datetime(c.creadoEn)}</div>
                  <div style={{fontSize:12.5,color:C.ink,lineHeight:1.5}}>{c.texto}</div>
                </div>
                {perfil?.rol==="admin"&&(
                  <button onClick={()=>onEliminar(c.id)} style={{background:"none",border:"none",color:C.inkFaint,fontSize:14,cursor:"pointer",padding:"0 4px",flexShrink:0}}>✕</button>
                )}
              </div>
            </div>
          ))}
          <div style={{display:"flex",gap:6,marginTop:6,alignItems:"center"}}>
            <input
              style={{flex:1,minWidth:0,padding:"8px 10px",borderRadius:8,border:`1px solid ${C.border}`,fontSize:13,fontFamily:SANS,background:C.card,color:C.ink,outline:"none"}}
              value={texto}
              onChange={e=>setTexto(e.target.value)}
              placeholder="Agregar nota…"
              onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&handleAgregar()}
            />
            <button
              onClick={handleAgregar}
              disabled={saving||!texto.trim()}
              style={{flexShrink:0,width:36,height:36,borderRadius:8,border:"none",background:texto.trim()?C.teal:C.inkFaint,color:"#fff",fontSize:16,cursor:texto.trim()?"pointer":"default",display:"flex",alignItems:"center",justifyContent:"center"}}
            >✓</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════
// ALERTAS DERIVADAS DE LAS OCs
// Se calculan al vuelo, así siempre reflejan el estado real
// sin depender de un proceso que las escriba en la base.
// ═══════════════════════════════════════════════
export function calcularAlertas(ocs) {
  const alertas = [];

  for (const oc of (ocs || [])) {
    // Aportes de socios y ventas externas no generan alertas de gestión
    if ((oc.tipo_registro || "venta") !== "venta") continue;
    const evF = facturaVigente(oc);
    const dias = evF ? fmt.diasDesde(evF.fecha) : null;
    const plazo = plazoPago(oc);
    const saldo = (oc.monto_facturado || 0) - (oc.monto_cobrado || 0);

    // 1. Facturas vencidas o por vencer
    if (evF && oc.estado_pago_cliente !== "pagado" && dias !== null) {
      const venc = estadoVencimiento(dias, plazo);
      if (venc.reclamar) {
        alertas.push({ ocId:oc.id, nivel:"alto", icono:<Ic n="🔴"/>, oc:oc.numero_oc, cliente:oc.cliente,
          titulo:`Factura ${evF.numero_factura} lleva ${dias} días`,
          detalle:`El plazo era ${plazo} días — corresponde reclamar el pago`,
          monto:saldo, tab:"compras", filtro:"cobro", orden:1 });
      } else if (venc.vencida) {
        alertas.push({ ocId:oc.id, nivel:"alto", icono:<Ic n="🟠"/>, oc:oc.numero_oc, cliente:oc.cliente,
          titulo:`Factura ${evF.numero_factura} vencida`,
          detalle:`${dias} días de ${plazo} de plazo`,
          monto:saldo, tab:"compras", filtro:"cobro", orden:2 });
      } else if (venc.porVencer) {
        alertas.push({ ocId:oc.id, nivel:"medio", icono:<Ic n="🟡"/>, oc:oc.numero_oc, cliente:oc.cliente,
          titulo:`Factura ${evF.numero_factura} vence pronto`,
          detalle:`Quedan ${plazo - dias} día${plazo - dias === 1 ? "" : "s"}`,
          monto:saldo, tab:"compras", filtro:"cobro", orden:3 });
      }
    }

    // 1.5 Vale vista o cheque que el cliente ya entregó, pero que
    // todavía no se ha ido a cobrar al banco — esa plata no es real
    // hasta que se cobre.
    (oc.eventos_pago_cliente || []).forEach(ev => {
      if (ev.medio_pago && ev.medio_pago !== "transferencia" && !ev.cobrado_en_banco) {
        const tipo = ev.medio_pago === "vale_vista" ? "Vale vista" : "Cheque";
        alertas.push({ ocId:oc.id, nivel:"alto", icono:<Ic n="📄"/>, oc:oc.numero_oc, cliente:oc.cliente,
          titulo:`${tipo} sin cobrar en el banco`,
          detalle:ev.institucion?`Hay que ir a cobrarlo en ${ev.institucion}`:"Falta ir a cobrarlo",
          monto:ev.monto, tab:"compras", filtro:null, orden:0 });
      }
    });

    // 2. Entregas atrasadas respecto de la fecha estimada
    const fEst = (oc.eventos_compra || [])[0]?.fecha_entrega_estimada;
    const entregada = oc.estado_entrega === "confirmada" || oc.estado_entrega === "entregado";
    if (fEst && !entregada) {
      const atraso = fmt.diasDesde(String(fEst).slice(0,10));
      if (atraso !== null && atraso > 0) {
        alertas.push({ ocId:oc.id, nivel:"alto", icono:<Ic n="🚚"/>, oc:oc.numero_oc, cliente:oc.cliente,
          titulo:`Entrega atrasada ${atraso} día${atraso === 1 ? "" : "s"}`,
          detalle:`Estaba estimada para el ${fmt.date(String(fEst).slice(0,10))}`,
          monto:oc.monto_total, tab:"compras", filtro:"entrega", orden:2 });
      }
    }

    // 3. Entregada hace días y todavía sin facturar
    if (entregada && oc.estado_factura_propia !== "emitida") {
      const fEnt = (oc.eventos_entrega || [])[0]?.fecha;
      const d = fEnt ? fmt.diasDesde(String(fEnt).slice(0,10)) : null;
      if (d !== null && d >= 3) {
        alertas.push({ ocId:oc.id, nivel:"medio", icono:<Ic n="🧾"/>, oc:oc.numero_oc, cliente:oc.cliente,
          titulo:`Entregada hace ${d} días, sin factura`,
          detalle:"Mientras no se facture, no se puede cobrar",
          monto:oc.monto_total, tab:"compras", filtro:"factura", orden:3 });
      }
    }

    // 3b. Ciclo fuera de orden: el registro quedó incompleto
    const facturada = oc.estado_factura_propia === "emitida";
    if (facturada && !entregada) {
      alertas.push({ ocId:oc.id, nivel:"medio", icono:<Ic n="⚠"/>, oc:oc.numero_oc, cliente:oc.cliente,
        titulo:"Facturada sin registrar la entrega",
        detalle:"Falta el registro de entrega — la agenda y el historial quedan incompletos",
        monto:oc.monto_total, tab:"compras", filtro:"entrega", orden:3 });
    }
    if (oc.estado_pago_cliente === "pagado" && !facturada) {
      alertas.push({ ocId:oc.id, nivel:"medio", icono:<Ic n="⚠"/>, oc:oc.numero_oc, cliente:oc.cliente,
        titulo:"Cobrada sin registrar la factura",
        detalle:"Entró la plata pero no hay factura cargada",
        monto:oc.monto_cobrado||oc.monto_total, tab:"compras", filtro:"factura", orden:3 });
    }

    // 4. OCs a medias y sin movimiento
    // Se prioriza la fecha real del evento (fecha) sobre cuándo se
    // guardó en la base (creadoEn) — si no, todo lo que se cargó junto
    // en un import masivo queda con el mismo "días sin avance" falso.
    const fechas = [
      ...(oc.eventos_compra||[]), ...(oc.eventos_entrega||[]),
      ...(oc.eventos_factura||[]), ...(oc.eventos_pago_cliente||[]),
    ].map(e => e.fecha || e.creadoEn).filter(Boolean).sort();
    const etapasNombres = {
      compra:  (oc.eventos_compra||[]).length > 0,
      entrega: entregada,
      factura: oc.estado_factura_propia === "emitida",
      cobro:   oc.estado_pago_cliente === "pagado",
      financ:  oc.estado_pago_financiamiento === "pagado",
    };
    const etapas = Object.values(etapasNombres).filter(Boolean).length;
    if (etapas > 0 && etapas < 5 && fechas.length) {
      const quieta = Math.floor((new Date() - new Date(fechas[fechas.length-1])) / 86400000);
      if (quieta >= 14) {
        const faltan = Object.entries(etapasNombres).filter(([,ok]) => !ok).map(([k]) => k);
        alertas.push({ ocId:oc.id, nivel:"bajo", icono:<Ic n="⏸"/>, oc:oc.numero_oc, cliente:oc.cliente,
          titulo:`Sin avance hace ${quieta} días`,
          detalle:`Va en ${etapas} de 5 etapas · falta: ${faltan.join(", ")}`,
          monto:oc.monto_total, tab:"compras", filtro:null, orden:4, etapas });
      }
    }

    // 5. Guardadas antes de ser aceptadas en Mercado Público
    if (oc.sync_pendiente) {
      alertas.push({ ocId:oc.id, nivel:"bajo", icono:<Ic n="⏳"/>, oc:oc.numero_oc, cliente:"Por completar",
        titulo:"Esperando aceptación en Mercado Público",
        detalle:"Se completará sola cuando la acepten",
        monto:0, tab:"compras", filtro:null, orden:5 });
    }

    // 6. Post-venta abierta
    if ((oc.eventos_postventa||[]).some(e => e.estado !== "resuelto")) {
      alertas.push({ ocId:oc.id, nivel:"medio", icono:<Ic n="🛠"/>, oc:oc.numero_oc, cliente:oc.cliente,
        titulo:"Post-venta sin resolver",
        detalle:"Hay un reclamo del cliente abierto",
        monto:0, tab:"compras", filtro:null, orden:3 });
    }
  }

  // Si una OC ya tiene un aviso urgente o de atención (factura vencida,
  // entrega atrasada, etc.), el informativo "sin avance" es redundante
  // — ya sabemos que necesita atención por otra razón más específica.
  const ocsConAvisoImportante = new Set(alertas.filter(a => a.nivel !== "bajo").map(a => a.ocId));
  const finales = alertas.filter(a =>
    !(a.nivel === "bajo" && a.titulo.startsWith("Sin avance") && ocsConAvisoImportante.has(a.ocId))
  );

  return finales.sort((a,b) => a.orden - b.orden || (a.etapas??99) - (b.etapas??99) || (b.monto||0) - (a.monto||0));
}

// El filtro vive en App (prop `filtroAlertas`) para sobrevivir a la navegación y a las recargas de datos.
// nivel: todas | alto | medio | bajo · etapa (opcional): refina con el campo `filtro` que ya trae cada alerta
// ("entrega" = entregas atrasadas, "cobro" = facturas vencidas), sin categorías nuevas.
const ETAPA_ALERTA = { entrega: "entregas atrasadas", cobro: "facturas vencidas sin cobrar" };
export function PanelNotificaciones({ notificaciones, ocs, onMarcarLeidas, onNavigate, filtroAlertas, onFiltroAlertas }) {
  const [filtroLocal, setFiltroLocal] = useState({ nivel: "todas", etapa: null });
  const fa = filtroAlertas || filtroLocal;
  const setFa = onFiltroAlertas || setFiltroLocal;
  const filtro = fa.nivel || "todas";
  const etapa = fa.etapa || null;
  const setFiltro = (nivel) => setFa({ nivel, etapa: null });
  const alertas = calcularAlertas(ocs);
  const noLeidas = (notificaciones || []).filter(n => !n.leida);
  const visibles = alertas
    .filter(a => filtro === "todas" || a.nivel === filtro)
    .filter(a => !etapa || a.filtro === etapa);
  const conteo = {
    alto:  alertas.filter(a => a.nivel === "alto").length,
    medio: alertas.filter(a => a.nivel === "medio").length,
    bajo:  alertas.filter(a => a.nivel === "bajo").length,
  };
  const colorNivel = (n) => n === "alto" ? C.danger : n === "medio" ? C.warn : C.inkFaint;

  const Chip = ({ id, label, n, color }) => (
    <button onClick={() => setFiltro(id)}
      style={{fontSize:12,fontWeight:700,padding:"5px 10px",borderRadius:8,cursor:"pointer",
        border:`1.5px solid ${filtro===id?color:C.border}`,
        background:filtro===id?C.paper:C.card, color:filtro===id?color:C.inkMuted}}>
      {label}{n !== undefined ? ` ${n}` : ""}
    </button>
  );

  return (
    <div style={{fontFamily:SANS}}>
      <div style={{marginBottom:12}}>
        <div style={{fontWeight:800,fontSize:14,color:C.ink}}>Alertas</div>
        <div style={{fontSize:12,color:C.inkFaint,marginTop:2}}>
          {alertas.length === 0 ? "Todo al día" : `${alertas.length} cosa${alertas.length>1?"s":""} que revisar · toca para ir a la OC`}
        </div>
      </div>

      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:12}}>
        <Chip id="todas" label="Todas" n={alertas.length} color={C.teal} />
        <Chip id="alto"  label={<I t={"🔴 Urgente"}/>}   n={conteo.alto}  color={C.danger} />
        <Chip id="medio" label={<I t={"🟡 Atención"}/>}  n={conteo.medio} color={C.warn} />
        <Chip id="bajo"  label="Informativas" n={conteo.bajo}  color={C.inkMuted} />
      </div>

      {etapa && (
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10,fontSize:12,color:C.inkMuted}}>
          <span>Mostrando solo: <b>{ETAPA_ALERTA[etapa] || etapa}</b></span>
          <button onClick={() => setFa({ nivel: filtro, etapa: null })}
            style={{border:`1px solid ${C.border}`,background:C.card,borderRadius:8,padding:"3px 9px",fontSize:12,cursor:"pointer",color:C.ink}}>Quitar ✕</button>
        </div>
      )}

      {visibles.length === 0 && (
        <div style={{textAlign:"center",padding:"30px 0",color:C.inkFaint,fontSize:13}}>
          ✓ Nada pendiente en esta categoría
        </div>
      )}

      {visibles.map((a, i) => (
        <button key={i} onClick={() => onNavigate && onNavigate(a.tab, a.filtro, a.ocId)}
          style={{width:"100%",textAlign:"left",background:C.card,border:`1px solid ${C.border}`,
            borderLeft:`4px solid ${colorNivel(a.nivel)}`,borderRadius:11,padding:"11px 13px",
            marginBottom:7,cursor:"pointer",display:"flex",gap:10,alignItems:"flex-start"}}>
          <span style={{fontSize:16,flexShrink:0,lineHeight:1.2}}>{a.icono}</span>
          <span style={{flex:1,minWidth:0}}>
            <span style={{display:"block",fontSize:12.5,fontWeight:700,color:C.ink}}>{a.titulo}</span>
            <span style={{display:"block",fontSize:12,color:C.inkMuted,marginTop:2}}>{a.detalle}</span>
            <span style={{display:"block",fontSize:12,color:C.inkFaint,marginTop:3,fontFamily:MONO}}>
              {a.oc}{a.cliente ? ` · ${a.cliente}` : ""}
            </span>
          </span>
          {a.monto > 0 && (
            <span style={{fontSize:12,fontWeight:800,fontFamily:MONO,color:colorNivel(a.nivel),flexShrink:0}}>
              {fmt.money(a.monto)}
            </span>
          )}
        </button>
      ))}

      {noLeidas.length > 0 && (
        <div style={{marginTop:18}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <span style={{fontSize:12,fontWeight:800,color:C.inkMuted,textTransform:"uppercase",letterSpacing:0.4}}>
              Para ti ({noLeidas.length})
            </span>
            <button onClick={onMarcarLeidas} style={{fontSize:12,color:C.tealDark,background:"none",border:"none",cursor:"pointer",fontWeight:600}}>
              Marcar leídas
            </button>
          </div>
          {noLeidas.map(n => (
            <div key={n.id} style={{background:C.tealLight,borderRadius:10,padding:"10px 12px",marginBottom:6,borderLeft:`3px solid ${C.teal}`}}>
              <div style={{fontSize:12.5,color:C.ink,fontWeight:600}}>{n.mensaje}</div>
              <div style={{fontSize:12,color:C.inkFaint,marginTop:3}}>{fmt.datetime(n.creadoEn)}</div>
            </div>
          ))}
        </div>
      )}

      <Leyenda titulo="¿Cómo se ordenan las alertas?" items={[
        {muestra:<Ic n="🔴"/>, texto:"Urgente: facturas pasadas de plazo o entregas atrasadas. Son las que cuestan plata."},
        {muestra:<Ic n="🟡"/>, texto:"Atención: vencen dentro de 5 días, o llevan días entregadas sin facturar."},
        {muestra:<Ic n="⏸"/>, texto:"Informativas: OCs sin avance hace más de dos semanas, o esperando Mercado Público."},
        {muestra:"›", texto:"Al tocar una alerta te lleva al listado filtrado por esa etapa."},
      ]} />
    </div>
  );
}
