-- =============================================================================
-- SWIMyti — Módulo agenda clínica (toma de horas) + portal paciente
-- =============================================================================
-- Nuevas entidades (3FN):
--   8. especialidades
--   9. doctores_especialidades   (N:M doctor ↔ especialidad)
--  10. horarios_disponibles      (bloques de disponibilidad publicados)
--  11. citas                     (reserva del paciente sobre un bloque, 1:1)
--
-- Reglas de negocio:
--   - Un bloque disponible puede reservarse por un único paciente (UNIQUE id_horario).
--   - El paciente solo reserva en bloques 'disponible' de especialidades vigentes.
--   - El paciente puede ver/cancelar sus propias citas.
--   - El profesional/admin publica bloques; admin ve todo.
--   - Cancelar una cita libera el bloque (estado → 'disponible').
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tipos enumerados
-- -----------------------------------------------------------------------------
do $$ begin
  create type public.estado_cita as enum (
    'disponible',
    'reservada',
    'cancelada',
    'completada'
  );
exception when duplicate_object then null;
end $$;

-- -----------------------------------------------------------------------------
-- 8. especialidades
-- -----------------------------------------------------------------------------
create table if not exists public.especialidades (
  id_especialidad bigint generated always as identity primary key,
  nombre          text not null,
  descripcion     text,
  activo          boolean not null default true,
  created_at      timestamptz not null default now(),
  constraint especialidades_nombre_unique unique (nombre)
);

create index if not exists idx_especialidades_activo on public.especialidades (activo) where activo = true;

comment on table public.especialidades is
  'Catálogo de especialidades médicas ofrecidas por el centro.';

-- -----------------------------------------------------------------------------
-- 9. doctores_especialidades (N:M)
-- -----------------------------------------------------------------------------
create table if not exists public.doctores_especialidades (
  id_doctor        uuid not null references public.usuarios (id_usuario) on delete cascade,
  id_especialidad  bigint not null references public.especialidades (id_especialidad) on delete cascade,
  primary key (id_doctor, id_especialidad)
);

create index if not exists idx_doc_esp_especialidad
  on public.doctores_especialidades (id_especialidad);

comment on table public.doctores_especialidades is
  'Asociación N:M entre profesionales (rol doctor) y especialidades.';

-- -----------------------------------------------------------------------------
-- 10. horarios_disponibles (bloques de disponibilidad)
-- -----------------------------------------------------------------------------
create table if not exists public.horarios_disponibles (
  id_horario       bigint generated always as identity primary key,
  id_profesional   uuid not null references public.usuarios (id_usuario) on delete cascade,
  id_especialidad  bigint references public.especialidades (id_especialidad),
  fecha_inicio     timestamptz not null,
  fecha_fin        timestamptz not null,
  estado           public.estado_cita not null default 'disponible',
  creado_por       uuid references public.usuarios (id_usuario),
  created_at       timestamptz not null default now(),
  constraint horarios_fecha_check check (fecha_fin > fecha_inicio),
  constraint horarios_estado_check check (
    estado in ('disponible', 'reservada', 'cancelada', 'completada')
  )
);

create index if not exists idx_horarios_profesional on public.horarios_disponibles (id_profesional);
create index if not exists idx_horarios_especialidad on public.horarios_disponibles (id_especialidad);
create index if not exists idx_horarios_inicio on public.horarios_disponibles (fecha_inicio);

comment on table public.horarios_disponibles is
  'Bloques de disponibilidad publicados por profesionales para la toma de horas.';

-- -----------------------------------------------------------------------------
-- 11. citas (reserva 1:1 sobre un bloque)
-- -----------------------------------------------------------------------------
create table if not exists public.citas (
  id_cita          bigint generated always as identity primary key,
  id_horario       bigint not null references public.horarios_disponibles (id_horario) on delete cascade,
  id_paciente      bigint not null references public.pacientes (id_paciente),
  motivo           text,
  estado           public.estado_cita not null default 'reservada',
  created_at       timestamptz not null default now(),
  constraint citas_horario_unique unique (id_horario)
);

create index if not exists idx_citas_paciente on public.citas (id_paciente);
create index if not exists idx_citas_estado on public.citas (estado);

comment on table public.citas is
  'Citas reservadas por pacientes sobre bloques de disponibilidad (1:1).';

-- -----------------------------------------------------------------------------
-- Funciones auxiliares
-- -----------------------------------------------------------------------------

-- Profesionales con rol doctor (para publicar y filtrar bloques)
create or replace function public.fn_es_doctor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.fn_rol_actual() = 'doctor', false);
$$;

-- ¿Es paciente portal (rol paciente)?
create or replace function public.fn_es_paciente()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.fn_rol_actual() = 'paciente', false);
$$;

-- Al reservar: transición de estado sobre el bloque (disponible → reservada)
create or replace function public.fn_reservar_horario()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  -- Solo se permite reservar bloques que estén 'disponible'
  if (select estado from public.horarios_disponibles where id_horario = new.id_horario)
     <> 'disponible' then
    raise exception 'SWIMyti: el horario seleccionado ya no está disponible.'
      using errcode = '45001';
  end if;

  update public.horarios_disponibles
    set estado = 'reservada'
  where id_horario = new.id_horario;

  return new;
end;
$$;

-- Al cancelar una cita: liberar el bloque (reservada → disponible)
create or replace function public.fn_liberar_horario()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if old.estado = 'reservada' and new.estado = 'cancelada' then
    update public.horarios_disponibles
      set estado = 'disponible'
    where id_horario = old.id_horario;
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Auto-registro de paciente (self-service)
-- Crea el perfil en usuarios (rol paciente) y el registro en pacientes,
-- vinculando id_usuario_portal = auth.uid(). Solo puede crearse su PROPIO perfil.
-- SECURITY DEFINER para bypasear RLS de usuarios/pacientes (solo con auth.uid()).
-- -----------------------------------------------------------------------------
create or replace function public.fn_auto_registro_paciente(
  p_rut text,
  p_nombres text,
  p_apellidos text,
  p_telefono text default null,
  p_email text default null,
  p_direccion text default null,
  p_fecha_nacimiento date default null,
  p_sexo text default null,
  p_prevision text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_rol_paciente bigint;
  v_id_paciente bigint;
begin
  if v_uid is null then
    raise exception 'SWIMyti: se requiere sesión autenticada.' using errcode = '42501';
  end if;

  -- El rol paciente debe existir
  select id_rol into v_rol_paciente from public.roles where nombre_rol = 'paciente';
  if v_rol_paciente is null then
    raise exception 'SWIMyti: rol paciente no configurado.' using errcode = '45001';
  end if;

  -- Perfil en usuarios (upsert)
  insert into public.usuarios (
    id_usuario, id_rol, email, nombres, apellidos, rut, telefono, activo
  )
  values (
    v_uid, v_rol_paciente, coalesce(p_email, (select email from auth.users where id = v_uid)),
    p_nombres, p_apellidos, p_rut, p_telefono, true
  )
  on conflict (id_usuario) do update
    set nombres = excluded.nombres,
        apellidos = excluded.apellidos,
        rut = excluded.rut,
        telefono = excluded.telefono,
        activo = true,
        updated_at = now();

  -- Paciente (upsert por RUT o por id_usuario_portal)
  select id_paciente into v_id_paciente
  from public.pacientes
  where id_usuario_portal = v_uid
     or rut = p_rut
  limit 1;

  if v_id_paciente is null then
    insert into public.pacientes (
      id_usuario_portal, rut, prevision, nombres, apellidos, telefono,
      email, direccion, fecha_nacimiento, sexo, activo
    )
    values (
      v_uid, p_rut, p_prevision, p_nombres, p_apellidos, p_telefono,
      p_email, p_direccion, p_fecha_nacimiento, p_sexo, true
    )
    returning id_paciente into v_id_paciente;
  else
    update public.pacientes
      set id_usuario_portal = v_uid,
          nombres = p_nombres,
          apellidos = p_apellidos,
          telefono = coalesce(p_telefono, telefono),
          email = coalesce(p_email, email),
          activo = true,
          updated_at = now()
    where id_paciente = v_id_paciente;
  end if;

  return v_uid;
end;
$$;

-- Triggers
drop trigger if exists trg_citas_reservar on public.citas;
create trigger trg_citas_reservar
  before insert on public.citas
  for each row
  execute function public.fn_reservar_horario();

drop trigger if exists trg_citas_liberar on public.citas;
create trigger trg_citas_liberar
  before update on public.citas
  for each row
  execute function public.fn_liberar_horario();

-- -----------------------------------------------------------------------------
-- Seed de especialidades
-- -----------------------------------------------------------------------------
insert into public.especialidades (nombre, descripcion)
values
  ('Medicina General',    'Atención primaria y consulta general'),
  ('Pediatría',           'Atención de salud infantil'),
  ('Ginecología',         'Salud de la mujer'),
  ('Cardiología',         'Salud cardiovascular'),
  ('Traumatología',       'Sistema musculoesquelético'),
  ('Dermatología',        'Salud de la piel'),
  ('Odontología',         'Salud dental y bucal')
on conflict (nombre) do nothing;

-- -----------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- -----------------------------------------------------------------------------
alter table public.especialidades           enable row level security;
alter table public.doctores_especialidades  enable row level security;
alter table public.horarios_disponibles     enable row level security;
alter table public.citas                    enable row level security;

alter table public.especialidades           force row level security;
alter table public.doctores_especialidades  force row level security;
alter table public.horarios_disponibles     force row level security;
alter table public.citas                    force row level security;

-- ---------- especialidades ----------
drop policy if exists especialidades_select_public on public.especialidades;
create policy especialidades_select_public
  on public.especialidades
  for select
  to anon, authenticated
  using (true);

drop policy if exists especialidades_admin on public.especialidades;
create policy especialidades_admin
  on public.especialidades
  for all
  to authenticated
  using ((select public.fn_es_admin()))
  with check ((select public.fn_es_admin()));

-- ---------- doctores_especialidades ----------
drop policy if exists doc_esp_select_public on public.doctores_especialidades;
create policy doc_esp_select_public
  on public.doctores_especialidades
  for select
  to anon, authenticated
  using (true);

drop policy if exists doc_esp_admin on public.doctores_especialidades;
create policy doc_esp_admin
  on public.doctores_especialidades
  for all
  to authenticated
  using ((select public.fn_es_admin()))
  with check ((select public.fn_es_admin()));

-- ---------- horarios_disponibles ----------
-- Cualquiera autenticado ve bloques; solo staff/admin los crean/editan
drop policy if exists horarios_select_public on public.horarios_disponibles;
create policy horarios_select_public
  on public.horarios_disponibles
  for select
  to anon, authenticated
  using (true);

drop policy if exists horarios_insert_staff on public.horarios_disponibles;
create policy horarios_insert_staff
  on public.horarios_disponibles
  for insert
  to authenticated
  with check (
    (select public.fn_es_staff())
    and (creado_por = (select auth.uid()) or (select public.fn_es_admin()))
  );

drop policy if exists horarios_update_staff on public.horarios_disponibles;
create policy horarios_update_staff
  on public.horarios_disponibles
  for update
  to authenticated
  using (
    (select public.fn_es_admin())
    or (id_profesional = (select auth.uid()))
  )
  with check (
    (select public.fn_es_admin())
    or (id_profesional = (select auth.uid()))
  );

drop policy if exists horarios_delete_admin on public.horarios_disponibles;
create policy horarios_delete_admin
  on public.horarios_disponibles
  for delete
  to authenticated
  using ((select public.fn_es_admin()));

-- ---------- citas ----------
-- El paciente solo ve/crea sus propias citas; staff ve todas
drop policy if exists citas_select_own_or_staff on public.citas;
create policy citas_select_own_or_staff
  on public.citas
  for select
  to authenticated
  using (
    (select public.fn_es_staff())
    or id_paciente = (select public.fn_mi_id_paciente())
  );

drop policy if exists citas_insert_paciente on public.citas;
create policy citas_insert_paciente
  on public.citas
  for insert
  to authenticated
  with check (
    id_paciente = (select public.fn_mi_id_paciente())
    and estado = 'reservada'
  );

-- Cancelar propia cita (o admin)
drop policy if exists citas_update_own_or_admin on public.citas;
create policy citas_update_own_or_admin
  on public.citas
  for update
  to authenticated
  using (
    (select public.fn_es_admin())
    or id_paciente = (select public.fn_mi_id_paciente())
  )
  with check (
    (select public.fn_es_admin())
    or id_paciente = (select public.fn_mi_id_paciente())
  );

drop policy if exists citas_delete_admin on public.citas;
create policy citas_delete_admin
  on public.citas
  for delete
  to authenticated
  using ((select public.fn_es_admin()));

-- -----------------------------------------------------------------------------
-- GRANTS
-- -----------------------------------------------------------------------------
grant select on public.especialidades to anon, authenticated;
grant select, insert, update, delete on public.especialidades to authenticated;

grant select on public.doctores_especialidades to anon, authenticated;
grant select, insert, update, delete on public.doctores_especialidades to authenticated;

grant select on public.horarios_disponibles to anon, authenticated;
grant select, insert, update, delete on public.horarios_disponibles to authenticated;

grant select, insert, update, delete on public.citas to authenticated;

grant usage, select on all sequences in schema public to authenticated;

grant execute on function public.fn_es_doctor() to authenticated;
grant execute on function public.fn_es_paciente() to authenticated;
grant execute on function public.fn_reservar_horario() to authenticated;
grant execute on function public.fn_liberar_horario() to authenticated;
grant execute on function public.fn_auto_registro_paciente(
  text, text, text, text, text, text, date, text, text
) to authenticated;