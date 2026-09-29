#!/usr/bin/env node
// =============================================================================
// SWIMyti — Guard de secretos (pre-commit)
//
// .gitignore protege rutas; este script protege contenido. Un .md o un .sql
// que se versionan siguen podendo llevar una contraseña adentro, y eso es
// exactamente lo que pasó con el plan de pruebas: el archivo era inocuo,
// salvo por la columna de contraseñas.
//
// Escanea SOLO las líneas agregadas en el staging area (git diff --cached),
// para no ensuciar el output con el historial ya aceptado.
//
// Uso:  node scripts/guardar-secretos.mjs
// Sale con código 1 si encuentra algo, y el commit no se completa.
// =============================================================================

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const RUTA_SECRETOS = join(RAIZ, 'scripts', '.secretos-local.json')

const git = (...args) =>
  execFileSync('git', args, { cwd: RAIZ, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

// -----------------------------------------------------------------------------
// ¿El valor capturado parece una clave o es una palabra cualquiera?
//
// Hace falta porque "contraseña/clave/password: valor" —una línea que explica
// la regla— matchea el patrón con "password" como valor, y "password" son 8
// caracteres. Una clave real casi siempre trae dígito o símbolo; una palabra
// de diccionario, no. Se pierde el caso de una clave solo alfabética, que se
// sigue cubriendo con la lista de secretos conocidos y con la regla de tabla.
// -----------------------------------------------------------------------------
const PALABRAS = /^(password|passwd|contrasena|contrasena|clave|credencial|secreto|token|admin|usuario|ejemplo|example|placeholder|pendiente|reemplazar|cambiar|rotar|rotada|generada)$/i

function pareceClave(valor) {
  if (!valor || valor.length < 8) return false
  if (PALABRAS.test(valor)) return false
  const tieneDigito = /[0-9]/.test(valor)
  const tieneSimbolo = /[!@#$%^&*()_+=\-]/.test(valor)
  return tieneDigito || tieneSimbolo
}

// -----------------------------------------------------------------------------
// Reglas de contenido.
//
// Cada regla es { patron, motivo }. Se prueban sobre el archivo y la línea, así
// que un mismo patrón puede ser legítimo en un archivo y sospechoso en otro
// (ej: service_role es normal en una migración, no en un README).
// -----------------------------------------------------------------------------
const REGLAS = [
  {
    nombre: 'password de demo en texto plano',
    // Exige comillas simples: distingue el literal crypt('CLAVE', ...) del
    // correcto crypt(v_pwd, ...). Sin esto el guard bloquea el seed legítimo.
    patron: /crypt\(\s*'[A-Za-z0-9!@#$%^&*()_+=-]{8,}'\s*,\s*gen_salt\(/i,
    motivo: "crypt('<algo>', gen_salt(...)) con una clave literal dentro del repo",
  },
  {
    nombre: 'clave de servicio de Supabase',
    patron: /sb_secret_[A-Za-z0-9_-]+/,
    motivo: 'las claves sb_secret_ / service_role jamás van en el frontend ni en el repo',
  },
  {
    nombre: 'JWT de Supabase',
    patron: /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/,
    motivo: 'las anon/publishable keys tampoco se commitean; van en frontend/.env',
  },
  {
    nombre: 'contraseña asignada en documentación',
    soloArchivos: /\.(md|mdx|txt|rst|adoc)$/i,
    // \p{L} en vez de [a-z]: si no, "Contraseña" no matchea porque la ñ no
    // es ASCII y la regla se cae justo en el idioma del proyecto.
    patron:
      /(contrase|clave|password|passwd|credencial)[\p{L}\s]{0,12}\s*[:=/]\s*`?['"]?([A-Za-z0-9!@#$%^&*()_+=-]{8,30})['"`]?/iu,
    excepcion: /(\(|ver\b|ninguna|ningun|secreto|placeholder|ejemplo|xxx|\*\*\*|<|>|no aplica|rotada|rotado|cambia|generada|AGENTS?\.md|\.{3})/i,
    motivo: 'documento con una credencial asignada; debe quedar solo en AGENTS.md',
  },
  {
    nombre: 'tabla de credenciales en documentación',
    soloArchivos: /\.(md|mdx|txt|rst|adoc)$/i,
    // El grupo de captura es la clave: sin él, el chequeo de plausibilidad
    // recibe undefined y la regla nunca dispara.
    patron: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\s*[/|]\s*`?['"]?([A-Za-z0-9!@#$%^&*()_+=-]{8,30})/,
    excepcion: /(\(|ver\b|ningun|secreto|xxx|\*\*\*|<|>|AGENTS?\.md|\.{3}|@\?)/i,
    motivo: 'email + contraseña en la misma línea, el formato de una tabla de acceso',
  },
]

// -----------------------------------------------------------------------------
// Secretos conocidos, cargados desde un archivo local ignorado por git.
// Si no existe, el chequeo literal se salta (y lo avisa) pero el resto corre.
// -----------------------------------------------------------------------------
function cargarSecretosConocidos() {
  if (!existsSync(RUTA_SECRETOS)) return null
  try {
    const crudo = JSON.parse(readFileSync(RUTA_SECRETOS, 'utf8'))
    return Array.isArray(crudo) ? crudo.filter((s) => typeof s === 'string' && s.length >= 6) : null
  } catch (e) {
    console.error(`  ! ${RUTA_SECRETOS} no es JSON válido: ${e.message}`)
    return null
  }
}

// -----------------------------------------------------------------------------
// Diff staged, solo líneas agregadas, con el archivo al que pertenecen.
// -----------------------------------------------------------------------------
function lineasAgregadas() {
  let diff
  try {
    diff = git('diff', '--cached', '-U0', '--no-color', '--diff-filter=ACMR')
  } catch {
    return []
  }

  const salida = []
  let archivo = null

  for (const linea of diff.split('\n')) {
    if (linea.startsWith('+++ b/')) {
      archivo = linea.slice(6)
      continue
    }
    if (linea.startsWith('diff --git')) {
      archivo = null
      continue
    }
    if (linea.startsWith('+++ ') || linea.startsWith('--- ')) continue
    if (archivo && linea.startsWith('+') && !linea.startsWith('+++')) {
      salida.push({ archivo, texto: linea.slice(1) })
    }
  }
  return salida
}

function escapar(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// -----------------------------------------------------------------------------
// Corrida
// -----------------------------------------------------------------------------
const hallazgos = []

for (const { archivo, texto } of lineasAgregadas()) {
  for (const regla of REGLAS) {
    if (regla.soloArchivos && !regla.soloArchivos.test(archivo)) continue
    const m = texto.match(regla.patron)
    if (!m) continue
    if (regla.excepcion && regla.excepcion.test(texto)) continue
    // Para la regla de "contraseña asignada", la excepción se evalúa sobre el
    // valor capturado, no sobre toda la línea: "Contraseña: ver AGENTS.md"
    // tiene un valor que no es una credencial y debe pasar.
    if (regla.soloArchivos) {
      const valor = m[2] || m[1] || ''
      if (pareceClave(valor)) {
        hallazgos.push({ archivo, linea: texto, regla, valor })
      }
      continue
    }
    hallazgos.push({ archivo, linea: texto, regla, valor: m[1] })
  }
}

const conocidos = cargarSecretosConocidos()
if (conocidos) {
  for (const { archivo, texto } of lineasAgregadas()) {
    for (const secreto of conocidos) {
      if (texto.includes(secreto)) {
        hallazgos.push({
          archivo,
          linea: texto,
          regla: { nombre: 'secreto conocido', motivo: `coincide con scripts/.secretos-local.json` },
          valor: secreto.slice(0, 3) + '…',
        })
      }
    }
  }
}

if (hallazgos.length === 0) {
  if (!conocidos) {
    console.log('  guard: sin secretos en el staging (chequeo literal omitido: falta scripts/.secretos-local.json)')
  }
  process.exit(0)
}

console.error('')
console.error('  COMMIT BLOQUEADO — se detectaron posibles secretos\n')
for (const h of hallazgos) {
  console.error(`  ${h.archivo}`)
  console.error(`    regla : ${h.regla.nombre}`)
  console.error(`    motivo: ${h.regla.motivo}`)
  console.error(`    linea : ${h.linea.trim().slice(0, 120)}`)
  console.error('')
}
console.error('  Qué hacer:')
console.error('    1. Saca la credencial del archivo y deja solo una referencia (ej: "ver AGENTS.md").')
console.error('    2. Guarda el valor en AGENTS.md, que está en .gitignore.')
console.error('    3. Vuelve a agregar el archivo y commitea.')
console.error('')
console.error('  Para omitir (solo si sabes que es un falso positivo, y anótalo en el commit):')
console.error('    git commit --no-verify')
console.error('')
process.exit(1)
