# Bot de WhatsApp — plan y puesta en marcha

Este documento es la referencia del proyecto de WhatsApp. Complementa el diseño general de `ONLINE-WEB-WHATSAPP.md` §4.

## Decisiones tomadas (7/11/2026)

- **Opción A: desarrollo a medida dentro del CRM**, conectado a la API oficial de WhatsApp (Cloud API). No se usan herramientas que automaticen WhatsApp Web.
- **Mismo número para bot y personas:** se mantiene el número actual de WhatsApp Business y se conecta con **coexistencia**. El equipo sigue usando la app del celular y el CRM ve y envía mensajes por la API.
- **Volumen estimado:** 100–200 conversaciones por mes.
- **Derivaciones:** las atiende una persona del equipo.
- **Alcance:** etapas 0 a 3 completas.

## Qué va a hacer el sistema

1. **Saludo automático.** Cuando entra un caso nuevo con consentimiento de contacto por WhatsApp, el CRM envía una plantilla aprobada por Meta.
2. **Historial en el CRM.** Todos los mensajes del cliente, del bot y del equipo (enviados desde el CRM o desde el celular) quedan en la ficha del caso, en una pestaña "WhatsApp".
3. **Consultas que llegan directo por WhatsApp.** Si escribe un número que no existe en el CRM, se crea un caso con origen "WhatsApp". Si ya existe, el mensaje se suma a su caso.
4. **Documentos a Drive.** Las fotos y PDF que mande el cliente se suben a la carpeta del caso en Google Drive. Si no hay carpeta, se crea automáticamente.
5. **Asistente con IA.** Responde preguntas frecuentes y la lista de documentos por tipo de garantía, y pide los datos faltantes. **Deriva a la persona del equipo** si:
   - el cliente lo pide;
   - el tema es una aprobación, rechazo o Clearing;
   - hay un reclamo;
   - no sabe la respuesta.

   No decide aprobaciones ni ve ingresos ni datos de Clearing.
6. **Convivencia bot–persona.** Si alguien del equipo escribe en esa conversación (desde el celular o el CRM), el bot se pausa en ella. Se puede reactivar desde la ficha. También existe un **interruptor general** para apagar el bot.

## Arquitectura

```mermaid
flowchart LR
  W[Formulario web] --> CRM[(Supabase / CRM)]
  CRM -->|caso nuevo con consentimiento| OB[Cola de envíos]
  OB -->|cron cada minuto| API[Proveedor / Cloud API]
  API <--> WA((WhatsApp del cliente))
  APP[App WhatsApp Business del equipo] <-->|coexistencia| API
  API -->|webhook firmado| WH[/api/whatsapp/webhook]
  WH --> CRM
  WH --> BOT[Asistente IA]
  BOT --> API
  WH --> DR[Google Drive]
```

- **Base de datos (Supabase):**
  - conversaciones, mensajes con su estado (enviado, entregado, leído, fallido) y cola de envíos con reintentos;
  - configuración del bot: interruptor, textos y documentos por garantía.
  - Permisos con RLS: el vendedor ve los mensajes de los casos que puede ver; la administración ve todo. Solo el servidor escribe.
- **Rutas del servidor (Vercel):**
  - `/api/whatsapp/webhook` recibe mensajes, ecos de la app del celular y estados de entrega. Verifica la firma y no procesa dos veces el mismo mensaje.
  - `/api/whatsapp/worker`: tarea programada que envía la cola, con reintentos.
- **Proveedor de WhatsApp:** el código es compatible con la Cloud API de Meta directa y con proveedores que usan su mismo formato, como 360dialog. Se cambia con variables de entorno.
- **IA:** API de Claude (Anthropic) con herramientas limitadas.
  - El modelo no recibe ingresos, Clearing ni datos de otros casos.
  - Las cédulas que escriba el cliente se enmascaran antes de enviarlas al modelo.

## Etapa 0 — Trámites (los hacés vos, con esta guía)

### 0.1 Verificar la empresa en Meta

En [Meta Business Suite](https://business.facebook.com/) → Configuración → Centro de seguridad → **Verificación de la empresa**. Necesitás:
- razón social y RUT;
- dirección;
- un documento que los respalde;
- un sitio web o dominio a nombre de la empresa.

Tarda entre unos días y dos semanas.

### 0.2 Elegir cómo conectar el número con coexistencia

Según la información disponible (noviembre de 2026), Meta habilita la coexistencia mediante un flujo de alta ("Embedded Signup") que ofrecen los **proveedores oficiales**. Para una empresa que conecta su propio número, el camino práctico es un proveedor:

| Camino | Costo fijo | Tiempo | Comentario |
|---|---|---|---|
| **Proveedor oficial con API compatible (recomendado)**, p. ej. 360dialog | ~€49/mes por número + mensajes de Meta, sin recargo | Días | El CRM habla con la API del proveedor, que tiene el mismo formato que la de Meta. El proveedor solo transporta mensajes, no reemplaza al CRM |
| Registrar una app propia como "Tech Provider" de Meta | US$ 0 + mensajes de Meta | Semanas, con revisión de Meta y resultado incierto | Más trámite. Se puede migrar más adelante |

**Recomendación:** empezar con el proveedor. Antes de contratar, confirmar con su soporte que admite coexistencia para un número de Uruguay y que ofrece webhook con cabecera secreta.

**Requisitos del número para coexistencia:**
- usarlo activamente en la app WhatsApp Business al menos 7 días antes;
- tener la app actualizada (versión 2.24.17 o superior);
- que el número no esté conectado a otra API.

Al conectarlo se desvinculan los dispositivos enlazados (WhatsApp Web/escritorio) y hay que volver a vincularlos. **No borrar ni desregistrar el número.**

### 0.3 Ajustar el consentimiento del formulario web

**Texto actual:** "Acepto que un asesor se contacte conmigo por WhatsApp."

**Texto recomendado:** "Acepto que Garantía Porto me contacte por WhatsApp sobre mi solicitud, incluso con mensajes automáticos."

Motivo: Meta pide que el permiso nombre a la empresa y al canal, y el bot envía mensajes automáticos. Hay que cambiar el texto en los dos formularios de Elementor. El CRM ya guarda la evidencia (`consent_evidence`) cuando el puente de WordPress está activo.

### 0.4 Plantilla de saludo

La creo desde el CRM o desde WhatsApp Manager cuando el número esté conectado. Borrador (categoría "utilidad"):

> Hola {{1}}, recibimos tu solicitud de garantía en Garantía Porto. Te escribimos por este medio para ayudarte con los próximos pasos. ¿Querés que te enviemos la lista de documentos?

Meta decide la categoría final. Si la clasifica como marketing, el costo por mensaje sube (ver costos).

### 0.5 Variables a cargar en Vercel (no compartirlas por chat)

| Variable | Qué es |
|---|---|
| `WHATSAPP_API_BASE_URL` | `https://graph.facebook.com/v23.0` (Meta directo) o la URL del proveedor |
| `WHATSAPP_API_TOKEN` | Token de acceso del sistema o API key del proveedor |
| `WHATSAPP_PHONE_NUMBER_ID` | ID del número (Meta directo; con proveedor puede no aplicar) |
| `WHATSAPP_WEBHOOK_SECRET` | Secreto para validar los webhooks: el app secret de Meta, o una cabecera secreta del proveedor |
| `WHATSAPP_VERIFY_TOKEN` | Token de verificación del webhook (solo Meta directo) |
| `WHATSAPP_ENABLED` | `false` hasta terminar las pruebas |
| `CRON_SECRET` | Protege la tarea programada de envíos |
| `GOOGLE_DRIVE_*` | Etapa 2 |
| `ANTHROPIC_API_KEY` | Etapa 3 |

## Etapas de desarrollo

| Etapa | Contenido | Estado |
|---|---|---|
| Prerrequisito | Corrección de la auditoría de seguridad (migración 011) | PR abierto |
| 0 | Trámites de Meta y del proveedor, consentimiento, plantilla | A cargo de Garantía Porto |
| 1 | Base de datos, webhook, envío con cola y reintentos, saludo automático, casos desde WhatsApp, pestaña WhatsApp en la ficha, pausa del bot por intervención humana, demo | En desarrollo |
| 2 | Documentos → Google Drive (creación de carpeta, validación de tipo y tamaño) | Pendiente |
| 3 | Asistente con IA, base de respuestas y documentos por garantía editable, derivación, piloto con pocos casos | Pendiente |

Todo se desarrolla y prueba primero sin conexión real, con datos ficticios. La activación con el número real se hace con `WHATSAPP_ENABLED=true` después de una prueba con tu propio celular.

## Costos estimados (100–200 conversaciones/mes)

| Concepto | Costo mensual aproximado |
|---|---|
| Proveedor para coexistencia | ~€49 (≈ US$ 55) |
| Mensajes de Meta (saludos + respuestas; 1.000 respuestas/mes gratis) | US$ 3–20 |
| IA (etapa 3) | US$ 5–30 |
| Vercel Pro y Supabase Pro (si todavía no se pagan) | ~US$ 45 |
| Google Drive API | sin costo adicional |

Las tarifas de Meta cambian cada trimestre: verificarlas en WhatsApp Manager al conectar.

## Datos que faltan

- [ ] ¿Usan **Google Workspace** (correo @dominio de la empresa) o una cuenta Gmail común para Drive? Cambia la forma de conectar Drive en la etapa 2.
- [ ] Horario de atención de la persona que toma las derivaciones, y el nombre con el que el bot la presenta.
- [ ] Lista de documentos por tipo de garantía (tradicional, universitaria, rural) y preguntas frecuentes con sus respuestas aprobadas (etapa 3).
