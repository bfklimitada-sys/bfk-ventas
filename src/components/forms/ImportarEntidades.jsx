// Importador de entidades: seleccionar → leer → validar → comparar → vista previa → confirmar → UNA RPC.
// Nada se escribe antes de «Confirmar importación».
import { useState } from "react";
import { C, btnP } from "../../lib/theme";
import { sel, rpcImportarEntidades } from "../../lib/supabase";
import { leerArchivoEntidades, validarFilas, compararConCatalogo, resumir, armarPayload,
  FORMATOS_ACEPTADOS, TEXTO_FORMATOS, LIMITE_OPERACIONES } from "../../lib/importacionEntidades";

const caja = { background:C.card, border:`1px solid ${C.border}`, borderRadius:8, padding:"8px 10px", marginBottom:8, fontSize:12 };
const lista = { maxHeight:220, overflowY:"auto", margin:0, paddingLeft:18 };

export function ImportarEntidades({ session, onTerminado, onCancelar }) {
  const [estado, setEstado] = useState("inicio");          // inicio | leyendo | vista | enviando | listo
  const [archivo, setArchivo] = useState(null);
  const [info, setInfo] = useState(null);                  // { formato, detalle, filasVacias }
  const [errores, setErrores] = useState([]);              // [{fila, rut, causa}]
  const [comparadas, setComparadas] = useState([]);
  const [omitidas, setOmitidas] = useState(new Set());
  const [mensaje, setMensaje] = useState(null);            // { tipo:'ok'|'error', texto }

  const reiniciar = () => { setEstado("inicio"); setArchivo(null); setInfo(null); setErrores([]); setComparadas([]); setOmitidas(new Set()); setMensaje(null); };

  const alElegir = async (f) => {
    reiniciar(); if (!f) return;
    setArchivo(f); setEstado("leyendo");
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const leido = leerArchivoEntidades(f.name, bytes);
      const v = validarFilas(leido.filas);
      setInfo({ formato: leido.formato, detalle: leido.detalle, filasVacias: v.filasVacias, ignoradas: v.encabezados?.ignoradas || [] });
      if (v.errores.length) { setErrores(v.errores); setComparadas([]); setEstado("vista"); return; }
      const catalogo = await sel("entidades_catalogo", session.access_token);   // catálogo fresco, no el estado en memoria
      setComparadas(compararConCatalogo(v.validas, catalogo)); setEstado("vista");
    } catch (e) {
      setErrores([{ fila: "—", rut: "", causa: e.message || String(e) }]); setEstado("vista");
    }
  };

  const r = resumir(comparadas, omitidas);
  const operaciones = armarPayload(comparadas);
  const bloqueos = [];
  if (errores.length) bloqueos.push("Corrija los errores del archivo y vuelva a cargarlo. No se importará ninguna fila mientras haya errores.");
  if (r.ambiguas) bloqueos.push("Hay RUT que coinciden con más de una entidad existente. Omita esas filas para continuar.");
  if (operaciones.length > LIMITE_OPERACIONES) bloqueos.push(`El archivo genera ${operaciones.length} cambios; el máximo por importación es ${LIMITE_OPERACIONES}. Divídalo en partes.`);
  const sinCambiosQueAplicar = !errores.length && comparadas.length > 0 && operaciones.length === 0;
  const puedeConfirmar = estado === "vista" && !bloqueos.length && operaciones.length > 0;

  const confirmar = async () => {
    if (!puedeConfirmar) return;
    setEstado("enviando"); setMensaje(null);
    try {
      const res = await rpcImportarEntidades(session.access_token, operaciones, false);
      setMensaje({ tipo: "ok", texto: `✓ Importación aplicada: ${res.creadas} nuevas · ${res.actualizadas} actualizadas · ${res.sin_cambios} sin cambios.` });
      setEstado("listo");
      onTerminado && onTerminado(res);
    } catch (e) {
      const red = !e.rpcStatus;
      setMensaje({ tipo: "error", texto: red
        ? "No se pudo confirmar la respuesta del servidor (conexión). La importación es atómica: se aplicó completa o no se aplicó nada. Vuelva a cargar el mismo archivo: si ya se aplicó, la vista previa mostrará todo «sin cambios»."
        : `Importación cancelada, no se aplicó ningún cambio. ${e.message || ""}` });
      setEstado("vista");
    }
  };

  const toggleOmitir = (fila) => setOmitidas(prev => { const n = new Set(prev); n.has(fila) ? n.delete(fila) : n.add(fila); return n; });
  const nuevas = comparadas.filter(c => c.estado === "nueva"), actualizaciones = comparadas.filter(c => c.estado === "actualizacion"), ambiguas = comparadas.filter(c => c.estado === "ambigua");

  return (
    <div style={{ background:C.tealLight, borderRadius:10, padding:"12px 14px" }} data-importador-entidades>
      <div style={{ fontSize:12.5, fontWeight:700, color:C.tealDark, marginBottom:8 }}>Importar entidades</div>
      <div style={{ fontSize:12, color:C.inkMuted, marginBottom:10 }}>
        Formatos: {TEXTO_FORMATOS}. Primera fila = encabezados: <b>rut</b> y <b>nombre</b> (o <b>entidad</b> / razón social) obligatorios; <b>comuna</b>, <b>contacto</b> y <b>correo</b> opcionales.
        Las celdas vacías no borran datos existentes. Máximo {LIMITE_OPERACIONES} cambios por importación.
      </div>
      <input type="file" accept={FORMATOS_ACEPTADOS} disabled={estado === "enviando"} onChange={e => alElegir(e.target.files[0])} style={{ marginBottom:10, fontSize:12 }} />
      {estado === "leyendo" && <div style={caja}>Leyendo y validando «{archivo?.name}»…</div>}

      {(estado === "vista" || estado === "enviando" || estado === "listo") && (
        <>
          {info && <div style={{ fontSize:11.5, color:C.inkMuted, marginBottom:6 }}>Archivo {info.formato.toUpperCase()} · {info.detalle}{info.filasVacias ? ` · ${info.filasVacias} filas vacías ignoradas` : ""}{info.ignoradas?.length ? ` · columnas ignoradas: ${info.ignoradas.join(", ")}` : ""}</div>}
          <div style={{ ...caja, fontWeight:700, color:C.ink }} data-resumen>
            {r.nuevas} nuevas | {r.actualizaciones} actualizaciones | {r.sinCambios} sin cambios | {r.ambiguas} ambiguas | {errores.length} errores{r.omitidas ? ` · ${r.omitidas} omitidas` : ""}
          </div>

          {errores.length > 0 && (
            <div style={{ ...caja, borderColor:C.danger }} data-errores>
              <div style={{ fontWeight:700, color:C.dangerText, marginBottom:4 }}>Errores ({errores.length}) — no se importará nada</div>
              <ul style={lista}>{errores.slice(0, 200).map((e, i) => <li key={i}>Fila {e.fila}{e.rut ? ` (RUT ${e.rut})` : ""}: {e.causa}</li>)}</ul>
              {errores.length > 200 && <div>… y {errores.length - 200} más</div>}
            </div>
          )}

          {ambiguas.length > 0 && (
            <div style={{ ...caja, borderColor:C.warn }} data-ambiguas>
              <div style={{ fontWeight:700, color:C.warnText, marginBottom:4 }}>RUT con más de una entidad existente (duplicados históricos)</div>
              {ambiguas.map(a => (
                <label key={a.fila} style={{ display:"flex", gap:6, alignItems:"center", padding:"3px 0" }}>
                  <input type="checkbox" checked={omitidas.has(a.fila)} onChange={() => toggleOmitir(a.fila)} />
                  Fila {a.fila}: {a.rutOriginal} — {a.nombre_entidad} ({a.coincidencias} entidades) · <b>Omitir esta fila</b>
                </label>
              ))}
            </div>
          )}

          {!errores.length && (nuevas.length > 0 || actualizaciones.length > 0) && (
            <div style={caja} data-cambios>
              {nuevas.length > 0 && <><div style={{ fontWeight:700 }}>Nuevas</div>
                <ul style={lista}>{nuevas.slice(0, 100).map(n => <li key={n.fila}>Fila {n.fila}: {n.rutAlmacenado} — {n.nombre_entidad}</li>)}</ul>
                {nuevas.length > 100 && <div>… y {nuevas.length - 100} más</div>}</>}
              {actualizaciones.length > 0 && <><div style={{ fontWeight:700, marginTop:6 }}>Actualizaciones (solo los campos indicados)</div>
                <ul style={lista}>{actualizaciones.slice(0, 100).map(a => <li key={a.fila}>Fila {a.fila}: {a.existente.rut} — {Object.entries(a.cambios).map(([k, v]) => `${k}: «${v}»`).join(", ")}</li>)}</ul>
                {actualizaciones.length > 100 && <div>… y {actualizaciones.length - 100} más</div>}</>}
            </div>
          )}

          {bloqueos.map((b, i) => <div key={i} style={{ fontSize:12, color:C.dangerText, fontWeight:600, marginBottom:6 }}>{b}</div>)}
          {sinCambiosQueAplicar && <div style={{ fontSize:12, color:C.okText, fontWeight:600, marginBottom:6 }} data-sin-cambios>El catálogo ya está al día con este archivo: no hay cambios que aplicar.</div>}
        </>
      )}

      {mensaje && <div style={{ fontSize:12, color: mensaje.tipo === "ok" ? C.okText : C.dangerText, marginBottom:8, fontWeight:600 }} data-mensaje>{mensaje.texto}</div>}
      <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
        {estado !== "listo" && <button onClick={confirmar} disabled={!puedeConfirmar} style={{ ...btnP(C.teal), opacity: puedeConfirmar ? 1 : 0.45, cursor: puedeConfirmar ? "pointer" : "not-allowed" }}>
          {estado === "enviando" ? "Importando…" : `✓ Confirmar importación${operaciones.length ? ` (${operaciones.length})` : ""}`}</button>}
        <button onClick={() => { reiniciar(); onCancelar && onCancelar(); }} disabled={estado === "enviando"} style={btnP(C.inkFaint)}>{estado === "listo" ? "Cerrar" : "Cancelar"}</button>
      </div>
    </div>
  );
}
