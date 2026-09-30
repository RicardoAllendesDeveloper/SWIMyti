# Plan de pruebas manuales — v2 (base limpia)

> Base reseteada el 2026-09-30. Cero datos operativos: 0 pacientes, 0 fichas,
> 0 citas, 6076 bloques generados, equipo demo de 7 profesionales.
> Esta version reemplaza al plan anterior: los datos que servian de referencia
> ya no existen en la base.

## Reglas de esta ronda

- **Rol por caso.** Cada caso indica con que cuenta entrar. No mezclar roles en un
  mismo caso: el 1.3 fallo justamente por probar la jefatura como si fuera un
  medico.
- **Base limpia.** Todo caso que deberia mostrar algo vacio debe efectivamente
  estar vacio. Si aparece algo, es residuo: anotar y reportar, no seguir.
- **Anotar el caso, no la solucion.** Si algo falla, capturar el mensaje exacto
  de la consola o del toast.
- **No crear datos de relleno.** La base es el caso de prueba. Si un flujo exige
  datos que no hay, se anota como bloqueo en vez de inventar un paciente.

## Cuentas

| Rol | Email |
|---|---|
| Administrador | `admin@swimyti.cl` |
| Doctor | `doctor.demo@swimyti.cl` |
| enfermeria | `enfermeria.demo@swimyti.cl` |
| Jefatura (enfermera + jefatura) | `jefatura.demo@swimyti.cl` |
| Administrativo | `admin.demo@swimyti.cl` |
| Unidad de apoyo | `apoyo.demo@swimyti.cl` |
| Paciente | `paciente.demo@swimyti.cl` |

Claves en `AGENTS.md` (ignorado por git). Los 7 profesionales del equipo
(`medico.general.demo@`, `cardiologo.demo@`, etc.) existen como perfiles para
agendar; no se prueban como login.

---

## Fase 0 — Acceso (bloqueante: si falla, todo lo demas no aplica)

| # | Caso | Cuenta | Resultado esperado |
|---|---|---|---|
| 0.1 | Login valido, cada una de las 7 cuentas | todas | Entra al home de su rol. **Si alguna falla, el resto se detiene.** |
| 0.2 | Login con clave incorrecta | cualquiera | Mensaje de credenciales invalidas, no pantalla en blanco |
| 0.3 | Rol acumulado: la ficha de la jefatura muestra los 2 roles | jefatura | Rotulo de enfermeria + acceso a coordinacion |
| 0.4 | Navegacion por rol: un doctor no ve `/finanzas` | doctor | Ruta bloqueada por `RoleRoute` |

> 0.1 es el caso que el reset destapo: las 6 cuentas demo existian sin
> `auth.identities`, asi que no podian iniciar sesion. Ya esta corregido; este
> caso verifica que no vuelva.

## Fase 1 — Agenda y publicacion (el corazon del 1.3 y el 1.9)

| # | Caso | Cuenta | Resultado esperado |
|---|---|---|---|
| 1.1 | `/disponibilidad`: la lista de profesionales no esta vacia | jefatura | 7 profesionales, agrupados por especialidad |
| 1.2 | Al elegir un profesional, las especialidades se acotan a las suyas | jefatura | Solo las declaradas de ese profesional |
| 1.3 | **Enfermeria no aparece bajo Medicina General** | jefatura | 3 enfermeras solo con enfermeria. **Era el defecto principal** |
| 1.4 | Publicar jornada: generar bloques | jefatura | Se crean bloques de 15 min |
| 1.5 | Ver la agenda desde la especialidad correcta | jefatura | Los bloques aparecen en la fecha esperada |
| 1.6 | Horarios en hora Chile | jefatura | 09:00-16:45 local, **no 04:30** (bug historico) |

## Fase 2 — Paciente y reservas

| # | Caso | Cuenta | Resultado esperado |
|---|---|---|---|
| 2.1 | El paciente ve su perfil | paciente | Solo sus datos |
| 2.2 | Ver disponibilidad y reservar un bloque | paciente | Bloque pasa a `reservada` |
| 2.3 | No puede reservar un bloque ya tomado | paciente | Mensaje de bloque no disponible |
| 2.4 | Liberar cita con **menos de 1 h** de anticipacion | paciente | Rechazado (regla de 1 hora) |
| 2.5 | Liberar cita con mas de 1 h | paciente | Permitido, bloque vuelve a `disponible` |
| 2.6 | El paciente no ve datos de otros pacientes | paciente | Sin acceso cruzado |

## Fase 3 — Ficha clinica (append-only)

| # | Caso | Cuenta | Resultado esperado |
|---|---|---|---|
| 3.1 | Abrir `/pacientes`: la lista esta vacia | doctor | 0 pacientes, sin errores de consola |
| 3.2 | Crear paciente | doctor | Se crea con los campos minimos |
| 3.3 | Abrir la ficha del paciente nuevo | doctor | El embed del creador **no** da error de rol |
| 3.4 | Crear ficha | doctor | Se crea; el trigger de inmutabilidad sigue activo |
| 3.5 | Editar ficha: debe ser **imposible** | doctor | Sin boton de edicion, o el trigger rechaza |
| 3.6 | Crear enmienda de auditoria | doctor | Se agrega una entrada nueva, no se edita la anterior |
| 3.7 | Adjuntar anexo clinico | doctor | Sube a Storage y queda listado |
| 3.8 | Abrir anexo | doctor | Se descarga o abre correctamente |

## Fase 4 — Interconsultas

| # | Caso | Cuenta | Resultado esperado |
|---|---|---|---|
| 4.1 | Ver interconsultas (base vacia) | doctor | 0 filas, sin error de consola |
| 4.2 | Crear interconsulta | doctor | Requiere paciente con ficha |
| 4.3 | Responder interconsulta | doctor | Queda registrada la respuesta |
| 4.4 | Ver el autor/origen | doctor | **El embed de rol resuelve sin ambiguedad** |

## Fase 5 — Finanzas y administration

| # | Caso | Cuenta | Resultado esperado |
|---|---|---|---|
| 5.1 | `/finanzas` con 0 datos | administrativo | Listado vacio, sin errores |
| 5.2 | Registrar bono | administrativo | Se crea el bono |
| 5.3 | Partidas del presupuesto | administrativo | Cuadran con el bono |
| 5.4 | `/bandeja-ordenes` vacia | apoyo | 0 ordenes |
| 5.5 | `/usuarios`: listado | admin | 14 cuentas, roles legibles |
| 5.6 | Agregar un rol a un usuario | admin | Se suma, **no se reemplaza** (modelo N-roles) |
| 5.7 | Desactivar una cuenta | admin | `activo = false`; la cuenta no entra |
| 5.8 | `/config-recinto` | admin | Configuracion legible y editable |

## Fase 6 — Seguridad (regresion)

| # | Caso | Verificacion |
|---|---|---|
| 6.1 | Un rol sin permiso no accede por URL directa | `RoleRoute` + RLS |
| 6.2 | La ficha no se puede editar por API | Trigger de inmutabilidad activo |
| 6.3 | La enfermeria no atiende en otra especialidad | RPC de validacion |
| 6.4 | Un profesional no agenda fuera de su especialidad | RLS de `horarios_disponibles` |

---

## Notas de ejecucion

- **Orden**: las fases son secuenciales. La 0 bloquea todo; la 1 depende de la 0.
- **Base limpia**: si la fase 3 pide datos que no existen, se crean en esa misma
  fase y se anotan como parte del caso. No se adelantan.
- **Los 6 casos fallidos de la ronda anterior** (1.1, 1.3, 1.4, 1.6, 1.8, 1.9)
  estan cubiertos aqui: 1.1 -> Fase 1, 1.3 -> Fase 1, 1.4 -> Fase 1,
  1.6 -> Fase 1, 1.8 -> Fase 4, 1.9 -> Fase 1.
- Al cerrar la ronda completa, rotar las claves con
  `supabase/rotar_contrasenas_demo.sql` y actualizar `AGENTS.md`.