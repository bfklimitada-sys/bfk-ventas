// Administración › Inteligencia Comercial (06/11/2026). Muestra el estado del interruptor central y permite a un
// administrador cambiarlo con una acción explícita y confirmada. Abrir esta pestaña SOLO lee el estado (una lectura
// de la base); no consulta ChileCompra, no sincroniza y no carga el módulo. El módulo (indicadores históricos) solo se
// descarga si está habilitado y el administrador presiona «Abrir».
import { useEffect, useState, lazy, Suspense } from "react";
import { C, iStyle } from "../../lib/theme";
import { Seccion, Tarjeta, Badge, BotonAdmin, AvisoLinea } from "../ui/Sistema";
import { leerInterruptorIC, cambiarInterruptorIC, FRASE_REACTIVAR } from "../../lib/interruptorIC";
import { importarModulo } from "../../lib/cargaModulos";

const InteligenciaComercial = lazy(() => importarModulo(() => import("./InteligenciaComercial")));

export function AdminInteligencia({ token, perfil, escritorio, leer = leerInterruptorIC, cambiar = cambiarInterruptorIC }) {
  const [est, setEst] = useState(null); const [abrir, setAbrir] = useState(false);
  const [frase, setFrase] = useState(""); const [motivo, setMotivo] = useState(""); const [msj, setMsj] = useState(null); const [guardando, setGuardando] = useState(false);
  const [recarga, setRecarga] = useState(0);
  useEffect(() => { let vivo = true; leer(token).then((e) => { if (vivo) setEst(e); }); return () => { vivo = false; }; }, [token, recarga, leer]);
  const hab = est?.habilitada === true;
  const aplicar = async (habilitar) => {
    setGuardando(true); setMsj(null);
    try { const e = await cambiar(token, { habilitar, confirmacion: habilitar ? frase.trim() : "", motivo: motivo.trim() }); setEst((x) => ({ ...x, ...e, instalado: true })); setFrase(""); setMotivo(""); if (!habilitar) setAbrir(false);
      setMsj({ tono: "ok", t: habilitar ? "Inteligencia Comercial quedó habilitada." : "Inteligencia Comercial quedó desactivada." }); }
    catch (e) { setMsj({ tono: "danger", t: e.message }); }
    finally { setGuardando(false); setRecarga((n) => n + 1); }
  };
  return (
    <Seccion id="adm-inteligencia" titulo="Inteligencia Comercial" nota="Consultas masivas a la API de Compra Ágil de ChileCompra. Desactivada por defecto; los datos históricos se conservan.">
      <Tarjeta data-ic-admin>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 700 }}>Estado</span>
          {!est ? <span style={{ fontSize: 13, color: C.inkMuted }}>Leyendo…</span>
            : <Badge tono={hab ? "ok" : "neutro"}><span data-ic-estado={hab ? "habilitada" : "desactivada"}>{hab ? "Habilitada" : "Desactivada"}</span></Badge>}
        </div>
        {est && !hab && <div style={{ fontSize: 13, color: C.inkMuted, marginTop: 8, lineHeight: 1.5 }}>
          El servidor rechaza toda sincronización y no consulta ChileCompra. No hay sincronizaciones automáticas.
          {est.instalado === false && <> El interruptor todavía no está instalado en la base: mientras no exista, el módulo permanece desactivado.</>}
          {est.cambiado_en && <> Último cambio: {new Date(est.cambiado_en).toLocaleString("es-CL")}{est.cambiado_por ? ` por ${est.cambiado_por}` : ""}{est.motivo ? ` · ${est.motivo}` : ""}.</>}
        </div>}
        {msj && <div style={{ marginTop: 10 }}><AvisoLinea dato="ic-admin-msj" tono={msj.tono} icono={msj.tono === "ok" ? "✓" : "⚠"}>{msj.t}</AvisoLinea></div>}
        {est && !hab && perfil?.rol === "admin" && (
          <details style={{ marginTop: 12 }} data-ic-reactivar>
            <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 700, color: C.ink }}>Reactivar (consume consultas de la API de ChileCompra)</summary>
            <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
              <label style={{ fontSize: 12, color: C.inkMuted }}>Escribe <b>{FRASE_REACTIVAR}</b> para confirmar
                <input data-ic-frase value={frase} onChange={(e) => setFrase(e.target.value)} style={iStyle} autoComplete="off" /></label>
              <label style={{ fontSize: 12, color: C.inkMuted }}>Motivo
                <input data-ic-motivo value={motivo} onChange={(e) => setMotivo(e.target.value)} style={iStyle} /></label>
              <BotonAdmin data-ic-confirmar-reactivar peligro disabled={guardando || frase.trim() !== FRASE_REACTIVAR || !motivo.trim()} onClick={() => aplicar(true)}>Reactivar Inteligencia Comercial</BotonAdmin>
            </div>
          </details>
        )}
        {hab && perfil?.rol === "admin" && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            <BotonAdmin data-ic-abrir onClick={() => setAbrir(true)} disabled={abrir}>Abrir Inteligencia Comercial</BotonAdmin>
            <BotonAdmin data-ic-desactivar peligro disabled={guardando} onClick={() => aplicar(false)}>Desactivar</BotonAdmin>
          </div>
        )}
      </Tarjeta>
      {hab && abrir && <div style={{ marginTop: 12 }}><Suspense fallback={<div style={{ fontSize: 13, color: C.inkMuted }}>Cargando Inteligencia Comercial…</div>}>
        <InteligenciaComercial token={token} perfil={perfil} escritorio={escritorio} />
      </Suspense></div>}
    </Seccion>
  );
}
