-- =============================================================================
-- SWIMyti — Ampliar gestión de citas al rol administrativo
-- =============================================================================
-- El administrativo gestiona las tomas de horas (cancelar/reagendar) de todos
-- los pacientes, facultad exclusiva junto al administrador.
-- El paciente conserva la facultad de cancelar sus propias citas.
-- =============================================================================

-- Función: ¿rol puede gestionar citas? (admin o administrativo)
create or replace function public.fn_puede_gestionar_citas()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.fn_rol_actual() in ('administrador', 'administrativo'),
    false
  );
$$;

grant execute on function public.fn_puede_gestionar_citas() to authenticated;

-- Ampliar policy de UPDATE de citas: admin, administrativo o el propio paciente
drop policy if exists citas_update_own_or_admin on public.citas;
create policy citas_update_own_or_admin
  on public.citas
  for update
  to authenticated
  using (
    (select public.fn_puede_gestionar_citas())
    or id_paciente = (select public.fn_mi_id_paciente())
  )
  with check (
    (select public.fn_puede_gestionar_citas())
    or id_paciente = (select public.fn_mi_id_paciente())
  );