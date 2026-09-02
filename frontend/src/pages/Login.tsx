import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { supabase, supabaseConfigError } from '../services/supabase'
import { useAuthRol, type RolUsuario } from '../context/AuthRolContext'
import { homeRol } from '../utils/permisos'
import '../styles/Login.css'

function mapAuthError(message: string): string {
  const normalized = message.toLowerCase()

  if (
    normalized.includes('invalid login credentials') ||
    normalized.includes('invalid_credentials') ||
    normalized.includes('email not confirmed')
  ) {
    return 'Credenciales incorrectas. Verifica tu email y contraseña.'
  }

  if (normalized.includes('too many requests') || normalized.includes('rate limit')) {
    return 'Demasiados intentos. Espera un momento e inténtalo de nuevo.'
  }

  if (
    normalized.includes('network') ||
    normalized.includes('fetch') ||
    normalized.includes('failed to fetch')
  ) {
    return 'No se pudo conectar con Supabase. Revisa VITE_SUPABASE_URL (debe ser https://TU_REF.supabase.co) y reinicia npm run dev.'
  }

  return message || 'No se pudo iniciar sesión. Inténtalo nuevamente.'
}

function Login() {
  const navigate = useNavigate()
  const { rol } = useAuthRol()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(supabaseConfigError)
  const [loading, setLoading] = useState(false)
  const [checkingSession, setCheckingSession] = useState(!supabaseConfigError)
  const [hasSession, setHasSession] = useState(false)

  useEffect(() => {
    if (supabaseConfigError) {
      setCheckingSession(false)
      return
    }

    let active = true

    const timeoutId = window.setTimeout(() => {
      if (!active) return
      setCheckingSession(false)
    }, 4000)

    supabase.auth
      .getSession()
      .then(({ data, error: sessionError }) => {
        if (!active) return
        if (sessionError) {
          setError(mapAuthError(sessionError.message))
          setHasSession(false)
        } else {
          setHasSession(Boolean(data.session))
        }
      })
      .catch(() => {
        if (!active) return
        setError('No se pudo verificar la sesión.')
        setHasSession(false)
      })
      .finally(() => {
        if (!active) return
        window.clearTimeout(timeoutId)
        setCheckingSession(false)
      })

    return () => {
      active = false
      window.clearTimeout(timeoutId)
    }
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(supabaseConfigError)
    if (supabaseConfigError) return

    if (!email.trim() || !password) {
      setError('Ingresa tu email y contraseña para continuar.')
      return
    }

    setLoading(true)

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })

      if (signInError) {
        setError(mapAuthError(signInError.message))
        return
      }

      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (user) {
        // Si el usuario no tiene perfil en public.usuarios (registro con
        // confirmación de email), completar el auto-registro en el primer login.
        const { data: perfil } = await supabase
          .from('usuarios')
          .select('id_usuario')
          .eq('id_usuario', user.id)
          .maybeSingle()

        if (!perfil) {
          const meta = user.user_metadata ?? {}
          // Refrescar sesión para obtener JWT con timestamp del servidor
          // (evita "JWT issued at future" por desfase de reloj)
          await supabase.auth.getSession()
          await supabase.rpc('fn_auto_registro_paciente', {
            p_rut: (meta.rut as string) || '',
            p_nombres: (meta.nombres as string) || 'Paciente',
            p_apellidos: (meta.apellidos as string) || 'Registrado',
            p_telefono: (meta.telefono as string) || null,
            p_email: user.email ?? '',
          })
        }
      }

      // Esperar breve a que el contexto resuelva el rol para redirigir al portal natural
      const { data } = await supabase
        .from('usuarios')
        .select('roles(nombre_rol)')
        .eq('id_usuario', (await supabase.auth.getUser()).data.user?.id ?? '')
        .maybeSingle()
      const related = data?.roles as { nombre_rol: string } | { nombre_rol: string }[] | null
      const rolNombre = Array.isArray(related)
        ? related[0]?.nombre_rol
        : related?.nombre_rol
      navigate(homeRol(rolNombre as RolUsuario) as string, { replace: true })
    } catch {
      setError('Error inesperado al iniciar sesión.')
    } finally {
      setLoading(false)
    }
  }

  if (checkingSession) {
    return (
      <div className="login-page">
        <div className="login-card">
          <p className="login-footer">Verificando sesión…</p>
        </div>
      </div>
    )
  }

  if (hasSession) {
    return <Navigate to={homeRol(rol)} replace />
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <header className="login-brand">
          <div className="login-brand-mark" aria-hidden="true">
            SW
          </div>
          <h1>SWIMyti</h1>
          <p>Acceso seguro al sistema clínico</p>
        </header>

        <form className="login-form" onSubmit={handleSubmit} noValidate>
          <div className="login-field">
            <label htmlFor="login-email">Email</label>
            <input
              id="login-email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="correo@centro.cl"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={loading || Boolean(supabaseConfigError)}
            />
          </div>

          <div className="login-field">
            <label htmlFor="login-password">Contraseña</label>
            <div className="login-pw-wrapper">
              <input
                id="login-password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loading || Boolean(supabaseConfigError)}
              />
              <button
                type="button"
                className="login-pw-toggle"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
                aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              >
                {showPassword ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                    <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {error ? (
            <p className="login-error" role="alert">
              {error}
            </p>
          ) : null}

          <button
            className="login-submit"
            type="submit"
            disabled={loading || Boolean(supabaseConfigError)}
          >
            {loading ? 'Ingresando…' : 'Ingresar'}
          </button>
        </form>

        <p className="login-footer">Trazabilidad inmutable · Acceso multi-rol</p>
        <p className="login-footer">
          <Link to="/" className="login-link">
            ← Volver al inicio
          </Link>
        </p>
      </div>
    </div>
  )
}

export default Login
