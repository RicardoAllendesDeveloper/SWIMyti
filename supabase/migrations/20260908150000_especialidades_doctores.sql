-- =============================================================================
-- SWIMyti - Especialidad principal y secundarias de los doctores
-- El administrador de sistema asigna a cada doctor su especialidad principal
-- (obligatoria, por defecto) y puede agregar/editar especialidades secundarias
-- a través del tiempo (obs. tester [47]).
-- =============================================================================

-- ---------- Estructura ----------
alter table public.doctores_especialidades
  add column if not exists es_principal boolean not null default false;

-- Un doctor solo puede tener una especialidad principal.
create unique index if not exists uq_doctores_especialidades_principal
  on public.doctores_especialidades (id_doctor)
  where es_principal = true;

-- ---------- Policies ----------
-- SELECT: público (ya existe doc_esp_select_public)
-- Gestión (INSERT/UPDATE/DELETE): solo administrador de sistema
drop policy if exists doc_esp_admin on public.doctores_especialidades;
create policy doc_esp_admin
  on public.doctores_especialidades
  for all
  to authenticated
  using ((select public.fn_es_admin()))
  with check ((select public.fn_es_admin()));

-- ---------- Seed: asignar especialidad principal a doctores sin ninguna ----------
insert into public.doctores_especialidades (id_doctor, id_especialidad, es_principal)
select u.id_usuario, e.id_especialidad, true
from public.usuarios u
join public.roles r on r.id_rol = u.id_rol
join public.especialidades e on e.nombre = 'Medicina General'
where r.nombre_rol = 'doctor'
  and not exists (
    select 1 from public.doctores_especialidades de
    where de.id_doctor = u.id_usuario
  )
on conflict (id_doctor, id_especialidad) do nothing;