// Gráficos SVG livianos de Inteligencia Comercial (sin dependencias nuevas). Barras finas con extremo redondeado
// anclado a la base, separación de 2 px, líneas de 2 px, ejes y grilla discretos, etiquetas directas selectivas y
// leyenda con conteo (la identidad nunca depende solo del color). Cada gráfico muestra un rótulo al pasar el
// puntero o tocar (celular) y los de resultados permiten filtrar al tocar una barra o un segmento.
import { useRef, useState } from "react";
import { C, MONO, SANS, fmt } from "../../lib/theme";

const TINTA = C.ink, SUAVE = C.inkMuted, TENUE = C.inkFaint, GRILLA = "#E5E7EB";
const compacto = (n) => { const a = Math.abs(n); return a >= 1e6 ? `$${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(".", ",")} M` : a >= 1e3 ? `$${Math.round(n / 1e3)} mil` : fmt.money(n); };
const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export const mesCorto = (m) => { const [a, x] = String(m).split("-"); return `${MES[Number(x) - 1]}-${a.slice(2)}`; };
const escala = (max) => { const p = Math.pow(10, Math.floor(Math.log10(Math.max(1, max)))); const pasos = [1, 2, 2.5, 5, 10].map((k) => k * p); const paso = pasos.find((s) => max / s <= 4) || pasos[4]; return { tope: Math.max(paso, Math.ceil(max / paso) * paso), paso }; };

// Rótulo flotante compartido (posición relativa al contenedor).
function useRotulo() {
  const ref = useRef(null); const [r, setR] = useState(null);
  const mostrar = (e, contenido) => {
    const b = ref.current?.getBoundingClientRect(); if (!b) return;
    const x = (e.touches?.[0]?.clientX ?? e.clientX) - b.left, y = (e.touches?.[0]?.clientY ?? e.clientY) - b.top;
    setR({ x: Math.min(Math.max(x, 70), b.width - 70), y, contenido });
  };
  const Rotulo = () => r && (
    <div data-rotulo role="status" style={{ position: "absolute", left: r.x, top: Math.max(0, r.y - 12), transform: "translate(-50%,-100%)", background: "#0F172A", color: "#fff", borderRadius: 8,
      padding: "6px 9px", fontSize: 12, lineHeight: 1.4, pointerEvents: "none", whiteSpace: "nowrap", zIndex: 5, boxShadow: "0 4px 12px rgba(15,23,42,.25)", fontFamily: SANS }}>{r.contenido}</div>
  );
  return { ref, mostrar, ocultar: () => setR(null), Rotulo };
}
const Marco = ({ titulo, nota, children, dato, rot }) => (
  <figure data-grafico={dato} style={{ margin: 0, background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: "12px 12px 10px", minWidth: 0 }}>
    <figcaption style={{ fontSize: 13, fontWeight: 800, color: TINTA, marginBottom: nota ? 1 : 8 }}>{titulo}</figcaption>
    {nota && <div style={{ fontSize: 12, color: TENUE, marginBottom: 8, lineHeight: 1.35 }}>{nota}</div>}
    <div ref={rot.ref} style={{ position: "relative" }} onMouseLeave={rot.ocultar}>{children}<rot.Rotulo /></div>
  </figure>
);
export const Leyenda = ({ items }) => (
  <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", marginTop: 8 }}>
    {items.map((i) => <span key={i.label} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: SUAVE }}>
      <span style={{ width: 10, height: 10, borderRadius: i.linea ? 2 : 3, background: i.color, display: "inline-block", ...(i.linea ? { height: 3 } : {}) }} />{i.label}{i.valor !== undefined ? <b style={{ color: TINTA, fontFamily: MONO }}>{i.valor}</b> : null}</span>)}
  </div>
);
const Vacio = ({ texto = "Sin datos en el período" }) => <div style={{ fontSize: 13, color: TENUE, padding: "26px 0", textAlign: "center" }}>{texto}</div>;

// 1. Barras: cantidad por resultado (tocar = filtrar).
export function BarrasResultado({ datos, onSeleccionar, activo }) {
  const rot = useRotulo(); const max = Math.max(1, ...datos.map((d) => d.n)); const W = 320, H = 150, B = 20, ancho = Math.min(46, (W - 20) / datos.length - 14);
  const { tope, paso } = escala(max);
  return (
    <Marco titulo="Resultados del período" nota="Toca una barra para filtrar" dato="barras-resultado" rot={rot}>
      {datos.every((d) => !d.n) ? <Vacio /> : (
        <svg viewBox={`0 0 ${W} ${H + B}`} width="100%" style={{ maxHeight: 240, display: "block", margin: "0 auto" }} role="img" aria-label={datos.map((d) => `${d.label}: ${d.n}`).join(", ")}>
          {Array.from({ length: Math.round(tope / paso) + 1 }, (_, i) => i * paso).map((v) => { const y = H - (v / tope) * (H - 16); return <g key={v}><line x1={20} x2={W} y1={y} y2={y} stroke={GRILLA} strokeWidth={1} /><text x={16} y={y + 4} fontSize={10} textAnchor="end" fill={TENUE}>{v}</text></g>; })}
          {datos.map((d, i) => {
            const x = 20 + (i + 0.5) * ((W - 20) / datos.length) - ancho / 2, h = (d.n / tope) * (H - 16), y = H - h;
            const atenuado = activo && activo !== d.k;
            return (
              <g key={d.k} data-barra={d.k} style={{ cursor: "pointer" }} onClick={() => onSeleccionar && onSeleccionar(d.k)}
                onMouseMove={(e) => rot.mostrar(e, <><b>{d.label}</b>: {d.n}</>)} onTouchStart={(e) => rot.mostrar(e, <><b>{d.label}</b>: {d.n}</>)}>
                <rect x={x - 6} y={0} width={ancho + 12} height={H} fill="transparent" />
                {h > 0 && <path d={`M${x},${H} V${y + 4} q0,-4 4,-4 h${ancho - 8} q4,0 4,4 V${H} Z`} fill={d.color} opacity={atenuado ? 0.3 : 1} />}
                <text x={x + ancho / 2} y={y - 5} fontSize={12} fontWeight={800} textAnchor="middle" fill={TINTA} fontFamily={MONO}>{d.n}</text>
                <text x={x + ancho / 2} y={H + 14} fontSize={11} textAnchor="middle" fill={SUAVE}>{d.corto || d.label}</text>
              </g>
            );
          })}
          <line x1={20} x2={W} y1={H} y2={H} stroke={TENUE} strokeWidth={1} />
        </svg>
      )}
    </Marco>
  );
}

// 2. Dona: distribución porcentual (tocar = filtrar).
export function Dona({ datos, onSeleccionar, activo }) {
  const rot = useRotulo(); const total = datos.reduce((s, d) => s + d.n, 0); const R = 62, r = 40, cx = 80, cy = 80;
  let a0 = -Math.PI / 2;
  const arcos = datos.filter((d) => d.n > 0).map((d) => {
    const ang = (d.n / total) * Math.PI * 2, a1 = a0 + ang, gap = datos.filter((x) => x.n > 0).length > 1 ? 0.025 : 0;
    const p = (rad, ra) => [cx + ra * Math.cos(rad), cy + ra * Math.sin(rad)];
    const s = a0 + gap, e = a1 - gap, big = e - s > Math.PI ? 1 : 0;
    const path = ang >= Math.PI * 2 - 1e-6 ? `M${cx - R},${cy} a${R},${R} 0 1,0 ${2 * R},0 a${R},${R} 0 1,0 ${-2 * R},0 M${cx - r},${cy} a${r},${r} 0 1,1 ${2 * r},0 a${r},${r} 0 1,1 ${-2 * r},0`
      : `M${p(s, R)} A${R},${R} 0 ${big} 1 ${p(e, R)} L${p(e, r)} A${r},${r} 0 ${big} 0 ${p(s, r)} Z`;
    a0 = a1; return { ...d, path, pct: Math.round((d.n / total) * 1000) / 10 };
  });
  return (
    <Marco titulo="Distribución de resultados" nota="Porcentaje sobre las oportunidades del período" dato="dona" rot={rot}>
      {!total ? <Vacio /> : (
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <svg viewBox="0 0 160 160" width={150} height={150} role="img" aria-label={arcos.map((a) => `${a.label} ${a.pct}%`).join(", ")} style={{ flexShrink: 0 }}>
            {arcos.map((a) => <path key={a.k} data-segmento={a.k} d={a.path} fill={a.color} fillRule="evenodd" opacity={activo && activo !== a.k ? 0.3 : 1} style={{ cursor: "pointer" }}
              onClick={() => onSeleccionar && onSeleccionar(a.k)} onMouseMove={(e) => rot.mostrar(e, <><b>{a.label}</b>: {a.n} · {String(a.pct).replace(".", ",")}%</>)} onTouchStart={(e) => rot.mostrar(e, <><b>{a.label}</b>: {a.n} · {String(a.pct).replace(".", ",")}%</>)} />)}
            <text x={cx} y={cy - 2} textAnchor="middle" fontSize={22} fontWeight={800} fill={TINTA} fontFamily={MONO}>{total}</text>
            <text x={cx} y={cy + 15} textAnchor="middle" fontSize={10} fill={SUAVE}>oportunidades</text>
          </svg>
          <div style={{ display: "grid", gap: 4, minWidth: 140, flex: 1 }}>
            {arcos.map((a) => <button key={a.k} type="button" onClick={() => onSeleccionar && onSeleccionar(a.k)} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", padding: "3px 0", cursor: "pointer", textAlign: "left", fontFamily: SANS }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: a.color, flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: SUAVE, flex: 1 }}>{a.label}</span>
              <span style={{ fontSize: 12, fontWeight: 800, color: TINTA, fontFamily: MONO }}>{a.n} · {String(a.pct).replace(".", ",")}%</span></button>)}
          </div>
        </div>
      )}
    </Marco>
  );
}

// 3. Línea: evolución mensual (cotizaciones presentadas, ganadas y perdidas), con cursor y rótulo por mes.
export function LineaMensual({ meses, series }) {
  const rot = useRotulo(); const [sel, setSel] = useState(null);
  const W = 340, H = 160, L = 26, Bo = 20, max = Math.max(1, ...meses.flatMap((m) => series.map((s) => m[s.k] || 0))); const { tope, paso } = escala(max);
  const x = (i) => L + (meses.length === 1 ? (W - L) / 2 : 8 + (i * (W - L - 16)) / (meses.length - 1)); const y = (v) => H - (v / tope) * (H - 14);
  const elegir = (e) => {
    const b = e.currentTarget.getBoundingClientRect(); const px = ((e.touches?.[0]?.clientX ?? e.clientX) - b.left) * (W / b.width);
    let i = 0, d = 1e9; meses.forEach((_, k) => { const dd = Math.abs(x(k) - px); if (dd < d) { d = dd; i = k; } });
    setSel(i); const m = meses[i];
    rot.mostrar(e, <><b>{mesCorto(m.mes)}</b>{series.map((s) => <div key={s.k}><span style={{ display: "inline-block", width: 8, height: 3, background: s.color, marginRight: 5, verticalAlign: "middle" }} />{s.label}: {m[s.k] || 0}</div>)}</>);
  };
  return (
    <Marco titulo="Evolución mensual" nota="Cotizaciones presentadas y adjudicaciones por mes de presentación" dato="linea-mensual" rot={rot}>
      {!meses.length ? <Vacio /> : (<>
        <svg viewBox={`0 0 ${W} ${H + Bo}`} width="100%" style={{ maxHeight: 240, display: "block", margin: "0 auto" }} role="img" aria-label={meses.map((m) => `${mesCorto(m.mes)}: ${series.map((s) => `${s.label} ${m[s.k] || 0}`).join(", ")}`).join("; ")}
          onMouseMove={elegir} onTouchStart={elegir} onMouseLeave={() => { setSel(null); rot.ocultar(); }}>
          {Array.from({ length: Math.round(tope / paso) + 1 }, (_, i) => i * paso).map((v) => <g key={v}><line x1={L} x2={W} y1={y(v)} y2={y(v)} stroke={GRILLA} /><text x={L - 4} y={y(v) + 4} fontSize={10} textAnchor="end" fill={TENUE}>{v}</text></g>)}
          {sel !== null && <line x1={x(sel)} x2={x(sel)} y1={4} y2={H} stroke={TENUE} strokeDasharray="3 3" />}
          {series.map((s) => (<g key={s.k}>
            {meses.length > 1 && <polyline points={meses.map((m, i) => `${x(i)},${y(m[s.k] || 0)}`).join(" ")} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
            {meses.map((m, i) => <circle key={i} cx={x(i)} cy={y(m[s.k] || 0)} r={sel === i ? 5 : 4} fill={s.color} stroke={C.card} strokeWidth={2} />)}
          </g>))}
          {meses.map((m, i) => (meses.length <= 8 || i % Math.ceil(meses.length / 8) === 0) && <text key={m.mes} x={x(i)} y={H + 14} fontSize={10} textAnchor="middle" fill={SUAVE}>{mesCorto(m.mes)}</text>)}
        </svg>
        <Leyenda items={series.map((s) => ({ label: s.label, color: s.color, linea: true }))} />
      </>)}
    </Marco>
  );
}

// 4. Barras horizontales: empresas que más adjudicaciones obtuvieron frente a BFK (solo oportunidades perdidas).
export function BarrasCompetidores({ items }) {
  const rot = useRotulo(); const max = Math.max(1, ...items.map((c) => c.n));
  return (
    <Marco titulo="Empresas que ganaron frente a BFK" nota="Oportunidades perdidas con adjudicatario conocido" dato="competidores" rot={rot}>
      {!items.length ? <Vacio texto="Sin adjudicatarios verificados en el período" /> : (
        <div style={{ display: "grid", gap: 7 }}>
          {items.map((c) => (
            <div key={c.rut} data-competidor={c.rut} onMouseMove={(e) => rot.mostrar(e, <><b>{c.nombre}</b><div>RUT {c.rut}</div><div>{c.n} adjudicación{c.n > 1 ? "es" : ""} · {fmt.money(c.monto_total)} total</div></>)}
              onTouchStart={(e) => rot.mostrar(e, <><b>{c.nombre}</b><div>{c.n} · {fmt.money(c.monto_total)}</div></>)}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, marginBottom: 2 }}>
                <span style={{ color: TINTA, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{c.nombre}</span>
                <span style={{ color: SUAVE, fontFamily: MONO, flexShrink: 0 }}><b style={{ color: TINTA }}>{c.n}</b> · {compacto(c.monto_total)}</span>
              </div>
              <div style={{ height: 10, background: "#F1F5F9", borderRadius: 4 }}><div style={{ width: `${(c.n / max) * 100}%`, height: "100%", background: "#EB6834", borderRadius: 4, minWidth: 6 }} /></div>
            </div>
          ))}
        </div>
      )}
    </Marco>
  );
}

// 5. Comparación de montos por mes (solo perdidas comparables: misma base tributaria y total a pagar).
export function ComparacionMontos({ meses }) {
  const rot = useRotulo(); const ms = meses.filter((m) => m.comparables > 0);
  const W = 340, H = 150, L = 46, Bo = 20, max = Math.max(1, ...ms.flatMap((m) => [m.comp_ofertado_total, m.comp_adjudicado_total])); const { tope, paso } = escala(max);
  const grupo = (W - L) / Math.max(1, ms.length), ancho = Math.min(22, grupo / 2 - 6);
  const SER = [{ k: "comp_ofertado_total", label: "Ofertado por BFK", color: "#2A78D6" }, { k: "comp_adjudicado_total", label: "Adjudicado a otra empresa", color: "#EB6834" }];
  return (
    <Marco titulo="Ofertado por BFK vs adjudicado" nota="Total a pagar por el comprador, solo en oportunidades perdidas comparables (misma base tributaria)" dato="comparacion" rot={rot}>
      {!ms.length ? <Vacio texto="Sin oportunidades perdidas comparables en el período" /> : (<>
        <svg viewBox={`0 0 ${W} ${H + Bo}`} width="100%" style={{ maxHeight: 240, display: "block", margin: "0 auto" }} role="img" aria-label={ms.map((m) => `${mesCorto(m.mes)}: BFK ${fmt.money(m.comp_ofertado_total)}, adjudicado ${fmt.money(m.comp_adjudicado_total)}`).join("; ")}>
          {Array.from({ length: Math.round(tope / paso) + 1 }, (_, i) => i * paso).map((v) => { const y = H - (v / tope) * (H - 14); return <g key={v}><line x1={L} x2={W} y1={y} y2={y} stroke={GRILLA} /><text x={L - 4} y={y + 4} fontSize={10} textAnchor="end" fill={TENUE}>{compacto(v)}</text></g>; })}
          {ms.map((m, i) => {
            const cx = L + (i + 0.5) * grupo; const dif = m.comp_ofertado_total - m.comp_adjudicado_total; const pct = m.comp_adjudicado_total ? Math.round((dif / m.comp_adjudicado_total) * 1000) / 10 : null;
            const tip = <><b>{mesCorto(m.mes)}</b> · {m.comparables} comparable{m.comparables > 1 ? "s" : ""}<div>BFK: {fmt.money(m.comp_ofertado_total)}</div><div>Adjudicado: {fmt.money(m.comp_adjudicado_total)}</div><div>Diferencia: {fmt.money(dif)}{pct !== null ? ` (${pct > 0 ? "+" : ""}${String(pct).replace(".", ",")}%)` : ""}</div></>;
            return (
              <g key={m.mes} data-mes-comparacion={m.mes} onMouseMove={(e) => rot.mostrar(e, tip)} onTouchStart={(e) => rot.mostrar(e, tip)}>
                <rect x={cx - grupo / 2} y={0} width={grupo} height={H} fill="transparent" />
                {SER.map((s, j) => { const h = (m[s.k] / tope) * (H - 14), x = cx - ancho - 1 + j * (ancho + 2), y = H - h;
                  return h > 0 && <path key={s.k} d={`M${x},${H} V${y + Math.min(4, h)} q0,-${Math.min(4, h)} ${Math.min(4, ancho / 2)},-${Math.min(4, h)} h${ancho - 2 * Math.min(4, ancho / 2)} q${Math.min(4, ancho / 2)},0 ${Math.min(4, ancho / 2)},${Math.min(4, h)} V${H} Z`} fill={s.color} />; })}
                <text x={cx} y={H + 14} fontSize={10} textAnchor="middle" fill={SUAVE}>{mesCorto(m.mes)}</text>
              </g>
            );
          })}
          <line x1={L} x2={W} y1={H} y2={H} stroke={TENUE} />
        </svg>
        <Leyenda items={SER.map((s) => ({ label: s.label, color: s.color }))} />
      </>)}
    </Marco>
  );
}
