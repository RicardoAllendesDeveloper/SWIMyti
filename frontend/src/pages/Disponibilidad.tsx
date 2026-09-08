import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../services/supabase'
import { useAuthRol } from '../context/AuthRolContext'
import Sidebar from '../components/Sidebar'
import type { Especialidad, HorarioDisponible } from '../types/database'
import '../styles/Disponibilidad.css'

function formatFechaHora(value: string): string {
  try {
    return new Intl.DateTimeFormat('es-CL', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value))
  } catch {
    return value
  }
}

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

function claveDia(value: string): string {
  const d = new Date(value)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`
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

function Disponibilidad() {
  const navigate = useNavigate()
  const { rol } = useAuthRol()

  const esProfesionalAgenda = rol === 'doctor' || rol === 'enfermeria'

  const [especialidades, setEspecialidades] = useState<Especialidad[]>([])
  const [horarios, setHorarios] = useState<HorarioDisponible[]>([])
  const [agenda, setAgenda] = useState<AtencionAgenda[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [especialidad, setEspecialidad] = useState('')
  const [fechaInicio, setFechaInicio] = useState('')
  const [fechaFin, setFechaFin] = useState('')

  const [tabAtenciones, setTabAtenciones] = useState<TabAtenciones>('actuales')
  const [busquedaBloques, setBusquedaBloques] = useState('')
  const [paginaBloques, setPaginaBloques] = useState(1)
  const POR_PAGINA = 10

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)

    const espRes = await supabase
      .from('especialidades')
      .select('id_especialidad, nombre')
      .eq('activo', true)
      .order('nombre', { ascending: true })
    if (espRes.error) {
      setError(espRes.error.message)
    } else {
      setEspecialidades((espRes.data ?? []) as Especialidad[])
    }

    const {
      data: { user },
    } = await supabase.auth.getUser()

    // Los horarios visibles: si es admin ve todos; si es doctor, los propios
    let horQuery = supabase
      .from('horarios_disponibles')
      .select(
        `
        id_horario,
        id_profesional,
        id_especialidad,
        fecha_inicio,
        fecha_fin,
        estado,
        usuarios:id_profesional ( nombres, apellidos ),
        especialidades ( nombre )
      `,
      )
      .order('fecha_inicio', { ascending: false })
      .limit(100)

    if (user && esProfesionalAgenda) {
      horQuery = horQuery.eq('id_profesional', user.id)
    }

    const horRes = await horQuery
    if (horRes.error) {
      setError(horRes.error.message || 'No se pudieron cargar los horarios.')
    } else {
      setHorarios((horRes.data ?? []) as unknown as HorarioDisponible[])
    }

    // Agenda de atenciones: todas las citas del doctor (o todas para admin)
    if (user) {
      let agQuery = supabase
        .from('citas')
        .select(
          `
          id_cita,
          id_horario,
          id_paciente,
          motivo,
          estado,
          llegada,
          horarios_disponibles (
            id_profesional,
            fecha_inicio,
            especialidades ( nombre )
          ),
          pacientes ( nombres, apellidos, rut )
        `,
        )
        .order('created_at', { ascending: true })

      if (esProfesionalAgenda) {
        agQuery = agQuery.eq('horarios_disponibles.id_profesional', user.id)
      }

      const agRes = await agQuery
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
    }

    setLoading(false)
  }, [rol])

  useEffect(() => {
    void loadData()
  }, [loadData])

  async function crearBloque(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSuccess(null)

    if (!fechaInicio || !fechaFin) {
      setError('Define la fecha/hora de inicio y fin del bloque.')
      return
    }

    const inicio = new Date(fechaInicio)
    const fin = new Date(fechaFin)
    if (fin <= inicio) {
      setError('El fin debe ser posterior al inicio.')
      return
    }

    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      setError('Sesión no válida.')
      return
    }

    setSaving(true)

    const { error: insertError } = await supabase.from('horarios_disponibles').insert({
      id_profesional: user.id,
      id_especialidad: especialidad ? Number(especialidad) : null,
      fecha_inicio: inicio.toISOString(),
      fecha_fin: fin.toISOString(),
      estado: 'disponible',
      creado_por: user.id,
    })

    setSaving(false)

    if (insertError) {
      setError(insertError.message || 'No se pudo publicar el bloque.')
      return
    }

    setSuccess('Bloque de disponibilidad publicado.')
    setFechaInicio('')
    setFechaFin('')
    setEspecialidad('')
    await loadData()
  }

  async function cancelarBloque(idHorario: number) {
    setError(null)
    setSuccess(null)
    const { error } = await supabase
      .from('horarios_disponibles')
      .update({ estado: 'cancelada' })
      .eq('id_horario', idHorario)
      .eq('estado', 'disponible')

    if (error) {
      setError(error.message || 'No se pudo cancelar el bloque.')
      return
    }
    setSuccess('Bloque cancelado.')
    await loadData()
  }

  async function verFichaPaciente(idPaciente: number) {
    navigate(`/expediente/${idPaciente}`)
  }

  async function cambiarEstadoAtencion(idCita: number, nuevoEstado: string) {
    setError(null)
    setSuccess(null)

    const { error } = await supabase
      .from('citas')
      .update({ estado: nuevoEstado })
      .eq('id_cita', idCita)

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
  const hoy = claveDia(new Date().toISOString())
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

  const [paginaAtenciones, setPaginaAtenciones] = useState(1)
  const listaTabActual = listaTab[tabAtenciones]
  const totalPaginasAtenciones = Math.max(
    1,
    Math.ceil(listaTabActual.length / POR_PAGINA),
  )
  const paginaSeguraAtenciones = Math.min(
    paginaAtenciones,
    totalPaginasAtenciones,
  )
  const atencionesPagina = listaTabActual.slice(
    (paginaSeguraAtenciones - 1) * POR_PAGINA,
    paginaSeguraAtenciones * POR_PAGINA,
  )

  // Filtro + paginación de bloques publicados
  const horariosFiltrados = horarios.filter((h) => {
    if (!busquedaBloques.trim()) return true
    const q = busquedaBloques.trim().toLowerCase()
    return (
      formatFechaHora(h.fecha_inicio).toLowerCase().includes(q) ||
      nombreEspecialidad(h).toLowerCase().includes(q) ||
      h.estado.toLowerCase().includes(q)
    )
  })
  const totalPaginasBloques = Math.max(
    1,
    Math.ceil(horariosFiltrados.length / POR_PAGINA),
  )
  const paginaSeguraBloques = Math.min(paginaBloques, totalPaginasBloques)
  const horariosPagina = horariosFiltrados.slice(
    (paginaSeguraBloques - 1) * POR_PAGINA,
    paginaSeguraBloques * POR_PAGINA,
  )

  const ESTADO_LABEL: Record<string, string> = {
    disponible: 'Disponible',
    reservada: 'Reservada',
    cancelada: 'Cancelada',
    completada: 'Completada',
  }

  return (
    <div className="dash">
      <Sidebar moduloActivo="disponibilidad" />

      <div className="dash-main">
        <header className="dash-topbar">
          <div>
            <h2>Agenda</h2>
            <p>Publica tu disponibilidad y gestiona tus atenciones</p>
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
                              onClick={() => void verFichaPaciente(a.id_paciente)}
                              title="Ver el expediente del paciente"
                            >
                              Ver expediente
                            </button>
                            {tabAtenciones !== 'anteriores' &&
                            a.estado === 'reservada' ? (
                              <>
                                <button
                                  type="button"
                                  className="dash-btn-primary"
                                  onClick={() =>
                                    void cambiarEstadoAtencion(a.id_cita, 'completada')
                                  }
                                >
                                  Realizada
                                </button>
                                <button
                                  type="button"
                                  className="dash-btn-danger"
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
                <h3>Publicar bloque</h3>
                <p className="dash-muted">
                  El profesional define cuándo está disponible para atender
                </p>
              </div>
            </div>

            <form className="dash-form" onSubmit={(e) => void crearBloque(e)}>
              <div className="dash-field">
                <label htmlFor="disp-especialidad">Especialidad</label>
                <select
                  id="disp-especialidad"
                  value={especialidad}
                  onChange={(e) => setEspecialidad(e.target.value)}
                >
                  <option value="">Sin especialidad</option>
                  {especialidades.map((e) => (
                    <option key={e.id_especialidad} value={String(e.id_especialidad)}>
                      {e.nombre}
                    </option>
                  ))}
                </select>
              </div>

              <div className="dash-row">
                <div className="dash-field">
                  <label htmlFor="disp-inicio">Fecha y hora de inicio</label>
                  <input
                    id="disp-inicio"
                    type="datetime-local"
                    value={fechaInicio}
                    onChange={(e) => setFechaInicio(e.target.value)}
                    required
                    disabled={saving}
                  />
                </div>
                <div className="dash-field">
                  <label htmlFor="disp-fin">Fecha y hora de fin</label>
                  <input
                    id="disp-fin"
                    type="datetime-local"
                    value={fechaFin}
                    onChange={(e) => setFechaFin(e.target.value)}
                    required
                    disabled={saving}
                  />
                </div>
              </div>

              <div className="dash-form-actions">
                <button
                  type="submit"
                  className="dash-btn-primary"
                  disabled={saving}
                >
                  {saving ? 'Publicando…' : 'Publicar bloque'}
                </button>
              </div>
            </form>
          </div>

          <div className="dash-card">
            <div className="dash-card-header">
              <div>
                <h3>Bloques publicados</h3>
                <p className="dash-muted">Estado actual de la disponibilidad</p>
              </div>
              <span className="dash-badge">{horarios.length}</span>
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
                    {horariosFiltrados.length} resultado
                    {horariosFiltrados.length === 1 ? '' : 's'}
                  </span>
                </div>
                {horariosFiltrados.length === 0 ? (
                  <p className="dash-empty">No hay bloques que coincidan.</p>
                ) : (
                  <div className="dash-table-wrap">
                    <table className="dash-table">
                      <thead>
                        <tr>
                          <th>Fecha</th>
                          <th>Profesional</th>
                          <th>Especialidad</th>
                          <th>Estado</th>
                          <th>Acción</th>
                        </tr>
                      </thead>
                      <tbody>
                        {horariosPagina.map((h) => {
                          const u = asSingle(h.usuarios)
                          const nombreProf = u
                            ? `${u.nombres ?? ''} ${u.apellidos ?? ''}`.trim()
                            : 'Profesional'
                          return (
                            <tr key={h.id_horario}>
                              <td>{formatFechaHora(h.fecha_inicio)}</td>
                              <td>{nombreProf}</td>
                              <td>{nombreEspecialidad(h)}</td>
                              <td>
                                <span className="dash-badge">
                                  {ESTADO_LABEL[h.estado] ?? h.estado}
                                </span>
                              </td>
                              <td>
                                {h.estado === 'disponible' ? (
                                  <button
                                    type="button"
                                    className="dash-btn-secondary"
                                    onClick={() => void cancelarBloque(h.id_horario)}
                                  >
                                    Cancelar
                                  </button>
                                ) : (
                                  '—'
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
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
        </section>
      </div>
    </div>
  )
}

export default Disponibilidad