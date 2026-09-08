-- =============================================================================
-- SWIMyti - Check-in de pacientes y acceso a resultados de exámenes
-- 1) Estado de llegada del paciente a su atención (citas.llegada), que el
--    administrativo registra al confirmar la hora (check-in) y que el personal
--    clínico ve en su agenda y el paciente en su portal.
-- 2) El paciente-propio puede leer SUS anexos clínicos (resultados de
--    exámenes/laboratorio/imagenología) desde su portal.
-- =============================================================================

-- ---------- 1) Estado de llegada en citas ----------
do $$ begin
  create type public.estado_llegada as enum (
    'pendiente',
    'en_sala',
    'no_llego',
    'tarde'
  );
exception when duplicate_object then null;
end $$;

alter table public.citas
  add column if not exists llegada public.estado_llegada not null default 'pendiente';

-- ---------- 2) Paciente-propio lee sus anexos (resultados de exámenes) ----------
drop policy if exists anexos_select_staff_o_paciente on public.anexos_clinicos;
create policy anexos_select_staff_o_paciente
  on public.anexos_clinicos
  for select
  to authenticated
  using (
    (select public.fn_es_personal_clinico())
    or id_paciente = (select public.fn_mi_id_paciente())
  );