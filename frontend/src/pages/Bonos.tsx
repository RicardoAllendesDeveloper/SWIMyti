import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../services/supabase'
import { useAuthRol } from '../context/AuthRolContext'
import Sidebar from '../components/Sidebar'
import type { Paciente } from '../types/database'
import '../styles/Bonos.css'

const SISTEMAS_PREVISION = [
  'FONASA',
  'ISAPRE',
  'PARTICULAR',
  'CAPREDENA',
  'DIPRECA',
  'ISP',
  'ISL',
]

type Bono = {
  id_bono: number
  id_paciente: number
  sistema_prevision: string
  monto: number | null
  estado: 'pendiente' | 'emitido' | 'anulado'
  fecha_emision: string
  detalle: string | null
  pacientes?: { nombres: string; apellidos: string; rut: string } | null
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

function Bonos() {
  const { rol } = useAuthRol()
  const puedeGestionar =
    rol === 'administrador' || rol === 'administrativo'

  const [bonos, setBonos] = useState<Bono[]>([])
  const [pacientes, setPacientes] = useState<Paciente[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)

  const [idPaciente, setIdPaciente] = useState('')
  const [sistema, setSistema] = useState('FONASA')
  const [monto, setMonto] = useState('')
  const [detalle, setDetalle] = useState('')

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)

    const bonosRes = await supabase
      .from('bonos_atencion')
      .select(
        'id_bono, id_paciente, sistema_prevision, monto, estado, fecha_emision, detalle, pacientes(nombres, apellidos, rut)',
      )
      .order('fecha_emision', { ascending: false })

    if (bonosRes.error) {
      setError(bonosRes.error.message || 'No se pudieron cargar los bonos.')
      setBonos([])
    } else {
      const rows = (bonosRes.data ?? []).map((row) => {
        const rel = row.pacientes as
          | { nombres: string; apellidos: string; rut: string }
          | { nombres: string; apellidos: string; rut: string }[]
          | null
        const p = Array.isArray(rel) ? rel[0] ?? null : rel
        return {
          id_bono: row.id_bono as number,
          id_paciente: row.id_paciente as number,
          sistema_prevision: row.sistema_prevision as string,
          monto: row.monto as number | null,
          estado: row.estado as Bono['estado'],
          fecha_emision: row.fecha_emision as string,
          detalle: row.detalle as string | null,
          pacientes: p
            ? {
                nombres: p.nombres,
                apellidos: p.apellidos,
                rut: p.rut,
              }
            : null,
        } satisfies Bono
      })
      setBonos(rows)
    }

    const pacRes = await supabase
      .from('pacientes')
      .select('id_paciente, rut, nombres, apellidos')
      .eq('activo', true)
      .order('apellidos', { ascending: true })

    if (!pacRes.error) {
      setPacientes((pacRes.data as Paciente[]) ?? [])
    }

    setLoading(false)
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  function openForm() {
    setError(null)
    setSuccess(null)
    setIdPaciente('')
    setSistema('FONASA')
    setMonto('')
    setDetalle('')
    setShowForm(true)
  }

  function closeForm() {
    if (saving) return
    setShowForm(false)
  }

  async function handleCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    if (!idPaciente || !sistema) {
      setError('Selecciona un paciente y el sistema de previsión.')
      return
    }

    setSaving(true)
    const { error: insError } = await supabase.from('bonos_atencion').insert({
      id_paciente: Number(idPaciente),
      sistema_prevision: sistema,
      monto: monto ? Number(monto) : null,
      detalle: detalle.trim() || null,
      estado: 'pendiente',
    })
    setSaving(false)

    if (insError) {
      setError(insError.message || 'No se pudo crear el bono.')
      return
    }

    setSuccess('Bono de atención registrado correctamente.')
    setShowForm(false)
    await loadData()
  }

  return (
    <div className="dash">
      <Sidebar moduloActivo="bonos" />

      <div className="dash-main">
        <header className="dash-topbar">
          <div>
            <h2>Bonos de atención</h2>
            <p>Sistema de previsión y registro de bonos del paciente</p>
          </div>
          {puedeGestionar ? (
            <button
              type="button"
              className="dash-btn-primary"
              onClick={openForm}
            >
              Nuevo bono
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
                <h3>Registro de bonos</h3>
                <p className="dash-muted">
                  Previsión asociada al paciente (FONASA, ISAPRE, Particular, CAPREDENA, DIPRECA, ISP, ISL)
                </p>
              </div>
              <span className="dash-badge">
                {loading ? '…' : `${bonos.length} registro${bonos.length === 1 ? '' : 's'}`}
              </span>
            </div>

            {loading ? (
              <p className="dash-loading">Cargando bonos…</p>
            ) : bonos.length === 0 ? (
              <p className="dash-empty">
                No hay bonos registrados. Usa “Nuevo bono” para crear el primero.
              </p>
            ) : (
              <div className="dash-table-wrap">
                <table className="dash-table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Paciente</th>
                      <th>Previsión</th>
                      <th>Monto</th>
                      <th>Estado</th>
                      <th>Emisión</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bonos.map((b) => (
                      <tr key={b.id_bono}>
                        <td>#{b.id_bono}</td>
                        <td>
                          <div>
                            {b.pacientes
                              ? `${b.pacientes.nombres} ${b.pacientes.apellidos}`
                              : `Paciente #${b.id_paciente}`}
                          </div>
                          {b.pacientes?.rut ? (
                            <div className="dash-muted">RUT {b.pacientes.rut}</div>
                          ) : null}
                        </td>
                        <td>
                          <span className="bonos-chip">{b.sistema_prevision}</span>
                        </td>
                        <td>
                          {b.monto != null
                            ? `${b.monto.toLocaleString('es-CL')}`
                            : '—'}
                        </td>
                        <td>
                          <span className="bonos-estado">{b.estado}</span>
                        </td>
                        <td>{formatFecha(b.fecha_emision)}</td>
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
            if (e.target === e.currentTarget) closeForm()
          }}
        >
          <div
            className="dash-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="nuevo-bono-title"
          >
            <div className="dash-modal-header">
              <div>
                <h3 id="nuevo-bono-title">Nuevo bono de atención</h3>
                <p>Asocia al paciente a su sistema de previsión.</p>
              </div>
              <button
                type="button"
                className="dash-modal-close"
                onClick={closeForm}
                aria-label="Cerrar"
                disabled={saving}
              >
                ×
              </button>
            </div>

            <form className="dash-form" onSubmit={(e) => void handleCreate(e)}>
              <div className="dash-field">
                <label htmlFor="bono-paciente">Paciente</label>
                <select
                  id="bono-paciente"
                  value={idPaciente}
                  onChange={(e) => setIdPaciente(e.target.value)}
                  required
                  disabled={saving}
                >
                  <option value="">
                    {pacientes.length === 0
                      ? 'No hay pacientes disponibles'
                      : 'Selecciona un paciente'}
                  </option>
                  {pacientes.map((p) => (
                    <option key={p.id_paciente} value={String(p.id_paciente)}>
                      {p.nombres} {p.apellidos} - {p.rut}
                    </option>
                  ))}
                </select>
              </div>

              <div className="dash-field">
                <label htmlFor="bono-sistema">Sistema de previsión</label>
                <select
                  id="bono-sistema"
                  value={sistema}
                  onChange={(e) => setSistema(e.target.value)}
                  required
                  disabled={saving}
                >
                  {SISTEMAS_PREVISION.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>

              <div className="dash-field">
                <label htmlFor="bono-monto">Monto (opcional)</label>
                <input
                  id="bono-monto"
                  type="number"
                  min="0"
                  step="0.01"
                  value={monto}
                  onChange={(e) => setMonto(e.target.value)}
                  placeholder="Ej. 25000"
                  disabled={saving}
                />
              </div>

              <div className="dash-field">
                <label htmlFor="bono-detalle">Detalle (opcional)</label>
                <textarea
                  id="bono-detalle"
                  value={detalle}
                  onChange={(e) => setDetalle(e.target.value)}
                  placeholder="Detalle del bono o prestación"
                  disabled={saving}
                />
              </div>

              <div className="dash-form-actions">
                <button
                  type="button"
                  className="dash-btn-secondary"
                  onClick={closeForm}
                  disabled={saving}
                >
                  Cancelar
                </button>
                <button type="submit" className="dash-btn-primary" disabled={saving}>
                  {saving ? 'Guardando…' : 'Guardar bono'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default Bonos
