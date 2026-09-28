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
const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

function CalendarioDisponibilidad({
  bloques,
  onReservar,
  confirmandoId,
  mensajeVacio = 'No hay horarios disponibles en este momento. Intenta más tarde.',
}: Props) {
  const hoy = new Date()
  const hoyClave = claveDia(hoy)
  const [anio, setAnio] = useState(hoy.getFullYear())
  const [diaSeleccionado, setDiaSeleccionado] = useState<string | null>(null)

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

  // Construcción de los 12 meses del año visible
  const meses = useMemo(() => {
    const arr: {
      mes: number
      nombre: string
      celdas: { dia: number | null; fecha: string }[]
    }[] = []
    for (let mes = 0; mes < 12; mes++) {
      const primerDia = new Date(anio, mes, 1)
      const offset = (primerDia.getDay() + 6) % 7 // lunes primero
      const diasEnMes = new Date(anio, mes + 1, 0).getDate()
      const celdas: { dia: number | null; fecha: string }[] = []
      for (let i = 0; i < offset; i++) celdas.push({ dia: null, fecha: '' })
      for (let d = 1; d <= diasEnMes; d++) {
        celdas.push({ dia: d, fecha: claveDia(new Date(anio, mes, d)) })
      }
      arr.push({ mes, nombre: MESES[mes], celdas })
    }
    return arr
  }, [anio])

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

  function cambiarAnio(delta: number) {
    setAnio(anio + delta)
    setDiaSeleccionado(null)
  }

  return (
    <div className="cal-disp">
      <div className="cal-disp-anio">
        <button
          type="button"
          className="cal-disp-nav"
          onClick={() => cambiarAnio(-1)}
          aria-label="Año anterior"
        >
          ←
        </button>
        <span className="cal-disp-anio-nombre">Año {anio}</span>
        <button
          type="button"
          className="cal-disp-nav"
          onClick={() => cambiarAnio(1)}
          aria-label="Año siguiente"
        >
          →
        </button>
      </div>

      <div className="cal-disp-meses">
        {meses.map((m) => (
          <div key={m.mes} className="cal-disp-mes-card">
            <div className="cal-disp-mes-titulo">{m.nombre}</div>
            <div className="cal-disp-grid cal-disp-grid-head">
              {DIAS_SEMANA.map((d) => (
                <span key={d} className="cal-disp-dia-nombre">{d}</span>
              ))}
            </div>
            <div className="cal-disp-grid">
              {m.celdas.map((c, idx) => {
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
          </div>
        ))}
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