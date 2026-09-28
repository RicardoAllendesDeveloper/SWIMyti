-- =============================================================================
-- SWIMyti - Órdenes de examen: flujo de trabajo de laboratorio
-- Agrega a ordenes_examen:
--   - modalidad: dónde se realizará el examen (en_recinto / otro_recinto).
--     El doctor solo pregunta al paciente; no agenda toma de muestra.
--   - toma_muestra: estado de la toma de muestra (pendiente / agendada /
--     realizada). Lo gestionan el paciente o el administrativo (entes
--     responsables de la toma de horas).
--   - fecha_toma_muestra: hora agendada para la toma de muestra.
-- Las órdenes existentes se asumen en_recinto (modalidad por defecto).
-- =============================================================================

alter table public.ordenes_examen
  add column if not exists modalidad text not null default 'en_recinto'
  check (modalidad in ('en_recinto', 'otro_recinto'));

alter table public.ordenes_examen
  add column if not exists toma_muestra text not null default 'pendiente'
  check (toma_muestra in ('pendiente', 'agendada', 'realizada'));

alter table public.ordenes_examen
  add column if not exists fecha_toma_muestra timestamptz;