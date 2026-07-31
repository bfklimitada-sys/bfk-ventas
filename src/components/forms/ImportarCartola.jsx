import { useState } from "react";
import * as XLSX from "xlsx";
import { C, MONO, SANS, btnP, btnG, fmt } from "../../lib/theme";

const aNumero = (v) => {
  if (v === null || v === undefined) return 0;
  const s = String(v).replace(/\$/g, "").replace(/\./g, "").replace(/,/g, "").trim();
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};
const soloDigitos = (s) => String(s || "").replace(/[^0-9kK]/g, "").toUpperCase();

// ── Lectura de cartolas de BancoEstado ──────────────────────
// Vienen en dos formatos:
//  · "Cartola en Línea"  → hoja Registros,   fecha completa (20/07/2026)
//  · "Cartola Histórica" → hoja Movimientos, fecha sin año (15/07)
export function leerCartola(workbook) {
  const movimientos = [];

  // ── Formato en línea ──
  const registros = workbook.Sheets["Registros"];
  if (registros) {
    const filas = XLSX.utils.sheet_to_json(registros, { header: 1 });
    for (let i = 1; i < filas.length; i++) {
      const f = filas[i];
      if (!f || !f[0]) continue;
      const p = String(f[0]).split("/");
      if (p.length < 3) continue;
      movimientos.push({
        fecha: `${p[2]}-${p[1].padStart(2, "0")}-${p[0].padStart(2, "0")}`,
        descripcion: String(f[3] || "").trim(),
        cargo: aNumero(f[4]),
        abono: aNumero(f[5]),
      });
    }
    return movimientos;
  }

  // ── Formato histórico ──
  const hoja = workbook.Sheets["Movimientos"];
  if (!hoja) return movimientos;

  let anioIni = null, anioFin = null, mesIni = null;
  const resumen = workbook.Sheets["Resumen"];
  if (resumen) {
    for (const f of XLSX.utils.sheet_to_json(resumen, { header: 1 })) {
      const k = String(f[0] || ""), v = String(f[4] || "");
      if (k === "Fecha Inicio" && v.includes("/")) { const p = v.split("/"); mesIni = Number(p[1]); anioIni = Number(p[2]); }
      if (k === "Fecha Final" && v.includes("/")) anioFin = Number(v.split("/")[2]);
    }
  }

  for (const f of XLSX.utils.sheet_to_json(hoja, { header: 1 }).slice(1)) {
    if (!f || !f[0]) continue;
    const p = String(f[0]).split("/");
    if (p.length < 2) continue;
    const dia = Number(p[0]), mes = Number(p[1]);
    const anio = (anioIni === anioFin || !anioFin) ? anioIni : (mes >= mesIni ? anioIni : anioFin);
    if (!anio) continue;
    movimientos.push({
      fecha: `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`,
      descripcion: String(f[6] || "").trim(),
      cargo: aNumero(f[7]),
      abono: aNumero(f[8]),
    });
  }
  return movimientos;
}

// ── Puntaje de coincidencia entre un abono y una factura ────
// El monto siempre debe calzar. El RUT y el nombre desempatan.
function puntuar(abono, oc) {
  let puntos = 0;
  const desc = abono.descripcion.toUpperCase();

  const rutOC = soloDigitos(oc.rut_cliente);
  if (rutOC.length > 6) {
    const rutsEnDesc = (desc.match(/\d{7,9}\s*-?\s*[0-9K]/g) || []).map(soloDigitos);
    if (rutsEnDesc.some(r => r === rutOC)) puntos += 100;
  }

  // Palabras distintivas del cliente que aparezcan en la descripción
  const ignorar = new Set(["ILUSTRE", "MUNICIPALIDAD", "MUNIC", "DE", "DEL", "LA", "EL", "SERVICIO", "SALUD", "DEPARTAMENTO"]);
  const palabras = String(oc.cliente || "").toUpperCase().split(/[^A-ZÁÉÍÓÚÑ]+/)
    .filter(p => p.length >= 5 && !ignorar.has(p));
  if (palabras.some(p => desc.includes(p))) puntos += 40;

  // Cercanía con la fecha de la factura: lo normal es cobrar después de emitir
  const evF = (oc.eventos_factura || [])[0];
  if (evF?.fecha) {
    const dias = (new Date(abono.fecha) - new Date(String(evF.fecha).slice(0, 10))) / 86400000;
    if (dias >= 0 && dias <= 90) puntos += 10;
    if (dias < 0) puntos -= 50;   // un cobro anterior a la factura es improbable
  }
  return puntos;
}

export function ImportarCartola({ ocs, onRegistrar }) {
  const [movs, setMovs] = useState([]);
  const [items, setItems] = useState([]);      // un item por abono con calce posible
  const [elegido, setElegido] = useState({});  // idx -> ocId seleccionado ("" = ninguno)
  const [leyendo, setLeyendo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [err, setErr] = useState("");

  const procesar = async (files) => {
    if (!files?.length) return;
    setLeyendo(true); setErr("");
    try {
      let todos = [];
      for (const file of files) {
        const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
        todos = todos.concat(leerCartola(wb));
      }
      const vistos = new Set();
      const unicos = todos.filter(m => {
        const k = `${m.fecha}|${m.descripcion}|${m.abono}|${m.cargo}`;
        if (vistos.has(k)) return false;
        vistos.add(k); return true;
      }).sort((a, b) => a.fecha.localeCompare(b.fecha));
      setMovs(unicos);
      calzar(unicos);
    } catch (e) {
      setErr("No se pudo leer el archivo: " + e.message);
    } finally { setLeyendo(false); }
  };

  const calzar = (movimientos) => {
    const pendientes = ocs
      .filter(o => (o.tipo_registro || "venta") === "venta"
        && o.estado_factura_propia === "emitida"
        && o.estado_pago_cliente !== "pagado")
      .map(o => ({ oc: o, saldo: (Number(o.monto_facturado) || 0) - (Number(o.monto_cobrado) || 0) }))
      .filter(x => x.saldo > 0);

    const resultado = [];
    const yaPropuestas = new Set();

    for (const mov of movimientos.filter(m => m.abono > 0)) {
      const candidatos = pendientes
        .filter(p => p.saldo === mov.abono && !yaPropuestas.has(p.oc.id))
        .map(p => ({ ...p, puntos: puntuar(mov, p.oc) }))
        .sort((a, b) => b.puntos - a.puntos);

      if (!candidatos.length) continue;

      const mejor = candidatos[0];
      const segundo = candidatos[1];
      // Es claro si hay un solo candidato, o si el primero saca ventaja
      const claro = candidatos.length === 1 || (mejor.puntos - (segundo?.puntos ?? 0)) >= 40;

      if (claro) yaPropuestas.add(mejor.oc.id);
      resultado.push({ mov, candidatos, sugerido: claro ? mejor.oc.id : "", claro });
    }

    setItems(resultado);
    setElegido(Object.fromEntries(resultado.map((r, i) => [i, r.sugerido])));
  };

  const registrar = async () => {
    const cobros = items
      .map((it, i) => ({ it, ocId: elegido[i] }))
      .filter(x => x.ocId)
      .map(({ it, ocId }) => {
        const c = it.candidatos.find(c => c.oc.id === ocId);
        return { ocId, numeroOc: c.oc.numero_oc, monto: c.saldo,
                 fecha: it.mov.fecha, descripcion: it.mov.descripcion };
      });
    if (!cobros.length) { setErr("No hay ningún cobro seleccionado"); return; }
    const ids = cobros.map(c => c.ocId);
    if (new Set(ids).size !== ids.length) { setErr("Hay una OC asignada a dos abonos distintos"); return; }
    setErr(""); setGuardando(true);
    try { await onRegistrar(cobros); }
    catch (e) { setErr(e.message); setGuardando(false); }
  };

  const nSel = Object.values(elegido).filter(Boolean).length;
  const totalSel = items.reduce((s, it, i) => {
    const c = it.candidatos.find(c => c.oc.id === elegido[i]);
    return s + (c ? c.saldo : 0);
  }, 0);

  if (!movs.length) {
    return (
      <div style={{ fontFamily: SANS }}>
        <div style={{ background: C.tealLight, borderRadius: 10, padding: "12px 14px", marginBottom: 16 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: C.tealDark, marginBottom: 5 }}>Cómo obtener la cartola</div>
          <div style={{ fontSize: 12, color: C.inkMuted, lineHeight: 1.55 }}>
            En BancoEstado Empresas descarga la Cartola en Línea o la Histórica de
            Chequera Electrónica. Lee ambos formatos y puedes subir varias a la vez.
          </div>
        </div>
        <label style={{ ...btnG, display: "block", textAlign: "center", cursor: "pointer", padding: "16px" }}>
          {leyendo ? "Leyendo…" : "📄 Elegir cartola(s)"}
          <input type="file" accept=".xlsx,.xls" multiple disabled={leyendo}
            onChange={e => procesar(Array.from(e.target.files || []))} style={{ display: "none" }} />
        </label>
        {err && <div style={{ background: C.dangerLight, color: C.danger, borderRadius: 8, padding: "8px 12px", fontSize: 12.5, marginTop: 12, fontWeight: 600 }}>{err}</div>}
        <div style={{ fontSize: 11.5, color: C.inkFaint, marginTop: 14, lineHeight: 1.5 }}>
          Los abonos se cruzan por monto, y el RUT o el nombre del pagador
          desempatan cuando hay varias facturas del mismo valor.
        </div>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: SANS }}>
      <div style={{ background: C.paper, borderRadius: 10, padding: "10px 13px", marginBottom: 14, fontSize: 12, color: C.inkMuted }}>
        {movs.length} movimientos · {movs.filter(m => m.abono > 0).length} abonos · {items.length} con calce posible
      </div>

      {items.length === 0 ? (
        <div style={{ textAlign: "center", padding: "24px 0", color: C.inkFaint, fontSize: 13 }}>
          Ningún abono calza con una factura pendiente
        </div>
      ) : (
        <>
          {items.map((it, i) => {
            const sel = elegido[i];
            return (
              <div key={i} style={{
                background: sel ? C.okLight : C.card,
                border: `1px solid ${sel ? C.ok : it.claro ? C.border : C.warn}`,
                borderRadius: 10, padding: "10px 12px", marginBottom: 7,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontSize: 11.5, color: C.inkMuted, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {fmt.date(it.mov.fecha)} · {it.mov.descripcion}
                  </span>
                  <span style={{ fontFamily: MONO, fontWeight: 800, fontSize: 12.5, color: C.ok, flexShrink: 0 }}>
                    {fmt.money(it.mov.abono)}
                  </span>
                </div>

                {!it.claro && (
                  <div style={{ fontSize: 10.5, color: C.warn, fontWeight: 700, margin: "5px 0 3px" }}>
                    ⚠ {it.candidatos.length} facturas de ese monto — elige cuál corresponde
                  </div>
                )}

                <select value={sel || ""} onChange={e => setElegido(m => ({ ...m, [i]: e.target.value }))}
                  style={{ width: "100%", marginTop: 6, padding: "7px 9px", borderRadius: 8, fontSize: 12,
                    border: `1px solid ${C.border}`, background: C.card, color: C.ink, fontFamily: SANS }}>
                  <option value="">— No registrar este abono —</option>
                  {it.candidatos.map(c => (
                    <option key={c.oc.id} value={c.oc.id}>
                      {c.oc.numero_oc}{c.oc.cliente ? ` · ${String(c.oc.cliente).slice(0, 28)}` : ""}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}

          {err && <div style={{ background: C.dangerLight, color: C.danger, borderRadius: 8, padding: "8px 12px", fontSize: 12.5, margin: "10px 0", fontWeight: 600 }}>{err}</div>}

          <button onClick={registrar} disabled={guardando || !nSel} style={{ ...btnP(guardando || !nSel ? C.inkFaint : C.ok), marginTop: 8 }}>
            {guardando ? "Registrando…" : `✓ Registrar ${nSel} cobro${nSel !== 1 ? "s" : ""} · ${fmt.money(totalSel)}`}
          </button>
        </>
      )}

      <button onClick={() => { setMovs([]); setItems([]); setElegido({}); setErr(""); }}
        style={{ ...btnG, width: "100%", marginTop: 12, fontSize: 12 }}>
        Subir otra cartola
      </button>
    </div>
  );
}
