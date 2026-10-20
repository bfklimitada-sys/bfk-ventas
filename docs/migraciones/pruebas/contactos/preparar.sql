-- Datos de prueba (SOLO en base desechable o copia restaurada). Marcadores: id 'ci_t_%' y RUT 99.111.xxx.
insert into public.ordenes_compra_v2 (id, numero_oc, cliente, entidad, rut_cliente, contacto, correo_cliente, fecha_hora_emision_mp) values
 ('ci_t_01','CI-T-01','Municipalidad de Prueba Alfa','Municipalidad de Prueba Alfa','99.111.222-7','Ana Pérez · +56 9 1111 1111','Ana.Perez@muni-alfa.cl','2026-01-10 10:00-03'),
 ('ci_t_02','CI-T-02','MUNICIPALIDAD DE PRUEBA ALFA','Municipalidad de Prueba Alfa','99111222-7','ANA PÉREZ · +56 9 1111 1111','ANA.PEREZ@MUNI-ALFA.CL','2026-02-10 10:00-03'),
 ('ci_t_03','CI-T-03','Municipalidad de Prueba Alfa','Municipalidad de Prueba Alfa','99.111.222-7','Bruno Soto · 22 333 4444','bruno@muni-alfa.cl','2026-03-10 10:00-03'),
 ('ci_t_04','CI-T-04','Municipalidad de Prueba Alfa','Municipalidad de Prueba Alfa','99.111.222-7','Ana Perez · +56 9 1111 1111','ana.perez@alfa.gob.cl','2026-04-10 10:00-03'),
 ('ci_t_05','CI-T-05','Municipalidad de Prueba Alfa','Municipalidad de Prueba Alfa','99.111.222-7','Ana Pérez','Ana.Perez@muni-alfa.cl','2026-05-10 10:00-03'),
 ('ci_t_06','CI-T-06','Municipalidad de Prueba Alfa','Municipalidad de Prueba Alfa','99.111.222-7','Bruno Soto · 22 999 0000','bruno@muni-alfa.cl','2026-06-10 10:00-03'),
 ('ci_t_07','CI-T-07','Municipalidad de Prueba Alfa','Municipalidad de Prueba Alfa','99.111.222-7','Bruno Soto','bruno.soto@otro-alfa.cl','2026-07-10 10:00-03'),
 ('ci_t_08','CI-T-08','Municipalidad de Prueba Alfa','Municipalidad de Prueba Alfa','99.111.222-7','','compras@muni-alfa.cl','2026-08-10 10:00-03'),
 ('ci_t_09','CI-T-09','Municipalidad de Prueba Alfa','Municipalidad de Prueba Alfa','99.111.222-7','Carla Ruiz · 22 334 4555','carla@muni-alfa.cl; licitaciones@muni-alfa.cl','2026-08-20 10:00-03'),
 ('ci_t_10','CI-T-10','Municipalidad de Prueba Alfa.','Municipalidad de Prueba Alfa.','99.111.333-9','Ana Pérez · +56 9 1111 1111','Ana.Perez@muni-alfa.cl','2026-01-15 10:00-03'),
 ('ci_t_11','CI-T-11','Municipalidad de Prueba Alfa','Municipalidad de Prueba Alfa','99.111.222-1','Ana Pérez','x@muni-alfa.cl','2026-01-11 10:00-03'),
 ('ci_t_12','CI-T-12','Cliente sin RUT','Cliente sin RUT','','Ana Pérez','y@muni-alfa.cl','2026-01-12 10:00-03'),
 ('ci_t_13','CI-T-13','Municipalidad de Prueba Alfa','Municipalidad de Prueba Alfa','99.111.222-7','Diego Mora · 22 111 2222','','2026-09-01 10:00-03'),
 ('ci_t_14','CI-T-14','Municipalidad de Prueba Alfa','Municipalidad de Prueba Alfa','99.111.222-7','Ana Pérez','ana.perez@antiguo-alfa.cl','2025-12-01 10:00-03'),
 ('ci_t_16','CI-T-16','Municipalidad de Prueba Alfa','Municipalidad de Prueba Alfa','99.111.222-7','Carla Ruiz','carla.ruiz@antiguo-alfa.cl','2026-02-01 10:00-03'),
 ('ci_t_17','CI-T-17','Municipalidad de Prueba Alfa.','Municipalidad de Prueba Alfa.','99.111.333-9','Ana Pérez · +56 9 7777 7777','ana.perez@muni-alfa.cl','2026-09-30 10:00-03'),
 ('ci_t_15','CI-T-15','Municipalidad de Prueba Alfa','Municipalidad de Prueba Alfa','99.111.222-7','Eva Lagos','eva@@muni-alfa','2026-09-05 10:00-03');
-- catálogo: una entidad con contacto confirmado para comprobar que la OC ya no lo sobrescribe
insert into public.entidades_catalogo (id, rut, nombre_entidad, comuna, contacto, correo)
values ('ci_t_ent_a','99.111.222-7','Municipalidad de Prueba Alfa','Alfa','Contacto Manual','manual@muni-alfa.cl'),
       ('ci_t_ent_c','99.111.444-0','Servicio de Prueba Gamma','Gamma','','');
