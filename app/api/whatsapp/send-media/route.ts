import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { oggOpusChannels } from "@/lib/ogg-opus";
import { whatsappNumber } from "@/lib/phone";
import {
  CAPTION_MAX,
  SEND_MEDIA,
  SEND_MEDIA_MAX_BYTES,
  fileMatchesType,
  sendFileName,
  sendMime,
  windowOpen,
} from "@/lib/whatsapp";
import {
  processOutbox,
  serviceClient,
  uploadMedia,
  waConfig,
} from "@/lib/whatsapp-server";

export const runtime = "nodejs";
export const maxDuration = 60;

const fail = (error: string, status: number) =>
  Response.json({ error }, { status });

const TOO_BIG = "El archivo supera los 4 MB que se pueden enviar desde el CRM.";

// Photos, PDFs, videos and audio (voice notes) sent by the team from the CRM chat (multipart: application_id, file, caption).
// Same checks as a text message: the caller's own JWT proves case access through RLS, and the
// client must have written in the last 24 h. The file goes to WhatsApp and is sent by media id.
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
  const declared = Number(req.headers.get("content-length") ?? "0");
  // Reject oversized uploads before reading them (the platform caps requests at ~4.5 MB anyway).
  if (declared > SEND_MEDIA_MAX_BYTES + 64 * 1024) return fail(TOO_BIG, 413);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("No se pudo leer el archivo.", 400);
  }
  const id = z.uuid().safeParse(form.get("application_id"));
  if (!id.success) return fail("Caso inválido.", 422);
  const file = form.get("file");
  if (!(file instanceof Blob) || !file.size)
    return fail("Elegí un archivo.", 422);
  if (file.size > SEND_MEDIA_MAX_BYTES) return fail(TOO_BIG, 413);
  const mime = sendMime(file.type);
  const type = SEND_MEDIA[mime];
  if (!type)
    return fail(
      "Solo se pueden enviar fotos (JPG o PNG), PDF, videos MP4 y audios (MP3, M4A, AAC u OGG).",
      415,
    );
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!fileMatchesType(bytes, mime))
    return fail(
      "El archivo no coincide con su tipo. Probá exportarlo de nuevo.",
      415,
    );
  const captionRaw = form.get("caption");
  const caption = typeof captionRaw === "string" ? captionRaw.trim() : "";
  if (type.kind === "audio" && caption)
    return fail(
      "Los audios se envían sin texto. Mandá el texto como mensaje aparte.",
      422,
    );
  if (caption.length > CAPTION_MAX)
    return fail(
      `El texto que acompaña el archivo admite hasta ${CAPTION_MAX} caracteres.`,
      422,
    );

  const asUser = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { authorization: `Bearer ${token}` } },
  });
  const { data: app } = await asUser
    .from("applications")
    .select("id,phone")
    .eq("id", id.data)
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
  if (!windowOpen(conv?.last_inbound_at))
    return fail(
      "Pasaron más de 24 h desde el último mensaje del cliente. Enviá la plantilla para retomar la conversación.",
      409,
    );

  const filename = sendFileName(
    file instanceof File ? file.name : "",
    type.ext,
  );
  const uploaded = await uploadMedia(cfg, new Blob([bytes]), mime, filename);
  if (!uploaded.ok) return fail(uploaded.error, 502);

  const inserted = await db
    .from("wa_outbox")
    .insert({
      application_id: app.id,
      purpose: "manual",
      kind: type.kind,
      body: caption || null,
      media: {
        id: uploaded.id,
        mime_type: mime,
        filename,
        // Ogg/Opus mono is what WhatsApp shows as a voice note (microphone, transcription).
        ...(mime === "audio/ogg" && oggOpusChannels(bytes) === 1
          ? { voice: true }
          : {}),
      },
      to_phone: `+${wa}`,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (inserted.error) return fail("No se pudo encolar el archivo.", 500);
  await processOutbox(db, cfg, 5).catch(() => undefined);
  const { data: result } = await db
    .from("wa_outbox")
    .select("status,last_error")
    .eq("id", inserted.data.id)
    .single();
  if (result?.status === "failed")
    return fail(result.last_error || "WhatsApp rechazó el archivo.", 502);
  return Response.json({ status: result?.status ?? "pending" });
}
