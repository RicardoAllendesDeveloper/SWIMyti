-- =============================================================================
-- SWIMyti - Órdenes de examen (nueva entidad)
-- El doctor emite una orden de examen para un paciente y puede enviarla al
-- personal de apoyo (laboratorio / imagenología) con un check. El personal de
-- apoyo solo recibe las órdenes que le fueron enviadas (enviada_a_apoyo = true)
-- y puede marcarlas como completadas. El paciente ve sus órdenes en el portal.
-- =============================================================================

do $$ begin
  create type public.estado_orden_examen as enum (
    'pendiente',
    'en_proceso',
    'completada',
    'cancelada'
  );
exception when duplicate_object then null;
end $$;

create table if not exists public.ordenes_examen (
  id_orden          bigint generated always as identity primary key,
  id_paciente       bigint not null references public.pacientes (id_paciente),
  id_usuario_emisor uuid not null references public.usuarios (id_usuario),
  tipo_examen       text not null,
  indicaciones      text,
  enviada_a_apoyo   boolean not null default false,
  estado            public.estado_orden_examen not null default 'pendiente',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint ordenes_examen_tipo_not_blank check (length(trim(tipo_examen)) > 0)
);

create index if not exists idx_ordenes_paciente on public.ordenes_examen (id_paciente);
create index if not exists idx_ordenes_estado on public.ordenes_examen (estado);

comment on table public.ordenes_examen is
  'Órdenes de examen emitidas por el doctor, opcionalmente enviadas al personal de apoyo y visibles para el paciente.';

drop trigger if exists trg_ordenes_examen_updated_at on public.ordenes_examen;
create trigger trg_ordenes_examen_updated_at
  before update on public.ordenes_examen
  for each row
  execute function public.fn_set_updated_at();

-- ---------- Helper: ¿es unidad de apoyo? ----------
create or replace function public.fn_es_unidad_apoyo()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.fn_rol_actual() = 'unidad_apoyo', false);
$$;

grant execute on function public.fn_es_unidad_apoyo() to authenticated;

-- ---------- RLS ----------
alter table public.ordenes_examen enable row level security;
alter table public.ordenes_examen force row level security;

-- SELECT: personal clínico ve todas; unidad de apoyo solo las enviadas a ella;
-- el paciente solo las suyas.
drop policy if exists ordenes_select on public.ordenes_examen;
create policy ordenes_select
  on public.ordenes_examen
  for select
  to authenticated
  using (
    (select public.fn_es_personal_clinico())
    or ((select public.fn_es_unidad_apoyo()) and enviada_a_apoyo = true)
    or id_paciente = (select public.fn_mi_id_paciente())
  );

-- INSERT: solo el doctor emite órdenes de examen.
drop policy if exists ordenes_insert on public.ordenes_examen;
create policy ordenes_insert
  on public.ordenes_examen
  for insert
  to authenticated
  with check (
    (select public.fn_emite_receta())
    and id_usuario_emisor = (select auth.uid())
  );

-- UPDATE: el doctor puede actualizar/cancelar las que emitió; la unidad de apoyo
-- puede marcar como completadas/en_proceso las órdenes que le fueron enviadas.
drop policy if exists ordenes_update on public.ordenes_examen;
create policy ordenes_update
  on public.ordenes_examen
  for update
  to authenticated
  using (
    (select public.fn_es_admin())
    or ((select public.fn_emite_receta()) and id_usuario_emisor = (select auth.uid()))
    or ((select public.fn_es_unidad_apoyo()) and enviada_a_apoyo = true)
  )
  with check (
    (select public.fn_es_admin())
    or ((select public.fn_emite_receta()) and id_usuario_emisor = (select auth.uid()))
    or ((select public.fn_es_unidad_apoyo()) and enviada_a_apoyo = true)
  );

-- DELETE: solo administrador
drop policy if exists ordenes_delete on public.ordenes_examen;
create policy ordenes_delete
  on public.ordenes_examen
  for delete
  to authenticated
  using ((select public.fn_es_admin()));

grant select, insert, update, delete on public.ordenes_examen to authenticated;
grant usage, select on sequence public.ordenes_examen_id_orden_seq to authenticated;