// Proyectos Industriales — documentos del proyecto (depósito privado «pi-documentos»).
// Cada archivo se sube a <proyecto>/<nombre único>, se registra con su huella SHA-256 y nunca se reemplaza ni se borra:
// una versión nueva deja la anterior como «reemplazada» y anular exige motivo. La carga está deshabilitada hasta que
// el respaldo diario de archivos esté activo (pi_configuracion); la descarga comprueba la huella.
import { useEffect, useState } from "react";
import { C, R, S, T, cardStyle, btnMini } from "../../lib/theme";
import { Badge, Seccion, Desplegable, AvisoLinea, AvisoAccion } from "../ui/Sistema";
import { Ventana, Campo, Rejilla, Entrada, Selector, ErrorForm, Vacio, PedirMotivo, estiloBoton } from "./Comunes";
import { CATEGORIAS_DOC, MAX_ARCHIVO, agruparDocumentos, rutaArchivo, extension, categoriaDocDe, etiqueta, formatoTamano, mensajeError } from "../../lib/proyectos";
import { listarDocumentos, listarEntregables, subirDocumento, descargarDocumento, guardarArchivo, actualizarDocumento } from "../../lib/proyectosDatos";

export function PestanaDocumentos({ token, proyecto: p, per, nombres, modulo, version, onCambio, showToast, onConfigDocumentos }) {
  const [docs, setDocs] = useState(null); const [ents, setEnts] = useState([]); const [error, setError] = useState("");
  const [subir, setSubir] = useState(null); const [anular, setAnular] = useState(null); const [bajando, setBajando] = useState(null);
  const cargar = async () => {
    try { const [d, e] = await Promise.all([listarDocumentos(token, p.id), listarEntregables(token, p.id)]); setDocs(d || []); setEnts(e || []); setError(""); }
    catch (er) { setError(mensajeError(er)); setDocs([]); }
  };
  useEffect(() => { cargar(); }, [p.id, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const habilitada = !!modulo?.documentosHabilitados;
  const puedeSubir = per.editarContenido && habilitada;
  async function descargar(d) {
    setBajando(d.id);
    try { const blob = await descargarDocumento(token, d); guardarArchivo(blob, d.nombre_archivo); }
    catch (e) { showToast(mensajeError(e), "error"); }
    finally { setBajando(null); }
  }
  if (docs === null) return <Vacio>Cargando documentos…</Vacio>;
  const grupos = agruparDocumentos(docs);
  const vigentes = grupos.filter((g) => !g.anulado);
  const anteriores = docs.filter((d) => d.estado !== "vigente");
  const Fila = ({ d, grupo }) => (
    <div data-documento={d.titulo} data-documento-version={d.numero_version} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
      <span style={{ width: 36, height: 36, borderRadius: R.sm, background: C.infoLight, color: C.info, fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{extension(d.nombre_archivo) || "DOC"}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontWeight: 700, color: C.ink, overflowWrap: "anywhere" }}>{d.titulo}</span>
          <Badge tono={d.estado === "vigente" ? "ok" : d.estado === "anulado" ? "danger" : "neutro"}><span data-estado-documento={d.estado}>v{d.numero_version} {d.estado === "vigente" ? "vigente" : d.estado === "anulado" ? "anulado" : "reemplazada"}</span></Badge>
        </div>
        <div style={{ fontSize: T.small, color: C.inkMuted, marginTop: 2, overflowWrap: "anywhere" }}>
          {[etiqueta(categoriaDocDe, d.categoria), d.nombre_archivo, formatoTamano(d.tamano), nombres[d.subido_por] || "—", new Date(d.subido_en).toLocaleDateString("es-CL"),
            grupo && grupo.versiones.length > 1 ? `${grupo.versiones.length} versiones` : null, d.entregable_id ? `entregable: ${ents.find((e) => e.id === d.entregable_id)?.nombre || "—"}` : null].filter(Boolean).join(" · ")}
        </div>
        {d.motivo_anulacion && <div style={{ fontSize: T.small, color: C.dangerText, marginTop: 2 }}>Anulado: {d.motivo_anulacion}</div>}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
          <button type="button" data-descargar={d.titulo} data-descargar-version={d.numero_version} disabled={bajando === d.id} onClick={() => descargar(d)} style={btnMini()}>{bajando === d.id ? "Descargando…" : "Descargar"}</button>
          {grupo && d.estado === "vigente" && puedeSubir && <button type="button" data-nueva-version={d.titulo} onClick={() => setSubir({ base: d })} style={btnMini()}>Nueva versión</button>}
          {grupo && d.estado === "vigente" && per.editarContenido && <button type="button" data-anular-documento={d.titulo} onClick={() => setAnular(d)} style={btnMini("peligro")}>Anular</button>}
        </div>
      </div>
    </div>
  );
  return (
    <Seccion titulo={`Documentos · ${vigentes.length}`} accion={puedeSubir && <button type="button" data-subir-documento onClick={() => setSubir({})} style={estiloBoton("pri")}>+ Subir</button>}
      nota="Privados: solo el equipo del proyecto puede verlos. Los archivos no se reemplazan ni se borran; cada versión queda guardada.">
      {error && <ErrorForm>{error}</ErrorForm>}
      {/* Configuración de la carga (antes, en la lista de Proyectos): aplica a todos los proyectos; solo el administrador la cambia, con motivo. */}
      {per.admin && onConfigDocumentos ? (
        <div data-config-documentos={habilitada ? "habilitada" : "deshabilitada"}>
          <AvisoAccion tono={habilitada ? "ok" : "warn"} icono="🔒" dato="config-documentos" accionDato="alternar-documentos"
            titulo={`Carga de documentos ${habilitada ? "habilitada" : "deshabilitada"} (todos los proyectos)`}
            accion={habilitada ? "Deshabilitar" : "Habilitar"} accionPeligro={habilitada} onAccion={onConfigDocumentos}>
            {habilitada ? (modulo.motivoDocumentos || "Los documentos se pueden subir.") : "Se habilita cuando el respaldo diario de archivos esté activo. El cambio pide un motivo y queda en el historial."}
          </AvisoAccion>
        </div>
      ) : !habilitada && <AvisoLinea tono="warn" icono="🔒" dato="documentos-deshabilitados">La carga de documentos está deshabilitada hasta que el respaldo diario de archivos esté activo.</AvisoLinea>}
      {!vigentes.length && <Vacio dato="documentos">Sin documentos vigentes.</Vacio>}
      {vigentes.map((g) => <div key={g.id} style={{ ...cardStyle, borderRadius: R.md, padding: "12px 14px", marginBottom: S.sm }}><Fila d={g.actual} grupo={g} /></div>)}
      {anteriores.length > 0 && (
        <Desplegable titulo={`Ver versiones anteriores y anulados (${anteriores.length})`} plano>
          {anteriores.map((d) => <div key={d.id} style={{ padding: "10px 0", borderBottom: `1px solid ${C.border}` }}><Fila d={d} /></div>)}
        </Desplegable>
      )}
      {subir && <FormSubir token={token} proyecto={p} entregables={ents} base={subir.base} onCerrar={() => setSubir(null)}
        onGuardado={async (msg) => { setSubir(null); showToast(msg); await cargar(); await onCambio(); }} />}
      {anular && <PedirMotivo titulo={`Anular «${anular.titulo}»`} peligro etiquetaBoton="Anular documento" texto="El documento queda anulado con su motivo; el archivo se conserva y sigue disponible para descarga. Solo un administrador puede restaurarlo."
        onCancelar={() => setAnular(null)} onConfirmar={async (m) => { const d = anular; setAnular(null);
          try { await actualizarDocumento(token, d, { estado: "anulado", motivo_anulacion: m }); showToast("Documento anulado"); } catch (e) { showToast(mensajeError(e), "error"); }
          await cargar(); await onCambio(); }} />}
    </Seccion>
  );
}

function FormSubir({ token, proyecto: p, entregables, base, onCerrar, onGuardado }) {
  const [archivo, setArchivo] = useState(null);
  const [titulo, setTitulo] = useState(base?.titulo || ""); const [categoria, setCategoria] = useState(base?.categoria || "tecnico");
  const [entregable, setEntregable] = useState(base?.entregable_id || ""); const [err, setErr] = useState(""); const [ocupado, setOcupado] = useState(false);
  async function guardar() {
    if (!archivo) { setErr("Elige el archivo."); return; }
    if (archivo.size <= 0) { setErr("El archivo está vacío."); return; }
    if (archivo.size > MAX_ARCHIVO) { setErr("El archivo supera el máximo de 50 MB."); return; }
    if (titulo.trim().length < 2) { setErr("Indica el título del documento."); return; }
    setOcupado(true); setErr("");
    try {
      await subirDocumento(token, { proyectoId: p.id, archivo, ruta: rutaArchivo(p.id, archivo.name), titulo: titulo.trim(), categoria, entregableId: entregable || null, documentoBaseId: base?.id || null });
      await onGuardado(base ? "Nueva versión subida." : "Documento subido.");
    } catch (e) { setErr(mensajeError(e)); }
    finally { setOcupado(false); }
  }
  return (
    <Ventana titulo={base ? `Nueva versión de «${base.titulo}»` : "Subir documento"} onCerrar={onCerrar} dato="subir-documento" ancho={520}
      pie={<><button type="button" onClick={onCerrar} style={estiloBoton()}>Cancelar</button><button type="button" data-confirmar-subida disabled={ocupado} onClick={guardar} style={estiloBoton("pri")}>{ocupado ? "Subiendo…" : "Subir"}</button></>}>
      <ErrorForm>{err}</ErrorForm>
      {base && <div style={{ fontSize: T.small, color: C.inkMuted, marginBottom: 10 }}>La versión {base.numero_version} queda guardada como reemplazada.</div>}
      <Campo etiqueta="Archivo" ayuda="Máximo 50 MB. Se registra su huella SHA-256 para comprobarlo al descargar.">
        <input data-campo="archivo" type="file" onChange={(e) => { const a = e.target.files?.[0] || null; setArchivo(a); setErr(""); if (a && !titulo) setTitulo(a.name.replace(/\.[^.]+$/, "").slice(0, 200)); }}
          style={{ width: "100%", fontSize: T.sm }} />
      </Campo>
      <Campo etiqueta="Título"><Entrada data-campo="titulo" value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={200} /></Campo>
      <Rejilla>
        <Campo etiqueta="Categoría"><Selector data-campo="categoria" value={categoria} onChange={(e) => setCategoria(e.target.value)} opciones={CATEGORIAS_DOC} /></Campo>
        <Campo etiqueta="Entregable"><Selector data-campo="entregable" value={entregable} onChange={(e) => setEntregable(e.target.value)} vacio="—" opciones={entregables.filter((x) => x.estado !== "anulado").map((x) => ({ v: x.id, l: x.codigo ? `${x.codigo} · ${x.nombre}` : x.nombre }))} /></Campo>
      </Rejilla>
    </Ventana>
  );
}
