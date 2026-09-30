-- =============================================================================
-- SWIMyti — La especialidad coordinable viaja con su id, no solo su nombre
-- =============================================================================
-- Que la jefatura publica "a ciegas" tiene una causa concreta: el listado de
-- profesionales coordinables devolvia el NOMBRE de la especialidad pero no su
-- id, asi que el frontend no podia acotar el desplegable de especialidad a las
-- que el profesional seleccionado tiene de verdad. El catalogo completo se
-- ofrecia siempre y la combinacion invalida solo se detecta al enviar, cuando
-- el RPC responde 'El profesional no tiene asignada esa especialidad'.
--
-- Con el id, el selector ofrece unicamente pares profesional<->especialidad
-- que el backend ya acepto al armar el listado, que es el mismo filtro de
-- ambito que usa fn_es_coordinador_agenda al publicar. Se evita que el usuario
-- descubra las reglas al toparse con un rechazo.
--
-- El tipo de retorno cambia, y Postgres no admite CREATE OR REPLACE para eso:
-- hay que DROP y volver a CREATE. El cuerpo y el grant a authenticated se
-- mantienen; la revocacion cambia a proposito (ver nota al pie).
--
-- Ojo con el ORDER BY: en una funcion 'returns table' los nombres de las
-- columnas de salida no son consultables, asi que 'order by especialidad'
-- falla con 42703. Va posicional, como en la version anterior.
-- =============================================================================

drop function if exists public.fn_profesionales_agenda_coordinable();

create function public.fn_profesionales_agenda_coordinable()
returns table (
  id_profesional  uuid,
  nombre          text,
  especialidad    text,
  id_especialidad bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select distinct
    dse.id_doctor,
    trim(coalesce(u.nombres, '') || ' ' || coalesce(u.apellidos, '')) as nombre,
    e.nombre::text as especialidad,
    dse.id_especialidad
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
  is 'SWIMyti: profesionales cuya carga horaria puede publicar el usuario actual, con el id de la especialidad para acotar el selector';

-- Postgres da EXECUTE a PUBLIC por defecto sobre toda funcion nueva, y anon
-- hereda de PUBLIC: con 'revoke ... from anon' solo NO alcanza, la revocacion
-- se hace sobre public. Verificado: con revoke a anon unicamente, anon podia
-- ejecutar la funcion (has_function_privilege = true).
revoke execute on function public.fn_profesionales_agenda_coordinable() from public;
grant execute on function public.fn_profesionales_agenda_coordinable() to authenticated;