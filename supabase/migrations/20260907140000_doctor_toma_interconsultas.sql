-- =============================================================================
-- SWIMyti - Doctor toma interconsultas pendientes de su especialidad
-- El doctor puede:
--   a) Tomar una interconsulta 'pendiente' sin asignar (id_profesional is null),
--      quedando asignada a él (id_profesional = auth.uid(), estado 'confirmada').
--   b) Atender las interconsultas 'confirmada' dirigidas a él (estado -> 'atendida').
-- Esto da utilidad real al módulo para el rol doctor (obs. tester).
-- =============================================================================

-- Nuevo helper: ¿el usuario es doctor?
create or replace function public.fn_es_doctor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.fn_rol_actual() = 'doctor', false);
$$;

grant execute on function public.fn_es_doctor() to authenticated;

-- UPDATE: el doctor puede tomar pendientes sin asignar y atender las confirmadas
-- dirigidas a él. Se agrega como política adicional (no reemplaza las existentes).
drop policy if exists interconsultas_update_doctor on public.interconsultas;
create policy interconsultas_update_doctor
  on public.interconsultas
  for update
  to authenticated
  using (
    (select public.fn_es_doctor())
    and (
      -- tomar una pendiente sin asignar
      (estado = 'pendiente' and id_profesional is null)
      -- atender una confirmada dirigida a él
      or (id_profesional = (select auth.uid()) and estado = 'confirmada')
    )
  )
  with check (
    (select public.fn_es_doctor())
    and (
      -- la tomó y quedó asignada a él (pendiente o confirmada)
      (id_profesional = (select auth.uid()) and estado in ('pendiente', 'confirmada'))
      -- la atendió (quedó atendida y sigue siendo suya)
      or (id_profesional = (select auth.uid()) and estado = 'atendida')
    )
  );