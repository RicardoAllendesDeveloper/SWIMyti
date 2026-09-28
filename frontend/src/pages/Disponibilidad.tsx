import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../services/supabase'
import { useAuthRol } from '../context/AuthRolContext'
import Sidebar from '../components/Sidebar'
import type { Especialidad, HorarioDisponible } from '../types/database'
import '../styles/Disponibilidad.css'

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

function formatFechaCorta(value: string): string {
  try {
    return new Intl.DateTimeFormat('es-CL', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(value))
  } catch {
    return value
  }
}

function formatHoraMin(value: string): string {
  try {
    return new Intl.DateTimeFormat('es-CL', { timeStyle: 'short' }).format(
      new Date(value),
    )
  } catch {
    return value
  }
}

function asSingle<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

function claveDia(value: string): string {
  const d = new Date(value)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`
}

type AtencionAgenda = {
  id_cita: number
  id_horario: number
  id_paciente: number
  fecha_inicio: string
  paciente_nombre: string
  rut: string
  especialidad: string
  motivo: string | null
  estado: string
  llegada: string
}

type TabAtenciones = 'actuales' | 'anteriores' | 'proximas'

function Disponibilidad() {
  const navigate = useNavigate()
  const { rol } = useAuthRol()

  const esProfesionalAgenda = rol === 'doctor' || rol === 'enfermeria'

  const [especialidades, setEspecialidades] = useState<Especialidad[]>([])
  const [horarios, setHorarios] = useState<HorarioDisponible[]>([])
  const [agenda, setAgenda] = useState<AtencionAgenda[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [especialidad, setEspecialidad] = useState('')
  const [fechaInicio, setFechaInicio] = useState('')
  const [fechaFin, setFechaFin] = useState('')
  const [horaInicio, setHoraInicio] = useState('')
  const [horaFin, setHoraFin] = useState('')
  const [diasSemana, setDiasSemana] = useState<number[]>([1, 2, 3, 4, 5])

  const [tabAtenciones, setTabAtenciones] = useState<TabAtenciones>('actuales')
  const [busquedaBloques, setBusquedaBloques] = useState('')
  const [paginaBloques, setPaginaBloques] = useState(1)
  const POR_PAGINA = 10

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)

    const {
      data: { user },
    } = await supabase.auth.getUser()

    // Especialidades del catálogo. Si el profesional (doctor/enfermería) tiene
// especialidades asignadas, se muestran solo las suyas.
    const espRes = await supabase
      .from('especialidades')
      .select('id_especialidad, nombre')
      .eq('activo', true)
      .order('nombre', { ascending: true })

    if (espRes.error) {
      setError(espRes.error.message)
    } else if (user && esProfesionalAgenda) {
      const misEsp = await supabase
        .from('doctores_especialidades')
        .select('id_especialidad, especialidades(nombre)')
        .eq('id_doctor', user.id)

      if (!misEsp.error && misEsp.data && misEsp.data.length > 0) {
        setEspecialidades(
          misEsp.data.map((row) => {
            const esp = Array.isArray(row.especialidades)
              ? row.especialidades[0]
              : row.especialidades
            return {
              id_especialidad: row.id_especialidad as number,
              nombre: (esp?.nombre as string) ?? 'Sin especialidad',
            }
          }),
        )
      } else {
        setEspecialidades((espRes.data ?? []) as Especialidad[])
      }
    } else {
      setEspecialidades((espRes.data ?? []) as Especialidad[])
    }

    // Los horarios visibles: si es admin ve todos; si es doctor, los propios
    let horQuery = supabase
      .from('horarios_disponibles')
      .select(
        `
        id_horario,
        id_profesional,
        id_especialidad,
        fecha_inicio,
        fecha_fin,
        estado,
        usuarios:id_profesional ( nombres, apellidos ),
        especialidades ( nombre )
      `,
      )
      .order('fecha_inicio', { ascending: false })
      .limit(100)

    if (user && esProfesionalAgenda) {
      horQuery = horQuery.eq('id_profesional', user.id)
    }

    const horRes = await horQuery
    if (horRes.error) {
      setError(horRes.error.message || 'No se pudieron cargar los horarios.')
    } else {
      setHorarios((horRes.data ?? []) as unknown as HorarioDisponible[])
    }

    // Agenda de atenciones: todas las citas del doctor (o todas para admin)
    if (user) {
      let agQuery = supabase
        .from('citas')
        .select(
          `
          id_cita,
          id_horario,
          id_paciente,
          motivo,
          estado,
          llegada,
          horarios_disponibles (
            id_profesional,
            fecha_inicio,
            especialidades ( nombre )
          ),
          pacientes ( nombres, apellidos, rut )
        `,
        )
        .order('created_at', { ascending: true })

      if (esProfesionalAgenda) {
        agQuery = agQuery.eq('horarios_disponibles.id_profesional', user.id)
      }

      const agRes = await agQuery
      if (!agRes.error) {
        const rows = (agRes.data ?? []).map((r) => {
          const h = asSingle(r.horarios_disponibles)
          const pac = asSingle(r.pacientes)
          const esp = h ? asSingle(h.especialidades) : null
          return {
            id_cita: r.id_cita as number,
            id_horario: r.id_horario as number,
            id_paciente: r.id_paciente as number,
            fecha_inicio: (h?.fecha_inicio as string) ?? '',
            paciente_nombre: pac
              ? `${pac.apellidos ?? ''}, ${pac.nombres ?? ''}`.trim()
              : `Paciente #${r.id_paciente}`,
            rut: (pac?.rut as string) ?? '',
            especialidad: (esp?.nombre as string) ?? 'Sin especialidad',
            motivo: (r.motivo as string | null) ?? null,
            estado: (r.estado as string) ?? 'reservada',
            llegada: (r.llegada as string | undefined) ?? 'pendiente',
          }
        })
        setAgenda(rows)
      }
    }

    setLoading(false)
  }, [rol])

  useEffect(() => {
    void loadData()
  }, [loadData])

  async function crearBloque(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSuccess(null)

    if (!fechaInicio || !fechaFin || !horaInicio || !horaFin) {
      setError('Define el rango de fechas y la hora de inicio/fin de la jornada.')
      return
    }

    if (diasSemana.length === 0) {
      setError('Selecciona al menos un día de la semana.')
      return
    }

    const horaIni = new Date(`1970-01-01T${horaInicio}:00`)
    const horaFn = new Date(`1970-01-01T${horaFin}:00`)
    if (horaFn <= horaIni) {
      setError('La hora de fin debe ser posterior a la de inicio.')
      return
    }

    setSaving(true)

    const idEspFinal = especialidad
      ? Number(especialidad)
      : especialidades.length === 1
        ? especialidades[0].id_especialidad
        : null

    if (!idEspFinal) {
      setSaving(false)
      setError('Selecciona una especialidad.')
      return
    }

    const { data, error } = await supabase.rpc('fn_generar_bloques_jornada', {
      p_id_especialidad: idEspFinal,
      p_fecha_inicio: fechaInicio,
      p_fecha_fin: fechaFin,
      p_hora_inicio: horaInicio,
      p_hora_fin: horaFin,
      p_dias: diasSemana,
    })

    setSaving(false)

    if (error || !data?.ok) {
      setError(error?.message || data?.error || 'No se pudo publicar la jornada.')
      return
    }

    setSuccess(
      `Jornada publicada: ${data.generados} bloques de 15 minutos generados.`,
    )
    setFechaInicio('')
    setFechaFin('')
    setHoraInicio('')
    setHoraFin('')
    setEspecialidad('')
    await loadData()
  }

  async function cancelarJornada(g: { fecha: string; idEspecialidad: number; idProfesional: string }) {
    setError(null)
    setSuccess(null)

    const confirmado = window.confirm(
      '¿Deseas cancelar todos los bloques disponibles de esta jornada? Las horas ya reservadas no se afectan.',
    )
    if (!confirmado) return

    const { error } = await supabase
      .from('horarios_disponibles')
      .update({ estado: 'cancelada' })
      .eq('id_profesional', g.idProfesional)
      .eq('id_especialidad', g.idEspecialidad)
      .eq('estado', 'disponible')
      .gte('fecha_inicio', `${g.fecha}T00:00:00`)
      .lt('fecha_inicio', `${g.fecha}T23:59:59.999`)

    if (error) {
      setError(error.message || 'No se pudo cancelar la jornada.')
      return
    }
    setSuccess('Jornada cancelada. Las horas disponibles quedaron liberadas.')
    await loadData()
  }

  async function verFichaPaciente(idPaciente: number) {
    navigate(`/expediente/${idPaciente}`)
  }

  async function cambiarEstadoAtencion(idCita: number, nuevoEstado: string) {
    setError(null)
    setSuccess(null)

    const { error } = await supabase
      .from('citas')
      .update({ estado: nuevoEstado })
      .eq('id_cita', idCita)

    if (error) {
      setError(error.message || 'No se pudo actualizar la atención.')
      return
    }
    setSuccess(
      nuevoEstado === 'completada'
        ? 'Atención marcada como realizada.'
        : 'Atención cancelada.',
    )
    await loadData()
  }

  function nombreEspecialidad(h: HorarioDisponible): string {
    const e = asSingle(h.especialidades)
    return e?.nombre ?? 'Sin especialidad'
  }

  // Clasificación de atenciones por día
  const hoy = claveDia(new Date().toISOString())
  const atencionesActuales = agenda.filter(
    (a) => a.fecha_inicio && claveDia(a.fecha_inicio) === hoy,
  )
  const atencionesAnteriores = agenda.filter(
    (a) => a.fecha_inicio && claveDia(a.fecha_inicio) < hoy,
  )
  const atencionesProximas = agenda.filter(
    (a) => a.fecha_inicio && claveDia(a.fecha_inicio) > hoy,
  )

  const listaTab: Record<TabAtenciones, AtencionAgenda[]> = {
    actuales: atencionesActuales,
    anteriores: atencionesAnteriores,
    proximas: atencionesProximas,
  }

  const [paginaAtenciones, setPaginaAtenciones] = useState(1)
  const listaTabActual = listaTab[tabAtenciones]
  const totalPaginasAtenciones = Math.max(
    1,
    Math.ceil(listaTabActual.length / POR_PAGINA),
  )
  const paginaSeguraAtenciones = Math.min(
    paginaAtenciones,
    totalPaginasAtenciones,
  )
  const atencionesPagina = listaTabActual.slice(
    (paginaSeguraAtenciones - 1) * POR_PAGINA,
    paginaSeguraAtenciones * POR_PAGINA,
  )

  // Filtro de bloques publicados
  const horariosFiltrados = horarios.filter((h) => {
    if (!busquedaBloques.trim()) return true
    const q = busquedaBloques.trim().toLowerCase()
    return (
      formatFechaHora(h.fecha_inicio).toLowerCase().includes(q) ||
      nombreEspecialidad(h).toLowerCase().includes(q) ||
      h.estado.toLowerCase().includes(q)
    )
  })

  // Agrupar los bloques por día + especialidad + profesional (jornada)
  type GrupoJornada = {
    fecha: string
    idEspecialidad: number
    especialidad: string
    idProfesional: string
    profesional: string
    bloques: HorarioDisponible[]
  }
  const gruposJornada: GrupoJornada[] = (() => {
    const mapa = new Map<string, GrupoJornada>()
    for (const h of horariosFiltrados) {
      const idEsp = h.id_especialidad ?? 0
      const k = `${claveDia(h.fecha_inicio)}|${idEsp}|${h.id_profesional}`
      let g = mapa.get(k)
      if (!g) {
        const u = asSingle(h.usuarios)
        g = {
          fecha: claveDia(h.fecha_inicio),
          idEspecialidad: idEsp,
          especialidad: nombreEspecialidad(h),
          idProfesional: h.id_profesional,
          profesional: u
            ? `${u.nombres ?? ''} ${u.apellidos ?? ''}`.trim()
            : 'Profesional',
          bloques: [],
        }
        mapa.set(k, g)
      }
      g.bloques.push(h)
    }
    return Array.from(mapa.values()).sort((a, b) => a.fecha.localeCompare(b.fecha))
  })()

  // Paginación por jornada (grupo)
  const totalPaginasBloques = Math.max(
    1,
    Math.ceil(gruposJornada.length / POR_PAGINA),
  )
  const paginaSeguraBloques = Math.min(paginaBloques, totalPaginasBloques)
  const gruposPagina = gruposJornada.slice(
    (paginaSeguraBloques - 1) * POR_PAGINA,
    paginaSeguraBloques * POR_PAGINA,
  )

  function estadoJornada(g: GrupoJornada): { label: string; cls: string } {
    const disponibles = g.bloques.filter((b) => b.estado === 'disponible').length
    if (disponibles === g.bloques.length) return { label: 'Disponible', cls: 'jornada-ok' }
    if (disponibles === 0) return { label: 'Completa', cls: 'jornada-agotada' }
    return { label: 'Parcial', cls: 'jornada-parcial' }
  }

  const ESTADO_LABEL: Record<string, string> = {
    disponible: 'Disponible',
    reservada: 'Reservada',
    cancelada: 'Cancelada',
    completada: 'Completada',
  }

  return (
    <div className="dash">
      <Sidebar moduloActivo="disponibilidad" />

      <div className="dash-main">
        <header className="dash-topbar">
          <div>
            <h2>Agenda</h2>
            <p>Publica tu disponibilidad y gestiona tus atenciones</p>
          </div>
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
                <h3>Atenciones</h3>
                <p className="dash-muted">
                  Consultas y procedimientos agendados para ti
                </p>
              </div>
            </div>

            <div className="agenda-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={tabAtenciones === 'actuales'}
                className={`agenda-tab${tabAtenciones === 'actuales' ? ' is-active' : ''}`}
                onClick={() => {
                  setTabAtenciones('actuales')
                  setPaginaAtenciones(1)
                }}
              >
                Actuales ({atencionesActuales.length})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tabAtenciones === 'anteriores'}
                className={`agenda-tab${tabAtenciones === 'anteriores' ? ' is-active' : ''}`}
                onClick={() => {
                  setTabAtenciones('anteriores')
                  setPaginaAtenciones(1)
                }}
              >
                Anteriores ({atencionesAnteriores.length})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tabAtenciones === 'proximas'}
                className={`agenda-tab${tabAtenciones === 'proximas' ? ' is-active' : ''}`}
                onClick={() => {
                  setTabAtenciones('proximas')
                  setPaginaAtenciones(1)
                }}
              >
                Próximas ({atencionesProximas.length})
              </button>
            </div>

            {loading ? (
              <p className="dash-loading">Cargando atenciones…</p>
            ) : listaTabActual.length === 0 ? (
              <p className="dash-empty">
                No hay atenciones en esta categoría.
              </p>
            ) : (
              <div className="dash-table-wrap">
                <table className="dash-table">
                  <thead>
                    <tr>
                      <th>Fecha y hora</th>
                      <th>Paciente</th>
                      <th>RUT</th>
                      <th>Especialidad</th>
                      <th>Motivo</th>
                      <th>Estado</th>
                      <th>Llegada</th>
                      <th>Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {atencionesPagina.map((a) => (
                      <tr key={a.id_cita}>
                        <td>{formatFechaCorta(a.fecha_inicio)}</td>
                        <td>{a.paciente_nombre}</td>
                        <td>{a.rut || '—'}</td>
                        <td>{a.especialidad}</td>
                        <td>{a.motivo ?? '—'}</td>
                        <td>
                          <span className="dash-badge">
                            {ESTADO_LABEL[a.estado] ?? a.estado}
                          </span>
                        </td>
                        <td>
                          <span className={`agenda-llegada agenda-llegada-${a.llegada}`}>
                            {a.llegada === 'en_sala'
                              ? 'En sala'
                              : a.llegada === 'tarde'
                                ? 'Llegó tarde'
                                : a.llegada === 'no_llego'
                                  ? 'No llegó'
                                  : 'Sin registro'}
                          </span>
                        </td>
                        <td>
                          <div className="agenda-acciones">
                            <button
                              type="button"
                              className="dash-btn-secondary"
                              onClick={() => void verFichaPaciente(a.id_paciente)}
                              title="Abrir el expediente del paciente"
                            >
                              {tabAtenciones === 'actuales'
                                ? 'Comenzar atención'
                                : 'Ver expediente'}
                            </button>
                            {tabAtenciones !== 'anteriores' &&
                            a.estado === 'reservada' ? (
                              <>
                                <button
                                  type="button"
                                  className="dash-btn-primary"
                                  onClick={() =>
                                    void cambiarEstadoAtencion(a.id_cita, 'completada')
                                  }
                                >
                                  Realizada
                                </button>
                                <button
                                  type="button"
                                  className="dash-btn-danger"
                                  onClick={() =>
                                    void cambiarEstadoAtencion(a.id_cita, 'cancelada')
                                  }
                                >
                                  No asistió
                                </button>
                              </>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {totalPaginasAtenciones > 1 ? (
                  <div className="dash-pagination">
                    <button
                      type="button"
                      className="dash-btn-secondary"
                      disabled={paginaSeguraAtenciones <= 1}
                      onClick={() => setPaginaAtenciones(paginaSeguraAtenciones - 1)}
                    >
                      Anterior
                    </button>
                    <span className="dash-muted">
                      Página {paginaSeguraAtenciones} de {totalPaginasAtenciones}
                    </span>
                    <button
                      type="button"
                      className="dash-btn-secondary"
                      disabled={paginaSeguraAtenciones >= totalPaginasAtenciones}
                      onClick={() => setPaginaAtenciones(paginaSeguraAtenciones + 1)}
                    >
                      Siguiente
                    </button>
                  </div>
                ) : null}
              </div>
            )}
          </div>

<div className="dash-card">
              <div className="dash-card-header">
                <div>
                  <h3>Publicar jornada</h3>
                  <p className="dash-muted">
                    Define tu jornada de atención y se divide en bloques de 15 minutos
                  </p>
                </div>
              </div>

              <form className="dash-form" onSubmit={(e) => void crearBloque(e)}>
                {especialidades.length > 1 ? (
                  <div className="dash-field">
                    <label htmlFor="disp-especialidad">Especialidad</label>
                    <select
                      id="disp-especialidad"
                      value={especialidad}
                      onChange={(e) => setEspecialidad(e.target.value)}
                    >
                      <option value="">Selecciona una especialidad</option>
                      {especialidades.map((e) => (
                        <option key={e.id_especialidad} value={String(e.id_especialidad)}>
                          {e.nombre}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : especialidades.length === 1 ? (
                  <p className="dash-field-hint" style={{ margin: '0 0 0.6rem' }}>
                    Especialidad: <strong>{especialidades[0].nombre}</strong>
                  </p>
                ) : null}

                <div className="dash-row">
                  <div className="dash-field">
                    <label htmlFor="disp-inicio">Desde</label>
                    <input
                      id="disp-inicio"
                      type="date"
                      value={fechaInicio}
                      onChange={(e) => setFechaInicio(e.target.value)}
                      required
                      disabled={saving}
                    />
                  </div>
                  <div className="dash-field">
                    <label htmlFor="disp-fin">Hasta</label>
                    <input
                      id="disp-fin"
                      type="date"
                      value={fechaFin}
                      onChange={(e) => setFechaFin(e.target.value)}
                      required
                      disabled={saving}
                    />
                  </div>
                </div>

                <div className="dash-row">
                  <div className="dash-field">
                    <label htmlFor="disp-hora-ini">Hora de inicio</label>
                    <input
                      id="disp-hora-ini"
                      type="time"
                      value={horaInicio}
                      onChange={(e) => setHoraInicio(e.target.value)}
                      required
                      disabled={saving}
                    />
                  </div>
                  <div className="dash-field">
                    <label htmlFor="disp-hora-fin">Hora de fin</label>
                    <input
                      id="disp-hora-fin"
                      type="time"
                      value={horaFin}
                      onChange={(e) => setHoraFin(e.target.value)}
                      required
                      disabled={saving}
                    />
                  </div>
                </div>

                <div className="dash-field">
                  <label>Días de la semana</label>
                  <div className="jornada-dias">
                    {[
                      { n: 'Lun', v: 1 },
                      { n: 'Mar', v: 2 },
                      { n: 'Mié', v: 3 },
                      { n: 'Jue', v: 4 },
                      { n: 'Vie', v: 5 },
                      { n: 'Sáb', v: 6 },
                    ].map((d) => (
                      <label key={d.v} className="jornada-dia">
                        <input
                          type="checkbox"
                          checked={diasSemana.includes(d.v)}
                          onChange={() =>
                            setDiasSemana((prev) =>
                              prev.includes(d.v)
                                ? prev.filter((x) => x !== d.v)
                                : [...prev, d.v],
                            )
                          }
                          disabled={saving}
                        />
                        {d.n}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="dash-form-actions">
                  <button
                    type="submit"
                    className="dash-btn-primary"
                    disabled={saving}
                  >
                    {saving ? 'Publicando…' : 'Publicar jornada'}
                  </button>
                </div>
              </form>
            </div>

          <div className="dash-card">
            <div className="dash-card-header">
              <div>
                <h3>Bloques publicados</h3>
                <p className="dash-muted">
                  Disponibilidad agrupada por jornada (día)
                </p>
              </div>
              <span className="dash-badge">{gruposJornada.length} jornadas</span>
            </div>

            {loading ? (
              <p className="dash-loading">Cargando bloques…</p>
            ) : (
              <>
                <div className="dash-filter-bar">
                  <input
                    className="dash-filter-input"
                    type="search"
                    placeholder="Buscar por fecha, especialidad o estado…"
                    value={busquedaBloques}
                    onChange={(e) => {
                      setBusquedaBloques(e.target.value)
                      setPaginaBloques(1)
                    }}
                  />
                  <span className="dash-muted">
                    {gruposJornada.length} jornada
                    {gruposJornada.length === 1 ? '' : 's'}
                  </span>
                </div>
                {gruposJornada.length === 0 ? (
                  <p className="dash-empty">No hay bloques que coincidan.</p>
                ) : (
                  <div className="jornadas">
                    {gruposPagina.map((g) => {
                      const est = estadoJornada(g)
                      const disponibles = g.bloques.filter(
                        (b) => b.estado === 'disponible',
                      ).length
                      const reservadas = g.bloques.filter(
                        (b) => b.estado === 'reservada',
                      ).length
                      const horas = g.bloques
                        .slice()
                        .sort(
                          (a, b) =>
                            new Date(a.fecha_inicio).getTime() -
                            new Date(b.fecha_inicio).getTime(),
                        )
                      return (
                        <div key={`${g.fecha}-${g.idEspecialidad}-${g.idProfesional}`} className="jornada">
                          <div className="jornada-header">
                            <div>
                              <strong>
                                {new Date(
                                  g.fecha + 'T00:00:00',
                                ).toLocaleDateString('es-CL', {
                                  weekday: 'long',
                                  day: 'numeric',
                                  month: 'long',
                                  year: 'numeric',
                                })}
                              </strong>
                              <span className="jornada-meta">
                                {g.especialidad} · {g.profesional}
                              </span>
                            </div>
                            <span className={`jornada-estado ${est.cls}`}>{est.label}</span>
                          </div>
                          <div className="jornada-resumen">
                            {disponibles > 0 ? (
                              <span className="jornada-count jornada-count-ok">
                                {disponibles} disponible{disponibles === 1 ? '' : 's'}
                              </span>
                            ) : null}
                            {reservadas > 0 ? (
                              <span className="jornada-count jornada-count-res">
                                {reservadas} reservada{reservadas === 1 ? '' : 's'}
                              </span>
                            ) : null}
                            <span className="jornada-count">
                              {g.bloques.length} en total
                            </span>
                          </div>
                          <div className="jornada-horas">
                            {horas.map((h) => (
                              <span
                                key={h.id_horario}
                                className={`jornada-hora${h.estado === 'disponible' ? ' is-disponible' : h.estado === 'reservada' ? ' is-reservada' : ' is-no'}`}
                                title={ESTADO_LABEL[h.estado] ?? h.estado}
                              >
                                {formatHoraMin(h.fecha_inicio)}
                              </span>
                            ))}
                          </div>
                          {disponibles > 0 ? (
                            <button
                              type="button"
                              className="dash-btn-secondary jornada-cancelar"
                              onClick={() =>
                                void cancelarJornada({
                                  fecha: g.fecha,
                                  idEspecialidad: g.idEspecialidad,
                                  idProfesional: g.idProfesional,
                                })
                              }
                            >
                              Cancelar jornada
                            </button>
                          ) : null}
                        </div>
                      )
                    })}
                    {totalPaginasBloques > 1 ? (
                      <div className="dash-pagination">
                        <button
                          type="button"
                          className="dash-btn-secondary"
                          disabled={paginaSeguraBloques <= 1}
                          onClick={() => setPaginaBloques(paginaSeguraBloques - 1)}
                        >
                          Anterior
                        </button>
                        <span className="dash-muted">
                          Página {paginaSeguraBloques} de {totalPaginasBloques}
                        </span>
                        <button
                          type="button"
                          className="dash-btn-secondary"
                          disabled={paginaSeguraBloques >= totalPaginasBloques}
                          onClick={() => setPaginaBloques(paginaSeguraBloques + 1)}
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
    </div>
  )
}

export default Disponibilidad