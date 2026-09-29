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

/** Rol asignado a un usuario, con su marca de principal. */
type RolUsuarioAdmin = {
  id_rol: number
  nombre_rol: string
  es_principal: boolean
}

type UsuarioAdmin = {
  id_usuario: string
  email: string
  nombres: string
  apellidos: string
  rut: string | null
  activo: boolean
  created_at: string
  /** Todos los roles acumulados (tabla usuario_roles), no solo el principal. */
  roles: RolUsuarioAdmin[]
  /** Especialidades que coordina, solo si tiene el rol jefatura. */
  ambito: string[]
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
  const [editRolAdicional, setEditRolAdicional] = useState('')
  const [editAmbito, setEditAmbito] = useState<number[]>([])
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
    // Los roles vienen de usuario_roles: un usuario puede tener varios y el
    // listado es el que le permite al administrador verlos todos juntos.
    const { data, error } = await supabase
      .from('usuarios')
      .select(
        `
        id_usuario, email, nombres, apellidos, rut, activo, created_at,
        usuario_roles!inner (
          es_principal,
          vigente_hasta,
          roles ( id_rol, nombre_rol )
        )
      `,
      )
      .order('created_at', { ascending: false })

    if (error) {
      setError(error.message || 'No se pudieron cargar los usuarios.')
      setUsuarios([])
      return
    }

    const filas = (data ?? []) as unknown as (UsuarioAdmin & {
      usuario_roles?: {
        es_principal: boolean
        vigente_hasta: string | null
        roles: { id_rol: number; nombre_rol: string } | { id_rol: number; nombre_rol: string }[] | null
      }[]
    })[]

    const visibles = filas
      .map((row) => {
        const rolesUsuario: RolUsuarioAdmin[] = (row.usuario_roles ?? [])
          .filter((r) => r.vigente_hasta === null)
          .map((r) => {
            const rel = Array.isArray(r.roles) ? r.roles[0] : r.roles
            return rel
              ? {
                  id_rol: rel.id_rol,
                  nombre_rol: rel.nombre_rol,
                  es_principal: r.es_principal,
                }
              : null
          })
          .filter((r): r is RolUsuarioAdmin => r !== null)

        return {
          id_usuario: row.id_usuario,
          email: row.email,
          nombres: row.nombres,
          apellidos: row.apellidos,
          rut: row.rut,
          activo: row.activo,
          created_at: row.created_at,
          roles: rolesUsuario.sort((a, b) => Number(b.es_principal) - Number(a.es_principal)),
          ambito: [],
        }
      })
      // El rol 'paciente' se asigna por el portal, no por administración.
      .filter((u) => u.roles.some((r) => r.nombre_rol !== 'paciente'))

    // Ámbito de jefatura: un query aparte para no anidar la relación sobre
    // una tabla que no tiene FK directa hacia usuarios.
    const conJefatura = visibles.filter((u) => u.roles.some((r) => r.nombre_rol === 'jefatura'))
    if (conJefatura.length > 0) {
      const { data: jefaturas } = await supabase
        .from('jefaturas_especialidades')
        .select('id_jefatura, especialidades(nombre)')
        .in(
          'id_jefatura',
          conJefatura.map((u) => u.id_usuario),
        )

      const porUsuario = new Map<string, string[]>()
      for (const je of (jefaturas ?? []) as {
        id_jefatura: string
        especialidades: { nombre: string } | { nombre: string }[] | null
      }[]) {
        const esp = Array.isArray(je.especialidades)
          ? je.especialidades[0]
          : je.especialidades
        if (!esp?.nombre) continue
        const lista: string[] = porUsuario.get(je.id_jefatura) ?? []
        lista.push(esp.nombre)
        porUsuario.set(je.id_jefatura, lista)
      }

      setUsuarios(
        visibles.map((u) => ({ ...u, ambito: porUsuario.get(u.id_usuario) ?? [] })),
      )
      return
    }

    setUsuarios(visibles)
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

  async function openEdit(usuario: UsuarioAdmin) {
    setError(null)
    setSuccess(null)
    setEditUsuario(usuario)
    setEditNombres(usuario.nombres)
    setEditApellidos(usuario.apellidos)
    const principal = usuario.roles.find((r) => r.es_principal) ?? usuario.roles[0]
    setEditIdRol(principal ? String(principal.id_rol) : '')
    setEditRolAdicional('')
    setEditAmbito([])
    setEditEspecialidades([])
    setEditEspecialidadPrincipal(null)

    // La jefatura coordina un ámbito, así que se cargan sus especialidades.
    if (usuario.roles.some((r) => r.nombre_rol === 'jefatura')) {
      const { data } = await supabase
        .from('jefaturas_especialidades')
        .select('id_especialidad')
        .eq('id_jefatura', usuario.id_usuario)
      setEditAmbito(((data ?? []) as { id_especialidad: number }[]).map((d) => d.id_especialidad))
    }

    if (usuario.roles.some((r) => r.nombre_rol === 'doctor')) {
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
      setError('Completa nombres, apellidos y rol principal.')
      return
    }

    const rolPrincipal = roles.find((r) => String(r.id_rol) === editIdRol)
    const rolAdicional = roles.find((r) => String(r.id_rol) === editRolAdicional)

    // Un doctor necesita especialidad para atender; la validación se hace
    // sobre el conjunto final de roles, no solo sobre el principal.
    const RolesFinales = new Set([
      ...editUsuario.roles.map((r) => r.nombre_rol),
      rolPrincipal?.nombre_rol,
      rolAdicional?.nombre_rol,
    ].filter((r): r is string => Boolean(r)))

    if (RolesFinales.has('doctor')) {
      if (editEspecialidades.length === 0) {
        setError('Asigna al menos una especialidad al doctor.')
        return
      }
      if (!editEspecialidadPrincipal) {
        setError('Selecciona la especialidad principal del doctor.')
        return
      }
    }

    if (RolesFinales.has('jefatura') && editAmbito.length === 0) {
      setError('La jefatura necesita al menos una especialidad que coordine.')
      return
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

    // Agregar rol. Nunca se quita uno: los roles se acumulan (decision de
    // producto, ver usuario_roles). Para dejar de tener un rol se desactiva
    // la cuenta.
    if (rolAdicional && !editUsuario.roles.some((r) => r.id_rol === rolAdicional.id_rol)) {
      const { error: rolError } = await supabase.from('usuario_roles').insert({
        id_usuario: editUsuario.id_usuario,
        id_rol: rolAdicional.id_rol,
        es_principal: false,
      })

      if (rolError) {
        setSaving(false)
        setError(rolError.message || 'No se pudo agregar el rol.')
        return
      }
    }

    // Ámbito de la jefatura: se sincroniza completo (borra y reinserta).
    if (RolesFinales.has('jefatura')) {
      const { error: delAmbito } = await supabase
        .from('jefaturas_especialidades')
        .delete()
        .eq('id_jefatura', editUsuario.id_usuario)

      if (delAmbito) {
        setSaving(false)
        setError(delAmbito.message || 'No se pudo guardar el ámbito de la jefatura.')
        return
      }

      if (editAmbito.length > 0) {
        const { error: insAmbito } = await supabase.from('jefaturas_especialidades').insert(
          editAmbito.map((idEsp) => ({
            id_jefatura: editUsuario.id_usuario,
            id_especialidad: idEsp,
          })),
        )

        if (insAmbito) {
          setSaving(false)
          setError(insAmbito.message || 'No se pudo guardar el ámbito de la jefatura.')
          return
        }
      }
    }

    // Sincronizar especialidades si el usuario tiene rol doctor
    if (RolesFinales.has('doctor')) {
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
                      <th>Roles</th>
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
                          <div className="usu-roles-actuales">
                            {usuario.roles.map((r) => (
                              <span key={r.id_rol} className="dash-badge">
                                {NOMBRE_ROL[r.nombre_rol as keyof typeof NOMBRE_ROL] ?? r.nombre_rol}
                              </span>
                            ))}
                          </div>
                          {usuario.ambito.length > 0 ? (
                            <div className="usuario-ambito">
                              Coordina: {usuario.ambito.join(', ')}
                            </div>
                          ) : null}
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
                <label>Roles actuales</label>
                <div className="usu-roles-actuales">
                  {editUsuario.roles.map((r) => (
                    <span key={r.id_rol} className="dash-badge">
                      {NOMBRE_ROL[r.nombre_rol as keyof typeof NOMBRE_ROL] ?? r.nombre_rol}
                      {r.es_principal ? ' (principal)' : ''}
                    </span>
                  ))}
                </div>
                <p className="dash-field-hint">
                  Los roles se acumulan y no se quitan. Si una persona deja de
                  ejercer un cargo, desactiva la cuenta.
                </p>
              </div>

              <div className="dash-field">
                <label htmlFor="editar-usuario-rol">Rol principal</label>
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
                <p className="dash-field-hint">
                  Define dónde aterriza la persona al entrar y qué se muestra en
                  su perfil. No cambia el resto de sus permisos.
                </p>
              </div>

              <div className="dash-field">
                <label htmlFor="editar-usuario-rol-adicional">Agregar rol</label>
                <select
                  id="editar-usuario-rol-adicional"
                  value={editRolAdicional}
                  onChange={(e) => setEditRolAdicional(e.target.value)}
                  disabled={saving || roles.length === 0}
                >
                  <option value="">Agregar una función adicional…</option>
                  {roles
                    .filter((r) => !editUsuario?.roles.some((x) => x.id_rol === r.id_rol))
                    .map((r) => (
                      <option key={r.id_rol} value={String(r.id_rol)}>
                        {NOMBRE_ROL[r.nombre_rol as keyof typeof NOMBRE_ROL] ?? r.nombre_rol}
                      </option>
                    ))}
                </select>
                <p className="dash-field-hint">
                  Suma una función a la que ya tiene. Ejemplo: Promoción a
                  jefatura sin perder el rol clínico.
                </p>
              </div>

              {(() => {
                const tieneJefatura =
                  editUsuario.roles.some((r) => r.nombre_rol === 'jefatura') ||
                  roles.find((r) => String(r.id_rol) === editIdRol)?.nombre_rol === 'jefatura' ||
                  roles.find((r) => String(r.id_rol) === editRolAdicional)?.nombre_rol === 'jefatura'
                if (!tieneJefatura) return null
                return (
                  <div className="dash-field">
                    <label>Ámbito que coordina la jefatura</label>
                    <div className="usu-especialidades">
                      {especialidades.map((esp) => {
                        const marcada = editAmbito.includes(esp.id_especialidad)
                        return (
                          <label key={esp.id_especialidad} className="usu-especialidad">
                            <span className="usu-especialidad-nombre">{esp.nombre}</span>
                            <span className="usu-especialidad-controls">
                              <input
                                type="checkbox"
                                checked={marcada}
                                onChange={(e) => {
                                  const checked = e.target.checked
                                  setEditAmbito((prev) =>
                                    checked
                                      ? [...prev, esp.id_especialidad]
                                      : prev.filter((id) => id !== esp.id_especialidad),
                                  )
                                }}
                                disabled={saving}
                              />
                            </span>
                          </label>
                        )
                      })}
                    </div>
                    <p className="dash-field-hint">
                      Solo podrá publicar carga horaria y gestionar citas de
                      estas especialidades.
                    </p>
                  </div>
                )
              })()}

              {(() => {
                const tieneDoctor =
                  editUsuario.roles.some((r) => r.nombre_rol === 'doctor') ||
                  roles.find((r) => String(r.id_rol) === editIdRol)?.nombre_rol === 'doctor' ||
                  roles.find((r) => String(r.id_rol) === editRolAdicional)?.nombre_rol === 'doctor'
                if (!tieneDoctor) return null
                return (
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
                )
              })()}

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