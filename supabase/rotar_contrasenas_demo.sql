-- =============================================================================
-- SWIMyti — Rotación de contraseñas de las cuentas demo
-- Ejecutar en Supabase → SQL Editor (como postgres / service role)
--
-- -----------------------------------------------------------------------------
-- Para qué: rotar las claves de las cuentas demo al terminar cada batería de
-- pruebas manuales, de modo que una clave filtrada en un captura, ticket o
-- conversación quede invalidada al día siguiente.
--
-- Este script NO contiene contraseñas. Lee cada clave de una variable de
-- sesión (formato set_config) o, si no está definida, genera una nueva:
--
--   select set_config('app.demo_pwd_doctor', 'la-clave-que-quieras', false);
--
-- Claves aceptadas: app.demo_pwd_doctor, _enfermeria, _administrativo,
-- _apoyo, _paciente y _jefatura. La correspondencia es por ROL, no por email:
-- jefatura.demo lee app.demo_pwd_jefatura.
--
-- Las claves generadas se imprimen UNA vez al final. Ese es el único momento
-- en que existen en texto legible. Copialas a AGENTS.md (está en .gitignore)
-- y a ningún otro lado.
--
-- Ver docs/PROTOCOLO_SEGURIDAD.md.
-- =============================================================================

create temporary table _demo_rotadas (
  email     text primary key,
  clave     text,
  origen    text
);

do $$
declare
  r record;
  v_id   uuid;
  v_pwd  text;
  v_flag text;
begin
  for r in
    select * from (values
      ('doctor.demo@swimyti.cl',     'doctor'),
      ('enfermeria.demo@swimyti.cl', 'enfermeria'),
      ('admin.demo@swimyti.cl',      'administrativo'),
      ('apoyo.demo@swimyti.cl',      'unidad_apoyo'),
      ('paciente.demo@swimyti.cl',   'paciente'),
      ('jefatura.demo@swimyti.cl',   'jefatura')
    ) as t(email, rol)
  loop
    v_pwd  := current_setting('app.demo_pwd_' || r.rol, true);
    v_flag := 'definida por el tester';

    if v_pwd is null or v_pwd = '' then
      v_pwd  := 'Sw' || substr(md5(random()::text || clock_timestamp()::text), 1, 12) || '!7';
      v_flag := 'generada';
    end if;

    select id into v_id from auth.users where email = r.email;
    if v_id is null then
      raise exception 'SWIMyti: la cuenta % no existe en auth.users. Corre seed_usuarios_demo.sql primero.', r.email;
    end if;

    update auth.users
       set encrypted_password = crypt(v_pwd, gen_salt('bf')),
           updated_at         = now()
     where id = v_id;

    insert into _demo_rotadas (email, clave, origen) values (r.email, v_pwd, v_flag);
  end loop;
end $$;

-- =============================================================================
-- Resultado. Copiar las claves a AGENTS.md y cerrar esta sesión.
-- =============================================================================
select email, clave, origen from _demo_rotadas order by email;

drop table _demo_rotadas;

-- =============================================================================
-- Verificación: las 6 cuentas existen y quedaron activas.
-- =============================================================================
select
  us.email,
  ro.nombre_rol,
  us.activo,
  (u.id is not null) as existe_en_auth
from public.usuarios us
join public.roles ro on ro.id_rol = us.id_rol
left join auth.users u on u.id = us.id_usuario
where us.email like '%demo@swimyti.cl'
order by ro.nombre_rol, us.email;
