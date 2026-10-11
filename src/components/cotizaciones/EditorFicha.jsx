import { useMemo, useRef, useState } from "react";
import { C, T, R, iStyle, iMono, selStyle, fmt } from "../../lib/theme";
import { Modal, Field } from "../ui/Basicos";
import { Badge, AvisoLinea, BotonPrincipal, BotonSecundario } from "../ui/Sistema";
import { revisarFicha, paresDeTexto, textoDePares, ESTADOS_ENVIO, proveedorDeEnlace } from "../../lib/cotizaciones";
import { normalizarImagen, traerImagen } from "../../lib/cotizacionesDatos";

// Ficha de un producto. Arriba: lo que va a la EETT (solo técnico). Abajo (solo en cotizaciones): datos internos.
// modo: "item" (línea de cotización) | "biblioteca" (solo ficha técnica).
export function EditorFicha({ inicial, envios = [], modo = "item", token, onGuardar, onCerrar, esNuevo }) {
  const [it, setIt] = useState(() => JSON.parse(JSON.stringify(inicial)));
  const [txtGen, setTxtGen] = useState(() => textoDePares(inicial.ficha?.generales));
  const [txtEsp, setTxtEsp] = useState(() => textoDePares(inicial.ficha?.especificaciones));
  const [guardarBib, setGuardarBib] = useState(modo === "item" && !inicial.producto_id);
  const [actualizarBib, setActualizarBib] = useState(false);
  const [urlImg, setUrlImg] = useState(""); const [cargandoImg, setCargandoImg] = useState(false); const [error, setError] = useState("");
  const archivo = useRef(null);
  const ficha = useMemo(() => ({ ...it.ficha, generales: paresDeTexto(txtGen), especificaciones: paresDeTexto(txtEsp) }), [it.ficha, txtGen, txtEsp]);
  const avisos = useMemo(() => revisarFicha(ficha), [ficha]);
  const setF = (k, v) => setIt((x) => ({ ...x, ficha: { ...x.ficha, [k]: v } }));
  const set = (k, v) => setIt((x) => ({ ...x, [k]: v }));
  const imgs = it.ficha.imagenes || [];

  const agregarArchivos = async (files) => {
    setError(""); setCargandoImg(true);
    try { const nuevas = []; for (const f of [...files].slice(0, 4)) nuevas.push(await normalizarImagen(f)); setF("imagenes", [...imgs, ...nuevas].slice(0, 4)); }
    catch (e) { setError(e.message); } finally { setCargandoImg(false); }
  };
  const agregarUrl = async () => {
    if (!urlImg.trim()) return; setError(""); setCargandoImg(true);
    try { const d = await traerImagen(token, urlImg.trim()); setF("imagenes", [...imgs, d].slice(0, 4)); setUrlImg(""); }
    catch (e) { setError(e.message); } finally { setCargandoImg(false); }
  };
  const mover = (i, d) => { const a = [...imgs]; const j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; setF("imagenes", a); };

  const guardar = () => {
    if (!ficha.nombre?.trim()) { setError("Falta el nombre exacto del producto."); return; }
    if (modo === "item" && !(Number(it.cantidad) > 0)) { setError("La cantidad debe ser mayor que cero."); return; }
    onGuardar({ ...it, ficha }, { guardarBiblioteca: guardarBib, actualizarBiblioteca: actualizarBib });
  };

  const consulta = it.consulta;
  return (
    <Modal title={modo === "biblioteca" ? "Ficha de la biblioteca" : esNuevo ? "Agregar producto" : "Editar producto"} onClose={onCerrar}>
      <div data-editor-ficha>
        {consulta && (
          <div data-origen-consulta style={{ fontSize: T.small, color: C.inkMuted, background: C.paper, border: `1px solid ${C.border}`, borderRadius: R.sm, padding: "8px 10px", marginBottom: 12 }}>
            <div><b>Origen:</b> {consulta.fuente || "—"} · consultado {consulta.fecha_consulta ? new Date(consulta.fecha_consulta).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" }) : "—"}{consulta.metodos?.length ? ` · ${consulta.metodos.join(", ")}` : ""}</div>
            {consulta.advertencias?.map((a, i) => <div key={i} style={{ marginTop: 3, color: C.warnText }}>• {a}</div>)}
          </div>
        )}

        <div style={{ fontSize: T.small, fontWeight: 800, color: C.tealDark, textTransform: "uppercase", letterSpacing: 0.5, margin: "4px 0 8px" }}>Ficha técnica · va en la EETT</div>
        <Field label="Nombre exacto del producto" required><textarea data-campo="nombre" rows={2} value={it.ficha.nombre || ""} onChange={(e) => setF("nombre", e.target.value)} style={{ ...iStyle, resize: "vertical" }} /></Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <Field label="Marca"><input data-campo="marca" value={it.ficha.marca || ""} onChange={(e) => setF("marca", e.target.value)} style={iStyle} /></Field>
          <Field label="Modelo"><input data-campo="modelo" value={it.ficha.modelo || ""} onChange={(e) => setF("modelo", e.target.value)} style={iStyle} /></Field>
        </div>
        <Field label="Color"><input data-campo="color" value={it.ficha.color || ""} onChange={(e) => setF("color", e.target.value)} style={iStyle} /></Field>
        <Field label="Características generales" hint="Una por línea: Etiqueta: valor (marca, modelo y color van arriba)."><textarea data-campo="generales" rows={3} value={txtGen} onChange={(e) => setTxtGen(e.target.value)} style={{ ...iStyle, resize: "vertical" }} placeholder={"Material: Acero\nGarantía: 12 meses"} /></Field>
        <Field label="Especificaciones" hint="Una por línea: Etiqueta: valor."><textarea data-campo="especificaciones" rows={6} value={txtEsp} onChange={(e) => setTxtEsp(e.target.value)} style={{ ...iStyle, resize: "vertical" }} placeholder={"Tipo de impresión: Inyección a color\nResolución (DPI): Hasta 1200 x 1200 dpi"} /></Field>
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
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <BotonSecundario onClick={() => archivo.current?.click()} disabled={cargandoImg || imgs.length >= 4}>Agregar foto</BotonSecundario>
            <input ref={archivo} type="file" accept="image/*" multiple hidden onChange={(e) => { agregarArchivos(e.target.files); e.target.value = ""; }} />
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            <input value={urlImg} onChange={(e) => setUrlImg(e.target.value)} placeholder="o pega el enlace de una imagen" style={{ ...iStyle, flex: 1 }} />
            <BotonSecundario onClick={agregarUrl} disabled={cargandoImg || !urlImg.trim() || imgs.length >= 4}>{cargandoImg ? "…" : "Traer"}</BotonSecundario>
          </div>
        </Field>

        {avisos.length > 0 && (
          <div data-revision-ficha style={{ marginBottom: 12 }}>
            {avisos.map((a, i) => <AvisoLinea key={i} tono={a.nivel === "bloqueo" ? "danger" : "warn"} dato={a.tipo}>{a.mensaje}</AvisoLinea>)}
          </div>
        )}

        {modo === "item" && (
          <div data-datos-internos style={{ borderTop: `2px dashed ${C.border}`, paddingTop: 12, marginTop: 4 }}>
            <div style={{ fontSize: T.small, fontWeight: 800, color: C.inkMuted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>🔒 Datos internos · nunca van en la EETT</div>
            <Field label="Enlace del proveedor"><input data-campo="enlace" value={it.enlace || ""} onChange={(e) => { set("enlace", e.target.value); if (!it.proveedor) set("proveedor", proveedorDeEnlace(e.target.value)); }} style={iStyle} inputMode="url" /></Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <Field label="Proveedor"><input data-campo="proveedor" value={it.proveedor || ""} onChange={(e) => set("proveedor", e.target.value)} style={iStyle} /></Field>
              <Field label="Cantidad" required><input data-campo="cantidad" type="number" inputMode="numeric" min="1" value={it.cantidad} onChange={(e) => set("cantidad", e.target.value)} style={iMono} /></Field>
            </div>
            <Field label="Precio unitario del proveedor" hint={it.precio_origen ? `${fmt.money(Number(it.precio_origen))} ${it.precio_incluye_iva === false ? "+ IVA" : "con IVA incluido"}` : "Precio publicado por unidad."}>
              <input data-campo="precio" type="number" inputMode="decimal" min="0" value={it.precio_origen ?? ""} onChange={(e) => set("precio_origen", e.target.value)} style={iMono} />
            </Field>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: T.sm, marginBottom: 8, minHeight: 32 }}><input type="checkbox" checked={it.precio_incluye_iva !== false} onChange={(e) => set("precio_incluye_iva", e.target.checked)} /> El precio publicado incluye IVA</label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: T.sm, marginBottom: 12, minHeight: 32 }}><input type="checkbox" checked={it.con_factura !== false} onChange={(e) => set("con_factura", e.target.checked)} /> Se compra con factura (IVA recuperable)</label>
            <Field label="Disponibilidad"><input value={it.disponibilidad || ""} onChange={(e) => set("disponibilidad", e.target.value)} style={iStyle} placeholder="En stock, bajo pedido…" /></Field>
            <Field label="Envío" hint="Nunca se asume despacho gratis: el envío se confirma en la pestaña Precios.">
              <select data-campo="envio" value={it.envio_key || ""} onChange={(e) => set("envio_key", e.target.value || null)} style={selStyle}>
                <option value="">Sin asignar</option>
                {envios.map((e) => <option key={e.key} value={e.key}>{e.proveedor || "Proveedor"} · {ESTADOS_ENVIO[e.estado]?.label}{e.monto !== "" && e.monto != null ? ` · ${fmt.money(Number(e.monto))}` : ""}</option>)}
                <option value="__nuevo">+ Nuevo envío de {it.proveedor || "este proveedor"}</option>
              </select>
            </Field>
            {it.producto_id
              ? <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: T.sm, marginBottom: 8 }}><input type="checkbox" checked={actualizarBib} onChange={(e) => setActualizarBib(e.target.checked)} /> Actualizar también la ficha en la biblioteca compartida</label>
              : <label data-guardar-biblioteca style={{ display: "flex", alignItems: "center", gap: 8, fontSize: T.sm, marginBottom: 8 }}><input type="checkbox" checked={guardarBib} onChange={(e) => setGuardarBib(e.target.checked)} /> Guardar en la biblioteca compartida (solo la ficha técnica)</label>}
          </div>
        )}
        {error && <AvisoLinea tono="danger">{error}</AvisoLinea>}
        <div style={{ display: "flex", gap: 8, marginTop: 8, position: "sticky", bottom: -20, background: C.card, padding: "10px 0" }}>
          <BotonSecundario onClick={onCerrar} style={{ flex: 1, justifyContent: "center", minHeight: 44 }}>Cancelar</BotonSecundario>
          <BotonPrincipal data-guardar-ficha onClick={guardar} style={{ flex: 2, justifyContent: "center" }}>{modo === "biblioteca" ? "Guardar ficha" : esNuevo ? "Agregar a la cotización" : "Guardar cambios"}</BotonPrincipal>
        </div>
        {avisos.some((a) => a.nivel === "revisar") && modo === "item" && <div style={{ fontSize: T.small, color: C.inkFaint, textAlign: "center" }}><Badge tono="warn">Revisar</Badge> Los avisos no impiden guardar; se aprueban antes de generar la EETT.</div>}
      </div>
    </Modal>
  );
}
