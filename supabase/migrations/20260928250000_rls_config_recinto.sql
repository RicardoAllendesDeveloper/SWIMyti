-- =============================================================================
-- SWIMyti - RLS en public.config_recinto
-- -----------------------------------------------------------------------------
-- ORIGEN DEL PROBLEMA
-- La migración 20260928130000_config_recinto_toma_muestra.sql creó esta tabla y
-- nunca ejecutó `enable row level security`, contra la regla que el propio
-- proyecto tiene escrita en AGENTS.md. Fue la ÚNICA de las 18 tablas del
-- esquema public sin RLS, por eso el Security Advisor la reportaba como error
-- (y no como warning).
--
-- Con RLS apagado, lo único que queda como puerta son los permisos de la tabla.
-- Supabase otorga ALL por defecto a anon / authenticated / service_role, así que
-- cualquier visitante anónimo del sitio podía leer Y escribir la tabla vía
-- PostgREST con la anon key (que es pública, viaja en el bundle del navegador).
--
-- IMPACTO
-- No hay filtración de datos clínicos: la tabla guarda la configuración del
-- recinto (clave, valor, descripcion). El impacto es de integridad y
-- disponibilidad: un anónimo podía cambiar `modalidad_toma_muestra` entre
-- 'full_time' y 'part_time', lo que altera cómo se generan los bloques de
-- 15 minutos de la toma de muestra, y además podía falsificar `actualizado_por`
-- (la auditoría de quién cambió la configuración no era confiable).
--
-- DEPENDENCIA IMPORTANTE: force row level security y la RPC de generación
-- public.fn_generar_bloques_toma_muestra es SECURITY DEFINER, o sea corre como
-- postgres (el dueño de la tabla). Sin FORCE, el dueño se saltaría RLS y la RPC
-- leería la configuración sin problema. CON FORCE, la RPC también pasa por las
-- políticas, y se evalúan contra el JWT del llamante real (auth.uid() sigue
-- leyendo los claims aunque current_user sea postgres). Por eso la política de
-- SELECT es `fn_es_admin()`: el único que llama a esa RPC es el administrador,
-- desde /config-recinto, que es el mismo módulo que edita la tabla.
--
-- Si alguien sin rol administrador llegara a llamar la RPC, `v_modalidad` queda
-- NULL y la función responde {'ok': false, 'error': 'Modalidad no configurada'}.
-- Falla explícitamente, no genera bloques con una modalidad por defecto, que es
-- justamente el comportamiento que no queremos.
--
-- Consumos verificados de esta tabla (a fecha de esta migración):
--   - frontend/src/pages/ConfigRecinto.tsx  -> SELECT y UPDATE (solo admin)
--   - public.fn_generar_bloques_toma_muestra -> SELECT (solo admin)
-- No hay otros lectores, ni funciones ni jobs.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. RLS habilitado y forzado
-- -----------------------------------------------------------------------------
alter table public.config_recinto enable row level security;
alter table public.config_recinto force  row level security;

-- -----------------------------------------------------------------------------
-- 2. Permisos: se cierra anon y se deja a authenticated solo lo que usa
-- -----------------------------------------------------------------------------
-- El permiso por sí solo no protege nada (RLS es el que filtra), pero dejar la
-- tabla sin INSERT ni DELETE para authenticated reduce la superficie de error si
-- alguien agrega un endpoint nuevo sin revisar la política.
revoke all on table public.config_recinto from anon;
revoke all on table public.config_recinto from authenticated;
grant select, update on table public.config_recinto to authenticated;

-- -----------------------------------------------------------------------------
-- 3. Políticas: solo el administrador lee y escribe la configuración
-- -----------------------------------------------------------------------------
drop policy if exists config_recinto_select_admin on public.config_recinto;
drop policy if exists config_recinto_update_admin on public.config_recinto;

create policy config_recinto_select_admin
  on public.config_recinto
  for select
  to authenticated
  using ((select public.fn_es_admin()));

create policy config_recinto_update_admin
  on public.config_recinto
  for update
  to authenticated
  using ((select public.fn_es_admin()))
  with check ((select public.fn_es_admin()));

comment on table public.config_recinto is
  'Configuración del recinto (modalidad de toma de muestra). Solo el administrador lee y escribe; los bloques los genera fn_generar_bloques_toma_muestra.';
