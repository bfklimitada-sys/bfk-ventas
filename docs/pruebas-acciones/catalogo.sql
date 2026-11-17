-- Huella de la estructura que toca la migración (para comparar antes / después de deshacer).
select 'col|'||table_name||'.'||column_name||'|'||data_type||'|'||is_nullable||'|'||coalesce(column_default,'') from information_schema.columns where table_schema='public' and table_name in ('oc_seguimientos','historial_cambios','eventos_postventa','eventos_entrega','notificaciones','ordenes_compra_v2','perfiles') order by 1;
select 'con|'||conrelid::regclass||'|'||conname||'|'||pg_get_constraintdef(oid) from pg_constraint where connamespace='public'::regnamespace order by 1;
select 'idx|'||indexdef from pg_indexes where schemaname='public' order by 1;
select 'trg|'||tgrelid::regclass||'|'||tgname||'|'||pg_get_triggerdef(oid) from pg_trigger where not tgisinternal order by 1;
select 'pol|'||tablename||'|'||policyname||'|'||cmd||'|'||coalesce(qual,'')||'|'||coalesce(with_check,'') from pg_policies where schemaname='public' order by 1;
select 'fun|'||p.proname||'|'||md5(pg_get_functiondef(p.oid)) from pg_proc p where p.pronamespace='public'::regnamespace order by 1;
select 'tab|'||tablename from pg_tables where schemaname='public' order by 1;
select 'acl|'||c.relname||'|'||coalesce(c.relacl::text,'') from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r' order by 1;
select 'com|'||c.relname||'|'||coalesce(obj_description(c.oid,'pg_class'),'') from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r' order by 1;
