-- =============================================================================
-- SWIMyti — Proteger estado y vinculo de portal del paciente
-- =============================================================================
-- COMPENSATORIA de 20260929020000_permisos_jefatura_pacientes.sql
--
-- Contexto: la migracion 2000 dio a la jefatura permiso de UPDATE sobre
-- pacientes, que es lo que pediste ("editar datos personales del paciente").
-- Pero en PostgreSQL, RLS decide QUE FILAS y nunca QUE COLUMNAS: la politica
-- autoriza la fila completa, no las columnas de datos personales.
--
-- El riesgo real no son los datos personales (nombre, telefono, domicilio):
-- esos son justamente los que la jefatura debe poder corregir. Son dos columnas
-- de control que tambien quedaron abiertas por el mismo permiso:
--
--   activo            -> dar de baja o reactivar un paciente
--   id_usuario_portal -> reapuntar el registro a otra cuenta del portal,
--                        es decir, mover la identidad digital de una persona
--
-- Ambas son decisiones administrativas del centro, no correcciones de ficha.
--
-- La proteccion de RUT y prevision ya existia (fn_proteger_datos_sensibles_
-- paciente). No se agrega un mecanismo nuevo: se extiende ese trigger, que ya
-- es el patron del proyecto y ya cubre el caso mas delicado.
--
-- Decision: no se usan permisos de columna (grant update (...)) porque
-- fn_set_updated_at no es SECURITY DEFINER y fallaria al no tener permiso
-- sobre updated_at, y porque el permiso de columna impediria a administrador
-- editar RUT/prevision sin duplicar la logica en una RPC.
-- =============================================================================

create or replace function public.fn_proteger_datos_sensibles_paciente()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Identidad: RUT y prevision requieren Administrador o permiso especial.
  if (new.rut is distinct from old.rut)
     or (new.prevision is distinct from old.prevision) then
    if not (
      public.fn_es_admin()
      or public.fn_tiene_permiso_sensible(old.id_paciente)
    ) then
      raise exception
        'SWIMyti: RUT y previsión solo pueden ser modificados por Administrador o con permiso especial aprobado.'
        using errcode = '42501';
    end if;
  end if;

  -- Control del registro: solo Administrador da de alta, reactiva o cambia el
  -- vinculo con la cuenta del portal. No hay permiso especial que lo habilite:
  -- es una decision del centro sobre su propia cartera de pacientes.
  if (new.activo is distinct from old.activo)
     or (new.id_usuario_portal is distinct from old.id_usuario_portal) then
    if not public.fn_es_admin() then
      raise exception
        'SWIMyti: el estado del paciente y su vinculo con el portal solo pueden ser modificados por Administrador.'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;
