import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../services/supabase'
import Sidebar from '../components/Sidebar'
import '../styles/Rem.css'

/**
 * Los agregados llegan calculados desde la RPC fn_rem_resumen(). La pagina no
 * consulta fichas_medicas ni bonos_atencion: antes lo hacia con .limit(500) y
 * se bajaba la columna `diagnostico` al navegador para contar en JavaScript,
 * lo que ademas de truncar los totales exponia dato clinico sensible.
 */
type Item = { clave: string; valor: number }

type RemResumen = {
  periodo: string
  atenciones_totales: number
  atenciones_mes: number
  citas_registradas: number
  bonos_totales: number
  top_especialidades: Item[]
  distribucion_atencion: Item[]
  ingresos_por_tipo: Item[]
  top_diagnosticos: Item[]
  puede_ver_diagnosticos: boolean
}

const PALETA = [
  '#0f4c81',
  '#2e86de',
  '#48c9b0',
  '#f39c12',
  '#8e44ad',
  '#e74c3c',
]

function Barras({ datos }: { datos: { clave: string; valor: number }[] }) {
  const max = Math.max(...datos.map((d) => d.valor), 1)
  return (
    <div className="rem-barras">
      {datos.map((d, idx) => (
        <div className="rem-barra-fila" key={`${d.clave}-${idx}`}>
          <div className="rem-barra-label">{d.clave}</div>
          <div className="rem-barra-track">
            <div
              className="rem-barra-valor"
              style={{
                width: `${(d.valor / max) * 100}%`,
                background: PALETA[idx % PALETA.length],
              }}
            />
          </div>
          <div className="rem-barra-num">{d.valor}</div>
        </div>
      ))}
    </div>
  )
}

function Torta({ datos }: { datos: { clave: string; valor: number }[] }) {
  const total = datos.reduce((acc, d) => acc + d.valor, 0) || 1
  let acumulado = 0
  const segmentos = datos.map((d, idx) => {
    const inicio = (acumulado / total) * 360
    acumulado += d.valor
    const fin = (acumulado / total) * 360
    return { ...d, inicio, fin, color: PALETA[idx % PALETA.length] }
  })

  const describeArco = (cx: number, cy: number, r: number, a0: number, a1: number) => {
    const rad = (a: number) => (a - 90) * (Math.PI / 180)
    const x0 = cx + r * Math.cos(rad(a0))
    const y0 = cy + r * Math.sin(rad(a0))
    const x1 = cx + r * Math.cos(rad(a1))
    const y1 = cy + r * Math.sin(rad(a1))
    const large = a1 - a0 > 180 ? 1 : 0
    return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} L ${cx} ${cy} Z`
  }

  return (
    <div className="rem-torta-wrap">
      <svg viewBox="0 0 120 120" width="180" height="180" role="img" aria-label="Distribución">
        {segmentos.map((s, idx) => (
          <path
            key={`${s.clave}-${idx}`}
            d={describeArco(60, 60, 52, s.inicio, s.fin)}
            fill={s.color}
            stroke="#fff"
            strokeWidth="1.5"
          />
        ))}
      </svg>
      <ul className="rem-leyenda">
        {segmentos.map((s, idx) => (
          <li key={`${s.clave}-${idx}`}>
            <span className="rem-leyenda-color" style={{ background: s.color }} />
            {s.clave} ({s.valor})
          </li>
        ))}
      </ul>
    </div>
  )
}

function Rem() {
  const [datos, setDatos] = useState<RemResumen | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  function exportarExcel() {
    if (!datos) return
    const filas: (string | number)[][] = [
      ['Indicador', 'Valor'],
      ['Atenciones totales', datos.atenciones_totales],
      ['Atenciones este mes', datos.atenciones_mes],
      ['Citas registradas', datos.citas_registradas],
      ['Atenciones cobradas (bonos)', datos.bonos_totales],
    ]
    filas.push([])
    filas.push(['Especialidad', 'Cantidad'])
    for (const e of datos.top_especialidades) filas.push([e.clave, e.valor])
    filas.push([])
    filas.push(['Tipo de atención', 'Cantidad'])
    for (const t of datos.distribucion_atencion) filas.push([t.clave, t.valor])
    if (datos.puede_ver_diagnosticos) {
      filas.push([])
      filas.push(['Diagnóstico', 'Cantidad'])
      for (const d of datos.top_diagnosticos) filas.push([d.clave, d.valor])
    }

    const esc = (v: string | number) => {
      const s = String(v)
      return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const csv = filas.map((f) => f.map(esc).join(';')).join('\r\n')
    const blob = new Blob(['\ufeff' + csv], {
      type: 'text/csv;charset=utf-8;',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `REM_SWIMyti_${datos.periodo.replace(/\s+/g, '_')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)

    const { data, error: rpcError } = await supabase.rpc('fn_rem_resumen')

    if (rpcError) {
      setError(rpcError.message)
    } else {
      setDatos(data as unknown as RemResumen)
    }

    setLoading(false)
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  return (
    <div className="dash">
      <Sidebar moduloActivo="rem" />

      <div className="dash-main">
        <header className="dash-topbar">
          <div>
            <h2>REM — Resumen Estadístico Mensual</h2>
            <p>Indicadores de atención del centro · {datos?.periodo ?? ''}</p>
          </div>
          <button
            type="button"
            className="dash-btn-primary"
            onClick={exportarExcel}
            disabled={loading || !datos}
          >
            Exportar a Excel
          </button>
        </header>

        <section className="dash-content">
          {error ? (
            <p className="dash-alert dash-alert-error" role="alert">
              {error}
            </p>
          ) : null}

          {loading ? (
            <p className="dash-loading">Calculando indicadores…</p>
          ) : datos ? (
            <>
              <div className="rem-kpis">
                <div className="rem-kpi">
                  <div className="rem-kpi-valor">{datos.atenciones_totales}</div>
                  <div className="rem-kpi-label">Atenciones totales</div>
                </div>
                <div className="rem-kpi">
                  <div className="rem-kpi-valor">{datos.atenciones_mes}</div>
                  <div className="rem-kpi-label">Atenciones este mes</div>
                </div>
                <div className="rem-kpi">
                  <div className="rem-kpi-valor">{datos.citas_registradas}</div>
                  <div className="rem-kpi-label">Citas registradas</div>
                </div>
                <div className="rem-kpi">
                  <div className="rem-kpi-valor">{datos.bonos_totales}</div>
                  <div className="rem-kpi-label">Atenciones cobradas (bonos)</div>
                </div>
              </div>

              <div className="rem-grid">
                <div className="rem-card">
                  <h3>Especialidades más solicitadas</h3>
                  {datos.top_especialidades.length === 0 ? (
                    <p className="rem-vacio">Sin datos de citas aún.</p>
                  ) : (
                    <Barras datos={datos.top_especialidades} />
                  )}
                </div>

                <div className="rem-card">
                  <h3>Distribución consultas vs procedimientos</h3>
                  {datos.distribucion_atencion.length === 0 ? (
                    <p className="rem-vacio">Sin bonos registrados aún.</p>
                  ) : (
                    <Torta datos={datos.distribucion_atencion} />
                  )}
                </div>

                <div className="rem-card">
                  <h3>Ingresos por tipo de atención (bonos)</h3>
                  {datos.ingresos_por_tipo.length === 0 ? (
                    <p className="rem-vacio">Sin bonos registrados aún.</p>
                  ) : (
                    <Barras datos={datos.ingresos_por_tipo} />
                  )}
                </div>

                <div className="rem-card">
                  <h3>Diagnósticos más comunes</h3>
                  {!datos.puede_ver_diagnosticos ? (
                    <p className="rem-vacio">
                      El detalle de diagnósticos se reserva para administración.
                    </p>
                  ) : datos.top_diagnosticos.length === 0 ? (
                    <p className="rem-vacio">Sin atenciones registradas aún.</p>
                  ) : (
                    <Barras datos={datos.top_diagnosticos} />
                  )}
                </div>
              </div>
            </>
          ) : null}
        </section>
      </div>
    </div>
  )
}

export default Rem