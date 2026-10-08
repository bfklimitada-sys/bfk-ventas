import { useEffect, useRef, useState } from "react";
import { Field } from "../ui/Basicos";
import { MarcoAuth, TEXTO_CORREO_ENVIADO } from "./LoginScreen";
import { supaGetUser, supaRefresh, supaResetPassword, supaSignOutGlobal, supaUpdatePassword, supaVerifyRecoveryHash } from "../../lib/supabase";
import { CONTRASENA_MIN, correoValido, mensajeEnlaceInvalido, validarNuevaContrasena } from "../../lib/recuperacion";
import { C, btnP, iStyle } from "../../lib/theme";

const MSG_EXPIRADA = "La sesión de recuperación expiró. Solicita un nuevo correo de recuperación.";

// Pantalla que se abre desde el enlace del correo de recuperación.
// La sesión de recuperación vive solo en memoria: no se guarda ni se usa para entrar a la app.
export function RestablecerContrasena({ retorno, onSalir }) {
  const [fase,setFase]=useState("validando"); // validando | formulario | invalido | listo
  const [motivo,setMotivo]=useState("");
  const [email,setEmail]=useState("");
  const [pass,setPass]=useState(""); const [pass2,setPass2]=useState(""); const [ver,setVer]=useState(false);
  const [err,setErr]=useState(""); const [info,setInfo]=useState(""); const [ocupado,setOcupado]=useState(false);
  const sesion=useRef(null); const usuarioId=useRef(null); const iniciado=useRef(false);

  const invalido=(m)=>{ sesion.current=null; setMotivo(m); setFase("invalido"); };

  useEffect(()=>{
    if(iniciado.current) return; iniciado.current=true; // el token es de un solo uso: no validar dos veces
    (async()=>{
      try{
        if(retorno.tipo==="error") return invalido(mensajeEnlaceInvalido(retorno.codigo));
        let s=retorno.tipo==="token_hash"?await supaVerifyRecoveryHash(retorno.token_hash):{...retorno};
        let u;
        try{ u=await supaGetUser(s.access_token); }
        catch(e){
          if(!s.refresh_token||!(e.status===401||e.status===403)) throw e;
          s={...s,...await supaRefresh(s.refresh_token).catch(()=>{ throw Object.assign(new Error(MSG_EXPIRADA),{status:401}); })}; u=await supaGetUser(s.access_token);
        }
        sesion.current=s; usuarioId.current=u.id||null; setEmail(u.email||""); setFase("formulario");
      }catch(e){ invalido(e?.status>=500||e?.name==="TypeError"?"No se pudo validar el enlace (sin conexión con el servidor). Revisa tu conexión y abre el enlace nuevamente.":(e.message||MSG_EXPIRADA)); }
    })();
  },[]);

  const guardar=async()=>{
    if(ocupado) return;
    setErr("");
    const v=validarNuevaContrasena(pass,pass2,email); if(v){ setErr(v); return; }
    setOcupado(true);
    try{
      let s=sesion.current; if(!s) throw Object.assign(new Error(MSG_EXPIRADA),{status:401});
      try{ await supaUpdatePassword(s.access_token,pass); }
      catch(e){
        if(!(e.status===401||e.status===403)||!s.refresh_token) throw e;
        s={...s,...await supaRefresh(s.refresh_token).catch(()=>{ throw Object.assign(new Error(MSG_EXPIRADA),{status:401}); })};
        sesion.current=s; await supaUpdatePassword(s.access_token,pass);
      }
      // Contraseña cambiada: se cierran todas las sesiones de esta cuenta (incluida la de recuperación).
      await supaSignOutGlobal(s.access_token);
      sesion.current=null; setPass(""); setPass2(""); setFase("listo");
    }catch(e){
      if(e.status===401||e.status===403) invalido(e.message||MSG_EXPIRADA);
      else setErr(e?.name==="TypeError"?"Sin conexión con el servidor. Intenta nuevamente.":e.message);
    }finally{ setOcupado(false); }
  };

  const pedirOtro=async()=>{
    if(ocupado) return;
    setErr(""); setInfo("");
    if(!correoValido(email)){ setErr("Indica un correo válido"); return; }
    setOcupado(true);
    try{ await supaResetPassword(email.trim()); setInfo(TEXTO_CORREO_ENVIADO); }
    catch(e){ setErr(e?.name==="TypeError"?"Sin conexión con el servidor. Intenta nuevamente.":e.message); }
    finally{ setOcupado(false); }
  };

  const volver=(aviso="")=>onSalir({ email, aviso, usuarioId:usuarioId.current, cambiada:fase==="listo" });
  const enlace={background:"none",border:"none",color:C.tealDark,fontSize:12,fontWeight:700,cursor:"pointer"};
  const caja=(bg,color)=>({background:bg,color,borderRadius:9,padding:"9px 12px",fontSize:12.5,marginBottom:14,textAlign:"center",fontWeight:600});
  const enter=(fn)=>(e)=>{ if(e.key==="Enter") fn(); };

  return (
    <MarcoAuth>
      <div style={{fontWeight:800,fontSize:15,color:C.ink,marginBottom:16,textAlign:"center"}}>
        {fase==="listo"?"Contraseña actualizada":fase==="invalido"?"Enlace no válido":"Nueva contraseña"}
      </div>
      {err&&<div role="alert" style={caja(C.dangerLight,C.dangerText)}>{err}</div>}
      {info&&<div role="status" style={caja(C.okLight,C.okText)}>{info}</div>}

      {fase==="validando"&&<div style={{textAlign:"center",color:C.inkMuted,fontSize:13,padding:"10px 0"}}>Validando el enlace…</div>}

      {fase==="formulario"&&<>
        <div style={{fontSize:12.5,color:C.inkMuted,marginBottom:14,textAlign:"center"}}>Cuenta: <b style={{color:C.ink}}>{email}</b></div>
        <Field label="Nueva contraseña" hint={`Mínimo ${CONTRASENA_MIN} caracteres, con letras y números.`}>
          <input style={iStyle} type={ver?"text":"password"} autoComplete="new-password" value={pass} onChange={e=>{setPass(e.target.value);setErr("");}} placeholder="Nueva contraseña" onKeyDown={enter(guardar)} />
        </Field>
        <Field label="Repetir contraseña">
          <input style={iStyle} type={ver?"text":"password"} autoComplete="new-password" value={pass2} onChange={e=>{setPass2(e.target.value);setErr("");}} placeholder="Repite la contraseña" onKeyDown={enter(guardar)} />
        </Field>
        <label style={{display:"flex",alignItems:"center",gap:8,fontSize:12.5,color:C.inkMuted,marginBottom:14,cursor:"pointer"}}>
          <input type="checkbox" checked={ver} onChange={e=>setVer(e.target.checked)} /> Mostrar contraseñas
        </label>
        <button onClick={guardar} disabled={ocupado} style={btnP(ocupado?C.inkFaint:C.night)}>{ocupado?"Guardando…":"Guardar nueva contraseña"}</button>
        <div style={{textAlign:"center",marginTop:14}}><button onClick={()=>volver()} style={enlace}>Cancelar y volver a iniciar sesión</button></div>
      </>}

      {fase==="invalido"&&<>
        <div style={caja(C.warnLight,C.warnText)}>{motivo}</div>
        <Field label="Correo">
          <input style={iStyle} type="email" value={email} onChange={e=>{setEmail(e.target.value);setErr("");}} placeholder="correo@ejemplo.com" onKeyDown={enter(pedirOtro)} />
        </Field>
        <button onClick={pedirOtro} disabled={ocupado} style={btnP(ocupado?C.inkFaint:C.night)}>{ocupado?"Procesando…":"Enviar nuevo correo de recuperación"}</button>
        <div style={{textAlign:"center",marginTop:14}}><button onClick={()=>volver()} style={enlace}>← Volver a iniciar sesión</button></div>
      </>}

      {fase==="listo"&&<>
        <div style={caja(C.okLight,C.okText)}>Tu contraseña se cambió correctamente. Por seguridad se cerraron las sesiones abiertas de esta cuenta.</div>
        <button onClick={()=>volver("Contraseña actualizada. Inicia sesión con tu nueva contraseña.")} style={btnP(C.night)}>Ir a iniciar sesión</button>
      </>}
    </MarcoAuth>
  );
}
