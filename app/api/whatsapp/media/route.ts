import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { driveConfig } from "@/lib/drive";
import {
  downloadMedia,
  drainMedia,
  readLimited,
  serviceClient,
  waConfig,
} from "@/lib/whatsapp-server";

export const runtime = "nodejs";
export const maxDuration = 60;

const fail = (error: string, status: number) =>
  Response.json({ error }, { status });

/** The caller's own Supabase session, so RLS decides which messages they can reach. */
async function caller(req: Request) {
  const db = serviceClient();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const bearer = req.headers.get("authorization");
  if (!db || !url || !anon || !bearer?.startsWith("Bearer ")) return null;
  const token = bearer.slice(7);
  const {
    data: { user },
  } = await db.auth.getUser(token);
  if (!user) return null;
  const { data: profile } = await db
    .from("profiles")
    .select("active")
    .eq("id", user.id)
    .single();
  if (!profile?.active) return null;
  const asUser = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { authorization: `Bearer ${token}` } },
  });
  return { db, asUser };
}

// GET ?id=<message id>: shows a file the client sent, straight from WhatsApp, even if it is not
// in Drive yet. Only for users who can see that case (RLS on wa_messages).
export async function GET(req: Request) {
  const cfg = waConfig();
  if (!cfg.enabled) return fail("WhatsApp no está activado.", 503);
  const who = await caller(req);
  if (!who) return fail("Sin autorización", 401);
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!z.uuid().safeParse(id).success) return fail("Archivo inválido.", 400);
  const { data: m } = await who.asUser
    .from("wa_messages")
    .select("id,direction,media")
    .eq("id", id)
    .maybeSingle();
  const media = m?.media as { id?: string; filename?: string } | null;
  if (!m || m.direction !== "in" || !media?.id)
    return fail("No tenés acceso a este archivo.", 404);
  const file = await downloadMedia(cfg, media.id);
  if (!file.ok) return fail(file.error, file.retry ? 502 : 410);
  const name = (media.filename || "archivo").replace(/[^\w.\- ]+/g, "_");
  return new Response(new Uint8Array(file.bytes), {
    headers: {
      "content-type": file.mime,
      "content-disposition": `inline; filename="${name}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

const schema = z.object({ application_id: z.uuid() }).strict();

// POST {application_id}: files this case's pending or failed WhatsApp documents in Drive now,
// instead of waiting for the next message or the daily task.
export async function POST(req: Request) {
  const cfg = waConfig();
  if (!cfg.enabled) return fail("WhatsApp no está activado.", 503);
  const who = await caller(req);
  if (!who) return fail("Sin autorización", 401);
  const raw = await readLimited(req, 1024);
  let input;
  try {
    input = schema.safeParse(JSON.parse(raw?.toString("utf8") || "{}"));
  } catch {
    return fail("JSON inválido", 400);
  }
  if (!input.success) return fail("Caso inválido.", 422);
  const { data: app } = await who.asUser
    .from("applications")
    .select("id")
    .eq("id", input.data.application_id)
    .maybeSingle();
  if (!app) return fail("No tenés acceso a este caso.", 403);
  const now = new Date().toISOString();
  // Bring this case's waiting files forward and give failed ones a fresh set of attempts.
  await who.db
    .from("wa_messages")
    .update({ media_next_at: now })
    .eq("application_id", app.id)
    .eq("media_status", "pending");
  await who.db
    .from("wa_messages")
    .update({
      media_status: "pending",
      media_attempts: 0,
      media_next_at: now,
      media_error: null,
    })
    .eq("application_id", app.id)
    .eq("media_status", "failed");
  const result = await drainMedia(who.db, cfg, driveConfig());
  return Response.json(result, { headers: { "cache-control": "no-store" } });
}
