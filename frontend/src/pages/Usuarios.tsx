import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../services/supabase'
import Sidebar from '../components/Sidebar'
import { NOMBRE_ROL } from '../utils/permisos'
import '../styles/Usuarios.css'

type Rol = {
  id_rol: number
  nombre_rol: string
}

type UsuarioAdmin = {
  id_usuario: string
  email: string
  nombres: string
  apellidos: string
  rut: string | null
  activo: boolean
  created_at: string
  roles?: { nombre_rol: string } | { nombre_rol: string }[] | null
}

function formatDate(value: string): string {
  try {
    return new Intl.DateTimeFormat('es-CL', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value))
  } catch {
    return value
  }
}

function Usuarios() {
  const [usuarios, setUsuarios] = useState<UsuarioAdmin[]>([])
  const [roles, setRoles] = useState<Rol[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)

  const [email, setEmail] = useState('')
  const [nombres, setNombres] = useState('')
  const [apellidos, setApellidos] = useState('')
  const [rut, setRut] = useState('')
  const [idRol, setIdRol] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const loadRoles = useCallback(async () => {
    const { data, error } = await supabase
      .from('roles')
      .select('id_rol, nombre_rol')
      .order('id_rol', { ascending: true })

    if (error) {
      setError(error.message || 'No se pudieron cargar los roles.')
      return
    }

    const all = (data ?? []) as Rol[]
    // Excluir el rol paciente de la creación directa (se asigna vía portal)
    setRoles(all.filter((r) => r.nombre_rol !== 'paciente'))
  }, [])

  const loadUsuarios = useCallback(async () => {
    const { data, error } = await supabase
      .from('usuarios')
      .select('id_usuario, email, nombres, apellidos, rut, activo, created_at, roles(nombre_rol)')
      .order('created_at', { ascending: false })

    if (error) {
      setError(error.message || 'No se pudieron cargar los usuarios.')
      setUsuarios([])
      return
    }

    const rows = (data ?? []).map((row) => {
      const related = row.roles
      const rol = Array.isArray(related) ? related[0] ?? null : related
      return {
        ...row,
        roles: rol ? { nombre_rol: (rol as { nombre_rol: string }).nombre_rol } : null,
      } as UsuarioAdmin
    })
    setUsuarios(rows)
  }, [])

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    await Promise.all([loadUsuarios(), loadRoles()])
    setLoading(false)
  }, [loadUsuarios, loadRoles])

  useEffect(() => {
    void loadData()
  }, [loadData])

  function resetForm() {
    setEmail('')
    setNombres('')
    setApellidos('')
    setRut('')
    setIdRol('')
    setPassword('')
    setConfirmPassword('')
  }

  function openForm() {
    setSuccess(null)
    setError(null)
    resetForm()
    setShowForm(true)
  }

  function closeForm() {
    if (saving) return
    setShowForm(false)
    resetForm()
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSuccess(null)

    if (!email.trim() || !nombres.trim() || !apellidos.trim() || !idRol) {
      setError('Completa email, nombres, apellidos y rol.')
      return
    }

    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres.')
      return
    }

    if (confirmPassword !== password) {
      setError('Las contraseñas no coinciden.')
      return
    }

    setSaving(true)

    try {
      // 1) Crear el usuario vía RPC SECURITY DEFINER (valida rol admin en el servidor).
      //    Antes se usaba supabase.auth.admin.createUser(), que exige la service_role
      //    key y no funciona desde el cliente con la anon key ("Bear token").
      const { data: rpcData, error: rpcError } = await supabase.rpc('fn_crear_usuario', {
        p_email: email.trim(),
        p_password: password,
        p_nombres: nombres.trim(),
        p_apellidos: apellidos.trim(),
        p_id_rol: Number(idRol),
        p_rut: rut.trim() || null,
      })

      if (rpcError) {
        setError(rpcError.message || 'No se pudo crear el usuario.')
        return
      }

      const result = rpcData as { ok?: boolean; error?: string } | null
      if (!result || !result.ok) {
        setError(result?.error || 'No se pudo crear el usuario.')
        return
      }

      setSuccess(`Usuario ${nombres.trim()} ${apellidos.trim()} creado correctamente.`)
      setShowForm(false)
      resetForm()
      await loadUsuarios()
    } catch {
      setError('Error inesperado al crear el usuario.')
    } finally {
      setSaving(false)
    }
  }

  async function handleToggleActivo(usuario: UsuarioAdmin) {
    setError(null)
    setSuccess(null)
    const next = !usuario.activo

    const { error } = await supabase
      .from('usuarios')
      .update({ activo: next })
      .eq('id_usuario', usuario.id_usuario)

    if (error) {
      setError(error.message || 'No se pudo actualizar el usuario.')
      return
    }

    setUsuarios((prev) =>
      prev.map((u) => (u.id_usuario === usuario.id_usuario ? { ...u, activo: next } : u)),
    )
    setSuccess(`Usuario ${next ? 'activado' : 'desactivado'} correctamente.`)
  }

  function rolDe(usuario: UsuarioAdmin): string {
    const r = usuario.roles
    if (!r) return 'Sin rol'
    const nombre = Array.isArray(r) ? r[0]?.nombre_rol : r.nombre_rol
    return NOMBRE_ROL[nombre as keyof typeof NOMBRE_ROL] ?? nombre ?? 'Sin rol'
  }

  return (
    <div className="dash">
      <Sidebar moduloActivo="usuarios" />

      <div className="dash-main">
        <header className="dash-topbar">
          <div>
            <h2>Gestión de usuarios</h2>
            <p>Administra perfiles, roles y estado de cuentas</p>
          </div>
          <button
            type="button"
            className="dash-btn-primary"
            onClick={openForm}
          >
            Nuevo usuario
          </button>
        </header>

        <section className="dash-content">
          {error ? (
            <p className="dash-alert dash-alert-error" role="alert">
              {error}
            </p>
          ) : null}

          {success ? (
            <p className="dash-alert dash-alert-success" role="status">
              {success}
            </p>
          ) : null}

          <div className="dash-card">
            <div className="dash-card-header">
              <div>
                <h3>Cuentas del sistema</h3>
                <p className="dash-muted">
                  Perfiles en public.usuarios (tabla usuarios)
                </p>
              </div>
              <span className="dash-badge">
                {loading ? '…' : `${usuarios.length} usuario${usuarios.length === 1 ? '' : 's'}`}
              </span>
            </div>

            {loading ? (
              <p className="dash-loading">Cargando usuarios…</p>
            ) : usuarios.length === 0 ? (
              <p className="dash-empty">
                No hay usuarios registrados. Usa &quot;Nuevo usuario&quot; para crear el primero.
              </p>
            ) : (
              <div className="dash-table-wrap">
                <table className="dash-table">
                  <thead>
                    <tr>
                      <th>Email</th>
                      <th>Nombre</th>
                      <th>RUT</th>
                      <th>Rol</th>
                      <th>Creado</th>
                      <th>Estado</th>
                      <th>Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usuarios.map((usuario) => (
                      <tr key={usuario.id_usuario}>
                        <td>{usuario.email}</td>
                        <td>
                          {usuario.nombres} {usuario.apellidos}
                        </td>
                        <td>{usuario.rut ?? '—'}</td>
                        <td>
                          <span className="dash-badge">{rolDe(usuario)}</span>
                        </td>
                        <td>{formatDate(usuario.created_at)}</td>
                        <td>
                          <span className={usuario.activo ? 'usuario-estado on' : 'usuario-estado off'}>
                            {usuario.activo ? 'Activo' : 'Inactivo'}
                          </span>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="dash-btn-secondary"
                            onClick={() => void handleToggleActivo(usuario)}
                          >
                            {usuario.activo ? 'Desactivar' : 'Activar'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </div>

      {showForm ? (
        <div
          className="dash-modal-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeForm()
          }}
        >
          <div
            className="dash-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="nuevo-usuario-title"
          >
            <div className="dash-modal-header">
              <div>
                <h3 id="nuevo-usuario-title">Nuevo usuario</h3>
                <p>
                  Se crea la cuenta en Auth y el perfil con su rol. La contraseña
                  queda definida por el administrador.
                </p>
              </div>
              <button
                type="button"
                className="dash-modal-close"
                onClick={closeForm}
                aria-label="Cerrar"
                disabled={saving}
              >
                ×
              </button>
            </div>

            <form className="dash-form" onSubmit={(e) => void handleCreate(e)}>
              <div className="dash-field">
                <label htmlFor="usuario-email">Email</label>
                <input
                  id="usuario-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="correo@centro.cl"
                  required
                  disabled={saving}
                />
              </div>

              <div className="dash-field">
                <label htmlFor="usuario-nombres">Nombres</label>
                <input
                  id="usuario-nombres"
                  type="text"
                  value={nombres}
                  onChange={(e) => setNombres(e.target.value)}
                  placeholder="Nombres del profesional"
                  required
                  disabled={saving}
                />
              </div>

              <div className="dash-field">
                <label htmlFor="usuario-apellidos">Apellidos</label>
                <input
                  id="usuario-apellidos"
                  type="text"
                  value={apellidos}
                  onChange={(e) => setApellidos(e.target.value)}
                  placeholder="Apellidos del profesional"
                  required
                  disabled={saving}
                />
              </div>

              <div className="dash-field">
                <label htmlFor="usuario-rut">RUT (opcional)</label>
                <input
                  id="usuario-rut"
                  type="text"
                  value={rut}
                  onChange={(e) => setRut(e.target.value)}
                  placeholder="12.345.678-9"
                  disabled={saving}
                />
              </div>

              <div className="dash-field">
                <label htmlFor="usuario-rol">Rol</label>
                <select
                  id="usuario-rol"
                  value={idRol}
                  onChange={(e) => setIdRol(e.target.value)}
                  required
                  disabled={saving || roles.length === 0}
                >
                  <option value="">Selecciona un rol</option>
                  {roles.map((r) => (
                    <option key={r.id_rol} value={String(r.id_rol)}>
                      {NOMBRE_ROL[r.nombre_rol as keyof typeof NOMBRE_ROL] ?? r.nombre_rol}
                    </option>
                  ))}
                </select>
              </div>

              <div className="dash-field">
                <label htmlFor="usuario-password">Contraseña temporal</label>
                <input
                  id="usuario-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Mínimo 8 caracteres"
                  required
                  disabled={saving}
                />
              </div>

              <div className="dash-field">
                <label htmlFor="usuario-confirm-password">Confirmar contraseña</label>
                <input
                  id="usuario-confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repite la contraseña"
                  required
                  disabled={saving}
                />
              </div>

              <div className="dash-form-actions">
                <button
                  type="button"
                  className="dash-btn-secondary"
                  onClick={closeForm}
                  disabled={saving}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="dash-btn-primary"
                  disabled={saving}
                >
                  {saving ? 'Creando…' : 'Crear usuario'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default Usuarios