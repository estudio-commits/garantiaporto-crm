# Contrato de integración v1 (aislado)

POST `/api/integration/events`, JSON validado por `lib/domain.ts`. Campos: schema_version=1, event_id UUID por envío, solicitud_id UUID por solicitud, step=1|2, sent_at ISO UTC, data con full_name y phone obligatorios. Importes numéricos sin separadores; phone/CI son texto. Extra permite campos simples acotados y versionados. Datos desconocidos deben mapearse a extra tras inspección, nunca copiar payload arbitrario sin validar.

Activación explícita: `CRM_INTEGRATION_ENABLED=true`, URL Supabase, clave de servicio y `CRM_WEBHOOK_SECRET` en entorno de servidor. Cabeceras `x-crm-timestamp` (segundos Unix) y `x-crm-signature` (hex HMAC SHA256 de timestamp + '.' + cuerpo JSON exacto). Ventana de 5 minutos, límite de 32 KiB y 120 eventos firmados válidos por minuto compartidos por el emisor (contador PostgreSQL, respuesta 429 con Retry-After). Cada reintento vuelve a firmar con timestamp actual y conserva event_id, solicitud_id y payload. Mismo event_id con otro payload produce 409. Exitoso/duplicado 200; schema inválido 422; no autenticado 401; deshabilitado/indisponible 503.

`npm run simulate` envía únicamente datos ficticios al loopback. Requiere configuración de backend aislado e integración habilitada. No apunta a la web. Tests SQL prueban la transacción sin depender de servicios externos.

La base serializa por solicitud con advisory lock y conserva eventos. Parte 2 completa sin resetear gestión. Parte 1 tardía no degrada. Discrepancias no sobrescriben valores válidos y quedan marcadas. Nuevas solicitudes crean contactos provisionales independientes: hasta contar con identificación fiable, la conciliación de contactos queda pendiente y nunca se hace por PII automáticamente.

Antes del adaptador real: leer popup, handlers JS/PHP, acciones Elementor, emails, submissions; identificar campos, confirmación de éxito, validación de consentimiento y transporte del identificador. La apertura de popup no es un envío. Mantener la precarga window.datosCotizadorGarantia. No usar parsing de emails. Auditar implementación antes de definir ID compartido.

Pendiente en staging: cola duradera del emisor, reintentos con backoff, conciliación/manual replay, ajuste de la cuota de tasa y pruebas de caída con el stack WordPress real. El receptor solo no garantiza recuperar envíos que nunca llegaron. Conservar correo y Ads y obtener autorización separada para cambios del sitio.


## Marketing e identidad (migración 007)

`data` admite además fbclid, referrer, landing_page, form_id y button_id. Es estricto: una clave desconocida devuelve 422 y debe mapearse a extra; nunca se elimina silenciosamente. `extra` conserva campos escalares acotados en el evento original (admin). Campos conocidos de marketing dentro de extra se proyectan a attribution con prioridad del primer valor no vacío, sin exponer extras arbitrarios.

CI válida de 7 u 8 dígitos, con o sin formato, completa applications.national_id sin sustituir una identidad existente distinta. CI inválida o conflictiva conserva el evento y marca discrepancia para revisión. La CI no es el identificador idempotente: solicitud_id/event_id siguen siendo UUID. La ausencia de CI en paso 1 no bloquea un prospecto.

Ver [plan de conexión al formulario y WhatsApp](ONLINE-WEB-WHATSAPP.md) para cola, autenticación, consentimiento, puesta en producción y decisiones pendientes.
