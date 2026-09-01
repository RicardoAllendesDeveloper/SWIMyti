import { BrowserRouter, Navigate, Routes, Route } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import RoleRoute from './components/RoleRoute'
import Citas from './pages/Citas'
import Dashboard from './pages/Dashboard'
import DetalleFicha from './pages/DetalleFicha'
import Disponibilidad from './pages/Disponibilidad'
import Interconsultas from './pages/Interconsultas'
import Landing from './pages/Landing'
import Login from './pages/Login'
import Pacientes from './pages/Pacientes'
import Portal from './pages/Portal'
import Registro from './pages/Registro'
import Usuarios from './pages/Usuarios'
import './styles/App.css'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/registro" element={<Registro />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <RoleRoute roles={['administrador', 'doctor', 'enfermeria', 'administrativo', 'unidad_apoyo']}>
                <Dashboard />
              </RoleRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/pacientes"
          element={
            <ProtectedRoute>
              <RoleRoute roles={['administrador', 'doctor', 'enfermeria', 'administrativo', 'unidad_apoyo']}>
                <Pacientes />
              </RoleRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/ficha/:id"
          element={
            <ProtectedRoute>
              <DetalleFicha />
            </ProtectedRoute>
          }
        />
        <Route
          path="/usuarios"
          element={
            <ProtectedRoute>
              <RoleRoute roles={['administrador']}>
                <Usuarios />
              </RoleRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/disponibilidad"
          element={
            <ProtectedRoute>
              <RoleRoute roles={['administrador', 'doctor']}>
                <Disponibilidad />
              </RoleRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/citas"
          element={
            <ProtectedRoute>
              <Citas />
            </ProtectedRoute>
          }
        />
        <Route
          path="/interconsultas"
          element={
            <ProtectedRoute>
              <RoleRoute roles={['enfermeria', 'doctor', 'administrativo', 'administrador', 'paciente']}>
                <Interconsultas />
              </RoleRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/portal"
          element={
            <ProtectedRoute>
              <RoleRoute roles={['paciente', 'administrador', 'administrativo']}>
                <Portal />
              </RoleRoute>
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
