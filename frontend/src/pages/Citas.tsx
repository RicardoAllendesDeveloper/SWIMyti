import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../services/supabase'
import { useAuthRol } from '../context/AuthRolContext'
import Sidebar from '../components/Sidebar'
import {
  puedeReservar,
  puedeGestionarCitas,
} from '../utils/permisos'
import type { Especialidad, HorarioDisponible } from '../types/database'
import '../styles/Citas.css'

function formatFechaHora(value: string): string {
  try {
    return new Intl.DateTimeFormat('es-CL', {
      dateStyle: 'full',
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

function Citas() {
  const { rol } = useAuthRol()
  const [especialidades, setEspecialidades] = useState<Especialidad[]>([])
  const [especialidadFiltro, setEspecialidadFiltro] = useState('')
  const [horarios, setHorarios] = useState<HorarioDisponible[]>([])
  const [pacientes, setPacientes] = useState<{ id_paciente: number; nombres: string; apellidos: string; rut: string }[]>([])
  const [idPacienteGestion, setIdPacienteGestion] = useState('')
  const [misCitas, setMisCitas] = useState<{ id_cita: number; id_horario: number; fecha_inicio: string }[]>([])
  const [citasGestion, setCitasGestion] = useState<
    { id_cita: number; id_horario: number; id_paciente: number; fecha_inicio: string; paciente_nombre: string; estado: string }[]
  >([])
  const [loading, setLoading] = useState(true)
  const [reservando, setReservando] = useState<number | null>(null)
  const [cancelando, setCancelando] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const gestiona = puedeGestionarCitas(rol)

  const cargarEspecialidades = useCallback(async () => {
    const { data, error } = await supabase
      .from('especialidades')
      .select('id_especialidad, nombre')
      .eq('activo', true)
      .order('nombre', { ascending: true })
    if (!error) {
      setEspecialidades((data ?? []) as Especialidad[])
    }
  }, [])

  const cargarHorarios = useCallback(async () => {
    let query = supabase
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
      .eq('estado', 'disponible')
      .gte('fecha_inicio', new Date().toISOString())
      .order('fecha_inicio', { ascending: true })

    if (especialidadFiltro) {
      query = query.eq('id_especialidad', Number(especialidadFiltro))
    }

    const { data, error } = await query
    if (error) {
      setError(error.message || 'No se pudieron cargar los horarios.')
      setHorarios([])
      return
    }
    setHorarios((data ?? []) as unknown as HorarioDisponible[])
  }, [especialidadFiltro])

  const cargarMisCitas = useCallback(async () => {
    if (gestiona) {
      // Admin/administrativo: ven todas las citas reservadas para gestión
      const [citasRes, pacRes] = await Promise.all([
        supabase
          .from('citas')
          .select(
            `
            id_cita,
            id_horario,
            id_paciente,
            estado,
            horarios_disponibles ( fecha_inicio ),
            pacientes ( nombres, apellidos )
          `,
          )
          .eq('estado', 'reservada')
          .order('created_at', { ascending: false }),
        supabase
          .from('pacientes')
          .select('id_paciente, nombres, apellidos, rut')
          .eq('activo', true)
          .order('apellidos', { ascending: true }),
      ])

      if (!pacRes.error) {
        setPacientes((pacRes.data ?? []) as { id_paciente: number; nombres: string; apellidos: string; rut: string }[])
      }

      if (!citasRes.error) {
        const rows = (citasRes.data ?? []).map((r) => {
          const pac = asSingle(r.pacientes)
          return {
            id_cita: r.id_cita as number,
            id_horario: r.id_horario as number,
            id_paciente: r.id_paciente as number,
            fecha_inicio: asSingle(r.horarios_disponibles)?.fecha_inicio as string,
            paciente_nombre: pac
              ? `${pac.apellidos ?? ''}, ${pac.nombres ?? ''}`.trim()
              : `Paciente #${r.id_paciente}`,
            estado: r.estado as string,
          }
        })
        setCitasGestion(rows)
        setMisCitas([])
      }
      return
    }

    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return

    const { data, error } = await supabase
      .from('citas')
      .select(
        `
        id_cita,
        id_horario,
        horarios_disponibles ( fecha_inicio )
      `,
      )
      .eq('estado', 'reservada')

    if (!error) {
      const rows = (data ?? []).map((r) => ({
        id_cita: r.id_cita as number,
        id_horario: r.id_horario as number,
        fecha_inicio: asSingle(r.horarios_disponibles)?.fecha_inicio as string,
      }))
      setMisCitas(rows)
    }
  }, [gestiona])

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    await Promise.all([cargarEspecialidades(), cargarHorarios(), cargarMisCitas()])
    setLoading(false)
  }, [cargarEspecialidades, cargarHorarios, cargarMisCitas])

  useEffect(() => {
    void loadData()
  }, [loadData])

  useEffect(() => {
    void cargarHorarios()
  }, [cargarHorarios])

  async function reservar(idHorario: number) {
    setError(null)
    setSuccess(null)
    setReservando(idHorario)

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        setError('Debes iniciar sesión para reservar una hora.')
        return
      }

      let idPacienteFinal: number | null = null

      if (gestiona) {
        // Admin/administrativo: reservan en nombre de un paciente seleccionado
        if (!idPacienteGestion) {
          setError('Selecciona un paciente para reservar en su nombre.')
          return
        }
        idPacienteFinal = Number(idPacienteGestion)
      } else {
        // Paciente: usa su perfil vinculado
        const { data: pac, error: pacError } = await supabase
          .from('pacientes')
          .select('id_paciente')
          .eq('id_usuario_portal', user.id)
          .maybeSingle()

        if (pacError || !pac) {
          setError(
            'No tienes un perfil de paciente vinculado. Completa tu registro en la landing.',
          )
          return
        }
        idPacienteFinal = pac.id_paciente
      }

      const { error: insertError } = await supabase.from('citas').insert({
        id_horario: idHorario,
        id_paciente: idPacienteFinal,
        motivo: null,
        estado: 'reservada',
      })

      if (insertError) {
        setError(
          insertError.message.includes('ya no está disponible')
            ? 'Ese horario acaba de ser reservado. Elige otro.'
            : insertError.message || 'No se pudo reservar la hora.',
        )
        return
      }

      setSuccess('¡Hora reservada correctamente! Puedes verla en tu portal.')
      await loadData()
    } catch {
      setError('Error inesperado al reservar la hora.')
    } finally {
      setReservando(null)
    }
  }

  async function cancelarCitaGestion(idCita: number) {
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

  function nombreProfesional(h: HorarioDisponible): string {
    const u = asSingle(h.usuarios)
    if (u && (u.nombres || u.apellidos)) {
      return `${u.nombres ?? ''} ${u.apellidos ?? ''}`.trim()
    }
    return 'Profesional'
  }

  function nombreEspecialidad(h: HorarioDisponible): string {
    const e = asSingle(h.especialidades)
    return e?.nombre ?? 'Sin especialidad'
  }

  const yaReservado = (idHorario: number) =>
    misCitas.some((c) => c.id_horario === idHorario)

  return (
    <div className="dash">
      <Sidebar moduloActivo="citas" />

      <div className="dash-main">
        <header className="dash-topbar">
          <div>
            <h2>Toma de horas</h2>
            <p>Reserva tu atención por especialidad y profesional</p>
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
                <h3>Horas disponibles</h3>
                <p className="dash-muted">
                  Bloques publicados por los profesionales
                </p>
              </div>
              <select
                className="citas-filtro"
                value={especialidadFiltro}
                onChange={(e) => setEspecialidadFiltro(e.target.value)}
                aria-label="Filtrar por especialidad"
              >
                <option value="">Todas las especialidades</option>
                {especialidades.map((e) => (
                  <option key={e.id_especialidad} value={String(e.id_especialidad)}>
                    {e.nombre}
                  </option>
                ))}
              </select>
              {gestiona ? (
                <select
                  className="citas-filtro"
                  value={idPacienteGestion}
                  onChange={(e) => setIdPacienteGestion(e.target.value)}
                  aria-label="Paciente para reservar"
                >
                  <option value="">Paciente…</option>
                  {pacientes.map((p) => (
                    <option key={p.id_paciente} value={String(p.id_paciente)}>
                      {p.nombres} {p.apellidos} - {p.rut}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>

            {loading ? (
              <p className="dash-loading">Cargando horarios…</p>
            ) : horarios.length === 0 ? (
              <p className="dash-empty">
                No hay horas disponibles con los filtros actuales. Vuelve pronto.
              </p>
            ) : (
              <div className="dash-table-wrap">
                <table className="dash-table">
                  <thead>
                    <tr>
                      <th>Fecha y hora</th>
                      <th>Profesional</th>
                      <th>Especialidad</th>
                      <th>Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {horarios.map((h) => {
                      const reservado = yaReservado(h.id_horario)
                      return (
                        <tr key={h.id_horario}>
                          <td>{formatFechaHora(h.fecha_inicio)}</td>
                          <td>{nombreProfesional(h)}</td>
                          <td>{nombreEspecialidad(h)}</td>
                          <td>
                            <button
                              type="button"
                              className="dash-btn-primary"
                              onClick={() => void reservar(h.id_horario)}
                              disabled={
                                reservando === h.id_horario ||
                                reservado ||
                                !puedeReservar(rol)
                              }
                            >
                              {reservando === h.id_horario
                                ? 'Reservando…'
                                : reservado
                                  ? 'Ya reservada'
                                  : 'Reservar'}
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {gestiona ? (
            <div className="dash-card">
              <div className="dash-card-header">
                <div>
                  <h3>Citas reservadas (gestión)</h3>
                  <p className="dash-muted">
                    Administrativo: cancela o reagenda las citas de los pacientes
                  </p>
                </div>
                <span className="dash-badge">{citasGestion.length}</span>
              </div>

              {loading ? (
                <p className="dash-loading">Cargando citas…</p>
              ) : citasGestion.length === 0 ? (
                <p className="dash-empty">
                  No hay citas reservadas actualmente.
                </p>
              ) : (
                <div className="dash-table-wrap">
                  <table className="dash-table">
                    <thead>
                      <tr>
                        <th>Paciente</th>
                        <th>Fecha y hora</th>
                        <th>Estado</th>
                        <th>Acción</th>
                      </tr>
                    </thead>
                    <tbody>
                      {citasGestion.map((c) => (
                        <tr key={c.id_cita}>
                          <td>{c.paciente_nombre}</td>
                          <td>{formatFechaHora(c.fecha_inicio)}</td>
                          <td>
                            <span className="dash-badge">{c.estado}</span>
                          </td>
                          <td>
                            <button
                              type="button"
                              className="dash-btn-secondary"
                              onClick={() => void cancelarCitaGestion(c.id_cita)}
                              disabled={cancelando === c.id_cita}
                            >
                              {cancelando === c.id_cita ? 'Cancelando…' : 'Cancelar'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : null}
        </section>
      </div>
    </div>
  )
}

export default Citas