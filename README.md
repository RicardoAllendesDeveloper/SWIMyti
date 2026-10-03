# SWIMyti

SaaS de **ficha clínica digital inmutable** para centros de salud de baja complejidad en Chile.

El valor central del sistema no es gestionar citas: es la **trazabilidad legal de la atención** bajo la
**Ley 19.628** de protección de datos personales. La ficha clínica es *append-only*: no se edita ni
se borra, y los triggers de base de datos lo impiden a nivel de motor, no solo en la interfaz.

**Estado:** en desarrollo activo. Base de datos y suite de pruebas desplegadas en Supabase.

[Read in English](README.en.md)

---

## Capturas

Las imágenes son de la **versión desplegada en producción**, con datos de demostración
saneados (RUT `00.000.000-4`, inválido en el Registro Civil por construcción).

| | |
|---|---|
| ![Panel de la jefatura](capturas/03-dashboard.png) | ![Agenda propia](capturas/04-agenda.png) |
| **Dashboard** — historial de atenciones y accesos por rol | **Agenda** — bloques de 15 minutos del propio profesional |
| ![Jornadas y bloques](capturas/05-jornadas.png) | ![Citas del área](capturas/06-jornadas-citas-area.png) |
| **Jornadas · pestaña 1** — publicar y bloquear bloques | **Jornadas · pestaña 2** — citas de los profesionales del área |
| ![Expediente](capturas/08-expediente.png) | ![Listado de pacientes](capturas/07-pacientes.png) |
| **Expediente** — historial, recetas, certificados y anexos | **Pacientes** — búsqueda por RUT, nombre o email |

La agenda usa bloques de 15 minutos derivados de jornadas, y **un bloque sin especialidad
no es reservable**: toda cita lleva paciente, especialidad y profesional.

---

## Stack

| Capa | Tecnología |
|---|---|
| Frontend | React 19 · React Router 7 · TypeScript (strict) · Vite 8 |
| Backend | Supabase (Postgres · Auth · Storage) |
| Seguridad | Row Level Security + RPC `SECURITY DEFINER` |
| Estilos | CSS puro por módulo, sin framework |
| Tests | Vitest (frontend) · SQL transaccional (integridad en BD) |
| Lint | oxlint |
| Deploy | Vercel |

---

## Lo que hay que mirar primero

Cada punto es un problema real que se resolvió. Están aquí porque son la evidencia del trabajo.

### 1. La ficha clínica es inmutable por diseño

`fichas_medicas` y `enmiendas_auditoria` no admiten `UPDATE` ni `DELETE`. No es una convención del
equipo ni una validación de formulario: son triggers que levantan excepción.

```sql
-- supabase/migrations/
-- fn_bloquear_mutacion_inmutable + trg_fichas_medicas_no_delete
```

Esto responde a un requisito legal, no a una preferencia de diseño.

### 2. RLS decide filas; los triggers deciden columnas

Las restricciones de columnas no se pueden expresar en una política de Postgres. El patrón del proyecto es
`fn_proteger_datos_sensibles_paciente`: RUT y previsión exigen rol específico, `activo` e
`id_usuario_portal` solo administrador.

```sql
fn_proteger_datos_sensibles_paciente()
```

### 3. Una atención exige cita y bono

Regla dura de integridad: **no existe atención sin cita programada ni sin bono emitido**, porque el
flujo pactado es `cita → bono → atención → ficha`.

```sql
-- supabase/migrations/20261002093000_atencion_como_entidad.sql
-- tabla atenciones + fn_valida_vinculos_atencion() (BEFORE INSERT SECURITY DEFINER)
```

`atenciones` tiene `id_cita` e `id_bono` `NOT NULL` con FK `RESTRICT` y unicidad por ambos: una cita
no genera dos atenciones, y un bono no se reutiliza.

### 4. Un bug de trigger que costó un día entero

Un trigger que **escribe en otra tabla** debe ser `SECURITY DEFINER`. Corriendo como `invoker` se
ejecuta con los permisos de quien disparó la sentencia: si ese rol no tiene política de escritura
sobre la tabla destino, el `UPDATE` afecta **0 filas sin error**.

```sql
fn_liberar_horario()  -- era invoker: los bloques quedaban 'reservada' para siempre
```

El síntoma era silencioso, que es lo peor que puede ser. La regresión está cubierta en
`supabase/tests/auditoria_rls.sql`.

### 5. La trampa de PostgREST

PostgREST **no acepta espacio entre dos paréntesis de cierre**:

```ts
usuarios:id_profesional(nombres, apellidos) )   // no parsea
usuarios:id_profesional(nombres, apellidos))    // sí
```

Rompió siete pantallas a la vez porque ambos estilos convivían en el mismo archivo y el código
parecía consistente. Por eso existe `npm run consultas`: valida **todas** las consultas del
frontend contra la base real, incluidos embeds anidados, columnas existentes y parámetros de RPC.
Sale con código 1 si algo no cuadra.

```bash
npm run consultas   # requiere ADMIN_PASSWORD en el entorno
```

### 6. Zona horaria

La base almacena `timestamptz` en UTC. Toda generación de bloques debe anclarse a `America/Santiago`.
Bug histórico: los bloques salían a las 04:30 hora Chile.

---

## Estructura

```
frontend/
  src/
    pages/            21 pantallas, una por módulo
    components/       Sidebar, calendarios, control de acceso por ruta
    context/          sesión + rol (única fuente de rol en cliente)
    services/         cliente de Supabase
    types/            tipos de las tablas
    utils/            helpers de permisos (UX, no seguridad)
    styles/           CSS puro por módulo
supabase/
  migrations/         61 migraciones numeradas
  tests/              auditoría RLS + suites transaccionales
scripts/              verificación de consultas contra la BD real
docs/                 documentación funcional
```

---

## Verificación

```bash
cd frontend
npm install
npm run dev          # desarrollo
npm run build        # tsc -b && vite build
npm run test         # vitest
npm run lint         # oxlint
npm run consultas    # valida las consultas contra la BD real
```

Las suites SQL se ejecutan sobre la base real dentro de transacciones que hacen `ROLLBACK`: la
prueba verifica comportamiento real de RLS y triggers sin dejar rastro.

---

## Modelo de acceso

Siete roles con permisos acumulativos: `administrador`, `administrativo`, `doctor`, `enfermeria`,
`unidad_apoyo`, `jefatura`, `paciente`.

La seguridad vive en **RLS + RPC**. Los controles de ruta en el frontend son navegación y
experiencia de usuario, nunca una frontera de seguridad: un usuario puede saltarse la interfaz,
no puede saltarse las políticas.

Las políticas se escriben `TO authenticated` con una allowlist deliberada, nunca `TO public`.