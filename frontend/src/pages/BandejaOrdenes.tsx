import { useCallback, useEffect, useState } from 'react'
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

type OrdenConAnexos = OrdenExamen & {
  anexos?: AnexoClinico[]
}

function BandejaOrdenes() {
  const [ordenes, setOrdenes] = useState<OrdenConAnexos[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState('')
  const [mostrarCompletadas, setMostrarCompletadas] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)

    const { data, error: err } = await supabase
      .from('ordenes_examen')
      .select(
        'id_orden, id_paciente, id_usuario_emisor, tipo_examen, indicaciones, enviada_a_apoyo, modalidad, toma_muestra, fecha_toma_muestra, estado, created_at, pacientes(nombres, apellidos, rut)',
      )
      .eq('enviada_a_apoyo', true)
      .neq('estado', 'cancelada')
      .order('created_at', { ascending: false })

    if (err) {
      setError(err.message || 'No se pudieron cargar las órdenes.')
      setOrdenes([])
    } else {
      const rows = (data ?? []) as unknown as OrdenConAnexos[]
      const pacientesIds = [...new Set(rows.map((o) => o.id_paciente))]
      const anexosMap = new Map<number, AnexoClinico[]>()
      if (pacientesIds.length > 0) {
        const { data: anexosData } = await supabase
          .from('anexos_clinicos')
          .select(
            'id_anexo, id_paciente, nombre_archivo, tipo_mime, url_documento, descripcion, tipo_anexo, created_at',
          )
          .in('id_paciente', pacientesIds)
          .order('created_at', { ascending: false })
        if (anexosData) {
          for (const a of anexosData as unknown as AnexoClinico[]) {
            const idPac = a.id_paciente as number | undefined
            if (idPac === undefined) continue
            const lista = anexosMap.get(idPac) ?? []
            lista.push(a)
            anexosMap.set(idPac, lista)
          }
        }
      }
      setOrdenes(rows.map((o) => ({ ...o, anexos: anexosMap.get(o.id_paciente) ?? [] })))
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

  const pendientes = ordenes.filter(
    (o) => o.estado === 'pendiente' || o.estado === 'en_proceso',
  )
  const completadas = ordenes.filter((o) => o.estado === 'completada')

  const ordenadas = [...pendientes].sort((a, b) => {
    const fa = a.fecha_toma_muestra ? new Date(a.fecha_toma_muestra).getTime() : Infinity
    const fb = b.fecha_toma_muestra ? new Date(b.fecha_toma_muestra).getTime() : Infinity
    return fa - fb
  })

  const visibles = (mostrarCompletadas ? [...ordenadas, ...completadas] : ordenadas).filter(
    (o) => {
      if (!busqueda.trim()) return true
      const q = busqueda.trim().toLowerCase()
      return `${o.tipo_examen} ${o.indicaciones ?? ''} ${o.pacientes?.nombres ?? ''} ${o.pacientes?.apellidos ?? ''} ${o.pacientes?.rut ?? ''}`
        .toLowerCase()
        .includes(q)
    },
  )

  return (
    <div className="dash">
      <Sidebar moduloActivo="bandeja_ordenes" />

      <div className="dash-main">
        <header className="dash-topbar">
          <div>
            <h2>Bandeja de órdenes de examen</h2>
            <p>Órdenes enviadas por los profesionales, ordenadas por toma de muestra</p>
          </div>
          <span className="dash-badge">
            {loading ? '…' : `${pendientes.length} pendiente${pendientes.length === 1 ? '' : 's'}`}
          </span>
        </header>

        <section className="dash-content">
          {error ? (
            <p className="dash-alert dash-alert-error" role="alert">{error}</p>
          ) : null}
          {success ? (
            <p className="dash-alert dash-alert-success" role="status">{success}</p>
          ) : null}

          {!loading && pendientes.length > 0 ? (
            <p className="bandeja-aviso">
              Hay {pendientes.length} órdenes por atender. Las que tienen toma de muestra
              agendada aparecen primero, en orden de hora.
            </p>
          ) : null}

          <div className="dash-card">
            <div className="dash-card-header">
              <div>
                <h3>Órdenes de trabajo</h3>
                <p className="dash-muted">
                  {mostrarCompletadas ? 'Pendientes y completadas' : 'Solo pendientes'}
                </p>
              </div>
              <label className="bandeja-toggle">
                <input
                  type="checkbox"
                  checked={mostrarCompletadas}
                  onChange={(e) => setMostrarCompletadas(e.target.checked)}
                />
                Ver completadas
              </label>
            </div>

            <div className="dash-filter-bar">
              <input
                className="dash-filter-input"
                type="search"
                placeholder="Buscar por paciente, RUT, examen…"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
              />
              <span className="dash-muted">
                {visibles.length} resultado{visibles.length === 1 ? '' : 's'}
              </span>
            </div>

            {loading ? (
              <p className="dash-loading">Cargando órdenes…</p>
            ) : visibles.length === 0 ? (
              <p className="dash-empty">
                {mostrarCompletadas
                  ? 'No hay órdenes registradas.'
                  : 'No hay órdenes pendientes. ¡Todo al día!'}
              </p>
            ) : (
              <div className="dash-table-wrap">
                <table className="dash-table">
                  <thead>
                    <tr>
                      <th>Paciente</th>
                      <th>Examen</th>
                      <th>Indicaciones</th>
                      <th>Toma de muestra</th>
                      <th>Estado</th>
                      <th>Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibles.map((o) => (
                      <tr key={o.id_orden}>
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
                          {o.fecha_toma_muestra ? (
                            formatFechaHora(o.fecha_toma_muestra)
                          ) : o.toma_muestra === 'realizada' ? (
                            'Realizada'
                          ) : (
                            'Sin agendar'
                          )}
                        </td>
                        <td>
                          <span className={`orden-estado orden-estado-${o.estado}`}>
                            {ESTADO_LABEL[o.estado] ?? o.estado}
                          </span>
                        </td>
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
                            {o.estado === 'pendiente' || o.estado === 'en_proceso' ? (
                              <SubirResultadoOrden orden={o} onSubido={() => void loadData()} />
                            ) : null}
                          </div>
                          {o.anexos && o.anexos.length > 0 ? (
                            <div className="bandeja-anexos">
                              {o.anexos.map((a) => (
                                <a
                                  key={a.id_anexo}
                                  href={a.url_documento}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="bandeja-anexo-link"
                                >
                                  {TIPO_ANEXO_LABEL[a.tipo_anexo ?? ''] ?? 'Resultado'}
                                </a>
                              ))}
                            </div>
                          ) : null}
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

function SubirResultadoOrden({
  orden,
  onSubido,
}: {
  orden: OrdenExamen
  onSubido: () => void
}) {
  const [archivo, setArchivo] = useState<File | null>(null)
  const [descripcion, setDescripcion] = useState('')
  const [subiendo, setSubiendo] = useState(false)

  async function subir() {
    if (!archivo) return
    setSubiendo(true)

    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      setSubiendo(false)
      return
    }

    const ruta = `${orden.id_paciente}/${Date.now()}_${archivo.name}`
    const { error: uploadError } = await supabase.storage
      .from('anexos')
      .upload(ruta, archivo, { cacheControl: '3600', upsert: false })

    if (uploadError) {
      setSubiendo(false)
      alert(uploadError.message)
      return
    }

    const { data: urlData } = supabase.storage.from('anexos').getPublicUrl(ruta)

    const { error: insError } = await supabase.from('anexos_clinicos').insert({
      id_paciente: orden.id_paciente,
      id_usuario_subida: user.id,
      nombre_archivo: archivo.name,
      tipo_mime: archivo.type || 'application/octet-stream',
      url_documento: urlData?.publicUrl ?? '',
      descripcion: descripcion.trim() || null,
      tipo_anexo: 'laboratorio',
    })

    setSubiendo(false)
    if (insError) {
      alert(insError.message)
      return
    }
    setArchivo(null)
    setDescripcion('')
    onSubido()
  }

  return (
    <div className="bandeja-subir">
      <input
        type="file"
        onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
        aria-label="Subir resultado"
      />
      <input
        type="text"
        value={descripcion}
        onChange={(e) => setDescripcion(e.target.value)}
        placeholder="Descripción (opcional)"
      />
      <button
        type="button"
        className="dash-btn-secondary"
        onClick={() => void subir()}
        disabled={!archivo || subiendo}
      >
        {subiendo ? 'Subiendo…' : 'Subir resultado'}
      </button>
    </div>
  )
}

export default BandejaOrdenes