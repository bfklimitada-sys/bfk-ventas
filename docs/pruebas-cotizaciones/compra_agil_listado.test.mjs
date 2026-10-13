// Uso: node docs/pruebas-cotizaciones/compra_agil_listado.test.mjs
// Mapeo del listado (fixture con la forma oficial) → propuesta para la cotización, protegiendo lo existente.
const { normalizarListadoCompraAgil } = await import("../../api/compra-agil.mjs");
const { propuestaCompraAgil, cotizacionVacia } = await import("../../src/lib/cotizaciones.js");
// Elemento con la forma oficial de payload.items[] (Guía API Compra Ágil v2, §6.1); datos de ejemplo.
const it = {"codigo": "1057539-228-COT26", "nombre": "Adquisición de licencias de software de ofimática", "estado": {"id_estado": 1, "codigo": "publicada", "glosa": "Publicada"}, "convocatoria": {"estado_convocatoria": 1, "descripcion": "Primer llamado"}, "documentos": [], "fechas": {"fecha_publicacion": "2026-07-14T10:00:00Z", "fecha_cierre": "2026-07-15T15:00:00Z", "fecha_ultimo_cambio": "2026-07-15T09:00:00Z", "fecha_cancelacion": null}, "montos": {"moneda": "CLP", "monto_disponible": 8450000, "monto_disponible_clp": 8450000}, "institucion": {"organismo_comprador": "Servicio de Salud Metropolitano Occidente", "rut": "61.608.100-3", "unidad_compra": "Abastecimiento", "region": 13, "nombre_region": "Metropolitana"}, "resumen": {"total_ofertas_recibidas": 0}, "motivos": {"motivo_cancelacion": null, "motivo_desierta": null, "motivo_seleccion": null}, "links": {"detalle": "/v2/compra-agil/1057539-228-COT26"}}; const d = normalizarListadoCompraAgil(it);
const F = []; const ok = (k, v, x) => { console.log((v ? "OK    " : "FALLA ") + k + (v ? "" : " :: " + JSON.stringify(x))); if (!v) F.push(k); };
ok("M1_campos", d.codigo === it.codigo && d.institucion === it.institucion.organismo_comprador && d.rut === it.institucion.rut && d.unidad_compra === it.institucion.unidad_compra && d.region === it.institucion.nombre_region && d.presupuesto.disponible === it.montos.monto_disponible_clp, d);
ok("M2_no_inventa", d.direccion_entrega === "" && d.plazo_dias === null && !d.productos.length && !d.documentos.length && d.descripcion === "", d);
const vacia = { ...cotizacionVacia(), fecha: "2026-10-13" };
const p1 = Object.fromEntries(propuestaCompraAgil(vacia, d).map((f) => [f.campo, f]));
ok("M3_fechas_en_hora_chile", p1.fecha_publicacion?.valor === "2026-07-14T06:00" && p1.fecha_cierre?.valor === "2026-07-15T11:00", [p1.fecha_publicacion?.valor, p1.fecha_cierre?.valor]);
ok("M4_propone_solo_lo_que_viene", Object.keys(p1).sort().join(",") === "fecha_cierre,fecha_publicacion,id_externo,institucion,nombre,presupuesto_estimado,region,rut,unidad_compra", Object.keys(p1));
ok("M5_no_toca_fecha_estado_precios", !["fecha", "estado", "recargo", "items", "plazo", "direccion_entrega"].some((k) => k in p1));
// Cotización ya completada a mano + datos ya aplicados antes
const llena = { ...vacia, institucion: "Otra institución escrita a mano", rut: "61.608.100-3", fecha_publicacion: "2026-07-14T06:00:00", presupuesto_estimado: "8450000" };
const p2 = Object.fromEntries(propuestaCompraAgil(llena, d).map((f) => [f.campo, f]));
ok("M6_distinto_ya_escrito_pide_confirmar", p2.institucion?.sobrescribe === true);
ok("M7_iguales_no_se_proponen", !p2.rut && !p2.fecha_publicacion && !p2.presupuesto_estimado, Object.keys(p2));
const sinMontos = normalizarListadoCompraAgil({ ...it, montos: null, fechas: null, institucion: null });
ok("M8_campos_nulos_no_fallan", sinMontos.presupuesto.disponible === null && sinMontos.fecha_publicacion === "" && sinMontos.institucion === "");
console.log(`\n${8 - F.length} OK · ${F.length} fallas`); process.exit(F.length ? 1 : 0);
