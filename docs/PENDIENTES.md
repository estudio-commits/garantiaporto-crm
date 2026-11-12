# Mejoras pendientes

Lista de mejoras acordadas para hacer más adelante, junto con otras. Al implementar una, sacarla de acá.

## Nombres de los archivos de WhatsApp en Drive

Hoy cada archivo se guarda como `AAAA-MM-DD HHMM WhatsApp - nombre.extensión` (ver `mediaFileName` en `lib/whatsapp-server.ts`). Las fotos no traen nombre y quedan todas como «Imagen», que solo se distinguen por la hora.

Acordado (12/11/2026), aplicar las dos:

1. **Usar la descripción de la foto:** si el cliente escribe un texto junto a la foto (por ejemplo «cédula frente»), usarlo como nombre: `… WhatsApp - cédula frente.jpg`. Si no hay texto, «Imagen».
2. **Numerar los archivos del mismo envío** para que no se repitan: «Imagen 1», «Imagen 2», etc.

El asistente no lee el contenido de los archivos, así que no se puede nombrar según lo que son (por ejemplo, «Recibo de sueldo octubre») sin que la IA abra cada documento.

## Otras

- **Tarea automática cada minuto:** al pasar a Vercel Pro, cambiar `vercel.json` de `17 11 * * *` (una vez por día) a `* * * * *`. Hoy los mensajes, archivos y carpetas se procesan al instante; la tarea diaria solo reintenta lo que falló.
- **Tolerancia de ingresos del asistente:** se ofrece que Lucía analice el caso cuando los ingresos llegan al menos al 85% del mínimo (`evaluateRent` en `lib/bot-knowledge.ts`). Falta que Garantía Porto confirme ese número.
- **Prueba automática del asistente:** correr `npm run bot:eval informe.md` con una clave de Anthropic para revisar las respuestas a la sección 11 de `docs/WHATSAPP-FAQ.md`.
