import { useEffect, useState, type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { supabase, supabaseConfigError } from '../services/supabase'

type ProtectedRouteProps = {
  children: ReactNode
}

function ProtectedRoute({ children }: ProtectedRouteProps) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(!supabaseConfigError)

  useEffect(() => {
    if (supabaseConfigError) {
      setLoading(false)
      return
    }

    let active = true

    const timeoutId = window.setTimeout(() => {
      if (!active) return
      setLoading(false)
    }, 4000)

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return
        setSession(data.session)
      })
      .catch(() => {
        if (!active) return
        setSession(null)
      })
      .finally(() => {
        if (!active) return
        window.clearTimeout(timeoutId)
        setLoading(false)
      })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setLoading(false)
    })

    return () => {
      active = false
      window.clearTimeout(timeoutId)
      subscription.unsubscribe()
    }
  }, [])

  if (loading) {
    return (
      <main>
        <p>Cargando...</p>
      </main>
    )
  }

  if (!session) {
    return <Navigate to="/login" replace />
  }

  return children
}

export default ProtectedRoute
