import { useMemo, useState } from 'react'
import '../styles/CalendarioDisponibilidad.css'

export type BloqueDisponible = {
  id_horario: number
  fecha_inicio: string
}

type Props = {
  bloques: BloqueDisponible[]
  onReservar: (idHorario: number, fechaInicio: string) => void
  confirmandoId: number | null
  mensajeVacio?: string
}

function claveDia(value: string | Date): string {
  const d = typeof value === 'string' ? new Date(value) : value
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`
}

function formatearHora(value: string): string {
  try {
    return new Intl.DateTimeFormat('es-CL', { timeStyle: 'short' }).format(
      new Date(value),
    )
  } catch {
    return value
  }
}

const DIAS_SEMANA = ['L', 'M', 'X', 'J', 'V', 'S', 'D']

function CalendarioDisponibilidad({
  bloques,
  onReservar,
  confirmandoId,
  mensajeVacio = 'No hay horarios disponibles en este momento. Intenta más tarde.',
}: Props) {
  const hoy = new Date()
  const hoyClave = claveDia(hoy)
  const [anio, setAnio] = useState(hoy.getFullYear())
  const [mes, setMes] = useState(hoy.getMonth())
  const [diaSeleccionado, setDiaSeleccionado] = useState<string | null>(null)

  // No se permite navegar a un mes anterior al actual
  const mesMinimo = hoy.getFullYear() * 12 + hoy.getMonth()
  const mesActual = anio * 12 + mes
  const noPuedeRetroceder = mesActual <= mesMinimo

  // Bloques agrupados por día
  const bloquesPorDia = useMemo(() => {
    const mapa = new Map<string, BloqueDisponible[]>()
    for (const b of bloques) {
      const k = claveDia(b.fecha_inicio)
      const lista = mapa.get(k) ?? []
      lista.push(b)
      mapa.set(k, lista)
    }
    return mapa
  }, [bloques])

  // Celdas del mes visible
  const celdas = useMemo(() => {
    const primerDia = new Date(anio, mes, 1)
    const offset = (primerDia.getDay() + 6) % 7 // lunes primero
    const diasEnMes = new Date(anio, mes + 1, 0).getDate()
    const arr: { dia: number | null; fecha: string }[] = []
    for (let i = 0; i < offset; i++) arr.push({ dia: null, fecha: '' })
    for (let d = 1; d <= diasEnMes; d++) {
      arr.push({ dia: d, fecha: claveDia(new Date(anio, mes, d)) })
    }
    return arr
  }, [anio, mes])

  const nombreMes = new Date(anio, mes, 1).toLocaleString('es-CL', {
    month: 'long',
    year: 'numeric',
  })

  const horasDelDia = diaSeleccionado ? (bloquesPorDia.get(diaSeleccionado) ?? []) : []
  const [pagina, setPagina] = useState(1)
  const POR_PAGINA = 10
  const totalPaginas = Math.max(1, Math.ceil(horasDelDia.length / POR_PAGINA))
  const paginaSegura = Math.min(pagina, totalPaginas)
  const horasPagina = horasDelDia.slice(
    (paginaSegura - 1) * POR_PAGINA,
    paginaSegura * POR_PAGINA,
  )

  function seleccionarDia(fecha: string) {
    if (diaSeleccionado === fecha) {
      setDiaSeleccionado(null)
      return
    }
    setDiaSeleccionado(fecha)
    setPagina(1)
  }

  function cambiarMes(delta: number) {
    const siguiente = mesActual + delta
    if (siguiente < mesMinimo) return
    let nuevoMes = mes + delta
    let nuevoAnio = anio
    if (nuevoMes < 0) {
      nuevoMes = 11
      nuevoAnio -= 1
    } else if (nuevoMes > 11) {
      nuevoMes = 0
      nuevoAnio += 1
    }
    setMes(nuevoMes)
    setAnio(nuevoAnio)
    setDiaSeleccionado(null)
  }

  return (
    <div className="cal-disp">
      <div className="cal-disp-mes">
        <button
          type="button"
          className="cal-disp-nav"
          onClick={() => cambiarMes(-1)}
          disabled={noPuedeRetroceder}
          aria-label="Mes anterior"
        >
          ←
        </button>
        <span className="cal-disp-nombre">{nombreMes}</span>
        <button
          type="button"
          className="cal-disp-nav"
          onClick={() => cambiarMes(1)}
          aria-label="Mes siguiente"
        >
          →
        </button>
      </div>

      <div className="cal-disp-grid cal-disp-grid-head">
        {DIAS_SEMANA.map((d) => (
          <span key={d} className="cal-disp-dia-nombre">{d}</span>
        ))}
      </div>

      <div className="cal-disp-grid">
        {celdas.map((c, idx) => {
          if (c.dia === null) {
            return <span key={`v-${idx}`} className="cal-disp-dia cal-disp-dia-vacio" />
          }
          const tiene = (bloquesPorDia.get(c.fecha)?.length ?? 0) > 0
          const esHoy = c.fecha === hoyClave
          const seleccionado = c.fecha === diaSeleccionado
          const pasado = c.fecha < hoyClave
          return (
            <button
              key={c.fecha}
              type="button"
              className={`cal-disp-dia${tiene ? ' cal-disp-dia-disponible' : ' cal-disp-dia-no'}${esHoy ? ' cal-disp-dia-hoy' : ''}${seleccionado ? ' cal-disp-dia-seleccionado' : ''}${pasado ? ' cal-disp-dia-pasado' : ''}`}
              onClick={() => tiene && !pasado && seleccionarDia(c.fecha)}
              disabled={!tiene || pasado}
              title={tiene ? 'Hay horas disponibles' : 'Sin horas disponibles'}
            >
              {c.dia}
            </button>
          )
        })}
      </div>

      {diaSeleccionado && horasDelDia.length > 0 ? (
        <div className="cal-disp-horas">
          <p className="cal-disp-horas-titulo">
            Horas disponibles del{' '}
            {new Date(diaSeleccionado + 'T00:00:00').toLocaleDateString('es-CL', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
            :
          </p>
          <div className="cal-disp-horas-lista">
            {horasPagina.map((b) => (
              <button
                key={b.id_horario}
                type="button"
                className="cal-disp-hora"
                onClick={() => onReservar(b.id_horario, b.fecha_inicio)}
                disabled={confirmandoId === b.id_horario}
              >
                {confirmandoId === b.id_horario ? 'Confirmando…' : formatearHora(b.fecha_inicio)}
              </button>
            ))}
          </div>
          {totalPaginas > 1 ? (
            <div className="cal-disp-paginacion">
              <button
                type="button"
                className="cal-disp-pag-btn"
                disabled={paginaSegura <= 1}
                onClick={() => setPagina(paginaSegura - 1)}
              >
                Anterior
              </button>
              <span className="cal-disp-pag-info">
                Página {paginaSegura} de {totalPaginas}
              </span>
              <button
                type="button"
                className="cal-disp-pag-btn"
                disabled={paginaSegura >= totalPaginas}
                onClick={() => setPagina(paginaSegura + 1)}
              >
                Siguiente
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="cal-disp-leyenda">
        <span><i className="cal-disp-leyenda-color cal-disp-leyenda-verde" /> Disponible</span>
        <span><i className="cal-disp-leyenda-color cal-disp-leyenda-rojo" /> Sin horas</span>
      </div>

      {bloques.length === 0 ? (
        <p className="cal-disp-vacio">{mensajeVacio}</p>
      ) : null}
    </div>
  )
}

export default CalendarioDisponibilidad