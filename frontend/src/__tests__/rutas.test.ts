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

/**
 * Lee los <Route path="..."> con su <RoleRoute roles={[...]}>, emparejando
 * cada ruta con SU propio guard.
 *
 * Ojo: antes se emparejaba con el guard SIGUIENTE dentro de 400 caracteres, y
 * eso producia dos errores silenciosos. `/` (la landing, publica) se quedaba
 * con el guard de `/dashboard`, y `/dashboard` directamente no se leia porque
 * el match anterior ya se habia consumido su guard. La ruta se saltaba sin
 * avisar y, siendo justamente la red que caza la deriva entre el sidebar y los
 * guards, era un agujero en el test mas importante del archivo.
 */
function leerRutas(): Ruta[] {
  const rutas: Ruta[] = []
  // Cada <Route abre su propio bloque: se parte por ahi para que el guard que
  // se encuentre sea el de esa ruta y no el de la siguiente.
  for (const bloque of appTsx.split(/<Route\b/)) {
    const path = bloque.match(/path="([^"]+)"/)
    const guard = bloque.match(/RoleRoute\s+roles=\{([^}]*)\}/)
    if (!path || !guard) continue
    const roles = [...guard[1].matchAll(/'([a-z_]+)'/g)].map((r) => r[1] as RolConocido)
    rutas.push({ path: path[1], roles })
  }
  return rutas
}

/** Ruta -> modulo del mapa, deduplicado: /ficha y /expediente usan 'fichas'. */
const RUTA_A_MODULO: Record<string, Modulo> = {
  '/dashboard': 'fichas',
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

/**
 * El sidebar es la tercera copia del mismo dato: cada item llevaba su propio
 * `roles: [...]`, que ya no se leia porque la visibilidad la resuelve
 * `tieneModuloConRoles` contra MODULOS_POR_ROL. El de REM decia
 * `['enfermeria']`, que ya era falso, y el proximo que lo leyera cambiaba el
 * filtro por ahi. Estos tests impiden que vuelva a colarse.
 */
describe('ITEMS del sidebar', () => {
  const sidebarTsx = readFileSync(resolve(aqui, '..', 'components', 'Sidebar.tsx'), 'utf-8')

  /** Lee los { modulo, label, ruta } del arreglo ITEMS. */
  function leerItems(): { modulo: string; label: string; ruta: string }[] {
    const bloque = sidebarTsx.slice(
      sidebarTsx.indexOf('const ITEMS'),
      sidebarTsx.indexOf('const ITEMS') + 4000,
    )
    const corte = bloque.indexOf('\n]')
    const cuerpo = corte === -1 ? bloque : bloque.slice(0, corte)
    return [...cuerpo.matchAll(
      /\{\s*modulo:\s*'([a-z_]+)',\s*label:\s*'([^']+)',\s*ruta:\s*'([^']+)'/g,
    )].map((m) => ({ modulo: m[1], label: m[2], ruta: m[3] }))
  }

  const items = leerItems()

  it('extrae los items del menu', () => {
    expect(items.length).toBeGreaterThanOrEqual(14)
  })

  it('no declara una lista de roles propia', () => {
    // Si vuelve a aparecer `roles:`, el filtro esta mirando la copia muerta
    // y MODULOS_POR_ROL deja de ser la fuente de verdad.
    expect(sidebarTsx, 'ITEMS volvió a declarar roles por item').not.toMatch(
      /modulo:\s*'[a-z_]+'[^}]*roles:/,
    )
    expect(sidebarTsx).not.toMatch(/label:\s*'[^']+',[^}]*roles:/)
  })

  it('todo modulo del mapa tiene item en el menu', () => {
    // Si MODULOS_POR_ROL concede un modulo sin item, el usuario tiene el
    // permiso pero no hay link: la funcion queda inalcanzable.
    const enMenu = new Set(items.map((i) => i.modulo))
    const enMapa = new Set(Object.values(MODULOS_POR_ROL).flat())
    const huerfanos = [...enMapa].filter((m) => !enMenu.has(m))
    expect(huerfanos, `modulos sin item en el sidebar: ${huerfanos.join(', ')}`).toEqual([])
  })

  it('no hay items duplicados', () => {
    const vistos = items.map((i) => i.modulo)
    const dupes = vistos.filter((m, i) => vistos.indexOf(m) !== i)
    // 'fichas' tiene varias rutas, pero un solo item.
    expect(dupes, `items duplicados: ${dupes.join(', ')}`).toEqual([])
  })

  it('todo item tiene etiqueta y ruta', () => {
    for (const i of items) {
      expect(i.label.trim(), `item ${i.modulo} sin etiqueta`).not.toBe('')
      expect(i.ruta, `item ${i.modulo} sin ruta`).toMatch(/^\//)
    }
  })

  it('la ruta de cada item es la de su modulo', () => {
    // El menu y la app pueden desincronizarse: /disponibilidad se muestra
    // como "Agenda", /ficha vive en /dashboard.
    for (const i of items) {
      const rutas = rutasDelModulo(i.modulo as Modulo)
      expect(rutas, `el item ${i.modulo} apunta a ${i.ruta}, que no esta en RUTA_A_MODULO`).toContain(
        i.ruta,
      )
    }
  })
})

/** Rutas que App.tsx declara para un modulo (el test de arriba las recorre). */
function rutasDelModulo(modulo: Modulo): string[] {
  return Object.entries(RUTA_A_MODULO)
    .filter(([, m]) => m === modulo)
    .map(([ruta]) => ruta)
}
