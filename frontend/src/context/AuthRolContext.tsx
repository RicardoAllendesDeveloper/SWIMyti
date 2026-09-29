import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, supabaseConfigError } from '../services/supabase'
import { agregarRoles, rolPrincipal, type FilaRol } from '../utils/permisos'

export type RolUsuario =
  | 'administrador'
  | 'doctor'
  | 'enfermeria'
  | 'administrativo'
  | 'unidad_apoyo'
  | 'jefatura'
  | 'paciente'
  | null

/** Roles sin el valor nulo, para comprobaciones de pertenencia. */
export type RolConocido = Exclude<RolUsuario, null>

type AuthRolContextValue = {
  session: Session | null
  /** Rol principal del usuario. Es el que se muestra y el que decide el home. */
  rol: RolUsuario
  /**
   * Todos los roles acumulados del usuario. Un profesional ascendido a jefatura
   * conserva su rol clínico y suma el de coordinación, sin cambiar de cuenta.
   */
  roles: RolConocido[]
  email: string | null
  nombres: string | null
  apellidos: string | null
  especialidad: string | null
  loading: boolean
  refreshRol: () => Promise<void>
}

const AuthRolContext = createContext<AuthRolContextValue>({
  session: null,
  rol: null,
  roles: [],
  email: null,
  nombres: null,
  apellidos: null,
  especialidad: null,
  loading: true,
  refreshRol: async () => {},
})

export function AuthRolProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [rol, setRol] = useState<RolUsuario>(null)
  const [roles, setRoles] = useState<RolConocido[]>([])
  const [email, setEmail] = useState<string | null>(null)
  const [nombres, setNombres] = useState<string | null>(null)
  const [apellidos, setApellidos] = useState<string | null>(null)
  const [especialidad, setEspecialidad] = useState<string | null>(null)
  const [loading, setLoading] = useState(!supabaseConfigError)

  const refreshRol = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      setRol(null)
      setRoles([])
      setEmail(null)
      setNombres(null)
      setApellidos(null)
      setEspecialidad(null)
      return
    }

    setEmail(user.email ?? user.id)

    // Los roles vienen de usuario_roles (N roles). El principal se marca con
    // es_principal para mantener la navegación y el rótulo igual que antes.
    const { data, error } = await supabase
      .from('usuario_roles')
      .select(
        'es_principal, vigente_hasta, roles(nombre_rol), usuarios(nombres, apellidos, doctores_especialidades(especialidades(nombre)))',
      )
      .eq('id_usuario', user.id)
      .is('vigente_hasta', null)

    // Fila de usuario_roles + el usuario y su especialidad principal. Cada
    // fila es un rol; la agregación vive en utils/permisos para poder testearla.
    type FilaPerfil = FilaRol & {
      usuarios?:
        | {
            nombres?: string
            apellidos?: string
            doctores_especialidades?: {
              especialidades?: { nombre?: string } | { nombre?: string }[] | null
            }[] | null
          }
        | {
            nombres?: string
            apellidos?: string
            doctores_especialidades?: {
              especialidades?: { nombre?: string } | { nombre?: string }[] | null
            }[] | null
          }[]
        | null
    }

    function aplicarDatos(filas: FilaPerfil[]) {
      // Los datos del usuario vienen repetidos en cada fila; se toma el
      // primero que los traiga, porque alguna fila puede venir sin relación.
      const conPerfil = filas.find((f) => f.usuarios)
      const u = conPerfil?.usuarios
      const usuario = Array.isArray(u) ? u[0] : u
      setNombres((usuario?.nombres as string) ?? null)
      setApellidos((usuario?.apellidos as string) ?? null)

      // Un usuario tiene N filas (una por rol). Se acumulan todas: tomar solo
      // la primera ocultaba módulos del sidebar.
      const nombresRol = agregarRoles(filas)
      setRoles(nombresRol)
      setRol(rolPrincipal(filas))

      // Especialidad principal del profesional
      const espRows = usuario?.doctores_especialidades ?? []
      let espNombre: string | null = null
      if (espRows.length > 0) {
        const primera = espRows[0] as {
          especialidades?: { nombre?: string } | { nombre?: string }[] | null
        }
        const e = Array.isArray(primera.especialidades)
          ? primera.especialidades[0]?.nombre
          : primera.especialidades?.nombre
        espNombre = (e as string) ?? null
      }
      setEspecialidad(espNombre)
    }

    const filas = Array.isArray(data) ? (data as unknown as FilaPerfil[]) : []
    const perfil = filas.find((f) => f.usuarios)

    if (error || !perfil) {
      // Auto-crear perfil si el usuario se registró con confirmación de email
      // y su perfil aún no existe en public.usuarios (caso típico: primer login
      // o retorno desde el correo de confirmación).
      try {
        const meta = user.user_metadata ?? {}
        // Refrescar sesión para obtener JWT con timestamp del servidor
        await supabase.auth.getSession()
        await supabase.rpc('fn_auto_registro_paciente', {
          p_rut: (meta.rut as string) || '',
          p_nombres: (meta.nombres as string) || 'Paciente',
          p_apellidos: (meta.apellidos as string) || 'Registrado',
          p_telefono: (meta.telefono as string) || null,
          p_email: user.email ?? '',
          p_direccion: (meta.direccion as string) || null,
          p_fecha_nacimiento: (meta.fecha_nacimiento as string) || null,
          p_sexo: (meta.sexo as string) || null,
          p_prevision: (meta.prevision as string) || null,
        })
        // Re-intentar obtener los roles tras crear el perfil
        const { data: retry } = await supabase
          .from('usuario_roles')
          .select(
            'es_principal, vigente_hasta, roles(nombre_rol), usuarios(nombres, apellidos, doctores_especialidades(especialidades(nombre)))',
          )
          .eq('id_usuario', user.id)
          .is('vigente_hasta', null)
        if (retry && retry.length > 0) {
          aplicarDatos(retry as unknown as FilaPerfil[])
          return
        }
      } catch {
        // Si el auto-registro falla, continuar sin perfil
      }
      setRol(null)
      setRoles([])
      return
    }

    aplicarDatos(filas)
  }, [])

  useEffect(() => {
    if (supabaseConfigError) {
      setLoading(false)
      return
    }

    let active = true

    const timeoutId = window.setTimeout(() => {
      if (!active) return
      setLoading(false)
    }, 4000)

    supabase.auth
      .getSession()
      .then(async ({ data }) => {
        if (!active) return
        setSession(data.session)
        if (data.session) {
          await refreshRol()
        }
      })
      .catch(() => {
        if (!active) return
        setSession(null)
      })
      .finally(() => {
        if (!active) return
        window.clearTimeout(timeoutId)
        setLoading(false)
      })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      if (nextSession) {
        void refreshRol()
      } else {
        setRol(null)
        setEmail(null)
        setNombres(null)
        setApellidos(null)
        setEspecialidad(null)
      }
      setLoading(false)
    })

    return () => {
      active = false
      window.clearTimeout(timeoutId)
      subscription.unsubscribe()
    }
  }, [refreshRol])

  return (
    <AuthRolContext.Provider
      value={{
        session,
        rol,
        roles,
        email,
        nombres,
        apellidos,
        especialidad,
        loading,
        refreshRol,
      }}
    >
      {children}
    </AuthRolContext.Provider>
  )
}

export function useAuthRol() {
  return useContext(AuthRolContext)
}