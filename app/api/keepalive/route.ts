import { keepAlive } from "@/lib/keepalive";
import { safeEqual, serviceClient } from "@/lib/whatsapp-server";

export const runtime = "nodejs";
export const maxDuration = 30;

// Called every day by Vercel Cron (vercel.json) with Authorization: Bearer $CRON_SECRET.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET || "";
  const auth = req.headers.get("authorization") || "";
  if (secret.length < 16 || !safeEqual(auth, `Bearer ${secret}`))
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  const db = serviceClient();
  if (!db)
    return Response.json(
      { ok: false, error: "Faltan las variables de Supabase." },
      { status: 503 },
    );
  const result = await keepAlive(db);
  if (!result.ok) console.error("[keepalive]", result.error);
  // A failure shows as an error in Vercel → Cron Jobs / Logs.
  return Response.json(result, {
    status: result.ok ? 200 : 502,
    headers: { "cache-control": "no-store" },
  });
}
