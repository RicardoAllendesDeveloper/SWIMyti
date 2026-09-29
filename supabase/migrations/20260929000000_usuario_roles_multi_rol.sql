-- =============================================================================
-- SWIMyti — Roles múltiples por usuario (N roles) + rol `jefatura` con ámbito
-- =============================================================================
-- MOTIVACIÓN
-- El modelo anterior tenía usuarios.id_rol (bigint, un solo valor), lo que
-- impedía expresar "jefatura de enfermería que además atiende pacientes", que es
-- la realidad de un centro de salud mediano. Forzar ese caso con dos cuentas
-- rompe la trazabilidad: fichas_medicas y enmiendas_auditoria son append-only y
-- guardan el id_usuario de quien operó, así que un ascenso con cuenta nueva deja
-- las fichas antiguas bajo una identidad que el sistema ya no reconoce.
--
-- DECISIÓN: un humano es un id_usuario para siempre. Los roles son atributos
-- que se acumulan y se registran con fecha de vigencia.
--
-- COMPATIBILIDAD: fn_rol_actual() se conserva y sigue devolviendo el rol
-- principal, de modo que las ~25 funciones y 3 políticas que dependen de ella
-- siguen funcionando sin cambios. Los helpers de permiso pasan a evaluar el
-- conjunto de roles.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tabla de roles por usuario
-- -----------------------------------------------------------------------------
create table if not exists public.usuario_roles (
  id_usuario     uuid        not null references public.usuarios (id_usuario) on delete cascade,
  id_rol         bigint      not null references public.roles (id_rol) on delete restrict,
  es_principal   boolean     not null default false,
  vigente_desde  timestamptz not null default now(),
  vigente_hasta  timestamptz null,
  created_at     timestamptz not null default now(),
  constraint usuario_roles_pkey primary key (id_usuario, id_rol),
  -- Un rol no puede tener dos filas vigentes a la vez.
  constraint usuario_roles_sin_vencimiento check (vigente_hasta is null)
);

comment on table public.usuario_roles is
  'Roles asignados a cada usuario. Permite acumular roles (p.ej. jefatura + enfermeria) sin romper la identidad del usuario en la trazabilidad append-only.';

create index if not exists idx_usuario_roles_usuario
  on public.usuario_roles (id_usuario);

create index if not exists idx_usuario_roles_rol
  on public.usuario_roles (id_rol);

-- -----------------------------------------------------------------------------
-- 2. Rol jefatura
-- -----------------------------------------------------------------------------
-- roles.nombre_rol tiene un CHECK que limita el dominio a seis valores
-- (ver roles_nombre_rol_check). Se amplía para admitir 'jefatura'.
alter table public.roles drop constraint if exists roles_nombre_rol_check;
alter table public.roles add constraint roles_nombre_rol_check
  check (nombre_rol = any (array[
    'administrador', 'doctor', 'enfermeria', 'administrativo',
    'unidad_apoyo', 'paciente', 'jefatura'
  ]));

insert into public.roles (nombre_rol, descripcion)
values ('jefatura', 'Jefatura de area: coordina la carga horaria de los profesionales de su ambito y puede atender pacientes.')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 3. Ambito de la jefatura (jefatura -> especialidad)
-- -----------------------------------------------------------------------------
create table if not exists public.jefaturas_especialidades (
  id_jefatura     uuid   not null references public.usuarios (id_usuario) on delete cascade,
  id_especialidad bigint not null references public.especialidades (id_especialidad) on delete cascade,
  created_at      timestamptz not null default now(),
  constraint jefaturas_especialidades_pkey primary key (id_jefatura, id_especialidad)
);

comment on table public.jefaturas_especialidades is
  'Ambito de coordinacion de cada jefatura. Una jefatura de enfermeria solo puede publicar/eliminar carga de profesionales de enfermeria.';

create index if not exists idx_jefaturas_especialidades_esp
  on public.jefaturas_especialidades (id_especialidad);

-- -----------------------------------------------------------------------------
-- 4. Backfill: cada usuario conserva su rol actual como principal
-- -----------------------------------------------------------------------------
insert into public.usuario_roles (id_usuario, id_rol, es_principal)
select u.id_usuario, u.id_rol, true
from public.usuarios u
on conflict (id_usuario, id_rol) do update set es_principal = true;

-- -----------------------------------------------------------------------------
-- 5. Funciones de lectura de roles
-- -----------------------------------------------------------------------------

-- Conjunto de roles vigentes del usuario autenticado.
create or replace function public.fn_roles_actuales()
returns text[]
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(
    (
      select array_agg(r.nombre_rol order by r.nombre_rol)
      from public.usuario_roles ur
      join public.roles r on r.id_rol = ur.id_rol
      join public.usuarios u on u.id_usuario = ur.id_usuario
      where ur.id_usuario = (select auth.uid())
        and u.activo = true
        and ur.vigente_hasta is null
    ),
    '{}'::text[]
  );
$function$;

-- ¿El usuario autenticado tiene alguno de estos roles?
create or replace function public.fn_tiene_rol(p_roles text[])
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.fn_roles_actuales() && p_roles;
$function$;

-- Rol principal. Se mantiene para no romper las funciones y politicas que
-- comparan contra un unico rol. Prioriza la fila marcada es_principal.
create or replace function public.fn_rol_actual()
returns text
language sql
stable
security definer
set search_path to 'public'
as $function$
  select r.nombre_rol
  from public.usuario_roles ur
  join public.roles r on r.id_rol = ur.id_rol
  join public.usuarios u on u.id_usuario = ur.id_usuario
  where ur.id_usuario = (select auth.uid())
    and u.activo = true
    and ur.vigente_hasta is null
  order by ur.es_principal desc, ur.vigente_desde asc
  limit 1;
$function$;

-- -----------------------------------------------------------------------------
-- 6. Helpers de permiso: ahora sobre el conjunto de roles
-- -----------------------------------------------------------------------------
create or replace function public.fn_es_admin()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.fn_tiene_rol(array['administrador']);
$function$;

create or replace function public.fn_es_staff()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.fn_tiene_rol(array[
    'administrador', 'doctor', 'enfermeria', 'administrativo', 'unidad_apoyo', 'jefatura'
  ]);
$function$;

-- Personal clinico que atiende pacientes y firma ficha. La jefatura de un area
-- clinica tambien puede hacerlo si acumula el rol clinico correspondiente
-- (p.ej. enfermeria + jefatura). No basta con el rol jefatura.
create or replace function public.fn_es_personal_clinico()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.fn_tiene_rol(array['doctor', 'enfermeria']);
$function$;

create or replace function public.fn_es_doctor()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.fn_tiene_rol(array['doctor']);
$function$;

create or replace function public.fn_es_paciente()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.fn_tiene_rol(array['paciente']);
$function$;

create or replace function public.fn_es_unidad_apoyo()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.fn_tiene_rol(array['unidad_apoyo']);
$function$;

-- Funciones de capacidad que delegan en el helper correspondiente.
create or replace function public.fn_puede_crear_ficha()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.fn_es_personal_clinico();
$function$;

create or replace function public.fn_puede_enmendar()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.fn_es_doctor();
$function$;

create or replace function public.fn_puede_gestionar_citas()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.fn_tiene_rol(array['administrador', 'administrativo']);
$function$;

create or replace function public.fn_puede_subir_anexo()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.fn_tiene_rol(array['administrador', 'doctor', 'enfermeria', 'unidad_apoyo']);
$function$;

-- -----------------------------------------------------------------------------
-- 7. Coordinacion de agenda
-- -----------------------------------------------------------------------------

-- El administrador coordina cualquier especialidad (es la jefatura superior).
-- La jefatura solo las especialidades de su ambito.
-- 'administrativo' NO aparece en ningun caso: no coordina agenda.
create or replace function public.fn_es_coordinador_agenda(p_id_especialidad bigint)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select case
    when public.fn_es_admin() then true
    when not public.fn_tiene_rol(array['jefatura']) then false
    else exists (
      select 1
      from public.jefaturas_especialidades je
      where je.id_jefatura = (select auth.uid())
        and je.id_especialidad = p_id_especialidad
    )
  end;
$function$;

-- -----------------------------------------------------------------------------
-- 8. Politicas de las tablas nuevas
-- -----------------------------------------------------------------------------
alter table public.usuario_roles enable row level security;
alter table public.usuario_roles force  row level security;

alter table public.jefaturas_especialidades enable row level security;
alter table public.jefaturas_especialidades force  row level security;

-- Lectura: un usuario ve sus propios roles; el administrador ve todos.
create policy usuario_roles_select_propios
  on public.usuario_roles
  for select
  to authenticated
  using (id_usuario = (select auth.uid()) or (select public.fn_es_admin()));

-- Escritura: solo el administrador asigna o retira roles.
create policy usuario_roles_write_admin
  on public.usuario_roles
  for all
  to authenticated
  using ((select public.fn_es_admin()))
  with check ((select public.fn_es_admin()));

-- Ambito: lectura para jefatura propia y administrador.
create policy jefaturas_esp_select
  on public.jefaturas_especialidades
  for select
  to authenticated
  using (id_jefatura = (select auth.uid()) or (select public.fn_es_admin()));

-- Ambito: escritura solo administrador (se asigna desde administracion de usuarios).
create policy jefaturas_esp_write_admin
  on public.jefaturas_especialidades
  for all
  to authenticated
  using ((select public.fn_es_admin()))
  with check ((select public.fn_es_admin()));

-- Grants minimos. Las funciones de lectura quedan disponibles para authenticated
-- porque las politicas las invocan; fn_crear_usuario y las RPCs de negocio se
-- ajustan en la migracion siguiente.
grant select on public.usuario_roles to authenticated;
grant insert, update, delete on public.usuario_roles to authenticated;
grant select on public.jefaturas_especialidades to authenticated;
grant insert, update, delete on public.jefaturas_especialidades to authenticated;

revoke all on public.usuario_roles from anon;
revoke all on public.jefaturas_especialidades from anon;

grant execute on function public.fn_roles_actuales() to authenticated, service_role;
grant execute on function public.fn_tiene_rol(text[]) to authenticated, service_role;
grant execute on function public.fn_es_coordinador_agenda(bigint) to authenticated, service_role;
grant execute on function public.fn_rol_actual() to authenticated, service_role;
grant execute on function public.fn_es_admin() to authenticated, service_role;
grant execute on function public.fn_es_staff() to authenticated, service_role;
grant execute on function public.fn_es_personal_clinico() to authenticated, service_role;
grant execute on function public.fn_es_doctor() to authenticated, service_role;
grant execute on function public.fn_es_paciente() to authenticated, service_role;
grant execute on function public.fn_es_unidad_apoyo() to authenticated, service_role;
grant execute on function public.fn_puede_crear_ficha() to authenticated, service_role;
grant execute on function public.fn_puede_enmendar() to authenticated, service_role;
grant execute on function public.fn_puede_gestionar_citas() to authenticated, service_role;
grant execute on function public.fn_puede_subir_anexo() to authenticated, service_role;
