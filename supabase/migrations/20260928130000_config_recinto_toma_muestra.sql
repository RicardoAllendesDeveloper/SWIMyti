-- =============================================================================
-- SWIMyti - Configuración del recinto: modalidad de toma de muestra
-- El Administrador de sistema define la jornada laboral del laboratorio:
--   - full_time: Lun-Vie 7:30-16:30 y Sáb 8:00-12:00 (laboratorio propio:
--     mañana toma de muestras, tarde análisis).
--   - part_time: Lun-Sáb 7:30-10:00 (solo toma de muestras; las muestras se
--     envían a un laboratorio externo).
-- A partir de la modalidad se generan bloques de atención de 15 minutos
-- (estándar de atención básica) para los próximos 30 días. Se renueva
-- automáticamente a menos que el Administrador cambie la modalidad.
-- =============================================================================

-- ---------- Especialidad: Toma de muestra (Laboratorio) ----------
insert into public.especialidades (nombre, descripcion)
values ('Toma de muestra (Laboratorio)', 'Extracción de muestras para exámenes de laboratorio')
on conflict (nombre) do nothing;

-- ---------- Tabla de configuración del recinto ----------
create table if not exists public.config_recinto (
  id_config      bigint generated always as identity primary key,
  clave          text not null unique,
  valor          text,
  descripcion    text,
  actualizado_por uuid references public.usuarios (id_usuario),
  updated_at     timestamptz not null default now()
);

insert into public.config_recinto (clave, valor, descripcion)
values ('modalidad_toma_muestra', 'full_time',
        'Jornada del laboratorio: full_time (Lun-Vie 7:30-16:30, Sáb 8:00-12:00) o part_time (Lun-Sáb 7:30-10:00)')
on conflict (clave) do nothing;

-- ---------- Función: generar bloques de toma de muestra (15 min) ----------
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
  v_existentes bigint;
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

  -- Si ya existen bloques futuros, no duplicar (renovación automática)
  select count(*) into v_existentes
  from public.horarios_disponibles
  where id_especialidad = v_esp
    and fecha_inicio > now()
    and estado in ('disponible', 'reservada', 'completada');

  if v_existentes > 0 then
    return jsonb_build_object('ok', true, 'generados', 0, 'existentes', v_existentes, 'modalidad', v_modalidad);
  end if;

  -- Generar bloques de 15 min para los próximos 30 días según la modalidad
  for v_dia in
    select generate_series(current_date, current_date + 30, interval '1 day')::date
  loop
    -- Determinar franja del día
    if extract(dow from v_dia) = 0 then
      continue; -- domingo: sin atención
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

    -- Bloques de 15 minutos
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

  -- Actualizar fecha de generación
  update public.config_recinto
  set updated_at = now(), actualizado_por = (select auth.uid())
  where clave = 'modalidad_toma_muestra';

  return jsonb_build_object('ok', true, 'generados', v_created, 'modalidad', v_modalidad);
end;
$$;

grant execute on function public.fn_generar_bloques_toma_muestra() to authenticated;