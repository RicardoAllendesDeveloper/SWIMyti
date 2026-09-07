-- =============================================================================
-- SWIMyti - Bonos de atención: tipo de atención, monto obligatorio e ingreso
-- automático a Finanzas
-- El administrativo cobra la atención y genera el bono. El monto es obligatorio
-- (según cobertura de salud) y el bono distingue consulta vs procedimiento.
-- Al emitirse un bono (estado 'emitido'), se registra automáticamente la partida
-- de ingreso en partidas_presupuesto, conectando Finanzas con los bonos.
-- =============================================================================

-- ---------- Estructura ----------
alter table public.bonos_atencion
  add column if not exists tipo_atencion text not null default 'consulta'
  check (tipo_atencion in ('consulta', 'procedimiento'));

-- El monto pasa a ser obligatorio (cobertura de salud = valor de la atención).
alter table public.bonos_atencion
  alter column monto set not null;

-- ---------- Trigger: bono emitido genera ingreso en Finanzas ----------
create or replace function public.fn_bono_genera_ingreso()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.estado = 'emitido' and new.monto is not null then
    insert into public.partidas_presupuesto (
      tipo,
      concepto,
      monto,
      periodo,
      descripcion
    )
    values (
      'ingreso',
      'Bono de atención #' || new.id_bono ||
        case when new.tipo_atencion = 'procedimiento' then ' (procedimiento)' else '' end,
      new.monto,
      to_char(new.fecha_emision, 'YYYY-MM'),
      'Ingreso automático generado por el bono de atención del paciente.'
    )
    on conflict do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_bonos_genera_ingreso on public.bonos_atencion;
create trigger trg_bonos_genera_ingreso
  after insert on public.bonos_atencion
  for each row
  execute function public.fn_bono_genera_ingreso();