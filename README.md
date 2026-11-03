# Garantía Porto CRM

Primera implementación aislada basada en especificación v1.3. Next.js / TypeScript / Supabase PostgreSQL + Auth + RLS. No modifica WordPress, cotizador, emails ni conversiones. No envía notificaciones comerciales ni automatiza WhatsApp, Clearing o decisiones.

## Ejecutar

Node 24 (probado), npm 11. `npm ci`, `npm run dev`. Sin variables Supabase se abre una **demo ficticia local**, persistida en localStorage (`porto-demo-v1`). La selección de rol demo NO autentica ni protege información: nunca ingresar datos reales. Para reiniciar, eliminar esa clave del navegador. No publicar la demo como CRM operativo.

Con `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY`, la aplicación exige Supabase Auth y aplica las políticas reales. Configurar únicamente un proyecto de desarrollo vacío. Aplicar migraciones de `supabase/migrations` en orden, con el propietario de la base. Crear el primer usuario desde Auth y un perfil admin con su UUID; no hay registro público. El admin puede crear las siguientes cuentas desde Equipo (requiere `SUPABASE_SERVICE_ROLE_KEY` solo en servidor). Deshabilitar signup público en Supabase y configurar redirect URL de recuperación `/login`. La recuperación requiere SMTP de Auth; todavía no se verificó contra un proveedor externo. No colocar claves de servicio en variables NEXT_PUBLIC ni en archivos versionados.

Copiar `.env.example` a `.env.local` sin incluir valores en commits. Variables vacías no conectan servicios. La integración está deshabilitada por defecto. Credenciales y producción pendientes de configuración por el responsable.

## Comprobaciones

- `npm run typecheck`: TypeScript.
- `npm test`: formatos monetarios, correlación y validación de eventos.
- `npm run test:db`: contenedor PostgreSQL 17 desechable, migraciones y pruebas reales de RLS/ingesta. Emula únicamente `auth.uid()`/roles para comprobar SQL; no equivale a probar Supabase Auth remoto. Docker requerido.
- `npm run test:e2e`: Chromium obtenido mediante paquete npm `@sparticuz/chromium`, recorridos demo y diseño móvil. No requiere CDN de Playwright. Configurado para Linux.
- `npm run build`: compilación de producción.

## Capacidades y límites actuales

Dashboard, lista paginada en cliente, búsqueda por nombre/teléfono, filtros básicos; ficha, edición, alta manual, asignación, estados independientes, archivado, resumen, notas históricas, auditoría, Clearing manual con permiso, datos sensibles admin-only, usuarios/permisos y campos personalizados. Backend de recepción con firma, transacciones, eventos únicos, discrepancias y orden invertido. La vinculación de contactos históricos y conciliación visual de discrepancias son pendientes: no hay fusión automática por datos personales.

La lista carga los registros autorizados por RLS antes de paginar: requiere paginación y filtros en servidor antes de escalar a grandes volúmenes. No incluye subida de archivos; documentación es estado/seguimiento y referencias. El panel de integración muestra intentos; reentrega persistente del emisor y adaptación al formulario real requieren la siguiente fase. La demo no simula seguridad real; las pruebas de permisos se ejecutan en PostgreSQL.

## Estructura

- `app/`: rutas del panel, login, administración e integración.
- `components/`: interfaz y gestión de usuarios.
- `lib/`: tipos, validación, cliente Supabase y fixtures.
- `supabase/migrations/`: esquema, RLS, triggers, ingesta y validación.
- `tests/`: negocio, SQL y navegador.
- `docs/INTEGRATION.md`: contrato y preparación de integración.
- `docs/OPERATIONS.md`: seguridad, operación y próximos pasos.

## Panel actualizado

Inicio simplificado con resumen y tasas de aprobación formal por origen/tipo de garantía. Solicitudes mantiene la lista con origen, etapa y responsable; Pipeline ofrece arrastrar tarjetas o moverlas con un selector accesible. Ambos comparten estado. Control de datos permite crear, renombrar y archivar orígenes y administrar campos personalizados. Orígenes iniciales: garantiaporto.com.uy y Negocio inmobiliario. La carga manual se registra por separado del origen comercial. Garantías tradicional, universitaria y rural visibles en lista, pipeline y ficha.

La migración 005 habilita estas funciones en Supabase. La demo se actualiza sin borrar datos guardados. Consultar la nota sobre archivos de fuente TRIAL en docs/OPERATIONS.md antes de producción.

## Procesos comerciales y de garantía

Ahora hay dos pipelines independientes: comercial (nuevo cliente, en contacto, finalizado) y garantía (sin contactar, documentación solicitada/recibida, preaprobación cargada, aprobada/rechazada). Las tarjetas abren una ficha lateral sin salir del tablero. Se ordenan por última modificación o ingreso; las alertas se basan en el último comentario y el día calendario de Uruguay (próximo al día siguiente, urgente desde el segundo), excluyendo garantías aprobadas/rechazadas y archivadas. Sin comentarios se usa el ingreso; editar datos no elimina la alerta.

La ficha reúne datos del cliente, fecha de ingreso, fecha de solicitud, enlace de carpeta Drive y ambos estados. Documentos exclusivamente en Drive: el CRM solo guarda el enlace. Historial cronológico con valores anteriores/nuevos, responsables y seguimientos; datos sensibles mantienen sus permisos. Rechazo formal exige un motivo y respaldo; solo administración registra decisiones finales. Para Supabase se requieren las migraciones hasta 007; la demo migra los datos anteriores automáticamente.


## Inicio, comentarios, marketing y estadísticas

Menú principal: Inicio → Pipeline → Lista de clientes → Estadísticas; administración conserva Equipo, Control de datos e Integraciones. Inicio muestra únicamente carga nueva y accesos a solicitudes, preaprobaciones (documentación recibida) y emisiones (aprobadas). Hasta registrar una emisión explícita, todas las aprobadas cuentan como pendientes; no se deduce emisión de una aprobación.

Pipeline reúne Gestión comercial / Gestión de garantía. Tarjetas con tipo, nombre, CI, ingreso, origen, alquiler y responsable; se mueven arrastrando o desde los estados de la ficha, accesible con teclado/móvil. El botón Agregar comentario abre tipo Comentario/Comunicación/Actualización y texto inicial editable. Registrar un comentario no infiere cambios de estado por su contenido.

CI obligatoria en carga manual, opcional para leads web incompletos. Admite `0.000.000-0` y `000.000-0` o dígitos; se almacena sin separadores, conserva ceros y se presenta formateada. Se valida formato, no identidad ni dígito verificador. Sigue existiendo un UUID interno por solicitud: varias solicitudes de la misma CI no se fusionan automáticamente. Registros antiguos sin CI quedan como Sin informar.

Estadísticas compara origen/campaña/tipo, decisiones y conversión, etapas actuales, rechazos y gestión del equipo. Cohortes por ingreso, incluidos archivados; comentarios por autor/fecha. No se inventan costos publicitarios ni rentabilidad. Marketing conserva atribución y muestra eventos originales a administración.

La migración `007_identity_comments_marketing.sql` mantiene fechas de actividad al migrar CI, agrega tipo de comentario y extiende captura de marketing. CI pasa a ser accesible al vendedor asignado junto con el caso; ingresos, motivo sensible y eventos originales siguen restringidos. No se ejecutaron migraciones sobre una base de producción.

**Publicación, seguridad, conexión web y WhatsApp:** [guía completa](docs/ONLINE-WEB-WHATSAPP.md). Para actualizar localmente: descargar la rama actualizada, abrir la carpeta en VS Code, `npm ci`, `npm run dev`. Usar la misma dirección/puerto conserva la demo del navegador.
