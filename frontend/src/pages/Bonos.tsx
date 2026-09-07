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
  tipo_atencion: 'consulta' | 'procedimiento'
  monto: number
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

function formatMonto(value: number): string {
  return `$${value.toLocaleString('es-CL')}`
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

  const [busquedaPaciente, setBusquedaPaciente] = useState('')
  const [idPaciente, setIdPaciente] = useState('')
  const [sistema, setSistema] = useState('FONASA')
  const [tipoAtencion, setTipoAtencion] = useState<'consulta' | 'procedimiento'>('consulta')
  const [monto, setMonto] = useState('')
  const [detalle, setDetalle] = useState('')

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)

    const bonosRes = await supabase
      .from('bonos_atencion')
      .select(
        'id_bono, id_paciente, sistema_prevision, tipo_atencion, monto, estado, fecha_emision, detalle, pacientes(nombres, apellidos, rut)',
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
          tipo_atencion: (row.tipo_atencion as Bono['tipo_atencion']) ?? 'consulta',
          monto: row.monto as number,
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
      .select('id_paciente, rut, prevision, nombres, apellidos')
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

  const pacientesFiltrados = pacientes.filter((p) => {
    if (!busquedaPaciente.trim()) return true
    const q = busquedaPaciente.trim().toLowerCase()
    return `${p.nombres} ${p.apellidos} ${p.rut}`.toLowerCase().includes(q)
  })

  function openForm() {
    setError(null)
    setSuccess(null)
    setIdPaciente('')
    setSistema('FONASA')
    setTipoAtencion('consulta')
    setMonto('')
    setDetalle('')
    setBusquedaPaciente('')
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

    const montoNum = Number(monto)
    if (!idPaciente || !sistema) {
      setError('Selecciona un paciente y el sistema de previsión.')
      return
    }
    if (!tipoAtencion) {
      setError('Indica si la atención es consulta o procedimiento.')
      return
    }
    if (!monto || montoNum <= 0) {
      setError('El monto es obligatorio y debe ser mayor a 0.')
      return
    }
    if (!detalle.trim()) {
      setError(
        'El detalle es obligatorio (valor de consulta o desglose de procedimiento).',
      )
      return
    }

    setSaving(true)
    const { error: insError } = await supabase.from('bonos_atencion').insert({
      id_paciente: Number(idPaciente),
      sistema_prevision: sistema,
      tipo_atencion: tipoAtencion,
      monto: montoNum,
      detalle: detalle.trim(),
      estado: 'emitido',
    })
    setSaving(false)

    if (insError) {
      setError(insError.message || 'No se pudo crear el bono.')
      return
    }

    setSuccess('Bono de atención emitido. El ingreso se registró en Finanzas.')
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
            <p>Registro y cobro de las atenciones según la cobertura del paciente</p>
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
                  Cada bono emitido se refleja como ingreso en Finanzas
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
                No hay bonos registrados. Usa “Nuevo bono” para cobrar la primera atención.
              </p>
            ) : (
              <div className="dash-table-wrap">
                <table className="dash-table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Paciente</th>
                      <th>Previsión</th>
                      <th>Tipo</th>
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
                          <span className="bonos-chip">
                            {b.tipo_atencion === 'procedimiento'
                              ? 'Procedimiento'
                              : 'Consulta'}
                          </span>
                        </td>
                        <td>{formatMonto(b.monto)}</td>
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
                <p>Cobra la atención según la cobertura del paciente.</p>
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
                <label htmlFor="bono-tipo">Tipo de atención</label>
                <select
                  id="bono-tipo"
                  value={tipoAtencion}
                  onChange={(e) => setTipoAtencion(e.target.value as 'consulta' | 'procedimiento')}
                  required
                  disabled={saving}
                >
                  <option value="consulta">Consulta</option>
                  <option value="procedimiento">Procedimiento</option>
                </select>
              </div>

              <div className="dash-field">
                <label htmlFor="bono-paciente-busqueda">Buscar paciente</label>
                <input
                  id="bono-paciente-busqueda"
                  type="search"
                  value={busquedaPaciente}
                  onChange={(e) => {
                    setBusquedaPaciente(e.target.value)
                    setIdPaciente('')
                  }}
                  placeholder="Buscar por nombre o RUT…"
                  disabled={saving}
                />
              </div>

              <div className="dash-field">
                <label htmlFor="bono-paciente">Paciente</label>
                <select
                  id="bono-paciente"
                  value={idPaciente}
                  onChange={(e) => setIdPaciente(e.target.value)}
                  required
                  disabled={saving || pacientesFiltrados.length === 0}
                >
                  <option value="">
                    {pacientesFiltrados.length === 0
                      ? 'No hay pacientes para la búsqueda'
                      : 'Selecciona un paciente'}
                  </option>
                  {pacientesFiltrados.map((p) => (
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
                <label htmlFor="bono-monto">Monto (según cobertura)</label>
                <input
                  id="bono-monto"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={monto}
                  onChange={(e) => setMonto(e.target.value)}
                  placeholder="Ej. 25000"
                  required
                  disabled={saving}
                />
              </div>

              <div className="dash-field">
                <label htmlFor="bono-detalle">Detalle de la atención</label>
                <textarea
                  id="bono-detalle"
                  value={detalle}
                  onChange={(e) => setDetalle(e.target.value)}
                  placeholder={
                    tipoAtencion === 'consulta'
                      ? 'Ej. Valor de consulta de medicina general'
                      : 'Ej. Honorarios, insumos, quirófano…'
                  }
                  required
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
                  {saving ? 'Guardando…' : 'Emitir bono y cobrar'}
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