// Administración › Ventas privadas (solo administrador; lo exige la base): datos de BFK impresos en cotizaciones y EETT,
// y el interruptor de carga de archivos (deshabilitado al instalar hasta que el respaldo diario incluya «vp-documentos»).
import { useState } from "react";
import { C, R, T, cardStyle } from "../../lib/theme";
import { Seccion, AvisoLinea } from "../ui/Sistema";
import { Campo, Rejilla, Entrada, ErrorForm, PedirMotivo } from "../proyectos/Comunes";
import { estiloBoton, NoInstalado } from "./Comunes";
import { configurar } from "../../lib/ventasPrivadasDatos";
import { mensajeVP } from "../../lib/ventasPrivadas";
import { Ic } from "../ui/Iconos";

const CAMPOS = [["razon_social", "Razón social"], ["nombre_corto", "Nombre corto"], ["rut", "RUT"], ["giro", "Giro"], ["lema", "Lema / descripción"], ["direccion", "Dirección"], ["comuna", "Comuna"], ["correo", "Correo"], ["telefonos", "Teléfonos"], ["sitio_web", "Sitio web"]];

export function ConfigVentasPrivadas({ token, vp, onRecargar, showToast }) {
  const [f, setF] = useState(() => Object.fromEntries(CAMPOS.map(([k]) => [k, vp?.empresa?.[k] || ""])));
  const [pedir, setPedir] = useState(null); const [err, setErr] = useState("");
  if (!vp?.instalado) return <Seccion titulo="Ventas privadas"><NoInstalado /></Seccion>;
  const guardar = async (clave, valor, motivo) => {
    try { await configurar(token, clave, valor, motivo); showToast?.("Configuración guardada"); setPedir(null); setErr(""); await onRecargar(); }
    catch (e) { setErr(mensajeVP(e)); setPedir(null); }
  };
  return (
    <Seccion titulo="Ventas privadas · configuración">
      <div data-config-vp style={{ ...cardStyle, borderRadius: R.md, padding: "12px 14px", marginBottom: 10 }}>
        <div style={{ fontWeight: 800, fontSize: T.sm, marginBottom: 6 }}>Datos de BFK en cotizaciones y EETT</div>
        <div style={{ fontSize: T.small, color: C.inkMuted, marginBottom: 8 }}>Se imprimen tal cual en los PDF. Los campos vacíos no se imprimen (por ejemplo, el giro, mientras no esté registrado).</div>
        <ErrorForm>{err}</ErrorForm>
        <Rejilla>{CAMPOS.map(([k, l]) => <Campo key={k} etiqueta={l}><Entrada data-config-campo={k} value={f[k]} onChange={(e) => setF((x) => ({ ...x, [k]: e.target.value }))} maxLength={300} /></Campo>)}</Rejilla>
        <button type="button" data-guardar-config onClick={() => setPedir({ clave: "empresa", valor: Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim() || null])) })} style={estiloBoton("pri")}>Guardar datos de BFK</button>
      </div>
      <div data-config-documentos-vp={vp.documentosHabilitados ? "habilitada" : "deshabilitada"} style={{ ...cardStyle, borderRadius: R.md, padding: "10px 14px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <Ic n="🔒" color={vp.documentosHabilitados ? C.ok : C.warn} />
        <span style={{ flex: "1 1 220px", fontSize: T.sm }}>Carga de archivos de ventas privadas: <b>{vp.documentosHabilitados ? "habilitada" : "deshabilitada"}</b>
          <span style={{ display: "block", fontSize: T.small, color: C.inkFaint }}>Habilítala cuando el respaldo diario de archivos incluya el depósito «vp-documentos».</span></span>
        <button type="button" data-alternar-documentos-vp onClick={() => setPedir({ clave: "documentos_habilitados", valor: !vp.documentosHabilitados })} style={estiloBoton(vp.documentosHabilitados ? "peligro" : "sec")}>{vp.documentosHabilitados ? "Deshabilitar" : "Habilitar"}</button>
      </div>
      {!vp.documentosHabilitados && <AvisoLinea tono="info" icono="ℹ">Mientras esté deshabilitada, las ventas, OC, entregas, facturas y pagos se registran igual; solo no se pueden adjuntar archivos.</AvisoLinea>}
      {pedir && <PedirMotivo titulo="Motivo del cambio" texto="Queda en el historial de configuración." etiquetaBoton="Guardar" onCancelar={() => setPedir(null)} onConfirmar={(m) => guardar(pedir.clave, pedir.valor, m)} />}
    </Seccion>
  );
}
