-- =============================================================================
-- SWIMyti — Listado de profesionales coordinables por el usuario actual
-- =============================================================================
-- La pagina de Agenda (/disponibilidad) necesita un selector de profesional
-- para publicar una jornada. Ese listado NO puede salir de una query normal
-- desde el cliente: un usuario solo debe ver a los profesionales de SU ambito.
--
-- Reglas:
--   - administrador           -> todos los profesionales
--   - jefatura                -> profesionales de las especialidades que
--                                 coordina (jefaturas_especialidades)
--   - cualquier otro rol      -> lista vacia (no puede publicar jornadas)
--
-- Es SECURITY DEFINER porque debe leer usuarios, doctores_especialidades y
-- jefaturas_especialidades en nombre de un usuario que no tiene acceso a la
-- tabla completa. La fila devuelta ya viene filtrada por ambito, asi que no
-- hay superficie de fuga: el SELECT solo puede devolver menos.
-- =============================================================================

create or replace function public.fn_profesionales_agenda_coordinable()
returns table (
  id_profesional uuid,
  nombre         text,
  especialidad   text
)
language sql
stable
security definer
set search_path = public
as $$
  select distinct
    dse.id_doctor,
    trim(coalesce(u.nombres, '') || ' ' || coalesce(u.apellidos, '')) as nombre,
    e.nombre::text
  from public.doctores_especialidades dse
  join public.usuarios u
    on u.id_usuario = dse.id_doctor
   and u.activo
  join public.especialidades e
    on e.id_especialidad = dse.id_especialidad
  where public.fn_es_admin()
     or (
       public.fn_tiene_rol(array['jefatura'])
       and exists (
         select 1
         from public.jefaturas_especialidades je
         where je.id_jefatura = auth.uid()
           and je.id_especialidad = dse.id_especialidad
       )
     )
  order by 3, 2;
$$;

comment on function public.fn_profesionales_agenda_coordinable()
  is 'SWIMyti: profesionales cuya carga horaria puede publicar el usuario actual';

revoke all on function public.fn_profesionales_agenda_coordinable() from anon;
grant execute on function public.fn_profesionales_agenda_coordinable() to authenticated;
