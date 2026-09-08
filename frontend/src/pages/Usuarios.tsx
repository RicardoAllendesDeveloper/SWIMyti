import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../services/supabase'
import Sidebar from '../components/Sidebar'
import { NOMBRE_ROL } from '../utils/permisos'
import '../styles/Usuarios.css'

type Rol = {
  id_rol: number
  nombre_rol: string
}

type Especialidad = {
  id_especialidad: number
  nombre: string
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
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [editUsuario, setEditUsuario] = useState<UsuarioAdmin | null>(null)
  const [editNombres, setEditNombres] = useState('')
  const [editApellidos, setEditApellidos] = useState('')
  const [editIdRol, setEditIdRol] = useState('')
  const [especialidades, setEspecialidades] = useState<Especialidad[]>([])
  const [editEspecialidades, setEditEspecialidades] = useState<number[]>([])
  const [editEspecialidadPrincipal, setEditEspecialidadPrincipal] = useState<number | null>(null)

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
      .select(
        'id_usuario, email, nombres, apellidos, rut, activo, created_at, roles!inner(nombre_rol)',
      )
      .in('roles.nombre_rol', [
        'administrador',
        'doctor',
        'enfermeria',
        'administrativo',
        'unidad_apoyo',
      ])
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

  const loadEspecialidades = useCallback(async () => {
    const { data, error } = await supabase
      .from('especialidades')
      .select('id_especialidad, nombre')
      .eq('activo', true)
      .order('nombre', { ascending: true })

    if (error) {
      setError(error.message || 'No se pudieron cargar las especialidades.')
      return
    }
    setEspecialidades((data ?? []) as Especialidad[])
  }, [])

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    await Promise.all([loadUsuarios(), loadRoles(), loadEspecialidades()])
    setLoading(false)
  }, [loadUsuarios, loadRoles, loadEspecialidades])

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

  async function openEdit(usuario: UsuarioAdmin) {
    setError(null)
    setSuccess(null)
    setEditUsuario(usuario)
    setEditNombres(usuario.nombres)
    setEditApellidos(usuario.apellidos)
    const rolActual = usuario.roles
    const rolNombre = Array.isArray(rolActual)
      ? rolActual[0]?.nombre_rol
      : rolActual?.nombre_rol
    const rol = roles.find((r) => r.nombre_rol === rolNombre)
    setEditIdRol(rol ? String(rol.id_rol) : '')
    setEditEspecialidades([])
    setEditEspecialidadPrincipal(null)

    if (rolNombre === 'doctor') {
      const { data, error } = await supabase
        .from('doctores_especialidades')
        .select('id_especialidad, es_principal')
        .eq('id_doctor', usuario.id_usuario)

      if (!error && data) {
        const ids = (data ?? []).map((d) => d.id_especialidad as number)
        const principal = (data ?? []).find((d) => d.es_principal)
        setEditEspecialidades(ids)
        setEditEspecialidadPrincipal(
          principal ? (principal.id_especialidad as number) : (ids[0] ?? null),
        )
      }
    }
    setShowEdit(true)
  }

  function closeEdit() {
    if (saving) return
    setShowEdit(false)
    setEditUsuario(null)
  }

  async function handleSaveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSuccess(null)

    if (!editUsuario) return
    if (!editNombres.trim() || !editApellidos.trim() || !editIdRol) {
      setError('Completa nombres, apellidos y rol.')
      return
    }

    const rolSel = roles.find((r) => String(r.id_rol) === editIdRol)
    if (rolSel?.nombre_rol === 'doctor') {
      if (editEspecialidades.length === 0) {
        setError('Asigna al menos una especialidad al doctor.')
        return
      }
      if (!editEspecialidadPrincipal) {
        setError('Selecciona la especialidad principal del doctor.')
        return
      }
    }

    setSaving(true)

    const { error: updateError } = await supabase
      .from('usuarios')
      .update({
        nombres: editNombres.trim(),
        apellidos: editApellidos.trim(),
        id_rol: Number(editIdRol),
      })
      .eq('id_usuario', editUsuario.id_usuario)

    if (updateError) {
      setSaving(false)
      setError(updateError.message || 'No se pudo actualizar el usuario.')
      return
    }

    // Sincronizar especialidades si el usuario es doctor
    if (rolSel?.nombre_rol === 'doctor') {
      const { error: delError } = await supabase
        .from('doctores_especialidades')
        .delete()
        .eq('id_doctor', editUsuario.id_usuario)

      if (delError) {
        setSaving(false)
        setError(delError.message || 'No se pudieron actualizar las especialidades.')
        return
      }

      const rows = editEspecialidades.map((idEsp) => ({
        id_doctor: editUsuario.id_usuario,
        id_especialidad: idEsp,
        es_principal: idEsp === editEspecialidadPrincipal,
      }))

      const { error: insError } = await supabase
        .from('doctores_especialidades')
        .insert(rows)

      if (insError) {
        setSaving(false)
        setError(insError.message || 'No se pudieron guardar las especialidades.')
        return
      }
    }

    setSaving(false)
    setSuccess('Usuario actualizado correctamente.')
    setShowEdit(false)
    setEditUsuario(null)
    await loadUsuarios()
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
                          <div className="usuario-acciones">
                            <button
                              type="button"
                              className="dash-btn-secondary"
                              onClick={() => openEdit(usuario)}
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              className="dash-btn-secondary"
                              onClick={() => void handleToggleActivo(usuario)}
                            >
                              {usuario.activo ? 'Desactivar' : 'Activar'}
                            </button>
                          </div>
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
                <div className="usu-pw-wrapper">
                  <input
                    id="usuario-password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Mínimo 8 caracteres"
                    required
                    disabled={saving}
                  />
                  <button
                    type="button"
                    className="usu-pw-toggle"
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

              <div className="dash-field">
                <label htmlFor="usuario-confirm-password">Confirmar contraseña</label>
                <div className="usu-pw-wrapper">
                  <input
                    id="usuario-confirm-password"
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repite la contraseña"
                    required
                    disabled={saving}
                  />
                  <button
                    type="button"
                    className="usu-pw-toggle"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    tabIndex={-1}
                    aria-label={showConfirmPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  >
                    {showConfirmPassword ? (
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

      {showEdit && editUsuario ? (
        <div
          className="dash-modal-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeEdit()
          }}
        >
          <div
            className="dash-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="editar-usuario-title"
          >
            <div className="dash-modal-header">
              <div>
                <h3 id="editar-usuario-title">Editar usuario</h3>
                <p>
                  Actualiza el perfil y el rol de {editUsuario.email}. La ficha médica
                  y el historial permanecen intactos.
                </p>
              </div>
              <button
                type="button"
                className="dash-modal-close"
                onClick={closeEdit}
                aria-label="Cerrar"
                disabled={saving}
              >
                ×
              </button>
            </div>

            <form className="dash-form" onSubmit={(e) => void handleSaveEdit(e)}>
              <div className="dash-field">
                <label htmlFor="editar-usuario-nombres">Nombres</label>
                <input
                  id="editar-usuario-nombres"
                  type="text"
                  value={editNombres}
                  onChange={(e) => setEditNombres(e.target.value)}
                  required
                  disabled={saving}
                />
              </div>

              <div className="dash-field">
                <label htmlFor="editar-usuario-apellidos">Apellidos</label>
                <input
                  id="editar-usuario-apellidos"
                  type="text"
                  value={editApellidos}
                  onChange={(e) => setEditApellidos(e.target.value)}
                  required
                  disabled={saving}
                />
              </div>

              <div className="dash-field">
                <label htmlFor="editar-usuario-rol">Rol</label>
                <select
                  id="editar-usuario-rol"
                  value={editIdRol}
                  onChange={(e) => setEditIdRol(e.target.value)}
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

              {roles.find((r) => String(r.id_rol) === editIdRol)?.nombre_rol === 'doctor' ? (
                <div className="dash-field">
                  <label>Especialidades del doctor</label>
                  <div className="usu-especialidades">
                    {especialidades.map((esp) => {
                      const seleccionada = editEspecialidades.includes(esp.id_especialidad)
                      return (
                        <label
                          key={esp.id_especialidad}
                          className="usu-especialidad"
                        >
                          <span className="usu-especialidad-nombre">{esp.nombre}</span>
                          <span className="usu-especialidad-controls">
                            {seleccionada ? (
                              <label className="usu-principal">
                                <input
                                  type="radio"
                                  name="edit-principal"
                                  checked={editEspecialidadPrincipal === esp.id_especialidad}
                                  onChange={() =>
                                    setEditEspecialidadPrincipal(esp.id_especialidad)
                                  }
                                  disabled={saving}
                                />
                                <span>Principal</span>
                              </label>
                            ) : null}
                            <input
                              type="checkbox"
                              checked={seleccionada}
                              onChange={(e) => {
                                const checked = e.target.checked
                                setEditEspecialidades((prev) =>
                                  checked
                                    ? [...prev, esp.id_especialidad]
                                    : prev.filter((id) => id !== esp.id_especialidad),
                                )
                                if (checked && !editEspecialidadPrincipal) {
                                  setEditEspecialidadPrincipal(esp.id_especialidad)
                                }
                              }}
                              disabled={saving}
                            />
                          </span>
                        </label>
                      )
                    })}
                  </div>
                  <p className="dash-field-hint">
                    Marca las especialidades del doctor y selecciona la principal.
                  </p>
                </div>
              ) : null}

              <div className="dash-form-actions">
                <button
                  type="button"
                  className="dash-btn-secondary"
                  onClick={closeEdit}
                  disabled={saving}
                >
                  Cancelar
                </button>
                <button type="submit" className="dash-btn-primary" disabled={saving}>
                  {saving ? 'Guardando…' : 'Guardar cambios'}
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