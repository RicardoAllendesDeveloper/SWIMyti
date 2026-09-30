-- =============================================================================
-- SWIMyti — Cerrar dos fugas: catalogo de profesionales a anon y bucket publico
-- =============================================================================
-- Dos hallazgos de una revision de exposicion, ambos verificados antes de
-- cambiar nada.
--
-- 1) doctores_especialidades era legible por 'anon'.
--
--    La politica doc_esp_select_public estaba creada para {anon, authenticated}
--    con qual = true, o sea lectura sin filtro de todas las filas. Eso entrega
--    a un visitante no autenticado el UUID de cada profesional junto con su
--    especialidad y su marca de principal. El catalogo de AGENTES.md es publico
--    por diseno (lo necesita el formulario de reserva), pero la lista de
--    profesionales con su especialidad no: es informacion de la dotacion del
--    centro y se puede enumerar desde fuera.
--
--    Se acota al personal clinico y a la jefatura, que son los roles que la
--    necesitan de verdad. El administrador conserva el acceso total via
--    doc_esp_admin. El paciente NO entra: no usa esta tabla, y su perfil en
--    AuthRolContext la consulta con 0 filas propias, asi que receives vacio sin
--    error.
--
-- 2) El bucket 'anexos' era publico y sin limites.
--
--    public = true hace que cada URL de objeto sea adivinable y servible sin
--    sesion. Los anexos clinicos son documentos de pacientes: bajo Ley 19.628
--    no pueden quedar en un endpoint que no comprueba quien pregunta. Pasa a
--    privado, con las politicas de storage.objects ya existentes (que si exigen
--    authenticated) mandando sobre el acceso real.
--
--    De paso se acotan los tipos MIME a los que un anexo clinico puede ser y
--    el tamano a 15 MB. Sin file_size_limit, un authenticated podia subir un
--    objeto arbitrariamente grande; sin restringir MIME, cualquier formato
--    incluidos los que un navegador ejecuta. Los adjuntos de la UI son pdf,
--    imagen y texto.
--
-- Nota sobre por que 'revoke a anon' no habria bastado en el caso de funciones:
-- Postgres da EXECUTE a PUBLIC por defecto y anon hereda de PUBLIC. Aca son
-- politicas RLS, asi que lo que se retira es el rol de la politica, no un
-- permiso.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. doctores_especialidades: fuera anon
-- -----------------------------------------------------------------------------
drop policy if exists doc_esp_select_public on public.doctores_especialidades;

-- El catalogo de profesionales queda para quien atiende o coordina.
create policy doc_esp_select_staff
  on public.doctores_especialidades
  for select
  to authenticated
  using (
    public.fn_es_admin()
    or public.fn_tiene_rol(array['doctor', 'enfermeria', 'jefatura'])
  );

-- -----------------------------------------------------------------------------
-- 2. Bucket 'anexos': privado y acotado
-- -----------------------------------------------------------------------------
-- RLS de storage.objects ya cubre SELECT/INSERT/DELETE exigiendo authenticated
-- y acotando por propietario; con el bucket privado ese es el unico camino.
update storage.buckets
set public             = false,
    file_size_limit    = 15728640,   -- 15 MB
    allowed_mime_types = array[
      'application/pdf',
      'image/png',
      'image/jpeg',
      'image/webp',
      'text/plain'
    ]
where name = 'anexos';

comment on table public.doctores_especialidades is
  'SWIMyti: especialidad clinica de cada profesional. Solo la ve el personal clinico y la jefatura; el catalogo publico de especialidades es otra tabla a proposito.';
