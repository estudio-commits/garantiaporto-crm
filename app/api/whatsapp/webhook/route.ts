import { after } from "next/server";
import { parseWebhook } from "@/lib/whatsapp";
import { driveConfig } from "@/lib/drive";
import {
  processMedia,
  processOutbox,
  readLimited,
  safeEqual,
  serviceClient,
  verifySignature,
  waConfig,
} from "@/lib/whatsapp-server";

export const runtime = "nodejs";
export const maxDuration = 60;

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
    }
  } catch {
    // A 5xx makes Meta redeliver; recording is idempotent by message id.
    return Response.json({ error: "Temporary failure" }, { status: 503 });
  }
  if (messages.length)
    after(async () => {
      await processOutbox(db, cfg, 10).catch(() => undefined);
      await processMedia(db, cfg, driveConfig(), 5).catch(() => undefined);
    });
  return Response.json({ ok: true });
}
