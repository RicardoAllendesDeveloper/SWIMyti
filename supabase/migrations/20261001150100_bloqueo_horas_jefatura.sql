-- SWIMyti — Deshabilitar horas: motivo, trazabilidad y cancelacion de citas
-- ---------------------------------------------------------------------------
-- Depends de 20261001150000_estado_bloqueada.sql, que es lo que agrega el valor
-- 'bloqueada' al enum. Corre en transaccion propia justamente por eso.
--
-- Que resuelve:
--   1. Que quede registro de por que se deshabilito una hora y quien lo hizo.
--      Es el requisito de trazabilidad: bloquear sin motivo no es auditable.
--   2. Que la cita apoyada en un bloque bloqueado se cancele, no quede huerfana
--      en 'reservada' sobre una hora que no se va a realizar.
--   3. Que la jefatura pueda revertir un bloqueoerror propio.
--
-- La seguridad va en el RPC SECURITY DEFINER, no aflojando RLS: el RLS decide
-- filas, y ademas el alcance por especialidad ya vive en
-- fn_es_coordinador_agenda().

-- 1. Trazabilidad del bloqueo -----------------------------------------------
alter table public.horarios_disponibles
  add column if not exists motivo_bloqueo text,
  add column if not exists bloqueado_por  uuid references public.usuarios(id_usuario),
  add column if not exists bloqueado_at   timestamptz;

comment on column public.horarios_disponibles.motivo_bloqueo is
  'Motivo por el que la jefatura deshabilito esta hora. Obligatorio al bloquear.';
comment on column public.horarios_disponibles.bloqueado_por is
  'Usuario que ejecuto el bloqueo. Queda aunque la cuenta se desactive.';
comment on column public.horarios_disponibles.bloqueado_at is
  'Momento del bloqueo.';

-- 1b. El check de estado enumera los valores permitidos, y agregar un valor al
-- enum NO lo actualiza. Sin esto, fn_bloquear_horarios reventaba con
-- 23514 "violates check constraint horarios_estado_check" y el bloqueo de
-- horas era imposible (encontrado al probar el RPC contra la BD el 2026-10-01).
--
-- Si alguna vez se agrega otro valor a estado_cita, hay que volver a tocar esta
-- lista. Es duplicada con el enum, que ya restringe el tipo, pero se mantiene
-- como defensa en profundidad al estilo del resto del proyecto.
alter table public.horarios_disponibles
  drop constraint if exists horarios_estado_check;
alter table public.horarios_disponibles
  add constraint horarios_estado_check
  check (estado = any (array['disponible','reservada','cancelada','completada','bloqueada']::estado_cita[]));

-- 2. Motivo de la cancelacion en la cita -------------------------------------
-- La cita se cancela, pero el motivo vive en ambos lados: en el bloque (para
-- saber que la hora quedo deshabilitada) y en la cita (para que la traza de la
-- atencion no dependa de joins posteriores).
alter table public.citas
  add column if not exists motivo_cancelacion text;

comment on column public.citas.motivo_cancelacion is
  'Motivo de la cancelacion. Lo llena el bloqueo de horas de la jefatura; la '
  'liberacion del paciente deja null.';

-- 3. 'bloqueada' es del bloque, nunca de la cita ------------------------------
-- Sin este check, el enum compartido deja que una cita quede en 'bloqueada',
-- que no es un estado de atencion y romperia los listings.
alter table public.citas
  drop constraint if exists citas_estado_check;
alter table public.citas
  add constraint citas_estado_check
  check (estado is distinct from 'bloqueada');

-- 4. fn_liberar_horario no debe resucitar una hora deshabilitada -------------
-- Este es el bug que hace inutil el bloqueo: al cancelar la cita, el trigger
-- devolvia el bloque a 'disponible'. Con eso, bloquear por ausencia sobrevenida
-- y cancelar la cita era exactamente lo mismo que no hacer nada, y el paciente
-- podia volver a reservar la hora que la jefatura acababa de cerrar.
-- La regla: si el bloque esta bloqueado a proposito, la cancelacion de la cita
-- no lo reabre. fn_liberar_horario queda SECURITY DEFINER porque escribe en
-- otra tabla.
create or replace function public.fn_liberar_horario()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if old.estado = 'reservada' and new.estado = 'cancelada' then
    update public.horarios_disponibles
      set estado = 'disponible'
    where id_horario = old.id_horario
      and estado is distinct from 'bloqueada';
  elsif old.estado = 'reservada' and new.estado = 'completada' then
    update public.horarios_disponibles
      set estado = 'completada'
    where id_horario = old.id_horario;
  end if;
  return new;
end;
$$;

-- 5. RPC de bloqueo -----------------------------------------------------------
-- No es un simple update: tiene que validar el ambito persona por persona,
-- porque un mismo lote puede traer horas de dos especialidades y la jefatura
-- solo coordina las suyas.
create or replace function public.fn_bloquear_horarios(
  p_ids    bigint[],
  p_motivo text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_motivo      text;
  v_fuera       bigint[];
  v_inexistentes bigint[];
  v_afectadas   jsonb;
  v_bloqueadas  int := 0;
  v_canceladas  int := 0;
begin
  v_motivo := btrim(coalesce(p_motivo, ''));

  if v_motivo = '' then
    raise exception 'SWIMyti: indica el motivo por el que se deshabilita la hora.'
      using errcode = '22023';
  end if;

  if p_ids is null or cardinality(p_ids) = 0 then
    raise exception 'SWIMyti: no se selecciono ninguna hora para deshabilitar.'
      using errcode = '22023';
  end if;

  -- No es una promesa de bonne voluntad: el motivo queda escrito en el bloque
  -- y es lo que la jefatura le dira al paciente por telefono.
  -- Las horas ya pasadas no se tocan: son historia clinica, no agenda futura.
  select coalesce(array_agg(h.id_horario), '{}'::bigint[])
    into v_inexistentes
  from public.horarios_disponibles h
  where h.id_horario = any(p_ids)
    and (h.fecha_fin <= now() or h.estado in ('completada', 'cancelada'));

  if cardinality(v_inexistentes) > 0 then
    raise exception
      'SWIMyti: % de las horas seleccionadas ya pasaron, se completaron o se cancelaron. No se puede deshabilitar una hora que no es futura.',
      cardinality(v_inexistentes)
      using errcode = '22023';
  end if;

  -- Ambito. El administrador coordina todas; la jefatura, las horas de su
  -- servicio mas las suyas propias (tambien atiende, y tambien bloquea las
  -- suyas). Este es el filtro que reemplaza al update directo: por eso el RPC
  -- valida antes de escribir, en vez de confiar en RLS fila por fila.
  --
  -- El coalesce NO es cosmetico. Sin sesion, auth.uid() es NULL, y
  -- `h.id_profesional = auth.uid()` evalua NULL, de modo que
  -- `not (false or false or NULL)` tambien es NULL: la fila NO entra en
  -- v_fuera y el bloqueo pasa. Con el coalesce, NULL se vuelve false, la fila
  -- entra en v_fuera y se rechaza. Mismo razonamiento para
  -- fn_es_coordinador_agenda con una especialidad nula.
  select coalesce(array_agg(h.id_horario), '{}'::bigint[])
    into v_fuera
  from public.horarios_disponibles h
  where h.id_horario = any(p_ids)
    and not coalesce(
      public.fn_es_admin()
      or public.fn_es_coordinador_agenda(h.id_especialidad)
      or (h.id_profesional is not null and h.id_profesional = auth.uid()),
      false
    );

  if cardinality(v_fuera) > 0 then
    raise exception
      'SWIMyti: no coordinas el area de % de las horas seleccionadas. Solo puedes deshabilitar horas de tu servicio o tuyas.',
      cardinality(v_fuera)
      using errcode = '42501';
  end if;

  -- Que citas se van a caer, antes de tocarlas. El sistema no notifica por
  -- correo (plan gratuito, sin Edge Functions), asi que la jefatura necesita
  -- la lista para llamar por telefono desde recepcion.
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id_cita',     c.id_cita,
               'id_paciente', c.id_paciente,
               'fecha',       h.fecha_inicio
             )
           ),
           '[]'::jsonb
         )
    into v_afectadas
  from public.citas c
  join public.horarios_disponibles h on h.id_horario = c.id_horario
  where h.id_horario = any(p_ids)
    and c.estado = 'reservada';

  -- Las horas con cita quedan bloqueadas igual. Bloquear sin cancelar dejaria
  -- al paciente con una reserva fantasma que el portal le sigue mostrando.
  update public.horarios_disponibles
     set estado         = 'bloqueada',
         motivo_bloqueo = v_motivo,
         bloqueado_por  = auth.uid(),
         bloqueado_at   = now()
   where id_horario = any(p_ids)
     and estado is distinct from 'completada';

  get diagnostics v_bloqueadas = row_count;

  update public.citas
     set estado = 'cancelada'
   where id_horario = any(p_ids)
     and estado = 'reservada';

  get diagnostics v_canceladas = row_count;

  return jsonb_build_object(
    'ok',                  true,
    'horas_bloqueadas',    v_bloqueadas,
    'citas_canceladas',    v_canceladas,
    'citas_afectadas',     v_afectadas,
    'motivo',              v_motivo
  );
end;
$$;

comment on function public.fn_bloquear_horarios(bigint[], text) is
  'Deshabilita horas del area. Exige motivo, valida el ambito de '
  'coordinacion, cancela las citas afectadas y devuelve quienes hay que '
  'avisar por telefono.';

-- 6. RPC para revertir un bloqueo ---------------------------------------------
-- El caso real: la jefatura bloquea por ausencia sobrevenida y al otro dia el
-- profesional vuelve. Sin esto habria que regenerar la jornada entera.
-- No reabre citas: las canceladas quedan canceladas y el paciente vuelve a
-- tomar hora. Reabrir la cita en silencio seria inventar una atencion.
create or replace function public.fn_reactivar_horarios(p_ids bigint[])
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_fuera     bigint[];
  v_reactivadas int := 0;
begin
  if p_ids is null or cardinality(p_ids) = 0 then
    raise exception 'SWIMyti: no se selecciono ninguna hora para reactivar.'
      using errcode = '22023';
  end if;

  select coalesce(array_agg(h.id_horario), '{}'::bigint[])
    into v_fuera
  from public.horarios_disponibles h
  where h.id_horario = any(p_ids)
    and h.estado = 'bloqueada'
    and not coalesce(
      public.fn_es_admin()
      or public.fn_es_coordinador_agenda(h.id_especialidad)
      or (h.id_profesional is not null and h.id_profesional = auth.uid()),
      false
    );

  if cardinality(v_fuera) > 0 then
    raise exception
      'SWIMyti: no coordinas el area de % de las horas seleccionadas.',
      cardinality(v_fuera)
      using errcode = '42501';
  end if;

  update public.horarios_disponibles
     set estado         = 'disponible',
         motivo_bloqueo = null,
         bloqueado_por  = null,
         bloqueado_at   = null
   where id_horario = any(p_ids)
     and estado = 'bloqueada';

  get diagnostics v_reactivadas = row_count;

  return jsonb_build_object(
    'ok',       true,
    'reactivadas', v_reactivadas
  );
end;
$$;

comment on function public.fn_reactivar_horarios(bigint[]) is
  'Reabre horas previamente bloqueadas por la jefatura. No revive citas: el '
  'paciente vuelve a tomar hora.';

-- 7. Grants --------------------------------------------------------------------
-- El EXECUTE por defecto viene del privilegio PUBLIC. Con
-- `revoke ... from anon, authenticated` la funcion seguiria ejecutable por
-- cualquiera, asi que se revoca de public (ver AGENTS.md).
--
-- OJO: ademas de PUBLIC, este entorno aplica ALTER DEFAULT PRIVILEGES y deja
-- un grant EXECUTE explicito a anon en las funciones nuevas. `revoke from
-- public` no lo quita, porque no viene de PUBLIC. Hay que revocar de anon
-- explicitamente o el RPC queda ejecutable sin sesion (comprobado el
-- 2026-10-01: fn_bloquear_horarios aparecia con anon=X mientras
-- fn_crear_usuario y fn_generar_bloques_jornada no lo tienen).
-- El RPC igual no seria explotable sin sesion porque auth.uid() es null y los
-- helpers de coordinacion dan false, pero la superficie no se deja abierta.
revoke all on function public.fn_bloquear_horarios(bigint[], text)  from public;
revoke all on function public.fn_reactivar_horarios(bigint[])         from public;
revoke all on function public.fn_bloquear_horarios(bigint[], text)  from anon;
revoke all on function public.fn_reactivar_horarios(bigint[])         from anon;
grant execute on function public.fn_bloquear_horarios(bigint[], text)  to authenticated;
grant execute on function public.fn_reactivar_horarios(bigint[])         to authenticated;
