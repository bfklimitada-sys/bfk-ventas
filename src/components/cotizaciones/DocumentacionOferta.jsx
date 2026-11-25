import { useEffect, useMemo, useRef, useState } from "react";
import { C, T, R, iStyle, selStyle } from "../../lib/theme";
import { Seccion, Tarjeta, Badge, AvisoLinea, BotonPrincipal, BotonSecundario, Desplegable } from "../ui/Sistema";
import { descargarBlob } from "../../lib/eettPdf";
import { TIPOS_DOCUMENTO, revisarModeloOferta } from "../../lib/documentosOferta";
import { generarDocumento, descargarDocumentoEmitido } from "../../lib/documentosOfertaDescarga";
import { CAMPOS_CONDICIONES, ESTADOS_CUMPLIMIENTO } from "../../lib/modeloOferta";
import { leerCondicionesOferta, guardarCondicionesOferta, listarDocumentosOferta, emitirDocumentoOferta, huellaContenido, versionPara } from "../../lib/documentosOfertaDatos";
import { VisorDocumento } from "./VisorDocumento";

// «Documentación de la oferta» (25/11/2026): dentro de cada cotización (Mercado Público y Ventas privadas, mismo
// componente). Tres documentos —Oferta técnica y económica (principal), Cotización económica y EETT— con vista previa,
// descarga, emisión definitiva e historial de versiones; condiciones comerciales y matriz de cumplimiento técnico.
// props:
//   canal "mp" | "vp"; cotizacionId (null si aún no se guarda); token; showToast
//   construirModelo({ version, condiciones, matriz }) → Promise<modelo público> (desde lo que está en pantalla)
//   asegurarGuardado() → Promise<boolean>: guarda la cotización si tiene cambios (la emisión usa SIEMPRE lo guardado)
//   propios: [{ titulo, valor, k }] condiciones que vienen de la propia cotización (se muestran, se editan en Datos)
//   ocultar: claves de CAMPOS_CONDICIONES que la cotización ya tiene como campo propio
//   sugeridas: { clave: texto } valor que se imprime si el campo queda vacío (p. ej. despacho «Incluido en el valor unitario»)
//   camposPropios: campos editables de la propia cotización que se muestran dentro de esta sección (Ventas privadas: vigencia,
//     forma de pago, condiciones y observaciones de la revisión) · onIrA(pestaña): enlace «Cambiar en Productos»
//   items: [{ n, nombre }] (para asociar requisitos); propuestaMatriz(): requisitos del comprador (opcional)
//   soloLectura: revisión que ya no se edita (no se cambian condiciones ni matriz; sí se emiten sus documentos)
//   puedeEmitir: false al ver una revisión anterior (solo vista previa y descarga)
//   cambiosSinGuardar: la cotización tiene cambios sin guardar (se recuerda si BFK Datos pide actualizarse)
const ORDEN = ["oferta", "cotizacion", "eett"];
const DESCRIPCION = {
  oferta: "Un solo PDF con la cotización, las condiciones comerciales, las fichas técnicas de todos los productos y la matriz de cumplimiento. Es la opción principal para presentar la oferta completa.",
  cotizacion: "Detalle de productos, cantidades, precios netos, IVA, total y condiciones comerciales.",
  eett: "Fichas técnicas de todos los productos (fotografías, especificaciones y condiciones). Sin información económica.",
};
const fechaHora = (iso) => { try { return new Date(iso).toLocaleString("es-CL", { timeZone: "America/Santiago", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }); } catch { return iso; } };

export function DocumentacionOferta({ canal, cotizacionId, token, showToast, construirModelo, asegurarGuardado, propios = [], ocultar = [], sugeridas = {}, origenes = {}, avisos = {}, camposPropios = null, onIrA, pendientes, items = [], propuestaMatriz, soloLectura = false, puedeEmitir = true, cambiosSinGuardar = false }) {
  const [instalada, setInstalada] = useState(null);          // null = consultando · true · false
  const [condiciones, setCondiciones] = useState({}); const [matriz, setMatriz] = useState([]);
  const [guardadas, setGuardadas] = useState("{}"); const [historial, setHistorial] = useState([]);
  const [previa, setPrevia] = useState(null); const [ocupado, setOcupado] = useState(""); const [emitido, setEmitido] = useState(null);
  const [error, setError] = useState("");
  const tokenRef = useRef(token); tokenRef.current = token;
  const sinGuardar = JSON.stringify({ condiciones, matriz }) !== guardadas;

  const cargar = async () => {
    if (!cotizacionId) { setInstalada((x) => x ?? true); return; }
    try {
      const [c, h] = await Promise.all([leerCondicionesOferta(tokenRef.current, canal, cotizacionId), listarDocumentosOferta(tokenRef.current, canal, cotizacionId)]);
      // Lo escrito antes de guardar la cotización por primera vez no se pierde: si la base aún no tiene condiciones, se
      // conservan las de pantalla (y el guardado automático las registra).
      const vacias = !Object.values(c.condiciones || {}).some((v) => String(v || "").trim()) && !(c.matriz || []).length;
      setGuardadas(JSON.stringify({ condiciones: c.condiciones || {}, matriz: c.matriz || [] }));
      if (!vacias) { setCondiciones(c.condiciones || {}); setMatriz(c.matriz || []); }
      setHistorial(h); setInstalada(true);
    } catch (e) { if (e.codigo === "NO_INSTALADA") setInstalada(false); else setError(e.message); }
  };
  useEffect(() => { cargar(); }, [canal, cotizacionId]);   // eslint-disable-line react-hooks/exhaustive-deps

  const setCond = (k, v) => setCondiciones((c) => ({ ...c, [k]: v }));
  // Cotización nueva (sin guardar): lo escrito aquí se entrega al editor, que lo guarda junto con la cotización (al guardarla por
  // primera vez el editor se vuelve a abrir con la cotización guardada y esta sección se monta de nuevo).
  useEffect(() => { if (pendientes) pendientes.current = !cotizacionId && sinGuardar ? { condiciones, matriz } : null; });
  // Guardado automático (25/11/2026): las condiciones y la matriz se guardan solas poco después de escribirlas (sin un segundo
  // botón «Guardar» que obligue a volver). Solo con la cotización ya guardada y la actualización instalada.
  useEffect(() => {
    if (!sinGuardar || soloLectura || !cotizacionId || !instalada) return undefined;
    const t = setTimeout(() => { guardarCondiciones({ silencioso: true }).catch((e) => setError(e.message)); }, 1200);
    return () => clearTimeout(t);
  }, [condiciones, matriz, guardadas, cotizacionId, instalada, soloLectura]);   // eslint-disable-line react-hooks/exhaustive-deps
  const guardarCondiciones = async ({ silencioso } = {}) => {
    if (!cotizacionId || !instalada) return false;
    await guardarCondicionesOferta(tokenRef.current, canal, cotizacionId, condiciones, matriz);
    setGuardadas(JSON.stringify({ condiciones, matriz }));
    if (!silencioso) showToast?.("Condiciones de la oferta guardadas.");
    return true;
  };

  // Modelo con su versión: la de una emisión anterior con la misma información, o la siguiente.
  const modeloConVersion = async () => {
    const m0 = await construirModelo({ version: 1, condiciones, matriz });
    const hc = await huellaContenido(m0);
    return { modelo: { ...m0, version: versionPara(historial, hc) }, huellaContenido: hc };
  };
  const generar = (tipo, modelo) => generarDocumento(tokenRef.current, tipo, modelo);

  const verPrevia = async (tipo) => {
    setError(""); setOcupado(`previa-${tipo}`); setEmitido(null);
    try {
      const { modelo, huellaContenido: hc } = await modeloConVersion();
      const r = await generar(tipo, modelo);
      setPrevia({ ...r, tipo, modelo, huellaContenido: hc, titulo: TIPOS_DOCUMENTO[tipo].nombre, version: modelo.version, avisos: revisarModeloOferta(modelo, tipo) });
    } catch (e) { setError(mensajeError(e)); } finally { setOcupado(""); }
  };
  // Versión nueva publicada mientras la pestaña estaba abierta: se avisa sin perder nada (los cambios siguen en pantalla).
  const mensajeError = (e) => `${e?.message || String(e)}${e?.versionNueva && cambiosSinGuardar ? " Tus cambios aún NO están guardados: pulsa Guardar antes de actualizar." : ""}`;
  const descargarActual = async (tipo) => {
    setError(""); setOcupado(`descargar-${tipo}`);
    try {
      const { modelo } = await modeloConVersion(); const r = await generar(tipo, modelo);
      descargarBlob(r.blob, r.nombre.replace(/\.pdf$/, "_sin-emitir.pdf"));
      showToast?.("PDF descargado sin emitir: no queda en el historial. Para presentarlo, emite la versión definitiva.");
    } catch (e) { setError(mensajeError(e)); } finally { setOcupado(""); }
  };

  // Emisión: se guarda lo pendiente, se reconstruye el documento desde lo GUARDADO y debe ser idéntico a la vista previa.
  const emitir = async () => {
    if (!previa) return;
    if (!window.confirm(`¿Emitir la versión ${String(previa.version).padStart(2, "0")} definitiva de «${previa.titulo}»? Quedará en el historial y no se podrá modificar.`)) return;
    setError(""); setOcupado("emitir");
    try {
      if (!(await asegurarGuardado())) throw new Error("No se pudo guardar la cotización: no se emitió nada.");
      if (sinGuardar && !soloLectura) await guardarCondiciones({ silencioso: true });
      const { modelo, huellaContenido: hc } = await modeloConVersion();
      const r = await generar(previa.tipo, modelo);
      if (r.huellaModelo !== previa.huellaModelo || r.huellaPdf !== previa.huellaPdf) {
        setPrevia({ ...r, tipo: previa.tipo, modelo, huellaContenido: hc, titulo: previa.titulo, version: modelo.version, avisos: revisarModeloOferta(modelo, previa.tipo) });
        throw new Error("La información cambió desde la vista previa (o al guardarse). Se actualizó la vista previa: revísala y vuelve a emitir.");
      }
      const res = await emitirDocumentoOferta(tokenRef.current, canal, cotizacionId, { tipo: previa.tipo, modelo, huellaContenido: hc, huellaModelo: r.huellaModelo, huellaPdf: r.huellaPdf, paginas: r.paginas, nombre: r.nombre });
      descargarBlob(r.blob, r.nombre);
      setEmitido(res?.existente ? `Esta versión ya estaba emitida (${fechaHora(res.emitido_en)}): se descargó el mismo documento.` : `Versión ${String(modelo.version).padStart(2, "0")} emitida y descargada (${r.nombre}).`);
      showToast?.(`${previa.titulo}: versión ${String(modelo.version).padStart(2, "0")} emitida.`);
      setHistorial(await listarDocumentosOferta(tokenRef.current, canal, cotizacionId));
    } catch (e) {
      setError(e.codigo === "OFERTA_VERSION" ? `${e.message}` : e.codigo === "NO_INSTALADA" ? "La emisión requiere instalar la actualización de documentos de la oferta. Puedes ver y descargar el PDF sin emitir." : (e.message || String(e)));
    } finally { setOcupado(""); }
  };

  const descargarEmitido = async (d) => {
    setError(""); setOcupado(`hist-${d.id}`);
    try {
      const r = await descargarDocumentoEmitido(tokenRef.current, d.id);
      if (!r.identico) showToast?.("Atención: el archivo regenerado no es idéntico byte a byte al emitido (cambió la fuente, el logo o una imagen). Su contenido es el mismo modelo emitido.", "error");
      else showToast?.(`Descargado ${r.nombre} (idéntico al emitido).`);
    } catch (e) { setError(e.message || String(e)); } finally { setOcupado(""); }
  };

  const porTipo = useMemo(() => Object.fromEntries(ORDEN.map((t) => [t, historial.filter((h) => h.tipo === t)])), [historial]);
  // «Tipo de días» ya va con el plazo de cada producto: el campo solo aparece si una cotización antigua lo tiene guardado.
  const campos = CAMPOS_CONDICIONES.filter((c) => !ocultar.includes(c.k) && (!c.antiguo || String(condiciones[c.k] || "").trim()));
  const propuesta = propuestaMatriz ? propuestaMatriz() : [];

  return (
    <div data-documentacion-oferta>
      <Seccion titulo="Documentación de la oferta" nota="Vista previa, descarga y emisión de los tres documentos. La vista previa es exactamente el PDF que se emite.">
        {instalada === false && <AvisoLinea tono="info" dato="oferta-no-instalada">La emisión con historial y las condiciones guardadas estarán disponibles al instalar la actualización. Mientras tanto puedes ver y descargar los PDF (sin emitir).</AvisoLinea>}
        {!cotizacionId && <AvisoLinea tono="info" dato="oferta-sin-guardar">Guarda la cotización para emitir documentos. La vista previa ya está disponible.</AvisoLinea>}
        {error && <AvisoLinea tono="danger" dato="oferta-error">{error}</AvisoLinea>}
        {ORDEN.map((tipo) => {
          const ult = porTipo[tipo]?.[0];
          return (
            <Tarjeta key={tipo} padding="12px 14px" data-documento-oferta={tipo} style={tipo === "oferta" ? { border: `1.5px solid ${C.teal}` } : undefined}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: T.sm, fontWeight: 700, color: C.ink }}>{TIPOS_DOCUMENTO[tipo].nombre}{tipo === "oferta" ? " · principal" : ""}</div>
                  <div style={{ fontSize: T.small, color: C.inkMuted, marginTop: 2 }}>{DESCRIPCION[tipo]}</div>
                </div>
                {ult ? <Badge tono="ok">v{String(ult.version).padStart(2, "0")} emitida</Badge> : <Badge tono="neutro">Sin emitir</Badge>}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                <BotonPrincipal data-previa-documento={tipo} onClick={() => verPrevia(tipo)} disabled={!!ocupado || !items.length} style={{ flex: "2 1 160px", justifyContent: "center", minHeight: 44 }}>
                  {ocupado === `previa-${tipo}` ? "Preparando…" : !puedeEmitir || !cotizacionId || !instalada ? "Vista previa" : "Vista previa y emitir"}</BotonPrincipal>
                <BotonSecundario data-descargar-documento={tipo} onClick={() => descargarActual(tipo)} disabled={!!ocupado || !items.length} style={{ flex: "1 1 120px", justifyContent: "center", minHeight: 44 }}>
                  {ocupado === `descargar-${tipo}` ? "Generando…" : "Descargar PDF"}</BotonSecundario>
              </div>
              {porTipo[tipo]?.length > 0 && (
                <Desplegable dato={`historial-${tipo}`} titulo="Historial de versiones" resumen={`${porTipo[tipo].length} emitida${porTipo[tipo].length === 1 ? "" : "s"}`} plano>
                  {porTipo[tipo].map((d) => (
                    <div key={d.id} data-version-emitida={d.version} style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between", fontSize: T.small, color: C.inkMuted, padding: "6px 0", borderBottom: `1px solid ${C.border}` }}>
                      <span>v{String(d.version).padStart(2, "0")} · {fechaHora(d.emitido_en)}{d.emitido_por_nombre ? ` · ${d.emitido_por_nombre}` : ""} · {d.paginas} pág.</span>
                      <button type="button" data-descargar-emitido={d.id} onClick={() => descargarEmitido(d)} disabled={!!ocupado} style={{ border: "none", background: "none", color: C.tealDark, textDecoration: "underline", cursor: "pointer", fontSize: T.small }}>
                        {ocupado === `hist-${d.id}` ? "Generando…" : "Descargar"}</button>
                    </div>
                  ))}
                </Desplegable>
              )}
            </Tarjeta>
          );
        })}
      </Seccion>

      <Seccion titulo="Condiciones comerciales" nota="El plazo y el despacho ya vienen de Productos (puedes reemplazarlos). Lo demás solo se imprime si lo completas.">
        {propios.filter((p) => String(p.valor || "").trim() || p.aviso).map((p) => (
          <div key={p.titulo} data-condicion-propia={p.k || p.titulo} style={{ fontSize: T.small, color: C.inkMuted, marginBottom: 8 }}>
            <b style={{ color: C.ink }}>{p.titulo}:</b> {p.valor || <span style={{ color: C.warnText, fontWeight: 600 }}>sin indicar</span>}
            {p.origen && <span style={{ color: C.inkFaint }}> ({p.origen})</span>}
            {p.aviso && <div style={{ color: C.warnText }}>{p.aviso}</div>}
            {p.ir && onIrA && !soloLectura && <button type="button" data-compact data-ir-a={p.ir} onClick={() => onIrA(p.ir)} style={{ border: "none", background: "none", padding: "2px 0", color: C.tealDark, fontSize: T.small, fontWeight: 600, textDecoration: "underline", cursor: "pointer" }}>Cambiar en Productos</button>}
          </div>
        ))}
        {camposPropios}
        <fieldset disabled={soloLectura} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
          {campos.map((c) => (
            <label key={c.k} style={{ display: "block", fontSize: T.small, color: C.inkMuted }} data-condicion={c.k}>
              {c.titulo}
              {c.opciones ? (
                <select value={condiciones[c.k] || ""} onChange={(e) => setCond(c.k, e.target.value)} style={{ ...selStyle, width: "100%", marginTop: 4 }}>
                  {c.opciones.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              ) : c.multilinea ? (
                <textarea rows={2} value={condiciones[c.k] || ""} onChange={(e) => setCond(c.k, e.target.value)} style={{ ...iStyle, width: "100%", marginTop: 4, resize: "vertical" }} />
              ) : (
                <>
                  <input value={condiciones[c.k] || ""} placeholder={sugeridas[c.k] || c.ayuda || ""} onChange={(e) => setCond(c.k, e.target.value)} style={{ ...iStyle, width: "100%", marginTop: 4 }} />
                  {sugeridas[c.k] && !String(condiciones[c.k] || "").trim() && <span data-sugerida={c.k} style={{ display: "block", fontSize: T.small, color: C.inkFaint, marginTop: 2 }}>Vacío: se imprime «{sugeridas[c.k]}»{origenes[c.k] ? ` (${origenes[c.k]})` : ""}.</span>}
                  {avisos[c.k] && !String(condiciones[c.k] || "").trim() && <span data-aviso-condicion={c.k} style={{ display: "block", fontSize: T.small, color: C.warnText, marginTop: 2 }}>{avisos[c.k]}{onIrA && !soloLectura && <> <button type="button" data-compact data-ir-a="productos" onClick={() => onIrA("productos")} style={{ border: "none", background: "none", padding: 0, color: C.tealDark, fontSize: T.small, fontWeight: 600, textDecoration: "underline", cursor: "pointer" }}>Ir a Productos</button></>}</span>}
                </>
              )}
            </label>
          ))}
        </fieldset>
      </Seccion>

      <Seccion titulo="Matriz de cumplimiento técnico" nota="Solo con requisitos reales del comprador. Nada se declara «Cumple» automáticamente.">
        {!matriz.length && propuesta.length > 0 && !soloLectura && (
          <BotonSecundario data-proponer-matriz onClick={() => setMatriz(propuesta)} style={{ minHeight: 40, marginBottom: 8 }}>Usar los {propuesta.length} requerimientos del comprador</BotonSecundario>
        )}
        {!matriz.length && <div style={{ fontSize: T.small, color: C.inkFaint, marginBottom: 6 }}>Sin requisitos: los documentos no incluyen matriz.</div>}
        <fieldset disabled={soloLectura} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          {matriz.map((r, i) => {
            const set = (k, v) => setMatriz((m) => m.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
            return (
              <div key={i} data-requisito={i} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 6, padding: "8px 0", borderBottom: `1px solid ${C.border}` }}>
                <select aria-label="Producto" value={r.item || ""} onChange={(e) => set("item", e.target.value ? Number(e.target.value) : null)} style={{ ...selStyle }}>
                  <option value="">Requisito general</option>
                  {items.map((it) => <option key={it.n} value={it.n}>Ítem {String(it.n).padStart(2, "0")} · {String(it.nombre || "").slice(0, 40)}</option>)}
                </select>
                <input aria-label="Requisito solicitado" placeholder="Requisito solicitado" value={r.requisito || ""} onChange={(e) => set("requisito", e.target.value)} style={iStyle} />
                <input aria-label="Característica ofertada" placeholder="Característica ofertada" value={r.ofertado || ""} onChange={(e) => set("ofertado", e.target.value)} style={iStyle} />
                <div style={{ display: "flex", gap: 6 }}>
                  <select aria-label="Cumplimiento" data-estado-requisito value={r.estado || "por_verificar"} onChange={(e) => set("estado", e.target.value)} style={{ ...selStyle, flex: 1 }}>
                    {ESTADOS_CUMPLIMIENTO.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                  <button type="button" aria-label="Quitar requisito" onClick={() => setMatriz((m) => m.filter((_, j) => j !== i))} style={{ border: `1px solid ${C.border}`, borderRadius: R.sm, background: C.card, minWidth: 36, cursor: "pointer" }}>✕</button>
                </div>
              </div>
            );
          })}
          {!soloLectura && <BotonSecundario data-agregar-requisito onClick={() => setMatriz((m) => [...m, { item: null, requisito: "", ofertado: "", estado: "por_verificar" }])} style={{ minHeight: 40, marginTop: 8 }}>+ Agregar requisito</BotonSecundario>}
        </fieldset>
      </Seccion>
      {!soloLectura && instalada && cotizacionId && (
        <BotonSecundario data-guardar-condiciones onClick={() => guardarCondiciones().catch((e) => setError(e.message))} disabled={!sinGuardar || !!ocupado} style={{ minHeight: 44, width: "100%", justifyContent: "center", opacity: sinGuardar ? 1 : 0.55 }}>
          {sinGuardar ? (cotizacionId ? "Guardando condiciones…" : "Se guardan al guardar la cotización") : "✓ Condiciones y matriz guardadas"}</BotonSecundario>
      )}

      {previa && (
        <VisorDocumento previa={previa} avisos={previa.avisos} emitiendo={ocupado === "emitir"} emitido={emitido} error={error}
          onCerrar={() => { setPrevia(null); setEmitido(null); setError(""); }}
          onDescargar={() => { descargarBlob(previa.blob, previa.nombre.replace(/\.pdf$/, "_sin-emitir.pdf")); showToast?.("PDF descargado sin emitir."); }}
          onEmitir={puedeEmitir && cotizacionId && instalada ? emitir : null} />
      )}
    </div>
  );
}
