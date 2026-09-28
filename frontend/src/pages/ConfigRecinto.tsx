import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../services/supabase'
import Sidebar from '../components/Sidebar'
import '../styles/ConfigRecinto.css'

const MODALIDADES = [
  {
    id: 'full_time',
    nombre: 'Full time',
    descripcion:
      'Lun–Vie 7:30 a 16:30 · Sáb 8:00 a 12:00. Ideal si el recinto tiene laboratorio propio (mañana toma de muestras, tarde análisis).',
  },
  {
    id: 'part_time',
    nombre: 'Part time',
    descripcion:
      'Lun–Sáb 7:30 a 10:00. Solo toma de muestras; las muestras se envían a un laboratorio externo.',
  },
]

const MODALIDAD_DETALLE: Record<string, { inicio: string; fin: string; label: string }[]> = {
  full_time: [
    { inicio: '07:30', fin: '16:30', label: 'Lunes a viernes' },
    { inicio: '08:00', fin: '12:00', label: 'Sábado' },
  ],
  part_time: [{ inicio: '07:30', fin: '10:00', label: 'Lunes a sábado' }],
}

function ConfigRecinto() {
  const [modalidad, setModalidad] = useState('')
  const [cargando, setCargando] = useState(true)
  const [generando, setGenerando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [infoGeneracion, setInfoGeneracion] = useState<string | null>(null)

  const loadConfig = useCallback(async () => {
    setCargando(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('config_recinto')
      .select('clave, valor')
      .eq('clave', 'modalidad_toma_muestra')
      .maybeSingle()
    if (err) {
      setError(err.message)
    } else {
      setModalidad(data?.valor === 'part_time' ? 'part_time' : 'full_time')
    }
    setCargando(false)
  }, [])

  useEffect(() => {
    void loadConfig()
  }, [loadConfig])

  async function guardarModalidad() {
    setError(null)
    setSuccess(null)
    setInfoGeneracion(null)

    const {
      data: { user },
    } = await supabase.auth.getUser()

    const { error: updError } = await supabase
      .from('config_recinto')
      .update({
        valor: modalidad,
        actualizado_por: user?.id ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('clave', 'modalidad_toma_muestra')

    if (updError) {
      setError(updError.message || 'No se pudo guardar la configuración.')
      return
    }
    setSuccess('Modalidad de toma de muestra actualizada. Genera los horarios para aplicarla.')
  }

  async function generarHorarios() {
    setError(null)
    setSuccess(null)
    setInfoGeneracion(null)
    setGenerando(true)

    const { data, error: rpcError } = await supabase.rpc(
      'fn_generar_bloques_toma_muestra',
    )

    setGenerando(false)

    if (rpcError) {
      setError(rpcError.message || 'No se pudieron generar los horarios.')
      return
    }

    const result = data as { ok?: boolean; generados?: number; existentes?: number; modalidad?: string } | null
    if (result && !result.ok) {
      setError((result as { error?: string }).error || 'No se pudieron generar los horarios.')
      return
    }
    if (result && result.generados && result.generados > 0) {
      setInfoGeneracion(
        `Se generaron ${result.generados} bloques de 15 minutos para los próximos 30 días.`,
      )
    } else if (result && result.existentes && result.existentes > 0) {
      setInfoGeneracion(
        `Ya existen ${result.existentes} bloques generados. No se duplicaron.`,
      )
    } else {
      setInfoGeneracion('No se generaron bloques nuevos.')
    }
  }

  return (
    <div className="dash">
      <Sidebar moduloActivo="config_recinto" />

      <div className="dash-main">
        <header className="dash-topbar">
          <div>
            <h2>Configuración del recinto</h2>
            <p>Parámetros generales del centro de salud</p>
          </div>
        </header>

        <section className="dash-content">
          {error ? (
            <p className="dash-alert dash-alert-error" role="alert">{error}</p>
          ) : null}
          {success ? (
            <p className="dash-alert dash-alert-success" role="status">{success}</p>
          ) : null}
          {infoGeneracion ? (
            <p className="dash-alert dash-alert-success" role="status">{infoGeneracion}</p>
          ) : null}

          {cargando ? (
            <p className="dash-loading">Cargando configuración…</p>
          ) : (
            <div className="dash-card">
              <div className="dash-card-header">
                <div>
                  <h3>Modalidad de toma de muestra</h3>
                  <p className="dash-muted">
                    Define la jornada laboral del laboratorio. Los horarios se generan
                    automáticamente en bloques de 15 minutos.
                  </p>
                </div>
              </div>

              <div className="cr-modalidades">
                {MODALIDADES.map((m) => (
                  <label
                    key={m.id}
                    className={`cr-modalidad${modalidad === m.id ? ' is-active' : ''}`}
                  >
                    <input
                      type="radio"
                      name="modalidad"
                      value={m.id}
                      checked={modalidad === m.id}
                      onChange={(e) => setModalidad(e.target.value)}
                    />
                    <div>
                      <strong>{m.nombre}</strong>
                      <p>{m.descripcion}</p>
                      <div className="cr-franjas">
                        {MODALIDAD_DETALLE[m.id].map((f) => (
                          <span key={f.label} className="cr-franja">
                            {f.label}: {f.inicio} – {f.fin}
                          </span>
                        ))}
                      </div>
                    </div>
                  </label>
                ))}
              </div>

              <div className="cr-actions">
                <button
                  type="button"
                  className="dash-btn-secondary"
                  onClick={() => void guardarModalidad()}
                >
                  Guardar modalidad
                </button>
                <button
                  type="button"
                  className="dash-btn-primary"
                  onClick={() => void generarHorarios()}
                  disabled={generando}
                >
                  {generando ? 'Generando…' : 'Generar horarios del mes'}
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

export default ConfigRecinto