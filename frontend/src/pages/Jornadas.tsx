import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { supabase } from '../services/supabase'
import { useAuthRol } from '../context/AuthRolContext'
import Sidebar from '../components/Sidebar'
import type { Especialidad, HorarioDisponible, MotivoBloqueo } from '../types/database'
import { claveDia, formatHoraMin, rangoUtcDeDia, desplazarDia, claveHoy } from '../utils/fechas'
import '../styles/Agenda.css'

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

function asSingle<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? (value[0] ?? null) : value
}

/** Profesional que la jefatura o el administrador pueden cargar horariamente. */
type ProfesionalAgenda = {
  id_profesional: string
  nombre: string
  especialidad: string
  id_especialidad: number
}

type CitaArea = {
  id_cita: number
  id_horario: number
  id_paciente: number
  fecha_inicio: string
  paciente_nombre: string
  rut: string
  especialidad: string
  profesional: string
  motivo: string | null
  estado: string
}

type TabJornadas = 'bloques' | 'citas'

const ESTADO_LABEL: Record<string, string> = {
  disponible: 'Disponible',
  reservada: 'Reservada',
  cancelada: 'Cancelada',
  bloqueada: 'Bloqueada',
  completada: 'Completada',
}

/**
 * Jornadas: coordina el área. Dos pestañas:
 *  1. "Jornadas y bloques" — crear, publicar, editar y eliminar las jornadas de
 *     los profesionales coordinables, incluidos los propios.
 *  2. "Citas del área" — ver y editar las citas de esos profesionales.
 *
 * Exclusivo de jefatura y administrador. Ver AGENTS.md, "Definición funcional".
 */
function Jornadas() {
  const { rol, roles } = useAuthRol()

  const [tab, setTab] = useState<TabJornadas>('bloques')

  const [especialidades, setEspecialidades] = useState<Especialidad[]>([])
  const [horarios, setHorarios] = useState<HorarioDisponible[]>([])
  const [profesionales, setProfesionales] = useState<ProfesionalAgenda[]>([])
  const [citasArea, setCitasArea] = useState<CitaArea[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [especialidad, setEspecialidad] = useState('')
  const [profesional, setProfesional] = useState('')
  const [fechaInicio, setFechaInicio] = useState('')
  const [fechaFin, setFechaFin] = useState('')
  const [horaInicio, setHoraInicio] = useState('')
  const [horaFin, setHoraFin] = useState('')
  const [diasSemana, setDiasSemana] = useState<number[]>([1, 2, 3, 4, 5])
  const [busquedaBloques, setBusquedaBloques] = useState('')
  const [busquedaCitas, setBusquedaCitas] = useState('')
  const [paginaBloques, setPaginaBloques] = useState(1)
  const [paginaCitas, setPaginaCitas] = useState(1)
  const POR_PAGINA = 10

  // Navegación por día y filtro por profesional: ver `loadBloques`.
  const [diaVisto, setDiaVisto] = useState(() => claveHoy())
  const [filtroProfesional, setFiltroProfesional] = useState('')
  const [cargandoBloques, setCargandoBloques] = useState(false)
  const [errorBloques, setErrorBloques] = useState<string | null>(null)

  // Deshabilitar horas
  const [seleccionBloqueo, setSeleccionBloqueo] = useState<number[]>([])
  const [modalBloqueo, setModalBloqueo] = useState<HorarioDisponible[] | null>(null)
  const [idMotivoBloqueo, setIdMotivoBloqueo] = useState(0)
  const [detalleBloqueo, setDetalleBloqueo] = useState('')
  const [motivosBloqueo, setMotivosBloqueo] = useState<MotivoBloqueo[]>([])
  const [avisoCobertura, setAvisoCobertura] = useState<string[] | null>(null)

  const motivoElegido = motivosBloqueo.find((m) => m.id_motivo === idMotivoBloqueo)
  const [bloqueando, setBloqueando] = useState(false)
  const [avisoLlamar, setAvisoLlamar] = useState<
    { id_cita: number; id_paciente: number; fecha: string }[] | null
  >(null)

  const soyAdministrador = rol === 'administrador'
  const soyJefatura = roles.includes('jefatura')

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)

    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      setLoading(false)
      return
    }

    // Especialidades del catálogo completo: quien coordina elige de todas.
    const espRes = await supabase
      .from('especialidades')
      .select('id_especialidad, nombre')
      .eq('activo', true)
      .order('nombre', { ascending: true })

    // Catálogo de motivos: lo elige la jefatura al bloquear, y el tipo
    // (planificado/sobrevenido) es lo que decide si la falta de cobertura se
    // rechaza o solo se advierte. Sin esto no habría forma de rotar el receso.
    const motivosRes = await supabase
      .from('motivos_bloqueo')
      .select('id_motivo, nombre, tipo, requiere_detalle')
      .eq('activo', true)
      .order('tipo', { ascending: true })
      .order('nombre', { ascending: true })

    if (motivosRes.error) {
      setError(motivosRes.error.message)
    } else {
      setMotivosBloqueo((motivosRes.data ?? []) as MotivoBloqueo[])
    }

    if (espRes.error) {
      setError(espRes.error.message)
    } else {
      setEspecialidades((espRes.data ?? []) as Especialidad[])
    }

    // Profesionales coordinables. El RPC ya viene acotado al ámbito: la
    // jefatura a los de su servicio (incluyéndose, porque también atiende) y el
    // administrador a todos. No se refiltra en el cliente.
    const profRes = await supabase.rpc('fn_profesionales_agenda_coordinable')
    let ids: string[] = []
    if (profRes.error) {
      setError(profRes.error.message)
      setProfesionales([])
    } else {
      const filas = (profRes.data ?? []) as ProfesionalAgenda[]
      setProfesionales(filas)
      ids = [...new Set(filas.map((p) => p.id_profesional))]
      if (filas.length === 1) setProfesional(filas[0].id_profesional)
    }

    // Los bloques NO se cargan acá: se cargan por día en `loadBloques`. Pedir
    // los ~6.900 del horizonte completo tardaba más de un segundo y se pintaba
    // una tabla de 30 días × 6 profesionales que no se puede usar.
    // Ver `loadBloques` y el filtro por profesional.

    // Citas del área: las de los profesionales coordinables. Para el
    // administrador son todas; para la jefatura, las de su servicio, y las
    // propias quedan incluidas porque ella aparece en su propio RPC.
    if (ids.length === 0) {
      setCitasArea([])
      setLoading(false)
      return
    }

    const citasRes = await supabase
      .from('citas')
      .select(
        `
        id_cita,
        id_horario,
        id_paciente,
        motivo,
        estado,
        horarios_disponibles(
             id_profesional,
             fecha_inicio,
             usuarios:id_profesional ( nombres, apellidos ),
             especialidades(nombre)),
           pacientes(nombres, apellidos, rut)
      `,
      )
      .in('horarios_disponibles.id_profesional', ids)
      .order('created_at', { ascending: true })

    if (!citasRes.error) {
      setCitasArea(
        (citasRes.data ?? []).map((r) => {
          const h = asSingle(r.horarios_disponibles)
          const pac = asSingle(r.pacientes)
          const esp = h ? asSingle(h.especialidades) : null
          const prof = h ? asSingle(h.usuarios) : null
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
            profesional: prof
              ? `${prof.nombres ?? ''} ${prof.apellidos ?? ''}`.trim()
              : 'Profesional',
            motivo: (r.motivo as string | null) ?? null,
            estado: (r.estado as string) ?? 'reservada',
          }
        }),
      )
    }

    setLoading(false)
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  /**
   * Carga los bloques de UN día, y opcionalmente de un solo profesional.
   *
   * Antes se pedía el horizonte completo (30 días × 6 profesionales ≈ 6.900
   * filas) en 7 tandas de 1.000 y se agrupaba todo en memoria para pintar una
   * tabla de 10 filas por página. Medido contra la BD real, cada tanda costaba
   * ~170 ms: más de un segundo de red para mostrar datos que nadie iba a
   * recorrer, y el agrupamiento en el cliente era lo más caro de todo.
   *
   * Un día son ~200 filas en un solo request. Además el filtro por
   * profesional es lo que hace utilizable la vista: para rotar el receso hay
   * que ver a un profesional y su franja, no seis columnas mezcladas.
   */
  const loadBloques = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    setCargandoBloques(true)
    setErrorBloques(null)

    const CAMPOS_HORARIOS = `
        id_horario,
        id_profesional,
        id_especialidad,
        fecha_inicio,
        fecha_fin,
        estado,
        motivo_bloqueo,
        bloqueado_por,
        bloqueado_at,
        usuarios:id_profesional ( nombres, apellidos ),
        especialidades ( nombre )
      `

    // El rango UTC se calcula desde el día chileno, no con un offset fijo:
    // ver `rangoUtcDeDia`.
    const { desde, hasta } = rangoUtcDeDia(diaVisto)

    let consulta = supabase
      .from('horarios_disponibles')
      .select(CAMPOS_HORARIOS)
      .gte('fecha_inicio', desde)
      .lt('fecha_inicio', hasta)
      .order('fecha_inicio', { ascending: true })

    // Sin profesional elegido se piden los del día de todos los coordinables;
    // con uno elegido, solo los suyos.
    if (filtroProfesional) {
      consulta = consulta.eq('id_profesional', filtroProfesional)
    }

    const { data, error } = await consulta

    if (error) {
      setErrorBloques(error.message)
      setHorarios([])
    } else {
      setHorarios((data ?? []) as unknown as HorarioDisponible[])
      // La selección puede apuntar a horas de otro día: se descarta para no
      // bloquear algo que ya no está a la vista.
      setSeleccionBloqueo([])
      setPaginaBloques(1)
    }

    setCargandoBloques(false)
  }, [diaVisto, filtroProfesional])

  useEffect(() => {
    void loadBloques()
  }, [loadBloques])

  /**
   * Especialidades publicables para el profesional elegido. El catálogo
   * completo es una trampa: casi cualquier combinación con el profesional
   * elegido la rechaza el RPC con 'El profesional no tiene asignada esa
   * especialidad', y eso se descubre solo tras enviar el formulario. Se acota
   * a las que el profesional tiene de verdad, que es el mismo filtro que
   * aplica fn_generar_bloques_jornada.
   */
  const especialidadesPublicables: Especialidad[] = useMemo(() => {
    if (!profesional) return especialidades
    const propias = new Map<number, string>()
    for (const p of profesionales) {
      if (p.id_profesional === profesional && !propias.has(p.id_especialidad)) {
        propias.set(p.id_especialidad, p.especialidad)
      }
    }
    if (propias.size === 0) return especialidades
    return [...propias].map(([id_especialidad, nombre]) => ({ id_especialidad, nombre }))
  }, [profesional, profesionales, especialidades])

  async function publicarJornada(event: FormEvent<HTMLFormElement>) {
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
    if (!profesional) {
      setError('Selecciona el profesional cuya carga horaria vas a definir.')
      return
    }

    const idEspFinal = especialidad
      ? Number(especialidad)
      : especialidadesPublicables.length === 1
        ? especialidadesPublicables[0].id_especialidad
        : null

    if (!idEspFinal) {
      setError('Selecciona una especialidad.')
      return
    }

    setSaving(true)
    const { data, error } = await supabase.rpc('fn_generar_bloques_jornada', {
      p_id_profesional: profesional,
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
    await Promise.all([loadData(), loadBloques()])
  }

  async function eliminarJornada(g: { fecha: string; idEspecialidad: number; idProfesional: string }) {
    setError(null)
    setSuccess(null)

    const confirmado = window.confirm(
      '¿Deseas eliminar esta jornada? Se borrarán los bloques que no estén reservados y podrás publicarla de nuevo.',
    )
    if (!confirmado) return

    const { data, error } = await supabase.rpc('fn_eliminar_bloques_jornada', {
      p_fecha: g.fecha,
      p_id_especialidad: g.idEspecialidad,
      p_id_profesional: g.idProfesional,
    })

    if (error || !data?.ok) {
      setError(error?.message || data?.error || 'No se pudo eliminar la jornada.')
      return
    }

    const eliminados = (data.eliminados as number) ?? 0
    const omitidos = (data.omitidos as number) ?? 0
    const partes: string[] = []

    if (eliminados > 0) {
      partes.push(
        `Jornada eliminada: ${eliminados} bloque${eliminados === 1 ? '' : 's'} borrado${eliminados === 1 ? '' : 's'}.`,
      )
    } else {
      partes.push('No había bloques disponibles para eliminar en esta jornada.')
    }
    if (omitidos > 0) {
      partes.push(
        `Se conservaron ${omitidos} bloque${omitidos === 1 ? '' : 's'} con reservas o atenciones asociadas.`,
      )
    }

    setSuccess(partes.join(' '))
    await Promise.all([loadData(), loadBloques()])
  }

  async function cancelarCita(idCita: number) {
    setError(null)
    setSuccess(null)
    setSaving(true)

    const { error } = await supabase
      .from('citas')
      .update({ estado: 'cancelada' })
      .eq('id_cita', idCita)

    setSaving(false)
    if (error) {
      setError(error.message || 'No se pudo cancelar la cita.')
      return
    }
    setSuccess('Cita cancelada. El horario vuelve a estar disponible.')
    await Promise.all([loadData(), loadBloques()])
  }

  /**
   * Deshabilitar horas. Es el poder real de la jefatura: la ausencia sobrevenida
   * o planificada (vacaciones, libre administrativo, ausencia sin goce) se
   * resuelve cerrando horas, no una por una.
   *
   * El motivo no es un detalle: es lo que la jefatura le dirá al paciente por
   * teléfono, y queda escrito en el bloque como rastro. Por eso el RPC lo exige
   * y devuelve la lista de pacientes a los que hay que llamar.
   *
   * El motivo va como CATALOGO, no como texto libre. Eso no es purismo: el tipo
   * (planificado u sobrevenido) decide si el sistema rechaza el bloqueo cuando
   * dejaría el centro sin ningún profesional, y más adelante es lo que RRHH
   * necesita para licenses, libres y vacaciones.
   */
  async function bloquearHoras(ids: number[], idMotivo: number, detalle: string) {
    setError(null)
    setSuccess(null)
    setBloqueando(true)

    const { data, error } = await supabase.rpc('fn_bloquear_horarios', {
      p_ids: ids,
      p_id_motivo: idMotivo,
      p_detalle: detalle || null,
    })

    setBloqueando(false)
    if (error) {
      setError(error.message || 'No se pudieron deshabilitar las horas.')
      return
    }

    const res = data as {
      horas_bloqueadas: number
      citas_canceladas: number
      citas_afectadas: { id_cita: number; id_paciente: number; fecha: string }[]
      franjas_sin_cobertura?: string[]
    } | null

    const horas = res?.horas_bloqueadas ?? 0
    const canceladas = res?.citas_canceladas ?? 0
    const afectados = res?.citas_afectadas ?? []
    const sinCobertura = res?.franjas_sin_cobertura ?? []

    const partes: string[] = [
      `Se deshabilitaron ${horas} hora${horas === 1 ? '' : 's'}.`,
    ]
    if (canceladas > 0) {
      partes.push(
        `Se cancelaron ${canceladas} cita${canceladas === 1 ? '' : 's'} ya tomadas.`,
      )
    }

    // Aviso de cobertura: el bloqueo se aplico igual (era una ausencia
    // sobrevenida y no habia otra alternativa), pero la jefatura tiene que
    // saber que quedo una franja sin nadie. Si no se dice, el centro descubre
    // el hueco cuando llega el paciente.
    if (sinCobertura.length > 0) {
      setSuccess(partes.join(' '))
      setAvisoCobertura(sinCobertura)
      return
    }

    setSuccess(partes.join(' '))

    if (afectados.length > 0) {
      setAvisoLlamar(afectados)
    }

    await Promise.all([loadData(), loadBloques()])
  }

  /**
   * Reabrir horas bloqueadas. El caso real es el profesional que se retira
   * unas horas y vuelve. No revive citas: el paciente vuelve a tomar hora.
   */
  async function reactivarHoras(ids: number[]) {
    setError(null)
    setSuccess(null)
    setBloqueando(true)

    const { data, error } = await supabase.rpc('fn_reactivar_horarios', { p_ids: ids })

    setBloqueando(false)
    if (error) {
      setError(error.message || 'No se pudieron reactivar las horas.')
      return
    }

    const res = data as { reactivadas: number } | null
    const n = res?.reactivadas ?? 0
    setSuccess(
      `Se reactivaron ${n} hora${n === 1 ? '' : 's'}. Los pacientes con citas canceladas tienen que tomar hora de nuevo.`,
    )
    await Promise.all([loadData(), loadBloques()])
  }

  function alternarSeleccion(id: number) {
    setSeleccionBloqueo((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  function pedirBloqueo() {
    const objetivo = seleccionadosBloqueo()
    if (objetivo.length === 0) {
      setError('Selecciona al menos una hora para deshabilitar.')
      return
    }
    setModalBloqueo(objetivo)
  }

  function nombreEspecialidad(h: HorarioDisponible): string {
    const e = asSingle(h.especialidades)
    return e?.nombre ?? 'Sin especialidad'
  }

  /** Solo se pueden deshabilitar horas futuras que no estén completadas. */
  function puedeBloquear(h: HorarioDisponible): boolean {
    return new Date(h.fecha_fin) > new Date() && h.estado !== 'completada'
  }

  function puedeReactivar(h: HorarioDisponible): boolean {
    return h.estado === 'bloqueada'
  }

  /** Una jornada sin ninguna hora accionable: ya termino o solo tiene pasado. */
  function jornadaAgotada(g: GrupoJornada): boolean {
    return !g.bloques.some((b) => puedeBloquear(b) || puedeReactivar(b))
  }

  /** Los seleccionados que siguen siendo válidos para la acción elegida. */
  function seleccionadosBloqueo(): HorarioDisponible[] {
    return horarios.filter((h) => seleccionBloqueo.includes(h.id_horario) && puedeBloquear(h))
  }

  /** Horas de una jornada que se pueden seleccionar (futuras y no completadas). */
  function seleccionablesDe(g: GrupoJornada): HorarioDisponible[] {
    return g.bloques.filter((b) => puedeBloquear(b))
  }

  function alternarJornada(g: GrupoJornada) {
    const ids = seleccionablesDe(g).map((b) => b.id_horario)
    const todasSel = ids.length > 0 && ids.every((id) => seleccionBloqueo.includes(id))
    setSeleccionBloqueo((prev) =>
      todasSel ? prev.filter((id) => !ids.includes(id)) : [...new Set([...prev, ...ids])],
    )
  }

  // Agrupar los bloques por día + especialidad + profesional (jornada)
  type GrupoJornada = {
    fecha: string
    idEspecialidad: number
    especialidad: string
    idProfesional: string
    profesional: string
    bloques: HorarioDisponible[]
    rangoHorario: string
  }
  const horariosFiltrados = horarios.filter((h) => {
    if (!busquedaBloques.trim()) return true
    const q = busquedaBloques.trim().toLowerCase()
    return (
      formatFechaHora(h.fecha_inicio).toLowerCase().includes(q) ||
      nombreEspecialidad(h).toLowerCase().includes(q) ||
      h.estado.toLowerCase().includes(q)
    )
  })
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
          profesional: u ? `${u.nombres ?? ''} ${u.apellidos ?? ''}`.trim() : 'Profesional',
          bloques: [],
          rangoHorario: '',
        }
        mapa.set(k, g)
      }
      g.bloques.push(h)
    }
    for (const g of mapa.values()) {
      const horas = g.bloques.map((b) => b.fecha_inicio).sort()
      g.rangoHorario = `${formatHoraMin(horas[0])} – ${formatHoraMin(horas[horas.length - 1])}`
    }
    // Orden: primero las jornadas que todavia se pueden actuar (tienen horas
    // futuras), despues las que ya se agotaron. Ordenar solo por fecha dejaba
    // arriba las jornadas de ayer y hoy, donde no hay nada seleccionable: se
    // veía una lista verde sin ninguna accion posible.
    return Array.from(mapa.values())
      .sort((a, b) => {
        const pasA = jornadaAgotada(a)
        const pasB = jornadaAgotada(b)
        if (pasA !== pasB) return pasA ? 1 : -1
        return a.fecha === b.fecha
          ? a.rangoHorario.localeCompare(b.rangoHorario)
          : a.fecha.localeCompare(b.fecha)
      })
  })()

  const totalPaginasBloques = Math.max(1, Math.ceil(gruposJornada.length / POR_PAGINA))
  const paginaSeguraBloques = Math.min(paginaBloques, totalPaginasBloques)
  const gruposPagina = gruposJornada.slice(
    (paginaSeguraBloques - 1) * POR_PAGINA,
    paginaSeguraBloques * POR_PAGINA,
  )

  function estadoJornada(g: GrupoJornada): { label: string; cls: string } {
    const disponibles = g.bloques.filter((b) => b.estado === 'disponible').length
    const bloqueadas = g.bloques.filter((b) => b.estado === 'bloqueada').length
    // Una jornada deshabilitada por la jefatura no es "Completa": es una
    // decisión, y tiene que verse como tal.
    if (bloqueadas > 0 && bloqueadas === g.bloques.length) {
      return { label: 'Deshabilitada', cls: 'jornada-bloqueada' }
    }
    if (disponibles === g.bloques.length) return { label: 'Disponible', cls: 'jornada-ok' }
    if (disponibles === 0) return { label: 'Completa', cls: 'jornada-agotada' }
    if (bloqueadas > 0) return { label: 'Parcial', cls: 'jornada-parcial' }
    return { label: 'Parcial', cls: 'jornada-parcial' }
  }

  // Citas del área, filtradas
  const citasFiltradas = citasArea.filter((c) => {
    if (!busquedaCitas.trim()) return true
    const q = busquedaCitas.trim().toLowerCase()
    return (
      c.paciente_nombre.toLowerCase().includes(q) ||
      c.profesional.toLowerCase().includes(q) ||
      c.especialidad.toLowerCase().includes(q) ||
      c.estado.toLowerCase().includes(q)
    )
  })
  const totalPaginasCitas = Math.max(1, Math.ceil(citasFiltradas.length / POR_PAGINA))
  const paginaSeguraCitas = Math.min(paginaCitas, totalPaginasCitas)
  const citasPagina = citasFiltradas.slice(
    (paginaSeguraCitas - 1) * POR_PAGINA,
    paginaSeguraCitas * POR_PAGINA,
  )

  return (
    <div className="dash">
      <Sidebar moduloActivo="jornadas" />

      <div className="dash-main">
        <header className="dash-topbar">
          <div>
            <h2>Jornadas</h2>
            <p>
              {soyAdministrador
                ? 'Coordina la carga horaria de todos los colaboradores y todas las áreas'
                : soyJefatura
                  ? 'Coordina la carga horaria de los profesionales de tu servicio'
                  : 'Coordinación de carga horaria'}
            </p>
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

          <div className="agenda-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'bloques'}
              className={`agenda-tab${tab === 'bloques' ? ' is-active' : ''}`}
              onClick={() => setTab('bloques')}
            >
              Jornadas y bloques
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'citas'}
              className={`agenda-tab${tab === 'citas' ? ' is-active' : ''}`}
              onClick={() => setTab('citas')}
            >
              Citas del área ({citasArea.length})
            </button>
          </div>

          {tab === 'bloques' ? (
            <>
              <div className="dash-card">
                <div className="dash-card-header">
                  <div>
                    <h3>Publicar jornada</h3>
                    <p className="dash-muted">
                      Define la jornada de atención de un profesional y se divide en bloques
                      de 15 minutos. Incluye tus propios bloques: si también atiendes, tu
                      carga se publica y se bloquea desde acá.
                    </p>
                  </div>
                </div>

                <form className="dash-form" onSubmit={(e) => void publicarJornada(e)}>
                  {profesionales.length > 1 ? (
                    <div className="dash-field">
                      <label htmlFor="jor-profesional">Profesional</label>
                      <select
                        id="jor-profesional"
                        value={profesional}
                        onChange={(e) => {
                          const elegido = e.target.value
                          setProfesional(elegido)
                          const propias = profesionales.filter(
                            (p) => p.id_profesional === elegido,
                          )
                          setEspecialidad(
                            propias.length === 1 ? String(propias[0].id_especialidad) : '',
                          )
                        }}
                        required
                        disabled={saving}
                      >
                        <option value="">Selecciona un profesional</option>
                        {profesionales.map((p) => (
                          <option
                            key={`${p.id_profesional}-${p.id_especialidad}`}
                            value={p.id_profesional}
                          >
                            {p.nombre} — {p.especialidad}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : profesionales.length === 1 ? (
                    <p className="dash-field-hint" style={{ margin: '0 0 0.6rem' }}>
                      Profesional: <strong>{profesionales[0].nombre}</strong>
                      {profesionales[0].especialidad
                        ? ` (${profesionales[0].especialidad})`
                        : null}
                    </p>
                  ) : (
                    <p className="dash-field-hint" style={{ margin: '0 0 0.6rem' }}>
                      No tienes profesionales a cargo para publicar una jornada.
                    </p>
                  )}

                  {especialidadesPublicables.length > 1 ? (
                    <div className="dash-field">
                      <label htmlFor="jor-especialidad">Especialidad</label>
                      <select
                        id="jor-especialidad"
                        value={especialidad}
                        onChange={(e) => setEspecialidad(e.target.value)}
                      >
                        <option value="">Selecciona una especialidad</option>
                        {especialidadesPublicables.map((e) => (
                          <option key={e.id_especialidad} value={String(e.id_especialidad)}>
                            {e.nombre}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : especialidadesPublicables.length === 1 ? (
                    <p className="dash-field-hint" style={{ margin: '0 0 0.6rem' }}>
                      Especialidad: <strong>{especialidadesPublicables[0].nombre}</strong>
                    </p>
                  ) : null}

                  <div className="dash-row">
                    <div className="dash-field">
                      <label htmlFor="jor-inicio">Desde</label>
                      <input
                        id="jor-inicio"
                        type="date"
                        value={fechaInicio}
                        onChange={(e) => setFechaInicio(e.target.value)}
                        required
                        disabled={saving}
                      />
                    </div>
                    <div className="dash-field">
                      <label htmlFor="jor-fin">Hasta</label>
                      <input
                        id="jor-fin"
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
                      <label htmlFor="jor-hora-ini">Hora de inicio</label>
                      <input
                        id="jor-hora-ini"
                        type="time"
                        value={horaInicio}
                        onChange={(e) => setHoraInicio(e.target.value)}
                        required
                        disabled={saving}
                      />
                    </div>
                    <div className="dash-field">
                      <label htmlFor="jor-hora-fin">Hora de fin</label>
                      <input
                        id="jor-hora-fin"
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
                    <button type="submit" className="dash-btn-primary" disabled={saving}>
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
                         Disponibilidad agrupada por jornada (día). Para deshabilitar horas{' '}
                         <strong>marca las horas</strong> o usa{' '}
                         <strong>«Toda la jornada»</strong>: te pedirá el motivo y avisará a los
                         pacientes con cita.
                       </p>
                  </div>
                  <span className="dash-badge">{gruposJornada.length} jornadas</span>
                </div>

                {loading || cargandoBloques ? (
                  <p className="dash-loading">Cargando bloques…</p>
                ) : (
                  <>
                    <div className="jornadas-nav">
                      <div className="jornadas-nav-dia">
                        <button
                          type="button"
                          className="dash-btn-secondary"
                          aria-label="Día anterior"
                          onClick={() => setDiaVisto(desplazarDia(diaVisto, -1))}
                        >
                          ‹
                        </button>
                        <label htmlFor="jornadas-dia" className="dash-muted">
                          Día
                        </label>
                        <input
                          id="jornadas-dia"
                          type="date"
                          value={diaVisto}
                          onChange={(e) => {
                            if (e.target.value) setDiaVisto(e.target.value)
                          }}
                        />
                        <button
                          type="button"
                          className="dash-btn-secondary"
                          aria-label="Día siguiente"
                          onClick={() => setDiaVisto(desplazarDia(diaVisto, 1))}
                        >
                          ›
                        </button>
                        {diaVisto !== claveHoy() ? (
                          <button
                            type="button"
                            className="dash-btn-secondary"
                            onClick={() => setDiaVisto(claveHoy())}
                          >
                            Hoy
                          </button>
                        ) : null}
                      </div>
                      <div className="jornadas-nav-prof">
                        <label htmlFor="jornadas-prof" className="dash-muted">
                          Profesional
                        </label>
                        <select
                          id="jornadas-prof"
                          value={filtroProfesional}
                          onChange={(e) => setFiltroProfesional(e.target.value)}
                        >
                          <option value="">Todos los del área</option>
                          {(() => {
                            const vistos = new Map<string, string>()
                            for (const p of profesionales) {
                              vistos.set(p.id_profesional, p.nombre || 'Profesional')
                            }
                            return Array.from(vistos.entries())
                              .sort((a, b) => a[1].localeCompare(b[1]))
                              .map(([id, nombre]) => (
                                <option key={id} value={id}>
                                  {nombre}
                                </option>
                              ))
                          })()}
                        </select>
                      </div>
                      <input
                        className="dash-filter-input"
                        type="search"
                        placeholder="Buscar por especialidad o estado…"
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
                    {errorBloques ? (
                      <p className="dash-error">{errorBloques}</p>
                    ) : null}
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
                            <div
                              key={`${g.fecha}-${g.idEspecialidad}-${g.idProfesional}-${g.rangoHorario}`}
                              className="jornada"
                            >
                              <div className="jornada-header">
                                <div>
                                  <strong>
                                    {new Date(`${g.fecha}T00:00:00Z`).toLocaleDateString(
                                      'es-CL',
                                      {
                                        weekday: 'long',
                                        day: 'numeric',
                                        month: 'long',
                                        year: 'numeric',
                                        timeZone: 'UTC',
                                      },
                                    )}
                                  </strong>
                                  <span className="jornada-horario">{g.rangoHorario}</span>
                                  <span className="jornada-meta">
                                    {g.especialidad} · {g.profesional}
                                  </span>
                                </div>
                                <div className="jornada-header-derecha">
                                  {jornadaAgotada(g) ? (
                                    <span className="jornada-agotada">Sin horas accionables</span>
                                  ) : null}
                                  <label className="jornada-todas">
                                    <input
                                      type="checkbox"
                                      checked={
                                        seleccionablesDe(g).length > 0 &&
                                        seleccionablesDe(g).every((b) =>
                                          seleccionBloqueo.includes(b.id_horario),
                                        )
                                      }
                                      onChange={() => alternarJornada(g)}
                                      disabled={bloqueando || seleccionablesDe(g).length === 0}
                                    />
                                    Toda la jornada
                                  </label>
                                  <span className={`jornada-estado ${est.cls}`}>{est.label}</span>
                                </div>
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
                                <span className="jornada-count">{g.bloques.length} en total</span>
                              </div>
                              <div className="jornada-horas">
                                {horas.map((h) => {
                                  const seleccionable = puedeBloquear(h) || puedeReactivar(h)
                                  // Una hora verde significa "reservable ahora".
                                  // Una hora que ya paso no lo esta, aunque siga
                                  // en estado 'disponible' en la base, asi que
                                  // no puede verse igual que una futura.
                                  const vencida = new Date(h.fecha_fin) <= new Date()
                                  const clases = `jornada-hora${vencida ? ' is-vencida' : h.estado === 'disponible' ? ' is-disponible' : h.estado === 'reservada' ? ' is-reservada' : ' is-no'}${
                                    seleccionBloqueo.includes(h.id_horario) ? ' is-selected' : ''
                                  }${h.estado === 'bloqueada' ? ' is-bloqueada' : ''}`
                                  const titulo = vencida
                                    ? `${ESTADO_LABEL[h.estado] ?? h.estado} (ya pasó)`
                                    : h.estado === 'bloqueada' && h.motivo_bloqueo
                                      ? `Deshabilitada: ${h.motivo_bloqueo}`
                                      : ESTADO_LABEL[h.estado] ?? h.estado

                                  // El label es lo que hace clicable toda la hora,
                                  // no solo el checkbox: pedirle al usuario que
                                  // encuentre un checkbox de 10px para
                                  // deshabilitar un bloque entero era pedirle
                                  // que adivinara.
                                  if (!seleccionable) {
                                    return (
                                      <span key={h.id_horario} className={clases} title={titulo}>
                                        {formatHoraMin(h.fecha_inicio)}
                                      </span>
                                    )
                                  }
                                  return (
                                    <label key={h.id_horario} className={clases} title={titulo}>
                                      <input
                                        type="checkbox"
                                        className="jornada-hora-check"
                                        checked={seleccionBloqueo.includes(h.id_horario)}
                                        onChange={() => alternarSeleccion(h.id_horario)}
                                        disabled={bloqueando}
                                        aria-label={`Seleccionar hora de ${formatHoraMin(h.fecha_inicio)}`}
                                      />
                                      {formatHoraMin(h.fecha_inicio)}
                                    </label>
                                  )
                                })}
                              </div>
                              <div className="jornada-acciones">
                                {seleccionablesDe(g).length > 0 ? (
                                  <button
                                    type="button"
                                    className="dash-btn-secondary jornada-bloquear-jornada"
                                    onClick={() => {
                                      const ids = seleccionablesDe(g).map((b) => b.id_horario)
                                      setSeleccionBloqueo(ids)
                                      setModalBloqueo(seleccionablesDe(g))
                                    }}
                                    disabled={bloqueando}
                                  >
                                    Deshabilitar jornada ({seleccionablesDe(g).length})
                                  </button>
                                ) : null}
                                {seleccionadosBloqueo().length > 0 ? (
                                  <button
                                    type="button"
                                    className="dash-btn-primary jornada-bloquear"
                                    onClick={pedirBloqueo}
                                    disabled={bloqueando}
                                  >
                                    Deshabilitar {seleccionadosBloqueo().length} hora
                                    {seleccionadosBloqueo().length === 1 ? '' : 's'}
                                  </button>
                                ) : null}
                                {seleccionadosBloqueo().length > 0 &&
                                seleccionadosBloqueo().every((b) => b.estado === 'bloqueada') ? (
                                  <button
                                    type="button"
                                    className="dash-btn-secondary jornada-reactivar"
                                    onClick={() =>
                                      void reactivarHoras(
                                        seleccionadosBloqueo().map((b) => b.id_horario),
                                      )
                                    }
                                    disabled={bloqueando}
                                  >
                                    Reactivar
                                  </button>
                                ) : null}
                                {disponibles > 0 ? (
                                  <button
                                    type="button"
                                    className="dash-btn-secondary jornada-cancelar"
                                    onClick={() =>
                                      void eliminarJornada({
                                        fecha: g.fecha,
                                        idEspecialidad: g.idEspecialidad,
                                        idProfesional: g.idProfesional,
                                      })
                                    }
                                  >
                                    Eliminar jornada
                                  </button>
                                ) : null}
                              </div>
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
            </>
          ) : (
            <div className="dash-card">
              <div className="dash-card-header">
                <div>
                  <h3>Citas del área</h3>
                  <p className="dash-muted">
                    {soyAdministrador
                      ? 'Atenciones de todos los colaboradores del recinto, incluidas las tuyas como profesional.'
                      : 'Atenciones de los profesionales de tu servicio, incluidas las tuyas: como jefatura también atiendes.'}
                  </p>
                </div>
                <span className="dash-badge">{citasArea.length} citas</span>
              </div>

              {loading ? (
                <p className="dash-loading">Cargando citas…</p>
              ) : (
                <>
                  <div className="dash-filter-bar">
                    <input
                      className="dash-filter-input"
                      type="search"
                      placeholder="Buscar por paciente, profesional o especialidad…"
                      value={busquedaCitas}
                      onChange={(e) => {
                        setBusquedaCitas(e.target.value)
                        setPaginaCitas(1)
                      }}
                    />
                    <span className="dash-muted">
                      {citasFiltradas.length} cita{citasFiltradas.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  {citasFiltradas.length === 0 ? (
                    <p className="dash-empty">No hay citas que coincidan.</p>
                  ) : (
                    <div className="dash-table-wrap">
                      <table className="dash-table">
                        <thead>
                          <tr>
                            <th>Fecha y hora</th>
                            <th>Paciente</th>
                            <th>Profesional</th>
                            <th>Especialidad</th>
                            <th>Motivo</th>
                            <th>Estado</th>
                            <th>Acción</th>
                          </tr>
                        </thead>
                        <tbody>
                          {citasPagina.map((c) => (
                            <tr key={c.id_cita}>
                              <td>{formatFechaHora(c.fecha_inicio)}</td>
                              <td>
                                {c.paciente_nombre}
                                {c.rut ? (
                                  <div className="jornada-meta">{c.rut}</div>
                                ) : null}
                              </td>
                              <td>{c.profesional}</td>
                              <td>{c.especialidad}</td>
                              <td>{c.motivo ?? '—'}</td>
                              <td>
                                <span className="dash-badge">
                                  {ESTADO_LABEL[c.estado] ?? c.estado}
                                </span>
                              </td>
                              <td>
                                {c.estado === 'reservada' ? (
                                  <button
                                    type="button"
                                    className="dash-btn-danger"
                                    disabled={saving}
                                    onClick={() => void cancelarCita(c.id_cita)}
                                  >
                                    Cancelar
                                  </button>
                                ) : (
                                  <span className="dash-muted">—</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {totalPaginasCitas > 1 ? (
                        <div className="dash-pagination">
                          <button
                            type="button"
                            className="dash-btn-secondary"
                            disabled={paginaSeguraCitas <= 1}
                            onClick={() => setPaginaCitas(paginaSeguraCitas - 1)}
                          >
                            Anterior
                          </button>
                          <span className="dash-muted">
                            Página {paginaSeguraCitas} de {totalPaginasCitas}
                          </span>
                          <button
                            type="button"
                            className="dash-btn-secondary"
                            disabled={paginaSeguraCitas >= totalPaginasCitas}
                            onClick={() => setPaginaCitas(paginaSeguraCitas + 1)}
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
          )}
        </section>

        {modalBloqueo ? (
          <div className="modal-overlay" role="dialog" aria-modal="true">
            <div className="modal">
              <h3>Deshabilitar {modalBloqueo.length} hora{modalBloqueo.length === 1 ? '' : 's'}</h3>
              <p className="dash-muted">
                Se cerrarán{' '}
                {modalBloqueo.length === 1
                  ? 'la hora seleccionada'
                  : `las ${modalBloqueo.length} horas seleccionadas`}
                . Las citas que ya estaban tomadas se cancelan y el motivo queda
                escrito en el bloque.
              </p>
              <ul className="modal-lista">
                {modalBloqueo.map((h) => (
                  <li key={h.id_horario}>
                    {formatFechaHora(h.fecha_inicio)} · {nombreEspecialidad(h)}
                    {h.estado === 'reservada' ? ' · tiene una cita tomada' : ''}
                  </li>
                ))}
              </ul>
              <div className="dash-field">
                <label htmlFor="motivo-bloqueo">Motivo</label>
                <select
                  id="motivo-bloqueo"
                  value={idMotivoBloqueo}
                  onChange={(e) => setIdMotivoBloqueo(Number(e.target.value))}
                  disabled={bloqueando}
                  autoFocus
                >
                  <option value={0}>Selecciona un motivo…</option>
                  <optgroup label="Se sabía de antemano">
                    {motivosBloqueo
                      .filter((m) => m.tipo === 'planificado')
                      .map((m) => (
                        <option key={m.id_motivo} value={m.id_motivo}>
                          {m.nombre}
                        </option>
                      ))}
                  </optgroup>
                  <optgroup label="Ocurrió sin aviso">
                    {motivosBloqueo
                      .filter((m) => m.tipo === 'sobrevenido')
                      .map((m) => (
                        <option key={m.id_motivo} value={m.id_motivo}>
                          {m.nombre}
                        </option>
                      ))}
                  </optgroup>
                </select>
                <p className="dash-field-hint">
                  {motivoElegido?.tipo === 'planificado' ? (
                    <>
                      Al ser <strong>planificado</strong>, el sistema no te va a
                      dejar dejar el centro sin ningún profesional en una franja.
                      Si es una ausencia que se produjo hoy, elige la segunda
                      sección.
                    </>
                  ) : (
                    <>
                      Es lo que la jefatura le dirá al paciente por teléfono, y
                      queda como registro. Si es una ausencia sobrevenida, el
                      bloqueo se aplica aunque quede una franja sin cobertura, y
                      te avisamos cuál.
                    </>
                  )}
                </p>
              </div>
              {motivoElegido?.requiere_detalle ? (
                <div className="dash-field">
                  <label htmlFor="detalle-bloqueo">Detalle (obligatorio)</label>
                  <textarea
                    id="detalle-bloqueo"
                    rows={2}
                    value={detalleBloqueo}
                    onChange={(e) => setDetalleBloqueo(e.target.value)}
                    placeholder="Por ejemplo: licencia médica desde el 2026-10-02"
                  />
                </div>
              ) : null}
              <div className="dash-form-actions">
                <button
                  type="button"
                  className="dash-btn-primary"
                  disabled={
                    bloqueando ||
                    idMotivoBloqueo === 0 ||
                    (motivoElegido?.requiere_detalle && detalleBloqueo.trim() === '')
                  }
                  onClick={() => {
                    const ids = modalBloqueo.map((h) => h.id_horario)
                    setModalBloqueo(null)
                    setIdMotivoBloqueo(0)
                    setDetalleBloqueo('')
                    setSeleccionBloqueo([])
                    void bloquearHoras(ids, idMotivoBloqueo, detalleBloqueo.trim())
                  }}
                >
                  {bloqueando ? 'Deshabilitando…' : 'Deshabilitar'}
                </button>
                <button
                  type="button"
                  className="dash-btn-secondary"
                  disabled={bloqueando}
                  onClick={() => {
                    setModalBloqueo(null)
                    setIdMotivoBloqueo(0)
                    setDetalleBloqueo('')
                  }}
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {avisoLlamar ? (
          <div className="modal-overlay" role="dialog" aria-modal="true">
            <div className="modal">
              <h3>Pacientes por avisar</h3>
              <p className="dash-muted">
                Estas citas se cancelaron al deshabilitar las horas. El sistema
                no manda correo (el plan es gratuito y no hay Envío de correos),
                así que <strong>recepción debe llamar</strong> para avisar.
              </p>
              <ul className="modal-lista">
                {avisoLlamar.map((a) => (
                  <li key={a.id_cita}>
                    {formatFechaHora(a.fecha)} · paciente N.º {a.id_paciente}
                  </li>
                ))}
              </ul>
              <div className="dash-form-actions">
                <button
                  type="button"
                  className="dash-btn-primary"
                  onClick={() => setAvisoLlamar(null)}
                >
                  Entendido
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {avisoCobertura ? (
          <div className="modal-overlay" role="dialog" aria-modal="true">
            <div className="modal">
              <h3>Quedó una franja sin ningún profesional</h3>
              <p>
                Las horas quedaron deshabilitadas igual, porque una ausencia
                sobrevenida no se puede deshacer. Pero{' '}
                <strong>no queda ningún profesional con horario</strong> en:
              </p>
              <ul className="modal-lista">
                {avisoCobertura.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <p className="dash-muted">
                Si el centro puede, conviene reconfigurar esos horarios antes de
                que llegue el paciente. Un motivo <strong>planificado</strong>{' '}
                nunca deja pasar esta situación: el sistema lo rechaza.
              </p>
              <div className="dash-form-actions">
                <button
                  type="button"
                  className="dash-btn-primary"
                  onClick={() => {
                    setAvisoCobertura(null)
                    void loadData()
                  }}
                >
                  Entendido
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default Jornadas
