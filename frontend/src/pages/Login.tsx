import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { supabase, supabaseConfigError } from '../services/supabase'
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
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
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
      navigate(rolNombre === 'paciente' ? '/portal' : '/dashboard', { replace: true })
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
    return <Navigate to="/dashboard" replace />
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
            <input
              id="login-password"
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loading || Boolean(supabaseConfigError)}
            />
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
      </div>
    </div>
  )
}

export default Login
