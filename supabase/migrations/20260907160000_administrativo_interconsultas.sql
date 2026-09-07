-- =============================================================================
-- SWIMyti - Administrativo gestiona interconsultas
-- El rol administrativo también puede levantar solicitudes de interconsulta
-- en nombre de un paciente (obs. tester rol administrativo).
-- =============================================================================

drop policy if exists interconsultas_insert on public.interconsultas;
create policy interconsultas_insert
  on public.interconsultas
  for insert
  to authenticated
  with check (
    ((select public.fn_rol_actual()) in ('enfermeria', 'administrativo')
      or (select public.fn_es_admin()))
    and id_solicitante = (select auth.uid())
  );