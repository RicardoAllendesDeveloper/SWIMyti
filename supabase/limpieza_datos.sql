-- =============================================================================
-- SWIMyti - Limpieza de datos (Fase 2)
-- Ejecutar en Supabase -> SQL Editor (como postgres / service role).
--
-- Qué limpia:
--   1) Recetas y certificados "de prueba" / emitidos por roles que ya no pueden
--      emitir (admin), o que contienen texto de prueba.
--   2) Bloques horarios de doctores errados: bloques en el pasado, bloques sin
--      profesional válido y bloques duplicados del mismo profesional+fecha.
--   3) Cuentas inactivas: perfiles de usuarios cuyo auth.users ya no existe.
--
-- La limpieza es IDEMPOTENTE (se puede re-ejecutar sin efectos secundarios).
-- Se incluyen consultas de VERIFICACIÓN (SELECT) antes de cada DELETE para
-- revisar qué filas serán afectadas.
-- =============================================================================

-- =============================================================================
-- 0) Preliminares: revisar conteos actuales
-- =============================================================================
select 'recetas' as tabla, count(*) from public.recetas_medicas
union all select 'certificados', count(*) from public.certificados_clinicos
union all select 'horarios', count(*) from public.horarios_disponibles
union all select 'usuarios', count(*) from public.usuarios
union all select 'citas', count(*) from public.citas;

-- =============================================================================
-- 1) RECETAS Y CERTIFICADOS DE PRUEBA O EMITIDOS POR ADMIN
--    Obs. Tester: "Administrador de sistema no puede ni debe realizar recetas
--    ni certificados". Tras aplicar la restricción a rol doctor, se eliminan los
--    documentos emitidos por administradores (emisión inválida) y los que
--    contengan marcadores de prueba.
-- =============================================================================

-- 1.1) Recetas emitidas por usuarios con rol 'administrador' (emisión inválida)
select r.id_receta, r.fecha_emision, u.email, ro.nombre_rol, r.medicamentos
from public.recetas_medicas r
join public.usuarios u on u.id_usuario = r.id_usuario_emisor
join public.roles ro on ro.id_rol = u.id_rol
where ro.nombre_rol = 'administrador';

delete from public.recetas_medicas r
using public.usuarios u, public.roles ro
where r.id_usuario_emisor = u.id_usuario
  and u.id_rol = ro.id_rol
  and ro.nombre_rol = 'administrador';

-- 1.2) Recetas con texto de prueba (medicamentos/indicaciones)
select r.id_receta, r.medicamentos, r.indicaciones
from public.recetas_medicas r
where r.medicamentos ilike '%prueba%'
   or r.medicamentos ilike '%test%'
   or r.indicaciones ilike '%prueba%'
   or r.indicaciones ilike '%test%';

delete from public.recetas_medicas
where medicamentos ilike '%prueba%'
   or medicamentos ilike '%test%'
   or indicaciones ilike '%prueba%'
   or indicaciones ilike '%test%';

-- 1.3) Certificados emitidos por usuarios con rol 'administrador' (emisión inválida)
select c.id_certificado, c.fecha_emision, u.email, ro.nombre_rol, c.tipo_certificado
from public.certificados_clinicos c
join public.usuarios u on u.id_usuario = c.id_usuario_emisor
join public.roles ro on ro.id_rol = u.id_rol
where ro.nombre_rol = 'administrador';

delete from public.certificados_clinicos c
using public.usuarios u, public.roles ro
where c.id_usuario_emisor = u.id_usuario
  and u.id_rol = ro.id_rol
  and ro.nombre_rol = 'administrador';

-- 1.4) Certificados con texto de prueba
select c.id_certificado, c.tipo_certificado, c.detalle
from public.certificados_clinicos c
where c.tipo_certificado ilike '%prueba%'
   or c.tipo_certificado ilike '%test%'
   or c.detalle ilike '%prueba%'
   or c.detalle ilike '%test%';

delete from public.certificados_clinicos
where tipo_certificado ilike '%prueba%'
   or tipo_certificado ilike '%test%'
   or detalle ilike '%prueba%'
   or detalle ilike '%test%';

-- =============================================================================
-- 2) BLOQUES HORARIOS ERRADOS
-- =============================================================================

-- 2.1) Bloques cuyo horario ya venció (fecha_fin en el pasado)
--      Se conserva trazabilidad; se marcan como 'cancelada' en lugar de eliminar.
select id_horario, id_profesional, fecha_inicio, fecha_fin, estado
from public.horarios_disponibles
where fecha_fin < now()
  and estado not in ('cancelada', 'completada');

update public.horarios_disponibles
set estado = 'cancelada'
where fecha_fin < now()
  and estado not in ('cancelada', 'completada');

-- 2.2) Bloques sin profesional válido (id_profesional que no existe en usuarios)
select h.id_horario, h.id_profesional, h.fecha_inicio, h.fecha_fin
from public.horarios_disponibles h
left join public.usuarios u on u.id_usuario = h.id_profesional
where u.id_usuario is null;

delete from public.horarios_disponibles h
where not exists (
  select 1 from public.usuarios u where u.id_usuario = h.id_profesional
);

-- 2.3) Bloques duplicados exactos del mismo profesional y rango de tiempo
--      (se conserva la primera ocurrencia, se cancelan las demás)
select h1.id_horario, h1.id_profesional, h1.fecha_inicio, h1.fecha_fin
from public.horarios_disponibles h1
join public.horarios_disponibles h2
  on h2.id_profesional = h1.id_profesional
 and h2.fecha_inicio = h1.fecha_inicio
 and h2.fecha_fin = h1.fecha_fin
 and h2.id_horario < h1.id_horario
where h1.estado = 'disponible';

update public.horarios_disponibles h1
set estado = 'cancelada'
from public.horarios_disponibles h2
where h2.id_profesional = h1.id_profesional
  and h2.fecha_inicio = h1.fecha_inicio
  and h2.fecha_fin = h1.fecha_fin
  and h2.id_horario < h1.id_horario
  and h1.estado = 'disponible';

-- =============================================================================
-- 3) CUENTAS INACTIVAS / PERFILES HUÉRFANOS
-- =============================================================================

-- 3.1) Perfiles en public.usuarios cuyo auth.users ya no existe (huérfanos)
select u.id_usuario, u.email, u.nombres, u.apellidos, u.activo
from public.usuarios u
left join auth.users a on a.id = u.id_usuario
where a.id is null;

-- Nota: los perfiles huérfanos no se eliminan automáticamente porque pueden
-- corresponder a pacientes con historial clínico. Solo se desactivan.
update public.usuarios u
set activo = false, updated_at = now()
where u.activo = true
  and not exists (
    select 1 from auth.users a where a.id = u.id_usuario
  );

-- 3.2) Usuarios marcados como inactivos desde hace más de 60 días
--      (perfiles demo de testers que ya no se usarán). Solo se dejan inactivos,
--      NO se eliminan, para conservar el historial de auditoría.
select u.id_usuario, u.email, u.nombres, u.apellidos, u.activo, u.updated_at
from public.usuarios u
where u.activo = false
  and u.updated_at < now() - interval '60 days';

-- =============================================================================
-- 4) VERIFICACIÓN FINAL
-- =============================================================================
select 'recetas' as tabla, count(*) from public.recetas_medicas
union all select 'certificados', count(*) from public.certificados_clinicos
union all select 'horarios', count(*) from public.horarios_disponibles
union all select 'usuarios activos', count(*) from public.usuarios where activo = true
union all select 'usuarios inactivos', count(*) from public.usuarios where activo = false;