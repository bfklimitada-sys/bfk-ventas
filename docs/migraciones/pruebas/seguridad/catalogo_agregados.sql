-- Solo lectura: conteos agregados (sin contenido) de perfiles, cuentas y Storage.
\pset format unaligned
\pset fieldsep '\t'
\pset tuples_only on
\o catalogo/agregados.tsv
select 'perfiles_por_rol', coalesce(rol::text,'(null)'), count(*)::text from public.perfiles group by 2
union all select 'cuentas_auth', 'total', count(*)::text from auth.users
union all select 'cuentas_auth', 'sin_perfil', count(*)::text from auth.users u where not exists (select 1 from public.perfiles p where p.id=u.id)
union all select 'cuentas_auth', 'confirmadas_sin_perfil', count(*)::text from auth.users u where u.email_confirmed_at is not null and not exists (select 1 from public.perfiles p where p.id=u.id)
union all select 'cuentas_auth', 'creadas_ultimos_30d', count(*)::text from auth.users where created_at > now() - interval '30 days'
union all select 'perfiles', 'sin_cuenta_auth', count(*)::text from public.perfiles p where not exists (select 1 from auth.users u where u.id=p.id);
\o catalogo/storage.tsv
select 'bucket', id, name, public::text, coalesce(file_size_limit::text,''), coalesce(array_to_string(allowed_mime_types,','),'') from storage.buckets
union all select 'objetos', bucket_id, count(*)::text, '', '', '' from storage.objects group by bucket_id;
\o
