-- SWIMyti: cierra los dos pendientes de la auditoria previa a las pruebas.
--
-- 1) fn_crear_usuario decidia con fn_rol_actual(), que devuelve SOLO el rol
--    principal (usuarios.id_rol). Con el modelo N-roles de AGENTS.md, un
--    administrador con el rol principal distinto de 'administrador' quedaba
--    fuera de la RPC. Se pasa a fn_tiene_rol, que evalua el conjunto.
--
--    No se toca el insert en public.usuarios ni el id_rol: el comportamiento de
--    trg_sync_usuario_rol_principal queda exactamente igual (ver AGENTS.md).
--
-- 2) fn_rem_resumen imprimia el mes con to_char(v_ini_mes, 'FMMonth YYYY'), que
--    depende de lc_time. En este proyecto lc_time = en_US.UTF-8, asi que el
--    informe salia en ingles ("September 2026") en un documento legal chileno.
--    No hay collations es_* instaladas (collations_es = 0) y el to_char de tres
--    argumentos no existe en esta version, asi que la solucion es una tabla de
--    meses en espanol que no dependa de la configuracion regional.

-- ------------------------------------------------------------------
-- 1) fn_crear_usuario: validar el conjunto de roles
-- ------------------------------------------------------------------
create or replace function public.fn_crear_usuario(
  p_email     text,
  p_password  text,
  p_nombres   text,
  p_apellidos text,
  p_id_rol    bigint,
  p_rut       text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_rol_nombre text;
  v_user_id    uuid;
  v_email      text;
  v_hash       text;
begin
  -- Sesión obligatoria. Antes esto no se comprobaba y el guard de rol solo
  -- fallaba abierto cuando fn_rol_actual() devolvía NULL.
  if (select auth.uid()) is null then
    return jsonb_build_object('ok', false, 'error', 'Se requiere sesión autenticada.');
  end if;

  -- fn_tiene_rol evalua TODOS los roles acumulados en usuario_roles, no solo el
  -- principal. Falla cerrada: sin sesión devuelve false.
  if not public.fn_tiene_rol(array['administrador']) then
    return jsonb_build_object('ok', false, 'error', 'Solo un administrador puede crear usuarios.');
  end if;

  v_email := lower(btrim(p_email));

  select r.nombre_rol into v_rol_nombre
    from public.roles r
   where r.id_rol = p_id_rol;

  if v_rol_nombre is null then
    return jsonb_build_object('ok', false, 'error', 'El rol indicado no existe.');
  end if;

  if v_rol_nombre = 'paciente' then
    return jsonb_build_object('ok', false, 'error', 'El rol paciente se crea vía el portal de registro.');
  end if;

  if exists (select 1 from auth.users where lower(email) = v_email) then
    return jsonb_build_object('ok', false, 'error', 'Ya existe un usuario con ese email.');
  end if;

  v_user_id := gen_random_uuid();
  v_hash    := crypt(p_password, gen_salt('bf'));

  begin
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change,
      email_change_token_new, email_change_token_current,
      created_at, updated_at
    ) values (
      '00000000-0000-0000-0000-000000000000',
      v_user_id, 'authenticated', 'authenticated', v_email, v_hash,
      now(),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      jsonb_build_object('nombres', p_nombres, 'apellidos', p_apellidos),
      '', '', '', '', '',
      now(), now()
    );

    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    ) values (
      v_user_id, v_user_id, v_email,
      jsonb_build_object('sub', v_user_id::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
      'email', now(), now(), now()
    );
  exception when others then
    begin
      delete from auth.identities where user_id = v_user_id;
      delete from auth.users      where id       = v_user_id;
    exception when others then null;
    end;
    return jsonb_build_object('ok', false, 'error', 'No se pudo crear el usuario en Auth: ' || sqlerrm);
  end;

  begin
    insert into public.usuarios (id_usuario, id_rol, email, nombres, apellidos, rut, activo)
    values (v_user_id, p_id_rol, v_email, p_nombres, p_apellidos, nullif(btrim(p_rut), ''), true);
  exception when others then
    begin
      delete from auth.identities where user_id = v_user_id;
      delete from auth.users      where id       = v_user_id;
    exception when others then null;
    end;
    return jsonb_build_object('ok', false, 'error', 'No se pudo crear el perfil: ' || sqlerrm);
  end;

  return jsonb_build_object('ok', true, 'id', v_user_id::text, 'email', v_email);
end;
$function$;

-- ------------------------------------------------------------------
-- 2) Mes en espanol, independiente de lc_time
-- ------------------------------------------------------------------
create or replace function public.fn_nombre_mes_es(p_mes integer)
returns text
language sql
immutable
set search_path to 'public'
as $function$
  select case p_mes
           when  1 then 'enero'      when  2 then 'febrero'   when  3 then 'marzo'
           when  4 then 'abril'      when  5 then 'mayo'      when  6 then 'junio'
           when  7 then 'julio'      when  8 then 'agosto'    when  9 then 'septiembre'
           when 10 then 'octubre'    when 11 then 'noviembre' when 12 then 'diciembre'
         end;
$function$;

-- Helper interno: el cliente llama a fn_rem_resumen, no a esta.
-- Hay que revocar de PUBLIC, no solo de anon/authenticated: en Postgres el
-- EXECUTE por defecto viene del privilegio PUBLIC, asi que quitarlo solo de los
-- dos roles deja la funcion ejecutable por cualquiera.
revoke execute on function public.fn_nombre_mes_es(integer) from public;

create or replace function public.fn_rem_resumen()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_es_admin boolean;
  v_ini_mes  date;
  v_fin_mes  date;
  v_result   jsonb;
begin
  if not public.fn_tiene_rol(array['jefatura', 'administrador']) then
    raise exception 'SWIMyti: el resumen estadistico es solo para jefatura y administracion'
      using errcode = '42501';
  end if;

  v_es_admin := public.fn_es_admin();
  v_ini_mes := date_trunc('month', now() at time zone 'America/Santiago')::date;
  v_fin_mes := (v_ini_mes + interval '1 month')::date;

  v_result := jsonb_build_object(
    -- Sin to_char con 'Month': dependia de lc_time y salia en ingles.
    'periodo', initcap(public.fn_nombre_mes_es(extract(month from v_ini_mes)::integer)
                       || ' ' || extract(year from v_ini_mes)::integer),
    'generado_en', now(),
    'atenciones_totales', (select count(*)::int from public.fichas_medicas),
    'atenciones_mes', (
      select count(*)::int from public.fichas_medicas f
       where (f.created_at at time zone 'America/Santiago')::date >= v_ini_mes
         and (f.created_at at time zone 'America/Santiago')::date <  v_fin_mes
    ),
    'citas_registradas', (select count(*)::int from public.citas),
    'bonos_totales', (select count(*)::int from public.bonos_atencion),
    'top_especialidades', coalesce((
      select jsonb_agg(t order by t.valor desc, t.clave) from (
        select coalesce(e.nombre, 'Sin informacion') as clave, count(*)::int as valor
          from public.citas c
          join public.horarios_disponibles h on h.id_horario = c.id_horario
          left join public.especialidades e on e.id_especialidad = h.id_especialidad
         group by 1 order by 2 desc, 1 limit 5
      ) t
    ), '[]'::jsonb),
    'distribucion_atencion', coalesce((
      select jsonb_agg(t order by t.valor desc, t.clave) from (
        select case when b.tipo_atencion = 'procedimiento' then 'Procedimientos' else 'Consultas' end as clave,
               count(*)::int as valor
          from public.bonos_atencion b group by 1 order by 2 desc, 1
      ) t
    ), '[]'::jsonb),
    'ingresos_por_tipo', coalesce((
      select jsonb_agg(t order by t.valor desc, t.clave) from (
        select case when b.tipo_atencion = 'procedimiento' then 'Procedimientos' else 'Consultas' end as clave,
               round(sum(coalesce(b.monto, 0)))::int as valor
          from public.bonos_atencion b group by 1 order by 2 desc, 1
      ) t
    ), '[]'::jsonb),
    'top_diagnosticos', case when v_es_admin then coalesce((
      select jsonb_agg(t order by t.valor desc, t.clave) from (
        select nullif(btrim(f.diagnostico), '') as clave, count(*)::int as valor
          from public.fichas_medicas f
         where f.diagnostico is not null and btrim(f.diagnostico) <> ''
         group by 1 order by 2 desc, 1 limit 5
      ) t
    ), '[]'::jsonb) else '[]'::jsonb end,
    'puede_ver_diagnosticos', v_es_admin
  );

  return v_result;
end;
$function$;
