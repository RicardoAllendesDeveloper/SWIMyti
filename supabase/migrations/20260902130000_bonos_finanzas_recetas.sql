-- =============================================================================
-- SWIMyti - Módulos de negocio: Bonos de atención, Finanzas, Recetas/Certificados
-- Expresión básica funcional (sin transacciones monetarias por ahora).
-- Sigue reglas: 3FN, RLS, RBAC, CSS no aplica aquí.
-- =============================================================================

-- Helpers de rol adicionales (SECURITY DEFINER, patrón de fix_rls_recursion)
create or replace function public.fn_gestiona_bonos()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.fn_rol_actual() in ('administrador', 'administrativo'),
    false
  );
$$;

create or replace function public.fn_gestiona_finanzas()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.fn_rol_actual() in ('administrador', 'administrativo'),
    false
  );
$$;

create or replace function public.fn_emite_receta()
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

grant execute on function public.fn_gestiona_bonos() to authenticated;
grant execute on function public.fn_gestiona_finanzas() to authenticated;
grant execute on function public.fn_emite_receta() to authenticated;

-- =============================================================================
-- 1) BONOS DE ATENCIÓN
-- Asocia al paciente a un sistema de previsión (FONASA, Isapre, Particular, etc.)
-- y registra el bono de atención (sin transacción monetaria por ahora).
-- =============================================================================
create table if not exists public.bonos_atencion (
  id_bono           bigint generated always as identity primary key,
  id_paciente       bigint not null references public.pacientes (id_paciente),
  sistema_prevision text not null,
  monto             numeric(12, 2) check (monto >= 0),
  estado            text not null default 'pendiente'
                    check (estado in ('pendiente', 'emitido', 'anulado')),
  fecha_emision     date not null default current_date,
  detalle           text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint bonos_prevision_check check (
    sistema_prevision in (
      'FONASA', 'ISAPRE', 'PARTICULAR', 'CAPREDENA', 'DIPRECA', 'ISP', 'ISL'
    )
  )
);

create index if not exists idx_bonos_paciente on public.bonos_atencion (id_paciente);
create index if not exists idx_bonos_fecha on public.bonos_atencion (fecha_emision desc);

alter table public.bonos_atencion enable row level security;

drop policy if exists bonos_select_staff on public.bonos_atencion;
create policy bonos_select_staff on public.bonos_atencion
  for select using (public.fn_gestiona_bonos());

drop policy if exists bonos_insert_staff on public.bonos_atencion;
create policy bonos_insert_staff on public.bonos_atencion
  for insert with check (public.fn_gestiona_bonos());

drop policy if exists bonos_update_staff on public.bonos_atencion;
create policy bonos_update_staff on public.bonos_atencion
  for update using (public.fn_gestiona_bonos())
  with check (public.fn_gestiona_bonos());

-- =============================================================================
-- 2) FINANZAS / PRESUPUESTOS
-- Registro de partidas presupuestarias (ingresos y egresos) del centro.
-- Sin transacciones contables reales por ahora; solo expresar la función.
-- =============================================================================
create table if not exists public.partidas_presupuesto (
  id_partida     bigint generated always as identity primary key,
  tipo           text not null check (tipo in ('ingreso', 'egreso')),
  concepto       text not null,
  monto          numeric(12, 2) not null check (monto > 0),
  periodo        text not null,
  descripcion    text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_partidas_periodo on public.partidas_presupuesto (periodo);
create index if not exists idx_partidas_tipo on public.partidas_presupuesto (tipo);

alter table public.partidas_presupuesto enable row level security;

drop policy if exists partidas_select_staff on public.partidas_presupuesto;
create policy partidas_select_staff on public.partidas_presupuesto
  for select using (public.fn_gestiona_finanzas());

drop policy if exists partidas_insert_staff on public.partidas_presupuesto;
create policy partidas_insert_staff on public.partidas_presupuesto
  for insert with check (public.fn_gestiona_finanzas());

drop policy if exists partidas_update_staff on public.partidas_presupuesto;
create policy partidas_update_staff on public.partidas_presupuesto
  for update using (public.fn_gestiona_finanzas())
  with check (public.fn_gestiona_finanzas());

drop policy if exists partidas_delete_staff on public.partidas_presupuesto;
create policy partidas_delete_staff on public.partidas_presupuesto
  for delete using (public.fn_gestiona_finanzas());

-- =============================================================================
-- 3) RECETAS MÉDICAS
-- El doctor/admin emite una receta asociada a un paciente.
-- =============================================================================
create table if not exists public.recetas_medicas (
  id_receta       bigint generated always as identity primary key,
  id_paciente     bigint not null references public.pacientes (id_paciente),
  id_usuario_emisor uuid not null references public.usuarios (id_usuario),
  medicamentos    text not null,
  indicaciones    text,
  fecha_emision   date not null default current_date,
  firma_digital_hash text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_recetas_paciente on public.recetas_medicas (id_paciente);
create index if not exists idx_recetas_fecha on public.recetas_medicas (fecha_emision desc);

alter table public.recetas_medicas enable row level security;

drop policy if exists recetas_select_staff on public.recetas_medicas;
create policy recetas_select_staff on public.recetas_medicas
  for select using (public.fn_emite_receta() or public.fn_es_staff());

drop policy if exists recetas_select_paciente on public.recetas_medicas;
create policy recetas_select_paciente on public.recetas_medicas
  for select using (public.fn_mi_id_paciente() = public.recetas_medicas.id_paciente);

drop policy if exists recetas_insert_staff on public.recetas_medicas;
create policy recetas_insert_staff on public.recetas_medicas
  for insert with check (public.fn_emite_receta());

-- =============================================================================
-- 4) CERTIFICADOS CLÍNICOS
-- El doctor/admin emite certificados (reposo, aptitud, atención).
-- =============================================================================
create table if not exists public.certificados_clinicos (
  id_certificado  bigint generated always as identity primary key,
  id_paciente     bigint not null references public.pacientes (id_paciente),
  id_usuario_emisor uuid not null references public.usuarios (id_usuario),
  tipo_certificado text not null,
  detalle         text,
  fecha_emision   date not null default current_date,
  firma_digital_hash text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_cert_paciente on public.certificados_clinicos (id_paciente);
create index if not exists idx_cert_fecha on public.certificados_clinicos (fecha_emision desc);

alter table public.certificados_clinicos enable row level security;

drop policy if exists cert_select_staff on public.certificados_clinicos;
create policy cert_select_staff on public.certificados_clinicos
  for select using (public.fn_emite_receta() or public.fn_es_staff());

drop policy if exists cert_select_paciente on public.certificados_clinicos;
create policy cert_select_paciente on public.certificados_clinicos
  for select using (public.fn_mi_id_paciente() = public.certificados_clinicos.id_paciente);

drop policy if exists cert_insert_staff on public.certificados_clinicos;
create policy cert_insert_staff on public.certificados_clinicos
  for insert with check (public.fn_emite_receta());
