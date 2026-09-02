import { useState } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useAuthRol } from '../context/AuthRolContext'
import { supabase } from '../services/supabase'
import { NOMBRE_ROL, tieneModulo, homeRol, type Modulo } from '../utils/permisos'

type SidebarProps = {
  moduloActivo?: Modulo
}

const ITEMS: { modulo: Modulo; label: string; ruta: string; roles: string[] }[] = [
  { modulo: 'portal', label: 'Mi portal', ruta: '/portal', roles: ['paciente'] },
  { modulo: 'citas', label: 'Toma de horas', ruta: '/citas', roles: ['*'] },
  { modulo: 'fichas', label: 'Fichas médicas', ruta: '/dashboard', roles: ['*'] },
  { modulo: 'pacientes', label: 'Pacientes', ruta: '/pacientes', roles: ['*'] },
  { modulo: 'disponibilidad', label: 'Disponibilidad', ruta: '/disponibilidad', roles: ['administrador', 'doctor'] },
  { modulo: 'interconsultas', label: 'Interconsultas', ruta: '/interconsultas', roles: ['*'] },
  { modulo: 'bonos', label: 'Bonos de atención', ruta: '/bonos', roles: ['administrador', 'administrativo'] },
  { modulo: 'finanzas', label: 'Presupuestos y finanzas', ruta: '/finanzas', roles: ['administrador', 'administrativo'] },
  { modulo: 'recetas', label: 'Recetas y certificados', ruta: '/recetas', roles: ['administrador', 'doctor'] },
  { modulo: 'usuarios', label: 'Usuarios', ruta: '/usuarios', roles: ['administrador'] },
]

function Sidebar({ moduloActivo }: SidebarProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { rol, email } = useAuthRol()
  const [loggingOut, setLoggingOut] = useState(false)

  async function handleLogout() {
    setLoggingOut(true)
    await supabase.auth.signOut()
    setLoggingOut(false)
    navigate('/login', { replace: true })
  }

  const visibles = ITEMS.filter(
    (item) =>
      tieneModulo(rol, item.modulo) &&
      (item.roles.includes('*') || (rol && item.roles.includes(rol))),
  )

  return (
    <aside className="dash-sidebar" aria-label="Navegación principal">
      <Link
        to={rol ? homeRol(rol) : '/'}
        className="dash-brand"
      >
        <div className="dash-brand-mark" aria-hidden="true">
          SW
        </div>
        <div>
          <h1>SWIMyti</h1>
          <p>Gestión clínica integral</p>
        </div>
      </Link>

      <nav className="dash-nav">
        {visibles.map((item) => {
          const activo =
            moduloActivo === item.modulo ||
            location.pathname === item.ruta
          return (
            <button
              key={item.modulo}
              type="button"
              className={`dash-nav-item${activo ? ' is-active' : ''}`}
              onClick={() => navigate(item.ruta)}
            >
              {item.label}
            </button>
          )
        })}
      </nav>

      <div className="dash-sidebar-footer">
        <div className="dash-user" title={email ?? undefined}>
          <div>{email ?? 'Usuario autenticado'}</div>
          {rol ? <div className="dash-user-rol">{NOMBRE_ROL[rol]}</div> : null}
        </div>
        <button
          type="button"
          className="dash-logout"
          onClick={() => void handleLogout()}
          disabled={loggingOut}
        >
          {loggingOut ? 'Cerrando…' : 'Cerrar sesión'}
        </button>
      </div>
    </aside>
  )
}

export default Sidebar