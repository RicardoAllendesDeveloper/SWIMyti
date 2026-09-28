-- =============================================================================
-- SWIMyti - Corrección de zona horaria en generación de bloques
-- Los bloques se generaban como 07:30 UTC (la BD está en UTC), pero el recinto
-- es chileno: la hora real debe ser America/Santiago (UTC-3 en verano / UTC-4
-- en invierno). Se ancla la generación a la zona horaria de Chile.
-- =============================================================================

-- Limpiar los bloques existentes de toma de muestra para regenerarlos bien
delete from public.horarios_disponibles h
using public.especialidades e
where e.id_especialidad = h.id_especialidad
  and e.nombre = 'Toma de muestra (Laboratorio)';

-- Función: generar bloques de toma de muestra (15 min) para los próximos 30 días
-- anclados a la zona horaria America/Santiago.
create or replace function public.fn_generar_bloques_toma_muestra()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_modalidad   text;
  v_esp         bigint;
  v_dia         date;
  v_inicio      time;
  v_fin         time;
  v_bloque      timestamptz;
  v_created     bigint := 0;
  v_tiene_dia   bigint;
begin
  -- Modalidad vigente
  select valor into v_modalidad
  from public.config_recinto
  where clave = 'modalidad_toma_muestra';

  if v_modalidad is null or v_modalidad not in ('full_time', 'part_time') then
    return jsonb_build_object('ok', false, 'error', 'Modalidad no configurada');
  end if;

  -- Especialidad de toma de muestra
  select id_especialidad into v_esp
  from public.especialidades
  where nombre = 'Toma de muestra (Laboratorio)';

  if v_esp is null then
    return jsonb_build_object('ok', false, 'error', 'Especialidad de toma de muestra no existe');
  end if;

  -- Fecha local chilena de hoy
  v_dia := (now() at time zone 'America/Santiago')::date;

  -- Generar bloques de 15 min para los próximos 30 días (día local chileno),
  -- saltando los días que ya tienen bloques de esta especialidad.
  for v_dia in
    select generate_series(
             (now() at time zone 'America/Santiago')::date,
             (now() at time zone 'America/Santiago')::date + 30,
             interval '1 day'
           )::date
  loop
    if extract(dow from v_dia) = 0 then
      continue; -- domingo: sin atención
    end if;

    select count(*) into v_tiene_dia
    from public.horarios_disponibles
    where id_especialidad = v_esp
      and (fecha_inicio at time zone 'America/Santiago')::date = v_dia;

    if v_tiene_dia > 0 then
      continue;
    end if;

    if v_modalidad = 'full_time' then
      if extract(dow from v_dia) = 6 then -- sábado
        v_inicio := time '08:00';
        v_fin    := time '12:00';
      else
        v_inicio := time '07:30';
        v_fin    := time '16:30';
      end if;
    else -- part_time
      v_inicio := time '07:30';
      v_fin    := time '10:00';
    end if;

    -- Construir el bloque en hora local chilena y convertir a UTC al insertar
    v_bloque := ((v_dia + v_inicio) at time zone 'America/Santiago');
    while v_bloque < ((v_dia + v_fin) at time zone 'America/Santiago') loop
      insert into public.horarios_disponibles (
        id_profesional, id_especialidad, fecha_inicio, fecha_fin, estado, creado_por
      )
      values (
        (select auth.uid()),
        v_esp,
        v_bloque,
        v_bloque + interval '15 minutes',
        'disponible',
        (select auth.uid())
      );
      v_created := v_created + 1;
      v_bloque := v_bloque + interval '15 minutes';
    end loop;
  end loop;

  update public.config_recinto
  set updated_at = now(), actualizado_por = (select auth.uid())
  where clave = 'modalidad_toma_muestra';

  return jsonb_build_object('ok', true, 'generados', v_created, 'modalidad', v_modalidad);
end;
$$;

grant execute on function public.fn_generar_bloques_toma_muestra() to authenticated;