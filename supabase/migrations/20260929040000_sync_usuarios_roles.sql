-- =============================================================================
-- SWIMyti — Sincronizacion usuarios.id_rol -> usuario_roles
-- =============================================================================
-- COMPENSATORIA de 20260929000000_usuario_roles_multi_rol.sql
--
-- Problema: esa migracion llevo la fuente de verdad de roles a la tabla
-- usuario_roles, y fn_rol_actual() ahora lee SOLO desde ahi. Pero los dos
-- caminos que dan de alta personas en el sistema siguen escribiendo unicamente
-- usuarios.id_rol y nunca crean la fila en usuario_roles:
--
--   - fn_crear_usuario()          (alta desde /usuarios)
--   - fn_auto_registro_paciente() (registro publico del portal)
--
-- Consecuencia: cualquier usuario creado desde ese momento tendria cero roles
-- en usuario_roles, fn_rol_actual() devolveria null y veria el sistema vacio
-- (ni dashboard, ni agenda, ni portal). Los 22 usuarios existentes se salvan
-- porque la migracion original los migro, pero los nuevos no.
--
-- Solucion: un trigger, no tocar cada RPC. Mantiene la sincronizacion en el
-- unico punto donde el rol entra al sistema, de modo que altas por RPC, altas
-- por el panel de usuarios y futuros caminos queden cubiertos sin tener que
-- acordarse de la tabla nueva.
--
-- usuario_roles sigue siendo la fuente de verdad: este trigger solo crea la
-- fila inicial y mantiene la marca es_principal. NUNCA borra roles, porque
-- acumular roles es parte del diseno (un ascenso no se pierde) y porque
-- usuario_roles no admite vigente_hasta (ver 20260929000000).
--
-- Nota: el vínculo con el portal NO vive en usuarios, sino en
-- pacientes.id_usuario_portal. Por eso se consulta esa tabla.
-- =============================================================================

create or replace function public.fn_sync_usuario_rol_principal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_es_portal boolean;
begin
  if new.id_rol is null then
    return new;
  end if;

  -- Si la fila ya existe (backfill o alta previa), solo se marca la primaria.
  if exists (
    select 1 from public.usuario_roles
    where id_usuario = new.id_usuario and id_rol = new.id_rol
  ) then
    if tg_op = 'UPDATE' and (
      select coalesce(
        (select es_principal from public.usuario_roles
          where id_usuario = new.id_usuario and id_rol = new.id_rol), false)
    ) is distinct from true then
      update public.usuario_roles
         set es_principal = false
       where id_usuario = new.id_usuario and es_principal = true;
      update public.usuario_roles
         set es_principal = true
       where id_usuario = new.id_usuario and id_rol = new.id_rol;
    end if;
    return new;
  end if;

  -- El portal del paciente no es el rol principal: su cuenta sirve para
  -- entrar, no para gestionar.
  select exists (
    select 1 from public.pacientes p
    where p.id_usuario_portal = new.id_usuario
  ) into v_es_portal;

  -- Cambio de rol principal: se degrada el anterior.
  if tg_op = 'UPDATE' then
    update public.usuario_roles
       set es_principal = false
     where id_usuario = new.id_usuario and es_principal = true;
  end if;

  insert into public.usuario_roles (id_usuario, id_rol, es_principal)
  values (new.id_usuario, new.id_rol, not v_es_portal);

  return new;
end;
$$;

drop trigger if exists trg_sync_usuario_rol_principal on public.usuarios;
create trigger trg_sync_usuario_rol_principal
  after insert or update of id_rol on public.usuarios
  for each row
  execute function public.fn_sync_usuario_rol_principal();

-- ------------------------------------------------------------------
-- Respaldo: dar de alta las filas que hayan quedado huerfanas por
-- altas hechas entre la migracion N-roles y este trigger.
-- ------------------------------------------------------------------
insert into public.usuario_roles (id_usuario, id_rol, es_principal)
select u.id_usuario, u.id_rol,
       not exists (
         select 1 from public.pacientes p
         where p.id_usuario_portal = u.id_usuario
       )
from public.usuarios u
where u.id_rol is not null
  and not exists (
    select 1 from public.usuario_roles ur
    where ur.id_usuario = u.id_usuario and ur.id_rol = u.id_rol
  )
on conflict (id_usuario, id_rol) do nothing;

-- ------------------------------------------------------------------
-- Coherencia: si algun usuario quedo sin NINGUN rol principal, se
-- marca el mas antiguo como principal. No se reordenan los usuarios
-- que ya tienen uno marcado: cambiar el principal sin necesidad
-- alteraria el rol mostrado y el home de esa persona.
-- ------------------------------------------------------------------
with sin_principal as (
  select ur.id_usuario
  from public.usuario_roles ur
  where ur.vigente_hasta is null
    and not exists (
      select 1 from public.pacientes p
      where p.id_usuario_portal = ur.id_usuario
    )
  group by ur.id_usuario
  having bool_or(ur.es_principal) = false
)
update public.usuario_roles ur
   set es_principal = true
  from sin_principal sp
 where ur.id_usuario = sp.id_usuario
   and ur.vigente_hasta is null
   and ur.id_rol = (
     select min(ur2.id_rol)
     from public.usuario_roles ur2
     where ur2.id_usuario = sp.id_usuario
       and ur2.vigente_hasta is null
   );
