import { useEffect, useState, type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuthRol, type RolUsuario } from '../context/AuthRolContext'
import { homeRol } from '../utils/permisos'

type RoleRouteProps = {
  roles: RolUsuario[]
  children: ReactNode
}

function RoleRoute({ roles, children }: RoleRouteProps) {
  const { rol, loading, session, refreshRol } = useAuthRol()
  const [esperandoRol, setEsperandoRol] = useState(true)

  // Si hay sesión pero el rol aún no se resolvió, reintentar una vez
  // y redirigir a /login si realmente no hay perfil (evita "cargando" eterno).
  useEffect(() => {
    let active = true
    if (session && !rol && !loading) {
      const t = window.setTimeout(async () => {
        await refreshRol()
        if (active) setEsperandoRol(false)
      }, 1500)
      return () => {
        active = false
        window.clearTimeout(t)
      }
    }
    if (!session || rol) {
      setEsperandoRol(false)
    }
  }, [session, rol, loading, refreshRol])

  if (loading || (session && !rol && esperandoRol)) {
    return (
      <main>
        <p>Cargando…</p>
      </main>
    )
  }

  if (!rol) {
    return <Navigate to="/login" replace />
  }

  if (!roles.includes(rol)) {
    return <Navigate to={homeRol(rol)} replace />
  }

  return children
}

export default RoleRoute