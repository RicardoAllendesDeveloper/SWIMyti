-- =============================================================================
-- SWIMyti — Seed de profesionales de demostración
-- =============================================================================
-- COMPLEMENTA seed_usuarios_demo.sql. Ese crea las CUENTAS (auth + usuarios +
-- rol). Este crea los PROFESIONALES que las cuentas necesitan para trabajar:
-- al menos un doctor y una enfermera con especialidad asignada, mas el resto
-- del equipo, para que la agenda tenga un equipo real que coordinar.
--
-- Por que un archivo aparte:
--   seed_usuarios_demo.sql responde a "quien entra". Este responde a "sobre
--   quien se agenda". La jefatura.demo elige sus ambitos de coordinacion
--   contando profesionales, asi que sin este archivo se coordina sobre un
--   equipo vacio y no hay nada que publicar.
--
-- NO CONTIENE CONTRASENAS. Solo crea perfiles en public.usuarios, que es la
-- capa de la aplicacion. Estas cuentas se crean en auth con las credenciales
-- que el tester fija por su cuenta (ver rotar_contrasenas_demo.sql).
--
-- Ejecutar DESPUES de seed_usuarios_demo.sql y DESPUES de la migracion
-- 20260930090000_especialidad_id_agenda_coordinable.sql.
-- =============================================================================

do $$
declare
  r record;
  v_rol      bigint;
  v_esp      bigint;
  v_esp_enf  bigint;
  v_esp_mg   bigint;
  v_id       uuid;
  v_pwd      text;
  v_nombres  text;
  v_apellidos text;
begin
  -- Especialidades de referencia. Se resuelven por nombre para que el seed
  -- no dependa del id: si el catalogo cambia de orden, esto sigue siendo
  -- valido.
  select id_especialidad into v_esp_mg   from public.especialidades where nombre = 'Medicina General' and activo;
  select id_especialidad into v_esp_enf  from public.especialidades where nombre = 'Enfermería' and activo;

  if v_esp_mg is null or v_esp_enf is null then
    raise exception 'SWIMyti: el catalogo de especialidades necesita Medicina General y Enfermería. Corre 20260812000000_initial_schema.sql';
  end if;

  -- ---------------------------------------------------------------------
  -- Equipo de demostracion.
  --
  -- email | rol | especialidad | es_principal
  --
  -- Los nombres son ficticios y de demostracion. Regla de negocio que este
  -- archivo respeta: enfermería se asigna SIEMPRE a Enfermería, nunca a
  -- Medicina General. Mezclar los dos es lo que hacia que la agenda mostrara
  -- a las enfermeras en un ambito que no era suyo.
  -- ---------------------------------------------------------------------
  for r in
    select * from (values
      ('medico.general.demo@swimyti.cl', 'doctor',     'Medicina General', 'Andrés',  'Medina Cruz', true),
      ('cardiologo.demo@swimyti.cl',    'doctor',     'Cardiología',      'Beatriz', 'Sandoval Nuñez', true),
      ('traumatologo.demo@swimyti.cl',  'doctor',     'Traumatología',    'Diego',   'Espinoza Ruiz',  true),
      ('dermatologo.demo@swimyti.cl',   'doctor',     'Dermatología',     'Elena',   'Paredes Vega',   true),
      ('enfermera.demo@swimyti.cl',     'enfermeria', 'Enfermería',       'Fernanda','González Bravo', true),
      ('enfermero.demo@swimyti.cl',     'enfermeria', 'Enfermería',       'Gonzalo', 'Molina Tapia',  true),
      ('toma.muestra.demo@swimyti.cl',  'enfermeria', 'Enfermería',       'Iris',    'Reyes Oyarza',   false)
    ) as t(email, rol, especialidad, nombres, apellidos, principal)
  loop
    select id_rol into v_rol from public.roles where nombre_rol = r.rol;
    if v_rol is null then
      raise exception 'SWIMyti: el rol % no existe', r.rol;
    end if;

    select id_especialidad into v_esp
    from public.especialidades where nombre = r.especialidad and activo;
    if v_esp is null then
      raise exception 'SWIMyti: la especialidad % no existe', r.especialidad;
    end if;

    v_nombres  := r.nombres;
    v_apellidos := r.apellidos;

    -- Clave autogenerada POR CUENTA, a proposito. Estas cuentas no se usan para
    -- entrar al producto: la bateria manual usa las 6 de
    -- seed_usuarios_demo.sql. El equipo de profesionales existe para que la
    -- agenda tenga sobre quien agendar. Compartir una clave por rol dejaria
    -- varias cuentas con la misma, que es justo lo que el protocolo de
    -- seguridad busca evitar. Formato: 'Sw' + 12 hex + '!7'.
    --
    -- Si necesitas entrar con una de estas, fija la clave antes de correr:
    --   select set_config('app.demo_pwd_medico_general', 'la-clave', false);
    -- y agregala a la lista de abajo.
    v_pwd := current_setting(
               'app.demo_pwd_' || replace(r.email, '@swimyti.cl', ''), true
             );
    if v_pwd is null or v_pwd = '' then
      v_pwd := 'Sw' || substr(md5(random()::text || clock_timestamp()::text), 1, 12) || '!7';
    end if;

    -- Cuenta de autenticacion.
    select id into v_id from auth.users where email = r.email;
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
        r.email,
        crypt(v_pwd, gen_salt('bf')),
        now(),
        jsonb_build_object('provider','email','providers',array['email']),
        jsonb_build_object('nombres', v_nombres, 'apellidos', v_apellidos),
        now(), now(), '', '', '', ''
      )
      returning id into v_id;
    end if;

    -- auth.identities: sin esto la cuenta existe pero no puede iniciar sesion.
    -- GoTrue exige una identity de provider 'email' para el login con clave.
    if not exists (
      select 1 from auth.identities where user_id = v_id
    ) then
      insert into auth.identities (
        user_id, provider, identity_data, provider_id,
        last_sign_in_at, created_at, updated_at
      )
      values (
        v_id, 'email',
        jsonb_build_object('sub', v_id::text, 'email', r.email, 'email_verified', true),
        v_id::text, null, now(), now()
      );
    end if;

    -- Perfil de aplicacion. Idempotente: si ya existe, se actualiza.
    insert into public.usuarios (id_usuario, id_rol, email, nombres, apellidos, activo)
    values (v_id, v_rol, r.email, v_nombres, v_apellidos, true)
    on conflict (id_usuario) do update
      set id_rol    = excluded.id_rol,
          email     = excluded.email,
          nombres   = excluded.nombres,
          apellidos = excluded.apellidos,
          activo    = true,
          updated_at = now();

    -- Especialidad clinica. Un profesional con varias posibles tendria que
    -- declararlas todas; aca cada uno tiene la suya.
    --
    -- Ojo con uq_doctores_especialidades_principal: solo UNA especialidad
    -- principal por profesional. `toma.muestra.demo` va con false (es una
    -- segunda enfermera de apoyo, no la principal de su especialidad) y el
    -- resto con true. Antes de marcar una como principal se baja la que
    -- tuviera, para que el seed sea idempotente aunque el profesional ya
    -- existiera con otra especialidad principal.
    if r.principal then
      update public.doctores_especialidades
      set es_principal = false
      where id_doctor = v_id and id_especialidad <> v_esp;
    end if;

    insert into public.doctores_especialidades (id_doctor, id_especialidad, es_principal)
    values (v_id, v_esp, r.principal)
    on conflict (id_doctor, id_especialidad) do update
      set es_principal = excluded.es_principal;
  end loop;
end $$;

-- =============================================================================
-- Verificacion: el equipo quedo cargado y, sobre todo, la enfermería NO tiene
-- Medicina General. Ese cruce era el defecto que se arrastraba.
-- =============================================================================
select
  ro.nombre_rol,
  e.nombre as especialidad,
  count(*) as profesionales,
  case
    when ro.nombre_rol = 'enfermeria' and e.nombre <> 'Enfermería'
      then 'REVISAR: enfermeria con especialidad ajena'
    else 'ok'
  end as revision
from public.doctores_pecialidades dse
join public.especialidades e on e.id_especialidad = dse.id_especialidad
join public.usuarios u on u.id_usuario = dse.id_doctor
join public.roles ro on ro.id_rol = u.id_rol
group by ro.nombre_rol, e.nombre
order by ro.nombre_rol, e.nombre;