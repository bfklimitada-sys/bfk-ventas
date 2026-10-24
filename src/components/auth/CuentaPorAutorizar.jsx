import { useState } from "react";
import { MarcoAuth } from "./LoginScreen";
import { C, btnP } from "../../lib/theme";

// Seguridad 23/10/2026: pantalla única para una cuenta con sesión pero SIN perfil BFK.
// No carga ni muestra ningún dato de BFK: solo el correo de la propia sesión. Cualquier dirección (#/compras,
// #/finanzas, #/administracion…) lleva aquí mientras la cuenta no tenga perfil, porque la aplicación no se monta.
// estado: "sin_perfil" (por autorizar) · "aislada" (cuenta técnica, nunca recibe perfil) · "error" (no se pudo comprobar).
export function CuentaPorAutorizar({ estado, correo, mensaje, onReintentar, onSalir }) {
  const [comprobando,setComprobando]=useState(false);
  const comprobar=async()=>{ setComprobando(true); try{ await onReintentar(); } finally{ setComprobando(false); } };
  const titulo = estado==="error" ? "No se pudo comprobar el acceso" : estado==="aislada" ? "Cuenta sin acceso a BFK" : "Cuenta por autorizar";
  return (
    <MarcoAuth>
      <div data-cuenta-por-autorizar={estado} role="status" aria-live="polite">
        <div style={{fontWeight:800,fontSize:17,color:C.ink,marginBottom:10,textAlign:"center"}}>{titulo}</div>
        {correo&&<div style={{fontSize:13,color:C.inkMuted,textAlign:"center",marginBottom:14,wordBreak:"break-all"}} data-correo-sesion>{correo}</div>}
        {estado==="sin_perfil"&&(
          <div style={{background:C.warnLight,color:C.ink,borderRadius:10,padding:"12px 14px",fontSize:13,lineHeight:1.5,marginBottom:16}}>
            Tu cuenta existe, pero todavía no está autorizada en BFK. Un administrador debe habilitarla desde
            <b> Administración → Usuarios</b>. Mientras tanto no tienes acceso a la información de la empresa.
          </div>
        )}
        {estado==="aislada"&&(
          <div style={{background:C.paper,color:C.ink,borderRadius:10,padding:"12px 14px",fontSize:13,lineHeight:1.5,marginBottom:16}}>
            Esta es una cuenta de uso técnico (aislada). No puede recibir acceso a la información de BFK.
          </div>
        )}
        {estado==="error"&&(
          <div style={{background:C.dangerLight,color:C.dangerText,borderRadius:10,padding:"12px 14px",fontSize:13,lineHeight:1.5,marginBottom:16,fontWeight:600}}>
            {mensaje||"No se pudo comprobar el acceso."} Por seguridad no se muestra la información hasta confirmarlo.
          </div>
        )}
        {estado!=="aislada"&&(
          <button data-comprobar-acceso onClick={comprobar} disabled={comprobando} style={{...btnP(comprobando?C.inkFaint:C.night),marginBottom:10}}>
            {comprobando?"Comprobando…":estado==="error"?"Reintentar":"Volver a comprobar"}
          </button>
        )}
        <button data-cerrar-sesion onClick={onSalir} style={{width:"100%",background:"none",border:`1px solid ${C.border}`,borderRadius:12,padding:"12px",minHeight:44,fontSize:14,fontWeight:700,color:C.ink,cursor:"pointer"}}>
          Cerrar sesión
        </button>
      </div>
    </MarcoAuth>
  );
}
