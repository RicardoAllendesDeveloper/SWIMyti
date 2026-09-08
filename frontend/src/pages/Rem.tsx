import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../services/supabase'
import Sidebar from '../components/Sidebar'
import '../styles/Rem.css'

type AtencionRem = {
  id_ficha: number
  diagnostico: string
  created_at: string
}

type CitaRem = {
  id_cita: number
  created_at: string
  horarios_disponibles?: {
    especialidades?: { nombre?: string } | { nombre?: string }[] | null
  } | null
}

type BonoRem = {
  id_bono: number
  tipo_atencion?: string
  monto: number
  fecha_emision: string
}

function asSingle<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

function topN(
  items: { clave: string; peso?: number }[],
  n = 5,
): { clave: string; valor: number }[] {
  const mapa = new Map<string, number>()
  for (const it of items) {
    const clave = (it.clave || 'Sin información').trim()
    const peso = it.peso ?? 1
    mapa.set(clave, (mapa.get(clave) ?? 0) + peso)
  }
  return [...mapa.entries()]
    .map(([clave, valor]) => ({ clave, valor }))
    .sort((a, b) => b.valor - a.valor)
    .slice(0, n)
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
  const [atenciones, setAtenciones] = useState<AtencionRem[]>([])
  const [citas, setCitas] = useState<CitaRem[]>([])
  const [bonos, setBonos] = useState<BonoRem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)

    const [atRes, ciRes, boRes] = await Promise.all([
      supabase
        .from('fichas_medicas')
        .select('id_ficha, diagnostico, created_at')
        .order('created_at', { ascending: false })
        .limit(500),
      supabase
        .from('citas')
        .select(
          'id_cita, created_at, horarios_disponibles ( especialidades ( nombre ) )',
        )
        .limit(500),
      supabase
        .from('bonos_atencion')
        .select('id_bono, tipo_atencion, monto, fecha_emision')
        .limit(500),
    ])

    if (atRes.error) setError(atRes.error.message)
    else setAtenciones((atRes.data ?? []) as AtencionRem[])

    if (ciRes.error) setError((c) => c ?? ciRes.error.message)
    else setCitas((ciRes.data ?? []) as CitaRem[])

    if (boRes.error) setError((c) => c ?? boRes.error.message)
    else setBonos((boRes.data ?? []) as BonoRem[])

    setLoading(false)
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const mesActual = new Date().toLocaleString('es-CL', {
    month: 'long',
    year: 'numeric',
  })

  const atencionesEsteMes = atenciones.filter((a) => {
    const d = new Date(a.created_at)
    const ahora = new Date()
    return (
      d.getMonth() === ahora.getMonth() && d.getFullYear() === ahora.getFullYear()
    )
  })

  const especialidades = citas.flatMap((c) => {
    const h = c.horarios_disponibles
    const e = h ? asSingle(h.especialidades) : null
    return [{ clave: e?.nombre ?? 'Sin información' }]
  })
  const topEspecialidades = topN(especialidades, 5)

  const tiposAtencion = bonos.map((b) => ({
    clave: b.tipo_atencion === 'procedimiento' ? 'Procedimientos' : 'Consultas',
    peso: b.monto ?? 1,
  }))
  const distribucionAtenciones = topN(
    tiposAtencion.map((t) => ({ clave: t.clave })),
    2,
  )

  const ingresosPorTipo = topN(tiposAtencion, 2)

  const diagnosticoTextos = atenciones.map((a) => ({ clave: a.diagnostico }))
  const topDiagnosticos = topN(diagnosticoTextos, 5)

  return (
    <div className="dash">
      <Sidebar moduloActivo="rem" />

      <div className="dash-main">
        <header className="dash-topbar">
          <div>
            <h2>REM — Resumen Estadístico Mensual</h2>
            <p>Indicadores de atención del centro · {mesActual}</p>
          </div>
        </header>

        <section className="dash-content">
          {error ? (
            <p className="dash-alert dash-alert-error" role="alert">
              {error}
            </p>
          ) : null}

          {loading ? (
            <p className="dash-loading">Calculando indicadores…</p>
          ) : (
            <>
              <div className="rem-kpis">
                <div className="rem-kpi">
                  <div className="rem-kpi-valor">{atenciones.length}</div>
                  <div className="rem-kpi-label">Atenciones totales</div>
                </div>
                <div className="rem-kpi">
                  <div className="rem-kpi-valor">{atencionesEsteMes.length}</div>
                  <div className="rem-kpi-label">Atenciones este mes</div>
                </div>
                <div className="rem-kpi">
                  <div className="rem-kpi-valor">{citas.length}</div>
                  <div className="rem-kpi-label">Citas registradas</div>
                </div>
                <div className="rem-kpi">
                  <div className="rem-kpi-valor">{bonos.length}</div>
                  <div className="rem-kpi-label">Atenciones cobradas (bonos)</div>
                </div>
              </div>

              <div className="rem-grid">
                <div className="rem-card">
                  <h3>Especialidades más solicitadas</h3>
                  {topEspecialidades.length === 0 ? (
                    <p className="rem-vacio">Sin datos de citas aún.</p>
                  ) : (
                    <Barras datos={topEspecialidades} />
                  )}
                </div>

                <div className="rem-card">
                  <h3>Distribución consultas vs procedimientos</h3>
                  {distribucionAtenciones.length === 0 ? (
                    <p className="rem-vacio">Sin bonos registrados aún.</p>
                  ) : (
                    <Torta datos={distribucionAtenciones} />
                  )}
                </div>

                <div className="rem-card">
                  <h3>Ingresos por tipo de atención (bonos)</h3>
                  {ingresosPorTipo.length === 0 ? (
                    <p className="rem-vacio">Sin bonos registrados aún.</p>
                  ) : (
                    <Barras datos={ingresosPorTipo} />
                  )}
                </div>

                <div className="rem-card">
                  <h3>Diagnósticos más comunes</h3>
                  {topDiagnosticos.length === 0 ? (
                    <p className="rem-vacio">Sin atenciones registradas aún.</p>
                  ) : (
                    <Barras datos={topDiagnosticos} />
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

export default Rem