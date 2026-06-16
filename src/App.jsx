import { useState, useEffect, useMemo, useRef } from "react";
import * as XLSX from "xlsx";

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

// ─── SUPABASE CONFIG ──────────────────────────────────────────────────────────
const SUPABASE_URL = "https://gypywxaugwuxbgmcqntp.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd5cHl3eGF1Z3d1eGJnbWNxbnRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2MjA4MjksImV4cCI6MjA5NzE5NjgyOX0.ujdKtdhFklJEPHy1vWlm8RLgPAQlo7sNNBGd_MbmibQ";

const SESSION_STORAGE_KEY = "bfk_supabase_session_v1";

// ─── SUPABASE AUTH HELPERS (vía REST, sin SDK) ───────────────────────────────
async function supaSignUp(email, password, nombre) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, password, data: { nombre } }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.msg || "Error al registrar");
  return data;
}

async function supaSignIn(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.msg || "Credenciales inválidas");
  return data; // { access_token, refresh_token, user, ... }
}

async function supaSignOut(accessToken) {
  try {
    await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method: "POST",
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken}` },
    });
  } catch {}
}

async function supaRefreshToken(refreshToken) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error("Sesión expirada");
  return data;
}

// ─── SUPABASE DATA HELPERS (REST / PostgREST) ────────────────────────────────
function supaHeaders(accessToken) {
  return {
    "Content-Type": "application/json",
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${accessToken}`,
    Prefer: "return=representation",
  };
}

async function supaSelect(table, accessToken, query = "") {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*${query}`, {
    headers: supaHeaders(accessToken),
  });
  if (!res.ok) throw new Error(`Error al leer ${table}`);
  return res.json();
}

async function supaInsert(table, accessToken, row) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: supaHeaders(accessToken),
    body: JSON.stringify(row),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message || `Error al insertar en ${table}`); }
  return res.json();
}

async function supaUpdate(table, accessToken, id, row) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: "PATCH",
    headers: supaHeaders(accessToken),
    body: JSON.stringify(row),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message || `Error al actualizar ${table}`); }
  return res.json();
}

async function supaDelete(table, accessToken, id) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: "DELETE",
    headers: supaHeaders(accessToken),
  });
  if (!res.ok) throw new Error(`Error al eliminar de ${table}`);
}

async function supaGetPerfil(accessToken, userId) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/perfiles?id=eq.${userId}&select=*`, {
    headers: supaHeaders(accessToken),
  });
  if (!res.ok) return null;
  const arr = await res.json();
  return arr[0] || null;
}

async function supaListPerfiles(accessToken) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/perfiles?select=*`, { headers: supaHeaders(accessToken) });
  if (!res.ok) return [];
  return res.json();
}

async function supaUpdatePerfilRol(accessToken, userId, rol) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/perfiles?id=eq.${userId}`, {
    method: "PATCH",
    headers: supaHeaders(accessToken),
    body: JSON.stringify({ rol }),
  });
  if (!res.ok) throw new Error("Error al actualizar rol");
  return res.json();
}

// ─── OC + ITEMS: lectura combinada vía resource embedding de PostgREST ──────
async function supaListOCConItems(accessToken) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/ordenes_compra?select=*,items_oc(*)&order=creadoEn.desc`, {
    headers: supaHeaders(accessToken),
  });
  if (!res.ok) throw new Error("Error al leer órdenes de compra");
  return res.json();
}

const COLORS = {
  green: "#1D9E75", greenLight: "#E8F7F2",
  amber: "#EF9F27", amberLight: "#FEF6E7",
  blue: "#3B82F6", blueLight: "#EFF6FF",
  gray: "#6B7280", grayLight: "#F3F4F6",
  red: "#EF4444", redLight: "#FEF2F2",
  purple: "#7C3AED", purpleLight: "#F5F3FF",
  dark: "#111827", border: "#E5E7EB",
  white: "#FFFFFF", bg: "#F9FAFB",
};

// ─── EXCEL COLUMN MAPPING ─────────────────────────────────────────────────────
const COL_MAP = {
  "cliente": "cliente", "nombre cliente": "cliente", "razón social": "cliente", "razon social": "cliente",
  "producto": "producto", "producto / servicio": "producto", "producto/servicio": "producto", "servicio": "producto", "descripción": "producto", "descripcion": "producto",
  "monto": "monto", "valor": "monto", "total": "monto", "precio": "monto",
  "proveedor": "proveedor", "comprado a": "proveedor",
  "costo compra": "costoCompra", "costo de compra": "costoCompra", "costo": "costoCompra",
  "fecha venta": "fechaVenta", "fecha de venta": "fechaVenta", "f. venta": "fechaVenta",
  "fecha entrega": "fechaEntrega", "fecha de entrega": "fechaEntrega", "f. entrega": "fechaEntrega",
  "estado": "estado", "estado entrega": "estado", "entrega": "estado",
  "factura": "factura", "emite factura": "factura", "factura cliente": "factura",
  "n° factura": "numFactura", "num factura": "numFactura", "numero factura": "numFactura", "número factura": "numFactura", "numfactura": "numFactura",
  "pago": "pago", "estado pago": "pago", "estado de pago": "pago",
  "fecha pago": "fechaPago", "fecha de pago": "fechaPago", "f. pago": "fechaPago",
  "nuestra factura": "facturaPropia", "factura propia": "facturaPropia", "nuestra factura emitida": "facturaPropia",
  "n° nuestra factura": "numFacturaPropia", "numero nuestra factura": "numFacturaPropia",
  "fecha nuestra factura": "fechaFacturaPropia",
  "notas": "notas", "observaciones": "notas", "nota": "notas",
};

function toISODate(val) {
  if (!val) return "";
  if (typeof val === "number") {
    const d = new Date(Math.round((val - 25569) * 86400 * 1000));
    return d.toISOString().split("T")[0];
  }
  const s = String(val).trim();
  if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}$/.test(s)) {
    const [dd, mm, yyyy] = s.split(/[\/\-]/);
    return `${yyyy}-${mm.padStart(2,"0")}-${dd.padStart(2,"0")}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
  return s;
}
function normalizeEstado(v) { const s = String(v||"").toLowerCase().trim(); if (["entregado","entregada","delivered"].includes(s)) return "entregado"; if (["cancelado","cancelada","cancelled","anulado"].includes(s)) return "cancelado"; return "pendiente"; }
function normalizeFactura(v) { const s = String(v||"").toLowerCase().trim(); return ["si","sí","yes","1","true","emitida","con factura"].includes(s) ? "si" : "no"; }
function normalizePago(v) { const s = String(v||"").toLowerCase().trim(); if (["pagado","pagada","paid"].includes(s)) return "pagado"; if (["parcial","partial","pago parcial"].includes(s)) return "parcial"; if (["n/a","na","no aplica"].includes(s)) return "n/a"; return "pendiente"; }

// Plazo de pago: 30 días corridos desde la emisión de NUESTRA factura
const PLAZO_PAGO_DIAS = 30;
function fechaVencimiento(fechaFacturaPropia) {
  if (!fechaFacturaPropia) return "";
  const d = new Date(fechaFacturaPropia + "T00:00:00");
  if (isNaN(d.getTime())) return "";
  d.setDate(d.getDate() + PLAZO_PAGO_DIAS);
  return d.toISOString().split("T")[0];
}
function diasParaVencer(fechaVenc) {
  if (!fechaVenc) return null;
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  const venc = new Date(fechaVenc + "T00:00:00");
  return Math.round((venc - hoy) / 86400000);
}

// ─── IMPORT EXCEL MODAL (ADMIN ONLY) ─────────────────────────────────────────
function ImportExcelModal({ onImport, onClose, existingCount }) {
  const [step, setStep] = useState("upload");
  const [rows, setRows] = useState([]);
  const [errors, setErrors] = useState([]);
  const [mode, setMode] = useState("append");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  const fileRef = useRef();

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target.result, { type: "binary", cellDates: false });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
        if (raw.length < 2) { setErrors(["El archivo no tiene datos suficientes."]); return; }
        const headers = raw[0].map(h => String(h).toLowerCase().trim());
        const fieldMap = {};
        headers.forEach((h, i) => { if (COL_MAP[h]) fieldMap[i] = COL_MAP[h]; });
        const required = ["cliente", "producto", "monto", "fechaVenta"];
        const missing = required.filter(r => !Object.values(fieldMap).includes(r));
        if (missing.length) { setErrors([`Columnas requeridas no encontradas: ${missing.join(", ")}`]); return; }
        const parsed = []; const errs = [];
        raw.slice(1).forEach((row, ri) => {
          if (row.every(c => c === "" || c === null || c === undefined)) return;
          const v = { id: "", cliente: "", producto: "", monto: 0, proveedor: "", costoCompra: 0, fechaVenta: "", fechaEntrega: "", estado: "pendiente", factura: "no", numFactura: "", pago: "n/a", fechaPago: "", facturaPropia: "no", numFacturaPropia: "", fechaFacturaPropia: "", notas: "", creadoEn: new Date().toISOString() };
          Object.entries(fieldMap).forEach(([ci, field]) => {
            const val = row[Number(ci)];
            if (field === "monto" || field === "costoCompra") v[field] = Number(String(val).replace(/[$\s]/g, "").replace(",",".")) || 0;
            else if (["fechaVenta","fechaEntrega","fechaPago","fechaFacturaPropia"].includes(field)) v[field] = toISODate(val);
            else if (field === "estado") v.estado = normalizeEstado(val);
            else if (field === "factura") v.factura = normalizeFactura(val);
            else if (field === "facturaPropia") v.facturaPropia = normalizeFactura(val);
            else if (field === "pago") v.pago = normalizePago(val);
            else v[field] = String(val || "").trim();
          });
          if (v.factura === "no") v.pago = "n/a";
          if (v.factura === "si" && v.pago === "n/a") v.pago = "pendiente";
          const rowErrs = [];
          if (!v.cliente) rowErrs.push("Cliente vacío");
          if (!v.producto) rowErrs.push("Producto vacío");
          if (!v.monto || v.monto <= 0) rowErrs.push("Monto inválido");
          if (!v.fechaVenta) rowErrs.push("Fecha venta vacía");
          if (rowErrs.length) { errs.push(`Fila ${ri+2}: ${rowErrs.join(", ")}`); return; }
          v.id = Date.now().toString() + "_" + ri;
          parsed.push(v);
        });
        setRows(parsed); setErrors(errs);
        if (parsed.length > 0) setStep("preview");
        else setErrors(prev => [...prev, "No se encontraron filas válidas."]);
      } catch (err) { setErrors(["Error al leer el archivo: " + err.message]); }
    };
    reader.readAsBinaryString(file);
  };

  const handleImport = () => {
    setImporting(true);
    setTimeout(() => { onImport(rows, mode); setResult({ count: rows.length, mode }); setStep("result"); setImporting(false); }, 400);
  };

  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["Cliente","Producto / Servicio","Monto","Proveedor","Costo Compra","Fecha Venta","Fecha Entrega","Estado","Factura Cliente","N° Factura","Pago","Fecha Pago","Nuestra Factura","N° Nuestra Factura","Fecha Nuestra Factura","Notas"],
      ["Municipalidad Angol","Servicio limpieza edificio",4800000,"Distribuidora Sur",3200000,"2026-01-15","2026-01-28","entregado","si","FAC-2026-001","pagado","2026-02-01","si","BFK-2026-014","2026-01-20",""],
      ["Gobernación Malleco","Mantención equipos informáticos",1900000,"TecnoChile SpA",1100000,"2026-03-15","2026-03-30","pendiente","no","","n/a","","no","","","Incluye traslado"],
    ]);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Ventas"); XLSX.writeFile(wb, "Plantilla_BFK_Ventas.xlsx");
  };

  const th = { padding:"7px 10px", textAlign:"left", fontSize:11, fontWeight:600, color:COLORS.gray, background:COLORS.grayLight, borderBottom:`1px solid ${COLORS.border}`, whiteSpace:"nowrap" };
  const td = { padding:"7px 10px", fontSize:11, borderBottom:`1px solid ${COLORS.border}`, whiteSpace:"nowrap" };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.45)", zIndex:100, display:"flex", alignItems:"center", justifyContent:"center", padding:16 }}>
      <div style={{ background:COLORS.white, borderRadius:12, width:"100%", maxWidth:760, maxHeight:"90vh", overflowY:"auto", boxShadow:"0 20px 60px rgba(0,0,0,0.2)" }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"16px 20px", borderBottom:`1px solid ${COLORS.border}`, position:"sticky", top:0, background:COLORS.white, zIndex:1 }}>
          <span style={{ fontWeight:700, fontSize:16, color:COLORS.dark }}>📥 Importar desde Excel <span style={{ fontSize:11, background:COLORS.purpleLight, color:COLORS.purple, padding:"2px 8px", borderRadius:10, marginLeft:8 }}>Solo Admin</span></span>
          <button onClick={onClose} style={{ background:"none", border:"none", cursor:"pointer", fontSize:20, color:COLORS.gray }}>×</button>
        </div>
        <div style={{ padding:20 }}>
          {step === "upload" && (
            <div>
              <div style={{ background:COLORS.purpleLight, border:`1px solid #DDD6FE`, borderRadius:8, padding:14, marginBottom:18 }}>
                <div style={{ fontWeight:700, fontSize:13, color:COLORS.purple, marginBottom:6 }}>📋 Cabeceras reconocidas</div>
                <div style={{ fontSize:12, color:COLORS.dark, marginBottom:8 }}>La primera fila del Excel debe tener los nombres de columna. Se aceptan estas cabeceras:</div>
                <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
                  {[["Cliente","req"],["Producto / Servicio","req"],["Monto","req"],["Fecha Venta","req"],["Proveedor",""],["Costo Compra",""],["Fecha Entrega",""],["Estado",""],["Factura Cliente",""],["N° Factura",""],["Pago",""],["Fecha Pago",""],["Nuestra Factura",""],["N° Nuestra Factura",""],["Fecha Nuestra Factura",""],["Notas",""]].map(([c,r]) => (
                    <span key={c} style={{ background:r?"#DCFCE7":COLORS.grayLight, color:r?COLORS.green:COLORS.dark, padding:"2px 8px", borderRadius:10, fontSize:11, fontWeight:r?700:400 }}>{c}{r?" *":""}</span>
                  ))}
                </div>
                <div style={{ fontSize:11, color:COLORS.gray, marginTop:8 }}>* Requeridas. Los campos de Fecha aceptan formato YYYY-MM-DD o DD/MM/YYYY.</div>
              </div>
              <div style={{ marginBottom:16 }}>
                <div style={{ fontSize:12, fontWeight:600, color:COLORS.dark, marginBottom:8 }}>Modo de importación</div>
                <div style={{ display:"flex", gap:10 }}>
                  {[["append","➕ Agregar",`Añadir a las ${existingCount} ventas existentes`],["replace","🔄 Reemplazar","Eliminar todo y cargar solo el Excel"]].map(([val,label,sub]) => (
                    <div key={val} onClick={() => setMode(val)} style={{ flex:1, border:`2px solid ${mode===val?COLORS.green:COLORS.border}`, borderRadius:8, padding:"10px 14px", cursor:"pointer", background:mode===val?COLORS.greenLight:COLORS.white }}>
                      <div style={{ fontWeight:700, fontSize:13, color:mode===val?COLORS.green:COLORS.dark }}>{label}</div>
                      <div style={{ fontSize:11, color:COLORS.gray, marginTop:3 }}>{sub}</div>
                    </div>
                  ))}
                </div>
                {mode === "replace" && <div style={{ background:COLORS.amberLight, color:COLORS.amber, borderRadius:6, padding:"7px 12px", fontSize:12, marginTop:8, fontWeight:600 }}>⚠️ Esto eliminará permanentemente todas las ventas actuales.</div>}
              </div>
              <div onClick={() => fileRef.current.click()} style={{ border:`2px dashed ${COLORS.border}`, borderRadius:10, padding:"32px 20px", textAlign:"center", cursor:"pointer", background:COLORS.grayLight }}
                onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if(f){fileRef.current.files=e.dataTransfer.files; handleFile({target:{files:[f]}});} }}>
                <div style={{ fontSize:32, marginBottom:8 }}>📂</div>
                <div style={{ fontWeight:600, fontSize:14, color:COLORS.dark }}>Arrastra tu archivo Excel aquí</div>
                <div style={{ fontSize:12, color:COLORS.gray, marginTop:4 }}>o haz clic para seleccionarlo (.xlsx, .xls)</div>
                <input ref={fileRef} type="file" accept=".xlsx,.xls" style={{ display:"none" }} onChange={handleFile} />
              </div>
              {errors.length > 0 && <div style={{ background:COLORS.redLight, border:`1px solid #FECACA`, borderRadius:8, padding:12, marginTop:14 }}>{errors.map((e,i)=><div key={i} style={{ fontSize:12, color:COLORS.red, marginBottom:3 }}>• {e}</div>)}</div>}
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:16 }}>
                <button onClick={downloadTemplate} style={{ fontSize:12, color:COLORS.blue, background:"none", border:"none", cursor:"pointer", textDecoration:"underline" }}>⬇ Descargar plantilla Excel de ejemplo</button>
                <button onClick={onClose} style={{ padding:"8px 18px", borderRadius:7, border:`1px solid ${COLORS.border}`, background:COLORS.white, cursor:"pointer", fontSize:13 }}>Cancelar</button>
              </div>
            </div>
          )}

          {step === "preview" && (
            <div>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14 }}>
                <div>
                  <span style={{ fontWeight:700, fontSize:14, color:COLORS.dark }}>{rows.length} ventas listas para importar</span>
                  {errors.length > 0 && <span style={{ fontSize:12, color:COLORS.amber, marginLeft:10 }}>⚠️ {errors.length} filas con errores omitidas</span>}
                </div>
                <button onClick={() => { setStep("upload"); setRows([]); setErrors([]); }} style={{ fontSize:12, color:COLORS.gray, background:"none", border:"none", cursor:"pointer" }}>← Volver</button>
              </div>
              {errors.length > 0 && <div style={{ background:COLORS.amberLight, borderRadius:8, padding:10, marginBottom:12 }}>{errors.map((e,i)=><div key={i} style={{ fontSize:11, color:COLORS.amber }}>• {e}</div>)}</div>}
              <div style={{ overflowX:"auto", maxHeight:340, overflowY:"auto", borderRadius:8, border:`1px solid ${COLORS.border}` }}>
                <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11 }}>
                  <thead style={{ position:"sticky", top:0 }}>
                    <tr>{["#","Cliente","Producto","Monto","Proveedor","F. Venta","Estado","Fact. cliente","Nuestra fact."].map(h=><th key={h} style={th}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {rows.map((v,i) => (
                      <tr key={i} style={{ background: i%2===0?COLORS.white:"#FAFAFA" }}>
                        <td style={{...td,color:COLORS.gray}}>{i+1}</td>
                        <td style={{...td,fontWeight:600}}>{v.cliente}</td>
                        <td style={{...td,maxWidth:140,overflow:"hidden",textOverflow:"ellipsis"}}>{v.producto}</td>
                        <td style={{...td,color:COLORS.green,fontWeight:700}}>${Number(v.monto).toLocaleString("es-CL")}</td>
                        <td style={{...td,color:COLORS.purple}}>{v.proveedor || "—"}</td>
                        <td style={td}>{v.fechaVenta}</td>
                        <td style={td}><span style={{ background:v.estado==="entregado"?COLORS.greenLight:v.estado==="cancelado"?COLORS.redLight:COLORS.amberLight, color:v.estado==="entregado"?COLORS.green:v.estado==="cancelado"?COLORS.red:COLORS.amber, padding:"2px 6px", borderRadius:10, fontSize:10, fontWeight:600 }}>{v.estado}</span></td>
                        <td style={td}>{v.factura==="si"?<span style={{ color:COLORS.blue, fontWeight:600 }}>{v.numFactura||"Emitida"}</span>:<span style={{ color:COLORS.gray }}>No</span>}</td>
                        <td style={td}>{v.facturaPropia==="si"?<span style={{ color:COLORS.green, fontWeight:600 }}>✓ Emitida</span>:<span style={{ color:COLORS.red, fontWeight:600 }}>⚠ Pendiente</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ display:"flex", gap:10, justifyContent:"flex-end", marginTop:16 }}>
                <button onClick={onClose} style={{ padding:"8px 18px", borderRadius:7, border:`1px solid ${COLORS.border}`, background:COLORS.white, cursor:"pointer", fontSize:13 }}>Cancelar</button>
                <button onClick={handleImport} disabled={importing} style={{ padding:"8px 20px", borderRadius:7, border:"none", background:importing?COLORS.gray:COLORS.green, color:"#fff", fontWeight:700, cursor:importing?"default":"pointer", fontSize:13 }}>
                  {importing?"Importando…":`✓ Importar ${rows.length} ventas (${mode==="replace"?"Reemplazar":"Agregar"})`}
                </button>
              </div>
            </div>
          )}

          {step === "result" && result && (
            <div style={{ textAlign:"center", padding:"20px 0" }}>
              <div style={{ fontSize:48, marginBottom:12 }}>✅</div>
              <div style={{ fontWeight:800, fontSize:20, color:COLORS.green, marginBottom:8 }}>¡Importación exitosa!</div>
              <div style={{ fontSize:14, color:COLORS.dark }}><b>{result.count}</b> ventas {result.mode==="replace"?"cargadas (datos anteriores reemplazados)":"agregadas al historial"}</div>
              <button onClick={onClose} style={{ marginTop:24, padding:"10px 28px", borderRadius:8, border:"none", background:COLORS.green, color:"#fff", fontWeight:700, cursor:"pointer", fontSize:14 }}>Ver dashboard</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── STORAGE HELPERS ─────────────────────────────────────────────────────────
async function storageGet(key) {
  try { return localStorage.getItem(key); }
  catch { return null; }
}
async function storageSet(key, value) {
  try { localStorage.setItem(key, value); } catch {}
}

// ─── FORMATTERS ──────────────────────────────────────────────────────────────
const fmt = {
  money: (n) => "$" + Number(n).toLocaleString("es-CL"),
  date: (d) => { if (!d) return "—"; const [y, m, dd] = d.split("-"); return `${dd}/${m}/${y.slice(2)}`; },
  month: (d) => { if (!d) return ""; const [y, m] = d.split("-"); return `${m}/${y.slice(2)}`; },
};

// ─── BADGE COMPONENT ─────────────────────────────────────────────────────────
function Badge({ type }) {
  const map = {
    pendiente:  { label: "Pendiente",  bg: COLORS.amberLight, color: COLORS.amber },
    entregado:  { label: "Entregado",  bg: COLORS.greenLight, color: COLORS.green },
    cancelado:  { label: "Cancelado",  bg: COLORS.redLight,   color: COLORS.red },
    pagado:     { label: "✓ Pagada",   bg: COLORS.greenLight, color: COLORS.green },
    "sin pagar":{ label: "△ Sin pagar",bg: COLORS.amberLight, color: COLORS.amber },
    parcial:    { label: "◑ Parcial",  bg: COLORS.blueLight,  color: COLORS.blue },
    "n/a":      { label: "—",          bg: "transparent",     color: COLORS.gray },
  };
  const s = map[type] || { label: type, bg: COLORS.grayLight, color: COLORS.gray };
  return (
    <span style={{ background: s.bg, color: s.color, padding: "2px 8px", borderRadius: 12, fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }}>
      {s.label}
    </span>
  );
}

// ─── VENCIMIENTO BADGE (30 días desde nuestra factura) ───────────────────────
function VencimientoBadge({ venta }) {
  if (venta.pago === "pagado" || venta.facturaPropia !== "si" || !venta.fechaFacturaPropia) return null;
  const venc = fechaVencimiento(venta.fechaFacturaPropia);
  const dias = diasParaVencer(venc);
  if (dias === null) return null;
  let style = { bg: COLORS.greenLight, color: COLORS.green, label: `Vence en ${dias}d` };
  if (dias < 0) style = { bg: COLORS.redLight, color: COLORS.red, label: `Vencida ${Math.abs(dias)}d` };
  else if (dias <= 5) style = { bg: COLORS.amberLight, color: COLORS.amber, label: `Vence en ${dias}d` };
  return (
    <div style={{ marginTop: 3 }}>
      <span style={{ background: style.bg, color: style.color, padding: "1px 6px", borderRadius: 10, fontSize: 9.5, fontWeight: 700, whiteSpace: "nowrap" }}>{style.label}</span>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// MÓDULO: ÓRDENES DE COMPRA (OC) CON ÍTEMS
// ════════════════════════════════════════════════════════════════════════════

const ESTADOS_COMPRA = [
  { value: "pendiente", label: "Pendiente", color: COLORS.red, bg: COLORS.redLight },
  { value: "en_proceso", label: "En proceso", color: COLORS.amber, bg: COLORS.amberLight },
  { value: "en_transito", label: "En tránsito", color: COLORS.blue, bg: COLORS.blueLight },
  { value: "comprado", label: "Comprado", color: COLORS.green, bg: COLORS.greenLight },
];
function estadoCompraInfo(v) { return ESTADOS_COMPRA.find(e => e.value === v) || ESTADOS_COMPRA[0]; }

function EstadoCompraBadge({ value }) {
  const info = estadoCompraInfo(value);
  return <span style={{ background: info.bg, color: info.color, padding: "2px 8px", borderRadius: 12, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>{info.label}</span>;
}

function nuevoItem() {
  return { id: "item_" + Date.now().toString() + "_" + Math.random().toString(36).slice(2, 7), producto: "", cantidad: 1, proveedor: "", costo_compra: "", estado_compra: "pendiente", notas: "" };
}

// ─── FORMULARIO DE OC (con ítems dinámicos) ─────────────────────────────────
function OCForm({ initial, onSave, onClose }) {
  const empty = {
    numero_oc: "", cliente: "", rut_cliente: "", comuna: "", vendedor: "",
    fechaVenta: "", fechaEntrega: "", estado: "pendiente",
    factura: "no", numFactura: "", pago: "n/a", fechaPago: "",
    facturaPropia: "no", numFacturaPropia: "", fechaFacturaPropia: "",
    financiamiento: "", estado_credito: "", monto_venta: "", notas: "",
  };
  const [f, setF] = useState(initial ? { ...empty, ...initial } : empty);
  const [items, setItems] = useState(initial?.items_oc?.length ? initial.items_oc.map(it => ({ ...it, costo_compra: it.costo_compra ?? "" })) : [nuevoItem()]);
  const [err, setErr] = useState({});

  const set = (k, v) => setF(p => {
    const next = { ...p, [k]: v };
    if (k === "factura") next.pago = v === "si" ? "pendiente" : "n/a";
    return next;
  });

  const setItem = (id, k, v) => setItems(prev => prev.map(it => it.id === id ? { ...it, [k]: v } : it));
  const addItem = () => setItems(prev => [...prev, nuevoItem()]);
  const removeItem = (id) => setItems(prev => prev.length > 1 ? prev.filter(it => it.id !== id) : prev);

  const totalCompraItems = items.reduce((s, it) => s + (Number(it.costo_compra) || 0), 0);

  const validate = () => {
    const e = {};
    if (!f.numero_oc.trim()) e.numero_oc = "Requerido";
    if (!f.cliente.trim()) e.cliente = "Requerido";
    if (!f.fechaVenta) e.fechaVenta = "Requerido";
    if (!f.monto_venta || isNaN(f.monto_venta) || Number(f.monto_venta) <= 0) e.monto_venta = "Monto válido requerido";
    const itemsInvalidos = items.some(it => !it.producto.trim());
    if (itemsInvalidos) e.items = "Cada ítem necesita un nombre de producto";
    setErr(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = () => {
    if (!validate()) return;
    const oc = { ...f, monto_venta: Number(f.monto_venta) };
    if (!initial) { oc.id = "oc_" + Date.now().toString(); oc.creadoEn = new Date().toISOString(); }
    else { oc.id = initial.id; oc.creadoEn = initial.creadoEn; }
    const itemsLimpios = items.map(it => ({
      id: it.id,
      oc_id: oc.id,
      producto: it.producto.trim(),
      cantidad: Number(it.cantidad) || 1,
      proveedor: it.proveedor.trim(),
      costo_compra: Number(it.costo_compra) || 0,
      estado_compra: it.estado_compra,
      notas: it.notas || "",
    }));
    onSave(oc, itemsLimpios, initial?.items_oc || []);
  };

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <Field label="N° Orden de Compra" required><input style={{ ...inputStyle, borderColor: err.numero_oc ? COLORS.red : COLORS.border }} value={f.numero_oc} onChange={e => set("numero_oc", e.target.value)} placeholder="ej: 4237-108-AG26" /></Field>
          {err.numero_oc && <div style={{ color: COLORS.red, fontSize: 11, marginTop: -10, marginBottom: 8 }}>{err.numero_oc}</div>}
        </div>
        <div>
          <Field label="Monto venta total ($)" required><input style={{ ...inputStyle, borderColor: err.monto_venta ? COLORS.red : COLORS.border }} type="number" value={f.monto_venta} onChange={e => set("monto_venta", e.target.value)} placeholder="0" /></Field>
          {err.monto_venta && <div style={{ color: COLORS.red, fontSize: 11, marginTop: -10, marginBottom: 8 }}>{err.monto_venta}</div>}
        </div>
        <div style={{ gridColumn: "1/-1" }}>
          <Field label="Cliente" required><input style={{ ...inputStyle, borderColor: err.cliente ? COLORS.red : COLORS.border }} value={f.cliente} onChange={e => set("cliente", e.target.value)} placeholder="Nombre o razón social" /></Field>
          {err.cliente && <div style={{ color: COLORS.red, fontSize: 11, marginTop: -10, marginBottom: 8 }}>{err.cliente}</div>}
        </div>
        <div><Field label="RUT cliente"><input style={inputStyle} value={f.rut_cliente} onChange={e => set("rut_cliente", e.target.value)} placeholder="12.345.678-9" /></Field></div>
        <div><Field label="Comuna"><input style={inputStyle} value={f.comuna} onChange={e => set("comuna", e.target.value)} placeholder="ej: Concepción" /></Field></div>
        <div><Field label="Vendedor"><input style={inputStyle} value={f.vendedor} onChange={e => set("vendedor", e.target.value)} placeholder="ej: Byron Vegas" /></Field></div>
        <div><Field label="Financiamiento"><input style={inputStyle} value={f.financiamiento} onChange={e => set("financiamiento", e.target.value)} placeholder="ej: Crédito Kevin, Cuenta BFK" /></Field></div>
        <div>
          <Field label="Fecha venta" required><input style={{ ...inputStyle, borderColor: err.fechaVenta ? COLORS.red : COLORS.border }} type="date" value={f.fechaVenta} onChange={e => set("fechaVenta", e.target.value)} /></Field>
          {err.fechaVenta && <div style={{ color: COLORS.red, fontSize: 11, marginTop: -10, marginBottom: 8 }}>{err.fechaVenta}</div>}
        </div>
        <div><Field label="Fecha entrega"><input style={inputStyle} type="date" value={f.fechaEntrega} onChange={e => set("fechaEntrega", e.target.value)} /></Field></div>
        <div>
          <Field label="Estado entrega">
            <select style={selectStyle} value={f.estado} onChange={e => set("estado", e.target.value)}>
              <option value="pendiente">Pendiente</option>
              <option value="entregado">Entregado</option>
              <option value="cancelado">Cancelado</option>
            </select>
          </Field>
        </div>
        <div>
          <Field label="Estado financiamiento">
            <select style={selectStyle} value={f.estado_credito} onChange={e => set("estado_credito", e.target.value)}>
              <option value="">—</option>
              <option value="PENDIENTE">Pendiente</option>
              <option value="REALIZADO">Realizado</option>
            </select>
          </Field>
        </div>
      </div>

      {/* ─── ÍTEMS / PRODUCTOS ─── */}
      <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px dashed ${COLORS.border}` }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: COLORS.purple }}>📦 Productos / Ítems de la OC</span>
          <span style={{ fontSize: 11, color: COLORS.gray }}>Total costo: <b style={{ color: COLORS.purple }}>{fmt.money(totalCompraItems)}</b></span>
        </div>
        {err.items && <div style={{ color: COLORS.red, fontSize: 11, marginBottom: 8 }}>{err.items}</div>}
        {items.map((it, idx) => (
          <div key={it.id} style={{ background: COLORS.grayLight, borderRadius: 8, padding: 10, marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: COLORS.gray }}>Ítem {idx + 1}</span>
              {items.length > 1 && <button onClick={() => removeItem(it.id)} style={{ background: "none", border: "none", color: COLORS.red, cursor: "pointer", fontSize: 11 }}>Quitar</button>}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 8, marginBottom: 8 }}>
              <input style={inputStyle} value={it.producto} onChange={e => setItem(it.id, "producto", e.target.value)} placeholder="Producto / descripción" />
              <input style={inputStyle} type="number" value={it.cantidad} onChange={e => setItem(it.id, "cantidad", e.target.value)} placeholder="Cantidad" />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
              <input style={inputStyle} value={it.proveedor} onChange={e => setItem(it.id, "proveedor", e.target.value)} placeholder="Proveedor (ej: Mercado Libre)" />
              <input style={inputStyle} type="number" value={it.costo_compra} onChange={e => setItem(it.id, "costo_compra", e.target.value)} placeholder="Costo compra ($)" />
            </div>
            <select style={selectStyle} value={it.estado_compra} onChange={e => setItem(it.id, "estado_compra", e.target.value)}>
              {ESTADOS_COMPRA.map(es => <option key={es.value} value={es.value}>{es.label}</option>)}
            </select>
          </div>
        ))}
        <button onClick={addItem} style={{ width: "100%", padding: "8px", borderRadius: 7, border: `1.5px dashed ${COLORS.purple}`, background: "transparent", color: COLORS.purple, fontWeight: 600, cursor: "pointer", fontSize: 12 }}>+ Agregar otro producto</button>
      </div>

      {/* ─── FACTURA CLIENTE / NUESTRA FACTURA ─── */}
      <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px dashed ${COLORS.border}`, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div style={{ gridColumn: "1/-1", fontSize: 12, fontWeight: 700, color: COLORS.blue, marginBottom: 4 }}>📄 Factura recibida del cliente</div>
        <div>
          <Field label="¿Cliente emitió factura?">
            <select style={selectStyle} value={f.factura} onChange={e => set("factura", e.target.value)}>
              <option value="no">No</option>
              <option value="si">Sí</option>
            </select>
          </Field>
        </div>
        {f.factura === "si" && (
          <>
            <div><Field label="N° Factura"><input style={inputStyle} value={f.numFactura} onChange={e => set("numFactura", e.target.value)} /></Field></div>
            <div>
              <Field label="Estado de pago">
                <select style={selectStyle} value={f.pago} onChange={e => set("pago", e.target.value)}>
                  <option value="pendiente">Sin pagar</option>
                  <option value="pagado">Pagado</option>
                  <option value="parcial">Pago parcial</option>
                </select>
              </Field>
            </div>
            {(f.pago === "pagado" || f.pago === "parcial") && (
              <div><Field label="Fecha de pago"><input style={inputStyle} type="date" value={f.fechaPago} onChange={e => set("fechaPago", e.target.value)} /></Field></div>
            )}
          </>
        )}

        <div style={{ gridColumn: "1/-1", fontSize: 12, fontWeight: 700, color: COLORS.green, marginTop: 6, marginBottom: 4 }}>🧾 Nuestra factura de venta</div>
        <div>
          <Field label="¿BFK ya emitió su factura?">
            <select style={selectStyle} value={f.facturaPropia} onChange={e => set("facturaPropia", e.target.value)}>
              <option value="no">No, pendiente de emitir</option>
              <option value="si">Sí, ya emitida</option>
            </select>
          </Field>
        </div>
        {f.facturaPropia === "si" && (
          <>
            <div><Field label="N° Nuestra factura"><input style={inputStyle} value={f.numFacturaPropia} onChange={e => set("numFacturaPropia", e.target.value)} /></Field></div>
            <div>
              <Field label="Fecha de emisión"><input style={inputStyle} type="date" value={f.fechaFacturaPropia} onChange={e => set("fechaFacturaPropia", e.target.value)} /></Field>
              {f.fechaFacturaPropia && <div style={{ fontSize: 11, color: COLORS.gray, marginTop: -8 }}>💰 Pago esperado: <b style={{ color: COLORS.dark }}>{fmt.date(fechaVencimiento(f.fechaFacturaPropia))}</b> (30 días)</div>}
            </div>
          </>
        )}
      </div>

      <Field label="Notas"><textarea style={{ ...inputStyle, height: 50, resize: "vertical", marginTop: 10 }} value={f.notas} onChange={e => set("notas", e.target.value)} placeholder="Observaciones opcionales" /></Field>

      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
        <button onClick={onClose} style={{ padding: "8px 18px", borderRadius: 7, border: `1px solid ${COLORS.border}`, background: COLORS.white, cursor: "pointer", fontSize: 13, color: COLORS.dark }}>Cancelar</button>
        <button onClick={handleSave} style={{ padding: "8px 18px", borderRadius: 7, border: "none", background: COLORS.green, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>{initial ? "Guardar cambios" : "Registrar OC"}</button>
      </div>
    </div>
  );
}


function ProgressBar({ venta }) {
  const steps = [
    { label: "Reg.", active: true, warn: false },
    { label: "Entr.", active: venta.estado === "entregado", warn: false },
    { label: "F.Propia", active: venta.facturaPropia === "si", warn: venta.estado === "entregado" && venta.facturaPropia !== "si" },
    {
      label: "Pago",
      active: venta.pago === "pagado",
      warn: venta.factura === "si" && venta.pago !== "pagado",
    },
  ];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
      {steps.map((s, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 2 }}>
          <div style={{
            width: 20, height: 20, borderRadius: "50%", fontSize: 8, fontWeight: 700,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: s.active ? COLORS.green : s.warn ? COLORS.amber : COLORS.grayLight,
            color: s.active || s.warn ? "#fff" : COLORS.gray,
            border: `2px solid ${s.active ? COLORS.green : s.warn ? COLORS.amber : COLORS.border}`,
          }}>{i + 1}</div>
          {i < 3 && <div style={{ width: 10, height: 2, background: s.active ? COLORS.green : COLORS.border }} />}
        </div>
      ))}
    </div>
  );
}

// ─── KPI CARD ────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, color }) {
  return (
    <div style={{ background: COLORS.white, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "14px 18px", minWidth: 130, flex: 1 }}>
      <div style={{ fontSize: 11, color: COLORS.gray, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: color || COLORS.dark }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: COLORS.gray, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ─── CHART ───────────────────────────────────────────────────────────────────
function BarChart({ ventas }) {
  const canvasRef = useRef();
  const chartRef = useRef();

  const data = useMemo(() => {
    const map = {};
    ventas.forEach(v => {
      const m = fmt.month(v.fechaVenta);
      if (!m) return;
      if (!map[m]) map[m] = { vendido: 0, cobrado: 0, sort: v.fechaVenta };
      map[m].vendido += Number(v.monto) || 0;
      if (v.pago === "pagado") map[m].cobrado += Number(v.monto) || 0;
    });
    const sorted = Object.entries(map).sort((a, b) => a[1].sort.localeCompare(b[1].sort));
    return {
      labels: sorted.map(([k]) => k),
      vendido: sorted.map(([, v]) => v.vendido),
      cobrado: sorted.map(([, v]) => v.cobrado),
    };
  }, [ventas]);

  useEffect(() => {
    if (!canvasRef.current || !data.labels.length) return;
    if (chartRef.current) chartRef.current.destroy();
    const Chart = window.Chart;
    if (!Chart) return;
    chartRef.current = new Chart(canvasRef.current, {
      type: "bar",
      data: {
        labels: data.labels,
        datasets: [
          { label: "Vendido", data: data.vendido, backgroundColor: "#86EFCA", borderRadius: 4 },
          { label: "Cobrado", data: data.cobrado, backgroundColor: COLORS.green, borderRadius: 4 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { ticks: { callback: v => "$" + v.toLocaleString("es-CL"), font: { size: 10 } }, grid: { color: "#F3F4F6" } },
          x: { ticks: { font: { size: 10 } }, grid: { display: false } },
        },
      },
    });
    return () => { if (chartRef.current) chartRef.current.destroy(); };
  }, [data]);

  if (!ventas.length) return null;
  return (
    <div style={{ background: COLORS.white, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: 18, marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: COLORS.dark }}>INGRESOS POR MES</span>
        <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: COLORS.gray }}>
          <span style={{ width: 10, height: 10, background: "#86EFCA", borderRadius: 2, display: "inline-block" }} /> Vendido
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: COLORS.gray }}>
          <span style={{ width: 10, height: 10, background: COLORS.green, borderRadius: 2, display: "inline-block" }} /> Cobrado
        </span>
      </div>
      <div style={{ height: 180 }}>
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}

// ─── PROVEEDORES PANEL (sección de compras) ──────────────────────────────────
function ProveedoresPanel({ ventas }) {
  const [open, setOpen] = useState(false);

  const data = useMemo(() => {
    const map = {};
    ventas.forEach(v => {
      if (!v.proveedor) return;
      if (!map[v.proveedor]) map[v.proveedor] = { compras: 0, ventasMonto: 0, count: 0 };
      map[v.proveedor].compras += Number(v.costoCompra) || 0;
      map[v.proveedor].ventasMonto += Number(v.monto) || 0;
      map[v.proveedor].count += 1;
    });
    return Object.entries(map)
      .map(([proveedor, d]) => ({ proveedor, ...d, margen: d.ventasMonto - d.compras }))
      .sort((a, b) => b.compras - a.compras);
  }, [ventas]);

  if (!data.length) return null;

  return (
    <div style={{ background: COLORS.white, border: `1px solid ${COLORS.border}`, borderRadius: 10, marginBottom: 18 }}>
      <div onClick={() => setOpen(o => !o)} style={{ padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}>
        <span style={{ fontWeight: 700, fontSize: 13, color: COLORS.dark }}>🛒 COMPRAS POR PROVEEDOR <span style={{ color: COLORS.gray, fontWeight: 400 }}>({data.length})</span></span>
        <span style={{ fontSize: 12, color: COLORS.gray }}>{open ? "▲ ocultar" : "▼ ver detalle"}</span>
      </div>
      {open && (
        <div style={{ overflowX: "auto", borderTop: `1px solid ${COLORS.border}` }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: COLORS.grayLight }}>
                {["Proveedor", "N° compras", "Total comprado", "Total vendido", "Margen generado"].map(h => (
                  <th key={h} style={{ padding: "9px 12px", textAlign: "left", fontWeight: 600, color: COLORS.gray, fontSize: 11, whiteSpace: "nowrap", borderBottom: `1px solid ${COLORS.border}` }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((d, i) => (
                <tr key={d.proveedor} style={{ borderBottom: `1px solid ${COLORS.border}`, background: i % 2 === 0 ? COLORS.white : "#FAFAFA" }}>
                  <td style={{ padding: "10px 12px", fontWeight: 700, color: COLORS.dark }}>{d.proveedor}</td>
                  <td style={{ padding: "10px 12px", color: COLORS.gray }}>{d.count}</td>
                  <td style={{ padding: "10px 12px", color: COLORS.purple, fontWeight: 700 }}>{fmt.money(d.compras)}</td>
                  <td style={{ padding: "10px 12px", color: COLORS.blue, fontWeight: 600 }}>{fmt.money(d.ventasMonto)}</td>
                  <td style={{ padding: "10px 12px", color: d.margen >= 0 ? COLORS.green : COLORS.red, fontWeight: 700 }}>{fmt.money(d.margen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── GASTOS (operacionales, no asociados a una venta específica) ────────────
const CATEGORIAS_GASTO = ["Arriendo", "Sueldos", "Transporte", "Combustible", "Servicios básicos", "Insumos oficina", "Marketing", "Honorarios", "Impuestos", "Otros"];

function GastoForm({ initial, onSave, onClose }) {
  const empty = { concepto: "", categoria: "Otros", monto: "", fecha: "", notas: "" };
  const [f, setF] = useState(initial || empty);
  const [err, setErr] = useState({});

  const validate = () => {
    const e = {};
    if (!f.concepto.trim()) e.concepto = "Requerido";
    if (!f.monto || isNaN(f.monto) || Number(f.monto) <= 0) e.monto = "Monto válido requerido";
    if (!f.fecha) e.fecha = "Requerido";
    setErr(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = () => {
    if (!validate()) return;
    const gasto = { ...f, monto: Number(f.monto) };
    if (!initial) { gasto.id = Date.now().toString(); gasto.creadoEn = new Date().toISOString(); }
    else { gasto.id = initial.id; gasto.creadoEn = initial.creadoEn; }
    onSave(gasto);
  };

  return (
    <div>
      <Field label="Concepto" required>
        <input style={{ ...inputStyle, borderColor: err.concepto ? COLORS.red : COLORS.border }} value={f.concepto} onChange={e => setF(p => ({ ...p, concepto: e.target.value }))} placeholder="Ej: Arriendo bodega junio" />
      </Field>
      {err.concepto && <div style={{ color: COLORS.red, fontSize: 11, marginTop: -10, marginBottom: 8 }}>{err.concepto}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field label="Categoría">
          <select style={selectStyle} value={f.categoria} onChange={e => setF(p => ({ ...p, categoria: e.target.value }))}>
            {CATEGORIAS_GASTO.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
        <div>
          <Field label="Monto ($)" required><input style={{ ...inputStyle, borderColor: err.monto ? COLORS.red : COLORS.border }} type="number" value={f.monto} onChange={e => setF(p => ({ ...p, monto: e.target.value }))} placeholder="0" /></Field>
          {err.monto && <div style={{ color: COLORS.red, fontSize: 11, marginTop: -10, marginBottom: 8 }}>{err.monto}</div>}
        </div>
      </div>
      <Field label="Fecha" required><input style={{ ...inputStyle, borderColor: err.fecha ? COLORS.red : COLORS.border }} type="date" value={f.fecha} onChange={e => setF(p => ({ ...p, fecha: e.target.value }))} /></Field>
      {err.fecha && <div style={{ color: COLORS.red, fontSize: 11, marginTop: -10, marginBottom: 8 }}>{err.fecha}</div>}
      <Field label="Notas"><textarea style={{ ...inputStyle, height: 50, resize: "vertical" }} value={f.notas} onChange={e => setF(p => ({ ...p, notas: e.target.value }))} placeholder="Observaciones opcionales" /></Field>
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
        <button onClick={onClose} style={{ padding: "8px 18px", borderRadius: 7, border: `1px solid ${COLORS.border}`, background: COLORS.white, cursor: "pointer", fontSize: 13, color: COLORS.dark }}>Cancelar</button>
        <button onClick={handleSave} style={{ padding: "8px 18px", borderRadius: 7, border: "none", background: COLORS.red, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>{initial ? "Guardar cambios" : "Registrar gasto"}</button>
      </div>
    </div>
  );
}

function GastosPanel({ gastos, kpis, onNuevo, onEditar, onEliminar }) {
  const [open, setOpen] = useState(true);

  const porCategoria = useMemo(() => {
    const map = {};
    gastos.forEach(g => { map[g.categoria] = (map[g.categoria] || 0) + (Number(g.monto) || 0); });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [gastos]);

  const totalGastos = gastos.reduce((s, g) => s + (Number(g.monto) || 0), 0);
  const utilidadEsperada = kpis.margen; // ingresos - costoCompra (sin gastos operativos)
  const utilidadReal = utilidadEsperada - totalGastos;
  const pctUtilidadReal = kpis.ingresos ? Math.round((utilidadReal / kpis.ingresos) * 100) : 0;

  return (
    <div style={{ background: COLORS.white, border: `1px solid ${COLORS.border}`, borderRadius: 10, marginBottom: 18 }}>
      <div style={{ padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <span onClick={() => setOpen(o => !o)} style={{ fontWeight: 700, fontSize: 13, color: COLORS.dark, cursor: "pointer" }}>
          💸 GASTOS Y UTILIDAD <span style={{ color: COLORS.gray, fontWeight: 400 }}>({gastos.length})</span> <span style={{ fontSize: 11, color: COLORS.gray }}>{open ? "▲" : "▼"}</span>
        </span>
        <button onClick={onNuevo} style={{ padding: "6px 14px", borderRadius: 7, border: "none", background: COLORS.red, color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 12 }}>+ Registrar gasto</button>
      </div>

      {open && (
        <div style={{ borderTop: `1px solid ${COLORS.border}` }}>
          {/* Resumen utilidad esperada vs real */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", padding: "14px 16px", background: COLORS.bg }}>
            <div style={{ flex: 1, minWidth: 150, background: COLORS.white, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: "10px 14px" }}>
              <div style={{ fontSize: 11, color: COLORS.gray }}>Margen bruto (ventas − compras)</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: COLORS.purple }}>{fmt.money(utilidadEsperada)}</div>
            </div>
            <div style={{ flex: 1, minWidth: 150, background: COLORS.white, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: "10px 14px" }}>
              <div style={{ fontSize: 11, color: COLORS.gray }}>Total gastos operativos</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: COLORS.red }}>− {fmt.money(totalGastos)}</div>
            </div>
            <div style={{ flex: 1, minWidth: 150, background: utilidadReal >= 0 ? COLORS.greenLight : COLORS.redLight, border: `1px solid ${utilidadReal >= 0 ? "#BBF7D0" : "#FECACA"}`, borderRadius: 8, padding: "10px 14px" }}>
              <div style={{ fontSize: 11, color: COLORS.gray }}>Utilidad real estimada</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: utilidadReal >= 0 ? COLORS.green : COLORS.red }}>{fmt.money(utilidadReal)}</div>
              <div style={{ fontSize: 11, color: COLORS.gray, marginTop: 2 }}>{pctUtilidadReal}% sobre ingresos</div>
            </div>
          </div>

          {/* Gastos por categoría */}
          {porCategoria.length > 0 && (
            <div style={{ padding: "0 16px 14px", display: "flex", flexWrap: "wrap", gap: 6 }}>
              {porCategoria.map(([cat, monto]) => (
                <span key={cat} style={{ background: COLORS.grayLight, color: COLORS.dark, padding: "4px 10px", borderRadius: 14, fontSize: 11 }}>
                  <b>{cat}:</b> {fmt.money(monto)}
                </span>
              ))}
            </div>
          )}

          {/* Tabla de gastos */}
          {gastos.length === 0 ? (
            <div style={{ padding: "20px 16px", textAlign: "center", color: COLORS.gray, fontSize: 13, borderTop: `1px solid ${COLORS.border}` }}>Aún no hay gastos registrados.</div>
          ) : (
            <div style={{ overflowX: "auto", borderTop: `1px solid ${COLORS.border}` }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: COLORS.grayLight }}>
                    {["Fecha", "Concepto", "Categoría", "Monto", "Notas", ""].map(h => (
                      <th key={h} style={{ padding: "9px 12px", textAlign: "left", fontWeight: 600, color: COLORS.gray, fontSize: 11, whiteSpace: "nowrap", borderBottom: `1px solid ${COLORS.border}` }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...gastos].sort((a, b) => (b.fecha || "").localeCompare(a.fecha || "")).map((g, i) => (
                    <tr key={g.id} style={{ borderBottom: `1px solid ${COLORS.border}`, background: i % 2 === 0 ? COLORS.white : "#FAFAFA" }}>
                      <td style={{ padding: "9px 12px", whiteSpace: "nowrap", color: COLORS.gray }}>{fmt.date(g.fecha)}</td>
                      <td style={{ padding: "9px 12px", fontWeight: 600, color: COLORS.dark }}>{g.concepto}</td>
                      <td style={{ padding: "9px 12px" }}><span style={{ background: COLORS.redLight, color: COLORS.red, padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 600 }}>{g.categoria}</span></td>
                      <td style={{ padding: "9px 12px", fontWeight: 700, color: COLORS.red, whiteSpace: "nowrap" }}>{fmt.money(g.monto)}</td>
                      <td style={{ padding: "9px 12px", color: COLORS.gray, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={g.notas}>{g.notas || "—"}</td>
                      <td style={{ padding: "9px 12px", whiteSpace: "nowrap" }}>
                        <button onClick={() => onEditar(g)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, marginRight: 4 }} title="Editar">✏️</button>
                        <button onClick={() => onEliminar(g.id)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14 }} title="Eliminar">🗑️</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}


// ─── PANEL DE ÓRDENES DE COMPRA ──────────────────────────────────────────────
function OCPanel({ ocs, onNuevo, onEditar, onEliminar }) {
  const [open, setOpen] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [search, setSearch] = useState("");
  const [fEstadoCompra, setFEstadoCompra] = useState("todos");

  const filtered = useMemo(() => {
    return ocs.filter(oc => {
      const q = search.toLowerCase();
      if (q && !oc.numero_oc.toLowerCase().includes(q) && !oc.cliente.toLowerCase().includes(q)) return false;
      if (fEstadoCompra !== "todos") {
        const items = oc.items_oc || [];
        const tieneEstado = items.some(it => it.estado_compra === fEstadoCompra);
        if (!tieneEstado) return false;
      }
      return true;
    });
  }, [ocs, search, fEstadoCompra]);

  return (
    <div style={{ background: COLORS.white, border: `1px solid ${COLORS.border}`, borderRadius: 10, marginBottom: 18 }}>
      <div style={{ padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <span onClick={() => setOpen(o => !o)} style={{ fontWeight: 700, fontSize: 13, color: COLORS.dark, cursor: "pointer" }}>
          📋 ÓRDENES DE COMPRA <span style={{ color: COLORS.gray, fontWeight: 400 }}>({ocs.length})</span> <span style={{ fontSize: 11, color: COLORS.gray }}>{open ? "▲" : "▼"}</span>
        </span>
        <button onClick={onNuevo} style={{ padding: "6px 14px", borderRadius: 7, border: "none", background: COLORS.purple, color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 12 }}>+ Nueva OC</button>
      </div>

      {open && (
        <div style={{ borderTop: `1px solid ${COLORS.border}` }}>
          <div style={{ padding: "10px 16px", display: "flex", flexWrap: "wrap", gap: 8 }}>
            <input style={{ border: `1px solid ${COLORS.border}`, borderRadius: 6, padding: "6px 10px", fontSize: 12, flex: 1, minWidth: 140 }} placeholder="Buscar OC o cliente…" value={search} onChange={e => setSearch(e.target.value)} />
            <select style={{ border: `1px solid ${COLORS.border}`, borderRadius: 6, padding: "6px 10px", fontSize: 12, background: COLORS.white }} value={fEstadoCompra} onChange={e => setFEstadoCompra(e.target.value)}>
              <option value="todos">Estado compra: todos</option>
              {ESTADOS_COMPRA.map(es => <option key={es.value} value={es.value}>{es.label}</option>)}
            </select>
          </div>

          {filtered.length === 0 ? (
            <div style={{ padding: "20px 16px", textAlign: "center", color: COLORS.gray, fontSize: 13, borderTop: `1px solid ${COLORS.border}` }}>No hay órdenes de compra que coincidan.</div>
          ) : (
            <div style={{ borderTop: `1px solid ${COLORS.border}` }}>
              {filtered.map(oc => {
                const items = oc.items_oc || [];
                const totalCosto = items.reduce((s, it) => s + (Number(it.costo_compra) || 0), 0);
                const pendientesCount = items.filter(it => it.estado_compra !== "comprado").length;
                const isOpen = expandedId === oc.id;
                return (
                  <div key={oc.id} style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                    <div onClick={() => setExpandedId(isOpen ? null : oc.id)} style={{ padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", gap: 8, flexWrap: "wrap" }}>
                      <div style={{ flex: 1, minWidth: 200 }}>
                        <span style={{ fontWeight: 700, fontSize: 13, color: COLORS.dark }}>{oc.numero_oc}</span>
                        <span style={{ fontSize: 12, color: COLORS.gray, marginLeft: 8 }}>{oc.cliente}</span>
                        {pendientesCount > 0 && <span style={{ marginLeft: 8, background: COLORS.redLight, color: COLORS.red, padding: "1px 7px", borderRadius: 10, fontSize: 10, fontWeight: 700 }}>{pendientesCount} ítem(s) sin comprar</span>}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: COLORS.green }}>{fmt.money(oc.monto_venta)}</span>
                        <span style={{ fontSize: 11, color: COLORS.purple }}>costo {fmt.money(totalCosto)}</span>
                        <Badge type={oc.estado} />
                        <span style={{ fontSize: 12, color: COLORS.gray }}>{isOpen ? "▲" : "▼"}</span>
                      </div>
                    </div>
                    {isOpen && (
                      <div style={{ padding: "0 16px 14px", background: COLORS.bg }}>
                        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 11, color: COLORS.gray, marginBottom: 10, paddingTop: 10 }}>
                          <span>Vendedor: <b style={{ color: COLORS.dark }}>{oc.vendedor || "—"}</b></span>
                          <span>Financiamiento: <b style={{ color: COLORS.dark }}>{oc.financiamiento || "—"}</b></span>
                          <span>F. venta: <b style={{ color: COLORS.dark }}>{fmt.date(oc.fechaVenta)}</b></span>
                          <span>Nuestra factura: {oc.facturaPropia === "si" ? <b style={{ color: COLORS.green }}>✓ {oc.numFacturaPropia}</b> : <b style={{ color: COLORS.red }}>Por emitir</b>}</span>
                        </div>
                        <div style={{ overflowX: "auto" }}>
                          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
                            <thead>
                              <tr style={{ background: COLORS.grayLight }}>
                                {["Producto", "Cant.", "Proveedor", "Costo", "Estado compra"].map(h => (
                                  <th key={h} style={{ padding: "6px 10px", textAlign: "left", fontWeight: 600, color: COLORS.gray, fontSize: 10.5, borderBottom: `1px solid ${COLORS.border}` }}>{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {items.map(it => (
                                <tr key={it.id} style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                                  <td style={{ padding: "6px 10px", fontWeight: 600 }}>{it.producto}</td>
                                  <td style={{ padding: "6px 10px", color: COLORS.gray }}>{it.cantidad}</td>
                                  <td style={{ padding: "6px 10px", color: COLORS.gray }}>{it.proveedor || "—"}</td>
                                  <td style={{ padding: "6px 10px", color: COLORS.purple, fontWeight: 600 }}>{fmt.money(it.costo_compra)}</td>
                                  <td style={{ padding: "6px 10px" }}><EstadoCompraBadge value={it.estado_compra} /></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 10 }}>
                          <button onClick={() => onEditar(oc)} style={{ padding: "5px 12px", borderRadius: 6, border: `1px solid ${COLORS.border}`, background: COLORS.white, cursor: "pointer", fontSize: 12 }}>✏️ Editar</button>
                          <button onClick={() => onEliminar(oc.id)} style={{ padding: "5px 12px", borderRadius: 6, border: "none", background: COLORS.redLight, color: COLORS.red, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>🗑️ Eliminar</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── PANEL: COMPRAS PENDIENTES DE REALIZAR ───────────────────────────────────
function ComprasPendientesPanel({ ocs }) {
  const [open, setOpen] = useState(true);

  const pendientes = useMemo(() => {
    const out = [];
    ocs.forEach(oc => {
      (oc.items_oc || []).forEach(it => {
        if (it.estado_compra !== "comprado") {
          out.push({ ...it, numero_oc: oc.numero_oc, cliente: oc.cliente, oc_id: oc.id });
        }
      });
    });
    return out.sort((a, b) => {
      const order = { pendiente: 0, en_proceso: 1, en_transito: 2 };
      return (order[a.estado_compra] ?? 9) - (order[b.estado_compra] ?? 9);
    });
  }, [ocs]);

  const totalPendiente = pendientes.reduce((s, it) => s + (Number(it.costo_compra) || 0), 0);

  if (pendientes.length === 0) return null;

  return (
    <div style={{ background: COLORS.redLight, border: `1px solid #FECACA`, borderRadius: 10, marginBottom: 18 }}>
      <div onClick={() => setOpen(o => !o)} style={{ padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", flexWrap: "wrap", gap: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 13, color: COLORS.red }}>
          🛒 COMPRAS PENDIENTES DE REALIZAR <span style={{ fontWeight: 400 }}>({pendientes.length} ítems · {fmt.money(totalPendiente)} estimado)</span>
        </span>
        <span style={{ fontSize: 12, color: COLORS.red }}>{open ? "▲" : "▼"}</span>
      </div>
      {open && (
        <div style={{ overflowX: "auto", borderTop: "1px solid #FECACA" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#FEE2E2" }}>
                {["OC", "Cliente", "Producto", "Cant.", "Proveedor", "Costo est.", "Estado"].map(h => (
                  <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600, color: COLORS.red, fontSize: 11, whiteSpace: "nowrap", borderBottom: "1px solid #FECACA" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pendientes.map(it => (
                <tr key={it.id} style={{ borderBottom: "1px solid #FECACA" }}>
                  <td style={{ padding: "8px 12px", fontWeight: 700, whiteSpace: "nowrap" }}>{it.numero_oc}</td>
                  <td style={{ padding: "8px 12px", color: COLORS.gray, whiteSpace: "nowrap" }}>{it.cliente}</td>
                  <td style={{ padding: "8px 12px" }}>{it.producto}</td>
                  <td style={{ padding: "8px 12px", color: COLORS.gray }}>{it.cantidad}</td>
                  <td style={{ padding: "8px 12px", color: COLORS.gray }}>{it.proveedor || "—"}</td>
                  <td style={{ padding: "8px 12px", color: COLORS.purple, fontWeight: 600, whiteSpace: "nowrap" }}>{fmt.money(it.costo_compra)}</td>
                  <td style={{ padding: "8px 12px" }}><EstadoCompraBadge value={it.estado_compra} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: COLORS.white, borderRadius: 12, width: "100%", maxWidth: 560, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: `1px solid ${COLORS.border}` }}>
          <span style={{ fontWeight: 700, fontSize: 16, color: COLORS.dark }}>{title}</span>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 20, color: COLORS.gray }}>×</button>
        </div>
        <div style={{ padding: 20 }}>{children}</div>
      </div>
    </div>
  );
}

// ─── FORM FIELD ──────────────────────────────────────────────────────────────
function Field({ label, required, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: COLORS.dark, display: "block", marginBottom: 4 }}>
        {label}{required && <span style={{ color: COLORS.red }}> *</span>}
      </label>
      {children}
    </div>
  );
}

const inputStyle = { width: "100%", border: `1px solid ${COLORS.border}`, borderRadius: 6, padding: "7px 10px", fontSize: 13, color: COLORS.dark, boxSizing: "border-box", outline: "none" };
const selectStyle = { ...inputStyle, background: COLORS.white };

// ─── VENTA FORM ──────────────────────────────────────────────────────────────
function VentaForm({ initial, onSave, onClose }) {
  const empty = {
    cliente: "", producto: "", monto: "", fechaVenta: "", fechaEntrega: "", estado: "pendiente",
    proveedor: "", costoCompra: "",
    factura: "no", numFactura: "", pago: "n/a", fechaPago: "",
    facturaPropia: "no", numFacturaPropia: "", fechaFacturaPropia: "",
    notas: "",
  };
  const [f, setF] = useState(initial ? { ...empty, ...initial } : empty);
  const [err, setErr] = useState({});

  const set = (k, v) => setF(p => {
    const next = { ...p, [k]: v };
    if (k === "factura") next.pago = v === "si" ? "pendiente" : "n/a";
    return next;
  });

  const validate = () => {
    const e = {};
    if (!f.cliente.trim()) e.cliente = "Requerido";
    if (!f.producto.trim()) e.producto = "Requerido";
    if (!f.monto || isNaN(f.monto) || Number(f.monto) <= 0) e.monto = "Monto válido requerido";
    if (!f.fechaVenta) e.fechaVenta = "Requerido";
    if (f.factura === "si" && !f.pago) e.pago = "Requerido";
    if (f.costoCompra && (isNaN(f.costoCompra) || Number(f.costoCompra) < 0)) e.costoCompra = "Costo inválido";
    setErr(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = () => {
    if (!validate()) return;
    const venta = { ...f, monto: Number(f.monto), costoCompra: f.costoCompra ? Number(f.costoCompra) : 0 };
    if (!initial) { venta.id = Date.now().toString(); venta.creadoEn = new Date().toISOString(); }
    else { venta.id = initial.id; venta.creadoEn = initial.creadoEn; }
    onSave(venta);
  };

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div style={{ gridColumn: "1/-1" }}>
          <Field label="Cliente" required><input style={{ ...inputStyle, borderColor: err.cliente ? COLORS.red : COLORS.border }} value={f.cliente} onChange={e => set("cliente", e.target.value)} placeholder="Nombre o razón social" /></Field>
          {err.cliente && <div style={{ color: COLORS.red, fontSize: 11, marginTop: -10, marginBottom: 8 }}>{err.cliente}</div>}
        </div>
        <div style={{ gridColumn: "1/-1" }}>
          <Field label="Producto / Servicio" required><input style={{ ...inputStyle, borderColor: err.producto ? COLORS.red : COLORS.border }} value={f.producto} onChange={e => set("producto", e.target.value)} placeholder="Descripción del producto o servicio" /></Field>
          {err.producto && <div style={{ color: COLORS.red, fontSize: 11, marginTop: -10, marginBottom: 8 }}>{err.producto}</div>}
        </div>
        <div>
          <Field label="Monto ($)" required><input style={{ ...inputStyle, borderColor: err.monto ? COLORS.red : COLORS.border }} type="number" value={f.monto} onChange={e => set("monto", e.target.value)} placeholder="0" /></Field>
          {err.monto && <div style={{ color: COLORS.red, fontSize: 11, marginTop: -10, marginBottom: 8 }}>{err.monto}</div>}
        </div>
        <div>
          <Field label="Fecha de venta" required><input style={{ ...inputStyle, borderColor: err.fechaVenta ? COLORS.red : COLORS.border }} type="date" value={f.fechaVenta} onChange={e => set("fechaVenta", e.target.value)} /></Field>
          {err.fechaVenta && <div style={{ color: COLORS.red, fontSize: 11, marginTop: -10, marginBottom: 8 }}>{err.fechaVenta}</div>}
        </div>
        <div>
          <Field label="Fecha entrega"><input style={inputStyle} type="date" value={f.fechaEntrega} onChange={e => set("fechaEntrega", e.target.value)} /></Field>
        </div>
        <div>
          <Field label="Estado entrega">
            <select style={selectStyle} value={f.estado} onChange={e => set("estado", e.target.value)}>
              <option value="pendiente">Pendiente</option>
              <option value="entregado">Entregado</option>
              <option value="cancelado">Cancelado</option>
            </select>
          </Field>
        </div>

        {/* ─── SECCIÓN COMPRA (proveedor / costo) ─── */}
        <div style={{ gridColumn: "1/-1", marginTop: 4, paddingTop: 10, borderTop: `1px dashed ${COLORS.border}` }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: COLORS.purple, marginBottom: 8 }}>🛒 Compra (reventa)</div>
        </div>
        <div>
          <Field label="Proveedor / comprado a"><input style={inputStyle} value={f.proveedor} onChange={e => set("proveedor", e.target.value)} placeholder="Nombre del proveedor" /></Field>
        </div>
        <div>
          <Field label="Costo de compra ($)"><input style={{ ...inputStyle, borderColor: err.costoCompra ? COLORS.red : COLORS.border }} type="number" value={f.costoCompra} onChange={e => set("costoCompra", e.target.value)} placeholder="0" /></Field>
          {err.costoCompra && <div style={{ color: COLORS.red, fontSize: 11, marginTop: -10, marginBottom: 8 }}>{err.costoCompra}</div>}
        </div>

        {/* ─── SECCIÓN FACTURA DEL CLIENTE (recibida) ─── */}
        <div style={{ gridColumn: "1/-1", marginTop: 4, paddingTop: 10, borderTop: `1px dashed ${COLORS.border}` }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: COLORS.blue, marginBottom: 8 }}>📄 Factura recibida del cliente</div>
        </div>
        <div>
          <Field label="¿Cliente emitió factura?">
            <select style={selectStyle} value={f.factura} onChange={e => set("factura", e.target.value)}>
              <option value="no">No</option>
              <option value="si">Sí</option>
            </select>
          </Field>
        </div>
        {f.factura === "si" && (
          <>
            <div>
              <Field label="N° Factura"><input style={inputStyle} value={f.numFactura} onChange={e => set("numFactura", e.target.value)} placeholder="FAC-2026-001" /></Field>
            </div>
            <div>
              <Field label="Estado de pago" required>
                <select style={{ ...selectStyle, borderColor: err.pago ? COLORS.red : COLORS.border }} value={f.pago} onChange={e => set("pago", e.target.value)}>
                  <option value="pendiente">Sin pagar</option>
                  <option value="pagado">Pagado</option>
                  <option value="parcial">Pago parcial</option>
                </select>
              </Field>
            </div>
            {(f.pago === "pagado" || f.pago === "parcial") && (
              <div>
                <Field label="Fecha de pago"><input style={inputStyle} type="date" value={f.fechaPago} onChange={e => set("fechaPago", e.target.value)} /></Field>
              </div>
            )}
          </>
        )}

        {/* ─── SECCIÓN FACTURA PROPIA (emitida por BFK como vendedor) ─── */}
        <div style={{ gridColumn: "1/-1", marginTop: 4, paddingTop: 10, borderTop: `1px dashed ${COLORS.border}` }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: COLORS.green, marginBottom: 8 }}>🧾 Nuestra factura de venta (BFK al cliente)</div>
        </div>
        <div>
          <Field label="¿BFK ya emitió su factura?">
            <select style={selectStyle} value={f.facturaPropia} onChange={e => set("facturaPropia", e.target.value)}>
              <option value="no">No, pendiente de emitir</option>
              <option value="si">Sí, ya emitida</option>
            </select>
          </Field>
        </div>
        {f.facturaPropia === "si" ? (
          <>
            <div>
              <Field label="N° Nuestra factura"><input style={inputStyle} value={f.numFacturaPropia} onChange={e => set("numFacturaPropia", e.target.value)} placeholder="BFK-2026-001" /></Field>
            </div>
            <div>
              <Field label="Fecha de emisión"><input style={inputStyle} type="date" value={f.fechaFacturaPropia} onChange={e => set("fechaFacturaPropia", e.target.value)} /></Field>
              {f.fechaFacturaPropia && (
                <div style={{ fontSize: 11, color: COLORS.gray, marginTop: -8 }}>
                  💰 Pago esperado: <b style={{ color: COLORS.dark }}>{fmt.date(fechaVencimiento(f.fechaFacturaPropia))}</b> (30 días)
                </div>
              )}
            </div>
          </>
        ) : (
          <div><div style={{ background: COLORS.amberLight, color: COLORS.amber, borderRadius: 6, padding: "8px 12px", fontSize: 12, fontWeight: 600, marginTop: 22 }}>⚠️ Quedará marcada como factura pendiente de emitir por nuestra parte.</div></div>
        )}

        <div style={{ gridColumn: "1/-1" }}>
          <Field label="Notas"><textarea style={{ ...inputStyle, height: 60, resize: "vertical" }} value={f.notas} onChange={e => set("notas", e.target.value)} placeholder="Observaciones opcionales" /></Field>
        </div>
      </div>
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
        <button onClick={onClose} style={{ padding: "8px 18px", borderRadius: 7, border: `1px solid ${COLORS.border}`, background: COLORS.white, cursor: "pointer", fontSize: 13, color: COLORS.dark }}>Cancelar</button>
        <button onClick={handleSave} style={{ padding: "8px 18px", borderRadius: 7, border: "none", background: COLORS.green, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
          {initial ? "Guardar cambios" : "Registrar venta"}
        </button>
      </div>
    </div>
  );
}

// ─── LOGIN SCREEN ─────────────────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [mode, setMode] = useState("login"); // login | signup
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nombre, setNombre] = useState("");
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setErr(""); setInfo("");
    if (!email.trim() || !password) { setErr("Completa correo y contraseña"); return; }
    setLoading(true);
    try {
      const session = await supaSignIn(email.trim(), password);
      await onLogin(session);
    } catch (e) {
      setErr(e.message);
    } finally { setLoading(false); }
  };

  const handleSignup = async () => {
    setErr(""); setInfo("");
    if (!nombre.trim() || !email.trim() || !password) { setErr("Completa todos los campos"); return; }
    if (password.length < 6) { setErr("La contraseña debe tener al menos 6 caracteres"); return; }
    setLoading(true);
    try {
      const data = await supaSignUp(email.trim(), password, nombre.trim());
      if (data.access_token) {
        await onLogin(data);
      } else {
        setInfo("Cuenta creada. Revisa tu correo para confirmar el acceso, luego inicia sesión.");
        setMode("login");
      }
    } catch (e) {
      setErr(e.message);
    } finally { setLoading(false); }
  };

  const submit = () => mode === "login" ? handleLogin() : handleSignup();

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #0F4C3A 0%, #1D9E75 100%)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: COLORS.white, borderRadius: 16, padding: "36px 32px", width: "100%", maxWidth: 380, boxShadow: "0 24px 64px rgba(0,0,0,0.2)" }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ width: 52, height: 52, background: COLORS.green, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px", fontSize: 24 }}>📊</div>
          <div style={{ fontWeight: 800, fontSize: 20, color: COLORS.dark }}>BFK Ltda</div>
          <div style={{ fontSize: 13, color: COLORS.gray, marginTop: 3 }}>Ventas Mercado Público</div>
        </div>

        <div style={{ display: "flex", borderRadius: 8, background: COLORS.grayLight, padding: 3, marginBottom: 20 }}>
          <button onClick={() => { setMode("login"); setErr(""); setInfo(""); }} style={{ flex: 1, padding: "7px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 700, background: mode === "login" ? COLORS.white : "transparent", color: mode === "login" ? COLORS.dark : COLORS.gray, boxShadow: mode === "login" ? "0 1px 3px rgba(0,0,0,0.1)" : "none" }}>Iniciar sesión</button>
          <button onClick={() => { setMode("signup"); setErr(""); setInfo(""); }} style={{ flex: 1, padding: "7px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 700, background: mode === "signup" ? COLORS.white : "transparent", color: mode === "signup" ? COLORS.dark : COLORS.gray, boxShadow: mode === "signup" ? "0 1px 3px rgba(0,0,0,0.1)" : "none" }}>Crear cuenta</button>
        </div>

        {err && <div style={{ background: COLORS.redLight, color: COLORS.red, borderRadius: 7, padding: "8px 12px", fontSize: 13, marginBottom: 14, textAlign: "center" }}>{err}</div>}
        {info && <div style={{ background: COLORS.greenLight, color: COLORS.green, borderRadius: 7, padding: "8px 12px", fontSize: 13, marginBottom: 14, textAlign: "center" }}>{info}</div>}

        {mode === "signup" && (
          <Field label="Nombre completo">
            <input style={inputStyle} value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Tu nombre" onKeyDown={e => e.key === "Enter" && submit()} />
          </Field>
        )}
        <Field label="Correo">
          <input style={inputStyle} type="email" value={email} onChange={e => { setEmail(e.target.value); setErr(""); }} placeholder="correo@ejemplo.com" onKeyDown={e => e.key === "Enter" && submit()} />
        </Field>
        <Field label="Contraseña">
          <input style={inputStyle} type="password" value={password} onChange={e => { setPassword(e.target.value); setErr(""); }} placeholder="••••••••" onKeyDown={e => e.key === "Enter" && submit()} />
        </Field>
        <button onClick={submit} disabled={loading} style={{ width: "100%", padding: "10px", borderRadius: 8, border: "none", background: loading ? COLORS.gray : COLORS.green, color: "#fff", fontWeight: 700, fontSize: 14, cursor: loading ? "default" : "pointer", marginTop: 6 }}>
          {loading ? "Procesando…" : mode === "login" ? "Ingresar" : "Crear cuenta"}
        </button>
        <div style={{ textAlign: "center", fontSize: 11, color: COLORS.gray, marginTop: 16 }}>
          {mode === "login" ? "¿No tienes cuenta? Usa la pestaña \"Crear cuenta\"" : "El primer usuario registrado será administrador."}
        </div>
      </div>
    </div>
  );
}

// ─── USER MANAGER ─────────────────────────────────────────────────────────────
function UserManager({ accessToken, currentUserId }) {
  const [perfiles, setPerfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = async () => {
    setLoading(true);
    try { setPerfiles(await supaListPerfiles(accessToken)); }
    catch { setErr("No se pudieron cargar los usuarios"); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const cambiarRol = async (userId, rolActual) => {
    const nuevoRol = rolActual === "admin" ? "usuario" : "admin";
    try {
      await supaUpdatePerfilRol(accessToken, userId, nuevoRol);
      setPerfiles(prev => prev.map(p => p.id === userId ? { ...p, rol: nuevoRol } : p));
    } catch { setErr("No se pudo actualizar el rol"); }
  };

  if (loading) return <div style={{ textAlign: "center", color: COLORS.gray, fontSize: 13, padding: 20 }}>Cargando usuarios…</div>;

  return (
    <div>
      <div style={{ background: COLORS.blueLight, borderRadius: 8, padding: 12, marginBottom: 16, fontSize: 12, color: COLORS.dark }}>
        ℹ️ Los usuarios se crean desde la pantalla de inicio de sesión ("Crear cuenta"). Aquí puedes ver quién está registrado y cambiar su rol entre <b>admin</b> y <b>usuario</b>.
      </div>
      {err && <div style={{ color: COLORS.red, fontSize: 12, marginBottom: 10 }}>{err}</div>}
      {perfiles.map(p => (
        <div key={p.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", background: COLORS.grayLight, borderRadius: 7, marginBottom: 6 }}>
          <div>
            <span style={{ fontWeight: 600, fontSize: 13 }}>{p.nombre}</span>
            {p.id === currentUserId && <span style={{ fontSize: 10, color: COLORS.gray, marginLeft: 6 }}>(tú)</span>}
            <span style={{ fontSize: 11, marginLeft: 8, background: p.rol === "admin" ? COLORS.purpleLight : COLORS.blueLight, color: p.rol === "admin" ? COLORS.purple : COLORS.blue, padding: "1px 8px", borderRadius: 10, fontWeight: 700 }}>{p.rol}</span>
          </div>
          <button onClick={() => cambiarRol(p.id, p.rol)} style={{ background: COLORS.white, border: `1px solid ${COLORS.border}`, borderRadius: 5, padding: "4px 10px", cursor: "pointer", fontSize: 11, fontWeight: 600, color: COLORS.dark }}>
            Hacer {p.rol === "admin" ? "usuario" : "admin"}
          </button>
        </div>
      ))}
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [session, setSession] = useState(null); // { access_token, refresh_token, user }
  const [perfil, setPerfil] = useState(null); // { id, nombre, rol }
  const [ventas, setVentas] = useState([]);
  const [gastos, setGastos] = useState([]);
  const [ocs, setOcs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dataError, setDataError] = useState("");
  const [modal, setModal] = useState(null); // null | 'nueva' | 'editar' | 'usuarios' | 'confirmar' | 'gasto' | 'gasto-editar' | 'gasto-confirmar' | 'import' | 'oc' | 'oc-editar' | 'oc-confirmar'
  const [editing, setEditing] = useState(null);
  const [editingGasto, setEditingGasto] = useState(null);
  const [editingOC, setEditingOC] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const [gastoToDelete, setGastoToDelete] = useState(null);
  const [ocToDelete, setOcToDelete] = useState(null);
  const [search, setSearch] = useState("");
  const [fEstado, setFEstado] = useState("todos");
  const [fFactura, setFFactura] = useState("todas");
  const [fPago, setFPago] = useState("todo");
  const [fFacturaPropia, setFFacturaPropia] = useState("todas");
  const [toast, setToast] = useState(null);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2800);
  };

  // Carga datos compartidos (ventas, gastos, OCs, perfil) usando el token activo
  const loadData = async (accessToken, userId) => {
    try {
      const [ventasData, gastosData, ocsData, perfilData] = await Promise.all([
        supaSelect("ventas", accessToken, "&order=creadoEn.desc"),
        supaSelect("gastos", accessToken, "&order=creadoEn.desc"),
        supaListOCConItems(accessToken),
        supaGetPerfil(accessToken, userId),
      ]);
      setVentas(ventasData.map(v => ({
        ...v,
        pago: v.pago ?? (v.factura === "si" ? "pendiente" : "n/a"),
        facturaPropia: v.facturaPropia ?? "no",
        numFacturaPropia: v.numFacturaPropia ?? "",
        fechaFacturaPropia: v.fechaFacturaPropia ?? "",
        proveedor: v.proveedor ?? "",
        costoCompra: v.costoCompra ?? 0,
      })));
      setGastos(gastosData);
      setOcs(ocsData);
      setPerfil(perfilData);
      setDataError("");
    } catch (e) {
      setDataError("No se pudieron cargar los datos. Verifica tu conexión.");
    }
  };

  // Init: restaurar sesión guardada localmente (solo el token, los datos viven en Supabase)
  useEffect(() => {
    (async () => {
      const s = await storageGet(SESSION_STORAGE_KEY);
      if (s) {
        try {
          let sess = JSON.parse(s);
          // Intentar refrescar el token por si expiró
          try { sess = await supaRefreshToken(sess.refresh_token); await storageSet(SESSION_STORAGE_KEY, JSON.stringify(sess)); } catch {}
          setSession(sess);
          await loadData(sess.access_token, sess.user.id);
        } catch {}
      }
      setLoading(false);
    })();
  }, []);

  const handleLogin = async (sess) => {
    setSession(sess);
    await storageSet(SESSION_STORAGE_KEY, JSON.stringify(sess));
    await loadData(sess.access_token, sess.user.id);
  };

  const handleLogout = async () => {
    if (session) await supaSignOut(session.access_token);
    setSession(null); setPerfil(null); setVentas([]); setGastos([]);
    await storageSet(SESSION_STORAGE_KEY, "");
  };

  // ── VENTAS: persistencia directa en Supabase, todos comparten la misma data ──
  // Convierte campos de fecha vacíos ("") a null, ya que Postgres rechaza "" en columnas date
  const sanitizeFechas = (obj, campos) => {
    const out = { ...obj };
    campos.forEach(c => { if (out[c] === "") out[c] = null; });
    return out;
  };
  const CAMPOS_FECHA_VENTA = ["fechaVenta", "fechaEntrega", "fechaPago", "fechaFacturaPropia"];

  const handleSave = async (venta) => {
    try {
      if (editing) {
        const { id, creadoEn, ...rest } = venta;
        await supaUpdate("ventas", session.access_token, id, sanitizeFechas(rest, CAMPOS_FECHA_VENTA));
        setVentas(prev => prev.map(v => v.id === venta.id ? venta : v));
      } else {
        const nueva = sanitizeFechas({ ...venta, creado_por: session.user.id }, CAMPOS_FECHA_VENTA);
        await supaInsert("ventas", session.access_token, nueva);
        setVentas(prev => [venta, ...prev]);
      }
      setModal(null); setEditing(null);
      showToast(editing ? "Venta actualizada" : "Venta registrada");
    } catch (e) {
      showToast("Error al guardar: " + e.message, "error");
    }
  };

  const handleDelete = async () => {
    try {
      await supaDelete("ventas", session.access_token, toDelete);
      setVentas(prev => prev.filter(v => v.id !== toDelete));
      setModal(null); setToDelete(null);
      showToast("Venta eliminada", "error");
    } catch (e) {
      showToast("Error al eliminar: " + e.message, "error");
    }
  };

  // ── GASTOS: persistencia directa en Supabase ──
  const handleSaveGasto = async (gasto) => {
    try {
      if (editingGasto) {
        const { id, creadoEn, ...rest } = gasto;
        await supaUpdate("gastos", session.access_token, id, rest);
        setGastos(prev => prev.map(g => g.id === gasto.id ? gasto : g));
      } else {
        const nuevo = { ...gasto, creado_por: session.user.id };
        await supaInsert("gastos", session.access_token, nuevo);
        setGastos(prev => [gasto, ...prev]);
      }
      setModal(null); setEditingGasto(null);
      showToast(editingGasto ? "Gasto actualizado" : "Gasto registrado");
    } catch (e) {
      showToast("Error al guardar: " + e.message, "error");
    }
  };

  const handleDeleteGasto = async () => {
    try {
      await supaDelete("gastos", session.access_token, gastoToDelete);
      setGastos(prev => prev.filter(g => g.id !== gastoToDelete));
      setModal(null); setGastoToDelete(null);
      showToast("Gasto eliminado", "error");
    } catch (e) {
      showToast("Error al eliminar: " + e.message, "error");
    }
  };

  // ── ÓRDENES DE COMPRA: guarda la OC y sincroniza sus ítems (insertar/actualizar/eliminar) ──
  const handleSaveOC = async (oc, itemsNuevos, itemsOriginales) => {
    try {
      const ocSanitizada = sanitizeFechas({ ...oc }, CAMPOS_FECHA_VENTA);
      if (editingOC) {
        const { id, creadoEn, items_oc, ...rest } = ocSanitizada;
        await supaUpdate("ordenes_compra", session.access_token, id, rest);
      } else {
        const { items_oc, ...rest } = ocSanitizada;
        await supaInsert("ordenes_compra", session.access_token, { ...rest, creado_por: session.user.id });
      }

      // Sincronizar ítems: eliminar los que ya no están, actualizar existentes, insertar nuevos
      const idsOriginales = itemsOriginales.map(it => it.id);
      const idsNuevos = itemsNuevos.map(it => it.id);
      const aEliminar = idsOriginales.filter(id => !idsNuevos.includes(id));
      await Promise.all(aEliminar.map(id => supaDelete("items_oc", session.access_token, id)));

      for (const item of itemsNuevos) {
        if (idsOriginales.includes(item.id)) {
          const { id, ...rest } = item;
          await supaUpdate("items_oc", session.access_token, id, rest);
        } else {
          await supaInsert("items_oc", session.access_token, item);
        }
      }

      const ocsActualizadas = await supaListOCConItems(session.access_token);
      setOcs(ocsActualizadas);
      setModal(null); setEditingOC(null);
      showToast(editingOC ? "OC actualizada" : "OC registrada");
    } catch (e) {
      showToast("Error al guardar OC: " + e.message, "error");
    }
  };

  const handleDeleteOC = async () => {
    try {
      await supaDelete("ordenes_compra", session.access_token, ocToDelete); // items_oc se borran en cascada
      setOcs(prev => prev.filter(o => o.id !== ocToDelete));
      setModal(null); setOcToDelete(null);
      showToast("OC eliminada", "error");
    } catch (e) {
      showToast("Error al eliminar: " + e.message, "error");
    }
  };

  const handleImport = async (rows, mode) => {
    try {
      if (mode === "replace") {
        await Promise.all(ventas.map(v => supaDelete("ventas", session.access_token, v.id)));
      }
      const rowsConAutor = rows.map(r => sanitizeFechas({ ...r, creado_por: session.user.id }, CAMPOS_FECHA_VENTA));
      // Insertar en lotes para no saturar la API
      for (let i = 0; i < rowsConAutor.length; i += 50) {
        await supaInsert("ventas", session.access_token, rowsConAutor.slice(i, i + 50));
      }
      setVentas(mode === "replace" ? rows : [...rows, ...ventas]);
      showToast(`${rows.length} ventas importadas correctamente`);
    } catch (e) {
      showToast("Error al importar: " + e.message, "error");
    }
  };

  const exportXLSX = () => {
    const rows = filtered.map(v => ({
      Cliente: v.cliente, Producto: v.producto, Monto: v.monto,
      Proveedor: v.proveedor, "Costo compra": v.costoCompra,
      Margen: (Number(v.monto)||0) - (Number(v.costoCompra)||0),
      "Fecha venta": fmt.date(v.fechaVenta), "Fecha entrega": fmt.date(v.fechaEntrega),
      Estado: v.estado,
      "Factura cliente": v.factura, "N° Factura cliente": v.numFactura,
      Pago: v.pago, "Fecha pago": fmt.date(v.fechaPago),
      "Nuestra factura emitida": v.facturaPropia === "si" ? "Sí" : "No",
      "N° Nuestra factura": v.numFacturaPropia, "Fecha nuestra factura": fmt.date(v.fechaFacturaPropia),
      "Vencimiento pago (30d)": v.facturaPropia === "si" ? fmt.date(fechaVencimiento(v.fechaFacturaPropia)) : "—",
      Notas: v.notas,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Ventas");
    if (gastos.length) {
      const gastoRows = gastos.map(g => ({ Fecha: fmt.date(g.fecha), Concepto: g.concepto, Categoría: g.categoria, Monto: g.monto, Notas: g.notas }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(gastoRows), "Gastos");
    }
    XLSX.writeFile(wb, "BFK_Ventas.xlsx");
    showToast("Exportado a Excel");
  };

  // KPIs
  const kpis = useMemo(() => {
    const total = ventas.length;
    const ingresos = ventas.reduce((s, v) => s + (Number(v.monto) || 0), 0);
    const factEmitidas = ventas.filter(v => v.factura === "si").length;
    const factPagadas = ventas.filter(v => v.pago === "pagado").length;
    const porCobrar = ventas.filter(v => v.factura === "si" && v.pago !== "pagado").reduce((s, v) => s + (Number(v.monto) || 0), 0);
    const entPendientes = ventas.filter(v => v.estado === "pendiente").length;
    // Facturas propias (BFK como vendedor) pendientes de emitir
    const facturasPropiasPendientes = ventas.filter(v => v.facturaPropia !== "si" && v.estado !== "cancelado");
    const montoFacturasPropiasPendientes = facturasPropiasPendientes.reduce((s, v) => s + (Number(v.monto) || 0), 0);
    // Compras / reventa
    const totalCompras = ventas.reduce((s, v) => s + (Number(v.costoCompra) || 0), 0);
    const margen = ingresos - totalCompras;
    const pctMargen = ingresos ? Math.round((margen / ingresos) * 100) : 0;
    // Vencimientos de pago (30 días desde nuestra factura)
    const pendientesPago = ventas.filter(v => v.facturaPropia === "si" && v.pago !== "pagado" && v.fechaFacturaPropia);
    const vencidas = pendientesPago.filter(v => diasParaVencer(fechaVencimiento(v.fechaFacturaPropia)) < 0);
    const porVencer = pendientesPago.filter(v => { const d = diasParaVencer(fechaVencimiento(v.fechaFacturaPropia)); return d >= 0 && d <= 5; });
    return {
      total, ingresos, factEmitidas, factPagadas, porCobrar, entPendientes,
      pctFact: total ? Math.round(factEmitidas / total * 100) : 0,
      pctPag: factEmitidas ? Math.round(factPagadas / factEmitidas * 100) : 0,
      facturasPropiasPendientesCount: facturasPropiasPendientes.length,
      montoFacturasPropiasPendientes,
      totalCompras, margen, pctMargen,
      vencidasCount: vencidas.length, vencidasMonto: vencidas.reduce((s,v)=>s+(Number(v.monto)||0),0),
      porVencerCount: porVencer.length, porVencerMonto: porVencer.reduce((s,v)=>s+(Number(v.monto)||0),0),
    };
  }, [ventas]);

  // Filters
  const filtered = useMemo(() => {
    return ventas.filter(v => {
      const q = search.toLowerCase();
      if (q && !v.cliente.toLowerCase().includes(q) && !v.producto.toLowerCase().includes(q)) return false;
      if (fEstado !== "todos" && v.estado !== fEstado) return false;
      if (fFactura === "con" && v.factura !== "si") return false;
      if (fFactura === "sin" && v.factura === "si") return false;
      if (fPago === "pagadas" && v.pago !== "pagado") return false;
      if (fPago === "sin pagar" && v.pago !== "pendiente") return false;
      if (fPago === "parcial" && v.pago !== "parcial") return false;
      if (fFacturaPropia === "pendientes" && v.facturaPropia === "si") return false;
      if (fFacturaPropia === "emitidas" && v.facturaPropia !== "si") return false;
      return true;
    });
  }, [ventas, search, fEstado, fFactura, fPago, fFacturaPropia]);

  if (loading) return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, color: COLORS.gray }}>Cargando…</div>;
  if (!session) return <LoginScreen onLogin={handleLogin} />;
  if (!perfil) return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, color: COLORS.gray, flexDirection: "column", gap: 10 }}>
    <div>Cargando tu perfil…</div>
    {dataError && <div style={{ color: COLORS.red, fontSize: 13 }}>{dataError}</div>}
  </div>;

  const selStyle = { border: `1px solid ${COLORS.border}`, borderRadius: 6, padding: "6px 10px", fontSize: 12, color: COLORS.dark, background: COLORS.white, cursor: "pointer" };

  return (
    <div style={{ minHeight: "100vh", background: COLORS.bg, fontFamily: "'Inter', system-ui, sans-serif" }}>
      {/* HEADER */}
      <div style={{ background: COLORS.white, borderBottom: `1px solid ${COLORS.border}`, padding: "12px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, position: "sticky", top: 0, zIndex: 50 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 16, color: COLORS.dark }}>BFK Ltda — Ventas Mercado Público</div>
          <div style={{ fontSize: 11, color: COLORS.gray }}>
            Actualizado: {new Date().toLocaleDateString("es-CL")} · {perfil.nombre}
            <span style={{ marginLeft: 8, background: perfil.rol === "admin" ? COLORS.purpleLight : COLORS.grayLight, color: perfil.rol === "admin" ? COLORS.purple : COLORS.gray, padding: "1px 7px", borderRadius: 10, fontSize: 10, fontWeight: 700 }}>{perfil.rol}</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {perfil.rol === "admin" && (
            <>
              <button onClick={() => setModal("import")} style={{ ...selStyle, background: COLORS.purpleLight, color: COLORS.purple, border: "none", fontWeight: 600 }}>📥 Importar Excel</button>
              <button onClick={() => setModal("usuarios")} style={{ ...selStyle, background: COLORS.blueLight, color: COLORS.blue, border: "none", fontWeight: 600 }}>👥 Usuarios</button>
            </>
          )}
          <button onClick={exportXLSX} style={{ ...selStyle, background: COLORS.grayLight, fontWeight: 600 }}>⬇ Exportar Excel</button>
          <button onClick={() => { setEditingOC(null); setModal("oc"); }} style={{ padding: "7px 16px", borderRadius: 7, border: "none", background: COLORS.purple, color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>+ Nueva OC</button>
          <button onClick={() => { setEditing(null); setModal("nueva"); }} style={{ padding: "7px 16px", borderRadius: 7, border: "none", background: COLORS.green, color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>+ Nueva venta</button>
          <button onClick={handleLogout} style={{ ...selStyle, color: COLORS.red }}>Salir</button>
        </div>
      </div>
      {dataError && (
        <div style={{ background: COLORS.redLight, color: COLORS.red, padding: "8px 20px", fontSize: 12, textAlign: "center" }}>{dataError}</div>
      )}

      <div style={{ padding: "18px 20px", maxWidth: 1280, margin: "0 auto" }}>
        {/* KPIs */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
          <KpiCard label="Total ventas" value={kpis.total} sub="registros" />
          <KpiCard label="Ingresos totales" value={fmt.money(kpis.ingresos)} sub="acumulado" color={COLORS.green} />
          <KpiCard label="Facturas emitidas" value={kpis.factEmitidas} sub={`${kpis.pctFact}% facturadas`} color={COLORS.blue} />
          <KpiCard label="Facturas pagadas" value={kpis.factPagadas} sub={`${kpis.pctPag}% de emitidas`} color={COLORS.green} />
          <KpiCard label="Por cobrar ($)" value={fmt.money(kpis.porCobrar)} sub="facturas sin pago" color={COLORS.amber} />
          <KpiCard label="Entregas pendientes" value={kpis.entPendientes} sub="sin entregar" color={kpis.entPendientes > 0 ? COLORS.amber : COLORS.gray} />
          <KpiCard label="Nuestras facturas por emitir" value={kpis.facturasPropiasPendientesCount} sub={fmt.money(kpis.montoFacturasPropiasPendientes)} color={kpis.facturasPropiasPendientesCount > 0 ? COLORS.red : COLORS.gray} />
          <KpiCard label="Total compras" value={fmt.money(kpis.totalCompras)} sub="costo a proveedores" color={COLORS.purple} />
          <KpiCard label="Margen" value={fmt.money(kpis.margen)} sub={`${kpis.pctMargen}% sobre ventas`} color={kpis.margen >= 0 ? COLORS.green : COLORS.red} />
          <KpiCard label="Pagos vencidos (30d)" value={kpis.vencidasCount} sub={fmt.money(kpis.vencidasMonto)} color={kpis.vencidasCount > 0 ? COLORS.red : COLORS.gray} />
        </div>

        {/* ALERTA: Facturas propias pendientes de emitir */}
        {kpis.facturasPropiasPendientesCount > 0 && (
          <div style={{ background: COLORS.redLight, border: `1px solid #FECACA`, borderRadius: 10, padding: "12px 16px", marginBottom: 18, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 22 }}>🧾</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, color: COLORS.red }}>{kpis.facturasPropiasPendientesCount} ventas sin nuestra factura emitida</div>
                <div style={{ fontSize: 12, color: COLORS.dark }}>Suman {fmt.money(kpis.montoFacturasPropiasPendientes)} que BFK aún no ha facturado al cliente.</div>
              </div>
            </div>
            <button onClick={() => { setFFacturaPropia("pendientes"); document.getElementById("tabla-ventas")?.scrollIntoView({ behavior: "smooth" }); }} style={{ padding: "7px 14px", borderRadius: 7, border: "none", background: COLORS.red, color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 12, whiteSpace: "nowrap" }}>Ver detalle</button>
          </div>
        )}

        {/* ALERTA: Pagos vencidos o por vencer (30 días desde nuestra factura) */}
        {(kpis.vencidasCount > 0 || kpis.porVencerCount > 0) && (
          <div style={{ background: COLORS.amberLight, border: `1px solid #FDE68A`, borderRadius: 10, padding: "12px 16px", marginBottom: 18, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 22 }}>⏰</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, color: COLORS.amber }}>
                  {kpis.vencidasCount > 0 && `${kpis.vencidasCount} pago(s) vencido(s) (${fmt.money(kpis.vencidasMonto)})`}
                  {kpis.vencidasCount > 0 && kpis.porVencerCount > 0 && " · "}
                  {kpis.porVencerCount > 0 && `${kpis.porVencerCount} por vencer en ≤5 días (${fmt.money(kpis.porVencerMonto)})`}
                </div>
                <div style={{ fontSize: 12, color: COLORS.dark }}>Plazo de pago acordado: 30 días desde la emisión de nuestra factura.</div>
              </div>
            </div>
            <button onClick={() => document.getElementById("tabla-ventas")?.scrollIntoView({ behavior: "smooth" })} style={{ padding: "7px 14px", borderRadius: 7, border: "none", background: COLORS.amber, color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 12, whiteSpace: "nowrap" }}>Ver detalle</button>
          </div>
        )}

        {/* COMPRAS PENDIENTES (alerta prioritaria) */}
        <ComprasPendientesPanel ocs={ocs} />

        {/* ÓRDENES DE COMPRA */}
        <OCPanel
          ocs={ocs}
          onNuevo={() => { setEditingOC(null); setModal("oc"); }}
          onEditar={(oc) => { setEditingOC(oc); setModal("oc-editar"); }}
          onEliminar={(id) => { setOcToDelete(id); setModal("oc-confirmar"); }}
        />

        {/* CHART */}
        <BarChart ventas={ventas} />
        <ProveedoresPanel ventas={ventas} />
        <GastosPanel
          gastos={gastos}
          kpis={kpis}
          onNuevo={() => { setEditingGasto(null); setModal("gasto"); }}
          onEditar={(g) => { setEditingGasto(g); setModal("gasto-editar"); }}
          onEliminar={(id) => { setGastoToDelete(id); setModal("gasto-confirmar"); }}
        />

        {/* TABLE */}
        <div id="tabla-ventas" style={{ background: COLORS.white, border: `1px solid ${COLORS.border}`, borderRadius: 10 }}>
          <div style={{ padding: "14px 16px", borderBottom: `1px solid ${COLORS.border}`, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <span style={{ fontWeight: 700, fontSize: 13, color: COLORS.dark, marginRight: 4 }}>HISTORIAL DE VENTAS</span>
            <input style={{ ...selStyle, minWidth: 160, flex: 1 }} placeholder="Buscar cliente o producto…" value={search} onChange={e => setSearch(e.target.value)} />
            <select style={selStyle} value={fEstado} onChange={e => setFEstado(e.target.value)}>
              <option value="todos">Todos los estados</option>
              <option value="pendiente">Pendiente</option>
              <option value="entregado">Entregado</option>
              <option value="cancelado">Cancelado</option>
            </select>
            <select style={selStyle} value={fFactura} onChange={e => setFFactura(e.target.value)}>
              <option value="todas">Todas las facturas cliente</option>
              <option value="con">Con factura cliente</option>
              <option value="sin">Sin factura cliente</option>
            </select>
            <select style={selStyle} value={fPago} onChange={e => setFPago(e.target.value)}>
              <option value="todo">Todo pago</option>
              <option value="pagadas">Pagadas</option>
              <option value="sin pagar">Sin pagar</option>
              <option value="parcial">Pago parcial</option>
            </select>
            <select style={{ ...selStyle, color: fFacturaPropia === "pendientes" ? COLORS.red : COLORS.dark, fontWeight: fFacturaPropia === "pendientes" ? 700 : 400 }} value={fFacturaPropia} onChange={e => setFFacturaPropia(e.target.value)}>
              <option value="todas">Nuestra factura: todas</option>
              <option value="pendientes">Nuestra factura: pendientes</option>
              <option value="emitidas">Nuestra factura: emitidas</option>
            </select>
          </div>

          {/* Responsive table wrapper */}
          <div style={{ overflowX: "auto" }}>
            {filtered.length === 0 ? (
              <div style={{ padding: 40, textAlign: "center", color: COLORS.gray, fontSize: 14 }}>
                {ventas.length === 0 ? "No hay ventas registradas. ¡Registra la primera!" : "Sin resultados para los filtros aplicados."}
              </div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: COLORS.grayLight }}>
                    {["Cliente", "Producto / Servicio", "Monto", "Proveedor / Costo", "F. venta", "F. entrega", "Progreso", "Entrega", "Fact. cliente", "Pago", "Nuestra factura", ""].map((h, i) => (
                      <th key={i} style={{ padding: "9px 12px", textAlign: "left", fontWeight: 600, color: COLORS.gray, fontSize: 11, whiteSpace: "nowrap", borderBottom: `1px solid ${COLORS.border}` }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((v, idx) => (
                    <tr key={v.id} style={{ borderBottom: `1px solid ${COLORS.border}`, background: idx % 2 === 0 ? COLORS.white : "#FAFAFA" }}>
                      <td style={{ padding: "10px 12px", fontWeight: 700, color: COLORS.dark, whiteSpace: "nowrap" }}>{v.cliente}</td>
                      <td style={{ padding: "10px 12px", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={v.producto}>{v.producto}</td>
                      <td style={{ padding: "10px 12px", color: COLORS.green, fontWeight: 700, whiteSpace: "nowrap" }}>{fmt.money(v.monto)}</td>
                      <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                        {v.proveedor
                          ? <div><div style={{ fontWeight: 600, color: COLORS.dark, fontSize: 11.5 }}>{v.proveedor}</div><div style={{ color: COLORS.purple, fontSize: 11 }}>{v.costoCompra ? fmt.money(v.costoCompra) : "—"}</div></div>
                          : <span style={{ color: COLORS.gray, fontSize: 11 }}>—</span>}
                      </td>
                      <td style={{ padding: "10px 12px", whiteSpace: "nowrap", color: COLORS.gray }}>{fmt.date(v.fechaVenta)}</td>
                      <td style={{ padding: "10px 12px", whiteSpace: "nowrap", color: COLORS.gray }}>{fmt.date(v.fechaEntrega)}</td>
                      <td style={{ padding: "10px 12px" }}><ProgressBar venta={v} /></td>
                      <td style={{ padding: "10px 12px" }}><Badge type={v.estado} /></td>
                      <td style={{ padding: "10px 12px" }}>
                        {v.factura === "si"
                          ? <span style={{ background: COLORS.blueLight, color: COLORS.blue, padding: "2px 8px", borderRadius: 12, fontSize: 11, fontWeight: 600 }}>{v.numFactura || "Emitida"}</span>
                          : <span style={{ color: COLORS.gray, fontSize: 11 }}>Sin factura</span>}
                      </td>
                      <td style={{ padding: "10px 12px" }}><Badge type={v.pago} /><VencimientoBadge venta={v} /></td>
                      <td style={{ padding: "10px 12px" }}>
                        {v.facturaPropia === "si"
                          ? <span style={{ background: COLORS.greenLight, color: COLORS.green, padding: "2px 8px", borderRadius: 12, fontSize: 11, fontWeight: 600 }}>✓ {v.numFacturaPropia || "Emitida"}</span>
                          : <span style={{ background: COLORS.redLight, color: COLORS.red, padding: "2px 8px", borderRadius: 12, fontSize: 11, fontWeight: 700 }}>⚠ Por emitir</span>}
                      </td>
                      <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                        <button onClick={() => { setEditing(v); setModal("editar"); }} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 15, marginRight: 4 }} title="Editar">✏️</button>
                        <button onClick={() => { setToDelete(v.id); setModal("confirmar"); }} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 15 }} title="Eliminar">🗑️</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {filtered.length > 0 && (
            <div style={{ padding: "10px 16px", fontSize: 11, color: COLORS.gray, borderTop: `1px solid ${COLORS.border}` }}>
              Mostrando {filtered.length} de {ventas.length} ventas
            </div>
          )}
        </div>
      </div>

      {/* MODALS */}
      {modal === "import" && perfil.rol === "admin" && (
        <ImportExcelModal onImport={handleImport} onClose={() => setModal(null)} existingCount={ventas.length} />
      )}
      {modal === "nueva" && (
        <Modal title="Nueva venta" onClose={() => setModal(null)}>
          <VentaForm onSave={handleSave} onClose={() => setModal(null)} />
        </Modal>
      )}
      {modal === "editar" && editing && (
        <Modal title="Editar venta" onClose={() => { setModal(null); setEditing(null); }}>
          <VentaForm initial={editing} onSave={handleSave} onClose={() => { setModal(null); setEditing(null); }} />
        </Modal>
      )}
      {modal === "usuarios" && (
        <Modal title="Gestión de usuarios" onClose={() => setModal(null)}>
          <UserManager accessToken={session.access_token} currentUserId={session.user.id} />
        </Modal>
      )}
      {modal === "confirmar" && (
        <Modal title="Confirmar eliminación" onClose={() => setModal(null)}>
          <p style={{ fontSize: 14, color: COLORS.dark, marginBottom: 20 }}>¿Estás seguro de que deseas eliminar esta venta? Esta acción no se puede deshacer.</p>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button onClick={() => setModal(null)} style={{ padding: "8px 18px", borderRadius: 7, border: `1px solid ${COLORS.border}`, background: COLORS.white, cursor: "pointer", fontSize: 13 }}>Cancelar</button>
            <button onClick={handleDelete} style={{ padding: "8px 18px", borderRadius: 7, border: "none", background: COLORS.red, color: "#fff", fontWeight: 600, cursor: "pointer", fontSize: 13 }}>Eliminar</button>
          </div>
        </Modal>
      )}
      {modal === "gasto" && (
        <Modal title="Registrar gasto" onClose={() => setModal(null)}>
          <GastoForm onSave={handleSaveGasto} onClose={() => setModal(null)} />
        </Modal>
      )}
      {modal === "gasto-editar" && editingGasto && (
        <Modal title="Editar gasto" onClose={() => { setModal(null); setEditingGasto(null); }}>
          <GastoForm initial={editingGasto} onSave={handleSaveGasto} onClose={() => { setModal(null); setEditingGasto(null); }} />
        </Modal>
      )}
      {modal === "gasto-confirmar" && (
        <Modal title="Confirmar eliminación de gasto" onClose={() => setModal(null)}>
          <p style={{ fontSize: 14, color: COLORS.dark, marginBottom: 20 }}>¿Estás seguro de que deseas eliminar este gasto? Esta acción no se puede deshacer.</p>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button onClick={() => setModal(null)} style={{ padding: "8px 18px", borderRadius: 7, border: `1px solid ${COLORS.border}`, background: COLORS.white, cursor: "pointer", fontSize: 13 }}>Cancelar</button>
            <button onClick={handleDeleteGasto} style={{ padding: "8px 18px", borderRadius: 7, border: "none", background: COLORS.red, color: "#fff", fontWeight: 600, cursor: "pointer", fontSize: 13 }}>Eliminar</button>
          </div>
        </Modal>
      )}
      {modal === "oc" && (
        <Modal title="Nueva Orden de Compra" onClose={() => setModal(null)}>
          <OCForm onSave={handleSaveOC} onClose={() => setModal(null)} />
        </Modal>
      )}
      {modal === "oc-editar" && editingOC && (
        <Modal title="Editar Orden de Compra" onClose={() => { setModal(null); setEditingOC(null); }}>
          <OCForm initial={editingOC} onSave={handleSaveOC} onClose={() => { setModal(null); setEditingOC(null); }} />
        </Modal>
      )}
      {modal === "oc-confirmar" && (
        <Modal title="Confirmar eliminación de OC" onClose={() => setModal(null)}>
          <p style={{ fontSize: 14, color: COLORS.dark, marginBottom: 20 }}>¿Estás seguro de que deseas eliminar esta Orden de Compra? Se eliminarán también todos sus ítems. Esta acción no se puede deshacer.</p>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button onClick={() => setModal(null)} style={{ padding: "8px 18px", borderRadius: 7, border: `1px solid ${COLORS.border}`, background: COLORS.white, cursor: "pointer", fontSize: 13 }}>Cancelar</button>
            <button onClick={handleDeleteOC} style={{ padding: "8px 18px", borderRadius: 7, border: "none", background: COLORS.red, color: "#fff", fontWeight: 600, cursor: "pointer", fontSize: 13 }}>Eliminar</button>
          </div>
        </Modal>
      )}

      {/* TOAST */}
      {toast && (
        <div style={{ position: "fixed", bottom: 24, right: 24, background: toast.type === "error" ? COLORS.red : COLORS.green, color: "#fff", padding: "10px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600, boxShadow: "0 4px 16px rgba(0,0,0,0.2)", zIndex: 200 }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
