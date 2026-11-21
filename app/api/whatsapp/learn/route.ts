import { runLearning, weekOf } from "@/lib/bot-learning";
import { safeEqual, serviceClient } from "@/lib/whatsapp-server";

export const runtime = "nodejs";
// Reading a week of conversations and answering takes a while.
export const maxDuration = 300;

const fail = (error: string, status: number) =>
  Response.json({ error }, { status });

// GET: weekly Vercel Cron (vercel.json), with Authorization: Bearer $CRON_SECRET. Runs once per week.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET || "";
  const auth = req.headers.get("authorization") || "";
  if (secret.length < 16 || !safeEqual(auth, `Bearer ${secret}`))
    return fail("Unauthorized", 401);
  const db = serviceClient();
  if (!db) return Response.json({ skipped: "disabled" });
  if (!process.env.ANTHROPIC_API_KEY)
    return Response.json({ skipped: "sin clave de Anthropic" });
  const done = await db
    .from("wa_bot_learning_runs")
    .select("id")
    .eq("week", weekOf())
    .eq("status", "lista")
    .limit(1);
  if (done.error) return fail("Falta la migración 027.", 503);
  if (done.data?.length) return Response.json({ skipped: "ya analizada" });
  return Response.json(await runLearning(db));
}

// POST: "Analizar ahora" from Integraciones (administration only).
export async function POST(req: Request) {
  const db = serviceClient();
  if (!db) return fail("Falta la configuración del servidor.", 503);
  if (!process.env.ANTHROPIC_API_KEY)
    return fail("Falta ANTHROPIC_API_KEY en Vercel.", 503);
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
  // One analysis at a time: a run started in the last 5 minutes is still going.
  const running = await db
    .from("wa_bot_learning_runs")
    .select("id")
    .eq("status", "en_curso")
    .gte("started_at", new Date(Date.now() - 5 * 60000).toISOString())
    .limit(1);
  if (running.error) return fail("Falta la migración 027.", 503);
  if (running.data?.length)
    return fail("Ya hay un análisis en curso. Esperá unos minutos.", 409);
  const result = await runLearning(db, undefined, user.id);
  return Response.json(result, { headers: { "cache-control": "no-store" } });
}
