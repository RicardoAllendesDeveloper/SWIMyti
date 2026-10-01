/**
 * Zona horaria de negocio. Todo lo que agrupa, ordena o etiqueta un bloque de
 * agenda se ancla a Chile, NO a la zona horaria del navegador del usuario.
 *
 * Motivo: las funciones de la BD (`fn_generar_bloques_jornada`,
 * `fn_eliminar_bloques_jornada`, `fn_generar_bloques_toma_muestra`) calculan
 * el día local con `at time zone 'America/Santiago'`. Si el cliente agrupara con
 * la zona del navegador, un profesional conectado desde otra zona vería los
 * bloques de la madrugada bajo un día distinto al que la BD considers, y al
 * eliminar una jornada borraría la ventana equivocada.
 *
 * La BD almacena `timestamptz` en UTC; la conversión a hora chilena ocurre
 * siempre en el servidor. El cliente solo lee, nunca decide el día.
 */

/** Zona horaria canónica del recinto. */
export const ZONA_HORARIA = 'America/Santiago'

const LOCALE_FECHA = 'es-CL'

/**
 * Formateador de partes en hora chilena, reutilizado.
 *
 * `hourCycle: 'h23'` importa: con la opción por defecto, `Intl` devuelve la hora
 * `24` en medianoche, y al pasarla a `Date.UTC` eso salta al día siguiente y
 * descuadra el cálculo del desfase.
 */
const FORMATO_CHILE = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONA_HORARIA,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

/**
 * Devuelve la clave `YYYY-MM-DD` de un instante **en hora chilena**.
 *
 * `en-CA` entrega ISO-like (YYYY-MM-DD), que es justo el formato que espera el
 * parámetro `p_fecha` de las RPC. No usar `toISOString()`: eso devuelve la
 * fecha en UTC y es exactamente el bug que esto previene.
 */
export function claveDia(value: string | Date): string {
  const d = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_HORARIA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

/** Clave del día de hoy en hora chilena. Reemplaza a `claveDia(new Date().toISOString())`. */
export function claveHoy(): string {
  return claveDia(new Date())
}

/**
 * Desplaza una clave `YYYY-MM-DD` un número de días, sin construir fechas ni
 * tocar zonas. Para navegar de día en día en la agenda.
 */
export function desplazarDia(clave: string, dias: number): string {
  const [anio, mes, dia] = clave.split('-').map(Number)
  if (!anio || !mes || !dia) return clave
  const d = new Date(Date.UTC(anio, mes - 1, dia))
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

/**
 * Rango UTC `[desde, hasta)` que cubre un día **completo** en hora chilena.
 *
 * Sirve para filtrar bloques en la BD sin traerlos todos: la BD guarda
 * `timestamptz` en UTC, y un filtro por `fecha_inicio` en texto plano
 * interpretaría "2026-10-03" como medianoche UTC, que en Chile es las 21:00 del
 * 2 de octubre (o 20:00, según horario de verano). Eso deja fuera la primera
 * hora del día y mete la última del anterior: el bloque de las 09:00 no
 * aparecería.
 *
 * El desplazamiento se resuelve preguntándole a `Intl` cuál es la hora local
 * real de ese instante, en vez de restar 3 o 4 horas a mano. Chile cambia entre
 * UTC-3 y UTC-4 dos veces al año, y un offset fijo rompe exactamente en esas
 * fechas, que son las que más se usan.
 *
 * `fin inclusivo` en el filtro de la BD: se usa `lt` con el inicio del día
 * siguiente, que es la forma correcta de cubrir el día entero sin repetir la
 * medianoche entre dos peticiones.
 */
export function rangoUtcDeDia(clave: string): { desde: string; hasta: string } {
  const [anio, mes, dia] = clave.split('-').map(Number)
  if (!anio || !mes || !dia) {
    const hoy = new Date()
    return {
      desde: hoy.toISOString(),
      hasta: new Date(hoy.getTime() + 86400000).toISOString(),
    }
  }
  return {
    desde: medianocheLocalChilena(anio, mes - 1, dia).toISOString(),
    hasta: medianocheLocalChilena(anio, mes - 1, dia + 1).toISOString(),
  }
}

/**
 * El instante UTC que corresponde a las PRIMER hora de un día en hora chilena.
 *
 * Hay dos trampas, y las dos están en la misma línea de código:
 *
 * 1. No se puede restar 3 o 4 horas a mano. Chile cambia de UTC-4 a UTC-3 y al
 *    revés dos veces al año.
 * 2. No se puede medir el desfase en la medianoche UTC, porque el cambio de
 *    horario chileno ocurre JUSTO a la medianoche: esa medición cae del lado
 *    anterior y devuelve un día corrido.
 *
 * Y hay una tercera, que es la que hace este helper necesario: el día del
 * cambio, la medianoche local **no existe**. El 6 de septiembre de 2026 el
 * reloj salta de las 23:00 a la 01:00, y el 5 de abril pasa al revés. En esos
 * días no hay ningún instante UTC que sea medianoche en Chile, así que no hay
 * ecuación que lo resuelva: hay que buscar el primer instante que de verdad
 * pertenezca al día.
 *
 * El punto de partida es el desfase medido al mediodía, que siempre es válido
 * (el cambio ocurre de madrugada) y deja el resultado a menos de una hora. Desde
 * ahí se camina minuto a minuto, en un sentido o en el otro. En un día normal
 * no hay casi nada que recorrer; los dos días de cambio horario del año
 * necesitan el recorrido completo, y por eso el bucle tiene tope.
 */
function medianocheLocalChilena(anio: number, mes: number, dia: number): Date {
  const clave = `${anio}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
  const mediodiaUtc = Date.UTC(anio, mes, dia, 12, 0, 0)
  const medianocheUtc = Date.UTC(anio, mes, dia, 0, 0, 0)

  let instante = new Date(medianocheUtc - desfaseEn(mediodiaUtc))

  if (claveDia(instante) !== clave) {
    // Está del lado equivocado (típicamente la hora previa): avanzar.
    for (let i = 0; i < 180 && claveDia(instante) !== clave; i++) {
      instante = new Date(instante.getTime() + 60000)
    }
    return instante
  }

  // Está dentro del día, pero hay que asegurarse de que sea la PRIMERA hora y
  // no una repetida por el retroceso del reloj.
  for (let i = 0; i < 180; i++) {
    const previo = new Date(instante.getTime() - 60000)
    if (claveDia(previo) !== clave) break
    instante = previo
  }
  return instante
}

/** Cuánto se adelanta Chile respecto a UTC, en ms, en ese instante. */
function desfaseEn(instanteMs: number): number {
  const partes = FORMATO_CHILE.formatToParts(new Date(instanteMs))
  const valor = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value ?? '0')
  const comoUtc = Date.UTC(
    valor('year'),
    valor('month') - 1,
    valor('day'),
    valor('hour'),
    valor('minute'),
    valor('second'),
  )
  return comoUtc - instanteMs
}

/**
 * Año y mes (0-11) **actuales en hora chilena**, para inicializar el
 * navegación de un calendario. Deriva de `claveHoy` en vez de `new Date()` para
 * que un dispositivo en otra zona no abra el mes equivocado.
 */
export function anioMesActuales(): { anio: number; mes: number } {
  const [anio, mes] = claveHoy().split('-')
  return { anio: Number(anio), mes: Number(mes) - 1 }
}

/**
 * Compone una clave `YYYY-MM-DD` desde números de calendario, SIN conversión
 * de zona horaria.
 *
 * Es para las celdas de un calendario, donde `anio`/`mes`/`dia` ya son la
 * fechacivil que se quiere mostrar. Pasar esto por `claveDia` sería un error:
 * `new Date(anio, mes, dia)` es medianoche en la zona del navegador, y al
 * convertirla a hora chilena retrocede un día.
 */
export function claveDiaDeCalendario(anio: number, mes: number, dia: number): string {
  return `${anio}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}

/** Días que tiene el mes (1-12), sin construir fechas ni tocar zonas. */
export function diasEnMes(anio: number, mes: number): number {
  return new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate()
}

/**
 * Día de la semana de una clave `YYYY-MM-DD`, 0 = lunes … 6 = domingo.
 * Calculado en UTC a propósito: la clave ya es una fecha civil y no debe
 * depender de la zona del dispositivo.
 */
export function diaSemanaDeClave(clave: string): number {
  const [anio, mes, dia] = clave.split('-').map(Number)
  return (new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay() + 6) % 7
}

/** `true` si la fecha/hora cae en el mismo día chileno que `referencia`. */
export function esMismoDia(value: string | Date, referencia: string | Date): boolean {
  return claveDia(value) === claveDia(referencia)
}

/**
 * Formatea la hora de un bloque en hora chilena (HH:MM).
 * Para etiquetas de agenda la hora local chilena es la correcta aunque el
 * dispositivo esté en otra zona.
 */
export function formatHoraMin(value: string | Date): string {
  try {
    return new Intl.DateTimeFormat(LOCALE_FECHA, {
      timeZone: ZONA_HORARIA,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(typeof value === 'string' ? new Date(value) : value)
  } catch {
    return typeof value === 'string' ? value : ''
  }
}

/** Formatea fecha y hora en hora chilena. */
export function formatFechaHora(value: string | Date): string {
  try {
    return new Intl.DateTimeFormat(LOCALE_FECHA, {
      timeZone: ZONA_HORARIA,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(typeof value === 'string' ? new Date(value) : value)
  } catch {
    return typeof value === 'string' ? value : ''
  }
}
