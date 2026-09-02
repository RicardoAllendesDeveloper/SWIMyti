import { Link } from 'react-router-dom'
import '../styles/Landing.css'

const ESPECIALIDADES = [
  'Medicina General',
  'Pediatría',
  'Ginecología',
  'Cardiología',
  'Traumatología',
  'Dermatología',
  'Odontología',
]

const CARACTERISTICAS = [
  {
    titulo: 'Fichas inmutables',
    texto:
      'Historiales clínicos que no pueden editarse ni eliminarse. Cualquier corrección se registra como enmienda auditada con firma digital.',
  },
  {
    titulo: 'Toma de horas online',
    texto:
      'Reserva tus atenciones por especialidad y profesional, desde cualquier dispositivo, sin llamadas ni filas.',
  },
  {
    titulo: 'Portal del paciente',
    texto:
      'Accede a tus citas, consultas previas, ficha médica y resultados de exámenes en un solo lugar.',
  },
  {
    titulo: 'Seguridad por diseño',
    texto:
      'Control de acceso por rol (RBAC), encriptación de credenciales y trazabilidad completa de cada operación.',
  },
]

function Landing() {
  return (
    <div className="land">
      <header className="land-header">
        <Link to="/" className="land-brand">
          <div className="land-brand-mark" aria-hidden="true">
            SW
          </div>
          <div>
            <span className="land-brand-name">SWIMyti</span>
            <span className="land-brand-tag">Gestión clínica integral</span>
          </div>
        </Link>
        <nav className="land-nav" aria-label="Navegación del sitio">
          <a href="#inicio">Inicio</a>
          <a href="#servicios">Servicios</a>
          <a href="#nosotros">Nosotros</a>
        </nav>
        <div className="land-header-actions">
          <Link className="land-btn-ghost" to="/login">
            Ingresar
          </Link>
          <Link className="land-btn-solid" to="/registro">
            Crear cuenta
          </Link>
        </div>
      </header>

      <main>
        <section className="land-hero" id="inicio">
          <div className="land-hero-content">
            <p className="land-eyebrow">Centro de salud de mediana y baja complejidad</p>
            <h1>Tu salud, con la seguridad y trazabilidad que mereces</h1>
            <p className="land-hero-text">
              SWIMyti es el sistema web integral que digitaliza la gestión clínica:
              fichas médicas inmutables, toma de horas online y acceso a tus
              resultados en cualquier momento.
            </p>
            <div className="land-hero-actions">
              <Link className="land-btn-solid" to="/registro">
                Solicitar cuenta de paciente
              </Link>
              <a className="land-btn-ghost" href="#servicios">
                Ver especialidades
              </a>
            </div>
          </div>
          <div className="land-hero-aside" aria-hidden="true">
            <div className="land-hero-card land-hero-card-1">Ficha médica inmutable</div>
            <div className="land-hero-card land-hero-card-2">Agenda tu hora online</div>
            <div className="land-hero-card land-hero-card-3">Resultados de exámenes</div>
          </div>
        </section>

        <section className="land-section" id="servicios">
          <div className="land-section-head">
            <h2>Especialidades disponibles</h2>
            <p>
              Agenda tu atención con nuestros profesionales por especialidad.
            </p>
          </div>
          <div className="land-grid land-grid-especialidades">
            {ESPECIALIDADES.map((especialidad) => (
              <div className="land-card" key={especialidad}>
                <div className="land-card-icon" aria-hidden="true">
                  {especialidad[0]}
                </div>
                <h3>{especialidad}</h3>
              </div>
            ))}
          </div>
        </section>

        <section className="land-section land-section-alt" id="nosotros">
          <div className="land-section-head">
            <h2>¿Por qué SWIMyti?</h2>
            <p>Una plataforma pensada para centros ambulatorios modernos.</p>
          </div>
          <div className="land-grid land-grid-caracteristicas">
            {CARACTERISTICAS.map((c) => (
              <div className="land-card" key={c.titulo}>
                <h3>{c.titulo}</h3>
                <p>{c.texto}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="land-cta">
          <h2>¿Eres paciente y quieres acceder a tu información?</h2>
          <p>
            Crea tu cuenta en minutos y gestiona tus citas, fichas y exámenes online.
          </p>
          <div className="land-hero-actions">
            <Link className="land-btn-solid" to="/registro">
              Crear cuenta de paciente
            </Link>
            <Link className="land-btn-outline-light" to="/login">
              Ya tengo cuenta
            </Link>
          </div>
        </section>
      </main>

      <footer className="land-footer">
        <p>
          SWIMyti — Sistema Web Integral Multi-rol y Trazabilidad Inmutable
        </p>
        <p className="land-footer-muted">
          Proyecto de título · Ingeniería en Informática
        </p>
      </footer>
    </div>
  )
}

export default Landing