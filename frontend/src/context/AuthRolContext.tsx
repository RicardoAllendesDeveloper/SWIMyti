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

export type RolUsuario =
  | 'administrador'
  | 'doctor'
  | 'enfermeria'
  | 'administrativo'
  | 'unidad_apoyo'
  | 'paciente'
  | null

type AuthRolContextValue = {
  session: Session | null
  rol: RolUsuario
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
      setEmail(null)
      setNombres(null)
      setApellidos(null)
      setEspecialidad(null)
      return
    }

    setEmail(user.email ?? user.id)

    const { data, error } = await supabase
      .from('usuarios')
      .select(
        'id_rol, nombres, apellidos, roles(nombre_rol), doctores_especialidades(especialidades(nombre))',
      )
      .eq('id_usuario', user.id)
      .maybeSingle()

    const aplicarDatos = (perfil: {
      nombres?: string
      apellidos?: string
      roles?: { nombre_rol: string } | { nombre_rol: string }[] | null
      doctores_especialidades?: {
        especialidades?: { nombre?: string } | { nombre?: string }[] | null
      }[] | null
    }) => {
      setNombres((perfil.nombres as string) ?? null)
      setApellidos((perfil.apellidos as string) ?? null)
      const rel = perfil.roles as
        | { nombre_rol: string }
        | { nombre_rol: string }[]
        | null
      const rolNombre = Array.isArray(rel) ? rel[0]?.nombre_rol : rel?.nombre_rol
      setRol((rolNombre as RolUsuario) ?? null)

      // Especialidad principal del profesional (primera con es_principal o la primera)
      const espRows = perfil.doctores_especialidades ?? []
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

    if (error || !data) {
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
        })
        // Re-intentar obtener el rol tras crear el perfil
        const { data: retry } = await supabase
          .from('usuarios')
          .select(
            'id_rol, nombres, apellidos, roles(nombre_rol), doctores_especialidades(especialidades(nombre))',
          )
          .eq('id_usuario', user.id)
          .maybeSingle()
        if (retry) {
          aplicarDatos(retry)
          return
        }
      } catch {
        // Si el auto-registro falla, continuar sin perfil
      }
      setRol(null)
      return
    }

    aplicarDatos(data)
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