import { useEffect, useMemo, useRef, useState } from "react";
import { C, T, R } from "../../lib/theme";
import { HojaLateral, AvisoLinea, BotonPrincipal, BotonSecundario } from "../ui/Sistema";
import { importarModulo } from "../../lib/cargaModulos";

// Vista previa de un documento de la oferta (25/11/2026). Muestra el MISMO PDF que se descarga o se emite (el blob que
// entrega el generador, dibujado con pdf.js): todas las páginas, navegación entre páginas y zoom, en PC y celular.
// No guarda ni emite nada por sí misma: «Emitir versión definitiva» llama a onEmitir, que vuelve a comprobar que la
// información no cambió desde esta vista previa.
const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2];
export function VisorDocumento({ previa, avisos = [], onCerrar, onDescargar, onEmitir, emitiendo = false, emitido = null }) {
  const { blob, nombre, paginas, titulo, version } = previa;
  const url = useMemo(() => URL.createObjectURL(blob), [blob]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const [estado, setEstado] = useState("cargando"); const [error, setError] = useState("");
  const [zoom, setZoom] = useState(1); const [actual, setActual] = useState(1);
  const cont = useRef(null); const pdfRef = useRef(null);
  const bloqueos = avisos.filter((a) => a.nivel === "bloqueo");

  useEffect(() => {
    let vivo = true; let tarea = null;
    (async () => {
      try {
        const [lib, w] = await importarModulo(() => Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.js?url")]));
        lib.GlobalWorkerOptions.workerSrc = w.default;
        tarea = lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false });
        const pdf = await tarea.promise; if (!vivo) return;
        pdfRef.current = pdf; setEstado("dibujar");
      } catch (e) { if (vivo) { setEstado("error"); setError(e?.message || String(e)); } }
    })();
    return () => { vivo = false; try { tarea?.destroy(); } catch { /* nada */ } };
  }, [blob]);

  // Dibuja (o vuelve a dibujar con otro zoom) todas las páginas.
  useEffect(() => {
    const pdf = pdfRef.current; const caja = cont.current;
    if (!pdf || !caja || (estado !== "dibujar" && estado !== "listo")) return undefined;
    let vivo = true;
    (async () => {
      caja.innerHTML = "";
      const ancho = Math.min(caja.clientWidth || 360, 820) * zoom;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      for (let n = 1; n <= pdf.numPages; n++) {
        const pag = await pdf.getPage(n); if (!vivo) return;
        const base = pag.getViewport({ scale: 1 }); const vp = pag.getViewport({ scale: (ancho / base.width) * dpr });
        const marco = document.createElement("div"); marco.setAttribute("data-pagina-doc", String(n));
        Object.assign(marco.style, { width: `${ancho}px`, margin: "0 auto 6px" });
        const lienzo = document.createElement("canvas"); lienzo.width = vp.width; lienzo.height = vp.height;
        Object.assign(lienzo.style, { width: `${ancho}px`, height: `${(vp.height / vp.width) * ancho}px`, display: "block", background: "#fff", boxShadow: "0 1px 4px rgba(0,0,0,0.25)" });
        lienzo.setAttribute("aria-label", `Página ${n} de ${pdf.numPages}`);
        const rotulo = document.createElement("div"); rotulo.textContent = `Página ${n} de ${pdf.numPages}`;
        Object.assign(rotulo.style, { fontSize: "12px", color: C.inkFaint, textAlign: "center", margin: "6px 0 14px" });
        marco.appendChild(lienzo); marco.appendChild(rotulo); caja.appendChild(marco);
        await pag.render({ canvasContext: lienzo.getContext("2d"), viewport: vp }).promise;
      }
      if (vivo) setEstado("listo");
    })().catch((e) => { if (vivo) { setEstado("error"); setError(e?.message || String(e)); } });
    return () => { vivo = false; };
  }, [estado === "dibujar", zoom]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Página visible (para el indicador «Página n de N»).
  const cuerpo = useRef(null);
  useEffect(() => {
    const el = cont.current?.closest("[data-hoja-cuerpo]"); if (!el) return undefined; cuerpo.current = el;
    const f = () => {
      const marcos = [...(cont.current?.querySelectorAll("[data-pagina-doc]") || [])]; const top = el.getBoundingClientRect().top + 80;
      let n = 1; for (const m of marcos) if (m.getBoundingClientRect().top <= top) n = Number(m.getAttribute("data-pagina-doc"));
      setActual(n);
    };
    el.addEventListener("scroll", f, { passive: true }); return () => el.removeEventListener("scroll", f);
  }, [estado]);
  const ir = (n) => { const m = cont.current?.querySelector(`[data-pagina-doc="${Math.min(Math.max(1, n), paginas)}"]`); if (m && cuerpo.current) cuerpo.current.scrollTo({ top: m.offsetTop - 8, behavior: "smooth" }); };
  const iz = ZOOMS.indexOf(zoom);

  const btn = { minHeight: 36, minWidth: 36, padding: "4px 10px", border: `1px solid ${C.border}`, borderRadius: R.sm, background: C.card, color: C.ink, fontSize: T.sm, cursor: "pointer" };
  return (
    <HojaLateral abierta onCerrar={onCerrar} dato="visor-documento" titulo={`Vista previa · ${titulo}`} subtitulo={`${nombre} · versión ${String(version).padStart(2, "0")} · ${paginas} página${paginas === 1 ? "" : "s"}`} ancho={920}>
      <div style={{ position: "sticky", top: 0, zIndex: 2, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", padding: "8px 12px", background: C.card, borderBottom: `1px solid ${C.border}` }}>
        <button type="button" style={btn} onClick={onCerrar} data-volver-editar>← Volver a editar</button>
        <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }} data-navegacion-paginas>
          <button type="button" style={btn} onClick={() => ir(actual - 1)} disabled={actual <= 1} aria-label="Página anterior">‹</button>
          <span style={{ fontSize: T.sm, color: C.inkMuted, minWidth: 64, textAlign: "center" }} data-pagina-actual>{actual} / {paginas}</span>
          <button type="button" style={btn} onClick={() => ir(actual + 1)} disabled={actual >= paginas} aria-label="Página siguiente">›</button>
        </span>
        <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }} data-zoom>
          <button type="button" style={btn} onClick={() => setZoom(ZOOMS[Math.max(0, iz - 1)])} disabled={iz <= 0} aria-label="Reducir">−</button>
          <span style={{ fontSize: T.sm, color: C.inkMuted, minWidth: 44, textAlign: "center" }} data-zoom-valor>{Math.round(zoom * 100)}%</span>
          <button type="button" style={btn} onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, iz + 1)])} disabled={iz >= ZOOMS.length - 1} aria-label="Ampliar">+</button>
        </span>
        <span style={{ flex: 1 }} />
        <BotonSecundario data-descargar-previa onClick={onDescargar} style={{ minHeight: 40 }}>Descargar PDF</BotonSecundario>
        {onEmitir && <BotonPrincipal data-emitir-documento onClick={onEmitir} disabled={emitiendo || !!emitido || bloqueos.length > 0} style={{ minHeight: 40, opacity: emitiendo || emitido || bloqueos.length ? 0.55 : 1 }}>
          {emitido ? "Emitida" : emitiendo ? "Emitiendo…" : "Emitir versión definitiva"}</BotonPrincipal>}
      </div>
      <div style={{ padding: 12, background: "#E5E7EB", minHeight: "100%", overflowX: "auto" }}>
        <AvisoLinea tono="info" icono="👁" dato="aviso-visor">Es exactamente el PDF que se descargará y se emitirá. La vista previa no guarda nada ni cambia estados.</AvisoLinea>
        {emitido && <AvisoLinea tono="ok" icono="✓" dato="visor-emitido">{emitido}</AvisoLinea>}
        {avisos.length > 0 && (
          <div data-avisos-documento style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: R.sm, padding: "8px 12px", marginBottom: 10 }}>
            <div style={{ fontSize: T.sm, fontWeight: 700, color: C.ink, marginBottom: 4 }}>Revisa antes de emitir</div>
            {avisos.map((a, i) => <div key={i} data-aviso-nivel={a.nivel} style={{ fontSize: T.small, color: a.nivel === "bloqueo" ? C.dangerText : C.warnText, marginTop: 2 }}>• {a.mensaje}</div>)}
            {bloqueos.length > 0 && <div style={{ fontSize: T.small, color: C.dangerText, marginTop: 4, fontWeight: 600 }}>Corrige lo marcado en rojo para poder emitir.</div>}
          </div>
        )}
        {estado === "cargando" && <div data-preview-cargando style={{ fontSize: T.sm, color: C.inkMuted, textAlign: "center", padding: 24 }}>Preparando la vista previa…</div>}
        {estado === "error" && (
          <div data-preview-alternativa>
            <AvisoLinea tono="warn">Este navegador no pudo dibujar las páginas ({error}). Puedes verlo con el visor del navegador:</AvisoLinea>
            <iframe title="Vista previa" src={url} style={{ width: "100%", height: "75vh", border: `1px solid ${C.border}`, borderRadius: R.sm, background: "#fff" }} />
          </div>
        )}
        <div ref={cont} data-preview-paginas />
      </div>
    </HojaLateral>
  );
}
