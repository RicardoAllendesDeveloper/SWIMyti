import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../services/supabase'
import { useAuthRol } from '../context/AuthRolContext'
import Sidebar from '../components/Sidebar'
import { puedeRegistrarPaciente } from '../utils/permisos'
import type { Paciente } from '../types/database'
import '../styles/Pacientes.css'

type PacienteForm = {
  rut: string
  nombres: string
  apellidos: string
  telefono: string
  email: string
  direccion: string
}

const emptyForm: PacienteForm = {
  rut: '',
  nombres: '',
  apellidos: '',
  telefono: '',
  email: '',
  direccion: '',
}

function Pacientes() {
  const { rol } = useAuthRol()
  const [pacientes, setPacientes] = useState<Paciente[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<PacienteForm>(emptyForm)
  const [missingProfile, setMissingProfile] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    setMissingProfile(false)

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      setError('No se pudo obtener la sesión del usuario.')
      setLoading(false)
      return
    }

    const profileRes = await supabase
      .from('usuarios')
      .select('id_usuario')
      .eq('id_usuario', user.id)
      .maybeSingle()

    if (profileRes.error) {
      setError(profileRes.error.message)
    } else if (!profileRes.data) {
      setMissingProfile(true)
      setError(
        'Tu cuenta no tiene perfil en public.usuarios. Sin rol staff, RLS oculta los pacientes. Ejecuta supabase/seed_mi_usuario.sql (cambia el email).',
      )
    }

    const pacientesRes = await supabase
      .from('pacientes')
      .select('id_paciente, rut, nombres, apellidos, telefono, email, direccion')
      .eq('activo', true)
      .order('apellidos', { ascending: true })

    if (pacientesRes.error) {
      setError((current) =>
        current
          ? current
          : pacientesRes.error?.message || 'No se pudieron cargar los pacientes.',
      )
      setPacientes([])
    } else {
      setPacientes((pacientesRes.data as Paciente[]) ?? [])
    }

    setLoading(false)
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  function openForm() {
    setError(null)
    setSuccess(null)
    setForm(emptyForm)
    setShowForm(true)
  }

  function closeForm() {
    if (saving) return
    setShowForm(false)
    setForm(emptyForm)
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSuccess(null)

    if (!form.rut.trim() || !form.nombres.trim() || !form.apellidos.trim()) {
      setError('RUT, nombres y apellidos son obligatorios.')
      return
    }

    setSaving(true)

    const { error: insertError } = await supabase.from('pacientes').insert({
      rut: form.rut.trim(),
      nombres: form.nombres.trim(),
      apellidos: form.apellidos.trim(),
      telefono: form.telefono.trim() || null,
      email: form.email.trim() || null,
      direccion: form.direccion.trim() || null,
      activo: true,
    })

    setSaving(false)

    if (insertError) {
      const msg = insertError.message.toLowerCase()
      if (msg.includes('row-level security') || msg.includes('permission')) {
        setError(
          'No tienes permiso para crear pacientes (se requiere rol administrador o administrativo).',
        )
      } else if (msg.includes('duplicate') || msg.includes('unique')) {
        setError('Ya existe un paciente con ese RUT.')
      } else if (msg.includes('stack depth')) {
        setError(
          'Error de RLS (stack depth). Ejecuta supabase/migrations/20260812120000_fix_rls_recursion.sql en el SQL Editor.',
        )
      } else {
        setError(insertError.message)
      }
      return
    }

    setSuccess('Paciente registrado correctamente.')
    setShowForm(false)
    setForm(emptyForm)
    await loadData()
  }

  return (
    <div className="pac">
      <Sidebar moduloActivo="pacientes" />

      <div className="pac-main">
        <header className="pac-topbar">
          <div>
            <h2>Pacientes</h2>
            <p>Registro y consulta de pacientes del centro</p>
          </div>
          {puedeRegistrarPaciente(rol) ? (
            <button
              type="button"
              className="pac-btn-primary"
              onClick={openForm}
              disabled={missingProfile}
            >
              Nuevo paciente
            </button>
          ) : null}
        </header>

        <section className="pac-content">
          {error ? (
            <p className="pac-alert pac-alert-error" role="alert">
              {error}
            </p>
          ) : null}

          {success ? (
            <p className="pac-alert pac-alert-success" role="status">
              {success}
            </p>
          ) : null}

          <div className="pac-card">
            <div className="pac-card-header">
              <div>
                <h3>Listado de pacientes</h3>
                <p className="pac-muted">
                  Datos de contacto · Tabla pacientes
                </p>
              </div>
              <span className="pac-badge">
                {loading
                  ? '…'
                  : `${pacientes.length} registro${pacientes.length === 1 ? '' : 's'}`}
              </span>
            </div>

            {loading ? (
              <p className="pac-loading">Cargando pacientes…</p>
            ) : pacientes.length === 0 ? (
              <p className="pac-empty">
                {missingProfile
                  ? 'Sin perfil staff no se pueden ver pacientes aunque existan en la base.'
                  : 'No hay pacientes registrados. Usa “Nuevo paciente” para crear el primero.'}
              </p>
            ) : (
              <div className="pac-table-wrap">
                <table className="pac-table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>RUT</th>
                      <th>Nombres</th>
                      <th>Apellidos</th>
                      <th>Email</th>
                      <th>Teléfono</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pacientes.map((p) => (
                      <tr key={p.id_paciente}>
                        <td>#{p.id_paciente}</td>
                        <td>{p.rut}</td>
                        <td>{p.nombres}</td>
                        <td>{p.apellidos}</td>
                        <td className="pac-cell-secondary">{p.email || '—'}</td>
                        <td className="pac-cell-secondary">{p.telefono || '—'}</td>
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
          className="pac-modal-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeForm()
          }}
        >
          <div
            className="pac-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="nuevo-paciente-title"
          >
            <div className="pac-modal-header">
              <div>
                <h3 id="nuevo-paciente-title">Nuevo paciente</h3>
                <p>
                  Completa los datos de identificación y contacto. El RUT debe ser único.
                </p>
              </div>
              <button
                type="button"
                className="pac-modal-close"
                onClick={closeForm}
                aria-label="Cerrar"
                disabled={saving}
              >
                ×
              </button>
            </div>

            <form className="pac-form" onSubmit={(e) => void handleCreate(e)}>
              <div className="pac-field">
                <label htmlFor="pac-rut">RUT</label>
                <input
                  id="pac-rut"
                  value={form.rut}
                  onChange={(e) => setForm((f) => ({ ...f, rut: e.target.value }))}
                  placeholder="12.345.678-9"
                  required
                  disabled={saving}
                />
              </div>

              <div className="pac-field">
                <label htmlFor="pac-nombres">Nombres</label>
                <input
                  id="pac-nombres"
                  value={form.nombres}
                  onChange={(e) => setForm((f) => ({ ...f, nombres: e.target.value }))}
                  required
                  disabled={saving}
                />
              </div>

              <div className="pac-field">
                <label htmlFor="pac-apellidos">Apellidos</label>
                <input
                  id="pac-apellidos"
                  value={form.apellidos}
                  onChange={(e) => setForm((f) => ({ ...f, apellidos: e.target.value }))}
                  required
                  disabled={saving}
                />
              </div>

              <div className="pac-field">
                <label htmlFor="pac-telefono">Teléfono</label>
                <input
                  id="pac-telefono"
                  value={form.telefono}
                  onChange={(e) => setForm((f) => ({ ...f, telefono: e.target.value }))}
                  placeholder="+56912345678"
                  disabled={saving}
                />
              </div>

              <div className="pac-field">
                <label htmlFor="pac-email">Email</label>
                <input
                  id="pac-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="paciente@ejemplo.cl"
                  disabled={saving}
                />
              </div>

              <div className="pac-field">
                <label htmlFor="pac-direccion">Dirección</label>
                <input
                  id="pac-direccion"
                  value={form.direccion}
                  onChange={(e) => setForm((f) => ({ ...f, direccion: e.target.value }))}
                  placeholder="Comuna / calle"
                  disabled={saving}
                />
              </div>

              <div className="pac-form-actions">
                <button
                  type="button"
                  className="pac-btn-secondary"
                  onClick={closeForm}
                  disabled={saving}
                >
                  Cancelar
                </button>
                <button type="submit" className="pac-btn-primary" disabled={saving}>
                  {saving ? 'Guardando…' : 'Guardar paciente'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default Pacientes
