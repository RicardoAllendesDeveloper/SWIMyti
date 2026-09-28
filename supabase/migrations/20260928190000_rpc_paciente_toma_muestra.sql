-- =============================================================================
-- SWIMyti - RPC para que el paciente agende/cambie/cancele su toma de muestra
-- La política ordenes_update NO permite al paciente actualizar su orden, por lo
-- que reservar vía cliente dejaba la cita creada (bloque bloqueado) pero la
-- orden sin marcar. Estas funciones son SECURITY DEFINER: validan en backend
-- y ejecutan cita + orden en una sola transacción.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Reservar toma de muestra sobre un bloque disponible
-- ---------------------------------------------------------------------------
create or replace function public.fn_paciente_reservar_toma_muestra(
  p_id_orden bigint,
  p_id_horario bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id_paciente bigint;
  v_orden       record;
  v_esp         bigint;
  v_fecha       timestamptz;
begin
  v_id_paciente := public.fn_mi_id_paciente();
  if v_id_paciente is null then
    return jsonb_build_object('ok', false, 'error', 'Tu cuenta no tiene un perfil de paciente.');
  end if;

  -- La orden debe pertenecer al paciente y estar pendiente de toma en recinto
  select o.id_orden, o.estado, o.modalidad, o.toma_muestra
    into v_orden
    from public.ordenes_examen o
    where o.id_orden = p_id_orden
      and o.id_paciente = v_id_paciente
    for update;

  if v_orden.id_orden is null then
    return jsonb_build_object('ok', false, 'error', 'La orden no existe o no te pertenece.');
  end if;
  if v_orden.estado <> 'pendiente' or v_orden.modalidad <> 'en_recinto'
     or v_orden.toma_muestra <> 'pendiente' then
    return jsonb_build_object('ok', false, 'error', 'Esta orden no admite reserva de toma de muestra.');
  end if;

  -- El bloque debe ser de toma de muestra y estar disponible
  select id_especialidad into v_esp
  from public.especialidades
  where nombre = 'Toma de muestra (Laboratorio)';

  select h.fecha_inicio into v_fecha
  from public.horarios_disponibles h
  where h.id_horario = p_id_horario
    and h.id_especialidad = v_esp
    and h.estado = 'disponible'
  for update;

  if v_fecha is null then
    return jsonb_build_object('ok', false, 'error', 'Ese horario ya no está disponible. Elige otro.');
  end if;

  -- Crear la cita (trigger fn_reservar_horario bloquea el bloque)
  insert into public.citas (id_horario, id_paciente, motivo, estado)
  values (p_id_horario, v_id_paciente, 'Toma de muestra', 'reservada');

  -- Marcar la orden
  update public.ordenes_examen
  set toma_muestra = 'agendada',
      fecha_toma_muestra = v_fecha,
      id_horario = p_id_horario
  where id_orden = p_id_orden;

  return jsonb_build_object('ok', true, 'fecha', v_fecha);
end;
$$;

-- ---------------------------------------------------------------------------
-- Liberar la hora de toma de muestra (para cambiar o cancelar)
-- Cancela la cita (el trigger libera el bloque) y deja la orden pendiente.
-- Solo se permite hasta 1 hora antes de la hora agendada.
-- ---------------------------------------------------------------------------
create or replace function public.fn_paciente_liberar_toma_muestra(
  p_id_orden bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id_paciente bigint;
  v_orden       record;
  v_horario     bigint;
  v_fecha       timestamptz;
begin
  v_id_paciente := public.fn_mi_id_paciente();
  if v_id_paciente is null then
    return jsonb_build_object('ok', false, 'error', 'Tu cuenta no tiene un perfil de paciente.');
  end if;

  select o.id_orden, o.toma_muestra, o.id_horario, o.fecha_toma_muestra
    into v_orden
    from public.ordenes_examen o
    where o.id_orden = p_id_orden
      and o.id_paciente = v_id_paciente
    for update;

  if v_orden.id_orden is null then
    return jsonb_build_object('ok', false, 'error', 'La orden no existe o no te pertenece.');
  end if;

  if v_orden.toma_muestra <> 'agendada' or v_orden.id_horario is null then
    return jsonb_build_object('ok', false, 'error', 'Esta orden no tiene una hora agendada.');
  end if;

  -- Regla: solo se aceptan cambios hasta 1 hora antes de la hora agendada
  if v_orden.fecha_toma_muestra is not null
     and v_orden.fecha_toma_muestra <= now() + interval '1 hour' then
    return jsonb_build_object(
      'ok', false,
      'error', 'No puedes cambiar o cancelar tu hora: faltan menos de 60 minutos para tu toma de muestra.'
    );
  end if;

  v_horario := v_orden.id_horario;

  -- Cancelar la cita asociada (el trigger fn_liberar_horario libera el bloque)
  update public.citas
  set estado = 'cancelada'
  where id_horario = v_horario
    and id_paciente = v_id_paciente
    and estado = 'reservada';

  -- Dejar la orden pendiente para volver a elegir hora
  update public.ordenes_examen
  set toma_muestra = 'pendiente',
      fecha_toma_muestra = null,
      id_horario = null
  where id_orden = p_id_orden;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.fn_paciente_reservar_toma_muestra(bigint, bigint) from public;
revoke all on function public.fn_paciente_liberar_toma_muestra(bigint) from public;
grant execute on function public.fn_paciente_reservar_toma_muestra(bigint, bigint) to authenticated;
grant execute on function public.fn_paciente_liberar_toma_muestra(bigint) to authenticated;