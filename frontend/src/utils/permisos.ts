import type { RolUsuario } from '../context/AuthRolContext'

const ROLES_CLINICOS = ['administrador', 'doctor', 'enfermeria'] as const
const ROLES_STAFF = [
  'administrador',
  'doctor',
  'enfermeria',
  'administrativo',
  'unidad_apoyo',
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

/** Roles que pueden crear enmiendas (RLS: fn_puede_enmendar) */
export function puedeEnmendar(rol: RolUsuario): boolean {
  return rol === 'administrador' || rol === 'doctor'
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

/** Roles que pueden solicitar interconsultas (enfermería/admin) */
export function puedeSolicitarInterconsulta(rol: RolUsuario): boolean {
  return rol === 'enfermeria' || rol === 'administrador'
}

export const NOMBRE_ROL: Record<NonNullable<RolUsuario>, string> = {
  administrador: 'Administrador',
  doctor: 'Doctor(a)',
  enfermeria: 'Enfermería',
  administrativo: 'Administrativo(a)',
  unidad_apoyo: 'Unidad de Apoyo',
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

/**
 * Módulos visibles por rol. Controla la navegación (sidebar) y las rutas.
 * Los roles ven únicamente lo que les corresponde según el modelo de gestión.
 */
export const MODULOS_POR_ROL: Record<NonNullable<RolUsuario>, Modulo[]> = {
  administrador: [
    'fichas',
    'pacientes',
    'disponibilidad',
    'citas',
    'interconsultas',
    'bonos',
    'finanzas',
    'recetas',
    'usuarios',
  ],
  doctor: ['fichas', 'pacientes', 'disponibilidad', 'interconsultas', 'recetas'],
  enfermeria: ['fichas', 'pacientes', 'citas', 'interconsultas'],
  administrativo: ['fichas', 'pacientes', 'citas', 'interconsultas', 'bonos', 'finanzas'],
  unidad_apoyo: ['fichas', 'pacientes'],
  paciente: ['portal', 'citas', 'interconsultas'],
}

export function tieneModulo(rol: RolUsuario, modulo: Modulo): boolean {
  if (!rol) return false
  return MODULOS_POR_ROL[rol].includes(modulo)
}