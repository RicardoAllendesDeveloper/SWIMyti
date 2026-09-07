import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../services/supabase'
import { useAuthRol } from '../context/AuthRolContext'
import Sidebar from '../components/Sidebar'
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
  const puedeEmitir = rol === 'doctor'

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
  const [busqueda, setBusqueda] = useState('')
  const [pagina, setPagina] = useState(1)
  const [detalle, setDetalle] = useState<Receta | Certificado | null>(null)
  const POR_PAGINA = 10

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

  const filtrarReceta = (r: Receta): boolean => {
    if (!busqueda.trim()) return true
    const q = busqueda.trim().toLowerCase()
    return `${r.medicamentos} ${r.indicaciones ?? ''} ${r.pacientes?.nombres ?? ''} ${r.pacientes?.apellidos ?? ''} ${r.pacientes?.rut ?? ''}`
      .toLowerCase()
      .includes(q)
  }

  const filtrarCertificado = (c: Certificado): boolean => {
    if (!busqueda.trim()) return true
    const q = busqueda.trim().toLowerCase()
    return `${c.tipo_certificado} ${c.detalle ?? ''} ${c.pacientes?.nombres ?? ''} ${c.pacientes?.apellidos ?? ''} ${c.pacientes?.rut ?? ''}`
      .toLowerCase()
      .includes(q)
  }

  const recetasFiltradas = recetas.filter(filtrarReceta)
  const certificadosFiltrados = certificados.filter(filtrarCertificado)

  const listaActiva =
    tab === 'recetas' ? recetasFiltradas : certificadosFiltrados
  const totalPaginas = Math.max(1, Math.ceil(listaActiva.length / POR_PAGINA))
  const paginaSegura = Math.min(pagina, totalPaginas)
  const listaPagina = listaActiva.slice(
    (paginaSegura - 1) * POR_PAGINA,
    paginaSegura * POR_PAGINA,
  )

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
              {tab === 'recetas' ? 'Nueva receta' : 'Nuevo certificado'}
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
            ) : (
              <>
                <div className="dash-filter-bar">
                  <input
                    className="dash-filter-input"
                    type="search"
                    placeholder={
                      tab === 'recetas'
                        ? 'Buscar por paciente, RUT, medicamento o indicación…'
                        : 'Buscar por paciente, RUT, tipo o detalle…'
                    }
                    value={busqueda}
                    onChange={(e) => {
                      setBusqueda(e.target.value)
                      setPagina(1)
                    }}
                  />
                  <span className="dash-muted">
                    {listaActiva.length} resultado
                    {listaActiva.length === 1 ? '' : 's'}
                  </span>
                </div>
                {listaActiva.length === 0 ? (
                  <p className="dash-empty">
                    {tab === 'recetas'
                      ? 'No hay recetas que coincidan con la búsqueda.'
                      : 'No hay certificados que coincidan con la búsqueda.'}
                  </p>
                ) : (
                  <div className="dash-table-wrap">
                    <table className="dash-table">
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>Paciente</th>
                          <th>{tab === 'recetas' ? 'Medicamentos' : 'Tipo'}</th>
                          <th>{tab === 'recetas' ? 'Indicaciones' : 'Detalle'}</th>
                          <th>Emisión</th>
                          <th>Acción</th>
                        </tr>
                      </thead>
                      <tbody>
                        {listaPagina.map((item) => {
                          const esReceta = 'medicamentos' in item
                          const paciente = item.pacientes
                          return (
                            <tr
                              key={
                                esReceta
                                  ? (item as Receta).id_receta
                                  : (item as Certificado).id_certificado
                              }
                            >
                              <td>
                                #
                                {esReceta
                                  ? (item as Receta).id_receta
                                  : (item as Certificado).id_certificado}
                              </td>
                              <td>
                                <div>
                                  {paciente
                                    ? `${paciente.nombres} ${paciente.apellidos}`
                                    : 'Paciente #'}
                                </div>
                                {paciente?.rut ? (
                                  <div className="dash-muted">RUT {paciente.rut}</div>
                                ) : null}
                              </td>
                              <td>
                                {esReceta ? (
                                  (item as Receta).medicamentos
                                ) : (
                                  <span className="recetas-chip">
                                    {(item as Certificado).tipo_certificado}
                                  </span>
                                )}
                              </td>
                              <td>
                                {esReceta
                                  ? (item as Receta).indicaciones || '—'
                                  : (item as Certificado).detalle || '—'}
                              </td>
                              <td>{formatFecha(item.fecha_emision)}</td>
                              <td>
                                <button
                                  type="button"
                                  className="dash-btn-secondary"
                                  onClick={() => setDetalle(item)}
                                >
                                  Ver detalle
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
                  {saving
                    ? 'Guardando…'
                    : tab === 'recetas'
                      ? 'Guardar receta'
                      : 'Guardar certificado'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {detalle ? (
        <div
          className="dash-modal-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDetalle(null)
          }}
        >
          <div
            className="dash-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="detalle-doc-title"
          >
            <div className="dash-modal-header">
              <div>
                <h3 id="detalle-doc-title">
                  {'medicamentos' in detalle ? 'Detalle de receta' : 'Detalle de certificado'}
                </h3>
                <p>
                  {'medicamentos' in detalle
                    ? `Receta médica #${(detalle as Receta).id_receta}`
                    : `Certificado #${(detalle as Certificado).id_certificado}`}
                </p>
              </div>
              <button
                type="button"
                className="dash-modal-close"
                onClick={() => setDetalle(null)}
                aria-label="Cerrar"
              >
                ×
              </button>
            </div>

            <div className="dash-form">
              <div className="dash-field">
                <label>Paciente</label>
                <p className="dash-readonly">
                  {detalle.pacientes
                    ? `${detalle.pacientes.nombres} ${detalle.pacientes.apellidos} · RUT ${detalle.pacientes.rut}`
                    : `Paciente #${detalle.id_paciente}`}
                </p>
              </div>

              {'medicamentos' in detalle ? (
                <>
                  <div className="dash-field">
                    <label>Medicamentos</label>
                    <p className="dash-readonly">{(detalle as Receta).medicamentos}</p>
                  </div>
                  <div className="dash-field">
                    <label>Indicaciones</label>
                    <p className="dash-readonly">
                      {(detalle as Receta).indicaciones || '—'}
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div className="dash-field">
                    <label>Tipo de certificado</label>
                    <p className="dash-readonly">
                      <span className="recetas-chip">
                        {(detalle as Certificado).tipo_certificado}
                      </span>
                    </p>
                  </div>
                  <div className="dash-field">
                    <label>Detalle</label>
                    <p className="dash-readonly">
                      {(detalle as Certificado).detalle || '—'}
                    </p>
                  </div>
                </>
              )}

              <div className="dash-field">
                <label>Fecha de emisión</label>
                <p className="dash-readonly">{formatFecha(detalle.fecha_emision)}</p>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default Recetas
