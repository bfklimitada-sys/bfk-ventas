// Contrato entre la aplicación y las funciones de la base de la cartola (registrar_movimiento_cartola,
// registrar_pago_financiador_cartola, cartola_quitar_alerta). Lee las llamadas capturadas por la simulación
// (BFK_CAPTURA_RPC) y las valida con las MISMAS reglas que la propuesta SQL: campos permitidos y obligatorios,
// marca, sentido, fecha y suma exacta. Si se indica el archivo SQL, toma de ahí las listas de campos.
// Uso: node contrato_rpc.mjs capturas.jsonl [propuesta.sql]
import { readFileSync } from "node:fs";

const [archivo, sql] = process.argv.slice(2);
let REGLAS = {
  cobro: { permitidas: ["id", "oc_id", "fecha", "monto", "notas", "creado_por"], obligatorias: ["id", "oc_id", "fecha", "monto"], max: 20 },
  vendedor: { permitidas: ["id", "vendedor_id", "anio", "mes", "monto_calculado", "monto_pagado", "monto_extra_gestion", "monto_transferido", "referencia_bancaria", "fecha", "estado", "notas", "creado_por"],
    obligatorias: ["id", "vendedor_id", "anio", "mes", "monto_pagado", "monto_extra_gestion", "monto_transferido", "fecha"], max: 1 },
  gasto: { permitidas: ["id", "categoria_id", "subcategoria", "monto", "mes", "anio", "fecha", "detalle", "creado_por"], obligatorias: ["id", "categoria_id", "monto", "mes", "anio", "fecha"], max: 1 },
  retiro: { permitidas: ["id", "socio", "tipo", "monto", "fecha", "medio", "notas", "creado_por"], obligatorias: ["id", "socio", "tipo", "monto", "fecha"], max: 1 },
};
if (sql) {   // las listas de la propuesta SQL mandan: si difieren de las de arriba, la prueba lo dice
  const t = readFileSync(sql, "utf8"); const lista = (x) => x.match(/'([^']+)'/g).map((y) => y.slice(1, -1));
  for (const m of t.matchAll(/when '(cobro|vendedor|gasto|retiro)' then v_tabla := '[a-z_]+'; v_max := (\d+);\s*v_permitidas := array\[([^\]]+)\];\s*v_obligatorias := array\[([^\]]+)\];/g))
    REGLAS[m[1]] = { permitidas: lista(m[3]), obligatorias: lista(m[4]), max: Number(m[2]) };
}
let ok = 0, fallas = 0;
const eq = (n, c, d) => { if (c) ok++; else fallas++; console.log((c ? "OK    " : "FALLA ") + n + (c ? "" : " :: " + JSON.stringify(d).slice(0, 300))); };
const marca = (m) => { const r = /^cart:(\d{4})(\d{2})(\d{2}):(\d+):(\d+):(-?\d+):([1-9]\d{0,3})$/.exec(m || ""); return r && { fecha: `${r[1]}-${r[2]}-${r[3]}`, cargo: +r[4], abono: +r[5] }; };
const llamadas = readFileSync(archivo, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const vistos = {};
for (const [k, { fn, b }] of llamadas.entries()) {
  const id = `${k + 1}_${fn}${b.p_tipo ? "_" + b.p_tipo : ""}`; vistos[fn + (b.p_tipo || "")] = true;
  if (fn === "cartola_quitar_alerta") { eq(`${id}_parametros`, typeof b.p_tabla === "string" && typeof b.p_id === "string", b); continue; }
  const mov = marca(b.p_marca);
  eq(`${id}_marca_valida`, !!mov && (mov.cargo > 0) !== (mov.abono > 0), b.p_marca);
  if (!mov) continue;
  if (b.p_vincular) { eq(`${id}_vincular_sin_filas`, Array.isArray(b.p_vincular) && b.p_vincular.length > 0 && !b.p_filas?.length, b); continue; }
  if (fn === "registrar_pago_financiador_cartola") {
    const asig = b.p_asignaciones || [];
    eq(`${id}_financiador_coherente`, b.p_fecha === mov.fecha && Number(b.p_monto) === mov.cargo && asig.every((a) => a.oc_id && Number(a.monto) > 0)
      && asig.reduce((s, a) => s + Number(a.monto), 0) <= Number(b.p_monto), b);
    continue;
  }
  const r = REGLAS[b.p_tipo]; eq(`${id}_tipo_conocido`, !!r, b.p_tipo); if (!r) continue;
  const filas = b.p_filas || [];
  eq(`${id}_cantidad_filas`, filas.length >= 1 && filas.length <= r.max, filas.length);
  eq(`${id}_solo_campos_permitidos`, filas.every((f) => Object.keys(f).every((c) => r.permitidas.includes(c))), filas.map((f) => Object.keys(f).filter((c) => !r.permitidas.includes(c))));
  eq(`${id}_campos_obligatorios`, filas.every((f) => r.obligatorias.every((c) => f[c] !== undefined && f[c] !== null && f[c] !== "")), filas);
  eq(`${id}_fecha_del_movimiento`, filas.every((f) => f.fecha === mov.fecha), filas.map((f) => f.fecha));
  const monto = (f) => Number(b.p_tipo === "vendedor" ? f.monto_transferido : f.monto);
  eq(`${id}_suma_exacta_del_banco`, filas.reduce((s, f) => s + monto(f), 0) === (b.p_tipo === "cobro" ? mov.abono : mov.cargo), filas.map(monto));
  if (b.p_tipo === "vendedor") eq(`${id}_comision_mas_apoyo`, filas.every((f) => Number(f.monto_pagado) + Number(f.monto_extra_gestion) === Number(f.monto_transferido)), filas);
  if (b.p_tipo === "retiro") eq(`${id}_retiro`, filas.every((f) => f.tipo === "retiro"), filas);
  if (b.p_tipo === "gasto") eq(`${id}_anio_mes_de_la_fecha`, filas.every((f) => Number(f.anio) === +mov.fecha.slice(0, 4) && Number(f.mes) === +mov.fecha.slice(5, 7)), filas);
}
for (const k of ["registrar_movimiento_cartolacobro", "registrar_movimiento_cartolavendedor", "registrar_movimiento_cartolagasto", "registrar_movimiento_cartolaretiro", "registrar_pago_financiador_cartola", "cartola_quitar_alerta"])
  eq(`cobertura_${k}`, !!vistos[k], Object.keys(vistos));
console.log(`\nRESUMEN contrato aplicación ↔ base (cartola): ${ok} OK, ${fallas} FALLA(S)`);
if (fallas) process.exitCode = 1;
