import type { RolConocido, RolUsuario } from '../context/AuthRolContext'

const ROLES_CLINICOS = ['doctor', 'enfermeria'] as const
const ROLES_STAFF = [
  'administrador',
  'doctor',
  'enfermeria',
  'administrativo',
  'unidad_apoyo',
  'jefatura',
] as const

export function esPersonalClinico(rol: RolUsuario): boolean {
  return ROLES_CLINICOS.some((r) => r === rol)
}

export function esStaff(rol: RolUsuario): boolean {
  return ROLES_STAFF.some((r) => r === rol)
}

export function esAdmin(rol: RolUsuario): boolean {
  return rol === 'administrador'
}

/** Roles que pueden crear fichas médicas (RLS: fn_puede_crear_ficha) */
export function puedeCrearFicha(rol: RolUsuario): boolean {
  return ROLES_CLINICOS.some((r) => r === rol)
}

/** Roles que pueden crear enmiendas (RLS: fn_puede_enmendar — solo doctor) */
export function puedeEnmendar(rol: RolUsuario): boolean {
  return rol === 'doctor'
}

/** Roles que pueden registrar pacientes (RLS: admin o administrativo) */
export function puedeRegistrarPaciente(rol: RolUsuario): boolean {
  return rol === 'administrador' || rol === 'administrativo'
}

/** Roles que pueden ver el módulo de usuarios (solo admin) */
export function puedeGestionarUsuarios(rol: RolUsuario): boolean {
  return rol === 'administrador'
}

/** Roles que pueden reservar/cancelar citas (paciente sobre su cuenta; admin/administrativo gestionan) */
export function puedeReservar(rol: RolUsuario): boolean {
  return rol === 'paciente' || rol === 'administrador' || rol === 'administrativo'
}

/** Roles que pueden gestionar citas de todos los pacientes (administrativo/admin) */
export function puedeGestionarCitas(rol: RolUsuario): boolean {
  return rol === 'administrador' || rol === 'administrativo'
}

/** Roles que pueden solicitar interconsultas (enfermería/administrativo/admin) */
export function puedeSolicitarInterconsulta(rol: RolUsuario): boolean {
  return (
    rol === 'enfermeria' ||
    rol === 'administrativo' ||
    rol === 'administrador'
  )
}

/** Roles que pueden subir anexos clínicos (unidad de apoyo + personal clínico) */
export function puedeSubirAnexo(rol: RolUsuario): boolean {
  return (
    rol === 'unidad_apoyo' ||
    rol === 'administrador' ||
    rol === 'doctor' ||
    rol === 'enfermeria'
  )
}

export const NOMBRE_ROL: Record<NonNullable<RolUsuario>, string> = {
  administrador: 'Administrador',
  doctor: 'Doctor(a)',
  enfermeria: 'Enfermería',
  administrativo: 'Administrativo(a)',
  unidad_apoyo: 'Unidad de Apoyo',
  jefatura: 'Jefatura',
  paciente: 'Paciente',
}

export type Modulo =
  | 'fichas'
  | 'pacientes'
  | 'enmiendas'
  | 'disponibilidad'
  | 'citas'
  | 'usuarios'
  | 'portal'
  | 'interconsultas'
  | 'bonos'
  | 'finanzas'
  | 'recetas'
  | 'calculos'
  | 'rem'
  | 'bandeja_ordenes'
  | 'config_recinto'

/**
 * Módulos visibles por rol. Controla la navegación (sidebar) y las rutas.
 * Los roles ven únicamente lo que les corresponde según el modelo de gestión.
 */
export const MODULOS_POR_ROL: Record<NonNullable<RolUsuario>, Modulo[]> = {
  administrador: [
    'pacientes',
    'disponibilidad',
    'citas',
    'interconsultas',
    'bonos',
    'finanzas',
    'usuarios',
    'config_recinto',
    'rem',
  ],
  doctor: ['fichas', 'disponibilidad', 'interconsultas', 'recetas', 'calculos'],
  enfermeria: ['fichas', 'disponibilidad', 'interconsultas', 'calculos'],
  administrativo: ['pacientes', 'citas', 'interconsultas', 'bonos', 'finanzas'],
  /**
   * Jefatura sin rol clínico asociado: coordina agenda y datos de pacientes.
   * Una jefatura de enfermería o medicina además hereda los módulos de su
   * rol clínico, porque la navegación usa la unión de todos sus roles.
   * `rem` es el Resumen Estadístico Mensual: informe de jefatura, no un
   * documento de enfermería como estaba antes mal clasificado.
   */
  jefatura: ['pacientes', 'disponibilidad', 'citas', 'interconsultas', 'rem'],
  unidad_apoyo: ['pacientes', 'bandeja_ordenes'],
  paciente: ['portal', 'citas', 'interconsultas'],
}

export function tieneModulo(rol: RolUsuario, modulo: Modulo): boolean {
  if (!rol) return false
  // Optional chaining a proposito: si la BD devuelve un rol que no esta en el
  // mapa (rol nuevo, typo, cache viejo), la navegacion se oculta en vez de
  // romper la pagina completa.
  return MODULOS_POR_ROL[rol]?.includes(modulo) ?? false
}

/** ¿Alguno de los roles acumulados habilita el módulo? */
export function tieneModuloConRoles(roles: RolConocido[], modulo: Modulo): boolean {
  return roles.some((r) => tieneModulo(r, modulo))
}

/** ¿El usuario acumula alguno de estos roles? */
export function tieneAlguno(roles: RolConocido[], objetivo: RolConocido[]): boolean {
  return roles.some((r) => objetivo.includes(r))
}

/**
 * Fila de `usuario_roles` tal como la devuelve PostgREST. Cada fila es UN rol,
 * con `es_principal` marcando cuál manda. La relación `roles` viene como
 * objeto pero el tipo generado la modela como arreglo, así que se normaliza.
 */
export type FilaRol = {
  es_principal?: boolean | null
  roles?:
    | { nombre_rol?: string | null }
    | { nombre_rol?: string | null }[]
    | null
}

function nombreRolDe(fila: FilaRol): RolConocido | null {
  const rel = fila.roles
  const arr = Array.isArray(rel) ? rel : rel ? [rel] : []
  const nombre = arr[0]?.nombre_rol
  return (nombre as RolConocido | null) ?? null
}

/**
 * Agrega los roles de TODAS las filas de `usuario_roles`, con el principal
 * primero y sin duplicados.
 *
 * Esto vive aparte del provider porque es lógica pura y se puede testear. El
 * bug que motivó extraerlo: el provider tomaba `filas[0]` y procesaba una sola
 * fila, así que un profesional con enfermería + jefatura recibía un único rol
 * — y cuál de los dos dependía del orden de PostgREST, que no está garantizado.
 * El sidebar ocultaba medio menú y el usuario caía en "sin permisos".
 */
export function agregarRoles(filas: FilaRol[]): RolConocido[] {
  const principal: RolConocido[] = []
  const resto: RolConocido[] = []

  for (const fila of filas) {
    const nombre = nombreRolDe(fila)
    if (!nombre) continue
    if (fila.es_principal) principal.push(nombre)
    else resto.push(nombre)
  }

  return [...new Set([...principal, ...resto])]
}

/** El rol que define el home y el rótulo: el marcado `es_principal`. */
export function rolPrincipal(filas: FilaRol[]): RolConocido | null {
  return agregarRoles(filas)[0] ?? null
}

/**
 * Ruta inicial (home) natural por rol, usada tras el login y como fallback
 * cuando un rol no tiene permitido un módulo. Los roles no clínicos ya no
 * aterrizan en /dashboard (fichas clínicas), sino en su módulo principal.
 */
export function homeRol(rol: RolUsuario): string {
  switch (rol) {
    case 'paciente':
      return '/portal'
    case 'administrativo':
      return '/citas'
    case 'unidad_apoyo':
      return '/bandeja-ordenes'
    case 'administrador':
      return '/usuarios'
    case 'jefatura':
      // Su módulo propio es la agenda que coordina.
      return '/disponibilidad'
    default:
      // doctor, enfermeria -> fichas clínicas
      return '/dashboard'
  }
}