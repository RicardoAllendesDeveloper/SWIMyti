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
  ],
  doctor: ['fichas', 'disponibilidad', 'interconsultas', 'recetas', 'calculos', 'rem'],
  enfermeria: ['fichas', 'disponibilidad', 'interconsultas', 'calculos', 'rem'],
  administrativo: ['pacientes', 'citas', 'interconsultas', 'bonos', 'finanzas'],
  /**
   * Jefatura sin rol clínico asociado: coordina agenda y datos de pacientes.
   * Una jefatura de enfermería o medicina además hereda los módulos de su
   * rol clínico, porque la navegación usa la unión de todos sus roles.
   */
  jefatura: ['pacientes', 'disponibilidad', 'citas', 'interconsultas'],
  unidad_apoyo: ['pacientes', 'bandeja_ordenes'],
  paciente: ['portal', 'citas', 'interconsultas'],
}

export function tieneModulo(rol: RolUsuario, modulo: Modulo): boolean {
  if (!rol) return false
  return MODULOS_POR_ROL[rol].includes(modulo)
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