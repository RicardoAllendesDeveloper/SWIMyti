import { useState } from 'react'
import Sidebar from '../components/Sidebar'
import '../styles/Calculos.css'

function redondear(valor: number, decimales = 2): number {
  const factor = 10 ** decimales
  return Math.round(valor * factor) / factor
}

function IMC() {
  const [peso, setPeso] = useState('')
  const [talla, setTalla] = useState('')

  const pesoNum = Number(peso)
  const tallaNum = Number(talla) / 100
  const imc =
    pesoNum > 0 && tallaNum > 0
      ? redondear(pesoNum / (tallaNum * tallaNum))
      : null

  let clasificacion = ''
  if (imc !== null) {
    if (imc < 18.5) clasificacion = 'Bajo peso'
    else if (imc < 25) clasificacion = 'Normal'
    else if (imc < 30) clasificacion = 'Sobrepeso'
    else if (imc < 35) clasificacion = 'Obesidad grado I'
    else if (imc < 40) clasificacion = 'Obesidad grado II'
    else clasificacion = 'Obesidad grado III'
  }

  return (
    <div className="calc-card">
      <h3>Índice de Masa Corporal (IMC)</h3>
      <div className="calc-fields">
        <label>
          Peso (kg)
          <input
            type="number"
            min="0"
            step="0.1"
            value={peso}
            onChange={(e) => setPeso(e.target.value)}
            placeholder="Ej. 70"
          />
        </label>
        <label>
          Talla (cm)
          <input
            type="number"
            min="0"
            step="0.1"
            value={talla}
            onChange={(e) => setTalla(e.target.value)}
            placeholder="Ej. 170"
          />
        </label>
      </div>
      {imc !== null ? (
        <p className="calc-resultado">
          IMC: <strong>{imc}</strong> — {clasificacion}
        </p>
      ) : (
        <p className="calc-ayuda">Ingresa peso y talla para calcular el IMC.</p>
      )}
    </div>
  )
}

function HOMA() {
  const [glucemia, setGlucemia] = useState('')
  const [insulina, setInsulina] = useState('')

  const g = Number(glucemia)
  const i = Number(insulina)
  const homa = g > 0 && i > 0 ? redondear((g * i) / 405) : null

  return (
    <div className="calc-card">
      <h3>HOMA-IR (resistencia a la insulina)</h3>
      <div className="calc-fields">
        <label>
          Glucemia en ayunas (mg/dL)
          <input
            type="number"
            min="0"
            step="0.1"
            value={glucemia}
            onChange={(e) => setGlucemia(e.target.value)}
            placeholder="Ej. 90"
          />
        </label>
        <label>
          Insulina en ayunas (µU/mL)
          <input
            type="number"
            min="0"
            step="0.1"
            value={insulina}
            onChange={(e) => setInsulina(e.target.value)}
            placeholder="Ej. 12"
          />
        </label>
      </div>
      {homa !== null ? (
        <p className="calc-resultado">
          HOMA-IR: <strong>{homa}</strong>{' '}
          {homa >= 2.5 ? '— sugiere resistencia a la insulina' : '— dentro de rango'}
        </p>
      ) : (
        <p className="calc-ayuda">Ingresa glucemia e insulina para calcular HOMA-IR.</p>
      )}
    </div>
  )
}

function PerfilPresion() {
  const [sistolica, setSistolica] = useState('')
  const [diastolica, setDiastolica] = useState('')
  const [mediciones, setMediciones] = useState<{ s: number; d: number }[]>([])

  const s = Number(sistolica)
  const d = Number(diastolica)

  function agregarMedicion() {
    if (s > 0 && d > 0) {
      setMediciones((prev) => [...prev, { s, d }])
      setSistolica('')
      setDiastolica('')
    }
  }

  function eliminarMedicion(idx: number) {
    setMediciones((prev) => prev.filter((_, i) => i !== idx))
  }

  const promedio =
    mediciones.length > 0
      ? {
          s: redondear(mediciones.reduce((acc, m) => acc + m.s, 0) / mediciones.length),
          d: redondear(mediciones.reduce((acc, m) => acc + m.d, 0) / mediciones.length),
        }
      : null

  let clasificacion = ''
  if (promedio) {
    const ps = promedio.s
    const pd = promedio.d
    if (ps < 120 && pd < 80) clasificacion = 'Presión arterial normal'
    else if (ps < 130 && pd < 85) clasificacion = 'Presión normal-alta'
    else if (ps < 140 || pd < 90) clasificacion = 'Hipertensión grado I'
    else if (ps < 160 || pd < 100) clasificacion = 'Hipertensión grado II'
    else clasificacion = 'Hipertensión grado III'
  }

  return (
    <div className="calc-card">
      <h3>Perfil de presión arterial</h3>
      <div className="calc-fields">
        <label>
          Presión sistólica (mmHg)
          <input
            type="number"
            min="0"
            value={sistolica}
            onChange={(e) => setSistolica(e.target.value)}
            placeholder="Ej. 120"
          />
        </label>
        <label>
          Presión diastólica (mmHg)
          <input
            type="number"
            min="0"
            value={diastolica}
            onChange={(e) => setDiastolica(e.target.value)}
            placeholder="Ej. 80"
          />
        </label>
        <button
          type="button"
          className="dash-btn-secondary"
          onClick={agregarMedicion}
          disabled={!(s > 0 && d > 0)}
        >
          Agregar medición
        </button>
      </div>

      {mediciones.length > 0 ? (
        <>
          <ul className="calc-mediciones">
            {mediciones.map((m, idx) => (
              <li key={idx}>
                {m.s}/{m.d} mmHg
                <button
                  type="button"
                  className="calc-medicion-eliminar"
                  onClick={() => eliminarMedicion(idx)}
                  aria-label="Eliminar medición"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <p className="calc-resultado">
            Promedio: <strong>{promedio!.s}/{promedio!.d} mmHg</strong> — {clasificacion}
          </p>
        </>
      ) : (
        <p className="calc-ayuda">
          Ingresa una o más mediciones para calcular el promedio y clasificar.
        </p>
      )}
    </div>
  )
}

function DosisMedicamento() {
  const [dosisReferencia, setDosisReferencia] = useState('')
  const [peso, setPeso] = useState('')
  const [frecuencia, setFrecuencia] = useState('24')
  const [presentacion, setPresentacion] = useState('')

  const dosisRef = Number(dosisReferencia)
  const pesoNum = Number(peso)
  const freq = Number(frecuencia)
  const present = Number(presentacion)

  const dosisPorToma =
    dosisRef > 0 && pesoNum > 0 && freq > 0
      ? redondear((dosisRef * pesoNum) / freq, 3)
      : null

  let unidades = ''
  if (dosisPorToma !== null && present > 0) {
    unidades = `${redondear(dosisPorToma / present, 2)} unidad(es) por toma`
  } else if (dosisPorToma !== null) {
    unidades = 'mg por toma'
  }

  return (
    <div className="calc-card">
      <h3>Cálculo de dosis de medicamento</h3>
      <p className="calc-ayuda">
        Según dosis de referencia (mg/kg/día), peso del paciente y frecuencia.
      </p>
      <div className="calc-fields">
        <label>
          Dosis de referencia (mg/kg/día)
          <input
            type="number"
            min="0"
            step="0.1"
            value={dosisReferencia}
            onChange={(e) => setDosisReferencia(e.target.value)}
            placeholder="Ej. 15"
          />
        </label>
        <label>
          Peso del paciente (kg)
          <input
            type="number"
            min="0"
            step="0.1"
            value={peso}
            onChange={(e) => setPeso(e.target.value)}
            placeholder="Ej. 20"
          />
        </label>
        <label>
          Frecuencia (horas)
          <input
            type="number"
            min="1"
            value={frecuencia}
            onChange={(e) => setFrecuencia(e.target.value)}
          />
        </label>
        <label>
          Presentación (mg/unidad, opcional)
          <input
            type="number"
            min="0"
            step="0.1"
            value={presentacion}
            onChange={(e) => setPresentacion(e.target.value)}
            placeholder="Ej. 250"
          />
        </label>
      </div>
      {dosisPorToma !== null ? (
        <p className="calc-resultado">
          Dosis por toma: <strong>{dosisPorToma}</strong> {unidades}
        </p>
      ) : (
        <p className="calc-ayuda">
          Completa la dosis de referencia y el peso para calcular.
        </p>
      )}
    </div>
  )
}

export function CalculosGrid() {
  return (
    <>
      <div className="calc-grid">
        <IMC />
        <HOMA />
        <PerfilPresion />
        <DosisMedicamento />
      </div>
      <p className="calc-nota">
        Herramientas de apoyo a la decisión. No sustituyen el criterio del
        profesional de salud.
      </p>
    </>
  )
}

export function CalculosModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="dash-modal-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="dash-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="calculadora-title"
      >
        <div className="dash-modal-header">
          <div>
            <h3 id="calculadora-title">Cálculos clínicos</h3>
            <p>Usa las herramientas sin cerrar el formulario.</p>
          </div>
          <button
            type="button"
            className="dash-modal-close"
            onClick={onClose}
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>
        <div className="dash-modal-body calculos-modal-body">
          <CalculosGrid />
        </div>
      </div>
    </div>
  )
}

function Calculos() {
  return (
    <div className="dash">
      <Sidebar moduloActivo="calculos" />

      <div className="dash-main">
        <header className="dash-topbar">
          <div>
            <h2>Cálculos clínicos</h2>
            <p>Herramientas rápidas para el apoyo a la decisión clínica</p>
          </div>
        </header>

        <section className="dash-content">
          <CalculosGrid />
        </section>
      </div>
    </div>
  )
}

export default Calculos