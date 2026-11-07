// Ventas privadas › Clientes: registro (sin duplicados por RUT, reutiliza el registro de clientes de BFK) e historial
// de cotizaciones, ventas y saldos de cada cliente.
import { useMemo, useState } from "react";
import { C, MONO, R, S, T, cardStyle } from "../../lib/theme";
import { HojaLateral, Seccion, Badge, AvisoLinea } from "../ui/Sistema";
import { Ventana, Campo, Rejilla, Subtitulo, Entrada, Area, Selector, ErrorForm } from "../proyectos/Comunes";
import { NoInstalado, Vacio, estiloBoton, Fila, BadgeVP, Kpi, RejillaKpi } from "./Comunes";
import { guardarCliente } from "../../lib/ventasPrivadasDatos";
import { resumenCliente, pesos, fechaTxt, mensajeVP, ESTADOS_COTIZACION, ESTADOS_PAGO, folioRevision } from "../../lib/ventasPrivadas";
import { analizarRut, rutParaGuardar } from "../../lib/rut";
const validarRut = (v) => analizarRut(v).ok;
const formatearRut = rutParaGuardar;

export function PanelClientes({ token, perfil, vp, onRecargar, showToast, onAbrir, focoId, onFocoUsado }) {
  const [texto, setTexto] = useState(""); const [soloVP, setSoloVP] = useState(true);
  const [form, setForm] = useState(null); const [abierto, setAbierto] = useState(null);
  if (focoId && focoId !== abierto) { setAbierto(focoId); onFocoUsado?.(); }
  const filas = useMemo(() => {
    const q = texto.trim().toLowerCase();
    return (vp.clientes || []).filter((c) => (!soloVP || c.es_venta_privada) && (!q || `${c.razon_social} ${c.rut || ""} ${c.contacto_nombre || ""}`.toLowerCase().includes(q)));
  }, [vp.clientes, texto, soloVP]);
  if (!vp.instalado) return <NoInstalado />;
  const cli = abierto ? vp.clientes.find((c) => c.id === abierto) : null;
  return (
    <div data-panel-vp-clientes>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: S.md }}>
        <div style={{ fontSize: T.sm, color: C.inkMuted, flex: "1 1 260px" }}>Empresas y personas de <b>ventas privadas</b>. El RUT es único: un cliente se registra una sola vez y se reutiliza en cotizaciones, ventas y Proyectos industriales.</div>
        <button type="button" data-nuevo-cliente onClick={() => setForm({})} style={{ ...estiloBoton("pri"), minHeight: 44, padding: "10px 18px" }}>+ Nuevo cliente</button>
      </div>
      <Seccion titulo={`Clientes · ${filas.length}`}>
        <Entrada data-buscar-clientes value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar por nombre, RUT o contacto" style={{ marginBottom: 8 }} />
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: T.sm, color: C.inkMuted, marginBottom: 10 }}>
          <input type="checkbox" checked={!soloVP} onChange={(e) => setSoloVP(!e.target.checked)} /> Incluir clientes registrados solo en Proyectos industriales
        </label>
        {!filas.length && <Vacio dato="sin-clientes">{vp.clientes.length ? "Ningún cliente coincide." : "Aún no hay clientes. Registra el primero con «+ Nuevo cliente»."}</Vacio>}
        {filas.map((c) => {
          const r = resumenCliente(c.id, vp);
          return (
            <button key={c.id} type="button" data-cliente={c.rut} onClick={() => setAbierto(c.id)} style={{ ...cardStyle, borderRadius: R.md, padding: "11px 14px", marginBottom: 8, width: "100%", textAlign: "left", cursor: "pointer", display: "flex", gap: 10, alignItems: "center" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: T.body, color: C.ink }}>{c.razon_social}</div>
                <div style={{ fontSize: T.small, color: C.inkMuted }}><span style={{ fontFamily: MONO }}>{c.rut || "Sin RUT"}</span> · {c.tipo_persona === "persona" ? "Persona" : "Empresa"}{c.contacto_nombre ? ` · ${c.contacto_nombre}` : ""}</div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontSize: T.small, color: C.inkMuted }}>{r.nCotizaciones} cot. · {r.ventas.length} ventas</div>
                {r.saldo > 0 && <div style={{ fontFamily: MONO, fontWeight: 800, fontSize: T.sm, color: r.vencido > 0 ? C.dangerText : C.warnText }}>Saldo {pesos(r.saldo)}</div>}
              </div>
            </button>
          );
        })}
      </Seccion>
      {cli && <FichaCliente cli={cli} vp={vp} perfil={perfil} onCerrar={() => setAbierto(null)} onEditar={() => setForm({ cliente: cli })} onAbrir={onAbrir} />}
      {form && <FormCliente token={token} cliente={form.cliente} clientes={vp.clientes} showToast={showToast} onCerrar={() => setForm(null)}
        onGuardado={async (id) => { setForm(null); await onRecargar(); setAbierto(id); }} />}
    </div>
  );
}

function FichaCliente({ cli, vp, perfil, onCerrar, onEditar, onAbrir }) {
  const r = resumenCliente(cli.id, vp);
  const puedeEditar = perfil?.rol === "admin" || cli.creado_por === perfil?.id;
  return (
    <HojaLateral abierta onCerrar={onCerrar} titulo={cli.razon_social} subtitulo={`${cli.rut || "Sin RUT"} · ${cli.tipo_persona === "persona" ? "Persona" : "Empresa"}`} dato="ficha-cliente"
      derecha={puedeEditar ? <button type="button" data-editar-cliente onClick={onEditar} style={estiloBoton()}>Editar</button> : null}>
      <div style={{ padding: 16 }}>
        <RejillaKpi>
          <Kpi dato="cli-vendido" et="Vendido (vigente)" v={pesos(r.vendido)} n={`${r.ventas.length} venta${r.ventas.length === 1 ? "" : "s"}`} />
          <Kpi dato="cli-cobrado" et="Cobrado" v={pesos(r.cobrado)} />
          <Kpi dato="cli-saldo" et="Saldo pendiente" v={pesos(r.saldo)} tono={r.vencido > 0 ? "danger" : r.saldo > 0 ? "warn" : "ok"} n={r.vencido > 0 ? `${pesos(r.vencido)} vencido` : null} />
        </RejillaKpi>
        <Seccion titulo="Datos">
          <div style={{ ...cardStyle, borderRadius: R.md, padding: "8px 14px" }}>
            {cli.giro && <Fila k="Giro" v={cli.giro} />}
            <Fila k="Contacto" v={[cli.contacto_nombre, cli.contacto_correo, cli.contacto_telefono].filter(Boolean).join(" · ") || "—"} />
            <Fila k="Facturación" v={[cli.direccion, cli.comuna, cli.region].filter(Boolean).join(", ") || "—"} />
            <Fila k="Entrega" v={[cli.direccion_entrega, cli.comuna_entrega].filter(Boolean).join(", ") || "—"} />
            <Fila k="Condiciones de pago" v={[cli.condiciones_pago, cli.plazo_pago_dias != null ? `${cli.plazo_pago_dias} días` : null].filter(Boolean).join(" · ") || "—"} />
            {cli.notas && <Fila k="Observaciones" v={cli.notas} />}
          </div>
          {!cli.es_venta_privada && <AvisoLinea tono="info" icono="ℹ">Cliente registrado en Proyectos industriales. Al usarlo en una venta privada se completan sus datos comerciales.</AvisoLinea>}
        </Seccion>
        <Seccion titulo={`Cotizaciones · ${r.cotizaciones.length}`}>
          {!r.cotizaciones.length && <Vacio>Sin cotizaciones.</Vacio>}
          {r.cotizaciones.map((c) => (
            <button key={c.id} type="button" data-cli-cot={c.folio} onClick={() => onAbrir?.("vp_cotizaciones", c.id)} style={{ ...cardStyle, borderRadius: R.md, padding: "9px 12px", marginBottom: 6, width: "100%", textAlign: "left", cursor: "pointer", display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontFamily: MONO, fontWeight: 800, flex: 1 }}>{folioRevision(c.folio, c.revision_actual)}</span>
              <span style={{ fontSize: T.small, color: C.inkMuted }}>{fechaTxt(c.fecha_emision)}</span>
              <BadgeVP mapa={ESTADOS_COTIZACION} k={c.estado_efectivo} />
              <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: T.sm }}>{pesos(c.total)}</span>
            </button>
          ))}
        </Seccion>
        <Seccion titulo={`Ventas · ${r.ventas.length}`}>
          {!r.ventas.length && <Vacio>Sin ventas vigentes.</Vacio>}
          {r.ventas.map((v) => (
            <button key={v.id} type="button" data-cli-venta={v.folio} onClick={() => onAbrir?.("vp_ordenes", v.id)} style={{ ...cardStyle, borderRadius: R.md, padding: "9px 12px", marginBottom: 6, width: "100%", textAlign: "left", cursor: "pointer", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontFamily: MONO, fontWeight: 800, flex: 1 }}>{v.folio}</span>
              <BadgeVP mapa={ESTADOS_PAGO} k={v.estado_pago} />
              <span style={{ fontSize: T.small, color: C.inkMuted }}>Total {pesos(v.total)} · saldo <b style={{ fontFamily: MONO, color: Number(v.monto_vencido) > 0 ? C.dangerText : C.ink }}>{pesos(v.saldo)}</b></span>
            </button>
          ))}
        </Seccion>
      </div>
    </HojaLateral>
  );
}

export function FormCliente({ token, cliente, clientes, showToast, onCerrar, onGuardado }) {
  const c = cliente || {};
  const [f, setF] = useState({ tipo_persona: c.tipo_persona || "empresa", rut: c.rut || "", razon_social: c.razon_social || "", giro: c.giro || "",
    contacto_nombre: c.contacto_nombre || "", contacto_correo: c.contacto_correo || "", contacto_telefono: c.contacto_telefono || "",
    direccion: c.direccion || "", comuna: c.comuna || "", region: c.region || "", direccion_entrega: c.direccion_entrega || "", comuna_entrega: c.comuna_entrega || "",
    condiciones_pago: c.condiciones_pago || "", plazo_pago_dias: c.plazo_pago_dias ?? "", notas: c.notas || "" });
  const [err, setErr] = useState(""); const [ocupado, setOcupado] = useState(false); const [existente, setExistente] = useState(null);
  const set = (k) => (e) => { setF((x) => ({ ...x, [k]: e.target.value })); setErr(""); setExistente(null); };
  const rutOk = validarRut(f.rut);
  const guardar = async () => {
    if (!rutOk) { setErr("El RUT no es válido (revisa el dígito verificador)."); return; }
    if (f.razon_social.trim().length < 2) { setErr(f.tipo_persona === "persona" ? "Falta el nombre." : "Falta la razón social."); return; }
    // Aviso previo de duplicado (la base vuelve a comprobarlo al guardar).
    const clave = String(f.rut).replace(/[^0-9kK]/g, "").toUpperCase();
    const dup = (clientes || []).find((x) => x.rut_clave === clave && x.id !== c.id);
    if (dup) { setExistente(dup); setErr(`Ya existe un cliente con ese RUT: ${dup.razon_social}.`); return; }
    setOcupado(true);
    try {
      const r = await guardarCliente(token, { ...(c.id ? { id: c.id, version: c.version } : {}), ...f, rut: formatearRut(f.rut), plazo_pago_dias: f.plazo_pago_dias === "" ? null : Number(f.plazo_pago_dias) });
      showToast?.(c.id ? "Cliente actualizado" : "Cliente registrado"); onGuardado?.(r.id);
    } catch (e) {
      if (e.duplicado && e.detalle) setExistente((clientes || []).find((x) => x.id === e.detalle) || { id: e.detalle });
      setErr(mensajeVP(e));
    } finally { setOcupado(false); }
  };
  return (
    <Ventana titulo={c.id ? "Editar cliente" : "Nuevo cliente"} onCerrar={onCerrar} dato="form-cliente" ancho={640}
      pie={<><button type="button" onClick={onCerrar} style={estiloBoton()}>Cancelar</button>
        {existente && <button type="button" data-usar-existente onClick={() => onGuardado?.(existente.id)} style={estiloBoton()}>Usar el cliente existente</button>}
        <button type="button" data-guardar-cliente disabled={ocupado} onClick={guardar} style={{ ...estiloBoton("pri"), minHeight: 44 }}>{ocupado ? "Guardando…" : "Guardar"}</button></>}>
      <ErrorForm>{err}</ErrorForm>
      <Rejilla>
        <Campo etiqueta="Tipo"><Selector data-campo-tipo value={f.tipo_persona} onChange={set("tipo_persona")} opciones={[{ v: "empresa", l: "Empresa" }, { v: "persona", l: "Persona natural" }]} /></Campo>
        <Campo etiqueta="RUT" error={f.rut && !rutOk ? "RUT no válido" : ""}><Entrada data-campo-rut value={f.rut} onChange={set("rut")} onBlur={() => rutOk && setF((x) => ({ ...x, rut: formatearRut(x.rut) }))} placeholder="76.123.456-7" /></Campo>
        <Campo etiqueta={f.tipo_persona === "persona" ? "Nombre" : "Razón social"} ancho="completo"><Entrada data-campo-razon value={f.razon_social} onChange={set("razon_social")} maxLength={200} /></Campo>
        {f.tipo_persona === "empresa" && <Campo etiqueta="Giro (cuando corresponda)" ancho="completo"><Entrada value={f.giro} onChange={set("giro")} maxLength={300} /></Campo>}
      </Rejilla>
      <Subtitulo>Contacto</Subtitulo>
      <Rejilla>
        <Campo etiqueta="Persona de contacto"><Entrada data-campo-contacto value={f.contacto_nombre} onChange={set("contacto_nombre")} maxLength={150} /></Campo>
        <Campo etiqueta="Correo"><Entrada data-campo-correo type="email" value={f.contacto_correo} onChange={set("contacto_correo")} maxLength={200} /></Campo>
        <Campo etiqueta="Teléfono"><Entrada value={f.contacto_telefono} onChange={set("contacto_telefono")} maxLength={40} /></Campo>
      </Rejilla>
      <Subtitulo>Direcciones</Subtitulo>
      <Rejilla>
        <Campo etiqueta="Dirección de facturación"><Entrada value={f.direccion} onChange={set("direccion")} maxLength={300} /></Campo>
        <Campo etiqueta="Comuna (facturación)"><Entrada value={f.comuna} onChange={set("comuna")} maxLength={100} /></Campo>
        <Campo etiqueta="Dirección de entrega"><Entrada data-campo-entrega value={f.direccion_entrega} onChange={set("direccion_entrega")} maxLength={300} /></Campo>
        <Campo etiqueta="Comuna (entrega)"><Entrada value={f.comuna_entrega} onChange={set("comuna_entrega")} maxLength={100} /></Campo>
      </Rejilla>
      <Subtitulo>Condiciones comerciales</Subtitulo>
      <Rejilla>
        <Campo etiqueta="Condiciones de pago"><Entrada data-campo-condiciones value={f.condiciones_pago} onChange={set("condiciones_pago")} maxLength={500} placeholder="Ej.: 30 días fecha factura" /></Campo>
        <Campo etiqueta="Plazo de pago (días)" ayuda="Se usa para calcular el vencimiento de las facturas."><Entrada inputMode="numeric" value={f.plazo_pago_dias} onChange={set("plazo_pago_dias")} /></Campo>
      </Rejilla>
      <Campo etiqueta="Observaciones"><Area value={f.notas} onChange={set("notas")} maxLength={2000} /></Campo>
    </Ventana>
  );
}

export { Badge };
