-- =============================================================================
-- SWIMyti - El paciente ve la identidad del profesional al agendar
-- REGLA [3]: todo profesional que emita horas debe estar registrado con nombre,
-- rol y especialidad. Al reservar, el paciente debe ver quién lo atenderá.
-- La RLS de usuarios solo permitía a staff o a sí mismo leer perfiles, por lo
-- que el paciente no veía el nombre del profesional al consultar horarios.
-- Se amplía: el paciente puede leer los perfiles de doctores y enfermería
-- (identificación pública mínima: nombre, apellido, rol, especialidad).
-- =============================================================================

drop policy if exists usuarios_select_profesionales_para_paciente on public.usuarios;
create policy usuarios_select_profesionales_para_paciente
  on public.usuarios
  for select
  to authenticated
  using (
    (select public.fn_es_paciente())
    and exists (
      select 1
      from public.roles r
      where r.id_rol = usuarios.id_rol
        and r.nombre_rol in ('doctor', 'enfermeria')
    )
  );