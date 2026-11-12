// Pasa las preguntas de prueba (docs/WHATSAPP-FAQ.md, sección 11) por el asistente real y escribe
// las respuestas en un informe para revisarlas. No toca la base ni envía WhatsApp: usa datos ficticios.
// Uso: ANTHROPIC_API_KEY=... npx tsx scripts/bot-eval.ts [salida.md]   (tiene costo de API)
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync } from "node:fs";
import { runBotTurn } from "../lib/bot";
import type { WaConfig } from "../lib/whatsapp-server";

type Row = Record<string, unknown>;
const cfg = { enabled: false } as WaConfig;

function fakeDb(body: string, kase: Row) {
  const outbox: string[] = [];
  const tools: string[] = [];
  const messages = [
    {
      direction: "in",
      author: "customer",
      kind: "text",
      body,
      media: null,
      media_status: null,
      created_at: new Date().toISOString(),
    },
  ];
  const data = (t: string) =>
    t === "wa_settings"
      ? {
          bot_enabled: true,
          bot_test_mode: false,
          bot_test_numbers: [],
          handoff_name: "Lucía Ussumorel",
          hours_start: "09:00:00",
          hours_end: "17:00:00",
          business_days: [1, 2, 3, 4, 5],
        }
      : t === "wa_conversations"
        ? {
            id: "c",
            wa_id: "59899000000",
            application_id: "a",
            bot_paused: false,
            bot_state: {},
            bot_turns: 0,
          }
        : t === "applications"
          ? {
              id: "a",
              full_name: "Contacto de WhatsApp",
              national_id: null,
              rent_amount: null,
              rent_currency: null,
              guarantee_type: "tradicional",
              source: "whatsapp",
              ...kase,
            }
          : null;
  const from = (t: string) => {
    const chain: Row = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      limit: async () => ({ data: messages, error: null }),
      single: async () => ({ data: data(t), error: null }),
      maybeSingle: async () => ({ data: null, error: null }),
      insert: async (r: Row) => {
        outbox.push(String(r.body));
        return { error: null };
      },
    };
    return chain;
  };
  const db = {
    from,
    rpc: async (name: string, args: Row) => {
      if (name === "wa_bot_claim") return { data: true, error: null };
      if (name === "wa_bot_handoff") tools.push(`derivación: ${args.p_reason}`);
      if (name === "wa_bot_update_case")
        tools.push(`CRM: ${JSON.stringify(args.f)}`);
      return { data: [], error: null };
    },
  };
  return { db: db as never, outbox, tools };
}

const doc = readFileSync("docs/WHATSAPP-FAQ.md", "utf8");
const section = doc.slice(doc.indexOf("## 11. "));
const cases = [
  ...section.matchAll(/^\| "(.+?)"(?: \+ foto)? \| (.+) \|$/gm),
].map((m) => ({ question: m[1].replace(/\\"/g, '"'), expected: m[2] }));
const client = new Anthropic();
const out = ["# Prueba del asistente — sección 11", ""];
for (const c of cases) {
  const kase = /universitari|estudiante/i.test(c.question)
    ? { guarantee_type: "universitaria" }
    : {};
  const { db, outbox, tools } = fakeDb(c.question, kase);
  const r = await runBotTurn(db, cfg, "c", client).catch((e) => ({
    error: String(e),
  }));
  out.push(
    `## ${c.question}`,
    "",
    `**Esperado:** ${c.expected}`,
    "",
    "**Respuesta:**",
    "",
    ...outbox.map((b) => `> ${b.replace(/\n/g, "\n> ")}`),
    "",
    ...(tools.length ? [`**Acciones:** ${tools.join(" · ")}`, ""] : []),
    ...("error" in r ? [`**Error:** ${r.error}`, ""] : []),
  );
  console.log(`✓ ${c.question}`);
}
const file = process.argv[2] || "bot-eval.md";
writeFileSync(file, out.join("\n"));
console.log(`Informe: ${file} (${cases.length} casos)`);
