-- SWIMyti: diagnostics in REM for jefatura + agenda no longer readable by anon.
--
-- 1) fn_rem_resumen se abre a 'jefatura' y 'administrador', pero el bloque de
--    diagnosticos seguia gateado por fn_es_admin(). Resultado: jefatura abria
--    REM y la UI le decia "El detalle de diagnosticos se reserva para
--    administracion" (frontend/src/pages/Rem.tsx). La funcion se contradicia a
--    si misma. Se usa el mismo predicado del gate, no uno nuevo.
--
--    'puede_ver_diagnosticos' se mantiene con el mismo nombre y la misma forma
--    porque frontend/src/pages/Rem.tsx lo tipa y lo lee. Hardcodearlo en true
--    habria dejado el flag muerto; asi sigue siendo una decision consciente si
--    alguna vez se amplia el gate.
--
-- 2) horarios_select_public era 'to anon, authenticated' con using (true): un
--    visitante sin sesion podia enumerar toda la agenda (profesional,
--    especialidad, estado y capacidad) de la clinica. No hay ruta publica que
--    la consulte: Landing/Login/Registro son las unicas sin ProtectedRoute
--    (frontend/src/App.tsx) y ninguno consulta horarios_disponibles.
--
--    No se afloja ninguna politica: se acota el alcance de una sola.

-- ---------- 1) fn_rem_resumen: diagnosticos para jefatura ----------

create or replace function public.fn_rem_resumen()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  -- Mismo conjunto que el gate de arriba. El gate ya garantiza esto, asi que
  -- hoy siempre es true; se mantiene explicito para que ampliar el gate obliga
  -- a decidir de forma consciente sobre los diagnosticos.
  v_ve_diagnosticos boolean;
  v_ini_mes date;
  v_fin_mes date;
  v_result jsonb;
begin
  if not public.fn_tiene_rol(array['jefatura', 'administrador']) then
    raise exception 'SWIMyti: el resumen estadistico es solo para jefatura y administracion'
      using errcode = '42501';
  end if;

  v_ve_diagnosticos := public.fn_tiene_rol(array['jefatura', 'administrador']);
  v_ini_mes := date_trunc('month', now() at time zone 'America/Santiago')::date;
  v_fin_mes := (v_ini_mes + interval '1 month')::date;

  v_result := jsonb_build_object(
    -- Sin to_char con 'Month': dependia de lc_time y salia en ingles.
    'periodo', initcap(public.fn_nombre_mes_es(extract(month from v_ini_mes)::integer)
                       || ' ' || extract(year from v_ini_mes)::integer),
    'generado_en', now(),
    'atenciones_totales', (select count(*)::int from public.fichas_medicas),
    'atenciones_mes', (
      select count(*)::int from public.fichas_medicas f
       where (f.created_at at time zone 'America/Santiago')::date >= v_ini_mes
         and (f.created_at at time zone 'America/Santiago')::date <  v_fin_mes
    ),
    'citas_registradas', (select count(*)::int from public.citas),
    'bonos_totales', (select count(*)::int from public.bonos_atencion),
    'top_especialidades', coalesce((
      select jsonb_agg(t order by t.valor desc, t.clave) from (
        select coalesce(e.nombre, 'Sin informacion') as clave, count(*)::int as valor
          from public.citas c
          join public.horarios_disponibles h on h.id_horario = c.id_horario
          left join public.especialidades e on e.id_especialidad = h.id_especialidad
         group by 1 order by 2 desc, 1 limit 5
      ) t
    ), '[]'::jsonb),
    'distribucion_atencion', coalesce((
      select jsonb_agg(t order by t.valor desc, t.clave) from (
        select case when b.tipo_atencion = 'procedimiento' then 'Procedimientos' else 'Consultas' end as clave,
               count(*)::int as valor
          from public.bonos_atencion b group by 1 order by 2 desc, 1
      ) t
    ), '[]'::jsonb),
    'ingresos_por_tipo', coalesce((
      select jsonb_agg(t order by t.valor desc, t.clave) from (
        select case when b.tipo_atencion = 'procedimiento' then 'Procedimientos' else 'Consultas' end as clave,
               round(sum(coalesce(b.monto, 0)))::int as valor
          from public.bonos_atencion b group by 1 order by 2 desc, 1
      ) t
    ), '[]'::jsonb),
    'top_diagnosticos', case when v_ve_diagnosticos then coalesce((
      select jsonb_agg(t order by t.valor desc, t.clave) from (
        select nullif(btrim(f.diagnostico), '') as clave, count(*)::int as valor
          from public.fichas_medicas f
         where f.diagnostico is not null and btrim(f.diagnostico) <> ''
         group by 1 order by 2 desc, 1 limit 5
      ) t
    ), '[]'::jsonb) else '[]'::jsonb end,
    'puede_ver_diagnosticos', v_ve_diagnosticos
  );

  return v_result;
end;
$function$;

comment on function public.fn_rem_resumen() is
  'Resumen estadistico mensual del mes en curso (America/Santiago). Restringido a jefatura y administracion; ambos ven diagnosticos.';

-- ---------- 2) horarios_disponibles: solo usuarios autenticados ----------

drop policy if exists horarios_select_public on public.horarios_disponibles;
create policy horarios_select_authenticated
  on public.horarios_disponibles
  for select
  to authenticated
  using (true);

-- El USING sigue en true: leer la agenda es de lectura, no de escritura. Lo
-- que cambia es quien puede leerla. Los gates de escritura (staff, profesional
-- sobre sus propios bloques, coordinador de agenda) viven en otras politicas y
-- no se tocan.