# Plan de pruebas manuales — recorrido por rol y módulo

Complementa la matriz automatizada (`supabase/tests/matriz_permisos.sql` y
`frontend/src/__tests__/`). Esa verifica la **base de datos**; esta verifica
lo que una persona ve y hace en el navegador, que son cosas distintas.

## Cómo usar

- `npm run dev` y abrir `http://localhost:5173`.
- Una fila por caso. Marcar **OK** / **FALLA** / **—** (no aplica a ese rol).
- Si algo falla, anotar qué se esperaba, qué pasó y una captura.
- Las credenciales están en `AGENTS.md` (fuera de git). No pegarlas en tickets.
- **Regla de oro de este plan:** si un rol ve un enlace en el sidebar y al
  pincharlo le sale "sin permisos", eso es **FALLA**, no una decisión de diseño.
  Esa deriva ya ocurrió con jefatura en 4 rutas y la izquierda el test
  `frontend/src/__tests__/rutas.test.ts`.

---

## 0. Preparación (admin)

| # | Caso | Esperado | Resultado |
|---|---|---|---|
| 0.1 | Login como `admin@swimyti.cl` | Entra sin "cargando" eterno | |
| 0.2 | Sidebar del admin | 9 módulos: Pacientes, Disponibilidad, Citas, Interconsultas, Bonos, Finanzas, Usuarios, Config recinto, REM | |
| 0.3 | Abrir `/rem` | Los 4 KPIs con números **mayores que 0** (hoy hay 16 atenciones) | |
| 0.4 | `/rem` → "Diagnósticos más comunes" | Sale con barras: admin sí ve diagnósticos | |
| 0.5 | Exportar a Excel | Descarga `.csv` con los indicadores y sin filas en blanco entre secciones | |

> Si 0.3 sale en cero, la RPC `fn_rem_resumen()` no está aplicada o el JWT no
> trae el rol. Revisar antes de seguir.

---

## 1. Jefatura — el recorrido crítico

Cuenta: `jefatura.demo@swimyti.cl` (enfermería + jefatura, 2 especialidades de ámbito).

| # | Caso | Esperado | Resultado |
|---|---|---|---|
| 1.1 | Login | Aterriza en `/disponibilidad`, no en fichas | |
| 1.2 | Sidebar | Pacientes, Disponibilidad, Citas, Interconsultas, **REM** + lo heredado de enfermería (Fichas, Cálculos) | |
| 1.3 | `/disponibilidad` → selector de profesional | Solo lista profesionales **de sus 2 especialidades** | |
| 1.4 | `/disponibilidad` → generar bloques | Crea bloques de 15 min; al reabrir, los horarios caen en la hora Chile, no 04:30 | |
| 1.5 | `/pacientes` | Abre y ve el listado (esto fallaba antes del fix) | |
| 1.6 | Editar un paciente | Puede cambiar teléfono/dirección; **no** puede cambiar RUT, previsión, `activo` ni el vínculo portal | |
| 1.7 | Intentar desactivar un paciente | Rechazado con error de permisos | |
| 1.8 | `/citas` → editar cita de su especialidad | Permitido | |
| 1.9 | `/citas` → editar cita de una especialidad **fuera** de su ámbito | Rechazado | |
| 1.10 | `/interconsultas` → crear | Permitido | |
| 1.11 | `/rem` | 4 KPIs con datos; la tarjeta de diagnósticos dice "se reserva para administración" | |
| 1.12 | `/usuarios` | **No** aparece en el sidebar y da "sin permisos" al entrar por URL | |
| 1.13 | `/finanzas` | No aparece; da "sin permisos" por URL | |
| 1.14 | `/rem` → Exportar | El `.csv` **no** incluye la sección de diagnósticos | |

> 1.12 y 1.13 son los negativos importantes: jefe no es superusuario.

---

## 2. Papel negativo: el rol único no alcanza

| # | Caso | Esperado | Resultado |
|---|---|---|---|
| 2.1 | Login como `enfermeria.demo@swimyti.cl` (enfermera **sin** jefatura) | No ve `/disponibilidad` como módulo coordinable, no ve REM | |
| 2.2 | Esa enfermera entra por URL a `/rem` | Rechazado | |
| 2.3 | Intenta generar bloques para un profesional de otra especialidad | Rechazado | |

> 2.1–2.3 son el contrapeso de 1.x: sin ellos, "jefatura puede" no prueba
> que "solo jefatura puede".

---

## 3. Administrativo - no confundir roles

| # | Caso | Esperado | Resultado |
|---|---|---|---|
| 3.1 | Login como `admin.demo@swimyti.cl` (administrativo) | Aterriza en `/citas` | |
| 3.2 | Sidebar | Pacientes, Citas, Interconsultas, Bonos, Finanzas. **Sin** Disponibilidad ni REM | |
| 3.3 | `/disponibilidad` por URL | Rechazado: administrativo no coordina carga horaria | |
| 3.4 | `/rem` por URL | Rechazado: el REM es de jefatura | |
| 3.5 | `/finanzas` | Abre y ve montos | |

---

## 4. Doctor y enfermería

| # | Caso | Esperado | Resultado |
|---|---|---|---|
| 4.1 | Login `doctor.demo@swimyti.cl` | Aterriza en `/dashboard` (fichas) | |
| 4.2 | Sidebar | Fichas, Disponibilidad, Interconsultas, Recetas, Cálculos. **Sin** REM, ni Usuarios, ni Finanzas | |
| 4.3 | `/rem` por URL | Rechazado | |
| 4.4 | Crear ficha en su especialidad | Permitido; en otra especialidad, rechazado (restriccion por especialidad) | |
| 4.5 | Intentar editar una ficha ya creada | Rechazado: la ficha es append-only. El único camino es una enmienda | |
| 4.6 | Crear enmienda de auditoría | Solo doctor; queda registrada y no se puede borrar | |
| 4.7 | `/usuarios` por URL | Rechazado | |

---

## 5. Unidad de apoyo

| # | Caso | Esperado | Resultado |
|---|---|---|---|
| 5.1 | Login `apoyo.demo@swimyti.cl` | Aterriza en `/bandeja-ordenes` | |
| 5.2 | Sidebar | Pacientes, Bandeja de órdenes | |
| 5.3 | Abrir paciente de apoyo | Ve datos de apoyo, no ficha clínica completa | |
| 5.4 | `/rem`, `/finanzas`, `/usuarios` por URL | Rechazados | |

---

## 6. Paciente — aislamiento de datos

| # | Caso | Esperado | Resultado |
|---|---|---|---|
| 6.1 | Login `paciente.demo@swimyti.cl` | Aterriza en `/portal` | |
| 6.2 | Portal | Solo su propia información | |
| 6.3 | Ver `/pacientes` por URL | Rechazado | |
| 6.4 | Intentar reservar una cita de otra persona | No aparece en su UI | |
| 6.5 | Liberar una cita con menos de 1 h de anticipación | Rechazado (regla de 1 hora) | |
| 6.6 | Liberar una cita con más de 1 h | Permitido, el bloque vuelve a "disponible" | |

---

## 7. Gestión de usuarios (solo admin)

| # | Caso | Esperado | Resultado |
|---|---|---|---|
| 7.1 | `/usuarios` → editar un usuario | La lista muestra **todos** sus roles, no uno | |
| 7.2 | Agregar rol | Dice "Agregar rol", nunca "Cambiar rol" | |
| 7.3 | Guardar con 2 roles | Ambos quedan; el anterior queda como principal, el nuevo como secundario | |
| 7.4 | Promover a jefatura | Pide el ámbito y guarda las especialidades | |
| 7.5 | Quitar el rol principal a alguien | Elige otro automáticamente, nunca deja la cuenta sin rol | |
| 7.6 | Intentar quitar el último rol | No lo permite | |
| 7.7 | Desactivar una cuenta | `activo = false`; conserva sus roles en el historial | |

> 7.7 es la vía documentada para "dejar un cargo": los roles se acumulan y
> no se quitan (decisión v1).

---

## 8. Cross-cutting (cualquier rol)

| # | Caso | Esperado | Resultado |
|---|---|---|---|
| 8.1 | Abrir la app sin sesión | Va a `/login` | |
| 8.2 | Escribir `/ficha/999999` (id inexistente) | Manejo de "no encontrado", no pantalla en blanco | |
| 8.3 | Cortar la red a mitad de una carga | Mensaje de error, no pantalla infinita de "Cargando…" | |
| 8.4 | Cerrar sesión y volver atrás en el navegador | No queda sesion colgada | |
| 8.5 | Revisar la pestaña Network en `/rem` | **No** aparece ninguna respuesta con la columna `diagnostico` | |

> 8.5 es la comprobación manual del fix de privacidad. Si el payload trae
> diagnósticos, la RPC no está siendo usada aunque la página se vea bien.

---

## Definición de "terminado"

- Todos los casos en **OK** o **—**, sin FALLA.
- Si hubo FALLA: se corrige, se vuelve a correr el caso, y se deja anotado.
- Cualquier hallazgo de seguridad vuelve como caso en
  `supabase/tests/matriz_permisos.sql` para que no dependa de que alguien
  vuelva a acordarse de probarlo.
