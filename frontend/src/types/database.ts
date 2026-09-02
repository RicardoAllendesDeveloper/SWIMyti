export type Paciente = {
  id_paciente: number
  rut: string
  nombres: string
  apellidos: string
  telefono?: string | null
  email?: string | null
  direccion?: string | null
  activo?: boolean
}

export type UsuarioResumen = {
  nombres: string
  apellidos: string
  email?: string | null
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
  estado: 'disponible' | 'reservada' | 'cancelada' | 'completada'
  created_at?: string
  usuarios?: UsuarioResumen | null
  especialidades?: Pick<Especialidad, 'nombre'> | Pick<Especialidad, 'nombre'>[] | null
}

export type Cita = {
  id_cita: number
  id_horario: number
  id_paciente: number
  motivo?: string | null
  estado: 'disponible' | 'reservada' | 'cancelada' | 'completada'
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
  id_ficha: number
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
  monto?: number | null
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
