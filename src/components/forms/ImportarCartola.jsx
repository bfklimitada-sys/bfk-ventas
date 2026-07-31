import { useState } from "react";
import * as XLSX from "xlsx";
import { C, MONO, SANS, btnP, btnG, fmt } from "../../lib/theme";

// ── Lectura de la cartola de BancoEstado ────────────────────
// La hoja "Movimientos" trae la fecha sin año (ej "15/07"), así que
// el año se deduce del rango que aparece en la hoja "Resumen".
const aNumero = (v) => {
  if (v === null || v === undefined) return 0;
  const s = String(v).replace(/\$/g, "").replace(/\./g, "").replace(/,/g, "").trim();
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

export function leerCartola(workbook) {
  const movimientos = [];
  const resumen = workbook.Sheets["Resumen"];
  let anioIni = null, anioFin = null, mesIni = null;

  if (resumen) {
    const filas = XLSX.utils.sheet_to_json(resumen, { header: 1 });
    for (const f of filas) {
      const clave = String(f[0] || "");
      const valor = String(f[4] || "");
      if (clave === "Fecha Inicio" && valor.includes("/")) {
        const p = valor.split("/"); mesIni = Number(p[1]); anioIni = Number(p[2]);
      }
      if (clave === "Fecha Final" && valor.includes("/")) anioFin = Number(valor.split("/")[2]);
    }
  }

  const hoja = workbook.Sheets["Movimientos"];
  if (!hoja) return movimientos;

  const filas = XLSX.utils.sheet_to_json(hoja, { header: 1 });
  for (let i = 1; i < filas.length; i++) {
    const f = filas[i];
    if (!f || !f[0]) continue;
    const partes = String(f[0]).split("/");
    if (partes.length < 2) continue;
    const dia = Number(partes[0]), mes = Number(partes[1]);
    // Si la cartola cruza el año, los meses >= al inicial son del año inicial
    const anio = (anioIni === anioFin || !anioFin) ? anioIni
      : (mes >= mesIni ? anioIni : anioFin);
    if (!anio) continue;

    const abono = aNumero(f[8]);
    const cargo = aNumero(f[7]);
    if (!abono && !cargo) continue;

    movimientos.push({
      fecha: `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`,
      operacion: String(f[5] || "").trim(),
      descripcion: String(f[6] || "").trim(),
      cargo, abono,
    });
  }
  return movimientos;
}

export function ImportarCartola({ ocs, onRegistrar }) {
  const [movs, setMovs] = useState([]);
  const [propuestas, setPropuestas] = useState([]);
  const [sinCalce, setSinCalce] = useState([]);
  const [marcadas, setMarcadas] = useState({});
  const [leyendo, setLeyendo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [err, setErr] = useState("");

  const procesar = async (files) => {
    if (!files?.length) return;
    setLeyendo(true); setErr("");
    try {
      let todos = [];
      for (const file of files) {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        todos = todos.concat(leerCartola(wb));
      }
      // Quitar movimientos repetidos entre cartolas que se solapan
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
    // Facturas emitidas sin cobrar del todo
    const pendientes = ocs
      .filter(o => (o.tipo_registro || "venta") === "venta"
        && o.estado_factura_propia === "emitida"
        && o.estado_pago_cliente !== "pagado")
      .map(o => ({ oc: o, saldo: (Number(o.monto_facturado) || 0) - (Number(o.monto_cobrado) || 0) }))
      .filter(x => x.saldo > 0);

    const abonos = movimientos.filter(m => m.abono > 0);
    const usados = new Set();
    const props = [];

    for (const p of pendientes) {
      const candidatos = abonos
        .map((a, i) => ({ a, i }))
        .filter(({ a, i }) => !usados.has(i) && a.abono === p.saldo);
      if (!candidatos.length) continue;
      const elegido = candidatos[0];
      usados.add(elegido.i);
      props.push({
        ocId: p.oc.id, numeroOc: p.oc.numero_oc, cliente: p.oc.cliente,
        monto: p.saldo, fecha: elegido.a.fecha,
        descripcion: elegido.a.descripcion,
        ambiguo: candidatos.length > 1,
      });
    }

    setPropuestas(props);
    setMarcadas(Object.fromEntries(props.map(p => [p.ocId, true])));
    setSinCalce(abonos.filter((_, i) => !usados.has(i)));
  };

  const registrar = async () => {
    const elegidas = propuestas.filter(p => marcadas[p.ocId]);
    if (!elegidas.length) { setErr("Marca al menos un cobro"); return; }
    setErr(""); setGuardando(true);
    try { await onRegistrar(elegidas); }
    catch (e) { setErr(e.message); setGuardando(false); }
  };

  const nMarcadas = propuestas.filter(p => marcadas[p.ocId]).length;
  const totalMarcado = propuestas.filter(p => marcadas[p.ocId]).reduce((s, p) => s + p.monto, 0);

  // ── Pantalla inicial ──
  if (!movs.length) {
    return (
      <div style={{ fontFamily: SANS }}>
        <div style={{ background: C.tealLight, borderRadius: 10, padding: "12px 14px", marginBottom: 16 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: C.tealDark, marginBottom: 5 }}>Cómo obtener la cartola</div>
          <div style={{ fontSize: 12, color: C.inkMuted, lineHeight: 1.55 }}>
            En BancoEstado Empresas entra a Cartola Histórica de Chequera Electrónica,
            elige el periodo y descarga el Excel. Puedes subir varias a la vez.
          </div>
        </div>

        <label style={{ ...btnG, display: "block", textAlign: "center", cursor: "pointer", padding: "16px" }}>
          {leyendo ? "Leyendo…" : "📄 Elegir cartola(s)"}
          <input type="file" accept=".xlsx,.xls" multiple disabled={leyendo}
            onChange={e => procesar(Array.from(e.target.files || []))} style={{ display: "none" }} />
        </label>

        {err && <div style={{ background: C.dangerLight, color: C.danger, borderRadius: 8, padding: "8px 12px", fontSize: 12.5, marginTop: 12, fontWeight: 600 }}>{err}</div>}

        <div style={{ fontSize: 11.5, color: C.inkFaint, marginTop: 14, lineHeight: 1.5 }}>
          La app compara los abonos con las facturas pendientes y te propone
          qué cobros registrar. Nada se guarda sin que lo confirmes.
        </div>
      </div>
    );
  }

  // ── Resultados ──
  return (
    <div style={{ fontFamily: SANS }}>
      <div style={{ background: C.paper, borderRadius: 10, padding: "10px 13px", marginBottom: 14, fontSize: 12, color: C.inkMuted }}>
        {movs.length} movimientos leídos · {movs.filter(m => m.abono > 0).length} abonos
      </div>

      {propuestas.length === 0 ? (
        <div style={{ textAlign: "center", padding: "24px 0", color: C.inkFaint, fontSize: 13 }}>
          Ningún abono calza con una factura pendiente
        </div>
      ) : (
        <>
          <div style={{ fontSize: 11, fontWeight: 800, color: C.inkMuted, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 }}>
            {propuestas.length} cobro{propuestas.length !== 1 ? "s" : ""} detectado{propuestas.length !== 1 ? "s" : ""}
          </div>

          {propuestas.map(p => (
            <label key={p.ocId} style={{
              display: "flex", alignItems: "flex-start", gap: 9, cursor: "pointer",
              background: marcadas[p.ocId] ? C.okLight : C.card,
              border: `1px solid ${marcadas[p.ocId] ? C.ok : C.border}`,
              borderRadius: 10, padding: "10px 12px", marginBottom: 6,
            }}>
              <input type="checkbox" checked={!!marcadas[p.ocId]} style={{ marginTop: 3 }}
                onChange={e => setMarcadas(m => ({ ...m, [p.ocId]: e.target.checked }))} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontFamily: MONO, fontSize: 12, fontWeight: 700, color: C.ink }}>{p.numeroOc}</span>
                <span style={{ display: "block", fontSize: 11, color: C.inkMuted, marginTop: 1 }}>
                  {fmt.date(p.fecha)} · {p.descripcion.slice(0, 34)}
                </span>
                {p.ambiguo && (
                  <span style={{ display: "block", fontSize: 10.5, color: C.warn, fontWeight: 700, marginTop: 2 }}>
                    ⚠ Hay más de un abono por ese monto — verifica cuál corresponde
                  </span>
                )}
              </span>
              <span style={{ fontFamily: MONO, fontWeight: 800, fontSize: 12.5, color: C.ok, flexShrink: 0 }}>
                {fmt.money(p.monto)}
              </span>
            </label>
          ))}

          {err && <div style={{ background: C.dangerLight, color: C.danger, borderRadius: 8, padding: "8px 12px", fontSize: 12.5, margin: "10px 0", fontWeight: 600 }}>{err}</div>}

          <button onClick={registrar} disabled={guardando || !nMarcadas} style={{ ...btnP(guardando || !nMarcadas ? C.inkFaint : C.ok), marginTop: 8 }}>
            {guardando ? "Registrando…" : `✓ Registrar ${nMarcadas} cobro${nMarcadas !== 1 ? "s" : ""} · ${fmt.money(totalMarcado)}`}
          </button>
        </>
      )}

      {sinCalce.length > 0 && (
        <details style={{ marginTop: 16 }}>
          <summary style={{ fontSize: 11.5, color: C.inkFaint, cursor: "pointer", padding: "6px 0", listStyle: "none" }}>
            ▸ {sinCalce.length} abonos sin calce ({fmt.money(sinCalce.reduce((s, m) => s + m.abono, 0))})
          </summary>
          <div style={{ fontSize: 11, color: C.inkFaint, margin: "6px 0 8px", lineHeight: 1.5 }}>
            Pueden ser cobros de facturas ya registradas, aportes de socios o pagos agrupados.
          </div>
          {sinCalce.slice(0, 25).map((m, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "5px 0", borderBottom: `1px solid ${C.border}`, fontSize: 11 }}>
              <span style={{ color: C.inkMuted, minWidth: 0 }}>{fmt.date(m.fecha)} · {m.descripcion.slice(0, 30)}</span>
              <span style={{ fontFamily: MONO, color: C.ink, flexShrink: 0 }}>{fmt.money(m.abono)}</span>
            </div>
          ))}
        </details>
      )}

      <button onClick={() => { setMovs([]); setPropuestas([]); setSinCalce([]); setErr(""); }}
        style={{ ...btnG, width: "100%", marginTop: 12, fontSize: 12 }}>
        Subir otra cartola
      </button>
    </div>
  );
}
