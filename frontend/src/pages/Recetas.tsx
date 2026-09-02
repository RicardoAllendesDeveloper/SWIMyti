import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../services/supabase'
import { useAuthRol } from '../context/AuthRolContext'
import Sidebar from '../components/Sidebar'
import { puedeEnmendar } from '../utils/permisos'
import type { Paciente } from '../types/database'
import '../styles/Recetas.css'

type Receta = {
  id_receta: number
  id_paciente: number
  id_usuario_emisor: string
  medicamentos: string
  indicaciones: string | null
  fecha_emision: string
  pacientes?: { nombres: string; apellidos: string; rut: string } | null
}

type Certificado = {
  id_certificado: number
  id_paciente: number
  id_usuario_emisor: string
  tipo_certificado: string
  detalle: string | null
  fecha_emision: string
  pacientes?: { nombres: string; apellidos: string; rut: string } | null
}

const TIPOS_CERTIFICADO = [
  'Reposo laboral',
  'Atención médica',
  'Aptitud',
  'Vacunación',
  'Otro',
]

function formatFecha(value: string): string {
  try {
    return new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium' }).format(
      new Date(value),
    )
  } catch {
    return value
  }
}

async function buildFirmaHash(userId: string): Promise<string> {
  const payload = `${userId}:${Date.now()}:swimyti-doc`
  if (globalThis.crypto?.subtle) {
    const data = new TextEncoder().encode(payload)
    const digest = await globalThis.crypto.subtle.digest('SHA-256', data)
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }
  return btoa(payload)
}

function Recetas() {
  const { rol } = useAuthRol()
  const puedeEmitir = puedeEnmendar(rol)

  const [recetas, setRecetas] = useState<Receta[]>([])
  const [certificados, setCertificados] = useState<Certificado[]>([])
  const [pacientes, setPacientes] = useState<Paciente[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [userId, setUserId] = useState('')
  const [tab, setTab] = useState<'recetas' | 'certificados'>('recetas')
  const [showForm, setShowForm] = useState(false)

  // Receta
  const [rPaciente, setRPaciente] = useState('')
  const [medicamentos, setMedicamentos] = useState('')
  const [indicaciones, setIndicaciones] = useState('')

  // Certificado
  const [cPaciente, setCPaciente] = useState('')
  const [cTipo, setCTipo] = useState(TIPOS_CERTIFICADO[0])
  const [cDetalle, setCDetalle] = useState('')

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)

    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (user) setUserId(user.id)

    const [recRes, certRes, pacRes] = await Promise.all([
      supabase
        .from('recetas_medicas')
        .select(
          'id_receta, id_paciente, id_usuario_emisor, medicamentos, indicaciones, fecha_emision, pacientes(nombres, apellidos, rut)',
        )
        .order('fecha_emision', { ascending: false }),
      supabase
        .from('certificados_clinicos')
        .select(
          'id_certificado, id_paciente, id_usuario_emisor, tipo_certificado, detalle, fecha_emision, pacientes(nombres, apellidos, rut)',
        )
        .order('fecha_emision', { ascending: false }),
      supabase
        .from('pacientes')
        .select('id_paciente, rut, nombres, apellidos')
        .eq('activo', true)
        .order('apellidos', { ascending: true }),
    ])

    if (recRes.error) {
      setError(recRes.error.message || 'No se pudieron cargar las recetas.')
      setRecetas([])
    } else {
      const rows = (recRes.data ?? []).map((row) => {
        const rel = row.pacientes as
          | { nombres: string; apellidos: string; rut: string }
          | { nombres: string; apellidos: string; rut: string }[]
          | null
        const p = Array.isArray(rel) ? rel[0] ?? null : rel
        return {
          id_receta: row.id_receta as number,
          id_paciente: row.id_paciente as number,
          id_usuario_emisor: row.id_usuario_emisor as string,
          medicamentos: row.medicamentos as string,
          indicaciones: row.indicaciones as string | null,
          fecha_emision: row.fecha_emision as string,
          pacientes: p
            ? { nombres: p.nombres, apellidos: p.apellidos, rut: p.rut }
            : null,
        } satisfies Receta
      })
      setRecetas(rows)
    }

    if (certRes.error) {
      setError((c) => c ?? (certRes.error?.message || 'No se pudieron cargar los certificados.'))
      setCertificados([])
    } else {
      const rows = (certRes.data ?? []).map((row) => {
        const rel = row.pacientes as
          | { nombres: string; apellidos: string; rut: string }
          | { nombres: string; apellidos: string; rut: string }[]
          | null
        const p = Array.isArray(rel) ? rel[0] ?? null : rel
        return {
          id_certificado: row.id_certificado as number,
          id_paciente: row.id_paciente as number,
          id_usuario_emisor: row.id_usuario_emisor as string,
          tipo_certificado: row.tipo_certificado as string,
          detalle: row.detalle as string | null,
          fecha_emision: row.fecha_emision as string,
          pacientes: p
            ? { nombres: p.nombres, apellidos: p.apellidos, rut: p.rut }
            : null,
        } satisfies Certificado
      })
      setCertificados(rows)
    }

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
    setRPaciente('')
    setMedicamentos('')
    setIndicaciones('')
    setCPaciente('')
    setCTipo(TIPOS_CERTIFICADO[0])
    setCDetalle('')
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

    if (tab === 'recetas') {
      if (!rPaciente || !medicamentos.trim()) {
        setError('Selecciona un paciente y escribe los medicamentos.')
        return
      }
      setSaving(true)
      const firma = await buildFirmaHash(userId)
      const { error: insError } = await supabase.from('recetas_medicas').insert({
        id_paciente: Number(rPaciente),
        id_usuario_emisor: userId,
        medicamentos: medicamentos.trim(),
        indicaciones: indicaciones.trim() || null,
        firma_digital_hash: firma,
      })
      setSaving(false)
      if (insError) {
        setError(insError.message || 'No se pudo emitir la receta.')
        return
      }
      setSuccess('Receta médica emitida correctamente.')
    } else {
      if (!cPaciente || !cTipo) {
        setError('Selecciona un paciente y el tipo de certificado.')
        return
      }
      setSaving(true)
      const firma = await buildFirmaHash(userId)
      const { error: insError } = await supabase
        .from('certificados_clinicos')
        .insert({
          id_paciente: Number(cPaciente),
          id_usuario_emisor: userId,
          tipo_certificado: cTipo,
          detalle: cDetalle.trim() || null,
          firma_digital_hash: firma,
        })
      setSaving(false)
      if (insError) {
        setError(insError.message || 'No se pudo emitir el certificado.')
        return
      }
      setSuccess('Certificado clínico emitido correctamente.')
    }

    setShowForm(false)
    await loadData()
  }

  return (
    <div className="dash">
      <Sidebar moduloActivo="recetas" />

      <div className="dash-main">
        <header className="dash-topbar">
          <div>
            <h2>Recetas y certificados</h2>
            <p>Emisión de recetas médicas y certificados clínicos</p>
          </div>
          {puedeEmitir ? (
            <button
              type="button"
              className="dash-btn-primary"
              onClick={openForm}
            >
              Nuevo documento
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

          <div className="recetas-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'recetas'}
              className={`recetas-tab${tab === 'recetas' ? ' is-active' : ''}`}
              onClick={() => setTab('recetas')}
            >
              Recetas médicas
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'certificados'}
              className={`recetas-tab${tab === 'certificados' ? ' is-active' : ''}`}
              onClick={() => setTab('certificados')}
            >
              Certificados
            </button>
          </div>

          <div className="dash-card">
            <div className="dash-card-header">
              <div>
                <h3>{tab === 'recetas' ? 'Recetas médicas' : 'Certificados clínicos'}</h3>
                <p className="dash-muted">
                  {tab === 'recetas'
                    ? 'Medicamentos e indicaciones emitidos por el profesional'
                    : 'Reposo, atención, aptitud y otros certificados'}
                </p>
              </div>
              <span className="dash-badge">
                {loading
                  ? '…'
                  : tab === 'recetas'
                    ? `${recetas.length} registro${recetas.length === 1 ? '' : 's'}`
                    : `${certificados.length} registro${certificados.length === 1 ? '' : 's'}`}
              </span>
            </div>

            {loading ? (
              <p className="dash-loading">Cargando…</p>
            ) : tab === 'recetas' ? (
              recetas.length === 0 ? (
                <p className="dash-empty">
                  No hay recetas registradas. Usa “Nuevo documento” para emitir la primera.
                </p>
              ) : (
                <div className="dash-table-wrap">
                  <table className="dash-table">
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Paciente</th>
                        <th>Medicamentos</th>
                        <th>Indicaciones</th>
                        <th>Emisión</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recetas.map((r) => (
                        <tr key={r.id_receta}>
                          <td>#{r.id_receta}</td>
                          <td>
                            <div>
                              {r.pacientes
                                ? `${r.pacientes.nombres} ${r.pacientes.apellidos}`
                                : `Paciente #${r.id_paciente}`}
                            </div>
                            {r.pacientes?.rut ? (
                              <div className="dash-muted">RUT {r.pacientes.rut}</div>
                            ) : null}
                          </td>
                          <td>{r.medicamentos}</td>
                          <td>{r.indicaciones || '—'}</td>
                          <td>{formatFecha(r.fecha_emision)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            ) : certificados.length === 0 ? (
              <p className="dash-empty">
                No hay certificados registrados. Usa “Nuevo documento” para emitir el primero.
              </p>
            ) : (
              <div className="dash-table-wrap">
                <table className="dash-table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Paciente</th>
                      <th>Tipo</th>
                      <th>Detalle</th>
                      <th>Emisión</th>
                    </tr>
                  </thead>
                  <tbody>
                    {certificados.map((c) => (
                      <tr key={c.id_certificado}>
                        <td>#{c.id_certificado}</td>
                        <td>
                          <div>
                            {c.pacientes
                              ? `${c.pacientes.nombres} ${c.pacientes.apellidos}`
                              : `Paciente #${c.id_paciente}`}
                          </div>
                          {c.pacientes?.rut ? (
                            <div className="dash-muted">RUT {c.pacientes.rut}</div>
                          ) : null}
                        </td>
                        <td>
                          <span className="recetas-chip">{c.tipo_certificado}</span>
                        </td>
                        <td>{c.detalle || '—'}</td>
                        <td>{formatFecha(c.fecha_emision)}</td>
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
            aria-labelledby="nuevo-doc-title"
          >
            <div className="dash-modal-header">
              <div>
                <h3 id="nuevo-doc-title">
                  {tab === 'recetas' ? 'Nueva receta médica' : 'Nuevo certificado'}
                </h3>
                <p>El documento queda firmado digitalmente y es inmutable una vez guardado.</p>
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
                <label htmlFor="doc-paciente">Paciente</label>
                <select
                  id="doc-paciente"
                  value={tab === 'recetas' ? rPaciente : cPaciente}
                  onChange={(e) =>
                    tab === 'recetas'
                      ? setRPaciente(e.target.value)
                      : setCPaciente(e.target.value)
                  }
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

              {tab === 'recetas' ? (
                <>
                  <div className="dash-field">
                    <label htmlFor="doc-medicamentos">Medicamentos</label>
                    <textarea
                      id="doc-medicamentos"
                      value={medicamentos}
                      onChange={(e) => setMedicamentos(e.target.value)}
                      placeholder="Ej. Paracetamol 500 mg, 1 comprimido c/8 horas"
                      required
                      disabled={saving}
                    />
                  </div>
                  <div className="dash-field">
                    <label htmlFor="doc-indicaciones">Indicaciones (opcional)</label>
                    <textarea
                      id="doc-indicaciones"
                      value={indicaciones}
                      onChange={(e) => setIndicaciones(e.target.value)}
                      placeholder="Reposo, dieta, controles"
                      disabled={saving}
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="dash-field">
                    <label htmlFor="doc-tipo">Tipo de certificado</label>
                    <select
                      id="doc-tipo"
                      value={cTipo}
                      onChange={(e) => setCTipo(e.target.value)}
                      required
                      disabled={saving}
                    >
                      {TIPOS_CERTIFICADO.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="dash-field">
                    <label htmlFor="doc-detalle">Detalle (opcional)</label>
                    <textarea
                      id="doc-detalle"
                      value={cDetalle}
                      onChange={(e) => setCDetalle(e.target.value)}
                      placeholder="Detalle del certificado"
                      disabled={saving}
                    />
                  </div>
                </>
              )}

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
                  {saving ? 'Guardando…' : 'Guardar documento'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default Recetas
