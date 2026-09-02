import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { supabase, supabaseConfigError } from '../services/supabase'
import '../styles/Registro.css'

function mapAuthError(message: string): string {
  const normalized = message.toLowerCase()

  if (
    normalized.includes('already registered') ||
    normalized.includes('user already') ||
    normalized.includes('duplicate')
  ) {
    return 'Ese correo ya está registrado. Inicia sesión o recupera tu contraseña.'
  }

  if (normalized.includes('too many requests') || normalized.includes('rate limit') || normalized.includes('429')) {
    return 'Demasiados intentos de registro. Espera unos minutos e inténtalo de nuevo.'
  }

  if (normalized.includes('password')) {
    return 'La contraseña debe tener al menos 8 caracteres.'
  }

  if (normalized.includes('email')) {
    return 'Ingresa un correo electrónico válido.'
  }

  return message || 'No se pudo crear la cuenta. Inténtalo nuevamente.'
}

function Registro() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [nombres, setNombres] = useState('')
  const [apellidos, setApellidos] = useState('')
  const [rut, setRut] = useState('')
  const [telefono, setTelefono] = useState('')
  const [error, setError] = useState<string | null>(supabaseConfigError)
  const [success, setSuccess] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [checkingSession, setCheckingSession] = useState(!supabaseConfigError)
  const [hasSession, setHasSession] = useState(false)

  useEffect(() => {
    if (supabaseConfigError) {
      setCheckingSession(false)
      return
    }

    let active = true
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return
        setHasSession(Boolean(data.session))
      })
      .catch(() => {
        if (!active) return
        setHasSession(false)
      })
      .finally(() => {
        if (!active) return
        setCheckingSession(false)
      })

    return () => {
      active = false
    }
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(supabaseConfigError)
    setSuccess(null)
    if (supabaseConfigError) return

    if (!email.trim() || !password || !nombres.trim() || !apellidos.trim() || !rut.trim()) {
      setError('Completa email, contraseña, nombres, apellidos y RUT.')
      return
    }

    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden.')
      return
    }

    setLoading(true)

    try {
      // 1) Crear la cuenta en Supabase Auth
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            nombres: nombres.trim(),
            apellidos: apellidos.trim(),
            rut: rut.trim(),
            telefono: telefono.trim(),
          },
        },
      })

      if (signUpError) {
        setError(mapAuthError(signUpError.message))
        return
      }

      if (!signUpData.user) {
        setError('No se pudo crear la cuenta.')
        return
      }

      // Supabase puede no retornar sesión tras signUp (confirmación de email).
      // Iniciamos sesión para que auth.uid() exista antes de crear el perfil.
      if (!signUpData.session) {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        })
        if (signInError) {
          setSuccess(
            'Cuenta creada correctamente. Revisa tu correo para activarla y luego inicia sesión.',
          )
          setLoading(false)
          return
        }
      }

      // 2) Ejecutar el auto-registro (crea perfil usuario + paciente)
      const { error: rpcError } = await supabase.rpc('fn_auto_registro_paciente', {
        p_rut: rut.trim(),
        p_nombres: nombres.trim(),
        p_apellidos: apellidos.trim(),
        p_telefono: telefono.trim() || null,
        p_email: email.trim(),
      })

      if (rpcError) {
        setError(
          `La cuenta se creó, pero el perfil de paciente falló: ${rpcError.message}.`,
        )
        return
      }

      navigate('/portal', { replace: true })
    } catch {
      setError('Error inesperado al crear la cuenta.')
    } finally {
      setLoading(false)
    }
  }

  if (checkingSession) {
    return (
      <div className="reg-page">
        <div className="reg-card">
          <p className="reg-footer">Verificando sesión…</p>
        </div>
      </div>
    )
  }

  if (hasSession) {
    return <Navigate to="/portal" replace />
  }

  return (
    <div className="reg-page">
      <div className="reg-card">
        <header className="reg-brand">
          <div className="reg-brand-mark" aria-hidden="true">
            SW
          </div>
          <h1>Crear cuenta de paciente</h1>
          <p>Accede a tu ficha médica, citas y exámenes online</p>
        </header>

        <form className="reg-form" onSubmit={handleSubmit} noValidate>
          <div className="reg-row">
            <div className="reg-field">
              <label htmlFor="reg-nombres">Nombres</label>
              <input
                id="reg-nombres"
                type="text"
                value={nombres}
                onChange={(e) => setNombres(e.target.value)}
                placeholder="Tus nombres"
                required
                disabled={loading}
              />
            </div>
            <div className="reg-field">
              <label htmlFor="reg-apellidos">Apellidos</label>
              <input
                id="reg-apellidos"
                type="text"
                value={apellidos}
                onChange={(e) => setApellidos(e.target.value)}
                placeholder="Tus apellidos"
                required
                disabled={loading}
              />
            </div>
          </div>

          <div className="reg-field">
            <label htmlFor="reg-rut">RUT</label>
            <input
              id="reg-rut"
              type="text"
              value={rut}
              onChange={(e) => setRut(e.target.value)}
              placeholder="12.345.678-9"
              required
              disabled={loading}
            />
          </div>

          <div className="reg-field">
            <label htmlFor="reg-email">Email</label>
            <input
              id="reg-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="correo@ejemplo.cl"
              required
              disabled={loading}
            />
          </div>

          <div className="reg-field">
            <label htmlFor="reg-telefono">Teléfono (opcional)</label>
            <input
              id="reg-telefono"
              type="tel"
              value={telefono}
              onChange={(e) => setTelefono(e.target.value)}
              placeholder="+56912345678"
              disabled={loading}
            />
          </div>

          <div className="reg-field">
            <label htmlFor="reg-password">Contraseña</label>
            <div className="reg-pw-wrapper">
              <input
                id="reg-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo 8 caracteres"
                required
                disabled={loading}
              />
              <button
                type="button"
                className="reg-pw-toggle"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
                aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              >
                {showPassword ? '🙈' : '👁'}
              </button>
            </div>
          </div>

          <div className="reg-field">
            <label htmlFor="reg-password-confirm">Confirmar contraseña</label>
            <div className="reg-pw-wrapper">
              <input
                id="reg-password-confirm"
                type={showConfirmPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repite tu contraseña"
                required
                disabled={loading}
              />
              <button
                type="button"
                className="reg-pw-toggle"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                tabIndex={-1}
                aria-label={showConfirmPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              >
                {showConfirmPassword ? '🙈' : '👁'}
              </button>
            </div>
          </div>

          {success ? (
            <p className="reg-success" role="status">
              {success}
            </p>
          ) : null}

          {error ? (
            <p className="reg-error" role="alert">
              {error}
            </p>
          ) : null}

          <button className="reg-submit" type="submit" disabled={loading}>
            {loading ? 'Creando cuenta…' : 'Crear cuenta'}
          </button>
        </form>

        <p className="reg-footer">
          ¿Ya tienes cuenta?{' '}
          <Link to="/login" className="reg-link">
            Inicia sesión
          </Link>
        </p>
        <p className="reg-footer">
          <Link to="/" className="reg-link">
            ← Volver al inicio
          </Link>
        </p>
      </div>
    </div>
  )
}

export default Registro