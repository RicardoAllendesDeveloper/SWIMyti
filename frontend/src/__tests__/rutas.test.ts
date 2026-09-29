import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MODULOS_POR_ROL, type Modulo } from '../utils/permisos'
import type { RolConocido } from '../context/AuthRolContext'

const aqui = dirname(fileURLToPath(import.meta.url))
const appTsx = readFileSync(resolve(aqui, '..', 'App.tsx'), 'utf-8')

/**
 * Rutas cuyo guard es deliberadamente mas estrecho que el modulo. Son vistas
 * acotadas a un paciente o un rol, no la entrada al modulo, asi que tiene
 * sentido que no entre todo el mundo que ve el link en el sidebar.
 */
const RUTAS_ACOTADAS = new Set(['/paciente-apoyo/:idPaciente', '/portal'])

type Ruta = { path: string; roles: RolConocido[] }

/** Lee los <Route path="..."> con su <RoleRoute roles={[...]}>. */
function leerRutas(): Ruta[] {
  const rutas: Ruta[] = []
  const re = /path="([^"]+)"[\s\S]{0,400}?RoleRoute\s+roles=\{([^}]*)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(appTsx)) !== null) {
    const roles = [...m[2].matchAll(/'([a-z_]+)'/g)].map((r) => r[1] as RolConocido)
    rutas.push({ path: m[1], roles })
  }
  return rutas
}

/** Ruta -> modulo del mapa, deduplicado: /ficha y /expediente usan 'fichas'. */
const RUTA_A_MODULO: Record<string, Modulo> = {
  '/': 'fichas',
  '/pacientes': 'pacientes',
  '/ficha/:id': 'fichas',
  '/expediente/:idPaciente': 'fichas',
  '/paciente-apoyo/:idPaciente': 'pacientes',
  '/usuarios': 'usuarios',
  '/disponibilidad': 'disponibilidad',
  '/calculos': 'calculos',
  '/rem': 'rem',
  '/bandeja-ordenes': 'bandeja_ordenes',
  '/config-recinto': 'config_recinto',
  '/citas': 'citas',
  '/interconsultas': 'interconsultas',
  '/bonos': 'bonos',
  '/finanzas': 'finanzas',
  '/recetas': 'recetas',
  '/portal': 'portal',
}

describe('guardas de ruta de App.tsx', () => {
  const rutas = leerRutas()

  it('extrae las rutas protegidas por rol', () => {
    expect(rutas.length).toBeGreaterThanOrEqual(15)
  })

  it('toda ruta con guard tiene un modulo declarado en el mapa', () => {
    for (const r of rutas) {
      if (RUTA_A_MODULO[r.path] === undefined) {
        throw new Error(
          `La ruta ${r.path} tiene RoleRoute pero RUTA_A_MODULO no declara su modulo. ` +
            `Agregalo o el test no puede verificarla.`,
        )
      }
    }
  })

  /**
   * Este es el test que evita la deriva. MODULOS_POR_ROL decide que link ve el
   * usuario en el sidebar; el guard de App.tsx decide si puede abrirlo. Si un
   * rol tiene el modulo pero no esta en el guard, el usuario ve un link y lo
   * botan a una pantalla de "sin permisos": eso siempre es un bug, nunca una
   * decision. Ocurrio con jefatura, que tenia 4 modulos en el mapa pero faltaba
   * en los guards de /pacientes, /disponibilidad y /citas.
   */
  it('ningun rol ve en el sidebar un link que no puede abrir', () => {
    const fallas: string[] = []
    for (const ruta of rutas) {
      if (RUTAS_ACOTADAS.has(ruta.path)) continue
      const modulo = RUTA_A_MODULO[ruta.path]
      for (const [rol, modulos] of Object.entries(MODULOS_POR_ROL)) {
        if (!modulos.includes(modulo)) continue
        if (!ruta.roles.includes(rol as RolConocido)) {
          fallas.push(`${ruta.path} (${modulo}): el rol "${rol}" ve el link pero no esta en el guard`)
        }
      }
    }
    expect(fallas, `\n${fallas.join('\n')}`).toEqual([])
  })

  it('toda ruta tiene al menos un rol autorizado', () => {
    for (const r of rutas) {
      expect(r.roles.length, `la ruta ${r.path} no tiene roles`).toBeGreaterThan(0)
    }
  })
})
