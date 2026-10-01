import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../services/supabase'
import { useAuthRol } from '../context/AuthRolContext'
import Sidebar from '../components/Sidebar'
import type { HorarioDisponible } from '../types/database'
import { claveDia, claveHoy, formatHoraMin } from '../utils/fechas'
import { traerEnTrozos } from '../utils/paginacion'
import '../styles/Agenda.css'

function formatFechaCorta(value: string): string {
  try {
    return new Intl.DateTimeFormat('es-CL', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(value))
  } catch {
    return value
  }
}

function asSingle<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

type AtencionAgenda = {
  id_cita: number
  id_horario: number
  id_paciente: number
  fecha_inicio: string
  paciente_nombre: string
  rut: string
  especialidad: string
  motivo: string | null
  estado: string
  llegada: string
}

type TabAtenciones = 'actuales' | 'anteriores' | 'proximas'

const ESTADO_LABEL: Record<string, string> = {
  disponible: 'Disponible',
  reservada: 'Reservada',
  cancelada: 'Cancelada',
  completada: 'Completada',
}

/**
 * Agenda propia: los bloques y las citas del propio profesional.
 *
 * No publica jornadas, no las borra y no muestra la agenda de otros. Eso vive
 * en `/jornadas` (jefatura y administrador). Ver AGENTS.md, "Definición
 * funcional del producto".
 */
function Agenda() {
  const navigate = useNavigate()
  const { roles } = useAuthRol()

  // Un profesional con agenda es quien tiene rol clínico. La jefatura puede
  // tener rol clínico acumulado: entonces ve su propia agenda como su
  // subalterno, pero nunca la de los demás.
  const esProfesionalAgenda = roles.some((r) => r === 'doctor' || r === 'enfermeria')

  const [horarios, setHorarios] = useState<HorarioDisponible[]>([])
  const [agenda, setAgenda] = useState<AtencionAgenda[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [tabAtenciones, setTabAtenciones] = useState<TabAtenciones>('actuales')
  const [busquedaBloques, setBusquedaBloques] = useState('')
  const [paginaBloques, setPaginaBloques] = useState(1)
  const [paginaAtenciones, setPaginaAtenciones] = useState(1)
  const POR_PAGINA = 10

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)

    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user || !esProfesionalAgenda) {
      setLoading(false)
      return
    }

    // Los bloques van por trozos porque el recinto tiene mas de 1000 bloques
    // y PostgREST corta en silencio a los 1000: el profesional mas cargado
    // tiene 893 y veria solo los 100 mas futuros.
    const CAMPOS_HORARIOS = `
        id_horario,
        id_profesional,
        id_especialidad,
        fecha_inicio,
        fecha_fin,
        estado,
        motivo_bloqueo,
        usuarios:id_profesional ( nombres, apellidos ),
        especialidades ( nombre )
      `

    const { filas: bloques, error: errorHorarios } = await traerEnTrozos(
      (desde, hasta) =>
        supabase
          .from('horarios_disponibles')
          .select(CAMPOS_HORARIOS)
          .eq('id_profesional', user.id)
          .order('fecha_inicio', { ascending: true })
          .range(desde, hasta),
      1000,
    )

    if (errorHorarios) {
      setError(errorHorarios)
    } else {
      setHorarios(bloques as unknown as HorarioDisponible[])
    }

    // Citas del propio profesional, sin filtro de rol: la agenda es siempre
    // la propia, incluso para la jefatura que además coordina.
    const agRes = await supabase
      .from('citas')
      .select(
        `
        id_cita,
        id_horario,
        id_paciente,
        motivo,
        estado,
        llegada,
        horarios_disponibles(id_profesional,
             fecha_inicio,
             especialidades(nombre)),
           pacientes(nombres, apellidos, rut)
      `,
      )
      .eq('horarios_disponibles.id_profesional', user.id)
      .order('created_at', { ascending: true })

    if (!agRes.error) {
      const rows = (agRes.data ?? []).map((r) => {
        const h = asSingle(r.horarios_disponibles)
        const pac = asSingle(r.pacientes)
        const esp = h ? asSingle(h.especialidades) : null
        return {
          id_cita: r.id_cita as number,
          id_horario: r.id_horario as number,
          id_paciente: r.id_paciente as number,
          fecha_inicio: (h?.fecha_inicio as string) ?? '',
          paciente_nombre: pac
            ? `${pac.apellidos ?? ''}, ${pac.nombres ?? ''}`.trim()
            : `Paciente #${r.id_paciente}`,
          rut: (pac?.rut as string) ?? '',
          especialidad: (esp?.nombre as string) ?? 'Sin especialidad',
          motivo: (r.motivo as string | null) ?? null,
          estado: (r.estado as string) ?? 'reservada',
          llegada: (r.llegada as string | undefined) ?? 'pendiente',
        }
      })
      setAgenda(rows)
    }

    setLoading(false)
  }, [esProfesionalAgenda])

  useEffect(() => {
    void loadData()
  }, [loadData])

  async function cambiarEstadoAtencion(idCita: number, nuevoEstado: string) {
    setError(null)
    setSuccess(null)
    setSaving(true)

    const { error } = await supabase
      .from('citas')
      .update({ estado: nuevoEstado })
      .eq('id_cita', idCita)

    setSaving(false)

    if (error) {
      setError(error.message || 'No se pudo actualizar la atención.')
      return
    }
    setSuccess(
      nuevoEstado === 'completada'
        ? 'Atención marcada como realizada.'
        : 'Atención cancelada.',
    )
    await loadData()
  }

  function nombreEspecialidad(h: HorarioDisponible): string {
    const e = asSingle(h.especialidades)
    return e?.nombre ?? 'Sin especialidad'
  }

  // Clasificación de atenciones por día
  const hoy = claveHoy()
  const atencionesActuales = agenda.filter(
    (a) => a.fecha_inicio && claveDia(a.fecha_inicio) === hoy,
  )
  const atencionesAnteriores = agenda.filter(
    (a) => a.fecha_inicio && claveDia(a.fecha_inicio) < hoy,
  )
  const atencionesProximas = agenda.filter(
    (a) => a.fecha_inicio && claveDia(a.fecha_inicio) > hoy,
  )

  const listaTab: Record<TabAtenciones, AtencionAgenda[]> = {
    actuales: atencionesActuales,
    anteriores: atencionesAnteriores,
    proximas: atencionesProximas,
  }

  const listaTabActual = listaTab[tabAtenciones]
  const totalPaginasAtenciones = Math.max(1, Math.ceil(listaTabActual.length / POR_PAGINA))
  const paginaSeguraAtenciones = Math.min(paginaAtenciones, totalPaginasAtenciones)
  const atencionesPagina = listaTabActual.slice(
    (paginaSeguraAtenciones - 1) * POR_PAGINA,
    paginaSeguraAtenciones * POR_PAGINA,
  )

  /**
   * Resumen de la atención por bloque, para el tooltip al pasar el cursor.
   * Antes cada hora decía solo el estado ("disponible"); la especificación
   * pide que muestre de quién es la atención. Ver AGENTS.md, Fase 8 punto 29.
   */
  const resumenPorHorario = useMemo(() => {
    const mapa = new Map<number, string>()
    for (const a of agenda) {
      if (!a.fecha_inicio) continue
      const partes = [
        a.especialidad,
        a.paciente_nombre,
        a.motivo ? `Motivo: ${a.motivo}` : 'Sin motivo registrado',
        `Estado: ${ESTADO_LABEL[a.estado] ?? a.estado}`,
        a.llegada === 'en_sala'
          ? 'Llegó'
          : a.llegada === 'tarde'
            ? 'Llegó tarde'
            : a.llegada === 'no_llego'
              ? 'No llegó'
              : null,
      ].filter(Boolean)
      mapa.set(a.id_horario, partes.join(' · '))
    }
    return mapa
  }, [agenda])

  function titleBloque(h: HorarioDisponible): string {
    const resumen = resumenPorHorario.get(h.id_horario)
    const base = `${formatHoraMin(h.fecha_inicio)} · ${nombreEspecialidad(h)} · ${ESTADO_LABEL[h.estado] ?? h.estado}`
    // Si la jefatura deshabilitó la hora, el profesional tiene que ver por qué:
    // si no solo ve un bloque gris y parece un error del sistema.
    const bloqueo =
      h.estado === 'bloqueada' && h.motivo_bloqueo
        ? `\nDeshabilitada por la jefatura: ${h.motivo_bloqueo}`
        : ''
    const cuerpo = resumen ? `\n${resumen}` : ''
    return `${base}${bloqueo}${cuerpo}`
  }

  // Filtro de bloques publicados
  const horariosFiltrados = horarios.filter((h) => {
    if (!busquedaBloques.trim()) return true
    const q = busquedaBloques.trim().toLowerCase()
    return (
      formatFechaCorta(h.fecha_inicio).toLowerCase().includes(q) ||
      nombreEspecialidad(h).toLowerCase().includes(q) ||
      h.estado.toLowerCase().includes(q)
    )
  })

  // Agrupar los bloques por día + especialidad (jornada propia)
  type GrupoJornada = {
    fecha: string
    idEspecialidad: number
    especialidad: string
    bloques: HorarioDisponible[]
    rangoHorario: string
  }
  const gruposJornada: GrupoJornada[] = (() => {
    const mapa = new Map<string, GrupoJornada>()
    for (const h of horariosFiltrados) {
      const idEsp = h.id_especialidad ?? 0
      const k = `${claveDia(h.fecha_inicio)}|${idEsp}`
      let g = mapa.get(k)
      if (!g) {
        g = {
          fecha: claveDia(h.fecha_inicio),
          idEspecialidad: idEsp,
          especialidad: nombreEspecialidad(h),
          bloques: [],
          rangoHorario: '',
        }
        mapa.set(k, g)
      }
      g.bloques.push(h)
    }
    // Un mismo día puede tener más de una carga. Se etiqueta cada una con su
    // rango horario para que no se lean como una sola.
    for (const g of mapa.values()) {
      const horas = g.bloques.map((b) => b.fecha_inicio).sort()
      g.rangoHorario = `${formatHoraMin(horas[0])} – ${formatHoraMin(horas[horas.length - 1])}`
    }
    return Array.from(mapa.values()).sort((a, b) =>
      a.fecha === b.fecha
        ? a.rangoHorario.localeCompare(b.rangoHorario)
        : a.fecha.localeCompare(b.fecha),
    )
  })()

  const totalPaginasBloques = Math.max(1, Math.ceil(gruposJornada.length / POR_PAGINA))
  const paginaSeguraBloques = Math.min(paginaBloques, totalPaginasBloques)
  const gruposPagina = gruposJornada.slice(
    (paginaSeguraBloques - 1) * POR_PAGINA,
    paginaSeguraBloques * POR_PAGINA,
  )

  function estadoJornada(g: GrupoJornada): { label: string; cls: string } {
    const disponibles = g.bloques.filter((b) => b.estado === 'disponible').length
    if (disponibles === g.bloques.length) return { label: 'Disponible', cls: 'jornada-ok' }
    if (disponibles === 0) return { label: 'Completa', cls: 'jornada-agotada' }
    return { label: 'Parcial', cls: 'jornada-parcial' }
  }

  return (
    <div className="dash">
      <Sidebar moduloActivo="agenda" />

      <div className="dash-main">
        <header className="dash-topbar">
          <div>
            <h2>Mi agenda</h2>
            <p>Tus horas y tus atenciones</p>
          </div>
        </header>

        <section className="dash-content">
          {error ? (
            <p className="dash-alert dash-alert-error" role="alert">
              {error}
            </p>
          ) : null}
          {success ? (
            <p className="dash-alert dash-alert-success" role="status">
              {success}
            </p>
          ) : null}

          {!esProfesionalAgenda ? (
            <div className="dash-card">
              <div className="dash-card-header">
                <div>
                  <h3>Mi agenda</h3>
                  <p className="dash-muted">
                    Tu jornada es publicada y administrada por la jefatura del área o
                    el administrador de sistema, desde el módulo Jornadas.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="dash-card">
                <div className="dash-card-header">
                  <div>
                    <h3>Atenciones</h3>
                    <p className="dash-muted">
                      Consultas y procedimientos agendados para ti
                    </p>
                  </div>
                </div>

                <div className="agenda-tabs" role="tablist">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tabAtenciones === 'actuales'}
                    className={`agenda-tab${tabAtenciones === 'actuales' ? ' is-active' : ''}`}
                    onClick={() => {
                      setTabAtenciones('actuales')
                      setPaginaAtenciones(1)
                    }}
                  >
                    Actuales ({atencionesActuales.length})
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tabAtenciones === 'anteriores'}
                    className={`agenda-tab${tabAtenciones === 'anteriores' ? ' is-active' : ''}`}
                    onClick={() => {
                      setTabAtenciones('anteriores')
                      setPaginaAtenciones(1)
                    }}
                  >
                    Anteriores ({atencionesAnteriores.length})
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tabAtenciones === 'proximas'}
                    className={`agenda-tab${tabAtenciones === 'proximas' ? ' is-active' : ''}`}
                    onClick={() => {
                      setTabAtenciones('proximas')
                      setPaginaAtenciones(1)
                    }}
                  >
                    Próximas ({atencionesProximas.length})
                  </button>
                </div>

                {loading ? (
                  <p className="dash-loading">Cargando atenciones…</p>
                ) : listaTabActual.length === 0 ? (
                  <p className="dash-empty">
                    No hay atenciones en esta categoría.
                  </p>
                ) : (
                  <div className="dash-table-wrap">
                    <table className="dash-table">
                      <thead>
                        <tr>
                          <th>Fecha y hora</th>
                          <th>Paciente</th>
                          <th>RUT</th>
                          <th>Especialidad</th>
                          <th>Motivo</th>
                          <th>Estado</th>
                          <th>Llegada</th>
                          <th>Acción</th>
                        </tr>
                      </thead>
                      <tbody>
                        {atencionesPagina.map((a) => (
                          <tr key={a.id_cita}>
                            <td>{formatFechaCorta(a.fecha_inicio)}</td>
                            <td>{a.paciente_nombre}</td>
                            <td>{a.rut || '—'}</td>
                            <td>{a.especialidad}</td>
                            <td>{a.motivo ?? '—'}</td>
                            <td>
                              <span className="dash-badge">
                                {ESTADO_LABEL[a.estado] ?? a.estado}
                              </span>
                            </td>
                            <td>
                              <span className={`agenda-llegada agenda-llegada-${a.llegada}`}>
                                {a.llegada === 'en_sala'
                                  ? 'En sala'
                                  : a.llegada === 'tarde'
                                    ? 'Llegó tarde'
                                    : a.llegada === 'no_llego'
                                      ? 'No llegó'
                                      : 'Sin registro'}
                              </span>
                            </td>
                            <td>
                              <div className="agenda-acciones">
                                <button
                                  type="button"
                                  className="dash-btn-secondary"
                                  onClick={() => navigate(`/expediente/${a.id_paciente}`)}
                                  title="Abrir el expediente del paciente"
                                >
                                  {tabAtenciones === 'actuales'
                                    ? 'Comenzar atención'
                                    : 'Ver expediente'}
                                </button>
                                {tabAtenciones !== 'anteriores' && a.estado === 'reservada' ? (
                                  <>
                                    <button
                                      type="button"
                                      className="dash-btn-primary"
                                      disabled={saving}
                                      onClick={() =>
                                        void cambiarEstadoAtencion(a.id_cita, 'completada')
                                      }
                                    >
                                      Realizada
                                    </button>
                                    <button
                                      type="button"
                                      className="dash-btn-danger"
                                      disabled={saving}
                                      onClick={() =>
                                        void cambiarEstadoAtencion(a.id_cita, 'cancelada')
                                      }
                                    >
                                      No asistió
                                    </button>
                                  </>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {totalPaginasAtenciones > 1 ? (
                      <div className="dash-pagination">
                        <button
                          type="button"
                          className="dash-btn-secondary"
                          disabled={paginaSeguraAtenciones <= 1}
                          onClick={() => setPaginaAtenciones(paginaSeguraAtenciones - 1)}
                        >
                          Anterior
                        </button>
                        <span className="dash-muted">
                          Página {paginaSeguraAtenciones} de {totalPaginasAtenciones}
                        </span>
                        <button
                          type="button"
                          className="dash-btn-secondary"
                          disabled={paginaSeguraAtenciones >= totalPaginasAtenciones}
                          onClick={() => setPaginaAtenciones(paginaSeguraAtenciones + 1)}
                        >
                          Siguiente
                        </button>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>

              <div className="dash-card">
                <div className="dash-card-header">
                  <div>
                    <h3>Mis horas</h3>
                    <p className="dash-muted">
                      Disponibilidad agrupada por jornada (día). Pasa el cursor sobre una
                      hora para ver el resumen de la atención.
                    </p>
                  </div>
                  <span className="dash-badge">{gruposJornada.length} jornadas</span>
                </div>

                {loading ? (
                  <p className="dash-loading">Cargando bloques…</p>
                ) : (
                  <>
                    <div className="dash-filter-bar">
                      <input
                        className="dash-filter-input"
                        type="search"
                        placeholder="Buscar por fecha, especialidad o estado…"
                        value={busquedaBloques}
                        onChange={(e) => {
                          setBusquedaBloques(e.target.value)
                          setPaginaBloques(1)
                        }}
                      />
                      <span className="dash-muted">
                        {gruposJornada.length} jornada
                        {gruposJornada.length === 1 ? '' : 's'}
                      </span>
                    </div>
                    {gruposJornada.length === 0 ? (
                      <p className="dash-empty">No hay bloques que coincidan.</p>
                    ) : (
                      <div className="jornadas">
                        {gruposPagina.map((g) => {
                          const est = estadoJornada(g)
                          const disponibles = g.bloques.filter(
                            (b) => b.estado === 'disponible',
                          ).length
                          const reservadas = g.bloques.filter(
                            (b) => b.estado === 'reservada',
                          ).length
                          const horas = g.bloques
                            .slice()
                            .sort(
                              (a, b) =>
                                new Date(a.fecha_inicio).getTime() -
                                new Date(b.fecha_inicio).getTime(),
                            )
                          return (
                            <div key={`${g.fecha}-${g.idEspecialidad}-${g.rangoHorario}`} className="jornada">
                              <div className="jornada-header">
                                <div>
                                  <strong>
                                    {/*
                                      La clave ya es una fecha civil chilena: se
                                      interpreta en UTC para formatearla.
                                    */}
                                    {new Date(`${g.fecha}T00:00:00Z`).toLocaleDateString(
                                      'es-CL',
                                      {
                                        weekday: 'long',
                                        day: 'numeric',
                                        month: 'long',
                                        year: 'numeric',
                                        timeZone: 'UTC',
                                      },
                                    )}
                                  </strong>
                                  <span className="jornada-horario">{g.rangoHorario}</span>
                                  <span className="jornada-meta">{g.especialidad}</span>
                                </div>
                                <span className={`jornada-estado ${est.cls}`}>{est.label}</span>
                              </div>
                              <div className="jornada-resumen">
                                {disponibles > 0 ? (
                                  <span className="jornada-count jornada-count-ok">
                                    {disponibles} disponible{disponibles === 1 ? '' : 's'}
                                  </span>
                                ) : null}
                                {reservadas > 0 ? (
                                  <span className="jornada-count jornada-count-res">
                                    {reservadas} reservada{reservadas === 1 ? '' : 's'}
                                  </span>
                                ) : null}
                                <span className="jornada-count">
                                  {g.bloques.length} en total
                                </span>
                              </div>
                              <div className="jornada-horas">
                                {horas.map((h) => (
                                  <span
                                    key={h.id_horario}
                                    className={`jornada-hora${h.estado === 'disponible' ? ' is-disponible' : h.estado === 'reservada' ? ' is-reservada' : ' is-no'}${h.estado === 'bloqueada' ? ' is-bloqueada' : ''}`}
                                    title={titleBloque(h)}
                                  >
                                    {formatHoraMin(h.fecha_inicio)}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )
                        })}
                        {totalPaginasBloques > 1 ? (
                          <div className="dash-pagination">
                            <button
                              type="button"
                              className="dash-btn-secondary"
                              disabled={paginaSeguraBloques <= 1}
                              onClick={() => setPaginaBloques(paginaSeguraBloques - 1)}
                            >
                              Anterior
                            </button>
                            <span className="dash-muted">
                              Página {paginaSeguraBloques} de {totalPaginasBloques}
                            </span>
                            <button
                              type="button"
                              className="dash-btn-secondary"
                              disabled={paginaSeguraBloques >= totalPaginasBloques}
                              onClick={() => setPaginaBloques(paginaSeguraBloques + 1)}
                            >
                              Siguiente
                            </button>
                          </div>
                        ) : null}
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}

export default Agenda
