-- =====================================================================
-- Auditoría de Row-Level Security — SWIMyti
-- ---------------------------------------------------------------------
-- Corre en SQL Editor. Solo lectura: no modifica nada.
-- Correr antes de cada deploy y después de crear cualquier tabla.
--
-- Cubre exactamente lo que reportó el aviso de Supabase del 27-09-2026
-- ("Table publicly accessible / rls_disabled_in_public"), que no es
-- solo cosa de la tabla: una tabla con RLS prendido y una política
-- USING true es igual de pública. Este archivo cubre los dos casos.
-- =====================================================================

\echo ''
\echo '=== 1. Tablas de public SIN RLS (debe salir 0 filas) ==='
\echo '--- Si aparece algo aqui, ESA es la tabla del aviso de Supabase. ---'
select c.relname as tabla_sin_rls
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r', 'p')
  and not c.relrowsecurity
order by c.relname;

\echo ''
\echo '=== 2. Tablas de public con RLS habilitado pero NO forzado ==='
\echo '--- Sin FORCE, el owner de la tabla ignora RLS. Aceptable si solo'
\echo '--- los SECURITY DEFINER (que corren como owner) dependen de eso,'
\echo '--- pero cada una debe justificarse. ---'
select c.relname as rls_sin_force
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r', 'p')
  and c.relrowsecurity
  and not c.relforcerowsecurity
order by c.relname;

\echo ''
\echo '=== 3. Politicas alcanzables por anon (directa o via PUBLIC) ==='
\echo '--- Toda politica con USING true o WITH CHECK true aqui es una'
\echo '--- puerta abierta. Las demas se cierran por la funcion de rol. ---'
select tablename as tabla,
       policyname as politica,
       cmd as operacion,
       case when coalesce(qual, '') = 'true' then 'USING true  <-- ABIERTA A ANON'
            when coalesce(with_check, '') = 'true' then 'CHECK true  <-- ABIERTA A ANON'
            else 'cerrada por funcion de rol' end as evaluacion,
       coalesce(nullif(qual, ''), nullif(with_check, '')) as expresion
from pg_policies
where schemaname = 'public'
  and ( 'anon' = any(roles)
     or roles = '{anon}'
     or 'public' = any(roles)
     or roles = '{public}' )
order by (coalesce(qual, '') = 'true' or coalesce(with_check, '') = 'true') desc,
         tablename, cmd;

\echo ''
\echo '=== 4. Allowlist de lectura anon (debe coincidir exacto) ==='
\echo '--- Si una tabla aparece aqui pero no esta en la lista de arriba,'
\echo '--- es una fuga. Si falta de la lista, se rompio una reserva. ---'
with permitir_anon as (
  select distinct tablename from pg_policies
  where schemaname = 'public'
    and cmd = 'SELECT'
    and coalesce(qual, '') = 'true'
    and ( 'anon' = any(roles) or 'public' = any(roles) )
)
select coalesce(t.tablename, '(ninguna)') as expuesta_a_anon,
       case when t.tablename in ('especialidades', 'horarios_disponibles', 'doctores_especialidades')
            then 'permitida a proposito' else 'REVISAR' end as veredicto
from permitir_anon t
order by t.tablename;

\echo ''
\echo '=== 5. Funciones SECURITY DEFINER ejecutables por anon (debe ser 0) ==='
select p.proname as funcion_ejecutable_por_anon
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef
  and has_function_privilege('anon', p.oid, 'EXECUTE')
order by p.proname;

\echo ''
\echo '=== 6. Escrituras con expresion true (debe ser 0) ==='
\echo '--- Una escritura con USING/WITH CHECK true reachable por anon es'
\echo '--- lectura+borrado libre. Las que delegan en fn_* no cuentan:'
\echo '--- devuelven false sin sesion y la tabla da 401 al rol anon. ---'
select tablename as tabla,
       policyname as politica,
       cmd as operacion,
       coalesce(nullif(qual, ''), nullif(with_check, '')) as expresion
from pg_policies
where schemaname = 'public'
  and cmd in ('INSERT', 'UPDATE', 'DELETE')
  and ( 'anon' = any(roles) or 'public' = any(roles) )
  and ( coalesce(qual, '') = 'true' or coalesce(with_check, '') = 'true' )
order by tablename, cmd;

\echo ''
\echo '=== 7. Higiene: politicas que usan el pseudo-rol PUBLIC ==='
\echo '--- PUBLIC incluye a anon. Aqui no es una fuga (la expresion cierra'
\echo '--- por rol) pero es mas ancho que lo necesario: deberian decir'
\echo '--- authenticated. Marcadas para que no crezcan sin querer. ---'
select tablename as tabla,
       policyname as politica,
       cmd as operacion
from pg_policies
where schemaname = 'public'
  and ( 'public' = any(roles) or roles = '{public}' )
order by tablename, cmd;

\echo ''
\echo '=== 8. Triggers que ESCRIBEN y no son SECURITY DEFINER (debe salir 0) ==='
\echo '--- Un trigger sin SECURITY DEFINER corre como el usuario que disparo'
\echo '--- la sentencia. Si ese rol no tiene politica de escritura sobre la'
\echo '--- tabla que el trigger modifica, el UPDATE afecta 0 filas SIN error.'
\echo '--- Asi se perdian cupos: fn_liberar_horario dejaba el bloque en'
\echo '--- reservada para siempre (corregido el 2026-09-30). Un trigger que'
\echo '--- solo levanta excepcion o escribe new.<columna> puede ser invoker. ---'
select t.tgname as trigger,
       t.tgrelid::regclass::text as tabla,
       p.proname as funcion
from pg_trigger t
join pg_proc p on p.oid = t.tgfoid
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and not t.tgisinternal
  and not p.prosecdef
  and p.prosrc ~* '(insert[[:space:]]+into|update[[:space:]]+[a-z_]+\.|delete[[:space:]]+from)'
order by t.tgrelid::regclass::text, t.tgname;

\echo ''
\echo '=== 9. El enum y los checks no pueden desincronizarse ==='
\echo '--- Si se agrega un valor a estado_cita, los checks que ENUMERAN los'
\echo '--- valores permitidos no se actualizan solos. Eso ya paso: al agregar'
\echo '--- bloqueada, fn_bloquear_horarios reventaba con 23514 y el bloqueo de'
\echo '--- horas era imposible. Esta consulta debe dar 5 filas, todas en true:'
\echo '--- cada valor del enum tiene que estar en el check de horarios_disponibles. ---'
select e.enumlabel as valor_del_enum,
       position(e.enumlabel::text in pg_get_constraintdef(chk.oid)) > 0 as esta_en_el_check
from pg_type t
join pg_enum e on t.oid = e.enumtypid
cross join (
  -- El alias no puede ser 'con': el parser lo choca con el nombre de la
  -- funcion consultada y falla con "missing FROM-clause entry".
  select cc.oid as oid
  from pg_constraint cc
  where cc.conname = 'horarios_estado_check'
    and cc.conrelid = 'public.horarios_disponibles'::regclass
) chk
where t.typname = 'estado_cita'
order by e.enumsortorder;

\echo ''
\echo '=== 10. La hora deshabilitada no se puede resucitar ==='
\echo '--- El motivo de esta suite: al cancelar la cita, fn_liberar_horario'
\echo '--- devolvia el bloque a disponible. Con eso, bloquear por ausencia y'
\echo '--- cancelar la cita era igual que no hacer nada, y el paciente podia'
\echo '--- volver a tomar la hora que la jefatura acababa de cerrar.'
\echo '--- Comprueba que el trigger tenga la guarda. ---'
select
  (pg_get_functiondef(p.oid) ilike '%estado is distinct from%bloqueada%') as trigger_tiene_guarda,
  (p.prosecdef) as es_security_definer
from pg_proc p
where p.proname = 'fn_liberar_horario';

\echo ''
\echo '=== 11. Superficie de los RPC de bloqueo de horas (debe salir solo authenticated) ==='
\echo '--- El EXECUTE por defecto viene del privilegio PUBLIC, y este entorno'
\echo '--- ademas deja un grant explicito a anon en las funciones nuevas.'
\echo '--- Cualquier rol fuera de authenticated + service_role se revisa. ---'
select p.proname,
       r.rolname as rol_con_permiso,
       has_function_privilege(r.oid, p.oid, 'execute') as puede_ejecutar
from pg_proc p
cross join (select oid, rolname from pg_roles where rolname in ('anon', 'authenticated')) r
where p.proname in ('fn_bloquear_horarios', 'fn_reactivar_horarios')
  and has_function_privilege(r.oid, p.oid, 'execute')
order by p.proname, r.rolname;

\echo ''
\echo '=== FIN. Ningun bloque debe marcar REVISAR ni devolver filas en 1, 5, 6, 8, 9 ni 11. ==='
\echo '   El 2 y el 7 son listas de revision, no fallas. El 9 y el 10 son checks'
\echo '   que deben dar todos true / ninguna fila. ==='
\echo ''
