# Contexto del Proyecto: SWIMyti

## 1. Descripción General
**Nombre:** SWIMyti (Sistema Web Integral Multi-rol Y Trazabilidad Inmutable).
**Objetivo:** Desarrollar un sistema web SaaS para la gestión clínica integral en centros de salud de mediana y baja complejidad. 
**Regla de Negocio Principal (Inmutabilidad por Diseño):** Las fichas médicas NO pueden ser editadas ni eliminadas una vez creadas (Append-Only). Cualquier modificación o corrección posterior se debe realizar a través de una tabla relacionada de "Enmiendas", la cual requiere obligatoriamente una firma digital del usuario y un timestamp de auditoría.

## 2. Stack Tecnológico
*   **Base de Datos:** PostgreSQL (alojada en Supabase).
*   **Backend/API:** Node.js / React (o el framework estructurado en el repositorio).
*   **Frontend:** React (JSX/TSX).
*   **Estilos:** CSS Puro (Responsive Design).
*   **Despliegue:** Vercel / Supabase.

## 3. 🚨 REGLAS ESTRICTAS DE DESARROLLO (HARD CONSTRAINTS) 🚨
El agente de IA DEBE cumplir estas reglas en todo el código generado:
1.  **CERO FRAMEWORKS CSS:** Está ESTRICTAMENTE PROHIBIDO utilizar Bootstrap, Tailwind CSS, Material UI, Chakra, o cualquier librería de componentes. Todo el diseño, layout (Flexbox/Grid) y responsividad debe ser escrito en archivos `.css` puros.
2.  **Seguridad a Nivel de Fila (RLS):** Toda interacción con la base de datos en Supabase debe estar protegida con Row Level Security (RLS). Los datos demográficos sensibles (RUT, previsión) solo pueden ser modificados por el rol Administrador.
3.  **RBAC (Control de Acceso Basado en Roles):** El sistema debe manejar validación de permisos en el Backend y renderizado condicional en el Frontend según el perfil del usuario autenticado.
4.  **Integridad Relacional:** La base de datos debe cumplir con la Tercera Forma Normal (3FN).

## 4. Roles del Sistema
1.  **Administrador:** Acceso total, gestión de usuarios, edición de datos sensibles (RUT).
2.  **Doctores:** Creación de fichas inmutables, ingreso de enmiendas (correcciones).
3.  **Enfermería:** Creación de fichas inmutables, visualización de historial.
4.  **Administrativos:** Registro de pacientes (datos de contacto), visualización básica. No pueden editar datos sensibles sin permiso temporal.
5.  **Unidades de Apoyo (Laboratorio/Imagenología):** Subida de archivos (Anexos Clínicos) a una ficha existente.
6.  **Paciente:** Modo de solo lectura (portal paciente).

## 5. Estructura Inicial de Base de Datos (Esquema Relacional)
El agente debe basarse en estas 7 entidades principales (Normalizadas en 3FN):
1.  `ROLES` (id_rol, nombre_rol)
2.  `USUARIOS` (id_usuario, id_rol, credenciales_auth)
3.  `PACIENTES` (id_paciente, rut_sensible, datos_contacto)
4.  `FICHAS_MEDICAS` (id_ficha, id_paciente, id_usuario_creador, diagnostico_inmutable, timestamp)
5.  `ENMIENDAS_AUDITORIA` (id_enmienda, id_ficha, id_usuario_autor, correccion_justificada, timestamp)
6.  `ANEXOS_CLINICOS` (id_anexo, id_ficha, url_documento)
7.  `PERMISOS_ESPECIALES` (id_permiso, id_usuario_solicitante, estado_aprobacion)

## 6. Siguiente Paso / Instrucción Inmediata
Agente, al leer este documento, tu primera tarea es preparar el **script DDL SQL completo para PostgreSQL (Supabase)** que genere las 7 tablas descritas, estableciendo correctamente las llaves primarias (PK), foráneas (FK), restricciones de inmutabilidad (ej. triggers para evitar UPDATE/DELETE en `FICHAS_MEDICAS`) y políticas RLS básicas.