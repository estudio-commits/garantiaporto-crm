// WhatsApp Cloud API helpers shared by server routes, the CRM UI and tests.
// Pure functions only: no secrets, no network, no Node-only modules.

export const WINDOW_MS = 24 * 60 * 60 * 1000;

export type WaConversation = {
  id: string;
  wa_id: string;
  application_id: string | null;
  profile_name: string | null;
  last_inbound_at: string | null;
  last_message_at: string | null;
  unread_count: number;
  needs_human: boolean;
  bot_paused: boolean;
  created_at: string;
};

export type WaMessage = {
  id: string;
  conversation_id: string;
  application_id: string | null;
  wamid: string | null;
  direction: "in" | "out";
  author: "customer" | "bot" | "human" | "system";
  author_id: string | null;
  kind: string;
  body: string;
  media: WaMedia | null;
  status: "received" | "sent" | "delivered" | "read" | "failed";
  error: string | null;
  created_at: string;
  status_at: string | null;
};

export type WaMedia = {
  id: string;
  mime_type?: string;
  sha256?: string;
  filename?: string;
};

export type InboundMessage = {
  wamid: string;
  from: string;
  profile_name?: string;
  timestamp: string;
  kind: string;
  body: string;
  media?: WaMedia;
};

export type StatusUpdate = {
  wamid: string;
  status: "sent" | "delivered" | "read" | "failed";
  timestamp: string;
  error?: string;
};

/** The customer-service window: free-form messages only within 24 h of the last inbound message. */
export function windowOpen(
  lastInboundAt: string | null | undefined,
  now = Date.now(),
): boolean {
  if (!lastInboundAt) return false;
  const t = Date.parse(lastInboundAt);
  return Number.isFinite(t) && now - t < WINDOW_MS && now >= t - 60_000;
}

export function windowClosesAt(lastInboundAt: string | null | undefined) {
  if (!lastInboundAt) return null;
  const t = Date.parse(lastInboundAt);
  return Number.isFinite(t) ? new Date(t + WINDOW_MS) : null;
}

const KINDS = new Set([
  "text",
  "image",
  "document",
  "audio",
  "video",
  "sticker",
  "location",
  "contacts",
  "interactive",
  "button",
  "reaction",
]);
const MEDIA = new Set(["image", "document", "audio", "video", "sticker"]);
const STATUSES = new Set(["sent", "delivered", "read", "failed"]);
const WA_ID = /^[1-9]\d{7,14}$/;

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown, max = 10000) =>
  typeof v === "string" ? v.slice(0, max) : "";

function toIso(seconds: unknown): string {
  const n = Number(seconds);
  return Number.isFinite(n) && n > 0
    ? new Date(n * 1000).toISOString()
    : new Date().toISOString();
}

function describe(m: Obj, kind: string): string {
  const part = obj(m[kind]);
  switch (kind) {
    case "text":
      return str(obj(m.text).body);
    case "image":
    case "video":
    case "document":
      return (
        str(part.caption) ||
        (kind === "document" ? str(part.filename, 300) : "")
      );
    case "location": {
      const name = [str(part.name, 200), str(part.address, 300)]
        .filter(Boolean)
        .join(" · ");
      return `Ubicación: ${part.latitude}, ${part.longitude}${name ? ` (${name})` : ""}`;
    }
    case "button":
      return str(part.text, 1000);
    case "interactive": {
      const reply = obj(part.button_reply ?? part.list_reply);
      return str(reply.title, 1000);
    }
    case "reaction":
      return `Reacción ${str(part.emoji, 20)}`.trim();
    case "contacts":
      return "Contacto compartido";
    default:
      return "";
  }
}

/**
 * Extracts inbound messages and delivery receipts from a Cloud API webhook body.
 * Unknown shapes are ignored instead of throwing, so one odd entry never blocks the rest.
 * When `phoneNumberId` is given, changes for other numbers of the same account are skipped.
 */
export function parseWebhook(
  payload: unknown,
  phoneNumberId?: string,
): { messages: InboundMessage[]; statuses: StatusUpdate[] } {
  const messages: InboundMessage[] = [];
  const statuses: StatusUpdate[] = [];
  const body = obj(payload);
  if (body.object !== "whatsapp_business_account")
    return { messages, statuses };
  for (const entry of arr(body.entry)) {
    for (const change of arr(obj(entry).changes)) {
      const c = obj(change);
      if (c.field !== "messages") continue;
      const value = obj(c.value);
      const metaId = str(obj(value.metadata).phone_number_id, 64);
      if (phoneNumberId && metaId && metaId !== phoneNumberId) continue;
      const names = new Map<string, string>();
      for (const contact of arr(value.contacts)) {
        const ct = obj(contact);
        names.set(str(ct.wa_id, 20), str(obj(ct.profile).name, 200));
      }
      for (const raw of arr(value.messages)) {
        const m = obj(raw);
        const from = str(m.from, 20);
        const wamid = str(m.id, 200);
        if (!WA_ID.test(from) || !wamid) continue;
        const type = str(m.type, 30);
        const kind = KINDS.has(type) ? type : "unsupported";
        const part = obj(m[type]);
        const media =
          MEDIA.has(kind) && typeof part.id === "string"
            ? {
                id: str(part.id, 100),
                mime_type: str(part.mime_type, 100) || undefined,
                sha256: str(part.sha256, 100) || undefined,
                filename: str(part.filename, 300) || undefined,
              }
            : undefined;
        messages.push({
          wamid,
          from,
          profile_name: names.get(from) || undefined,
          timestamp: toIso(m.timestamp),
          kind,
          body:
            kind === "unsupported"
              ? "Mensaje de un tipo que el CRM todavía no muestra."
              : describe(m, kind),
          media,
        });
      }
      for (const raw of arr(value.statuses)) {
        const s = obj(raw);
        const status = str(s.status, 20);
        const wamid = str(s.id, 200);
        if (!STATUSES.has(status) || !wamid) continue;
        const err = obj(arr(s.errors)[0]);
        statuses.push({
          wamid,
          status: status as StatusUpdate["status"],
          timestamp: toIso(s.timestamp),
          error: err.code
            ? `${err.code} ${str(err.title, 200)}${
                obj(err.error_data).details
                  ? `: ${str(obj(err.error_data).details, 250)}`
                  : ""
              }`.slice(0, 500)
            : undefined,
        });
      }
    }
  }
  return { messages, statuses };
}

export type OutboxRow = {
  id: string;
  application_id: string | null;
  purpose: "greeting" | "reopen" | "manual" | "auto_reply" | "bot";
  to_phone: string;
  kind: "text" | "template";
  body: string | null;
  template: { name: string; language: string; params?: string[] } | null;
  attempts: number;
  created_at: string;
};

export function messagePayload(to: string, row: OutboxRow) {
  if (row.kind === "template" && row.template) {
    const params = (row.template.params ?? []).map((text) => ({
      type: "text",
      text: String(text).slice(0, 1024),
    }));
    return {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "template",
      template: {
        name: row.template.name,
        language: { code: row.template.language },
        components: params.length ? [{ type: "body", parameters: params }] : [],
      },
    };
  }
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { preview_url: false, body: String(row.body ?? "").slice(0, 4096) },
  };
}

// Graph errors worth retrying: throttling, temporary platform failures and auth/config problems
// that an operator can fix (token renewal). Everything else (closed window, undeliverable,
// template rejected, bad parameter) fails permanently and is shown in the CRM.
const RETRY_CODES = new Set([
  1, 2, 4, 17, 190, 341, 368, 80007, 130429, 131000, 131016, 131056, 133004,
]);
export function shouldRetry(httpStatus: number, code?: number) {
  if (httpStatus === 429 || httpStatus >= 500 || httpStatus === 0) return true;
  return code !== undefined && RETRY_CODES.has(code);
}

/** Human-readable Spanish explanation for the most common send failures. */
export function explainError(code?: number, fallback = "") {
  const known: Record<number, string> = {
    131047:
      "Pasaron más de 24 h desde el último mensaje del cliente: hay que enviar una plantilla.",
    131026:
      "WhatsApp no pudo entregar el mensaje (número sin WhatsApp o bloqueado).",
    131051: "Tipo de mensaje no admitido.",
    132000: "La plantilla no coincide con sus variables.",
    132001: "La plantilla no existe o no está aprobada en ese idioma.",
    131056: "Demasiados mensajes seguidos a este número; se reintenta.",
    130429: "Límite de envío alcanzado; se reintenta.",
    190: "El token de acceso de WhatsApp no es válido o venció.",
    100: "Parámetro inválido en la solicitud a WhatsApp.",
  };
  return (
    (code !== undefined && known[code]) ||
    fallback ||
    "Error al enviar a WhatsApp."
  );
}

export const firstName = (fullName: string) =>
  fullName.trim().split(/\s+/)[0] || "¡hola!";
