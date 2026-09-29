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
\echo '=== FIN. Ningun bloque debe marcar REVISAR ni devolver filas en 1, 5 o 6. ==='
\echo '   El 2 y el 7 son listas de revisión, no fallas. ==='
\echo ''
