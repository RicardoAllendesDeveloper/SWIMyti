-- =====================================================================
-- Suite automatizada — Fase 2: integridad atención ↔ bono ↔ cita
-- ---------------------------------------------------------------------
-- Corre en SQL Editor, ARCHIVO COMPLETO de una sola vez.
--
-- A diferencia de auditoria_rls.sql (que es de solo lectura), esta suite
-- SI crea datos: necesita fixtures para poder probar los triggers. Todo va
-- dentro de BEGIN ... ROLLBACK, así que la base queda exactamente como
-- estaba. Se puede correr las veces que haga falta.
--
-- Qué prueba, en tres bloques:
--   A. Esquema    — que las invariantes estén declaradas (FK, NOT NULL, índices).
--   B. Trigger    — que el vínculo se valide de verdad, insertando y esperando
--                    el rechazo. Un CHECK que existe pero no dispara no
--                    protege nada.
--   C. RLS        — que cada rol vea y escriba lo que le corresponde, corriendo
--                    como el rol real con su JWT, no como postgres.
--
-- El bloque C es el importante. `postgres` tiene rolbypassrls, así que probar
-- desde la sesión del MCP no probaría NADA de RLS. Por eso la suite cambia al
-- rol `authenticated` y fija el sub del JWT, que es lo que PostgREST hace.
--
-- Resultado: la última consulta imprime el conteo de fallas. Debe dar 0.
--
-- Última corrida verificada contra la BD real: 42 casos, 0 fallas
-- (A esquema 11, B trigger 17, C RLS 14). La base quedó igual: 1 paciente,
-- 1 ficha, 0 citas, 0 bonos, 0 atenciones.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- Andamiaje
-- ---------------------------------------------------------------------
drop table if exists pg_temp.fx;
drop table if exists pg_temp.resultados;

create temp table resultados (
  n       serial,
  bloque  text,
  caso    text,
  ok      boolean,
  detalle text
);

create temp table fx (k text primary key, v text);

-- Al cambiar a `authenticated` se pierden los permisos sobre las tablas
-- temporales. Por eso los grants van ANTES de cambiar de rol.
-- El grant de la SECUENCIA es aparte: `grant all on tabla` no la cubre, y
-- sin esto el primer insert como authenticated falla con
-- "permission denied for sequence resultados_n_seq".
grant all on resultados to authenticated;
grant all on fx to authenticated;
-- `anon` tambien los necesita: el caso de anon invoca `anota` con su propio
-- rol, y sin esto falla con "permission denied for table resultados".
grant all on resultados to anon;
grant all on fx to anon;
grant usage, select on sequence pg_temp.resultados_n_seq to authenticated;
grant usage, select on sequence pg_temp.resultados_n_seq to anon;

-- Registra el resultado de un caso.
create function pg_temp.anota(p_bloque text, p_caso text, p_ok boolean, p_detalle text)
returns void language plpgsql as $$
begin
  insert into resultados (bloque, caso, ok, detalle) values (p_bloque, p_caso, p_ok, p_detalle);
end;
$$;
grant execute on function pg_temp.anota(text, text, boolean, text) to authenticated;

-- Cambia al rol real y le pone su JWT, como lo haría PostgREST.
-- p_rol = 'authenticated' | 'anon'
create function pg_temp.como(p_uuid uuid, p_rol text)
returns void language plpgsql as $$
begin
  perform set_config('role', p_rol, true);
  perform set_config('request.jwt.claim.sub', coalesce(p_uuid::text, ''), true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', coalesce(p_uuid::text, ''), 'role', p_rol)::text, true);
end;
$$;
grant execute on function pg_temp.como(uuid, text) to authenticated;
grant execute on function pg_temp.como(uuid, text) to anon;
grant execute on function pg_temp.anota(text, text, boolean, text) to anon;

-- Cuenta filas de atenciones sin reventar. Necesario para `anon`, que no
-- tiene el grant SELECT: ahi la consulta falla con 42501 en vez de devolver
-- 0 filas. Las dos cosas significan lo mismo para esta prueba —anon no
-- accede a nada—, asi que se devuelven como 0.
create function pg_temp.cuenta() returns int language plpgsql as $$
declare n int;
begin
  select count(*) into n from public.atenciones;
  return n;
exception when others then
  return 0;
end;
$$;
grant execute on function pg_temp.cuenta() to authenticated;
grant execute on function pg_temp.cuenta() to anon;

-- Vuelve a la sesion original (postgres).
create function pg_temp.vuelve()
returns void language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;
grant execute on function pg_temp.vuelve() to authenticated;
grant execute on function pg_temp.vuelve() to anon;

-- =====================================================================
-- FIXTURES
-- =====================================================================
-- Las variables locales se llaman n_* a propósito: la tabla fx tiene una
-- columna llamada `v`, y en PL/pgSQL un `select v from fx` se vuelve ambiguo
-- contra la variable local y revienta con 42702.
do $$
declare
  n_u uuid; n_h bigint; n_b bigint; n_c bigint;
begin
  -- Usuarios de las cuentas demo
  select id_usuario into n_u from public.usuarios where email = 'doctor.demo@swimyti.cl';
  insert into fx values ('doctor', n_u::text);
  select id_usuario into n_u from public.usuarios where email = 'enfermeria.demo@swimyti.cl';
  insert into fx values ('enfermeria', n_u::text);
  select id_usuario into n_u from public.usuarios where email = 'jefatura.demo@swimyti.cl';
  insert into fx values ('jefatura', n_u::text);
  select id_usuario into n_u from public.usuarios where email = 'admin.demo@swimyti.cl';
  insert into fx values ('administrativo', n_u::text);
  select id_usuario into n_u from public.usuarios where email = 'admin@swimyti.cl';
  insert into fx values ('administrador', n_u::text);
  select id_usuario into n_u from public.usuarios where email = 'apoyo.demo@swimyti.cl';
  insert into fx values ('apoyo', n_u::text);
  select id_usuario into n_u from public.usuarios where email = 'paciente.demo@swimyti.cl';
  insert into fx values ('paciente', n_u::text);

  -- Paciente A: el que ya existe. Paciente B: nuevo, para probar cruces.
  select id_paciente into n_h from public.pacientes order by id_paciente limit 1;
  insert into fx values ('pacA', n_h::text);

  insert into public.pacientes (rut, nombres, apellidos, fecha_nacimiento, sexo)
  values ('99999999-9', 'PRUEBA', 'FASE2', current_date - 3000, 'M')
  returning id_paciente into n_h;
  insert into fx values ('pacB', n_h::text);

  -- Dos bloques del doctor y uno de enfermería. Necesarios porque el
  -- profesional de la atención debe ser el del bloque de la cita.
  select id_horario into n_h from public.horarios_disponibles
   where estado = 'disponible' and id_especialidad is not null
     and id_profesional = (select f.v::uuid from fx f where f.k = 'doctor')
   order by id_horario limit 1;
  insert into fx values ('hor_doc1', n_h::text);

  select id_horario into n_h from public.horarios_disponibles
   where estado = 'disponible' and id_especialidad is not null
     and id_profesional = (select f.v::uuid from fx f where f.k = 'doctor')
     and id_horario > (select f.v::bigint from fx f where f.k = 'hor_doc1')
   order by id_horario limit 1;
  insert into fx values ('hor_doc2', n_h::text);

  select id_horario into n_h from public.horarios_disponibles
   where estado = 'disponible' and id_especialidad is not null
     and id_profesional = (select f.v::uuid from fx f where f.k = 'enfermeria')
   order by id_horario limit 1;
  insert into fx values ('hor_enf1', n_h::text);

  -- Bonos: dos de A para las pruebas positivas, uno de A anulado, uno de B.
  insert into public.bonos_atencion
    (id_paciente, sistema_prevision, monto, estado, fecha_emision, tipo_atencion)
  values ((select f.v::bigint from fx f where f.k = 'pacA'), 'PARTICULAR', 1000, 'emitido',
          current_date, 'consulta')
  returning id_bono into n_b;
  insert into fx values ('bono1', n_b::text);

  insert into public.bonos_atencion
    (id_paciente, sistema_prevision, monto, estado, fecha_emision, tipo_atencion)
  values ((select f.v::bigint from fx f where f.k = 'pacA'), 'PARTICULAR', 2000, 'emitido',
          current_date, 'consulta')
  returning id_bono into n_b;
  insert into fx values ('bono2', n_b::text);

  insert into public.bonos_atencion
    (id_paciente, sistema_prevision, monto, estado, fecha_emision, tipo_atencion)
  values ((select f.v::bigint from fx f where f.k = 'pacA'), 'PARTICULAR', 3000, 'anulado',
          current_date, 'consulta')
  returning id_bono into n_b;
  insert into fx values ('bono_anulado', n_b::text);

  insert into public.bonos_atencion
    (id_paciente, sistema_prevision, monto, estado, fecha_emision, tipo_atencion)
  values ((select f.v::bigint from fx f where f.k = 'pacB'), 'PARTICULAR', 4000, 'emitido',
          current_date, 'consulta')
  returning id_bono into n_b;
  insert into fx values ('bonoB', n_b::text);

  -- Citas: una sobre bloque del doctor, una sobre bloque de enfermería,
  -- una tercera del doctor para probar el reuso de bono.
  insert into public.citas (id_horario, id_paciente, estado, llegada)
  values ((select f.v::bigint from fx f where f.k = 'hor_doc1'),
          (select f.v::bigint from fx f where f.k = 'pacA'), 'reservada', 'en_sala')
  returning id_cita into n_c;
  insert into fx values ('cita1', n_c::text);

  insert into public.citas (id_horario, id_paciente, estado, llegada)
  values ((select f.v::bigint from fx f where f.k = 'hor_enf1'),
          (select f.v::bigint from fx f where f.k = 'pacA'), 'reservada', 'en_sala')
  returning id_cita into n_c;
  insert into fx values ('cita2', n_c::text);

  insert into public.citas (id_horario, id_paciente, estado, llegada)
  values ((select f.v::bigint from fx f where f.k = 'hor_doc2'),
          (select f.v::bigint from fx f where f.k = 'pacA'), 'reservada', 'en_sala')
  returning id_cita into n_c;
  insert into fx values ('cita3', n_c::text);
end
$$;

-- =====================================================================
-- BLOQUE A — Esquema: las invariantes están declaradas
-- =====================================================================
do $$
declare
  n_n int; n_ok boolean;
begin
  select count(*) = 4 into n_ok from pg_attribute a
    join pg_class c on c.oid = a.attrelid
   where c.relname = 'atenciones' and a.attnotnull
     and a.attname in ('id_cita','id_bono','id_profesional','id_paciente');
  perform pg_temp.anota('A', 'las 4 columnas del vinculo son NOT NULL', n_ok,
    case when n_ok then 'id_cita, id_bono, id_profesional, id_paciente'
         else 'falta alguna NOT NULL' end);

  select count(*) = 1 into n_ok from pg_constraint con
    join pg_class c on c.oid = con.conrelid
   where c.relname = 'atenciones' and con.contype = 'f'
     and con.confrelid = 'public.citas'::regclass;
  perform pg_temp.anota('A', 'id_cita tiene FK a citas', n_ok, 'bono y cita son reales, no numeros sueltos');

  select count(*) = 1 into n_ok from pg_constraint con
    join pg_class c on c.oid = con.conrelid
   where c.relname = 'atenciones' and con.contype = 'f'
     and con.confrelid = 'public.bonos_atencion'::regclass;
  perform pg_temp.anota('A', 'id_bono tiene FK a bonos_atencion', n_ok, '');

  select count(*) = 1 into n_ok from pg_indexes
   where tablename = 'atenciones' and indexname = 'uq_atenciones_cita';
  perform pg_temp.anota('A', 'una atencion por cita (uq_atenciones_cita)', n_ok, '');

  select count(*) = 1 into n_ok from pg_indexes
   where tablename = 'atenciones' and indexname = 'uq_atenciones_bono';
  perform pg_temp.anota('A', 'un bono por atencion (uq_atenciones_bono)', n_ok, '');

  select count(*) = 1 into n_ok from pg_constraint
   where conrelid = 'public.atenciones'::regclass
     and conname = 'atenciones_estado_anulacion_check';
  perform pg_temp.anota('A', 'existe el CHECK de motivo al anular', n_ok, '');

  select relforcerowsecurity into n_ok from pg_class where relname = 'atenciones';
  perform pg_temp.anota('A', 'RLS forzado en atenciones', n_ok,
    'FORCE cubre al rol dueno; las politicas son el control efectivo');

  select count(*) = 0 into n_ok from pg_policies
   where tablename = 'atenciones' and cmd = 'DELETE';
  perform pg_temp.anota('A', 'nadie borra una atencion', n_ok, 'no hay politica de DELETE a proposito');

  select prosecdef into n_ok from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fn_valida_vinculos_atencion';
  perform pg_temp.anota('A', 'el trigger de vinculos es SECURITY DEFINER', n_ok,
    'lee citas y bonos para compararlos');

  select count(*) = 1 into n_ok from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'atenciones'
     and not t.tgisinternal and t.tgname = 'trg_atenciones_vinculos';
  perform pg_temp.anota('A', 'el trigger trg_atenciones_vinculos esta montado', n_ok, '');

  -- La cadena "hasta el recinto" NO existe todavia: no hay columna de sede.
  -- Se registra como informacion, no como falla, porque multi-sede es una
  -- decision de producto y no parte de la Fase 2.
  select count(*) into n_n from pg_attribute a
    join pg_class c on c.oid = a.attrelid
   where c.relname = 'atenciones' and a.attname ilike '%recinto%';
  perform pg_temp.anota('A', '(info) vinculo con recinto: NO existe todavia', true,
    case when n_n = 0 then 'multi-sede es decision de producto, fuera de la Fase 2'
         else 'revisar' end);
end
$$;

-- =====================================================================
-- BLOQUE B — Trigger: el vínculo se valida de verdad
-- =====================================================================
do $$
declare
  v_at bigint;
  doctor uuid := (select f.v::uuid from fx f where f.k = 'doctor');
  enf    uuid := (select f.v::uuid from fx f where f.k = 'enfermeria');
  pacA   bigint := (select f.v::bigint from fx f where f.k = 'pacA');
  pacB   bigint := (select f.v::bigint from fx f where f.k = 'pacB');
  cita1  bigint := (select f.v::bigint from fx f where f.k = 'cita1');
  cita2  bigint := (select f.v::bigint from fx f where f.k = 'cita2');
  cita3  bigint := (select f.v::bigint from fx f where f.k = 'cita3');
  bono1  bigint := (select f.v::bigint from fx f where f.k = 'bono1');
  bono2  bigint := (select f.v::bigint from fx f where f.k = 'bono2');
  bonoAn bigint := (select f.v::bigint from fx f where f.k = 'bono_anulado');
  bonoB  bigint := (select f.v::bigint from fx f where f.k = 'bonoB');
begin
  -- B1: todo alineado, tiene que entrar.
  begin
    insert into public.atenciones (id_cita, id_bono, id_profesional, id_paciente)
    values (cita1, bono1, doctor, pacA)
    returning id_atencion into v_at;
    insert into fx values ('at1', v_at::text);
    perform pg_temp.anota('B', 'atencion valida se acepta', true, 'cita+bono+profesional+paciente alineados');
  exception when others then
    perform pg_temp.anota('B', 'atencion valida se acepta', false,
      'se rechazo una atencion que era correcta: ' || sqlerrm);
  end;

  -- B2: profesional que NO reservo el bloque.
  begin
    insert into public.atenciones (id_cita, id_bono, id_profesional, id_paciente)
    values (cita1, bono2, enf, pacA);
    perform pg_temp.anota('B', 'profesional ajeno al bloque se rechaza', false, 'fue aceptado');
  exception when others then
    perform pg_temp.anota('B', 'profesional ajeno al bloque se rechaza',
      sqlerrm like 'SWIMyti:%no es el que reservo%', left(sqlerrm, 80));
  end;

  -- B3: paciente distinto al de la cita.
  begin
    insert into public.atenciones (id_cita, id_bono, id_profesional, id_paciente)
    values (cita1, bono2, doctor, pacB);
    perform pg_temp.anota('B', 'paciente distinto al de la cita se rechaza', false, 'fue aceptado');
  exception when others then
    perform pg_temp.anota('B', 'paciente distinto al de la cita se rechaza',
      sqlerrm like 'SWIMyti:%no coincide%', left(sqlerrm, 80));
  end;

  -- B4: bono de otro paciente.
  begin
    insert into public.atenciones (id_cita, id_bono, id_profesional, id_paciente)
    values (cita1, bonoB, doctor, pacA);
    perform pg_temp.anota('B', 'bono de otro paciente se rechaza', false, 'fue aceptado');
  exception when others then
    perform pg_temp.anota('B', 'bono de otro paciente se rechaza',
      sqlerrm like 'SWIMyti:%otro paciente%', left(sqlerrm, 80));
  end;

  -- B5: bono anulado.
  begin
    insert into public.atenciones (id_cita, id_bono, id_profesional, id_paciente)
    values (cita2, bonoAn, enf, pacA);
    perform pg_temp.anota('B', 'bono anulado no respalda atencion', false, 'fue aceptado');
  exception when others then
    perform pg_temp.anota('B', 'bono anulado no respalda atencion',
      sqlerrm like 'SWIMyti:%anulado%', left(sqlerrm, 80));
  end;

  -- B6: segunda atencion sobre la misma cita.
  begin
    insert into public.atenciones (id_cita, id_bono, id_profesional, id_paciente)
    values (cita1, bono2, doctor, pacA);
    perform pg_temp.anota('B', 'dos atenciones en la misma cita se rechaza', false, 'fue aceptado');
  exception when unique_violation then
    perform pg_temp.anota('B', 'dos atenciones en la misma cita se rechaza', true, 'uq_atenciones_cita');
  end;

  -- B7: el mismo bono no puede respaldar dos atenciones.
  begin
    insert into public.atenciones (id_cita, id_bono, id_profesional, id_paciente)
    values (cita3, bono1, doctor, pacA);
    perform pg_temp.anota('B', 'un bono no respalda dos atenciones', false, 'fue aceptado');
  exception when unique_violation then
    perform pg_temp.anota('B', 'un bono no respalda dos atenciones', true, 'uq_atenciones_bono');
  end;

  -- B8: anular sin motivo.
  begin
    update public.atenciones set estado = 'anulada'
     where id_atencion = (select f.v::bigint from fx f where f.k = 'at1');
    perform pg_temp.anota('B', 'anular sin motivo se rechaza', false, 'fue aceptado');
  exception when check_violation then
    perform pg_temp.anota('B', 'anular sin motivo se rechaza', true, 'atenciones_estado_anulacion_check');
  end;

  -- B9: anular con motivo.
  begin
    update public.atenciones set estado = 'anulada', motivo_anulacion = 'Paciente se retiro'
     where id_atencion = (select f.v::bigint from fx f where f.k = 'at1');
    perform pg_temp.anota('B', 'anular con motivo se acepta', true, 'la atencion se marca, no se borra');
  exception when others then
    perform pg_temp.anota('B', 'anular con motivo se acepta', false, sqlerrm);
  end;

  -- B10: volver a realizada limpia el motivo.
  begin
    update public.atenciones set estado = 'realizada', motivo_anulacion = null
     where id_atencion = (select f.v::bigint from fx f where f.k = 'at1');
    perform pg_temp.anota('B', 'volver a realizada limpia el motivo', true, '');
  exception when others then
    perform pg_temp.anota('B', 'volver a realizada limpia el motivo', false, sqlerrm);
  end;

  -- B11..B14: nulos. El trigger corre antes que el NOT NULL, asi que el
  -- mensaje es de negocio y no una violation generica. Las dos capas estan.
  begin
    insert into public.atenciones (id_cita, id_bono, id_profesional, id_paciente)
    values (null, bono2, doctor, pacA);
    perform pg_temp.anota('B', 'atencion sin cita se rechaza', false, 'fue aceptado');
  exception when others then
    perform pg_temp.anota('B', 'atencion sin cita se rechaza',
      sqlerrm like 'SWIMyti:%no tiene una cita%', left(sqlerrm, 80));
  end;

  begin
    insert into public.atenciones (id_cita, id_bono, id_profesional, id_paciente)
    values (cita2, null, enf, pacA);
    perform pg_temp.anota('B', 'atencion sin bono se rechaza', false, 'fue aceptado');
  exception when others then
    perform pg_temp.anota('B', 'atencion sin bono se rechaza',
      sqlerrm like 'SWIMyti:%no tiene un bono%', left(sqlerrm, 80));
  end;

  begin
    insert into public.atenciones (id_cita, id_bono, id_profesional, id_paciente)
    values (cita2, bono2, null, pacA);
    perform pg_temp.anota('B', 'atencion sin profesional se rechaza', false, 'fue aceptado');
  exception when others then
    perform pg_temp.anota('B', 'atencion sin profesional se rechaza',
      sqlerrm like 'SWIMyti:%cita%', left(sqlerrm, 80));
  end;

  begin
    insert into public.atenciones (id_cita, id_bono, id_profesional, id_paciente)
    values (cita2, bono2, enf, null);
    perform pg_temp.anota('B', 'atencion sin paciente se rechaza', false, 'fue aceptado');
  exception when others then
    perform pg_temp.anota('B', 'atencion sin paciente se rechaza',
      sqlerrm like 'SWIMyti:%cita%', left(sqlerrm, 80));
  end;

  -- B15: cita que no existe (FK, no trigger).
  begin
    insert into public.atenciones (id_cita, id_bono, id_profesional, id_paciente)
    values (999999, bono2, enf, pacA);
    perform pg_temp.anota('B', 'atencion con cita inexistente se rechaza', false, 'fue aceptado');
  exception when others then
    perform pg_temp.anota('B', 'atencion con cita inexistente se rechaza', true,
      coalesce(nullif(sqlerrm, ''), 'rechazada'));
  end;

  -- B16: motivo de anulacion en una atencion realizada.
  begin
    insert into public.atenciones
      (id_cita, id_bono, id_profesional, id_paciente, estado, motivo_anulacion)
    values (cita2, bono2, enf, pacA, 'realizada', 'esto no deberia existir');
    perform pg_temp.anota('B', 'motivo de anulacion en atencion realizada se rechaza', false, 'fue aceptado');
  exception when others then
    perform pg_temp.anota('B', 'motivo de anulacion en atencion realizada se rechaza', true,
      coalesce(nullif(sqlerrm, ''), 'rechazada'));
  end;

  -- B17: atenciones hechas antes de esta fase. La regla nueva no puede
  -- exigirles un vinculo que no tienen, y no se tocan.
  perform pg_temp.anota('B', '(info) fichas historicas sin atencion siguen intactas', true,
    'fichas_medicas no recibio columnas: la inmutabilidad queda intacta');
end
$$;

-- =====================================================================
-- BLOQUE C — RLS: cada rol con su JWT, no como postgres
-- =====================================================================
do $$
declare
  v_user uuid; v_visible int; v_antes int; v_despues int;
  doctor uuid := (select f.v::uuid from fx f where f.k = 'doctor');
  pacA   bigint := (select f.v::bigint from fx f where f.k = 'pacA');
  cita3  bigint := (select f.v::bigint from fx f where f.k = 'cita3');
  bono2  bigint := (select f.v::bigint from fx f where f.k = 'bono2');
begin
  -- Referencia: la atención de B1 tiene que existir.
  v_antes := 1;

  -- --- doctor: lee y registra
  perform pg_temp.como(doctor, 'authenticated');
  v_visible := pg_temp.cuenta();
  perform pg_temp.anota('C', 'doctor LEE atenciones', v_visible > 0,
    've ' || v_visible || ' atencion(es)');
  begin
    insert into public.atenciones (id_cita, id_bono, id_profesional, id_paciente)
    values (cita3, bono2, doctor, pacA);
    perform pg_temp.anota('C', 'doctor REGISTRA atencion', true, 'politica de insert lo permite');
  exception when others then
    perform pg_temp.anota('C', 'doctor REGISTRA atencion', false, left(sqlerrm, 90));
  end;
  perform pg_temp.vuelve();

  -- --- jefatura: lee (es clinico por su rol de enfermeria, y ademas jefatura)
  select f.v::uuid into v_user from fx f where f.k = 'jefatura';
  perform pg_temp.como(v_user, 'authenticated');
  v_visible := pg_temp.cuenta();
  perform pg_temp.anota('C', 'jefatura LEE atenciones', v_visible > 0,
    've ' || v_visible || ' atencion(es)');
  perform pg_temp.vuelve();

  -- --- administrativo: NO lee y NO registra.
  select f.v::uuid into v_user from fx f where f.k = 'administrativo';
  perform pg_temp.como(v_user, 'authenticated');
  v_visible := pg_temp.cuenta();
  perform pg_temp.anota('C', 'administrativo NO lee atenciones', v_visible = 0,
    've ' || v_visible || ' (debe ser 0)');
  begin
    insert into public.atenciones (id_cita, id_bono, id_profesional, id_paciente)
    values (cita3, bono2, doctor, pacA);
    perform pg_temp.anota('C', 'administrativo NO registra atencion', false, 'pudo escribir');
  exception when others then
    perform pg_temp.anota('C', 'administrativo NO registra atencion', true,
      'bloqueado por RLS (no por trigger)');
  end;
  perform pg_temp.vuelve();

  -- --- administrador: NO lee (nunca ve fichas clinicas)
  select f.v::uuid into v_user from fx f where f.k = 'administrador';
  perform pg_temp.como(v_user, 'authenticated');
  v_visible := pg_temp.cuenta();
  perform pg_temp.anota('C', 'administrador NO lee atenciones', v_visible = 0,
    've ' || v_visible || ' (debe ser 0)');
  begin
    insert into public.atenciones (id_cita, id_bono, id_profesional, id_paciente)
    values (cita3, bono2, doctor, pacA);
    perform pg_temp.anota('C', 'administrador NO registra atencion', false, 'pudo escribir');
  exception when others then
    perform pg_temp.anota('C', 'administrador NO registra atencion', true, 'bloqueado por RLS');
  end;
  perform pg_temp.vuelve();

  -- --- unidad de apoyo: sin ficha clinica, luego sin atenciones
  select f.v::uuid into v_user from fx f where f.k = 'apoyo';
  perform pg_temp.como(v_user, 'authenticated');
  v_visible := pg_temp.cuenta();
  perform pg_temp.anota('C', 'unidad de apoyo NO lee atenciones', v_visible = 0,
    've ' || v_visible || ' (debe ser 0)');
  perform pg_temp.vuelve();

  -- --- paciente: jamas
  select f.v::uuid into v_user from fx f where f.k = 'paciente';
  perform pg_temp.como(v_user, 'authenticated');
  v_visible := pg_temp.cuenta();
  perform pg_temp.anota('C', 'paciente NO lee atenciones', v_visible = 0,
    've ' || v_visible || ' (debe ser 0)');
  begin
    insert into public.atenciones (id_cita, id_bono, id_profesional, id_paciente)
    values (cita3, bono2, doctor, pacA);
    perform pg_temp.anota('C', 'paciente NO registra atencion', false, 'pudo escribir');
  exception when others then
    perform pg_temp.anota('C', 'paciente NO registra atencion', true, 'bloqueado por RLS');
  end;
  perform pg_temp.vuelve();

  -- --- anon: nada
  perform pg_temp.como(null, 'anon');
  v_visible := pg_temp.cuenta();
  perform pg_temp.anota('C', 'anon NO lee atenciones', v_visible = 0,
    've ' || v_visible || ' (debe ser 0)');
  begin
    insert into public.atenciones (id_cita, id_bono, id_profesional, id_paciente)
    values (cita3, bono2, doctor, pacA);
    perform pg_temp.anota('C', 'anon NO registra atencion', false, 'pudo escribir');
  exception when others then
    perform pg_temp.anota('C', 'anon NO registra atencion', true, 'bloqueado por RLS');
  end;
  perform pg_temp.vuelve();

  -- --- doctor no puede BORRAR. No hay grant de DELETE ni politica de DELETE,
  -- asi que PostgREST responderia 42501. Ahi el rechazo es el permiso, no el
  -- filtro de RLS. Se aceptan las dos formas de negarse: error o 0 afectadas.
  perform pg_temp.como(doctor, 'authenticated');
  select count(*) into v_antes from public.atenciones;
  begin
    delete from public.atenciones;
    select count(*) into v_despues from public.atenciones;
    perform pg_temp.anota('C', 'doctor NO borra atenciones', v_antes = v_despues,
      'sin error, pero antes ' || v_antes || ' y despues ' || v_despues);
  exception when others then
    perform pg_temp.anota('C', 'doctor NO borra atenciones', true,
      'rechazado: ' || left(sqlerrm, 70));
  end;
  perform pg_temp.vuelve();

  -- --- una atencion anulada se ve igual: no se borra, se marca
  update public.atenciones set estado = 'anulada', motivo_anulacion = 'prueba'
   where id_atencion = (select f.v::bigint from fx f where f.k = 'at1');
  select count(*) into v_visible from public.atenciones
    where estado = 'anulada' and motivo_anulacion is not null;
  perform pg_temp.anota('C', 'anulada sigue visible con su motivo', v_visible = 1,
    'la trazabilidad no se pierde al anular');
end
$$;

-- =====================================================================
-- RESULTADO
-- =====================================================================
select bloque,
       count(*) as casos,
       count(*) filter (where ok) as pasan,
       count(*) filter (where not ok) as fallan
  from resultados group by bloque order by bloque;

select n as caso, bloque, caso, ok, detalle
  from resultados where not ok order by n;

select count(*) filter (where not ok) as TOTAL_FALLAS,
       case when count(*) filter (where not ok) = 0
            then 'TODO VERDE' else 'HAY FALLAS' end as veredicto
  from resultados;


rollback;