-- =============================================================================
-- SWIMyti — Fix: permitir re-reservar un horario tras cancelar su cita
-- =============================================================================
-- Problema: la constraint UNIQUE(id_horario) en citas bloquea la reserva de un
-- horario que ya tuvo una cita cancelada (la fila cancelada sigue existiendo).
--
-- Solución: reemplazar por un índice único PARCIAL que solo considere citas
-- activas (estado <> 'cancelada'). Al cancelar, el horario vuelve a disponible
-- y puede reservarse de nuevo insertando una nueva fila en citas.
-- =============================================================================

alter table public.citas drop constraint if exists citas_horario_unique;

create unique index if not exists citas_horario_activo_unique
  on public.citas (id_horario)
  where estado <> 'cancelada';

-- =============================================================================
-- Fix: los horarios publicados deben llevar especialidad para la toma de horas
-- (evitar bloques 'Sin especialidad' que confunden al paciente).
-- Se asigna Medicina General (id 1) a los horarios sin especialidad existentes.
-- =============================================================================
update public.horarios_disponibles
set id_especialidad = (select id_especialidad from public.especialidades where nombre = 'Medicina General')
where id_especialidad is null;

-- =============================================================================
-- Seed de bloques futuros de disponibilidad para el doctor demo
-- (varios días adelante, con especialidad Medicina General)
-- =============================================================================
do $$
declare
  v_doctor uuid;
  v_med_gral bigint;
  v_inicio timestamptz;
begin
  select id into v_doctor from auth.users where email = 'doctor.demo@swimyti.cl';
  select id_especialidad into v_med_gral from public.especialidades where nombre = 'Medicina General';

  if v_doctor is not null and v_med_gral is not null then
    for i in 1..6 loop
      v_inicio := date_trunc('day', now() + (i || ' days')::interval)
                    + time '09:00' + (i * 2 || ' hours')::interval;
      insert into public.horarios_disponibles (
        id_profesional, id_especialidad, fecha_inicio, fecha_fin, estado, creado_por
      )
      values (
        v_doctor, v_med_gral, v_inicio, v_inicio + interval '30 minutes',
        'disponible', v_doctor
      )
      on conflict do nothing;
    end loop;
  end if;
end $$;

-- Verificación
select
  h.id_horario,
  h.fecha_inicio,
  e.nombre as especialidad,
  h.estado,
  u.nombres || ' ' || u.apellidos as doctor
from public.horarios_disponibles h
left join public.especialidades e on e.id_especialidad = h.id_especialidad
left join public.usuarios u on u.id_usuario = h.id_profesional
where h.estado = 'disponible'
order by h.fecha_inicio;