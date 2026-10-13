import { useEffect, useRef, useState } from "react";
import { C } from "../../lib/theme";

// Imagen de una ficha. Si es una ruta del depósito privado, se descarga recién cuando la miniatura
// entra en pantalla (carga progresiva: no se baja toda la biblioteca con sus imágenes).
export function ImagenFicha({ src, almacen, alt = "", style, vacio = "Sin foto" }) {
  const directa = typeof src === "string" && src.startsWith("data:");
  const [url, setUrl] = useState(directa ? src : null);
  const caja = useRef(null);
  useEffect(() => {
    if (!src) { setUrl(null); return undefined; }
    if (directa) { setUrl(src); return undefined; }
    let vivo = true; setUrl(null);
    const cargar = () => almacen?.miniatura(src).then((d) => { if (vivo) setUrl(d || null); }).catch(() => {});
    const el = caja.current;
    if (!el || typeof IntersectionObserver === "undefined") { cargar(); return () => { vivo = false; }; }
    const io = new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting)) { io.disconnect(); cargar(); } }, { rootMargin: "200px" });
    io.observe(el);
    return () => { vivo = false; io.disconnect(); };
  }, [src, directa, almacen]);
  return (
    <div ref={caja} style={{ background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", color: C.inkFaint, fontSize: 11, overflow: "hidden", ...style }}>
      {url ? <img src={url} alt={alt} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "contain" }} /> : src ? "…" : vacio}
    </div>
  );
}
