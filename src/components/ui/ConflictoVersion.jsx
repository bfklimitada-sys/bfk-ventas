// Ventana «Hay una versión más nueva en BFK» (09/11/2026). Muestra campo por campo qué se conserva de lo escrito en esta pestaña,
// qué se toma de lo guardado después y, en lo que cambió en ambos, deja elegir (por defecto, lo de BFK: nada se sobrescribe solo).
// «Combinar» deja el resultado en el editor SIN guardar, con la versión vigente: se revisa y se guarda normalmente.
import { useState } from "react";
import { C, SANS, T } from "../../lib/theme";

const ESTADOS = {
  solo_mio: { t: "Se conserva lo tuyo", c: C.okText }, solo_bfk: { t: "Se toma lo guardado en BFK", c: C.inkMuted },
  conflicto: { t: "Cambió en ambos: elige", c: C.warnText }, igual: { t: "Igual", c: C.inkFaint },
};

export function ConflictoVersion({ version, campos, nota, onCombinar, onDescartarMios, onCancelar, ocupado, bloqueado }) {
  const [elecciones, setElecciones] = useState({});
  const visibles = campos.filter((c) => c.estado !== "igual");
  const nConf = campos.filter((c) => c.estado === "conflicto").length;
  const boton = (extra = {}) => ({ border: `1px solid ${C.border}`, background: C.card, color: C.ink, borderRadius: 10, padding: "9px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: SANS, ...extra });
  return (
    <div role="dialog" aria-modal="true" data-conflicto-version style={{ position: "fixed", inset: 0, zIndex: 1900, background: "rgba(8,14,28,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 12, fontFamily: SANS }}>
      <div style={{ background: C.card, borderRadius: 14, width: "100%", maxWidth: 640, maxHeight: "92vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 50px rgba(0,0,0,0.35)" }}>
        <div style={{ padding: "16px 18px 10px", borderBottom: `1px solid ${C.border}` }}>
          <div style={{ fontWeight: 700, fontSize: 16, color: C.ink }}>Hay una versión más nueva en BFK{version ? ` (versión ${version})` : ""}</div>
          <div style={{ fontSize: T.small, color: C.inkMuted, marginTop: 4, lineHeight: 1.45 }}>
            Tus cambios no se guardaron para no sobrescribir lo guardado después. Revisa campo por campo: lo combinado queda en la pantalla sin guardar y luego lo guardas.
            {nConf ? ` ${nConf} campo${nConf === 1 ? "" : "s"} cambió en ambos: por defecto se mantiene lo de BFK.` : ""}
          </div>
          {nota && <div data-nota-conflicto style={{ fontSize: T.small, color: C.warnText, marginTop: 6, fontWeight: 600 }}>{nota}</div>}
        </div>
        <div style={{ overflowY: "auto", padding: "8px 18px" }}>
          {!visibles.length && <div data-sin-diferencias style={{ fontSize: T.sm, color: C.inkMuted, padding: "10px 0" }}>Tus cambios coinciden con lo guardado en BFK: no hay nada que elegir.</div>}
          {visibles.map((c) => (
            <div key={c.k} data-campo-conflicto={c.k} data-estado-conflicto={c.estado} style={{ padding: "9px 0", borderBottom: `1px solid ${C.border}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                <b style={{ fontSize: T.sm, color: C.ink }}>{c.etiqueta}</b><span style={{ fontSize: T.small, fontWeight: 600, color: ESTADOS[c.estado].c }}>{ESTADOS[c.estado].t}</span>
              </div>
              {c.estado === "conflicto" ? (
                <div style={{ display: "grid", gap: 4, marginTop: 6 }}>
                  {[["bfk", `Lo guardado en BFK: ${c.resumenBfk}`], ["mio", `Lo tuyo: ${c.resumenMio}`]].map(([v, txt]) => (
                    <label key={v} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: T.small, color: C.ink, cursor: "pointer" }}>
                      <input type="radio" name={`conf-${c.k}`} data-elegir={`${c.k}:${v}`} checked={(elecciones[c.k] || "bfk") === v} onChange={() => setElecciones((e) => ({ ...e, [c.k]: v }))} style={{ marginTop: 2 }} />
                      <span style={{ wordBreak: "break-word" }}>{txt}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: T.small, color: C.inkMuted, marginTop: 4, wordBreak: "break-word" }}>{c.estado === "solo_mio" ? `Lo tuyo: ${c.resumenMio}` : `BFK: ${c.resumenBfk}`}</div>
              )}
            </div>
          ))}
        </div>
        <div style={{ padding: "12px 18px", borderTop: `1px solid ${C.border}`, display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button type="button" data-cancelar-conflicto onClick={onCancelar} disabled={ocupado} style={boton()}>Seguir con lo mío sin combinar</button>
          <button type="button" data-descartar-conflicto onClick={onDescartarMios} disabled={ocupado} style={boton()}>Descartar lo mío y abrir la versión de BFK</button>
          <button type="button" data-combinar-conflicto onClick={() => onCombinar(elecciones)} disabled={ocupado || bloqueado} style={boton({ background: C.night, color: "#fff", border: "none", opacity: bloqueado ? 0.5 : 1 })}>Combinar y revisar</button>
        </div>
      </div>
    </div>
  );
}
