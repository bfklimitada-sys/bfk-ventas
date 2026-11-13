-- F29 con el desglose del informe del contador (13/11/2026). Autorizado por Kevin el 13/11/2026 10:30.
-- Solo AGREGA columnas que admiten NULL a public.iva_mensual (sin valor por defecto: no se reescribe la tabla ni se
-- completa ningún dato histórico). NULL = dato pendiente de ingresar; 0 = $0 registrado explícitamente.
--   remanente_anterior  remanente de crédito del mes anterior, reajustado, copiado del informe del período
--   ppm                 PPM del F29 copiado del informe
--   otras_retenciones   Impuesto Único, retención de honorarios y demás retenciones del F29
--   desglose_f29        true = período registrado con el desglose; NULL = registro anterior (conserva su cálculo)
-- No toca filas, gastos, pagos, cierres, permisos ni políticas (la política rw_autenticados existente cubre las columnas).
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
alter table public.iva_mensual
  add column if not exists remanente_anterior numeric,
  add column if not exists ppm numeric,
  add column if not exists otras_retenciones numeric,
  add column if not exists desglose_f29 boolean;
alter table public.iva_mensual
  add constraint iva_mensual_f29_desglose_ck check (
    (remanente_anterior is null or (remanente_anterior >= 0 and remanente_anterior = trunc(remanente_anterior)))
    and (ppm is null or (ppm >= 0 and ppm = trunc(ppm)))
    and (otras_retenciones is null or (otras_retenciones >= 0 and otras_retenciones = trunc(otras_retenciones)))
    and (desglose_f29 is null or desglose_f29)
    and (desglose_f29 is not null or (remanente_anterior is null and ppm is null and otras_retenciones is null)));
comment on column public.iva_mensual.remanente_anterior is 'F29: remanente anterior reajustado copiado del informe. NULL = pendiente (13/11/2026)';
comment on column public.iva_mensual.ppm is 'F29: PPM copiado del informe. NULL = pendiente (13/11/2026)';
comment on column public.iva_mensual.otras_retenciones is 'F29: otras retenciones (Impuesto Único, honorarios). NULL = pendiente (13/11/2026)';
comment on column public.iva_mensual.desglose_f29 is 'true = período con el desglose del informe; NULL = registro anterior con su cálculo (13/11/2026)';
commit;
