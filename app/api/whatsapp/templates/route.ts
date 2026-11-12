import { templatePreview } from "@/lib/whatsapp";
import { serviceClient, waConfig } from "@/lib/whatsapp-server";

export const runtime = "nodejs";
export const maxDuration = 20;

const fail = (error: string, status: number) =>
  Response.json({ error }, { status });

// Admin-only: reads the approved text of the greeting and reopen templates from Meta,
// so Integraciones shows exactly what the client receives.
export async function GET(req: Request) {
  const cfg = waConfig();
  const db = serviceClient();
  const waba = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "";
  if (!db) return fail("Falta la configuración del servidor.", 503);
  const bearer = req.headers.get("authorization");
  if (!bearer?.startsWith("Bearer ")) return fail("Sin autorización", 401);
  const {
    data: { user },
  } = await db.auth.getUser(bearer.slice(7));
  if (!user) return fail("Sin autorización", 401);
  const { data: profile } = await db
    .from("profiles")
    .select("role,active")
    .eq("id", user.id)
    .single();
  if (!profile?.active || profile.role !== "admin")
    return fail("Solo administración.", 403);
  if (!cfg.token || !/^\d{5,30}$/.test(waba))
    return Response.json({ configured: false });
  const { data: settings } = await db
    .from("wa_settings")
    .select("greeting_template,reopen_template,template_language")
    .eq("id", 1)
    .single();
  if (!settings) return fail("Falta la configuración de WhatsApp.", 503);
  const names = [settings.greeting_template, settings.reopen_template];
  const result: Record<string, unknown> = { configured: true };
  for (const [key, name] of [
    ["greeting", names[0]],
    ["reopen", names[1]],
  ] as const) {
    const url = `${cfg.apiBase}/${waba}/message_templates?${new URLSearchParams({ name, fields: "name,language,status,components", limit: "20" })}`;
    try {
      const r = await fetch(url, {
        headers: { authorization: `Bearer ${cfg.token}` },
        signal: AbortSignal.timeout(10000),
        redirect: "error",
      });
      if (!r.ok) {
        result[key] = {
          error:
            r.status === 400 || r.status === 404
              ? "Revisá el identificador de la cuenta de WhatsApp Business."
              : r.status === 403 || r.status === 401
                ? "El token no tiene permiso para leer las plantillas."
                : `Meta respondió con error (HTTP ${r.status}).`,
        };
        continue;
      }
      const data = (await r.json()) as { data?: [] };
      result[key] = templatePreview(
        data.data ?? [],
        name,
        settings.template_language,
      ) ?? { error: `No existe la plantilla «${name}» en esta cuenta.` };
    } catch {
      result[key] = { error: "No se pudo consultar a Meta." };
    }
  }
  return Response.json(result, { headers: { "cache-control": "no-store" } });
}
