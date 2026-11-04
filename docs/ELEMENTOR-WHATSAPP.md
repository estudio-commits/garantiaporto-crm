# Conexión para Garantía Porto: Elementor Pro y WhatsApp Business

Confirmado por el usuario: el sitio usa WordPress con Elementor Pro y su widget Formulario. Ya existe WhatsApp Business y portfolio comercial de Meta; todavía no está habilitada la API. No se ha cambiado la web ni creado/configurado servicios externos desde este repositorio.

## Adaptador preparado para WPCode

Ya se confirmaron dos formularios independientes en un popup, con recopilación de envíos y correo. El adaptador y los pasos de instalación están en [integrations/wordpress/README.md](../integrations/wordpress/README.md). Viene con captura y envío desactivados. Falta validarlo en el WordPress real antes de activar producción. Las notas siguientes describen el diseño y los controles de la integración.

## Elementor Pro: integrar sin perder el primer paso

Hay que revisar cómo están construidos los dos pasos. El campo **Step** de un único formulario Elementor suele dividir la interfaz, pero el envío ocurre al final; pulsar “Siguiente” no garantiza que haya un registro persistido. Si este es el caso, un webhook al envío final no satisface el requisito de crear el lead desde el primer paso.

Implementación propuesta, primero en una copia de pruebas del sitio:

1. Identificar si hay un formulario con pasos, dos formularios independientes o JavaScript adicional. Revisar el widget real y el código del popup, no deducirlo solo a partir del cotizador. Registrar el nombre/ID del formulario, IDs de campos, acciones posteriores al envío, validaciones y consentimiento.
2. Para dos envíos independientes, añadir una acción de formulario personalizada en un plugin propio de WordPress que tome los envíos validados de Elementor Pro y los guarde en una cola duradera. Para un único formulario multipaso, implementar captura validada al completar el paso 1 en servidor y usar el envío final de Elementor como paso 2. Este caso requiere un cambio acotado del sitio en staging, pendiente de implementación; no se resuelve únicamente activando la acción Webhook.
3. Mantener el mismo `solicitud_id` en ambos pasos, incluso al cerrar/reabrir el popup o reintentar. Crear `event_id` por envío, conservarlo en reintentos. Definir cuándo “Nueva solicitud” genera un nuevo identificador. La CI puede faltar al principio y no reemplaza esos UUID.
4. El plugin envía desde servidor al receptor del CRM con el formato y firma HMAC definidos en `INTEGRATION.md`. La acción Webhook estándar de Elementor no se conecta directamente a este receptor sin adaptar el cuerpo, la firma y la política de reintentos. No colocar el secreto en campos ocultos ni en JavaScript público.
5. Cola persistente, estados pendiente/enviado/error, reintentos y replay manual. Puede implementarse con Action Scheduler y registros propios, revisando la disponibilidad/versiones en el WordPress instalado. Un cron real del hosting ejecuta el worker: no depender exclusivamente de visitas a la web para vaciar la cola. Un fallo temporal del CRM no debe bloquear el registro del prospecto en WordPress ni los correos existentes.
6. Conservar Emails, Collect Submissions, conversiones y demás acciones que existan. Probar con datos ficticios que el paso 1 queda guardado, el paso 2 completa el mismo caso, los duplicados no crean clientes nuevos y los envíos se recuperan después de una caída.

Mapa a completar después de inspeccionar el formulario (los nombres de la izquierda son los del CRM, no se presumen IDs de Elementor):

| Campo del CRM | Dato a localizar en Elementor/cotizador |
| --- | --- |
| full_name / phone | Nombre y teléfono de paso 1 |
| rent_amount / rent_currency | Alquiler y moneda; conservar precarga del cotizador |
| national_id / monthly_income | CI e ingresos cuando corresponda en paso 2 |
| button_origin / button_id | Botón que abrió/inició la solicitud |
| source_url / landing_page / referrer | URL del registro, página de llegada y referente |
| utm_source/medium/campaign/content/term | Parámetros de adquisición preservados entre pasos |
| gclid / gbraid / wbraid / fbclid | Identificadores de clic cuando existan |
| form_id | Formulario real que produjo el envío |
| consent_evidence | Texto/versionado y evidencia del consentimiento recibido |
| extra | Otros campos escalares relevantes sin descartar los originales |

Pueden usarse campos ocultos y etiquetas dinámicas de Elementor cuando correspondan, pero los valores enviados por el navegador son entrada no confiable: validar en servidor. Preservar la atribución desde la llegada, no recalcularla únicamente en el último paso. Los campos de garantía que aún no estén mapeados no deben desecharse: conservarlos en extra y ampliar el contrato antes de depender de ellos operacionalmente.

La exportación de la plantilla/widget del formulario y el JavaScript que lo conecta con el cotizador permitirán preparar el adaptador concreto. No hace falta compartir credenciales de WordPress por el chat. Las pruebas deben hacerse con una copia de staging y datos ficticios.

Referencia técnica: [acciones personalizadas de formularios Elementor](https://developers.elementor.com/docs/form-actions/). Verificar las APIs contra la versión instalada.

## WhatsApp: siguiente paso con la cuenta que ya tenés

El portfolio comercial y la app WhatsApp Business son un punto de partida; no prueban que exista una cuenta de WhatsApp Business Platform habilitada ni credenciales API.

1. **Elegir Cloud API directa o un proveedor oficial.** Cloud API directa permite desarrollar el servicio del CRM con mayor control; un proveedor puede simplificar alta, bandeja humana y soporte, con costos propios. No es necesario elegir antes de comprobar cómo conservar el número actual.
2. **Comprobar el número y la coexistencia.** Si querés seguir usando la app WhatsApp Business con el mismo número, confirmar elegibilidad y un proceso de alta que soporte coexistencia. No se garantiza para toda cuenta, región o proveedor. No borrar ni desregistrar el número para intentar activar la API. Primero ensayar con un número de prueba; si coexistencia no está disponible, evaluar migración planificada o número separado.
3. **Alta oficial.** En la opción directa, configurar una app en Meta for Developers asociada al portfolio, añadir WhatsApp, usar la configuración de pruebas y vincular/crear la cuenta de WhatsApp Business Platform. Cumplir los requisitos que muestre Meta: permisos de administración, verificación empresarial cuando aplique, nombre para mostrar, número verificado, facturación y requisitos de puesta en producción. En un proveedor, usar su alta oficial/Embedded Signup y verificar quién será propietario de los activos.
4. **Credenciales y webhook.** El servicio necesitará el WABA ID, Phone Number ID, token de servidor con permisos mínimos apropiados, secreto de app para verificar firmas y token de verificación del webhook. Guardarlos en el gestor de secretos. No usar un token temporal de prueba en producción ni compartirlo por chat. Suscribir mensajes y estados de entrega.
5. **Consentimiento y plantilla inicial.** Revisar si el formulario autoriza explícitamente el contacto por WhatsApp y conserva evidencia. Preparar una plantilla de saludo para revisión de Meta, por ejemplo: “Hola {{1}}, recibimos tu solicitud de Garantía Porto. ¿Querés que te ayudemos con la documentación?”. Es un borrador, no una plantilla aprobada ni una categoría garantizada. El formulario web no abre la ventana de atención de WhatsApp; aplicar las reglas vigentes de plantillas y mensajes libres.
6. **Prueba antes del agente.** Recibir y responder mensajes con destinatarios de prueba, verificar firmas, deduplicación, límites, errores, entrega y pausa para intervención humana. Después conectar preguntas frecuentes y documentos por garantía a un agente limitado según `ONLINE-WEB-WHATSAPP.md`.

Decisión pendiente: mantener el número actual y la app, o usar un número separado. También faltan el texto de consentimiento actual, documentos requeridos para cada tipo de garantía, respuestas aprobadas, horarios y responsable de derivaciones. La habilitación depende de Meta/proveedor; no se puede prometer la aprobación ni un plazo fijo.

Referencias oficiales: [Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api/), [Meta for Developers](https://developers.facebook.com/), [política de WhatsApp Business](https://business.whatsapp.com/policy). Los pasos son una guía; comprobar requisitos vigentes y elegibilidad dentro de la cuenta antes de realizar cambios.
