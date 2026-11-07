# Auditoría de seguridad — noviembre 2026

Se hizo con la skill `security-audit` de Cloudflare (`.claude/skills/security-audit/`), en perfil `standard`, sobre el commit `f29fb39` de la rama `codex/crm-demo`. Se revisaron el código fuente y se hicieron pruebas locales aisladas, sin contactar servicios desplegados y con datos ficticios.

## Resultado

- **Problemas críticos o altos:** ninguno.
- **Problemas confirmados de severidad baja:** 2. Ambos quedan **corregidos en la migración `011_security_audit_fixes.sql`**.
- **Pendiente de validar en la configuración de WordPress:** 1 punto.
- **Notas de endurecimiento:** varias.

### 1. Identificador de continuación web expuesto a vendedores (corregido)

**El problema:**
- `ingest_event` unía el paso 2 del formulario web a un caso solo por `external_id = solicitud_id`.
- Ese identificador era legible para el vendedor asignado: en la fila del caso y en la auditoría.
- Con ese identificador, un vendedor (aun después de que le quitaran el acceso) podía completar el formulario público y escribir ingresos y cédula en la tabla solo-admin.

**La corrección (011):**
- `external_id` y `contact_id` ya no son legibles para `authenticated` ni `anon`: se usan permisos por columna.
- El cliente lee `applications` con una lista explícita de columnas: `APPLICATION_COLUMNS` en `components/crm.tsx`.
- La auditoría ya no copia esas columnas y se limpiaron los registros existentes.
- Un evento web dirigido a un caso archivado, ya decidido o con más de 30 días queda **en cuarentena**:
  - se guarda en `form_events` con `quarantined = true` y discrepancia, para revisión de administración;
  - no modifica el caso ni los datos sensibles.
- El bloqueo de concurrencia se toma sobre el UUID normalizado.

### 2. Atribución y evidencia de decisión en altas de vendedores (corregido)

**El problema:** `guard_application` prohibía al vendedor modificar `attribution`, `decision_date` y `decision_reference`, pero no impedía cargarlas al crear un caso por la API.

**La corrección (011):** en un alta hecha por un vendedor, esos campos deben venir vacíos.

### Pendiente de validación: cola de WordPress sin límite

Envíos anónimos del formulario pueden acumularse en la cola del puente de WordPress, que se procesa de a 5 por minuto y retrasa los leads legítimos. Que sea explotable depende de la protección anti-spam de los formularios (reCAPTCHA, honeypot) y de los límites del hosting.

Revisar en Elementor y en el hosting antes de activar `capture`/`send`.

### Endurecimiento recomendado (no son vulnerabilidades)

**Navegador y despliegue**
- Agregar CSP y HSTS: `next.config.ts` o Vercel.
- Exigir un largo mínimo a `CRM_WEBHOOK_SECRET` en la ruta de integración.
- Correr `npm audit` u `osv-scanner` periódicamente y verificar que Vercel instale con `npm ci`.
- Usar `127.0.0.1` en los scripts `dev` y `start` para desarrollo.

**Base de datos**
- Evitar que un campo personalizado pase a "sensible" sin reclasificar su auditoría previa.
- Revocar explícitamente TRUNCATE, REFERENCES y TRIGGER de `anon`/`authenticated`.

**WordPress**
- Poner tope de tamaño a las filas "review" de la cola.
- Agregar retención o purga de la cola.
- Limpiar el aviso del panel de administración.

**API de administración**
- `/api/admin/users`: leer el cuerpo con límite real de tamaño y verificar la escritura en la auditoría.

**Importación histórica**
- Insertar el motivo de rechazo antes del caso.
- Prefijar las acciones históricas.
- Usar un literal dollar-quoted.

### Cómo se verificó la corrección

- `tests/database.sql` incluye regresiones para los tres puntos de la migración 011.
- Se ejecutaron con PostgreSQL 16 y migraciones 001–011, en dos modos: con permisos de prueba y emulando los privilegios por defecto de Supabase.
- `npm run typecheck`, `npm test`, `npm run build` y `npm run test:e2e` pasan.
