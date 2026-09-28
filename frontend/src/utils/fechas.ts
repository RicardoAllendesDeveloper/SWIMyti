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
