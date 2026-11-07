// Server-only WhatsApp code: configuration, webhook signatures, Graph API calls and the outbox worker.
// Never import this file from client components: it reads secrets from the environment.
import { createHmac, timingSafeEqual } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { whatsappNumber } from "./phone";
import {
  explainError,
  messagePayload,
  shouldRetry,
  type OutboxRow,
} from "./whatsapp";

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
