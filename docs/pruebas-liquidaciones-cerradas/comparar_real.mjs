// Datos reales de una copia (PostgREST, solo lectura) DESPUÉS de la migración: con las liquidaciones cerradas cargadas, cada
// vendedor-mes da EXACTAMENTE lo mismo que sin ellas (registrar no recalcula nada) y no hay ajustes pendientes. Luego, solo en
// memoria: subir costos, cambiar vendedores y refacturar las OC de los meses cerrados → esos meses NO cambian (aparecen
// ajustes por revisar) y no se genera ninguna comisión duplicada. No escribe nada.
import { createHmac } from "node:crypto";
import * as N from "../../src/lib/calculos.js";
const { PGRST_URL, JWT_SECRET, USUARIO } = process.env;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url"); const t = Math.floor(Date.now() / 1000);
const h = b64({ alg: "HS256", typ: "JWT" }), p = b64({ sub: USUARIO, role: "authenticated", aud: "authenticated", exp: t + 3600, iat: t });
const TOKEN = `${h}.${p}.${createHmac("sha256", JWT_SECRET).update(`${h}.${p}`).digest("base64url")}`;
const get = async (r) => { const x = await fetch(`${PGRST_URL}/${r}`, { headers: { Authorization: `Bearer ${TOKEN}` } }); if (!x.ok) throw new Error(`${x.status} ${r}`); return x.json(); };
const ocs = (await get("ordenes_compra_v2?select=*,eventos_factura(*)")).filter((o) => !o.archivada);
const ivaMensual = await get("iva_mensual?select=*"); const pagos = await get("pagos_vendedor?select=*"); const vendedores = await get("vendedores?select=id");
const liqs = await get("comision_liquidaciones?select=*,comision_liquidacion_ocs(*)"); const decisiones = await get("comision_decisiones?select=*");
const cierres = { liquidaciones: liqs.map((l) => ({ ...l, ocs: l.comision_liquidacion_ocs })), decisiones };
const per = (x) => `${x.anio}-${String(x.mes).padStart(2, "0")}`; let RC = 0;
const num = (c) => c && JSON.stringify({ calc: c.pagoCalculado, pagado: c.pagado, saldo: c.deuda, reg: c.porRegularizar, util: c.sumaUtilidad, com: c.comisionOrdinaria, f29: c.descuentoF29,
  ocs: c.detalle.map((l) => `${l.numero_oc}:${Math.round(l.utilidad * 100) / 100}`).sort() });
const cuadro = (lista, cie) => { const m = new Map(); for (const v of vendedores) for (const x of N.mesesConFactura(v.id, lista, cie)) {
  const c = N.calcularPagoVendedor({ vendedorId: v.id, ocs: lista, anio: x.anio, mes: x.mes, ivaMensual, pagosVendedor: pagos, cierres: cie }); if (c) m.set(`${v.id}|${per(x)}`, c); } return m; };
const sin = cuadro(ocs, null), con = cuadro(ocs, cierres);
const distintos = [...sin.keys(), ...con.keys()].filter((k, i, a) => a.indexOf(k) === i && num(sin.get(k)) !== num(con.get(k)));
const pendientes = [...con.values()].filter((c) => c.ajustesPorRevisar?.length);
console.log(`LIQUIDACIONES_CERRADAS|${liqs.length}|${liqs.map((l) => `${l.vendedor_id} ${l.anio}-${String(l.mes).padStart(2, "0")} ${l.origen} ${l.comision_reconocida}`).sort().join(" · ")}`);
console.log(`IDENTICO_AL_REGISTRAR|vendedor_mes=${con.size}|distintos=${distintos.length}${distintos.length ? " " + distintos.join(",") : ""}|ajustes_pendientes=${pendientes.length}`);
if (distintos.length || pendientes.length) RC = 1;
for (const [k, c] of con) if (c.cerrada) console.log(`MES_CERRADO|${k}|${c.cerrada.origen}|reconocida ${c.pagoCalculado}|pagado ${c.pagado}|saldo ${c.deuda}${c.porRegularizar ? `|POR REGULARIZAR ${c.porRegularizar} (diferencia ya existente; no se modifica)` : ""}`);
// Simulación (solo en memoria) sobre las OC de los meses cerrados.
const enCierre = new Map(); for (const l of liqs) for (const r of l.comision_liquidacion_ocs) enCierre.set(r.oc_id, l);
let i = 0; const otro = vendedores.find((v) => v.id !== "vend_matias")?.id || "vend_kevin";
const sim = ocs.map((o) => { if (!enCierre.has(o.id)) return o; i++;
  if (i % 3 === 0) return { ...o, costo_total: (Number(o.costo_total) || 0) + 10000 };                       // costo sube
  if (i % 3 === 1) return { ...o, monto_total: (Number(o.monto_total) || 0) + 5000 };                        // venta sube
  return { ...o, vendedor_id: enCierre.get(o.id).vendedor_id === otro ? "vend_matias" : otro }; });          // cambia el vendedor
const simC = cuadro(sim, cierres);
const cerradosCambiados = [...con.entries()].filter(([k, c]) => c.cerrada && (!simC.get(k) || simC.get(k).pagoCalculado !== c.pagoCalculado || simC.get(k).pagado !== c.pagado || simC.get(k).deuda !== c.deuda)).map(([k]) => k);
const ajustes = [...simC.values()].reduce((a, c) => a + (c.ajustesPorRevisar?.length || 0), 0);
const nuevos = [...simC.keys()].filter((k) => !con.has(k));
const sinAnt = cuadro(sim, null); const nuevosSinProteccion = [...sinAnt.keys()].filter((k) => !sin.has(k)).length;
const cambiadosSinProteccion = [...sin.keys()].filter((k) => num(sin.get(k)) !== num(sinAnt.get(k))).length;
console.log(`SIMULACION|OC de meses cerrados modificadas ${i} (costo, venta o vendedor)|meses cerrados que cambian ${cerradosCambiados.length}|ajustes por revisar ${ajustes}|meses nuevos con comisión ${nuevos.length}${nuevos.length ? " " + nuevos.join(",") : ""}|sin esta protección: ${cambiadosSinProteccion} vendedor-mes cambiarían y ${nuevosSinProteccion} meses nuevos`);
if (cerradosCambiados.length || nuevos.length || !ajustes) RC = 1;
console.log(RC ? "FALLA|comparación liquidaciones cerradas" : "COMPARACION_LC_CORRECTA");
process.exitCode = RC;
