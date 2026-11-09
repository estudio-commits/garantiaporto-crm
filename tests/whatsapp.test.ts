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
  template: { name: "saludo_solicitud", language: "es_UY", params: ["Ana"] },
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
      language: { code: "es_UY" },
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

// ---- Etapa 2: Drive ----
import { generateKeyPairSync, createHash as hash } from "node:crypto";
import {
  folderIdFromUrl,
  ensureCaseFolder,
  uploadFile,
  type DriveConfig,
} from "../lib/drive";
import {
  caseFolderName,
  downloadMedia,
  mediaFileName,
  processMedia,
} from "../lib/whatsapp-server";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const drive: DriveConfig = {
  enabled: true,
  clientEmail: "crm-ficticio@proyecto-ficticio.iam.gserviceaccount.com",
  privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  parentFolderId: "PARENTFOLDER123",
};

type Call = { url: string; init?: RequestInit };
function fakeGoogle(handlers: ((c: Call) => Response | undefined)[]) {
  const calls: Call[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    const c = { url: String(url), init };
    calls.push(c);
    if (c.url === "https://oauth2.googleapis.com/token")
      return new Response(
        JSON.stringify({ access_token: "ya29.ficticio", expires_in: 3600 }),
        { status: 200 },
      );
    for (const h of handlers) {
      const r = h(c);
      if (r) return r;
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  return { f, calls };
}

test("Drive folder URL parsing and naming", () => {
  assert.equal(
    folderIdFromUrl(
      "https://drive.google.com/drive/folders/AbC_123-xyz?usp=sharing",
    ),
    "AbC_123-xyz",
  );
  assert.equal(
    folderIdFromUrl("https://drive.google.com/drive/u/1/folders/AbC_123-xyz"),
    "AbC_123-xyz",
  );
  assert.equal(folderIdFromUrl("https://evil.example/drive/folders/x"), null);
  assert.equal(
    caseFolderName({
      id: "a1b2c3d4-0000-4000-8000-000000000001",
      full_name: "Ana/Ficticia",
      national_id: "12345678",
    }),
    "Ana Ficticia · CI 1.234.567-8",
  );
  assert.equal(
    caseFolderName({
      id: "a1b2c3d4-0000-4000-8000-000000000001",
      full_name: "Bruno Ficticio",
      national_id: null,
    }),
    "Bruno Ficticio · Solicitud a1b2c3d4",
  );
  assert.equal(
    mediaFileName(
      "document",
      { id: "m", filename: "recibo:octubre.pdf" },
      "application/pdf",
      "2026-11-07T15:30:00Z",
    ),
    "2026-11-07 1230 WhatsApp - recibo octubre.pdf",
  );
});

test("ensureCaseFolder reuses a tagged folder and creates one in the parent otherwise", async () => {
  const found = fakeGoogle([
    (c) =>
      c.url.includes("/files?") && c.init?.method === "GET"
        ? new Response(JSON.stringify({ files: [{ id: "EXISTINGFOLDER1" }] }))
        : undefined,
  ]);
  assert.equal(
    await ensureCaseFolder(
      drive,
      "a1b2c3d4-0000-4000-8000-000000000001",
      "Caso",
      found.f,
    ),
    "EXISTINGFOLDER1",
  );
  const created = fakeGoogle([
    (c) =>
      c.init?.method === "GET"
        ? new Response(JSON.stringify({ files: [] }))
        : undefined,
    (c) =>
      c.init?.method === "POST" &&
      c.url.startsWith("https://www.googleapis.com/drive/v3/files")
        ? new Response(JSON.stringify({ id: "NEWFOLDER12345" }))
        : undefined,
  ]);
  assert.equal(
    await ensureCaseFolder(
      drive,
      "a1b2c3d4-0000-4000-8000-000000000001",
      "Caso ficticio",
      created.f,
    ),
    "NEWFOLDER12345",
  );
  const body = JSON.parse(
    String(
      created.calls.find(
        (c) => c.init?.method === "POST" && !c.url.includes("oauth2"),
      )!.init!.body,
    ),
  );
  assert.deepEqual(body.parents, ["PARENTFOLDER123"]);
  assert.equal(
    body.appProperties.crm_case,
    "a1b2c3d4-0000-4000-8000-000000000001",
  );
});

test("uploadFile sends multipart into the folder and returns the Drive link", async () => {
  const g = fakeGoogle([
    (c) =>
      c.url.startsWith("https://www.googleapis.com/upload/")
        ? new Response(
            JSON.stringify({
              id: "FILE1",
              webViewLink: "https://drive.google.com/file/d/FILE1/view",
            }),
          )
        : undefined,
  ]);
  const r = await uploadFile(
    drive,
    "FOLDER1234567",
    "doc.pdf",
    "application/pdf",
    Buffer.from("%PDF-1.4 ficticio"),
    g.f,
  );
  assert.deepEqual(r, {
    id: "FILE1",
    url: "https://drive.google.com/file/d/FILE1/view",
  });
  const up = g.calls.find((c) =>
    c.url.startsWith("https://www.googleapis.com/upload/"),
  )!;
  assert.match(
    String((up.init!.headers as Record<string, string>).authorization),
    /^Bearer ya29\.ficticio$/,
  );
  assert.match(
    Buffer.from(up.init!.body as Buffer).toString(),
    /"parents":\["FOLDER1234567"\][\s\S]*%PDF-1\.4 ficticio/,
  );
});

function fakeMeta(file: Buffer, meta: Record<string, unknown>) {
  return (async (url: string, init?: RequestInit) => {
    if (String(url) === "https://graph.example.test/v23.0/MEDIA1")
      return new Response(
        JSON.stringify({
          url: "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1",
          ...meta,
        }),
      );
    if (String(url).startsWith("https://lookaside.fbsbx.com/")) {
      assert.equal(
        (init?.headers as Record<string, string>).authorization,
        "Bearer token-ficticio",
      );
      return new Response(new Uint8Array(file));
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
}

test("downloadMedia validates type, size, host and checksum", async () => {
  const pdf = Buffer.from("%PDF-1.4 documento ficticio");
  const sha = hash("sha256").update(pdf).digest("hex");
  const ok = await downloadMedia(
    cfg,
    "MEDIA1",
    fakeMeta(pdf, {
      mime_type: "application/pdf",
      file_size: pdf.length,
      sha256: sha,
    }),
  );
  assert.equal(ok.ok, true);
  const exe = await downloadMedia(
    cfg,
    "MEDIA1",
    fakeMeta(pdf, { mime_type: "application/x-msdownload" }),
  );
  assert.equal(!exe.ok && exe.reject, true);
  const big = await downloadMedia(
    cfg,
    "MEDIA1",
    fakeMeta(pdf, {
      mime_type: "application/pdf",
      file_size: 30 * 1024 * 1024,
    }),
  );
  assert.equal(!big.ok && big.reject, true);
  const tampered = await downloadMedia(
    cfg,
    "MEDIA1",
    fakeMeta(pdf, { mime_type: "application/pdf", sha256: "0".repeat(64) }),
  );
  assert.equal(!tampered.ok && tampered.retry, true);
  const evilHost = await downloadMedia(cfg, "MEDIA1", (async (url: string) =>
    String(url).endsWith("/MEDIA1")
      ? new Response(
          JSON.stringify({
            url: "https://attacker.example/steal",
            mime_type: "application/pdf",
          }),
        )
      : new Response("should not be called", { status: 500 })) as typeof fetch);
  assert.equal(!evilHost.ok && evilHost.reject, true);
  assert.equal(
    (await downloadMedia(cfg, "../etc", fakeMeta(pdf, {}))).ok,
    false,
  );
});

test("processMedia files a document in a new case folder and records the link", async () => {
  const pdf = Buffer.from("%PDF-1.4 documento ficticio");
  const meta = fakeMeta(pdf, {
    mime_type: "application/pdf",
    file_size: pdf.length,
  });
  const google = fakeGoogle([
    (c) =>
      c.init?.method === "GET" &&
      c.url.startsWith("https://www.googleapis.com/drive/v3/files?")
        ? new Response(JSON.stringify({ files: [] }))
        : undefined,
    (c) =>
      c.init?.method === "POST" &&
      c.url.startsWith("https://www.googleapis.com/drive/v3/files?")
        ? new Response(JSON.stringify({ id: "NEWFOLDER12345" }))
        : undefined,
    (c) =>
      c.url.startsWith("https://www.googleapis.com/upload/")
        ? new Response(
            JSON.stringify({
              id: "FILE1",
              webViewLink: "https://drive.google.com/file/d/FILE1/view",
            }),
          )
        : undefined,
  ]);
  const fetcher = (async (url: string, init?: RequestInit) =>
    String(url).includes("googleapis.com")
      ? google.f(url, init)
      : meta(url, init)) as typeof fetch;
  const completed: Record<string, unknown>[] = [];
  const db = {
    rpc: (fn: string, args: Record<string, unknown>) => {
      if (fn === "wa_media_case")
        return {
          single: async () => ({
            data: {
              full_name: "Ana Ficticia",
              national_id: null,
              phone: "099000001",
              created_at: "2026-11-07T12:00:00Z",
              drive_folder_url: null,
            },
            error: null,
          }),
        };
      if (fn === "wa_claim_media")
        return Promise.resolve({
          data: [
            {
              id: "m1",
              application_id: "a1b2c3d4-0000-4000-8000-000000000001",
              kind: "document",
              media: { id: "MEDIA1", filename: "recibo.pdf" },
              created_at: "2026-11-07T15:30:00Z",
            },
          ],
          error: null,
        });
      completed.push(args);
      return Promise.resolve({ data: null, error: null });
    },
  };
  const r = await processMedia(db as never, cfg, drive, 5, fetcher);
  assert.deepEqual(r, { claimed: 1, stored: 1, failed: 0 });
  assert.deepEqual(completed[0], {
    p_id: "m1",
    p_status: "stored",
    p_file_id: "FILE1",
    p_file_url: "https://drive.google.com/file/d/FILE1/view",
    p_folder_url: "https://drive.google.com/drive/folders/NEWFOLDER12345",
    p_error: null,
    p_retry: false,
  });
});

test("processCaseFolders creates the case folder named with name and CI, or keeps an existing one", async () => {
  const { processCaseFolders } = await import("../lib/whatsapp-server");
  const google = fakeGoogle([
    (c) =>
      c.init?.method === "GET"
        ? new Response(JSON.stringify({ files: [] }))
        : undefined,
    (c) =>
      c.init?.method === "POST" &&
      c.url.startsWith("https://www.googleapis.com/drive/v3/files?")
        ? new Response(JSON.stringify({ id: "CASEFOLDER123" }))
        : undefined,
  ]);
  const completed: Record<string, unknown>[] = [];
  const db = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === "claim_case_folders")
        return {
          data: [
            {
              application_id: "a1b2c3d4-0000-4000-8000-000000000001",
              full_name: "Ana Ficticia",
              national_id: "12345678",
              drive_folder_url: null,
            },
            {
              application_id: "b1b2c3d4-0000-4000-8000-000000000002",
              full_name: "Con Carpeta",
              national_id: null,
              drive_folder_url:
                "https://drive.google.com/drive/folders/MANUAL123456",
            },
          ],
          error: null,
        };
      completed.push(args);
      return { data: null, error: null };
    },
  };
  const r = await processCaseFolders(db as never, drive, 5, google.f);
  assert.deepEqual(r, { claimed: 2, created: 2, failed: 0 });
  assert.equal(
    completed[0].p_folder_url,
    "https://drive.google.com/drive/folders/CASEFOLDER123",
  );
  assert.equal(
    completed[1].p_folder_url,
    "https://drive.google.com/drive/folders/MANUAL123456",
  );
  const create = google.calls.find(
    (c) =>
      c.init?.method === "POST" &&
      c.url.startsWith("https://www.googleapis.com/drive/v3/files?"),
  )!;
  assert.equal(
    JSON.parse(String(create.init!.body)).name,
    "Ana Ficticia · CI 1.234.567-8",
  );
});
