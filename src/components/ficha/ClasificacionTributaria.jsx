// Clasificación tributaria (fase 2 de ventas exentas, 20/10/2026) para una OC o una cotización.
// Muestra el tratamiento vigente, la solicitud pendiente y el historial; permite SOLICITAR (cualquier usuario) y
// APROBAR / RECHAZAR (solo administrador). Las reglas las aplica la base; aquí solo se avisa antes de enviar.
// No habilita facturas DTE 34 ni cambia fórmulas de cotización (fases siguientes).
import { useState } from "react";
import { Field } from "../ui/Basicos";
import { C, btnG, btnP, fmt, iStyle, selStyle } from "../../lib/theme";
import { Ic } from "../ui/Iconos";
import { TRATAMIENTOS, ESTADOS_SOLICITUD, tratamientoDe, esClasificacionHistorica, esExentaClasificada, etiquetaTratamiento, historialDe, validarSolicitud } from "../../lib/clasificacionTributaria";

const fecha = (x) => (x ? fmt.date(String(x).slice(0, 10)) : "—");

export function ClasificacionTributaria({ ambito, objetivo, historial, perfil, oc = null, cotizacionVinculada = null, acciones, aviso }) {
  const [form, setForm] = useState(null);
  const [archivo, setArchivo] = useState(null);
  const [obs, setObs] = useState("");
  const [err, setErr] = useState(""); const [ocupado, setOcupado] = useState(false);
  const esAdmin = perfil?.rol === "admin";
  const id = objetivo?.id;
  if (historial === null) {
    return <div data-trib-no-instalada style={{ fontSize: 12, color: C.inkMuted, lineHeight: 1.5 }}>
      Tratamiento: <b>{etiquetaTratamiento(objetivo)}</b>. La clasificación tributaria respaldada se habilitará cuando se instale la migración autorizada.
    </div>;
  }
  const hist = historialDe(historial, ambito, id);
  const pend = hist.find((h) => h.estado === "pendiente");
  // Lo vigente es la clasificación APROBADA del historial (la base la copia a la fila en la misma transacción);
  // así una cotización abierta en el editor muestra lo aprobado aunque su copia local sea anterior.
  const ap = hist.find((h) => h.estado === "aprobada");
  const vig = ap ? { ...objetivo, tratamiento_iva: ap.tratamiento, fundamento_iva: ap.fundamento_legal, respaldo_iva: [ap.respaldo_descripcion, ap.respaldo_documento].filter(Boolean).join(" · "),
    tratamiento_aprobado_en: ap.resuelto_en, clasificacion_id: ap.id } : objetivo;
  const actual = vig?.tratamiento_iva || null;
  const correr = async (fn) => { setErr(""); setOcupado(true); try { await fn(); } catch (e) { setErr(e.message); } finally { setOcupado(false); } };
  const enviar = () => correr(async () => {
    const msg = validarSolicitud({ ...form, respaldo_documento: archivo ? archivo.name : form.respaldo_documento }, { actual, ambito, oc });
    if (msg) throw new Error(msg);
    let doc = form.respaldo_documento, sha = null;
    if (archivo) { const s = await acciones.subirRespaldo(ambito, id, archivo); doc = s.ruta; sha = s.sha256; }
    await acciones.solicitar({ ambito, [ambito === "oc" ? "oc_id" : "cotizacion_id"]: id, tratamiento: form.tratamiento,
      fundamento_legal: form.fundamento_legal, respaldo_descripcion: form.respaldo_descripcion, respaldo_documento: doc, respaldo_sha256: sha,
      motivo: form.motivo, procedimiento_documental: form.procedimiento_documental });
    setForm(null); setArchivo(null);
  });
  const t = form ? TRATAMIENTOS[form.tratamiento] : null;
  const tieneDocs = ambito === "oc" && (oc?.eventos_factura || []).length > 0;
  return (
    <div data-clasificacion-tributaria={ambito}>
      <div data-trib-vigente style={{ background: esExentaClasificada(vig) ? C.infoLight : C.paper, border: `1px solid ${esExentaClasificada(vig) ? C.info + "55" : C.border}`, borderRadius: 10, padding: "10px 12px", marginBottom: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: C.inkMuted, textTransform: "uppercase", letterSpacing: 0.4 }}>Tratamiento vigente</div>
        <div style={{ fontSize: 14, fontWeight: 800, color: C.ink, marginTop: 2 }}>{etiquetaTratamiento(vig)}</div>
        {!esClasificacionHistorica(vig) && (
          <div style={{ fontSize: 12, color: C.inkMuted, lineHeight: 1.5, marginTop: 4 }}>
            {vig.fundamento_iva && <>Fundamento: {vig.fundamento_iva}<br /></>}
            {vig.respaldo_iva && <>Respaldo: {vig.respaldo_iva}<br /></>}
            Aprobado el {fecha(vig.tratamiento_aprobado_en)}{hist.find((h) => h.id === vig.clasificacion_id)?.resuelto_por_nombre ? ` por ${hist.find((h) => h.id === vig.clasificacion_id).resuelto_por_nombre}` : ""}
          </div>
        )}
        {esExentaClasificada(vig) && <div data-trib-aviso-fase style={{ fontSize: 12, color: C.warnText, marginTop: 6, fontWeight: 600 }}>
          <Ic n="⚠" /> {ambito === "oc" ? "La factura exenta (DTE 34) se registrará cuando se habilite su emisión (fase 3); hasta entonces no se registran facturas afectas en esta OC." : "La fórmula de la cotización sigue con IVA 19% hasta la fase 3 (precio exento sobre costo bruto)."}
        </div>}
        {aviso && <div style={{ fontSize: 12, color: C.inkMuted, marginTop: 6 }}>{aviso}</div>}
      </div>

      {pend && (
        <div data-trib-pendiente style={{ background: C.warnLight, border: `1px solid ${C.warn}66`, borderRadius: 10, padding: "10px 12px", marginBottom: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: C.warnText }}>Solicitud pendiente: {TRATAMIENTOS[pend.tratamiento]?.etiqueta}</div>
          <div style={{ fontSize: 12, color: C.ink, lineHeight: 1.5, marginTop: 4 }}>
            {pend.fundamento_legal && <>Fundamento: {pend.fundamento_legal}<br /></>}
            {pend.respaldo_descripcion && <>Respaldo: {pend.respaldo_descripcion}{pend.respaldo_documento ? ` · ${pend.respaldo_documento}` : ""}<br /></>}
            {pend.procedimiento_documental && <>Procedimiento documental: {pend.procedimiento_documental}<br /></>}
            {pend.origen === "cotizacion" && <>Heredada de la cotización adjudicada.<br /></>}
            Pedida por {pend.solicitado_por_nombre || "—"} el {fecha(pend.solicitado_en)}
          </div>
          {pend.respaldo_documento?.startsWith("trib-respaldos/") && acciones.abrirRespaldo && (
            <button data-consulta="1" onClick={() => correr(async () => window.open(await acciones.abrirRespaldo(pend.respaldo_documento), "_blank"))} style={{ ...btnG, fontSize: 12, minHeight: 34, padding: "4px 10px", marginTop: 6 }}><Ic n="📄" /> Ver respaldo</button>
          )}
          {esAdmin && (
            <div style={{ marginTop: 8 }}>
              <Field label="Observación (obligatoria para rechazar)"><input data-trib-observacion style={iStyle} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="ej: certificado FO.R.A. revisado" /></Field>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button data-trib-aprobar disabled={ocupado} onClick={() => correr(async () => { await acciones.resolver(pend.id, "aprobar", obs); setObs(""); })} style={{ ...btnP(C.ok), width: "auto", flex: "1 1 140px" }}>✓ Aprobar</button>
                <button data-trib-rechazar disabled={ocupado} onClick={() => correr(async () => { if (obs.trim().length < 5) throw new Error("Indica el motivo del rechazo."); await acciones.resolver(pend.id, "rechazar", obs); setObs(""); })} style={{ ...btnP(C.danger), width: "auto", flex: "1 1 140px" }}>Rechazar</button>
              </div>
            </div>
          )}
          {(esAdmin || pend.solicitado_por === perfil?.id) && <button data-trib-anular disabled={ocupado} onClick={() => correr(() => acciones.anular(pend.id))} style={{ ...btnG, fontSize: 12, minHeight: 34, padding: "4px 10px", marginTop: 6 }}>Anular solicitud</button>}
        </div>
      )}

      {!pend && !form && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
          <button data-trib-solicitar onClick={() => setForm({ tratamiento: actual && actual !== "afecta" ? "afecta" : "exenta_fora", fundamento_legal: "", respaldo_descripcion: "", respaldo_documento: "", motivo: "", procedimiento_documental: "" })}
            style={{ ...btnG, fontSize: 13, flex: "1 1 200px" }}><Ic n="🧾" /> Solicitar clasificación tributaria</button>
          {ambito === "oc" && cotizacionVinculada?.tratamiento_iva && cotizacionVinculada.tratamiento_iva !== (actual || "afecta") && (
            <button data-trib-heredar disabled={ocupado} onClick={() => correr(() => acciones.heredar(id, tieneDocs ? window.prompt("La OC tiene documentos SII. Describe el procedimiento documental (NC y facturas):") : null))}
              style={{ ...btnG, fontSize: 13, flex: "1 1 200px" }}>Usar la de la cotización {cotizacionVinculada.id_externo || ""} ({TRATAMIENTOS[cotizacionVinculada.tratamiento_iva]?.corta})</button>
          )}
        </div>
      )}

      {form && (
        <div data-trib-formulario style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 12px", marginBottom: 10 }}>
          <Field label="Tratamiento solicitado" required>
            <select data-trib-tratamiento style={selStyle} value={form.tratamiento} onChange={(e) => setForm({ ...form, tratamiento: e.target.value, fundamento_legal: form.fundamento_legal || TRATAMIENTOS[e.target.value]?.fundamentoSugerido || "" })}>
              {Object.entries(TRATAMIENTOS).filter(([k]) => k !== (actual || "afecta")).map(([k, v]) => <option key={k} value={k}>{v.etiqueta}</option>)}
            </select>
          </Field>
          {t?.exenta && <>
            <Field label="Fundamento legal" required hint="Norma que establece la exención"><input data-trib-fundamento style={iStyle} value={form.fundamento_legal} onChange={(e) => setForm({ ...form, fundamento_legal: e.target.value })} placeholder={t.fundamentoSugerido || "ej: Art. … de la Ley …"} /></Field>
            <Field label="Qué acredita el respaldo" required hint={t.respaldoAyuda}><input data-trib-respaldo style={iStyle} value={form.respaldo_descripcion} onChange={(e) => setForm({ ...form, respaldo_descripcion: e.target.value })} placeholder="ej: certificado de la DGS: pago con Fondo Rotativo" /></Field>
            <Field label="Documento de respaldo" required hint="PDF, PNG o JPG (máx. 10 MB). Si no tienes el archivo, indica su referencia (folio, oficio o enlace).">
              <input data-trib-archivo type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => setArchivo(e.target.files?.[0] || null)} style={{ fontSize: 13, marginBottom: 6 }} />
              {!archivo && <input data-trib-documento style={iStyle} value={form.respaldo_documento} onChange={(e) => setForm({ ...form, respaldo_documento: e.target.value })} placeholder="o referencia: ej. Oficio N.º 123 de la DGS" />}
            </Field>
          </>}
          {tieneDocs && <Field label="Procedimiento documental" required hint="La OC ya tiene documentos SII: indica las notas de crédito y facturas que respaldan el cambio">
            <input data-trib-procedimiento style={iStyle} value={form.procedimiento_documental} onChange={(e) => setForm({ ...form, procedimiento_documental: e.target.value })} placeholder="ej: NC 72 (código 1) anula la factura 3301" /></Field>}
          <Field label="Motivo (opcional)"><input style={iStyle} value={form.motivo} onChange={(e) => setForm({ ...form, motivo: e.target.value })} /></Field>
          <div style={{ fontSize: 12, color: C.inkMuted, marginBottom: 8 }}>La solicitud queda pendiente hasta que un administrador la apruebe. Un impuesto $0 en Mercado Público no basta para clasificar una venta como exenta.</div>
          <div style={{ display: "flex", gap: 6 }}>
            <button data-trib-enviar disabled={ocupado} onClick={enviar} style={{ ...btnP(C.info), width: "auto", flex: 1 }}>{ocupado ? "Enviando…" : "Enviar solicitud"}</button>
            <button disabled={ocupado} onClick={() => { setForm(null); setArchivo(null); setErr(""); }} style={{ ...btnG, flex: "0 0 auto" }}>Cancelar</button>
          </div>
        </div>
      )}
      {err && <div data-trib-error style={{ background: C.dangerLight, color: C.dangerText, borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 10, fontWeight: 600 }}>{err}</div>}

      {hist.filter((h) => h.estado !== "pendiente").length > 0 && (
        <div data-trib-historial>
          <div style={{ fontSize: 12, fontWeight: 800, color: C.inkMuted, textTransform: "uppercase", letterSpacing: 0.4, margin: "4px 0 6px" }}>Historial</div>
          {hist.filter((h) => h.estado !== "pendiente").map((h) => (
            <div key={h.id} style={{ fontSize: 12, color: C.ink, padding: "5px 0", borderBottom: `1px solid ${C.border}`, lineHeight: 1.45 }}>
              <b>{TRATAMIENTOS[h.tratamiento]?.corta}</b> · {ESTADOS_SOLICITUD[h.estado]} · pedida por {h.solicitado_por_nombre || "—"} ({fecha(h.solicitado_en)})
              {h.resuelto_en && <> · resuelta por {h.resuelto_por_nombre || "—"} ({fecha(h.resuelto_en)})</>}
              {h.observacion_resolucion && <span style={{ color: C.inkMuted }}> · {h.observacion_resolucion}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export const resumenClasificacion = (obj, historial, ambito) => {
  if (historial === null) return tratamientoDe(obj) === "afecta" ? "afecta" : TRATAMIENTOS[tratamientoDe(obj)]?.corta;
  const p = historialDe(historial, ambito, obj?.id).find((h) => h.estado === "pendiente");
  return `${esClasificacionHistorica(obj) ? "afecta (histórica)" : TRATAMIENTOS[tratamientoDe(obj)]?.corta}${p ? " · solicitud pendiente" : ""}`;
};
