import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../services/supabase'
import Sidebar from '../components/Sidebar'
import type { AnexoClinico, Cita, Interconsulta } from '../types/database'
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
    return new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium' }).format(
      new Date(value),
    )
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

const LLEGADA_LABEL: Record<string, string> = {
  pendiente: 'Sin confirmar llegada',
  en_sala: 'En sala de espera',
  no_llego: 'No llegó a la atención',
  tarde: 'Llegó tarde',
}

const ESTADO_INTERCONSULTA: Record<string, string> = {
  pendiente: 'Pendiente',
  confirmada: 'Confirmada',
  rechazada: 'Rechazada',
  atendida: 'Atendida',
  cancelada: 'Cancelada',
}

type Receta = {
  id_receta: number
  medicamentos: string
  indicaciones: string | null
  fecha_emision: string
}

type Certificado = {
  id_certificado: number
  tipo_certificado: string
  detalle: string | null
  fecha_emision: string
}

function Portal() {
  const [citas, setCitas] = useState<Cita[]>([])
  const [recetas, setRecetas] = useState<Receta[]>([])
  const [certificados, setCertificados] = useState<Certificado[]>([])
  const [anexos, setAnexos] = useState<AnexoClinico[]>([])
  const [interconsultas, setInterconsultas] = useState<Interconsulta[]>([])
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

    const [citasRes, recRes, certRes, anexRes, icRes] = await Promise.all([
      supabase
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
            fecha_inicio,
            fecha_fin,
            especialidades ( nombre ),
            usuarios:id_profesional ( nombres, apellidos )
          )
        `,
        )
        .eq('id_paciente', pac.id_paciente)
        .neq('estado', 'cancelada')
        .order('created_at', { ascending: false }),
      supabase
        .from('recetas_medicas')
        .select('id_receta, medicamentos, indicaciones, fecha_emision')
        .eq('id_paciente', pac.id_paciente)
        .order('fecha_emision', { ascending: false }),
      supabase
        .from('certificados_clinicos')
        .select('id_certificado, tipo_certificado, detalle, fecha_emision')
        .eq('id_paciente', pac.id_paciente)
        .order('fecha_emision', { ascending: false }),
      supabase
        .from('anexos_clinicos')
        .select(
          'id_anexo, id_paciente, nombre_archivo, descripcion, tipo_anexo, created_at',
        )
        .eq('id_paciente', pac.id_paciente)
        .order('created_at', { ascending: false }),
      supabase
        .from('interconsultas')
        .select(
          'id_interconsulta, especialidad, motivo, estado, respuesta, created_at',
        )
        .eq('id_paciente', pac.id_paciente)
        .order('created_at', { ascending: false }),
    ])

    if (citasRes.error) setError(citasRes.error.message)
    else setCitas((citasRes.data ?? []) as unknown as Cita[])

    if (!recRes.error) setRecetas((recRes.data ?? []) as Receta[])
    if (!certRes.error) setCertificados((certRes.data ?? []) as Certificado[])
    if (!anexRes.error) setAnexos((anexRes.data ?? []) as AnexoClinico[])
    if (!icRes.error) setInterconsultas((icRes.data ?? []) as Interconsulta[])

    setLoading(false)
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  async function cancelarCita(idCita: number) {
    const confirmado = window.confirm(
      '¿Está seguro/a que quiere cancelar su cita?',
    )
    if (!confirmado) return

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

  function profesionalCita(cita: Cita): string {
    const h = cita.horarios_disponibles
    const u = h ? asSingle(h.usuarios) : null
    if (u && (u.nombres || u.apellidos)) return `${u.nombres} ${u.apellidos}`.trim()
    return 'Profesional'
  }

  const hoy = claveDia(new Date().toISOString())
  const citasProximas = citas.filter(
    (c) =>
      c.horarios_disponibles &&
      claveDia(c.horarios_disponibles.fecha_inicio) >= hoy,
  )
  const citasHistorial = citas.filter(
    (c) =>
      c.horarios_disponibles &&
      claveDia(c.horarios_disponibles.fecha_inicio) < hoy,
  )

  const tipoAnexoLabel: Record<string, string> = {
    laboratorio: 'Laboratorio',
    imagenologia: 'Imagenología',
    banco_sangre: 'Banco de sangre',
    informe: 'Informe',
    otro: 'Otro',
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
              <div className="dash-card portal-card-full">
                <div className="portal-aviso portal-aviso-info">
                  <p>
                    <strong>Importante:</strong> para agilizar tu atención, preséntate
                    en el recinto <strong>15 minutos antes</strong> de la hora de tu cita
                    para el registro de llegada.
                  </p>
                </div>
              </div>

              <div className="dash-card">
                <div className="dash-card-header">
                  <div>
                    <h3>Mis próximas citas</h3>
                    <p className="dash-muted">Atenciones agendadas y su estado de llegada</p>
                  </div>
                  <span className="dash-badge">{citasProximas.length}</span>
                </div>
                {citasProximas.length === 0 ? (
                  <p className="dash-empty">No tienes citas próximas. Reserva una hora.</p>
                ) : (
                  <ul className="portal-list">
                    {citasProximas.map((cita) => (
                      <li key={cita.id_cita} className="portal-item">
                        <div>
                          <strong>
                            {especialidadCita(cita)} · {profesionalCita(cita)}
                          </strong>
                          <p className="portal-muted">
                            {cita.horarios_disponibles
                              ? formatFechaHora(cita.horarios_disponibles.fecha_inicio)
                              : '—'}
                          </p>
                          <p className="portal-muted">
                            Estado de llegada:{' '}
                            <span className="portal-estado">
                              {cita.llegada ? LLEGADA_LABEL[cita.llegada] ?? cita.llegada : 'Sin confirmar llegada'}
                            </span>
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
                    <h3>Historial de citas</h3>
                    <p className="dash-muted">Atenciones anteriores</p>
                  </div>
                  <span className="dash-badge">{citasHistorial.length}</span>
                </div>
                {citasHistorial.length === 0 ? (
                  <p className="dash-empty">No tienes atenciones anteriores.</p>
                ) : (
                  <ul className="portal-list">
                    {citasHistorial.map((cita) => (
                      <li key={cita.id_cita} className="portal-item">
                        <div>
                          <strong>
                            {especialidadCita(cita)} · {profesionalCita(cita)}
                          </strong>
                          <p className="portal-muted">
                            {cita.horarios_disponibles
                              ? formatFechaHora(cita.horarios_disponibles.fecha_inicio)
                              : '—'}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="dash-card">
                <div className="dash-card-header">
                  <div>
                    <h3>Mis interconsultas</h3>
                    <p className="dash-muted">Solicitudes de interconsulta asociadas a ti</p>
                  </div>
                  <span className="dash-badge">{interconsultas.length}</span>
                </div>
                {interconsultas.length === 0 ? (
                  <p className="dash-empty">No tienes interconsultas registradas.</p>
                ) : (
                  <ul className="portal-list">
                    {interconsultas.map((ic) => (
                      <li key={ic.id_interconsulta} className="portal-item">
                        <div>
                          <strong>{ic.especialidad ?? 'Interconsulta'}</strong>
                          <p className="portal-muted">{ic.motivo}</p>
                          <p className="portal-muted">
                            Estado:{' '}
                            <span className="portal-estado">
                              {ESTADO_INTERCONSULTA[ic.estado] ?? ic.estado}
                            </span>
                          </p>
                          {ic.respuesta ? (
                            <p className="portal-muted">Respuesta: {ic.respuesta}</p>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="dash-card">
                <div className="dash-card-header">
                  <div>
                    <h3>Mis recetas</h3>
                    <p className="dash-muted">Recetas médicas emitidas para ti</p>
                  </div>
                  <span className="dash-badge">{recetas.length}</span>
                </div>
                {recetas.length === 0 ? (
                  <p className="dash-empty">No tienes recetas registradas.</p>
                ) : (
                  <ul className="portal-list">
                    {recetas.map((r) => (
                      <li key={r.id_receta} className="portal-item">
                        <div>
                          <strong>Receta #{r.id_receta}</strong>
                          <p className="portal-muted">{r.medicamentos}</p>
                          {r.indicaciones ? (
                            <p className="portal-muted">Indicaciones: {r.indicaciones}</p>
                          ) : null}
                          <p className="portal-muted">{formatFecha(r.fecha_emision)}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="dash-card">
                <div className="dash-card-header">
                  <div>
                    <h3>Mis certificados</h3>
                    <p className="dash-muted">Certificados clínicos emitidos para ti</p>
                  </div>
                  <span className="dash-badge">{certificados.length}</span>
                </div>
                {certificados.length === 0 ? (
                  <p className="dash-empty">No tienes certificados registrados.</p>
                ) : (
                  <ul className="portal-list">
                    {certificados.map((c) => (
                      <li key={c.id_certificado} className="portal-item">
                        <div>
                          <strong>{c.tipo_certificado}</strong>
                          {c.detalle ? (
                            <p className="portal-muted">{c.detalle}</p>
                          ) : null}
                          <p className="portal-muted">{formatFecha(c.fecha_emision)}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="dash-card">
                <div className="dash-card-header">
                  <div>
                    <h3>Mis resultados de exámenes</h3>
                    <p className="dash-muted">Anexos clínicos asociados a ti</p>
                  </div>
                  <span className="dash-badge">{anexos.length}</span>
                </div>
                {anexos.length === 0 ? (
                  <p className="dash-empty">
                    No tienes resultados de exámenes disponibles.
                  </p>
                ) : (
                  <ul className="portal-list">
                    {anexos.map((a) => (
                      <li key={a.id_anexo} className="portal-item">
                        <div>
                          <strong>
                            {tipoAnexoLabel[a.tipo_anexo ?? ''] ?? a.tipo_anexo ?? 'Resultado'}
                          </strong>
                          {a.descripcion ? (
                            <p className="portal-muted">{a.descripcion}</p>
                          ) : null}
                          <p className="portal-muted">{formatFecha(a.created_at)}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="dash-card portal-card-full">
                <div className="dash-card-header">
                  <div>
                    <h3>Solicitud de ficha médica</h3>
                    <p className="dash-muted">Documento legal y sensible</p>
                  </div>
                </div>
                <div className="portal-aviso">
                  <p>
                    Tu ficha médica es un <strong>documento legal y sensible</strong> que
                    contiene información clínica protegida. Por seguridad, no está
                    disponible en el portal en línea.
                  </p>
                  <p>
                    Para consultarla, acércate de forma <strong>presencial</strong> al
                    recinto donde te atendiste e indícanos que deseas revisar o solicitar
                    una copia de tu ficha. Nuestro equipo te atenderá y te guiará en el
                    procedimiento.
                  </p>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

export default Portal