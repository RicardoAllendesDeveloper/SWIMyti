-- =============================================================================
-- SWIMyti — DDL inicial PostgreSQL (Supabase)
-- Sistema Web Integral Multi-rol Y Trazabilidad Inmutable
-- =============================================================================
-- Entidades (3FN):
--   1. roles
--   2. usuarios
--   3. pacientes
--   4. fichas_medicas          (APPEND-ONLY: sin UPDATE/DELETE)
--   5. enmiendas_auditoria     (APPEND-ONLY: sin UPDATE/DELETE)
--   6. anexos_clinicos
--   7. permisos_especiales
-- =============================================================================

-- Extensiones
create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- Tipos enumerados
-- -----------------------------------------------------------------------------
do $$ begin
  create type public.estado_permiso as enum (
    'pendiente',
    'aprobado',
    'rechazado',
    'expirado',
    'revocado'
  );
exception when duplicate_object then null;
end $$;

-- -----------------------------------------------------------------------------
-- 1. roles
-- -----------------------------------------------------------------------------
create table if not exists public.roles (
  id_rol        bigint generated always as identity primary key,
  nombre_rol    text not null,
  descripcion   text,
  created_at    timestamptz not null default now(),
  constraint roles_nombre_rol_unique unique (nombre_rol),
  constraint roles_nombre_rol_check check (
    nombre_rol in (
      'administrador',
      'doctor',
      'enfermeria',
      'administrativo',
      'unidad_apoyo',
      'paciente'
    )
  )
);

comment on table public.roles is
  'Catálogo de roles del sistema (RBAC).';

-- -----------------------------------------------------------------------------
-- 2. usuarios  (vinculados a auth.users de Supabase)
-- -----------------------------------------------------------------------------
create table if not exists public.usuarios (
  id_usuario          uuid primary key references auth.users (id) on delete cascade,
  id_rol              bigint not null references public.roles (id_rol),
  email               text not null,
  nombres             text not null,
  apellidos           text not null,
  rut                 text,
  telefono            text,
  activo              boolean not null default true,
  firma_digital_hash  text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint usuarios_email_unique unique (email),
  constraint usuarios_rut_unique unique (rut)
);

create index if not exists idx_usuarios_id_rol on public.usuarios (id_rol);
create index if not exists idx_usuarios_activo on public.usuarios (activo) where activo = true;

comment on table public.usuarios is
  'Perfiles de usuarios del sistema. id_usuario = auth.users.id.';
comment on column public.usuarios.firma_digital_hash is
  'Hash de la firma digital del profesional (requerida en enmiendas).';

-- -----------------------------------------------------------------------------
-- 3. pacientes
-- -----------------------------------------------------------------------------
create table if not exists public.pacientes (
  id_paciente         bigint generated always as identity primary key,
  -- Datos sensibles (solo Admin puede modificar vía RLS)
  rut                 text not null,
  prevision           text,
  -- Datos demográficos / contacto
  nombres             text not null,
  apellidos           text not null,
  fecha_nacimiento    date,
  sexo                text,
  telefono            text,
  email               text,
  direccion           text,
  comuna              text,
  region              text,
  -- Vínculo opcional al portal paciente (auth)
  id_usuario_portal   uuid references public.usuarios (id_usuario) on delete set null,
  activo              boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint pacientes_rut_unique unique (rut),
  constraint pacientes_sexo_check check (
    sexo is null or sexo in ('M', 'F', 'X', 'otro')
  )
);

create index if not exists idx_pacientes_rut on public.pacientes (rut);
create index if not exists idx_pacientes_apellidos_nombres
  on public.pacientes (apellidos, nombres);
create index if not exists idx_pacientes_id_usuario_portal
  on public.pacientes (id_usuario_portal)
  where id_usuario_portal is not null;

comment on table public.pacientes is
  'Datos demográficos y de contacto de pacientes. RUT/previsión: solo Admin.';
comment on column public.pacientes.rut is
  'Dato sensible. UPDATE restringido a rol administrador (RLS).';
comment on column public.pacientes.prevision is
  'Dato sensible. UPDATE restringido a rol administrador (RLS).';

-- -----------------------------------------------------------------------------
-- 4. fichas_medicas  — INMUTABLES (append-only)
-- -----------------------------------------------------------------------------
create table if not exists public.fichas_medicas (
  id_ficha              bigint generated always as identity primary key,
  id_paciente           bigint not null references public.pacientes (id_paciente),
  id_usuario_creador    uuid not null references public.usuarios (id_usuario),
  motivo_consulta       text not null,
  anamnesis             text,
  examen_fisico         text,
  diagnostico           text not null,
  plan_tratamiento      text,
  observaciones         text,
  created_at            timestamptz not null default now(),
  -- Metadatos de integridad (firma al crear)
  firma_digital_hash    text not null,
  constraint fichas_medicas_diagnostico_not_blank check (length(trim(diagnostico)) > 0),
  constraint fichas_medicas_motivo_not_blank check (length(trim(motivo_consulta)) > 0),
  constraint fichas_medicas_firma_not_blank check (length(trim(firma_digital_hash)) > 0)
);

create index if not exists idx_fichas_medicas_id_paciente
  on public.fichas_medicas (id_paciente);
create index if not exists idx_fichas_medicas_id_usuario_creador
  on public.fichas_medicas (id_usuario_creador);
create index if not exists idx_fichas_medicas_created_at
  on public.fichas_medicas (created_at desc);

comment on table public.fichas_medicas is
  'Fichas clínicas INMUTABLES. Cualquier corrección se registra en enmiendas_auditoria.';

-- -----------------------------------------------------------------------------
-- 5. enmiendas_auditoria  — APPEND-ONLY (correcciones con firma)
-- -----------------------------------------------------------------------------
create table if not exists public.enmiendas_auditoria (
  id_enmienda             bigint generated always as identity primary key,
  id_ficha                bigint not null references public.fichas_medicas (id_ficha),
  id_usuario_autor        uuid not null references public.usuarios (id_usuario),
  campo_corregido         text not null,
  valor_anterior          text,
  correccion_justificada  text not null,
  firma_digital_hash      text not null,
  created_at              timestamptz not null default now(),
  constraint enmiendas_correccion_not_blank check (
    length(trim(correccion_justificada)) > 0
  ),
  constraint enmiendas_firma_not_blank check (
    length(trim(firma_digital_hash)) > 0
  ),
  constraint enmiendas_campo_not_blank check (
    length(trim(campo_corregido)) > 0
  )
);

create index if not exists idx_enmiendas_id_ficha
  on public.enmiendas_auditoria (id_ficha);
create index if not exists idx_enmiendas_id_usuario_autor
  on public.enmiendas_auditoria (id_usuario_autor);
create index if not exists idx_enmiendas_created_at
  on public.enmiendas_auditoria (created_at desc);

comment on table public.enmiendas_auditoria is
  'Enmiendas a fichas (append-only). Requiere firma digital y justificación.';

-- -----------------------------------------------------------------------------
-- 6. anexos_clinicos
-- -----------------------------------------------------------------------------
create table if not exists public.anexos_clinicos (
  id_anexo              bigint generated always as identity primary key,
  id_ficha              bigint not null references public.fichas_medicas (id_ficha),
  id_usuario_subida     uuid not null references public.usuarios (id_usuario),
  nombre_archivo        text not null,
  tipo_mime             text,
  url_documento         text not null,
  descripcion           text,
  tipo_anexo            text,
  created_at            timestamptz not null default now(),
  constraint anexos_url_not_blank check (length(trim(url_documento)) > 0),
  constraint anexos_nombre_not_blank check (length(trim(nombre_archivo)) > 0),
  constraint anexos_tipo_check check (
    tipo_anexo is null or tipo_anexo in (
      'laboratorio',
      'imagenologia',
      'receta',
      'informe',
      'otro'
    )
  )
);

create index if not exists idx_anexos_id_ficha
  on public.anexos_clinicos (id_ficha);
create index if not exists idx_anexos_id_usuario_subida
  on public.anexos_clinicos (id_usuario_subida);

comment on table public.anexos_clinicos is
  'Anexos clínicos (lab/imagenología/etc.) asociados a una ficha existente.';

-- -----------------------------------------------------------------------------
-- 7. permisos_especiales
-- -----------------------------------------------------------------------------
create table if not exists public.permisos_especiales (
  id_permiso              bigint generated always as identity primary key,
  id_usuario_solicitante  uuid not null references public.usuarios (id_usuario),
  id_usuario_aprobador    uuid references public.usuarios (id_usuario),
  id_paciente             bigint references public.pacientes (id_paciente),
  tipo_permiso            text not null,
  motivo                  text not null,
  estado_aprobacion       public.estado_permiso not null default 'pendiente',
  valido_desde            timestamptz,
  valido_hasta            timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint permisos_motivo_not_blank check (length(trim(motivo)) > 0),
  constraint permisos_tipo_check check (
    tipo_permiso in (
      'editar_rut',
      'editar_prevision',
      'editar_datos_sensibles',
      'acceso_temporal_ficha',
      'otro'
    )
  ),
  constraint permisos_vigencia_check check (
    valido_hasta is null
    or valido_desde is null
    or valido_hasta > valido_desde
  )
);

create index if not exists idx_permisos_solicitante
  on public.permisos_especiales (id_usuario_solicitante);
create index if not exists idx_permisos_estado
  on public.permisos_especiales (estado_aprobacion);
create index if not exists idx_permisos_paciente
  on public.permisos_especiales (id_paciente)
  where id_paciente is not null;

comment on table public.permisos_especiales is
  'Permisos temporales (p.ej. editar RUT) sujetos a aprobación de Admin.';

-- =============================================================================
-- Funciones auxiliares de rol
-- SECURITY DEFINER: evitan recursión RLS (policies de usuarios llaman a estas
-- funciones, que a su vez leen usuarios). Solo resuelven auth.uid() actual.
-- =============================================================================

-- Rol del usuario autenticado actual
create or replace function public.fn_rol_actual()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select r.nombre_rol
  from public.usuarios u
  join public.roles r on r.id_rol = u.id_rol
  where u.id_usuario = (select auth.uid())
    and u.activo = true
  limit 1;
$$;

comment on function public.fn_rol_actual() is
  'Devuelve el nombre_rol del usuario autenticado (auth.uid()). SECURITY DEFINER para evitar recursión RLS.';

-- ¿Es administrador?
create or replace function public.fn_es_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.fn_rol_actual() = 'administrador', false);
$$;

-- ¿Es personal clínico (doctor / enfermería / admin)?
create or replace function public.fn_es_personal_clinico()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.fn_rol_actual() in ('administrador', 'doctor', 'enfermeria'),
    false
  );
$$;

-- ¿Es staff (cualquier rol interno excepto paciente)?
create or replace function public.fn_es_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.fn_rol_actual() in (
      'administrador',
      'doctor',
      'enfermeria',
      'administrativo',
      'unidad_apoyo'
    ),
    false
  );
$$;

-- ¿Puede crear fichas? (doctor / enfermería / admin)
create or replace function public.fn_puede_crear_ficha()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.fn_rol_actual() in ('administrador', 'doctor', 'enfermeria'),
    false
  );
$$;

-- ¿Puede crear enmiendas? (doctor / admin)
create or replace function public.fn_puede_enmendar()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.fn_rol_actual() in ('administrador', 'doctor'),
    false
  );
$$;

-- ¿Puede subir anexos? (unidad_apoyo / doctor / enfermería / admin)
create or replace function public.fn_puede_subir_anexo()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.fn_rol_actual() in (
      'administrador',
      'doctor',
      'enfermeria',
      'unidad_apoyo'
    ),
    false
  );
$$;

-- Paciente portal: id_paciente vinculado al auth.uid() actual
create or replace function public.fn_mi_id_paciente()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select p.id_paciente
  from public.pacientes p
  where p.id_usuario_portal = (select auth.uid())
  limit 1;
$$;

-- Permiso especial vigente para editar datos sensibles de un paciente
create or replace function public.fn_tiene_permiso_sensible(p_id_paciente bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.permisos_especiales pe
    where pe.id_usuario_solicitante = (select auth.uid())
      and pe.estado_aprobacion = 'aprobado'
      and pe.tipo_permiso in ('editar_rut', 'editar_prevision', 'editar_datos_sensibles')
      and (pe.id_paciente is null or pe.id_paciente = p_id_paciente)
      and (pe.valido_desde is null or pe.valido_desde <= now())
      and (pe.valido_hasta is null or pe.valido_hasta >= now())
  );
$$;

-- updated_at automático
create or replace function public.fn_set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- =============================================================================
-- INMUTABILIDAD: triggers que bloquean UPDATE/DELETE
-- =============================================================================

create or replace function public.fn_bloquear_mutacion_inmutable()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  raise exception
    'SWIMyti: la tabla %.% es inmutable (append-only). Operación % no permitida. Use enmiendas_auditoria para correcciones.',
    tg_table_schema, tg_table_name, tg_op
    using errcode = '42501';
  return null;
end;
$$;

-- fichas_medicas: sin UPDATE ni DELETE
drop trigger if exists trg_fichas_medicas_no_update on public.fichas_medicas;
create trigger trg_fichas_medicas_no_update
  before update on public.fichas_medicas
  for each row
  execute function public.fn_bloquear_mutacion_inmutable();

drop trigger if exists trg_fichas_medicas_no_delete on public.fichas_medicas;
create trigger trg_fichas_medicas_no_delete
  before delete on public.fichas_medicas
  for each row
  execute function public.fn_bloquear_mutacion_inmutable();

-- enmiendas_auditoria: sin UPDATE ni DELETE
drop trigger if exists trg_enmiendas_no_update on public.enmiendas_auditoria;
create trigger trg_enmiendas_no_update
  before update on public.enmiendas_auditoria
  for each row
  execute function public.fn_bloquear_mutacion_inmutable();

drop trigger if exists trg_enmiendas_no_delete on public.enmiendas_auditoria;
create trigger trg_enmiendas_no_delete
  before delete on public.enmiendas_auditoria
  for each row
  execute function public.fn_bloquear_mutacion_inmutable();

-- updated_at en tablas mutables
drop trigger if exists trg_usuarios_updated_at on public.usuarios;
create trigger trg_usuarios_updated_at
  before update on public.usuarios
  for each row
  execute function public.fn_set_updated_at();

drop trigger if exists trg_pacientes_updated_at on public.pacientes;
create trigger trg_pacientes_updated_at
  before update on public.pacientes
  for each row
  execute function public.fn_set_updated_at();

drop trigger if exists trg_permisos_updated_at on public.permisos_especiales;
create trigger trg_permisos_updated_at
  before update on public.permisos_especiales
  for each row
  execute function public.fn_set_updated_at();

-- Protección de columnas sensibles en pacientes (RUT / previsión)
-- Solo administrador (o permiso especial aprobado) puede cambiarlas.
create or replace function public.fn_proteger_datos_sensibles_paciente()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if (new.rut is distinct from old.rut)
     or (new.prevision is distinct from old.prevision) then
    if not (
      public.fn_es_admin()
      or public.fn_tiene_permiso_sensible(old.id_paciente)
    ) then
      raise exception
        'SWIMyti: RUT y previsión solo pueden ser modificados por Administrador o con permiso especial aprobado.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_pacientes_proteger_sensibles on public.pacientes;
create trigger trg_pacientes_proteger_sensibles
  before update on public.pacientes
  for each row
  execute function public.fn_proteger_datos_sensibles_paciente();

-- =============================================================================
-- Seed mínimo de roles
-- =============================================================================
insert into public.roles (nombre_rol, descripcion)
values
  ('administrador',  'Acceso total; gestión de usuarios y datos sensibles'),
  ('doctor',         'Creación de fichas inmutables e ingreso de enmiendas'),
  ('enfermeria',     'Creación de fichas inmutables y visualización de historial'),
  ('administrativo', 'Registro de pacientes y visualización básica'),
  ('unidad_apoyo',   'Subida de anexos clínicos a fichas existentes'),
  ('paciente',       'Portal de solo lectura del propio historial')
on conflict (nombre_rol) do nothing;

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

alter table public.roles                 enable row level security;
alter table public.usuarios              enable row level security;
alter table public.pacientes             enable row level security;
alter table public.fichas_medicas        enable row level security;
alter table public.enmiendas_auditoria   enable row level security;
alter table public.anexos_clinicos       enable row level security;
alter table public.permisos_especiales   enable row level security;

-- Forzar RLS también para el dueño de la tabla
alter table public.roles                 force row level security;
alter table public.usuarios              force row level security;
alter table public.pacientes             force row level security;
alter table public.fichas_medicas        force row level security;
alter table public.enmiendas_auditoria   force row level security;
alter table public.anexos_clinicos       force row level security;
alter table public.permisos_especiales   force row level security;

-- ---------- roles ----------
drop policy if exists roles_select_authenticated on public.roles;
create policy roles_select_authenticated
  on public.roles
  for select
  to authenticated
  using (true);

drop policy if exists roles_all_admin on public.roles;
create policy roles_all_admin
  on public.roles
  for all
  to authenticated
  using ((select public.fn_es_admin()))
  with check ((select public.fn_es_admin()));

-- ---------- usuarios ----------
drop policy if exists usuarios_select_staff_or_self on public.usuarios;
create policy usuarios_select_staff_or_self
  on public.usuarios
  for select
  to authenticated
  using (
    (select public.fn_es_staff())
    or id_usuario = (select auth.uid())
  );

drop policy if exists usuarios_insert_admin on public.usuarios;
create policy usuarios_insert_admin
  on public.usuarios
  for insert
  to authenticated
  with check ((select public.fn_es_admin()));

drop policy if exists usuarios_update_admin_or_self on public.usuarios;
create policy usuarios_update_admin_or_self
  on public.usuarios
  for update
  to authenticated
  using (
    (select public.fn_es_admin())
    or id_usuario = (select auth.uid())
  )
  with check (
    (select public.fn_es_admin())
    or id_usuario = (select auth.uid())
  );

drop policy if exists usuarios_delete_admin on public.usuarios;
create policy usuarios_delete_admin
  on public.usuarios
  for delete
  to authenticated
  using ((select public.fn_es_admin()));

-- ---------- pacientes ----------
drop policy if exists pacientes_select_staff_or_self on public.pacientes;
create policy pacientes_select_staff_or_self
  on public.pacientes
  for select
  to authenticated
  using (
    (select public.fn_es_staff())
    or id_usuario_portal = (select auth.uid())
  );

drop policy if exists pacientes_insert_admin_o_administrativo on public.pacientes;
create policy pacientes_insert_admin_o_administrativo
  on public.pacientes
  for insert
  to authenticated
  with check (
    (select public.fn_rol_actual()) in ('administrador', 'administrativo')
  );

-- UPDATE: staff puede actualizar contacto; sensibles se filtran por trigger
drop policy if exists pacientes_update_staff on public.pacientes;
create policy pacientes_update_staff
  on public.pacientes
  for update
  to authenticated
  using (
    (select public.fn_rol_actual()) in (
      'administrador',
      'administrativo',
      'doctor',
      'enfermeria'
    )
  )
  with check (
    (select public.fn_rol_actual()) in (
      'administrador',
      'administrativo',
      'doctor',
      'enfermeria'
    )
  );

drop policy if exists pacientes_delete_admin on public.pacientes;
create policy pacientes_delete_admin
  on public.pacientes
  for delete
  to authenticated
  using ((select public.fn_es_admin()));

-- ---------- fichas_medicas (solo INSERT + SELECT; UPDATE/DELETE bloqueados por trigger) ----------
drop policy if exists fichas_select_clinico_o_paciente on public.fichas_medicas;
create policy fichas_select_clinico_o_paciente
  on public.fichas_medicas
  for select
  to authenticated
  using (
    (select public.fn_es_personal_clinico())
  );

drop policy if exists fichas_insert_creadores on public.fichas_medicas;
create policy fichas_insert_creadores
  on public.fichas_medicas
  for insert
  to authenticated
  with check (
    (select public.fn_puede_crear_ficha())
    and id_usuario_creador = (select auth.uid())
  );

-- Sin policies de UPDATE/DELETE → denegado por RLS + triggers de inmutabilidad

-- ---------- enmiendas_auditoria ----------
drop policy if exists enmiendas_select_clinico_o_paciente on public.enmiendas_auditoria;
create policy enmiendas_select_clinico_o_paciente
  on public.enmiendas_auditoria
  for select
  to authenticated
  using (
    (select public.fn_es_personal_clinico())
  );

drop policy if exists enmiendas_insert_doctores on public.enmiendas_auditoria;
create policy enmiendas_insert_doctores
  on public.enmiendas_auditoria
  for insert
  to authenticated
  with check (
    (select public.fn_puede_enmendar())
    and id_usuario_autor = (select auth.uid())
  );

-- ---------- anexos_clinicos ----------
drop policy if exists anexos_select_staff_o_paciente on public.anexos_clinicos;
create policy anexos_select_staff_o_paciente
  on public.anexos_clinicos
  for select
  to authenticated
  using (
    (select public.fn_es_personal_clinico())
  );

drop policy if exists anexos_insert_autorizados on public.anexos_clinicos;
create policy anexos_insert_autorizados
  on public.anexos_clinicos
  for insert
  to authenticated
  with check (
    (select public.fn_puede_subir_anexo())
    and id_usuario_subida = (select auth.uid())
  );

drop policy if exists anexos_delete_admin on public.anexos_clinicos;
create policy anexos_delete_admin
  on public.anexos_clinicos
  for delete
  to authenticated
  using ((select public.fn_es_admin()));

-- ---------- permisos_especiales ----------
drop policy if exists permisos_select_admin_o_solicitante on public.permisos_especiales;
create policy permisos_select_admin_o_solicitante
  on public.permisos_especiales
  for select
  to authenticated
  using (
    (select public.fn_es_admin())
    or id_usuario_solicitante = (select auth.uid())
  );

drop policy if exists permisos_insert_staff on public.permisos_especiales;
create policy permisos_insert_staff
  on public.permisos_especiales
  for insert
  to authenticated
  with check (
    (select public.fn_es_staff())
    and id_usuario_solicitante = (select auth.uid())
    and estado_aprobacion = 'pendiente'
  );

drop policy if exists permisos_update_admin on public.permisos_especiales;
create policy permisos_update_admin
  on public.permisos_especiales
  for update
  to authenticated
  using ((select public.fn_es_admin()))
  with check ((select public.fn_es_admin()));

-- =============================================================================
-- GRANTS (Data API — anon/authenticated)
-- Las tablas nuevas no se exponen solas; se otorgan privilegios mínimos.
-- RLS sigue filtrando filas.
-- =============================================================================

grant usage on schema public to anon, authenticated;

grant select on public.roles to authenticated;

grant select, insert, update, delete on public.usuarios to authenticated;
grant select, insert, update, delete on public.pacientes to authenticated;
grant select, insert on public.fichas_medicas to authenticated;
grant select, insert on public.enmiendas_auditoria to authenticated;
grant select, insert, delete on public.anexos_clinicos to authenticated;
grant select, insert, update on public.permisos_especiales to authenticated;

grant usage, select on all sequences in schema public to authenticated;

grant execute on function public.fn_rol_actual() to authenticated;
grant execute on function public.fn_es_admin() to authenticated;
grant execute on function public.fn_es_personal_clinico() to authenticated;
grant execute on function public.fn_es_staff() to authenticated;
grant execute on function public.fn_puede_crear_ficha() to authenticated;
grant execute on function public.fn_puede_enmendar() to authenticated;
grant execute on function public.fn_puede_subir_anexo() to authenticated;
grant execute on function public.fn_mi_id_paciente() to authenticated;
grant execute on function public.fn_tiene_permiso_sensible(bigint) to authenticated;
