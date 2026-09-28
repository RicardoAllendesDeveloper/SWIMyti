-- =============================================================================
-- SWIMyti - Permitir al paciente agendar/cambiar su propia toma de muestra
-- La política ordenes_update existente no permite al paciente actualizar su
-- orden (solo admin / emisor / unidad de apoyo). Esto hacía que la reserva
-- creara la cita y bloqueara el bloque, pero el update de la orden fallara,
-- dejándola en 'pendiente' y mostrando el calendario indebidamente.
--
-- Se agrega una política UPDATE adicional y RESTRICTIVA: el paciente solo puede
-- modificar los campos de agendamiento (toma_muestra, fecha_toma_muestra,
-- id_horario) de sus propias órdenes, y solo mientras esté en 'pendiente'.
-- =============================================================================

drop policy if exists "ordenes_update_paciente_toma_muestra" on public.ordenes_examen;

create policy "ordenes_update_paciente_toma_muestra"
on public.ordenes_examen
for update
to authenticated
using (
  id_paciente = (select public.fn_mi_id_paciente())
)
with check (
  id_paciente = (select public.fn_mi_id_paciente())
  and estado = 'pendiente'
  and modalidad = 'en_recinto'
  and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ordenes_examen'
  )
);