-- =============================================================================
-- SWIMyti — Coordinacion de agenda por jefatura (ambito por especialidad)
-- =============================================================================
-- Reemplaza el modelo "el profesional publica su propia jornada" por
-- "quien coordina la agenda publica la carga de un profesional".
--
-- CAMBIOS
-- 1. fn_generar_bloques_jornada recibe p_id_profesional: los bloques se
--    generan para ese profesional, no para quien llama. Solo un coordinador con
--    ambito en la especialidad puede invocarla.
-- 2. fn_eliminar_bloques_jornada exige el mismo permiso, incluida la
--    especialidad. Se elimina la rama que permitia al profesional borrar la suya.
-- 3. horarios_disponibles deja de ser editable por el profesional: INSERT,
--    UPDATE y DELETE pasan a exigir coordinador. Las RPCs son SECURITY DEFINER
--    y no dependen de RLS, asi que el flujo sigue funcionando.
-- 4. fn_es_coordinador_cita(p_id_horario) permite a la jefatura gestionar las
--    citas de su ambito, sin darle acceso a la agenda completa.
--
-- 'administrativo' no aparece como coordinador en ningun caso.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. La especialidad del profesional destino debe existir, estar activa y
--    ser una de las asignadas a ese profesional (no a quien coordina).
-- -----------------------------------------------------------------------------
create or replace function public.fn_especialidad_del_profesional(
  p_id_profesional uuid,
  p_id_especialidad bigint
)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1
    from public.doctores_especialidades de
    join public.especialidades e on e.id_especialidad = de.id_especialidad
    where de.id_doctor = p_id_profesional
      and de.id_especialidad = p_id_especialidad
      and e.activo
  );
$function$;

-- -----------------------------------------------------------------------------
-- 2. Generacion de bloques para un profesional
-- -----------------------------------------------------------------------------
create or replace function public.fn_generar_bloques_jornada(
  p_id_profesional   uuid,
  p_id_especialidad  bigint,
  p_fecha_inicio     date,
  p_fecha_fin        date,
  p_hora_inicio      time without time zone,
  p_hora_fin         time without time zone,
  p_dias             integer[]
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_coordinador uuid := auth.uid();
  v_dia         date;
  v_bloque      timestamptz;
  v_created     bigint := 0;
  v_total       bigint := 0;
  v_existe      bigint;
begin
  if v_coordinador is null then
    return jsonb_build_object('ok', false, 'error', 'Sesión no válida.');
  end if;

  if p_id_profesional is null then
    return jsonb_build_object('ok', false, 'error', 'Selecciona un profesional.');
  end if;
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

  -- El destino debe ser un profesional activo del sistema.
  if not exists (
    select 1
    from public.usuarios u
    where u.id_usuario = p_id_profesional
      and u.activo
  ) then
    return jsonb_build_object('ok', false, 'error', 'El profesional no existe o esta inactivo.');
  end if;

  -- La especialidad debe pertenecer al profesional destino, no a quien llama.
  if not public.fn_especialidad_del_profesional(p_id_profesional, p_id_especialidad) then
    return jsonb_build_object('ok', false, 'error',
      'El profesional no tiene asignada esa especialidad.');
  end if;

  -- Permiso: el administrador coordina cualquier especialidad; la jefatura solo
  -- las de su ambito. 'administrativo' queda fuera.
  if not public.fn_es_coordinador_agenda(p_id_especialidad) then
    return jsonb_build_object('ok', false, 'error',
      'Tu rol no puede publicar carga horaria para esa especialidad.');
  end if;

  -- Generar bloques de 15 min por cada día del rango que corresponda.
  for v_dia in
    select generate_series(p_fecha_inicio, p_fecha_fin, interval '1 day')::date
  loop
    if not (extract(dow from v_dia) = any(p_dias)) then
      continue;
    end if;

    v_total := v_total + 1;
    v_bloque := ((v_dia + p_hora_inicio) at time zone 'America/Santiago');

    while v_bloque < ((v_dia + p_hora_fin) at time zone 'America/Santiago') loop
      select count(*) into v_existe
      from public.horarios_disponibles
      where id_profesional = p_id_profesional
        and id_especialidad = p_id_especialidad
        and fecha_inicio = v_bloque;

      if v_existe = 0 then
        insert into public.horarios_disponibles (
          id_profesional, id_especialidad, fecha_inicio, fecha_fin, estado, creado_por
        )
        values (
          p_id_profesional,
          p_id_especialidad,
          v_bloque,
          v_bloque + interval '15 minutes',
          'disponible',
          v_coordinador
        );
        v_created := v_created + 1;
      end if;

      v_bloque := v_bloque + interval '15 minutes';
    end loop;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'generados', v_created,
    'dias', v_total
  );
end;
$function$;

-- -----------------------------------------------------------------------------
-- 3. Eliminacion de la jornada
-- -----------------------------------------------------------------------------
create or replace function public.fn_eliminar_bloques_jornada(
  p_fecha           date,
  p_id_especialidad bigint,
  p_id_profesional  uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_desde    timestamptz;
  v_hasta    timestamptz;
  v_borrados bigint := 0;
  v_omitidos bigint := 0;
begin
  if (select auth.uid()) is null then
    raise exception 'SWIMyti: se requiere sesión autenticada.' using errcode = '42501';
  end if;

  if p_fecha is null or p_id_especialidad is null or p_id_profesional is null then
    raise exception 'SWIMyti: datos de la jornada incompletos.' using errcode = '45001';
  end if;

  if not public.fn_es_coordinador_agenda(p_id_especialidad) then
    raise exception 'SWIMyti: tu rol no puede eliminar carga horaria de esa especialidad.'
      using errcode = '42501';
  end if;

  -- Mismo criterio de zona horaria que fn_generar_bloques_jornada: el dia es
  -- local (America/Santiago) y la BD guarda timestamptz en UTC.
  v_desde := (p_fecha::timestamp + time '00:00:00') at time zone 'America/Santiago';
  v_hasta := (p_fecha::timestamp + time '23:59:59.999') at time zone 'America/Santiago';

  -- Se cuentan los que NO se pueden tocar (con historia) para poder informar al
  -- usuario en vez de borrar a ciegas.
  select count(*) into v_omitidos
  from public.horarios_disponibles h
  where h.id_profesional = p_id_profesional
    and h.id_especialidad = p_id_especialidad
    and h.fecha_inicio >= v_desde
    and h.fecha_inicio <= v_hasta
    and (
      h.estado <> 'disponible'
      or exists (select 1 from public.citas c where c.id_horario = h.id_horario)
      or exists (select 1 from public.ordenes_examen o where o.id_horario = h.id_horario)
    );

  delete from public.horarios_disponibles h
  where h.id_profesional = p_id_profesional
    and h.id_especialidad = p_id_especialidad
    and h.fecha_inicio >= v_desde
    and h.fecha_inicio <= v_hasta
    and h.estado = 'disponible'
    and not exists (select 1 from public.citas c where c.id_horario = h.id_horario)
    and not exists (select 1 from public.ordenes_examen o where o.id_horario = h.id_horario);

  get diagnostics v_borrados = row_count;

  return jsonb_build_object('ok', true, 'eliminados', v_borrados, 'omitidos', v_omitidos);
end;
$function$;

-- -----------------------------------------------------------------------------
-- 4. La jefatura gestiona las citas de su ambito (agenda, no clinica)
-- -----------------------------------------------------------------------------
-- Devuelve true si quien llama puede gestionar la cita del bloque indicado.
-- El administrador y el administrativo conservan su acceso actual; la jefatura
-- solo cuando el bloque pertenece a una especialidad de su ambito.
create or replace function public.fn_es_coordinador_cita(p_id_horario bigint)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select case
    when public.fn_tiene_rol(array['administrador', 'administrativo']) then true
    when not public.fn_tiene_rol(array['jefatura']) then false
    else exists (
      select 1
      from public.horarios_disponibles h
      join public.jefaturas_especialidades je
        on je.id_especialidad = h.id_especialidad
      where h.id_horario = p_id_horario
        and je.id_jefatura = (select auth.uid())
    )
  end;
$function$;

-- -----------------------------------------------------------------------------
-- 5. horarios_disponibles: solo el coordinador escribe
-- -----------------------------------------------------------------------------
-- Antes, cualquier profesional podia INSERT (vía fn_es_staff, que incluía a
-- administrativo) y UPDATE/DELETE de cualquier fila propia, incluyendo
-- cambiar id_profesional o id_especialidad. Se cierra ese acceso directo: la
-- escritura pasa por las RPCs, que son SECURITY DEFINER y validan el ambito.
drop policy if exists horarios_insert_staff on public.horarios_disponibles;
drop policy if exists horarios_update_staff on public.horarios_disponibles;
drop policy if exists horarios_delete_propio on public.horarios_disponibles;

create policy horarios_write_coordinador
  on public.horarios_disponibles
  for all
  to authenticated
  using ((select public.fn_es_coordinador_agenda(id_especialidad)))
  with check ((select public.fn_es_coordinador_agenda(id_especialidad)));

-- -----------------------------------------------------------------------------
-- 6. citas: la jefatura gestiona las de su ambito
-- -----------------------------------------------------------------------------
-- Se agrega una politica de UPDATE y una de DELETE. Se mantienen las
-- existentes, que siguen cubriendo al personal clinico sobre sus propios
-- bloques y al paciente sobre su propia cita.
create policy citas_update_coordinador_ambito
  on public.citas
  for update
  to authenticated
  using ((select public.fn_es_coordinador_cita(id_horario)))
  with check ((select public.fn_es_coordinador_cita(id_horario)));

create policy citas_delete_coordinador_ambito
  on public.citas
  for delete
  to authenticated
  using ((select public.fn_es_coordinador_cita(id_horario)));

-- -----------------------------------------------------------------------------
-- 7. Grants minimos
-- -----------------------------------------------------------------------------
grant execute on function public.fn_especialidad_del_profesional(uuid, bigint) to authenticated, service_role;
grant execute on function public.fn_es_coordinador_cita(bigint) to authenticated, service_role;
grant execute on function public.fn_generar_bloques_jornada(uuid, bigint, date, date, time without time zone, time without time zone, integer[]) to authenticated, service_role;
grant execute on function public.fn_eliminar_bloques_jornada(date, bigint, uuid) to authenticated, service_role;
