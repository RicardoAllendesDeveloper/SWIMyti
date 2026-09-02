-- =============================================================================
-- FIX: creación de usuarios desde el panel Admin (rol administrador) - v2
-- =============================================================================
-- v1 usaba auth.admin_create_user(password, email, email_confirm, data) que NO
-- existe en el schema auth de la instancia. Se reemplaza por inserción directa
-- en auth.users + auth.identities usando el hash bcrypt de pgcrypto, que es el
-- formato que Supabase reconoce (y rehashea al primer signInWithPassword).
--
-- SEGURIDAD: RPC SECURITY DEFINER que solo actúa si fn_rol_actual() es
-- 'administrador'. fija search_path delimitado y valida el rol destino.
-- =============================================================================

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
set search_path = public
as $$
declare
  v_caller_rol  text;
  v_rol_nombre  text;
  v_user_id     uuid;
  v_email       text;
  v_hash        text;
begin
  v_caller_rol := public.fn_rol_actual();
  if v_caller_rol <> 'administrador' then
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
      created_at, updated_at
    ) values (
      '00000000-0000-0000-0000-000000000000',
      v_user_id, 'authenticated', 'authenticated', v_email, v_hash,
      now(),
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      jsonb_build_object('nombres', p_nombres, 'apellidos', p_apellidos),
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

grant execute on function public.fn_crear_usuario(text, text, text, text, bigint, text) to authenticated;