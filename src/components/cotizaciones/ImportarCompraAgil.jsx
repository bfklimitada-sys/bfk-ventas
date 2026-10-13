import { useState } from "react";
import { C, T, R, iStyle, fmt } from "../../lib/theme";
import { Modal } from "../ui/Basicos";
import { AvisoLinea, BotonPrincipal, BotonSecundario, Tarjeta } from "../ui/Sistema";
import { codigoCompraAgil, propuestaCompraAgil } from "../../lib/cotizaciones";
import { consultarCompraAgil } from "../../lib/cotizacionesDatos";

const fechaHora = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? String(iso || "") : d.toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" }); };
const mostrar = (campo, v) => {
  if (v == null || v === "") return "—";
  if (campo === "presupuesto_estimado") return `${fmt.money(Math.round(Number(v)))} (presupuesto del comprador; no es el precio de BFK)`;
  if (campo === "fecha_publicacion" || campo === "fecha_cierre") return fechaHora(v);
  if (campo === "requerimientos") return `${v.length} producto(s) requerido(s)`;
  if (campo === "documentos_mp") return v.map((d) => d.nombre || d.id).join(", ");
  return String(v);
};

// «Enlace o código de Compra Ágil» + «Consultar y completar». Consulta la API oficial de ChileCompra desde el
// servidor (/api/compra-agil). Muestra una vista previa; lo que reemplazaría un dato ya escrito queda SIN marcar
// hasta que el usuario lo confirme. No toca la fecha de emisión de BFK, el estado, los productos ni los precios.
export function ImportarCompraAgil({ cot, token, onAplicar, deshabilitado }) {
  const [entrada, setEntrada] = useState(""); const [consultando, setConsultando] = useState(false); const [error, setError] = useState("");
  const [vista, setVista] = useState(null); // { fuente, consultado_en, datos, filas, marcados }

  const consultar = async () => {
    setError("");
    if (!codigoCompraAgil(entrada)) { setError("No se reconoce un código de Compra Ágil (por ejemplo 3390-246-COT26). Revisa el enlace o el código."); return; }
    setConsultando(true);
    try {
      const r = await consultarCompraAgil(token, entrada.trim());
      const filas = propuestaCompraAgil(cot, r.datos);
      setVista({ ...r, filas, marcados: Object.fromEntries(filas.map((f) => [f.campo, !f.sobrescribe])) });
    } catch (e) { setError(e.message); } finally { setConsultando(false); }
  };
  const aplicar = () => {
    const cambios = {}; vista.filas.forEach((f) => { if (vista.marcados[f.campo]) cambios[f.campo] = f.valor; });
    if (Object.keys(cambios).length) cambios.mp_consultado_en = vista.consultado_en;
    onAplicar(cambios, vista.datos); setVista(null); setEntrada("");
  };

  return (
    <Tarjeta padding="12px" data-importar-compra-agil style={{ borderColor: C.teal }}>
      <div style={{ fontSize: T.sm, fontWeight: 800, color: C.ink, marginBottom: 6 }}>Enlace o código de Compra Ágil</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <input data-entrada-compra-agil value={entrada} onChange={(e) => { setEntrada(e.target.value); setError(""); }} onKeyDown={(e) => { if (e.key === "Enter") consultar(); }} disabled={deshabilitado}
          placeholder="https://… o 3390-246-COT26" style={{ ...iStyle, flex: "1 1 220px", width: "auto" }} />
        <BotonPrincipal data-consultar-compra-agil onClick={consultar} disabled={consultando || !entrada.trim() || deshabilitado} style={{ opacity: consultando || !entrada.trim() ? 0.6 : 1 }}>{consultando ? "Consultando…" : "Consultar y completar"}</BotonPrincipal>
      </div>
      <div style={{ fontSize: T.small, color: C.inkFaint, marginTop: 6 }}>Consulta la API oficial de ChileCompra. Verás los datos antes de aplicarlos; todo queda editable y el ingreso manual sigue disponible.</div>
      {error && <AvisoLinea tono="warn" dato="error-compra-agil">{error}</AvisoLinea>}

      {vista && (
        <Modal title={`Datos de la Compra Ágil ${vista.datos.codigo}`} onClose={() => setVista(null)}>
          <div data-vista-compra-agil>
            <div style={{ fontSize: T.small, color: C.inkMuted, marginBottom: 10 }}>{vista.fuente} · consultado {fechaHora(vista.consultado_en)}{vista.datos.estado ? ` · estado: ${vista.datos.estado}` : ""}</div>
            {vista.datos.oc_emitida && <AvisoLinea tono="info">ChileCompra indica que este proceso ya tiene una OC emitida. La cotización no cambia de estado por esto.</AvisoLinea>}
            {!vista.filas.length && <AvisoLinea tono="info">No hay datos nuevos: la cotización ya coincide con lo publicado.</AvisoLinea>}
            {vista.filas.map((f) => (
              <label key={f.campo} data-fila-importar={f.campo} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "8px 0", borderBottom: `1px solid ${C.border}`, fontSize: T.sm, cursor: "pointer" }}>
                <input type="checkbox" checked={!!vista.marcados[f.campo]} onChange={(e) => setVista((v) => ({ ...v, marcados: { ...v.marcados, [f.campo]: e.target.checked } }))} style={{ marginTop: 3 }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 800, color: C.ink }}>{f.etiqueta}</div>
                  <div style={{ color: C.ink, wordBreak: "break-word" }}>{mostrar(f.campo, f.valor)}</div>
                  {f.sobrescribe && <div data-sobrescribe style={{ color: C.warnText, fontWeight: 700, marginTop: 2 }}>Reemplazaría el valor actual: {mostrar(f.campo, f.actual)}</div>}
                  {f.campo === "requerimientos" && (
                    <div style={{ marginTop: 4 }}>{f.valor.map((p, i) => (
                      <div key={i} style={{ fontSize: T.small, color: C.inkMuted, background: C.paper, borderRadius: R.sm, padding: "4px 8px", marginTop: 4 }}>
                        <b>{p.cantidad ?? "?"} {p.unidad || ""}</b> · {p.nombre}{p.descripcion ? ` — ${p.descripcion}` : ""}
                      </div>))}
                      <div style={{ fontSize: T.small, color: C.inkFaint, marginTop: 4 }}>Son requerimientos del comprador, no productos de proveedores: cada producto ofrecido se ingresa manualmente.</div>
                    </div>
                  )}
                </div>
              </label>
            ))}
            <div style={{ fontSize: T.small, color: C.inkFaint, margin: "10px 0" }}>La fecha de emisión de BFK, el estado, los productos ofrecidos y los precios no se modifican. Comuna y ciudad no vienen en la API: complétalas a mano si corresponde.</div>
            <div style={{ display: "flex", gap: 8 }}>
              <BotonSecundario onClick={() => setVista(null)} style={{ flex: 1, justifyContent: "center" }}>Cancelar</BotonSecundario>
              <BotonPrincipal data-aplicar-compra-agil onClick={aplicar} disabled={!vista.filas.some((f) => vista.marcados[f.campo])} style={{ flex: 2, justifyContent: "center" }}>Aplicar datos marcados</BotonPrincipal>
            </div>
          </div>
        </Modal>
      )}
    </Tarjeta>
  );
}
