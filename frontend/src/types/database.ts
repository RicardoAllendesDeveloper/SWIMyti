export type Paciente = {
  id_paciente: number
  rut: string
  nombres: string
  apellidos: string
  prevision?: string | null
  telefono?: string | null
  email?: string | null
  direccion?: string | null
  activo?: boolean
}

export type UsuarioResumen = {
  nombres: string
  apellidos: string
  email?: string | null
  roles?: { nombre_rol?: string } | { nombre_rol?: string }[] | null
}

export type FichaMedica = {
  id_ficha: number
  id_paciente: number
  id_usuario_creador: string
  motivo_consulta: string
  anamnesis?: string | null
  examen_fisico?: string | null
  diagnostico: string
  plan_tratamiento?: string | null
  observaciones?: string | null
  created_at: string
  firma_digital_hash?: string
  pacientes?: Pick<Paciente, 'nombres' | 'apellidos' | 'rut'> | null
  usuarios?: UsuarioResumen | null
}

export type EnmiendaAuditoria = {
  id_enmienda: number
  id_ficha: number
  id_usuario_autor: string
  campo_corregido: string
  valor_anterior: string | null
  correccion_justificada: string
  firma_digital_hash: string
  created_at: string
  usuarios?: UsuarioResumen | null
}

export type Especialidad = {
  id_especialidad: number
  nombre: string
  descripcion?: string | null
  activo?: boolean
}

export type HorarioDisponible = {
  id_horario: number
  id_profesional: string
  id_especialidad?: number | null
  fecha_inicio: string
  fecha_fin: string
  /**
   * `bloqueada` es el estado que la jefatura deja una hora cuando el
   * profesional no attends. No es un estado de cita: una cita apoyada en una
   * hora bloqueada pasa a `cancelada`. Ver migración 20261001150100.
   */
  estado: 'disponible' | 'reservada' | 'cancelada' | 'completada' | 'bloqueada'
    motivo_bloqueo?: string | null
    id_motivo_bloqueo?: number | null
    bloqueado_por?: string | null
    bloqueado_at?: string | null
  created_at?: string
  usuarios?: UsuarioResumen | null
  especialidades?: Pick<Especialidad, 'nombre'> | Pick<Especialidad, 'nombre'>[] | null
}

/**
 * Catálogo de motivos de bloqueo de horas. El `tipo` no es decorativo: es lo
 * que decide si bloquear sin cobertura se rechaza (planificado) o se permite
 * con advertencia (sobrevenido), y lo que después necesita RRHH para licencias,
 * libres administrativos y vacaciones.
 */
export type MotivoBloqueo = {
  id_motivo: number
  nombre: string
  tipo: 'planificado' | 'sobrevenido'
  requiere_detalle: boolean
  activo?: boolean
}

/**
 * Atención clínica: el ACTO realizado, no su registro clínico.
 *
 * No se confunde con la ficha. La ficha (`fichas_medicas`) es el contenido
 * clínico y es append-only bajo la Ley 19.628. La atención es el hecho
 * verificable de que se atendió a alguien, con qué bono y a nombre de qué
 * profesional. Son cosas distintas y por eso viven en tablas distintas.
 *
 * Las cuatro referencias son NOT NULL en la base: no existe una atención sin
 * cita ni sin bono. Eso lo garantiza el esquema, no el formulario.
 */
export type EstadoAtencion = 'realizada' | 'anulada'

export type Atencion = {
  id_atencion: number
  id_cita: number
  id_bono: number
  /** El que UCÓ, no el que creó el registro. La BD lo contrasta con el bloque de la cita. */
  id_profesional: string
  id_paciente: number
  id_especialidad?: number | null
  fecha_atencion: string
  estado: EstadoAtencion
  /** Obligatorio si `estado` es 'anulada'. Una atención no se borra: se anula y se explica. */
  motivo_anulacion?: string | null
  created_at?: string
  updated_at?: string
}

export type Cita = {
  id_cita: number
  id_horario: number
  id_paciente: number
  motivo?: string | null
  estado: 'disponible' | 'reservada' | 'cancelada' | 'completada'
  /** Lo llena el bloqueo de horas de la jefatura; la liberación del paciente lo deja nulo. */
  motivo_cancelacion?: string | null
  llegada?: 'pendiente' | 'en_sala' | 'no_llego' | 'tarde'
  created_at?: string
  horarios_disponibles?: {
    fecha_inicio: string
    fecha_fin: string
    id_profesional: string
    usuarios?: UsuarioResumen | UsuarioResumen[] | null
    especialidades?: Pick<Especialidad, 'nombre'> | Pick<Especialidad, 'nombre'>[] | null
  } | null
}

export type AnexoClinico = {
  id_anexo: number
  id_ficha?: number | null
  id_paciente?: number | null
  id_usuario_subida: string
  nombre_archivo: string
  tipo_mime?: string | null
  url_documento: string
  descripcion?: string | null
  tipo_anexo?: string | null
  created_at: string
}

export type Interconsulta = {
  id_interconsulta: number
  id_paciente: number
  id_solicitante: string
  id_profesional?: string | null
  especialidad?: string | null
  motivo: string
  estado: 'pendiente' | 'confirmada' | 'rechazada' | 'atendida' | 'cancelada'
  confirmada_por?: string | null
  respuesta?: string | null
  created_at: string
  updated_at?: string
  pacientes?: Pick<Paciente, 'nombres' | 'apellidos' | 'rut'> | null
  solicitante?: UsuarioResumen | UsuarioResumen[] | null
  profesional?: UsuarioResumen | UsuarioResumen[] | null
}

export type BonoAtencion = {
  id_bono: number
  id_paciente: number
  sistema_prevision: string
  tipo_atencion?: 'consulta' | 'procedimiento'
  monto: number
  estado: 'pendiente' | 'emitido' | 'anulado'
  fecha_emision: string
  detalle?: string | null
  pacientes?: Pick<Paciente, 'nombres' | 'apellidos' | 'rut'> | null
}

export type PartidaPresupuesto = {
  id_partida: number
  tipo: 'ingreso' | 'egreso'
  concepto: string
  monto: number
  periodo: string
  descripcion?: string | null
}

export type RecetaMedica = {
  id_receta: number
  id_paciente: number
  id_usuario_emisor: string
  medicamentos: string
  indicaciones?: string | null
  fecha_emision: string
}

export type CertificadoClinico = {
  id_certificado: number
  id_paciente: number
  id_usuario_emisor: string
  tipo_certificado: string
  detalle?: string | null
  fecha_emision: string
}

export type OrdenExamen = {
  id_orden: number
  id_paciente: number
  id_usuario_emisor: string
  tipo_examen: string
  indicaciones?: string | null
  enviada_a_apoyo: boolean
  modalidad: 'en_recinto' | 'otro_recinto'
  toma_muestra: 'pendiente' | 'agendada' | 'realizada'
  fecha_toma_muestra?: string | null
  id_horario?: number | null
  estado: 'pendiente' | 'en_proceso' | 'completada' | 'cancelada'
  created_at: string
  pacientes?: Pick<Paciente, 'nombres' | 'apellidos' | 'rut'> | null
}
