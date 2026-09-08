-- =============================================================================
-- SWIMyti - Enfermería gestiona su agenda de atenciones
-- Enfermería publica horarios (procedimientos y controles de enfermería) y
-- debe poder actualizar el estado de las citas asociadas a sus horarios
-- (marcar 'completada' cuando atiende, o 'cancelada' si el paciente no asiste).
-- Se amplía la política citas_update_doctor a personal clínico (doctor o
-- enfermería) que sea dueño del horario.
-- =============================================================================

drop policy if exists citas_update_clinico on public.citas;
create policy citas_update_clinico
  on public.citas
  for update
  to authenticated
  using (
    (select public.fn_es_personal_clinico())
    and exists (
      select 1
      from public.horarios_disponibles h
      where h.id_horario = citas.id_horario
        and h.id_profesional = (select auth.uid())
    )
  )
  with check (
    (select public.fn_es_personal_clinico())
    and exists (
      select 1
      from public.horarios_disponibles h
      where h.id_horario = citas.id_horario
        and h.id_profesional = (select auth.uid())
    )
  );