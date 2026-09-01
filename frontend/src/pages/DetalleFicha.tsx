import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../services/supabase'
import { useAuthRol } from '../context/AuthRolContext'
import { puedeEnmendar } from '../utils/permisos'
import type { EnmiendaAuditoria, FichaMedica, UsuarioResumen } from '../types/database'
import '../styles/DetalleFicha.css'

const CAMPOS_ENMIENDA = [
  { value: 'diagnostico', label: 'Diagnóstico' },
  { value: 'motivo_consulta', label: 'Motivo de consulta' },
  { value: 'anamnesis', label: 'Anamnesis' },
  { value: 'examen_fisico', label: 'Examen físico' },
  { value: 'plan_tratamiento', label: 'Plan de tratamiento' },
  { value: 'observaciones', label: 'Observaciones' },
  { value: 'nota_clinica', label: 'Nota clínica / corrección general' },
] as const

type CampoEnmienda = (typeof CAMPOS_ENMIENDA)[number]['value']

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

function labelCampo(campo: string): string {
  return CAMPOS_ENMIENDA.find((c) => c.value === campo)?.label ?? campo
}

function nombreUsuario(usuario?: UsuarioResumen | null, fallback?: string): string {
  if (usuario?.nombres || usuario?.apellidos) {
    return `${usuario.nombres ?? ''} ${usuario.apellidos ?? ''}`.trim()
  }
  if (usuario?.email) return usuario.email
  return fallback ?? 'Usuario no disponible'
}

function asSingleRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

async function buildFirmaHash(userId: string): Promise<string> {
  const payload = `${userId}:${Date.now()}:swimyti-enmienda`
  if (globalThis.crypto?.subtle) {
    const data = new TextEncoder().encode(payload)
    const digest = await globalThis.crypto.subtle.digest('SHA-256', data)
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }
  return btoa(payload)
}

function mapAuthError(message: string): string {
  const normalized = message.toLowerCase()
  if (normalized.includes('row-level security') || normalized.includes('permission')) {
    return 'No tienes permiso para agregar enmiendas (se requiere rol doctor o administrador, y perfil en usuarios).'
  }
  if (normalized.includes('foreign key') || normalized.includes('usuarios')) {
    return 'Tu usuario de Auth no tiene perfil en la tabla usuarios. Crea el registro vinculado a auth.uid().'
  }
  return message || 'No se pudo guardar la enmienda.'
}

function DetalleFicha() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { rol } = useAuthRol()

  const [ficha, setFicha] = useState<FichaMedica | null>(null)
  const [enmiendas, setEnmiendas] = useState<EnmiendaAuditoria[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)

  const [campoCorregido, setCampoCorregido] = useState<CampoEnmienda>('diagnostico')
  const [correccion, setCorreccion] = useState('')

  const loadData = useCallback(async () => {
    if (!id || Number.isNaN(Number(id))) {
      setError('Identificador de ficha inválido.')
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    const idFicha = Number(id)

    const [fichaRes, enmiendasRes] = await Promise.all([
      supabase
        .from('fichas_medicas')
        .select(
          `
          id_ficha,
          id_paciente,
          id_usuario_creador,
          motivo_consulta,
          anamnesis,
          examen_fisico,
          diagnostico,
          plan_tratamiento,
          observaciones,
          created_at,
          firma_digital_hash,
          pacientes ( nombres, apellidos, rut ),
          usuarios:id_usuario_creador ( nombres, apellidos, email )
        `,
        )
        .eq('id_ficha', idFicha)
        .maybeSingle(),
      supabase
        .from('enmiendas_auditoria')
        .select(
          `
          id_enmienda,
          id_ficha,
          id_usuario_autor,
          campo_corregido,
          valor_anterior,
          correccion_justificada,
          firma_digital_hash,
          created_at,
          usuarios:id_usuario_autor ( nombres, apellidos, email )
        `,
        )
        .eq('id_ficha', idFicha)
        .order('created_at', { ascending: false }),
    ])

    if (fichaRes.error) {
      setError(fichaRes.error.message || 'No se pudo cargar la ficha médica.')
      setFicha(null)
      setLoading(false)
      return
    }

    if (!fichaRes.data) {
      setError('Ficha no encontrada o sin permisos para visualizarla.')
      setFicha(null)
      setLoading(false)
      return
    }

    const row = fichaRes.data
    const paciente = asSingleRelation(row.pacientes)
    const creador = asSingleRelation(row.usuarios)

    setFicha({
      id_ficha: row.id_ficha as number,
      id_paciente: row.id_paciente as number,
      id_usuario_creador: row.id_usuario_creador as string,
      motivo_consulta: row.motivo_consulta as string,
      anamnesis: (row.anamnesis as string | null) ?? null,
      examen_fisico: (row.examen_fisico as string | null) ?? null,
      diagnostico: row.diagnostico as string,
      plan_tratamiento: (row.plan_tratamiento as string | null) ?? null,
      observaciones: (row.observaciones as string | null) ?? null,
      created_at: row.created_at as string,
      firma_digital_hash: (row.firma_digital_hash as string | undefined) ?? undefined,
      pacientes: paciente
        ? {
            nombres: paciente.nombres as string,
            apellidos: paciente.apellidos as string,
            rut: paciente.rut as string,
          }
        : null,
      usuarios: creador
        ? {
            nombres: creador.nombres as string,
            apellidos: creador.apellidos as string,
            email: (creador.email as string | null) ?? null,
          }
        : null,
    })

    if (enmiendasRes.error) {
      setError(enmiendasRes.error.message || 'No se pudieron cargar las enmiendas.')
      setEnmiendas([])
    } else {
      const rows = (enmiendasRes.data ?? []).map((item) => {
        const autor = asSingleRelation(item.usuarios)
        return {
          id_enmienda: item.id_enmienda as number,
          id_ficha: item.id_ficha as number,
          id_usuario_autor: item.id_usuario_autor as string,
          campo_corregido: item.campo_corregido as string,
          valor_anterior: (item.valor_anterior as string | null) ?? null,
          correccion_justificada: item.correccion_justificada as string,
          firma_digital_hash: item.firma_digital_hash as string,
          created_at: item.created_at as string,
          usuarios: autor
            ? {
                nombres: autor.nombres as string,
                apellidos: autor.apellidos as string,
                email: (autor.email as string | null) ?? null,
              }
            : null,
        } satisfies EnmiendaAuditoria
      })
      setEnmiendas(rows)
    }

    setLoading(false)
  }, [id])

  useEffect(() => {
    void loadData()
  }, [loadData])

  function valorAnteriorDeCampo(campo: CampoEnmienda): string | null {
    if (!ficha) return null
    if (campo === 'nota_clinica') return null

    const mapa: Record<Exclude<CampoEnmienda, 'nota_clinica'>, string | null | undefined> = {
      diagnostico: ficha.diagnostico,
      motivo_consulta: ficha.motivo_consulta,
      anamnesis: ficha.anamnesis,
      examen_fisico: ficha.examen_fisico,
      plan_tratamiento: ficha.plan_tratamiento,
      observaciones: ficha.observaciones,
    }

    return mapa[campo] ?? null
  }

  function openForm() {
    setSuccess(null)
    setError(null)
    setCampoCorregido('diagnostico')
    setCorreccion('')
    setShowForm(true)
  }

  function closeForm() {
    if (saving) return
    setShowForm(false)
    setCorreccion('')
  }

  async function handleCreateEnmienda(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSuccess(null)

    if (!ficha) return

    if (!correccion.trim()) {
      setError('Debes escribir la corrección o nota clínica justificada.')
      return
    }

    setSaving(true)

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError || !user) {
        setError('Sesión no válida. Vuelve a iniciar sesión.')
        return
      }

      const firma_digital_hash = await buildFirmaHash(user.id)
      const valor_anterior = valorAnteriorDeCampo(campoCorregido)

      const { error: insertError } = await supabase.from('enmiendas_auditoria').insert({
        id_ficha: ficha.id_ficha,
        id_usuario_autor: user.id,
        campo_corregido: campoCorregido,
        valor_anterior,
        correccion_justificada: correccion.trim(),
        firma_digital_hash,
      })

      if (insertError) {
        setError(mapAuthError(insertError.message))
        return
      }

      setSuccess('Enmienda registrada. La ficha original permanece intacta (append-only).')
      setShowForm(false)
      setCorreccion('')
      await loadData()
    } catch {
      setError('Error inesperado al guardar la enmienda.')
    } finally {
      setSaving(false)
    }
  }

  const pacienteLabel = ficha?.pacientes
    ? `${ficha.pacientes.apellidos}, ${ficha.pacientes.nombres}`
    : ficha
      ? `Paciente #${ficha.id_paciente}`
      : '—'

  return (
    <div className="df">
      <header className="df-header">
        <div className="df-header-left">
          <button
            type="button"
            className="df-back"
            onClick={() => navigate(rol === 'paciente' ? '/portal' : '/dashboard')}
          >
            ← Volver al {rol === 'paciente' ? 'portal' : 'dashboard'}
          </button>
          <div>
            <h1>
              Ficha médica {ficha ? `#${ficha.id_ficha}` : id ? `#${id}` : ''}
            </h1>
            <p>Registro clínico inmutable · Correcciones vía enmiendas</p>
          </div>
        </div>

        <div className="df-header-actions">
          <span className="df-badge df-badge-readonly">Lectura · Inmutable</span>
          {puedeEnmendar(rol) ? (
            <button
              type="button"
              className="df-btn-primary"
              onClick={openForm}
              disabled={loading || !ficha}
            >
              Agregar enmienda
            </button>
          ) : null}
        </div>
      </header>

      <main className="df-content">
        {error ? (
          <p className="df-alert df-alert-error" role="alert">
            {error}
          </p>
        ) : null}

        {success ? (
          <p className="df-alert df-alert-success" role="status">
            {success}
          </p>
        ) : null}

        {loading ? (
          <p className="df-loading">Cargando ficha…</p>
        ) : !ficha ? (
          <p className="df-empty">No hay datos para mostrar.</p>
        ) : (
          <>
            <p className="df-notice">
              Esta ficha está en modo solo lectura. El diagnóstico y el resto de campos
              originales no se editan; cualquier corrección se agrega como enmienda de
              auditoría (append-only).
            </p>

            <section className="df-card" aria-labelledby="ficha-original-title">
              <div className="df-card-header">
                <h2 id="ficha-original-title">Ficha original</h2>
              </div>
              <div className="df-card-body">
                <div className="df-meta">
                  <div className="df-meta-item">
                    <label>Paciente</label>
                    <p>
                      {pacienteLabel}
                      {ficha.pacientes?.rut ? ` · RUT ${ficha.pacientes.rut}` : ''}
                    </p>
                  </div>
                  <div className="df-meta-item">
                    <label>Médico / creador</label>
                    <p>
                      {nombreUsuario(ficha.usuarios, ficha.id_usuario_creador)}
                    </p>
                  </div>
                  <div className="df-meta-item">
                    <label>Timestamp</label>
                    <p>{formatDate(ficha.created_at)}</p>
                  </div>
                  <div className="df-meta-item">
                    <label>ID ficha</label>
                    <p>#{ficha.id_ficha}</p>
                  </div>
                </div>

                <div className="df-field-block">
                  <label>Motivo de consulta</label>
                  <p className="df-readonly">{ficha.motivo_consulta}</p>
                </div>

                <div className="df-field-block">
                  <label>Diagnóstico (inmutable)</label>
                  <p className="df-readonly df-readonly-emphasis">{ficha.diagnostico}</p>
                </div>

                {ficha.anamnesis ? (
                  <div className="df-field-block">
                    <label>Anamnesis</label>
                    <p className="df-readonly">{ficha.anamnesis}</p>
                  </div>
                ) : null}

                {ficha.examen_fisico ? (
                  <div className="df-field-block">
                    <label>Examen físico</label>
                    <p className="df-readonly">{ficha.examen_fisico}</p>
                  </div>
                ) : null}

                {ficha.plan_tratamiento ? (
                  <div className="df-field-block">
                    <label>Plan de tratamiento</label>
                    <p className="df-readonly">{ficha.plan_tratamiento}</p>
                  </div>
                ) : null}

                {ficha.observaciones ? (
                  <div className="df-field-block">
                    <label>Observaciones</label>
                    <p className="df-readonly">{ficha.observaciones}</p>
                  </div>
                ) : null}
              </div>
            </section>

            <section className="df-card" aria-labelledby="enmiendas-title">
              <div className="df-card-header">
                <h2 id="enmiendas-title">Enmiendas de auditoría</h2>
                <span className="df-badge df-badge-readonly">
                  {enmiendas.length} registro{enmiendas.length === 1 ? '' : 's'}
                </span>
              </div>
              <div className="df-card-body">
                {enmiendas.length === 0 ? (
                  <p className="df-empty" style={{ padding: '1rem 0' }}>
                    Aún no hay enmiendas. Usa &quot;Agregar enmienda&quot; para registrar una
                    corrección sin alterar la ficha original.
                  </p>
                ) : (
                  <ul className="df-timeline">
                    {enmiendas.map((enmienda) => (
                      <li key={enmienda.id_enmienda} className="df-enmienda">
                        <div className="df-enmienda-top">
                          <span className="df-enmienda-campo">
                            {labelCampo(enmienda.campo_corregido)}
                          </span>
                          <span className="df-enmienda-fecha">
                            {formatDate(enmienda.created_at)}
                          </span>
                        </div>
                        <p className="df-enmienda-autor">
                          Autor: {nombreUsuario(enmienda.usuarios, enmienda.id_usuario_autor)}
                        </p>
                        <p className="df-enmienda-texto">{enmienda.correccion_justificada}</p>
                        {enmienda.valor_anterior ? (
                          <p className="df-enmienda-previo">
                            Valor anterior: {enmienda.valor_anterior}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          </>
        )}
      </main>

      {showForm && ficha ? (
        <div
          className="df-modal-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeForm()
          }}
        >
          <div
            className="df-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="enmienda-title"
          >
            <div className="df-modal-header">
              <div>
                <h3 id="enmienda-title">Agregar enmienda</h3>
                <p>
                  Se insertará un nuevo registro en enmiendas_auditoria. La ficha #
                  {ficha.id_ficha} no se modifica.
                </p>
              </div>
              <button
                type="button"
                className="df-modal-close"
                onClick={closeForm}
                aria-label="Cerrar"
                disabled={saving}
              >
                ×
              </button>
            </div>

            <form className="df-form" onSubmit={(e) => void handleCreateEnmienda(e)}>
              <div className="df-field">
                <label htmlFor="enmienda-campo">Campo / tipo de corrección</label>
                <select
                  id="enmienda-campo"
                  value={campoCorregido}
                  onChange={(e) => setCampoCorregido(e.target.value as CampoEnmienda)}
                  disabled={saving}
                >
                  {CAMPOS_ENMIENDA.map((campo) => (
                    <option key={campo.value} value={campo.value}>
                      {campo.label}
                    </option>
                  ))}
                </select>
              </div>

              {campoCorregido !== 'nota_clinica' && valorAnteriorDeCampo(campoCorregido) ? (
                <div className="df-field">
                  <label>Valor actual en la ficha (solo lectura)</label>
                  <p className="df-readonly">{valorAnteriorDeCampo(campoCorregido)}</p>
                  <p className="df-field-hint">
                    Este valor se guardará como referencia histórica (valor_anterior).
                  </p>
                </div>
              ) : null}

              <div className="df-field">
                <label htmlFor="enmienda-texto">Corrección justificada</label>
                <textarea
                  id="enmienda-texto"
                  value={correccion}
                  onChange={(e) => setCorreccion(e.target.value)}
                  placeholder="Describe la corrección o nota clínica y su justificación"
                  required
                  disabled={saving}
                />
              </div>

              <div className="df-form-actions">
                <button
                  type="button"
                  className="df-btn-secondary"
                  onClick={closeForm}
                  disabled={saving}
                >
                  Cancelar
                </button>
                <button type="submit" className="df-btn-primary" disabled={saving}>
                  {saving ? 'Guardando…' : 'Guardar enmienda'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default DetalleFicha
