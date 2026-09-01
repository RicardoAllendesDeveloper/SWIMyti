-- =============================================================================
-- SWIMyti — Completar perfil de paciente (cuenta real confirmada por email)
-- Email: risho.osorio.allendes@gmail.com
-- Nombre: Alejo Felipe Alegría Cid
-- RUT: 1.000.007-K (ficticio para demo, dígito verificador válido)
-- =============================================================================
do $$
declare
  v_uid uuid;
  v_rol_paciente bigint;
  v_id_paciente bigint;
begin
  select id into v_uid
  from auth.users
  where email = 'risho.osorio.allendes@gmail.com';

  if v_uid is null then
    raise notice 'No se encontró el usuario en auth.users con ese email.';
    return;
  end if;

  select id_rol into v_rol_paciente
  from public.roles where nombre_rol = 'paciente';

  -- 1) Perfil en public.usuarios (rol paciente, activo)
  insert into public.usuarios (
    id_usuario, id_rol, email, nombres, apellidos, rut, activo
  )
  values (
    v_uid, v_rol_paciente, 'risho.osorio.allendes@gmail.com',
    'Alejo Felipe', 'Alegría Cid', '1.000.007-K', true
  )
  on conflict (id_usuario) do update
    set id_rol = excluded.id_rol,
        nombres = excluded.nombres,
        apellidos = excluded.apellidos,
        rut = excluded.rut,
        activo = true,
        updated_at = now();

  -- 2) Registro en public.pacientes vinculado al portal
  select id_paciente into v_id_paciente
  from public.pacientes
  where id_usuario_portal = v_uid or rut = '1.000.007-K'
  limit 1;

  if v_id_paciente is null then
    insert into public.pacientes (
      id_usuario_portal, rut, prevision, nombres, apellidos, sexo, activo
    )
    values (
      v_uid, '1.000.007-K', 'FONASA', 'Alejo Felipe', 'Alegría Cid', 'M', true
    );
  else
    update public.pacientes
      set id_usuario_portal = v_uid, nombres = 'Alejo Felipe',
          apellidos = 'Alegría Cid', activo = true, updated_at = now()
    where id_paciente = v_id_paciente;
  end if;

  raise notice 'Perfil completado para %', 'risho.osorio.allendes@gmail.com';
end $$;

-- Verificación
select
  us.email,
  us.nombres,
  us.apellidos,
  ro.nombre_rol,
  us.activo,
  pa.id_paciente
from public.usuarios us
join public.roles ro on ro.id_rol = us.id_rol
left join public.pacientes pa on pa.id_usuario_portal = us.id_usuario
where us.email = 'risho.osorio.allendes@gmail.com';