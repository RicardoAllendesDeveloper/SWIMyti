-- =============================================================================
-- SWIMyti - Anexos clínicos por paciente (rol Unidad de Apoyo)
-- El personal de unidad de apoyo (laboratorio, imagenología, banco de sangre)
-- sube resultados/exámenes asociados al PACIENTE, sin necesidad de ver la ficha
-- médica (confidencialidad clínica). El anexo puede quedar vinculado al paciente
-- (id_paciente) y opcionalmente a una atención específica (id_ficha).
-- Se mantiene: solo personal clínico lee anexos; quien los sube queda registrado.
-- =============================================================================

-- ---------- Estructura ----------
alter table public.anexos_clinicos
  alter column id_ficha drop not null;

alter table public.anexos_clinicos
  add column if not exists id_paciente bigint references public.pacientes (id_paciente);

create index if not exists idx_anexos_paciente on public.anexos_clinicos (id_paciente);

-- ---------- Policies ----------
-- SELECT: solo personal clínico (admin/doctor/enfermería). Unidad de apoyo sube
-- anexos pero no lee contenido clínico.
drop policy if exists anexos_select_staff_o_paciente on public.anexos_clinicos;
create policy anexos_select_staff_o_paciente
  on public.anexos_clinicos
  for select
  to authenticated
  using (
    (select public.fn_es_personal_clinico())
  );

-- INSERT: quien puede subir anexos (unidad_apoyo/doctor/enfermería/admin),
-- siempre que sea el autor. Debe asociarse a un paciente (id_paciente) o a una
-- ficha existente (id_ficha) para conservar trazabilidad.
drop policy if exists anexos_insert_autorizados on public.anexos_clinicos;
create policy anexos_insert_autorizados
  on public.anexos_clinicos
  for insert
  to authenticated
  with check (
    (select public.fn_puede_subir_anexo())
    and id_usuario_subida = (select auth.uid())
    and (
      id_paciente is not null
      or id_ficha is not null
    )
  );

-- DELETE: solo admin
drop policy if exists anexos_delete_admin on public.anexos_clinicos;
create policy anexos_delete_admin
  on public.anexos_clinicos
  for delete
  to authenticated
  using ((select public.fn_es_admin()));