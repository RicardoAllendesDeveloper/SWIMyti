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

function Disponibilidad() {
  const navigate = useNavigate()
  const { rol } = useAuthRol()

  const [especialidades, setEspecialidades] = useState<Especialidad[]>([])
  const [horarios, setHorarios] = useState<HorarioDisponible[]>([])
  const [agenda, setAgenda] = useState<
    {
      id_cita: number
      id_horario: number
      id_paciente: number
      fecha_inicio: string
      paciente_nombre: string
      rut: string
      especialidad: string
      motivo: string | null
    }[]
  >([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [especialidad, setEspecialidad] = useState('')
  const [fechaInicio, setFechaInicio] = useState('')
  const [fechaFin, setFechaFin] = useState('')

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

    if (user && rol === 'doctor') {
      horQuery = horQuery.eq('id_profesional', user.id)
    }

    const horRes = await horQuery
    if (horRes.error) {
      setError(horRes.error.message || 'No se pudieron cargar los horarios.')
    } else {
      setHorarios((horRes.data ?? []) as unknown as HorarioDisponible[])
    }

    // Agenda de atenciones: citas activas del doctor (o todas para admin)
    if (user) {
      let agQuery = supabase
        .from('citas')
        .select(
          `
          id_cita,
          id_horario,
          id_paciente,
          motivo,
          horarios_disponibles (
            id_profesional,
            fecha_inicio,
            especialidades ( nombre )
          ),
          pacientes ( nombres, apellidos, rut )
        `,
        )
        .eq('estado', 'reservada')
        .order('created_at', { ascending: true })

      if (rol === 'doctor') {
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
            fecha_inicio: h?.fecha_inicio as string,
            paciente_nombre: pac
              ? `${pac.apellidos ?? ''}, ${pac.nombres ?? ''}`.trim()
              : `Paciente #${r.id_paciente}`,
            rut: (pac?.rut as string) ?? '',
            especialidad: (esp?.nombre as string) ?? 'Sin especialidad',
            motivo: (r.motivo as string | null) ?? null,
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

  function nombreEspecialidad(h: HorarioDisponible): string {
    const e = asSingle(h.especialidades)
    return e?.nombre ?? 'Sin especialidad'
  }

  return (
    <div className="dash">
      <Sidebar moduloActivo="disponibilidad" />

      <div className="dash-main">
        <header className="dash-topbar">
          <div>
            <h2>Disponibilidad de horas</h2>
            <p>Publica bloques de atención para la toma de horas</p>
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
                <h3>Agenda de atenciones</h3>
                <p className="dash-muted">
                  Pacientes que tienes agendados para atender
                </p>
              </div>
              <span className="dash-badge">{agenda.length}</span>
            </div>

            {loading ? (
              <p className="dash-loading">Cargando agenda…</p>
            ) : agenda.length === 0 ? (
              <p className="dash-empty">
                No tienes citas agendadas por atender.
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
                      <th>Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agenda.map((a) => (
                      <tr key={a.id_cita}>
                        <td>{formatFechaCorta(a.fecha_inicio)}</td>
                        <td>{a.paciente_nombre}</td>
                        <td>{a.rut || '—'}</td>
                        <td>{a.especialidad}</td>
                        <td>{a.motivo ?? '—'}</td>
                        <td>
                          <button
                            type="button"
                            className="dash-btn-secondary"
                            onClick={() => navigate(`/pacientes`)}
                            title="Ver detalle del paciente"
                          >
                            Ver paciente
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
            ) : horarios.length === 0 ? (
              <p className="dash-empty">No hay bloques publicados todavía.</p>
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
                    {horarios.map((h) => {
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
                            <span className="dash-badge">{h.estado}</span>
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
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

export default Disponibilidad