# Operación y alcance de esta entrega

Separar Supabase/Vercel de desarrollo y producción. Ningún dato real en fixtures, pruebas, capturas, logs o prompts. HTTPS y secreto de firma fuerte en entorno seguro; no registrar cuerpos ni tokens. El cliente usa anon key pública con JWT de usuario y RLS; la clave de servicio solo se usa en rutas servidor restringidas.

RLS abarca casos, notas, auditoría, datos sensibles, Clearing y campos personalizados. Vendedor solo ve sus asignados; no puede asignar, cambiar decisión formal, acceder a eventos originales ni administrar perfiles. Admin-only para cédula/ingresos en esta versión conservadora. Clearing exige permiso específico. Desactivación revoca acceso a datos por cada consulta aun con JWT vigente. Contactos canónicos no son visibles a vendedores, evitando exposición entre solicitudes compartidas. No hay borrado ordinario de notas/auditoría. Datos anteriores/nuevos de estados y asignación quedan auditados; cambios sensibles registran actividad sin duplicar valores en la auditoría general.

## Antes de producción

- Verificar login, recuperación/SMTP, creación de usuarios y expiración de sesión en Supabase real; configurar política de contraseñas y MFA para admins.
- Revisar recuperación de contraseña y redirects permitidos, HTTPS, CSP y controles de tasa distribuidos.
- Confirmar normativa uruguaya, finalidad de tratamiento y plazos de retención/borrado. Consentimiento: no inferir aceptación técnica ni rechazo de email vacío.
- Configurar backups gestionados según plan Supabase. Ejecutar restauración en proyecto aislado, aplicar verificaciones de esquema, conteos y políticas. Documentar RPO/RTO y responsable. No se ha realizado backup/restore externo.
- Verificar doble envío, orden inverso, concurrencia, discrepancias y caídas del receptor con cola del emisor. Preservar mediciones, correos y cotizador.
- Completar paginación/búsqueda de servidor, filtros de todas las dimensiones y periodos, conciliación manual de contactos/eventos antes de declarar todo el MVP v1.3 terminado.
- Aprobación explícita para dominio, despliegue y conexión de producción. Rollback del adaptador debe detener únicamente entregas al CRM y conservar cola, emails y captación original.

## Entorno cloud

Las tareas ya están aisladas: usar este checkout, no crear worktrees salvo pedido explícito. Instalar con npm ci; el caché npm se ubica en /workspace/.npm-cache por permisos del entorno. Los procesos no sobreviven snapshots: iniciar npm run dev en cada tarea cuando haga falta. La base PostgreSQL usada en tests es desechable; no es el backend conectado al panel.
