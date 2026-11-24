import { after } from "next/server";
import { parseWebhook } from "@/lib/whatsapp";
import { botPause, runBotAfterPause } from "@/lib/bot";
import { driveConfig } from "@/lib/drive";
import {
  processCaseFolders,
  drainMedia,
  processOutbox,
  readLimited,
  safeEqual,
  serviceClient,
  verifySignature,
  waConfig,
} from "@/lib/whatsapp-server";

export const runtime = "nodejs";
// Room for filing documents, the assistant's pause (10–15 s) and its reply.
export const maxDuration = 120;

// Meta's one-time subscription check: echo hub.challenge only for our verify token.
export async function GET(req: Request) {
  const cfg = waConfig();
  const p = new URL(req.url).searchParams;
  const token = p.get("hub.verify_token") || "";
  const challenge = p.get("hub.challenge") || "";
  if (
    p.get("hub.mode") === "subscribe" &&
    cfg.verifyToken.length >= 16 &&
    safeEqual(token, cfg.verifyToken) &&
    /^[\w.-]{1,200}$/.test(challenge)
  )
    return new Response(challenge, {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  return new Response("Forbidden", { status: 403 });
}

export async function POST(req: Request) {
  const cfg = waConfig();
  const db = serviceClient();
  if (!cfg.enabled || !db)
    return Response.json({ error: "WhatsApp disabled" }, { status: 503 });
  const raw = await readLimited(req, 1024 * 1024);
  if (!raw)
    return Response.json({ error: "Payload too large" }, { status: 413 });
  if (
    !verifySignature(raw, req.headers.get("x-hub-signature-256"), cfg.appSecret)
  )
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  let payload: unknown;
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { messages, statuses } = parseWebhook(payload, cfg.phoneNumberId);
  if (!messages.length && !statuses.length) return Response.json({ ok: true });
  // The raw log helps support and replay; it is admin-only and pruned per the retention policy.
  await db.from("wa_webhook_events").insert({ payload });
  // Per conversation, the newest client message of this delivery: the assistant answers after a pause,
  // and only if no newer message arrived meanwhile.
  const botConversations = new Map<string, string>();
  try {
    for (const s of statuses) {
      const r = await db.rpc("wa_record_status", {
        p_wamid: s.wamid,
        p_status: s.status,
        p_at: s.timestamp,
        p_error: s.error ?? null,
      });
      if (r.error) throw Error(r.error.message);
    }
    for (const m of messages) {
      const r = await db.rpc("wa_record_inbound", { m });
      if (r.error) throw Error(r.error.message);
      if (r.data?.bot_active && r.data.message_id)
        botConversations.set(
          String(r.data.conversation_id),
          String(r.data.message_id),
        );
    }
  } catch {
    // A 5xx makes Meta redeliver; recording is idempotent by message id.
    return Response.json({ error: "Temporary failure" }, { status: 503 });
  }
  const readyAt = Date.now() + botPause();
  if (messages.length)
    after(async () => {
      await processOutbox(db, cfg, 10).catch(() => undefined);
      await processCaseFolders(db, driveConfig(), 5).catch(() => undefined);
      // Every file of the batch, not only the first five (several photos often arrive together).
      await drainMedia(db, cfg, driveConfig(), 30000).catch(() => undefined);
      // Documents are filed first so the assistant can confirm them in its reply.
      // The pause runs alongside the filing above; several chats are answered in parallel.
      await Promise.all(
        [...botConversations].map(([id, messageId]) =>
          runBotAfterPause(db, cfg, id, messageId, readyAt).catch(
            () => undefined,
          ),
        ),
      );
    });
  return Response.json({ ok: true });
}
