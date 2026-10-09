// Cartolas BancoEstado SINTÉTICAS (datos ficticios) con la misma estructura que las reales: hojas, encabezados,
// formatos de fecha y de monto. Nunca se usan cartolas reales en este repositorio público.
import * as XLSX from "xlsx";

const dm = (iso) => { const [y, m, d] = iso.split("-"); return `${d}/${m}`; };
const dmy = (iso) => { const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; };
const pesos = (n) => "$" + Number(n).toLocaleString("es-CL");
const pesosLinea = (n) => (n ? "$ " + Number(n).toLocaleString("es-CL") : "");

// movs: [{ fecha: "AAAA-MM-DD", op, desc, cargo, abono }]. Calcula el saldo de cada fila desde saldoInicial.
export function cartolaHistorica(movs, { saldoInicial = 0, numero = 1, desde, hasta, totalesMal = false, nDeclarados, columnasDesordenadas = false, sinColumna } = {}) {
  let s = saldoInicial;
  const filas = movs.map((m) => { s += (m.abono || 0) - (m.cargo || 0); return { ...m, saldo: m.saldo ?? s }; });
  const depositos = filas.filter((m) => /DEPOSITO CON DOCUMENTOS/.test(m.desc)).reduce((a, m) => a + (m.abono || 0), 0);
  const abonos = filas.reduce((a, m) => a + (m.abono || 0), 0), cargos = filas.reduce((a, m) => a + (m.cargo || 0), 0);
  const resumen = [
    ["", "", "", "", "", "", "", "", "600 000 0000 | soporte@ficticio.cl"],
    ["Nombre Empresa", "", "", "", "EMPRESA FICTICIA LIMITADA"],
    ["Cartóla Histórica de Chequera Electrónica"],
    ["N° Cuenta", "", "", "", "00000000000"],
    ["Fecha Inicio", "", "", "", dmy(desde || filas[0].fecha)],
    ["Fecha Final", "", "", "", dmy(hasta || filas.at(-1).fecha)],
    ["Fecha Emisión", "", "", "", dmy(hasta || filas.at(-1).fecha)],
    ["N° Cartola", "", "", "", String(numero)],
    ["N° Movimientos", "", "", "", String(nDeclarados ?? filas.length)],
    ["Saldo Inicial", "", "", "", pesos(saldoInicial)],
    ["Total Cargos", "", "", "", pesos(cargos)],
    ["Total Cheques", "", "", "", pesos(depositos)],
    ["Total Abonos", "", "", "", pesos(abonos - depositos + (totalesMal ? 1000 : 0))],
    ["Total Depósitos", "", "", "", pesos(depositos)],
    ["Saldo Final", "", "", "", pesos(s)],
  ];
  let hdr = ["Fecha", "Sucursal", "N° Cuenta", "Alias", "N° Cartola", "N° Operación", "Descripción", "Cheques / Cargos", "Depósitos / Abonos", "Saldo"];
  let cuerpo = filas.map((m) => [dm(m.fecha), "STGO.PRINCIPAL", "00000000000", "CHEQUERA ELECTRONICA", numero, m.op ?? "7000001", m.desc, m.cargo || 0, pesos(m.abono || 0), pesos(m.saldo)]);
  if (columnasDesordenadas) { const orden = [9, 6, 0, 8, 7, 5, 1, 2, 3, 4]; hdr = orden.map((i) => hdr[i]); cuerpo = cuerpo.map((r) => orden.map((i) => r[i])); }
  if (sinColumna) { const i = hdr.indexOf(sinColumna); hdr = hdr.filter((_, k) => k !== i); cuerpo = cuerpo.map((r) => r.filter((_, k) => k !== i)); }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumen), "Resumen");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([hdr, ...cuerpo]), "Movimientos");
  return wb;
}

export function cartolaEnLinea(movs, { saldoInicial = 0, glosaVariante = false } = {}) {
  let s = saldoInicial;
  const filas = movs.map((m) => { s += (m.abono || 0) - (m.cargo || 0); return { ...m, saldo: m.saldo ?? s }; });
  const resumen = [
    ["Nombre Empresa", "", "", "", "EMPRESA FICTICIA LIMITADA"],
    ["Cartola en Línea Chequera Electrónica"],
    ["Saldo"],
    ["Inicial", "", "", "", pesosLinea(saldoInicial) || "$ 0"],
    ["Disponible", "", "", "", pesosLinea(s) || "$ 0"],
    ["Saldo Contable", "", "", "", pesosLinea(s) || "$ 0"],
    ["Total Abonos", "", "", "", pesosLinea(filas.reduce((a, m) => a + (m.abono || 0), 0)) || "$ 0"],
    ["Total Cargos", "", "", "", pesosLinea(filas.reduce((a, m) => a + (m.cargo || 0), 0)) || "$ 0"],
  ];
  const hdr = ["Fecha", "Sucursal", "N° Operación", "Descripción", "Cargos", "Abonos", "Saldo"];
  const cuerpo = filas.map((m) => [dmy(m.fecha), "STGO.PRINCIPAL ", String(m.op ?? "7000001").padStart(11, "0"),
    glosaVariante ? m.desc.replace("TEF A ", "TEF A  ").slice(0, 30) : m.desc, pesosLinea(m.cargo), pesosLinea(m.abono), pesosLinea(m.saldo)]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumen), "Resumen");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([hdr, ...cuerpo]), "Registros");
  return wb;
}

// Lee un libro como lo haría el navegador (ida y vuelta por el formato xlsx).
export const idaYVuelta = (wb) => XLSX.read(XLSX.write(wb, { type: "array", bookType: "xlsx" }), { type: "array" });
