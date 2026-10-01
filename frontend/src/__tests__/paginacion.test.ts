import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, it, expect, vi } from 'vitest'
import { traerEnTrozos } from '../utils/paginacion'

const aqui = dirname(fileURLToPath(import.meta.url))
const leerPagina = (nombre: string) =>
  readFileSync(resolve(aqui, '..', 'pages', nombre), 'utf-8')

/** Simula un endpoint de PostgREST con tope de 1000 filas. */
function endpointPostgREST(total: number, tope = 1000) {
  return vi.fn(async (desde: number, hasta: number) => {
    const fin = Math.min(hasta + 1, total)
    const data = fin > desde ? Array.from({ length: fin - desde }, (_, i) => desde + i) : []
    // si se pide mas del tope, el servidor devuelve solo el tope, en silencio
    return { data: data.slice(0, tope), error: null }
  })
}

describe('traerEnTrozos', () => {
  it('baja todo cuando cabe en un solo tramo', async () => {
    const pedir = endpointPostgREST(1879)
    const { filas, error } = await traerEnTrozos(pedir)

    expect(error).toBeNull()
    expect(filas).toHaveLength(1879)
    expect(pedir).toHaveBeenCalledTimes(2)
  })

  it('no se detiene al primer tramo lleno: sigue pidiendo', async () => {
    const pedir = endpointPostgREST(2500)
    const { filas } = await traerEnTrozos(pedir)

    expect(filas).toHaveLength(2500)
    expect(pedir.mock.calls.map((c) => c[0])).toEqual([0, 1000, 2000])
  })

  it('pide un tramo de sobra cuando el total es multiplo exacto', async () => {
    // 2000 filas: los dos primeros tramos vienen llenos, asi que hace falta
    // un tercero para confirmar que no hay mas. Un premature stop perderia
    // justo el ultimo bloque.
    const pedir = endpointPostgREST(2000)
    const { filas } = await traerEnTrozos(pedir)

    expect(filas).toHaveLength(2000)
    expect(pedir).toHaveBeenCalledTimes(3)
  })

  it('reparte los rangos sin huecos ni solapes', async () => {
    const pedir = endpointPostgREST(1879)
    await traerEnTrozos(pedir)

    for (const [desde, hasta] of pedir.mock.calls) {
      expect(hasta).toBe(desde + 999)
    }
    expect(pedir.mock.calls[1][0]).toBe(pedir.mock.calls[0][1] + 1)
  })

  it('devuelve lo ya bajado y el error si un tramo falla a mitad', async () => {
    const pedir = vi
      .fn()
      .mockResolvedValueOnce({ data: Array(1000).fill(1), error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'boom' } })

    const { filas, error } = await traerEnTrozos(pedir)

    expect(error).toBe('boom')
    expect(filas).toHaveLength(1000)
  })

  it('no se cae si la promesa revienta', async () => {
    const pedir = vi.fn().mockRejectedValue(new Error('red caida'))
    const { filas, error } = await traerEnTrozos(pedir)

    expect(error).toBe('No se pudieron cargar los datos.')
    expect(filas).toEqual([])
  })

  it('tolera data null sin error', async () => {
    const pedir = vi.fn().mockResolvedValue({ data: null, error: null })
    const { filas, error } = await traerEnTrozos(pedir)

    expect(error).toBeNull()
    expect(filas).toEqual([])
  })
})

/**
 * El bug que motiva el helper: PostgREST topa las respuestas en 1000 filas y
 * lo hace sin avisar. Un `.limit()` en estas pantallas no evita la trampa: la
 * convierte en un recorte silencioso, y como ademas venia en orden inverso
 * el profesional perdiaba el tramo proximo, que es justo el que se usa.
 * Si alguien vuelve a poner un tope fijo, el test cae.
 */
describe('pantallas de agenda sin recorte silencioso', () => {
  const paginas = ['Agenda.tsx', 'Jornadas.tsx', 'Citas.tsx', 'Portal.tsx']

  for (const pagina of paginas) {
    it(`${pagina} no recorta la carga con un limite fijo`, () => {
      const fuente = leerPagina(pagina)
      const limites = fuente.match(/limit\(\s*\d+\s*\)/gi) ?? []

      expect(
        limites,
        `${pagina} tiene ${limites.length} limit() fijo(s). ` +
          `El tope de 1000 filas lo impone el servidor: subirlo en el cliente ` +
          `no arregla nada, hay que pedir por tramos con range() o acotar por fecha.`,
      ).toEqual([])
    })

    /**
     * Hay dos maneras válidas de no comerse el tope de 1000 filas: pedir por
     * tramos (`traerEnTrozos`), o acotar el conjunto a algo que de verdad quepa
     * en 1000 filas. Lo que no vale es ninguna de las dos: es cargar el
     * horizonte entero y descubrir el recorte en pantalla.
     *
     * `Jornadas.tsx` pasó de lo primero a lo segundo: pedía los ~6.900 bloques
     * del horizonte en 7 tandas (más de un segundo de red, medido) y ahora pide
     * un día con filtro por profesional, que son ~200 filas en un request.
     */
    it(`${pagina} acota la carga (por tramos o por fecha)`, () => {
      const fuente = leerPagina(pagina)
      const acotada =
        fuente.includes('traerEnTrozos') ||
        // Un rango explícito de fechas en el filtro es una cota real.
        /\.gte\(\s*'fecha_inicio'/.test(fuente) ||
        /\.eq\(\s*'fecha_inicio'/.test(fuente)

      expect(
        acotada,
        `${pagina} no acota la carga de horarios: o usa traerEnTrozos, o ` +
          `filtra por fecha_inicio con gte/eq. Sin una de las dos, se está ` +
          `pidiendo el horizonte entero y el tope de 1000 filas lo recorta en ` +
          `silencio.`,
      ).toBe(true)
    })
  }
})
