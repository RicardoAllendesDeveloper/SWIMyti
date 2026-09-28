-- =============================================================================
-- SWIMyti - Publicar jornada de atención del profesional (doctor/enfermería)
-- El profesional define un rango de fechas, los días de la semana, y la hora
-- inicio/fin. La función divide la jornada en bloques de 15 minutos
-- (estándar de atención básica), igual que la toma de muestra, para que el
-- calendario verde/rojo funcione igual para cualquier tipo de cita.
-- No duplica bloques ya existentes (misma fecha/hora + profesional + especialidad).
-- =============================================================================

create or replace function public.fn_generar_bloques_jornada(
  p_id_especialidad bigint,
  p_fecha_inicio date,
  p_fecha_fin date,
  p_hora_inicio time,
  p_hora_fin time,
  p_dias integer[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prof    uuid := auth.uid();
  v_rol     text;
  v_dia     date;
  v_bloque  timestamptz;
  v_created bigint := 0;
  v_total   bigint := 0;
  v_existe  bigint;
begin
  if v_prof is null then
    return jsonb_build_object('ok', false, 'error', 'Sesión no válida.');
  end if;

  -- Solo doctor o enfermería publican su propia agenda
  select public.fn_rol_actual() into v_rol;
  if v_rol not in ('doctor', 'enfermeria') then
    return jsonb_build_object('ok', false, 'error', 'Solo doctores o enfermería pueden publicar su jornada.');
  end if;

  -- Validaciones
  if p_id_especialidad is null then
    return jsonb_build_object('ok', false, 'error', 'Selecciona una especialidad.');
  end if;
  if p_fecha_inicio is null or p_fecha_fin is null or p_fecha_fin < p_fecha_inicio then
    return jsonb_build_object('ok', false, 'error', 'Rango de fechas inválido.');
  end if;
  if p_hora_inicio is null or p_hora_fin is null or p_hora_fin <= p_hora_inicio then
    return jsonb_build_object('ok', false, 'error', 'La hora de fin debe ser posterior a la de inicio.');
  end if;
  if p_dias is null or array_length(p_dias, 1) = 0 then
    return jsonb_build_object('ok', false, 'error', 'Selecciona al menos un día de la semana.');
  end if;

  -- La especialidad debe existir y pertenecer al profesional (si es doctor)
  if not exists (
    select 1 from public.especialidades e where e.id_especialidad = p_id_especialidad and e.activo
  ) then
    return jsonb_build_object('ok', false, 'error', 'La especialidad no es válida.');
  end if;

  if v_rol = 'doctor' and not exists (
    select 1 from public.doctores_especialidades de
    where de.id_doctor = v_prof and de.id_especialidad = p_id_especialidad
  ) then
    return jsonb_build_object('ok', false, 'error', 'No tienes asignada esa especialidad.');
  end if;

  -- Generar bloques de 15 min por cada día del rango que corresponda
  for v_dia in
    select generate_series(p_fecha_inicio, p_fecha_fin, interval '1 day')::date
  loop
    if not (extract(dow from v_dia) = any(p_dias)) then
      continue;
    end if;

    v_total := v_total + 1;
    v_bloque := ((v_dia + p_hora_inicio) at time zone 'America/Santiago');

    while v_bloque < ((v_dia + p_hora_fin) at time zone 'America/Santiago') loop
      -- No duplicar si el bloque exacto ya existe para este profesional/especialidad
      select count(*) into v_existe
      from public.horarios_disponibles
      where id_profesional = v_prof
        and id_especialidad = p_id_especialidad
        and fecha_inicio = v_bloque;

      if v_existe = 0 then
        insert into public.horarios_disponibles (
          id_profesional, id_especialidad, fecha_inicio, fecha_fin, estado, creado_por
        )
        values (
          v_prof,
          p_id_especialidad,
          v_bloque,
          v_bloque + interval '15 minutes',
          'disponible',
          v_prof
        );
        v_created := v_created + 1;
      end if;

      v_bloque := v_bloque + interval '15 minutes';
    end loop;
  end loop;

  return jsonb_build_object('ok', true, 'generados', v_created, 'dias', v_total, 'modalidad', v_rol);
end;
$$;

revoke all on function public.fn_generar_bloques_jornada(bigint, date, date, time, time, integer[]) from public;
grant execute on function public.fn_generar_bloques_jornada(bigint, date, date, time, time, integer[]) to authenticated;