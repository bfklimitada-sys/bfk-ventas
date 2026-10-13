import { useEffect, useMemo, useRef, useState } from "react";
import { C, T, R, iStyle, iMono, selStyle, fmt } from "../../lib/theme";
import { Modal, Field } from "../ui/Basicos";
import { Badge, AvisoLinea, BotonPrincipal, BotonSecundario } from "../ui/Sistema";
import { revisarFicha, paresDeTexto, textoDePares, ESTADOS_ENVIO, proveedorDeEnlace, envioConfirmado, envioVacio } from "../../lib/cotizaciones";
import { normalizarImagen, traerImagen, rutaConocida } from "../../lib/cotizacionesDatos";

const m = (x) => fmt.money(Math.round(Number(x) || 0));
const mismoTexto = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

// Ficha de un producto (ingreso manual). Arriba: lo que va a la EETT (solo técnico).
// Abajo (solo en cotizaciones): datos comerciales internos, incluido el DESPACHO (individual o compartido),
// que se registra aquí mismo sin pasar por la pestaña Precios.
// modo: "item" (línea de cotización) | "biblioteca" (solo ficha técnica).
// protegido: cotización adjudicada → lo ofertado no se modifica (solo enlace, proveedor y ficha técnica).
export function EditorFicha({ inicial, envios = [], items = [], destino = "", modo = "item", almacen, token, onGuardar, onCerrar, esNuevo, protegido = false }) {
  const [it, setIt] = useState(() => JSON.parse(JSON.stringify(inicial)));
  const [txtGen, setTxtGen] = useState(() => textoDePares(inicial.ficha?.generales));
  const [txtEsp, setTxtEsp] = useState(() => textoDePares(inicial.ficha?.especificaciones));
  const [guardarBib, setGuardarBib] = useState(modo === "item" && !inicial.producto_id);
  const [actualizarBib, setActualizarBib] = useState(false);
  const [urlImg, setUrlImg] = useState(""); const [cargandoImg, setCargandoImg] = useState(false); const [error, setError] = useState("");
  const archivo = useRef(null);

  // Imágenes guardadas (rutas del depósito) → visibles para editarlas.
  useEffect(() => {
    const rutas = (inicial.ficha?.imagenes || []).filter((x) => typeof x === "string" && !x.startsWith("data:"));
    if (!rutas.length || !almacen) return;
    let vivo = true; setCargandoImg(true);
    almacen.resolverImagenes(inicial.ficha.imagenes, 4).then((imgs) => { if (vivo) setIt((x) => ({ ...x, ficha: { ...x.ficha, imagenes: imgs } })); }).finally(() => { if (vivo) setCargandoImg(false); });
    return () => { vivo = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Despacho ──
  const otrosDe = (key) => items.filter((x) => x.key !== inicial.key && x.envio_key === key);
  const envioActual = envios.find((e) => e.key === inicial.envio_key) || null;
  const [despMod, setDespMod] = useState(() => (envioActual && otrosDe(envioActual.key).length ? "existente" : "propio"));
  const [desp, setDesp] = useState(() => (envioActual ? { ...envioActual } : { ...envioVacio(inicial.proveedor), key: null }));
  const [reverificado, setReverificado] = useState(false);
  const elegibles = envios.filter((e) => !(envioActual && e.key === envioActual.key && !otrosDe(e.key).length));
  const setD = (k, v) => setDesp((d) => ({ ...d, [k]: v }));
  const elegirExistente = (key) => { const e = envios.find((x) => x.key === key); if (e) { setDesp({ ...e }); setReverificado(false); } };
  const cambiarModo = (mm) => {
    setDespMod(mm); setReverificado(false);
    if (mm === "existente" && elegibles[0]) setDesp({ ...elegibles[0] });
    if (mm === "propio") setDesp(envioActual && !otrosDe(envioActual.key).length ? { ...envioActual } : { ...envioVacio(it.proveedor), key: null });
  };
  const cambiarEstado = (estado) => { setDesp((d) => ({ ...d, estado })); setReverificado(envioConfirmado({ estado })); };
  const verificadoPara = envioConfirmado(desp) ? (reverificado ? destino : desp.destino) : "";
  const destinoDistinto = envioConfirmado(desp) && !reverificado && !mismoTexto(desp.destino, destino);
  const compartidoCon = desp.key ? otrosDe(desp.key) : [];

  const ficha = useMemo(() => ({ ...it.ficha, generales: paresDeTexto(txtGen), especificaciones: paresDeTexto(txtEsp) }), [it.ficha, txtGen, txtEsp]);
  const avisos = useMemo(() => revisarFicha(ficha), [ficha]);
  const setF = (k, v) => setIt((x) => ({ ...x, ficha: { ...x.ficha, [k]: v } }));
  const set = (k, v) => setIt((x) => ({ ...x, [k]: v }));
  const imgs = it.ficha.imagenes || [];

  const agregarArchivos = async (files) => {
    setError(""); setCargandoImg(true);
    try { const nuevas = []; for (const f of [...files].slice(0, 4)) nuevas.push(await normalizarImagen(f)); setF("imagenes", [...imgs, ...nuevas].filter((x, i, a) => a.indexOf(x) === i).slice(0, 4)); }
    catch (e) { setError(e.message); } finally { setCargandoImg(false); }
  };
  const agregarUrl = async () => {
    if (!urlImg.trim()) return; setError(""); setCargandoImg(true);
    try { const d = await traerImagen(token, urlImg.trim()); setF("imagenes", [...imgs, d].slice(0, 4)); setUrlImg(""); }
    catch (e) { setError(e.message); } finally { setCargandoImg(false); }
  };
  const mover = (i, d) => { const a = [...imgs]; const j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; setF("imagenes", a); };

  const guardar = () => {
    setError("");
    if (!ficha.nombre?.trim()) { setError("Falta el nombre exacto del producto."); return; }
    if (modo === "item" && !protegido) {
      if (!(Number(it.cantidad) > 0)) { setError("La cantidad debe ser mayor que cero."); return; }
      if (despMod === "existente" && !desp.key) { setError("Elige el despacho ya registrado que comparte este producto."); return; }
      if (envioConfirmado(desp) && reverificado && !destino) { setError("Para confirmar el despacho, primero ingresa la dirección de entrega del cliente en la pestaña Datos."); return; }
      if (envioConfirmado(desp) && !String(desp.evidencia || "").trim()) { setError("Registra brevemente cómo se verificó el despacho (simulación de compra, cotización del proveedor, captura…)."); return; }
      if (Number(desp.monto) < 0) { setError("El costo del despacho no puede ser negativo."); return; }
    }
    const fichaFinal = { ...ficha, imagenes: (ficha.imagenes || []).map(rutaConocida) };
    let item = { ...it, ficha: fichaFinal };
    // El primer enlace registrado se conserva como referencia si luego se cambia por otro.
    if (modo === "item" && inicial.enlace && !mismoTexto(inicial.enlace, it.enlace) && !inicial.enlace_original) item.enlace_original = inicial.enlace;
    const envio = modo === "item" && !protegido ? { modo: despMod, ...desp, destino: envioConfirmado(desp) ? (reverificado ? destino : desp.destino) : "", fecha_cotizacion: reverificado ? new Date().toISOString().slice(0, 10) : desp.fecha_cotizacion } : null;
    onGuardar(item, { guardarBiblioteca: guardarBib, actualizarBiblioteca: actualizarBib, envio });
  };

  const consulta = it.consulta;
  const bloq = { disabled: protegido, style: protegido ? { opacity: 0.6 } : undefined };
  return (
    <Modal title={modo === "biblioteca" ? "Ficha de la biblioteca" : esNuevo ? "Ingresar producto" : "Editar producto"} onClose={onCerrar}>
      <div data-editor-ficha>
        {consulta && (
          <div data-origen-consulta style={{ fontSize: T.small, color: C.inkMuted, background: C.paper, border: `1px solid ${C.border}`, borderRadius: R.sm, padding: "8px 10px", marginBottom: 12 }}>
            <div><b>Origen:</b> {consulta.fuente || "—"}{consulta.fecha_consulta ? ` · ${new Date(consulta.fecha_consulta).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" })}` : ""}</div>
            {consulta.advertencias?.map((a, i) => <div key={i} style={{ marginTop: 3, color: C.warnText }}>• {a}</div>)}
          </div>
        )}
        {protegido && <AvisoLinea tono="info" icono="🔒" dato="item-protegido">Cotización adjudicada: el producto ofertado (marca y modelo), la cantidad, los precios y el despacho quedan protegidos. Puedes actualizar el enlace de compra, el proveedor y corregir la ficha técnica.</AvisoLinea>}

        <div style={{ fontSize: T.small, fontWeight: 800, color: C.tealDark, textTransform: "uppercase", letterSpacing: 0.5, margin: "4px 0 8px" }}>Ficha técnica · va en la EETT</div>
        <Field label="Nombre exacto del producto" required><textarea data-campo="nombre" rows={2} value={it.ficha.nombre || ""} onChange={(e) => setF("nombre", e.target.value)} style={{ ...iStyle, resize: "vertical" }} /></Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <Field label="Marca"><input data-campo="marca" value={it.ficha.marca || ""} onChange={(e) => setF("marca", e.target.value)} style={iStyle} disabled={protegido} /></Field>
          <Field label="Modelo"><input data-campo="modelo" value={it.ficha.modelo || ""} onChange={(e) => setF("modelo", e.target.value)} style={iStyle} disabled={protegido} /></Field>
        </div>
        <Field label="Color"><input data-campo="color" value={it.ficha.color || ""} onChange={(e) => setF("color", e.target.value)} style={iStyle} /></Field>
        <Field label="Características generales" hint="Una por línea: Etiqueta: valor (marca, modelo y color van arriba)."><textarea data-campo="generales" rows={3} value={txtGen} onChange={(e) => setTxtGen(e.target.value)} style={{ ...iStyle, resize: "vertical" }} placeholder={"Material: Acero\nGarantía: 12 meses"} /></Field>
        <Field label="Especificaciones técnicas" hint="Una por línea: Etiqueta: valor."><textarea data-campo="especificaciones" rows={6} value={txtEsp} onChange={(e) => setTxtEsp(e.target.value)} style={{ ...iStyle, resize: "vertical" }} placeholder={"Capacidad bruta: 590 L\nVoltaje: 220 V"} /></Field>
        <Field label="Descripción técnica (opcional)"><textarea data-campo="descripcion" rows={3} value={it.ficha.descripcion || ""} onChange={(e) => setF("descripcion", e.target.value)} style={{ ...iStyle, resize: "vertical" }} /></Field>

        <Field label={`Imágenes (${imgs.length} de 4) · las 2 primeras van en la EETT`}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            {imgs.map((src, i) => (
              <div key={i} data-imagen-ficha style={{ position: "relative", width: 86, height: 86, border: `1px solid ${C.border}`, borderRadius: R.sm, background: "#fff", overflow: "hidden" }}>
                <img src={src} alt={`Imagen ${i + 1}`} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                <button type="button" aria-label="Quitar imagen" onClick={() => setF("imagenes", imgs.filter((_, j) => j !== i))} style={{ position: "absolute", top: 2, right: 2, width: 26, height: 26, minHeight: 26, borderRadius: 13, border: "none", background: "rgba(0,0,0,0.6)", color: "#fff", cursor: "pointer", padding: 0 }}>✕</button>
                {i > 0 && <button type="button" aria-label="Mover antes" onClick={() => mover(i, -1)} style={{ position: "absolute", bottom: 2, left: 2, width: 26, height: 26, minHeight: 26, borderRadius: 13, border: "none", background: "rgba(0,0,0,0.5)", color: "#fff", cursor: "pointer", padding: 0 }}>◀</button>}
              </div>
            ))}
            {cargandoImg && <div style={{ fontSize: T.small, color: C.inkFaint, alignSelf: "center" }}>Cargando imágenes…</div>}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <BotonSecundario data-agregar-foto onClick={() => archivo.current?.click()} disabled={cargandoImg || imgs.length >= 4}>Agregar foto</BotonSecundario>
            <input ref={archivo} type="file" accept="image/*" multiple hidden onChange={(e) => { agregarArchivos(e.target.files); e.target.value = ""; }} />
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            <input value={urlImg} onChange={(e) => setUrlImg(e.target.value)} placeholder="o pega el enlace de una imagen" style={{ ...iStyle, flex: 1 }} />
            <BotonSecundario onClick={agregarUrl} disabled={cargandoImg || !urlImg.trim() || imgs.length >= 4}>{cargandoImg ? "…" : "Traer"}</BotonSecundario>
          </div>
          <div style={{ fontSize: T.small, color: C.inkFaint, marginTop: 4 }}>Las fotos se reducen y comprimen automáticamente (máx. 1000 px).</div>
        </Field>

        {avisos.length > 0 && (
          <div data-revision-ficha style={{ marginBottom: 12 }}>
            {avisos.map((a, i) => <AvisoLinea key={i} tono={a.nivel === "bloqueo" ? "danger" : "warn"} dato={a.tipo}>{a.mensaje}</AvisoLinea>)}
          </div>
        )}

        {modo === "item" && (
          <div data-datos-internos style={{ borderTop: `2px dashed ${C.border}`, paddingTop: 12, marginTop: 4 }}>
            <div style={{ fontSize: T.small, fontWeight: 800, color: C.inkMuted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>🔒 Datos comerciales internos · nunca van en la EETT</div>
            <Field label="Enlace de compra del proveedor" hint={inicial.enlace_original && !mismoTexto(inicial.enlace_original, it.enlace) ? `Enlace original de referencia: ${inicial.enlace_original}` : "Se guarda para comprar después (no necesita leerse automáticamente)."}>
              <input data-campo="enlace" value={it.enlace || ""} onChange={(e) => { set("enlace", e.target.value); if (!it.proveedor) set("proveedor", proveedorDeEnlace(e.target.value)); }} style={iStyle} inputMode="url" placeholder="https://…" />
            </Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <Field label="Proveedor"><input data-campo="proveedor" value={it.proveedor || ""} onChange={(e) => set("proveedor", e.target.value)} style={iStyle} /></Field>
              <Field label="Cantidad" required><input data-campo="cantidad" type="number" inputMode="numeric" min="1" value={it.cantidad} onChange={(e) => set("cantidad", e.target.value)} style={iMono} {...bloq} /></Field>
            </div>
            <Field label="Precio unitario de compra" hint={it.precio_origen ? `${m(it.precio_origen)} ${it.precio_incluye_iva === false ? "+ IVA" : "con IVA incluido"}` : "Precio por unidad publicado por el proveedor."}>
              <input data-campo="precio" type="number" inputMode="decimal" min="0" value={it.precio_origen ?? ""} onChange={(e) => set("precio_origen", e.target.value)} style={iMono} {...bloq} />
            </Field>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: T.sm, marginBottom: 6, minHeight: 32 }}><input type="checkbox" disabled={protegido} checked={it.precio_incluye_iva !== false} onChange={(e) => set("precio_incluye_iva", e.target.checked)} /> El precio publicado incluye IVA</label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: T.sm, marginBottom: 12, minHeight: 32 }}><input type="checkbox" disabled={protegido} checked={it.con_factura !== false} onChange={(e) => set("con_factura", e.target.checked)} /> Se compra con factura</label>

            <div data-despacho-ficha style={{ border: `1px solid ${C.border}`, borderRadius: R.md, padding: "10px 12px", marginBottom: 12, background: C.paper, opacity: protegido ? 0.7 : 1 }}>
              <div style={{ fontSize: T.sm, fontWeight: 800, color: C.ink, marginBottom: 6 }}>Despacho</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                <BotonSecundario data-despacho-modo="propio" activo={despMod === "propio"} disabled={protegido} onClick={() => cambiarModo("propio")}>Despacho de este producto</BotonSecundario>
                {elegibles.length > 0 && <BotonSecundario data-despacho-modo="existente" activo={despMod === "existente"} disabled={protegido} onClick={() => cambiarModo("existente")}>Usar un despacho ya registrado</BotonSecundario>}
              </div>
              {despMod === "existente" && (
                <Field label="Despacho compartido (mismo pedido)">
                  <select data-campo="envio-existente" value={desp.key || ""} disabled={protegido} onChange={(e) => elegirExistente(e.target.value)} style={selStyle}>
                    {!desp.key && <option value="">Elige un despacho…</option>}
                    {elegibles.map((e) => <option key={e.key} value={e.key}>{e.proveedor || "Proveedor"} · {m(e.monto)} · {ESTADOS_ENVIO[e.estado]?.label} · {items.filter((x) => x.envio_key === e.key && x.key !== inicial.key).length} producto(s)</option>)}
                  </select>
                </Field>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <Field label={despMod === "existente" ? "Costo total del despacho compartido" : "Costo del despacho (pagado)"}>
                  <input data-campo="monto-despacho" type="number" inputMode="numeric" min="0" value={desp.monto ?? ""} onChange={(e) => setD("monto", e.target.value)} style={iMono} disabled={protegido} placeholder="0" />
                </Field>
                <Field label="Verificación">
                  <select data-campo="estado-despacho" value={desp.estado} disabled={protegido} onChange={(e) => cambiarEstado(e.target.value)} style={selStyle}>{Object.entries(ESTADOS_ENVIO).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
                </Field>
              </div>
              <Field label="Cómo se verificó"><input data-campo="evidencia-despacho" value={desp.evidencia || ""} disabled={protegido} onChange={(e) => setD("evidencia", e.target.value)} placeholder={destino ? `Simulación de compra a ${destino}…` : "Ingresa primero la dirección de entrega (Datos)"} style={iStyle} /></Field>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: T.sm, minHeight: 32 }}><input type="checkbox" disabled={protegido} checked={desp.con_factura !== false} onChange={(e) => setD("con_factura", e.target.checked)} /> Despacho incluido en la factura</label>
              <div data-despacho-destino style={{ fontSize: T.small, marginTop: 4, color: destinoDistinto ? C.warnText : C.inkMuted, fontWeight: destinoDistinto ? 700 : 400 }}>
                {!destino ? "Falta la dirección de entrega del cliente: el despacho se verifica para esa dirección." :
                  !envioConfirmado(desp) ? `Por verificar para: ${destino}. Nunca se asume despacho gratis.` :
                  destinoDistinto ? <>Verificado para «{desp.destino || "otra dirección"}»; la entrega ahora es «{destino}». <button type="button" data-reverificar onClick={() => setReverificado(true)} disabled={protegido} style={{ border: "none", background: "none", color: C.tealDark, textDecoration: "underline", cursor: "pointer", padding: 0, fontWeight: 700 }}>Lo verifiqué para la dirección actual</button></> :
                  `Verificado para: ${verificadoPara}`}
              </div>
              {compartidoCon.length > 0 && <div style={{ fontSize: T.small, color: C.inkMuted, marginTop: 4 }}>Compartido con: {compartidoCon.map((x) => x.ficha?.nombre || "producto").join(", ")}. El costo total se ingresa una sola vez y se reparte según el valor de cada producto.</div>}
            </div>

            <Field label="Recargo comercial individual (opcional)" hint="Vacío = recargo general de la cotización (sugerido 30%).">
              <input data-campo="recargo-item" type="number" inputMode="decimal" value={it.recargo == null || it.recargo === "" ? "" : Math.round(Number(it.recargo) * 1000) / 10} disabled={protegido}
                onChange={(e) => set("recargo", e.target.value === "" ? null : Number(e.target.value) / 100)} style={{ ...iMono, width: 120 }} placeholder="%" />
            </Field>
            {it.producto_id
              ? <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: T.sm, marginBottom: 8 }}><input type="checkbox" checked={actualizarBib} onChange={(e) => setActualizarBib(e.target.checked)} /> Actualizar también la ficha en la biblioteca compartida</label>
              : <label data-guardar-biblioteca style={{ display: "flex", alignItems: "center", gap: 8, fontSize: T.sm, marginBottom: 8 }}><input type="checkbox" checked={guardarBib} onChange={(e) => setGuardarBib(e.target.checked)} /> Guardar en la biblioteca compartida (solo la ficha técnica)</label>}
          </div>
        )}
        {error && <AvisoLinea tono="danger" dato="error-ficha">{error}</AvisoLinea>}
        <div style={{ display: "flex", gap: 8, marginTop: 8, position: "sticky", bottom: -20, background: C.card, padding: "10px 0" }}>
          <BotonSecundario onClick={onCerrar} style={{ flex: 1, justifyContent: "center", minHeight: 44 }}>Cancelar</BotonSecundario>
          <BotonPrincipal data-guardar-ficha onClick={guardar} style={{ flex: 2, justifyContent: "center" }}>{modo === "biblioteca" ? "Guardar ficha" : esNuevo ? "Agregar a la cotización" : "Guardar cambios"}</BotonPrincipal>
        </div>
        {avisos.some((a) => a.nivel === "revisar") && modo === "item" && <div style={{ fontSize: T.small, color: C.inkFaint, textAlign: "center" }}><Badge tono="warn">Revisar</Badge> Los avisos no impiden guardar; se aprueban antes de generar la EETT.</div>}
      </div>
    </Modal>
  );
}
