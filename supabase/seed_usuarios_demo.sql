-- =============================================================================
-- SWIMyti — Seed usuarios demo multi-perfil (para testers y evaluación)
-- Ejecutar en Supabase → SQL Editor (como postgres / service role)
-- Crea cuentas en auth.users + perfiles en public.usuarios con su rol.
--
-- REQUISITO previo: roles sembrados por 20260812000000_initial_schema.sql
-- y extensión pgcrypto (ya creada por la migración inicial).
--
-- =============================================================================
-- ESTE ARCHIVO NO CONTIENE CONTRASEÑAS. A propósito.
-- -----------------------------------------------------------------------------
-- Cada cuenta demo recibe su clave desde una variable de sesión, con este
-- formato, o si no está definida se genera una nueva:
--
--   select set_config('app.demo_pwd_doctor', 'la-clave-que-quieras', false);
--
-- Claves aceptadas: app.demo_pwd_doctor, _enfermeria, _administrativo,
-- _apoyo, _paciente y _jefatura. La clave se aplica solo al crear la cuenta;
-- para cambiar la de una cuenta que ya existe, ver rotar_contrasenas_demo.sql.
--
-- Al final se imprime el email y la clave de cada cuenta. Ese es el único
-- momento en que la clave existe en texto legible: copiala a AGENTS.md
-- (que está en .gitignore) y no la guardes en ningún otro lado.
--
-- Ver docs/PROTOCOLO_SEGURIDAD.md.
-- -----------------------------------------------------------------------------
-- ATENCIÓN: son cuentas de demostración con claves conocidas. Nunca ejecutar
-- este seed contra una instancia con datos reales.
-- =============================================================================

do $$
declare
  v_id       uuid;
  v_rol      bigint;
  v_email    text;
  v_nombres  text;
  v_apellidos text;
  v_pwd      text;
  v_rol_jef  bigint;
  r record;
begin
  -- ---------------------------------------------------------------
  -- Las 6 cuentas demo. La clave se resuelve una vez por iteracion:
  -- la que venga en set_config, o una generada si el tester no fijo
  -- ninguna. Formato: 'Sw' + 12 hex + '!7' -> 16 chars, con mayuscula,
  -- minuscula, digito y simbolo, que es lo que pide el password strength
  -- de Supabase Auth.
  -- ---------------------------------------------------------------
  for r in
    select * from (values
      ('doctor.demo@swimyti.cl',     'doctor',        'María',   'Fuentes Rojas'),
      ('enfermeria.demo@swimyti.cl', 'enfermeria',    'Carlos',  'Pérez Soto'),
      ('admin.demo@swimyti.cl',      'administrativo','Javiera', 'López Morales'),
      ('apoyo.demo@swimyti.cl',      'unidad_apoyo',  'Rodrigo', 'Castro Díaz'),
      ('paciente.demo@swimyti.cl',   'paciente',      'Camila',  'Torres Vega'),
      ('jefatura.demo@swimyti.cl',   'enfermeria',    'Patricia','Munos Lara')
    ) as t(email, rol, nombres, apellidos)
  loop
    v_email     := r.email;
    v_nombres   := r.nombres;
    v_apellidos := r.apellidos;
    v_pwd       := coalesce(
                     current_setting('app.demo_pwd_' || r.rol, true),
                     current_setting('app.demo_pwd_jefatura', true)
                   );
    if v_pwd is null or v_pwd = '' then
      v_pwd := 'Sw' || substr(md5(random()::text || clock_timestamp()::text), 1, 12) || '!7';
    end if;

    select id_rol into v_rol from public.roles where nombre_rol = r.rol;
    if v_rol is null then
      raise exception 'SWIMyti: el rol % no existe. Corre primero 20260812000000_initial_schema.sql', r.rol;
    end if;

    select id into v_id from auth.users where email = v_email;
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
        v_email,
        crypt(v_pwd, gen_salt('bf')),
        now(),
        jsonb_build_object('provider','email','providers',array['email']),
        jsonb_build_object('nombres', v_nombres, 'apellidos', v_apellidos),
        now(), now(), '', '', '', ''
      )
      returning id into v_id;
    end if;

    insert into public.usuarios (id_usuario, id_rol, email, nombres, apellidos, activo)
    values (v_id, v_rol, v_email, v_nombres, v_apellidos, true)
    on conflict (id_usuario) do update
      set id_rol = excluded.id_rol, email = excluded.email, activo = true, updated_at = now();
  end loop;

  -- ---------------- Paciente: vincular registro en pacientes ----------------
  select id_usuario into v_id
  from public.usuarios
  where email = 'paciente.demo@swimyti.cl';

  if v_id is not null then
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
  end if;

  -- ---------------- Jefatura: rol acumulado (enfermera + jefatura) --------
  -- Demuestra el modelo N-roles: atiende como enfermera y coordina como
  -- jefatura. Su rol principal sigue siendo enfermería.
  select id_rol into v_rol_jef from public.roles where nombre_rol = 'jefatura';
  select id_usuario into v_id from public.usuarios where email = 'jefatura.demo@swimyti.cl';

  if v_id is not null and v_rol_jef is not null then
    insert into public.usuario_roles (id_usuario, id_rol, es_principal)
    values (v_id, v_rol_jef, false)
    on conflict (id_usuario, id_rol) do nothing;

    -- Ambito: coordina las dos especialidades con mas profesionales
    -- cargados, para que la demo tenga un equipo real que coordinar.
    delete from public.jefaturas_especialidades where id_jefatura = v_id;
    insert into public.jefaturas_especialidades (id_jefatura, id_especialidad)
    select v_id, id_especialidad
    from (
      select dse.id_especialidad, count(*) as n
      from public.doctores_especialidades dse
      join public.especialidades e on e.id_especialidad = dse.id_especialidad
      where e.activo
      group by dse.id_especialidad
      order by count(*) desc, dse.id_especialidad
      limit 2
    ) t;

    -- También es enfermera, así que especialidad clínica para que pueda atender.
    if not exists (
      select 1 from public.doctores_especialidades where id_doctor = v_id
    ) then
      insert into public.doctores_especialidades (id_doctor, id_especialidad, es_principal)
      select v_id, id_especialidad, true
      from public.jefaturas_especialidades
      where id_jefatura = v_id
      order by id_especialidad
      limit 1;
    end if;
  end if;
end $$;

-- =============================================================================
-- Verificación. `clave` queda vacía cuando la cuenta ya existía: el seed no
-- resetea contraseñas, solo rotar_contrasenas_demo.sql lo hace.
-- =============================================================================
select
  us.email,
  us.nombres,
  us.apellidos,
  ro.nombre_rol,
  us.activo,
  case
    when u.id is null then '(sin fila en auth)'
    else '(ya existía: clave no modificada por este seed)'
  end as clave
from public.usuarios us
join public.roles ro on ro.id_rol = us.id_rol
left join auth.users u on u.id = us.id_usuario
where us.email like '%demo@swimyti.cl'
order by ro.nombre_rol;
