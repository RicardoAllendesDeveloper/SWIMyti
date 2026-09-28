-- =============================================================================
-- SWIMyti - Eliminación real (borrado) de bloques de jornada publicada
-- -----------------------------------------------------------------------------
-- Problema: "Cancelar jornada" en /disponibilidad solo hacía un UPDATE a
-- estado='cancelada'. Los bloques seguían apareciendo en "Bloques publicados"
-- (inservibles: no se pueden reservar) y fn_generar_bloques_jornada los
-- encontraba como "ya existentes", impidiendo volver a cargar la misma jornada.
--
-- Solución:
--   1. Política de borrado coherente con la de actualización: el profesional
--      borra sus propios bloques (antes solo el administrador podía).
--   2. RPC SECURITY DEFINER que elimina los bloques 'disponible' de una jornada
--      (día + especialidad + profesional). Nunca toca bloques con historia
--      (reservada / cancelada / completada) ni los referenciados por una cita
--      o por una orden de examen.
--   3. Limpieza única de los bloques huérfanos en estado 'cancelada' que dejó
--      el flujo anterior (sin citas ni órdenes asociadas).
--
-- Regla de negocio: una jornada eliminada desaparece de la agenda y puede
-- publicarse de nuevo. Las horas ya reservadas nunca se eliminan.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. RLS: el profesional puede borrar sus propios bloques
-- -----------------------------------------------------------------------------
drop policy if exists horarios_delete_admin on public.horarios_disponibles;

create policy horarios_delete_propio
  on public.horarios_disponibles
  for delete
  to authenticated
  using (
    (select public.fn_es_admin())
    or (id_profesional = (select auth.uid()))
  );

-- -----------------------------------------------------------------------------
-- 2. RPC: eliminar los bloques disponibles de una jornada
-- -----------------------------------------------------------------------------
create or replace function public.fn_eliminar_bloques_jornada(
  p_fecha date,
  p_id_especialidad bigint,
  p_id_profesional uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rol      text;
  v_es_admin boolean;
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

  select public.fn_rol_actual() into v_rol;
  v_es_admin := public.fn_es_admin();

  -- El profesional solo elimina sobre su propia agenda; el administrador sobre cualquiera
  if not v_es_admin and p_id_profesional <> (select auth.uid()) then
    raise exception 'SWIMyti: solo puedes eliminar bloques de tu propia agenda.'
      using errcode = '42501';
  end if;

  if not v_es_admin and v_rol not in ('doctor', 'enfermeria') then
    raise exception 'SWIMyti: tu rol no puede publicar agenda.'
      using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.especialidades e
    where e.id_especialidad = p_id_especialidad
  ) then
    raise exception 'SWIMyti: la especialidad no es válida.' using errcode = '45001';
  end if;

  -- Mismo criterio de zona horaria que fn_generar_bloques_jornada: el día es
  -- local (America/Santiago) y la BD guarda timestamptz en UTC.
  v_desde := (p_fecha::timestamp + time '00:00:00') at time zone 'America/Santiago';
  v_hasta := (p_fecha::timestamp + time '23:59:59.999') at time zone 'America/Santiago';

  -- Primero se cuentan los que NO se pueden tocar (con historia), para poder
  -- informar al usuario en vez de borrar a ciegas.
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

  return jsonb_build_object(
    'ok', true,
    'eliminados', v_borrados,
    'omitidos', v_omitidos
  );
end;
$$;

comment on function public.fn_eliminar_bloques_jornada(date, bigint, uuid) is
  'Elimina los bloques disponibles de una jornada (día + especialidad + profesional). '
  'No toca bloques con historia (reservada/cancelada/completada) ni referenciados por citas u órdenes.';

revoke all on function public.fn_eliminar_bloques_jornada(date, bigint, uuid) from public;
grant execute on function public.fn_eliminar_bloques_jornada(date, bigint, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. Limpieza única: bloques 'cancelada' huérfanos del flujo anterior
-- -----------------------------------------------------------------------------
-- Solo se borran los que no tienen cita (citas.id_horario es ON DELETE CASCADE:
-- borrarlos perdería historial) ni orden de examen asociada.
delete from public.horarios_disponibles h
where h.estado = 'cancelada'
  and not exists (select 1 from public.citas c where c.id_horario = h.id_horario)
  and not exists (select 1 from public.ordenes_examen o where o.id_horario = h.id_horario);
