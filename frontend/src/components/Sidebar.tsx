import { useState } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useAuthRol } from '../context/AuthRolContext'
import { supabase } from '../services/supabase'
import { NOMBRE_ROL, tieneModuloConRoles, homeRol, type Modulo } from '../utils/permisos'

type SidebarProps = {
  moduloActivo?: Modulo
}

// Solo etiqueta y ruta. La visibilidad NO se decide acá: la resuelve
// `tieneModuloConRoles` contra MODULOS_POR_ROL, que es la unica fuente de
// verdad. Cada item tenia ademas su propio `roles`, que no se leia en ningun
// lado y ya quedo desactualizado (rem decia enfermeria). No volver a agregarlo:
// el filtro no va por aca.
const ITEMS: { modulo: Modulo; label: string; ruta: string }[] = [
  { modulo: 'portal', label: 'Mi portal', ruta: '/portal' },
  { modulo: 'citas', label: 'Gestión de horas', ruta: '/citas' },
  { modulo: 'fichas', label: 'Fichas médicas', ruta: '/dashboard' },
  { modulo: 'pacientes', label: 'Pacientes', ruta: '/pacientes' },
  { modulo: 'disponibilidad', label: 'Agenda', ruta: '/disponibilidad' },
  { modulo: 'interconsultas', label: 'Interconsultas', ruta: '/interconsultas' },
  { modulo: 'bonos', label: 'Bonos de atención', ruta: '/bonos' },
  { modulo: 'finanzas', label: 'Presupuestos y finanzas', ruta: '/finanzas' },
  { modulo: 'recetas', label: 'Generar documentos', ruta: '/recetas' },
  { modulo: 'calculos', label: 'Cálculos clínicos', ruta: '/calculos' },
  { modulo: 'rem', label: 'REM', ruta: '/rem' },
  { modulo: 'bandeja_ordenes', label: 'Bandeja de órdenes', ruta: '/bandeja-ordenes' },
  { modulo: 'usuarios', label: 'Usuarios', ruta: '/usuarios' },
  { modulo: 'config_recinto', label: 'Configuración del recinto', ruta: '/config-recinto' },
]

function Sidebar({ moduloActivo }: SidebarProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { rol, roles, email, nombres, apellidos, especialidad } = useAuthRol()
  const [loggingOut, setLoggingOut] = useState(false)

  async function handleLogout() {
    setLoggingOut(true)
    await supabase.auth.signOut()
    setLoggingOut(false)
    navigate('/login', { replace: true })
  }

  // Un módulo es visible si el conjunto de roles del usuario lo habilita.
  // Así una jefatura que además es enfermería ve lo de ambas funciones.
  const visibles = ITEMS.filter((item) => tieneModuloConRoles(roles, item.modulo))

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
          <div className="dash-user-nombre">
            {(nombres || apellidos)
              ? `${nombres ?? ''} ${apellidos ?? ''}`.trim()
              : (email ?? 'Usuario autenticado')}
          </div>
          {email ? <div className="dash-user-email">{email}</div> : null}
          {rol ? <div className="dash-user-rol">{NOMBRE_ROL[rol]}</div> : null}
          {roles.length > 1 ? (
            <div className="dash-user-roles">
              {roles
                .filter((r) => r !== rol)
                .map((r) => NOMBRE_ROL[r])
                .join(' · ')}
            </div>
          ) : null}
          {especialidad ? (
            <div className="dash-user-esp">{especialidad}</div>
          ) : null}
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