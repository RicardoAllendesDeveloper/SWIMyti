-- =============================================================================
-- SWIMyti — Seed usuarios demo multi-perfil (para testers y evaluación)
-- Ejecutar en Supabase → SQL Editor (como postgres / service role)
-- Crea cuentas en auth.users + perfiles en public.usuarios con su rol.
--
-- NOTA: usa INSERT directo en auth.users con crypt() (pgcrypto), porque
-- auth.admin_create_user() no existe en todas las versiones de Supabase.
-- =============================================================================
-- Requisito previo: roles sembrados por 20260812000000_initial_schema.sql
-- y extensión pgcrypto (ya creada por la migración inicial).
-- =============================================================================

do $$
declare
  v_id uuid;
  v_rol_doctor    bigint;
  v_rol_enfer     bigint;
  v_rol_admin     bigint;
  v_rol_apoyo     bigint;
  v_rol_pac       bigint;
begin
  select id_rol into v_rol_doctor from public.roles where nombre_rol = 'doctor';
  select id_rol into v_rol_enfer from public.roles where nombre_rol = 'enfermeria';
  select id_rol into v_rol_admin from public.roles where nombre_rol = 'administrativo';
  select id_rol into v_rol_apoyo from public.roles where nombre_rol = 'unidad_apoyo';
  select id_rol into v_rol_pac   from public.roles where nombre_rol = 'paciente';

  -- ---------------- Doctor ----------------
  select id into v_id from auth.users where email = 'doctor.demo@swimyti.cl';
  if v_id is null then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, recovery_token,
      email_change, email_change_token_new
    )
    values (
      '00000000-0000-0000-0000-000000000000',
      gen_random_uuid(),
      'authenticated', 'authenticated',
      'doctor.demo@swimyti.cl',
      crypt('Doctor123!', gen_salt('bf')),
      now(),
      jsonb_build_object('provider','email','providers',array['email']),
      jsonb_build_object('nombres','María','apellidos','Fuentes Rojas'),
      now(), now(), '', '', '', ''
    )
    returning id into v_id;
  end if;
  insert into public.usuarios (id_usuario, id_rol, email, nombres, apellidos, activo)
  values (v_id, v_rol_doctor, 'doctor.demo@swimyti.cl', 'María', 'Fuentes Rojas', true)
  on conflict (id_usuario) do update
    set id_rol = excluded.id_rol, email = excluded.email, activo = true, updated_at = now();

  -- ---------------- Enfermería ----------------
  select id into v_id from auth.users where email = 'enfermeria.demo@swimyti.cl';
  if v_id is null then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, recovery_token,
      email_change, email_change_token_new
    )
    values (
      '00000000-0000-0000-0000-000000000000',
      gen_random_uuid(),
      'authenticated', 'authenticated',
      'enfermeria.demo@swimyti.cl',
      crypt('Enfermeria123!', gen_salt('bf')),
      now(),
      jsonb_build_object('provider','email','providers',array['email']),
      jsonb_build_object('nombres','Carlos','apellidos','Pérez Soto'),
      now(), now(), '', '', '', ''
    )
    returning id into v_id;
  end if;
  insert into public.usuarios (id_usuario, id_rol, email, nombres, apellidos, activo)
  values (v_id, v_rol_enfer, 'enfermeria.demo@swimyti.cl', 'Carlos', 'Pérez Soto', true)
  on conflict (id_usuario) do update
    set id_rol = excluded.id_rol, email = excluded.email, activo = true, updated_at = now();

  -- ---------------- Administrativo ----------------
  select id into v_id from auth.users where email = 'admin.demo@swimyti.cl';
  if v_id is null then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, recovery_token,
      email_change, email_change_token_new
    )
    values (
      '00000000-0000-0000-0000-000000000000',
      gen_random_uuid(),
      'authenticated', 'authenticated',
      'admin.demo@swimyti.cl',
      crypt('Admin123!', gen_salt('bf')),
      now(),
      jsonb_build_object('provider','email','providers',array['email']),
      jsonb_build_object('nombres','Javiera','apellidos','López Morales'),
      now(), now(), '', '', '', ''
    )
    returning id into v_id;
  end if;
  insert into public.usuarios (id_usuario, id_rol, email, nombres, apellidos, activo)
  values (v_id, v_rol_admin, 'admin.demo@swimyti.cl', 'Javiera', 'López Morales', true)
  on conflict (id_usuario) do update
    set id_rol = excluded.id_rol, email = excluded.email, activo = true, updated_at = now();

  -- ---------------- Unidad de Apoyo ----------------
  select id into v_id from auth.users where email = 'apoyo.demo@swimyti.cl';
  if v_id is null then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, recovery_token,
      email_change, email_change_token_new
    )
    values (
      '00000000-0000-0000-0000-000000000000',
      gen_random_uuid(),
      'authenticated', 'authenticated',
      'apoyo.demo@swimyti.cl',
      crypt('Apoyo123!', gen_salt('bf')),
      now(),
      jsonb_build_object('provider','email','providers',array['email']),
      jsonb_build_object('nombres','Rodrigo','apellidos','Castro Díaz'),
      now(), now(), '', '', '', ''
    )
    returning id into v_id;
  end if;
  insert into public.usuarios (id_usuario, id_rol, email, nombres, apellidos, activo)
  values (v_id, v_rol_apoyo, 'apoyo.demo@swimyti.cl', 'Rodrigo', 'Castro Díaz', true)
  on conflict (id_usuario) do update
    set id_rol = excluded.id_rol, email = excluded.email, activo = true, updated_at = now();

  -- ---------------- Paciente (portal) ----------------
  select id into v_id from auth.users where email = 'paciente.demo@swimyti.cl';
  if v_id is null then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, recovery_token,
      email_change, email_change_token_new
    )
    values (
      '00000000-0000-0000-0000-000000000000',
      gen_random_uuid(),
      'authenticated', 'authenticated',
      'paciente.demo@swimyti.cl',
      crypt('Paciente123!', gen_salt('bf')),
      now(),
      jsonb_build_object('provider','email','providers',array['email']),
      jsonb_build_object('nombres','Camila','apellidos','Torres Vega'),
      now(), now(), '', '', '', ''
    )
    returning id into v_id;
  end if;
  insert into public.usuarios (id_usuario, id_rol, email, nombres, apellidos, activo)
  values (v_id, v_rol_pac, 'paciente.demo@swimyti.cl', 'Camila', 'Torres Vega', true)
  on conflict (id_usuario) do update
    set id_rol = excluded.id_rol, email = excluded.email, activo = true, updated_at = now();

  -- Vincular al paciente con un registro en pacientes (si no existe por RUT o portal)
  if not exists (
    select 1 from public.pacientes
    where id_usuario_portal = v_id or lower(rut) = '26.765.432-1'
  ) then
    insert into public.pacientes (
      id_usuario_portal, rut, prevision, nombres, apellidos, sexo, activo
    )
    values (v_id, '26.765.432-1', 'FONASA', 'Camila', 'Torres Vega', 'F', true);
  else
    update public.pacientes
      set id_usuario_portal = v_id, activo = true, updated_at = now()
    where id_usuario_portal = v_id or lower(rut) = '26.765.432-1';
  end if;
end $$;

-- =============================================================================
-- Verificación
-- =============================================================================
select
  us.email,
  us.nombres,
  us.apellidos,
  ro.nombre_rol,
  us.activo
from public.usuarios us
join public.roles ro on ro.id_rol = us.id_rol
where us.email like '%demo@swimyti.cl'
order by ro.nombre_rol;

-- =============================================================================
-- Credenciales demo
-- =============================================================================
-- doctor.demo@swimyti.cl        / Doctor123!
-- enfermeria.demo@swimyti.cl    / Enfermeria123!
-- admin.demo@swimyti.cl         / Admin123!
-- apoyo.demo@swimyti.cl         / Apoyo123!
-- paciente.demo@swimyti.cl      / Paciente123!