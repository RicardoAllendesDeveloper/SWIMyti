-- =============================================================================
-- FIX: creación de usuarios desde el panel Admin (rol administrador)
-- =============================================================================
-- Problema: Usuarios.tsx usaba supabase.auth.admin.createUser() desde el
-- cliente web, pero esa API Admin exige la service_role key (nunca en el
-- frontend). Al usarla con la anon key, Supabase respondía:
--   "This endpoint requires a valid Bearer token"
--
-- Solución: RPC SECURITY DEFINER que (1) valida que el llamador sea rol
-- administrador por auth.uid(), (2) crea el usuario en auth.users vía la
-- función oficial auth.admin_create_user() (hashea la contraseña con el
-- algoritmo de Go de Supabase, compatible con el signIn del cliente),
-- (3) inserta el perfil en public.usuarios. Se ejecuta con los privilegios
-- del owner (postgres), que sí posee permisos sobre el schema auth.
--
-- SEGURIDAD: es SECURITY DEFINER pero solo actúa si fn_rol_actual() es
-- 'administrador'. No acepta datos sensibles distintos a los del formulario
-- y fija el search_path delimitado para evitar escalada de privilegios.
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
  v_caller_rol text;
  v_rol_nombre text;
  v_user_id    uuid;
begin
  v_caller_rol := public.fn_rol_actual();
  if v_caller_rol <> 'administrador' then
    return jsonb_build_object('ok', false, 'error', 'Solo un administrador puede crear usuarios.');
  end if;

  -- Validar el rol destino (debe existir y no ser paciente)
  select r.nombre_rol into v_rol_nombre
  from public.roles r
  where r.id_rol = p_id_rol;

  if v_rol_nombre is null then
    return jsonb_build_object('ok', false, 'error', 'El rol indicado no existe.');
  end if;

  if v_rol_nombre = 'paciente' then
    return jsonb_build_object('ok', false, 'error', 'El rol paciente se crea vía el portal de registro.');
  end if;

  begin
    v_user_id := auth.admin_create_user(
      password       => p_password,
      email          => lower(trim(p_email)),
      email_confirm  => true,
      data           => jsonb_build_object('nombres', p_nombres, 'apellidos', p_apellidos)
    );
  exception when others then
    return jsonb_build_object('ok', false, 'error', sqlerrm);
  end;

  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'No se pudo crear el usuario en Auth.');
  end if;

  begin
    insert into public.usuarios (id_usuario, id_rol, email, nombres, apellidos, rut, activo)
    values (v_user_id, p_id_rol, lower(trim(p_email)), p_nombres, p_apellidos, nullif(trim(p_rut), ''), true);
  exception when others then
    -- Revertir el usuario de Auth si el perfil falla
    begin
      delete from auth.users where id = v_user_id;
    exception when others then null;
    end;
    return jsonb_build_object('ok', false, 'error', sqlerrm);
  end;

  return jsonb_build_object('ok', true, 'id', v_user_id::text, 'email', lower(trim(p_email)));
end;
$$;

grant execute on function public.fn_crear_usuario(text, text, text, text, bigint, text) to authenticated;