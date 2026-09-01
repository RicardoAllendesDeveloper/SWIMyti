-- =============================================================================
-- SWIMyti — Fix policies RLS: interconsultas (paciente confirma) y citas
-- (administrativo reserva en nombre de un paciente)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Interconsultas: el paciente debe poder confirmar/rechazar
-- La policy anterior usaba estado='pendiente' tanto en USING (fila vieja)
-- como en WITH CHECK (fila nueva). Al cambiar el estado, la fila nueva ya no
-- es 'pendiente' y WITH CHECK fallaba.
-- Fix: USING valida la fila vieja (pendiente), WITH CHECK valida el nuevo estado.
-- ---------------------------------------------------------------------------
drop policy if exists interconsultas_update on public.interconsultas;
create policy interconsultas_update
  on public.interconsultas
  for update
  to authenticated
  using (
    (select public.fn_es_admin())
    or (id_paciente = (select public.fn_mi_id_paciente()) and estado = 'pendiente')
    or (id_profesional = (select auth.uid()) and estado = 'confirmada')
  )
  with check (
    (select public.fn_es_admin())
    or (id_paciente = (select public.fn_mi_id_paciente()) and estado in ('confirmada', 'rechazada'))
    or (id_profesional = (select auth.uid()) and estado in ('atendida', 'cancelada'))
  );

-- ---------------------------------------------------------------------------
-- 2) Citas: el administrativo (o admin) reserva en nombre de cualquier paciente
-- La policy insert exigía id_paciente = fn_mi_id_paciente(). Se amplía para
-- permitir que quien gestiona citas (admin/administrativo) reserve para cualquier
-- paciente, y el paciente sigue reservando solo para sí mismo.
-- ---------------------------------------------------------------------------
drop policy if exists citas_insert_paciente on public.citas;
create policy citas_insert_paciente
  on public.citas
  for insert
  to authenticated
  with check (
    (select public.fn_puede_gestionar_citas())
    or (id_paciente = (select public.fn_mi_id_paciente()) and estado = 'reservada')
  );