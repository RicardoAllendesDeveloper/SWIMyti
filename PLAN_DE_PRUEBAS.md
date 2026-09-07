# SWIMyti — Plan de Pruebas por Rol

Plan de pruebas funcionales para validar el sistema **SWIMyti** (plataforma web de gestión clínica multi-rol).

- **Entorno**: producción https://swi-myti.vercel.app/ (frontend en Vercel + backend/datos en Supabase).
- **Objetivo**: verificar que cada rol solo puede hacer lo que le corresponde (RBAC) y que los flujos funcionan de extremo a extremo.
- **Base**: PostgreSQL en Supabase (RLS aplica la seguridad a nivel de fila, no solo en la interfaz).

> **Nota sobre "endpoints"**: SWIMyti es una SPA. Cada pantalla (ruta del frontend) dispara automáticamente operaciones de datos contra la **API REST de Supabase (PostgREST)**, autenticadas con el JWT del usuario logueado (`Authorization: Bearer <jwt>`). En las tablas de cada rol se indica, por cada funcionalidad, la **ruta frontend** y la **operación de datos** que se ejecuta en segundo plano.

---

## Roles del sistema

| Rol | Descripción | Home tras login |
|-----|-------------|-----------------|
| `administrador` | Supervisa todo: fichas, pacientes, agenda, citas, interconsultas, bonos, finanzas, recetas, usuarios | `/dashboard` |
| `doctor` | Personal clínico: fichas, enmiendas, disponibilidad, interconsultas, recetas/certificados | `/dashboard` |
| `enfermeria` | Personal clínico: fichas, pacientes, citas, interconsultas | `/dashboard` |
| `administrativo` | Gestión administrativa: pacientes, citas, interconsultas, bonos, finanzas | `/citas` |
| `unidad_apoyo` | Adjunta anexos/resultados a pacientes | `/pacientes` |
| `paciente` | Portal: consulta sus citas y solicita su ficha presencialmente | `/portal` |

---

## 1. Rol: Administrador

### Módulos accesibles
`fichas`, `pacientes`, `disponibilidad`, `citas`, `interconsultas`, `bonos`, `finanzas`, `recetas`, `usuarios`

### Funcionalidades y endpoints

| # | Funcionalidad | Ruta (frontend) | Operación de datos (Supabase/PostgREST) | Resultado esperado |
|---|---------------|-----------------|------------------------------------------|--------------------|
| A1 | Iniciar sesión como administrador | `/login` | `auth.signInWithPassword` + `auth.getUser` + `select usuarios (roles)` | Sesión iniciada, redirige a `/dashboard` |
| A2 | Ver listado de fichas médicas | `/dashboard` | `select fichas_medicas (join pacientes)` | Lista todas las fichas con paciente |
| A3 | Crear ficha médica | `/dashboard` | `insert fichas_medicas` | Ficha creada (append-only, inmmutable) |
| A4 | Ver detalle de ficha + enmiendas | `/ficha/:id` | `select fichas_medicas` + `select enmiendas_auditoria` | Detalle completo + historial de enmiendas |
| A5 | Ingresar enmienda | `/ficha/:id` | `insert enmiendas_auditoria` | Enmienda registrada con firma, la ficha original no cambia |
| A6 | Registrar paciente | `/pacientes` | `insert pacientes` | Paciente creado |
| A7 | Publicar disponibilidad de doctor | `/disponibilidad` | `insert horarios_disponibles` | Bloque disponible publicado |
| A8 | Gestionar citas (ver/cancelar todas) | `/citas` | `select/update citas` | Ve y cancela cualquier cita |
| A9 | Solicitar interconsulta | `/interconsultas` | `insert interconsultas` | Interconsulta creada (pendiente) |
| A10 | Registrar bono de atención | `/bonos` | `select pacientes` + `insert bonos_atencion` | Bono registrado con previsión |
| A11 | Registrar partida financiera (ingreso/egreso) | `/finanzas` | `insert partidas_presupuesto` | Partida creada |
| A12 | Emitir receta médica | `/recetas` | `insert recetas_medicas` (firma SHA-256) | Receta emitida |
| A13 | Emitir certificado clínico | `/recetas` | `insert certificados_clinicos` (firma SHA-256) | Certificado emitido |
| A14 | Crear usuario (cuenta + perfil + rol) | `/usuarios` | `rpc fn_crear_usuario` + `select roles` | Cuenta creada; el usuario puede iniciar sesión |
| A15 | Activar/desactivar usuario (cuenta inactiva) | `/usuarios` | `update usuarios (activo)` | Cuenta se desactiva/activa |
| A16 | **Negativo** — Administrador intenta eliminar ficha | `/ficha/:id` | `delete fichas_medicas` (bloqueado por trigger) | **FALLA** (inmutabilidad) |

---

## 2. Rol: Doctor

### Módulos accesibles
`fichas`, `pacientes`, `disponibilidad`, `interconsultas`, `recetas`

### Funcionalidades y endpoints

| # | Funcionalidad | Ruta (frontend) | Operación de datos (Supabase/PostgREST) | Resultado esperado |
|---|---------------|-----------------|------------------------------------------|--------------------|
| D1 | Iniciar sesión como doctor | `/login` | `supabase.auth.signInWithPassword` | Sesión iniciada, redirige a `/dashboard` |
| D2 | Ver listado de fichas médicas | `/dashboard` | `select fichas_medicas (join pacientes)` | Lista las fichas |
| D3 | Crear ficha médica | `/dashboard` | `insert fichas_medicas` | Ficha creada (append-only) |
| D4 | Ver detalle de ficha + enmiendas | `/ficha/:id` | `select fichas_medicas` + `select enmiendas_auditoria` | Detalle + historial |
| D5 | Ingresar enmienda | `/ficha/:id` | `insert enmiendas_auditoria` | Enmienda registrada con firma |
| D6 | Publicar bloque de disponibilidad | `/disponibilidad` | `insert horarios_disponibles` | Bloque publicado (solo verá los suyos) |
| D7 | Atender interconsulta (confirmar/responder/atender) | `/interconsultas` | `update interconsultas (estado, respuesta)` | Interconsulta gestionada |
| D8 | Emitir receta médica | `/recetas` | `insert recetas_medicas` | Receta emitida |
| D9 | Emitir certificado clínico | `/recetas` | `insert certificados_clinicos` | Certificado emitido |
| D10 | **Negativo** — Doctor intenta gestionar usuarios | `/usuarios` | Ruta bloqueada por rol | **Redirigido/denegado** (solo admin) |
| D11 | **Negativo** — Doctor intenta crear/ver bonos | `/bonos` | Ruta bloqueada por rol | **Redirigido/denegado** |
| D12 | **Negativo** — Doctor intenta gestionar finanzas | `/finanzas` | Ruta bloqueada por rol | **Redirigido/denegado** |

---

## 3. Rol: Enfermería

### Módulos accesibles
`fichas`, `pacientes`, `citas`, `interconsultas`

### Funcionalidades y endpoints

| # | Funcionalidad | Ruta (frontend) | Operación de datos (Supabase/PostgREST) | Resultado esperado |
|---|---------------|-----------------|------------------------------------------|--------------------|
| E1 | Iniciar sesión como enfermería | `/login` | `supabase.auth.signInWithPassword` | Sesión iniciada, redirige a `/dashboard` |
| E2 | Ver listado de fichas médicas | `/dashboard` | `select fichas_medicas (join pacientes)` | Lista las fichas |
| E3 | Crear ficha médica | `/dashboard` | `insert fichas_medicas` | Ficha creada (append-only) |
| E4 | Ver detalle de ficha + enmiendas | `/ficha/:id` | `select fichas_medicas` + `select enmiendas_auditoria` | Detalle + historial |
| E5 | Ver/gestionar citas | `/citas` | `select/update citas` | Ve y cancela citas |
| E6 | Solicitar interconsulta | `/interconsultas` | `insert interconsultas` | Interconsulta creada (pendiente) |
| E7 | **Negativo** — Enfermería intenta **ingresar enmienda** | `/ficha/:id` | `insert enmiendas_auditoria` | **FALLA** (solo admin/doctor pueden enmendar) |
| E8 | **Negativo** — Enfermería intenta publicar disponibilidad | `/disponibilidad` | Ruta bloqueada por rol | **Redirigido/denegado** |
| E9 | **Negativo** — Enfermería intenta gestionar bonos/finanzas/usuarios | `/bonos`, `/finanzas`, `/usuarios` | Rutas bloqueadas por rol | **Redirigido/denegado** |

---

## 4. Rol: Administrativo

### Módulos accesibles
`pacientes`, `citas`, `interconsultas`, `bonos`, `finanzas`

### Funcionalidades y endpoints

| # | Funcionalidad | Ruta (frontend) | Operación de datos (Supabase/PostgREST) | Resultado esperado |
|---|---------------|-----------------|------------------------------------------|--------------------|
| AD1 | Iniciar sesión como administrativo | `/login` | `supabase.auth.signInWithPassword` | Sesión iniciada, redirige a `/citas` |
| AD2 | Registrar paciente | `/pacientes` | `insert pacientes` | Paciente creado |
| AD3 | Reservar cita "en nombre de" un paciente | `/citas` | `select pacientes` + `insert citas` | Cita reservada |
| AD4 | Ver/gestionar todas las citas | `/citas` | `select/update citas` | Ve y cancela citas |
| AD5 | Solicitar interconsulta | `/interconsultas` | `insert interconsultas` | Interconsulta creada (pendiente) |
| AD6 | Registrar bono de atención | `/bonos` | `select pacientes` + `insert bonos_atencion` | Bono registrado |
| AD7 | Registrar partida financiera | `/finanzas` | `insert partidas_presupuesto` | Partida creada |
| AD8 | **Negativo** — Administrativo intenta ver/crear fichas médicas | `/dashboard` | Ruta bloqueada por rol | **Redirigido/denegado** (home `/citas`) |
| AD9 | **Negativo** — Administrativo intenta crear usuarios | `/usuarios` | Ruta bloqueada por rol | **Redirigido/denegado** |
| AD10 | **Negativo** — Administrativo edita RUT/previsión en paciente | `/pacientes` | Bloqueado por RLS | **FALLA** (solo admin edita datos sensibles) |

---

## 5. Rol: Unidad de Apoyo

### Módulos accesibles
`pacientes`

### Funcionalidades y endpoints

| # | Funcionalidad | Ruta (frontend) | Operación de datos (Supabase/PostgREST) | Resultado esperado |
|---|---------------|-----------------|------------------------------------------|--------------------|
| U1 | Iniciar sesión como unidad de apoyo | `/login` | `supabase.auth.signInWithPassword` | Sesión iniciada, redirige a `/pacientes` |
| U2 | Ver listado de pacientes | `/pacientes` | `select pacientes` | Lista los pacientes |
| (U3) | Adjuntar anexos/resultados a una ficha | *(visualización de anexos)* | `select/insert anexos_clinicos` | *(pendiente de habilitar/validar en UI)* |
| U4 | **Negativo** — Unidad de apoyo intenta ver fichas clínicas | `/dashboard`, `/ficha/:id` | Ruta bloqueada por rol | **Redirigido/denegado** (solo personal clínico) |
| U5 | **Negativo** — Unidad de apoyo intenta gestionar citas/bonos/finanzas | `/citas`, `/bonos`, `/finanzas` | Rutas bloqueadas por rol | **Redirigido/denegado** |

---

## 6. Rol: Paciente

### Módulos accesibles
`portal`, `citas`, `interconsultas`

### Funcionalidades y endpoints

| # | Funcionalidad | Ruta (frontend) | Operación de datos (Supabase/PostgREST) | Resultado esperado |
|---|---------------|-----------------|------------------------------------------|--------------------|
| P1 | Registrarse (self-service) | `/registro` | `auth.signUp` + `auth.signInWithPassword` + `rpc fn_auto_registro_paciente` | Cuenta de paciente creada |
| P2 | Iniciar sesión como paciente | `/login` | `auth.signInWithPassword` | Sesión iniciada, redirige a `/portal` |
| P3 | Ver sus citas | `/portal` | `select citas (join horarios/especialidades)` | Ve solo sus citas |
| P4 | Ver horas disponibles y reservar cita | `/citas` | `select horarios_disponibles` + `insert citas` | Cita reservada |
| P5 | Cancelar su cita | `/portal` | `update citas (estado: cancelada)` | Cita cancelada |
| P6 | Ver/confirmar sus interconsultas | `/interconsultas` | `select (solo las suyas por RLS)` + `update (confirmar)` | Ve y confirma sus interconsultas |
| P7 | **Negativo** — Paciente intenta consultar su ficha médica | `/portal` | No se consulta ficha/nexos | **NO ve ficha**; solo un aviso de que debe solicitarla **presencialmente** |
| P8 | **Negativo** — Paciente intenta ver fichas de otros | `/dashboard`, `/ficha/:id` | Ruta bloqueada por rol | **Redirigido/denegado** |

---

## Notas transversales

- **Inmutabilidad**: las filas de `fichas_medicas` y `enmiendas_auditoria` tienen triggers que bloquean `UPDATE` y `DELETE`. Ningún rol puede editar/borrar una ficha o enmienda existente.
- **RLS (Row Level Security)**: aunque una ruta del frontend se "saltara", la base de datos rechaza cualquier operación que el rol no tenga permitida (por ejemplo, enmiendas de enfermería, edición de RUT por administrativo, fichas para paciente).
- **Firma digital**: recetas, certificados y enmiendas registran `firma_digital_hash` (SHA-256) del usuario autenticado.
- **Cuenta inactiva**: el administrador puede activar/desactivar cuentas desde `/usuarios`; una cuenta inactiva no debe poder operar.
- **Resultado de cada caso**: marcar `PASS` / `FAIL` en la columna o junto a cada caso al ejecutar.

---

*Documento de apoyo para la ejecución de pruebas. Generado a partir del código real del frontend (rutas en `App.tsx`, permisos en `permisos.ts`) y del mapeo de operaciones Supabase/PostgREST por página.*
