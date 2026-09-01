import { type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuthRol, type RolUsuario } from '../context/AuthRolContext'

type RoleRouteProps = {
  roles: RolUsuario[]
  children: ReactNode
}

function RoleRoute({ roles, children }: RoleRouteProps) {
  const { rol, loading, session } = useAuthRol()

  // Mientras haya sesión pero el rol aún no se resolvió, no redirigir
  if (loading || (session && !rol)) {
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
    // Redirigir al portal natural del rol
    return <Navigate to={rol === 'paciente' ? '/portal' : '/dashboard'} replace />
  }

  return children
}

export default RoleRoute