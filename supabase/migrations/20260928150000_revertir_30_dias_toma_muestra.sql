-- =============================================================================
-- SWIMyti - Reversión a generación de 30 días para toma de muestra
-- Se elimina el horizonte anual (20260928140000) por riesgos operativos:
-- cambiar de modalidad o feriados dejarían miles de bloques incorrectos.
-- Horizonte móvil: próximos 30 días desde la fecha actual.
-- =============================================================================

-- Limpiar bloques de toma de muestra disponibles más allá de 30 días
delete from public.horarios_disponibles h
using public.especialidades e
where e.id_especialidad = h.id_especialidad
  and e.nombre = 'Toma de muestra (Laboratorio)'
  and h.estado = 'disponible'
  and h.fecha_inicio > current_date + 30;

-- Función: generar bloques de toma de muestra (15 min) para los próximos 30 días
create or replace function public.fn_generar_bloques_toma_muestra()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_modalidad  text;
  v_esp        bigint;
  v_dia        date;
  v_inicio     time;
  v_fin        time;
  v_bloque     timestamptz;
  v_created    bigint := 0;
  v_tiene_dia  bigint;
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

  -- Generar bloques de 15 min para los próximos 30 días, saltando los días
  -- que ya tienen bloques de esta especialidad (renovación incremental).
  for v_dia in
    select generate_series(current_date, current_date + 30, interval '1 day')::date
  loop
    if extract(dow from v_dia) = 0 then
      continue; -- domingo: sin atención
    end if;

    select count(*) into v_tiene_dia
    from public.horarios_disponibles
    where id_especialidad = v_esp
      and fecha_inicio::date = v_dia;

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

    v_bloque := (v_dia::timestamp + v_inicio);
    while v_bloque < (v_dia::timestamp + v_fin) loop
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