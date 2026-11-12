-- Ajustes de la base de la DEMOSTRACIÓN (solo base desechable local; nunca producción): nombres ficticios en catálogos y perfiles.
-- Los catálogos de prueba traen nombres del equipo de BFK; en la demostración no debe aparecer ninguna persona real.
-- La réplica local trae miles de filas sintéticas de Mercado Público para pruebas de rendimiento. En la demostración, Mercado
-- Público lo atiende el simulador, así que esas filas sobran (y traen catálogos «Vendedor 1», «Financiador 1»…).
truncate public.ordenes_compra_v2, public.gastos_indirectos, public.pagos_vendedor, public.ajustes_saldo_financiador, public.aportes_socios,
  public.iva_mensual, public.entidades_catalogo, public.contactos_cobranza, public.historial_cambios, public.notificaciones cascade;
delete from public.vendedores where id ~ '^v[0-9]+$';
delete from public.financiadores where id ~ '^f[0-9]+$';
update public.vendedores v set nombre = n.nombre, comision_pct = 10 from (values
  ('vend_byron','Daniela Fuentes'), ('vend_francisco','Rodrigo Pino'), ('vend_juan','Marcela Soto'), ('vend_kevin','Tomás Herrera'), ('vend_matias','Ignacio Lagos')) n(id, nombre) where v.id = n.id;
update public.financiadores f set nombre = n.nombre from (values
  ('fin_byron','Inversiones Los Coihues SpA'), ('fin_francisco','Capital Andino Ltda.'), ('fin_kevin','Factoring del Sur S.A.'), ('fin_matias','Fondo Socio Inversionista')) n(id, nombre) where f.id = n.id;
update public.perfiles p set nombre = n.nombre from (values
  ('11111111-1111-1111-1111-111111111111'::uuid,'Administrador Demo'), ('22222222-2222-2222-2222-222222222222','Daniela Fuentes'),
  ('33333333-3333-3333-3333-333333333333','Carolina Méndez'), ('44444444-4444-4444-4444-444444444444','Felipe Araya'), ('55555555-5555-5555-5555-555555555555','Visita Demo')) n(id, nombre) where p.id = n.id;
-- Los identificadores de los catálogos de prueba también llevan nombres propios: se reemplazan (nadie los referencia tras la limpieza).
update public.vendedores set id = 'vend_' || lower(translate(split_part(nombre, ' ', 1), 'áéíóú', 'aeiou')) where id in ('vend_byron','vend_francisco','vend_juan','vend_kevin','vend_matias');
update public.financiadores set id = 'fin_demo_' || row_number from (select id as viejo, row_number() over (order by nombre) from public.financiadores where id <> 'fin_cuenta_bfk') n where id = n.viejo;
