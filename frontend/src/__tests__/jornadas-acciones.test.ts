import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, it, expect } from 'vitest'

const aqui = dirname(fileURLToPath(import.meta.url))
const leer = (nombre: string) => readFileSync(resolve(aqui, '..', 'pages', nombre), 'utf-8')

/**
 * Un bug real de la pantalla de Jornadas: al seleccionar horas en una jornada,
 * los botones "Deshabilitar N horas" y "Reactivar" aparecían en TODAS las
 * tarjetas, no solo en las que tenían selección.
 *
 * La causa era usar la selección global (`seleccionadosBloqueo()`) para
 * decidir la visibilidad. No rompía datos: la acción seguía operando sobre la
 * selección correcta. Peor era que el botón se mostraba en la tarjeta
 * equivocada, y el riesgo real es de interpretación: creer que se va a
 * reactivar la jornada que uno está mirando y deshabilitar otra.
 *
 * Estos tests fijan el invariante para que la tarjeta que se decide pintar
 * sea la jornada, no el estado global.
 */
describe('Jornadas: los botones de acción son por jornada', () => {
  const fuente = leer('Jornadas.tsx')

  it('expone un helper que devuelve la selección de una jornada', () => {
    // Si este helper desaparece, la visibilidad vuelve al error global.
    expect(fuente).toMatch(/function seleccionadosDe\(g: GrupoJornada\)/)
  })

  it('usa la selección de la jornada para decidir si pintar el botón', () => {
    // La condición de visibilidad DEBE derivar de la tarjeta.
    expect(fuente).toContain('{seleccionadosDe(g).length > 0 ? (')
    expect(fuente).toMatch(
      /seleccionadosDe\(g\)\.length > 0 &&\s*\n?\s*seleccionadosDe\(g\)\.every/,
    )
  })

  it('NO usa la selección global como condición de visibilidad dentro de las tarjetas', () => {
    // La selección global sí vale para la acción (afecta a todo lo marcado),
    // pero no para decidir si el botón existe en una tarjeta.
    //
    // Solo se mira lo que va dentro del `.map` de las jornadas: el aviso de
    // alcance de la selección se pinta FUERA de las tarjetas y ahí la
    // condición global es justamente lo que tiene que medir.
    const cuerpo = fuente.slice(fuente.indexOf('gruposPagina.map'))
    const usosComoCondicion = cuerpo.match(
      /\{\s*seleccionadosBloqueo\(\)\.length > 0\s*\?/g,
    )
    expect(
      usosComoCondicion ?? [],
      'Jornadas.tsx vuelve a pintar el botón de una tarjeta según la selección ' +
        'global. El botón debe existir solo en las jornadas con horas seleccionadas.',
    ).toEqual([])
  })

  it('mantiene la acción sobre la selección global, para no romper la selección múltiple', () => {
    // Corregir la visibilidad no puede significar filtrar la acción: si el
    // botón solo deshabilitara las horas de su propia jornada, se perdería la
    // capacidad de bloquear el mismo tramo a varios profesionales de una vez.
    expect(fuente).toContain('onClick={pedirBloqueo}')
    expect(fuente).toMatch(/reactivarHoras\(\s*\n?\s*seleccionadosBloqueo\(\)\.map/)
  })

  it('avisa el alcance cuando la selección abarca varias jornadas', () => {
    // Con selección global, el usuario no tiene forma de saber a qué alcanza
    // el botón que está a punto de apretar.
    expect(fuente).toContain('jornadas-seleccion')
  })
})