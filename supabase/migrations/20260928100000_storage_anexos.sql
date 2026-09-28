-- =============================================================================
-- SWIMyti - Subida real de anexos clínicos (Supabase Storage)
-- Crea el bucket 'anexos' y las políticas de Storage para que:
--   - Personal autorizado (unidad de apoyo y personal clínico) pueda subir archivos.
--   - Personal clínico y el paciente-propio puedan leer/descargar los anexos.
-- Los anexos quedan asociados al paciente en anexos_clinicos.url_documento (URL
-- pública de Storage).
-- =============================================================================

-- ---------- Bucket ----------
insert into storage.buckets (id, name, public)
values ('anexos', 'anexos', true)
on conflict (id) do nothing;

-- ---------- Políticas de Storage (storage.objects) ----------
-- INSERT: unidad de apoyo + personal clínico pueden subir dentro de anexos/
drop policy if exists "anexos_storage_insert" on storage.objects;
create policy "anexos_storage_insert"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'anexos'
    and (
      (select public.fn_puede_subir_anexo())
      or (select public.fn_es_personal_clinico())
    )
  );

-- SELECT (leer/descargar): personal clínico o el paciente-propio.
-- La ruta del objeto se guarda como {id_paciente}/{archivo}, por lo que el
-- paciente solo puede leer archivos dentro de su carpeta (ruta empieza por su id).
drop policy if exists "anexos_storage_select" on storage.objects;
create policy "anexos_storage_select"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'anexos'
    and (
      (select public.fn_es_personal_clinico())
      or (select public.fn_es_admin())
      or (
        (select public.fn_es_paciente())
        and (storage.foldername(name))[1] = (
          select public.fn_mi_id_paciente()::text
        )
      )
    )
  );

-- DELETE: solo administrador
drop policy if exists "anexos_storage_delete" on storage.objects;
create policy "anexos_storage_delete"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'anexos'
    and (select public.fn_es_admin())
  );