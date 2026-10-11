import { useMemo, useState } from "react";
import { C, T, R, iStyle, iMono, selStyle, fmt, MONO } from "../../lib/theme";
import { Field, Modal } from "../ui/Basicos";
import { HojaLateral, Pestanas, PanelPestana, Tarjeta, Badge, AvisoLinea, BotonPrincipal, BotonSecundario, FilaDato, Desplegable, Seccion } from "../ui/Sistema";
import { calcularCotizacion, estadoParaPDF, textoParaMercadoPublico, margenDeRecargo, itemVacio, envioVacio, proveedorDeEnlace, ESTADOS_COTIZACION, ESTADOS_ENVIO, FORMULA, RECARGO_SUGERIDO } from "../../lib/cotizaciones";
import { consultarEnlace, traerImagen, logoBFK } from "../../lib/cotizacionesDatos";
import { extraerDeTexto } from "../../lib/extraerProducto";
import { descargarPdfEETT, huellaPDF } from "../../lib/eettPdf";
import { EditorFicha } from "./EditorFicha";
import logoUrl from "../../assets/bfk-logo.jpg";

const pct = (x) => `${(Math.round(Number(x) * 1000) / 10).toLocaleString("es-CL")}%`;
const m = (x) => fmt.money(Math.round(Number(x) || 0));
const iguales = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function EditorCotizacion({ almacen, inicial, token, entidadesCatalogo = [], productosBib = [], showToast, onGuardada, onBibliotecaCambio, onCerrar }) {
  const [cot, setCot] = useState(() => JSON.parse(JSON.stringify(inicial)));
  const [sucio, setSucio] = useState(!inicial.id);
  const [pestana, setPestana] = useState(inicial.id ? "productos" : "datos");
  const [editor, setEditor] = useState(null);       // { item, esNuevo }
  const [enlace, setEnlace] = useState(""); const [consultando, setConsultando] = useState(""); const [errorEnlace, setErrorEnlace] = useState(""); const [enlacePendiente, setEnlacePendiente] = useState("");
  const [verBib, setVerBib] = useState(false); const [buscaBib, setBuscaBib] = useState("");
  const [verTexto, setVerTexto] = useState(false); const [texto, setTexto] = useState("");
  const [guardando, setGuardando] = useState(false); const [generando, setGenerando] = useState(false); const [generados, setGenerados] = useState([]);

  const calc = useMemo(() => calcularCotizacion(cot), [cot]);
  const pdf = useMemo(() => estadoParaPDF(cot), [cot]);
  const cambiar = (fn) => { setCot((c) => fn(JSON.parse(JSON.stringify(c)))); setSucio(true); };
  const setCampo = (k, v) => cambiar((c) => { c[k] = v; return c; });

  // ── Productos ──
  const envioSugerido = (proveedor) => {
    const p = String(proveedor || "").trim().toLowerCase();
    return (p && cot.envios.find((e) => String(e.proveedor || "").trim().toLowerCase() === p)?.key) || "__nuevo";
  };
  const abrirNuevo = (item) => setEditor({ esNuevo: true, item: { ...item, envio_key: item.envio_key || envioSugerido(item.proveedor) } });

  const guardarItem = async (item, { guardarBiblioteca, actualizarBiblioteca }) => {
    let it = { ...item }; const consulta = it.consulta; delete it.consulta;
    try {
      if (guardarBiblioteca) { it.producto_id = await almacen.guardarProducto(it.ficha, { fuente: consulta?.fuente || proveedorDeEnlace(it.enlace), fecha_verificacion: it.fecha_consulta }); onBibliotecaCambio?.(); }
      else if (actualizarBiblioteca && it.producto_id) { await almacen.guardarProducto(it.ficha, { id: it.producto_id }); onBibliotecaCambio?.(); }
    } catch (e) { showToast?.(`No se guardó en la biblioteca: ${e.message}`, "error"); }
    cambiar((c) => {
      if (it.envio_key === "__nuevo") { const e = envioVacio(it.proveedor); c.envios.push(e); it.envio_key = e.key; }
      const i = c.items.findIndex((x) => x.key === it.key);
      if (i >= 0) { if (!iguales(c.items[i].ficha, it.ficha)) it.ficha_aprobada = false; c.items[i] = it; } else c.items.push(it);
      return c;
    });
    setEditor(null);
    if (guardarBiblioteca) showToast?.("Producto guardado en la biblioteca compartida");
  };

  const consultar = async () => {
    const u = enlace.trim(); if (!u) return;
    setErrorEnlace(""); setConsultando("Consultando el enlace…");
    try {
      const r = await consultarEnlace(token, u);
      const item = { ...itemVacio(), enlace: r.enlace || u, proveedor: proveedorDeEnlace(r.enlace || u) || r.fuente, precio_origen: r.precio_origen ?? "", precio_incluye_iva: r.precio_incluye_iva !== false,
        disponibilidad: r.disponibilidad || "", fecha_consulta: r.fecha_consulta, origen_datos: (r.metodos || []).join(",") || "enlace",
        consulta: { fuente: r.fuente, fecha_consulta: r.fecha_consulta, metodos: r.metodos, advertencias: [...(r.advertencias || [])] },
        ficha: { ...r.ficha, imagenes: [] } };
      const urls = (r.ficha?.imagenes || []).slice(0, 4);
      if (urls.length) {
        setConsultando(`Trayendo ${urls.length} imagen${urls.length > 1 ? "es" : ""}…`);
        const res = await Promise.allSettled(urls.map((x) => traerImagen(token, x)));
        item.ficha.imagenes = res.filter((x) => x.status === "fulfilled").map((x) => x.value);
        const fallas = res.length - item.ficha.imagenes.length; if (fallas) item.consulta.advertencias.push(`${fallas} imagen(es) no se pudieron traer.`);
      }
      setEnlace(""); abrirNuevo(item);
    } catch (e) { setErrorEnlace(e.message); setEnlacePendiente(u); } finally { setConsultando(""); }
  };
  const manual = (conEnlace) => abrirNuevo({ ...itemVacio(), enlace: conEnlace || "", proveedor: proveedorDeEnlace(conEnlace || ""), origen_datos: "manual" });
  const desdeTexto = () => {
    const r = extraerDeTexto(texto); const e = enlacePendiente;
    abrirNuevo({ ...itemVacio(), enlace: e, proveedor: proveedorDeEnlace(e), ficha: r.ficha, origen_datos: "texto", fecha_consulta: new Date().toISOString(),
      consulta: { fuente: e ? `${proveedorDeEnlace(e)} (texto pegado)` : "texto pegado", fecha_consulta: new Date().toISOString(), metodos: ["texto"], advertencias: r.advertencias } });
    setVerTexto(false); setTexto(""); setEnlacePendiente(""); setErrorEnlace(""); setEnlace("");
  };
  const desdeBiblioteca = (p) => {
    abrirNuevo({ ...itemVacio(), producto_id: p.id, origen_datos: "biblioteca", fecha_consulta: null,
      ficha: { nombre: p.nombre, marca: p.marca, modelo: p.modelo, color: p.color, descripcion: p.descripcion, generales: p.generales, especificaciones: p.especificaciones, imagenes: p.imagenes } });
    setVerBib(false); setBuscaBib("");
  };
  const quitar = (key) => { if (!window.confirm("¿Quitar este producto de la cotización? (La biblioteca no cambia.)")) return; cambiar((c) => { c.items = c.items.filter((x) => x.key !== key); return c; }); };
  const mover = (i, d) => cambiar((c) => { const j = i + d; if (j < 0 || j >= c.items.length) return c; [c.items[i], c.items[j]] = [c.items[j], c.items[i]]; return c; });

  // ── Envíos ──
  const setEnvio = (key, k, v) => cambiar((c) => { const e = c.envios.find((x) => x.key === key); if (e) e[k] = v; return c; });
  const quitarEnvio = (key) => cambiar((c) => { c.envios = c.envios.filter((e) => e.key !== key); c.items.forEach((it) => { if (it.envio_key === key) it.envio_key = null; }); return c; });
  const asignar = (itemKey, envKey) => cambiar((c) => { const it = c.items.find((x) => x.key === itemKey); if (!it) return c; if (envKey === "__nuevo") { const e = envioVacio(it.proveedor); c.envios.push(e); envKey = e.key; } it.envio_key = envKey || null; return c; });

  // ── Guardar / PDF ──
  const guardar = async () => {
    setGuardando(true);
    try { const r = await almacen.guardarCotizacion(cot); const nueva = { ...cot, id: r.id, version: r.version }; setCot(nueva); setSucio(false); showToast?.("Cotización guardada"); onGuardada?.(nueva); }
    catch (e) { showToast?.(e.message, "error"); } finally { setGuardando(false); }
  };
  const generarPDF = async () => {
    if (!pdf.listo) return; setGenerando(true);
    try {
      const logo = await logoBFK(logoUrl);
      const r = await descargarPdfEETT(cot, cot.items, { logo });
      let registro = "Descargado en este dispositivo";
      if (almacen.modo === "base") {
        if (cot.id && !sucio) { await almacen.registrarEETT(cot, r.blob, await huellaPDF(r.blob), r.paginas); registro = `Guardado (versión ${cot.version})`; }
        else registro = "Descargado · guarda la cotización para registrar el PDF";
      }
      setGenerados((g) => [{ nombre: r.nombre, paginas: r.paginas, cuando: new Date(), registro }, ...g]);
      showToast?.(`PDF EETT generado: ${r.paginas} página${r.paginas > 1 ? "s" : ""}`);
    } catch (e) { showToast?.(`No se pudo generar el PDF: ${e.message}`, "error"); } finally { setGenerando(false); }
  };
  const copiarMP = async () => {
    if (!calc.listo) { showToast?.("Hay costos o despachos pendientes: confírmalos antes de copiar precios.", "error"); return; }
    try { await navigator.clipboard.writeText(textoParaMercadoPublico(cot, calc)); showToast?.("Valores copiados (tabulados)"); }
    catch { showToast?.("No se pudo copiar en este navegador", "error"); }
  };
  const cerrar = () => { if (sucio && !window.confirm("Hay cambios sin guardar. ¿Cerrar igual?")) return; onCerrar(); };
  const elegirEntidad = (nombre) => {
    const e = entidadesCatalogo.find((x) => String(x.nombre_entidad || "").toLowerCase() === String(nombre).toLowerCase());
    cambiar((c) => { c.institucion = nombre; if (e) { if (!c.rut) c.rut = e.rut || ""; if (!c.comuna) c.comuna = e.comuna || ""; } return c; });
  };

  const nPend = calc.pendientes.length; const nRev = pdf.porItem.filter((p) => !p.aprobado).length;
  const filtradosBib = productosBib.filter((p) => !buscaBib.trim() || `${p.nombre} ${p.marca} ${p.modelo}`.toLowerCase().includes(buscaBib.trim().toLowerCase()));
  const titulo = cot.id_externo || (cot.id ? "Cotización" : "Nueva cotización");

  return (
    <HojaLateral abierta onCerrar={cerrar} dato="cotizacion" titulo={titulo} subtitulo={[cot.institucion, ESTADOS_COTIZACION[cot.estado]?.label].filter(Boolean).join(" · ")}
      derecha={<BotonPrincipal data-guardar-cotizacion onClick={guardar} disabled={guardando} style={{ minHeight: 40, padding: "8px 14px", opacity: guardando ? 0.6 : 1 }}>{guardando ? "Guardando…" : sucio ? "Guardar •" : "Guardado"}</BotonPrincipal>}>
      <div style={{ padding: 16 }} data-editor-cotizacion>
        <Pestanas etiqueta="Cotización" activa={pestana} onCambiar={setPestana} items={[
          { key: "datos", label: "Datos" },
          { key: "productos", label: "Productos", n: cot.items.length || null },
          { key: "precios", label: "Precios", n: nPend || null, tono: nPend ? "warn" : null },
          { key: "eett", label: "EETT", n: nRev || null, tono: nRev ? "warn" : null },
        ]} />

        <PanelPestana visible={pestana === "datos"} titulo="Datos">
          <Field label="ID Mercado Público" required><input data-campo="id_externo" value={cot.id_externo} onChange={(e) => setCampo("id_externo", e.target.value.trim().toUpperCase())} style={iMono} placeholder="1525570-33-COT26" /></Field>
          <Field label="Nombre de la licitación / compra ágil"><input data-campo="nombre_licitacion" value={cot.nombre} onChange={(e) => setCampo("nombre", e.target.value)} style={iStyle} /></Field>
          <Field label="Institución" required><input data-campo="institucion" list="cz-entidades" value={cot.institucion} onChange={(e) => elegirEntidad(e.target.value)} style={iStyle} />
            <datalist id="cz-entidades">{entidadesCatalogo.slice(0, 400).map((e) => <option key={e.id || e.rut} value={e.nombre_entidad} />)}</datalist></Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <Field label="RUT"><input data-campo="rut" value={cot.rut} onChange={(e) => setCampo("rut", e.target.value)} style={iMono} /></Field>
            <Field label="Fecha de emisión"><input type="date" value={cot.fecha || ""} onChange={(e) => setCampo("fecha", e.target.value)} style={iStyle} /></Field>
          </div>
          <Field label="Dirección de entrega" hint="Con ella se verifica el envío real de cada proveedor."><input data-campo="direccion" value={cot.direccion_entrega} onChange={(e) => setCampo("direccion_entrega", e.target.value)} style={iStyle} /></Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <Field label="Comuna"><input value={cot.comuna} onChange={(e) => setCampo("comuna", e.target.value)} style={iStyle} /></Field>
            <Field label="Plazo de entrega"><input data-campo="plazo" value={cot.plazo} onChange={(e) => setCampo("plazo", e.target.value)} style={iStyle} placeholder="2 DIAS" /></Field>
          </div>
          <Field label="Estado"><select data-campo="estado" value={cot.estado} onChange={(e) => setCampo("estado", e.target.value)} style={selStyle}>{Object.entries(ESTADOS_COTIZACION).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
          {cot.estado === "adjudicada" && <Field label="OC adjudicada (opcional)" hint="Solo deja el vínculo: no crea ni modifica la OC."><input value={cot.oc_codigo || ""} onChange={(e) => setCampo("oc_codigo", e.target.value.trim().toUpperCase())} style={iMono} placeholder="1525570-1082-AG26" /></Field>}
          <Field label="Observaciones (internas)"><textarea rows={3} value={cot.observaciones} onChange={(e) => setCampo("observaciones", e.target.value)} style={{ ...iStyle, resize: "vertical" }} /></Field>
        </PanelPestana>

        <PanelPestana visible={pestana === "productos"} titulo="Productos">
          <Tarjeta padding="12px">
            <div style={{ display: "flex", gap: 6 }}>
              <input data-enlace-proveedor value={enlace} onChange={(e) => { setEnlace(e.target.value); if (enlacePendiente) { setEnlacePendiente(""); setErrorEnlace(""); } }} onKeyDown={(e) => { if (e.key === "Enter") consultar(); }} inputMode="url" placeholder="Pega el enlace del proveedor (Falabella, Mercado Libre…)" style={{ ...iStyle, flex: 1 }} />
              <BotonPrincipal data-consultar-enlace onClick={consultar} disabled={!!consultando || !enlace.trim()} style={{ opacity: consultando || !enlace.trim() ? 0.6 : 1, padding: "8px 14px" }}>{consultando ? "…" : "Consultar"}</BotonPrincipal>
            </div>
            {consultando && <div style={{ fontSize: T.small, color: C.inkMuted, marginTop: 6 }}>{consultando}</div>}
            {errorEnlace && <AvisoLinea tono="warn" dato="error-enlace">{errorEnlace}</AvisoLinea>}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
              <BotonSecundario data-desde-biblioteca onClick={() => setVerBib(true)}>Desde biblioteca{productosBib.length ? ` (${productosBib.length})` : ""}</BotonSecundario>
              <BotonSecundario data-ingreso-manual onClick={() => { manual(enlacePendiente); setErrorEnlace(""); setEnlace(""); setEnlacePendiente(""); }}>Ingresar manual</BotonSecundario>
              <BotonSecundario data-pegar-texto onClick={() => setVerTexto(true)}>Pegar texto de ficha</BotonSecundario>
            </div>
          </Tarjeta>
          {!cot.items.length && <div style={{ fontSize: T.sm, color: C.inkFaint, textAlign: "center", padding: 20 }}>Agrega el primer producto con un enlace, desde la biblioteca o manualmente.</div>}
          {cot.items.map((it, i) => {
            const l = calc.lineas[i]; const rv = pdf.porItem[i]; const env = cot.envios.find((e) => e.key === it.envio_key);
            return (
              <Tarjeta key={it.key} padding="10px 12px" data-item-cotizacion={i + 1}>
                <div style={{ display: "flex", gap: 10 }}>
                  <div style={{ width: 56, height: 56, flexShrink: 0, borderRadius: R.sm, border: `1px solid ${C.border}`, background: "#fff", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", color: C.inkFaint, fontSize: 11 }}>
                    {it.ficha.imagenes?.[0] ? <img src={it.ficha.imagenes[0]} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : "Sin foto"}
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: T.sm, fontWeight: 800, color: C.ink, lineHeight: 1.3, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{i + 1}. {it.ficha.nombre || "Sin nombre"}</div>
                    <div style={{ fontSize: T.small, color: C.inkMuted, marginTop: 2 }}>{[it.ficha.marca, it.ficha.modelo].filter(Boolean).join(" · ") || "Sin marca/modelo"}{it.proveedor ? ` · ${it.proveedor}` : ""}</div>
                    {Number(it.precio_origen) > 0
                      ? <div style={{ fontSize: T.small, color: C.ink, marginTop: 2, fontFamily: MONO }}>{l.cantidad} × {m(it.precio_origen)}{it.precio_incluye_iva === false ? " + IVA" : ""} → <b>{m(l.unitario_neto)}</b> neto c/u</div>
                      : <div style={{ fontSize: T.small, color: C.warnText, marginTop: 2, fontWeight: 700 }}>Falta el precio de compra · toca Editar</div>}
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
                      {it.producto_id && <Badge tono="info">Biblioteca</Badge>}
                      {!env ? <Badge tono="warn">Envío sin asignar</Badge> : !["confirmado", "sin_costo_confirmado"].includes(env.estado) && <Badge tono={ESTADOS_ENVIO[env.estado]?.tono}>Envío {ESTADOS_ENVIO[env.estado]?.label.toLowerCase()}</Badge>}
                      {rv.bloqueos.length > 0 && <Badge tono="danger">{rv.bloqueos.length} bloqueo</Badge>}
                      {rv.revisar.length > 0 && <Badge tono={it.ficha_aprobada ? "ok" : "warn"}>{it.ficha_aprobada ? "Ficha aprobada" : `${rv.revisar.length} por revisar`}</Badge>}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 8, justifyContent: "flex-end" }}>
                  {i > 0 && <BotonSecundario aria-label="Subir" onClick={() => mover(i, -1)} style={{ minHeight: 34, padding: "4px 10px" }}>↑</BotonSecundario>}
                  <BotonSecundario onClick={() => quitar(it.key)} style={{ minHeight: 34, padding: "4px 10px", color: C.dangerText }}>Quitar</BotonSecundario>
                  <BotonSecundario data-editar-item onClick={() => setEditor({ esNuevo: false, item: it })} style={{ minHeight: 34, padding: "4px 12px" }}>Editar</BotonSecundario>
                </div>
              </Tarjeta>
            );
          })}
        </PanelPestana>

        <PanelPestana visible={pestana === "precios"} titulo="Precios">
          {!FORMULA.confirmada && <AvisoLinea tono="info" icono="⚠" dato="formula-provisional">Fórmula provisional: recargo sobre costo neto real, unitario redondeado hacia arriba. Pendiente de confirmación.</AvisoLinea>}
          <Tarjeta padding="12px 14px">
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <label htmlFor="cz-recargo" style={{ fontSize: T.sm, fontWeight: 800, color: C.ink }}>Recargo comercial</label>
              <input id="cz-recargo" data-campo="recargo" type="number" inputMode="decimal" step="1" value={cot.recargo === "" || cot.recargo == null ? "" : Math.round(Number(cot.recargo) * 1000) / 10}
                onChange={(e) => setCampo("recargo", e.target.value === "" ? "" : Number(e.target.value) / 100)} style={{ ...iMono, width: 90 }} />
              <span style={{ fontSize: T.sm }}>%</span>
              {Number(cot.recargo) !== RECARGO_SUGERIDO && <button type="button" onClick={() => setCampo("recargo", RECARGO_SUGERIDO)} style={{ border: "none", background: "none", color: C.tealDark, textDecoration: "underline", cursor: "pointer", fontSize: T.small, padding: 0, minHeight: 32 }}>Usar sugerido 30%</button>}
            </div>
            <div style={{ fontSize: T.small, color: C.inkMuted, marginTop: 4 }}>Sugerido 30% (no obligatorio). Equivale a un margen de {pct(margenDeRecargo(cot.recargo === "" ? RECARGO_SUGERIDO : cot.recargo))} sobre la venta neta. Cada producto puede tener su propio recargo.</div>
          </Tarjeta>

          <Seccion titulo="Envíos por proveedor" nota="Modalidad A: el envío va dentro de los precios unitarios y el campo Despacho de Mercado Público queda en $0. Nunca se asume despacho gratis.">
            {!cot.envios.length && <div style={{ fontSize: T.sm, color: C.inkFaint }}>Aún no hay envíos. Se crean al agregar productos.</div>}
            {cot.envios.map((e) => {
              const ls = cot.items.map((it, i) => ({ it, i })).filter((x) => x.it.envio_key === e.key);
              return (
                <Tarjeta key={e.key} padding="10px 12px" data-envio={e.proveedor}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <input value={e.proveedor} onChange={(ev) => setEnvio(e.key, "proveedor", ev.target.value)} placeholder="Proveedor / pedido" style={{ ...iStyle, fontWeight: 800, flex: 1 }} />
                    <Badge tono={ESTADOS_ENVIO[e.estado]?.tono}>{ESTADOS_ENVIO[e.estado]?.label}</Badge>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
                    <Field label="Monto del envío (pagado)"><input data-campo="monto-envio" type="number" inputMode="numeric" min="0" value={e.monto} onChange={(ev) => setEnvio(e.key, "monto", ev.target.value)} style={iMono} /></Field>
                    <Field label="Verificación"><select data-campo="estado-envio" value={e.estado} onChange={(ev) => setEnvio(e.key, "estado", ev.target.value)} style={selStyle}>{Object.entries(ESTADOS_ENVIO).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></Field>
                  </div>
                  <Field label="Evidencia / destino verificado"><input value={e.evidencia} onChange={(ev) => setEnvio(e.key, "evidencia", ev.target.value)} placeholder={cot.comuna ? `Simulado a ${cot.comuna}…` : "Cómo se verificó (comuna, captura, carro)"} style={iStyle} /></Field>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: T.sm, minHeight: 32 }}><input type="checkbox" checked={e.con_factura !== false} onChange={(ev) => setEnvio(e.key, "con_factura", ev.target.checked)} /> Envío incluido en la factura (IVA recuperable)</label>
                  <div style={{ fontSize: T.small, color: C.inkMuted, marginTop: 4 }}>
                    {ls.length ? `Reparto según valor: ${ls.map(({ it, i }) => `${i + 1}. ${m(calc.lineas[i].envio_asignado)}`).join(" · ")}` : "No asignado a ningún producto."}
                    {!ls.length && <button type="button" onClick={() => quitarEnvio(e.key)} style={{ marginLeft: 8, border: "none", background: "none", color: C.dangerText, textDecoration: "underline", cursor: "pointer", padding: 0 }}>Quitar</button>}
                  </div>
                </Tarjeta>
              );
            })}
          </Seccion>

          <Seccion titulo="Desglose por producto">
            {cot.items.map((it, i) => {
              const l = calc.lineas[i];
              return (
                <Desplegable key={it.key} dato={`linea-${i + 1}`} titulo={`${i + 1}. ${it.ficha.nombre || "Producto"}`} resumen={`${l.cantidad} u · ${m(l.unitario_neto)} neto c/u`} derecha={<span style={{ fontFamily: MONO, fontWeight: 800, fontSize: 13 }}>{m(l.neto_linea)}</span>}>
                  <FilaDato k="Productos (desembolso con IVA)" v={m(l.costo_producto_bruto)} />
                  <FilaDato k="Envío asignado" signo="+" v={m(l.envio_asignado)} />
                  <FilaDato k="Costo bruto desembolsado" signo="=" v={m(l.costo_bruto)} fuerte />
                  <FilaDato k="IVA crédito recuperable" signo="−" v={m(l.iva_credito)} nota={it.con_factura === false ? "Compra sin factura: el IVA es costo." : null} />
                  <FilaDato k="Costo neto" signo="=" v={m(l.costo_neto)} fuerte />
                  <FilaDato k={`Recargo ${pct(l.recargo)}`} signo="+" v={m(l.neto_linea - l.costo_neto)} />
                  <FilaDato k="Precio unitario neto para Mercado Público" v={m(l.unitario_neto)} fuerte tono="ok" dato={`unitario-${i + 1}`} />
                  <FilaDato k={`Total neto línea (${l.cantidad} u)`} v={m(l.neto_linea)} />
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: T.small }}>
                    <span>Recargo propio de esta línea:</span>
                    <input type="number" inputMode="decimal" value={it.recargo == null || it.recargo === "" ? "" : Math.round(Number(it.recargo) * 1000) / 10} placeholder={String(Math.round(Number(cot.recargo === "" ? RECARGO_SUGERIDO : cot.recargo) * 1000) / 10)}
                      onChange={(e) => cambiar((c) => { c.items[i].recargo = e.target.value === "" ? null : Number(e.target.value) / 100; return c; })} style={{ ...iMono, width: 80, minHeight: 34, padding: "4px 8px" }} /> %
                  </div>
                </Desplegable>
              );
            })}
          </Seccion>

          <Tarjeta padding="12px 14px" data-totales-cotizacion>
            <FilaDato k="Costo bruto desembolsado" v={m(calc.totales.costo_bruto)} dato="costo-bruto" />
            <FilaDato k="IVA crédito recuperable" signo="−" v={m(calc.totales.iva_credito)} dato="iva-credito" />
            <FilaDato k="Costo neto" signo="=" v={m(calc.totales.costo_neto)} fuerte dato="costo-neto" />
            <FilaDato k="Venta neta ofertada" v={m(calc.totales.neto)} fuerte dato="neto" />
            <FilaDato k="IVA débito (19%)" signo="+" v={m(calc.totales.iva_debito)} dato="iva-debito" />
            <FilaDato k="Total con IVA" signo="=" v={m(calc.totales.total)} fuerte dato="total" />
            <FilaDato k="Despacho en Mercado Público (modalidad A)" v={m(0)} dato="despacho-mp" />
            <FilaDato k="Utilidad neta (venta neta − costo neto)" v={m(calc.totales.utilidad_neta)} tono={calc.totales.utilidad_neta >= 0 ? "ok" : "danger"} fuerte dato="utilidad" nota={`Margen ${pct(calc.totales.margen_sobre_venta)} sobre venta · recargo efectivo ${pct(calc.totales.recargo_efectivo)}`} />
            <FilaDato k="IVA neto estimado de esta operación (débito − crédito)" v={m(calc.totales.iva_a_pagar)} dato="iva-pagar" nota="Estimación referencial de esta cotización. No es el F29 ni el IVA a pagar del mes: ese se determina con todas las compras y ventas del período." />
          </Tarjeta>
          {calc.pendientes.map((p, i) => <AvisoLinea key={i} tono="warn" dato="pendiente-precio">{p}</AvisoLinea>)}
          <BotonSecundario data-copiar-mp onClick={copiarMP} disabled={!cot.items.length || !calc.listo} style={{ width: "100%", justifyContent: "center", minHeight: 44 }}>Copiar valores para Mercado Público</BotonSecundario>
          {cot.items.length > 0 && !calc.listo && <div data-copiar-bloqueado style={{ fontSize: T.small, color: C.warnText, textAlign: "center", marginTop: 6 }}>Bloqueado: confirma los costos y despachos pendientes ({calc.pendientes.length}) antes de copiar precios a Mercado Público.</div>}
        </PanelPestana>

        <PanelPestana visible={pestana === "eett"} titulo="EETT">
          <AvisoLinea tono="info" icono="🔒">El PDF contiene solo información técnica: nunca precios, envíos, enlaces, proveedores ni utilidades.</AvisoLinea>
          {pdf.faltan.length > 0 && <AvisoLinea tono="warn" dato="faltan-datos" accion="Completar" onClick={() => setPestana("datos")}>Falta: {pdf.faltan.join(" y ")}.</AvisoLinea>}
          {!cot.items.length && <div style={{ fontSize: T.sm, color: C.inkFaint }}>Agrega productos para generar la EETT.</div>}
          {pdf.porItem.map((p, i) => {
            const it = cot.items[i];
            return (
              <Tarjeta key={p.key} padding="10px 12px" data-revision-eett={i + 1}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                  <div style={{ fontSize: T.sm, fontWeight: 800, color: C.ink, minWidth: 0 }}>Ficha {i + 1}: {it.ficha.nombre || "Sin nombre"}</div>
                  <Badge tono={p.bloqueos.length ? "danger" : p.aprobado ? "ok" : "warn"}>{p.bloqueos.length ? "Bloqueada" : p.aprobado ? "Lista" : "Revisar"}</Badge>
                </div>
                {p.avisos.map((a, j) => <div key={j} style={{ fontSize: T.small, color: a.nivel === "bloqueo" ? C.dangerText : C.warnText, marginTop: 4 }}>• {a.mensaje}</div>)}
                {p.revisar.length > 0 && !p.bloqueos.length && (
                  <label data-aprobar-ficha style={{ display: "flex", alignItems: "center", gap: 8, fontSize: T.sm, marginTop: 8, minHeight: 36, fontWeight: 700 }}>
                    <input type="checkbox" checked={!!it.ficha_aprobada} onChange={(e) => cambiar((c) => { c.items[i].ficha_aprobada = e.target.checked; return c; })} />
                    Revisé estos avisos y apruebo la ficha tal como está
                  </label>
                )}
                <div style={{ marginTop: 6 }}><button type="button" onClick={() => setEditor({ esNuevo: false, item: it })} style={{ border: "none", background: "none", color: C.tealDark, textDecoration: "underline", cursor: "pointer", fontSize: T.small, padding: 0, minHeight: 30 }}>Corregir ficha</button></div>
              </Tarjeta>
            );
          })}
          <BotonPrincipal data-generar-eett onClick={generarPDF} disabled={!pdf.listo || generando} style={{ width: "100%", justifyContent: "center", marginTop: 4, opacity: !pdf.listo || generando ? 0.55 : 1 }}>{generando ? "Generando…" : `Generar PDF EETT (${cot.items.length} ficha${cot.items.length === 1 ? "" : "s"})`}</BotonPrincipal>
          {generados.map((g, i) => <div key={i} data-eett-generado style={{ fontSize: T.small, color: C.inkMuted, marginTop: 8 }}>✓ {g.nombre} · {g.paginas} pág. · {g.cuando.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })} · {g.registro}</div>)}
        </PanelPestana>
      </div>

      {editor && <EditorFicha key={editor.item.key} inicial={editor.item} esNuevo={editor.esNuevo} envios={cot.envios} token={token} onGuardar={guardarItem} onCerrar={() => setEditor(null)} />}
      {verBib && (
        <Modal title="Biblioteca de productos" onClose={() => setVerBib(false)}>
          <input value={buscaBib} onChange={(e) => setBuscaBib(e.target.value)} placeholder="Buscar por nombre, marca o modelo" style={{ ...iStyle, marginBottom: 10 }} autoFocus />
          {!productosBib.length && <div style={{ fontSize: T.sm, color: C.inkFaint }}>La biblioteca está vacía. Los productos aprobados en tus cotizaciones aparecerán aquí.</div>}
          {filtradosBib.slice(0, 60).map((p) => (
            <Tarjeta key={p.id} onClick={() => desdeBiblioteca(p)} padding="8px 10px" data-producto-biblioteca={p.nombre}>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <div style={{ width: 44, height: 44, flexShrink: 0, background: "#fff", border: `1px solid ${C.border}`, borderRadius: R.sm, overflow: "hidden" }}>{p.imagenes?.[0] && <img src={p.imagenes[0]} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />}</div>
                <div style={{ minWidth: 0 }}><div style={{ fontSize: T.sm, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.nombre}</div><div style={{ fontSize: T.small, color: C.inkMuted }}>{[p.marca, p.modelo].filter(Boolean).join(" · ")}</div></div>
              </div>
            </Tarjeta>
          ))}
        </Modal>
      )}
      {verTexto && (
        <Modal title="Pegar texto de la ficha" onClose={() => setVerTexto(false)}>
          <Field label="Texto copiado de la página del proveedor" hint={`Copia desde tu teléfono la sección de características (una por línea: Etiqueta: valor, o tabulado). Luego revisas y completas la ficha.${enlacePendiente ? " El enlace se guarda como dato interno." : ""}`}>
            <textarea data-texto-ficha rows={10} value={texto} onChange={(e) => setTexto(e.target.value)} style={{ ...iStyle, resize: "vertical" }} />
          </Field>
          <BotonPrincipal onClick={desdeTexto} disabled={!texto.trim()} style={{ width: "100%", justifyContent: "center" }}>Continuar</BotonPrincipal>
        </Modal>
      )}
    </HojaLateral>
  );
}
