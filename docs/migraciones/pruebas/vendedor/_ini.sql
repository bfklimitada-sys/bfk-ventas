\set ON_ERROR_STOP off
\set QUIET 1
-- Carga útil mínima de cz_guardar_cotizacion_v2 (función temporal de la sesión: no queda nada en la base)
create or replace function pg_temp.pl(p_id uuid, p_ver int, p_estado text, p_vend text, p_extra jsonb default '{}'::jsonb) returns jsonb language sql as $$
  select jsonb_build_object('id', p_id, 'version', p_ver, 'nombre', 'VR ' || coalesce(p_extra->>'n', 'cotizacion'), 'estado', p_estado,
    'vendedor_id', p_vend, 'vendedor_nombre', coalesce(p_extra->>'vn', 'Nombre escrito a mano'), 'items', coalesce(p_extra->'items', '[]'::jsonb), 'envios', '[]'::jsonb,
    'subtotal_neto', coalesce((p_extra->>'neto')::numeric, 0), 'impuestos', coalesce((p_extra->>'iva')::numeric, 0), 'total', 0, 'formula', p_extra->'formula', 'oc_codigo', p_extra->>'oc')
$$;
select set_config('request.jwt.claims', json_build_object('sub', :'usr', 'role', 'authenticated')::text, false), set_config('request.method', 'POST', false) \gset _
set role authenticated;
\set QUIET 0
