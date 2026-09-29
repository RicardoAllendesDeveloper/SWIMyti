# Plan de pruebas manuales — recorrido por rol y módulo

Complementa la matriz automatizada (`supabase/tests/matriz_permisos.sql` y
`frontend/src/__tests__/`). Esa verifica la **base de datos**; esta verifica
lo que una persona ve y hace en el navegador, que son cosas distintas.

## Leyenda

| Marca | Significado |
|---|---|
| — | Solo lectura. Se puede correr en producción sin riesgo. |
| ⚠️ **ESCRIBE** | Modifica datos. Leer la nota antes de ejecutar. |
| ⛔ **IRREVERSIBLE** | Escribe en una tabla append-only. No se puede borrar ni corregir. |

> **Antes de correr los casos que escriben:** las tablas `fichas_medicas` y
> `enmiendas_auditoria` son append-only por diseño (trazabilidad clínica bajo
> la Ley 19.628). Un registro creado en una prueba **no se puede eliminar**
> después. Si prefieres no ensuciar los datos, salta 4.4 y 4.6 y anota
> "no ejecutado" en el Word: son los dos únicos irreversibles.

Los 11 casos que escriben están marcados ⚠️ en las tablas de abajo. Todos los
demás se pueden correr sin miedo.

## Matriz de módulos por rol

Qué módulo debe verse en el menú lateral de cada rol. Generada desde
`MODULOS_POR_ROL` en `frontend/src/utils/permisos.ts`. La última columna es la
cuenta `jefatura.demo`, que acumula enfermería + jefatura.

| Módulo | Ruta | admin | jef | admvo | doc | enf | apoyo | pac | **ENF+JEF** |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Mi portal | `/portal` | - | - | - | - | - | - | Sí | - |
| Gestión de horas | `/citas` | Sí | Sí | Sí | - | - | - | Sí | Sí |
| Fichas médicas | `/dashboard` | - | - | - | Sí | Sí | - | - | Sí |
| Pacientes | `/pacientes` | Sí | Sí | Sí | - | - | Sí | - | Sí |
| Agenda | `/disponibilidad` | Sí | Sí | - | Sí | Sí | - | - | Sí |
| Interconsultas | `/interconsultas` | Sí | Sí | Sí | Sí | Sí | - | Sí | Sí |
| Bonos de atención | `/bonos` | Sí | - | Sí | - | - | - | - | - |
| Presupuestos y finanzas | `/finanzas` | Sí | - | Sí | - | - | - | - | - |
| Generar documentos | `/recetas` | - | - | - | Sí | - | - | - | - |
| Cálculos clínicos | `/calculos` | - | - | - | Sí | Sí | - | - | Sí |
| REM | `/rem` | Sí | Sí | - | - | - | - | - | Sí |
| Bandeja de órdenes | `/bandeja-ordenes` | - | - | - | - | - | Sí | - | - |
| Usuarios | `/usuarios` | Sí | - | - | - | - | - | - | - |
| Configuración del recinto | `/config-recinto` | Sí | - | - | - | - | - | - | - |
| **Total** | | **9** | **5** | **5** | **5** | **4** | **2** | **3** | **7** |

## Cómo usar

- Ir a `https://swi-myti.vercel.app`.
- Una fila por caso. Marcar **OK** / **FALLA** / **—** (no aplica a ese rol).
- Si algo falla, anotar qué se esperaba, qué pasó y una captura.
- Las credenciales están en `AGENTS.md` (fuera de git). No pegarlas en tickets.
- **Regla de oro de este plan:** si un rol ve un enlace en el sidebar y al
  pincharlo le sale "sin permisos", eso es **FALLA**, no una decisión de diseño.
  Esa deriva ya ocurrió con jefatura en 4 rutas y la dejó el test
  `frontend/src/__tests__/rutas.test.ts`.

### Credenciales

Las contraseñas **no viven en este archivo**. Están en `AGENTS.md`, que está en
`.gitignore` justamente por eso. Este documento solo necesita saber a qué
cuenta corresponde cada caso.

| Rolón | Email | Contraseña |
|---|---|---|
| Administrador | `admin@swimyti.cl` | en `AGENTS.md` |
| Jefatura (enfermera + jefatura) | `jefatura.demo@swimyti.cl` | en `AGENTS.md` |
| Enfermería (sin jefatura) | `enfermeria.demo@swimyti.cl` | en `AGENTS.md` |
| Administrativo | `admin.demo@swimyti.cl` | en `AGENTS.md` |
| Doctor | `doctor.demo@swimyti.cl` | en `AGENTS.md` |
| Unidad de apoyo | `apoyo.demo@swimyti.cl` | en `AGENTS.md` |
| Paciente | `paciente.demo@swimyti.cl` | en `AGENTS.md` |

> Importante: `jefatura.demo` tiene **dos** roles (enfermería principal +
> jefatura secundaria). `enfermeria.demo` tiene **solo** enfermería. Los dos
> existen a propósito: la comparación entre ambos es lo que demuestra que
> los permisos de jefatura están acotados y no se filtran a enfermería.

---

## 0. Preparación (admin)

| # | Caso | Esperado | Resultado |
|---|---|---|---|
| 0.1 | Login como `admin@swimyti.cl` | Entra sin "cargando" eterno | |
| 0.2 | Sidebar del admin | 9 módulos: Pacientes, Agenda, Gestión de horas, Interconsultas, Bonos de atención, Presupuestos y finanzas, Usuarios, Configuración del recinto, REM | |
| 0.3 | Abrir `/rem` | Los 4 KPIs con números **mayores que 0** (hay 16 atenciones) | |
| 0.4 | `/rem` → "Diagnósticos más comunes" | Sale con barras: admin sí ve diagnósticos | |
| 0.5 | `/rem` → Exportar | Descarga `.csv` con los indicadores | |

> Si 0.3 sale en cero, la RPC `fn_rem_resumen()` no está aplicada o el JWT no
> trae el rol. Revisar antes de seguir.

---

## 1. Jefatura — el recorrido crítico

Cuenta: `jefatura.demo@swimyti.cl`.

| # | Caso | Esperado | Resultado |
|---|---|---|---|
| 1.1 | Login | Aterriza en el módulo **Agenda** (`/disponibilidad`), no en fichas | |
| 1.2 | Sidebar | Fichas médicas, Agenda, Pacientes, Gestión de horas, Interconsultas, Cálculos clínicos, **REM** — **los 7 juntos** (los 4 de enfermería + los 3 propios de jefatura) | |
| 1.3 | Módulo **Agenda** → selector de profesional | Solo lista profesionales **de sus 2 especialidades** | |
| 1.4 | Módulo **Agenda** → generar bloques | Bloques de 15 min; al reabrir, horarios en hora Chile, **no 04:30** | ⚠️ **ESCRIBE** `horarios_disponibles` |
| 1.5 | `/pacientes` | Abre y ve el listado (esto fallaba antes del fix) | |
| 1.6 | Editar un paciente: teléfono/dirección | Puede | ⚠️ **ESCRIBE** `pacientes` |
| 1.7 | Intentar **desactivar** un paciente | Rechazado con error de permisos | |
| 1.8 | `/citas` → editar cita de su especialidad | Permitido | ⚠️ **ESCRIBE** `citas` |
| 1.9 | `/citas` → editar cita **fuera** de su ámbito | Rechazado | |
| 1.10 | Módulo **Interconsultas** → crear | Permitido | ⚠️ **ESCRIBE** `interconsultas` |
| 1.11 | `/rem` | 4 KPIs con datos; la tarjeta de diagnósticos dice "se reserva para administración" | |
| 1.12 | `/usuarios` | **No** en el sidebar; da "sin permisos" por URL | |
| 1.13 | `/finanzas` | No aparece; da "sin permisos" por URL | |
| 1.14 | `/rem` → Exportar | El `.csv` **no** incluye la sección de diagnósticos | |

> 1.12 y 1.13 son los negativos importantes: jefe no es superusuario.
> **1.2 es el caso que valida el fix de esta sesión.** Antes el contexto
> devolvía un solo rol, así que el sidebar salía a medias.

---

## 2. Papel negativo: el rol único no alcanza

Cuenta: `enfermeria.demo@swimyti.cl` (enfermera **sin** jefatura).

| # | Caso | Esperado | Resultado |
|---|---|---|---|
| 2.1 | Sidebar | Solo 4 módulos: Fichas médicas, Agenda, Interconsultas, Cálculos clínicos. **Sin** REM, Pacientes ni Gestión de horas | |
| 2.2 | `/rem` por URL | Rechazado | |
| 2.3 | Generar bloques para profesional de otra especialidad | Rechazado | |

> 2.1–2.3 son el contrapeso de 1.x: sin ellos, "jefatura puede" no prueba
> que "solo jefatura puede".

---

## 3. Administrativo — no confundir roles

| # | Caso | Esperado | Resultado |
|---|---|---|---|
| 3.1 | Login como `admin.demo@swimyti.cl` | Aterriza en `/citas` | |
| 3.2 | Sidebar | Pacientes, Gestión de horas, Interconsultas, Bonos de atención, Presupuestos y finanzas (5). **Sin** Agenda y **sin** REM | |
| 3.3 | `/disponibilidad` por URL | Rechazado: administrativo no coordina carga horaria | |
| 3.4 | `/rem` por URL | Rechazado | |
| 3.5 | `/finanzas` | Abre y ve montos | |

---

## 4. Doctor y enfermería

| # | Caso | Esperado | Resultado |
|---|---|---|---|
| 4.1 | Login `doctor.demo@swimyti.cl` | Aterriza en `/dashboard` (fichas) | |
| 4.2 | Sidebar | Fichas médicas, Agenda, Interconsultas, Generar documentos, Cálculos clínicos (5). **Sin** REM, Usuarios ni Finanzas | |
| 4.3 | `/rem` por URL | Rechazado | |
| 4.4 | Crear ficha en su especialidad | Permitido | ⛔ **IRREVERSIBLE** `fichas_medicas` |
| 4.5 | Intentar editar una ficha ya creada | Rechazado: la ficha es append-only. El único camino es una enmienda | |
| 4.6 | Crear enmienda de auditoría | Solo doctor; queda registrada y no se puede borrar | ⛔ **IRREVERSIBLE** `enmiendas_auditoria` |
| 4.7 | `/usuarios` por URL | Rechazado | |

> 4.4 y 4.6 son los dos únicos casos imposibles de revertir. Si no quieres
> ensuciar los datos clínicos, márcalos "no ejecutado" y anota por qué.

---

## 5. Unidad de apoyo

| # | Caso | Esperado | Resultado |
|---|---|---|---|
| 5.1 | Login `apoyo.demo@swimyti.cl` | Aterriza en `/bandeja-ordenes` | |
| 5.2 | Sidebar | Solo 2 módulos: Pacientes y Bandeja de órdenes | |
| 5.3 | Abrir paciente de apoyo | Ve datos de apoyo, no ficha clínica completa | |
| 5.4 | `/rem`, `/finanzas`, `/usuarios` por URL | Rechazados | |

---

## 6. Paciente — aislamiento de datos

| # | Caso | Esperado | Resultado |
|---|---|---|---|
| 6.1 | Login `paciente.demo@swimyti.cl` | Aterriza en `/portal` | |
| 6.2 | Portal | Solo su propia información | |
| 6.3 | Ver `/pacientes` por URL | Rechazado | |
| 6.4 | Reservar una cita de otra persona | No aparece en su UI | |
| 6.5 | Liberar cita con **menos de 1 h** | Rechazado (regla de 1 hora) | |
| 6.6 | Liberar cita con **más de 1 h** | Permitido, el bloque vuelve a "disponible" | ⚠️ **ESCRIBE** `citas` + `horarios` |

---

## 7. Gestión de usuarios (solo admin)

| # | Caso | Esperado | Resultado |
|---|---|---|---|
| 7.1 | `/usuarios` → ver un usuario | La lista muestra **todos** sus roles, no uno | |
| 7.2 | Botón de rol | Dice "Agregar rol", nunca "Cambiar rol" | |
| 7.3 | Guardar con 2 roles | Ambos quedan; el anterior principal, el nuevo secundario | ⚠️ **ESCRIBE** `usuario_roles` |
| 7.4 | Promover a jefatura | Pide el ámbito y guarda las especialidades | ⚠️ **ESCRIBE** `usuario_roles` + `jefaturas_especialidades` |
| 7.5 | Quitar el rol principal | Elige otro automáticamente, nunca deja la cuenta sin rol | ⚠️ **ESCRIBE** `usuario_roles` |
| 7.6 | Intentar quitar el último rol | No lo permite | |
| 7.7 | Desactivar una cuenta | `activo = false`; conserva sus roles | ⚠️ **ESCRIBE** `usuarios` |

> 7.7 es la vía documentada para "dejar un cargo": los roles se acumulan y
> no se quitan (decisión v1). **Cuidado:** si desactivas una cuenta demo,
> recuerda rehabilitarla después.

---

## 8. Cross-cutting

| # | Caso | Esperado | Resultado |
|---|---|---|---|
| 8.1 | Abrir la app sin sesión | Va a `/login` | |
| 8.2 | Escribir `/ficha/999999` (id inexistente) | "No encontrado", no pantalla en blanco | |
| 8.3 | Cortar la red a mitad de una carga | Mensaje de error, no "Cargando…" infinito | |
| 8.4 | Cerrar sesión y volver atrás | No queda sesión colgada | |
| 8.5 | Pestaña Network en `/rem` | **No** aparece ninguna respuesta con la columna `diagnostico` | |

> 8.5 es la comprobación manual del fix de privacidad. Si el payload trae
> diagnósticos, la RPC no está siendo usada aunque la página se vea bien.

---

## Definición de "terminado"

- Todos los casos en **OK** o **no ejecutado**, sin FALLA.
- Si hubo FALLA: se corrige, se vuelve a correr el caso, y se deja anotado.
- Cualquier hallazgo de seguridad vuelve como caso en
  `supabase/tests/matriz_permisos.sql` para que no dependa de que alguien
  vuelva a acordarse de probarlo.
