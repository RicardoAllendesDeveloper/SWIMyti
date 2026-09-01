-- =============================================================================
-- SWIMyti — Interconsultas clínicas
-- =============================================================================
-- Nueva entidad (3FN):
--  12. interconsultas
--
-- Reglas de negocio:
--   - Enfermería (o admin) solicita una interconsulta para un paciente.
--   - El paciente debe confirmar la interconsulta (en su portal) o el
--     administrativo puede confirmarla en su nombre.
--   - El doctor destino la atiende, marcándola como atendida.
-- =============================================================================

do $$ begin
  create type public.estado_interconsulta as enum (
    'pendiente',
    'confirmada',
    'rechazada',
    'atendida',
    'cancelada'
  );
exception when duplicate_object then null;
end $$;

create table if not exists public.interconsultas (
  id_interconsulta   bigint generated always as identity primary key,
  id_paciente        bigint not null references public.pacientes (id_paciente),
  id_solicitante     uuid not null references public.usuarios (id_usuario),
  id_profesional     uuid references public.usuarios (id_usuario),  -- doctor destino
  especialidad       text,
  motivo             text not null,
  estado             public.estado_interconsulta not null default 'pendiente',
  confirmada_por     uuid references public.usuarios (id_usuario),
  respuesta          text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint interconsultas_motivo_not_blank check (length(trim(motivo)) > 0)
);

create index if not exists idx_interconsultas_paciente on public.interconsultas (id_paciente);
create index if not exists idx_interconsultas_profesional on public.interconsultas (id_profesional);
create index if not exists idx_interconsultas_estado on public.interconsultas (estado);

comment on table public.interconsultas is
  'Solicitudes de interconsulta generadas por enfermería para un paciente, confirmadas por el paciente o administrativo y atendidas por un doctor.';

-- updated_at
drop trigger if exists trg_interconsultas_updated_at on public.interconsultas;
create trigger trg_interconsultas_updated_at
  before update on public.interconsultas
  for each row
  execute function public.fn_set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.interconsultas enable row level security;
alter table public.interconsultas force row level security;

-- SELECT: staff ve todas; el paciente solo las suyas
drop policy if exists interconsultas_select on public.interconsultas;
create policy interconsultas_select
  on public.interconsultas
  for select
  to authenticated
  using (
    (select public.fn_es_staff())
    or id_paciente = (select public.fn_mi_id_paciente())
  );

-- INSERT: enfermería o admin
drop policy if exists interconsultas_insert on public.interconsultas;
create policy interconsultas_insert
  on public.interconsultas
  for insert
  to authenticated
  with check (
    ((select public.fn_rol_actual()) = 'enfermeria'
      or (select public.fn_es_admin()))
    and id_solicitante = (select auth.uid())
  );

-- UPDATE: paciente confirma las suyas (pendiente -> confirmada); admin todo;
-- doctor atiende las dirigidas a él
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
    or (id_paciente = (select public.fn_mi_id_paciente()) and estado = 'pendiente')
    or (id_profesional = (select auth.uid()) and estado = 'confirmada')
  );

-- DELETE: solo admin
drop policy if exists interconsultas_delete on public.interconsultas;
create policy interconsultas_delete
  on public.interconsultas
  for delete
  to authenticated
  using ((select public.fn_es_admin()));

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
grant select, insert, update, delete on public.interconsultas to authenticated;
grant usage, select on sequence public.interconsultas_id_interconsulta_seq to authenticated;