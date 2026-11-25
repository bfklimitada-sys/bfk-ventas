import { useState } from "react";
import { C, T, R, iStyle } from "../../lib/theme";
import { AvisoLinea, BotonPrincipal, BotonSecundario, Desplegable } from "../ui/Sistema";
import { procesarTextoTecnico } from "../../lib/especificaciones";

// «Pegar información técnica del proveedor» (25/11/2026): el vendedor pega lo que copió de la página del proveedor (tabla,
// listado, párrafos…) y BFK propone las características separadas, normalizadas y agrupadas. Nada cambia en la ficha hasta
// elegir «Reemplazar» o «Agregar». El texto original se conserva en la ficha (nunca va a los documentos).
export function ProcesarTextoTecnico({ ficha, onAplicar, deshabilitado }) {
  const [texto, setTexto] = useState(""); const [res, setRes] = useState(null);
  const procesar = () => setRes(procesarTextoTecnico(texto, { marca: ficha?.marca, modelo: ficha?.modelo, nombre: ficha?.nombre }));
  const aplicar = (modo) => { onAplicar({ ...res, modo }); setRes(null); setTexto(""); };
  return (
    <Desplegable dato="procesar-texto" titulo="Pegar información técnica del proveedor" resumen="Ordena automáticamente lo copiado de la página del proveedor" plano>
      <textarea data-texto-proveedor rows={6} value={texto} disabled={deshabilitado} onChange={(e) => { setTexto(e.target.value); setRes(null); }}
        placeholder={"Pega aquí la ficha técnica copiada (tabla, listado o párrafos)."} style={{ ...iStyle, width: "100%", resize: "vertical" }} />
      <BotonSecundario data-procesar-texto onClick={procesar} disabled={!texto.trim() || deshabilitado} style={{ minHeight: 40, marginTop: 6 }}>Procesar texto</BotonSecundario>
      {res && (
        <div data-resultado-procesado style={{ marginTop: 10, border: `1px solid ${C.border}`, borderRadius: R.sm, padding: "8px 10px", background: C.paper }}>
          <div style={{ fontSize: T.sm, fontWeight: 700, color: C.ink }}>{res.filas.length} característica{res.filas.length === 1 ? "" : "s"} en {res.categorias.length} grupo{res.categorias.length === 1 ? "" : "s"}</div>
          {res.avisos.map((a, i) => <div key={i} data-aviso-procesado={a.tipo} style={{ fontSize: T.small, color: C.warnText, marginTop: 3 }}>• {a.mensaje}</div>)}
          {res.categorias.map((c) => (
            <div key={c.id} data-grupo-procesado={c.id} style={{ marginTop: 8 }}>
              <div style={{ fontSize: T.small, fontWeight: 700, color: C.tealDark }}>{c.titulo}</div>
              {c.filas.map((f, i) => (
                <div key={i} style={{ display: "flex", gap: 8, fontSize: T.small, padding: "2px 0", color: f.contradictorio || f.incompleto ? C.warnText : C.ink }}>
                  <span style={{ fontWeight: 600, minWidth: 140 }}>{f.etiqueta}</span><span>{f.valor || "—"}{f.contradictorio ? "  (valor distinto en el texto)" : f.incompleto ? "  (sin valor informado)" : ""}</span>
                </div>
              ))}
            </div>
          ))}
          {res.descripcion && <div style={{ fontSize: T.small, color: C.inkMuted, marginTop: 8 }}><b>Descripción sugerida:</b> {res.descripcion}</div>}
          {res.descartados.length > 0 && <div data-descartados style={{ fontSize: T.small, color: C.inkFaint, marginTop: 8 }}>Se dejaron fuera {res.descartados.length} línea{res.descartados.length === 1 ? "" : "s"} comercial{res.descartados.length === 1 ? "" : "es"} o publicitaria{res.descartados.length === 1 ? "" : "s"} ({res.descartados.slice(0, 3).map((x) => `«${x.slice(0, 40)}»`).join(", ")}{res.descartados.length > 3 ? "…" : ""}). Siguen en el texto original guardado.</div>}
          {!res.filas.length && <AvisoLinea tono="warn">No se reconocieron características. Revisa el texto o ingrésalas a mano.</AvisoLinea>}
          {res.filas.length > 0 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
              <BotonPrincipal data-reemplazar-especificaciones onClick={() => aplicar("reemplazar")} style={{ flex: "1 1 160px", justifyContent: "center", minHeight: 40 }}>Reemplazar especificaciones</BotonPrincipal>
              <BotonSecundario data-agregar-especificaciones onClick={() => aplicar("agregar")} style={{ flex: "1 1 140px", justifyContent: "center", minHeight: 40 }}>Agregar a las actuales</BotonSecundario>
            </div>
          )}
        </div>
      )}
    </Desplegable>
  );
}
