-- =============================================================================
-- 20260929110000 - REM: resumen estadistico agregado en la base de datos
-- =============================================================================
-- Por que: el Resumen Estadistico Mensual se armaba en el navegador con tres
-- queries paginadas con .limit(500) y toda la agregacion en JavaScript. Eso
-- traia tres problemas, no uno:
--
--   1. Los numeros estaban truncados. "Atenciones totales" era en realidad
--      "atenciones de las ultimas 500", y el informe no avisaba. Un resumen
--      estadistico que reporta mal es peor que no tener informe.
--   2. Se descargaba la columna `diagnostico` de fichas_medicas al navegador.
--      Diagnostico es dato clinico sensible bajo la Ley 19.628, y la RLS decide
--      filas, no columnas: si la fila es visible, llega completa.
--   3. REM es un informe de jefatura, pero dependia de leer fichas_medicas y
--      bonos_atencion crudos, y fn_gestiona_bonos() solo admite
--      administrador/administrativo. Con la UI en jefatura la seccion de
--      atenciones habria salido en cero.
--
-- Que hace: una RPC SECURITY DEFINER que calcula los agregados en Postgres y
-- devuelve solo numeros y etiquetas. El navegador deja de ver diagnosticos.
--
-- Decision de privacidad: los diagnosticos mas comunes siguen devolviendo el
-- texto, pero SOLO para administrador. Para jefatura la tarjeta no se arma.
-- Un top-5 de diagnosticos sobre una poblacion chica permite reidentificar
-- pacientes, y lateo el dato se leeria como el nombre de una condicion
-- clinica de alguien concreto. Si mas adelante se quiere, la via segura es
-- publicarlo como indicador epidemiologico del periodo, no como ranking de
-- fichas.
-- =============================================================================

create or replace function public.fn_rem_resumen()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_es_admin boolean;
  v_ini_mes  date;
  v_fin_mes  date;
  v_result   jsonb;
begin
  -- La RPC es SECURITY DEFINER, asi que salta RLS por dentro. El permiso hay
  -- que validarlo aqui explicitamente, contra el rol real de quien llama.
  if not public.fn_tiene_rol(array['jefatura', 'administrador']) then
    raise exception 'SWIMyti: el resumen estadistico es solo para jefatura y administracion'
      using errcode = '42501';
  end if;

  v_es_admin := public.fn_es_admin();

  -- El mes se acota en America/Santiago, no en UTC ni en la zona del
  -- navegador: la BD guarda timestamptz en UTC y "este mes" tiene que
  -- coincidir con el calendario del centro.
  v_ini_mes := date_trunc('month', now() at time zone 'America/Santiago')::date;
  v_fin_mes := (v_ini_mes + interval '1 month')::date;

  v_result := jsonb_build_object(
    'periodo', to_char(v_ini_mes, 'FMMonth YYYY'),
    'generado_en', now(),

    -- KPIs ---------------------------------------------------------------
    'atenciones_totales', (
      select count(*)::int from public.fichas_medicas
    ),
    'atenciones_mes', (
      select count(*)::int from public.fichas_medicas f
       where (f.created_at at time zone 'America/Santiago')::date >= v_ini_mes
         and (f.created_at at time zone 'America/Santiago')::date <  v_fin_mes
    ),
    'citas_registradas', (
      select count(*)::int from public.citas
    ),
    'bonos_totales', (
      select count(*)::int from public.bonos_atencion
    ),

    -- Especialidades mas solicitadas: se cuenta por especialidad del bloque
    -- reservado, no por la del profesional.
    'top_especialidades', coalesce((
      select jsonb_agg(t order by t.valor desc, t.clave)
        from (
          select coalesce(e.nombre, 'Sin informacion') as clave,
                 count(*)::int as valor
            from public.citas c
            join public.horarios_disponibles h on h.id_horario = c.id_horario
            left join public.especialidades e on e.id_especialidad = h.id_especialidad
           group by 1
           order by 2 desc, 1
           limit 5
        ) t
    ), '[]'::jsonb),

    -- Consultas vs procedimientos: es un conteo de bonos, no un monto.
    'distribucion_atencion', coalesce((
      select jsonb_agg(t order by t.valor desc, t.clave)
        from (
          select case when b.tipo_atencion = 'procedimiento'
                       then 'Procedimientos' else 'Consultas' end as clave,
                 count(*)::int as valor
            from public.bonos_atencion b
           group by 1
           order by 2 desc, 1
        ) t
    ), '[]'::jsonb),

    -- Ingresos por tipo: aqui si se suma el monto, no se cuenta.
    'ingresos_por_tipo', coalesce((
      select jsonb_agg(t order by t.valor desc, t.clave)
        from (
          select case when b.tipo_atencion = 'procedimiento'
                       then 'Procedimientos' else 'Consultas' end as clave,
                 round(sum(coalesce(b.monto, 0)))::int as valor
            from public.bonos_atencion b
           group by 1
           order by 2 desc, 1
        ) t
    ), '[]'::jsonb),

    -- Diagnosticos mas comunes: solo administrador. Ver cabecera.
    'top_diagnosticos', case when v_es_admin then coalesce((
      select jsonb_agg(t order by t.valor desc, t.clave)
        from (
          select nullif(btrim(f.diagnostico), '') as clave,
                 count(*)::int as valor
            from public.fichas_medicas f
           where f.diagnostico is not null
             and btrim(f.diagnostico) <> ''
           group by 1
           order by 2 desc, 1
           limit 5
        ) t
    ), '[]'::jsonb) else '[]'::jsonb end,

    -- La UI necesita saber si puede pintar esa tarjeta.
    'puede_ver_diagnosticos', v_es_admin
  );

  return v_result;
end;
$$;

comment on function public.fn_rem_resumen() is
  'SWIMyti: agregados del Resumen Estadistico Mensual. Calcula en la BD para no bajar diagnosticos al navegador (Ley 19.628). Solo jefatura y administracion; el ranking de diagnosticos es exclusivo de administracion.';

-- Permisos: revoke de PUBLIC y de anon. Se revoca de los DOS porque una
-- migracion anterior demostro que con uno solo el permiso igual queda abierto.
revoke execute on function public.fn_rem_resumen() from public, anon;
grant execute on function public.fn_rem_resumen() to authenticated, service_role;
