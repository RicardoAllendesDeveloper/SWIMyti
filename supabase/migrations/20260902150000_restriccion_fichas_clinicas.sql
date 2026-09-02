-- =============================================================================
-- FIX: restringir acceso a fichas médicas (confidencialidad clínica)
-- =============================================================================
-- Motivo: la inmutabilidad de las fichas busca también proteger la
-- confidencialidad y legitimidad de los datos clínicos. La ficha médica es un
-- documento legal sensible y no puede quedar expuesta a vulnerabilidades por
-- la vía digital del portal.
--
-- Tras este fix SOLO el personal clínico (admin / doctor / enfermería) puede
-- leer fichas_medicas. Se ELIMINA el acceso de:
--   - 'administrativo'        (gestión de citas/pacientes/bonos, no clínico)
--   - 'unidad_apoyo'          (anexos, no contenido clínico)
--   - paciente-propio         (NO ve su ficha en el portal; la solicita
--                              presencialmente por ser documento legal)
--
-- El administrador conserva lectura por rol de dueño/auditor (NO edita: la
-- inmutabilidad la garantizan los triggers no_update/no_delete).
-- =============================================================================

drop policy if exists fichas_select_clinico_o_paciente on public.fichas_medicas;
create policy fichas_select_clinico_o_paciente
  on public.fichas_medicas
  for select
  to authenticated
  using (
    (select public.fn_es_personal_clinico())
  );

-- -----------------------------------------------------------------------------
-- enmiendas_auditoria: la pista de auditoría de correcciones también es contenido
-- clínico. Solo la ve personal clínico (admin/doctor/enfermería). Se elimina la
-- cláusula que permitía al paciente-propio ver enmiendas de sus fichas.
-- -----------------------------------------------------------------------------
drop policy if exists enmiendas_select_clinico_o_paciente on public.enmiendas_auditoria;
create policy enmiendas_select_clinico_o_paciente
  on public.enmiendas_auditoria
  for select
  to authenticated
  using (
    (select public.fn_es_personal_clinico())
  );

-- -----------------------------------------------------------------------------
-- anexos_clinicos: los anexos (exámenes/resultados) son contenido clínico que se
-- adjunta a una ficha. Solo personal clínico. Se elimina la lectura al paciente.
-- (unidad_apoyo sube anexos, no los lee: INSERT se mantiene con su policy propia)
-- -----------------------------------------------------------------------------
drop policy if exists anexos_select_staff_o_paciente on public.anexos_clinicos;
create policy anexos_select_staff_o_paciente
  on public.anexos_clinicos
  for select
  to authenticated
  using (
    (select public.fn_es_personal_clinico())
  );
