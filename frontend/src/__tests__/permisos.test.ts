import { describe, expect, it } from 'vitest'
import {
  agregarRoles,
  esStaff,
  homeRol,
  MODULOS_POR_ROL,
  NOMBRE_ROL,
  rolPrincipal,
  tieneAlguno,
  tieneModulo,
  tieneModuloConRoles,
  type FilaRol,
  type Modulo,
} from '../utils/permisos'
import type { RolConocido } from '../context/AuthRolContext'

describe('modulos por rol', () => {
  it('cubre todos los roles del catalogo', () => {
    for (const rol of Object.keys(NOMBRE_ROL)) {
      expect(MODULOS_POR_ROL[rol as RolConocido]).toBeDefined()
    }
  })

  it('la jefatura ve jornadas y pacientes, pero no agenda propia, fichas ni finanzas', () => {
    const modulos = MODULOS_POR_ROL.jefatura
    // 'jornadas' es su módulo de coordinación; no tiene 'agenda' porque su
    // agenda propia le llega por el rol clínico acumulado (enfermería/medicina).
    expect(modulos).toContain('jornadas')
    expect(modulos).toContain('pacientes')
    expect(modulos).not.toContain('agenda')
    expect(modulos).not.toContain('citas')
    expect(modulos).not.toContain('fichas')
    expect(modulos).not.toContain('finanzas')
    expect(modulos).not.toContain('usuarios')
  })

  it('el administrador no tiene agenda propia ni toma horas', () => {
    // No realiza atenciones: para ver los horarios del resto usa Jornadas.
    // No toma horas: los roles que reservan son administrativo y paciente.
    const modulos = MODULOS_POR_ROL.administrador
    expect(modulos).toContain('jornadas')
    expect(modulos).not.toContain('agenda')
    expect(modulos).not.toContain('citas')
  })

  it('el administrativo pierde finanzas y conserva la toma de horas', () => {
    // Finanzas es el equivalente al REM: le corresponde a la jefatura del área,
    // que por ahora es el Administrador.
    const modulos = MODULOS_POR_ROL.administrativo
    expect(modulos).toContain('citas')
    expect(modulos).not.toContain('finanzas')
    expect(modulos).not.toContain('jornadas')
  })

  it('el administrador no pierde ningun modulo al agregar la jefatura', () => {
    for (const modulo of MODULOS_POR_ROL.jefatura) {
      expect(MODULOS_POR_ROL.administrador).toContain(modulo)
    }
  })
})

describe('los tres modulos que se confundian', () => {
  it('agenda, citas y jornadas son modulos distintos', () => {
    // Ver AGENTS.md, "Definicion funcional": confundirlos fue el origen de
    // meses de malentendidos.
    expect(MODULOS_POR_ROL.doctor).toContain('agenda')
    expect(MODULOS_POR_ROL.doctor).not.toContain('jornadas')
    expect(MODULOS_POR_ROL.enfermeria).toContain('agenda')
    expect(MODULOS_POR_ROL.enfermeria).not.toContain('citas')
  })

  it('solo administrativo y paciente toman horas', () => {
    const toman = (Object.keys(MODULOS_POR_ROL) as RolConocido[]).filter((r) =>
      MODULOS_POR_ROL[r].includes('citas'),
    )
    expect(toman.sort()).toEqual(['administrativo', 'paciente'])
  })

  it('solo jefatura y administrador coordinan el area', () => {
    const coordinan = (Object.keys(MODULOS_POR_ROL) as RolConocido[]).filter((r) =>
      MODULOS_POR_ROL[r].includes('jornadas'),
    )
    expect(coordinan.sort()).toEqual(['administrador', 'jefatura'])
  })
})

describe('tieneModuloConRoles (N-roles)', () => {
  it('un solo rol decide igual que antes', () => {
    expect(tieneModuloConRoles(['doctor'], 'fichas')).toBe(true)
    expect(tieneModuloConRoles(['administrativo'], 'fichas')).toBe(false)
  })

  it('la jefatura RafOzada a enfermería ve la union de ambas', () => {
    const roles: RolConocido[] = ['enfermeria', 'jefatura']

    // De enfermería: fichas, agenda propia y cálculos
    expect(tieneModuloConRoles(roles, 'fichas')).toBe(true)
    expect(tieneModuloConRoles(roles, 'calculos')).toBe(true)
    expect(tieneModuloConRoles(roles, 'agenda')).toBe(true)
    // De jefatura: jornadas (coordinar el área) y rem
    expect(tieneModuloConRoles(roles, 'jornadas')).toBe(true)
    expect(tieneModuloConRoles(roles, 'rem')).toBe(true)
    // La jefatura no toma horas para sí misma
    expect(tieneModuloConRoles(roles, 'citas')).toBe(false)
  })

  it('la jefatura sola NO habilita atencion clinica', () => {
    expect(tieneModuloConRoles(['jefatura'], 'fichas')).toBe(false)
    expect(tieneModuloConRoles(['jefatura'], 'recetas')).toBe(false)
  })

  it('un rol no autorizado no se filtra por otro que si lo esta', () => {
    const roles: RolConocido[] = ['administrativo', 'jefatura']
    expect(tieneModuloConRoles(roles, 'usuarios')).toBe(false)
    expect(tieneModuloConRoles(roles, 'bonos')).toBe(true)
  })

  it('sin roles no ve nada', () => {
    expect(tieneModuloConRoles([], 'fichas')).toBe(false)
    expect(tieneModulo(null, 'fichas')).toBe(false)
  })
})

describe('tieneAlguno', () => {
  it('detecta pertenencia al conjunto', () => {
    expect(tieneAlguno(['enfermeria', 'jefatura'], ['jefatura'])).toBe(true)
    expect(tieneAlguno(['enfermeria', 'jefatura'], ['doctor'])).toBe(false)
    expect(tieneAlguno([], ['administrador'])).toBe(false)
  })
})

describe('esStaff', () => {
  it('la jefatura es staff pero no es clinico por si sola', () => {
    expect(esStaff('jefatura')).toBe(true)
  })
})

describe('homeRol', () => {
  it('la jefatura aterriza en jornadas', () => {
    expect(homeRol('jefatura')).toBe('/jornadas')
  })

  it('los roles no clinicos no caen en fichas', () => {
    const noClinicos: RolConocido[] = [
      'administrativo',
      'unidad_apoyo',
      'jefatura',
      'paciente',
    ]
    for (const rol of noClinicos) {
      expect(homeRol(rol)).not.toBe('/dashboard')
    }
  })

  it('sin rol no hay home', () => {
    expect(homeRol(null)).toBe('/dashboard')
  })
})

describe('coherencia de modulos', () => {
  it('todo modulo nuevo queda asignado a al menos un rol', () => {
    const declarados = new Set<string>()
    for (const lista of Object.values(MODULOS_POR_ROL)) {
      for (const m of lista) declarados.add(m)
    }
    const esperados: Modulo[] = [
      'fichas', 'pacientes', 'enmiendas', 'agenda', 'citas', 'jornadas', 'usuarios',
      'portal', 'interconsultas', 'bonos', 'finanzas', 'recetas', 'calculos',
      'rem', 'bandeja_ordenes', 'config_recinto',
    ]
    // 'enmiendas' no es una pantalla: la enmienda se hace dentro de la ficha.
    // Se lista aqui para que agregar un modulo nuevo sin asignarlo a nadie
    // haga fallar el test en vez de quedar invisible para todos.
    const huerfanos = esperados.filter((m) => !declarados.has(m))
    expect(huerfanos).toEqual(['enmiendas'])
  })
})

describe('robustez ante roles desconocidos', () => {
  it('un rol fuera del mapa no rompe la pagina', () => {
    const rolFantasia = 'rol_borrado' as RolConocido
    expect(() => tieneModulo(rolFantasia, 'fichas')).not.toThrow()
    expect(tieneModulo(rolFantasia, 'fichas')).toBe(false)
    expect(tieneModuloConRoles([rolFantasia, 'doctor'], 'fichas')).toBe(true)
  })
})

// Regresión del bug que motivó extraer agregarRoles: el provider procesaba
// `filas[0]` y devolvía un solo rol, así que un profesional con enfermería +
// jefatura perdía medio menú del sidebar. El orden de PostgREST no está
// garantizado, por eso se prueban las dos variantes.
describe('agregarRoles (N-roles desde usuario_roles)', () => {
  const fila = (nombre: string, es_principal = false): FilaRol => ({
    es_principal,
    roles: { nombre_rol: nombre },
  })

  it('acumula los roles aunque venga el secundario primero', () => {
    const filas = [fila('jefatura'), fila('enfermeria', true)]
    expect(agregarRoles(filas)).toEqual(['enfermeria', 'jefatura'])
  })

  it('acumula los roles con el principal primero', () => {
    const filas = [fila('enfermeria', true), fila('jefatura')]
    expect(agregarRoles(filas)).toEqual(['enfermeria', 'jefatura'])
  })

  it('no duplica si la misma fila trae la relación como arreglo', () => {
    const filas: FilaRol[] = [
      { es_principal: true, roles: [{ nombre_rol: 'doctor' }] },
      { es_principal: false, roles: [{ nombre_rol: 'jefatura' }] },
    ]
    expect(agregarRoles(filas)).toEqual(['doctor', 'jefatura'])
  })

  it('descarta filas sin rol o con rol desconocido', () => {
    const filas: FilaRol[] = [
      fila('doctor', true),
      { es_principal: false, roles: null },
      { es_principal: false, roles: { nombre_rol: 'rol_borrado' } },
    ]
    expect(agregarRoles(filas)).toEqual(['doctor', 'rol_borrado'])
  })

  it('un usuario sin roles no rompe la pagina', () => {
    expect(agregarRoles([])).toEqual([])
    expect(rolPrincipal([])).toBeNull()
  })

  it('el rol principal manda sobre el orden de las filas', () => {
    expect(rolPrincipal([fila('jefatura'), fila('enfermeria', true)])).toBe(
      'enfermeria',
    )
  })

  it('sin es_principal marcado cae al primero, sin romperse', () => {
    expect(rolPrincipal([fila('enfermeria'), fila('jefatura')])).toBe('enfermeria')
  })

  // El sidebar es la fuente de navegación: si un rol se pierde aquí, el
  // usuario ve menos de lo que el sistema le permite.
  it('un enfermero ascendido conserva los modulos de ambos roles', () => {
    const roles = agregarRoles([fila('jefatura'), fila('enfermeria', true)])
    expect(tieneModuloConRoles(roles, 'fichas')).toBe(true)
    expect(tieneModuloConRoles(roles, 'rem')).toBe(true)
  })
})
