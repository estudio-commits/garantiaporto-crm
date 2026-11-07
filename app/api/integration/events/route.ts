import { createClient } from "@supabase/supabase-js";
import { createHmac, timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { eventSchema } from "@/lib/domain";
import { processOutbox, waConfig } from "@/lib/whatsapp-server";
export const runtime = "nodejs";
export async function POST(req: Request) {
  if (process.env.CRM_INTEGRATION_ENABLED !== "true")
    return Response.json({ error: "Integration disabled" }, { status: 503 });
  const secret = process.env.CRM_WEBHOOK_SECRET,
    url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret || !url || !key)
    return Response.json({ error: "Not configured" }, { status: 503 });
  const stamp = req.headers.get("x-crm-timestamp") || "",
    sig = req.headers.get("x-crm-signature") || "";
  if (
    !/^\d{10}$/.test(stamp) ||
    Math.abs(Date.now() / 1000 - Number(stamp)) > 300 ||
    !/^[a-f0-9]{64}$/.test(sig)
  )
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const reader = req.body?.getReader();
  if (!reader) return Response.json({ error: "Missing body" }, { status: 400 });
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 32768) {
      await reader.cancel();
      return Response.json({ error: "Payload too large" }, { status: 413 });
    }
    chunks.push(value);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  const expected = createHmac("sha256", secret)
    .update(`${stamp}.${raw}`)
    .digest();
  if (!timingSafeEqual(expected, Buffer.from(sig, "hex")))
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const result = eventSchema.safeParse(input);
  if (!result.success)
    return Response.json({ error: "Invalid event schema" }, { status: 422 });
  const db = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const slot = await db.rpc("take_integration_slot");
  if (slot.error)
    return Response.json({ error: "Unavailable" }, { status: 503 });
  if (!slot.data)
    return Response.json(
      { error: "Rate limited" },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  const { data, error } = await db.rpc("ingest_event", { e: result.data });
  if (error) {
    await db.from("integration_attempts").insert({
      event_id: result.data.event_id,
      status: "failed",
      code: error.code,
    });
    return Response.json(
      { error: "Event not processed" },
      { status: error.code === "P0001" ? 409 : 503 },
    );
  }
  // A new web lead with WhatsApp consent queues a greeting; send it now instead of waiting for cron.
  const wa = waConfig();
  if (wa.enabled)
    after(async () => {
      await processOutbox(db, wa, 5).catch(() => undefined);
    });
  return Response.json(data);
}
