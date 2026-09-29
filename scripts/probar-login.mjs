// Prueba una sola cuenta, con email y clave por argumentos, e imprime solo el
// resultado. Para verificar cuentas que no son demo (ej: la de administrador
// real), que el script de las 6 no cubre.
//
// Uso: node scripts/probar-login.mjs <correo> <clave>
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const [email, clave] = process.argv.slice(2)
if (!email || !clave) {
  console.log('uso: node scripts/probar-login.mjs <correo> <clave>')
  process.exit(2)
}

const env = readFileSync(join(process.cwd(), 'frontend', '.env'), 'utf8')
const url = env.match(/VITE_SUPABASE_URL=(.+)/)?.[1]?.trim()
const key = env.match(/VITE_SUPABASE_ANON_KEY=(.+)/)?.[1]?.trim()

const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: key, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password: clave }),
})
const cuerpo = await res.json()
const entra = res.ok && Boolean(cuerpo.access_token)
console.log(
  `  ${entra ? 'ok' : 'rechazada'}  ${email}  ${entra ? '' : cuerpo.error_description || cuerpo.msg || cuerpo.error || `http ${res.status}`}`
)
process.exit(entra ? 0 : 1)
