import { driveConfig } from "@/lib/drive";
import {
  processMedia,
  processOutbox,
  safeEqual,
  serviceClient,
  waConfig,
} from "@/lib/whatsapp-server";

export const runtime = "nodejs";
export const maxDuration = 60;

// Called by Vercel Cron (vercel.json) with Authorization: Bearer $CRON_SECRET.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET || "";
  const auth = req.headers.get("authorization") || "";
  if (secret.length < 16 || !safeEqual(auth, `Bearer ${secret}`))
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const cfg = waConfig();
  const db = serviceClient();
  if (!cfg.enabled || !db) return Response.json({ skipped: "disabled" });
  let total = { claimed: 0, sent: 0, failed: 0 };
  // Drain in small batches within the function time budget.
  for (let i = 0; i < 5; i++) {
    const r = await processOutbox(db, cfg, 20);
    total = {
      claimed: total.claimed + r.claimed,
      sent: total.sent + r.sent,
      failed: total.failed + r.failed,
    };
    if (r.claimed < 20) break;
  }
  const media = await processMedia(db, cfg, driveConfig(), 10);
  return Response.json({ ...total, media });
}
