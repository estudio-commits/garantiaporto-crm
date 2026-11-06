@AGENTS.md

# Garantía Porto CRM — guía para Claude Code

CRM interno de Garantía Porto (Uruguay). Next.js 16 + React 19 + TypeScript, Supabase (PostgreSQL + Auth + RLS), validación con Zod. Proyecto iniciado en Codex; la rama principal es `codex/crm-demo`. La documentación y la interfaz están en español rioplatense.

## Comandos

- `npm ci` — instalar (usa `.npm-cache/` local por `.npmrc`).
- `npm run dev` — servidor de desarrollo. Sin variables Supabase abre la **demo ficticia** persistida en localStorage (`porto-demo-v1`).
- `npm run typecheck` — TypeScript.
- `npm test` — pruebas unitarias (`tests/*.test.ts` con `tsx --test`).
- `npm run test:e2e -- --trace off` — Playwright contra la demo en el puerto 3100 (usa Chromium de `@sparticuz/chromium`).
- `npm run build` — build de producción.
- `npm run test:db` / `npm run test:import` — requieren Docker (PostgreSQL 17 desechable). No disponibles en el entorno cloud sin Docker.

Antes de dar por terminado un cambio: `npm run typecheck && npm test && npm run build`, y `npm run test:e2e` si toca la interfaz.

## Estructura

- `app/` rutas (panel, login, `api/admin/users`, `api/integration/events`).
- `components/` interfaz (`crm.tsx` es el contenedor principal; `pipeline.tsx`, `case-detail.tsx`, etc.).
- `lib/` dominio y reglas (`domain.ts`, `workflow.ts`, `analytics.ts`, `phone.ts`, `sources.ts`), cliente Supabase y datos demo (`demo.ts`).
- `supabase/migrations/` migraciones numeradas `NNN_nombre.sql`; se aplican en orden. Nunca editar una migración ya publicada: crear la siguiente.
- `integrations/wordpress/` puente WPCode/Elementor (deshabilitado por defecto).
- `docs/` arquitectura, operación, integración, importación histórica, WhatsApp.

## Reglas del proyecto

- **Ningún dato real** de clientes en fixtures, tests, capturas, logs ni prompts. Solo datos ficticios.
- Secretos solo en `.env.local` (ignorado). Nunca usar `SUPABASE_SERVICE_ROLE_KEY` ni `CRM_WEBHOOK_SECRET` con prefijo `NEXT_PUBLIC_`.
- La seguridad real vive en PostgreSQL (RLS, triggers, tablas sensibles separadas), no en la UI. Al cambiar permisos o columnas, actualizar migración + `tests/database.sql`.
- Dos ejes independientes: comercial (`nuevo`, `en_contacto`, `finalizado`) y garantía (`sin_contactar` … `aprobada`/`rechazada`). Cambiar uno no modifica el otro.
- `created_at` (ingreso) es inmutable; `requested_date` es editable y auditada. Toda modificación de estado/asignación se audita con valor anterior/nuevo.
- Alertas por días calendario de `America/Montevideo` según el último comentario.
- Solo administración decide aprobación/rechazo y registra emisiones.
- Cambios en el modelo de datos deben reflejarse también en la demo (`lib/demo.ts`) con migración del localStorage sin borrar datos existentes.
- No modificar la web, cotizador, emails ni campañas; la integración externa queda deshabilitada por defecto (`CRM_INTEGRATION_ENABLED=false`).
- Mantener README/docs actualizados cuando cambie el comportamiento visible.
