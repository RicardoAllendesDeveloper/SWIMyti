import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../services/supabase'
import { useAuthRol } from '../context/AuthRolContext'
import Sidebar from '../components/Sidebar'
import { puedeSolicitarInterconsulta } from '../utils/permisos'
import type { Interconsulta, Paciente } from '../types/database'
import '../styles/Interconsultas.css'

function formatFecha(value: string): string {
  try {
    return new Intl.DateTimeFormat('es-CL', {
      dateStyle: 'medium',
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

const ESTADO_LABEL: Record<string, string> = {
  pendiente: 'Pendiente',
  confirmada: 'Confirmada',
  rechazada: 'Rechazada',
  atendida: 'Atendida',
  cancelada: 'Cancelada',
}

function Interconsultas() {
  const { rol } = useAuthRol()
  const [listado, setListado] = useState<Interconsulta[]>([])
  const [pacientes, setPacientes] = useState<Paciente[]>([])
  const [doctores, setDoctores] = useState<{ id_usuario: string; nombres: string; apellidos: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)

  const [idPaciente, setIdPaciente] = useState('')
  const [idProfesional, setIdProfesional] = useState('')
  const [especialidad, setEspecialidad] = useState('')
  const [motivo, setMotivo] = useState('')

  const esSolicitante = puedeSolicitarInterconsulta(rol)
  const esPaciente = rol === 'paciente'

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)

    // Pacientes visibles (para el formulario de solicitud)
    const pacientesRes = await supabase
      .from('pacientes')
      .select('id_paciente, rut, nombres, apellidos')
      .eq('activo', true)
      .order('apellidos', { ascending: true })
    if (!pacientesRes.error) {
      setPacientes((pacientesRes.data ?? []) as Paciente[])
    }

    // Doctores (roles con rol doctor) para el destino
    const doctoresRes = await supabase
      .from('usuarios')
      .select('id_usuario, nombres, apellidos, roles!inner(nombre_rol)')
      .eq('roles.nombre_rol', 'doctor')
      .eq('activo', true)
      .order('apellidos', { ascending: true })
    if (!doctoresRes.error) {
      setDoctores(
        (doctoresRes.data ?? []).map((d) => ({
          id_usuario: d.id_usuario as string,
          nombres: d.nombres as string,
          apellidos: d.apellidos as string,
        })),
      )
    }

    // Listado según rol
    let query = supabase
      .from('interconsultas')
      .select(
        `
        id_interconsulta,
        id_paciente,
        id_solicitante,
        id_profesional,
        especialidad,
        motivo,
        estado,
        respuesta,
        created_at,
        pacientes ( nombres, apellidos, rut ),
        solicitante:id_solicitante ( nombres, apellidos ),
        profesional:id_profesional ( nombres, apellidos )
      `,
      )
      .order('created_at', { ascending: false })

    if (esPaciente) {
      // El paciente solo ve las suyas (RLS ya lo filtra)
    } else if (rol === 'doctor') {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (user) query = query.eq('id_profesional', user.id)
    }

    const { data, error } = await query
    if (error) {
      setError(error.message || 'No se pudieron cargar las interconsultas.')
      setListado([])
    } else {
      setListado((data ?? []) as unknown as Interconsulta[])
    }

    setLoading(false)
  }, [rol, esPaciente])

  useEffect(() => {
    void loadData()
  }, [loadData])

  function openForm() {
    setError(null)
    setSuccess(null)
    setMotivo('')
    setIdPaciente('')
    setIdProfesional('')
    setEspecialidad('')
    setShowForm(true)
  }

  async function handleCrear(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSuccess(null)

    if (!idPaciente || !motivo.trim()) {
      setError('Paciente y motivo son obligatorios.')
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
    const { error: insertError } = await supabase.from('interconsultas').insert({
      id_paciente: Number(idPaciente),
      id_solicitante: user.id,
      id_profesional: idProfesional ? idProfesional : null,
      especialidad: especialidad.trim() || null,
      motivo: motivo.trim(),
      estado: 'pendiente',
    })
    setSaving(false)

    if (insertError) {
      setError(insertError.message || 'No se pudo crear la interconsulta.')
      return
    }

    setSuccess('Interconsulta solicitada. El paciente debe confirmarla.')
    setShowForm(false)
    await loadData()
  }

  async function cambiarEstado(
    id: number,
    nuevoEstado: Interconsulta['estado'],
    respuesta?: string,
  ) {
    setError(null)
    setSuccess(null)

    const patch: Record<string, unknown> = { estado: nuevoEstado }
    if (respuesta !== undefined) patch.respuesta = respuesta

    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (user && (nuevoEstado === 'confirmada' || nuevoEstado === 'rechazada')) {
      patch.confirmada_por = user.id
    }

    const { error } = await supabase
      .from('interconsultas')
      .update(patch)
      .eq('id_interconsulta', id)

    if (error) {
      setError(error.message || 'No se pudo actualizar la interconsulta.')
      return
    }

    const msg: Record<string, string> = {
      confirmada: 'Interconsulta confirmada.',
      rechazada: 'Interconsulta rechazada.',
      atendida: 'Interconsulta marcada como atendida.',
      cancelada: 'Interconsulta cancelada.',
    }
    setSuccess(msg[nuevoEstado] ?? 'Interconsulta actualizada.')
    await loadData()
  }

  function nombrePaciente(i: Interconsulta): string {
    const p = i.pacientes
    if (p) return `${p.apellidos}, ${p.nombres}`
    return `Paciente #${i.id_paciente}`
  }

  function nombreDe(u?: Interconsulta['solicitante']): string {
    const x = asSingle(u)
    if (x && (x.nombres || x.apellidos)) return `${x.nombres ?? ''} ${x.apellidos ?? ''}`.trim()
    return '—'
  }

  return (
    <div className="dash">
      <Sidebar moduloActivo="interconsultas" />

      <div className="dash-main">
        <header className="dash-topbar">
          <div>
            <h2>Interconsultas</h2>
            <p>
              {esPaciente
                ? 'Confirma o rechaza tus interconsultas'
                : rol === 'doctor'
                  ? 'Interconsultas dirigidas a tu especialidad'
                  : 'Gestión de solicitudes de interconsulta'}
            </p>
          </div>
          {esSolicitante ? (
            <button type="button" className="dash-btn-primary" onClick={openForm}>
              Nueva interconsulta
            </button>
          ) : null}
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
                <h3>Solicitudes</h3>
                <p className="dash-muted">
                  Interconsultas registradas en el sistema
                </p>
              </div>
              <span className="dash-badge">
                {loading ? '…' : listado.length}
              </span>
            </div>

            {loading ? (
              <p className="dash-loading">Cargando interconsultas…</p>
            ) : listado.length === 0 ? (
              <p className="dash-empty">No hay interconsultas registradas.</p>
            ) : (
              <div className="dash-table-wrap">
                <table className="dash-table">
                  <thead>
                    <tr>
                      <th>Paciente</th>
                      <th>Motivo</th>
                      <th>Especialidad</th>
                      <th>Doctor</th>
                      <th>Estado</th>
                      <th>Fecha</th>
                      <th>Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {listado.map((i) => (
                      <tr key={i.id_interconsulta}>
                        <td>{nombrePaciente(i)}</td>
                        <td>{i.motivo}</td>
                        <td>{i.especialidad ?? '—'}</td>
                        <td>{i.id_profesional ? nombreDe(i.profesional) : '—'}</td>
                        <td>
                          <span className="dash-badge">{ESTADO_LABEL[i.estado] ?? i.estado}</span>
                        </td>
                        <td>{formatFecha(i.created_at)}</td>
                        <td>
                          {esPaciente && i.estado === 'pendiente' ? (
                            <div className="ic-acciones">
                              <button
                                type="button"
                                className="dash-btn-primary"
                                onClick={() => void cambiarEstado(i.id_interconsulta, 'confirmada')}
                              >
                                Confirmar
                              </button>
                              <button
                                type="button"
                                className="dash-btn-secondary"
                                onClick={() => void cambiarEstado(i.id_interconsulta, 'rechazada')}
                              >
                                Rechazar
                              </button>
                            </div>
                          ) : rol === 'doctor' && i.estado === 'confirmada' ? (
                            <button
                              type="button"
                              className="dash-btn-primary"
                              onClick={() => void cambiarEstado(i.id_interconsulta, 'atendida')}
                            >
                              Atender
                            </button>
                          ) : rol === 'administrador' && i.estado === 'pendiente' ? (
                            <div className="ic-acciones">
                              <button
                                type="button"
                                className="dash-btn-primary"
                                onClick={() => void cambiarEstado(i.id_interconsulta, 'confirmada')}
                              >
                                Confirmar
                              </button>
                              <button
                                type="button"
                                className="dash-btn-secondary"
                                onClick={() => void cambiarEstado(i.id_interconsulta, 'cancelada')}
                              >
                                Cancelar
                              </button>
                            </div>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </div>

      {showForm ? (
        <div
          className="dash-modal-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowForm(false)
          }}
        >
          <div
            className="dash-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="nueva-interconsulta-title"
          >
            <div className="dash-modal-header">
              <div>
                <h3 id="nueva-interconsulta-title">Nueva interconsulta</h3>
                <p>
                  Solicita una interconsulta para un paciente. El paciente deberá
                  confirmarla.
                </p>
              </div>
              <button
                type="button"
                className="dash-modal-close"
                onClick={() => setShowForm(false)}
                aria-label="Cerrar"
                disabled={saving}
              >
                ×
              </button>
            </div>

            <form className="dash-form" onSubmit={(e) => void handleCrear(e)}>
              <div className="dash-field">
                <label htmlFor="ic-paciente">Paciente</label>
                <select
                  id="ic-paciente"
                  value={idPaciente}
                  onChange={(e) => setIdPaciente(e.target.value)}
                  required
                  disabled={saving || pacientes.length === 0}
                >
                  <option value="">Selecciona un paciente</option>
                  {pacientes.map((p) => (
                    <option key={p.id_paciente} value={String(p.id_paciente)}>
                      {p.nombres} {p.apellidos} - {p.rut}
                    </option>
                  ))}
                </select>
              </div>

              <div className="dash-field">
                <label htmlFor="ic-especialidad">Especialidad (opcional)</label>
                <input
                  id="ic-especialidad"
                  type="text"
                  value={especialidad}
                  onChange={(e) => setEspecialidad(e.target.value)}
                  placeholder="Ej. Cardiología"
                  disabled={saving}
                />
              </div>

              <div className="dash-field">
                <label htmlFor="ic-doctor">Doctor destino (opcional)</label>
                <select
                  id="ic-doctor"
                  value={idProfesional}
                  onChange={(e) => setIdProfesional(e.target.value)}
                  disabled={saving || doctores.length === 0}
                >
                  <option value="">Sin asignar</option>
                  {doctores.map((d) => (
                    <option key={d.id_usuario} value={d.id_usuario}>
                      {d.nombres} {d.apellidos}
                    </option>
                  ))}
                </select>
              </div>

              <div className="dash-field">
                <label htmlFor="ic-motivo">Motivo</label>
                <textarea
                  id="ic-motivo"
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="Describe el motivo de la interconsulta"
                  required
                  disabled={saving}
                />
              </div>

              <div className="dash-form-actions">
                <button
                  type="button"
                  className="dash-btn-secondary"
                  onClick={() => setShowForm(false)}
                  disabled={saving}
                >
                  Cancelar
                </button>
                <button type="submit" className="dash-btn-primary" disabled={saving}>
                  {saving ? 'Guardando…' : 'Solicitar interconsulta'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default Interconsultas