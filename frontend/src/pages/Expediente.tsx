import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../services/supabase'
import { useAuthRol } from '../context/AuthRolContext'
import { homeRol, puedeEnmendar } from '../utils/permisos'
import type { AnexoClinico, FichaMedica, UsuarioResumen } from '../types/database'
import '../styles/DetalleFicha.css'

// =============================================================================
// NOTA DE ARQUITECTURA (decisión actual):
// SWIMyti usa actualmente una fila por atención en fichas_medicas. Para la demo
// y el comité, la vista de "Expediente del paciente" agrupa todas las atenciones
// del paciente en una ficha integral (Opción B: sin migración de datos).
// MEJORA FUTURA (regla): migrar a un modelo en el que `fichas_medicas` sea 1:1
// con el paciente (id_paciente único) y exista una tabla `atenciones` con cada
// consulta/procedimiento, para cumplir estrictamente con "ficha única por
// paciente" a nivel de esquema. Esta migración debe contemplar el traspaso de
// enmiendas y anexos a la nueva tabla y la actualización del diccionario de
// datos y el diagrama ER (16 -> 17 entidades).
// =============================================================================

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

type Atencion = FichaMedica & {
  enmiendas_count?: number
}

type Enmienda = {
  id_enmienda: number
  id_ficha: number
  campo_corregido: string
  valor_anterior: string | null
  correccion_justificada: string
  created_at: string
  usuarios?: UsuarioResumen | UsuarioResumen[] | null
}

type Receta = {
  id_receta: number
  medicamentos: string
  indicaciones: string | null
  fecha_emision: string
}

type Certificado = {
  id_certificado: number
  tipo_certificado: string
  detalle: string | null
  fecha_emision: string
}

function formatFechaHora(value: string): string {
  try {
    return new Intl.DateTimeFormat('es-CL', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value))
  } catch {
    return value
  }
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

function asSingleRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

function prefijoProfesional(usuario?: UsuarioResumen | null): string {
  const rolVal = Array.isArray(usuario?.roles)
    ? usuario?.roles?.[0]?.nombre_rol
    : usuario?.roles?.nombre_rol
  if (rolVal === 'doctor') return 'Dr(a). '
  if (rolVal === 'enfermeria') return 'EU. '
  return ''
}

function nombreUsuario(usuario?: UsuarioResumen | null, fallback?: string): string {
  if (usuario?.nombres || usuario?.apellidos) {
    const nombre = `${usuario.nombres ?? ''} ${usuario.apellidos ?? ''}`.trim()
    return `${prefijoProfesional(usuario)}${nombre}`.trim()
  }
  if (usuario?.email) return usuario.email
  return fallback ?? 'Usuario no disponible'
}

function labelCampo(campo: string): string {
  return CAMPOS_ENMIENDA.find((c) => c.value === campo)?.label ?? campo
}

async function buildFirmaHash(userId: string): Promise<string> {
  const payload = `${userId}:${Date.now()}:swimyti-atencion`
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
    return 'No tienes permiso para esta operación (se requiere rol clínico y perfil en usuarios).'
  }
  if (normalized.includes('foreign key') || normalized.includes('usuarios')) {
    return 'Tu usuario de Auth no tiene perfil en la tabla usuarios.'
  }
  return message || 'No se pudo completar la operación.'
}

function Expediente() {
  const { idPaciente } = useParams<{ idPaciente: string }>()
  const navigate = useNavigate()
  const { rol } = useAuthRol()

  const [paciente, setPaciente] = useState<{
    id_paciente: number
    rut: string
    prevision: string | null
    nombres: string
    apellidos: string
    telefono: string | null
    email: string | null
    direccion: string | null
  } | null>(null)
  const [atenciones, setAtenciones] = useState<Atencion[]>([])
  const [enmiendas, setEnmiendas] = useState<Enmienda[]>([])
  const [recetas, setRecetas] = useState<Receta[]>([])
  const [certificados, setCertificados] = useState<Certificado[]>([])
  const [anexos, setAnexos] = useState<AnexoClinico[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [showAtencionForm, setShowAtencionForm] = useState(false)
  const [showEnmiendaForm, setShowEnmiendaForm] = useState(false)

  const [userId, setUserId] = useState('')
  const [motivoConsulta, setMotivoConsulta] = useState('')
  const [diagnostico, setDiagnostico] = useState('')
  const [anamnesis, setAnamnesis] = useState('')
  const [examenFisico, setExamenFisico] = useState('')
  const [planTratamiento, setPlanTratamiento] = useState('')
  const [observaciones, setObservaciones] = useState('')

  const [atencionEnmienda, setAtencionEnmienda] = useState<Atencion | null>(null)
  const [campoCorregido, setCampoCorregido] = useState<CampoEnmienda>('diagnostico')
  const [correccion, setCorreccion] = useState('')

  const loadData = useCallback(async () => {
    if (!idPaciente || Number.isNaN(Number(idPaciente))) {
      setError('Identificador de paciente inválido.')
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    const idPac = Number(idPaciente)

    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (user) setUserId(user.id)

    const [pacRes, fichasRes, enmRes, recRes, certRes, anexRes] = await Promise.all([
      supabase
        .from('pacientes')
        .select(
          'id_paciente, rut, prevision, nombres, apellidos, telefono, email, direccion',
        )
        .eq('id_paciente', idPac)
        .maybeSingle(),
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
          usuarios:id_usuario_creador ( nombres, apellidos, email, roles ( nombre_rol ) )
        `,
        )
        .eq('id_paciente', idPac)
        .order('created_at', { ascending: false }),
      supabase
        .from('enmiendas_auditoria')
        .select(
          `
          id_enmienda,
          id_ficha,
          campo_corregido,
          valor_anterior,
          correccion_justificada,
          created_at,
          usuarios:id_usuario_autor ( nombres, apellidos, email, roles ( nombre_rol ) )
        `,
        )
        .order('created_at', { ascending: false }),
      supabase
        .from('recetas_medicas')
        .select('id_receta, medicamentos, indicaciones, fecha_emision')
        .eq('id_paciente', idPac)
        .order('fecha_emision', { ascending: false }),
      supabase
        .from('certificados_clinicos')
        .select('id_certificado, tipo_certificado, detalle, fecha_emision')
        .eq('id_paciente', idPac)
        .order('fecha_emision', { ascending: false }),
      supabase
        .from('anexos_clinicos')
        .select(
          'id_anexo, id_paciente, nombre_archivo, tipo_mime, url_documento, descripcion, tipo_anexo, created_at',
        )
        .eq('id_paciente', idPac)
        .order('created_at', { ascending: false }),
    ])

    if (pacRes.error || !pacRes.data) {
      setError(pacRes.error?.message || 'Paciente no encontrado o sin permisos.')
      setLoading(false)
      return
    }
    setPaciente({
      id_paciente: pacRes.data.id_paciente as number,
      rut: pacRes.data.rut as string,
      prevision: (pacRes.data.prevision as string | null) ?? null,
      nombres: pacRes.data.nombres as string,
      apellidos: pacRes.data.apellidos as string,
      telefono: (pacRes.data.telefono as string | null) ?? null,
      email: (pacRes.data.email as string | null) ?? null,
      direccion: (pacRes.data.direccion as string | null) ?? null,
    })

    if (fichasRes.error) {
      setError(fichasRes.error.message || 'No se pudieron cargar las atenciones.')
      setAtenciones([])
    } else {
      const rows = (fichasRes.data ?? []).map((row) => {
        const creador = asSingleRelation(row.usuarios)
        return {
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
          usuarios: creador
            ? {
                nombres: creador.nombres as string,
                apellidos: creador.apellidos as string,
                email: (creador.email as string | null) ?? null,
                roles: asSingleRelation(creador.roles) ?? null,
              }
            : null,
        } satisfies Atencion
      })
      setAtenciones(rows)
    }

    if (enmRes.error) {
      setError((c) => c ?? (enmRes.error?.message || 'No se pudieron cargar las enmiendas.'))
      setEnmiendas([])
    } else {
      setEnmiendas(
        ((enmRes.data ?? []) as Enmienda[]).map((e) => ({
          ...e,
          usuarios: asSingleRelation(e.usuarios) ?? null,
        })),
      )
    }

    if (!recRes.error) setRecetas((recRes.data ?? []) as Receta[])
    if (!certRes.error) setCertificados((certRes.data ?? []) as Certificado[])
    if (!anexRes.error) setAnexos((anexRes.data ?? []) as AnexoClinico[])

    setLoading(false)
  }, [idPaciente])

  useEffect(() => {
    void loadData()
  }, [loadData])

  function resetAtencionForm() {
    setMotivoConsulta('')
    setDiagnostico('')
    setAnamnesis('')
    setExamenFisico('')
    setPlanTratamiento('')
    setObservaciones('')
  }

  function openAtencionForm() {
    setError(null)
    setSuccess(null)
    resetAtencionForm()
    setShowAtencionForm(true)
  }

  function closeAtencionForm() {
    if (saving) return
    setShowAtencionForm(false)
  }

  async function handleNuevaAtencion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSuccess(null)

    if (!paciente) return
    if (!userId) {
      setError('Sesión no válida. Vuelve a iniciar sesión.')
      return
    }
    if (!motivoConsulta.trim() || !diagnostico.trim()) {
      setError('Motivo de consulta y diagnóstico son obligatorios.')
      return
    }

    setSaving(true)

    try {
      const firma_digital_hash = await buildFirmaHash(userId)
      const { error: insertError } = await supabase.from('fichas_medicas').insert({
        id_paciente: paciente.id_paciente,
        id_usuario_creador: userId,
        motivo_consulta: motivoConsulta.trim(),
        diagnostico: diagnostico.trim(),
        anamnesis: anamnesis.trim() || null,
        examen_fisico: examenFisico.trim() || null,
        plan_tratamiento: planTratamiento.trim() || null,
        observaciones: observaciones.trim() || null,
        firma_digital_hash,
      })

      if (insertError) {
        setError(mapAuthError(insertError.message))
        return
      }

      setSuccess('Atención registrada en el expediente del paciente.')
      setShowAtencionForm(false)
      resetAtencionForm()
      await loadData()
    } catch {
      setError('Error inesperado al registrar la atención.')
    } finally {
      setSaving(false)
    }
  }

  function openEnmiendaForm(atencion: Atencion) {
    setError(null)
    setSuccess(null)
    setAtencionEnmienda(atencion)
    setCampoCorregido('diagnostico')
    setCorreccion('')
    setShowEnmiendaForm(true)
  }

  function closeEnmiendaForm() {
    if (saving) return
    setShowEnmiendaForm(false)
    setAtencionEnmienda(null)
  }

  function valorAnteriorDeCampo(campo: CampoEnmienda): string | null {
    if (!atencionEnmienda) return null
    if (campo === 'nota_clinica') return null
    const mapa: Record<Exclude<CampoEnmienda, 'nota_clinica'>, string | null | undefined> = {
      diagnostico: atencionEnmienda.diagnostico,
      motivo_consulta: atencionEnmienda.motivo_consulta,
      anamnesis: atencionEnmienda.anamnesis,
      examen_fisico: atencionEnmienda.examen_fisico,
      plan_tratamiento: atencionEnmienda.plan_tratamiento,
      observaciones: atencionEnmienda.observaciones,
    }
    return mapa[campo] ?? null
  }

  async function handleNuevaEnmienda(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSuccess(null)

    if (!atencionEnmienda) return
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
        id_ficha: atencionEnmienda.id_ficha,
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

      setSuccess('Enmienda registrada. La atención original permanece intacta.')
      setShowEnmiendaForm(false)
      setCorreccion('')
      await loadData()
    } catch {
      setError('Error inesperado al guardar la enmienda.')
    } finally {
      setSaving(false)
    }
  }

  const enmiendasDeAtencion = (idFicha: number): Enmienda[] =>
    enmiendas.filter((e) => e.id_ficha === idFicha)

  if (loading) {
    return (
      <div className="df">
        <header className="df-header">
          <div className="df-header-left">
            <button type="button" className="df-back" onClick={() => navigate(homeRol(rol))}>
              ← Volver
            </button>
          </div>
        </header>
        <main className="df-content">
          <p className="df-loading">Cargando expediente…</p>
        </main>
      </div>
    )
  }

  if (!paciente) {
    return (
      <div className="df">
        <header className="df-header">
          <div className="df-header-left">
            <button type="button" className="df-back" onClick={() => navigate(homeRol(rol))}>
              ← Volver
            </button>
          </div>
        </header>
        <main className="df-content">
          <p className="df-alert df-alert-error" role="alert">{error ?? 'Paciente no disponible.'}</p>
        </main>
      </div>
    )
  }

  return (
    <div className="df">
      <header className="df-header">
        <div className="df-header-left">
          <button
            type="button"
            className="df-back"
            onClick={() => navigate(-1)}
          >
            ← Volver
          </button>
          <div>
            <h1>Expediente: {paciente.apellidos}, {paciente.nombres}</h1>
            <p>
              RUT {paciente.rut} · Previsión {paciente.prevision ?? '—'}
            </p>
          </div>
        </div>
        <div className="df-header-actions">
          <span className="df-badge df-badge-readonly">
            {atenciones.length} atención{atenciones.length === 1 ? '' : 'es'}
          </span>
          {puedeEnmendar(rol) ? (
            <button type="button" className="df-btn-primary" onClick={openAtencionForm}>
              Nueva atención
            </button>
          ) : null}
        </div>
      </header>

      <main className="df-content">
        {error ? (
          <p className="df-alert df-alert-error" role="alert">{error}</p>
        ) : null}
        {success ? (
          <p className="df-alert df-alert-success" role="status">{success}</p>
        ) : null}

        <section className="df-card" aria-labelledby="datos-paciente-title">
          <div className="df-card-header">
            <h2 id="datos-paciente-title">Datos del paciente</h2>
          </div>
          <div className="df-card-body">
            <div className="df-meta">
              <div className="df-meta-item">
                <label>Nombre completo</label>
                <p>{paciente.nombres} {paciente.apellidos}</p>
              </div>
              <div className="df-meta-item">
                <label>RUT</label>
                <p>{paciente.rut}</p>
              </div>
              <div className="df-meta-item">
                <label>Previsión</label>
                <p>{paciente.prevision ?? '—'}</p>
              </div>
              <div className="df-meta-item">
                <label>Teléfono</label>
                <p>{paciente.telefono ?? '—'}</p>
              </div>
              <div className="df-meta-item">
                <label>Email</label>
                <p>{paciente.email ?? '—'}</p>
              </div>
              <div className="df-meta-item">
                <label>Dirección</label>
                <p>{paciente.direccion ?? '—'}</p>
              </div>
            </div>
          </div>
        </section>

        <section className="df-card" aria-labelledby="atenciones-title">
          <div className="df-card-header">
            <h2 id="atenciones-title">Historial de atenciones</h2>
            <span className="df-badge df-badge-readonly">{atenciones.length}</span>
          </div>
          <div className="df-card-body">
            {atenciones.length === 0 ? (
              <p className="df-empty">Este paciente aún no tiene atenciones registradas.</p>
            ) : (
              <div className="df-timeline">
                {atenciones.map((a) => (
                  <div key={a.id_ficha} className="df-enmienda">
                    <div className="df-enmienda-top">
                      <span className="df-enmienda-campo">Atención #{a.id_ficha}</span>
                      <span className="df-enmienda-fecha">
                        {formatFechaHora(a.created_at)}
                      </span>
                    </div>
                    <p className="df-enmienda-autor">
                      Profesional: {nombreUsuario(a.usuarios, a.id_usuario_creador)}
                    </p>
                    <p className="df-enmienda-texto">
                      <strong>Motivo:</strong> {a.motivo_consulta}
                    </p>
                    <p className="df-enmienda-texto">
                      <strong>Diagnóstico:</strong> {a.diagnostico}
                    </p>
                    {a.anamnesis ? (
                      <p className="df-enmienda-texto">
                        <strong>Anamnesis:</strong> {a.anamnesis}
                      </p>
                    ) : null}
                    {a.examen_fisico ? (
                      <p className="df-enmienda-texto">
                        <strong>Examen físico:</strong> {a.examen_fisico}
                      </p>
                    ) : null}
                    {a.plan_tratamiento ? (
                      <p className="df-enmienda-texto">
                        <strong>Plan de tratamiento:</strong> {a.plan_tratamiento}
                      </p>
                    ) : null}
                    {a.observaciones ? (
                      <p className="df-enmienda-texto">
                        <strong>Observaciones:</strong> {a.observaciones}
                      </p>
                    ) : null}
                    {puedeEnmendar(rol) ? (
                      <div className="df-form-actions" style={{ marginTop: '0.6rem' }}>
                        <button
                          type="button"
                          className="df-btn-secondary"
                          onClick={() => openEnmiendaForm(a)}
                        >
                          Agregar enmienda
                        </button>
                      </div>
                    ) : null}
                    {enmiendasDeAtencion(a.id_ficha).length > 0 ? (
                      <div style={{ marginTop: '0.75rem' }}>
                        <p className="df-enmienda-autor" style={{ fontWeight: 700 }}>
                          Enmiendas de esta atención:
                        </p>
                        {enmiendasDeAtencion(a.id_ficha).map((e) => (
                          <div key={e.id_enmienda} className="df-enmienda-previo">
                            <strong>{labelCampo(e.campo_corregido)}</strong> · {formatFechaHora(e.created_at)} ·{' '}
                            {nombreUsuario(asSingleRelation(e.usuarios))}
                            <br />
                            {e.correccion_justificada}
                            {e.valor_anterior ? (
                              <>
                                <br />
                                <em>Valor anterior: {e.valor_anterior}</em>
                              </>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="df-card" aria-labelledby="recetas-title">
          <div className="df-card-header">
            <h2 id="recetas-title">Recetas médicas</h2>
            <span className="df-badge df-badge-readonly">{recetas.length}</span>
          </div>
          <div className="df-card-body">
            {recetas.length === 0 ? (
              <p className="df-empty">No hay recetas registradas.</p>
            ) : (
              <div className="df-timeline">
                {recetas.map((r) => (
                  <div key={r.id_receta} className="df-enmienda">
                    <div className="df-enmienda-top">
                      <span className="df-enmienda-campo">Receta #{r.id_receta}</span>
                      <span className="df-enmienda-fecha">{formatFecha(r.fecha_emision)}</span>
                    </div>
                    <p className="df-enmienda-texto">{r.medicamentos}</p>
                    {r.indicaciones ? (
                      <p className="df-enmienda-texto">
                        <strong>Indicaciones:</strong> {r.indicaciones}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="df-card" aria-labelledby="certificados-title">
          <div className="df-card-header">
            <h2 id="certificados-title">Certificados clínicos</h2>
            <span className="df-badge df-badge-readonly">{certificados.length}</span>
          </div>
          <div className="df-card-body">
            {certificados.length === 0 ? (
              <p className="df-empty">No hay certificados registrados.</p>
            ) : (
              <div className="df-timeline">
                {certificados.map((c) => (
                  <div key={c.id_certificado} className="df-enmienda">
                    <div className="df-enmienda-top">
                      <span className="df-enmienda-campo">{c.tipo_certificado}</span>
                      <span className="df-enmienda-fecha">{formatFecha(c.fecha_emision)}</span>
                    </div>
                    {c.detalle ? <p className="df-enmienda-texto">{c.detalle}</p> : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="df-card" aria-labelledby="anexos-title">
          <div className="df-card-header">
            <h2 id="anexos-title">Anexos clínicos</h2>
            <span className="df-badge df-badge-readonly">{anexos.length}</span>
          </div>
          <div className="df-card-body">
            {anexos.length === 0 ? (
              <p className="df-empty">No hay anexos (exámenes o resultados) registrados.</p>
            ) : (
              <div className="df-timeline">
                {anexos.map((a) => (
                  <div key={a.id_anexo} className="df-enmienda">
                    <div className="df-enmienda-top">
                      <span className="df-enmienda-campo">
                        {a.tipo_anexo ? a.tipo_anexo : 'Anexo'}
                      </span>
                      <span className="df-enmienda-fecha">
                        {formatFechaHora(a.created_at)}
                      </span>
                    </div>
                    <p className="df-enmienda-texto">
                      {a.nombre_archivo || 'Documento'}
                    </p>
                    {a.descripcion ? (
                      <p className="df-enmienda-texto">
                        <strong>Descripción:</strong> {a.descripcion}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </main>

      {showAtencionForm ? (
        <div
          className="df-modal-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeAtencionForm()
          }}
        >
          <div
            className="df-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="nueva-atencion-title"
          >
            <div className="df-modal-header">
              <div>
                <h3 id="nueva-atencion-title">Nueva atención</h3>
                <p>
                  Se registra una nueva atención en el expediente de {paciente.nombres}{' '}
                  {paciente.apellidos}. El diagnóstico es inmutable.
                </p>
              </div>
              <button
                type="button"
                className="df-modal-close"
                onClick={closeAtencionForm}
                aria-label="Cerrar"
                disabled={saving}
              >
                ×
              </button>
            </div>

            <form className="df-form" onSubmit={(e) => void handleNuevaAtencion(e)}>
              <div className="df-field">
                <label htmlFor="exp-motivo">Motivo de consulta</label>
                <input
                  id="exp-motivo"
                  type="text"
                  value={motivoConsulta}
                  onChange={(e) => setMotivoConsulta(e.target.value)}
                  placeholder="Ej. Control de hipertensión"
                  required
                  disabled={saving}
                />
              </div>

              <div className="df-field">
                <label htmlFor="exp-diagnostico">Diagnóstico (inmutable)</label>
                <textarea
                  id="exp-diagnostico"
                  value={diagnostico}
                  onChange={(e) => setDiagnostico(e.target.value)}
                  placeholder="Describe el diagnóstico clínico"
                  required
                  disabled={saving}
                />
                <p className="df-field-hint">Este campo no podrá editarse después de guardar.</p>
              </div>

              <div className="df-field">
                <label htmlFor="exp-anamnesis">Anamnesis</label>
                <textarea
                  id="exp-anamnesis"
                  value={anamnesis}
                  onChange={(e) => setAnamnesis(e.target.value)}
                  placeholder="Antecedentes y relato del paciente"
                  disabled={saving}
                />
              </div>

              <div className="df-field">
                <label htmlFor="exp-examen">Examen físico</label>
                <textarea
                  id="exp-examen"
                  value={examenFisico}
                  onChange={(e) => setExamenFisico(e.target.value)}
                  placeholder="Hallazgos del examen físico"
                  disabled={saving}
                />
              </div>

              <div className="df-field">
                <label htmlFor="exp-plan">Plan de tratamiento</label>
                <textarea
                  id="exp-plan"
                  value={planTratamiento}
                  onChange={(e) => setPlanTratamiento(e.target.value)}
                  placeholder="Plan de tratamiento e indicaciones"
                  disabled={saving}
                />
              </div>

              <div className="df-field">
                <label htmlFor="exp-obs">Observaciones</label>
                <textarea
                  id="exp-obs"
                  value={observaciones}
                  onChange={(e) => setObservaciones(e.target.value)}
                  placeholder="Observaciones adicionales"
                  disabled={saving}
                />
              </div>

              <div className="df-form-actions">
                <button
                  type="button"
                  className="df-btn-secondary"
                  onClick={closeAtencionForm}
                  disabled={saving}
                >
                  Cancelar
                </button>
                <button type="submit" className="df-btn-primary" disabled={saving}>
                  {saving ? 'Guardando…' : 'Guardar atención'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {showEnmiendaForm && atencionEnmienda ? (
        <div
          className="df-modal-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeEnmiendaForm()
          }}
        >
          <div
            className="df-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="nueva-enmienda-title"
          >
            <div className="df-modal-header">
              <div>
                <h3 id="nueva-enmienda-title">Agregar enmienda</h3>
                <p>
                  Se insertará un nuevo registro en enmiendas_auditoria. La atención #{' '}
                  {atencionEnmienda.id_ficha} no se modifica.
                </p>
              </div>
              <button
                type="button"
                className="df-modal-close"
                onClick={closeEnmiendaForm}
                aria-label="Cerrar"
                disabled={saving}
              >
                ×
              </button>
            </div>

            <form className="df-form" onSubmit={(e) => void handleNuevaEnmienda(e)}>
              <div className="df-field">
                <label htmlFor="exp-enmienda-campo">Campo / tipo de corrección</label>
                <select
                  id="exp-enmienda-campo"
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
                  <label>Valor actual en la atención (solo lectura)</label>
                  <p className="df-readonly">{valorAnteriorDeCampo(campoCorregido)}</p>
                </div>
              ) : null}

              <div className="df-field">
                <label htmlFor="exp-enmienda-texto">Corrección justificada</label>
                <textarea
                  id="exp-enmienda-texto"
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
                  onClick={closeEnmiendaForm}
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

export default Expediente