import { useCallback, useEffect, useState } from "react";
import { rpcCuentasPorAutorizar, rpcAutorizarCuenta, selAutorizaciones, funcionNoInstalada, mensajeAcceso } from "../../lib/supabase";
import { C, btnP, fmt, iStyle } from "../../lib/theme";
import { Seccion, Tarjeta, Badge, BotonAdmin } from "../ui/Sistema";

// Seguridad 23/10/2026 · Administración → Usuarios: cuentas sin perfil BFK («por autorizar») y su autorización.
// Todo lo valida la base: bfk_cuentas_por_autorizar() y bfk_autorizar_cuenta() solo responden a un administrador,
// una cuenta aislada nunca recibe perfil y cada autorización queda en perfiles_autorizaciones.
// Si la migración de seguridad aún no está instalada, la sección lo informa y no ofrece ninguna acción.
const nombreSugerido = (correo) => String(correo || "").split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();

export function AutorizacionCuentas({ session, showToast, onAutorizada, visible }) {
  const token = session?.access_token;
  const [cuentas, setCuentas] = useState(null);        // null = cargando
  const [estado, setEstado] = useState("cargando");    // cargando | ok | no_instalada | error
  const [error, setError] = useState("");
  const [registro, setRegistro] = useState([]);
  const [abierta, setAbierta] = useState(null);        // id de la cuenta con el formulario abierto
  const [nombre, setNombre] = useState(""); const [rol, setRol] = useState("usuario"); const [confirmado, setConfirmado] = useState(false);
  const [guardando, setGuardando] = useState(false); const [errForm, setErrForm] = useState("");

  const cargar = useCallback(async () => {
    if (!token) return;
    setEstado("cargando"); setError("");
    try {
      const lista = await rpcCuentasPorAutorizar(token);
      setCuentas(Array.isArray(lista) ? lista : []); setEstado("ok");
      const reg = await selAutorizaciones(token).catch(() => []);
      setRegistro(Array.isArray(reg) ? reg : []);
    } catch (e) {
      setCuentas([]);
      if (funcionNoInstalada(e)) setEstado("no_instalada");
      else { setEstado("error"); setError(mensajeAcceso(e.message)); }
    }
  }, [token]);
  useEffect(() => { if (visible) cargar(); }, [visible, cargar]);

  const abrir = (c) => { setAbierta(c.id); setNombre(nombreSugerido(c.correo)); setRol("usuario"); setConfirmado(false); setErrForm(""); };
  const autorizar = async (c) => {
    const n = nombre.trim();
    if (!n) { setErrForm("Indica el nombre con que aparecerá en BFK"); return; }
    if (!confirmado) { setErrForm("Marca la confirmación antes de autorizar"); return; }
    setGuardando(true); setErrForm("");
    try {
      const r = await rpcAutorizarCuenta(token, { id: c.id, nombre: n, rol });
      showToast(r?.accion === "ya_autorizada" ? `${c.correo} ya estaba autorizada` : `${c.correo} autorizada como ${rol === "admin" ? "administrador" : "usuario"}`);
      setAbierta(null);
      await cargar();
      await onAutorizada?.();
    } catch (e) { setErrForm(mensajeAcceso(e.message) || "No se pudo autorizar la cuenta"); }
    finally { setGuardando(false); }
  };

  return (
    <Seccion id="adm-por-autorizar" titulo="Cuentas por autorizar" nota="Cuentas creadas que todavía no tienen perfil BFK: no ven ninguna información hasta que un administrador las autoriza.">
      <div data-por-autorizar={estado}>
        {estado === "cargando" && <Tarjeta><div style={{ fontSize: 13, color: C.inkMuted }}>Cargando cuentas…</div></Tarjeta>}
        {estado === "no_instalada" && (
          <Tarjeta><div data-por-autorizar-no-instalada style={{ fontSize: 13, color: C.inkMuted, lineHeight: 1.5 }}>
            La autorización de cuentas se activa al instalar la migración de seguridad (perfil BFK obligatorio).
          </div></Tarjeta>
        )}
        {estado === "error" && (
          <Tarjeta><div style={{ fontSize: 13, color: C.dangerText, fontWeight: 600 }}>{error || "No se pudieron leer las cuentas por autorizar"}</div>
            <BotonAdmin onClick={cargar} style={{ marginTop: 10 }}>Reintentar</BotonAdmin></Tarjeta>
        )}
        {estado === "ok" && cuentas.length === 0 && (
          <Tarjeta><div data-sin-pendientes style={{ fontSize: 13, color: C.inkMuted }}>No hay cuentas por autorizar.</div></Tarjeta>
        )}
        {estado === "ok" && cuentas.map((c) => (
          <Tarjeta key={c.id}>
            <div data-cuenta-pendiente={c.correo} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
              <div style={{ minWidth: 0, flex: "1 1 200px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 700, fontSize: 15, color: C.ink, wordBreak: "break-all" }}>{c.correo || "(sin correo)"}</span>
                  {c.aislada ? <Badge tono="neutro">Aislada · {c.aislada}</Badge> : <Badge tono="warn">Por autorizar</Badge>}
                  {!c.confirmada && <Badge tono="neutro">Correo sin confirmar</Badge>}
                </div>
                <div style={{ fontSize: 12, color: C.inkMuted, marginTop: 4 }}>
                  Creada: {c.creada_en ? fmt.datetime(c.creada_en) : "—"} · Último ingreso: {c.ultimo_ingreso ? fmt.datetime(c.ultimo_ingreso) : "nunca"}
                </div>
              </div>
              {!c.aislada && abierta !== c.id && (
                <BotonAdmin data-autorizar-abrir onClick={() => abrir(c)} style={{ flexShrink: 0, padding: "8px 12px", fontSize: 13 }}>Autorizar</BotonAdmin>
              )}
            </div>
            {c.aislada && <div style={{ fontSize: 12, color: C.inkMuted, marginTop: 8 }}>Cuenta técnica aislada: la base no permite darle acceso a BFK.</div>}
            {abierta === c.id && (
              <div data-form-autorizar style={{ marginTop: 12, borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: C.inkMuted, marginBottom: 4 }}>Nombre en BFK</label>
                <input data-autorizar-nombre style={iStyle} value={nombre} onChange={(e) => { setNombre(e.target.value); setErrForm(""); }} placeholder="Nombre y apellido" />
                <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: C.inkMuted, margin: "10px 0 4px" }}>Rol</label>
                <select data-autorizar-rol style={iStyle} value={rol} onChange={(e) => { setRol(e.target.value); setConfirmado(false); }}>
                  <option value="usuario">Usuario</option>
                  <option value="admin">Administrador</option>
                </select>
                <label data-autorizar-confirmacion style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 12, fontSize: 13, color: C.ink, lineHeight: 1.45, cursor: "pointer" }}>
                  <input type="checkbox" checked={confirmado} onChange={(e) => { setConfirmado(e.target.checked); setErrForm(""); }} style={{ width: 20, height: 20, flexShrink: 0, marginTop: 1 }} />
                  <span>{rol === "admin"
                    ? <>Confirmo que <b>{c.correo}</b> debe ser <b>administrador</b>: tendrá acceso completo a la información de BFK y podrá autorizar otras cuentas.</>
                    : <>Confirmo que <b>{c.correo}</b> debe tener acceso a la información de BFK.</>}</span>
                </label>
                {errForm && <div data-autorizar-error style={{ background: C.dangerLight, color: C.dangerText, borderRadius: 8, padding: "8px 10px", fontSize: 13, marginTop: 10, fontWeight: 600 }}>{errForm}</div>}
                <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                  <button data-autorizar-confirmar onClick={() => autorizar(c)} disabled={guardando} style={{ ...btnP(guardando ? C.inkFaint : C.night), flex: "1 1 160px", width: "auto" }}>{guardando ? "Autorizando…" : "Autorizar cuenta"}</button>
                  <button onClick={() => setAbierta(null)} disabled={guardando} style={{ flex: "0 1 120px", background: "none", border: `1px solid ${C.border}`, borderRadius: 12, minHeight: 44, fontWeight: 700, color: C.ink, cursor: "pointer" }}>Cancelar</button>
                </div>
              </div>
            )}
          </Tarjeta>
        ))}
        {estado === "ok" && registro.length > 0 && (
          <Tarjeta>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, marginBottom: 6 }}>Autorizaciones registradas</div>
            <div data-registro-autorizaciones>
              {registro.slice(0, 10).map((a) => (
                <div key={a.id} style={{ fontSize: 12, color: C.inkMuted, padding: "4px 0", borderTop: `1px solid ${C.border}` }}>
                  {fmt.datetime(a.autorizado_en)} · <b style={{ color: C.ink }}>{a.nombre}</b> ({a.correo || "—"}) como {a.rol === "admin" ? "administrador" : "usuario"} · por {a.autorizado_por_nombre || "—"}
                </div>
              ))}
            </div>
          </Tarjeta>
        )}
      </div>
    </Seccion>
  );
}
