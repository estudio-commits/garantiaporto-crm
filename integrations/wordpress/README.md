# Conectar Elementor con Porto CRM mediante WPCode

Adaptador preparado para el popup con formularios `garantia_paso_1` y `garantia_paso_2`, nombres **Lead Garantía - Paso 1** y **Solicitud Garantía - Datos adicionales**. El primero usa `nombre`, `celular`, `alquiler`, `moneda`; el segundo usa `nombre_paso1`, `celular_paso1`, `alquiler_paso1`, `moneda_paso1`, `ingresos`, `cedula`. Ambos deben tener campos Elementor de tipo Oculto con IDs `solicitud_id` y `event_id`, sin valor predeterminado.

Los dos HTML originales del popup y las acciones Correo/Recopilar envíos deben permanecer. El adaptador no modifica la pantalla de éxito, no dispara conversiones, no envía WhatsApp y no usa correos para cargar clientes. Solo recibe registros de los dos nombres configurados después de la validación de Elementor. La instalación no cambia por sí sola el sitio: captura y transmisión vienen apagadas.

## Instalar y guardar la clave (sin activar envíos)

1. Guardar una copia del popup y probar primero en una copia de pruebas del sitio. PHP 8.1 o superior recomendado. Tener acceso al hosting para desactivar un snippet si el sitio tiene un conflicto.
2. En WPCode → Añadir fragmento → Añadir código personalizado, elegir **Fragmento PHP**. Título: `Conexión Porto CRM`.
3. Abrir `WPCode-Porto-CRM.txt` desde GitHub y usar **Raw / Copiar contenido sin formato**. Copiar el archivo completo. El archivo ya viene sin la etiqueta inicial `<?php` que muestra el editor de WPCode.
4. Pegar, elegir **Inserción automática → Ejecutar en todas partes / Run Everywhere**, guardar y activar el fragmento. No usar una ubicación HTML, JavaScript ni solo frontend: el servidor debe recibir los formularios y ejecutar la cola.
5. Recargar WordPress. Abrir **Ajustes → Porto CRM**.
6. Pegar en Clave de conexión el mismo `CRM_WEBHOOK_SECRET` guardado en Vercel. Dejar **Capturar** y **Enviar** desmarcados, y guardar. La clave no se imprime de nuevo ni se incluye en JavaScript.
7. Mantener `CRM_INTEGRATION_ENABLED=false` en Vercel durante esta configuración.

## Prueba controlada antes de producción

En una copia de pruebas, ajustar el destino a un CRM de pruebas con la misma estructura (constante ENDPOINT del código fuente, reconstruir el snippet). La versión entregada apunta al subdominio de producción indicado por el usuario, por lo que no activar transmisión en staging sin cambiar antes ese destino.

- Habilitar captura, conservar envío desactivado. Limpiar la caché del sitio si se usa caché de página. Completar paso 1 con nombre/teléfono ficticios: Elementor debe conservar su envío/correo, mostrar paso 2 y la cola mostrar un pendiente. No debe haber ningún envío al CRM todavía.
- Completar paso 2: deben existir dos eventos con el mismo identificador de solicitud, distintos identificadores de evento y los datos copiados del primer paso. No recargar la página entre pasos.
- Verificar los parámetros de marketing con una URL ficticia con UTM y el comportamiento de cotizador, moneda y conversión existentes. No se pudo inspeccionar la configuración global de conversiones; hay que comprobar que no cambia su conteo antes de activar producción.
- Configurar CRM_INTEGRATION_ENABLED=true en el entorno de prueba y volver a desplegar Vercel para aplicar las variables. Activar Enviar en WordPress y pulsar Procesar pendientes. El primer evento debe crear una ficha y el segundo completarla. Reintentar no debe duplicarla.
- Simular indisponibilidad con integración desactivada: quedan pendientes y vuelven a intentarse. Verificar recuperación y luego reactivar el receptor. No probar la cola con clientes reales.
- Configurar un cron real del hosting que ejecute las tareas de WordPress cada minuto. WP-Cron depende de visitas; sin cron real no se garantiza entrega inmediata. La cola procesa hasta 5 eventos por ejecución, con espera creciente hasta una hora y 15 intentos antes de marcar error.
- Repetir la configuración comprobada en producción, activar receptor con redeploy y luego captura/envío. Revisar la cola después de los primeros envíos. El control de asignación no se modifica: las nuevas solicitudes llegan sin responsable, para asignarlas desde el CRM. El tipo por defecto del receptor sigue siendo tradicional; distinguir rural/universitaria requiere una señal del formulario que aún no se recibe.

## Funcionamiento y límites

El navegador conserva únicamente UUID de solicitud/eventos y el estado de finalización en sessionStorage. El mismo ID acompaña ambos pasos, incluso al reabrir un popup incompleto. Tras finalizar, la próxima apertura crea otra solicitud. Los secretos y los datos del cliente no se guardan en sessionStorage. Si un navegador no permite ese almacenamiento, los IDs duran hasta recargar la página. Un reinicio de sesión, otra pestaña o un borrado del almacenamiento no se concilian automáticamente por teléfono/cédula.

Los IDs se rellenan antes de que Elementor serialice el envío. La URL y el título solo se completan si sus campos existentes están vacíos; no se reemplazan valores de atribución ya presentes. Las UTM e identificadores de clic disponibles en url_origen se extraen en servidor. Los campos originales se conservan como extras restringidos. No se inventan origen de botón, consentimiento ni página de llegada. Queda pendiente inspeccionar los scripts de marketing globales.

Cada envío validado se guarda en una tabla propia de WordPress, con cuerpo estable y hash. Un reintento firma de nuevo ese mismo cuerpo, con timestamp actual, conservando event_id/solicitud_id. La transmisión HTTP ocurre en el worker, no al enviar el formulario. La cola usa una toma atómica de cada trabajo para impedir que dos workers lo envíen simultáneamente; los trabajos interrumpidos pueden recuperarse después de cinco minutos. Una respuesta solo se confirma con HTTP 200 y un application_id válido.

Errores temporales/429 se reintentan. Errores de configuración/autorización o datos se retienen para revisión. El botón de reintento solo reenvía errores con payload válido; los registros `review` requieren conciliación con Elementor → Envíos. Cambiar los datos de un event_id ya guardado no sobrescribe: retiene el nuevo contenido para revisión y muestra aviso. Una cola sin instalar o un error de escritura muestra un aviso al administrador; los envíos/correos originales siguen siendo la fuente de recuperación.

La configuración usa capacidad manage_options y nonces; la clave es una opción privada de WordPress sin autoload. La tabla conserva datos personales, por lo que las copias de seguridad y acceso a la base de WordPress deben tener la misma protección que Elementor → Envíos. No tiene endpoint público para consultar datos. La limpieza de registros entregados debe acordarse con la política de conservación; no se borran automáticamente antecedentes ni errores.

Si se necesita detener envíos, desmarcar Enviar; Capturar puede seguir reteniendo solicitudes. Desactivar el snippet detiene ambos. No borra la cola.

## Código y verificación

`bridge.php` es el servidor y `browser.js` el identificador de los pasos. `python3 integrations/wordpress/build-snippet.py` genera el archivo completo para WPCode. No editar las dos versiones en paralelo.

Se verifican el contrato JSON del CRM, mapeo, importes, UUID, deduplicación, firma HMAC, toma de trabajos, reintentos y JavaScript con datos ficticios. Las pruebas PHP usan dobles de APIs de WordPress; no sustituyen probar Elementor Pro y WPCode reales con la versión instalada.

```sh
npm test
python3 integrations/wordpress/build-snippet.py
docker run --rm -v "$PWD":/app:ro -v /tmp:/tmp -w /app php:8.3-cli php tests/wordpress-bridge.php
```
