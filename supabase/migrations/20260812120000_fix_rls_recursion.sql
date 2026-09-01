-- =============================================================================
-- FIX: stack depth limit exceeded (recursión infinita en RLS)
-- =============================================================================
-- Causa: fn_rol_actual / fn_es_staff leen public.usuarios con SECURITY INVOKER,
-- y la policy SELECT de usuarios llama a fn_es_staff() → bucle infinito.
--
-- Solución: helpers de rol como SECURITY DEFINER (bypassean RLS solo para
-- resolver el rol del auth.uid() actual). Siguen siendo seguras porque filtran
-- por auth.uid() y no aceptan parámetros arbitrarios de filas ajenas.
-- =============================================================================

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

create or replace function public.fn_es_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.fn_rol_actual() = 'administrador', false);
$$;

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

-- Asegurar execute para authenticated
grant execute on function public.fn_rol_actual() to authenticated;
grant execute on function public.fn_es_admin() to authenticated;
grant execute on function public.fn_es_personal_clinico() to authenticated;
grant execute on function public.fn_es_staff() to authenticated;
grant execute on function public.fn_puede_crear_ficha() to authenticated;
grant execute on function public.fn_puede_enmendar() to authenticated;
grant execute on function public.fn_puede_subir_anexo() to authenticated;
grant execute on function public.fn_mi_id_paciente() to authenticated;
grant execute on function public.fn_tiene_permiso_sensible(bigint) to authenticated;
