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

## Procesos separados, documentación externa e historial

Aplicar `006_separate_workflows.sql` después de 005. El estado comercial tiene exactamente `nuevo`, `en_contacto`, `finalizado`. El proceso de garantía tiene `sin_contactar`, `documentacion_solicitada`, `documentacion_recibida`, `preaprobacion_cargada`, `aprobada`, `rechazada`. Cambiar un eje no modifica el otro. Los campos del esquema anterior se conservan para trazabilidad/integración, pero ya no se presentan como controles principales de ficha.

Migración: nuevo conserva nuevo; finalizado/descartado pasan a finalizado; las otras etapas comerciales pasan a en_contacto. La garantía se deriva primero de la decisión formal existente, después de la preaprobación/documentación registrada. Se guarda un snapshot administrativo del modelo anterior, se conservan fecha de ingreso y última modificación, y no se atribuye una nueva actividad al cliente por migrar. La demo conserva y migra su almacenamiento sin borrar notas ni campos.

Decisiones finales: solo administración puede aprobar, rechazar o reabrir; se exige fecha y respaldo. Rechazar exige uno de los cuatro motivos: ingresos, score, documentación insuficiente o Clearing. El motivo se guarda en la tabla sensible y en auditoría privada para no exponer Clearing por un campo alternativo. `set_guarantee_decision` realiza la decisión y motivo en una transacción. No consulta Clearing ni decide automáticamente.

La fecha de ingreso al CRM (`created_at`) es inmutable y se asigna en servidor. La fecha de solicitud (`requested_date`) es una fecha independiente editable: en alta manual se propone hoy en Uruguay; en integración se toma el primer evento disponible cuando no hay una fecha registrada. Casos anteriores sin evidencia conservan la fecha de solicitud vacía. Correcciones quedan auditadas.

Drive: solo se almacena un enlace HTTPS a una carpeta de drive.google.com, validado tanto en interfaz como en PostgreSQL. No hay cargas de archivos, copias, consultas de contenido, conectores ni modificación de permisos de Drive. Quien abre el enlace necesita acceso propio en Google Drive. La URL es visible a quienes pueden ver el caso.

Actividad: `updated_at` cambia ante una modificación real de datos/estado, identificación, Clearing, campos personalizados o nuevo seguimiento. Guardar lo mismo y consultar una ficha no renuevan el reloj. Orden predeterminado de ambos pipelines: modificación más reciente; también se puede ordenar por ingreso. La advertencia visual aparece a partir de 48 horas exactas en casos no archivados, incluidos los finalizados; se recalcula cada minuto mientras el panel permanece abierto. No se envían notificaciones.

Auditoría: se registran campo, valor anterior/nuevo, autor y fecha/hora de cambios nuevos. Identificación/ingresos y motivos de rechazo conservan visibilidad admin; Clearing requiere su permiso; los campos personalizados sensibles conservan visibilidad restringida. Las notas aparecen junto con los cambios en una única cronología. No es posible reconstruir valores anteriores que la versión inicial no hubiera guardado. El historial anterior disponible se conserva.
