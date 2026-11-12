// hoyChile(): fecha de Chile para los valores predeterminados de formularios. Casos cercanos a medianoche, horario de verano
// (UTC−3) e invierno (UTC−4) y los dos cambios de hora de America/Santiago en 2026 (5 de abril y 6 de septiembre).
// Se ejecuta con el reloj del equipo en tres zonas (lo hace ejecutar.sh): TZ=UTC, TZ=America/Santiago y TZ=Asia/Tokyo.
import { hoyChile, diasISO, periodosChile } from "../../src/lib/fechaChile.js";
import * as PI from "../../src/lib/proyectos.js";
let okN = 0, fallas = 0; const ok = (n, c, d) => { if (c) okN++; else { fallas++; console.log("FALLA", n, d ?? ""); } };
const caso = (utc, esperado, nota) => { const r = hoyChile(new Date(utc)); ok(`${utc} → ${esperado} (${nota})`, r === esperado, `obtuvo ${r}`); };
// Verano (UTC−3): la medianoche de Chile es a las 03:00 UTC.
caso("2026-11-12T02:30:00Z", "2026-11-11", "23:30 del 11/11 en Chile; UTC ya es 12/11: el caso del defecto");
caso("2026-11-12T02:59:59Z", "2026-11-11", "un segundo antes de la medianoche de Chile");
caso("2026-11-12T03:00:00Z", "2026-11-12", "medianoche exacta de Chile");
caso("2026-11-12T00:00:00Z", "2026-11-11", "21:00 en Chile: empieza el tramo en que UTC va un día adelante");
caso("2026-11-11T23:59:59Z", "2026-11-11", "20:59 en Chile: UTC y Chile coinciden");
caso("2026-11-12T15:00:00Z", "2026-11-12", "mediodía");
// Invierno (UTC−4): la medianoche de Chile es a las 04:00 UTC.
caso("2026-06-15T03:30:00Z", "2026-06-14", "23:30 del 14/06 en Chile (invierno)");
caso("2026-06-15T03:59:59Z", "2026-06-14", "un segundo antes de la medianoche (invierno)");
caso("2026-06-15T04:00:00Z", "2026-06-15", "medianoche exacta (invierno)");
caso("2026-06-15T00:00:00Z", "2026-06-14", "20:00 en Chile (invierno): empieza el tramo adelantado");
// Fin del horario de verano: sábado 4 de abril de 2026 a las 24:00 el reloj vuelve a las 23:00 (UTC−3 → UTC−4).
caso("2026-04-05T02:59:59Z", "2026-04-04", "23:59:59 antes del cambio (verano)");
caso("2026-04-05T03:00:00Z", "2026-04-04", "23:00 repetidas tras atrasar el reloj: sigue siendo sábado 4");
caso("2026-04-05T03:59:59Z", "2026-04-04", "23:59:59 de la hora repetida");
caso("2026-04-05T04:00:00Z", "2026-04-05", "medianoche real del domingo 5");
// Inicio del horario de verano: sábado 5 de septiembre a las 24:00 el reloj salta a la 01:00 del domingo 6 (UTC−4 → UTC−3).
caso("2026-09-06T03:59:59Z", "2026-09-05", "23:59:59 del sábado 5 (invierno)");
caso("2026-09-06T04:00:00Z", "2026-09-06", "01:00 del domingo 6: la hora 00:00–00:59 no existe");
caso("2026-09-06T02:30:00Z", "2026-09-05", "22:30 del sábado 5");
// Fin de mes y de año.
caso("2026-12-01T02:10:00Z", "2026-11-30", "23:10 del 30/11: no pasa al mes siguiente");
caso("2027-01-01T01:00:00Z", "2026-12-31", "22:00 del 31/12: no pasa al año siguiente");
caso("2028-03-01T02:00:00Z", "2028-02-29", "23:00 del 29/02 de un año bisiesto");
// Aritmética de fechas puras y períodos rápidos de los filtros (contados desde el hoy de Chile, no desde el día UTC).
ok("diasISO resta 90 días", diasISO("2026-11-12", -90) === "2026-08-14", diasISO("2026-11-12", -90));
ok("diasISO cruza año y bisiesto", diasISO("2028-03-01", -1) === "2028-02-29" && diasISO("2026-12-31", 1) === "2027-01-01");
{ const p = periodosChile(new Date("2026-12-01T02:10:00Z")); // 23:10 del 30/11 en Chile; en UTC ya es diciembre
  ok("períodos: «Este mes» sigue siendo noviembre", p.esteMes[0] === "2026-11-01" && p.esteMes[1] === "2026-11-30", p.esteMes);
  ok("períodos: «Mes pasado» es octubre completo", p.mesPasado[0] === "2026-10-01" && p.mesPasado[1] === "2026-10-31", p.mesPasado);
  ok("períodos: «90 días»", p.dias90[0] === "2026-09-01" && p.dias90[1] === "2026-11-30", p.dias90);
  ok("períodos: «Este año»", p.esteAnio[0] === "2026-01-01" && p.esteAnio[1] === "2026-11-30", p.esteAnio); }
{ const p = periodosChile(new Date("2027-01-01T01:00:00Z")); // 22:00 del 31/12/2026 en Chile
  ok("períodos: fin de año no salta a 2027", p.esteAnio[0] === "2026-01-01" && p.esteMes[0] === "2026-12-01" && p.mesPasado[0] === "2026-11-01" && p.mesPasado[1] === "2026-11-30", p); }
{ const p = periodosChile(new Date("2026-01-15T15:00:00Z"));
  ok("períodos: «Mes pasado» en enero es diciembre del año anterior", p.mesPasado[0] === "2025-12-01" && p.mesPasado[1] === "2025-12-31", p.mesPasado); }
// Proyectos reutiliza la misma función (la importa y la reexporta): sus valores por defecto no pueden quedar sin definir.
ok("Proyectos reexporta la misma función", PI.hoyChile === hoyChile);
{ let r; try { r = PI.razonesAtraso({ estado: "en_ejecucion", fecha_termino_prevista: "2020-01-01" }); } catch (e) { r = "ERROR " + e.message; }
  ok("Proyectos usa el hoy de Chile por defecto (sin pasarle la fecha)", Array.isArray(r) && r.length >= 1, r); }
ok("sin argumento usa la hora actual", /^\d{4}-\d{2}-\d{2}$/.test(hoyChile()));
console.log(`RESUMEN hoyChile (TZ=${process.env.TZ || "del equipo"}): ${okN} OK, ${fallas} FALLA(S)`);
process.exit(fallas ? 1 : 0);
