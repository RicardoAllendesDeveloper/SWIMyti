import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/index.css'
import { AuthRolProvider } from './context/AuthRolContext'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthRolProvider>
      <App />
    </AuthRolProvider>
  </StrictMode>,
)
