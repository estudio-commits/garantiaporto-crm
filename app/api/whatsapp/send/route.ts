import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { whatsappNumber } from "@/lib/phone";
import { firstName, windowOpen } from "@/lib/whatsapp";
import {
  processOutbox,
  readLimited,
  serviceClient,
  waConfig,
} from "@/lib/whatsapp-server";

export const runtime = "nodejs";
export const maxDuration = 30;

const schema = z
  .object({
    application_id: z.uuid(),
    action: z.enum(["text", "greeting", "reopen"]),
    body: z.string().trim().min(1).max(4096).optional(),
    consent: z.boolean().optional(),
  })
  .strict();

const fail = (error: string, status: number) =>
  Response.json({ error }, { status });

// Manual messages from the CRM. The caller's own JWT is used to prove case access
// through RLS; only then does the server enqueue and send with WhatsApp credentials.
export async function POST(req: Request) {
  const cfg = waConfig();
  const db = serviceClient();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!cfg.enabled || !db || !url || !anon)
    return fail("WhatsApp todavía no está activado.", 503);
  const bearer = req.headers.get("authorization");
  if (!bearer?.startsWith("Bearer ")) return fail("Sin autorización", 401);
  const token = bearer.slice(7);
  const {
    data: { user },
  } = await db.auth.getUser(token);
  if (!user) return fail("Sin autorización", 401);
  const raw = await readLimited(req, 16 * 1024);
  if (!raw) return fail("Mensaje demasiado largo", 413);
  let input;
  try {
    input = schema.safeParse(JSON.parse(raw.toString("utf8")));
  } catch {
    return fail("JSON inválido", 400);
  }
  if (!input.success) return fail("Revisá el mensaje.", 422);
  const { application_id, action, body, consent } = input.data;

  const asUser = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { authorization: `Bearer ${token}` } },
  });
  const { data: app } = await asUser
    .from("applications")
    .select("id,full_name,phone,attribution,archived,wa_consent")
    .eq("id", application_id)
    .maybeSingle();
  if (!app) return fail("No tenés acceso a este caso.", 403);
  const { data: profile } = await db
    .from("profiles")
    .select("active")
    .eq("id", user.id)
    .single();
  if (!profile?.active) return fail("Tu usuario no está activo.", 403);
  const wa = whatsappNumber(app.phone);
  if (!wa) return fail("El celular del caso no es válido para WhatsApp.", 422);

  const { data: conv } = await db
    .from("wa_conversations")
    .select("last_inbound_at")
    .eq("wa_id", wa)
    .maybeSingle();
  const { data: settings } = await db
    .from("wa_settings")
    .select("greeting_template,reopen_template,template_language")
    .eq("id", 1)
    .single();
  if (!settings) return fail("Falta la configuración de WhatsApp.", 503);

  let row: Record<string, unknown>;
  if (action === "text") {
    if (!body) return fail("Escribí un mensaje.", 422);
    if (!windowOpen(conv?.last_inbound_at))
      return fail(
        "Pasaron más de 24 h desde el último mensaje del cliente. Enviá la plantilla para retomar la conversación.",
        409,
      );
    row = { purpose: "manual", kind: "text", body };
  } else {
    const hasConsent =
      consent === true ||
      app.wa_consent === true ||
      !!String(
        (app.attribution as Record<string, unknown>)?.consent_evidence ?? "",
      ).trim() ||
      !!conv?.last_inbound_at;
    if (!hasConsent)
      return fail(
        "Confirmá que el cliente aceptó ser contactado por WhatsApp.",
        422,
      );
    // Consent confirmed by the team is stored on the case (audited as the user) so it is asked only once.
    if (consent === true && !app.wa_consent) {
      const saved = await asUser
        .from("applications")
        .update({ wa_consent: true })
        .eq("id", application_id)
        .select("id");
      // Sellers who can see but not edit the case: the server records it (audited as "Sistema").
      if (!saved.data?.length)
        await db
          .from("applications")
          .update({ wa_consent: true })
          .eq("id", application_id);
    }
    row = {
      purpose: action,
      kind: "template",
      template: {
        name:
          action === "greeting"
            ? settings.greeting_template
            : settings.reopen_template,
        language: settings.template_language,
        params: [firstName(app.full_name)],
      },
    };
  }
  const inserted = await db
    .from("wa_outbox")
    .insert({
      ...row,
      application_id,
      to_phone: `+${wa}`,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (inserted.error)
    return inserted.error.code === "23505"
      ? fail("El saludo inicial ya se envió a este caso.", 409)
      : fail("No se pudo encolar el mensaje.", 500);
  await processOutbox(db, cfg, 5).catch(() => undefined);
  const { data: result } = await db
    .from("wa_outbox")
    .select("status,last_error")
    .eq("id", inserted.data.id)
    .single();
  if (result?.status === "failed")
    return fail(result.last_error || "WhatsApp rechazó el mensaje.", 502);
  return Response.json({ status: result?.status ?? "pending" });
}
