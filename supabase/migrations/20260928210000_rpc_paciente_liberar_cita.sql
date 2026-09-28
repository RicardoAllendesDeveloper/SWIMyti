-- =============================================================================
-- SWIMyti - RPC: paciente cancela/libera su propia cita (médica/enfermería)
-- Aplica la regla global: solo se acepta cancelar/cambiar hasta 1 hora antes
-- de la hora de la cita. SECURITY DEFINER: valida propiedad y regla en backend.
-- El trigger fn_liberar_horario libera el bloque al pasar a 'cancelada'.
-- =============================================================================

create or replace function public.fn_paciente_liberar_cita(
  p_id_cita bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id_paciente bigint;
  v_cita        record;
begin
  v_id_paciente := public.fn_mi_id_paciente();
  if v_id_paciente is null then
    return jsonb_build_object('ok', false, 'error', 'Tu cuenta no tiene un perfil de paciente.');
  end if;

  select c.id_cita, c.estado, c.id_horario, h.fecha_inicio
    into v_cita
    from public.citas c
    join public.horarios_disponibles h on h.id_horario = c.id_horario
    where c.id_cita = p_id_cita
      and c.id_paciente = v_id_paciente
    for update of c;

  if v_cita.id_cita is null then
    return jsonb_build_object('ok', false, 'error', 'La cita no existe o no te pertenece.');
  end if;

  if v_cita.estado <> 'reservada' then
    return jsonb_build_object('ok', false, 'error', 'Esta cita ya no está reservada.');
  end if;

  -- Regla global: cambios/cancelación hasta 1 hora antes de la cita
  if v_cita.fecha_inicio is not null
     and v_cita.fecha_inicio <= now() + interval '1 hour' then
    return jsonb_build_object(
      'ok', false,
      'error', 'No puedes cancelar o cambiar tu cita: faltan menos de 60 minutos para tu atención.'
    );
  end if;

  -- Cancelar (el trigger fn_liberar_horario libera el bloque)
  update public.citas
  set estado = 'cancelada'
  where id_cita = p_id_cita
    and estado = 'reservada';

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.fn_paciente_liberar_cita(bigint) from public;
grant execute on function public.fn_paciente_liberar_cita(bigint) to authenticated;