# Protocolo de manejo de secretos — SWIMyti

Vigente desde 2026-09-29. Si algo de este documento contradice tu criterio en
el momento, gana tu criterio: dilo y actualizamos el protocolo.

## Por qué existe

Porque ya pasó dos veces:

1. `supabase/seed_usuarios_demo.sql` estuvo **siete commits** con las seis
   contraseñas de las cuentas demo en texto plano, dentro de `crypt('...')`.
2. `docs/PLAN_PRUEBAS_MANUALES.md` se comiteó con las siete contraseñas en una
   tabla de acceso.

Ninguno de los dos archivos parecía sospechoso a simple vista. Por eso el
protocolo no se apoya en la buena fe sino en tres capas.

## Las tres capas

| Capa | Qué hace | Dónde vive |
|---|---|---|
| 1. Ignorar | Impide que un archivo con credenciales se versione | `.gitignore` |
| 2. Guard | Bloquea el commit si el contenido tiene una clave | `.githooks/pre-commit` |
| 3. Rotar | Invalida la clave aunque se haya filtrado | `supabase/rotar_contrasenas_demo.sql` |

La capa 1 sola no alcanza: un `.md` o un `.sql` que sí se versionan también
pueden llevar una contraseña adentro. Ese fue exactamente el punto ciego.

## Capa 1 — Dónde viven las credenciales

**Único lugar permitido: `AGENTS.md` en la raíz.** Está en `.gitignore` y no
debe salir nunca de tu máquina.

Lo que sí puede(versionarse) es la *referencia*: "ver AGENTS.md", o el email de
la cuenta sin la clave. Nunca el valor.

También ignorados, por si los creas: `*.secret`, `*credencial*`, `privado/`,
`sensibles/`, `*.bundle`, `*.dump`, `frontend/.env`.

## Capa 2 — El guard

El hook está en `.githooks/` y se activa una vez por clonación:

```bash
git config core.hooksPath .githooks
```

Escanea **solo las líneas agregadas** en el staging area, así que no ensucia el
output con el historial ya aceptado. Detecta:

- `crypt('CLAVE', gen_salt(...))` con literal en cualquier `.sql`.
- `sb_secret_...` y JWTs de Supabase (`eyJ...`), que son claves de la API.
- En `.md`/`.txt`: "contraseña/clave/password: valor" con un valor plausible.
- En `.md`/`.txt`: email y contraseña en la misma línea (el formato de tabla
  de acceso que rundownó el plan de pruebas).
- Cualquier coincidencia exacta con las claves que tengas en
  `scripts/.secretos-local.json` (ignorado por git).

Para que reconozca tus claves actuales, mantenlas ahí como un JSON de strings:

```json
["ClaveActual1", "ClaveActual2"]
```

**Sobre los falsos positivos.** El guard tiene excepción para
`ver AGENTS.md`, `rotada`, `secreto`, `xxx`, `<placeholder>`, etc. Si igual
te bloquea algo legítimo, el bypass es `git commit --no-verify` — pero solo si
confirmaste que es un valor falso, y menciónalo en el mensaje del commit. Un
guard que se ignora seguido se desactiva para siempre, así que hay que usarlo
como red, no como muro.

Ejecutarlo a mano cuando quieras revisar el staging:

```bash
node scripts/guardar-secretos.mjs
```

Y correr su propia suite de 12 casos (6 que deben bloquear, 6 que deben pasar):

```bash
node scripts/probar-guard.mjs
```

**Limitaciones conocidas, para no confiar de más.** La lista de excepciones es
deliberadamente amplia (`ver`, `secreto`, `ejemplo`, `placeholder`, `rotada`,
`generada`…), y eso tiene un costo: una clave que contenga alguna de esas
palabras —tipo `Wq7#fK_Ejemplo_Prueba`— se escapa de las reglas heurísticas.
Por eso el exceptuado va parejo con dos redes que no dependan de palabras:
la lista de `scripts/.secretos-local.json` y el filtro de historia. El guard
es una red, no una garantía: seguir evitando `git add -A` sigue siendo la regla
que más importa.

## Capa 3 — Rotar al terminar cada batería de pruebas

**Se rota solo si la batería concludes con todos los errores resueltos.** Si
quedó algún caso fallando, primero se arregla: rotar con un bug abierto
complica leer los pasos que ya sabías que fallaban.

Pasos:

1. Correr `supabase/rotar_contrasenas_demo.sql` en el SQL Editor.
2. El script imprime `email`, `clave` y si fue `definida por el tester` o
   `generada`.
3. Copiar las claves nuevas a `AGENTS.md` y cerrar el editor.
4. Verificar que el nuevo plan quedó_stageado limpio:
   `node scripts/guardar-secretos.mjs`.

El script no contiene claves. Lee cada una de una variable de sesión:

```sql
select set_config('app.demo_pwd_doctor', 'la-clave-que-quieras', false);
```

Claves por ROL: `app.demo_pwd_doctor`, `_enfermeria`, `_administrativo`,
`_apoyo`, `_paciente`, `_jefatura`. Si no defines una, se genera sola con
formato `Sw` + 12 hex + `!7` (16 caracteres con mayúscula, minúscula, dígito y
símbolo, que es lo que pide el password strength de Supabase).

Las cuentas con clave *generada* solo se muestran esa vez. Si pierdes el
resultado, genera de nuevo: no hay forma de recuperarla.

**Trampa al correrlo por MCP.** El SQL Editor muestra todos los result sets, pero
`supabase_execute_sql` devuelve **solo el último**. Con el script tal cual (que
crea una tabla temporal, rota dentro de un `do $$`, y después consulta esa
tabla), el `select` con las claves se traga y quedan las 6 cuentas con claves
nuevas que nadie conoce. Para correrlo por MCP, usa una sola sentencia con CTE
y `update ... returning`, que sí retorna las claves como último result set:

```sql
with generada as (
  select u.id, u.email,
         'Sw' || substr(md5(random()::text || clock_timestamp()::text),1,12) || '!7' as clave
    from auth.users u
   where u.email like '%demo@swimyti.cl'
), rotado as (
  update auth.users a
     set encrypted_password = crypt(g.clave, gen_salt('bf')), updated_at = now()
    from generada g where a.id = g.id
  returning g.email, g.clave
)
select email, clave from rotado order by email;
```

**La cuenta de administrador real no la cubre este script**, porque no la crea
el seed. Si su clave estuvo alguna vez en el historial, hay que rotarla por
separado (mismo CTE, filtrando por `admin@swimyti.cl`) y verificarla con
`node scripts/probar-login.mjs <correo> <clave>`.

## Crear las cuentas demo por primera vez

`supabase/seed_usuarios_demo.sql`, mismo mecanismo: clave por variable de
sesión o autogenerada e impresa una vez al final. El seed **solo crea**;
no resetea claves de cuentas que ya existen. Para eso, el script de rotación.

## Si un secreto ya se filtró

1. **Rotar primero.** Es lo único que invalida la clave filtrada. Todo lo demás
   es limpieza de rastro.
2. Borrar el archivo del working tree y volver a agregarlo sin el secreto.
3. Si llegó a un commit pusheado, reescribir historia (ver abajo).
4. Si el repo estuvo público, avisar a GitHub Support para purgar las vistas
   cacheadas (forks, PRs,issus). Desde 2019 no es automático.

### Reescribir historia

El repo es privado, pero el costo de hacerlo es bajo y el de no hacerlo es una
credencial válida en el historial para siempre. Precedente usado el 2026-09-29:
se limpiaron las contraseñas de `supabase/seed_usuarios_demo.sql` y
`docs/PLAN_PRUEBAS_MANUALES.md` de los 75 commits.

```bash
# 1. respaldo antes de tocar nada
git bundle create ../swimyti-prepurga.bundle --all

# 2. filtro de reemplazo (un archivo con "claveVieja==>nuevo" por clave)
python -m git_filter_repo --force --replace-text reemplazos.txt

# 3. verificar que no quede nada
git rev-list --all | git grep -iF 'CLAVE_A_BUSCAR'   # no debe salir nada

# 4. publicar (force push; quien tenga clon debe hacer reset --hard)
git push --force origin main
```

Después del paso 2, `git filter-repo` borra el remoto `origin` por seguridad:
hay que readdarlo con `git remote add origin <url>`.

Aunque no esté en el historial, la clave expuesta se considera comprometida:
rota igual.

## Lo que nunca va al repo

- Contraseñas de cuentas demo, de staging, o de producción.
- `service_role` / `sb_secret_...` en cualquier archivo.
- Claves de la API de Supabase (`VITE_SUPABASE_ANON_KEY` va en
  `frontend/.env`, que está ignorado; el `.example` solo lleva placeholders).
- Tokens OAuth, que viven en `~/.local/share/opencode/mcp-auth.json`.
- Datos identificables de pacientes en documentación, capturas o commits.
- Volcados de base de datos.

**Nunca uses `git add -A` ni `git add .` sin revisar.** Fue el paso que dejó
las contraseñas en el commit `3f6adc7`. Agrega por path explícito, o revisa
`git status` antes de commitear.

## Resumen en una línea

La clave vive en `AGENTS.md`, el guard vigila el staging, y al terminar cada
batería de pruebas —con todos los errores resueltos— se rota.
