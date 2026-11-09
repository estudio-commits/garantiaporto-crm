// Server-only WhatsApp code: configuration, webhook signatures, Graph API calls and the outbox worker.
// Never import this file from client components: it reads secrets from the environment.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { whatsappNumber } from "./phone";
import {
  explainError,
  messagePayload,
  shouldRetry,
  type OutboxRow,
  type WaMedia,
} from "./whatsapp";
import {
  DriveError,
  ensureCaseFolder,
  folderIdFromUrl,
  folderUrl,
  uploadFile,
  type DriveConfig,
} from "./drive";

export type WaConfig = {
  enabled: boolean;
  apiBase: string;
  token: string;
  phoneNumberId: string;
  appSecret: string;
  verifyToken: string;
};

export function waConfig(): WaConfig {
  const version = process.env.WHATSAPP_GRAPH_VERSION || "v23.0";
  const cfg = {
    apiBase: (
      process.env.WHATSAPP_API_BASE_URL ||
      `https://graph.facebook.com/${version}`
    ).replace(/\/+$/, ""),
    token: process.env.WHATSAPP_API_TOKEN || "",
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
    appSecret: process.env.WHATSAPP_APP_SECRET || "",
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || "",
  };
  const enabled =
    process.env.WHATSAPP_ENABLED === "true" &&
    !!cfg.token &&
    /^\d{5,30}$/.test(cfg.phoneNumberId) &&
    cfg.appSecret.length >= 16 &&
    cfg.apiBase.startsWith("https://");
  return { ...cfg, enabled };
}

export function serviceClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Meta signs the exact raw body: X-Hub-Signature-256: sha256=<hex HMAC with the app secret>. */
export function verifySignature(
  raw: Buffer,
  header: string | null,
  secret: string,
) {
  if (!secret || !header || !/^sha256=[a-f0-9]{64}$/.test(header)) return false;
  const expected = createHmac("sha256", secret).update(raw).digest();
  return timingSafeEqual(expected, Buffer.from(header.slice(7), "hex"));
}

/** Reads a request body up to `max` bytes; returns null when larger. */
export async function readLimited(req: Request, max: number) {
  const reader = req.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

type SendResult =
  { ok: true; wamid: string } | { ok: false; error: string; retry: boolean };

export async function graphSend(
  cfg: WaConfig,
  payload: unknown,
  fetcher: typeof fetch = fetch,
): Promise<SendResult> {
  let status = 0,
    data: Record<string, unknown> = {};
  try {
    const r = await fetcher(`${cfg.apiBase}/${cfg.phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${cfg.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    status = r.status;
    data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    const id = (data.messages as { id?: string }[] | undefined)?.[0]?.id;
    if (r.ok && typeof id === "string") return { ok: true, wamid: id };
  } catch {
    return {
      ok: false,
      error: "Sin respuesta de WhatsApp (red o tiempo de espera).",
      retry: true,
    };
  }
  const err = (data.error ?? {}) as { code?: number; message?: string };
  return {
    ok: false,
    error:
      `${err.code ?? status} ${explainError(err.code, `HTTP ${status}`)}`.slice(
        0,
        500,
      ),
    retry: shouldRetry(status, err.code),
  };
}

const GREETING_TTL_MS = 48 * 3600 * 1000;

/** Claims due outbox rows and sends them. Safe to call concurrently: claims use SKIP LOCKED. */
export async function processOutbox(
  db: SupabaseClient,
  cfg: WaConfig,
  limit = 10,
  fetcher: typeof fetch = fetch,
) {
  const claimed = await db.rpc("wa_claim_outbox", { n: limit });
  if (claimed.error) throw Error(claimed.error.message);
  const rows = (claimed.data ?? []) as OutboxRow[];
  let sent = 0,
    failed = 0;
  for (const row of rows) {
    const to = whatsappNumber(row.to_phone);
    let result: SendResult;
    if (
      row.purpose === "greeting" &&
      Date.now() - Date.parse(row.created_at) > GREETING_TTL_MS
    )
      result = {
        ok: false,
        error: "Saludo vencido: no se envió dentro de las 48 h.",
        retry: false,
      };
    else if (!to)
      result = {
        ok: false,
        error: "El celular no tiene un formato válido para WhatsApp.",
        retry: false,
      };
    else result = await graphSend(cfg, messagePayload(to, row), fetcher);
    const done = await db.rpc("wa_complete_outbox", {
      p_id: row.id,
      p_wa_id: to,
      p_wamid: result.ok ? result.wamid : null,
      p_error: result.ok ? null : result.error,
      p_retry: result.ok ? false : result.retry,
    });
    if (done.error) throw Error(done.error.message);
    if (result.ok) sent++;
    else failed++;
  }
  return { claimed: rows.length, sent, failed };
}

// ---- Etapa 2: documents received over WhatsApp → case folder in Google Drive ----

export const MEDIA_MAX_BYTES = 20 * 1024 * 1024;
const MEDIA_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
};
export const mediaExtension = (mime: string) =>
  MEDIA_TYPES[mime.split(";")[0].trim().toLowerCase()];

type MediaResult =
  | { ok: true; bytes: Buffer; mime: string }
  | { ok: false; error: string; retry: boolean; reject?: boolean };

/** Resolves a Cloud API media id and downloads it with size, type and checksum checks. */
export async function downloadMedia(
  cfg: WaConfig,
  mediaId: string,
  fetcher: typeof fetch = fetch,
): Promise<MediaResult> {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(mediaId))
    return {
      ok: false,
      error: "Identificador de archivo inválido.",
      retry: false,
      reject: true,
    };
  const auth = { authorization: `Bearer ${cfg.token}` };
  try {
    const info = await fetcher(`${cfg.apiBase}/${mediaId}`, {
      headers: auth,
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    const meta = (await info.json().catch(() => ({}))) as {
      url?: string;
      mime_type?: string;
      file_size?: number;
      sha256?: string;
    };
    if (!info.ok || !meta.url)
      return {
        ok: false,
        error: `WhatsApp no entregó el archivo (HTTP ${info.status}).`,
        retry: info.status === 429 || info.status >= 500,
      };
    const mime = String(meta.mime_type || "");
    if (!mediaExtension(mime))
      return {
        ok: false,
        error: `Tipo de archivo no admitido (${mime || "desconocido"}). Se aceptan PDF, imágenes y Word.`,
        retry: false,
        reject: true,
      };
    if ((meta.file_size ?? 0) > MEDIA_MAX_BYTES)
      return {
        ok: false,
        error: "El archivo supera los 20 MB.",
        retry: false,
        reject: true,
      };
    // The bearer token is only ever sent to Meta's media hosts, and redirects are not followed.
    const u = new URL(meta.url);
    if (
      u.protocol !== "https:" ||
      !/(^|\.)(fbsbx\.com|facebook\.com|whatsapp\.net)$/.test(u.hostname)
    )
      return {
        ok: false,
        error: "Enlace de descarga inválido.",
        retry: false,
        reject: true,
      };
    const r = await fetcher(meta.url, {
      headers: auth,
      redirect: "error",
      signal: AbortSignal.timeout(60000),
    });
    if (!r.ok || !r.body)
      return {
        ok: false,
        error: `No se pudo descargar el archivo (HTTP ${r.status}).`,
        retry: r.status === 429 || r.status >= 500,
      };
    const reader = r.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MEDIA_MAX_BYTES) {
        await reader.cancel();
        return {
          ok: false,
          error: "El archivo supera los 20 MB.",
          retry: false,
          reject: true,
        };
      }
      chunks.push(value);
    }
    const bytes = Buffer.concat(chunks);
    if (meta.sha256) {
      const digest = createHash("sha256").update(bytes).digest();
      if (
        meta.sha256 !== digest.toString("hex") &&
        meta.sha256 !== digest.toString("base64")
      )
        return {
          ok: false,
          error:
            "El archivo descargado no coincide con su huella; se reintenta.",
          retry: true,
        };
    }
    return { ok: true, bytes, mime: mime.split(";")[0].trim().toLowerCase() };
  } catch {
    return {
      ok: false,
      error: "Sin respuesta de WhatsApp al descargar el archivo.",
      retry: true,
    };
  }
}

const safeName = (s: string) =>
  s
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export function caseFolderName(c: {
  full_name: string;
  national_id: string | null;
  phone: string;
  created_at: string;
}) {
  const ci = c.national_id ? `CI ${c.national_id}` : c.phone;
  return safeName(`${c.full_name} · ${ci} · ${c.created_at.slice(0, 10)}`);
}

export function mediaFileName(
  kind: string,
  media: WaMedia,
  mime: string,
  receivedAt: string,
) {
  const stamp = new Date(receivedAt)
    .toLocaleString("sv-SE", { timeZone: "America/Montevideo" })
    .slice(0, 16)
    .replace(":", "");
  const ext = mediaExtension(mime) ?? "bin";
  const original = media.filename
    ? safeName(media.filename).replace(/\.[A-Za-z0-9]{1,5}$/, "")
    : kind === "image"
      ? "Imagen"
      : "Documento";
  return `${stamp} WhatsApp - ${original}.${ext}`;
}

/** Claims pending media and files each one in the case folder (creating it when the case has none). */
export async function processMedia(
  db: SupabaseClient,
  cfg: WaConfig,
  drive: DriveConfig,
  limit = 5,
  fetcher: typeof fetch = fetch,
) {
  if (!drive.enabled) return { claimed: 0, stored: 0, failed: 0 };
  const claimed = await db.rpc("wa_claim_media", { n: limit });
  if (claimed.error) throw Error(claimed.error.message);
  const rows = (claimed.data ?? []) as {
    id: string;
    application_id: string;
    kind: string;
    media: WaMedia;
    created_at: string;
  }[];
  let stored = 0,
    failed = 0;
  for (const row of rows) {
    let status = "failed",
      fileId: string | null = null,
      fileUrl: string | null = null,
      newFolderUrl: string | null = null,
      error: string | null = null,
      retry = false;
    const media = await downloadMedia(cfg, row.media?.id ?? "", fetcher);
    if (!media.ok) {
      status = media.reject ? "rejected" : "failed";
      error = media.error;
      retry = media.retry;
    } else {
      try {
        const kase = await db
          .rpc("wa_media_case", { p_application: row.application_id })
          .single();
        if (kase.error || !kase.data)
          throw new DriveError("No se encontró el caso.", true);
        const c = kase.data as {
          full_name: string;
          national_id: string | null;
          phone: string;
          created_at: string;
          drive_folder_url: string | null;
        };
        let folder = folderIdFromUrl(c.drive_folder_url);
        if (!folder) {
          folder = await ensureCaseFolder(
            drive,
            row.application_id,
            caseFolderName(c),
            fetcher,
          );
          newFolderUrl = folderUrl(folder);
        }
        const up = await uploadFile(
          drive,
          folder,
          mediaFileName(row.kind, row.media, media.mime, row.created_at),
          media.mime,
          media.bytes,
          fetcher,
        );
        status = "stored";
        fileId = up.id;
        fileUrl = up.url;
      } catch (e) {
        error = e instanceof Error ? e.message : "Error al guardar en Drive.";
        retry = e instanceof DriveError ? e.retry : true;
      }
    }
    const done = await db.rpc("wa_complete_media", {
      p_id: row.id,
      p_status: status,
      p_file_id: fileId,
      p_file_url: fileUrl,
      p_folder_url: newFolderUrl,
      p_error: error,
      p_retry: retry,
    });
    if (done.error) throw Error(done.error.message);
    if (status === "stored") stored++;
    else failed++;
  }
  return { claimed: rows.length, stored, failed };
}
