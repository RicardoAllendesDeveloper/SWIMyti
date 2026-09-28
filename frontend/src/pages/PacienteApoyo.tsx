import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../services/supabase'
import Sidebar from '../components/Sidebar'
import type { AnexoClinico, OrdenExamen } from '../types/database'
import '../styles/PacienteApoyo.css'

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

const ESTADO_LABEL: Record<string, string> = {
  pendiente: 'Pendiente',
  en_proceso: 'En proceso',
  completada: 'Completada',
  cancelada: 'Cancelada',
}

const TIPO_ANEXO_LABEL: Record<string, string> = {
  laboratorio: 'Laboratorio',
  imagenologia: 'Imagenología',
  banco_sangre: 'Banco de sangre',
  informe: 'Informe',
  otro: 'Otro',
}

function PacienteApoyo() {
  const { idPaciente } = useParams<{ idPaciente: string }>()
  const navigate = useNavigate()

  const [paciente, setPaciente] = useState<{
    id_paciente: number
    rut: string
    nombres: string
    apellidos: string
  } | null>(null)
  const [ordenes, setOrdenes] = useState<OrdenExamen[]>([])
  const [anexos, setAnexos] = useState<AnexoClinico[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    if (!idPaciente || Number.isNaN(Number(idPaciente))) {
      setError('Identificador de paciente inválido.')
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    const idPac = Number(idPaciente)

    const [pacRes, ordRes, anexRes] = await Promise.all([
      supabase
        .from('pacientes')
        .select('id_paciente, rut, nombres, apellidos')
        .eq('id_paciente', idPac)
        .maybeSingle(),
      supabase
        .from('ordenes_examen')
        .select(
          'id_orden, id_paciente, id_usuario_emisor, tipo_examen, indicaciones, enviada_a_apoyo, modalidad, toma_muestra, fecha_toma_muestra, estado, created_at',
        )
        .eq('id_paciente', idPac)
        .order('created_at', { ascending: false }),
      supabase
        .from('anexos_clinicos')
        .select(
          'id_anexo, id_paciente, nombre_archivo, tipo_mime, url_documento, descripcion, tipo_anexo, created_at',
        )
        .eq('id_paciente', idPac)
        .order('created_at', { ascending: false }),
    ])

    if (pacRes.error || !pacRes.data) {
      setError(pacRes.error?.message || 'Paciente no encontrado.')
      setLoading(false)
      return
    }
    setPaciente({
      id_paciente: pacRes.data.id_paciente as number,
      rut: pacRes.data.rut as string,
      nombres: pacRes.data.nombres as string,
      apellidos: pacRes.data.apellidos as string,
    })

    if (!ordRes.error) setOrdenes((ordRes.data ?? []) as unknown as OrdenExamen[])
    if (!anexRes.error) setAnexos((anexRes.data ?? []) as unknown as AnexoClinico[])

    setLoading(false)
  }, [idPaciente])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const tieneExamenes = ordenes.length > 0 || anexos.length > 0

  return (
    <div className="dash">
      <Sidebar moduloActivo="pacientes" />

      <div className="dash-main">
        <header className="dash-topbar">
          <div>
            <h2>Historial de exámenes del paciente</h2>
            <p>
              {paciente
                ? `${paciente.apellidos}, ${paciente.nombres} · RUT ${paciente.rut}`
                : 'Cargando…'}
            </p>
          </div>
          <button
            type="button"
            className="dash-btn-secondary"
            onClick={() => navigate('/pacientes')}
          >
            ← Volver a pacientes
          </button>
        </header>

        <section className="dash-content">
          {error ? (
            <p className="dash-alert dash-alert-error" role="alert">{error}</p>
          ) : null}

          {loading ? (
            <p className="dash-loading">Cargando historial…</p>
          ) : !tieneExamenes ? (
            <div className="dash-card">
              <div className="dash-card-body" style={{ padding: '1.5rem' }}>
                <p className="dash-empty">
                  No hay atenciones registradas.
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="dash-card">
                <div className="dash-card-header">
                  <div>
                    <h3>Órdenes de examen</h3>
                    <p className="dash-muted">Exámenes solicitados para este paciente</p>
                  </div>
                  <span className="dash-badge">{ordenes.length}</span>
                </div>
                <div className="dash-card-body">
                  {ordenes.length === 0 ? (
                    <p className="dash-empty">Este paciente no tiene órdenes de examen.</p>
                  ) : (
                    <div className="pa-list">
                      {ordenes.map((o) => (
                        <div key={o.id_orden} className="pa-item">
                          <div className="pa-item-top">
                            <span className="pa-chip">{o.tipo_examen}</span>
                            <span className={`pa-estado pa-estado-${o.estado}`}>
                              {ESTADO_LABEL[o.estado] ?? o.estado}
                            </span>
                          </div>
                          {o.indicaciones ? (
                            <p className="pa-muted">Indicaciones: {o.indicaciones}</p>
                          ) : null}
                          <p className="pa-muted">
                            {o.modalidad === 'en_recinto' ? 'En el recinto' : 'Otro recinto'}
                            {o.fecha_toma_muestra
                              ? ` · Toma de muestra: ${formatFechaHora(o.fecha_toma_muestra)}`
                              : ''}
                          </p>
                          <p className="pa-muted">{formatFechaHora(o.created_at)}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="dash-card">
                <div className="dash-card-header">
                  <div>
                    <h3>Resultados subidos</h3>
                    <p className="dash-muted">Documentos de resultados de este paciente</p>
                  </div>
                  <span className="dash-badge">{anexos.length}</span>
                </div>
                <div className="dash-card-body">
                  {anexos.length === 0 ? (
                    <p className="dash-empty">Este paciente no tiene resultados subidos.</p>
                  ) : (
                    <div className="pa-list">
                      {anexos.map((a) => (
                        <div key={a.id_anexo} className="pa-item">
                          <div className="pa-item-top">
                            <span className="pa-chip">
                              {TIPO_ANEXO_LABEL[a.tipo_anexo ?? ''] ?? a.tipo_anexo ?? 'Resultado'}
                            </span>
                            <span className="pa-muted">{formatFechaHora(a.created_at)}</span>
                          </div>
                          <p className="pa-texto">{a.descripcion || a.nombre_archivo}</p>
                          {a.url_documento ? (
                            <a
                              href={a.url_documento}
                              target="_blank"
                              rel="noreferrer"
                              className="pa-btn-secondary"
                              style={{ textDecoration: 'none', display: 'inline-block', marginTop: '0.4rem' }}
                            >
                              Ver / descargar
                            </a>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}

export default PacienteApoyo