import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../services/supabase'
import { useAuthRol } from '../context/AuthRolContext'
import Sidebar from '../components/Sidebar'
import { CalculosModal } from './Calculos'
import { puedeCrearFicha } from '../utils/permisos'
import type { FichaMedica, Paciente } from '../types/database'
import '../styles/Dashboard.css'

function formatDate(value: string): string {
  try {
    return new Intl.DateTimeFormat('es-CL', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value))
  } catch {
    return value
  }
}

async function buildFirmaHash(userId: string): Promise<string> {
  const payload = `${userId}:${Date.now()}:swimyti-ficha`
  if (globalThis.crypto?.subtle) {
    const data = new TextEncoder().encode(payload)
    const digest = await globalThis.crypto.subtle.digest('SHA-256', data)
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }
  return btoa(payload)
}

function Dashboard() {
  const navigate = useNavigate()
  const { rol } = useAuthRol()
  const [userId, setUserId] = useState<string>('')
  const [fichas, setFichas] = useState<FichaMedica[]>([])
  const [pacientes, setPacientes] = useState<Paciente[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)

  const [idPaciente, setIdPaciente] = useState('')
  const [motivoConsulta, setMotivoConsulta] = useState('')
  const [anamnesis, setAnamnesis] = useState('')
  const [diagnostico, setDiagnostico] = useState('')
  const [missingProfile, setMissingProfile] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [pagina, setPagina] = useState(1)
  const POR_PAGINA = 10
  const [showCalculadora, setShowCalculadora] = useState(false)

  const loadPacientes = useCallback(async () => {
    const pacientesRes = await supabase
      .from('pacientes')
      .select('id_paciente, rut, nombres, apellidos')
      .eq('activo', true)
      .order('apellidos', { ascending: true })

    if (pacientesRes.error) {
      setPacientes([])
      return (
        pacientesRes.error.message || 'No se pudieron cargar los pacientes.'
      )
    }

    setPacientes((pacientesRes.data as Paciente[]) ?? [])
    return null
  }, [])

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    setMissingProfile(false)

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      setError('No se pudo obtener la sesión del usuario.')
      setLoading(false)
      return
    }

    setUserId(user.id)

    const profileRes = await supabase
      .from('usuarios')
      .select('id_usuario')
      .eq('id_usuario', user.id)
      .maybeSingle()

    if (!profileRes.error && !profileRes.data) {
      setMissingProfile(true)
      setError(
        'Tu cuenta no tiene perfil en public.usuarios. Sin rol staff, RLS oculta pacientes y bloquea fichas. Ejecuta supabase/seed_mi_usuario.sql en el SQL Editor de Supabase (cambia el email).',
      )
    }

    const [fichasRes, pacientesError] = await Promise.all([
      supabase
        .from('fichas_medicas')
        .select(
          'id_ficha, id_paciente, id_usuario_creador, motivo_consulta, diagnostico, created_at, pacientes(nombres, apellidos, rut)',
        )
        .order('created_at', { ascending: false }),
      loadPacientes(),
    ])

    if (fichasRes.error) {
      setError(
        fichasRes.error.message ||
          'No se pudieron cargar las fichas médicas.',
      )
      setFichas([])
    } else {
      const rows = (fichasRes.data ?? []).map((row) => {
        const related = row.pacientes
        const paciente = Array.isArray(related) ? related[0] ?? null : related

        return {
          id_ficha: row.id_ficha as number,
          id_paciente: row.id_paciente as number,
          id_usuario_creador: row.id_usuario_creador as string,
          motivo_consulta: row.motivo_consulta as string,
          diagnostico: row.diagnostico as string,
          created_at: row.created_at as string,
          pacientes: paciente
            ? {
                nombres: paciente.nombres as string,
                apellidos: paciente.apellidos as string,
                rut: paciente.rut as string,
              }
            : null,
        } satisfies FichaMedica
      })

      setFichas(rows)
    }

    if (pacientesError) {
      setError((current) => current ?? pacientesError)
    }

    setLoading(false)
  }, [loadPacientes])

  useEffect(() => {
    void loadData()
  }, [loadData])

  function resetForm() {
    setIdPaciente('')
    setMotivoConsulta('')
    setAnamnesis('')
    setDiagnostico('')
  }

  async function openForm() {
    setSuccess(null)
    setError(null)
    resetForm()
    const pacientesError = await loadPacientes()
    if (pacientesError) {
      setError(pacientesError)
    }
    setShowForm(true)
  }

  function closeForm() {
    if (saving) return
    setShowForm(false)
    resetForm()
  }

  async function handleCreateFicha(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSuccess(null)

    if (!userId) {
      setError('Sesión no válida. Vuelve a iniciar sesión.')
      return
    }

    if (!idPaciente || !motivoConsulta.trim() || !diagnostico.trim()) {
      setError('Completa paciente, motivo de consulta y diagnóstico.')
      return
    }

    setSaving(true)

    try {
      const firma_digital_hash = await buildFirmaHash(userId)

      const { error: insertError } = await supabase.from('fichas_medicas').insert({
        id_paciente: Number(idPaciente),
        id_usuario_creador: userId,
        motivo_consulta: motivoConsulta.trim(),
        anamnesis: anamnesis.trim() || null,
        diagnostico: diagnostico.trim(),
        firma_digital_hash,
      })

      if (insertError) {
        setError(
          insertError.message ||
            'No se pudo crear la ficha. Verifica permisos RLS y tu perfil en usuarios.',
        )
        return
      }

      setSuccess('Ficha médica creada correctamente (registro inmutable).')
      setShowForm(false)
      resetForm()
      await loadData()
    } catch {
      setError('Error inesperado al crear la ficha.')
    } finally {
      setSaving(false)
    }
  }

  const fichasFiltradas = fichas.filter((ficha) => {
    if (!busqueda.trim()) return true
    const q = busqueda.trim().toLowerCase()
    const paciente = ficha.pacientes
    const nombre = paciente
      ? `${paciente.nombres} ${paciente.apellidos} ${paciente.rut}`.toLowerCase()
      : ''
    return (
      nombre.includes(q) ||
      String(ficha.motivo_consulta).toLowerCase().includes(q) ||
      String(ficha.diagnostico).toLowerCase().includes(q)
    )
  })

  const totalPaginas = Math.max(1, Math.ceil(fichasFiltradas.length / POR_PAGINA))
  const paginaSegura = Math.min(pagina, totalPaginas)
  const fichasPagina = fichasFiltradas.slice(
    (paginaSegura - 1) * POR_PAGINA,
    paginaSegura * POR_PAGINA,
  )

  return (
    <div className="dash">
      <Sidebar moduloActivo="fichas" />

      <div className="dash-main">
        <header className="dash-topbar">
          <div>
            <h2>Bienvenido a SWIMyti</h2>
            <p>Registro clínico inmutable y trazable</p>
          </div>
          {puedeCrearFicha(rol) ? (
            <button
              type="button"
              className="dash-btn-primary"
              onClick={() => void openForm()}
            >
              Nueva atención
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
                <h3>Historial de atenciones</h3>
                <p className="dash-muted">
                  Registro clínico inmutable (tabla fichas_medicas)
                </p>
              </div>
              <span className="dash-badge">
                {loading ? '…' : `${fichas.length} registro${fichas.length === 1 ? '' : 's'}`}
              </span>
            </div>

            {loading ? (
              <p className="dash-loading">Cargando atenciones…</p>
            ) : (
              <>
                <div className="dash-filter-bar">
                  <input
                    className="dash-filter-input"
                    type="search"
                    placeholder="Buscar por paciente, RUT, motivo o diagnóstico…"
                    value={busqueda}
                    onChange={(e) => {
                      setBusqueda(e.target.value)
                      setPagina(1)
                    }}
                  />
                  <span className="dash-muted">
                    {fichasFiltradas.length} resultado
                    {fichasFiltradas.length === 1 ? '' : 's'}
                  </span>
                </div>
                {fichasFiltradas.length === 0 ? (
                  <p className="dash-empty">
                    No hay atenciones que coincidan con la búsqueda.
                  </p>
                ) : (
                  <div className="dash-table-wrap">
                    <table className="dash-table">
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>Paciente</th>
                          <th>Motivo</th>
                          <th>Diagnóstico</th>
                          <th>Fecha</th>
                          <th>Acción</th>
                        </tr>
                      </thead>
                      <tbody>
                        {fichasPagina.map((ficha) => {
                          const paciente = ficha.pacientes
                          const nombrePaciente = paciente
                            ? `${paciente.apellidos}, ${paciente.nombres}`
                            : `Paciente #${ficha.id_paciente}`

                          return (
                            <tr key={ficha.id_ficha}>
                              <td>#{ficha.id_ficha}</td>
                              <td>
                                <div>{nombrePaciente}</div>
                                {paciente?.rut ? (
                                  <div className="dash-muted">RUT {paciente.rut}</div>
                                ) : null}
                              </td>
                              <td>{ficha.motivo_consulta}</td>
                              <td>{ficha.diagnostico}</td>
                              <td>{formatDate(ficha.created_at)}</td>
                              <td>
                                <button
                                  type="button"
                                  className="dash-btn-secondary"
                                  onClick={() => navigate(`/expediente/${ficha.id_paciente}`)}
                                >
                                  Ver expediente
                                </button>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                    {totalPaginas > 1 ? (
                      <div className="dash-pagination">
                        <button
                          type="button"
                          className="dash-btn-secondary"
                          disabled={paginaSegura <= 1}
                          onClick={() => setPagina(paginaSegura - 1)}
                        >
                          Anterior
                        </button>
                        <span className="dash-muted">
                          Página {paginaSegura} de {totalPaginas}
                        </span>
                        <button
                          type="button"
                          className="dash-btn-secondary"
                          disabled={paginaSegura >= totalPaginas}
                          onClick={() => setPagina(paginaSegura + 1)}
                        >
                          Siguiente
                        </button>
                      </div>
                    ) : null}
                  </div>
                )}
              </>
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
            aria-labelledby="nueva-ficha-title"
          >
            <div className="dash-modal-header">
              <div>
                <h3 id="nueva-ficha-title">Nueva atención médica</h3>
                <p>
                  El diagnóstico es inmutable. Las correcciones posteriores se
                  registran como enmiendas.
                </p>
              </div>
              <div className="dash-modal-header-actions">
                <button
                  type="button"
                  className="dash-btn-secondary"
                  onClick={() => setShowCalculadora(true)}
                >
                  Calculadora
                </button>
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
            </div>

            <form className="dash-form" onSubmit={(e) => void handleCreateFicha(e)}>
              <div className="dash-field">
                <label htmlFor="ficha-paciente">Paciente</label>
                <select
                  id="ficha-paciente"
                  value={idPaciente}
                  onChange={(e) => setIdPaciente(e.target.value)}
                  required
                  disabled={saving || pacientes.length === 0}
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
                {pacientes.length === 0 ? (
                  <p className="dash-field-hint">
                    {missingProfile
                      ? 'Sin perfil en usuarios, RLS oculta los pacientes aunque existan.'
                      : 'No hay pacientes visibles. Ve a Pacientes para registrar uno.'}
                  </p>
                ) : (
                  <p className="dash-field-hint">
                    {pacientes.length} paciente
                    {pacientes.length === 1 ? '' : 's'} disponible
                    {pacientes.length === 1 ? '' : 's'}
                  </p>
                )}
              </div>

              <div className="dash-field">
                <label htmlFor="ficha-motivo">Motivo de consulta</label>
                <input
                  id="ficha-motivo"
                  type="text"
                  value={motivoConsulta}
                  onChange={(e) => setMotivoConsulta(e.target.value)}
                  placeholder="Ej. Control de hipertensión"
                  required
                  disabled={saving}
                />
              </div>

              <div className="dash-field">
                <label htmlFor="ficha-diagnostico">Diagnóstico (inmutable)</label>
                <textarea
                  id="ficha-diagnostico"
                  value={diagnostico}
                  onChange={(e) => setDiagnostico(e.target.value)}
                  placeholder="Describe el diagnóstico clínico"
                  required
                  disabled={saving}
                />
                <p className="dash-field-hint">
                  Este campo no podrá editarse después de guardar.
                </p>
              </div>

              <div className="dash-field">
                <label htmlFor="ficha-anamnesis">Anamnesis</label>
                <textarea
                  id="ficha-anamnesis"
                  value={anamnesis}
                  onChange={(e) => setAnamnesis(e.target.value)}
                  placeholder="Antecedentes y relato del paciente (separado del diagnóstico)"
                  disabled={saving}
                />
                <p className="dash-field-hint">
                  La anamnesis y el diagnóstico son campos independientes.
                </p>
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
                <button
                  type="submit"
                  className="dash-btn-primary"
                  disabled={saving || pacientes.length === 0}
                >
                  {saving ? 'Guardando…' : 'Guardar atención'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {showCalculadora ? (
        <CalculosModal onClose={() => setShowCalculadora(false)} />
      ) : null}
    </div>
  )
}

export default Dashboard
