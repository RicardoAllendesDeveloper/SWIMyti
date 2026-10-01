-- SWIMyti — Estado 'bloqueada' para horas deshabilitadas por la jefatura
-- ---------------------------------------------------------------------------
-- Por qué en un archivo aparte:
--   Postgres no permite USAR un valor recién agregado al enum dentro de la
--   misma transacción que lo crea ("unsafe use of new value"). La columna
--   motivo_bloqueo, el check de citas y el RPC que escriben 'bloqueada' van en
--   20261001150100_bloqueo_horas_jefatura.sql, que corre en su propia
--   transacción. No intentar juntarlos.
--
-- Contexto funcional (docs/Descripción honesta de los módulos dentro de los
-- roles.docx): el poder real de la jefatura es deshabilitar horas. Sirve para
-- ausencia sobrevinida, llegada tarde, y ausencias planificadas (vacaciones,
-- libre administrativo, ausencia sin goce de sueldo). El telefono al paciente
-- es tarea humana de recepción: el sistema no notifica.
--
-- 'bloqueada' es un estado del bloque, no de la cita. La cita apoyada en un
-- bloque bloqueado pasa a 'cancelada'. Por eso el check del archivo siguiente
-- impide que una cita quedate en 'bloqueada'.

alter type public.estado_cita add value if not exists 'bloqueada';
