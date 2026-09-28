import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../services/supabase'
import Sidebar from '../components/Sidebar'
import type { OrdenExamen } from '../types/database'
import '../styles/OrdenesApoyo.css'

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

function OrdenesApoyo() {
  const [ordenes, setOrdenes] = useState<OrdenExamen[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState('')

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)

    const { data, error: err } = await supabase
      .from('ordenes_examen')
      .select(
        'id_orden, id_paciente, id_usuario_emisor, tipo_examen, indicaciones, enviada_a_apoyo, estado, created_at, pacientes(nombres, apellidos, rut)',
      )
      .eq('enviada_a_apoyo', true)
      .neq('estado', 'cancelada')
      .order('created_at', { ascending: false })

    if (err) {
      setError(err.message || 'No se pudieron cargar las órdenes.')
      setOrdenes([])
    } else {
      setOrdenes((data ?? []) as unknown as OrdenExamen[])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  async function cambiarEstado(orden: OrdenExamen, estado: OrdenExamen['estado']) {
    setError(null)
    setSuccess(null)
    setSaving(orden.id_orden)

    const { error: updError } = await supabase
      .from('ordenes_examen')
      .update({ estado })
      .eq('id_orden', orden.id_orden)

    setSaving(null)

    if (updError) {
      setError(updError.message || 'No se pudo actualizar la orden.')
      return
    }
    setSuccess(
      estado === 'completada'
        ? 'Orden marcada como completada.'
        : 'Orden marcada como en proceso.',
    )
    await loadData()
  }

  const filtradas = ordenes.filter((o) => {
    if (!busqueda.trim()) return true
    const q = busqueda.trim().toLowerCase()
    return `${o.tipo_examen} ${o.indicaciones ?? ''} ${o.pacientes?.nombres ?? ''} ${o.pacientes?.apellidos ?? ''} ${o.pacientes?.rut ?? ''}`
      .toLowerCase()
      .includes(q)
  })

  const ESTADO_LABEL: Record<string, string> = {
    pendiente: 'Pendiente',
    en_proceso: 'En proceso',
    completada: 'Completada',
    cancelada: 'Cancelada',
  }

  return (
    <div className="dash">
      <Sidebar moduloActivo="ordenes_apoyo" />

      <div className="dash-main">
        <header className="dash-topbar">
          <div>
            <h2>Órdenes de examen</h2>
            <p>Órdenes enviadas por los profesionales para su ejecución</p>
          </div>
        </header>

        <section className="dash-content">
          {error ? (
            <p className="dash-alert dash-alert-error" role="alert">{error}</p>
          ) : null}
          {success ? (
            <p className="dash-alert dash-alert-success" role="status">{success}</p>
          ) : null}

          <div className="dash-card">
            <div className="dash-card-header">
              <div>
                <h3>Órdenes recibidas</h3>
                <p className="dash-muted">Exámenes solicitados para los pacientes</p>
              </div>
              <span className="dash-badge">
                {loading ? '…' : ordenes.length}
              </span>
            </div>

            <div className="dash-filter-bar">
              <input
                className="dash-filter-input"
                type="search"
                placeholder="Buscar por paciente, RUT, examen o estado…"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
              />
              <span className="dash-muted">
                {filtradas.length} resultado{filtradas.length === 1 ? '' : 's'}
              </span>
            </div>

            {loading ? (
              <p className="dash-loading">Cargando órdenes…</p>
            ) : filtradas.length === 0 ? (
              <p className="dash-empty">
                No hay órdenes de examen enviadas a esta unidad.
              </p>
            ) : (
              <div className="dash-table-wrap">
                <table className="dash-table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Paciente</th>
                      <th>Examen</th>
                      <th>Indicaciones</th>
                      <th>Estado</th>
                      <th>Recibida</th>
                      <th>Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtradas.map((o) => (
                      <tr key={o.id_orden}>
                        <td>#{o.id_orden}</td>
                        <td>
                          <div>
                            {o.pacientes
                              ? `${o.pacientes.nombres} ${o.pacientes.apellidos}`
                              : `Paciente #${o.id_paciente}`}
                          </div>
                          {o.pacientes?.rut ? (
                            <div className="dash-muted">RUT {o.pacientes.rut}</div>
                          ) : null}
                        </td>
                        <td>
                          <span className="orden-chip">{o.tipo_examen}</span>
                        </td>
                        <td>{o.indicaciones || '—'}</td>
                        <td>
                          <span className={`orden-estado orden-estado-${o.estado}`}>
                            {ESTADO_LABEL[o.estado] ?? o.estado}
                          </span>
                        </td>
                        <td>{formatFecha(o.created_at)}</td>
                        <td>
                          <div className="orden-acciones">
                            {o.estado === 'pendiente' ? (
                              <button
                                type="button"
                                className="dash-btn-secondary"
                                onClick={() => void cambiarEstado(o, 'en_proceso')}
                                disabled={saving === o.id_orden}
                              >
                                Iniciar
                              </button>
                            ) : null}
                            {o.estado === 'en_proceso' || o.estado === 'pendiente' ? (
                              <button
                                type="button"
                                className="dash-btn-primary"
                                onClick={() => void cambiarEstado(o, 'completada')}
                                disabled={saving === o.id_orden}
                              >
                                Completar
                              </button>
                            ) : null}
                          </div>
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
    </div>
  )
}

export default OrdenesApoyo