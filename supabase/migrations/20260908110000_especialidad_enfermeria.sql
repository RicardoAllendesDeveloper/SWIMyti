-- =============================================================================
-- SWIMyti - Nueva especialidad: Enfermería
-- Enfermería publica horarios (controles y procedimientos de enfermería) en su
-- agenda, por lo que su especialidad debe estar disponible en el catálogo
-- `especialidades` para poder seleccionarla al publicar bloques.
-- =============================================================================

insert into public.especialidades (nombre, descripcion)
values (
  'Enfermería',
  'Controles y procedimientos de enfermería'
)
on conflict (nombre) do nothing;