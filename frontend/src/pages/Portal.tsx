import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../services/supabase'
import Sidebar from '../components/Sidebar'
import CalendarioDisponibilidad from '../components/CalendarioDisponibilidad'
import type { AnexoClinico, Cita, Interconsulta, OrdenExamen } from '../types/database'
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
  const navigate = useNavigate()
  const [citas, setCitas] = useState<Cita[]>([])
  const [recetas, setRecetas] = useState<Receta[]>([])
  const [certificados, setCertificados] = useState<Certificado[]>([])
  const [anexos, setAnexos] = useState<AnexoClinico[]>([])
  const [interconsultas, setInterconsultas] = useState<Interconsulta[]>([])
  const [ordenes, setOrdenes] = useState<OrdenExamen[]>([])
  const [pacienteNombre, setPacienteNombre] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cancelando, setCancelando] = useState<number | null>(null)
  const [cambiando, setCambiando] = useState<number | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [bloquesToma, setBloquesToma] = useState<
    { id_horario: number; fecha_inicio: string }[]
  >([])
  const [confirmando, setConfirmando] = useState<number | null>(null)

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

    const [citasRes, recRes, certRes, anexRes, icRes, ordRes, horRes] = await Promise.all([
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
          'id_anexo, id_paciente, nombre_archivo, descripcion, tipo_anexo, url_documento, created_at',
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
      supabase
        .from('ordenes_examen')
        .select(
          'id_orden, id_paciente, id_usuario_emisor, tipo_examen, indicaciones, enviada_a_apoyo, modalidad, toma_muestra, fecha_toma_muestra, id_horario, estado, created_at',
        )
        .eq('id_paciente', pac.id_paciente)
        .order('created_at', { ascending: false }),
      supabase
        .from('horarios_disponibles')
        .select('id_horario, fecha_inicio, especialidades(nombre)')
        .eq('estado', 'disponible')
        .gte('fecha_inicio', new Date().toISOString())
        .order('fecha_inicio', { ascending: true })
        .limit(1000),
    ])

    if (citasRes.error) setError(citasRes.error.message)
    else setCitas((citasRes.data ?? []) as unknown as Cita[])

    if (!recRes.error) setRecetas((recRes.data ?? []) as Receta[])
    if (!certRes.error) setCertificados((certRes.data ?? []) as Certificado[])
    if (!anexRes.error) setAnexos((anexRes.data ?? []) as AnexoClinico[])
    if (!icRes.error) setInterconsultas((icRes.data ?? []) as Interconsulta[])
    if (!ordRes.error) setOrdenes((ordRes.data ?? []) as OrdenExamen[])

    if (!horRes.error) {
      const rows = (horRes.data ?? []) as {
        id_horario: number
        fecha_inicio: string
        especialidades?: { nombre?: string } | { nombre?: string }[] | null
      }[]
      setBloquesToma(
        rows
          .filter((h) => {
            const e = asSingle(h.especialidades)
            return e?.nombre === 'Toma de muestra (Laboratorio)'
          })
          .map((h) => ({ id_horario: h.id_horario, fecha_inicio: h.fecha_inicio })),
      )
    }

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

    const { data, error } = await supabase.rpc('fn_paciente_liberar_cita', {
      p_id_cita: idCita,
    })

    setCancelando(null)

    if (error || !data?.ok) {
      setError(error?.message || data?.error || 'No se pudo cancelar la cita.')
      return
    }

    setSuccess('Cita cancelada. El horario vuelve a estar disponible.')
    await loadData()
  }

  async function cambiarHoraCita(idCita: number) {
    const confirmado = window.confirm(
      '¿Deseas cambiar la hora de tu cita? Se liberará tu hora actual y podrás elegir otra.',
    )
    if (!confirmado) return

    setError(null)
    setSuccess(null)
    setCambiando(idCita)

    const { data, error } = await supabase.rpc('fn_paciente_liberar_cita', {
      p_id_cita: idCita,
    })

    setCambiando(null)

    if (error || !data?.ok) {
      setError(error?.message || data?.error || 'No se pudo cambiar la hora.')
      return
    }

    setSuccess('Tu cita fue liberada. Elige una nueva hora disponible.')
    navigate('/citas')
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

  async function reservarTomaMuestra(orden: OrdenExamen, idHorario: number) {
    setError(null)
    setSuccess(null)
    setConfirmando(idHorario)

    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      setConfirmando(null)
      setError('Sesión no válida. Vuelve a iniciar sesión.')
      return
    }

    // Confirmación
    const confirmar = window.confirm(
      '¿Confirmar la reserva de esta hora para tu toma de muestra?',
    )
    if (!confirmar) {
      setConfirmando(null)
      return
    }

    const { data, error } = await supabase.rpc('fn_paciente_reservar_toma_muestra', {
      p_id_orden: orden.id_orden,
      p_id_horario: idHorario,
    })

    setConfirmando(null)

    if (error || !data?.ok) {
      const msg = error?.message || data?.error || 'No se pudo agendar la hora.'
      if (msg.toLowerCase().includes('ya no está disponible')) {
        setError('Ese horario acaba de ser reservado. Elige otro.')
      } else {
        setError(msg)
      }
      await loadData()
      return
    }

    setSuccess('Tu hora de toma de muestra fue agendada exitosamente.')
    await loadData()
  }

  async function cancelarTomaMuestra(orden: OrdenExamen) {
    setError(null)
    setSuccess(null)

    const { data, error } = await supabase.rpc('fn_paciente_liberar_toma_muestra', {
      p_id_orden: orden.id_orden,
    })

    if (error || !data?.ok) {
      setError(error?.message || data?.error || 'No se pudo cancelar la toma de muestra.')
      return
    }
    setSuccess('Toma de muestra cancelada. El horario vuelve a estar disponible.')
    await loadData()
  }

  async function cambiarTomaMuestra(orden: OrdenExamen) {
    setError(null)
    setSuccess(null)

    const confirmar = window.confirm(
      '¿Deseas cambiar la hora de tu toma de muestra? Se liberará tu hora actual.',
    )
    if (!confirmar) return

    const { data, error } = await supabase.rpc('fn_paciente_liberar_toma_muestra', {
      p_id_orden: orden.id_orden,
    })

    if (error || !data?.ok) {
      setError(error?.message || data?.error || 'No se pudo cambiar la hora.')
      return
    }
    setSuccess('Tu hora fue liberada. Elige una nueva hora disponible.')
    await loadData()
  }

  function imprimirOrden(orden: OrdenExamen) {
    const ventana = window.open('', '_blank', 'width=800,height=600')
    if (!ventana) return
    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Orden de Examen</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 40px; color: #0f172a; }
    h1 { color: #0f4c81; font-size: 22px; }
    .header { border-bottom: 3px solid #0f4c81; padding-bottom: 10px; margin-bottom: 24px; }
    .campo { margin-bottom: 14px; }
    .label { font-weight: bold; font-size: 12px; color: #64748b; text-transform: uppercase; }
    .valor { font-size: 15px; margin-top: 2px; }
    .footer { margin-top: 40px; font-size: 12px; color: #64748b; border-top: 1px solid #e2e8f0; padding-top: 10px; }
    @media print { body { margin: 20px; } }
  </style>
</head>
<body>
  <div class="header">
    <h1>SWIMyti — Orden de Examen</h1>
    <p>Centro de salud · Documento entregado al paciente</p>
  </div>
  <div class="campo"><div class="label">Paciente</div><div class="valor">${pacienteNombre || 'Paciente'}</div></div>
  <div class="campo"><div class="label">Examen solicitado</div><div class="valor">${orden.tipo_examen}</div></div>
  ${orden.indicaciones ? `<div class="campo"><div class="label">Indicaciones</div><div class="valor">${orden.indicaciones}</div></div>` : ''}
  <div class="campo"><div class="label">Lugar de realización</div><div class="valor">Otro recinto (no se realiza en este centro)</div></div>
  <div class="campo"><div class="label">Fecha de emisión</div><div class="valor">${formatFechaHora(orden.created_at)}</div></div>
  <div class="footer">
    <p>SWIMyti — Sistema Web Integral Multi-rol y Trazabilidad Inmutable</p>
    <p>Este documento debe presentarse en el recinto donde se realizará el examen.</p>
  </div>
</body>
</html>`
    ventana.document.write(html)
    ventana.document.close()
    ventana.focus()
    ventana.print()
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
                          cita.horarios_disponibles &&
                          new Date(cita.horarios_disponibles.fecha_inicio).getTime() -
                            Date.now() <
                            60 * 60 * 1000 ? (
                            <p className="portal-muted">
                              No puedes cancelar ni cambiar: faltan menos de 60
                              minutos para tu atención.
                            </p>
                          ) : (
                            <div className="portal-acciones-fila">
                              <button
                                type="button"
                                className="dash-btn-secondary"
                                onClick={() => void cambiarHoraCita(cita.id_cita)}
                                disabled={cambiando === cita.id_cita}
                              >
                                {cambiando === cita.id_cita
                                  ? 'Cambiando…'
                                  : 'Cambiar hora'}
                              </button>
                              <button
                                type="button"
                                className="dash-btn-secondary"
                                onClick={() => void cancelarCita(cita.id_cita)}
                                disabled={cancelando === cita.id_cita}
                              >
                                {cancelando === cita.id_cita ? 'Cancelando…' : 'Cancelar'}
                              </button>
                            </div>
                          )
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
                          {a.url_documento ? (
                            <a
                              href={a.url_documento}
                              target="_blank"
                              rel="noreferrer"
                              className="dash-btn-secondary"
                              style={{ textDecoration: 'none', display: 'inline-block', marginTop: '0.4rem' }}
                            >
                              Ver / descargar
                            </a>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="dash-card portal-card-full">
                <div className="dash-card-header">
                  <div>
                    <h3>Mis órdenes de examen</h3>
                    <p className="dash-muted">Exámenes solicitados por tus profesionales</p>
                  </div>
                  <span className="dash-badge">{ordenes.length}</span>
                </div>
                {ordenes.length === 0 ? (
                  <p className="dash-empty">No tienes órdenes de examen registradas.</p>
                ) : (
                  <ul className="portal-list">
                    {ordenes.map((o) => (
                      <li key={o.id_orden} className="portal-item">
                        <div>
                          <strong>{o.tipo_examen}</strong>
                          {o.indicaciones ? (
                            <p className="portal-muted">Indicaciones: {o.indicaciones}</p>
                          ) : null}
                          <p className="portal-muted">
                            Estado:{' '}
                            <span className="portal-estado">
                              {o.estado === 'en_proceso'
                                ? 'En proceso'
                                : o.estado === 'completada'
                                  ? 'Completada'
                                  : o.estado === 'cancelada'
                                    ? 'Cancelada'
                                    : 'Pendiente'}
                            </span>
                            {' '}·{' '}
                            {o.modalidad === 'en_recinto' ? 'En el recinto' : 'Otro recinto'}
                          </p>
                          {o.modalidad === 'en_recinto' ? (
                            <p className="portal-muted">
                              Toma de muestra:{' '}
                              {o.toma_muestra === 'agendada' && o.fecha_toma_muestra
                                ? `${formatFechaHora(o.fecha_toma_muestra)}`
                                : o.toma_muestra === 'realizada'
                                  ? 'Realizada'
                                  : 'Sin agendar'}
                            </p>
                          ) : null}
                          <p className="portal-muted">{formatFecha(o.created_at)}</p>
                        </div>
                        <div className="portal-acciones">
                          {o.modalidad === 'otro_recinto' && o.estado !== 'cancelada' ? (
                            <button
                              type="button"
                              className="dash-btn-secondary"
                              onClick={() => imprimirOrden(o)}
                            >
                              Imprimir / PDF
                            </button>
                          ) : null}
                          {o.modalidad === 'en_recinto' &&
                          o.estado === 'pendiente' &&
                          o.toma_muestra === 'pendiente' ? (
                            <div className="toma-bloques">
                              <p className="portal-muted">
                                <strong>Elige el día y la hora de tu toma de muestra:</strong>{' '}
                                Recuerda llegar 15 minutos antes.
                              </p>
                              <CalendarioDisponibilidad
                                bloques={bloquesToma}
                                onReservar={(idHorario, _fecha) =>
                                  void reservarTomaMuestra(o, idHorario)
                                }
                                confirmandoId={confirmando}
                              />
                            </div>
                          ) : null}
                          {o.modalidad === 'en_recinto' &&
                          o.toma_muestra === 'agendada' ? (
                            <div className="toma-cambiar">
                              <p className="portal-muted">
                                <strong>Tienes tu hora de toma de muestra agendada.</strong>{' '}
                                {o.fecha_toma_muestra
                                  ? `Para el ${formatFechaHora(o.fecha_toma_muestra)}.`
                                  : ''}
                              </p>
                              <p className="portal-muted">
                                ¿Deseas cambiar tu hora? Los cambios se aceptan hasta
                                1 hora antes de la hora agendada.
                              </p>
                              <div className="portal-acciones-fila">
                                <button
                                  type="button"
                                  className="dash-btn-secondary"
                                  onClick={() => void cambiarTomaMuestra(o)}
                                  disabled={o.fecha_toma_muestra
                                    ? new Date(o.fecha_toma_muestra).getTime() -
                                        Date.now() <
                                      60 * 60 * 1000
                                    : false}
                                >
                                  Cambiar hora
                                </button>
                                <button
                                  type="button"
                                  className="dash-btn-secondary"
                                  onClick={() => void cancelarTomaMuestra(o)}
                                >
                                  Cancelar toma
                                </button>
                              </div>
                            </div>
                          ) : null}
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