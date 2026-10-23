// Conciliación MASIVA segura (23/10/2026). Solo confirma vínculos con registros que YA existen en BFK (decisiones de
// conciliación: no crean ni cambian cobros, gastos ni pagos). Cada movimiento del lote se vuelve a validar con datos
// frescos justo antes de guardarse; la base (conciliacion_decidir) impide además vincular un registro o un movimiento
// dos veces, aunque dos personas concilien a la vez. Nunca crea registros nuevos.
import { TABLA_REGISTRO } from "./conciliacion.js";

const tablaDe = (r) => r.tabla || TABLA_REGISTRO[r.tipo];
const clavesDe = (regs) => (regs || []).map((r) => `${tablaDe(r)}:${r.id}`).sort().join(",");

// Coincidencias SEGURAS: reconocidas por la conciliación con evidencia además del monto (RUT, nombre, persona, nota con
// la fecha, glosa del SII o una referencia ya confirmada), posteriores al cierre, aún sin decisión ni marca, con
// registros de un solo tipo que suman exacto. Nada «Por revisar», sin coincidencia, con conflicto ni anterior al cierre.
export function coincidenciasSeguras(vista) {
  return (vista?.ya || []).filter((it) => {
    const x = it.x;
    if (!x || x.estado !== "conciliado" || !it.reconocidoAuto || x.anteriorCierre || x.vinculoRoto) return false;
    if (x.origen === "decision" || x.origen === "cartola") return false;
    const regs = x.registros || [];
    if (!regs.length || new Set(regs.map(tablaDe)).size !== 1 || regs.some((r) => !tablaDe(r))) return false;
    if (regs.some((r) => r.dir !== x.dir || r.tipo === "compra")) return false;
    return regs.reduce((s, r) => s + (Number(r.monto) || 0), 0) === x.monto;
  }).map((it) => ({
    marca: it.marca, item: it, tabla: tablaDe(it.x.registros[0]), ids: it.x.registros.map((r) => String(r.id)), registros: it.x.registros,
    monto: it.x.monto, dir: it.x.dir, fecha: it.x.m.fecha, descripcion: it.x.m.descripcion, operacion: it.x.m.operacion || null,
    evidencia: (it.x.evidencia || []).join(" · "), origen: it.reconocidoAuto,
  }));
}

export function resumenLote(lote) {
  const entra = lote.filter((s) => s.dir === "entra"), sale = lote.filter((s) => s.dir === "sale");
  const suma = (l) => l.reduce((a, s) => a + s.monto, 0);
  const porTabla = {}; for (const s of lote) porTabla[s.tabla] = (porTabla[s.tabla] || 0) + 1;
  return { n: lote.length, abonos: entra.length, totalAbonos: suma(entra), cargos: sale.length, totalCargos: suma(sale), porTabla,
    registros: lote.reduce((a, s) => a + s.ids.length, 0) };
}

// Revalida UNA coincidencia contra la conciliación calculada con datos frescos (otra persona pudo vincular, borrar o
// cambiar algo). Solo sigue si el movimiento sigue reconocido con evidencia y con EXACTAMENTE los mismos registros.
export function revalidar(seg, concFresca) {
  const x = (concFresca?.movimientos || []).find((y) => y.marca === seg.marca);
  if (!x) return { ok: false, motivo: "el movimiento ya no está en las cartolas cargadas" };
  if (x.origen === "decision" || x.origen === "cartola") return { ok: false, motivo: "ya estaba confirmado (otra persona o una sesión anterior)", yaHecho: true };
  if (x.estado !== "conciliado" || x.anteriorCierre) return { ok: false, motivo: "con los datos actuales ya no es una coincidencia segura: queda para revisar" };
  if (clavesDe(x.registros) !== clavesDe(seg.registros)) return { ok: false, motivo: "con los datos actuales corresponde a otro registro: queda para revisar" };
  return { ok: true };
}

const textoError = (e) => String(e?.rpcCuerpo?.message || e?.message || e || "");
export const esConflicto = (e) => /23505|duplicate key|conc_dec_|ya est[aá] vinculado|vinculado a otro/i.test(textoError(e));

// Ejecuta el lote: una decisión por movimiento (cada una atómica en la base). Si una falla, las demás siguen; el
// resultado dice exactamente qué se guardó y qué no. Funciones inyectadas: leerFrescos() → datos, conciliar(datos) → conc,
// decidir({marca, decision, tabla, ids, operacion, descripcion}).
export async function ejecutarLote(lote, { leerFrescos, conciliar, decidir, alAvanzar }) {
  const res = [];
  const conc = conciliar(await leerFrescos());
  for (const [k, seg] of lote.entries()) {
    const v = revalidar(seg, conc);
    if (!v.ok) { res.push({ marca: seg.marca, ok: false, omitido: true, yaHecho: !!v.yaHecho, motivo: v.motivo }); alAvanzar?.(k + 1, lote.length); continue; }
    try {
      await decidir({ marca: seg.marca, decision: "vinculado", tabla: seg.tabla, ids: seg.ids, operacion: seg.operacion, descripcion: seg.descripcion });
      res.push({ marca: seg.marca, ok: true });
    } catch (e) {
      res.push({ marca: seg.marca, ok: false, conflicto: esConflicto(e),
        motivo: esConflicto(e) ? "otra persona acaba de vincular este movimiento o su registro: no se guardó" : textoError(e).replace(/^CONC:\s*/, "") || "no se pudo guardar" });
    }
    alAvanzar?.(k + 1, lote.length);
  }
  return res;
}

// Decisiones creadas por este lote (para «Deshacer este lote»): vigentes, de las marcas confirmadas y que no existían antes.
export function decisionesDelLote(antes, despues, marcas) {
  const previas = new Set((antes || []).map((d) => String(d.id)));
  const set = new Set(marcas);
  return (despues || []).filter((d) => !d.anulado_en && d.decision === "vinculado" && set.has(d.marca) && !previas.has(String(d.id))).map((d) => d.id);
}
