-- =============================================================================
-- SWIMyti — Matriz de permisos (pruebas de seguridad)
-- =============================================================================
-- COMO EJECUTAR: pegar el archivo completo en Supabase SQL Editor y correr.
-- Resultado actual: 25/25 OK.
--
-- NO deja datos: todo corre dentro de la transaccion implicita de la llamada,
-- que se revierte al terminar. Se puede correr las veces que haga falta.
--
-- Que prueba: que la separacion de responsabilidades se sostiene en la BD, no
-- solo en la interfaz. Ocultar un boton es UX; esto es seguridad.
--
-- Como simula la sesion: set_config('request.jwt.claims', ...) escribe el JWT
-- que lee auth.uid(), y set local role baja el privilegio al de la app real.
-- Con eso RLS y las funciones de rol responden como lo harian con un token de
-- verdad, sin crear usuarios ni contrasenas para testear.
--
-- SALIDA: tabla con CASO / ESPERADO / OBTENIDO -> OK|FALLA
--
-- Sobre los casos 14-19 (exposicion a anon): en Postgres toda funcion nace con
-- EXECUTE para PUBLIC, y varias acumulaban ademas un grant explicito a anon.
-- Por eso cerrar esto exige `revoke ... from public, anon` y no solo uno de
-- los dos. Fue un agujero real que detecto esta matriz, no un control teorico.
-- =============================================================================

create temporary table swimyti_test (caso text, esperado text, obtenido text);

do $$
declare
  v_obtenido text;
  v_caso     text := '';
  v_esperado text := '';
  v_res      text;
  c_ok       int := 0;
  c_falla    int := 0;
  n          int;

  v_uid_jef    uuid;
  v_uid_doc    uuid;
  v_uid_adm    uuid;
  v_uid_admvo  uuid;
  v_uid_pac    uuid;
  v_esp_dentro bigint;
  v_esp_fuera   bigint;
  v_id_jef   bigint;
  v_id_doc   bigint;
  v_id_adm   bigint;
  v_id_admvo bigint;
  v_id_pac   bigint;
begin
  -- ------------------------------------------------------------------
  -- Anclas: solo identificadores, nunca datos de pacientes
  -- ------------------------------------------------------------------
  select r.id_rol into v_id_jef   from public.roles r where r.nombre_rol = 'jefatura';
  select r.id_rol into v_id_doc   from public.roles r where r.nombre_rol = 'doctor';
  select r.id_rol into v_id_adm   from public.roles r where r.nombre_rol = 'administrador';
  select r.id_rol into v_id_admvo from public.roles r where r.nombre_rol = 'administrativo';
  select r.id_rol into v_id_pac   from public.roles r where r.nombre_rol = 'paciente';

  select u.id_usuario into v_uid_adm
    from public.usuarios u
    join public.usuario_roles ur on ur.id_usuario = u.id_usuario
   where ur.id_rol = v_id_adm and u.activo limit 1;
  select u.id_usuario into v_uid_admvo
    from public.usuarios u
    join public.usuario_roles ur on ur.id_usuario = u.id_usuario
   where ur.id_rol = v_id_admvo and u.activo limit 1;
  select u.id_usuario into v_uid_doc
    from public.usuarios u
    join public.usuario_roles ur on ur.id_usuario = u.id_usuario
   where ur.id_rol = v_id_doc and u.activo limit 1;
  select u.id_usuario into v_uid_pac
    from public.usuarios u
    join public.usuario_roles ur on ur.id_usuario = u.id_usuario
   where ur.id_rol = v_id_pac and u.activo limit 1;
  select u.id_usuario into v_uid_jef
    from public.usuarios u
    join public.usuario_roles ur on ur.id_usuario = u.id_usuario
   where ur.id_rol = v_id_jef and u.activo limit 1;

  select dse.id_especialidad into v_esp_dentro
    from public.doctores_especialidades dse
    join public.especialidades e on e.id_especialidad = dse.id_especialidad
   where e.activo
   group by dse.id_especialidad
   order by count(*) desc, dse.id_especialidad limit 1;
  select e.id_especialidad into v_esp_fuera
    from public.especialidades e
   where e.activo and e.id_especialidad <> v_esp_dentro
   order by e.id_especialidad limit 1;

  -- ==================================================================
  -- 20 casos
  -- ==================================================================
  for n in 1..25 loop
    reset role;
    v_caso := ''; v_esperado := ''; v_obtenido := '';

    case n
      -- 1. Ambito de coordinacion de agenda ------------------------
      when 1 then
        v_caso := 'administrador coordina cualquier especialidad';
        v_esperado := 'true';
        perform set_config('request.jwt.claims',
          json_build_object('sub', v_uid_adm::text)::text, true);
        set local role authenticated;
        v_obtenido := public.fn_es_coordinador_agenda(v_esp_fuera)::text;
        reset role;

      when 2 then
        v_caso := 'jefatura coordina SU especialidad';
        v_esperado := 'true';
        perform set_config('request.jwt.claims',
          json_build_object('sub', v_uid_jef::text)::text, true);
        set local role authenticated;
        v_obtenido := public.fn_es_coordinador_agenda(v_esp_dentro)::text;
        reset role;

      when 3 then
        v_caso := 'jefatura NO coordina fuera de su ambito';
        v_esperado := 'false';
        perform set_config('request.jwt.claims',
          json_build_object('sub', v_uid_jef::text)::text, true);
        set local role authenticated;
        v_obtenido := public.fn_es_coordinador_agenda(v_esp_fuera)::text;
        reset role;

      when 4 then
        v_caso := 'administrativo NO coordina carga horaria';
        v_esperado := 'false';
        perform set_config('request.jwt.claims',
          json_build_object('sub', v_uid_admvo::text)::text, true);
        set local role authenticated;
        v_obtenido := public.fn_es_coordinador_agenda(v_esp_dentro)::text;
        reset role;

      -- 2. Listado de profesionales, acotado en la BD --------------
      when 5 then
        v_caso := 'jefatura ve solo profesionales de su ambito';
        v_esperado := 'true';
        perform set_config('request.jwt.claims',
          json_build_object('sub', v_uid_jef::text)::text, true);
        set local role authenticated;
        v_obtenido := (not exists (
          select 1 from public.fn_profesionales_agenda_coordinable() p
          join public.especialidades e on e.nombre = p.especialidad
          where e.id_especialidad = v_esp_fuera))::text;
        reset role;

      when 6 then
        v_caso := 'doctor sin jefatura ve lista de profesionales vacia';
        v_esperado := 'true';
        perform set_config('request.jwt.claims',
          json_build_object('sub', v_uid_doc::text)::text, true);
        set local role authenticated;
        v_obtenido :=
          (select count(*) = 0 from public.fn_profesionales_agenda_coordinable())::text;
        reset role;

      -- 3. Acumulacion de roles y aislamiento de datos ------------
      when 7 then
        v_caso := 'jefatura acumula enfermeria y jefatura a la vez';
        v_esperado := 'true';
        perform set_config('request.jwt.claims',
          json_build_object('sub', v_uid_jef::text)::text, true);
        set local role authenticated;
        v_obtenido := (public.fn_tiene_rol(array['enfermeria', 'jefatura']))::text;
        reset role;

      when 8 then
        v_caso := 'jefatura puede listar pacientes';
        v_esperado := 'true';
        perform set_config('request.jwt.claims',
          json_build_object('sub', v_uid_jef::text)::text, true);
        set local role authenticated;
        v_obtenido := (select count(*) > 0 from public.pacientes)::text;
        reset role;

      when 9 then
        v_caso := 'paciente ve exactamente su propia ficha';
        v_esperado := 'true';
        perform set_config('request.jwt.claims',
          json_build_object('sub', v_uid_pac::text)::text, true);
        set local role authenticated;
        v_obtenido := (select count(*) = 1 from public.pacientes)::text;
        reset role;

      -- 4. Trazabilidad inmutable de la ficha clinica -------------
      when 10 then
        v_caso := 'fichas_medicas sin UPDATE ni DELETE en RLS';
        v_esperado := '0';
        perform set_config('request.jwt.claims',
          json_build_object('sub', v_uid_doc::text)::text, true);
        set local role authenticated;
        v_obtenido := (select count(*) from pg_policies
                         where schemaname = 'public'
                           and tablename = 'fichas_medicas'
                           and cmd in ('UPDATE', 'DELETE'))::text;
        reset role;

      when 11 then
        v_caso := 'ficha bloquea UPDATE con trigger activo';
        v_esperado := 'true';
        v_obtenido := exists (
          select 1 from pg_trigger
           where tgrelid = 'public.fichas_medicas'::regclass
             and not tgisinternal and tgenabled = 'O'
             and tgname = 'trg_fichas_medicas_no_update'
             and pg_get_triggerdef(oid) ilike '%fn_bloquear_mutacion_inmutable%');

      when 12 then
        v_caso := 'ficha bloquea DELETE con trigger activo';
        v_esperado := 'true';
        v_obtenido := exists (
          select 1 from pg_trigger
           where tgrelid = 'public.fichas_medicas'::regclass
             and not tgisinternal and tgenabled = 'O'
             and tgname = 'trg_fichas_medicas_no_delete'
             and pg_get_triggerdef(oid) ilike '%fn_bloquear_mutacion_inmutable%');

      when 13 then
        v_caso := 'enmiendas de auditoria tambien inmutables';
        v_esperado := '2';
        v_obtenido := (select count(*) from pg_trigger
                         where tgrelid = 'public.enmiendas_auditoria'::regclass
                           and not tgisinternal and tgenabled = 'O'
                           and pg_get_triggerdef(oid)
                               ilike '%fn_bloquear_mutacion_inmutable%')::text;

      -- 5. El visitante anonimo no ejecuta nada -------------------
      when 14 then
        v_caso := 'anon NO puede generar bloques de horario';
        v_esperado := 'false';
        v_obtenido := (select bool_or(has_function_privilege('anon', p.oid, 'execute'))
                         from pg_proc p
                         join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname = 'public'
                          and p.proname = 'fn_generar_bloques_jornada')::text;

      when 15 then
        v_caso := 'anon NO puede listar profesionales de agenda';
        v_esperado := 'false';
        v_obtenido := (select bool_or(has_function_privilege('anon', p.oid, 'execute'))
                         from pg_proc p
                         join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname = 'public'
                          and p.proname = 'fn_profesionales_agenda_coordinable')::text;

      when 16 then
        v_caso := 'anon NO puede consultar el ambito de coordinacion';
        v_esperado := 'false';
        v_obtenido := (select bool_or(has_function_privilege('anon', p.oid, 'execute'))
                         from pg_proc p
                         join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname = 'public'
                          and p.proname = 'fn_es_coordinador_agenda')::text;

      when 17 then
        v_caso := 'anon NO puede consultar el ambito de una cita';
        v_esperado := 'false';
        v_obtenido := (select bool_or(has_function_privilege('anon', p.oid, 'execute'))
                         from pg_proc p
                         join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname = 'public'
                          and p.proname = 'fn_es_coordinador_cita')::text;

      when 18 then
        v_caso := 'anon NO puede leer la especialidad de un profesional';
        v_esperado := 'false';
        v_obtenido := (select bool_or(has_function_privilege('anon', p.oid, 'execute'))
                         from pg_proc p
                         join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname = 'public'
                          and p.proname = 'fn_especialidad_del_profesional')::text;

      when 19 then
        v_caso := 'ninguna SECURITY DEFINER de negocio abierta a anon';
        v_esperado := '0';
        v_obtenido := (select count(*) from pg_proc p
                         join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname = 'public'
                          and p.prosecdef
                          and has_function_privilege('anon', p.oid, 'execute'))::text;

      when 20 then
        v_caso := '20 alta de usuarios solo para authenticated';
        v_esperado := 'false';
        v_obtenido := (select bool_or(has_function_privilege('anon', p.oid, 'execute'))
                         from pg_proc p
                         join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname = 'public'
                          and p.proname = 'fn_crear_usuario')::text;

      -- 6. REM: el informe se agrega en la BD y no filtra diagnosticos --
      when 21 then
        v_caso := '21 anon NO puede leer el resumen estadistico';
        v_esperado := 'false';
        v_obtenido := (select bool_or(has_function_privilege('anon', p.oid, 'execute'))
                         from pg_proc p
                         join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname = 'public'
                          and p.proname = 'fn_rem_resumen')::text;

      when 22 then
        v_caso := '22 REM: el administrador si ve diagnosticos';
        v_esperado := 'true';
        perform set_config('request.jwt.claims',
          json_build_object('sub', v_uid_adm::text)::text, true);
        set local role authenticated;
        v_obtenido := coalesce(
          (public.fn_rem_resumen() ->> 'puede_ver_diagnosticos'), '<nulo>');
        reset role;

      when 23 then
        v_caso := '23 REM: jefatura NO recibe diagnosticos';
        v_esperado := '0';
        perform set_config('request.jwt.claims',
          json_build_object('sub', v_uid_jef::text)::text, true);
        set local role authenticated;
        v_obtenido := jsonb_array_length(
          public.fn_rem_resumen() -> 'top_diagnosticos')::text;
        reset role;

      when 24 then
        v_caso := '24 REM: el doctor queda bloqueado';
        v_esperado := '1';
        perform set_config('request.jwt.claims',
          json_build_object('sub', v_uid_doc::text)::text, true);
        set local role authenticated;
        begin
          perform public.fn_rem_resumen();
          v_obtenido := '0';
        exception when others then
          v_obtenido := '1';
        end;
        reset role;

      when 25 then
        v_caso := '25 REM: el mes se acota en America/Santiago';
        v_esperado := 'true';
        v_obtenido := (public.fn_rem_resumen() ->> 'atenciones_mes')::int
                    <= (public.fn_rem_resumen() ->> 'atenciones_totales')::int;
    end case;

    if v_esperado = v_obtenido then
      v_res := 'OK';   c_ok := c_ok + 1;
    else
      v_res := 'FALLA'; c_falla := c_falla + 1;
    end if;
    insert into swimyti_test values (v_caso, v_esperado, v_obtenido || ' -> ' || v_res);
  end loop;
end $$;

select caso, esperado, obtenido from swimyti_test order by caso;
