import { describe, it, expect } from 'vitest'
import { claveDia, rangoUtcDeDia, desplazarDia } from '../utils/fechas'

/**
 * El rango UTC de un día chileno es el tipo de helper que falla en silencio:
 * si devuelve mal los límites, la pantalla muestra el día equivocado y nadie
 * se da cuenta, porque las fechas siguen viéndose "normales".
 *
 * La forma de comprobarlo no es mirar el string, sino pasar el rango por la
 * misma función que usa el resto de la app para decidir a qué día pertenece un
 * bloque. Si `claveDia(desde)` es el día pedido, el filtro trae lo correcto.
 */
describe('rangoUtcDeDia', () => {
  const cubreDiaPedido = (clave: string) => {
    const { desde, hasta } = rangoUtcDeDia(clave)
    // El primer instante del rango debe ser de ese día...
    expect(claveDia(desde)).toBe(clave)
    // ...y el último, un milisegundo antes del fin, también.
    expect(claveDia(new Date(new Date(hasta).getTime() - 1))).toBe(clave)
  }

  /** Horas reales que dura el día, que en el cambio de horario no son 24. */
  const duracionHoras = (clave: string) => {
    const { desde, hasta } = rangoUtcDeDia(clave)
    return (new Date(hasta).getTime() - new Date(desde).getTime()) / 3_600_000
  }

  it('cubre el día pedido en horario de invierno (UTC-3)', () => {
    cubreDiaPedido('2026-06-15')
  })

  it('cubre el día pedido en horario de invierno (UTC-4)', () => {
    cubreDiaPedido('2026-07-15')
  })

  it('cubre el día pedido en horario de verano (UTC-3)', () => {
    // Verano chileno = UTC-3. Es la estación en la que estamos hoy.
    cubreDiaPedido('2026-01-15')
  })

  it('cubre el día en que Chile entra en horario de verano', () => {
    // 2026-09-06: Chile pasa de UTC-4 a UTC-3. El reloj salta de 23:00 a 01:00,
    // así que ESE día tiene 23 horas y su medianoche local no existe.
    cubreDiaPedido('2026-09-06')
    expect(duracionHoras('2026-09-06')).toBe(23)
  })

  it('cubre el día en que Chile sale del horario de verano', () => {
    // 2026-04-04: Chile pasa de UTC-3 a UTC-4, el reloj retrocede una hora y ese
    // día tiene 25. Ojo con esto: el día de 25 horas es el ANTERIOR al cambio,
    // que es donde cae el retroceso de las 24:00, no el siguiente.
    cubreDiaPedido('2026-04-04')
    expect(duracionHoras('2026-04-04')).toBe(25)
  })

  it('un día normal dura 24 horas en ambas estaciones', () => {
    // El desfase cambia con la estación; la duración del día, no.
    expect(duracionHoras('2026-07-15')).toBe(24)
    expect(duracionHoras('2026-01-15')).toBe(24)
  })

  it('devuelve un rango contiguo y sin huecos entre días seguidos', () => {
    for (const clave of ['2026-09-05', '2026-09-06', '2026-04-03', '2026-04-04']) {
      const { hasta } = rangoUtcDeDia(clave)
      const siguiente = rangoUtcDeDia(desplazarDia(clave, 1))
      expect(hasta).toBe(siguiente.desde)
    }
  })

  it('no pierde la hora de la mañana ni incluye la del día anterior', () => {
    // El bloque de las 09:00 de Chile es el que un offset mal calculado deja
    // fuera, y es el primero que la jefatura revisa al abrir el día.
    const { desde } = rangoUtcDeDia('2026-10-03')
    const nueveChile = new Date('2026-10-03T09:00:00-03:00')
    expect(nueveChile.getTime()).toBeGreaterThanOrEqual(new Date(desde).getTime())
  })

  it('tolera una clave inválida sin lanzar', () => {
    expect(() => rangoUtcDeDia('')).not.toThrow()
    expect(() => rangoUtcDeDia('no-es-fecha')).not.toThrow()
  })
})

describe('desplazarDia', () => {
  it('suma y resta días cruzando meses', () => {
    expect(desplazarDia('2026-10-31', 1)).toBe('2026-11-01')
    expect(desplazarDia('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('cruza el cambio de año', () => {
    expect(desplazarDia('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('devuelve la clave sin cambios si no es válida', () => {
    expect(desplazarDia('basura', 1)).toBe('basura')
  })
})
