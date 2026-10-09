import * as XLSX from "xlsx";

// ═══════════════════════════════════════════════════════════════
// Lectura de cartolas BancoEstado (Chequera Electrónica) · conciliación bancaria 2026-10
//
// Dos formatos oficiales:
//  · Cartola en Línea  → hojas Resumen + Registros:   Fecha (dd/mm/aaaa) · Sucursal · N° Operación · Descripción · Cargos · Abonos · Saldo
//  · Cartola Histórica → hojas Resumen + Movimientos: Fecha (dd/mm, sin año) · … · N° Operación · Descripción ·
//                        Cheques / Cargos · Depósitos / Abonos · Saldo
//
// Reglas (todas verificadas contra las cartolas originales):
//  · Las columnas se ubican por el NOMBRE del encabezado, no por posición. Falta una → el archivo se rechaza.
//  · Se conservan el N° de operación (sin ceros a la izquierda) y el saldo de cada línea. El N° de operación
//    NO es único (BancoEstado repite códigos de canal): sirve como referencia y evidencia, nunca como clave.
//  · Montos: solo pesos enteros ("$1.234.567", "$ 98.765", 98765). Un decimal rechaza el archivo.
//  · Año de la histórica: se recorre desde la Fecha Inicio del Resumen y se suma un año al retroceder el mes;
//    la última fecha debe ser la Fecha Final (funciona aunque la cartola abarque más de 12 meses).
//  · Cadena de saldo: saldo inicial + abonos − cargos debe dar el saldo de CADA fila y el saldo final.
//  · Resumen de la histórica: abonos del archivo = Total Abonos + Total Depósitos (BancoEstado informa los
//    depósitos con documentos aparte). Los cargos se validan con la cadena de saldo (en algunas cartolas el
//    Resumen excluye los giros de cajero).
//  · Un archivo con cualquier error se rechaza completo: nunca se usa a medias.
// ═══════════════════════════════════════════════════════════════

const txt = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
export const normalizarOperacion = (v) => txt(v).replace(/^0+(?=\d)/, "");

export function montoEntero(v, ctx = "") {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") {
    if (!Number.isInteger(v)) throw new Error(`${ctx}: monto con decimales (${v})`);
    return v;
  }
  const s = String(v).replace(/[$\s.]/g, "");
  if (s === "") return 0;
  if (!/^-?\d+$/.test(s)) throw new Error(`${ctx}: monto no válido (${v})`);
  return Number(s);
}

const dmyAIso = (dmy) => {
  const p = txt(dmy).split("/");
  if (p.length !== 3 || !/^\d{4}$/.test(p[2])) return null;
  return `${p[2]}-${p[1].padStart(2, "0")}-${p[0].padStart(2, "0")}`;
};

const COLUMNAS = {
  linea: { fecha: "Fecha", operacion: "N° Operación", descripcion: "Descripción", cargo: "Cargos", abono: "Abonos", saldo: "Saldo" },
  historico: { fecha: "Fecha", operacion: "N° Operación", descripcion: "Descripción", cargo: "Cheques / Cargos", abono: "Depósitos / Abonos", saldo: "Saldo" },
};
const sinTilde = (s) => txt(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();

// Clave de un movimiento SIN la glosa: la glosa cambia entre formatos (espacios, truncado) y el N° de operación
// se repite; fecha + cargo + abono + saldo distingue cada línea de la cuenta.
export const claveMovimiento = (m) => `${m.fecha}|${m.cargo}|${m.abono}|${m.saldo}`;

// Lee UN libro de BancoEstado. Nunca lanza: devuelve { errores: [...] } si algo no cuadra.
export function leerCartolaBancoEstado(wb, nombre = "archivo") {
  const base = { nombre, formato: null, numero: null, desde: null, hasta: null, saldoInicial: null, saldoFinal: null, movs: [], errores: [] };
  try {
    const formato = wb?.Sheets?.Registros ? "linea" : wb?.Sheets?.Movimientos ? "historico" : null;
    if (!formato) return { ...base, errores: ["No es una cartola de BancoEstado: falta la hoja Registros o Movimientos"] };
    const resumen = {};
    for (const f of XLSX.utils.sheet_to_json(wb.Sheets.Resumen || {}, { header: 1, defval: "" })) {
      const k = txt(f[0]); if (k && !(k in resumen)) resumen[k] = f[4];
    }
    const [hdr = [], ...filas] = XLSX.utils.sheet_to_json(wb.Sheets[formato === "linea" ? "Registros" : "Movimientos"], { header: 1, raw: true, defval: "" });
    const idx = {};
    for (const [k, nombreCol] of Object.entries(COLUMNAS[formato])) {
      idx[k] = hdr.findIndex((h) => sinTilde(h) === sinTilde(nombreCol));
      if (idx[k] < 0) return { ...base, formato, errores: [`Falta la columna «${nombreCol}»`] };
    }
    const errores = [];
    const desdeR = formato === "historico" ? dmyAIso(resumen["Fecha Inicio"]) : null;
    const hastaR = formato === "historico" ? dmyAIso(resumen["Fecha Final"]) : null;
    if (formato === "historico" && (!desdeR || !hastaR)) return { ...base, formato, errores: ["El Resumen no trae Fecha Inicio y Fecha Final"] };
    let anio = desdeR ? Number(desdeR.slice(0, 4)) : null, mesPrevio = desdeR ? Number(desdeR.slice(5, 7)) : null;
    const movs = [];
    filas.forEach((r, k) => {
      if (!txt(r[idx.fecha])) return;
      const ctx = `fila ${k + 2}`;
      let fecha;
      if (formato === "linea") {
        fecha = dmyAIso(r[idx.fecha]);
        if (!fecha) { errores.push(`${ctx}: fecha no válida (${r[idx.fecha]})`); return; }
      } else {
        const [d, m] = txt(r[idx.fecha]).split("/");
        if (!(Number(d) >= 1 && Number(d) <= 31 && Number(m) >= 1 && Number(m) <= 12)) { errores.push(`${ctx}: fecha no válida (${r[idx.fecha]})`); return; }
        if (Number(m) < mesPrevio) anio++;
        mesPrevio = Number(m);
        fecha = `${anio}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      }
      try {
        movs.push({ fecha, operacion: normalizarOperacion(r[idx.operacion]), descripcion: txt(r[idx.descripcion]),
          cargo: montoEntero(r[idx.cargo], ctx), abono: montoEntero(r[idx.abono], ctx), saldo: montoEntero(r[idx.saldo], ctx), archivo: nombre, fila: k + 2 });
      } catch (e) { errores.push(e.message); }
    });
    if (!movs.length && !errores.length) errores.push("La cartola no trae movimientos");
    let saldoInicial = null, saldoFinal = null;
    try {
      saldoInicial = montoEntero(formato === "linea" ? resumen["Inicial"] : resumen["Saldo Inicial"], "Resumen");
      saldoFinal = montoEntero(formato === "linea" ? resumen["Saldo Contable"] : resumen["Saldo Final"], "Resumen");
    } catch (e) { errores.push(e.message); }
    if (!errores.length) {
      let s = saldoInicial;
      for (const m of movs) {
        if (m.cargo && m.abono) errores.push(`fila ${m.fila}: trae cargo y abono a la vez`);
        s += m.abono - m.cargo;
        if (s !== m.saldo) { errores.push(`El saldo no cuadra en la fila ${m.fila} (${m.fecha}): se esperaba ${s}, la cartola dice ${m.saldo}`); break; }
      }
      if (!errores.length && s !== saldoFinal) errores.push(`El saldo final calculado (${s}) no coincide con el del Resumen (${saldoFinal})`);
      if (formato === "historico") {
        if (movs.at(-1).fecha !== hastaR) errores.push(`La última fecha (${movs.at(-1).fecha}) no coincide con la Fecha Final del Resumen (${hastaR})`);
        if (movs.some((m) => m.fecha < desdeR || m.fecha > hastaR)) errores.push("Hay fechas fuera del rango del Resumen");
        const declarados = Number(txt(resumen["N° Movimientos"]));
        if (Number.isFinite(declarados) && declarados > 0 && declarados !== movs.length) errores.push(`El Resumen declara ${declarados} movimientos y el archivo trae ${movs.length}`);
        try {
          const abonos = movs.reduce((a, m) => a + m.abono, 0);
          const decl = montoEntero(resumen["Total Abonos"], "Resumen") + montoEntero(resumen["Total Depósitos"], "Resumen");
          if (abonos !== decl) errores.push(`Los abonos (${abonos}) no coinciden con Total Abonos + Total Depósitos del Resumen (${decl})`);
        } catch (e) { errores.push(e.message); }
      }
    }
    return { ...base, formato, numero: txt(resumen["N° Cartola"]) || null, desde: desdeR || movs[0]?.fecha || null, hasta: hastaR || movs.at(-1)?.fecha || null,
      saldoInicial, saldoFinal, movs: errores.length ? [] : movs, errores };
  } catch (e) {
    return { ...base, errores: ["No se pudo leer el archivo: " + e.message] };
  }
}

// Une varias cartolas ya leídas.
//  · Solo se usan las que no tienen errores (las otras se informan como rechazadas).
//  · Deduplicación por multiconjunto: para cada clave se conserva el MÁXIMO de veces que aparece en un mismo
//    archivo. Así un archivo repetido o el mismo período en el otro formato no duplican nada, y dos líneas
//    reales idénticas de un mismo día (p. ej. dos giros) se conservan.
//  · Continuidad: el saldo final de un tramo debe ser el saldo inicial del siguiente; si no, falta una cartola.
export function unirCartolas(cartolas) {
  const rechazadas = (cartolas || []).filter((c) => c.errores.length).map((c) => ({ nombre: c.nombre, errores: c.errores }));
  const validas = (cartolas || []).filter((c) => !c.errores.length);
  const maximo = new Map(), ejemplos = new Map();
  for (const c of validas) {
    const n = new Map();
    for (const m of c.movs) {
      const k = claveMovimiento(m);
      n.set(k, (n.get(k) || 0) + 1);
      if (!ejemplos.has(k)) ejemplos.set(k, []);
      ejemplos.get(k).push(m);
    }
    for (const [k, v] of n) maximo.set(k, Math.max(maximo.get(k) || 0, v));
  }
  // Orden de la cuenta: por tramo (fecha) y luego por fila dentro del archivo.
  const orden = new Map(validas.map((c) => [c.nombre, c.desde || ""]));
  const movs = [...maximo].flatMap(([k, n]) => ejemplos.get(k).slice(0, n))
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || String(orden.get(a.archivo)).localeCompare(String(orden.get(b.archivo))) || a.fila - b.fila)
    .map((m) => ({ ...m, clave: claveMovimiento(m) }));
  const leidos = validas.reduce((s, c) => s + c.movs.length, 0);
  const tramos = [...new Map(validas.map((c) => [`${c.desde}|${c.hasta}|${c.saldoInicial}|${c.saldoFinal}`, c])).values()]
    .sort((a, b) => String(a.desde).localeCompare(String(b.desde)) || String(a.hasta).localeCompare(String(b.hasta)));
  const archivosRepetidos = validas.length - tramos.length;
  const faltantes = [];
  for (let i = 1; i < tramos.length; i++) {
    const a = tramos[i - 1], b = tramos[i];
    if (a.saldoFinal !== b.saldoInicial)
      faltantes.push({ despuesDe: a.hasta, antesDe: b.desde, saldoEsperado: a.saldoFinal, saldoEncontrado: b.saldoInicial, neto: b.saldoInicial - a.saldoFinal });
  }
  return { movs, leidos, duplicadosQuitados: leidos - movs.length, archivosRepetidos, faltantes, rechazadas, tramos: tramos.map((c) => ({ nombre: c.nombre, formato: c.formato, numero: c.numero, desde: c.desde, hasta: c.hasta, saldoInicial: c.saldoInicial, saldoFinal: c.saldoFinal, n: c.movs.length })) };
}

// Totales por mes de la cartola (base de banco_mensual): entradas, salidas y saldo del último movimiento del mes.
export function totalesPorMes(movs) {
  const meses = {};
  for (const m of movs || []) {
    const k = String(m.fecha).slice(0, 7);
    if (!meses[k]) meses[k] = { entro: 0, salio: 0, saldo: null };
    meses[k].entro += m.abono || 0;
    meses[k].salio += m.cargo || 0;
    if (m.saldo != null) meses[k].saldo = m.saldo;
  }
  return Object.entries(meses).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => ({
    id: k, anio: Number(k.slice(0, 4)), mes: Number(k.slice(5, 7)), entro: v.entro, salio: v.salio, saldo_cierre: v.saldo,
  }));
}
