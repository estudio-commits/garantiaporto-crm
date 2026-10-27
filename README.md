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
