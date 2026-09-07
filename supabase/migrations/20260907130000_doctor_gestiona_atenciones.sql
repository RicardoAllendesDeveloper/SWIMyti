-- =============================================================================
-- SWIMyti - Doctor gestiona el estado de sus atenciones (Agenda)
-- Permite al rol doctor actualizar las citas asociadas a sus horarios
-- (marcar 'completada' cuando atiende, o 'cancelada' cuando el paciente no
-- asiste), sin alterar la inmutabilidad de fichas_medicas/enmiendas.
-- También sincroniza el estado del horario al completar la atención.
-- =============================================================================

-- ---------- Trigger: completar atención libera/actualiza el horario ----------
create or replace function public.fn_liberar_horario()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if old.estado = 'reservada' and new.estado = 'cancelada' then
    update public.horarios_disponibles
      set estado = 'disponible'
    where id_horario = old.id_horario;
  elsif old.estado = 'reservada' and new.estado = 'completada' then
    update public.horarios_disponibles
      set estado = 'completada'
    where id_horario = old.id_horario;
  end if;
  return new;
end;
$$;

-- ---------- RLS: doctor actualiza citas de sus horarios ----------
drop policy if exists citas_update_doctor on public.citas;
create policy citas_update_doctor
  on public.citas
  for update
  to authenticated
  using (
    (select public.fn_es_doctor())
    and exists (
      select 1
      from public.horarios_disponibles h
      where h.id_horario = citas.id_horario
        and h.id_profesional = (select auth.uid())
    )
  )
  with check (
    (select public.fn_es_doctor())
    and exists (
      select 1
      from public.horarios_disponibles h
      where h.id_horario = citas.id_horario
        and h.id_profesional = (select auth.uid())
    )
  );