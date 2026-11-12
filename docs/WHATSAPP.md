# Bot de WhatsApp — plan y puesta en marcha

Este documento es la referencia del proyecto de WhatsApp. Complementa el diseño general de `ONLINE-WEB-WHATSAPP.md` §4.

## Decisiones tomadas (7/11/2026)

- **Opción A: desarrollo a medida dentro del CRM**, conectado directamente a la API oficial de Meta (Cloud API), sin proveedor intermedio. No se usan herramientas que automaticen WhatsApp Web.
- **El número pasa a ser exclusivo de la API.** Se deja de usar la app WhatsApp Business del celular para ese número. El equipo lee y responde desde el CRM, que funciona en el navegador del celular y de la computadora. No se usa coexistencia ni proveedor, así que no hay cuota mensual fija.
- **Volumen estimado:** 100–200 conversaciones por mes.
- **Derivaciones:** las atiende una persona del equipo.
- **Alcance:** etapas 0 a 3 completas.

## Qué hace el sistema

1. **Saludo automático.** Cuando entra un caso web con consentimiento de contacto por WhatsApp, el CRM envía la plantilla `saludo_solicitud`.
2. **Historial en el CRM.** Todos los mensajes del cliente, del equipo y automáticos quedan en la ficha del caso, en la pestaña **WhatsApp**, con estado: enviado, entregado, leído o no enviado (con el motivo).
3. **Bandeja "WhatsApp".** En el menú aparece una bandeja con todas las conversaciones que el usuario puede ver (los vendedores, solo las de sus casos). Muestra contador de no leídos, avisos del navegador opcionales y el contador en el título de la pestaña.
4. **Consultas que llegan directo por WhatsApp.** Si escribe un número que no existe en el CRM, se crea un caso con origen "WhatsApp" y el nombre del perfil del cliente. Si existe, el mensaje se suma a su caso. La primera vez que escribe (o tras 12 h sin actividad) recibe una respuesta automática configurable.
5. **Respuestas manuales.** Se escribe libremente dentro de las 24 h posteriores al último mensaje del cliente. Fuera de ese plazo, el CRM ofrece enviar la plantilla `retomar_conversacion`.
6. **Documentos a Drive** (etapa 2) y **asistente con IA** con derivación humana (etapa 3).

## Arquitectura

```mermaid
flowchart LR
  W[Formulario web] --> CRM[(Supabase / CRM)]
  CRM -->|caso con consentimiento| OB[Cola de envíos wa_outbox]
  UI[CRM en celular o PC] -->|/api/whatsapp/send| OB
  OB -->|envío inmediato + cron| API[Cloud API de Meta]
  API <--> WA((WhatsApp del cliente))
  API -->|webhook firmado| WH[/api/whatsapp/webhook]
  WH --> CRM
```

**Base de datos** (migración `012_whatsapp.sql`):

- `wa_conversations`, `wa_messages`, `wa_outbox` (cola con reintentos), `wa_settings` (configuración) y `wa_webhook_events` (registro técnico, solo administración).
- Permisos por RLS: el vendedor ve los mensajes de los casos que puede ver y administración ve todo. Ningún usuario escribe directamente: los envíos pasan por el servidor, que vuelve a verificar el acceso al caso.

**Rutas:**

| Ruta                         | Para qué                                                                                                              |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `GET /api/whatsapp/webhook`  | Verificación de suscripción de Meta (token de verificación)                                                           |
| `POST /api/whatsapp/webhook` | Mensajes y estados. Verifica la firma `X-Hub-Signature-256` con el app secret y no procesa dos veces un mismo mensaje |
| `POST /api/whatsapp/send`    | Envíos manuales desde el CRM, con la sesión del usuario                                                               |
| `GET /api/whatsapp/worker`   | Cron: envía lo pendiente y reintenta (protegido con `CRON_SECRET`)                                                    |

**Envíos inmediatos.** Los mensajes salen en el momento:

- el saludo, al entrar el caso por la integración web;
- la respuesta automática, al recibir el webhook;
- el mensaje manual, al enviarlo.

El cron solo cubre los reintentos.

**Cron en Vercel.** `vercel.json` lo programa una vez por día, porque el plan Hobby no permite más. En **Vercel Pro**, cambiar el `schedule` a `* * * * *` para que los reintentos sean por minuto.

## Etapa 0 — Trámites (a cargo de Garantía Porto)

### 0.1 Verificar la empresa en Meta

En [Meta Business Suite](https://business.facebook.com/): Configuración → Centro de seguridad → **Verificación de la empresa**.

Piden:

- razón social, RUT y dirección;
- un documento que los respalde;
- un sitio web con dominio de la empresa.

Demora de días a dos semanas.

### 0.2 Crear la app y probar con el número de prueba de Meta

1. En [Meta for Developers](https://developers.facebook.com/): **Crear app** → tipo **Empresa** → asociarla al portfolio comercial de Garantía Porto → agregar el producto **WhatsApp**.
2. Meta da un **número de prueba** gratuito. Con él probamos todo antes de tocar el número real.
3. En Configuración del sistema del portfolio: crear un **usuario del sistema** (administrador), asignarle la app y la cuenta de WhatsApp, y generar un **token permanente** con permisos `whatsapp_business_messaging` y `whatsapp_business_management`. No compartirlo por chat: va directo a Vercel.
4. Agregar un **método de pago** a la cuenta de WhatsApp (WhatsApp Manager → Configuración de pagos).

### 0.3 Pasar el número actual a la API (al final, cuando el CRM esté probado)

> **Importante:** al pasar el número a la API, deja de funcionar en la app WhatsApp Business y **el historial de chats de la app no se traslada**. Hacerlo recién cuando el CRM esté probado con el número de prueba.

1. **Exportar** los chats importantes desde la app: en cada chat → Más → Exportar chat. Guardarlos en un lugar seguro, porque contienen datos personales.
2. En la app WhatsApp Business: Ajustes → Cuenta → **Eliminar cuenta**. Esto libera el número; no lo da de baja de la línea telefónica.
3. En WhatsApp Manager → Números de teléfono → **Agregar número**:
   - ingresar el número y verificarlo por SMS o llamada;
   - elegir el **nombre visible** ("Garantía Porto"), que Meta revisa.
4. Copiar el **Phone Number ID** del número real y reemplazar el del número de prueba en Vercel.

Durante el cambio hay unos minutos u horas en los que el número no recibe mensajes. Conviene hacerlo en un horario de poco movimiento.

### 0.4 Plantillas (WhatsApp Manager → Plantillas de mensajes)

Creadas el 9/11/2026, categoría **Utilidad**, idioma **Spanish (URY)** (código `es_UY`, el valor por defecto de `wa_settings.template_language`), una variable `{{1}}` con el nombre de pila. `saludo_solicitud` incluye además un botón de respuesta rápida "Sí, enviame la lista". Si se cambia el nombre o el idioma de una plantilla en Meta, actualizar `wa_settings`.

| Nombre                 | Texto sugerido                                                                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `saludo_solicitud`     | Hola {{1}}, recibimos tu solicitud de garantía en Garantía Porto. Te escribimos por este medio para ayudarte con los próximos pasos. ¿Querés que te enviemos la lista de documentos? |
| `retomar_conversacion` | Hola {{1}}, te escribimos de Garantía Porto para seguir con tu solicitud de garantía. ¿Podés responder este mensaje para continuar?                                                  |

`{{1}}` es el nombre de pila. Meta decide la categoría final: si la clasifica como marketing, el costo por mensaje sube.

### 0.5 Consentimiento del formulario web

**Texto actual:** "Acepto que un asesor se contacte conmigo por WhatsApp."

**Texto recomendado:** "Acepto que Garantía Porto me contacte por WhatsApp sobre mi solicitud, incluso con mensajes automáticos."

Meta pide que el permiso nombre a la empresa y al canal, y el CRM envía mensajes automáticos. Hay que cambiarlo en los dos formularios de Elementor. **El saludo automático solo se envía si el caso trae ese consentimiento** (`consent_evidence`). Para casos cargados a mano, el CRM pide confirmar el consentimiento antes de enviar el saludo.

### 0.6 Variables en Vercel (Settings → Environment Variables)

| Variable                       | Valor                                                                                                                                        |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `WHATSAPP_ENABLED`             | `false` hasta terminar las pruebas; después `true`                                                                                           |
| `WHATSAPP_PHONE_NUMBER_ID`     | ID del número real (el de prueba solo escribe a la lista de destinatarios de Meta)                                                           |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | Opcional. Identificador de la cuenta de WhatsApp Business (Configuración de la API). Permite ver el texto de las plantillas en Integraciones |
| `WHATSAPP_API_TOKEN`           | Token permanente del usuario del sistema                                                                                                     |
| `WHATSAPP_APP_SECRET`          | App → Configuración → Básica → Clave secreta de la app                                                                                       |
| `WHATSAPP_VERIFY_TOKEN`        | Un texto aleatorio de 32+ caracteres que elegís vos                                                                                          |
| `WHATSAPP_GRAPH_VERSION`       | `v23.0`, o la versión vigente que indique Meta                                                                                               |
| `CRON_SECRET`                  | Texto aleatorio de 32+ caracteres                                                                                                            |

Ya existen, y también son necesarias: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY`.

### 0.7 Conectar el webhook

En la app de Meta → WhatsApp → Configuración → **Webhook**:

- URL de devolución de llamada: `https://<dominio-del-crm>/api/whatsapp/webhook`
- Token de verificación: el mismo valor de `WHATSAPP_VERIFY_TOKEN`
- Suscribir el campo **messages**

## Etapa 2 — Documentos a Google Drive (Google Workspace)

Cuando el cliente manda un **PDF, una imagen o un Word** (hasta 20 MB) por WhatsApp, el CRM lo descarga de Meta y lo guarda en la **carpeta del caso**:

- **Cada caso nuevo tiene su carpeta desde que entra al CRM** (formulario web, WhatsApp o carga manual). Se crea en la carpeta principal (Clientes garantiaporto.com.uy → Solicitudes) con el nombre "Nombre Apellido · CI 1.234.567-8", o "Nombre Apellido · Solicitud xxxxxxxx" si todavía no hay CI. El enlace queda en la ficha. Si un documento llega antes de que exista la carpeta, se crea en ese momento.
- En el chat aparece "Guardado en la carpeta del caso" con el enlace **Ver en Drive**.
- Si falla, aparece el motivo y un botón **Reintentar**.
- Los audios, videos y stickers quedan solo en el chat.
- **Los archivos no se guardan en la base del CRM.**

### Configuración (una sola vez, con una cuenta administradora de Workspace)

1. **Crear un proyecto en Google Cloud.** En [console.cloud.google.com](https://console.cloud.google.com/), con la cuenta de Workspace de la empresa, crear el proyecto "CRM Garantía Porto". Después, en APIs y servicios → Biblioteca, habilitar **Google Drive API**.
2. **Crear la cuenta de servicio.** En IAM y administración → Cuentas de servicio → **Crear cuenta de servicio**, con el nombre "crm-drive" y sin roles. Después, en la cuenta → Claves → Agregar clave → **JSON**: se descarga un archivo. **No lo envíes por chat ni lo subas a Git.**
   - Si Google no permite crear la clave, es por una política de la organización ("Disable service account key creation"). Un administrador puede permitirla solo para este proyecto, en IAM → Políticas de la organización.
3. **Crear la unidad compartida.** En Google Drive, crear una **unidad compartida** "Clientes CRM", o usar una existente. Después:
   - en Administrar miembros, agregar el email de la cuenta de servicio (termina en `@...iam.gserviceaccount.com`) como **Administrador de contenido**;
   - dentro de la unidad, crear la carpeta principal, por ejemplo "Solicitudes", y copiar su ID: es lo que aparece después de `/folders/` en la dirección.
4. **Cargar las variables en Vercel:**

| Variable                             | Valor                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------ |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL`       | `client_email` del archivo JSON                                                |
| `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | `private_key` del archivo JSON (completo, desde `-----BEGIN PRIVATE KEY-----`) |
| `GOOGLE_DRIVE_PARENT_FOLDER_ID`      | ID de la carpeta principal                                                     |

**Carpetas creadas a mano.** Si un caso ya tiene una carpeta cargada a mano, el CRM guarda los documentos en esa carpeta. Tiene que estar dentro de la unidad compartida o compartida con la cuenta de servicio. Si no, el chat muestra "La carpeta no existe o no está compartida con la cuenta del CRM": se comparte la carpeta y se toca **Reintentar**.

**Privacidad.** Los documentos quedan en una unidad compartida de la empresa: el acceso lo dan los miembros de la unidad y el CRM nunca crea enlaces públicos. Los archivos pasan por Meta y por el servidor del CRM solo en tránsito.

## Etapa 3 — Asistente con IA

### Qué hace

- **Cuándo responde:**
  - en los **casos web**, apenas el cliente contesta el saludo o toca "Sí, enviame la lista", sin esperar a Lucía;
  - en las **consultas directas** por WhatsApp, desde el primer mensaje.
- **Qué hace en la conversación:**
  - se presenta como asistente automático;
  - pregunta la situación de ingresos y envía la **lista oficial de documentos**, que el CRM manda con el texto aprobado sin que el modelo lo reescriba;
  - responde **solo** con las preguntas frecuentes aprobadas (`docs/WHATSAPP-FAQ.md` → `lib/bot-knowledge.ts`).
- **Consultas directas:** pide nombre y apellido, monto y moneda del alquiler, tipo de garantía y situación de ingresos, y los carga en la ficha. Solo completa datos vacíos; en los casos web nunca cambia el nombre ni el tipo de garantía.
- **Cédula:** si el cliente la escribe, la registra el servidor y **no se envía al modelo**; el modelo ve "[cédula]".
- **Deriva a Lucía cuando corresponde:**
  - el cliente pide una persona, reclama o pregunta por aprobación, rechazo o Clearing;
  - consulta por **garantía rural** (se gestiona de forma personalizada);
  - quiere la cotización exacta después de recibir el costo aproximado;
  - no sabe la respuesta, o pasaron 40 respuestas automáticas.

  Al derivar, el cliente recibe el aviso aprobado (con el horario si es fuera de hora), el chat queda marcado **"Requiere atención"** en la bandeja y el asistente se pausa.

- **Cuando alguien del equipo escribe** en un chat desde el CRM, el asistente se pausa en ese chat. Se reactiva con **Reactivar asistente** en la pestaña WhatsApp del caso.
- **Costo:** con el monto del alquiler informa un **costo aproximado (70% del importe del alquiler)**, calculado por el CRM, no por la IA, y aclara que se puede financiar con tarjeta sin recargo.
- **Garantía universitaria:** misma lista de documentos que la tradicional.
- **Nunca** dice si una garantía está aprobada o rechazada, y no pide contraseñas ni tarjetas.

### Activación paso a paso

1. **Clave de Anthropic.** Crear una clave en [console.anthropic.com](https://console.anthropic.com/) → API Keys, con un **límite de gasto mensual** en Billing. Cargarla en Vercel como `ANTHROPIC_API_KEY` (Sensitive) y volver a publicar.
2. **Migración 014.** Aplicar `supabase/migrations/014_whatsapp_bot.sql`; en publicación manual, con el script `supabase-migracion-014.sql`.
3. **Configuración.** En el CRM → **Integraciones → WhatsApp → Asistente con IA**:
   - marcar **Asistente activado** y dejar **Modo prueba** marcado;
   - cargar tu celular y el de Lucía en **Números de prueba**;
   - guardar.
4. **Prueba.** Escribirle al número desde esos celulares y probar distintas conversaciones: preguntas frecuentes, pedir la lista, mandar un PDF, pedir una persona, preguntar el costo.
5. **Activación para clientes.** Cuando las respuestas estén bien, desmarcar **Modo prueba**: el asistente pasa a responder a todos.

Para apagarlo en cualquier momento: desmarcar **Asistente activado**. Vuelve la respuesta automática fija, si está activada.

### Modelo y costo

- Usa la API de Claude (Anthropic) con el modelo **Claude Opus 5.5** (`claude-opus-5-5`), en esfuerzo bajo, con caché de instrucciones y con **respaldo automático** (fallback) a otro modelo si el principal rechaza un mensaje.
- **Costo estimado:** unos US$ 0,02–0,03 por mensaje del cliente. Con 100–200 conversaciones al mes, **~US$ 25–50/mes**.
- Para bajar el costo, se puede cambiar el modelo con la variable `ANTHROPIC_MODEL` en Vercel:

| Modelo                                                       | Valor de `ANTHROPIC_MODEL` | Costo estimado/mes |
| ------------------------------------------------------------ | -------------------------- | ------------------ |
| Claude Sonnet 5.5 (rápido y capaz)                           | `claude-sonnet-5-5`        | ~US$ 12–25         |
| Claude Haiku 5.5 (el más económico, sin respaldo automático) | `claude-haiku-5-5`         | ~US$ 1–3           |

Conviene probar en modo prueba antes de cambiar de modelo.

## Prueba antes de usar el número real

1. Con el número de prueba: agregar tu celular como destinatario de prueba en Meta. Después:
   - crear un caso con tu celular desde el CRM;
   - en la pestaña WhatsApp, marcar el consentimiento y enviar el saludo;
   - responder desde tu celular y verificar que la respuesta aparece en el CRM;
   - responder desde el CRM.
2. Escribir desde otro celular que no esté en el CRM y verificar que se crea el caso "WhatsApp" con la respuesta automática.
3. Recién entonces pasar el número real (0.3).

## Configuración en el CRM

En **Integraciones** (solo administración) se activan el saludo automático, la respuesta fija y el asistente. Ahí también se ve el texto aprobado de las plantillas «saludo inicial» y «retomar conversación», leído de Meta (requiere `WHATSAPP_BUSINESS_ACCOUNT_ID`). Los nombres y el idioma de las plantillas se guardan en `wa_settings` y se cambian desde Supabase.

### Consentimiento

Cada caso guarda si el cliente aceptó que lo contacten por WhatsApp (`wa_consent`, migración 016). Se marca solo cuando el formulario web trae el consentimiento o cuando el cliente escribe al número. Si lo aceptó por otro medio, se tilda una vez en la ficha o en el chat, al enviar la primera plantilla. El cambio queda en el historial de auditoría.

### Historial y seguimiento

Cuando alguien del equipo envía un mensaje de WhatsApp desde el CRM, el historial del caso suma una comunicación «WhatsApp: conversación con el cliente…», una por día. Así la alerta de seguimiento cuenta esa conversación como contacto. Los mensajes del cliente, del asistente y el saludo automático no suman al historial: un cliente que escribió y no recibió respuesta del equipo sigue generando alerta. En la demo, los mensajes no se suman al historial.

## Etapas de desarrollo

| Etapa         | Contenido                                                                                                                                             | Estado                    |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Prerrequisito | Corrección de la auditoría de seguridad (migración 011)                                                                                               | Listo para revisar        |
| 0             | Trámites de Meta, plantillas, consentimiento                                                                                                          | A cargo de Garantía Porto |
| 1             | Base de datos, webhook, envíos con cola y reintentos, saludo automático, casos desde WhatsApp, respuesta automática, pestaña y bandeja WhatsApp, demo | Listo para revisar        |
| 2             | Documentos → Google Drive (unidad compartida de Workspace, carpeta por caso, reintentos)                                                              | Listo para revisar        |
| 3             | Asistente con IA (Claude), lista oficial de documentos, carga de datos, derivación, pausa por intervención humana, configuración en Integraciones     | Listo para revisar        |

## Costos estimados (100–200 conversaciones/mes)

| Concepto                                                                                           | Costo mensual aproximado |
| -------------------------------------------------------------------------------------------------- | ------------------------ |
| Saludos con plantilla de utilidad (~US$ 0,011 c/u; ~US$ 0,074 si Meta la clasifica como marketing) | US$ 2–15                 |
| Respuestas del equipo y automáticas: las primeras 1.000 por mes gratis, después ~US$ 0,011 c/u     | US$ 0–25                 |
| IA (etapa 3, Claude Opus 5.5; ver tabla de modelos)                                                | US$ 25–50                |
| Vercel Pro y Supabase Pro (si todavía no se pagan)                                                 | ~US$ 45                  |

Tarifas de la región "Resto de Latinoamérica", vigentes desde el 1/10/2026 según fuentes de proveedores de Meta. Verificarlas en WhatsApp Manager.

## Datos pendientes

- [x] Usan **Google Workspace** (etapa 2: unidad compartida + cuenta de servicio).
- [ ] Horario de atención de la persona que toma las derivaciones, y el nombre con el que el bot la presenta (etapa 3).
- [ ] Lista de documentos por tipo de garantía y preguntas frecuentes con respuestas aprobadas (etapa 3).
