// Consumo de Supabase, fase 1 (15/11/2026) — funciones puras de la recarga parcial (lib/recargaParcial.js).
// Uso: node docs/pruebas-consumo/recarga.test.mjs
import { componerOCs, mezclarOCs, mezclarHistorial, mezclarCorreos, cursorCorreos, filtroIn, debeRecargar, fotosPorOC, lineasSinUrl, ultimoHistorial, INTERVALO_RECARGA_MS } from "../../src/lib/recargaParcial.js";
let n = 0; const F = [];
const ok = (t, c, d = "") => { if (c) { n++; console.log("OK   ", t); } else { F.push(t); console.log("FALLA", t, typeof d === "string" ? d : JSON.stringify(d).slice(0, 300)); } };
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// componerOCs = mismo armado que la carga completa anterior (App.jsx hasta 8ea74b0)
const ocsD = [{ id: "A", creadoEn: "2026-11-02", oc_productos_link: [{ id: "l1" }, { id: "l2" }, { id: "l3" }] }, { id: "B", creadoEn: "2026-11-01", oc_productos_link: [] }];
const extra = { reclamos: [{ id: "r1", oc_id: "A" }, { id: "r2", oc_id: "B" }, { id: "r3", oc_id: "A" }], responsables: [{ id: "p1", oc_id: "B" }], postventa: [{ id: "v1", oc_id: "A" }],
  seguimientos: [{ id: "s1", oc_id: "A" }], bitacora: [{ id: "h1", campo: "seguimiento:s1" }, { id: "h2", campo: "seguimiento:s9" }], fotos: { B: { neto: 1 } },
  urls: [{ id: "l1", url: "https://a" }, { id: "l2", url: null }], urlsExtensas: {} };
const antiguo = (ocs, x) => {   // copia literal del armado anterior (referencia)
  const reclamosPorOC = {}, respPorOC = {}, pvPorOC = {}, segPorOC = {}; const bitacoraSeg = {};
  for (const h of x.bitacora) { const k = String(h.campo || "").slice(12); if (k) (bitacoraSeg[k] ||= []).push(h); }
  for (const r of x.seguimientos) (segPorOC[r.oc_id] ||= []).push({ ...r, bitacora: bitacoraSeg[r.id] || [] });
  for (const r of x.reclamos) (reclamosPorOC[r.oc_id] ||= []).push(r); for (const r of x.responsables) (respPorOC[r.oc_id] ||= []).push(r); for (const r of x.postventa) (pvPorOC[r.oc_id] ||= []).push(r);
  return ocs.map((oc) => ({ ...oc, oc_reclamos: reclamosPorOC[oc.id] || [], oc_responsables: respPorOC[oc.id] || [], eventos_postventa: pvPorOC[oc.id] || [], oc_seguimientos: segPorOC[oc.id] || [], mp: x.fotos[oc.id] || null }));
};
const c = componerOCs(ocsD, extra); const ref = antiguo(ocsD, extra);
const sinLinks = (l) => l.map((o) => { const { oc_productos_link, ...r } = o; return r; });
ok("componerOCs: reclamos, responsables, post-venta, seguimientos con bitácora y foto iguales al armado anterior", igual(sinLinks(c), sinLinks(ref)));
ok("componerOCs: enlace normal se completa; enlace null se conserva null", c[0].oc_productos_link[0].url === "https://a" && c[0].oc_productos_link[1].url === null);
ok("componerOCs: enlace extenso queda sin descargar (undefined)", c[0].oc_productos_link[2].url === undefined && !("url" in c[0].oc_productos_link[2]));
ok("componerOCs: enlace extenso ya descargado se reutiliza", componerOCs(ocsD, { ...extra, urlsExtensas: { l3: "https://x".repeat(300) } })[0].oc_productos_link[2].url.length === 2700);
ok("componerOCs: si la base devuelve la fila completa (url incluida) no se toca", componerOCs([{ id: "A", oc_productos_link: [{ id: "l1", url: "u" }] }], {})[0].oc_productos_link[0].url === "u");
ok("lineasSinUrl: solo las de enlace extenso", igual(lineasSinUrl(c), ["l3"]));
ok("fotosPorOC: por prefijo, ignora listas", igual(fotosPorOC([{ id: "oc_mp:A", datos: { a: 1 } }, { id: "oc_mp:B", datos: [] }, { id: "otro", datos: { b: 1 } }], "oc_mp:"), { A: { a: 1 } }));

// mezclarOCs
const L = { activas: [{ id: "C", creadoEn: "2026-11-05", v: 1 }, { id: "A", creadoEn: "2026-11-02", v: 1 }, { id: "B", creadoEn: "2026-11-01", v: 1 }], archivadas: [{ id: "Z", creadoEn: "2026-10-01", archivada: true }] };
let m = mezclarOCs(L, [{ id: "A", creadoEn: "2026-11-02", v: 2 }], ["A"]);
ok("mezclarOCs: reemplaza en su lugar sin tocar las demás", igual(m.activas.map((o) => o.id + o.v), ["C1", "A2", "B1"]) && m.activas[0] === L.activas[0] && m.archivadas === m.archivadas);
m = mezclarOCs(L, [{ id: "A", creadoEn: "2026-11-02", v: 1 }], ["A"]);
ok("mezclarOCs: sin cambios conserva el mismo objeto", m.activas[1] === L.activas[1]);
m = mezclarOCs(L, [{ id: "N", creadoEn: "2026-11-03", v: 1 }], ["N"]);
ok("mezclarOCs: OC nueva entra en su posición por fecha de creación", igual(m.activas.map((o) => o.id), ["C", "N", "A", "B"]));
m = mezclarOCs(L, [{ id: "A", creadoEn: "2026-11-02", archivada: true }], ["A"]);
ok("mezclarOCs: OC archivada pasa a archivadas", igual(m.activas.map((o) => o.id), ["C", "B"]) && igual(m.archivadas.map((o) => o.id), ["A", "Z"]));
m = mezclarOCs(L, [], ["B"]);
ok("mezclarOCs: OC pedida que ya no existe se quita", igual(m.activas.map((o) => o.id), ["C", "A"]));
const act = mezclarOCs({ activas: L.activas, archivadas: [] }, [{ id: "A", creadoEn: "2026-11-02", archivada: true }], ["A"]).activas;
const arch = mezclarOCs({ activas: [], archivadas: L.archivadas }, [{ id: "A", creadoEn: "2026-11-02", archivada: true }], ["A"]).archivadas;
ok("mezclarOCs por separado (como en App) = juntas", igual(act.map((o) => o.id), ["C", "B"]) && igual(arch.map((o) => o.id), ["A", "Z"]));

// historial
const h = Array.from({ length: 200 }, (_, i) => ({ id: "h" + i, creadoEn: `2026-11-01T00:${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}Z` }));
const nuevo = [{ id: "hx", creadoEn: "2026-11-02T00:00:00Z" }, { id: "h199", creadoEn: h[199].creadoEn }];
const mh = mezclarHistorial(h, nuevo);
ok("mezclarHistorial: agrega lo nuevo arriba, sin duplicar, máximo 200", mh.length === 200 && mh[0].id === "hx" && mh.filter((x) => x.id === "h199").length === 1 && !mh.some((x) => x.id === "h0"));
ok("ultimoHistorial: fecha más reciente", ultimoHistorial(h) === h[199].creadoEn && ultimoHistorial([]) === "");

// correos
const desde = "2026-10-16T00:00:00Z";
const cs = [{ id: 1, fecha: "2026-11-10T00:00:00Z", estado: "pendiente", sincronizado_en: "2026-11-10T01:00:00Z" }, { id: 2, fecha: "2026-09-01T00:00:00Z", estado: "pendiente", sincronizado_en: "2026-09-01T01:00:00Z" }];
const cur = cursorCorreos(cs);
ok("cursorCorreos: lo último sincronizado y gestionado", cur.sincronizado === "2026-11-10T01:00:00Z" && cur.gestionado === "1970-01-01T00:00:00Z");
const mc = mezclarCorreos(cs, [{ id: 3, fecha: "2026-11-14T00:00:00Z", estado: "pendiente" }, { id: 2, estado: "gestionado", gestionado_en: "2026-11-14T02:00:00Z" }], desde);
ok("mezclarCorreos: agrega el nuevo y quita el antiguo ya gestionado (fuera de 30 días)", igual(mc.map((x) => x.id), [3, 1]));
ok("mezclarCorreos: gestionado dentro de 30 días se actualiza y queda", mezclarCorreos(cs, [{ id: 1, estado: "gestionado" }], desde).find((x) => x.id === 1).estado === "gestionado");

// filtros e intervalo
ok("filtroIn: valores entre comillas y codificados; vacío → null", filtroIn("id", ["a", "b,c", "a"]) === '&id=in.("a","b%2Cc")' && filtroIn("id", [null, ""]) === null);
ok("debeRecargar: nunca cargado → sí; 14 min → no; 15 min → sí", debeRecargar(0, 1000) && !debeRecargar(1000, 1000 + 14 * 60000) && debeRecargar(1000, 1000 + INTERVALO_RECARGA_MS));
console.log(`\n${n} OK, ${F.length} fallas`); process.exit(F.length ? 1 : 0);
