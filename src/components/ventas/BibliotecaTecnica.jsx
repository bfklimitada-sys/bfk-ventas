// Ventas privadas › Biblioteca técnica: información técnica reutilizable por producto (sobre la biblioteca compartida
// de productos de BFK). Campos según el tipo de producto, sin obligar parámetros que no correspondan. Fotografías, fichas
// técnicas y manuales como archivos. Extracción asistida desde una ficha PDF: propone pares «característica: valor» que
// aparecen literalmente en el texto (con su página) y quedan PENDIENTES hasta que una persona los revisa.
import { useEffect, useState } from "react";
import { C, MONO, R, S, T, cardStyle, iStyle } from "../../lib/theme";
import { AvisoLinea, Badge, Seccion } from "../ui/Sistema";
import { Ventana, Campo, Rejilla, Subtitulo, Entrada, Area, Selector, ErrorForm } from "../proyectos/Comunes";
import { estiloBoton, Vacio, SubirArchivo, ListaDocumentos } from "./Comunes";
import { buscarProductos, leerProductos, guardarProducto, registrarExtraccion, resolverExtraccion, descargarDocumento, anular } from "../../lib/ventasPrivadasDatos";
import { TIPOS_PRODUCTO, PARAMETROS_SUGERIDOS, propuestasDesdeTexto, mensajeVP } from "../../lib/ventasPrivadas";
import { importarModulo } from "../../lib/cargaModulos";

// Texto de cada página de un PDF (pdf.js). Las líneas se arman por la posición vertical del texto.
export async function textoPorPagina(blob) {
  const [lib, w] = await importarModulo(() => Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.js?url")]));
  lib.GlobalWorkerOptions.workerSrc = w.default;
  const pdf = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }).promise;
  const paginas = [];
  for (let i = 1; i <= Math.min(pdf.numPages, 40); i++) {
    const tc = await (await pdf.getPage(i)).getTextContent();
    const filas = new Map();
    for (const it of tc.items) { const y = Math.round(it.transform[5]); const k = [...filas.keys()].find((z) => Math.abs(z - y) <= 2) ?? y; (filas.get(k) || filas.set(k, []).get(k)).push(it); }
    paginas.push([...filas.entries()].sort((a, b) => b[0] - a[0]).map(([, its]) => its.sort((a, b) => a.transform[4] - b.transform[4]).map((x) => x.str).join(" ").replace(/\s+/g, " ").trim()).filter(Boolean).join("\n"));
  }
  return paginas;
}

export function BibliotecaTecnica({ token, vp, showToast }) {
  const [q, setQ] = useState(""); const [res, setRes] = useState(null); const [abierto, setAbierto] = useState(null); const [err, setErr] = useState("");
  useEffect(() => { const t = setTimeout(async () => { try { setRes(await buscarProductos(token, q.trim())); setErr(""); } catch (e) { setErr(mensajeVP(e)); } }, 300); return () => clearTimeout(t); }, [q, token]);
  return (
    <div data-biblioteca-tecnica>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: S.md }}>
        <div style={{ fontSize: T.sm, color: C.inkMuted, flex: "1 1 260px" }}>Información técnica de productos para las EETT. Se reutiliza en cada cotización; los cambios no alteran EETT ya emitidas.</div>
        <button type="button" data-nuevo-producto onClick={() => setAbierto("nuevo")} style={{ ...estiloBoton("pri"), minHeight: 44 }}>+ Nuevo producto</button>
      </div>
      <Entrada data-buscar-producto value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre, marca o modelo" style={{ marginBottom: 10 }} />
      {err && <AvisoLinea tono="danger">{err}</AvisoLinea>}
      {(res || []).map((p) => (
        <button key={p.id} type="button" data-producto={p.id} onClick={() => setAbierto(p.id)} style={{ ...cardStyle, borderRadius: R.md, padding: "10px 12px", marginBottom: 6, width: "100%", textAlign: "left", cursor: "pointer" }}>
          <div style={{ fontWeight: 700, fontSize: T.sm }}>{p.nombre}</div><div style={{ fontSize: T.small, color: C.inkMuted }}>{[p.marca, p.modelo].filter(Boolean).join(" · ") || "Sin marca ni modelo"}</div>
        </button>
      ))}
      {res && !res.length && <Vacio>Sin productos.</Vacio>}
      {abierto && <EditorProducto token={token} vp={vp} id={abierto === "nuevo" ? null : abierto} showToast={showToast} onCerrar={() => setAbierto(null)} onCreado={(id) => setAbierto(id)} />}
    </div>
  );
}

const vacioTecnico = { nombre: "", marca: "", modelo: "", codigo: "", descripcion_tecnica: "", tipo_producto: "equipo", caracteristicas: [], condiciones_operacion: "", condiciones_instalacion: "", accesorios: [], exclusiones: [], garantia: "", normas: [], fuente_tipo: "manual", fuente_detalle: "" };

export function EditorProducto({ token, vp, id, showToast, onCerrar, onCreado }) {
  const [f, setF] = useState(id ? null : { ...vacioTecnico }); const [docs, setDocs] = useState([]); const [ext, setExt] = useState([]); const [version, setVersion] = useState(undefined);
  const [err, setErr] = useState(""); const [ocupado, setOcupado] = useState(""); const [revisando, setRevisando] = useState(null);
  const cargar = async () => {
    try {
      const { productos, tecnicos, documentos, extracciones } = await leerProductos(token, [id]);
      const p = productos[0] || {}; const t = tecnicos[0] || {};
      setF({ ...vacioTecnico, nombre: p.nombre || "", marca: p.marca || "", modelo: p.modelo || "", descripcion_tecnica: p.descripcion_tecnica || "", codigo: t.codigo || "", tipo_producto: t.tipo_producto || "otro",
        caracteristicas: t.caracteristicas || [], condiciones_operacion: t.condiciones_operacion || "", condiciones_instalacion: t.condiciones_instalacion || "", accesorios: t.accesorios || [], exclusiones: t.exclusiones || [],
        garantia: t.garantia || "", normas: t.normas || [], fuente_tipo: t.fuente_tipo || "manual", fuente_detalle: t.fuente_detalle || "", _mp: !t.producto_id && ((p.especificaciones || []).length || (p.caracteristicas || []).length) ? p : null });
      setVersion(t.version); setDocs(documentos); setExt(extracciones);
    } catch (e) { setErr(mensajeVP(e)); }
  };
  useEffect(() => { if (id) cargar(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!f) return <Ventana titulo="Producto" onCerrar={onCerrar}><Vacio>Cargando…</Vacio></Ventana>;
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const car = f.caracteristicas;
  const setCar = (i, k, v) => setF((x) => ({ ...x, caracteristicas: x.caracteristicas.map((c, j) => (j === i ? { ...c, [k]: v } : c)) }));
  const sugeridos = (PARAMETROS_SUGERIDOS[f.tipo_producto] || []).filter((s) => !car.some((c) => c.caracteristica.toLowerCase() === s.toLowerCase()));
  const guardar = async () => {
    if (!f.nombre.trim()) { setErr("Falta el nombre del producto."); return; }
    const sinResp = f.normas.find((n) => n.norma.trim() && !String(n.respaldo_texto || "").trim() && !n.respaldo_documento_id);
    if (sinResp) { setErr(`La norma «${sinResp.norma}» necesita respaldo (archivo o referencia verificable).`); return; }
    setOcupado("guardar");
    try {
      const r = await guardarProducto(token, { producto_id: id || null, ...f, ...(version != null ? { version } : {}) });
      showToast?.("Información técnica guardada"); setErr("");
      if (!id) onCreado?.(r.producto_id); else { setVersion(r.version); await cargar(); }
    } catch (e) { setErr(mensajeVP(e)); } finally { setOcupado(""); }
  };
  const extraer = async (doc) => {
    setOcupado("extraer");
    try {
      const blob = await descargarDocumento(token, doc);
      const paginas = await textoPorPagina(blob);
      const propuesta = propuestasDesdeTexto(paginas);
      if (!propuesta.length) { showToast?.(paginas.join("").trim() ? "No se encontraron pares «característica: valor» en el texto. Ingresa los datos manualmente." : "El PDF no tiene texto legible (probablemente es una imagen escaneada). Ingresa los datos manualmente.", "error"); return; }
      await registrarExtraccion(token, { producto_id: id, documento_id: doc.id, metodo: "texto_pdf", propuesta });
      showToast?.(`${propuesta.length} datos propuestos: quedan pendientes de revisión`); await cargar();
    } catch (e) { showToast?.(`No se pudo leer la ficha: ${mensajeVP(e)}`, "error"); } finally { setOcupado(""); }
  };
  return (
    <Ventana titulo={id ? `Producto · ${f.nombre}` : "Nuevo producto"} onCerrar={onCerrar} dato="editor-producto" ancho={820}
      pie={<><button type="button" onClick={onCerrar} style={estiloBoton()}>Cerrar</button><button type="button" data-guardar-producto disabled={!!ocupado} onClick={guardar} style={{ ...estiloBoton("pri"), minHeight: 44 }}>{ocupado === "guardar" ? "Guardando…" : "Guardar"}</button></>}>
      <ErrorForm>{err}</ErrorForm>
      {f._mp && <AvisoLinea tono="info" icono="ℹ">Este producto viene de la biblioteca de Cotizaciones MP y tiene especificaciones propias allí. Puedes copiarlas como características y revisarlas.
        <button type="button" onClick={() => setF((x) => ({ ...x, caracteristicas: [...x.caracteristicas, ...[...(x._mp.caracteristicas || []), ...(x._mp.especificaciones || [])].map((e) => ({ caracteristica: e.etiqueta || "", valor: e.valor || "", unidad: "", origen: { tipo: "manual" } }))], _mp: null }))} style={{ ...estiloBoton(), marginLeft: 8 }}>Copiar</button></AvisoLinea>}
      <Rejilla columnas={3}>
        <Campo etiqueta="Nombre"><Entrada data-producto-nombre value={f.nombre} onChange={set("nombre")} /></Campo>
        <Campo etiqueta="Marca"><Entrada data-producto-marca value={f.marca} onChange={set("marca")} /></Campo>
        <Campo etiqueta="Modelo"><Entrada data-producto-modelo value={f.modelo} onChange={set("modelo")} /></Campo>
        <Campo etiqueta="Código"><Entrada value={f.codigo} onChange={set("codigo")} /></Campo>
        <Campo etiqueta="Tipo de producto"><Selector data-producto-tipo value={f.tipo_producto} onChange={set("tipo_producto")} opciones={TIPOS_PRODUCTO} /></Campo>
        <Campo etiqueta="Fuente de la información"><Selector value={f.fuente_tipo} onChange={set("fuente_tipo")} opciones={[{ v: "manual", l: "Ingreso manual" }, { v: "archivo", l: "Archivo (ficha técnica)" }, { v: "enlace", l: "Enlace del fabricante" }]} /></Campo>
      </Rejilla>
      {f.fuente_tipo !== "manual" && <Campo etiqueta={f.fuente_tipo === "enlace" ? "Enlace del fabricante" : "Archivo de origen"}><Entrada value={f.fuente_detalle} onChange={set("fuente_detalle")} /></Campo>}
      <Campo etiqueta="Descripción técnica"><Area value={f.descripcion_tecnica} onChange={set("descripcion_tecnica")} /></Campo>
      <Subtitulo>Características (característica · valor · unidad)</Subtitulo>
      <div style={{ fontSize: T.small, color: C.inkMuted, marginBottom: 6 }}>Ninguna es obligatoria. Lo que no se conozca no se registra (en la EETT aparecerá «No informado» hasta completarlo o excluirlo).</div>
      {car.map((c, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 80px auto", gap: 6, marginBottom: 6 }}>
          <input aria-label="Característica" value={c.caracteristica} onChange={(e) => setCar(i, "caracteristica", e.target.value)} style={{ ...iStyle, minHeight: 36, padding: "6px 8px" }} />
          <input aria-label="Valor" value={c.valor} onChange={(e) => setCar(i, "valor", e.target.value)} style={{ ...iStyle, minHeight: 36, padding: "6px 8px" }} />
          <input aria-label="Unidad" value={c.unidad || ""} onChange={(e) => setCar(i, "unidad", e.target.value)} style={{ ...iStyle, minHeight: 36, padding: "6px 8px" }} />
          <button type="button" onClick={() => setF((x) => ({ ...x, caracteristicas: x.caracteristicas.filter((_, j) => j !== i) }))} style={estiloBoton("peligro")}>✕</button>
          {c.origen?.tipo === "archivo" && <div style={{ gridColumn: "1 / -1", fontSize: T.small, color: C.inkFaint, marginTop: -4 }}>Desde archivo{c.origen.pagina ? `, página ${c.origen.pagina}` : ""}</div>}
        </div>
      ))}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        <button type="button" data-agregar-car onClick={() => setF((x) => ({ ...x, caracteristicas: [...x.caracteristicas, { caracteristica: "", valor: "", unidad: "" }] }))} style={estiloBoton()}>+ Característica</button>
        {sugeridos.map((s) => <button key={s} type="button" onClick={() => setF((x) => ({ ...x, caracteristicas: [...x.caracteristicas, { caracteristica: s, valor: "", unidad: "" }] }))} style={{ ...estiloBoton(), color: C.inkMuted }}>+ {s}</button>)}
      </div>
      <Rejilla>
        <Campo etiqueta="Condiciones de operación"><Area value={f.condiciones_operacion} onChange={set("condiciones_operacion")} /></Campo>
        <Campo etiqueta="Condiciones de instalación"><Area value={f.condiciones_instalacion} onChange={set("condiciones_instalacion")} /></Campo>
        <Campo etiqueta="Accesorios incluidos" ayuda="Uno por línea."><Area value={f.accesorios.join("\n")} onChange={(e) => setF((x) => ({ ...x, accesorios: e.target.value.split("\n") }))} /></Campo>
        <Campo etiqueta="Exclusiones" ayuda="Una por línea."><Area value={f.exclusiones.join("\n")} onChange={(e) => setF((x) => ({ ...x, exclusiones: e.target.value.split("\n") }))} /></Campo>
      </Rejilla>
      <Campo etiqueta="Garantía"><Entrada value={f.garantia} onChange={set("garantia")} /></Campo>
      <Subtitulo>Normas y certificaciones (solo con respaldo)</Subtitulo>
      {f.normas.map((n, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr 1fr auto", gap: 6, marginBottom: 6 }}>
          <input aria-label="Norma" value={n.norma} onChange={(e) => setF((x) => ({ ...x, normas: x.normas.map((m, j) => (j === i ? { ...m, norma: e.target.value } : m)) }))} style={{ ...iStyle, minHeight: 36 }} />
          <input aria-label="Respaldo" placeholder="Referencia verificable" value={n.respaldo_texto || ""} onChange={(e) => setF((x) => ({ ...x, normas: x.normas.map((m, j) => (j === i ? { ...m, respaldo_texto: e.target.value } : m)) }))} style={{ ...iStyle, minHeight: 36 }} />
          <select aria-label="Archivo de respaldo" value={n.respaldo_documento_id || ""} onChange={(e) => setF((x) => ({ ...x, normas: x.normas.map((m, j) => (j === i ? { ...m, respaldo_documento_id: e.target.value || null } : m)) }))} style={{ ...iStyle, minHeight: 36 }}>
            <option value="">Sin archivo</option>{docs.filter((d) => ["certificado", "ficha_tecnica", "manual"].includes(d.categoria)).map((d) => <option key={d.id} value={d.id}>{d.titulo}</option>)}
          </select>
          <button type="button" onClick={() => setF((x) => ({ ...x, normas: x.normas.filter((_, j) => j !== i) }))} style={estiloBoton("peligro")}>✕</button>
        </div>
      ))}
      <button type="button" onClick={() => setF((x) => ({ ...x, normas: [...x.normas, { norma: "", respaldo_texto: "" }] }))} style={{ ...estiloBoton(), marginBottom: 12 }}>+ Norma</button>
      {id ? <>
        <Subtitulo>Fotografías, fichas técnicas y manuales</Subtitulo>
        <SubirArchivo token={token} ambito="producto" id={id} categorias={["ficha_tecnica", "foto", "manual", "certificado"]} habilitado={vp.documentosHabilitados} showToast={showToast} onSubido={cargar} />
        <ListaDocumentos token={token} documentos={docs} showToast={showToast} onAnular={async (d) => { const m = window.prompt("Motivo de la anulación"); if (!m) return; try { await anular(token, "documento", d.id, m); await cargar(); } catch (e) { showToast?.(mensajeVP(e), "error"); } }} />
        {docs.filter((d) => d.categoria === "ficha_tecnica" && /pdf/i.test(d.tipo_mime || d.nombre_archivo)).length > 0 && <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: T.small, fontWeight: 700, color: C.inkMuted, marginBottom: 4 }}>EXTRACCIÓN ASISTIDA (queda pendiente de revisión)</div>
          {docs.filter((d) => d.categoria === "ficha_tecnica" && /pdf/i.test(d.tipo_mime || d.nombre_archivo)).map((d) => <button key={d.id} type="button" data-extraer={d.id} disabled={!!ocupado} onClick={() => extraer(d)} style={{ ...estiloBoton(), marginRight: 6 }}>{ocupado === "extraer" ? "Leyendo…" : `Proponer datos desde «${d.titulo}»`}</button>)}
        </div>}
        {ext.map((e) => (
          <AvisoLinea key={e.id} tono="warn" icono="⏳" dato="extraccion-pendiente" accion="Revisar" onClick={() => setRevisando(e)}>{e.propuesta.length} datos extraídos de «{docs.find((d) => d.id === e.documento_id)?.titulo || "ficha"}» pendientes de revisión</AvisoLinea>
        ))}
      </> : <div style={{ fontSize: T.small, color: C.inkFaint }}>Guarda el producto para adjuntar fotografías, fichas y manuales.</div>}
      {revisando && <RevisarExtraccion token={token} ext={revisando} showToast={showToast} onCerrar={() => setRevisando(null)} onListo={async () => { setRevisando(null); await cargar(); }} />}
    </Ventana>
  );
}

function RevisarExtraccion({ token, ext, showToast, onCerrar, onListo }) {
  const [filas, setFilas] = useState(ext.propuesta.map((p) => ({ ...p, aceptar: false })));
  const [ocupado, setOcupado] = useState(false);
  const ok = async () => {
    setOcupado(true);
    try { const r = await resolverExtraccion(token, ext.id, filas.filter((f) => f.aceptar).map(({ caracteristica, valor, unidad, pagina }) => ({ caracteristica, valor, unidad, pagina }))); showToast?.(r.aceptadas ? `${r.aceptadas} datos incorporados a la ficha (con su página de origen)` : "Propuesta descartada"); onListo(); }
    catch (e) { showToast?.(mensajeVP(e), "error"); } finally { setOcupado(false); }
  };
  return (
    <Ventana titulo="Revisar datos extraídos" onCerrar={onCerrar} dato="revisar-extraccion" ancho={760}
      pie={<><button type="button" onClick={onCerrar} style={estiloBoton()}>Después</button><button type="button" data-confirmar-extraccion disabled={ocupado} onClick={ok} style={{ ...estiloBoton("pri"), minHeight: 44 }}>{ocupado ? "Guardando…" : `Incorporar ${filas.filter((f) => f.aceptar).length} seleccionados`}</button></>}>
      <p style={{ marginTop: 0, fontSize: T.sm, color: C.inkMuted }}>Marca solo lo que corresponde al producto y corrige si es necesario. Lo no marcado se descarta. Nada se incorpora sin tu revisión.</p>
      {filas.map((f, i) => (
        <div key={i} data-propuesta={i} style={{ display: "grid", gridTemplateColumns: "auto 1.2fr 1fr 70px 52px", gap: 6, alignItems: "center", marginBottom: 6 }}>
          <input type="checkbox" checked={f.aceptar} onChange={(e) => setFilas((x) => x.map((y, j) => (j === i ? { ...y, aceptar: e.target.checked } : y)))} />
          <input value={f.caracteristica} onChange={(e) => setFilas((x) => x.map((y, j) => (j === i ? { ...y, caracteristica: e.target.value } : y)))} style={{ ...iStyle, minHeight: 34, padding: "5px 8px" }} />
          <input value={f.valor} onChange={(e) => setFilas((x) => x.map((y, j) => (j === i ? { ...y, valor: e.target.value } : y)))} style={{ ...iStyle, minHeight: 34, padding: "5px 8px" }} />
          <input value={f.unidad || ""} onChange={(e) => setFilas((x) => x.map((y, j) => (j === i ? { ...y, unidad: e.target.value } : y)))} style={{ ...iStyle, minHeight: 34, padding: "5px 8px" }} />
          <span title={f.texto_origen} style={{ fontSize: T.small, color: C.inkFaint }}>pág. {f.pagina}</span>
        </div>
      ))}
    </Ventana>
  );
}
