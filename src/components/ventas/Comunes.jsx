// Ventas privadas — piezas de presentación compartidas (las reglas están en lib/ventasPrivadas.js y en la base).
import { useEffect, useMemo, useRef, useState, Children } from "react";
import { C, MONO, R, S, T, cardStyle, iStyle } from "../../lib/theme";
import { Badge, estiloChip } from "../ui/Sistema";
import { Ic } from "../ui/Iconos";
import { Campo, Entrada, Selector, Vacio, estiloBoton } from "../proyectos/Comunes";
import { calcularTotales, pesos, pct, cantidadTxt, etiquetaEstado, tonoEstado, CATEGORIAS_DOCUMENTO, fechaTxt } from "../../lib/ventasPrivadas";
import { buscarProductos, subirDocumento, descargarDocumento, guardarArchivo, TAMANO_MAXIMO } from "../../lib/ventasPrivadasDatos";

export { Vacio, estiloBoton };

export function NoInstalado() {
  return (
    <div data-vp-no-instalado style={{ ...cardStyle, padding: "18px 20px" }}>
      <div style={{ fontWeight: 700, fontSize: T.title, color: C.ink, marginBottom: 6 }}>Ventas privadas aún no está activado</div>
      <div style={{ fontSize: T.sm, color: C.inkMuted, lineHeight: 1.5 }}>El módulo se activa al instalar su migración en la base de datos. Mientras tanto no se guarda nada y Mercado Público funciona igual que siempre.</div>
    </div>
  );
}

export const BadgeVP = ({ mapa, k, dato }) => <Badge tono={tonoEstado(mapa, k)}><span data-estado-vp={dato || k}>{etiquetaEstado(mapa, k)}</span></Badge>;

// Filtro de canal: Todos los canales · Mercado Público · Ventas privadas (Inicio, Alertas, Agenda y Finanzas).
export const CANALES = [{ k: "todos", l: "Todos los canales" }, { k: "mp", l: "Mercado Público" }, { k: "vp", l: "Ventas privadas" }];
export function CanalFiltro({ valor, onCambiar, dato = "canal" }) {
  return (
    <div role="radiogroup" aria-label="Canal de venta" data-canal-filtro={dato} className="bfk-sin-barra" style={{ display: "flex", gap: 6, overflowX: "auto", margin: "0 0 12px", paddingBottom: 2 }}>
      {CANALES.map((c) => {
        const act = valor === c.k;
        return <button key={c.k} type="button" data-compact role="radio" aria-checked={act} data-canal={c.k} onClick={() => onCambiar(c.k)} style={estiloChip(act)}>{c.l}</button>;
      })}
    </div>
  );
}

export function Kpi({ et, v, n, tono, dato, onClick, plano, linea }) {
  const col = { ok: C.okText, warn: C.warnText, danger: C.dangerText, marca: C.tealDark }[tono] || C.ink;
  // linea: conteo en una sola línea (etiqueta · valor), igual que Indicador linea del sistema.
  if (linea) {
    const st = { display: "inline-flex", flexWrap: "wrap", alignItems: "baseline", gap: "0 8px", border: `1px solid ${C.border}`, borderRadius: R.sm, background: C.card, padding: "7px 12px", minHeight: 36, font: "inherit", color: "inherit", boxSizing: "border-box", textAlign: "left", maxWidth: "100%" };
    const c = (<><span style={{ fontSize: T.sm, color: C.inkMuted, whiteSpace: "nowrap" }}>{et}</span><span data-kpi-valor={dato} style={{ fontFamily: MONO, fontWeight: 600, fontSize: T.body, color: col }}>{v}</span>{n && <span style={{ fontSize: T.small, color: C.inkFaint }}>{n}</span>}</>);
    return onClick ? <button type="button" data-compact data-kpi={dato} onClick={onClick} style={{ ...st, cursor: "pointer" }}>{c}</button> : <div data-kpi={dato} style={st}>{c}</div>;
  }
  // plano: dato dentro de una franja (sin tarjeta propia); la nota queda como texto de ayuda al pasar el cursor.
  if (plano) {
    const st = { background: "none", border: "none", padding: "2px 0", textAlign: "left", font: "inherit", color: "inherit", minWidth: 0, minHeight: 0 };
    const c = (<>
      <span style={{ display: "block", fontSize: T.small, color: C.inkMuted, lineHeight: 1.3 }}>{et}</span>
      <span data-kpi-valor={dato} style={{ display: "block", fontFamily: MONO, fontWeight: 600, fontSize: 15, color: col, letterSpacing: -0.3, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v}</span>
    </>);
    return onClick ? <button type="button" data-compact data-kpi={dato} title={n || undefined} onClick={onClick} style={{ ...st, cursor: "pointer" }}>{c}</button> : <div data-kpi={dato} title={n || undefined} style={st}>{c}</div>;
  }
  const cuerpo = (<>
    <span style={{ display: "block", fontSize: T.small, fontWeight: 600, color: C.inkMuted, lineHeight: 1.3 }}>{et}</span>
    <span data-kpi-valor={dato} style={{ display: "block", fontFamily: MONO, fontWeight: 700, fontSize: 18, color: col, letterSpacing: -0.5, marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v}</span>
    {n && <span style={{ display: "block", fontSize: T.small, color: C.inkFaint, marginTop: 3, lineHeight: 1.35 }}>{n}</span>}
  </>);
  const base = { ...cardStyle, borderRadius: R.md, padding: "12px 14px", textAlign: "left", font: "inherit", color: "inherit", minWidth: 0 };
  return onClick ? <button type="button" data-kpi={dato} onClick={onClick} style={{ ...base, cursor: "pointer", width: "100%" }}>{cuerpo}</button> : <div data-kpi={dato} style={base}>{cuerpo}</div>;
}
// desliza: en pantallas angostas, los conteos en una sola fila que se desliza (no ocupan tres o cuatro filas antes de la lista).
export const RejillaKpi = ({ children, linea, desliza }) => linea ? <div className={desliza ? "bfk-sin-barra" : undefined} data-rejilla-desliza={desliza ? "" : undefined} style={{ display: "flex", flexWrap: desliza ? "nowrap" : "wrap", overflowX: desliza ? "auto" : undefined, WebkitOverflowScrolling: "touch", gap: S.sm, marginBottom: S.md, ...(desliza ? { margin: `0 -16px ${S.md}px`, padding: "0 16px" } : {}) }}>{desliza ? Children.map(children, (h) => h && <div style={{ flexShrink: 0 }}>{h}</div>) : children}</div> : <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: S.sm, marginBottom: S.lg }}>{children}</div>;

// Cifras, fechas y folios van en monoespaciada; nombres y textos, en la letra normal (un nombre largo en negrita monoespaciada
// pesaba más que los montos). El valor puede ocupar varias líneas: nunca se corta.
const esCifra = (v) => typeof v === "number" || (typeof v === "string" && /^[\s$\d.,:%/()+\-−–·A-Z]*$/.test(v) && /\d/.test(v));
export const Fila = ({ k, v, fuerte, tono, dato }) => {
  const cifra = fuerte || esCifra(v);
  return (
    <div data-fila-vp={dato} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, padding: "7px 0", borderBottom: `1px solid ${C.border}` }}>
      <span style={{ fontSize: T.sm, color: fuerte ? C.ink : C.inkMuted, fontWeight: fuerte ? 700 : 500, flexShrink: 0, maxWidth: "50%" }}>{k}</span>
      <span style={{ fontFamily: cifra ? MONO : "inherit", fontWeight: fuerte ? 700 : cifra ? 600 : 500, fontSize: fuerte ? 16 : 14, color: { ok: C.okText, warn: C.warnText, danger: C.dangerText }[tono] || C.ink, textAlign: "right", minWidth: 0, overflowWrap: "anywhere" }}>{v}</span>
    </div>
  );
};

export function SelectorCliente({ clientes, valor, onCambiar, onNuevo, deshabilitado }) {
  const [q, setQ] = useState("");
  const lista = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (clientes || []).filter((c) => c.activo !== false && (!s || `${c.razon_social} ${c.rut || ""}`.toLowerCase().includes(s))).slice(0, 50);
  }, [clientes, q]);
  const sel = (clientes || []).find((c) => c.id === valor);
  if (sel) return (
    <div data-cliente-elegido style={{ background: C.tealLight, border: `1px solid ${C.teal}`, borderRadius: R.sm, padding: "9px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
      <div style={{ minWidth: 0 }}><div style={{ fontWeight: 700, fontSize: T.sm, color: C.ink }}>{sel.razon_social}</div><div style={{ fontSize: T.small, color: C.inkMuted, fontFamily: MONO }}>{sel.rut || "Sin RUT"}</div></div>
      {!deshabilitado && <button type="button" onClick={() => onCambiar(null)} style={{ ...estiloBoton(), minHeight: 34 }}>Cambiar</button>}
    </div>
  );
  return (
    <div>
      <div style={{ display: "flex", gap: 6 }}>
        <Entrada data-buscar-cliente placeholder="Buscar cliente por nombre o RUT" value={q} onChange={(e) => setQ(e.target.value)} />
        {onNuevo && <button type="button" data-nuevo-cliente-rapido onClick={onNuevo} style={{ ...estiloBoton(), minHeight: 42 }}>+ Cliente</button>}
      </div>
      <div style={{ maxHeight: 210, overflowY: "auto", marginTop: 6, border: `1px solid ${C.border}`, borderRadius: R.sm, background: C.card }}>
        {lista.map((c) => (
          <button key={c.id} type="button" data-opcion-cliente={c.rut || c.id} onClick={() => onCambiar(c.id)}
            style={{ width: "100%", textAlign: "left", background: "none", border: "none", borderBottom: `1px solid ${C.border}`, padding: "8px 10px", cursor: "pointer", minHeight: 40 }}>
            <span style={{ display: "block", fontSize: T.sm, fontWeight: 600, color: C.ink }}>{c.razon_social}</span>
            <span style={{ fontSize: T.small, color: C.inkMuted, fontFamily: MONO }}>{c.rut || "Sin RUT"}{c.es_venta_privada ? "" : " · cliente de Proyectos Industriales"}</span>
          </button>
        ))}
        {!lista.length && <div style={{ padding: 10, fontSize: T.sm, color: C.inkFaint }}>Sin resultados. Registra el cliente con «+ Cliente».</div>}
      </div>
    </div>
  );
}

// ── Editor de líneas (cotización privada y venta directa) ──────────────────────────────────────────
export const lineaVacia = () => ({ _k: Math.random().toString(36).slice(2), tipo: "producto", producto_id: null, codigo: "", descripcion: "", unidad: "UN", cantidad: 1, precio_unitario: "", descuento_pct: 0, costo_unitario: "" });
export function EditorLineas({ token, items, onCambiar, verCostos, soloLectura }) {
  const tot = calcularTotales(items);
  const set = (i, campo, valor) => onCambiar(items.map((x, j) => (j === i ? { ...x, [campo]: valor } : x)));
  const quitar = (i) => onCambiar(items.filter((_, j) => j !== i));
  const mover = (i, d) => { const j = i + d; if (j < 0 || j >= items.length) return; const n = [...items]; [n[i], n[j]] = [n[j], n[i]]; onCambiar(n); };
  const [buscando, setBuscando] = useState(null);
  const inp = { ...iStyle, minHeight: 38, padding: "7px 9px", fontSize: 13 };
  return (
    <div data-editor-lineas>
      {items.map((it, i) => {
        const l = tot.lineas[i];
        return (
          <div key={it._k || it.id || i} data-linea={i + 1} style={{ ...cardStyle, borderRadius: R.md, padding: "10px 12px", marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ fontFamily: MONO, fontWeight: 700, color: C.tealDark, minWidth: 26 }}>{i + 1}</span>
              <select aria-label="Tipo" disabled={soloLectura} value={it.tipo} onChange={(e) => set(i, "tipo", e.target.value)} style={{ ...inp, width: 120 }}>
                <option value="producto">Producto</option><option value="servicio">Servicio</option>
              </select>
              {it.producto_id && <Badge tono="info">Biblioteca</Badge>}
              <span style={{ flex: 1 }} />
              {!soloLectura && <>
                <button type="button" aria-label="Subir línea" onClick={() => mover(i, -1)} style={{ ...estiloBoton(), minHeight: 32, padding: "4px 8px" }}>↑</button>
                <button type="button" aria-label="Bajar línea" onClick={() => mover(i, 1)} style={{ ...estiloBoton(), minHeight: 32, padding: "4px 8px" }}>↓</button>
                <button type="button" data-quitar-linea aria-label="Quitar línea" onClick={() => quitar(i)} style={{ ...estiloBoton("peligro"), minHeight: 32, padding: "4px 8px" }}>✕</button>
              </>}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(110px,1fr))", gap: 8 }}>
              <label style={{ gridColumn: "1 / -1" }}><span style={{ fontSize: 12, fontWeight: 600, color: C.inkMuted }}>Descripción</span>
                <div style={{ display: "flex", gap: 6 }}>
                  <textarea data-campo="descripcion" disabled={soloLectura} rows={2} value={it.descripcion} onChange={(e) => set(i, "descripcion", e.target.value)} style={{ ...inp, minHeight: 52, resize: "vertical", fontFamily: "inherit", flex: 1 }} />
                  {!soloLectura && token && <button type="button" data-elegir-producto onClick={() => setBuscando(i)} title="Elegir de la biblioteca de productos" style={{ ...estiloBoton(), minHeight: 52 }}><Ic n="📋" /></button>}
                </div>
              </label>
              <label><span style={{ fontSize: 12, fontWeight: 600, color: C.inkMuted }}>Código</span><input disabled={soloLectura} value={it.codigo || ""} onChange={(e) => set(i, "codigo", e.target.value)} style={inp} /></label>
              <label><span style={{ fontSize: 12, fontWeight: 600, color: C.inkMuted }}>Unidad</span><input data-campo="unidad" disabled={soloLectura} value={it.unidad} onChange={(e) => set(i, "unidad", e.target.value)} style={inp} maxLength={20} /></label>
              <label><span style={{ fontSize: 12, fontWeight: 600, color: C.inkMuted }}>Cantidad</span><input data-campo="cantidad" disabled={soloLectura} inputMode="decimal" value={it.cantidad} onChange={(e) => set(i, "cantidad", e.target.value)} style={{ ...inp, fontFamily: MONO }} /></label>
              <label><span style={{ fontSize: 12, fontWeight: 600, color: C.inkMuted }}>Precio unit. neto</span><input data-campo="precio" disabled={soloLectura} inputMode="decimal" value={it.precio_unitario} onChange={(e) => set(i, "precio_unitario", e.target.value)} style={{ ...inp, fontFamily: MONO }} /></label>
              <label><span style={{ fontSize: 12, fontWeight: 600, color: C.inkMuted }}>Descuento %</span><input data-campo="descuento" disabled={soloLectura} inputMode="decimal" value={it.descuento_pct} onChange={(e) => set(i, "descuento_pct", e.target.value)} style={{ ...inp, fontFamily: MONO }} /></label>
              {verCostos && <label><span style={{ fontSize: 12, fontWeight: 600, color: C.warnText }}>Costo unit. (interno)</span><input data-campo="costo" disabled={soloLectura} inputMode="decimal" value={it.costo_unitario ?? ""} onChange={(e) => set(i, "costo_unitario", e.target.value)} style={{ ...inp, fontFamily: MONO, borderColor: "#F5D38A" }} /></label>}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 14, flexWrap: "wrap", marginTop: 8, fontSize: T.small, color: C.inkMuted }}>
              {l.descuento > 0 && <span>Descuento <b style={{ fontFamily: MONO }}>{pesos(l.descuento)}</b></span>}
              <span>Subtotal neto <b data-subtotal-linea style={{ fontFamily: MONO, color: C.ink }}>{pesos(l.neto)}</b></span>
              {verCostos && l.costo != null && <span style={{ color: l.utilidad < 0 ? C.dangerText : C.okText }}>Utilidad <b style={{ fontFamily: MONO }}>{pesos(l.utilidad)}</b> · {pct(l.neto > 0 ? l.utilidad / l.neto : null)}</span>}
            </div>
          </div>
        );
      })}
      {!items.length && <Vacio>Sin líneas.</Vacio>}
      {!soloLectura && <button type="button" data-agregar-linea onClick={() => onCambiar([...items, lineaVacia()])} style={{ ...estiloBoton(), width: "100%", minHeight: 44, marginTop: 4 }}>+ Agregar línea</button>}
      {buscando != null && <BuscadorProducto token={token} onCerrar={() => setBuscando(null)} onElegir={(p) => {
        const i = buscando; setBuscando(null);
        onCambiar(items.map((x, j) => (j === i ? { ...x, producto_id: p.id, descripcion: [p.nombre, p.marca, p.modelo].filter(Boolean).join(" · "), tipo: x.tipo } : x)));
      }} />}
    </div>
  );
}

function BuscadorProducto({ token, onElegir, onCerrar }) {
  const [q, setQ] = useState(""); const [res, setRes] = useState(null); const [err, setErr] = useState("");
  const t = useRef(null);
  const buscar = (s) => { setQ(s); clearTimeout(t.current); t.current = setTimeout(async () => { try { setRes(await buscarProductos(token, s.trim())); setErr(""); } catch (e) { setErr(e.message); } }, 300); };
  useEffect(() => { buscar(""); return () => clearTimeout(t.current); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div data-buscador-producto style={{ position: "fixed", inset: 0, zIndex: 90, background: "rgba(11,17,32,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onMouseDown={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
      <div style={{ background: C.card, borderRadius: R.xl, width: "min(520px,100%)", maxHeight: "80vh", display: "flex", flexDirection: "column", padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}><b>Biblioteca de productos</b><button type="button" onClick={onCerrar} style={estiloBoton()}>✕</button></div>
        <Entrada autoFocus placeholder="Nombre, marca o modelo" value={q} onChange={(e) => buscar(e.target.value)} />
        {err && <div style={{ color: C.dangerText, fontSize: T.small, marginTop: 6 }}>{err}</div>}
        <div style={{ overflowY: "auto", marginTop: 8 }}>
          {(res || []).map((p) => (
            <button key={p.id} type="button" data-producto-opcion={p.id} onClick={() => onElegir(p)} style={{ width: "100%", textAlign: "left", background: "none", border: "none", borderBottom: `1px solid ${C.border}`, padding: "8px 6px", cursor: "pointer" }}>
              <span style={{ display: "block", fontWeight: 600, fontSize: T.sm }}>{p.nombre}</span>
              <span style={{ fontSize: T.small, color: C.inkMuted }}>{[p.marca, p.modelo].filter(Boolean).join(" · ") || "Sin marca ni modelo"}</span>
            </button>
          ))}
          {res && !res.length && <div style={{ padding: 10, color: C.inkFaint, fontSize: T.sm }}>Sin resultados.</div>}
        </div>
      </div>
    </div>
  );
}

export function ResumenTotales({ tot, verCostos, dato = "totales" }) {
  return (
    <div data-resumen={dato} style={{ ...cardStyle, borderRadius: R.md, padding: "10px 14px" }}>
      {tot.descuento > 0 && <><Fila k="Subtotal (antes de descuentos)" v={pesos(tot.bruto)} /><Fila k="Descuentos" v={`−${pesos(tot.descuento)}`} /></>}
      <Fila k="Neto" v={pesos(tot.neto)} dato="neto" />
      <Fila k={tot.iva > 0 ? "IVA 19 %" : "IVA (exenta)"} v={pesos(tot.iva)} dato="iva" />
      <Fila k="Total" v={pesos(tot.total)} fuerte dato="total" />
      {verCostos && (
        <div data-margen-interno style={{ marginTop: 10, background: C.warnLight, borderRadius: R.sm, padding: "8px 10px" }}>
          <div style={{ fontSize: T.small, fontWeight: 700, color: C.warnText, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 2, display: "flex", alignItems: "center", gap: 6 }}><Ic n="🔒" /> Interno · no aparece en el PDF</div>
          <Fila k="Costo estimado" v={pesos(tot.costo)} dato="costo" />
          <Fila k="Utilidad estimada" v={pesos(tot.utilidad)} tono={tot.utilidad < 0 ? "danger" : "ok"} dato="utilidad" />
          <Fila k="Margen sobre venta neta" v={pct(tot.margen)} dato="margen" />
          {tot.sinCosto > 0 && <div style={{ fontSize: T.small, color: C.warnText, marginTop: 4 }}>{tot.sinCosto} línea{tot.sinCosto > 1 ? "s" : ""} sin costo registrado: la utilidad no las descuenta.</div>}
        </div>
      )}
    </div>
  );
}

// ── Archivos ───────────────────────────────────────────────────────────────────────────────────────
export function SubirArchivo({ token, ambito, id, categorias, habilitado, onSubido, showToast, etiqueta = "Adjuntar archivo", categoriaInicial }) {
  const [cat, setCat] = useState(categoriaInicial || categorias[0]); const [titulo, setTitulo] = useState(""); const [archivo, setArchivo] = useState(null); const [ocupado, setOcupado] = useState(false);
  if (!habilitado) return <div data-documentos-deshabilitados style={{ fontSize: T.small, color: C.inkMuted, background: C.paper, border: `1px dashed ${C.border}`, borderRadius: R.sm, padding: "8px 10px" }}><Ic n="🔒" /> La carga de archivos está deshabilitada hasta que un administrador active su respaldo (Administración › Ventas privadas).</div>;
  const subir = async () => {
    if (!archivo) return; setOcupado(true);
    try { const r = await subirDocumento(token, { ambito, id, categoria: cat, titulo: titulo.trim() || archivo.name, archivo }); showToast?.("Archivo adjuntado"); setArchivo(null); setTitulo(""); onSubido?.(r, cat); }
    catch (e) { showToast?.(e.message, "error"); } finally { setOcupado(false); }
  };
  return (
    <div data-subir-archivo style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 8, alignItems: "end" }}>
      {categorias.length > 1 && <Campo etiqueta="Tipo"><Selector value={cat} onChange={(e) => setCat(e.target.value)} opciones={categorias.map((c) => ({ v: c, l: CATEGORIAS_DOCUMENTO[c] }))} /></Campo>}
      <Campo etiqueta="Título (opcional)"><Entrada value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={200} /></Campo>
      <Campo etiqueta={`Archivo (máx. ${Math.round(TAMANO_MAXIMO / 1048576)} MB)`}><input data-input-archivo type="file" onChange={(e) => setArchivo(e.target.files?.[0] || null)} style={{ fontSize: T.small, maxWidth: "100%" }} /></Campo>
      <button type="button" data-subir disabled={!archivo || ocupado} onClick={subir} style={{ ...estiloBoton("pri"), minHeight: 42, marginBottom: S.md, opacity: !archivo || ocupado ? 0.6 : 1 }}>{ocupado ? "Subiendo…" : etiqueta}</button>
    </div>
  );
}
export function ListaDocumentos({ token, documentos, onAnular, showToast }) {
  const [bajando, setBajando] = useState(null);
  if (!documentos?.length) return <Vacio dato="sin-documentos">Sin archivos adjuntos.</Vacio>;
  const bajar = async (d) => { setBajando(d.id); try { guardarArchivo(await descargarDocumento(token, d), d.nombre_archivo); } catch (e) { showToast?.(e.message, "error"); } finally { setBajando(null); } };
  return documentos.map((d) => (
    <div key={d.id} data-documento={d.categoria} style={{ ...cardStyle, borderRadius: R.md, padding: "9px 12px", marginBottom: 6, display: "flex", alignItems: "center", gap: 10, opacity: d.estado === "vigente" ? 1 : 0.55 }}>
      <Ic n="📄" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: T.sm, color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.titulo}</div>
        <div style={{ fontSize: T.small, color: C.inkMuted }}>{CATEGORIAS_DOCUMENTO[d.categoria] || d.categoria} · {d.nombre_archivo} · {fechaTxt(String(d.subido_en).slice(0, 10))}{d.estado !== "vigente" ? ` · anulado: ${d.anulacion_motivo || ""}` : ""}</div>
      </div>
      <button type="button" data-descargar-documento onClick={() => bajar(d)} disabled={bajando === d.id} style={estiloBoton()}>{bajando === d.id ? "…" : <Ic n="📥" />}</button>
      {onAnular && d.estado === "vigente" && <button type="button" onClick={() => onAnular(d)} style={estiloBoton("peligro")}>Anular</button>}
    </div>
  ));
}

export const textoCantidad = cantidadTxt;
