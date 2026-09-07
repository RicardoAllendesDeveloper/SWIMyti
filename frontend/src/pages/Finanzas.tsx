import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../services/supabase'
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
  const [partidas, setPartidas] = useState<Partida[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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

  return (
    <div className="dash">
      <Sidebar moduloActivo="finanzas" />

      <div className="dash-main">
        <header className="dash-topbar">
          <div>
            <h2>Presupuestos y finanzas</h2>
            <p>Ingresos generados por los bonos de atención y egresos del centro</p>
          </div>
        </header>

        <section className="dash-content">
          {error ? (
            <p className="dash-alert dash-alert-error" role="alert">
              {error}
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
                  Los ingresos de tipo &quot;Bono de atención&quot; se registran automáticamente
                  al emitir un bono
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
                Aún no hay partidas registradas. Los ingresos aparecerán cuando se emitan bonos de atención.
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

export default Finanzas