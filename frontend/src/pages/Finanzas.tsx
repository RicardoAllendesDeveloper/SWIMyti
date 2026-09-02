import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../services/supabase'
import { useAuthRol } from '../context/AuthRolContext'
import Sidebar from '../components/Sidebar'
import '../styles/Finanzas.css'

type Partida = {
  id_partida: number
  tipo: 'ingreso' | 'egreso'
  concepto: string
  monto: number
  periodo: string
  descripcion: string | null
  created_at: string
}

function Finanzas() {
  const { rol } = useAuthRol()
  const puedeGestionar = rol === 'administrador' || rol === 'administrativo'

  const [partidas, setPartidas] = useState<Partida[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)

  const [tipo, setTipo] = useState<'ingreso' | 'egreso'>('ingreso')
  const [concepto, setConcepto] = useState('')
  const [monto, setMonto] = useState('')
  const [periodo, setPeriodo] = useState('')
  const [descripcion, setDescripcion] = useState('')

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)

    const { data, error: err } = await supabase
      .from('partidas_presupuesto')
      .select('id_partida, tipo, concepto, monto, periodo, descripcion, created_at')
      .order('created_at', { ascending: false })

    if (err) {
      setError(err.message || 'No se pudieron cargar las partidas.')
      setPartidas([])
    } else {
      setPartidas((data as Partida[]) ?? [])
    }

    setLoading(false)
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const totalIngresos = partidas
    .filter((p) => p.tipo === 'ingreso')
    .reduce((acc, p) => acc + p.monto, 0)
  const totalEgresos = partidas
    .filter((p) => p.tipo === 'egreso')
    .reduce((acc, p) => acc + p.monto, 0)
  const balance = totalIngresos - totalEgresos

  function openForm() {
    setError(null)
    setSuccess(null)
    setTipo('ingreso')
    setConcepto('')
    setMonto('')
    setPeriodo('')
    setDescripcion('')
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
    if (!concepto.trim() || !monto || montoNum <= 0 || !periodo.trim()) {
      setError('Completa concepto, monto (mayor a 0) y periodo.')
      return
    }

    setSaving(true)
    const { error: insError } = await supabase.from('partidas_presupuesto').insert({
      tipo,
      concepto: concepto.trim(),
      monto: montoNum,
      periodo: periodo.trim(),
      descripcion: descripcion.trim() || null,
    })
    setSaving(false)

    if (insError) {
      setError(insError.message || 'No se pudo registrar la partida.')
      return
    }

    setSuccess('Partida presupuestaria registrada.')
    setShowForm(false)
    await loadData()
  }

  async function handleDelete(id: number) {
    const { error: delError } = await supabase
      .from('partidas_presupuesto')
      .delete()
      .eq('id_partida', id)

    if (delError) {
      setError(delError.message || 'No se pudo eliminar la partida.')
      return
    }
    setSuccess('Partida eliminada.')
    await loadData()
  }

  return (
    <div className="dash">
      <Sidebar moduloActivo="finanzas" />

      <div className="dash-main">
        <header className="dash-topbar">
          <div>
            <h2>Presupuestos y finanzas</h2>
            <p>Resumen presupuestario del centro (ingresos y egresos)</p>
          </div>
          {puedeGestionar ? (
            <button
              type="button"
              className="dash-btn-primary"
              onClick={openForm}
            >
              Nueva partida
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

          <div className="finanzas-resumen">
            <div className="finanzas-card finanzas-card-ingreso">
              <div className="finanzas-card-label">Ingresos</div>
              <div className="finanzas-card-valor">
                ${totalIngresos.toLocaleString('es-CL')}
              </div>
            </div>
            <div className="finanzas-card finanzas-card-egreso">
              <div className="finanzas-card-label">Egresos</div>
              <div className="finanzas-card-valor">
                ${totalEgresos.toLocaleString('es-CL')}
              </div>
            </div>
            <div className={`finanzas-card ${balance >= 0 ? 'finanzas-card-balance-pos' : 'finanzas-card-balance-neg'}`}>
              <div className="finanzas-card-label">Balance</div>
              <div className="finanzas-card-valor">
                ${balance.toLocaleString('es-CL')}
              </div>
            </div>
          </div>

          <div className="dash-card">
            <div className="dash-card-header">
              <div>
                <h3>Partidas presupuestarias</h3>
                <p className="dash-muted">
                  Registro de partidas por periodo (expresión básica, sin contabilidad real)
                </p>
              </div>
              <span className="dash-badge">
                {loading ? '…' : `${partidas.length} registro${partidas.length === 1 ? '' : 's'}`}
              </span>
            </div>

            {loading ? (
              <p className="dash-loading">Cargando partidas…</p>
            ) : partidas.length === 0 ? (
              <p className="dash-empty">
                No hay partidas registradas. Usa “Nueva partida” para crear la primera.
              </p>
            ) : (
              <div className="dash-table-wrap">
                <table className="dash-table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Tipo</th>
                      <th>Concepto</th>
                      <th>Monto</th>
                      <th>Periodo</th>
                      <th>Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {partidas.map((p) => (
                      <tr key={p.id_partida}>
                        <td>#{p.id_partida}</td>
                        <td>
                          <span className={`finanzas-tipo finanzas-tipo-${p.tipo}`}>
                            {p.tipo}
                          </span>
                        </td>
                        <td>
                          <div>{p.concepto}</div>
                          {p.descripcion ? (
                            <div className="dash-muted">{p.descripcion}</div>
                          ) : null}
                        </td>
                        <td>${p.monto.toLocaleString('es-CL')}</td>
                        <td>{p.periodo}</td>
                        <td>
                          <button
                            type="button"
                            className="dash-btn-secondary"
                            onClick={() => void handleDelete(p.id_partida)}
                            disabled={!puedeGestionar}
                          >
                            Eliminar
                          </button>
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
            aria-labelledby="nueva-partida-title"
          >
            <div className="dash-modal-header">
              <div>
                <h3 id="nueva-partida-title">Nueva partida presupuestaria</h3>
                <p>Registra un ingreso o egreso por periodo.</p>
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
                <label htmlFor="finanzas-tipo">Tipo</label>
                <select
                  id="finanzas-tipo"
                  value={tipo}
                  onChange={(e) => setTipo(e.target.value as 'ingreso' | 'egreso')}
                  disabled={saving}
                >
                  <option value="ingreso">Ingreso</option>
                  <option value="egreso">Egreso</option>
                </select>
              </div>

              <div className="dash-field">
                <label htmlFor="finanzas-concepto">Concepto</label>
                <input
                  id="finanzas-concepto"
                  value={concepto}
                  onChange={(e) => setConcepto(e.target.value)}
                  placeholder="Ej. Consulta particular, Arriendo, Sueldos"
                  required
                  disabled={saving}
                />
              </div>

              <div className="dash-field">
                <label htmlFor="finanzas-monto">Monto</label>
                <input
                  id="finanzas-monto"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={monto}
                  onChange={(e) => setMonto(e.target.value)}
                  placeholder="Ej. 500000"
                  required
                  disabled={saving}
                />
              </div>

              <div className="dash-field">
                <label htmlFor="finanzas-periodo">Periodo</label>
                <input
                  id="finanzas-periodo"
                  value={periodo}
                  onChange={(e) => setPeriodo(e.target.value)}
                  placeholder="Ej. Septiembre 2026"
                  required
                  disabled={saving}
                />
              </div>

              <div className="dash-field">
                <label htmlFor="finanzas-descripcion">Descripción (opcional)</label>
                <textarea
                  id="finanzas-descripcion"
                  value={descripcion}
                  onChange={(e) => setDescripcion(e.target.value)}
                  placeholder="Detalle de la partida"
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
                  {saving ? 'Guardando…' : 'Guardar partida'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default Finanzas
