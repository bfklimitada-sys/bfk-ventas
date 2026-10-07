-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- Matías Vegas · julio 2026 (confirmado por el usuario 07/10/2026). Una sola transacción, dueño de las tablas:
--   psql -v ON_ERROR_STOP=1 -1 -f 2026-10-07-matias-julio.sql
-- La transferencia BancoEstado del 31/08/2026 a Matías por $704.505 (registrada como pago de comisión de julio)
-- incluye $34.596 de "Apoyo en gestión y actualización de datos". Igual que abril (K10 del cierre):
--   · pagos_vendedor pv_1791177843463_pk6vs: monto_pagado 704.505 → 669.909 (comisión de julio calculada = $669.909).
--   · gasto nuevo cat_apoyo_gestion $34.596, misma fecha que el pago → la caja no cambia (669.909 + 34.596 = 704.505).
--   No cambia la comisión calculada, no crea deuda, no toca otros pagos. Registro: lote 'matias-julio-20261007'.
-- Deshacer: 2026-10-07-matias-julio-deshacer.sql
-- ═══════════════════════════════════════════════════════════════════════════════════════════
do $$
declare v public.pagos_vendedor; v_notas text; c int;
begin
  if to_regclass('public.fin_correcciones_registro') is null then raise exception 'JULIO: faltan estructuras'; end if;
  if exists (select 1 from public.fin_verificar_consistencia()) then raise exception 'JULIO: base inconsistente antes de empezar'; end if;
  if exists (select 1 from public.fin_correcciones_registro where lote = 'matias-julio-20261007' and revertida_en is null) then
    raise notice 'JULIO|J1|YA_APLICADA|'; return;
  end if;
  if not exists (select 1 from public.categorias_gasto where id = 'cat_apoyo_gestion') then
    raise notice 'JULIO|J1|BLOQUEADA|falta la categoría cat_apoyo_gestion'; return;
  end if;
  select count(*) into c from public.pagos_vendedor where vendedor_id = 'vend_matias' and anio = 2026 and mes = 7;
  select * into v from public.pagos_vendedor where id = 'pv_1791177843463_pk6vs';
  if c <> 1 or v.vendedor_id is distinct from 'vend_matias' or v.anio <> 2026 or v.mes <> 7 or v.monto_pagado <> 704505
     or v.monto_verificado is not null or v.fecha <> '2026-08-30' or exists (select 1 from public.gastos_indirectos where id = 'gasto_matias_julio_20261007') then
    raise notice 'JULIO|J1|BLOQUEADA|pre-estado distinto (pagos julio %, pagado %, verificado %, fecha %)', c, v.monto_pagado, v.monto_verificado, v.fecha; return;
  end if;
  v_notas := nullif(btrim(coalesce(v.notas, '')), '');
  update public.pagos_vendedor
     set monto_pagado = 669909,
         notas = coalesce(v_notas || ' ', '') || 'Separado (07/10/2026, confirmado por el usuario): comisión de julio $669.909 aquí + $34.596 de apoyo en gestión y actualización de datos como gasto aparte (misma transferencia de $704.505).'
   where id = v.id;
  insert into public.fin_correcciones_registro (lote, tabla, fila_id, campo, antes, despues, motivo) values
    ('matias-julio-20261007', 'pagos_vendedor', v.id, 'monto_pagado', '704505', '669909', 'J1 Julio 2026: separar $34.596 de apoyo en gestión del pago de comisión'),
    ('matias-julio-20261007', 'pagos_vendedor', v.id, 'notas', v.notas, (select notas from public.pagos_vendedor where id = v.id), 'J1 nota');
  insert into public.gastos_indirectos (id, categoria_id, subcategoria, monto, mes, anio, fecha, detalle)
  values ('gasto_matias_julio_20261007', 'cat_apoyo_gestion', '', 34596, extract(month from v.fecha)::int, extract(year from v.fecha)::int, v.fecha,
          'Matías Vegas · Apoyo en gestión y actualización de datos (parte de la transferencia BancoEstado de $704.505 del 31/08/2026; comisión de julio $669.909)');
  insert into public.fin_correcciones_registro (lote, tabla, fila_id, campo, antes, despues, motivo)
  values ('matias-julio-20261007', 'gastos_indirectos', 'gasto_matias_julio_20261007', '*fila_nueva*', null, '34596', 'J1 apoyo en gestión julio 2026');
  if exists (select 1 from public.fin_verificar_consistencia()) then raise exception 'JULIO: la base quedó inconsistente; no se aplica nada'; end if;
  raise notice 'JULIO|J1|APLICADA|julio: comisión $669.909 + apoyo $34.596';
end $$;
