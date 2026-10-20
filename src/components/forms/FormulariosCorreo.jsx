import { useRef, useState } from "react";
import { Field } from "../ui/Basicos";
import { del } from "../../lib/supabase";
import { C, btnP, fmt, iStyle } from "../../lib/theme";
import { I } from "../ui/Iconos";
import { abrirCorreo, abrirGmail, abrirMailto, copiarTexto, esTelefono, CUENTA_REMITENTE } from "../../lib/correos";
import { entidadPorRut, filtrarPorRut } from "../../lib/rut";
import { correoSugerido, textoSugerencia } from "../../lib/contactosInstitucionales";
import { ElegirContacto, useContactos } from "../ficha/ContactosInstitucion";

// ── Preparar y confirmar un correo (14/10/2026) ──
// 1) «Abrir en Gmail» (PC) / «Abrir en la app de correo» (teléfono): deja el mensaje listo, SIN enviarlo ni registrarlo.
// 2) Quedan visibles botones para copiar destinatario, CC, asunto y mensaje (por si Gmail no abre).
// 3) Solo «Ya lo envié» registra el envío, una sola vez («Envío confirmado por el usuario»).
// validar(): devuelve un texto de error o "" · datos: { correo, cc, asunto, cuerpo } · onConfirmar: registra el envío.
export function PreparadorCorreo({ datos, validar, onConfirmar, textoBoton, color = C.teal }) {
  const [fase, setFase] = useState("editar");     // editar → preparado → confirmado
  const [err, setErr] = useState(""); const [aviso, setAviso] = useState(""); const [copiado, setCopiado] = useState("");
  const [confirmando, setConfirmando] = useState(false); const confirmado = useRef(false);
  const telefono = esTelefono();
  const preparar = (medio) => {
    const e = validar?.() || ""; if (e) { setErr(e); return; }
    setErr(""); setCopiado("");
    // Se abre en el MISMO clic (sin esperas): así el navegador no bloquea la pestaña de Gmail.
    const r = medio === "gmail" ? { medio, abierto: abrirGmail(datos) } : medio === "app" ? { medio, abierto: abrirMailto(datos) } : abrirCorreo(datos);
    setAviso(r.abierto ? "" : r.medio === "gmail" ? "El navegador bloqueó la pestaña de Gmail. Permite ventanas emergentes para BFK o usa los botones de copiar." : "No se pudo abrir la app de correo. Usa los botones de copiar.");
    setFase((f) => (f === "confirmado" ? f : "preparado"));
  };
  const copiar = async (k, t) => { setCopiado((await copiarTexto(t)) ? k : "error"); };
  const confirmar = async () => {
    if (confirmado.current) return;   // evita registros duplicados por toques repetidos
    confirmado.current = true; setConfirmando(true); setErr("");
    try { await onConfirmar(); setFase("confirmado"); }
    catch (e) { confirmado.current = false; setErr(e.message || "No se pudo registrar el envío."); }
    finally { setConfirmando(false); }
  };
  const boton = (extra = {}) => ({ border: `1px solid ${C.border}`, background: C.card, color: C.ink, borderRadius: 8, padding: "8px 10px", fontSize: 13, fontWeight: 700, cursor: "pointer", minHeight: 40, ...extra });
  const todo = `Para: ${datos.correo}${datos.cc ? `\nCC: ${datos.cc}` : ""}\nAsunto: ${datos.asunto}\n\n${datos.cuerpo}`;
  return (
    <div data-preparador-correo={fase}>
      {err && <div style={{ background: C.dangerLight, color: C.dangerText, borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 10, fontWeight: 600 }}>{err}</div>}
      {fase === "editar" && <>
        <button data-abrir-correo onClick={() => preparar()} style={btnP(color)}>{telefono ? "📧 Abrir en la app de correo" : "📧 Abrir en Gmail"} · {textoBoton}</button>
        <div style={{ fontSize: 12, color: C.inkMuted, marginTop: 6, lineHeight: 1.45 }}>
          {telefono ? "Se abrirá la app de correo del teléfono con el mensaje listo." : <>Se abrirá Gmail en una pestaña nueva, con la cuenta <b>{CUENTA_REMITENTE}</b>. Si Google pide iniciar sesión, ingresa con esa cuenta.</>} Nada se envía automáticamente.
        </div>
      </>}
      {fase !== "editar" && (
        <div data-correo-estado={fase} style={{ background: fase === "confirmado" ? C.okLight : C.warnLight, borderRadius: 8, padding: "10px 12px", marginBottom: 10, fontSize: 13, color: fase === "confirmado" ? C.okText : C.warnText, lineHeight: 1.45 }}>
          {fase === "confirmado" ? <b>✓ Envío confirmado por el usuario</b> : <><b>Correo preparado — aún no registrado como enviado.</b> Revísalo y envíalo desde {telefono ? "tu app de correo" : <>Gmail ({CUENTA_REMITENTE})</>}; luego confirma aquí.</>}
        </div>
      )}
      {aviso && fase === "preparado" && <div data-correo-bloqueado style={{ background: C.dangerLight, color: C.dangerText, borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 10, fontWeight: 600 }}>{aviso}</div>}
      {fase === "preparado" && <>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.inkMuted, textTransform: "uppercase", margin: "4px 0 6px" }}>Si el correo no se abrió, copia los datos</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          <button data-copiar-correo="para" onClick={() => copiar("para", datos.correo)} style={boton()}>{copiado === "para" ? "✓ Copiado" : "Copiar destinatario"}</button>
          {datos.cc && <button data-copiar-correo="cc" onClick={() => copiar("cc", datos.cc)} style={boton()}>{copiado === "cc" ? "✓ Copiado" : "Copiar CC"}</button>}
          <button data-copiar-correo="asunto" onClick={() => copiar("asunto", datos.asunto)} style={boton()}>{copiado === "asunto" ? "✓ Copiado" : "Copiar asunto"}</button>
          <button data-copiar-correo="cuerpo" onClick={() => copiar("cuerpo", datos.cuerpo)} style={boton()}>{copiado === "cuerpo" ? "✓ Copiado" : "Copiar mensaje"}</button>
          <button data-copiar-correo="todo" onClick={() => copiar("todo", todo)} style={boton()}>{copiado === "todo" ? "✓ Copiado" : "Copiar todo"}</button>
        </div>
        {copiado === "error" && <div style={{ fontSize: 12, color: C.dangerText, marginBottom: 6 }}>No se pudo copiar en este navegador: selecciona el texto de la vista previa.</div>}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
          <button data-reabrir-gmail onClick={() => preparar("gmail")} style={boton({ color: C.tealDark })}>Abrir Gmail de nuevo</button>
          <button data-abrir-app-correo onClick={() => preparar("app")} style={boton({ color: C.tealDark })}>{telefono ? "Abrir app de correo de nuevo" : "Usar el programa de correo del equipo"}</button>
        </div>
        <button data-confirmar-envio onClick={confirmar} disabled={confirmando} style={btnP(confirmando ? C.inkFaint : color)}>{confirmando ? "Registrando…" : "✓ Ya envié el correo — registrar envío"}</button>
        <div style={{ fontSize: 12, color: C.inkMuted, marginTop: 6 }}>Registra el envío solo después de enviarlo. Si no lo enviaste, cierra esta ventana: no queda nada registrado.</div>
      </>}
    </div>
  );
}

export function FormEntregaFallida({ oc, onEnviar, entidadesCatalogo }) {
  const matchCatalogo=entidadPorRut(entidadesCatalogo,oc.rut_cliente).entidad;
  const [lugar,setLugar]=useState("bodega");
  const [motivo,setMotivo]=useState("usted no estaba en el lugar");
  const ctxCI=useContactos(); const sug=correoSugerido(ctxCI?.contactos,oc);
  const [correo,setCorreo]=useState(sug.correo||oc.correo_cliente||matchCatalogo?.correo||"");

  const asunto=`Entrega OC ${oc.numero_oc}`;
  const cuerpo=`Estimado/a,\n\nJunto con saludar le comento que hoy durante la mañana nos acercamos a ${lugar} para hacer la entrega de los productos asociados a la OC del asunto, siendo esta entrega fallida debido a que ${motivo}.\n\nPor favor avisar a personal de bodega que realizaremos un nuevo intento de entrega entre hoy y el resto de la semana en curso.\n\nAgradezco su ayuda con esa gestión.\n\nSin más que agregar, saludos cordiales,\nBFK Ltda`;

  const validar=()=>!correo.trim()?"Indica el correo del destinatario":"";
  const confirmar=()=>onEnviar({correo:correo.trim(),ocId:oc.id,tipo:"entrega fallida",detalle:`lugar: ${lugar} · motivo: ${motivo}`});

  return (
    <div>
      <div style={{background:C.warnLight,borderRadius:8,padding:"10px 12px",fontSize:13,color:C.warnText,fontWeight:700,marginBottom:14}}>OC {oc.numero_oc} · Correo de entrega fallida</div>
      <Field label="Correo del destinatario" required hint={sug.correo?textoSugerencia(sug):matchCatalogo?"Autocompletado desde el catálogo de entidades":""}><input style={iStyle} type="email" value={correo} onChange={e=>setCorreo(e.target.value)} placeholder="contacto@entidad.cl" /></Field>
      <ElegirContacto oc={oc} valor={correo} onElegir={c=>setCorreo(c.correo)} />
      <Field label="Lugar de entrega" required hint="ej: bodega de farmacología, bodega central"><input style={iStyle} value={lugar} onChange={e=>setLugar(e.target.value)} /></Field>
      <Field label="Motivo de la entrega fallida" required hint="ej: usted no estaba en el lugar, bodega estaba cerrada"><input style={iStyle} value={motivo} onChange={e=>setMotivo(e.target.value)} /></Field>
      <div style={{background:C.paper,borderRadius:8,padding:"10px 12px",marginBottom:14}}>
        <div style={{fontSize:12,fontWeight:700,color:C.inkMuted,textTransform:"uppercase",marginBottom:4}}>Asunto</div>
        <div style={{fontSize:13,color:C.ink,marginBottom:8}}>{asunto}</div>
        <div style={{fontSize:12,fontWeight:700,color:C.inkMuted,textTransform:"uppercase",marginBottom:4}}>Vista previa</div>
        <div style={{fontSize:12,color:C.ink,whiteSpace:"pre-wrap"}}>{cuerpo}</div>
      </div>
      <PreparadorCorreo datos={{correo:correo.trim(),asunto,cuerpo}} validar={validar} onConfirmar={confirmar} textoBoton="aviso de entrega fallida" color={C.warn} />
    </div>
  );
}

export function FormFechaEntrega({ oc, onEnviar, entidadesCatalogo }) {
  const matchCatalogo=entidadPorRut(entidadesCatalogo,oc.rut_cliente).entidad;
  const evC=(oc.eventos_compra||[])[0];
  const fechaEstimadaDefault=evC?.fecha_entrega_estimada||"";
  const [fechaEntrega,setFechaEntrega]=useState(fechaEstimadaDefault);
  const ctxCI=useContactos(); const sug=correoSugerido(ctxCI?.contactos,oc);
  const [correo,setCorreo]=useState(sug.correo||oc.correo_cliente||matchCatalogo?.correo||"");

  const asunto=`Fecha de entrega OC ${oc.numero_oc}`;
  const fechaFmt=fechaEntrega?fmt.dateLong(fechaEntrega):"[fecha a definir]";
  const cuerpo=`Estimado/a,\n\nJunto con saludar le informamos que la entrega de los productos asociados a la OC del asunto está programada para el día ${fechaFmt}.\n\nQuedamos atentos ante cualquier consulta.\n\nSaludos cordiales,\nBFK Ltda`;

  const validar=()=>!correo.trim()?"Indica el correo del destinatario":!fechaEntrega?"Indica la fecha estimada de entrega":"";
  const confirmar=()=>onEnviar({correo:correo.trim(),ocId:oc.id,tipo:"fecha de entrega",detalle:`entrega programada para el ${fmt.date(fechaEntrega)}`});

  return (
    <div>
      <div style={{background:C.transitLight,borderRadius:8,padding:"10px 12px",fontSize:13,color:C.transit,fontWeight:700,marginBottom:14}}>OC {oc.numero_oc} · Correo de fecha de entrega</div>
      <Field label="Correo del destinatario" required hint={sug.correo?textoSugerencia(sug):matchCatalogo?"Autocompletado desde el catálogo de entidades":""}><input style={iStyle} type="email" value={correo} onChange={e=>setCorreo(e.target.value)} placeholder="contacto@entidad.cl" /></Field>
      <ElegirContacto oc={oc} valor={correo} onElegir={c=>setCorreo(c.correo)} />
      <Field label="Fecha estimada de entrega" required hint={fechaEstimadaDefault?"Autocompletado con la fecha estimada registrada":""}><input style={iStyle} type="date" value={fechaEntrega} onChange={e=>setFechaEntrega(e.target.value)} /></Field>
      <div style={{background:C.paper,borderRadius:8,padding:"10px 12px",marginBottom:14}}>
        <div style={{fontSize:12,fontWeight:700,color:C.inkMuted,textTransform:"uppercase",marginBottom:4}}>Asunto</div>
        <div style={{fontSize:13,color:C.ink,marginBottom:8}}>{asunto}</div>
        <div style={{fontSize:12,fontWeight:700,color:C.inkMuted,textTransform:"uppercase",marginBottom:4}}>Vista previa</div>
        <div style={{fontSize:12,color:C.ink,whiteSpace:"pre-wrap"}}>{cuerpo}</div>
      </div>
      <PreparadorCorreo datos={{correo:correo.trim(),asunto,cuerpo}} validar={validar} onConfirmar={confirmar} textoBoton="fecha estimada de entrega" color={C.transit} />
    </div>
  );
}

export function FormReclamarFactura({ oc, evF, dias, contactos, onEnviar, onGuardarContacto }) {
  const contactoExistente = filtrarPorRut(contactos, oc.rut_cliente)[0];
  const [rut, setRut] = useState(oc.rut_cliente || "");
  const [nombreCliente, setNombreCliente] = useState(oc.cliente || contactoExistente?.nombre_cliente || "");
  const ctxCI = useContactos(); const sug = correoSugerido(ctxCI?.contactos, oc);
  const [correo, setCorreo] = useState(sug.correo || oc.correo_cliente || contactoExistente?.correo || "");
  const [cc, setCc] = useState("");

  const asunto = `OC ${oc.numero_oc} — Consulta por pago factura N°${evF?.numero_factura || ""}`;
  const cuerpo = `Estimados,\n\nEsperamos se encuentren bien. Les escribimos porque no hemos recibido el comprobante de pago de la factura N°${evF?.numero_factura || ""} asociada a la Orden de Compra ${oc.numero_oc}, emitida con fecha ${fmt.date(evF?.fecha)} (${dias} días desde su emisión), y en nuestros registros aún no aparece como pagada.\n\nAgradeceríamos nos puedan validar si ya fue cursado el pago — de ser así, si nos pueden compartir el comprobante correspondiente nos ayudaría mucho con nuestra conciliación. Si todavía está en trámite, nos sería muy útil contar con una fecha estimada para nuestro seguimiento interno.\n\nMuchas gracias de antemano por su ayuda.\n\nDatos para transferencia:\nBanco Estado\nBFK Ltda.\nRUT: 77.322.317-3\nChequera Electrónica: 54970259913\n\nSaludos cordiales,\nBFK Ltda`;

  const ccLimpio = cc.split(/[,;]/).map((x) => x.trim()).filter(Boolean).join(", ");
  const validar = () => !correo.trim() ? "Indica el correo del cliente" : !nombreCliente.trim() ? "Indica el nombre del cliente" : "";
  // Solo al confirmar el envío se guarda el contacto y se registra el reclamo (abrir Gmail no registra nada).
  const confirmar = async () => {
    if (rut.trim() && !contactoExistente) await onGuardarContacto({ rut: rut.trim(), nombreCliente: nombreCliente.trim(), correo: correo.trim() });
    await onEnviar({ correo: correo.trim(), cc: cc.trim(), asunto, cuerpo, ocId: oc.id, rut: rut.trim(), tipo: "reclamo de pago", detalle: `factura N°${evF?.numero_factura || ""}` });
  };

  return (
    <div>
      <div style={{background:C.dangerLight,borderRadius:8,padding:"10px 12px",fontSize:13,color:C.dangerText,fontWeight:700,marginBottom:14}}>
        Factura {evF?.numero_factura} · {dias} días desde emisión
      </div>
      {oc.ultimo_reclamo_fecha&&<div style={{background:C.warnLight,borderRadius:8,padding:"8px 12px",fontSize:12,color:C.warnText,fontWeight:600,marginBottom:14}}>Ya se reclamó esta factura el {fmt.datetime(oc.ultimo_reclamo_fecha)}</div>}
      <Field label="RUT del cliente" hint="Para guardar el correo y reutilizarlo después"><input style={iStyle} value={rut} onChange={e=>setRut(e.target.value)} placeholder="ej: 12.345.678-9" /></Field>
      <Field label="Nombre del cliente" required><input style={iStyle} value={nombreCliente} onChange={e=>setNombreCliente(e.target.value)} /></Field>
      <Field label="Correo del cliente" required hint={sug.correo?textoSugerencia(sug):contactoExistente?"Correo guardado encontrado para este RUT":"Se guardará para futuras facturas"}><input style={iStyle} type="email" value={correo} onChange={e=>setCorreo(e.target.value)} placeholder="contacto@entidad.cl" /></Field>
      <ElegirContacto oc={oc} valor={correo} onElegir={c=>setCorreo(c.correo)} />
      <Field label="Con copia (CC)" hint="Opcional — separa varios correos con coma"><input style={iStyle} value={cc} onChange={e=>setCc(e.target.value)} placeholder="jefatura@bfk.cl, contador@bfk.cl" /></Field>
      <div style={{background:C.paper,borderRadius:8,padding:"10px 12px",marginBottom:14}}>
        <div style={{fontSize:12,fontWeight:700,color:C.inkMuted,textTransform:"uppercase",marginBottom:4}}>Asunto</div>
        <div style={{fontSize:13,color:C.ink,marginBottom:8}}>{asunto}</div>
        <div style={{fontSize:12,fontWeight:700,color:C.inkMuted,textTransform:"uppercase",marginBottom:4}}>Mensaje</div>
        <div style={{fontSize:12,color:C.ink,whiteSpace:"pre-wrap"}}>{cuerpo}</div>
      </div>
      <PreparadorCorreo datos={{ correo: correo.trim(), cc: ccLimpio, asunto, cuerpo }} validar={validar} onConfirmar={confirmar} textoBoton="consulta de pago" color={C.danger} />
    </div>
  );
}
