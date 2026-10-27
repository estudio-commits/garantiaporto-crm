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

## Actualización de identidad, orígenes y pipeline

Aplicar `005_sources_pipeline.sql` después de 004 en el backend de pruebas. Incorpora catálogo `client_sources` con lectura para usuarios activos y edición exclusiva de administradores, `applications.source_id` y la etapa comercial `en_preaprobacion`. `source` conserva el medio técnico (web/manual). Los registros web se vinculan al origen web; los manuales históricos quedan sin identificar hasta revisión. El receptor web asigna el UUID estable del origen web incluso si su etiqueta cambia. Archivar orígenes conserva relaciones históricas, pero impide nuevas selecciones manuales. Los cambios de origen y etapa quedan auditados.

El pipeline y la lista comparten `applications.stage`. Mover tarjetas no cambia preaprobación interna ni decisión formal. En móvil y teclado se puede usar el selector de etapa de cada tarjeta. Las tasas del inicio son aprobadas/(aprobadas+rechazadas), agrupadas por origen y por tipo de garantía, solo sobre solicitudes activas accesibles al usuario. Sin decisiones se muestra “Sin decisiones”, no 0%. No se infiere perfil personal ni elegibilidad.

La demo conserva `porto-demo-v1` y actualiza los campos nuevos sin borrar notas o solicitudes. Para actualizar en Windows: detener el servidor anterior con Ctrl+C, descargar el ZIP actualizado de la rama codex/crm-demo, extraer, ejecutar npm ci y npm run dev desde la nueva carpeta. Usar el mismo puerto conserva los datos del navegador; otro puerto tiene almacenamiento independiente.

Identidad: SVG oficiales suministrados y cuatro pesos locales de Roobert. Los archivos entregados son TRIAL y su archivo de licencia dice “Personal Use Only”. Se incluyeron para revisar el prototipo, conservando la licencia en `public/fonts/LICENSE.txt`; antes de uso comercial se necesita una licencia web apropiada y sustituir los archivos trial. No se descargan fuentes externas al abrir el panel.
