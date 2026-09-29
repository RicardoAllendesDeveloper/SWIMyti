// Verifica que las 6 cuentas demo pueden autenticarse de verdad contra la API
// de Supabase. No imprime la anon key ni las claves: solo email + resultado.
//
// Uso: node scripts/verificar-login-demo.mjs
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const raiz = process.cwd()
const env = readFileSync(join(raiz, 'frontend', '.env'), 'utf8')
const url = env.match(/VITE_SUPABASE_URL=(.+)/)?.[1]?.trim()
const key = env.match(/VITE_SUPABASE_ANON_KEY=(.+)/)?.[1]?.trim()

if (!url || !key) {
  console.log('  ! falta VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY en frontend/.env')
  process.exit(1)
}

const CUENTAS = [
  ['doctor.demo@swimyti.cl', process.env.DEMO_DOCTOR],
  ['enfermeria.demo@swimyti.cl', process.env.DEMO_ENFERMERIA],
  ['jefatura.demo@swimyti.cl', process.env.DEMO_JEFATURA],
  ['admin.demo@swimyti.cl', process.env.DEMO_ADMIN],
  ['apoyo.demo@swimyti.cl', process.env.DEMO_APOYO],
  ['paciente.demo@swimyti.cl', process.env.DEMO_PACIENTE],
].filter(([, p]) => p)

let ok = 0
let fallos = 0

for (const [email, clave] of CUENTAS) {
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: clave }),
  })
  const cuerpo = await res.json()
  const entra = res.ok && Boolean(cuerpo.access_token)
  const detalle = entra
    ? 'ok'
    : cuerpo.error_description || cuerpo.msg || cuerpo.error || `http ${res.status}`
  console.log(`  ${entra ? 'ok  ' : 'FALLA'}  ${email.padEnd(28)} ${detalle}`)
  entra ? ok++ : fallos++
}

console.log(`\n  ${ok} pueden autenticarse, ${fallos} no`)
process.exit(fallos === 0 ? 0 : 1)
