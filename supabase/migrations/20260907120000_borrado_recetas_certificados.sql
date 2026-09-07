-- =============================================================================
-- SWIMyti - Borrado de recetas/certificados por su emisor (rol Doctor)
-- Solo la FICHA MÉDICA es inmutable (fichas_medicas / enmiendas_auditoria).
-- Las recetas y certificados mal creados pueden ser eliminados por el doctor
-- que los emitió (id_usuario_emisor = auth.uid()), ya que no constituyen el
-- registro clínico inmutable y su borrado evita documentos erróneos al paciente.
-- =============================================================================

-- ---------- recetas_medicas ----------
drop policy if exists recetas_delete_emisor on public.recetas_medicas;
create policy recetas_delete_emisor
  on public.recetas_medicas
  for delete
  to authenticated
  using (
    (select public.fn_emite_receta())
    and id_usuario_emisor = (select auth.uid())
  );

-- ---------- certificados_clinicos ----------
drop policy if exists certificados_delete_emisor on public.certificados_clinicos;
create policy certificados_delete_emisor
  on public.certificados_clinicos
  for delete
  to authenticated
  using (
    (select public.fn_emite_receta())
    and id_usuario_emisor = (select auth.uid())
  );