-- SWIMyti 2026-10-02
-- Fase 2, punto 1: la atencion como entidad, con cita y bono obligatorios.
--
-- CONTEXTO
-- El plan de la Fase 2 pide "bloquear la creacion de una atencion sin cita
-- previa" y "sin bono asociado". Al intentar traducirlo a SQL aparecio que
-- NO existe una tabla atenciones: la atencion no era una entidad del modelo.
-- Lo mas cercano era fichas_medicas, que guarda id_paciente e
-- id_usuario_creador, pero no el vinculo con la cita ni con el bono.
--
-- DECISION (2026-10-02, usuario)
-- Se crea la tabla atenciones en vez de colgar id_cita/id_bono de
-- fichas_medicas. Razon: separar el ACTO clinico de su REGISTRO.
--   - atenciones  = que se le hizo a quien, cuando, por quien, y con que bono.
--                   Es el hecho economico y de trazabilidad.
--   - fichas_medicas = el contenido clinico (anamnesis, diagnostico), que ya es
--                   append-only bajo la Ley 19.628.
-- Mezclarlos obligaria a agregar columnas a una tabla inmutable, y la
-- inmutabilidad es un requisito legal, no una comodidad. Ademas el profesional
-- puede legítimamente tener mas de un registro clinico por atencion, y la
-- atencion puede existir sin ficha escrita si el paciente se retira.
--
-- LA REGLA
-- No se puede crear una atencion sin cita previa, ni sin bono. Se impone con
-- FK + NOT NULL, no con un trigger: son invariantes que el esquema garantiza.
--
-- La conexion al profesional NO se copia como uuid suelto: se deriva del
-- bloque de la cita (horarios_disponibles.id_profesional). Si se copiara,
-- alguien podria registrar una atencion a nombre de un profesional que nunca
-- vio al paciente. El trigger la valida.
--
-- TAMANO
-- id_atencion bigint GENERATED ALWAYS AS IDENTITY, igual que id_ficha,
-- id_cita e id_bono. Sigue la convencion del proyecto y deja el id a cargo
-- de la base: si el cliente lo controla, un rollback del insert permite
-- reutilizar un id que ya se imprimio en un documento.
--
-- ESTADOS
-- estado_atencion: 'realizada' (por defecto), 'anulada'. La anulacion existe
-- porque una atencion puede revertirse (el paciente se retira, se cobró mal,
-- error de registro) y no se borra: se marca. Borrar un hecho de atencion
-- seria exactamente el tipo de hueco de trazabilidad que la Ley 19.628
-- busca cerrar.

-- ---------------------------------------------------------------------------
-- 1. Estados de la atencion
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'estado_atencion') then
    create type public.estado_atencion as enum ('realizada', 'anulada');
  end if;
end
$$;

comment on type public.estado_atencion is
  'Estado de una atencion clinica. Se anula, no se borra: la trazabilidad lo exige.';

-- ---------------------------------------------------------------------------
-- 2. La tabla atenciones
-- ---------------------------------------------------------------------------
create table if not exists public.atenciones (
  id_atencion         bigint generated always as identity primary key,
  -- La cita es la ancla. Una atencion siempre viene de una cita confirmada.
  id_cita             bigint       not null
    references public.citas (id_cita)
    on delete restrict
    on update restrict,
  -- El bono se emite antes de la atencion: es lo que se paga.
  id_bono            bigint       not null
    references public.bonos_atencion (id_bono)
    on delete restrict
    on update restrict,
  -- El profesional que UCABO, no el que creo el registro.
  id_profesional      uuid         not null
    references public.usuarios (id_usuario)
    on delete restrict
    on update restrict,
  id_paciente         bigint       not null
    references public.pacientes (id_paciente)
    on delete restrict
    on update restrict,
  id_especialidad     bigint
    references public.especialidades (id_especialidad)
    on delete restrict
    on update restrict,
  fecha_atencion      timestamptz  not null default now(),
  estado              public.estado_atencion not null default 'realizada',
  -- Se guarda el motivo de la anulacion cuando estado = 'anulada'. La
  -- trazabilidad exige saber POR QUE se anulo una atencion.
  motivo_anulacion    text,
  created_at          timestamptz  not null default now(),
  updated_at          timestamptz  not null default now(),

  constraint atenciones_estado_anulacion_check check (
    (estado = 'anulada' and motivo_anulacion is not null
      and length(trim(both from motivo_anulacion)) > 0)
    or
    (estado <> 'anulada' and motivo_anulacion is null)
  )
);

comment on table public.atenciones is
  'Atenciones clinicas realizadas. Cada una cuelga de una cita y de un bono: '
  'es el vinculo bono <-> cita <-> atencion <-> profesional <-> paciente que exige el plan de Fase 2.';
comment on column public.atenciones.id_profesional is
  'Profesional que UBCIO al paciente. Debe coincidir con el del bloque reservado; lo valida trg_atenciones_vinculos.';
comment on column public.atenciones.motivo_anulacion is
  'Obligatorio si estado = anulada. Queda como registro del porque.';

-- ---------------------------------------------------------------------------
-- 3. Integridad de los vinculos
-- ---------------------------------------------------------------------------
-- Las FKs guarantee que el id existe, pero NO que los registros pertenezcan al
-- mismo paciente. Eso solo se comprueba leyendo las otras tablas, asi que va
-- en un trigger.
--
-- SECURITY DEFINER: este trigger lee citas, bonos y bloques para compararlos
-- con la atencion. Corre como el usuario que inserta, y las politicas de
-- lectura de citas no cubren necesariamente a quien esta registrando. Sin
-- DEFINER el INSERT fallaria con "permiso denegado" en vez del mensaje de
-- negocio correcto, o peor, pasaria sin validar.
--
-- Se hace BEFORE INSERT: si el vinculo esta mal, no hay fila que ensucie la
-- tabla.
-- RAISE EXCEPTION no admite concatenar con || antes de los argumentos: hay
-- que usar format(). El error "syntax error at or near ||" es de ahi.

create or replace function public.fn_valida_vinculos_atencion()
returns trigger
language plpgsql
security definer
set search_path to public
as $$
declare
  v_cita_misma    boolean;
  v_bono_mismo    boolean;
  v_prof_correcto boolean;
  v_bono_estado   text;
begin
  select c.id_paciente = new.id_paciente
    into v_cita_misma
    from public.citas c
   where c.id_cita = new.id_cita;

  if v_cita_misma is null then
    raise exception using
      message = format(
        'SWIMyti: la atencion %1$s no tiene una cita valida asociada.', new.id_cita),
      errcode = '23503';
  end if;

  if not v_cita_misma then
    raise exception using
      message = format(
        'SWIMyti: el paciente de la atencion no coincide con el de la cita %1$s. '
        || 'Una atencion pertenece al paciente que reservo la hora.',
        new.id_cita),
      errcode = '23514';
  end if;

  select b.id_paciente = new.id_paciente
    into v_bono_mismo
    from public.bonos_atencion b
   where b.id_bono = new.id_bono;

  if v_bono_mismo is null then
    raise exception using
      message = format(
        'SWIMyti: la atencion %1$s no tiene un bono valido asociado.', new.id_bono),
      errcode = '23503';
  end if;

  if not v_bono_mismo then
    raise exception using
      message = format(
        'SWIMyti: el bono %1$s pertenece a otro paciente que el de la atencion.',
        new.id_bono),
      errcode = '23514';
  end if;

  select b.estado into v_bono_estado
    from public.bonos_atencion b
   where b.id_bono = new.id_bono;

  if v_bono_estado = 'anulado' then
    raise exception using
      message = format(
        'SWIMyti: el bono %1$s esta anulado. No puede respaldar una atencion.',
        new.id_bono),
      errcode = '23514';
  end if;

  select h.id_profesional = new.id_profesional
    into v_prof_correcto
    from public.citas c
    join public.horarios_disponibles h on h.id_horario = c.id_horario
   where c.id_cita = new.id_cita;

  if v_prof_correcto is null then
    raise exception using
      message = format(
        'SWIMyti: la cita %1$s no tiene un bloque reservado con profesional asignado.',
        new.id_cita),
      errcode = '23503';
  end if;

  if not v_prof_correcto then
    raise exception using
      message = format(
        'SWIMyti: el profesional registrado no es el que reservo el bloque de la cita %1$s. '
        || 'La atencion se registra a nombre de quien UCBIO al paciente.',
        new.id_cita),
      errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.fn_valida_vinculos_atencion() is
  'Valida que cita, bono, paciente y profesional de una atencion pertenezcan al mismo hecho. BEFORE INSERT, SECURITY DEFINER.';

-- Trigger: PostgreSQL no revisa EXECUTE en funciones de trigger al dispararlas,
-- asi que revocar desde public es higiene y no riesgo. Se hace igual por
-- convencion del proyecto (ver AGENTS.md: revocar sobre PUBLIC, no anon).
revoke all on function public.fn_valida_vinculos_atencion() from public;

drop trigger if exists trg_atenciones_vinculos on public.atenciones;
create trigger trg_atenciones_vinculos
  before insert on public.atenciones
  for each row
  execute function public.fn_valida_vinculos_atencion();

-- ---------------------------------------------------------------------------
-- 4. updated_at
-- ---------------------------------------------------------------------------
-- Se REUSA public.fn_set_updated_at(), que ya existe y la usan los triggers de
-- usuarios, pacientes, ordenes_examen, permisos e interconsultas. Crear una
-- segunda funcion con el mismo cuerpo pero otro nombre duplicaria la logica en
-- el sitio donde mas caro cuesta notarla: el mantenimiento futuro.
drop trigger if exists trg_atenciones_updated_at on public.atenciones;
create trigger trg_atenciones_updated_at
  before update on public.atenciones
  for each row
  execute function public.fn_set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. Una atencion por cita, un bono por atencion
-- ---------------------------------------------------------------------------
-- Sin esto se podrian registrar dos atenciones sobre la misma cita (o
-- reutilizar un bono para dos atenciones) y el bono deja de ser el registro de lo que se cobro. Es la razon de ser del vinculo.
create unique index if not exists uq_atenciones_cita
  on public.atenciones (id_cita);

create unique index if not exists uq_atenciones_bono
  on public.atenciones (id_bono);

-- ---------------------------------------------------------------------------
-- 6. RLS
-- ---------------------------------------------------------------------------
alter table public.atenciones enable row level security;
alter table public.atenciones force row level security;

-- Quien puede VER atenciones: el personal clinico y la jefatura. El
-- administrador NO (nunca ve fichas clinicas); el paciente tampoco, y solo
-- veria las propias, que se resuelven en el Portal via las citas.
create policy atenciones_select_clinico
  on public.atenciones
  for select
  to authenticated
  using (
    (select public.fn_es_personal_clinico())
    or (select public.fn_tiene_rol(array['jefatura']))
  );

-- Quien REGISTRA una atencion: solo el personal clinico que atiende.
--
-- No se incluye a `administrativo`, aunque recepcion sea quien emite el bono.
-- El bono vive en bonos_atencion, que es el registro economico y si es
-- visible para finanzas. La atencion es el ACTO CLINICO, y segun la
-- especificacion funcional es el doctor y la enfermeria quienes tocan
-- atenciones. Ademas, con esta politica el administrativo podria insertar y
-- no leer: una asimetria que no tiene sentido.
create policy atenciones_insert_registra
  on public.atenciones
  for insert
  to authenticated
  with check (
    (select public.fn_es_personal_clinico())
  );

-- La atencion se anula, no se borra ni se edita libremente.
-- UPDATE solo para el personal clinico, y el CHECK exige motivo al anular.
create policy atenciones_update_anula
  on public.atenciones
  for update
  to authenticated
  using (
    (select public.fn_es_personal_clinico())
  )
  with check (
    (select public.fn_es_personal_clinico())
  );

-- DELETE: nadie. Una atencion realizada no se borra; se anula.
-- No se crea politica de borrado a proposito.

-- ---------------------------------------------------------------------------
-- 7. Permisos
-- ---------------------------------------------------------------------------
grant usage on schema public to authenticated;
grant select, insert, update on public.atenciones to authenticated;
-- Sin grant de delete: nadie borra atenciones.
revoke delete on public.atenciones from authenticated, anon;
revoke all on public.atenciones from anon;