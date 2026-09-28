import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../services/supabase'
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
    prevision: string | null
    nombres: string
    apellidos: string
    telefono: string | null
  } | null>(null)
  const [ordenes, setOrdenes] = useState<OrdenExamen[]>([])
  const [anexos, setAnexos] = useState<AnexoClinico[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Formulario de anexo
  const [tipoAnexo, setTipoAnexo] = useState('laboratorio')
  const [descripcionAnexo, setDescripcionAnexo] = useState('')
  const [archivoAnexo, setArchivoAnexo] = useState<File | null>(null)

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
        .select('id_paciente, rut, prevision, nombres, apellidos, telefono')
        .eq('id_paciente', idPac)
        .maybeSingle(),
      supabase
        .from('ordenes_examen')
        .select(
          'id_orden, id_paciente, id_usuario_emisor, tipo_examen, indicaciones, enviada_a_apoyo, estado, created_at',
        )
        .eq('id_paciente', idPac)
        .eq('enviada_a_apoyo', true)
        .neq('estado', 'cancelada')
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
      prevision: (pacRes.data.prevision as string | null) ?? null,
      nombres: pacRes.data.nombres as string,
      apellidos: pacRes.data.apellidos as string,
      telefono: (pacRes.data.telefono as string | null) ?? null,
    })

    if (!ordRes.error) setOrdenes((ordRes.data ?? []) as unknown as OrdenExamen[])
    if (!anexRes.error) setAnexos((anexRes.data ?? []) as unknown as AnexoClinico[])

    setLoading(false)
  }, [idPaciente])

  useEffect(() => {
    void loadData()
  }, [loadData])

  async function cambiarEstado(orden: OrdenExamen, estado: OrdenExamen['estado']) {
    setError(null)
    setSuccess(null)
    setSaving(true)
    const { error: updError } = await supabase
      .from('ordenes_examen')
      .update({ estado })
      .eq('id_orden', orden.id_orden)
    setSaving(false)
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

  async function handleSubirResultado(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSuccess(null)

    if (!paciente) return
    if (!archivoAnexo) {
      setError('Selecciona un archivo para adjuntar.')
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

    const ruta = `${paciente.id_paciente}/${Date.now()}_${archivoAnexo.name}`
    const { error: uploadError } = await supabase.storage
      .from('anexos')
      .upload(ruta, archivoAnexo, { cacheControl: '3600', upsert: false })

    if (uploadError) {
      setSaving(false)
      setError(uploadError.message || 'No se pudo subir el archivo.')
      return
    }

    const { data: urlData } = supabase.storage.from('anexos').getPublicUrl(ruta)
    const urlPublica = urlData?.publicUrl ?? ''

    const { error: insError } = await supabase.from('anexos_clinicos').insert({
      id_paciente: paciente.id_paciente,
      id_usuario_subida: user.id,
      nombre_archivo: archivoAnexo.name,
      tipo_mime: archivoAnexo.type || 'application/octet-stream',
      url_documento: urlPublica,
      descripcion: descripcionAnexo.trim() || null,
      tipo_anexo: tipoAnexo,
    })
    setSaving(false)

    if (insError) {
      setError(insError.message || 'No se pudo registrar el resultado.')
      return
    }

    setSuccess('Resultado del examen subido correctamente.')
    setArchivoAnexo(null)
    setDescripcionAnexo('')
    setTipoAnexo('laboratorio')
    await loadData()
  }

  if (loading) {
    return (
      <div className="pa">
        <div className="pa-header">
          <button type="button" className="pa-back" onClick={() => navigate('/pacientes')}>
            ← Volver a pacientes
          </button>
        </div>
        <main className="pa-content">
          <p className="pa-loading">Cargando paciente…</p>
        </main>
      </div>
    )
  }

  if (!paciente) {
    return (
      <div className="pa">
        <div className="pa-header">
          <button type="button" className="pa-back" onClick={() => navigate('/pacientes')}>
            ← Volver a pacientes
          </button>
        </div>
        <main className="pa-content">
          <p className="pa-alert pa-alert-error" role="alert">{error ?? 'Paciente no disponible.'}</p>
        </main>
      </div>
    )
  }

  return (
    <div className="pa">
      <header className="pa-header">
        <button type="button" className="pa-back" onClick={() => navigate('/pacientes')}>
          ← Volver a pacientes
        </button>
        <div className="pa-header-title">
          <h1>{paciente.apellidos}, {paciente.nombres}</h1>
          <p>
            RUT {paciente.rut} · Previsión {paciente.prevision ?? '—'} · Teléfono {paciente.telefono ?? '—'}
          </p>
        </div>
      </header>

      <main className="pa-content">
        {error ? (
          <p className="pa-alert pa-alert-error" role="alert">{error}</p>
        ) : null}
        {success ? (
          <p className="pa-alert pa-alert-success" role="status">{success}</p>
        ) : null}

        <section className="pa-card" aria-labelledby="ordenes-title">
          <div className="pa-card-header">
            <h2 id="ordenes-title">Órdenes de examen</h2>
            <span className="pa-badge">{ordenes.length}</span>
          </div>
          <div className="pa-card-body">
            {ordenes.length === 0 ? (
              <p className="pa-empty">Este paciente no tiene órdenes de examen enviadas a esta unidad.</p>
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
                    <p className="pa-muted">{formatFechaHora(o.created_at)}</p>
                    {o.estado === 'pendiente' || o.estado === 'en_proceso' ? (
                      <div className="pa-acciones">
                        {o.estado === 'pendiente' ? (
                          <button
                            type="button"
                            className="pa-btn-secondary"
                            onClick={() => void cambiarEstado(o, 'en_proceso')}
                            disabled={saving}
                          >
                            Iniciar
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="pa-btn-primary"
                          onClick={() => void cambiarEstado(o, 'completada')}
                          disabled={saving}
                        >
                          Completar
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="pa-card" aria-labelledby="resultados-title">
          <div className="pa-card-header">
            <h2 id="resultados-title">Resultados subidos</h2>
            <span className="pa-badge">{anexos.length}</span>
          </div>
          <div className="pa-card-body">
            {anexos.length === 0 ? (
              <p className="pa-empty">Aún no se han subido resultados para este paciente.</p>
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
        </section>

        <section className="pa-card" aria-labelledby="subir-title">
          <div className="pa-card-header">
            <h2 id="subir-title">Subir resultado de examen</h2>
          </div>
          <div className="pa-card-body">
            <form className="pa-form" onSubmit={(e) => void handleSubirResultado(e)}>
              <div className="pa-field">
                <label htmlFor="pa-tipo">Tipo de resultado</label>
                <select
                  id="pa-tipo"
                  value={tipoAnexo}
                  onChange={(e) => setTipoAnexo(e.target.value)}
                  disabled={saving}
                >
                  <option value="laboratorio">Laboratorio</option>
                  <option value="imagenologia">Imagenología</option>
                  <option value="banco_sangre">Banco de sangre</option>
                  <option value="informe">Informe</option>
                  <option value="otro">Otro</option>
                </select>
              </div>
              <div className="pa-field">
                <label htmlFor="pa-archivo">Archivo del resultado</label>
                <input
                  id="pa-archivo"
                  type="file"
                  onChange={(e) => setArchivoAnexo(e.target.files?.[0] ?? null)}
                  required
                  disabled={saving}
                />
                {archivoAnexo ? (
                  <p className="pa-hint">
                    Archivo seleccionado: {archivoAnexo.name} ({(archivoAnexo.size / 1024).toFixed(1)} KB)
                  </p>
                ) : null}
              </div>
              <div className="pa-field">
                <label htmlFor="pa-descripcion">Descripción (opcional)</label>
                <textarea
                  id="pa-descripcion"
                  value={descripcionAnexo}
                  onChange={(e) => setDescripcionAnexo(e.target.value)}
                  placeholder="Ej. Resultado de hemograma"
                  disabled={saving}
                />
              </div>
              <div className="pa-actions">
                <button type="submit" className="pa-btn-primary" disabled={saving}>
                  {saving ? 'Subiendo…' : 'Subir resultado'}
                </button>
              </div>
            </form>
          </div>
        </section>
      </main>
    </div>
  )
}

export default PacienteApoyo