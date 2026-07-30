import { useState } from "react";
import { Field } from "../ui/Basicos";
import { supaResetPassword, supaSignIn, supaSignUp } from "../../lib/supabase";
import { C, MONO, SANS, btnP, iStyle } from "../../lib/theme";

export function LoginScreen({ onLogin }) {
  const [mode,setMode]=useState("login");
  const [email,setEmail]=useState(""); const [pass,setPass]=useState(""); const [nombre,setNombre]=useState("");
  const [err,setErr]=useState(""); const [info,setInfo]=useState(""); const [loading,setLoading]=useState(false);
  const submit = async () => {
    setErr(""); setInfo(""); setLoading(true);
    try {
      if(mode==="login"){
        if(!email.trim()||!pass){setErr("Completa correo y contraseña");return;}
        const s=await supaSignIn(email.trim(),pass); await onLogin(s);
      } else if(mode==="signup") {
        if(!nombre.trim()||!email.trim()||!pass){setErr("Completa todos los campos");return;}
        if(pass.length<6){setErr("Contraseña mínimo 6 caracteres");return;}
        const d=await supaSignUp(email.trim(),pass,nombre.trim());
        if(d.access_token) await onLogin(d);
        else { setInfo("Cuenta creada. Confirma tu correo, luego inicia sesión."); setMode("login"); }
      } else if(mode==="recover") {
        if(!email.trim()){setErr("Indica tu correo");return;}
        await supaResetPassword(email.trim());
        setInfo("Te enviamos un correo con instrucciones para recuperar tu contraseña.");
      }
    } catch(e){setErr(e.message);}
    finally{setLoading(false);}
  };
  return (
    <div style={{minHeight:"100vh",background:`linear-gradient(165deg,${C.night} 0%,#1A2540 60%,${C.tealDark} 130%)`,display:"flex",alignItems:"center",justifyContent:"center",padding:16,fontFamily:SANS}}>
      <div style={{background:C.card,borderRadius:20,padding:"38px 30px",width:"100%",maxWidth:380,boxShadow:"0 30px 70px rgba(0,0,0,0.35)"}}>
        <div style={{textAlign:"center",marginBottom:26}}>
          <div style={{width:50,height:50,background:C.night,borderRadius:12,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 14px",fontFamily:MONO,color:C.teal,fontWeight:800,fontSize:18}}>BFK</div>
          <div style={{fontWeight:800,fontSize:19,color:C.ink,letterSpacing:-0.3}}>Torre de Control</div>
          <div style={{fontSize:12.5,color:C.inkMuted,marginTop:3}}>BFK Ltda · Ventas Mercado Público</div>
        </div>
        {mode!=="recover"&&(
          <div style={{display:"flex",borderRadius:10,background:C.paper,padding:3,marginBottom:22}}>
            {["login","signup"].map(m=>(
              <button key={m} onClick={()=>{setMode(m);setErr("");setInfo("");}} style={{flex:1,padding:"8px",borderRadius:8,border:"none",cursor:"pointer",fontSize:13,fontWeight:700,background:mode===m?C.card:"transparent",color:mode===m?C.ink:C.inkMuted,boxShadow:mode===m?"0 1px 4px rgba(0,0,0,0.08)":"none"}}>
                {m==="login"?"Iniciar sesión":"Crear cuenta"}
              </button>
            ))}
          </div>
        )}
        {mode==="recover"&&<div style={{fontWeight:800,fontSize:15,color:C.ink,marginBottom:16,textAlign:"center"}}>Recuperar contraseña</div>}
        {err&&<div style={{background:C.dangerLight,color:C.danger,borderRadius:9,padding:"9px 12px",fontSize:12.5,marginBottom:14,textAlign:"center",fontWeight:600}}>{err}</div>}
        {info&&<div style={{background:C.okLight,color:C.ok,borderRadius:9,padding:"9px 12px",fontSize:12.5,marginBottom:14,textAlign:"center",fontWeight:600}}>{info}</div>}
        {mode==="signup"&&<Field label="Nombre"><input style={iStyle} value={nombre} onChange={e=>setNombre(e.target.value)} placeholder="Tu nombre" onKeyDown={e=>e.key==="Enter"&&submit()} /></Field>}
        <Field label="Correo"><input style={iStyle} type="email" value={email} onChange={e=>{setEmail(e.target.value);setErr("");}} placeholder="correo@ejemplo.com" onKeyDown={e=>e.key==="Enter"&&submit()} /></Field>
        {mode!=="recover"&&<Field label="Contraseña"><input style={iStyle} type="password" value={pass} onChange={e=>{setPass(e.target.value);setErr("");}} placeholder="••••••••" onKeyDown={e=>e.key==="Enter"&&submit()} /></Field>}
        <button onClick={submit} disabled={loading} style={btnP(loading?C.inkFaint:C.night)}>{loading?"Procesando…":mode==="login"?"Ingresar":mode==="signup"?"Crear cuenta":"Enviar correo de recuperación"}</button>
        {mode==="login"&&<div style={{textAlign:"center",marginTop:14}}><button onClick={()=>{setMode("recover");setErr("");setInfo("");}} style={{background:"none",border:"none",color:C.teal,fontSize:12,fontWeight:700,cursor:"pointer"}}>¿Olvidaste tu contraseña?</button></div>}
        {mode==="recover"&&<div style={{textAlign:"center",marginTop:14}}><button onClick={()=>{setMode("login");setErr("");setInfo("");}} style={{background:"none",border:"none",color:C.teal,fontSize:12,fontWeight:700,cursor:"pointer"}}>← Volver a iniciar sesión</button></div>}
        <div style={{textAlign:"center",fontSize:11,color:C.inkFaint,marginTop:16}}>{mode==="login"?'¿Sin cuenta? Usa "Crear cuenta"':mode==="signup"?"El primer usuario será administrador.":""}</div>
      </div>
    </div>
  );
}
