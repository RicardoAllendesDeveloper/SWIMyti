-- =============================================================================
-- SWIMyti — Vincular tu usuario de Auth con un rol staff
-- Ejecutar en Supabase → SQL Editor (como postgres / service role)
-- =============================================================================
-- 1) Reemplaza el email por el de tu cuenta de login
-- 2) Elige el rol: administrador | doctor | enfermeria | administrativo
-- =============================================================================

-- Ver roles disponibles
-- select * from public.roles;

insert into public.usuarios (
  id_usuario,
  id_rol,
  email,
  nombres,
  apellidos,
  activo
)
select
  u.id,
  r.id_rol,
  u.email,
  coalesce(u.raw_user_meta_data->>'nombres', split_part(u.email, '@', 1)),
  coalesce(u.raw_user_meta_data->>'apellidos', 'Staff'),
  true
from auth.users u
cross join public.roles r
where u.email = 'TU_EMAIL_AQUI@ejemplo.cl'   -- <-- CAMBIAR
  and r.nombre_rol = 'administrador'         -- o 'doctor'
on conflict (id_usuario) do update
set
  id_rol = excluded.id_rol,
  email = excluded.email,
  activo = true,
  updated_at = now();

-- Verificación
select
  us.id_usuario,
  us.email,
  us.nombres,
  us.apellidos,
  ro.nombre_rol,
  us.activo
from public.usuarios us
join public.roles ro on ro.id_rol = us.id_rol
where us.email = 'TU_EMAIL_AQUI@ejemplo.cl';  -- <-- CAMBIAR
