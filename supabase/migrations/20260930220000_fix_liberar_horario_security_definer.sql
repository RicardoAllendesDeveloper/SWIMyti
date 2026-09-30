-- SWIMyti: corrige la liberacion del bloque al cambiar el estado de una cita.
--
-- Problema:
--   fn_liberar_horario() se ejecutaba como invoker. La tabla public.horarios_disponibles
--   solo tiene politica de escritura para coordinadores (horarios_write_coordinador).
--   Cuando un usuario no coordinador actualizaba el estado de una cita (por ejemplo un
--   doctor completando su atencion desde Disponibilidad.tsx), el UPDATE interno del
--   trigger afectaba 0 filas SIN lanzar error. Resultado: el bloque quedaba 'reservada'
--   permanentemente y no podia volver a reservarse, porque fn_reservar_horario exige
--   estado = 'disponible'. Los cupos se iban agotando en silencio.
--
-- Verificado por REST (JWT real):
--   via RPC fn_paciente_liberar_cita  -> bloque pasa a 'disponible'   (corre como postgres)
--   via PATCH directo del doctor      -> cita 'completada', bloque sigue 'reservada' (bug)
--
-- Correccion:
--   fn_reservar_horario ya era SECURITY DEFINER; esta migracion hace simetrica
--   fn_liberar_horario. El trigger solo toca el bloque referenciado por old.id_horario,
--   es decir el de la propia cita que se esta actualizando.

alter function public.fn_liberar_horario() security definer;
alter function public.fn_liberar_horario() set search_path = public;
