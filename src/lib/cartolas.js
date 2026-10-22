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
//
// Solo revisión (22/10/2026): si el archivo se pudo LEER pero no cuadra (saldo, totales, cantidad o fechas del
// Resumen), sigue rechazado para conciliar (movs: [], errores con el detalle técnico), pero además entrega:
//  · soloRevision: true y movsRevision: sus movimientos, solo para consultarlos (fecha, operación, monto, saldo);
//  · diagnostico: las diferencias en palabras simples, sin suponer qué operaciones las explican.
// Un archivo que no se puede leer (formato, columnas, fechas o montos no válidos) no trae nada para revisar.
// ═══════════════════════════════════════════════════════════════

const txt = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const pesos = (n) => (n < 0 ? "-$" : "$") + Math.abs(Math.round(Number(n) || 0)).toLocaleString("es-CL");
const dma = (iso) => { const [y, m, d] = String(iso || "").split("-"); return d ? `${d}/${m}/${y}` : ""; };
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
  const base = { nombre, formato: null, numero: null, desde: null, hasta: null, saldoInicial: null, saldoFinal: null, movs: [], errores: [], soloRevision: false, movsRevision: [], diagnostico: [] };
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
    // Opcional (solo como dato informativo): sucursal donde se hizo el depósito o la operación.
    const iSucursal = hdr.findIndex((h) => sinTilde(h) === "SUCURSAL");
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
        movs.push({ fecha, operacion: normalizarOperacion(r[idx.operacion]), descripcion: txt(r[idx.descripcion]), sucursal: iSucursal >= 0 ? txt(r[iSucursal]) : "",
          cargo: montoEntero(r[idx.cargo], ctx), abono: montoEntero(r[idx.abono], ctx), saldo: montoEntero(r[idx.saldo], ctx), archivo: nombre, fila: k + 2 });
      } catch (e) { errores.push(e.message); }
    });
    if (!movs.length && !errores.length) errores.push("La cartola no trae movimientos");
    let saldoInicial = null, saldoFinal = null;
    try {
      saldoInicial = montoEntero(formato === "linea" ? resumen["Inicial"] : resumen["Saldo Inicial"], "Resumen");
      saldoFinal = montoEntero(formato === "linea" ? resumen["Saldo Contable"] : resumen["Saldo Final"], "Resumen");
    } catch (e) { errores.push(e.message); }
    // Hasta aquí: errores de LECTURA (el archivo no sirve ni para revisar). Desde aquí: el archivo se leyó, y se
    // comprueba que cuadre. Lo que no cuadra deja la cartola en «solo revisión» (nunca se usa para conciliar).
    const lectura = errores.length === 0;
    const diagnostico = [];
    if (lectura) {
      let s = saldoInicial;
      for (const m of movs) {
        if (m.cargo && m.abono) {
          errores.push(`fila ${m.fila}: trae cargo y abono a la vez`);
          diagnostico.push({ tipo: "fila", fila: m.fila, texto: `El movimiento del ${dma(m.fecha)}${m.operacion ? ` (operación ${m.operacion})` : ""} trae un cargo y un abono a la vez.` });
        }
        s += m.abono - m.cargo;
        if (s !== m.saldo) {
          errores.push(`El saldo no cuadra en la fila ${m.fila} (${m.fecha}): se esperaba ${s}, la cartola dice ${m.saldo}`);
          diagnostico.push({ tipo: "salto", fila: m.fila, fecha: m.fecha, diferencia: m.saldo - s,
            texto: `Antes del movimiento del ${dma(m.fecha)}${m.operacion ? ` (operación ${m.operacion})` : ""} el saldo ${m.saldo < s ? "baja" : "sube"} ${pesos(Math.abs(m.saldo - s))} sin un movimiento que lo explique. Puede faltar un movimiento en el archivo.` });
          s = m.saldo;   // se sigue revisando desde el saldo que informa el banco, para encontrar TODAS las diferencias
        }
      }
      if (s !== saldoFinal) {
        errores.push(`El saldo final calculado (${s}) no coincide con el del Resumen (${saldoFinal})`);
        diagnostico.push({ tipo: "saldo_final", diferencia: saldoFinal - s, saldoMovimientos: s, saldoResumen: saldoFinal,
          texto: `El saldo que informa el banco en el resumen (${pesos(saldoFinal)}) no coincide con el saldo del último movimiento del archivo (${pesos(s)}). Diferencia: ${pesos(Math.abs(saldoFinal - s))}. Puede que el banco aún no liste algún movimiento: descarga la cartola de nuevo más tarde.` });
      }
      const sumaAbonos = movs.reduce((a, m) => a + m.abono, 0), sumaCargos = movs.reduce((a, m) => a + m.cargo, 0);
      if (formato === "historico") {
        if (movs.at(-1).fecha !== hastaR) {
          errores.push(`La última fecha (${movs.at(-1).fecha}) no coincide con la Fecha Final del Resumen (${hastaR})`);
          diagnostico.push({ tipo: "fechas", texto: `El último movimiento es del ${dma(movs.at(-1).fecha)}, pero el banco dice que la cartola llega hasta el ${dma(hastaR)}.` });
        }
        if (movs.some((m) => m.fecha < desdeR || m.fecha > hastaR)) {
          errores.push("Hay fechas fuera del rango del Resumen");
          diagnostico.push({ tipo: "fechas", texto: `Hay movimientos fuera del período que informa el banco (${dma(desdeR)} al ${dma(hastaR)}).` });
        }
        const declarados = Number(txt(resumen["N° Movimientos"]));
        if (Number.isFinite(declarados) && declarados > 0 && declarados !== movs.length) {
          errores.push(`El Resumen declara ${declarados} movimientos y el archivo trae ${movs.length}`);
          diagnostico.push({ tipo: "cantidad", texto: `El banco informa ${declarados} movimientos y el archivo trae ${movs.length}.` });
        }
        try {
          const decl = montoEntero(resumen["Total Abonos"], "Resumen") + montoEntero(resumen["Total Depósitos"], "Resumen");
          if (sumaAbonos !== decl) {
            errores.push(`Los abonos (${sumaAbonos}) no coinciden con Total Abonos + Total Depósitos del Resumen (${decl})`);
            diagnostico.push({ tipo: "totales", texto: `Los abonos del archivo suman ${pesos(sumaAbonos)} y el banco informa ${pesos(decl)} (diferencia ${pesos(Math.abs(decl - sumaAbonos))}).` });
          }
        } catch (e) { errores.push(e.message); }
      } else {
        // En línea: los totales del Resumen se informan para el diagnóstico (no cambian la validación de saldos).
        for (const [k, suma, nombre] of [["Total Abonos", sumaAbonos, "abonos"], ["Total Cargos", sumaCargos, "cargos"]]) {
          if (resumen[k] === undefined || resumen[k] === "") continue;
          let decl = null; try { decl = montoEntero(resumen[k], "Resumen"); } catch { decl = null; }
          if (decl !== null && decl !== suma) {
            errores.push(`Los ${nombre} del archivo (${suma}) no coinciden con ${k} del Resumen (${decl})`);
            diagnostico.push({ tipo: "totales", texto: `Los ${nombre} del archivo suman ${pesos(suma)} y el banco informa ${pesos(decl)} (diferencia ${pesos(Math.abs(decl - suma))}).` });
          }
        }
      }
    }
    const soloRevision = lectura && errores.length > 0;
    return { ...base, formato, numero: txt(resumen["N° Cartola"]) || null, desde: desdeR || movs[0]?.fecha || null, hasta: hastaR || movs.at(-1)?.fecha || null,
      saldoInicial, saldoFinal, movs: errores.length ? [] : movs, errores,
      soloRevision, movsRevision: soloRevision ? movs : [], diagnostico };
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
  // Rechazadas: no se usan para conciliar. Las «solo revisión» se informan además con su diagnóstico y movimientos.
  const rechazadas = (cartolas || []).filter((c) => c.errores.length).map((c) => ({ nombre: c.nombre, errores: c.errores, soloRevision: !!c.soloRevision }));
  const soloRevision = (cartolas || []).filter((c) => c.soloRevision).map((c) => ({ nombre: c.nombre, formato: c.formato, desde: c.desde, hasta: c.hasta,
    saldoInicial: c.saldoInicial, saldoFinal: c.saldoFinal, diagnostico: c.diagnostico || [], movs: c.movsRevision || [] }));
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
  return { movs, leidos, duplicadosQuitados: leidos - movs.length, archivosRepetidos, faltantes, rechazadas, soloRevision, tramos: tramos.map((c) => ({ nombre: c.nombre, formato: c.formato, numero: c.numero, desde: c.desde, hasta: c.hasta, saldoInicial: c.saldoInicial, saldoFinal: c.saldoFinal, n: c.movs.length })) };
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
