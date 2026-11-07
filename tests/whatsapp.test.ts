import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  messagePayload,
  parseWebhook,
  shouldRetry,
  windowOpen,
  type OutboxRow,
} from "../lib/whatsapp";
import {
  graphSend,
  processOutbox,
  verifySignature,
  type WaConfig,
} from "../lib/whatsapp-server";

const envelope = (value: unknown) => ({
  object: "whatsapp_business_account",
  entry: [{ id: "1", changes: [{ field: "messages", value }] }],
});

test("parses inbound text, media and receipts; ignores other numbers and bad senders", () => {
  const payload = envelope({
    metadata: { phone_number_id: "111111" },
    contacts: [{ wa_id: "59899000001", profile: { name: "Ana Ficticia" } }],
    messages: [
      {
        from: "59899000001",
        id: "wamid.A",
        timestamp: "1762516800",
        type: "text",
        text: { body: "Hola" },
      },
      {
        from: "59899000001",
        id: "wamid.B",
        timestamp: "1762516801",
        type: "document",
        document: {
          id: "MEDIA1",
          mime_type: "application/pdf",
          filename: "recibo.pdf",
          sha256: "x",
        },
      },
      {
        from: "59899000001",
        id: "wamid.C",
        timestamp: "1762516802",
        type: "ephemeral",
      },
      {
        from: "not-a-number",
        id: "wamid.D",
        type: "text",
        text: { body: "x" },
      },
    ],
    statuses: [
      {
        id: "wamid.OUT",
        status: "failed",
        timestamp: "1762516803",
        errors: [
          {
            code: 131047,
            title: "Re-engagement message",
            error_data: { details: "Outside window" },
          },
        ],
      },
      { id: "wamid.OUT2", status: "weird" },
    ],
  });
  const r = parseWebhook(payload, "111111");
  assert.equal(r.messages.length, 3);
  assert.deepEqual(
    { ...r.messages[0], timestamp: undefined },
    {
      wamid: "wamid.A",
      from: "59899000001",
      profile_name: "Ana Ficticia",
      timestamp: undefined,
      kind: "text",
      body: "Hola",
      media: undefined,
    },
  );
  assert.equal(r.messages[0].timestamp, "2025-11-07T12:00:00.000Z");
  assert.equal(r.messages[1].kind, "document");
  assert.equal(r.messages[1].body, "recibo.pdf");
  assert.equal(r.messages[1].media?.id, "MEDIA1");
  assert.equal(r.messages[2].kind, "unsupported");
  assert.equal(r.statuses.length, 1);
  assert.match(
    r.statuses[0].error ?? "",
    /^131047 Re-engagement message: Outside window$/,
  );
  assert.equal(parseWebhook(payload, "222222").messages.length, 0);
  assert.deepEqual(parseWebhook({ object: "page" }), {
    messages: [],
    statuses: [],
  });
});

test("24 h customer-service window", () => {
  const now = Date.parse("2026-11-07T12:00:00Z");
  assert.equal(windowOpen("2026-11-06T12:00:01Z", now), true);
  assert.equal(windowOpen("2026-11-06T11:59:59Z", now), false);
  assert.equal(windowOpen(null, now), false);
  assert.equal(windowOpen("garbage", now), false);
});

const row = (over: Partial<OutboxRow> = {}): OutboxRow => ({
  id: "o1",
  application_id: "a1",
  purpose: "greeting",
  to_phone: "099 000 001",
  kind: "template",
  body: null,
  template: { name: "saludo_solicitud", language: "es", params: ["Ana"] },
  attempts: 1,
  created_at: new Date().toISOString(),
  ...over,
});

test("builds Cloud API payloads", () => {
  assert.deepEqual(messagePayload("59899000001", row()), {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: "59899000001",
    type: "template",
    template: {
      name: "saludo_solicitud",
      language: { code: "es" },
      components: [
        { type: "body", parameters: [{ type: "text", text: "Ana" }] },
      ],
    },
  });
  const text = messagePayload(
    "59899000001",
    row({ kind: "text", body: "Hola", template: null }),
  );
  assert.equal(text.type, "text");
  assert.deepEqual((text as { text: unknown }).text, {
    preview_url: false,
    body: "Hola",
  });
});

test("retry classification", () => {
  assert.equal(shouldRetry(503), true);
  assert.equal(shouldRetry(429), true);
  assert.equal(shouldRetry(400, 130429), true);
  assert.equal(shouldRetry(400, 131047), false);
  assert.equal(shouldRetry(400, 132001), false);
});

test("webhook signature uses the exact raw body", () => {
  const secret = "app-secret-ficticio-1234";
  const raw = Buffer.from('{"object":"whatsapp_business_account"}');
  const sig =
    "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  assert.equal(verifySignature(raw, sig, secret), true);
  assert.equal(
    verifySignature(Buffer.from(raw.toString() + " "), sig, secret),
    false,
  );
  assert.equal(verifySignature(raw, sig, "otro-secreto-ficticio-123"), false);
  assert.equal(verifySignature(raw, "sha256=zz", secret), false);
  assert.equal(verifySignature(raw, null, secret), false);
});

const cfg: WaConfig = {
  enabled: true,
  apiBase: "https://graph.example.test/v23.0",
  token: "token-ficticio",
  phoneNumberId: "111111",
  appSecret: "app-secret-ficticio-1234",
  verifyToken: "verify-token-ficticio",
};

test("graphSend maps success and Graph errors", async () => {
  let seen: { url: string; init: RequestInit } | null = null;
  const ok = await graphSend(cfg, { x: 1 }, (async (
    url: string,
    init: RequestInit,
  ) => {
    seen = { url, init };
    return new Response(JSON.stringify({ messages: [{ id: "wamid.NEW" }] }), {
      status: 200,
    });
  }) as typeof fetch);
  assert.deepEqual(ok, { ok: true, wamid: "wamid.NEW" });
  assert.equal(seen!.url, "https://graph.example.test/v23.0/111111/messages");
  assert.equal(
    (seen!.init.headers as Record<string, string>).authorization,
    "Bearer token-ficticio",
  );
  const closed = await graphSend(
    cfg,
    {},
    (async () =>
      new Response(JSON.stringify({ error: { code: 131047, message: "x" } }), {
        status: 400,
      })) as typeof fetch,
  );
  assert.equal(closed.ok, false);
  assert.equal(!closed.ok && closed.retry, false);
  assert.match(!closed.ok ? closed.error : "", /^131047 Pasaron más de 24 h/);
  const down = await graphSend(cfg, {}, (async () => {
    throw new Error("network");
  }) as typeof fetch);
  assert.equal(!down.ok && down.retry, true);
});

test("processOutbox sends, rejects invalid numbers and expires old greetings", async () => {
  const rows = [
    row({ id: "ok" }),
    row({ id: "bad", to_phone: "2900 0000" }),
    row({
      id: "old",
      created_at: new Date(Date.now() - 49 * 3600e3).toISOString(),
    }),
  ];
  const completed: Record<string, unknown>[] = [];
  const db = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === "wa_claim_outbox") return { data: rows, error: null };
      completed.push(args);
      return { data: null, error: null };
    },
  };
  let calls = 0;
  const r = await processOutbox(db as never, cfg, 10, (async () => {
    calls++;
    return new Response(JSON.stringify({ messages: [{ id: "wamid.SENT" }] }), {
      status: 200,
    });
  }) as typeof fetch);
  assert.deepEqual(r, { claimed: 3, sent: 1, failed: 2 });
  assert.equal(calls, 1);
  assert.deepEqual(completed[0], {
    p_id: "ok",
    p_wa_id: "59899000001",
    p_wamid: "wamid.SENT",
    p_error: null,
    p_retry: false,
  });
  assert.equal(completed[1].p_wa_id, null);
  assert.equal(completed[1].p_retry, false);
  assert.match(String(completed[2].p_error), /vencido/);
});
