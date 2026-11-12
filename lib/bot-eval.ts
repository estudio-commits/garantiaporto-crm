// "Probar asistente": pasa una pregunta de prueba por el asistente real con un caso ficticio en
// memoria. No escribe en la base ni envía WhatsApp: todo lo que el asistente haría queda registrado
// en el resultado. Server-only.
import type { SupabaseClient } from "@supabase/supabase-js";
import { runBotTurn, type BotClient } from "./bot";
import type { WaConfig } from "./whatsapp-server";

type Row = Record<string, unknown>;
export type EvalResult = {
  question: string;
  replies: string[];
  actions: string[];
  error?: string;
};

function memoryDb(question: string, kase: Row) {
  const replies: string[] = [];
  const actions: string[] = [];
  const messages = [
    {
      direction: "in",
      author: "customer",
      kind: "text",
      body: question,
      media: null,
      media_status: null,
      created_at: new Date().toISOString(),
    },
  ];
  const data = (t: string): Row | null =>
    t === "wa_settings"
      ? {
          bot_enabled: true,
          bot_test_mode: false,
          bot_test_numbers: [],
          handoff_name: "Lucía Ussumorel",
          hours_start: "00:00:00",
          hours_end: "23:59:00",
          business_days: [1, 2, 3, 4, 5, 6, 7],
        }
      : t === "wa_conversations"
        ? {
            id: "prueba",
            wa_id: "59899000000",
            application_id: "prueba",
            bot_paused: false,
            bot_state: {},
            bot_turns: 0,
          }
        : t === "applications"
          ? {
              id: "prueba",
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
        replies.push(String(r.body ?? ""));
        return { error: null };
      },
    };
    return chain;
  };
  const db = {
    from,
    rpc: async (name: string, args: Row) => {
      if (name === "wa_bot_claim") return { data: true, error: null };
      if (name === "wa_bot_handoff")
        actions.push(`Deriva a Lucía: ${String(args.p_reason)}`);
      if (name === "wa_bot_update_case")
        actions.push(`Guarda en la ficha: ${JSON.stringify(args.f)}`);
      return { data: [], error: null };
    },
  };
  return { db: db as unknown as SupabaseClient, replies, actions };
}

export async function runEvalCase(
  client: BotClient,
  question: string,
): Promise<EvalResult> {
  const kase = /universitari|estudiante/i.test(question)
    ? { guarantee_type: "universitaria" }
    : {};
  const { db, replies, actions } = memoryDb(question, kase);
  const cfg = { enabled: false } as WaConfig;
  await runBotTurn(db, cfg, "prueba", client);
  const error = actions.find((a) => a.includes("Error del asistente"));
  return { question, replies, actions, ...(error ? { error } : {}) };
}
