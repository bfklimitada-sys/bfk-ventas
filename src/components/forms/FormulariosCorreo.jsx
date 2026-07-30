import { useState } from "react";
import { Field } from "../ui/Basicos";
import { del } from "../../lib/supabase";
import { C, btnP, fmt, iStyle } from "../../lib/theme";

export function FormEntregaFallida({ oc, onEnviar, entidadesCatalogo }) {
  const matchCatalogo=(entidadesCatalogo||[]).find(e=>e.rut===(oc.rut_cliente||"").trim());
  const [lugar,setLugar]=useState("bodega");
  const [motivo,setMotivo]=useState("usted no estaba en el lugar");
  const [correo,setCorreo]=useState(oc.correo_cliente||matchCatalogo?.correo||"");
  const [err,setErr]=useState(""); const [sending,setSending]=useState(false);

  const asunto=`Entrega OC ${oc.numero_oc}`;
  const cuerpo=`Estimado/a,\n\nJunto con saludar le comento que hoy durante la mañana nos acercamos a ${lugar} para hacer la entrega de los productos asociados a la OC del asunto, siendo esta entrega fallida debido a que ${motivo}.\n\nPor favor avisar a personal de bodega que realizaremos un nuevo intento de entrega entre hoy y el resto de la semana en curso.\n\nAgradezco su ayuda con esa gestión.\n\nSin más que agregar, saludos cordiales,\nBFK Ltda`;

  const handleEnviar=async()=>{
    if(!correo.trim()){setErr("Indica el correo del destinatario");return;}
    setErr(""); setSending(true);
    const url=`mailto:${encodeURIComponent(correo)}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`;
    window.location.href=url;
    await onEnviar({correo,ocId:oc.id});
    setSending(false);
  };

  return (
    <div>
      <div style={{background:C.warnLight,borderRadius:9,padding:"10px 12px",fontSize:12.5,color:C.warn,fontWeight:700,marginBottom:14}}>OC {oc.numero_oc} · Correo de entrega fallida</div>
      <Field label="Correo del destinatario" required hint={oc.correo_cliente?"Correo guardado en esta OC":matchCatalogo?"Autocompletado desde el catálogo de entidades":""}><input style={iStyle} type="email" value={correo} onChange={e=>setCorreo(e.target.value)} placeholder="contacto@entidad.cl" /></Field>
      <Field label="Lugar de entrega" required hint="ej: bodega de farmacología, bodega central"><input style={iStyle} value={lugar} onChange={e=>setLugar(e.target.value)} /></Field>
      <Field label="Motivo de la entrega fallida" required hint="ej: usted no estaba en el lugar, bodega estaba cerrada"><input style={iStyle} value={motivo} onChange={e=>setMotivo(e.target.value)} /></Field>
      <div style={{background:C.paper,borderRadius:9,padding:"10px 12px",marginBottom:14}}>
        <div style={{fontSize:10.5,fontWeight:700,color:C.inkMuted,textTransform:"uppercase",marginBottom:4}}>Asunto</div>
        <div style={{fontSize:12.5,color:C.ink,marginBottom:8}}>{asunto}</div>
        <div style={{fontSize:10.5,fontWeight:700,color:C.inkMuted,textTransform:"uppercase",marginBottom:4}}>Vista previa</div>
        <div style={{fontSize:11.5,color:C.ink,whiteSpace:"pre-wrap"}}>{cuerpo}</div>
      </div>
      {err&&<div style={{background:C.dangerLight,color:C.danger,borderRadius:8,padding:"8px 12px",fontSize:12.5,marginBottom:10,fontWeight:600}}>{err}</div>}
      <button onClick={handleEnviar} disabled={sending} style={btnP(sending?C.inkFaint:C.warn)}>{sending?"Abriendo correo…":"📧 Enviar aviso de entrega fallida"}</button>
    </div>
  );
}

export function FormFechaEntrega({ oc, onEnviar, entidadesCatalogo }) {
  const matchCatalogo=(entidadesCatalogo||[]).find(e=>e.rut===(oc.rut_cliente||"").trim());
  const evC=(oc.eventos_compra||[])[0];
  const fechaEstimadaDefault=evC?.fecha_entrega_estimada||"";
  const [fechaEntrega,setFechaEntrega]=useState(fechaEstimadaDefault);
  const [correo,setCorreo]=useState(oc.correo_cliente||matchCatalogo?.correo||"");
  const [err,setErr]=useState(""); const [sending,setSending]=useState(false);

  const asunto=`Fecha de entrega OC ${oc.numero_oc}`;
  const fechaFmt=fechaEntrega?fmt.dateLong(fechaEntrega):"[fecha a definir]";
  const cuerpo=`Estimado/a,\n\nJunto con saludar le informamos que la entrega de los productos asociados a la OC del asunto está programada para el día ${fechaFmt}.\n\nQuedamos atentos ante cualquier consulta.\n\nSaludos cordiales,\nBFK Ltda`;

  const handleEnviar=async()=>{
    if(!correo.trim()){setErr("Indica el correo del destinatario");return;}
    if(!fechaEntrega){setErr("Indica la fecha estimada de entrega");return;}
    setErr(""); setSending(true);
    const url=`mailto:${encodeURIComponent(correo)}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`;
    window.location.href=url;
    await onEnviar({correo,ocId:oc.id});
    setSending(false);
  };

  return (
    <div>
      <div style={{background:C.transitLight,borderRadius:9,padding:"10px 12px",fontSize:12.5,color:C.transit,fontWeight:700,marginBottom:14}}>OC {oc.numero_oc} · Correo de fecha de entrega</div>
      <Field label="Correo del destinatario" required hint={oc.correo_cliente?"Correo guardado en esta OC":matchCatalogo?"Autocompletado desde el catálogo de entidades":""}><input style={iStyle} type="email" value={correo} onChange={e=>setCorreo(e.target.value)} placeholder="contacto@entidad.cl" /></Field>
      <Field label="Fecha estimada de entrega" required hint={fechaEstimadaDefault?"Autocompletado con la fecha estimada registrada":""}><input style={iStyle} type="date" value={fechaEntrega} onChange={e=>setFechaEntrega(e.target.value)} /></Field>
      <div style={{background:C.paper,borderRadius:9,padding:"10px 12px",marginBottom:14}}>
        <div style={{fontSize:10.5,fontWeight:700,color:C.inkMuted,textTransform:"uppercase",marginBottom:4}}>Asunto</div>
        <div style={{fontSize:12.5,color:C.ink,marginBottom:8}}>{asunto}</div>
        <div style={{fontSize:10.5,fontWeight:700,color:C.inkMuted,textTransform:"uppercase",marginBottom:4}}>Vista previa</div>
        <div style={{fontSize:11.5,color:C.ink,whiteSpace:"pre-wrap"}}>{cuerpo}</div>
      </div>
      {err&&<div style={{background:C.dangerLight,color:C.danger,borderRadius:8,padding:"8px 12px",fontSize:12.5,marginBottom:10,fontWeight:600}}>{err}</div>}
      <button onClick={handleEnviar} disabled={sending} style={btnP(sending?C.inkFaint:C.transit)}>{sending?"Abriendo correo…":"📅 Enviar fecha estimada de entrega"}</button>
    </div>
  );
}

export function FormReclamarFactura({ oc, evF, dias, contactos, onEnviar, onGuardarContacto }) {
  const contactoExistente = contactos.find(c => c.rut === (oc.rut_cliente || "").trim());
  const [rut, setRut] = useState(oc.rut_cliente || "");
  const [nombreCliente, setNombreCliente] = useState(oc.cliente || contactoExistente?.nombre_cliente || "");
  const [correo, setCorreo] = useState(oc.correo_cliente || contactoExistente?.correo || "");
  const [err, setErr] = useState(""); const [sending, setSending] = useState(false);

  const asunto = `OC ${oc.numero_oc} — Solicitud de pago factura N°${evF?.numero_factura || ""}`;
  const cuerpo = `Estimados,\n\nEsperamos se encuentren bien. Por medio del presente correo solicitamos la gestión de pago de la factura N°${evF?.numero_factura || ""} asociada a la Orden de Compra ${oc.numero_oc}, emitida con fecha ${fmt.date(evF?.fecha)}, la cual registra ${dias} días desde su emisión.\n\nQuedamos atentos a su pronta respuesta.\n\nDatos para transferencia:\nBanco Estado\nBFK Ltda.\nRUT: 77.322.317-3\nChequera Electrónica: 54970259913\n\nSaludos cordiales,\nBFK Ltda`;

  const handleEnviar = async () => {
    if (!correo.trim()) { setErr("Indica el correo del cliente"); return; }
    if (!nombreCliente.trim()) { setErr("Indica el nombre del cliente"); return; }
    setErr(""); setSending(true);
    try {
      if (rut.trim() && !contactoExistente) await onGuardarContacto({ rut: rut.trim(), nombreCliente: nombreCliente.trim(), correo: correo.trim() });
      await onEnviar({ correo: correo.trim(), asunto, cuerpo, ocId: oc.id, rut: rut.trim() });
    } catch (e) { setErr(e.message); } finally { setSending(false); }
  };

  return (
    <div>
      <div style={{background:C.dangerLight,borderRadius:9,padding:"10px 12px",fontSize:12.5,color:C.danger,fontWeight:700,marginBottom:14}}>
        Factura {evF?.numero_factura} · {dias} días desde emisión
      </div>
      {oc.ultimo_reclamo_fecha&&<div style={{background:C.warnLight,borderRadius:9,padding:"8px 12px",fontSize:11.5,color:C.warn,fontWeight:600,marginBottom:14}}>Ya se reclamó esta factura el {fmt.datetime(oc.ultimo_reclamo_fecha)}</div>}
      <Field label="RUT del cliente" hint="Para guardar el correo y reutilizarlo después"><input style={iStyle} value={rut} onChange={e=>setRut(e.target.value)} placeholder="ej: 12.345.678-9" /></Field>
      <Field label="Nombre del cliente" required><input style={iStyle} value={nombreCliente} onChange={e=>setNombreCliente(e.target.value)} /></Field>
      <Field label="Correo del cliente" required hint={oc.correo_cliente?"Correo ya guardado en esta OC":contactoExistente?"Correo guardado encontrado para este RUT":"Se guardará para futuras facturas"}><input style={iStyle} type="email" value={correo} onChange={e=>setCorreo(e.target.value)} placeholder="contacto@entidad.cl" /></Field>
      <div style={{background:C.paper,borderRadius:9,padding:"10px 12px",marginBottom:14}}>
        <div style={{fontSize:10.5,fontWeight:700,color:C.inkMuted,textTransform:"uppercase",marginBottom:4}}>Asunto</div>
        <div style={{fontSize:12.5,color:C.ink,marginBottom:8}}>{asunto}</div>
        <div style={{fontSize:10.5,fontWeight:700,color:C.inkMuted,textTransform:"uppercase",marginBottom:4}}>Mensaje</div>
        <div style={{fontSize:12,color:C.ink,whiteSpace:"pre-wrap"}}>{cuerpo}</div>
      </div>
      {err&&<div style={{background:C.dangerLight,color:C.danger,borderRadius:8,padding:"8px 12px",fontSize:12.5,marginBottom:10,fontWeight:600}}>{err}</div>}
      <button onClick={handleEnviar} disabled={sending} style={btnP(sending?C.inkFaint:C.danger)}>{sending?"Enviando…":"✓ Enviar reclamo de pago"}</button>
    </div>
  );
}
