-- =============================================================================
-- SWIMyti - Migración compensatoria de seguridad: RPC del schema public
-- -----------------------------------------------------------------------------
-- Auditoría del 2026-09-28 (40 migraciones aplicadas contra los catálogos).
--
-- HALLAZGO 1 - Los `revoke` del proyecto nunca sirvieron
-- Las migraciones anteriores terminaban con `revoke all on function ... from
-- public`. Eso no retira nada: Supabase aplica ALTER DEFAULT PRIVILEGES que
-- otorga EXECUTE de forma EXPLÍCITA a anon / authenticated / service_role al
-- crear cada función, y revocar al rol PUBLIC no elimina esos otorgamientos
-- directos. Resultado: las 30 funciones de public quedaban invocables con la
-- anon key, que viaja pública en el bundle del navegador.
--
-- HALLAZGO 2 - Escalada de privilegios sin autenticación
-- public.fn_crear_usuario es SECURITY DEFINER y su único guard era:
--     v_caller_rol := public.fn_rol_actual();
--     if v_caller_rol <> 'administrador' then
--       return ... 'Solo un administrador puede crear usuarios.'
--     end if;
-- Sin sesión, fn_rol_actual() devuelve NULL (u.id_usuario = auth.uid() con
-- auth.uid() NULL no matchea ninguna fila). En PL/pgSQL `NULL <> 'x'` es NULL,
-- y un `if` con NULL se evalúa como false: el guard NO se entraba. La función
-- seguía e insertaba en auth.users + auth.identities + public.usuarios con el
-- rol y la contraseña que eligiera el llamante, sin filtrar p_id_rol (solo
-- bloqueaba el rol 'paciente').
-- Explotación: POST /rest/v1/rpc/fn_crear_usuario con la anon key → crear un
-- administrador → iniciar sesión → control total del sistema, incluida la
-- ficha clínica (Ley 19.628).
--
-- CORRECCIONES
--   1. fn_crear_usuario: exigir sesión explícita y usar `is distinct from`
--      (NULL-safe) en vez de `<>`.
--   2. Revocar EXECUTE a `anon` en todas las funciones de public. La
--      autorización real siguen siendo las políticas RLS y los guards
--      internos; esto cierra la superficie de invocación anónima.
--   3. Revocar también al rol PUBLIC y reotorgar explícitamente a
--      `authenticated` y `service_role`, para que la próxima vez que se cree
--      una función no vuelva a quedar abierta por defecto.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. fn_crear_usuario: guard NULL-safe
-- -----------------------------------------------------------------------------
-- Se conserva el cuerpo tal cual (misma huella de hash salvo el guard) para no
-- alterar el flujo de alta de usuarios. search_path se mantiene en
-- 'public, extensions' porque el cuerpo usa crypt/gen_salt/gen_random_uuid.
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
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_caller_rol  text;
  v_rol_nombre  text;
  v_user_id     uuid;
  v_email       text;
  v_hash        text;
begin
  -- Sesión obligatoria. Antes esto no se comprobaba y el guard de rol solo
  -- fallaba abierto cuando fn_rol_actual() devolvía NULL (es decir, siempre
  -- que no hubiera sesión).
  if (select auth.uid()) is null then
    return jsonb_build_object('ok', false, 'error', 'Se requiere sesión autenticada.');
  end if;

  v_caller_rol := public.fn_rol_actual();

  -- `is distinct from` trata NULL correctamente: sin rol asignado, el
  -- resultado es true y la función se detiene. Con `<>` el NULL producía un
  -- IF no ejecutado y la RPC quedaba abierta a cualquiera.
  if v_caller_rol is distinct from 'administrador' then
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
      delete from auth.users where id = v_user_id;
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
      delete from auth.users where id = v_user_id;
    exception when others then null;
    end;
    return jsonb_build_object('ok', false, 'error', 'No se pudo crear el perfil: ' || sqlerrm);
  end;

  return jsonb_build_object('ok', true, 'id', v_user_id::text, 'email', v_email);
end;
$$;

comment on function public.fn_crear_usuario(text, text, text, text, bigint, text) is
  'Alta de usuarios por el panel de administración. Solo un administrador autenticado.';

-- -----------------------------------------------------------------------------
-- 2 y 3. Privilegios de ejecución sobre todas las funciones de public
-- -----------------------------------------------------------------------------
-- Se recorre el catálogo en vez de listar las 30 funciones a mano, para que la
-- migración siga siendo válida si se crean o eliminan funciones.
do $$
declare
  r record;
begin
  for r in
    -- regprocedure se renderiza SIN esquema si el search_path incluye public,
    -- así que se antepone el nombre a mano para no depender del contexto.
    select format('%I.%s', n.nspname, p.oid::regprocedure::text) as firma
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  loop
    -- Cierra la vía anónima (hallazgo 1).
    execute format('revoke execute on function %s from anon', r.firma);
    -- Quita el otorgamiento por defecto del rol PUBLIC, que era un no-op
    -- mientras existiera el EXPLÍCITO de ALTER DEFAULT PRIVILEGES.
    execute format('revoke execute on function %s from public', r.firma);
    -- El frontend siempre llama con sesión: authenticated (y service_role para
    -- uso administrativo) conservan el acceso.
    execute format('grant execute on function %s to authenticated, service_role', r.firma);
  end loop;
end;
$$;
