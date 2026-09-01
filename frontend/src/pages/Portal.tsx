import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../services/supabase'
import Sidebar from '../components/Sidebar'
import type { AnexoClinico, Cita, FichaMedica } from '../types/database'
import '../styles/Portal.css'

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

function formatFecha(value: string): string {
  try {
    return new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium' }).format(new Date(value))
  } catch {
    return value
  }
}

function asSingle<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

function Portal() {
  const navigate = useNavigate()

  const [citas, setCitas] = useState<Cita[]>([])
  const [fichas, setFichas] = useState<FichaMedica[]>([])
  const [anexos, setAnexos] = useState<AnexoClinico[]>([])
  const [pacienteNombre, setPacienteNombre] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cancelando, setCancelando] = useState<number | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      setError('Sesión no válida.')
      setLoading(false)
      return
    }

    // Datos del paciente vinculado
    const { data: pac, error: pacError } = await supabase
      .from('pacientes')
      .select('id_paciente, nombres, apellidos')
      .eq('id_usuario_portal', user.id)
      .maybeSingle()

    if (pacError || !pac) {
      setError(
        'Tu cuenta no tiene un perfil de paciente vinculado. Contacta a administración.',
      )
      setLoading(false)
      return
    }

    setPacienteNombre(`${pac.nombres} ${pac.apellidos}`)

    // Citas (solo futuras activas)
    const [citasRes, fichasRes, anexosRes] = await Promise.all([
      supabase
        .from('citas')
        .select(
          `
          id_cita,
          id_horario,
          id_paciente,
          motivo,
          estado,
          horarios_disponibles ( fecha_inicio, fecha_fin, especialidades ( nombre ) )
        `,
        )
        .eq('id_paciente', pac.id_paciente)
        .neq('estado', 'cancelada')
        .order('created_at', { ascending: false }),
      supabase
        .from('fichas_medicas')
        .select(
          `
          id_ficha,
          id_paciente,
          motivo_consulta,
          diagnostico,
          created_at
        `,
        )
        .eq('id_paciente', pac.id_paciente)
        .order('created_at', { ascending: false }),
      supabase
        .from('anexos_clinicos')
        .select(
          `
          id_anexo,
          id_ficha,
          nombre_archivo,
          tipo_mime,
          url_documento,
          descripcion,
          tipo_anexo,
          created_at
        `,
        )
        .in(
          'id_ficha',
          (
            await supabase
              .from('fichas_medicas')
              .select('id_ficha')
              .eq('id_paciente', pac.id_paciente)
          ).data?.map((f) => f.id_ficha as number) ?? [],
        )
        .order('created_at', { ascending: false }),
    ])

    if (citasRes.error) {
      setError(citasRes.error.message)
    } else {
      setCitas((citasRes.data ?? []) as unknown as Cita[])
    }

    if (fichasRes.error) {
      setError((e) => e ?? fichasRes.error!.message)
    } else {
      setFichas((fichasRes.data ?? []) as FichaMedica[])
    }

    if (anexosRes.error) {
      setError((e) => e ?? anexosRes.error!.message)
    } else {
      setAnexos((anexosRes.data ?? []) as AnexoClinico[])
    }

    setLoading(false)
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  async function cancelarCita(idCita: number) {
    setError(null)
    setSuccess(null)
    setCancelando(idCita)

    const { error } = await supabase
      .from('citas')
      .update({ estado: 'cancelada' })
      .eq('id_cita', idCita)

    setCancelando(null)

    if (error) {
      setError(error.message || 'No se pudo cancelar la cita.')
      return
    }

    setSuccess('Cita cancelada. El horario vuelve a estar disponible.')
    await loadData()
  }

  function especialidadCita(cita: Cita): string {
    const h = cita.horarios_disponibles
    const e = h ? asSingle(h.especialidades) : null
    return e?.nombre ?? 'Sin especialidad'
  }

  return (
    <div className="dash">
      <Sidebar moduloActivo="portal" />

      <div className="dash-main">
        <header className="dash-topbar">
          <div>
            <h2>Mi portal de salud</h2>
            <p>{pacienteNombre ? `Bienvenido(a), ${pacienteNombre}` : 'Portal del paciente'}</p>
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

          {loading ? (
            <p className="dash-loading">Cargando tu información…</p>
          ) : (
            <div className="portal-grid">
              <div className="dash-card">
                <div className="dash-card-header">
                  <div>
                    <h3>Mis citas</h3>
                    <p className="dash-muted">Próximas atenciones agendadas</p>
                  </div>
                  <span className="dash-badge">{citas.length}</span>
                </div>
                {citas.length === 0 ? (
                  <p className="dash-empty">No tienes citas. Reserva una hora.</p>
                ) : (
                  <ul className="portal-list">
                    {citas.map((cita) => (
                      <li key={cita.id_cita} className="portal-item">
                        <div>
                          <strong>{especialidadCita(cita)}</strong>
                          <p className="portal-muted">
                            {cita.horarios_disponibles
                              ? formatFechaHora(cita.horarios_disponibles.fecha_inicio)
                              : '—'}
                          </p>
                          <p className="portal-muted">
                            Estado: <span className="portal-estado">{cita.estado}</span>
                          </p>
                        </div>
                        {cita.estado === 'reservada' ? (
                          <button
                            type="button"
                            className="dash-btn-secondary"
                            onClick={() => void cancelarCita(cita.id_cita)}
                            disabled={cancelando === cita.id_cita}
                          >
                            {cancelando === cita.id_cita ? 'Cancelando…' : 'Cancelar'}
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="dash-card">
                <div className="dash-card-header">
                  <div>
                    <h3>Mis fichas médicas</h3>
                    <p className="dash-muted">Historial clínico (solo lectura)</p>
                  </div>
                  <span className="dash-badge">{fichas.length}</span>
                </div>
                {fichas.length === 0 ? (
                  <p className="dash-empty">Aún no tienes fichas médicas.</p>
                ) : (
                  <ul className="portal-list">
                    {fichas.map((ficha) => (
                      <li key={ficha.id_ficha} className="portal-item">
                        <div>
                          <strong>Ficha #{ficha.id_ficha}</strong>
                          <p className="portal-muted">{formatFecha(ficha.created_at)}</p>
                          <p className="portal-text">{ficha.diagnostico}</p>
                        </div>
                        <button
                          type="button"
                          className="dash-btn-secondary"
                          onClick={() => navigate(`/ficha/${ficha.id_ficha}`)}
                        >
                          Ver
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="dash-card portal-card-full">
                <div className="dash-card-header">
                  <div>
                    <h3>Mis exámenes y anexos</h3>
                    <p className="dash-muted">Resultados y documentos clínicos</p>
                  </div>
                  <span className="dash-badge">{anexos.length}</span>
                </div>
                {anexos.length === 0 ? (
                  <p className="dash-empty">No tienes exámenes registrados.</p>
                ) : (
                  <div className="dash-table-wrap">
                    <table className="dash-table">
                      <thead>
                        <tr>
                          <th>Documento</th>
                          <th>Tipo</th>
                          <th>Fecha</th>
                          <th>Acción</th>
                        </tr>
                      </thead>
                      <tbody>
                        {anexos.map((anexo) => (
                          <tr key={anexo.id_anexo}>
                            <td>{anexo.nombre_archivo}</td>
                            <td>{anexo.tipo_anexo ?? anexo.tipo_mime ?? '—'}</td>
                            <td>{formatFecha(anexo.created_at)}</td>
                            <td>
                              <a
                                className="dash-btn-secondary"
                                href={anexo.url_documento}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Descargar
                              </a>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

export default Portal