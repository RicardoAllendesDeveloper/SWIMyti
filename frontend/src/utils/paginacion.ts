/**
 * PostgREST responde como maximo 1000 filas por peticion, y lo hace en
 * silencio: si pides 1879, te devuelve 1000 y no dice nada. Un `.limit()`
 * en el cliente no evita la trampa, solo la hace explicita y peor.
 *
 * `traerEnTrozos` pide la coleccion por tramos de `range()` hasta que le
 * llega un tramo corto, que es la unica senal fiable de que se acabo.
 *
 * Importante: el orden va como parametro del SELECT, no de la funcion.
 * Paginar sobre un resultado sin orden determinista devuelve tramos
 * solapados o con huecos entre si, que es peor que truncar.
 */
export type Trozo<T> = {
  data: T[] | null
  error: { message: string } | null
}

export async function traerEnTrozos<T>(
  pedirTrozo: (desde: number, hasta: number) => PromiseLike<Trozo<T>>,
  porTrozo = 1000,
): Promise<{ filas: T[]; error: string | null }> {
  const filas: T[] = []

  for (let desde = 0; ; desde += porTrozo) {
    let trozo: Trozo<T>
    try {
      trozo = await pedirTrozo(desde, desde + porTrozo - 1)
    } catch {
      return { filas, error: 'No se pudieron cargar los datos.' }
    }

    if (trozo.error) return { filas, error: trozo.error.message }

    const lote = trozo.data ?? []
    filas.push(...lote)

    if (lote.length < porTrozo) return { filas, error: null }
  }
}
