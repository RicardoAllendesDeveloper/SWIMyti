-- =============================================================================
-- SWIMyti - Vincular orden de examen con el bloque de toma de muestra reservado
-- Permite cancelar/cambiar la hora liberando el bloque asociado (los triggers
-- fn_reservar_horario / fn_liberar_horario manejan el estado del bloque).
-- =============================================================================

alter table public.ordenes_examen
  add column if not exists id_horario bigint references public.horarios_disponibles (id_horario)
  on delete set null;