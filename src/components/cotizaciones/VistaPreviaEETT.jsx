import { useEffect, useMemo, useRef, useState } from "react";
import { C, T, R } from "../../lib/theme";
import { HojaLateral, AvisoLinea, BotonSecundario } from "../ui/Sistema";
import { importarModulo } from "../../lib/cargaModulos";

// Vista previa de la EETT dentro de BFK Datos (PC y celular), con TODAS las páginas.
// Muestra exactamente el PDF que entrega el mismo generador de la descarga (blob en memoria).
// No guarda nada: ni en Supabase ni en el dispositivo, y no crea registros ni cambia el estado.
// Las páginas se dibujan con pdf.js (cargado bajo demanda desde el propio dominio). Si el navegador no lo
// permite, se ofrece el visor del navegador (pestaña nueva) como alternativa compatible.
export function VistaPreviaEETT({ blob, nombre, paginas, onCerrar, onDescargar }) {
  const url = useMemo(() => URL.createObjectURL(blob), [blob]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const [estado, setEstado] = useState("cargando"); const [error, setError] = useState("");
  const cont = useRef(null);

  useEffect(() => {
    let vivo = true; let tarea = null;
    (async () => {
      try {
        const [lib, w] = await importarModulo(() => Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.js?url")]));
        lib.GlobalWorkerOptions.workerSrc = w.default;
        tarea = lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false });
        const pdf = await tarea.promise;
        if (!vivo) return;
        const caja = cont.current; if (!caja) return; caja.innerHTML = "";
        const ancho = Math.min(caja.clientWidth || 360, 820);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        for (let n = 1; n <= pdf.numPages; n++) {
          const pag = await pdf.getPage(n); if (!vivo) return;
          const base = pag.getViewport({ scale: 1 }); const vp = pag.getViewport({ scale: (ancho / base.width) * dpr });
          const lienzo = document.createElement("canvas"); lienzo.width = vp.width; lienzo.height = vp.height;
          lienzo.style.width = `${ancho}px`; lienzo.style.height = `${(vp.height / vp.width) * ancho}px`;
          lienzo.style.display = "block"; lienzo.style.margin = "0 auto"; lienzo.style.background = "#fff"; lienzo.style.boxShadow = "0 1px 4px rgba(0,0,0,0.25)";
          lienzo.setAttribute("data-pagina-preview", String(n)); lienzo.setAttribute("aria-label", `Página ${n} de ${pdf.numPages}`);
          const rotulo = document.createElement("div"); rotulo.textContent = `Página ${n} de ${pdf.numPages}`;
          Object.assign(rotulo.style, { fontSize: "12px", color: C.inkFaint, textAlign: "center", margin: "6px 0 14px" });
          caja.appendChild(lienzo); caja.appendChild(rotulo);
          await pag.render({ canvasContext: lienzo.getContext("2d"), viewport: vp }).promise;
        }
        if (vivo) setEstado("listo");
      } catch (e) { if (vivo) { setEstado("error"); setError(e?.message || String(e)); } }
    })();
    return () => { vivo = false; try { tarea?.destroy(); } catch { /* nada */ } };
  }, [blob]);

  return (
    <HojaLateral abierta onCerrar={onCerrar} dato="vista-previa-eett" titulo="Vista previa de EETT" subtitulo={`${nombre} · ${paginas} página${paginas === 1 ? "" : "s"} · no se guarda nada`} ancho={900}
      derecha={onDescargar ? <BotonSecundario onClick={onDescargar} style={{ minHeight: 40 }}>Generar y descargar</BotonSecundario> : null}>
      <div style={{ padding: 12, background: "#E5E7EB", minHeight: "100%" }}>
        <AvisoLinea tono="info" icono="👁" dato="aviso-preview">Vista previa: es el mismo PDF que se descargará. No se guardó la cotización ni se registró ninguna EETT.</AvisoLinea>
        {estado === "cargando" && <div data-preview-cargando style={{ fontSize: T.sm, color: C.inkMuted, textAlign: "center", padding: 24 }}>Preparando la vista previa…</div>}
        {estado === "error" && (
          <div data-preview-alternativa>
            <AvisoLinea tono="warn">Este navegador no pudo dibujar las páginas ({error}). Puedes verlo con el visor del navegador:</AvisoLinea>
            <iframe title="Vista previa EETT" src={url} style={{ width: "100%", height: "75vh", border: `1px solid ${C.border}`, borderRadius: R.sm, background: "#fff" }} />
          </div>
        )}
        <div ref={cont} data-preview-paginas />
        <div style={{ textAlign: "center", marginTop: 8 }}>
          <a href={url} target="_blank" rel="noopener noreferrer" data-preview-pestana style={{ fontSize: T.small, color: C.tealDark }}>Abrir la vista previa en una pestaña nueva</a>
        </div>
      </div>
    </HojaLateral>
  );
}
