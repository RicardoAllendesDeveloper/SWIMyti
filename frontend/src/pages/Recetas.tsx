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

type OrdenExamen = {
  id_orden: number
  id_paciente: number
  id_usuario_emisor: string
  tipo_examen: string
  indicaciones: string | null
  enviada_a_apoyo: boolean
  modalidad: 'en_recinto' | 'otro_recinto'
  toma_muestra: 'pendiente' | 'agendada' | 'realizada'
  fecha_toma_muestra: string | null
  estado: 'pendiente' | 'en_proceso' | 'completada' | 'cancelada'
  created_at: string
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
  const [ordenes, setOrdenes] = useState<OrdenExamen[]>([])
  const [pacientes, setPacientes] = useState<Paciente[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
const [userId, setUserId] = useState('')
  const [tab, setTab] = useState<'recetas' | 'certificados' | 'ordenes'>('recetas')
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

  // Orden de examen
  const [oPaciente, setOPaciente] = useState('')
  const [oTipo, setOTipo] = useState('')
  const [oIndicaciones, setOIndicaciones] = useState('')
  const [oModalidad, setOModalidad] = useState<'en_recinto' | 'otro_recinto'>('en_recinto')

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)

    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (user) setUserId(user.id)

    const [recRes, certRes, ordRes, pacRes] = await Promise.all([
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
        .from('ordenes_examen')
        .select(
          'id_orden, id_paciente, id_usuario_emisor, tipo_examen, indicaciones, enviada_a_apoyo, modalidad, toma_muestra, fecha_toma_muestra, estado, created_at, pacientes(nombres, apellidos, rut)',
        )
        .order('created_at', { ascending: false }),
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

    if (ordRes.error) {
      setError((c) => c ?? (ordRes.error?.message || 'No se pudieron cargar las órdenes de examen.'))
      setOrdenes([])
    } else {
      const rows = (ordRes.data ?? []).map((row) => {
        const rel = row.pacientes as
          | { nombres: string; apellidos: string; rut: string }
          | { nombres: string; apellidos: string; rut: string }[]
          | null
        const p = Array.isArray(rel) ? rel[0] ?? null : rel
        return {
          id_orden: row.id_orden as number,
          id_paciente: row.id_paciente as number,
          id_usuario_emisor: row.id_usuario_emisor as string,
          tipo_examen: row.tipo_examen as string,
          indicaciones: row.indicaciones as string | null,
          enviada_a_apoyo: row.enviada_a_apoyo as boolean,
          modalidad: (row.modalidad as OrdenExamen['modalidad']) ?? 'en_recinto',
          toma_muestra: (row.toma_muestra as OrdenExamen['toma_muestra']) ?? 'pendiente',
          fecha_toma_muestra: (row.fecha_toma_muestra as string | null) ?? null,
          estado: row.estado as OrdenExamen['estado'],
          created_at: row.created_at as string,
          pacientes: p
            ? { nombres: p.nombres, apellidos: p.apellidos, rut: p.rut }
            : null,
        } satisfies OrdenExamen
      })
      setOrdenes(rows)
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
    setOPaciente('')
    setOTipo('')
    setOIndicaciones('')
    setOModalidad('en_recinto')
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
    } else if (tab === 'certificados') {
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
    } else {
      // Órdenes de examen
      if (!oPaciente || !oTipo.trim()) {
        setError('Selecciona un paciente y escribe el tipo de examen.')
        return
      }
      setSaving(true)
      const { error: insError } = await supabase.from('ordenes_examen').insert({
        id_paciente: Number(oPaciente),
        id_usuario_emisor: userId,
        tipo_examen: oTipo.trim(),
        indicaciones: oIndicaciones.trim() || null,
        enviada_a_apoyo: oModalidad === 'en_recinto',
        modalidad: oModalidad,
        toma_muestra: 'pendiente',
        estado: 'pendiente',
      })
      setSaving(false)
      if (insError) {
        setError(insError.message || 'No se pudo emitir la orden de examen.')
        return
      }
      setSuccess(
        oModalidad === 'en_recinto'
          ? 'Orden de examen emitida y enviada al laboratorio. El paciente debe agendar la toma de muestra.'
          : 'Orden de examen emitida. El paciente puede descargarla para realizarla en otro recinto.',
      )
    }

    setShowForm(false)
    await loadData()
  }

  async function handleDelete(item: Receta | Certificado) {
    const esReceta = 'medicamentos' in item
    const confirmado = window.confirm(
      esReceta
        ? `¿Eliminar la receta #${(item as Receta).id_receta}? Esta acción no se puede deshacer.`
        : `¿Eliminar el certificado #${(item as Certificado).id_certificado}? Esta acción no se puede deshacer.`,
    )
    if (!confirmado) return

    setError(null)
    setSuccess(null)
    setSaving(true)

    const tabla = esReceta ? 'recetas_medicas' : 'certificados_clinicos'
    const idCol = esReceta ? 'id_receta' : 'id_certificado'
    const idVal = esReceta
      ? (item as Receta).id_receta
      : (item as Certificado).id_certificado

    const { error: delError } = await supabase
      .from(tabla)
      .delete()
      .eq(idCol, idVal)

    setSaving(false)

    if (delError) {
      setError(
        delError.message ||
          'No se pudo eliminar el documento. Solo puedes eliminar los que emitiste tú.',
      )
      return
    }

    setSuccess(
      esReceta ? 'Receta eliminada correctamente.' : 'Certificado eliminado correctamente.',
    )
    await loadData()
  }

  async function cancelarOrden(orden: OrdenExamen) {
    const confirmado = window.confirm(
      `¿Cancelar la orden de examen #${orden.id_orden}? Esta acción no se puede deshacer.`,
    )
    if (!confirmado) return

    setError(null)
    setSuccess(null)
    setSaving(true)

    const { error } = await supabase
      .from('ordenes_examen')
      .update({ estado: 'cancelada' })
      .eq('id_orden', orden.id_orden)

    setSaving(false)

    if (error) {
      setError(error.message || 'No se pudo cancelar la orden.')
      return
    }
    setSuccess('Orden de examen cancelada.')
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

  const filtrarOrden = (o: OrdenExamen): boolean => {
    if (!busqueda.trim()) return true
    const q = busqueda.trim().toLowerCase()
    return `${o.tipo_examen} ${o.indicaciones ?? ''} ${o.pacientes?.nombres ?? ''} ${o.pacientes?.apellidos ?? ''} ${o.pacientes?.rut ?? ''} ${o.estado}`
      .toLowerCase()
      .includes(q)
  }

  const recetasFiltradas = recetas.filter(filtrarReceta)
  const certificadosFiltrados = certificados.filter(filtrarCertificado)
  const ordenesFiltradas = ordenes.filter(filtrarOrden)

  const listaActiva =
    tab === 'recetas'
      ? recetasFiltradas
      : tab === 'certificados'
        ? certificadosFiltrados
        : ordenesFiltradas
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
            <h2>Generar documentos</h2>
            <p>Emisión de recetas médicas, certificados clínicos y órdenes de examen</p>
          </div>
          {puedeEmitir ? (
            <button
              type="button"
              className="dash-btn-primary"
              onClick={openForm}
            >
              {tab === 'recetas'
                ? 'Nueva receta'
                : tab === 'certificados'
                  ? 'Nuevo certificado'
                  : 'Nueva orden de examen'}
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
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'ordenes'}
              className={`recetas-tab${tab === 'ordenes' ? ' is-active' : ''}`}
              onClick={() => setTab('ordenes')}
            >
              Órdenes de examen
            </button>
          </div>

          <div className="dash-card">
            <div className="dash-card-header">
              <div>
                <h3>
                  {tab === 'recetas'
                    ? 'Recetas médicas'
                    : tab === 'certificados'
                      ? 'Certificados clínicos'
                      : 'Órdenes de examen'}
                </h3>
                <p className="dash-muted">
                  {tab === 'recetas'
                    ? 'Medicamentos e indicaciones emitidos por el profesional'
                    : tab === 'certificados'
                      ? 'Reposo, atención, aptitud y otros certificados'
                      : 'Exámenes solicitados por el doctor, opcionalmente enviados a unidad de apoyo'}
                </p>
              </div>
              <span className="dash-badge">
                {loading
                  ? '…'
                  : tab === 'recetas'
                    ? `${recetas.length} registro${recetas.length === 1 ? '' : 's'}`
                    : tab === 'certificados'
                      ? `${certificados.length} registro${certificados.length === 1 ? '' : 's'}`
                      : `${ordenes.length} registro${ordenes.length === 1 ? '' : 's'}`}
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
                          <th>{tab === 'recetas' ? 'Medicamentos' : tab === 'certificados' ? 'Tipo' : 'Examen'}</th>
                          <th>{tab === 'recetas' ? 'Indicaciones' : tab === 'certificados' ? 'Detalle' : 'Estado'}</th>
                          <th>{tab === 'ordenes' ? 'Fecha' : 'Emisión'}</th>
                          <th>Acción</th>
                        </tr>
                      </thead>
                      <tbody>
                        {listaPagina.map((item) => {
                          const paciente = item.pacientes
                          if (tab === 'ordenes') {
                            const o = item as OrdenExamen
                            return (
                              <tr key={o.id_orden}>
                                <td>#{o.id_orden}</td>
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
                                  <span className="recetas-chip">{o.tipo_examen}</span>
                                </td>
                                <td>
                                  <span className={`orden-estado orden-estado-${o.estado}`}>
                                    {o.estado}
                                  </span>
                                  <div className="dash-muted">
                                    {o.modalidad === 'en_recinto'
                                      ? 'En el recinto'
                                      : 'Otro recinto'}
                                  </div>
                                  {o.fecha_toma_muestra ? (
                                    <div className="dash-muted">
                                      Toma de muestra: {formatFechaHora(o.fecha_toma_muestra)}
                                    </div>
                                  ) : null}
                                </td>
                                <td>{formatFecha(o.created_at)}</td>
                                <td>
                                  <div className="recetas-acciones">
                                    {puedeEmitir && o.id_usuario_emisor === userId ? (
                                      <button
                                        type="button"
                                        className="dash-btn-secondary"
                                        onClick={() => void cancelarOrden(o)}
                                        disabled={saving}
                                      >
                                        Cancelar
                                      </button>
                                    ) : null}
                                  </div>
                                </td>
                              </tr>
                            )
                          }
                          const esReceta = 'medicamentos' in item
                          const doc = item as Receta | Certificado
                          return (
                            <tr
                              key={
                                esReceta
                                  ? (doc as Receta).id_receta
                                  : (doc as Certificado).id_certificado
                              }
                            >
                              <td>
                                #
                                {esReceta
                                  ? (doc as Receta).id_receta
                                  : (doc as Certificado).id_certificado}
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
                                  (doc as Receta).medicamentos
                                ) : (
                                  <span className="recetas-chip">
                                    {(doc as Certificado).tipo_certificado}
                                  </span>
                                )}
                              </td>
                              <td>
                                {esReceta
                                  ? (doc as Receta).indicaciones || '—'
                                  : (doc as Certificado).detalle || '—'}
                              </td>
                              <td>{formatFecha(doc.fecha_emision)}</td>
                              <td>
                                <div className="recetas-acciones">
                                  <button
                                    type="button"
                                    className="dash-btn-secondary"
                                    onClick={() => setDetalle(doc)}
                                  >
                                    Ver detalle
                                  </button>
                                  {puedeEmitir && doc.id_usuario_emisor === userId ? (
                                    <button
                                      type="button"
                                      className="dash-btn-danger"
                                      onClick={() => void handleDelete(doc)}
                                      disabled={saving}
                                    >
                                      Eliminar
                                    </button>
                                  ) : null}
                                </div>
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
                  {tab === 'recetas'
                    ? 'Nueva receta médica'
                    : tab === 'certificados'
                      ? 'Nuevo certificado'
                      : 'Nueva orden de examen'}
                </h3>
                <p>
                  {tab === 'ordenes'
                    ? 'Solicita un examen para el paciente. Puedes enviarla al personal de apoyo.'
                    : 'El documento queda firmado digitalmente y es inmutable una vez guardado.'}
                </p>
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
                  value={
                    tab === 'recetas'
                      ? rPaciente
                      : tab === 'certificados'
                        ? cPaciente
                        : oPaciente
                  }
                  onChange={(e) =>
                    tab === 'recetas'
                      ? setRPaciente(e.target.value)
                      : tab === 'certificados'
                        ? setCPaciente(e.target.value)
                        : setOPaciente(e.target.value)
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
              ) : tab === 'certificados' ? (
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
              ) : (
                <>
                  <div className="dash-field">
                    <label htmlFor="doc-tipo-examen">Tipo de examen</label>
                    <input
                      id="doc-tipo-examen"
                      type="text"
                      value={oTipo}
                      onChange={(e) => setOTipo(e.target.value)}
                      placeholder="Ej. Hemograma, Radiografía de tórax, Perfil lipídico…"
                      required
                      disabled={saving}
                    />
                  </div>
                  <div className="dash-field">
                    <label htmlFor="doc-ord-indicaciones">Indicaciones (opcional)</label>
                    <textarea
                      id="doc-ord-indicaciones"
                      value={oIndicaciones}
                      onChange={(e) => setOIndicaciones(e.target.value)}
                      placeholder="Ayuno, preparación, observaciones…"
                      disabled={saving}
                    />
                  </div>
                  <div className="dash-field">
                    <label htmlFor="doc-modalidad">¿Dónde se realizará el examen?</label>
                    <select
                      id="doc-modalidad"
                      value={oModalidad}
                      onChange={(e) => setOModalidad(e.target.value as 'en_recinto' | 'otro_recinto')}
                      disabled={saving}
                    >
                      <option value="en_recinto">En el recinto</option>
                      <option value="otro_recinto">En otro recinto</option>
                    </select>
                    <p className="dash-field-hint">
                      {oModalidad === 'en_recinto'
                        ? 'La orden se envía al laboratorio y el paciente agendará la toma de muestra.'
                        : 'La orden queda como documento descargable para el paciente.'}
                    </p>
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
                      : tab === 'certificados'
                        ? 'Guardar certificado'
                        : 'Guardar orden'}
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
