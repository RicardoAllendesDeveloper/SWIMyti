-- =============================================================================
-- SWIMyti — Fix: triggers de citas como SECURITY DEFINER
-- =============================================================================
-- Problema: fn_reservar_horario y fn_liberar_horario eran SECURITY INVOKER.
-- Cuando el administrativo (o admin) inserta/cancela una cita, el UPDATE sobre
-- horarios_disponibles era bloqueado por RLS (la policy de horarios exige ser
-- admin o el id_profesional), por lo que el estado del bloque no cambiaba:
-- la hora seguía 'disponible' para el paciente pero al reservar fallaba la
-- constraint citas_horario_activo_unique.
--
-- Solución: el trigger gestiona el estado del horario como parte de la lógica
-- del sistema, por lo que se ejecuta como SECURITY DEFINER (como las funciones
-- de rol), filtrando siempre por el id_horario de la fila insertada/actualizada.
-- =============================================================================

create or replace function public.fn_reservar_horario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Solo se permite reservar bloques que estén 'disponible'
  if (select estado from public.horarios_disponibles where id_horario = new.id_horario)
     <> 'disponible' then
    raise exception 'SWIMyti: el horario seleccionado ya no está disponible.'
      using errcode = '45001';
  end if;

  update public.horarios_disponibles
    set estado = 'reservada'
  where id_horario = new.id_horario;

  return new;
end;
$$;

create or replace function public.fn_liberar_horario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.estado = 'reservada' and new.estado = 'cancelada' then
    update public.horarios_disponibles
      set estado = 'disponible'
    where id_horario = old.id_horario;
  end if;
  return new;
end;
$$;

-- Recrear triggers (por si acaso)
drop trigger if exists trg_citas_reservar on public.citas;
create trigger trg_citas_reservar
  before insert on public.citas
  for each row
  execute function public.fn_reservar_horario();

drop trigger if exists trg_citas_liberar on public.citas;
create trigger trg_citas_liberar
  before update on public.citas
  for each row
  execute function public.fn_liberar_horario();

-- Verificación: sincronizar estado de horarios con citas activas existentes
update public.horarios_disponibles h
set estado = 'disponible'
where h.estado = 'reservada'
  and not exists (
    select 1 from public.citas c
    where c.id_horario = h.id_horario and c.estado = 'reservada'
  );