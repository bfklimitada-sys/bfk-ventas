-- DESHACER de la corrección: vuelve al estado previo (vuelve a bloquear las escrituras directas de OC).
revoke execute on function public.trib_escritura_api() from authenticated;
