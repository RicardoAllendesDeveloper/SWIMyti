-- =============================================================================
-- SWIMyti - Enfermería toma y atiende interconsultas de su especialidad
-- Un médico puede solicitar una interconsulta de curación o control de
-- enfermería. El personal de enfermería debe poder tomar esas interconsultas
-- pendientes sin asignar y atenderlas (marcarlas como atendidas).
-- Se amplía la política de update a personal clínico (doctor o enfermería).
-- =============================================================================

create or replace function public.fn_es_personal_clinico()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.fn_rol_actual() in ('administrador', 'doctor', 'enfermeria'),
    false
  );
$$;

grant execute on function public.fn_es_personal_clinico() to authenticated;

drop policy if exists interconsultas_update_doctor on public.interconsultas;
create policy interconsultas_update_doctor
  on public.interconsultas
  for update
  to authenticated
  using (
    (select public.fn_es_personal_clinico())
    and (
      -- tomar una pendiente sin asignar
      (estado = 'pendiente' and id_profesional is null)
      -- atender una confirmada dirigida a él/ella
      or (id_profesional = (select auth.uid()) and estado = 'confirmada')
    )
  )
  with check (
    (select public.fn_es_personal_clinico())
    and (
      (id_profesional = (select auth.uid()) and estado in ('pendiente', 'confirmada'))
      or (id_profesional = (select auth.uid()) and estado = 'atendida')
    )
  );