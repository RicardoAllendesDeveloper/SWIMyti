-- SWIMyti: endurecimiento previo a la bateria de pruebas
--
-- Cuatro hallazgos de una auditoria sobre pg_policies / pg_proc / pg_trigger,
-- verificados contra produccion con peticiones REST reales.
--
-- 1) Trigger sobre citas: un paciente podia mover su cita a otro bloque.
-- 2) FORCE ROW LEVEL SECURITY faltante en 4 tablas de finanzas y recetas.
-- 3) Politicas con TO public: anon recibia 401 en vez de [].
-- 4) Los tres predicados de autorizacion usaban el rol principal, no el
--    conjunto de roles (modelo N-roles documentado en AGENTS.md).

-- ------------------------------------------------------------------
-- 1) Un paciente solo puede cancelar su propia cita
-- ------------------------------------------------------------------
-- RLS decide QUE filas, nunca QUE columnas, asi que acotar columnas va en
-- un trigger, mismo criterio que fn_proteger_datos_sensibles_paciente.
--
-- El agujero: citas_update_own_or_admin daba UPDATE al paciente con un
-- WITH CHECK que solo comprobaba id_paciente, dejando libres todas las demas
-- columnas. Un PATCH del estilo {"id_horario": <otro bloque>} movia la cita:
--   - fn_liberar_horario es BEFORE UPDATE y solo reacciona a los cambios de
--     estado, asi que el bloque viejo queda en 'reservada' para siempre y el
--     nuevo sigue en 'disponible';
--   - el bloque nuevo queda envenenado, porque fn_reservar_horario rechaza
--     cualquier reserva sobre un id_horario que ya tenga una cita activa.
-- Con una sola peticion un paciente deja inutilizable un bloque de cualquier
-- profesional. No era fuga de datos, pero si de integridad y disponibilidad.
--
-- El personal no se restringe: sus cambios siguen pasando por las politicas
-- y por los triggers de horario. La regla de 1 hora la aplica
-- fn_paciente_liberar_cita, que actualiza solo el estado.
create or replace function public.fn_citas_paciente_solo_cancela()
returns trigger
language plpgsql
set search_path = 'public'
as $$
begin
  -- Todos los roles de SWIMyti menos el paciente.
  if public.fn_es_staff() then
    return new;
  end if;

  -- Unico cambio admisible para un paciente: cancelar.
  if new.id_paciente is distinct from old.id_paciente
     or new.id_horario is distinct from old.id_horario
     or new.motivo     is distinct from old.motivo
     or new.llegada    is distinct from old.llegada
     or new.estado::text is distinct from 'cancelada' then
    raise exception
      'SWIMyti: solo puedes cancelar tu propia cita. Para reagendar o cambiar el estado de una atencion, comunicate con el centro.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_citas_paciente_solo_cancela on public.citas;
create trigger trg_citas_paciente_solo_cancela
  before update on public.citas
  for each row
  execute function public.fn_citas_paciente_solo_cancela();

comment on function public.fn_citas_paciente_solo_cancela() is
  'SWIMyti: limita al paciente a cancelar su propia cita. RLS no acota columnas, por eso va en trigger.';

-- ------------------------------------------------------------------
-- 2) FORCE ROW LEVEL SECURITY en las 4 tablas que faltaban
-- ------------------------------------------------------------------
-- Sin FORCE, el dueño de la tabla (postgres) ignora RLS.
--
-- Alcance real, medido: postgres tiene rolbypassrls = true en este proyecto,
-- asi que FORCE NO protege frente a las funciones SECURITY DEFINER de finanzas
-- y recetas, que corren como postgres y se saltan RLS igual con o sin FORCE.
-- Para el trafico real (anon y authenticated) el controleffective son las
-- politicas, no FORCE; FORCE solo cubre el caso del dueño sin BYPASSRLS.
--
-- Se aplica igualmente por defensa en profundidad y porque el proyecto puede
-- migrar a un rol_dueno sin BYPASSRLS mas adelante.
--
-- Verificado que no rompe nada por REST con JWT real: administrativo escribe
-- en partidas_presupuesto y bonos_atencion (201), doctor en recetas_medicas
-- (201); enfermeria, paciente y doctor en las tablas que no les tocan siguen
-- recibiendo 403. Las politicas de estas tablas se apoyan en los mismos
-- predicados (fn_gestiona_finanzas, fn_gestiona_bonos, fn_emite_receta), asi
-- que las funciones siguen admitiendo su propia escritura.
alter table public.bonos_atencion       force row level security;
alter table public.certificados_clinicos force row level security;
alter table public.partidas_presupuesto force row level security;
alter table public.recetas_medicas      force row level security;

-- ------------------------------------------------------------------
-- 3) Politicas TO public -> TO authenticated
-- ------------------------------------------------------------------
-- Con TO public, una peticion anon si evalua la expresion de la politica.
-- Como anon no tiene EXECUTE de los predicados, PostgREST devolvia 401 en
-- vez de la lista vacia que dan el resto de tablas. Sin datos expuestos,
-- pero es un oraculo innecesario y un 401 donde deberia haber un [].
-- Con TO authenticated, anon no casa con ninguna politica y cae en el
-- rechazo por defecto de Postgres, que es el comportamiento correcto.

drop policy if exists bonos_insert_staff       on public.bonos_atencion;
drop policy if exists bonos_select_staff       on public.bonos_atencion;
drop policy if exists bonos_update_staff       on public.bonos_atencion;

create policy bonos_insert_staff on public.bonos_atencion
  for insert to authenticated with check (public.fn_gestiona_bonos());
create policy bonos_select_staff on public.bonos_atencion
  for select to authenticated using (public.fn_gestiona_bonos());
create policy bonos_update_staff on public.bonos_atencion
  for update to authenticated
  using (public.fn_gestiona_bonos())
  with check (public.fn_gestiona_bonos());

drop policy if exists partidas_delete_staff    on public.partidas_presupuesto;
drop policy if exists partidas_insert_staff    on public.partidas_presupuesto;
drop policy if exists partidas_select_staff    on public.partidas_presupuesto;
drop policy if exists partidas_update_staff    on public.partidas_presupuesto;

create policy partidas_delete_staff on public.partidas_presupuesto
  for delete to authenticated using (public.fn_gestiona_finanzas());
create policy partidas_insert_staff on public.partidas_presupuesto
  for insert to authenticated with check (public.fn_gestiona_finanzas());
create policy partidas_select_staff on public.partidas_presupuesto
  for select to authenticated using (public.fn_gestiona_finanzas());
create policy partidas_update_staff on public.partidas_presupuesto
  for update to authenticated
  using (public.fn_gestiona_finanzas())
  with check (public.fn_gestiona_finanzas());

drop policy if exists recetas_insert_staff     on public.recetas_medicas;
drop policy if exists recetas_select_paciente  on public.recetas_medicas;
drop policy if exists recetas_select_staff     on public.recetas_medicas;

create policy recetas_insert_staff on public.recetas_medicas
  for insert to authenticated with check (public.fn_emite_receta());
create policy recetas_select_paciente on public.recetas_medicas
  for select to authenticated
  using (public.fn_mi_id_paciente() = id_paciente);
create policy recetas_select_staff on public.recetas_medicas
  for select to authenticated
  using (public.fn_emite_receta() or public.fn_es_staff());

drop policy if exists cert_insert_staff        on public.certificados_clinicos;
drop policy if exists cert_select_paciente     on public.certificados_clinicos;
drop policy if exists cert_select_staff        on public.certificados_clinicos;

create policy cert_insert_staff on public.certificados_clinicos
  for insert to authenticated with check (public.fn_emite_receta());
create policy cert_select_paciente on public.certificados_clinicos
  for select to authenticated
  using (public.fn_mi_id_paciente() = id_paciente);
create policy cert_select_staff on public.certificados_clinicos
  for select to authenticated
  using (public.fn_emite_receta() or public.fn_es_staff());

-- ------------------------------------------------------------------
-- 4) Autorizacion por conjunto de roles, no por rol principal
-- ------------------------------------------------------------------
-- fn_rol_actual() devuelve usuarios.id_rol, que en el modelo N-roles es solo
-- el rol principal. Un profesional con rol principal 'doctor' que ademas tiene
-- 'administrativo' acumulaba el permiso de emitir recetas pero perdia el de
-- gestionar finanzas; y una enfermera con rol principal 'enfermeria' que
-- suma 'doctor' no podia prescribir. fn_tiene_rol(array[...]) consulta el
-- conjunto en usuario_roles, que es el modelo documentado.
--
-- Se mantiene coalesce(..., false) para que un usuario sin perfil no pase.
create or replace function public.fn_emite_receta()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    public.fn_tiene_rol(array['doctor']),
    false
  );
$$;

create or replace function public.fn_gestiona_bonos()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    public.fn_tiene_rol(array['administrador', 'administrativo']),
    false
  );
$$;

create or replace function public.fn_gestiona_finanzas()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    public.fn_tiene_rol(array['administrador', 'administrativo']),
    false
  );
$$;

comment on function public.fn_emite_receta() is
  'SWIMyti: emision de recetas y certificados. Evalua el conjunto de roles del usuario, no solo el principal.';
comment on function public.fn_gestiona_finanzas() is
  'SWIMyti: partidas de presupuesto. Evalua el conjunto de roles del usuario, no solo el principal.';
comment on function public.fn_gestiona_bonos() is
  'SWIMyti: bonos de atencion. Evalua el conjunto de roles del usuario, no solo el principal.';
