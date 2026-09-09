-- =============================================================================
-- SWIMyti - Acceso a fichas médicas SOLO para doctor y enfermería
-- REGLA DE NEGOCIO: las fichas médicas son material legal sensible. Solo
-- doctores y enfermería pueden crearlas, leerlas o enmendarlas. El administrador
-- de sistema NO debe poder consultarlas (aunque gestione pacientes/usuarios).
-- Se ajustan las funciones RLS usadas por fichas_medicas, enmiendas y anexos.
-- NOTA: citas/interconsultas/agenda usan fn_es_personal_clinico para otras
-- reglas (doctor/enfermería gestionan sus atenciones) — el admin conserva su
-- acceso propio vía fn_es_admin en esas tablas.
-- =============================================================================

-- Personal clínico con acceso a fichas: SOLO doctor y enfermería.
create or replace function public.fn_es_personal_clinico()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.fn_rol_actual() in ('doctor', 'enfermeria'),
    false
  );
$$;

grant execute on function public.fn_es_personal_clinico() to authenticated;

-- Puede crear fichas: SOLO doctor y enfermería.
create or replace function public.fn_puede_crear_ficha()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.fn_rol_actual() in ('doctor', 'enfermeria'),
    false
  );
$$;

grant execute on function public.fn_puede_crear_ficha() to authenticated;

-- Puede enmendar: SOLO doctor (la enfermería registra procedimientos pero no
-- diagnostica ni corrige diagnósticos; facultad exclusiva del médico).
create or replace function public.fn_puede_enmendar()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.fn_rol_actual() = 'doctor',
    false
  );
$$;

grant execute on function public.fn_puede_enmendar() to authenticated;