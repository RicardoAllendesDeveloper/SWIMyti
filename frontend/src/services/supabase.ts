import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() ?? ''
const supabaseAnonKey =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() ?? ''

function validateSupabaseConfig(url: string, key: string): string | null {
  if (!url || !key) {
    return 'Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY en frontend/.env'
  }

  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url)) {
    return 'VITE_SUPABASE_URL inválida. Debe ser https://TU_REF.supabase.co (Project URL en Supabase → Settings → API).'
  }

  if (key.startsWith('sb_secret_') || key.includes('service_role')) {
    return 'Estás usando la secret/service key. En el frontend solo va la anon key o publishable key (nunca sb_secret_).'
  }

  const looksLikeJwt = key.startsWith('eyJ') && key.split('.').length === 3
  const looksLikePublishable = key.startsWith('sb_publishable_')

  if (!looksLikeJwt && !looksLikePublishable) {
    return 'VITE_SUPABASE_ANON_KEY inválida. Copia la anon public key (eyJ...) o la publishable key (sb_publishable_...).'
  }

  return null
}

export const supabaseConfigError = validateSupabaseConfig(supabaseUrl, supabaseAnonKey)

export const supabase: SupabaseClient = createClient(
  supabaseConfigError ? 'https://placeholder.supabase.co' : supabaseUrl,
  supabaseConfigError ? 'placeholder-key' : supabaseAnonKey,
)
