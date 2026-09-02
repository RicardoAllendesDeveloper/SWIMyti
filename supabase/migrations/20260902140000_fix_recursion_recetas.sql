-- =============================================================================
-- FIX: infinite recursion detected in policy for relation "recetas_medicas"
-- =============================================================================
-- Causa: la policy SELECT para paciente usaba una subconsulta sobre la MISMA
-- tabla dentro de su propia política RLS → bucle infinito.
--
-- Solución: usar la comparación directa con fn_mi_id_paciente() (SECURITY
-- DEFINER), que NO referencia la tabla en la política, evitando la recursión.
-- Se aplica igual a certificados_clinicos (mismo patrón).
-- =============================================================================

drop policy if exists recetas_select_paciente on public.recetas_medicas;
create policy recetas_select_paciente on public.recetas_medicas
  for select using (public.fn_mi_id_paciente() = public.recetas_medicas.id_paciente);

drop policy if exists cert_select_paciente on public.certificados_clinicos;
create policy cert_select_paciente on public.certificados_clinicos
  for select using (public.fn_mi_id_paciente() = public.certificados_clinicos.id_paciente);
