-- =============================================================================
-- SWIMyti — Permisos de la jefatura: edicion de datos de paciente y citas
-- =============================================================================
-- La jefatura coordina la agenda de su ambito y gestiona las citas de ese
-- ambito (ver 20260929010000). Este archivo extiende ese permiso a la
-- edición de datos personales del paciente, que es parte de su gestión.
--
-- IMPORTANTE: las políticas de pacientes se apoyaban en fn_rol_actual(), que
-- devuelve UN solo rol (el principal). Una jefatura de enfermería tiene
-- enfermeria como principal y jefatura como secundario, así que
-- fn_rol_actual() devolvería 'enfermeria' y la política no la distinguiría.
-- Se migran a fn_tiene_rol(), que evalúa el conjunto de roles.
--
-- 'administrativo' conserva exactamente los mismos permisos que tenía.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. paciente: la jefatura puede editar los datos personales
-- -----------------------------------------------------------------------------
-- Se reemplaza el uso de fn_rol_actual() por fn_tiene_rol(), de modo que
-- cualquier rol acumulado habilite la edición.
drop policy if exists pacientes_update_staff on public.pacientes;
create policy pacientes_update_staff
  on public.pacientes
  for update
  to authenticated
  using ((select public.fn_tiene_rol(array[
    'administrador', 'administrativo', 'doctor', 'enfermeria', 'jefatura'
  ])))
  with check ((select public.fn_tiene_rol(array[
    'administrador', 'administrativo', 'doctor', 'enfermeria', 'jefatura'
  ])));

-- El registro de pacientes nuevos sigue siendo admin/administrativo: la
-- jefatura coordina agenda y datos, no habilita altas de pacientes.
drop policy if exists pacientes_insert_admin_o_administrativo on public.pacientes;
create policy pacientes_insert_admin_o_administrativo
  on public.pacientes
  for insert
  to authenticated
  with check ((select public.fn_tiene_rol(array['administrador', 'administrativo'])));

-- -----------------------------------------------------------------------------
-- 2. interconsultas: la jefatura puede solicitar y resolver las de su ambito
-- -----------------------------------------------------------------------------
drop policy if exists interconsultas_insert on public.interconsultas;
create policy interconsultas_insert
  on public.interconsultas
  for insert
  to authenticated
  with check (
    ((select public.fn_tiene_rol(array['enfermeria', 'administrativo', 'administrador', 'jefatura']))
     and id_solicitante = (select auth.uid()))
  );

-- -----------------------------------------------------------------------------
-- 3. Citas: la jefatura ya tiene UPDATE y DELETE por ambito (migracion previa).
--    Se agrega la lectura acotada: la jefatura ve las citas de su ambito.
-- -----------------------------------------------------------------------------
-- fn_es_staff() ya incluye 'jefatura', por lo que citas_select_own_or_staff
-- le da lectura de toda la tabla. Se deja como esta a proposito: una jefatura
-- necesita ver la agenda para coordinarla. El limite esta en la escritura, que
-- si esta acotada al ambito.
