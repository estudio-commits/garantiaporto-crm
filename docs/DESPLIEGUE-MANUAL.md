# Publicar sin GitHub (Vercel CLI + Supabase SQL Editor)

Este procedimiento sirve **mientras la cuenta de GitHub está suspendida**. Publica el CRM desde tu computadora con Windows y actualiza la base de datos a mano. Cuando GitHub vuelva, el flujo normal (pull request → merge) sigue funcionando sin repetir nada.

## Archivos que necesitás

- `garantiaporto-crm-deploy.zip`: el código del CRM, con la corrección de seguridad y las etapas 1 y 2 de WhatsApp.
- `supabase-migraciones-011-013.sql`: el script que actualiza la base de datos.

**Orden obligatorio: primero el código (paso 1) y enseguida la base (paso 2).** El código nuevo funciona con la base vieja, pero el código viejo **no** funciona con la base nueva.

## Paso 1 — Publicar el código en Vercel (unos 10 minutos)

1. Necesitás **Node.js LTS** instalado. Ya lo tenés si alguna vez abriste la demo; si no, descargalo de nodejs.org.
2. Descomprimí `garantiaporto-crm-deploy.zip`, por ejemplo en `Documentos\garantiaporto-crm`.
3. Abrí esa carpeta en el Explorador, hacé clic en la barra de dirección, escribí `cmd` y presioná Enter.
4. Ejecutá:
   ```
   npx vercel login
   ```
   Elegí la misma forma con la que entrás a Vercel (email o Google) y confirmá en el navegador.
5. Ejecutá:
   ```
   npx vercel link
   ```
   Respuestas:
   - _Set up …?_ → **Y**
   - _Which scope?_ → tu cuenta o equipo
   - _Link to existing project?_ → **Y**
   - _What's the name?_ → **garantiaporto-crm**
6. Ejecutá:
   ```
   npx vercel --prod
   ```
   Tarda unos 2 minutos. Al final muestra la dirección de **Production**. Vercel compila con las variables que ya cargaste. Si avisa que el proyecto está conectado a Git, seguí igual.

## Paso 2 — Actualizar la base en Supabase (unos 5 minutos, enseguida del paso 1)

1. Supabase → tu proyecto → **SQL Editor** → **New query**.
2. Abrí `supabase-migraciones-011-013.sql` con el Bloc de notas, copiá **todo**, pegalo y tocá **Run**.
3. Si Supabase pregunta por RLS, elegí **Run and enable RLS**. El script ya activa la seguridad de cada tabla nueva.
4. Tiene que decir **Success**. Si aparece un error, **no lo vuelvas a ejecutar**: mandame el mensaje exacto.
5. Para comprobar, ejecutá esta consulta. La lista tiene que terminar en `013`:
   ```sql
   select version from supabase_migrations.schema_migrations order by version;
   ```

## Paso 3 — Probar el CRM y Google Drive

1. Entrá al CRM y cargá un **caso ficticio** (nombre inventado, CI válida inventada, tu celular).
2. En menos de un minuto tiene que aparecer en Drive, en **Clientes garantiaporto.com.uy → Solicitudes**, una carpeta "Nombre · CI 1.234.567-8", y su enlace en la ficha. Si no aparece, recargá la página.
3. Comprobá que la ficha tiene la pestaña **WhatsApp** y el menú la sección **WhatsApp**.

## Paso 4 — Conectar WhatsApp con el número de prueba de Meta

1. Meta for Developers → tu app → WhatsApp → **Configuración** → Webhook → **Editar**:
   - URL de devolución de llamada: `https://<dirección del CRM>/api/whatsapp/webhook`
   - Token de verificación: el mismo valor de `WHATSAPP_VERIFY_TOKEN`
   - Tocá **Verificar y guardar** y después **suscribí el campo `messages`**.
2. Meta → WhatsApp → **Configuración de la API**: agregá tu celular como destinatario de prueba.
3. En Vercel cambiá `WHATSAPP_ENABLED` a `true` y volvé a publicar desde la carpeta con `npx vercel --prod`. Los cambios de variables necesitan una nueva publicación.
4. **Prueba** (las plantillas tienen que estar aprobadas):
   - en el caso ficticio, pestaña WhatsApp → marcá el consentimiento → **Enviar saludo inicial**;
   - te llega la plantilla al celular; respondé y el mensaje aparece en el CRM (se actualiza cada 10 segundos);
   - respondé desde el CRM;
   - mandá un PDF desde el celular: aparece "Guardado en la carpeta del caso" con el enlace a Drive.
5. Desde otro celular que no esté en el CRM (también agregado como destinatario de prueba), escribí al número: se crea un caso "WhatsApp" con su carpeta en Drive y llega la respuesta automática.

## Cuando GitHub vuelva

Avisame:

- subo la rama y abro el pull request;
- al aprobarlo, Supabase **no** repite las migraciones (quedaron registradas en el paso 2);
- Vercel vuelve a publicar el mismo código.

## Importante

- **No vuelvas a una versión anterior del CRM en Vercel** (Instant Rollback) después del paso 2: la versión vieja no funciona con la base nueva. Si algo falla, escribime.
- El número real se pasa a la API **al final**, cuando todo funcione con el número de prueba (ver `WHATSAPP.md` §0.3).
