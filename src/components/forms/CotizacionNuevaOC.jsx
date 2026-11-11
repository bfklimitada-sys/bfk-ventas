import { useEffect, useMemo, useRef, useState } from "react";
import { C, MONO, btnP, fmt, iStyle } from "../../lib/theme";
import { Ic } from "../ui/Iconos";
import { sugerirCotizaciones, elegibilidad, diferenciasOC } from "../../lib/nuevaOCCotizacion";
import { baseCotizacion } from "../../lib/compraCotizacion";
import { ESTADOS_COTIZACION } from "../../lib/cotizaciones";

const m = (x) => fmt.money(Math.round(Number(x) || 0));
const caja = { background: C.paper, borderRadius: 12, padding: "10px 12px", marginBottom: 14, border: `1px solid ${C.border}` };
const tit = (t, extra = null) => <div style={{ fontSize: 12, fontWeight: 700, color: C.inkMuted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8, display: "flex", justifyContent: "space-between", gap: 8 }}><span>{t}</span>{extra}</div>;
const codigoDe = (c) => c?.id_externo || c?.nombre || String(c?.id || "").slice(0, 8);
const fechaCorta = (f) => (f ? fmt.date(String(f).slice(0, 10)) : "");

// Tarjeta de una cotización (sugerida o encontrada). Nunca se elige sola: el botón es la confirmación del usuario.
function Tarjeta({ c, motivos = [], confianza, eleg, onUsar }) {
  const est = ESTADOS_COTIZACION[c.estado]?.label || c.estado;
  return (
    <div data-tarjeta-cotizacion={c.id} style={{ background: C.card, border: `1px solid ${eleg.ok ? C.border : C.dangerLight}`, borderRadius: 10, padding: "10px 12px", marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, flex: "1 1 200px" }}>
          <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: 13, color: C.ink, wordBreak: "break-word" }}>{codigoDe(c)}</div>
          <div style={{ fontSize: 12, color: C.inkMuted, marginTop: 2, lineHeight: 1.45 }}>
            {c.nombre && c.nombre !== codigoDe(c) ? <>{c.nombre}<br /></> : null}
            {c.institucion || "Institución sin registrar"} · {est}{c.fecha ? ` · ${fechaCorta(c.fecha)}` : ""}{Number(c.total) ? ` · total ${m(c.total)}` : ""}
            {c.vendedor_nombre ? <> · vendedor {c.vendedor_nombre}</> : null}
          </div>
        </div>
        {confianza && <span data-confianza={confianza} style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, borderRadius: 999, padding: "2px 8px", background: confianza === "alta" ? C.okLight : confianza === "media" ? C.infoLight : C.paper, color: confianza === "alta" ? C.okText : confianza === "media" ? C.info : C.inkMuted }}>Coincidencia {confianza}</span>}
      </div>
      {motivos.length > 0 && <div data-motivos style={{ fontSize: 12, color: C.inkMuted, marginTop: 6 }}>Coincide: {motivos.join(" · ")}</div>}
      {eleg.ok
        ? <button data-usar-cotizacion={c.id} onClick={() => onUsar(c)} style={{ ...btnP(C.teal), marginTop: 8, minHeight: 44 }}>Usar esta cotización</button>
        : <div data-no-vinculable style={{ fontSize: 12, color: C.dangerText, fontWeight: 500, marginTop: 6 }}>No se puede vincular: {eleg.motivo}</div>}
    </div>
  );
}

// Sección «Cotización BFK» de Nueva OC: sugiere, permite buscar y cargar la cotización elegida (solo lectura).
// seleccion = { fila, cot, base } | null. sinCotizacion: el usuario decidió continuar sin cotización.
export function SelectorCotizacionOC({ ocMP, onCandidatas, onBuscarTexto, onCargar, seleccion, onSeleccion, sinCotizacion, onSinCotizacion, bloqueado = false }) {
  const [fase, setFase] = useState("buscando");   // buscando | lista | no_disponible | error
  const [datos, setDatos] = useState({ lista: [], itemsPor: {}, motivo: "" });
  const [q, setQ] = useState(""); const [res, setRes] = useState(null); const [buscandoTxt, setBuscandoTxt] = useState(false);
  const [cargando, setCargando] = useState(null); const [err, setErr] = useState("");
  const vivo = useRef(true); useEffect(() => () => { vivo.current = false; }, []);

  useEffect(() => {
    (async () => {
      try {
        const r = await onCandidatas(ocMP);
        if (!vivo.current) return;
        if (!r.disponible) { setDatos({ lista: [], itemsPor: {}, motivo: r.motivo }); setFase("no_disponible"); return; }
        setDatos({ lista: r.lista, itemsPor: r.itemsPor || {}, motivo: "" }); setFase("lista");
      } catch (e) { if (vivo.current) { setErr(`No se pudieron buscar cotizaciones relacionadas (${e.message}). Puedes buscarla por su código o continuar sin cotización.`); setFase("error"); } }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sugeridas = useMemo(() => sugerirCotizaciones(ocMP, datos.lista, datos.itemsPor), [ocMP, datos]);

  const buscarTexto = async () => {
    const t = q.trim(); if (t.length < 2) { setErr("Escribe al menos 2 caracteres del código, nombre o institución."); return; }
    setErr(""); setBuscandoTxt(true);
    try { const filas = await onBuscarTexto(t); if (vivo.current) setRes(filas); }
    catch (e) { if (vivo.current) setErr(`No se pudo buscar: ${e.message}`); }
    finally { if (vivo.current) setBuscandoTxt(false); }
  };
  const usar = async (fila) => {
    setErr(""); setCargando(fila.id);
    try {
      const cot = await onCargar(fila.id);
      if (!vivo.current) return;
      const eleg = elegibilidad(cot, ocMP.numero_oc);
      if (!eleg.ok) { setErr(eleg.motivo); setCargando(null); return; }
      if (!(cot.items || []).length) { setErr("La cotización no tiene productos guardados."); setCargando(null); return; }
      onSeleccion({ fila, cot, base: baseCotizacion(cot), eleg });
    } catch (e) { if (vivo.current) setErr(`No se pudo cargar la cotización: ${e.message}`); }
    if (vivo.current) setCargando(null);
  };

  // ── Elegida ──
  if (seleccion) {
    const { cot, base, eleg } = seleccion;
    const avisos = diferenciasOC(ocMP, cot, base);
    return (
      <div data-cotizacion-seleccionada={cot.id} style={{ ...caja, background: C.tealLight, borderColor: C.teal }}>
        {tit("Cotización BFK", bloqueado ? null : <button data-cambiar-cotizacion onClick={() => onSeleccion(null)} style={{ background: "none", border: "none", color: C.tealDark, textDecoration: "underline", cursor: "pointer", fontSize: 12, padding: 0, minHeight: 32, textTransform: "none", letterSpacing: 0 }}>Cambiar</button>)}
        <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: 13, color: C.ink }}>✓ {base.codigo}</div>
        <div style={{ fontSize: 12, color: C.inkMuted, marginTop: 2, lineHeight: 1.5 }}>
          {cot.nombre && cot.nombre !== base.codigo ? <>{cot.nombre}<br /></> : null}
          {cot.institucion || "—"} · {ESTADOS_COTIZACION[cot.estado]?.label || cot.estado} · {base.lineas.length} producto{base.lineas.length === 1 ? "" : "s"} · costo cotizado {m(base.costoTotal)}
        </div>
        <div data-efecto-vinculo style={{ fontSize: 12, color: C.ink, marginTop: 6, lineHeight: 1.5 }}>
          {eleg.yaVinculada && !eleg.adjudicar ? "Ya está vinculada a esta OC." : `Al guardar, la cotización quedará ${eleg.adjudicar ? "adjudicada y " : ""}vinculada a esta OC.`} Sus productos, cantidades y precios de venta no se modifican.
        </div>
        {avisos.map((a, i) => <div key={i} data-aviso-cotizacion style={{ fontSize: 12, color: C.warnText, fontWeight: 500, marginTop: 6 }}><Ic n="⚠" /> {a}</div>)}
      </div>
    );
  }

  // ── Continuar sin cotización ──
  if (sinCotizacion) return (
    <div data-sin-cotizacion-elegido style={{ ...caja, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span style={{ fontSize: 12, color: C.inkMuted }}>Sin cotización BFK: la OC se guarda sola y la compra se registra después.</span>
      <button data-volver-a-cotizaciones onClick={() => onSinCotizacion(false)} style={{ background: "none", border: "none", color: C.tealDark, textDecoration: "underline", cursor: "pointer", fontSize: 12, padding: 0, minHeight: 32 }}>Buscar cotización</button>
    </div>
  );

  return (
    <div data-cotizacion-nueva-oc style={caja}>
      {tit("Cotización BFK relacionada")}
      {fase === "buscando" && <div data-buscando-sugerencias style={{ fontSize: 13, color: C.inkMuted, padding: "4px 0 8px" }}>Buscando cotizaciones relacionadas con {ocMP.numero_oc}…</div>}
      {fase === "no_disponible" && <div style={{ fontSize: 12, color: C.inkMuted, marginBottom: 8 }}>{datos.motivo}</div>}
      {fase === "lista" && (sugeridas.length ? (
        <>
          <div style={{ fontSize: 12, color: C.inkMuted, marginBottom: 8 }}>Posibles cotizaciones para esta OC. Revisa y elige la correcta: no se vincula ninguna sin tu confirmación.</div>
          {sugeridas.map((s) => <div key={s.cot.id} data-sugerencia={s.cot.id}><Tarjeta c={s.cot} motivos={s.motivos} confianza={s.confianza} eleg={s.eleg} onUsar={usar} /></div>)}
        </>
      ) : <div data-sin-sugerencias style={{ fontSize: 12, color: C.inkMuted, marginBottom: 8 }}>No se encontraron cotizaciones que coincidan con el RUT, el monto, el nombre o los productos de la OC.</div>)}

      {fase !== "no_disponible" && <>
        <div style={{ fontSize: 12, fontWeight: 600, color: C.ink, margin: "8px 0 6px" }}>¿No aparece? Búscala</div>
        <div style={{ display: "flex", gap: 6 }}>
          <input data-buscar-cotizacion style={{ ...iStyle, flex: 1, minWidth: 0 }} value={q} placeholder="Código, nombre o institución"
            onChange={(e) => { setQ(e.target.value); setErr(""); }} onKeyDown={(e) => e.key === "Enter" && buscarTexto()} />
          <button data-boton-buscar-cotizacion onClick={buscarTexto} disabled={buscandoTxt} style={{ ...btnP(buscandoTxt ? C.inkFaint : C.tealDark), width: "auto", padding: "0 14px", minHeight: 44 }}>{buscandoTxt ? "…" : "Buscar"}</button>
        </div>
        {res && (res.length ? <div style={{ marginTop: 8 }}>{res.map((c) => <div key={c.id} data-resultado-busqueda={c.id}><Tarjeta c={c} eleg={elegibilidad(c, ocMP.numero_oc)} onUsar={usar} /></div>)}</div>
          : <div data-sin-resultados style={{ fontSize: 12, color: C.inkMuted, marginTop: 8 }}>Sin resultados para «{q.trim()}».</div>)}
      </>}

      {cargando && <div data-cargando-cotizacion style={{ fontSize: 12, color: C.inkMuted, marginTop: 8 }}>Cargando la cotización…</div>}
      {err && <div data-error-cotizacion style={{ background: C.dangerLight, color: C.dangerText, borderRadius: 8, padding: "8px 12px", fontSize: 12, marginTop: 8, fontWeight: 500 }}>{err}</div>}
      <button data-sin-cotizacion-oc onClick={() => onSinCotizacion(true)} style={{ background: "none", border: "none", color: C.tealDark, textDecoration: "underline", cursor: "pointer", fontSize: 12, padding: 0, marginTop: 10, minHeight: 32 }}>Continuar sin cotización</button>
    </div>
  );
}

// «Guardar solo la OC»: lo que trae la cotización (solo lectura) y la utilidad estimada a costo cotizado.
export function ResumenCotizacionOC({ base, ventaOC }) {
  const util = Math.round(Number(ventaOC) || 0) - Math.round(base.costoTotal);
  return (
    <div data-resumen-cotizacion style={caja}>
      {tit("Lo cotizado · montos con IVA")}
      {base.lineas.map((l) => (
        <div key={l.key} data-linea-cotizada={l.key} style={{ fontSize: 12, padding: "5px 0", borderBottom: `1px solid ${C.border}` }}>
          <b>{l.nombre}</b>{l.marca || l.modelo ? ` · ${[l.marca, l.modelo].filter(Boolean).join(" ")}` : ""} × {l.cantidad}<br />
          <span style={{ color: C.inkMuted, wordBreak: "break-word" }}>{l.proveedor || "Sin proveedor"} · {m(l.unitario)} c/u · {m(l.unitario * l.cantidad)}{l.enlace ? ` · ${l.enlace.slice(0, 60)}${l.enlace.length > 60 ? "…" : ""}` : ""}</span>
        </div>
      ))}
      {base.envios.filter((e) => e.monto > 0).map((e) => <div key={e.key} style={{ fontSize: 12, padding: "5px 0", color: C.inkMuted }}>Despacho cotizado{e.proveedor ? ` · ${e.proveedor}` : ""}: <b style={{ color: C.ink }}>{m(e.monto)}</b></div>)}
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "2px 12px", fontSize: 12, marginTop: 6 }}>
        <span>Venta (monto de la OC con IVA)</span><b data-venta-oc>{m(ventaOC)}</b>
        <span>Costo cotizado (productos + despacho)</span><b data-costo-cotizado>{m(base.costoTotal)}</b>
        <span>Utilidad estimada</span><b data-utilidad-estimada style={{ color: util < 0 ? C.dangerText : C.okText }}>{m(util)}</b>
      </div>
      <div style={{ fontSize: 12, color: C.inkFaint, marginTop: 6 }}>No se registra ninguna compra ni deuda. El costo real se registra cuando confirmes la compra («Registrar compra» de la OC usa esta misma cotización).</div>
    </div>
  );
}
