import test from "node:test";
import assert from "node:assert/strict";
import {
  BOT_TOOLS,
  daysLabel,
  extractCI,
  inBusinessHours,
  maskCI,
  runBotTurn,
  transcript,
  type BotClient,
} from "../lib/bot";
import {
  documentListMessage,
  handoffMessage,
  systemPrompt,
} from "../lib/bot-knowledge";
import type { WaConfig } from "../lib/whatsapp-server";

const cfg: WaConfig = {
  enabled: true,
  apiBase: "https://graph.example.test/v23.0",
  token: "token-ficticio",
  phoneNumberId: "111111",
  appSecret: "app-secret-ficticio-1234",
  verifyToken: "verify-token-ficticio",
};

test("CI is detected only in explicit formats and masked before reaching the model", () => {
  assert.equal(extractCI("mi cédula es 1.234.567-8"), "1.234.567-8");
  assert.equal(extractCI("CI: 12345678"), "12345678");
  assert.equal(extractCI("123.456-7"), "123.456-7");
  assert.equal(extractCI("mi celular es 099123456 y pago 25000"), null);
  assert.equal(
    maskCI("Soy Ana, cédula 1.234.567-8, alquiler 25000"),
    "Soy Ana, cédula [cédula], alquiler 25000",
  );
});

test("business hours follow Montevideo time and configured days", () => {
  const s = {
    hours_start: "09:00:00",
    hours_end: "17:00:00",
    business_days: [1, 2, 3, 4, 5],
  };
  assert.equal(inBusinessHours(s, new Date("2026-11-09T13:00:00Z")), true); // lunes 10:00 UY
  assert.equal(inBusinessHours(s, new Date("2026-11-09T20:30:00Z")), false); // lunes 17:30 UY
  assert.equal(inBusinessHours(s, new Date("2026-11-08T13:00:00Z")), false); // domingo
  assert.equal(daysLabel([1, 2, 3, 4, 5]), "lunes a viernes");
});

test("approved texts: document list and handoff messages", () => {
  const list = documentListMessage("empleado");
  assert.match(list, /^\*Documentos para empleado:\*/);
  assert.match(list, /últimos 3 si tus ingresos son fijos/);
  assert.equal(
    handoffMessage(
      "Lucía Ussumorel",
      false,
      "lunes a viernes",
      "09:00",
      "17:00",
    ),
    "Nuestro horario de atención es de 09:00 a 17:00, de lunes a viernes. Lucía se pondrá en contacto contigo cuanto antes.",
  );
  assert.match(
    handoffMessage("Lucía Ussumorel", true, "", "", ""),
    /^Te comunico con Lucía Ussumorel/,
  );
  const sys = systemPrompt(
    "Lucía Ussumorel",
    "lunes a viernes",
    "09:00",
    "17:00",
  );
  assert.match(sys, /Nunca digas que una garantía está aprobada/);
  assert.match(sys, /aproximadamente un 70% del importe del alquiler/);
  assert.match(sys, /garantía rural: derivá enseguida/);
});

test("tools are strict and schema-closed", () => {
  for (const t of BOT_TOOLS) {
    assert.equal(t.strict, true);
    assert.equal(
      (t.input_schema as unknown as { additionalProperties: boolean })
        .additionalProperties,
      false,
    );
  }
});

test("transcript alternates roles, starts with the customer and labels team messages", () => {
  const msgs = transcript(
    [
      {
        direction: "out",
        author: "system",
        kind: "template",
        body: "Plantilla: saludo_solicitud",
        media: null,
        media_status: null,
        created_at: "1",
      },
      {
        direction: "in",
        author: "customer",
        kind: "button",
        body: "Sí, enviame la lista",
        media: null,
        media_status: null,
        created_at: "2",
      },
      {
        direction: "in",
        author: "customer",
        kind: "text",
        body: "mi ci es 1.234.567-8",
        media: null,
        media_status: null,
        created_at: "3",
      },
      {
        direction: "out",
        author: "human",
        kind: "text",
        body: "Hola, soy Lucía",
        media: null,
        media_status: null,
        created_at: "4",
      },
      {
        direction: "in",
        author: "customer",
        kind: "document",
        body: "recibo.pdf",
        media: { filename: "recibo.pdf" },
        media_status: "stored",
        created_at: "5",
      },
    ],
    "Lucía Ussumorel",
  );
  assert.deepEqual(
    msgs.map((m) => m.role),
    ["user", "assistant", "user", "assistant", "user"],
  );
  assert.equal(msgs[2].content, "Sí, enviame la lista\nmi ci es [cédula]");
  assert.equal(msgs[3].content, "[Lucía Ussumorel escribió]: Hola, soy Lucía");
  assert.match(String(msgs[4].content), /recibo\.pdf, guardado en su carpeta/);
});

// ---- runBotTurn with a fake database and a fake Claude client ----

type Row = Record<string, unknown>;
function fakeDb(
  opts: {
    settings?: Row;
    conversation?: Row;
    messages?: Row[];
    kase?: Row;
  } = {},
) {
  const calls: { rpc: [string, Row][]; outbox: Row[] } = {
    rpc: [],
    outbox: [],
  };
  const settings = {
    bot_enabled: true,
    bot_test_mode: true,
    bot_test_numbers: ["59899000001"],
    handoff_name: "Lucía Ussumorel",
    hours_start: "09:00:00",
    hours_end: "17:00:00",
    business_days: [1, 2, 3, 4, 5, 6, 7],
    ...opts.settings,
  };
  const conversation = {
    id: "conv-1",
    wa_id: "59899000001",
    application_id: "app-1",
    bot_paused: false,
    bot_state: {},
    bot_turns: 0,
    ...opts.conversation,
  };
  const messages = opts.messages ?? [
    {
      direction: "in",
      author: "customer",
      kind: "text",
      body: "Hola, quiero la garantía. Soy empleado.",
      media: null,
      media_status: null,
      created_at: "2026-11-09T13:00:00Z",
    },
  ];
  const kase = {
    id: "app-1",
    full_name: "Ana Ficticia",
    national_id: null,
    rent_amount: null,
    rent_currency: null,
    guarantee_type: "tradicional",
    source: "web",
    ...opts.kase,
  };
  const query = (table: string) => {
    const result = () =>
      table === "wa_settings"
        ? settings
        : table === "wa_conversations"
          ? conversation
          : table === "applications"
            ? kase
            : null;
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      limit: async () => ({ data: [...messages].reverse(), error: null }),
      single: async () => ({ data: result(), error: null }),
      insert: async (row: Row) => {
        calls.outbox.push(row);
        return { error: null };
      },
    };
    return chain;
  };
  const db = {
    from: query,
    rpc: async (name: string, args: Row) => {
      calls.rpc.push([name, args]);
      if (name === "wa_bot_claim") return { data: true, error: null };
      if (name === "wa_claim_outbox") return { data: [], error: null };
      if (name === "wa_bot_update_case")
        return { data: ["rent_amount"], error: null };
      return { data: null, error: null };
    },
  };
  return { db: db as never, calls };
}

function fakeClient(responses: Row[]) {
  const requests: Row[] = [];
  const client = {
    beta: {
      messages: {
        create: async (req: Row) => {
          requests.push(structuredClone(req));
          const r = responses.shift();
          if (!r) throw new Error("no more fake responses");
          if (r.throw) throw r.throw;
          return r;
        },
      },
    },
  } as unknown as BotClient;
  return { client, requests };
}

const text = (t: string) => ({ type: "text", text: t });
const toolUse = (name: string, input: Row, id = "tu_1") => ({
  type: "tool_use",
  id,
  name,
  input,
});

test("assistant sends the official document list, records the profile and replies", async () => {
  const { db, calls } = fakeDb();
  const { client, requests } = fakeClient([
    {
      stop_reason: "tool_use",
      content: [
        text("¡Hola! Soy el asistente automático de Garantía Porto."),
        toolUse("enviar_lista_de_documentos", {
          situacion_ingresos: "empleado",
        }),
      ],
    },
    {
      stop_reason: "end_turn",
      content: [text("Cuando los tengas, mandalos por acá.")],
    },
  ]);
  const r = await runBotTurn(db, cfg, "conv-1", client);
  assert.deepEqual(r, { ran: true, sent: 3, handedOff: false });
  assert.deepEqual(
    calls.outbox.map((o) => o.purpose),
    ["bot", "bot", "bot"],
  );
  assert.match(String(calls.outbox[1].body), /^\*Documentos para empleado:\*/);
  const release = calls.rpc.find(([n]) => n === "wa_bot_release")!;
  assert.deepEqual(release[1].p_state, {
    income_profile: "empleado",
    documents_sent_for: "empleado",
  });
  const req = requests[0] as {
    model: string;
    output_config: Row;
    fallbacks: string;
    betas: string[];
    system: Row[];
    messages: { role: string; content: unknown }[];
  };
  assert.equal(req.model, "claude-opus-5-5");
  assert.deepEqual(req.output_config, { effort: "low" });
  assert.equal(req.fallbacks, "default");
  assert.deepEqual(req.betas, ["server-side-fallback-2026-07-01"]);
  assert.deepEqual(req.system[0].cache_control, { type: "ephemeral" });
  assert.equal(req.messages.at(-1)!.role, "system");
  // The second request carries the tool result after the assistant turn.
  const second = requests[1] as {
    messages: { role: string; content: unknown }[];
  };
  assert.equal(second.messages.at(-1)!.role, "user");
});

test("CI typed by the customer is stored by the server and never sent to the model", async () => {
  const { db, calls } = fakeDb({
    messages: [
      {
        direction: "in",
        author: "customer",
        kind: "text",
        body: "Mi cédula es 1.234.567-8",
        media: null,
        media_status: null,
        created_at: "2026-11-09T13:00:00Z",
      },
    ],
  });
  const { client, requests } = fakeClient([
    { stop_reason: "end_turn", content: [text("¡Gracias! Ya la registré.")] },
  ]);
  await runBotTurn(db, cfg, "conv-1", client);
  assert.ok(
    calls.rpc.some(
      ([n, a]) =>
        n === "wa_bot_update_case" &&
        (a.f as Row).national_id === "1.234.567-8",
    ),
  );
  assert.doesNotMatch(JSON.stringify(requests[0]), /1\.234\.567-8/);
});

test("handoff pauses the bot, sends the approved notice and stops writing", async () => {
  const { db, calls } = fakeDb({ settings: { business_days: [] } });
  const { client, requests } = fakeClient([
    {
      stop_reason: "tool_use",
      content: [
        toolUse("derivar_a_persona", { motivo: "Pide hablar con una persona" }),
      ],
    },
  ]);
  const r = await runBotTurn(db, cfg, "conv-1", client);
  assert.equal(r.handedOff, true);
  assert.equal(requests.length, 1);
  assert.ok(
    calls.rpc.some(
      ([n, a]) =>
        n === "wa_bot_handoff" && a.p_reason === "Pide hablar con una persona",
    ),
  );
  assert.match(
    String(calls.outbox.at(-1)!.body),
    /^Nuestro horario de atención/,
  );
});

test("refusals and API errors hand the conversation to a person", async () => {
  const refused = fakeDb();
  const r1 = await runBotTurn(
    refused.db,
    cfg,
    "conv-1",
    fakeClient([{ stop_reason: "refusal", content: [] }]).client,
  );
  assert.equal(r1.handedOff, true);
  const failing = fakeDb();
  const r2 = await runBotTurn(
    failing.db,
    cfg,
    "conv-1",
    fakeClient([{ throw: new Error("boom") }]).client,
  );
  assert.equal(r2.handedOff, true);
  assert.ok(failing.calls.rpc.some(([n]) => n === "wa_bot_handoff"));
  assert.ok(failing.calls.rpc.some(([n]) => n === "wa_bot_release"));
});

test("does not answer when inactive, paused, outside the test list or without a new customer message", async () => {
  const cases: [Parameters<typeof fakeDb>[0], string][] = [
    [{ settings: { bot_enabled: false } }, "inactivo"],
    [{ conversation: { bot_paused: true } }, "inactivo"],
    [{ conversation: { wa_id: "59899000999" } }, "inactivo"],
    [
      {
        messages: [
          {
            direction: "out",
            author: "bot",
            kind: "text",
            body: "Hola",
            media: null,
            media_status: null,
            created_at: "1",
          },
        ],
      },
      "sin mensajes nuevos",
    ],
  ];
  for (const [opts, reason] of cases) {
    const { db, calls } = fakeDb(opts);
    const { client, requests } = fakeClient([]);
    const r = await runBotTurn(db, cfg, "conv-1", client);
    assert.equal(r.ran, false);
    assert.equal(r.reason, reason);
    assert.equal(requests.length, 0);
    assert.equal(calls.outbox.length, 0);
  }
  const { db } = fakeDb();
  assert.equal(
    (await runBotTurn(db, cfg, "conv-1", null)).reason,
    "sin clave de Anthropic",
  );
});

test("very long customer messages are truncated before reaching the model", () => {
  const msgs = transcript(
    [
      {
        direction: "in",
        author: "customer",
        kind: "text",
        body: "a".repeat(5000),
        media: null,
        media_status: null,
        created_at: "1",
      },
    ],
    "Lucía",
  );
  assert.equal(String(msgs[0].content).length, 1500);
});

test("cost estimate is computed by the server, not by the model", async () => {
  const { estimateCost } = await import("../lib/bot-knowledge");
  assert.equal(estimateCost(25000, "UYU"), "$ 17.500");
  assert.equal(estimateCost(1000, "USD"), "US$ 700");
  const { db, calls } = fakeDb();
  const { client, requests } = fakeClient([
    {
      stop_reason: "tool_use",
      content: [
        toolUse("estimar_costo", { monto_alquiler: 25000, moneda: "UYU" }),
      ],
    },
    {
      stop_reason: "end_turn",
      content: [text("Sería aproximadamente $ 17.500.")],
    },
  ]);
  await runBotTurn(db, cfg, "conv-1", client);
  assert.ok(
    calls.rpc.some(
      ([n, a]) =>
        n === "wa_bot_update_case" && (a.f as Row).rent_amount === 25000,
    ),
  );
  const toolResult = JSON.stringify(
    (requests[1] as { messages: unknown[] }).messages.at(-1),
  );
  assert.match(toolResult, /Costo aproximado: \$ 17\.500/);
});
