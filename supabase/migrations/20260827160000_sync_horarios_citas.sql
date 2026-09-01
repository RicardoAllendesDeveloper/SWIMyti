-- =============================================================================
-- SWIMyti — Sincronizar estado de horarios con citas activas + defensa extra
-- =============================================================================
-- Problema: horarios quedaron inconsistentes con las citas (cita activa con
-- horario 'disponible'). La migración anterior solo sincronizó en una dirección.
--
-- Solución:
--  1) Sincronización BIDIRECCIONAL:
--       - horario 'disponible' con cita activa  -> 'reservada'
--       - horario 'reservada'  sin cita activa  -> 'disponible'
--  2) Reforzar fn_reservar_horario para que verifique también que no exista
--     ya una cita activa sobre el horario (defensa en profundidad).
-- =============================================================================

-- 1) Sincronización bidireccional
-- Horarios marcados disponibles pero con cita activa -> reservada
update public.horarios_disponibles h
set estado = 'reservada'
where h.estado = 'disponible'
  and exists (
    select 1 from public.citas c
    where c.id_horario = h.id_horario and c.estado = 'reservada'
  );

-- Horarios marcados reservada pero sin cita activa -> disponible
update public.horarios_disponibles h
set estado = 'disponible'
where h.estado = 'reservada'
  and not exists (
    select 1 from public.citas c
    where c.id_horario = h.id_horario and c.estado = 'reservada'
  );

-- 2) Reforzar el trigger de reserva: verificar estado del horario Y que no
-- exista una cita activa previa (la constraint única también lo protege, pero
-- esto da un mensaje de error más claro y evita la inconsistencia).
create or replace function public.fn_reservar_horario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- El bloque debe estar 'disponible'
  if (select estado from public.horarios_disponibles where id_horario = new.id_horario)
     <> 'disponible' then
    raise exception 'SWIMyti: el horario seleccionado ya no está disponible.'
      using errcode = '45001';
  end if;

  -- No debe existir otra cita activa sobre el mismo horario
  if exists (
    select 1 from public.citas
    where id_horario = new.id_horario and estado <> 'cancelada'
  ) then
    raise exception 'SWIMyti: el horario seleccionado ya fue reservado.'
      using errcode = '45001';
  end if;

  update public.horarios_disponibles
    set estado = 'reservada'
  where id_horario = new.id_horario;

  return new;
end;
$$;

drop trigger if exists trg_citas_reservar on public.citas;
create trigger trg_citas_reservar
  before insert on public.citas
  for each row
  execute function public.fn_reservar_horario();

-- Verificación final
select
  h.id_horario,
  h.fecha_inicio,
  h.estado as estado_horario,
  (select count(*) from public.citas c
   where c.id_horario = h.id_horario and c.estado = 'reservada') as citas_activas
from public.horarios_disponibles h
order by h.fecha_inicio;