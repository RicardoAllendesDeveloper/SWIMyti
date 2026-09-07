-- =============================================================================
-- SWIMyti - Restricción de emisión de recetas/certificados a rol Doctor
-- Obs. Tester (Tester Principal): "Administrador de sistema no puede ni debe
-- realizar recetas ni certificados" (la emisión es facultad exclusiva del médico).
-- Se actualiza fn_emite_receta para que solo el rol 'doctor' pueda emitir.
-- Las políticas RLS de recetas_medicas y certificados_clinicos usan esta función,
-- por lo que no es necesario recrearlas.
-- =============================================================================

create or replace function public.fn_emite_receta()
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

grant execute on function public.fn_emite_receta() to authenticated;