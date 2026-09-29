// Suite de pruebas del guard de secretos
// Uso: node scripts/probar-guard.mjs
// Valida que el guard bloquee lo que debe y NO bloquee lo que no debe.
// Un guard que llora falso positivo se termina usando con --no-verify, y un
// guard que no llora no sirve. Hay que probar los dos sentidos.

import { execFileSync } from 'node:child_process'
import { writeFileSync, unlinkSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = process.cwd()
const ARCHIVO = join(RAIZ, 'prueba-guard.md')

// Las claves reales NO van hardcodeadas acá: el guard bloquearía este mismo
// archivo, que sería poético pero inútil. Para probar la detección de secretos
// conocidos se toma una clave de la lista local en tiempo de ejecución.
const RUTA_SECRETOS = join(RAIZ, 'scripts', '.secretos-local.json')
const claveConocida =
  existsSync(RUTA_SECRETOS) && JSON.parse(readFileSync(RUTA_SECRETOS, 'utf8'))[0]

const CASOS = [
  // [nombre, contenido, debe_bloquear]
  ['tabla de acceso con clave conocida', `| Admin | admin@swimyti.cl | ${claveConocida} |`, true],
  ['tabla con clave desconocida', '| Admin | admin@swimyti.cl | Zz9#kQ_no_esta_en_lista |', true],
  ['clave asignada con tilde', 'Contraseña del admin: `Wq7#fK_Zx3mQ_Prueba`', true],
  ['password asignado', 'password: qwertyApiKey2026!', true],
  ['documento que explica la regla', '- En `.md`: "contraseña/clave/password: valor" con un valor plausible.', false],
  ['referencia a AGENTS.md', 'Contraseña: ver AGENTS.md', false],
  ['clave rotada', 'Contraseña: rotada el 2026-09-28', false],
  ['placeholder generico', 'Contraseña: <la-que-se-usa>', false],
  ['tabla sin clave', '| Rol | Correo | Acceso |\n| admin | admin@swimyti.cl | ver AGENTS.md |', false],
  ['set_config con valor de ejemplo', "select set_config('app.demo_pwd_doctor', 'la-clave-que-quieras', false);", false],
  ['descripcion de rotacion', 'Las claves se rotan con rotar_contrasenas_demo.sql', false],
]

const git = (...args) => execFileSync('git', args, { cwd: RAIZ, encoding: 'utf8' })
const correr = () => {
  try {
    execFileSync('node', [join(RAIZ, 'scripts', 'guardar-secretos.mjs')], { cwd: RAIZ, encoding: 'utf8', stdio: 'pipe' })
    return 0
  } catch (e) {
    return e.status ?? 1
  }
}

let ok = 0
let fallos = 0

for (const [nombre, contenido, debeBloquear] of CASOS) {
  writeFileSync(ARCHIVO, contenido + '\n', 'utf8')
  git('add', 'prueba-guard.md')
  const bloquea = correr() !== 0
  git('reset', '-q', 'prueba-guard.md')
  const bien = bloquea === debeBloquear
  if (bien) ok++
  else fallos++
  const marca = bien ? 'ok  ' : 'FALLA'
  const resultado = bloquea ? 'bloquea' : 'deja pasar'
  console.log(`  ${marca}  [${resultado.padEnd(12)}] ${nombre}`)
  if (!bien) console.log(`         esperaba: ${debeBloquear ? 'bloquear' : 'dejar pasar'}`)
}

try { unlinkSync(ARCHIVO) } catch {}

// Además, los archivos reales del proyecto deben pasar.
console.log('\n  -- archivos reales del staging --')
const staged = git('diff', '--cached', '--name-only').split('\n').filter(Boolean)
git('add', '.')
const bloqueaStaging = correr() !== 0
try { unlinkSync(ARCHIVO) } catch {}
if (bloqueaStaging) {
  console.log('  FALLA  el staging real tiene hallazgos')
  fallos++
} else {
  console.log(`  ok    el staging real pasa limpio (${staged.length} archivos pendientes)`)
  ok++
}

console.log(`\n  ${ok} ok, ${fallos} fallas`)
process.exit(fallos === 0 ? 0 : 1)
