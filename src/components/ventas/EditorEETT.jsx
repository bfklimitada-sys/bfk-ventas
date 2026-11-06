// Ventas privadas — «Generar EETT» desde una cotización privada.
// 1) Seleccionar ítems (conservan la numeración de la cotización). 2) Se recuperan cantidades, unidades y la información
// técnica de cada producto de la biblioteca; lo que falte queda «No informado» (nunca se completa por suposición).
// 3) Revisar y editar (características, condiciones, accesorios, exclusiones, garantía, normas con respaldo, requisitos
// del cliente distinguidos de lo ofrecido, anexos). 4) Emitir: la base valida y congela el contenido (revisión nueva para
// cada actualización). El PDF se genera desde el contenido congelado, sin costos, márgenes ni precios.
import { useEffect, useMemo, useState } from "react";
import { C, MONO, R, T, cardStyle, iStyle } from "../../lib/theme";
import { AvisoLinea, Badge, Desplegable } from "../ui/Sistema";
import { Ventana, Campo, Rejilla, Subtitulo, Entrada, Area, Selector, ErrorForm } from "../proyectos/Comunes";
import { estiloBoton, Vacio } from "./Comunes";
import { leerEETT, guardarEETT, emitirEETT, descartarEETT, leerProductos, guardarProducto, imagenComoDataURL } from "../../lib/ventasPrivadasDatos";
import { itemEETTDesde, revisarEETT, CUMPLIMIENTOS, NO_INFORMADO, mensajeVP, cantidadTxt, hoyISO, folioRevision, CATEGORIAS_DOCUMENTO } from "../../lib/ventasPrivadas";
import { generarPdfEETTPrivada } from "../../lib/vpPdf";
import { descargarBlob } from "../../lib/eettPdf";
import { logoBFK } from "../../lib/cotizacionesDatos";
import logoUrl from "../../assets/bfk-logo.jpg";

// Imágenes para el PDF: fotos adjuntas al producto (vp-documentos) o, si no hay, las de la biblioteca (cz-productos).
async function imagenesDe(token, contenido) {
  const ids = (contenido.items || []).map((i) => i.producto_id).filter(Boolean);
  if (!ids.length) return {};
  const { productos, documentos } = await leerProductos(token, ids);
  const out = {};
  for (const it of contenido.items) {
    if (!it.producto_id) continue;
    const fotos = documentos.filter((d) => d.producto_id === it.producto_id && d.categoria === "foto" && /^image\/(jpe?g|png)/i.test(d.tipo_mime || "")).slice(0, 2);
    let imgs = (await Promise.all(fotos.map((f) => imagenComoDataURL(token, { bucket: "vp-documentos", ruta: f.ruta, sha256: f.sha256 })))).filter(Boolean);
    if (!imgs.length) {
      const p = productos.find((x) => x.id === it.producto_id);
      imgs = (await Promise.all((p?.imagenes || []).slice(0, 2).map((r) => (typeof r === "string" ? imagenComoDataURL(token, { bucket: "cz-productos", ruta: r }) : null)))).filter(Boolean);
    }
    out[it.item_id] = imgs;
  }
  return out;
}
export async function descargarEETT(token, id, empresa, showToast) {
  try {
    const e = await leerEETT(token, id); if (!e) throw new Error("EETT no encontrada");
    const r = await generarPdfEETTPrivada(e, { logo: await logoBFK(logoUrl), empresa, imagenes: await imagenesDe(token, e.contenido) });
    descargarBlob(r.blob, r.nombre);
  } catch (x) { showToast?.(`No se pudo generar el PDF de la EETT: ${mensajeVP(x)}`, "error"); }
}

export function EditorEETT({ token, cot, datos, vp, eettId, showToast, onCerrar }) {
  const lineas = useMemo(() => datos.items.filter((i) => i.revision_id === cot.revision_id).sort((a, b) => a.orden - b.orden), [datos, cot.revision_id]);
  const [borrador, setBorrador] = useState(null);   // {id, folio, revision, version, contenido}
  const [sel, setSel] = useState(() => new Set(lineas.map((l) => l.id)));
  const [cargando, setCargando] = useState(!!eettId); const [ocupado, setOcupado] = useState(""); const [errores, setErrores] = useState([]); const [avisos, setAvisos] = useState([]);
  const [docsProd, setDocsProd] = useState([]);
  useEffect(() => {
    if (!eettId) return;
    (async () => {
      try { const e = await leerEETT(token, eettId); setBorrador(e); const ids = (e.contenido.items || []).map((i) => i.producto_id).filter(Boolean); if (ids.length) setDocsProd((await leerProductos(token, ids)).documentos); }
      catch (x) { showToast?.(mensajeVP(x), "error"); } finally { setCargando(false); }
    })();
  }, [eettId, token]); // eslint-disable-line react-hooks/exhaustive-deps
  const revisionNum = datos.revisiones.find((r) => r.id === cot.revision_id)?.numero ?? 0;
  const ultimaEmitida = datos.eett.find((e) => e.estado === "emitida");

  const armar = async () => {
    setOcupado("armar");
    try {
      const elegidas = lineas.filter((l) => sel.has(l.id));
      const { productos, tecnicos, documentos } = await leerProductos(token, elegidas.map((l) => l.producto_id));
      setDocsProd(documentos);
      const cl = vp.clientes.find((c) => c.id === cot.cliente_id) || {};
      // Si ya hay una EETT emitida, la nueva revisión parte de su contenido (lo ya revisado no se pierde).
      let previo = null;
      if (ultimaEmitida) { try { previo = (await leerEETT(token, ultimaEmitida.id))?.contenido || null; } catch { previo = null; } }
      const contenido = {
        fecha: hoyISO(), cliente: { razon_social: cl.razon_social || cot.cliente_nombre, rut: cl.rut || cot.cliente_rut },
        cotizacion: { folio: cot.folio, revision: revisionNum },
        objeto: previo?.objeto || "", alcance: previo?.alcance || "", observaciones: previo?.observaciones || "", anexos: previo?.anexos || [],
        items: elegidas.map((l) => {
          const antes = previo?.items?.find((x) => x.item_id === l.id || (x.orden === l.orden && x.producto_id === l.producto_id));
          const base = itemEETTDesde(l, productos.find((p) => p.id === l.producto_id), tecnicos.find((t) => t.producto_id === l.producto_id));
          return antes ? { ...base, ...antes, item_id: l.id, orden: l.orden, cantidad: Number(l.cantidad), unidad: l.unidad } : base;
        }),
      };
      const r = await guardarEETT(token, { cotizacion_id: cot.id, contenido });
      setBorrador({ id: r.id, folio: r.folio, revision: r.revision, version: r.version, estado: "borrador", contenido });
      showToast?.(`Borrador ${r.folio} Rev. ${r.revision} creado`);
    } catch (x) { showToast?.(mensajeVP(x), "error"); } finally { setOcupado(""); }
  };

  const c = borrador?.contenido;
  const setC = (fn) => setBorrador((b) => ({ ...b, contenido: fn(b.contenido), _sucio: true }));
  const setItem = (idx, campo, valor) => setC((x) => ({ ...x, items: x.items.map((it, i) => (i === idx ? { ...it, [campo]: valor } : it)) }));
  const guardar = async () => {
    setOcupado("guardar");
    try { const r = await guardarEETT(token, { id: borrador.id, version: borrador.version, cotizacion_id: cot.id, contenido: borrador.contenido }); setBorrador((b) => ({ ...b, version: r.version, _sucio: false })); showToast?.("Borrador guardado"); return r; }
    catch (x) { showToast?.(mensajeVP(x), "error"); return null; } finally { setOcupado(""); }
  };
  const previa = async () => {
    setOcupado("previa");
    try { const r = await generarPdfEETTPrivada({ ...borrador, estado: "borrador" }, { logo: await logoBFK(logoUrl), empresa: vp.empresa, imagenes: await imagenesDe(token, borrador.contenido) }); window.open(URL.createObjectURL(r.blob), "_blank"); }
    catch (x) { showToast?.(mensajeVP(x), "error"); } finally { setOcupado(""); }
  };
  const emitir = async () => {
    const rv = revisarEETT(c); setErrores(rv.errores); setAvisos(rv.avisos);
    if (rv.errores.length) { showToast?.("Revisa los puntos pendientes antes de emitir.", "error"); return; }
    const g = borrador._sucio ? await guardar() : { version: borrador.version }; if (!g) return;
    setOcupado("emitir");
    try {
      const r = await emitirEETT(token, borrador.id, g.version);
      showToast?.(`EETT ${r.folio} Rev. ${r.revision} emitida`);
      await descargarEETT(token, r.id, vp.empresa, showToast);
      onCerrar();
    } catch (x) { setErrores([mensajeVP(x)]); showToast?.(mensajeVP(x), "error"); } finally { setOcupado(""); }
  };
  const descartar = async () => {
    if (!window.confirm("¿Descartar este borrador de EETT? (las EETT emitidas no se ven afectadas)")) return;
    try { await descartarEETT(token, borrador.id); onCerrar(); } catch (x) { showToast?.(mensajeVP(x), "error"); }
  };
  const guardarEnBiblioteca = async (it) => {
    try {
      const r = await guardarProducto(token, { producto_id: it.producto_id || null, nombre: it.nombre, marca: it.marca, modelo: it.modelo, codigo: it.codigo, descripcion_tecnica: it.descripcion,
        tipo_producto: it.tipo === "servicio" ? "servicio" : undefined, caracteristicas: (it.caracteristicas || []).filter((k) => !k.excluir), condiciones_operacion: it.condiciones_operacion,
        condiciones_instalacion: it.condiciones_instalacion, accesorios: it.accesorios, exclusiones: it.exclusiones, garantia: it.garantia, normas: it.normas, fuente_tipo: it.fuente?.tipo || "manual", fuente_detalle: it.fuente?.detalle });
      setC((x) => ({ ...x, items: x.items.map((y) => (y.item_id === it.item_id ? { ...y, producto_id: r.producto_id } : y)) }));
      showToast?.("Información técnica guardada en la biblioteca (las EETT ya emitidas no cambian)");
    } catch (x) { showToast?.(mensajeVP(x), "error"); }
  };

  if (cargando) return <Ventana titulo="EETT" onCerrar={onCerrar}><Vacio>Cargando…</Vacio></Ventana>;
  if (!borrador) return (
    <Ventana titulo={`Generar EETT · ${folioRevision(cot.folio, revisionNum)}`} onCerrar={onCerrar} dato="eett-seleccion" ancho={640}
      pie={<><button type="button" onClick={onCerrar} style={estiloBoton()}>Cancelar</button><button type="button" data-armar-eett disabled={!sel.size || !!ocupado} onClick={armar} style={{ ...estiloBoton("pri"), minHeight: 44 }}>{ocupado ? "Preparando…" : `Preparar EETT (${sel.size} ítem${sel.size === 1 ? "" : "s"})`}</button></>}>
      <p style={{ marginTop: 0, fontSize: T.sm, color: C.inkMuted }}>Selecciona los ítems de la cotización que irán en las especificaciones técnicas. Las cantidades, unidades y la numeración se toman de la cotización.{ultimaEmitida ? ` Hay una EETT emitida (${ultimaEmitida.folio} Rev. ${ultimaEmitida.revision}): se generará la revisión siguiente, conservando la anterior.` : ""}</p>
      {lineas.map((l) => (
        <label key={l.id} data-eett-item={l.orden} style={{ ...cardStyle, borderRadius: R.md, padding: "9px 12px", marginBottom: 6, display: "flex", gap: 10, alignItems: "center", cursor: "pointer" }}>
          <input type="checkbox" checked={sel.has(l.id)} onChange={(e) => setSel((s) => { const n = new Set(s); e.target.checked ? n.add(l.id) : n.delete(l.id); return n; })} />
          <b style={{ fontFamily: MONO, color: C.tealDark }}>{l.orden}</b>
          <span style={{ flex: 1, fontSize: T.sm }}>{l.descripcion}</span>
          <span style={{ fontSize: T.small, color: C.inkMuted }}>{cantidadTxt(l.cantidad)} {l.unidad}</span>
          {l.producto_id ? <Badge tono="info">Con ficha</Badge> : <Badge tono="warn">Sin ficha</Badge>}
        </label>
      ))}
    </Ventana>
  );

  return (
    <Ventana titulo={`EETT ${borrador.folio} · Rev. ${borrador.revision} (borrador)`} onCerrar={onCerrar} dato="eett-editor" ancho={900}
      pie={<>
        <button type="button" data-descartar-eett onClick={descartar} style={estiloBoton("peligro")}>Descartar borrador</button>
        <span style={{ flex: 1 }} />
        <button type="button" data-guardar-eett disabled={!!ocupado} onClick={guardar} style={estiloBoton()}>{ocupado === "guardar" ? "Guardando…" : "Guardar borrador"}</button>
        <button type="button" data-previa-eett disabled={!!ocupado} onClick={previa} style={estiloBoton()}>{ocupado === "previa" ? "…" : "Vista previa PDF"}</button>
        <button type="button" data-emitir-eett disabled={!!ocupado} onClick={emitir} style={{ ...estiloBoton("pri"), minHeight: 44 }}>{ocupado === "emitir" ? "Emitiendo…" : "Emitir y descargar PDF"}</button>
      </>}>
      <AvisoLinea tono="info" icono="ℹ">Referencia: cotización {folioRevision(cot.folio, c.cotizacion?.revision)} · {c.cliente?.razon_social}. Las EETT no muestran costos, márgenes ni precios (estos quedan en la cotización).</AvisoLinea>
      {errores.length > 0 && <div data-errores-eett style={{ background: C.dangerLight, borderRadius: R.sm, padding: "9px 12px", marginBottom: 10 }}>{errores.map((e, i) => <div key={i} style={{ fontSize: T.sm, color: C.dangerText, fontWeight: 700 }}>• {e}</div>)}</div>}
      {avisos.length > 0 && <div style={{ background: C.warnLight, borderRadius: R.sm, padding: "9px 12px", marginBottom: 10 }}>{avisos.map((e, i) => <div key={i} style={{ fontSize: T.small, color: C.warnText }}>• {e}</div>)}</div>}
      <Campo etiqueta="Objeto del suministro"><Area data-eett-objeto value={c.objeto} onChange={(e) => setC((x) => ({ ...x, objeto: e.target.value }))} placeholder="Ej.: Suministro e instalación de bomba centrífuga para planta…" /></Campo>
      <Campo etiqueta="Alcance"><Area data-eett-alcance value={c.alcance} onChange={(e) => setC((x) => ({ ...x, alcance: e.target.value }))} /></Campo>
      {c.items.map((it, idx) => <ItemEETT key={it.item_id} it={it} idx={idx} setItem={setItem} docsProd={docsProd} onGuardarBiblioteca={() => guardarEnBiblioteca(it)} />)}
      <Campo etiqueta="Observaciones generales"><Area value={c.observaciones} onChange={(e) => setC((x) => ({ ...x, observaciones: e.target.value }))} /></Campo>
    </Ventana>
  );
}

function ListaTexto({ etiqueta, valores, onCambiar, dato }) {
  return <Campo etiqueta={etiqueta} ayuda="Una por línea."><Area data-lista={dato} value={(valores || []).join("\n")} onChange={(e) => onCambiar(e.target.value.split("\n").map((s) => s.replace(/^\s*[·•-]\s*/, "")).filter((s, i, a) => s.trim() || i === a.length - 1))} /></Campo>;
}

function ItemEETT({ it, idx, setItem, docsProd, onGuardarBiblioteca }) {
  const inp = { ...iStyle, minHeight: 36, padding: "6px 8px", fontSize: 13 };
  const car = it.caracteristicas || [];
  const setCar = (i, campo, valor) => setItem(idx, "caracteristicas", car.map((k, j) => (j === i ? { ...k, [campo]: valor, ...(campo === "valor" ? { pendiente_revision: false } : {}) } : k)));
  const faltan = car.filter((k) => !k.excluir && (!String(k.valor || "").trim() || k.valor === NO_INFORMADO)).length;
  const docs = docsProd.filter((d) => d.producto_id === it.producto_id && ["ficha_tecnica", "manual", "certificado", "eett_anexo"].includes(d.categoria));
  const req = it.requisitos || [];
  const setReq = (i, campo, valor) => setItem(idx, "requisitos", req.map((r, j) => (j === i ? { ...r, [campo]: valor } : r)));
  const normas = it.normas || [];
  const setNorma = (i, campo, valor) => setItem(idx, "normas", normas.map((n, j) => (j === i ? { ...n, [campo]: valor } : n)));
  return (
    <Desplegable dato={`eett-item-${it.orden}`} abiertoInicial={idx === 0} titulo={`Ítem ${it.orden} — ${it.nombre}`} resumen={`${cantidadTxt(it.cantidad)} ${it.unidad}${it.marca ? ` · ${it.marca}` : ""}${it.modelo ? ` ${it.modelo}` : ""}`}
      derecha={faltan ? <Badge tono="warn">{faltan} «No informado»</Badge> : <Badge tono="ok">Completo</Badge>}>
      <Rejilla columnas={3}>
        <Campo etiqueta="Nombre"><Entrada value={it.nombre} onChange={(e) => setItem(idx, "nombre", e.target.value)} /></Campo>
        {it.tipo !== "servicio" && <Campo etiqueta="Marca"><Entrada data-eett-marca value={it.marca} placeholder={NO_INFORMADO} onChange={(e) => setItem(idx, "marca", e.target.value)} /></Campo>}
        {it.tipo !== "servicio" && <Campo etiqueta="Modelo"><Entrada data-eett-modelo value={it.modelo} placeholder={NO_INFORMADO} onChange={(e) => setItem(idx, "modelo", e.target.value)} /></Campo>}
        <Campo etiqueta="Código"><Entrada value={it.codigo} onChange={(e) => setItem(idx, "codigo", e.target.value)} /></Campo>
        <Campo etiqueta="Cantidad (de la cotización)"><Entrada disabled value={`${cantidadTxt(it.cantidad)} ${it.unidad}`} /></Campo>
      </Rejilla>
      <Campo etiqueta="Descripción técnica"><Area value={it.descripcion} onChange={(e) => setItem(idx, "descripcion", e.target.value)} /></Campo>
      <Subtitulo>Características del producto ofrecido</Subtitulo>
      {car.map((k, i) => {
        const falta = !k.excluir && (!String(k.valor || "").trim() || k.valor === NO_INFORMADO);
        return (
          <div key={i} data-caracteristica={k.caracteristica} style={{ display: "grid", gridTemplateColumns: "minmax(110px,1.2fr) minmax(90px,1fr) 70px auto auto", gap: 6, alignItems: "center", marginBottom: 6, opacity: k.excluir ? 0.5 : 1 }}>
            <input aria-label="Característica" value={k.caracteristica} onChange={(e) => setCar(i, "caracteristica", e.target.value)} style={inp} />
            <input aria-label="Valor" data-valor-caracteristica value={k.valor} onChange={(e) => setCar(i, "valor", e.target.value)} style={{ ...inp, borderColor: falta ? C.warn : C.border, background: falta ? C.warnLight : C.card }} />
            <input aria-label="Unidad" value={k.unidad || ""} onChange={(e) => setCar(i, "unidad", e.target.value)} style={inp} />
            <label style={{ fontSize: T.small, display: "flex", gap: 4, alignItems: "center", whiteSpace: "nowrap" }}><input type="checkbox" data-excluir-caracteristica checked={!!k.excluir} onChange={(e) => setCar(i, "excluir", e.target.checked)} /> Excluir</label>
            <span title={k.origen?.tipo === "archivo" ? `Desde archivo${k.origen.pagina ? `, pág. ${k.origen.pagina}` : ""}` : k.sugerido ? "Parámetro sugerido para este tipo de producto" : ""} style={{ fontSize: T.small, color: C.inkFaint }}>{k.origen?.tipo === "archivo" ? `pág. ${k.origen.pagina || "?"}` : k.sugerido ? "sugerido" : ""}</span>
          </div>
        );
      })}
      <button type="button" data-agregar-caracteristica onClick={() => setItem(idx, "caracteristicas", [...car, { caracteristica: "", valor: "", unidad: "" }])} style={{ ...estiloBoton(), marginBottom: 10 }}>+ Característica</button>
      <Rejilla>
        <Campo etiqueta="Condiciones de operación"><Area value={it.condiciones_operacion} onChange={(e) => setItem(idx, "condiciones_operacion", e.target.value)} /></Campo>
        <Campo etiqueta="Condiciones de instalación"><Area value={it.condiciones_instalacion} onChange={(e) => setItem(idx, "condiciones_instalacion", e.target.value)} /></Campo>
        <ListaTexto etiqueta="Accesorios incluidos" valores={it.accesorios} onCambiar={(v) => setItem(idx, "accesorios", v)} dato="accesorios" />
        <ListaTexto etiqueta="Exclusiones" valores={it.exclusiones} onCambiar={(v) => setItem(idx, "exclusiones", v)} dato="exclusiones" />
      </Rejilla>
      <Campo etiqueta="Garantía"><Entrada value={it.garantia} onChange={(e) => setItem(idx, "garantia", e.target.value)} /></Campo>
      <Subtitulo>Normas y certificaciones (solo con respaldo)</Subtitulo>
      {normas.map((n, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr auto", gap: 6, marginBottom: 6 }}>
          <input aria-label="Norma" value={n.norma} onChange={(e) => setNorma(i, "norma", e.target.value)} style={inp} />
          <input aria-label="Respaldo" placeholder="Respaldo verificable (ficha, certificado, página)" value={n.respaldo_texto || ""} onChange={(e) => setNorma(i, "respaldo_texto", e.target.value)} style={{ ...inp, borderColor: !n.respaldo_texto && !n.respaldo_documento_id ? C.danger : C.border }} />
          <button type="button" onClick={() => setItem(idx, "normas", normas.filter((_, j) => j !== i))} style={estiloBoton("peligro")}>✕</button>
        </div>
      ))}
      <button type="button" onClick={() => setItem(idx, "normas", [...normas, { norma: "", respaldo_texto: "" }])} style={{ ...estiloBoton(), marginBottom: 10 }}>+ Norma</button>
      <Subtitulo>Requisitos del cliente / producto ofrecido</Subtitulo>
      <div style={{ fontSize: T.small, color: C.inkMuted, marginBottom: 6 }}>Lo que pidió el cliente se registra aparte de lo ofrecido. No se declara cumplimiento ni equivalencia sin respaldo.</div>
      {req.map((r, i) => (
        <div key={i} data-requisito={i} style={{ ...cardStyle, borderRadius: R.sm, padding: 8, marginBottom: 6 }}>
          <Rejilla>
            <Campo etiqueta="Requisito del cliente"><Entrada value={r.requisito} onChange={(e) => setReq(i, "requisito", e.target.value)} /></Campo>
            <Campo etiqueta="Ofrecido por BFK"><Entrada value={r.ofrecido} onChange={(e) => setReq(i, "ofrecido", e.target.value)} /></Campo>
            <Campo etiqueta="Cumplimiento"><Selector data-cumplimiento value={r.cumplimiento || "sin_declarar"} onChange={(e) => setReq(i, "cumplimiento", e.target.value)} opciones={CUMPLIMIENTOS} /></Campo>
            <Campo etiqueta="Respaldo"><Entrada value={r.respaldo || ""} onChange={(e) => setReq(i, "respaldo", e.target.value)} placeholder="Documento y página" /></Campo>
          </Rejilla>
          <button type="button" onClick={() => setItem(idx, "requisitos", req.filter((_, j) => j !== i))} style={estiloBoton("peligro")}>Quitar requisito</button>
        </div>
      ))}
      <button type="button" data-agregar-requisito onClick={() => setItem(idx, "requisitos", [...req, { requisito: "", ofrecido: "", cumplimiento: "sin_declarar", respaldo: "" }])} style={{ ...estiloBoton(), marginBottom: 10 }}>+ Requisito</button>
      {docs.length > 0 && <>
        <Subtitulo>Anexos del ítem</Subtitulo>
        {docs.map((d) => {
          const marcado = (it.anexos || []).some((a) => a.documento_id === d.id);
          return <label key={d.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: T.sm, marginBottom: 4 }}><input type="checkbox" checked={marcado}
            onChange={(e) => setItem(idx, "anexos", e.target.checked ? [...(it.anexos || []), { documento_id: d.id, titulo: d.titulo, nombre_archivo: d.nombre_archivo }] : (it.anexos || []).filter((a) => a.documento_id !== d.id))} />{CATEGORIAS_DOCUMENTO[d.categoria]}: {d.titulo}</label>;
        })}
      </>}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}><button type="button" data-guardar-biblioteca onClick={onGuardarBiblioteca} style={estiloBoton()}>Guardar información técnica en la biblioteca</button></div>
    </Desplegable>
  );
}
