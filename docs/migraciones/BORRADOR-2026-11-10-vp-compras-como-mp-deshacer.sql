-- Deshacer BORRADOR-2026-11-10-vp-compras-como-mp.sql. Las compras registradas desde la cotización se CONSERVAN como filas
-- normales de vp_compras (proveedor, fecha, neto, IVA, total, descripción): el costo real no cambia. Solo se pierden los
-- detalles de cantidad, precio unitario, enlace y pedido, que el respaldo previo conserva.
begin;
set local lock_timeout = '5s';
drop function public.vp_registrar_compras_cotizacion(jsonb);
drop index public.vp_compras_despacho_unico;
drop index public.vp_compras_clave_unica;
alter table public.vp_compras drop column clave, drop column envio_clave, drop column pedido, drop column enlace, drop column precio_unitario,
  drop column cantidad, drop column concepto;
notify pgrst, 'reload schema';
commit;
