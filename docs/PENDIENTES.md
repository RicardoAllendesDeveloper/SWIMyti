# Pendientes de SWIMyti — estado al momento de postergar

**Estado del proyecto:** POSTERGADO INDEFINIDAMENTE por el usuario (2026-10-06).

Este archivo existe para que retomar el proyecto no dependa de recordar la conversación en la que se
decidió pausarlo. Documenta **qué quedó a medias, por qué, y en qué orden conviene retomarlo**.

> **Por qué está postergado.** No es un problema del producto ni de la ejecución técnica. El modelo
> comercial que lo sostenía no resiste el contraste con el mercado real chileno, y hay 8 requisitos
> legales bloqueantes. El detalle completo está en el análisis de viabilidad y en
> `E:\Actuales\Proyectos Devs\Estrategias laborales y de empleabilidad\CONTEXTO-LABORAL.md` (sección
> 4, "Factores que llevaron al fracaso el modelo original").
>
> **Condición para retomar:** tener fondos propios o una base de ingresos robusta que absorban el
> riesgo de un cliente.clinical. Mientras tanto el trabajo va a freelance.

---

## Plan en curso — semana del 9 al 16 de octubre de 2026

**Objetivo de la semana:** dejar la propuesta lo más completa posible antes de que la base vuelva a
dormirse, avanzando solo en lo que **no depende de tener clientes**. En paralelo siguen el trabajo
freelance, la práctica y la búsqueda de empleo.

**Estado de la base.** El proyecto Supabase se pausó solo (plan gratuito, 7 días sin actividad) y ya
fue resumido: datos y configuración intactos. Se mantiene arriba mientras haya consultas; si pasan
~7 días sin una sola consulta se vuelve a pausar, y **eso es lo esperado, no una falla**. La ventana
para resumirlo otra vez es de **90 días** según el correo de aviso (la documentación dice 1 año), así
que se trata como 90 días y conviene anotar la fecha exacta de la próxima pausa.

**Frentes elegidos:**

1. **Decisión de tenancy multi-centro** (ver Bloque 3). Va primero porque es la decisión que, mal
   tomada, obliga a migrar datos de clientes reales después. No depende de tener clientes.
2. **Bitácora de accesos — Decreto 41 art. 9** (ver 2.1). Es el requisito legal más barato de
   resolver y el más fácil de auditar que exista: barato ahora, caro después.

**Queda acordado para más adelante:** volver a testear las funciones básicas del sistema y terminar
la reparación que estaba en curso cuando apareció el problema que detuvo el proyecto. Se retoma con
calma, cuando el resto del trabajo lo permita.

**Nota operativa.** Las migraciones se siguen aplicando pegando el `.sql` completo en el SQL Editor
del dashboard, como las 62 anteriores. El historial de `supabase_migrations` sigue vacío: no se usa
`db push` ni `apply_migration`.

---

## Estado técnico actual: el proyecto está sano

Antes de los pendientes, lo que sí está verificado y funcionando:

| Área | Estado |
|---|---|
| Migraciones | 62 aplicadas y versionadas |
| Suite SQL | 42/42 casos pasando (`supabase/tests/fase2_atencion.sql`) |
| Auditoría RLS | Al día con la regresión de triggers cubiertos |
| Tests frontend | 71/71 (Vitest) |
| Validador de consultas | 44 consultas / 13 RPC / 0 fallos |
| Build | `tsc -b && vite build` correcto |
| Deploy | `https://swi-myti.vercel.app` publicado |
| Repositorio | `https://github.com/RicardoAllendesDeveloper/SWIMyti` (público, saneado) |

**El código no está roto ni a medio construir.** Los pendientes de abajo son mejoras y
cumplimientos legales, no repair de emergencia.

---

## Bloque 1 — Integridad atención ↔ bono ↔ cita ↔ ficha (Fase 2)

**Prioridad: la más alta.** Es trabajo de diseño de datos, y el diseño no se improvisa cuando ya
hay clientes: una migración mal pensada acá obliga a migrar datos reales después.

### 1.1 Vínculo `fichas_medicas` ↔ `atenciones`

La tabla `atenciones` ya existe (migración `20261002093000_atencion_como_entidad.sql`) y valida que
toda atención tenga cita y bono. Falta el eslabón con la ficha:

- [ ] Migración compensatoria: agregar **`fichas_medicas.id_atencion`** (nullable, por compatibilidad
      con fichas históricas)
- [ ] Trigger para fichas nuevas: toda ficha creada debe apuntar a una atención existente
- [ ] Actualizar tipos en `frontend/src/types/database.ts`
- [ ] **`frontend/src/pages/Dashboard.tsx`**: crear ficha ligada a una atención
- [ ] **`frontend/src/pages/Expediente.tsx`**: mostrar el vínculo

**Restricción dura que NO se debe violar:** `atenciones` y `fichas_medicas` **permanecen tablas
separadas**. No agregar `id_cita` ni `id_bono` a `fichas_medicas`. El vínculo va en la dirección
`fichas_medicas → atenciones`.

**Por qué importa:** sin este vínculo, la trazabilidad de la Ley 19.628 tiene un hueco. La ficha
existe, la atención existe, pero no se puede probar que una atención específica produjo una ficha
específica.

### 1.2 Cobertura en la suite de pruebas

- [ ] Agregar el vínculo a `supabase/tests/fase2_atencion.sql`, siguiendo el patrón del bloque 8 de
      `supabase/tests/auditoria_rls.sql`

---

## Bloque 2 — Cumplimiento legal (bloqueantes reales)

Estos no son mejoras de producto. **Son condiciones para poder vender a un centro de salud**, y varios
son cheap de resolver ahora y caros después de tener clientes.

### 2.1 Bitácora de accesos — Decreto 41 art. 9 — ALTA

El decreto exige registrar **fecha y persona que accedió a la ficha**, y acceso con clave personal
e intransferible.

- [ ] Tabla de auditoría de accesos (distinta de `enmiendas_auditoria`, que es otra cosa)
- [ ] Trigger o RPC que registre el acceso en cada lectura de ficha
- [ ] Tests que verifiquen que se registra

Es el más barato de resolver y a la vez más fácil de auditar que exista. **Barato ahora, caro
después.**

### 2.2 Derecho de copia del paciente — Ley 20.584 art. 13 — ALTA

El paciente es titular de su ficha y tiene derecho a copia íntegra, **gratuita y sin dilaciones
indebidas**, en formato estructurado, de uso común, legible y portable.

> **Corrección a una decisión anterior:** la regla de "no existe protocolo de entrega de la ficha en
> PDF ni en Word" de `AGENTS.md` es **un riesgo legal, no una decisión de producto**. La nota de que
> "depende de lo que decida cada recinto" es cierta en la práctica, pero un PDF cifrado tampoco
> satisface la letra de la ley si el destinatario es otro prestador.

- [ ] Decidir el mecanismo (exportación estructurada, no PDF)
- [ ] Distinguir claramente entre:
  - **art. 12:** el paciente NO puede consultar la ficha en línea si hay terceros no vinculados
    → esta prohibición **SÍ se sostiene**
  - **art. 13:** derecho a copia íntegra → **esto falta**

Son dos cosas distintas. La prohibición de consulta en línea se mantiene; falta el proceso de entrega.

### 2.3 Inmutabilidad vs. derecho de rectificación y supresión — MEDIA

`fichas_medicas` es append-only (requisito de la Ley 19.628). Eso **choca** con:

- art. 7 Ley 21.719 (rectificación y supresión)
- art. 6 Ley 19.628
- art. 13 Ley 20.584 (deber de conservar **15 años**)

Es un problema de **diseño de base de datos**, no de papeleo. La vía de resolución es
**enmienda con trazabilidad, nunca borrado**: ya existe `enmiendas_auditoria` con trigger de
inmutabilidad, así que el patrón está medio construido.

- [ ] Decidir cómo se concilia append-only con supresión
- [ ] Verificar el plazo de 15 años (política de retención)

### 2.4 Interoperabilidad / exportación estructurada — ALTA

La FCE "deberá estar diseñada para interoperar con otros sistemas" (Ley 21.541 + Ley 20.584
art. 13). SWIMyti no tiene FHIR ni exportación estructurada.

**Es la brecha técnica/comercial más grande del proyecto**, y también la más cara. No atacar antes de
tener un cliente que la exija.

### 2.5 Bitácora de auditoría de RLS pendiente de ampliar

`supabase/tests/auditoria_rls.sql` tiene el bloque 8 (regresión de `SECURITY DEFINER`). Los enlaces
1.1 y 2.1 agregan casos nuevos a esa suite.

---

## Bloque 3 — Cosas menores, no bloqueantes

Ordenadas por relación effort/valor, no por dificultad.

- [ ] **Tres capturas sin embeber en los README:**
      `capturas/01-landing.png`, `02-login.png`, `09-fichas-medicas.png`. El README tiene 6 de las 9
      capturas disponibles. Es un commit de una línea.
- [ ] **`supabase/migrations/20261001160000_avisos_recinto_dashboard.sql`**: la migración existe pero
      quedó fuera del historial de forma replay-safe. Verificar si se aplica limpia desde cero.
- [ ] **Arquitectura multi-centro** (`id_recinto` compartido vs. un proyecto Supabase por centro):
      decisión **no tomada**. El análisis de costo está hecho (infra marginal ≈ $10/mes por centro), y
      la conclusión es que el riesgo del modelo por centro es **operacional, no monetario**: N
      proyectos = N tablas de migraciones que aplicar N veces.
- [ ] **Reactivos de inmutabilidad adicionales** en `avisos_recinto` y `avisos_retiro`: si alguna vez
      se hace un reset de base, hay que desactivarlos primero (4 triggers, update y delete).

---

## Reglas de oro del proyecto (vigentes aunque esté postergado)

Estas son las restricciones que hicieron que SWIMyti no fuera un CRUD más. Si se retoma, son
inegociables.

### Seguridad

- La seguridad vive en **RLS + RPCs**. `RoleRoute` y `utils/permisos.ts` solo controlan navegación
  (UX). Nunca son seguridad.
- **Nunca** aflojar una política RLS para resolver un problema de permisos. El patrón correcto es
  una RPC `SECURITY DEFINER` con validaciones explícitas.
- ⚠️ **Un trigger que ESCRIBE en otra tabla debe ser `SECURITY DEFINER`**. Sin eso corre como el
  usuario que disparó la sentencia, y si ese rol no tiene política de escritura sobre la tabla
  destino, el `UPDATE` afecta **0 filas sin error**. Costo real: `fn_liberar_horario` era `invoker` y
  los bloques quedaban `reservada` para siempre. La regresión está en `auditoria_rls.sql` bloque 8.
- En RLS, `FORCE ROW LEVEL SECURITY` no protege frente a funciones `SECURITY DEFINER`: `postgres`
  tiene `rolbypassrls = true`. Para tráfico `anon`/`authenticated` el control efectivo son las
  **políticas**, así que toda política debe ser `TO authenticated` (o una allowlist deliberada),
  nunca `TO public`.
- **Revocar es sobre `PUBLIC`**, no sobre `anon, authenticated`: el `EXECUTE` por defecto viene del
  privilegio `PUBLIC`.
- En Postgres, RLS decide **qué filas**, nunca **qué columnas**. Para columnas: trigger o RPC. El
  patrón es `fn_proteger_datos_sensibles_paciente`.

### Datos

- `fichas_medicas` y `enmiendas_auditoria` son **append-only**. Los triggers bloquean `update` y
  `delete`. Todo cambio es un registro nuevo.
- La BD almacena `timestamptz` en **UTC**. Toda generación de bloques ancla a `America/Santiago`.
- **Bloques de 15 minutos**, generados siempre vía RPC generadora, nunca inserts desde el cliente.
- Horizonte móvil de **30 días** para bloques de toma de muestra. No extender a 365.
- El **teléfono al paciente es tarea humana de recepción**. El sistema no llama.
- **`lc_time` es `en_US.UTF-8`** y no hay collations `es_*`. Para texto visible en español usar
  `fn_nombre_mes_es(integer)`, nunca `to_char(fecha, 'Month')`.

### Comercial

- **Restricción DURA: desarrollo en plan gratuito.** No invertir en Supabase ni Vercel hasta cerrar
  un acuerdo con un cliente. Recordar que **Vercel Hobby prohíbe el uso comercial**, así que el plan
  Pro hay que pagarlo desde el cliente #1, no cuando "haya clientela".
- No se pueden agregar features de plan pagado (Edge Functions para correo, etc.) hasta que exista
  cliente.

### Verificación

Cuando se toque un `select` con embeds, correr `npm run consultas`. PostgREST **no acepta espacio
entre dos paréntesis de cierre**; ese error rompió 7 pantallas a la vez porque los dos estilos
convivían en el mismo archivo.

Comandos: `npm run build`, `npm run test`, `npm run lint`, `npm run consultas`
(este último necesita `ADMIN_PASSWORD` en el entorno).

---

## Orden de retomación sugerido

Cuando el usuario decida retomar, este es el orden que evita el mayor daño:

1. **Primero** definir tenancy (¿un proyecto Supabase por centro, o `id_recinto` compartido?). Es la
   decisión que, mal tomada, obliga a migrar datos de clientes reales.
2. **Segundo** cerrar el diseño de `fichas_medicas ↔ atenciones` (Bloque 1). Otra vez: diseño de
   datos, barato ahora.
3. **Tercero** los legales baratos que auditan: bitácora de accesos (2.1) y derecho de copia (2.2).
4. **Cuarto** interoperabilidad (2.4), que es la más cara y la que conviene atacar con un cliente
   real que la exija.
5. **Al final** las cosas menores del Bloque 3.

Los puntos 1 y 2 **no dependen de tener clientes** y son los que se pasan mientras el proyecto está
pausado. Los legales de bajo esfuerzo también.

---

## Referencias

- Análisis de viabilidad comercial y legal: `E:\Actuales\Proyectos Devs\Estrategias laborales y de empleabilidad\CONTEXTO-LABORAL.md`, sección 4
- Plan de pruebas vigente: `docs/PLAN_PRUEBAS_V2.md`
- Protocolo de seguridad: `docs/PROTOCOLO_SEGURIDAD.md`
- Contexto funcional autoritativo: `AGENTS.md` (ignorado por git, contiene credenciales demo)
- Repositorio: `https://github.com/RicardoAllendesDeveloper/SWIMyti`
