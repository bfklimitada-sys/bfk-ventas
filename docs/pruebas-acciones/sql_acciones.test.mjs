// Centro de Acciones (17/11/2026) · pruebas de la BASE con PostgreSQL real (RLS, disparadores y funciones de verdad).
// Uso: ACC_DB_URL=postgresql://postgres@/acc?host=/tmp&port=5433 node docs/pruebas-acciones/sql_acciones.test.mjs [--sin-base]
//   Sin --sin-base: carga base-local.sql (réplica de producción) y aplica la migración. Con --sin-base: usa la base tal cual
//   (copia restaurada del respaldo con la migración ya aplicada) y crea sus propios datos de PRUEBA dentro de una transacción
//   que se deshace al final de cada caso.
import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const AQUI = dirname(fileURLToPath(import.meta.url));
const DB = process.env.ACC_DB_URL || "postgresql://postgres@/postgres?host=/tmp&port=5433";
const SIN_BASE = process.argv.includes("--sin-base");
const F = []; let nOk = 0;
const ok = (k, v, d) => { if (!v) { F.push(k); console.log("FALLA " + k + (d !== undefined ? " :: " + String(typeof d === "string" ? d : JSON.stringify(d)).slice(0, 600) : "")); } else { nOk++; console.log("OK    " + k); } };
const psql = (sql, { db = DB } = {}) => execFileSync("psql", [db, "-X", "-At", "-q", "-v", "ON_ERROR_STOP=1"], { input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
const intenta = (sql) => { try { return { ok: true, out: psql(sql) }; } catch (e) { return { ok: false, err: String(e.stderr || e.message) }; } };
const lit = (s) => `$q$${s}$q$`;
const U = { admin: "11111111-1111-1111-1111-111111111111", ana: "22222222-2222-2222-2222-222222222222", beto: "33333333-3333-3333-3333-333333333333", nadie: "44444444-4444-4444-4444-444444444444" };
const como = (u) => u === "anon" ? `set role anon; select set_config('request.jwt.claims', '{"role":"anon"}', false) \\gset _\n`
  : `set role authenticated; select set_config('request.jwt.claims', ${lit(JSON.stringify({ sub: u, role: "authenticated" }))}, false) \\gset _\n`;
// Cada caso corre en una transacción que se deshace (no deja rastros) salvo que se pida conservar.
const caso = (u, sql) => `begin;\n${como(u)}${sql}\nrollback;`;
const j = (sql) => JSON.parse(psql(sql) || "null");

if (!SIN_BASE) {
  psql(readFileSync(resolve(AQUI, "base-local.sql"), "utf8"));
  psql(readFileSync(resolve(AQUI, "../migraciones/2026-11-17-centro-acciones.sql"), "utf8"));
} else {
  // Datos de PRUEBA sobre la copia restaurada: perfiles ficticios y dos OC ficticias (se borran al final).
  // (modo réplica solo para crear los datos de prueba: sin claves foráneas hacia auth.users ni disparadores de la OC)
  // Las cuentas de prueba también existen en auth.users (historial_cambios y notificaciones apuntan a auth.users en producción).
  psql(`set session_replication_role = replica;
        do $$ begin if to_regclass('auth.users') is not null then
          insert into auth.users (id, email) values ('${U.admin}','admin.prueba.acc@copia.invalid'),('${U.ana}','ana.prueba.acc@copia.invalid'),('${U.beto}','beto.prueba.acc@copia.invalid') on conflict do nothing;
        end if; end $$;`);
  psql(`set session_replication_role = replica; insert into public.perfiles(id,nombre,rol) values ('${U.admin}','Admin Prueba','admin'),('${U.ana}','Ana Prueba','usuario'),('${U.beto}','Beto Prueba','usuario') on conflict do nothing;
        insert into public.ordenes_compra_v2(id,numero_oc,cliente,estado_entrega,archivada) values ('oc_prueba_acc_1','PRUEBA-ACC-1','CLIENTE PRUEBA UNO','pendiente',false),('oc_prueba_acc_2','PRUEBA-ACC-2','CLIENTE PRUEBA DOS','pendiente',true) on conflict do nothing;`);
}
const OC1 = SIN_BASE ? "oc_prueba_acc_1" : "oc2";      // OC vigente sin acciones
const OCA = SIN_BASE ? "oc_prueba_acc_2" : "oc3";      // OC archivada
const huellaFin = () => psql(`select md5(coalesce((select string_agg(t::text, ',' order by t.id) from public.ordenes_compra_v2 t),''))`);
const fin0 = huellaFin();

// ── Instalación ──
if (!SIN_BASE) {
  const r = j(`select json_agg(json_build_object('oc',oc_id,'orig',origen_id,'cat',categoria,'est',estado,'autor',creado_por_nombre) order by origen_id) from public.oc_seguimientos`);
  ok("S01 instalación: UNA acción para el único incidente abierto en OC vigente (ninguna para archivada ni resuelto)", r?.length === 1 && r[0].orig === "pv1" && r[0].cat === "postventa" && r[0].est === "pendiente" && r[0].autor === "Automático", r);
  const h = j(`select json_agg(accion) from public.historial_cambios where campo like 'seguimiento:%'`);
  ok("S02 instalación: queda en el historial como «creada automáticamente»", h?.length === 1 && /creada automáticamente/.test(h[0]), h);
}
// ── Categorías ──
{
  const n = psql(caso(U.ana, `select count(*) from public.acciones_categorias;`)).split("\n").pop();
  ok("S03 un usuario lee el catálogo de categorías (12 iniciales)", Number(n) >= 12, n);
  const r = intenta(caso(U.ana, `insert into public.acciones_categorias(id,etiqueta) values ('nueva_cat','Nueva categoría');`));
  ok("S04 un usuario NO puede crear categorías", !r.ok && /row-level security|permission/i.test(r.err), r.err);
  const r2 = intenta(caso(U.admin, `insert into public.acciones_categorias(id,etiqueta,orden) values ('garantias_ext','Garantías extendidas',90); select count(*) from public.acciones_categorias where id='garantias_ext';`));
  ok("S05 un administrador agrega una categoría", r2.ok && r2.out.endsWith("1"), r2);
  const r3 = intenta(caso(U.admin, `update public.acciones_categorias set id='otra' where id='otro';`));
  ok("S06 el código de una categoría no se cambia", !r3.ok && /no se cambia/.test(r3.err), r3.err);
  const r4 = intenta(caso(U.admin, `insert into public.oc_seguimientos(id,oc_id,categoria,descripcion) values ('t_s07','${OC1}','cliente','usa la categoría');
    update public.acciones_categorias set activa=false where id='cliente';
    select categoria from public.oc_seguimientos where id='t_s07';`));
  ok("S07 desactivar una categoría no cambia los registros que la usan", r4.ok && r4.out.endsWith("cliente"), r4);
  const r5 = intenta(caso(U.admin, `update public.acciones_categorias set activa=false where id='cliente';\n${como(U.ana)}insert into public.oc_seguimientos(id,oc_id,categoria,descripcion) values ('t_s08','${OC1}','cliente','x');`));
  ok("S08 una categoría desactivada no se ofrece para acciones nuevas", !r5.ok && /no está disponible/.test(r5.err), r5.err);
  const r6 = intenta(caso(U.ana, `insert into public.oc_seguimientos(id,oc_id,categoria,descripcion) values ('t_s09','${OC1}','inventada','x');`));
  ok("S09 categoría inexistente rechazada", !r6.ok, r6.err);
}
// ── Creación manual ──
{
  const r = intenta(caso(U.ana, `insert into public.oc_seguimientos(id,categoria,descripcion) values ('t_s10',  'comercial','sin título');`));
  ok("S10 acción sin OC exige título", !r.ok && /necesita un título/.test(r.err), r.err);
  const r2 = intenta(caso(U.ana, `insert into public.oc_seguimientos(id,titulo,categoria,descripcion,cliente,prioridad,responsable_id,responsable_nombre,fecha_revision,creado_por,creado_por_nombre)
      values ('t_s11','  Llamar a proveedor  ','comercial','Coordinar visita técnica','  Cliente Libre  ','alta','${U.beto}','NOMBRE FALSO','2026-11-20','${U.admin}','Otro autor');
    select row_to_json(s) from public.oc_seguimientos s where id='t_s11';
    select count(*)||'|'||string_agg(accion,';') from public.historial_cambios where campo='seguimiento:t_s11';
    select count(*)||'|'||max(mensaje) from public.notificaciones where usuario_id='${U.beto}' and mensaje like '%Llamar a proveedor%';`));
  const L = r2.ok ? r2.out.split("\n") : []; const s = L.length ? JSON.parse(L[L.length - 3]) : {};
  ok("S11 acción sin OC: título y cliente limpios, autor y nombre del responsable los fija la base", r2.ok && s.oc_id === null && s.titulo === "Llamar a proveedor" && s.cliente === "Cliente Libre" && s.creado_por === U.ana && s.creado_por_nombre === "Ana Prueba" && s.responsable_nombre === "Beto Prueba" && s.estado === "pendiente", r2.ok ? s : r2.err);
  ok("S12 la creación queda en el historial con fecha y usuario", L[L.length - 2]?.startsWith("1|Acción: creada (Gestiones comerciales"), L[L.length - 2]);
  ok("S13 el responsable asignado recibe un aviso «Para ti»", L[L.length - 1]?.startsWith("1|Te asignaron la acción «Llamar a proveedor»"), L[L.length - 1]);
  const r3 = intenta(caso(U.ana, `insert into public.oc_seguimientos(id,oc_id,titulo,categoria,descripcion,cliente,responsable_id) values ('t_s14','${OC1}','Con OC','proveedor','desc','Cliente distinto','${U.ana}');
    select coalesce(cliente,'∅')||'|'||(select count(*) from public.notificaciones where mensaje like '%Con OC%') from public.oc_seguimientos where id='t_s14';`));
  ok("S14 con OC el cliente es el de la OC (no se guarda otro) y no se avisa a quien se asigna a sí mismo", r3.ok && r3.out.endsWith("∅|0"), r3);
  const r4 = intenta(caso(U.ana, `insert into public.oc_seguimientos(id,oc_id,categoria,descripcion,origen,origen_id) values ('t_s15','${OC1}','postventa','falsa','postventa','pvX');`));
  ok("S15 un usuario no puede crear acciones «automáticas»", !r4.ok && /solo las genera el sistema/.test(r4.err), r4.err);
  const r5 = intenta(caso(U.ana, `insert into public.oc_seguimientos(id,oc_id,categoria,descripcion,estado) values ('t_s16','${OC1}','proveedor','x','resuelto');`));
  ok("S16 una acción se crea abierta", !r5.ok && /se crea abierto/.test(r5.err), r5.err);
  const r6 = intenta(caso(U.nadie, `insert into public.oc_seguimientos(id,titulo,categoria,descripcion) values ('t_s17','x','comercial','x');`));
  ok("S17 una cuenta sin perfil BFK no crea acciones", !r6.ok, r6.err);
  const r7 = intenta(`begin; ${como("anon")} select count(*) from public.oc_seguimientos; rollback;`);
  ok("S18 «anon» no lee acciones", !r7.ok && /permission denied/.test(r7.err), r7.err);
  const r8 = intenta(`begin; ${como("anon")} select count(*) from public.acciones_categorias; rollback;`);
  ok("S19 «anon» no lee categorías", !r8.ok && /permission denied/.test(r8.err), r8.err);
  const r9 = psql(caso(U.nadie, `select count(*) from public.oc_seguimientos;`)).split("\n").pop();
  ok("S20 una cuenta sin perfil BFK no ve acciones", r9 === "0", r9);
}
// ── Seguimiento: edición, estados, historial, reapertura ──
const base = `insert into public.oc_seguimientos(id,oc_id,titulo,categoria,descripcion,prioridad) values ('t_a','${OC1}','Acción A','proveedor','Proveedor no confirma despacho','media');\n`;
{
  const r = intenta(caso(U.ana, base + `update public.oc_seguimientos set prioridad='alta', responsable_id='${U.beto}', fecha_revision='2026-11-25', estado='en_gestion' where id='t_a';
    select string_agg(accion||' ['||coalesce(valor_anterior,'')||' → '||coalesce(valor_nuevo,'')||'] '||usuario_nombre, ' ; ' order by accion) from public.historial_cambios where campo='seguimiento:t_a' and accion<>'Acción: creada (Compras y proveedores · prioridad media)';
    select count(*) from public.notificaciones where usuario_id='${U.beto}';`));
  const L = r.ok ? r.out.split("\n") : [];
  ok("S21 cambios de prioridad, responsable, vencimiento y estado: una línea de historial por cambio, con usuario", r.ok && /prioridad cambiada \[Media → Alta\] Ana Prueba/.test(L.at(-2)) && /responsable cambiado \[Sin asignar → Beto Prueba\]/.test(L.at(-2)) && /vencimiento cambiado \[— → 25\/11\/2026\]/.test(L.at(-2)) && /estado cambiado \[Pendiente → En gestión\]/.test(L.at(-2)), r.ok ? L.at(-2) : r.err);
  ok("S22 al reasignar se avisa al nuevo responsable", r.ok && Number(L.at(-1)) >= 1, L.at(-1));
  const r2 = intenta(caso(U.ana, base + `update public.oc_seguimientos set estado='resuelto' where id='t_a';`));
  ok("S23 resolver exige la solución", !r2.ok && /describe brevemente la solución/.test(r2.err), r2.err);
  const r3 = intenta(caso(U.ana, base + `update public.oc_seguimientos set estado='resuelto', solucion='  Proveedor confirmó despacho  ' where id='t_a';
    select solucion||'|'||resuelto_por||'|'||resuelto_por_nombre||'|'||(resuelto_en is not null) from public.oc_seguimientos where id='t_a';
    select valor_nuevo from public.historial_cambios where campo='seguimiento:t_a' and accion='Acción: resuelta';`));
  ok("S24 resolver registra fecha, usuario y descripción de la solución", r3.ok && r3.out.split("\n").at(-2) === `Proveedor confirmó despacho|${U.ana}|Ana Prueba|true` && r3.out.split("\n").at(-1) === "Proveedor confirmó despacho", r3);
  const res = `update public.oc_seguimientos set estado='resuelto', solucion='Listo' where id='t_a';\n`;
  const r4 = intenta(caso(U.beto, base + res + `update public.oc_seguimientos set prioridad='baja' where id='t_a';`));
  ok("S25 lo resuelto queda como historial: un usuario no lo edita", !r4.ok && /ya está resuelto/.test(r4.err), r4.err);
  const r5 = intenta(caso(U.beto, base + res + `update public.oc_seguimientos set estado='pendiente', prioridad='alta' where id='t_a';`));
  ok("S26 reabrir no permite cambiar otros datos en el mismo paso", !r5.ok && /ya está resuelto/.test(r5.err), r5.err);
  const r6 = intenta(caso(U.beto, base + res + `update public.oc_seguimientos set estado='pendiente' where id='t_a';
    select estado||'|'||coalesce(solucion,'∅')||'|'||coalesce(resuelto_en::text,'∅') from public.oc_seguimientos where id='t_a';
    select valor_anterior||'|'||valor_nuevo||'|'||usuario_nombre from public.historial_cambios where campo='seguimiento:t_a' and accion='Acción: reabierta';`));
  ok("S27 cualquier usuario BFK reabre: queda pendiente, sin solución vigente; la anterior queda en el historial", r6.ok && r6.out.split("\n").at(-2) === "pendiente|∅|∅" && r6.out.split("\n").at(-1) === "Solución anterior: Listo|Pendiente|Beto Prueba", r6);
  const r7 = intenta(caso(U.admin, base + res + `update public.oc_seguimientos set solucion='Listo (corregido)' where id='t_a'; select count(*) from public.historial_cambios where campo='seguimiento:t_a' and accion like '%solución corregida%' and valor_nuevo='Listo (corregido)';`));
  ok("S28 un administrador puede corregir lo resuelto (queda en el historial)", r7.ok && r7.out.endsWith("1"), r7);
  const r8 = intenta(caso(U.ana, base + `update public.oc_seguimientos set oc_id=null, titulo='x' where id='t_a';`));
  ok("S29 no se cambia la OC de una acción", !r8.ok && /No se puede cambiar la OC/.test(r8.err), r8.err);
  const r9 = intenta(caso(U.ana, base + `delete from public.oc_seguimientos where id='t_a'; select count(*) from public.oc_seguimientos where id='t_a';`));
  ok("S30 un usuario no elimina acciones", r9.ok && r9.out.endsWith("1"), r9);
  const r10 = intenta(caso(U.admin, base + `delete from public.oc_seguimientos where id='t_a'; select count(*) from public.oc_seguimientos where id='t_a'; select count(*) from public.historial_cambios where campo='seguimiento:t_a' and accion like '%eliminada%';`));
  ok("S31 un administrador elimina (registro por error) y queda en el historial", r10.ok && r10.out.split("\n").slice(-2).join(",") === "0,1", r10);
  const r11 = intenta(caso(U.ana, base + `insert into public.oc_seguimientos(id,oc_id,categoria,descripcion) values ('t_b','${OC1}','proveedor','Otra acción independiente'); select count(*) from public.oc_seguimientos where oc_id='${OC1}' and estado<>'resuelto';`));
  ok("S32 una OC puede tener varias acciones independientes", r11.ok && Number(r11.out.split("\n").at(-1)) >= 2, r11);
}
// ── Automáticas: postventa ──
{
  const pv = (id, oc, estado = "abierto") => `insert into public.eventos_postventa(id,oc_id,fecha,tipo,descripcion,estado) values ('${id}','${oc}','2026-11-16','falla','No enciende','${estado}');\n`;
  const cnt = (id) => `select count(*)||'|'||coalesce(max(estado),'∅')||'|'||coalesce(max(categoria),'∅') from public.oc_seguimientos where origen='postventa' and origen_id='${id}';\n`;
  const r = intenta(caso(U.ana, pv("t_pv1", OC1) + cnt("t_pv1") + `update public.eventos_postventa set descripcion='No enciende (editado)' where id='t_pv1';\n` + cnt("t_pv1")
    + `update public.eventos_postventa set estado='resuelto', solucion='Se cambió el equipo' where id='t_pv1';\n` + cnt("t_pv1")
    + `select solucion||'|'||resuelto_por_nombre from public.oc_seguimientos where origen_id='t_pv1';\n`
    + `update public.eventos_postventa set estado='abierto' where id='t_pv1';\n` + cnt("t_pv1")
    + `delete from public.eventos_postventa where id='t_pv1';\n` + cnt("t_pv1")));
  const L = r.ok ? r.out.split("\n").slice(-6) : [];
  ok("S33 incidente de postventa nuevo → UNA acción de Postventa", L[0] === "1|pendiente|postventa", r.ok ? L : r.err);
  ok("S34 editar el incidente no duplica la acción", L[1] === "1|pendiente|postventa", L);
  ok("S35 incidente cerrado → acción resuelta sola, con la solución del incidente", L[2] === "1|resuelto|postventa" && /^Incidente de postventa cerrado en la OC: Se cambió el equipo\. Cierre automático\.\|Automático/.test(L[3]), L);
  ok("S36 incidente reabierto → la misma acción se reabre (sin duplicar)", L[4] === "1|pendiente|postventa", L);
  ok("S37 incidente eliminado → la acción se resuelve con esa nota (se conserva)", L[5] === "1|resuelto|postventa", L);
  const r2 = intenta(caso(U.ana, pv("t_pv2", OCA) + cnt("t_pv2") + pv("t_pv3", OC1, "resuelto") + cnt("t_pv3")));
  ok("S38 sin acción para OC archivada ni para un incidente que se registra ya cerrado", r2.ok && r2.out.split("\n").slice(-2).join(",") === "0|∅|∅,0|∅|∅", r2);
  const r3 = intenta(caso(U.ana, pv("t_pv4", OC1) + `select coalesce(estado_postventa,'∅') from public.ordenes_compra_v2 where id='${OC1}';
    update public.oc_seguimientos set estado='resuelto', solucion='Resuelto por teléfono' where origen_id='t_pv4';
    select estado from public.eventos_postventa where id='t_pv4'; select coalesce(estado_postventa,'∅') from public.ordenes_compra_v2 where id='${OC1}';`));
  const L3 = r3.ok ? r3.out.split("\n").slice(-3) : [];
  ok("S39 resolver la acción NO cierra el incidente ni cambia la OC", r3.ok && L3[1] === "abierto" && L3[2] === L3[0], r3.ok ? L3 : r3.err);
  const r4 = intenta(caso(U.ana, pv("t_pv5", OC1) + `update public.oc_seguimientos set estado='resuelto', solucion='Gestionado' where origen_id='t_pv5';
    update public.eventos_postventa set descripcion='otra edición' where id='t_pv5';` + cnt("t_pv5")));
  ok("S40 una acción resuelta a mano no se regenera al editar el incidente (sin duplicados)", r4.ok && r4.out.split("\n").at(-1) === "1|resuelto|postventa", r4);
}
// ── Automáticas: entrega fallida ──
{
  const rpc = (oc, lugar, motivo) => `select public.acc_registrar_entrega_fallida('${oc}', ${lugar === null ? "null" : lit(lugar)}, ${motivo === null ? "null" : lit(motivo)});\n`;
  const r = intenta(caso(U.ana, rpc(OC1, "Bodega central", "bodega cerrada") + rpc(OC1, "Bodega central", "nadie recibió")
    + `select count(*)||'|'||max(prioridad)||'|'||max(categoria)||'|'||max(titulo)||'|'||(max(fecha_revision) >= (now() at time zone 'America/Santiago')::date) from public.oc_seguimientos where origen='entrega_fallida' and oc_id='${OC1}';
    select count(*) from public.historial_cambios h join public.oc_seguimientos s on h.campo='seguimiento:'||s.id where s.origen='entrega_fallida' and s.oc_id='${OC1}' and h.accion='Acción: nuevo intento de entrega fallido';
    insert into public.eventos_entrega(id,oc_id,fecha,persona_recibe) values ('t_ent1','${OC1}','2026-11-18','Juan Bodega');
    select estado||'|'||solucion from public.oc_seguimientos where origen='entrega_fallida' and oc_id='${OC1}';
    select coalesce(estado_entrega,'∅') from public.ordenes_compra_v2 where id='${OC1}';` + rpc(OC1, null, "otra vez")
    + `select count(*)||'|'||count(*) filter (where estado<>'resuelto') from public.oc_seguimientos where origen='entrega_fallida' and oc_id='${OC1}';`));
  const L = r.ok ? r.out.split("\n") : [];
  const fila = L.find((x) => /^\d+\|alta\|/.test(x)) || "";
  ok("S41 entrega fallida → UNA acción alta de Entregas, vence esta semana; un 2.º intento no la duplica", /^1\|alta\|entrega\|Reprogramar entrega fallida\|true$/.test(fila), r.ok ? L : r.err);
  ok("S42 el nuevo intento queda en el historial de esa acción", L.includes("1"), L);
  ok("S43 al registrar la entrega, la acción se resuelve sola (con fecha y quién recibe)", L.some((x) => x === "resuelto|Entrega registrada el 18/11/2026 (recibe: Juan Bodega). Cierre automático."), L);
  ok("S44 resolver la acción no cambia el estado de entrega de la OC", L.some((x) => x === "pendiente"), L);
  ok("S45 una nueva entrega fallida posterior crea una acción nueva (la anterior queda resuelta)", L.at(-1) === "2|1", L.at(-1));
  const r2 = intenta(caso(U.ana, rpc(OC1, "x", "   ")));
  ok("S46 entrega fallida sin motivo → rechazada", !r2.ok && /motivo/.test(r2.err), r2.err);
  const r3 = intenta(caso(U.ana, rpc(OCA, "x", "y")));
  ok("S47 entrega fallida en OC archivada → rechazada", !r3.ok && /archivada/.test(r3.err), r3.err);
  const r4 = intenta(caso(U.nadie, rpc(OC1, "x", "y")));
  ok("S48 cuenta sin perfil BFK no registra entregas fallidas", !r4.ok && /perfil BFK/.test(r4.err), r4.err);
  const r5 = intenta(`begin; ${como("anon")}${rpc(OC1, "x", "y")} rollback;`);
  ok("S49 «anon» no puede llamar la función", !r5.ok && /permission denied/.test(r5.err), r5.err);
}
// ── Concurrencia: 6 sesiones registran a la vez la misma entrega fallida → una sola acción abierta ──
{
  const sql = `${como(U.ana)}select public.acc_registrar_entrega_fallida('${OC1}', 'Bodega', 'cerrado');`;
  const corre = () => new Promise((res) => { const p = spawn("psql", [DB, "-X", "-At", "-q", "-v", "ON_ERROR_STOP=1"]); let o = "", e = ""; p.stdout.on("data", (d) => (o += d)); p.stderr.on("data", (d) => (e += d)); p.on("close", (c) => res({ c, o, e })); p.stdin.end(sql); });
  const rs = await Promise.all(Array.from({ length: 6 }, corre));
  const n = psql(`select count(*) from public.oc_seguimientos where origen='entrega_fallida' and oc_id='${OC1}' and estado<>'resuelto';`);
  const nuevas = rs.filter((x) => /"nueva": true/.test(x.o)).length;
  ok("S50 seis registros simultáneos → una sola acción abierta (sin errores)", n === "1" && nuevas === 1 && rs.every((x) => x.c === 0), { n, nuevas, errores: rs.map((x) => x.e).filter(Boolean) });
  psql(`set session_replication_role = replica; delete from public.historial_cambios where campo in (select 'seguimiento:'||id from public.oc_seguimientos where origen='entrega_fallida' and oc_id='${OC1}'); delete from public.oc_seguimientos where origen='entrega_fallida' and oc_id='${OC1}';`);
}
// ── Protección: nada financiero ni de la OC cambió ──
ok("S51 las OC quedaron idénticas tras todas las pruebas (ninguna acción modifica la OC)", huellaFin() === fin0);
{
  const defs = psql(`select string_agg(pg_get_functiondef(p.oid), E'\\n') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'acc\\_%' or p.proname='seg_antes_guardar');`);
  const prohibidas = ["ordenes_compra_v2 set", "update public.ordenes_compra_v2", "eventos_compra", "eventos_pago", "eventos_factura", "financiadores", "pagos_vendedor", "iva_mensual", "gastos_indirectos", "comision_", "update public.eventos_postventa", "update public.eventos_entrega"];
  ok("S52 ninguna función del Centro de Acciones escribe en tablas financieras, de la OC ni en el incidente o la entrega", !prohibidas.some((x) => defs.toLowerCase().includes(x)), prohibidas.filter((x) => defs.toLowerCase().includes(x)));
}
if (SIN_BASE) {
  // Limpieza: no queda ningún dato ni cuenta de prueba en la copia (las pruebas siguientes usan solo cuentas reales).
  const F3 = `'${U.admin}','${U.ana}','${U.beto}'`;
  psql(`set session_replication_role = replica;
  delete from public.historial_cambios where oc_id in ('oc_prueba_acc_1','oc_prueba_acc_2') or usuario_id in (${F3}) or campo in (select 'seguimiento:'||id from public.oc_seguimientos where oc_id in ('oc_prueba_acc_1','oc_prueba_acc_2') or creado_por in (${F3}));
  delete from public.notificaciones where usuario_id in (${F3});
  delete from public.oc_seguimientos where oc_id in ('oc_prueba_acc_1','oc_prueba_acc_2') or creado_por in (${F3});
  delete from public.ordenes_compra_v2 where id in ('oc_prueba_acc_1','oc_prueba_acc_2');
  delete from public.perfiles where id in (${F3});
  do $$ begin if to_regclass('auth.users') is not null then delete from auth.users where id in (${F3}); end if; end $$;`);
  const resto = psql(`select (select count(*) from public.perfiles where id in (${F3}))+(select count(*) from public.oc_seguimientos where creado_por in (${F3}))+(select count(*) from public.ordenes_compra_v2 where id like 'oc\_prueba\_acc%');`);
  ok("S53 la copia queda sin datos ni cuentas de prueba", resto === "0", resto);
}
console.log(`RESUMEN base del Centro de Acciones: ${nOk} OK, ${F.length} fallas`);
process.exit(F.length ? 1 : 0);
