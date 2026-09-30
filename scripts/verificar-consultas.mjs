// Verifica que TODAS las consultas que el frontend manda a Supabase siguen siendo
// validas contra la base real. Corre sin navegador, en segundos, y sale con
// codigo 1 si algo no cuadra, para poder engancharlo al build.
//
// Que atrapa, y por que existe:
//
//   1) ESPACIO ENTRE DOS PARENTESIS DE CIERRE. Ese es el unico fallo real de
//      sintaxis en los embeds:  parent(child(a, b) )  no parsea, y tampoco
//      parent(child(a, b) ). Hay que cerrar pegado. Todo lo demas se tolera:
//      el espacio antes del parentesis de apertura va bien, el de despues
//      tambien, y los espacios dentro de los embeds internos van bien.
//      Confundido, porque los dos estilos conviven en el mismo archivo y el
//      codigo parece consistente. Con un template literal multilinea el salto
//      de linea se convierte en espacio y cae solo. Rompio 7 pantallas
//      (Portal, Citas, Disponibilidad, Expediente, DetalleFicha, Usuarios) el
//      2026-09-30 y no lo atrapo ninguna revision.
//
//   2) COLUMNAS INEXISTENTES. Una columna renombrada en la BD devuelve
//      PGRST204 y la pantalla queda vacia sin aviso claro.
//
//   3) RPCs: que el cliente mande los nombres de parametro correctos.
//
// Sobre la existencia de las funciones RPC: NO se puede comprobar por HTTP con
// la anon key. Un POST a /rpc/<fn> con {} devuelve PGRST202 tanto si la funcion
// existe con parametros con nombre como si no existe en absoluto, y el spec
// OpenAPI de este proyecto responde 401. Por eso la firma se compara contra el
// snapshot de abajo. Lo que si se detecta es que el cliente mande un
// parametro que la funcion no tiene, que es el error real que se busca.
//
// Uso:
//   ADMIN_PASSWORD='...' node scripts/verificar-consultas.mjs
//
// No imprime la anon key ni la clave: solo tabla, archivo y mensaje de error.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// Anclado a la ubicacion del script, no al cwd: asi funciona igual desde la
// raiz del repo o desde frontend/.
const raiz = dirname(dirname(fileURLToPath(import.meta.url)))
const env = readFileSync(join(raiz, 'frontend', '.env'), 'utf8')
const url = env.match(/VITE_SUPABASE_URL=(.+)/)?.[1]?.trim()
const key = env.match(/VITE_SUPABASE_ANON_KEY=(.+)/)?.[1]?.trim()

if (!url || !key) {
  console.log('  ! falta VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY en frontend/.env')
  process.exit(1)
}

const password = process.env.ADMIN_PASSWORD
if (!password) {
  console.log("  ! falta ADMIN_PASSWORD. Va en AGENTS.md, no en ningun archivo del repo.")
  console.log("    ADMIN_PASSWORD='...' node scripts/verificar-consultas.mjs")
  process.exit(1)
}

// Snapshot de firmas RPC.
// Fuente: select proname, pg_get_function_identity_arguments(oid) from pg_proc,
// 2026-09-30. Si cambias una firma en la BD, actualiza esta lista en la misma
// migracion que cambie la firma.
const FIRMAS_RPC = {
  fn_auto_registro_paciente: [
    'p_rut', 'p_nombres', 'p_apellidos', 'p_telefono', 'p_email',
    'p_direccion', 'p_fecha_nacimiento', 'p_sexo', 'p_prevision',
  ],
  fn_crear_usuario: ['p_email', 'p_password', 'p_nombres', 'p_apellidos', 'p_id_rol', 'p_rut'],
  fn_eliminar_bloques_jornada: ['p_fecha', 'p_id_especialidad', 'p_id_profesional'],
  fn_generar_bloques_jornada: [
    'p_id_profesional', 'p_id_especialidad', 'p_fecha_inicio', 'p_fecha_fin',
    'p_hora_inicio', 'p_hora_fin', 'p_dias',
  ],
  fn_paciente_liberar_cita: ['p_id_cita'],
  fn_paciente_liberar_toma_muestra: ['p_id_orden'],
  fn_paciente_reservar_toma_muestra: ['p_id_orden', 'p_id_horario'],
  fn_rem_resumen: [],
}

function archivos(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) archivos(p, acc)
    else if (/\.tsx?$/.test(p)) acc.push(p)
  }
  return acc
}

let token
try {
  const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@swimyti.cl', password }),
  })
  if (!r.ok) throw new Error(`login devolvio ${r.status}`)
  token = (await r.json()).access_token
} catch (e) {
  console.log(`  ! no se pudo autenticar como administrador: ${e.message}`)
  process.exit(1)
}

async function consultar(ruta) {
  const r = await fetch(`${url}/rest/v1/${ruta}`, {
    headers: { apikey: key, Authorization: `Bearer ${token}` },
  })
  const cuerpo = await r.text()
  if (r.ok) return { ok: true }
  let msg = cuerpo.slice(0, 200)
  try { msg = JSON.parse(cuerpo).message ?? msg } catch { /* texto plano */ }
  return { ok: false, code: r.status, msg }
}

const consultas = new Map()
const rpcs = []
const RE_SELECT = /\.select\(\s*(`[^`]*`|['"][^'"]*['"](?:\s*\+\s*['"][^'"]*['"])*|[A-Z_][A-Z0-9_]*)?/s
const RE_CONST = /const\s+([A-Z_][A-Z0-9_]*)\s*=\s*(`[^`]*`|['"][^'"]*['"])/g
const RE_LIT = /['"]([^'"]*)['"]|`([^`]*)`/

for (const ruta of archivos(join(raiz, 'frontend', 'src'))) {
  const src = readFileSync(ruta, 'utf8')
  const nombre = ruta.split(/[\\/]/).pop()

  const constantes = {}
  for (const m of src.matchAll(RE_CONST)) constantes[m[1]] = m[2].slice(1, -1)

  for (const m of src.matchAll(/\.from\(\s*['"]([a-z_]+)['"]\s*\)/g)) {
    const tabla = m[1]
    const cola = src.slice(m.index + m[0].length, m.index + m[0].length + 400)
    const s = RE_SELECT.exec(cola)
    if (!s || s[1] === undefined) continue
    let sel
    if (/^[A-Z_][A-Z0-9_]*$/.test(s[1])) sel = constantes[s[1]]
    else {
      const d = RE_LIT.exec(s[1])
      sel = d ? [d[1], d[2]].filter(Boolean).join('') : ''
    }
    if (!sel) continue

    // Anidado = hay un parentesis DENTRO de otro. Se detectan con la posicion
    // de los parentesis: si el cierre del primero no es el ultimo caracter.
    let anidado = false
    for (let i = 0; i < sel.length; i++) {
      if (sel[i] !== '(') continue
      let prof = 0
      for (let j = i; j < sel.length; j++) {
        if (sel[j] === '(') prof++
        else if (sel[j] === ')' && --prof === 0) { if (j < sel.length - 1) anidado = true; break }
      }
      if (anidado) break
    }

    const id = `${tabla}|${sel}`
    if (!consultas.has(id)) {
      consultas.set(id, {
        tabla,
        sel: sel.split(/\s+/).join(' ').trim(),
        anidado,
        donde: `${nombre}:${src.slice(0, m.index).split('\n').length}`,
      })
    }
  }

  for (const m of src.matchAll(/\.rpc\(\s*['"]([a-z_0-9]+)['"]\s*,\s*\{/g)) {
    const apertura = src.indexOf('{', m.index + m[0].length - 1)
    let prof = 0
    let fin = null
    for (let i = apertura; i < src.length; i++) {
      if (src[i] === '{') prof++
      else if (src[i] === '}' && --prof === 0) { fin = i; break }
    }
    if (fin === null) continue
    const cuerpo = src.slice(apertura + 1, fin)
    const enviados = [...new Set([...cuerpo.matchAll(/['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?\s*:/g)].map(x => x[1]))]
    rpcs.push({
      fn: m[1],
      enviados,
      donde: `${nombre}:${src.slice(0, m.index).split('\n').length}`,
    })
  }
}

const normas = [...consultas.values()]
let fallas = 0
let avisos = 0
const pad = s => String(s).padEnd(30)

console.log('')
console.log('=== embeds anidados: sin espacio entre dos parentesis de cierre ===')
for (const c of normas.filter(x => x.anidado)) {
  const r = await consultar(`${c.tabla}?select=${encodeURIComponent(c.sel)}&limit=1`)
  if (r.ok) console.log(`  OK    ${pad(c.donde)} ${c.tabla}`)
  else { fallas++; console.log(`  FALLA ${pad(c.donde)} ${c.tabla}  [${r.code}] ${r.msg}`) }
}
console.log(`  ${normas.filter(x => x.anidado).length} embeds anidados`)

console.log('')
console.log('=== selects simples: columnas que existen ===')
for (const c of normas.filter(x => !x.anidado)) {
  const r = await consultar(`${c.tabla}?select=${encodeURIComponent(c.sel)}&limit=1`)
  if (r.ok) console.log(`  OK    ${pad(c.donde)} ${c.tabla}`)
  else { fallas++; console.log(`  FALLA ${pad(c.donde)} ${c.tabla}  [${r.code}] ${r.msg}`) }
}
console.log(`  ${normas.filter(x => !x.anidado).length} selects simples`)

console.log('')
console.log('=== RPCs: parametros que el cliente manda ===')
const vistas = new Set()
for (const r of rpcs) {
  const id = r.fn + r.donde
  if (vistas.has(id)) continue
  vistas.add(id)
  const firma = FIRMAS_RPC[r.fn]
  if (!firma) {
    avisos++
    console.log(`  ?     ${pad(r.donde)} ${r.fn}  no esta en el snapshot: agregalo`)
    continue
  }
  // Los parametros con DEFAULT NULL se pueden omitir, y el snapshot no los
  // distingue, asi que solo se exige no mandar parametros inexistentes.
  const inventados = r.enviados.filter(a => !firma.includes(a))
  if (inventados.length) {
    fallas++
    console.log(`  FALLA ${pad(r.donde)} ${r.fn}  manda parametros inexistentes: ${inventados.join(', ')}`)
  } else {
    console.log(`  OK    ${pad(r.donde)} ${r.fn}  (${r.enviados.length} de ${firma.length} args)`)
  }
}

console.log('')
console.log(`consultas: ${normas.length} | rpcs: ${rpcs.length} | fallas: ${fallas} | avisos: ${avisos}`)
if (fallas > 0) {
  console.log('')
  console.log('El frontend tiene consultas que la base rechaza. No sigas probando a mano')
  console.log('hasta arreglarlas: van a fallar siempre y no son culpa del tester.')
  process.exit(1)
}
console.log('Todo cuadra contra la base real.')