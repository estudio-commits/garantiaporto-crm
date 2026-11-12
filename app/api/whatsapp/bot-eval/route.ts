import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { runEvalCase } from "@/lib/bot-eval";
import { TEST_CASES } from "@/lib/bot-tests";
import { readLimited, serviceClient } from "@/lib/whatsapp-server";

export const runtime = "nodejs";
export const maxDuration = 60;

const fail = (error: string, status: number) =>
  Response.json({ error }, { status });
const schema = z.object({ index: z.number().int().min(0) }).strict();

// Admin-only: runs ONE test question (docs/WHATSAPP-FAQ.md, section 11) through the real assistant
// with a fictitious in-memory case. Nothing is stored and no WhatsApp message is sent.
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
  const raw = await readLimited(req, 1024);
  let input;
  try {
    input = schema.safeParse(JSON.parse(raw?.toString("utf8") || "{}"));
  } catch {
    return fail("JSON inválido", 400);
  }
  if (!input.success || input.data.index >= TEST_CASES.length)
    return fail("Pregunta de prueba inexistente.", 422);
  const c = TEST_CASES[input.data.index];
  const result = await runEvalCase(new Anthropic(), c.question);
  return Response.json(
    { ...result, expected: c.expected },
    { headers: { "cache-control": "no-store" } },
  );
}
