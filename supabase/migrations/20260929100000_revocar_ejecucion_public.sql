-- =============================================================================
-- 20260929100000 - Cerrar permisos de ejecucion heredados de PUBLIC
-- =============================================================================
-- Por que: en Postgres toda funcion nace con EXECUTE para el pseudo-rol PUBLIC.
-- Las migraciones anteriores revocaban de 'anon', lo cual NO hace nada por si
-- solo: el permiso sigue llegando por PUBLIC, asi que cualquier visitante sin
-- sesion podia invocar 8 funciones SECURITY DEFINER.
--
-- El detalle que hace que un revoke seemingly correcto no cierre nada: siete de
-- esas ocho acumulaban ADEMAS un grant explicito a anon, asi que su ACL era
-- '{=X, ..., anon=X, ...}'. Hay que revocar de los dos origenes: `from public`
-- quita el heredado y `from anon` quita el explicito. Revocar solo uno deja la
-- puerta abierta. El raise del punto 3 existe justamente para detectar eso.
--
-- Impacto real medido con la matriz de permisos (supabase/tests/matriz_permisos.sql):
--   - fn_generar_bloques_jornada: un anonimo podia generar bloques de agenda.
--   - fn_profesionales_agenda_coordinable: un anonimo podia enumerar profesionales
--     y especialidades. Bajo la Ley 19.628 eso es dato personal de terceros.
--   - fn_es_coordinador_agenda / _cita / fn_especialidad_del_profesional:
--     sondeo de booleanos sobre el ambito de terceros.
--
-- Que cambia: solo permisos. No se toca logica, datos ni politicas RLS. Los
-- usuarios de la app (rol authenticated) conservan el acceso porque ya tenian
-- el permiso explicito; se vuelve a declarar para que quede a la vista.
-- =============================================================================

-- 1. Las 8 funciones de negocio que quedaron abiertas al publico.
--    Se revocan de los DOS origenes: PUBLIC (heredado) y anon (explicito).
revoke execute on function public.fn_generar_bloques_jornada(
  uuid, bigint, date, date, time, time, integer[]) from public, anon;

revoke execute on function public.fn_profesionales_agenda_coordinable()
  from public, anon;

revoke execute on function public.fn_es_coordinador_agenda(bigint)
  from public, anon;

revoke execute on function public.fn_es_coordinador_cita(bigint)
  from public, anon;

revoke execute on function public.fn_especialidad_del_profesional(uuid, bigint)
  from public, anon;

revoke execute on function public.fn_tiene_rol(text[]) from public, anon;

revoke execute on function public.fn_roles_actuales() from public, anon;

revoke execute on function public.fn_sync_usuario_rol_principal() from public, anon;

-- 2. Reafirmar el acceso de la aplicacion. authenticated es el rol con el que
--    corre PostgREST; service_role lo usa el backend/edge. Sin esto, quitar el
--    permiso a PUBLIC dejaria la app sin acceso a estas funciones.
grant execute on function public.fn_generar_bloques_jornada(
  uuid, bigint, date, date, time, time, integer[]) to authenticated, service_role;

grant execute on function public.fn_profesionales_agenda_coordinable()
  to authenticated, service_role;

grant execute on function public.fn_es_coordinador_agenda(bigint)
  to authenticated, service_role;

grant execute on function public.fn_es_coordinador_cita(bigint)
  to authenticated, service_role;

grant execute on function public.fn_especialidad_del_profesional(uuid, bigint)
  to authenticated, service_role;

grant execute on function public.fn_tiene_rol(text[]) to authenticated, service_role;

grant execute on function public.fn_roles_actuales() to authenticated, service_role;

-- fn_sync_usuario_rol_principal es funcion de trigger: no se invoca por RPC,
-- asi que no necesita permiso de ejecucion para nadie.

-- 3. Red de seguridad. Si una migracion futura crea una SECURITY DEFINER y
--    olvida el revoke, el caso 19 de la matriz de permisos lo detecta y CI
--    falla. Este raise deja ademas el motivo escrito en el error de quien
--    intente aplicar cambios sin correr los tests.
do $$
declare
  v_abiertas text;
begin
  select string_agg(p.proname, ', ' order by p.proname) into v_abiertas
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosecdef
     and has_function_privilege('anon', p.oid, 'execute');

  if v_abiertas is not null then
    raise exception 'SWIMyti: quedan SECURITY DEFINER ejecutables por anon: %. Revocar de PUBLIC.', v_abiertas;
  end if;
end $$;

comment on function public.fn_profesionales_agenda_coordinable() is
  'SWIMyti: lista profesionales coordinables. SECURITY DEFINER con revoke de PUBLIC: no puede quedar ejecutable por anon porque devuelve nombres de profesionales (dato personal bajo la Ley 19.628).';
