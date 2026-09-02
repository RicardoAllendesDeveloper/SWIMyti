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
  loading: boolean
  refreshRol: () => Promise<void>
}

const AuthRolContext = createContext<AuthRolContextValue>({
  session: null,
  rol: null,
  email: null,
  loading: true,
  refreshRol: async () => {},
})

export function AuthRolProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [rol, setRol] = useState<RolUsuario>(null)
  const [email, setEmail] = useState<string | null>(null)
  const [loading, setLoading] = useState(!supabaseConfigError)

  const refreshRol = useCallback(async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      setRol(null)
      setEmail(null)
      return
    }

    setEmail(user.email ?? user.id)

    const { data, error } = await supabase
      .from('usuarios')
      .select('id_rol, roles(nombre_rol)')
      .eq('id_usuario', user.id)
      .maybeSingle()

    if (error || !data) {
      // Auto-crear perfil si el usuario se registró con confirmación de email
      // y su perfil aún no existe en public.usuarios (caso típico: primer login
      // o retorno desde el correo de confirmación).
      try {
        const meta = user.user_metadata ?? {}
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
          .select('id_rol, roles(nombre_rol)')
          .eq('id_usuario', user.id)
          .maybeSingle()
        if (retry) {
          const rel = retry.roles as
            | { nombre_rol: string }
            | { nombre_rol: string }[]
            | null
          const rn = Array.isArray(rel) ? rel[0]?.nombre_rol : rel?.nombre_rol
          setRol((rn as RolUsuario) ?? null)
          return
        }
      } catch {
        // Si el auto-registro falla, continuar sin perfil
      }
      setRol(null)
      return
    }

    const related = data.roles as
      | { nombre_rol: string }
      | { nombre_rol: string }[]
      | null
    const rolNombre = Array.isArray(related)
      ? related[0]?.nombre_rol
      : related?.nombre_rol
    setRol((rolNombre as RolUsuario) ?? null)
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
      value={{ session, rol, email, loading, refreshRol }}
    >
      {children}
    </AuthRolContext.Provider>
  )
}

export function useAuthRol() {
  return useContext(AuthRolContext)
}