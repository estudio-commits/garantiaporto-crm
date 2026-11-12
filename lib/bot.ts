// Asistente automático de WhatsApp (etapa 3). Server-only.
// Reads the conversation, asks Claude for the next reply with three narrow tools, and queues the
// replies in wa_outbox. Every case change goes through wa_bot_update_case, which only fills
// allowed fields; formal decisions and Clearing are never exposed to or set by the model.
// Fixed steps (site buttons, web-form confirmation, rural) and every calculation run in code.
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AUTO_TAG,
  DOC_PROFILES,
  documentListMessage,
  handoffMessage,
  isGreetingButton,
  references,
  ruralMessage,
  siteButton,
  systemPrompt,
  webConfirmation,
  type DocProfile,
  type GuaranteeType,
} from "./bot-knowledge";
import { processOutbox, type WaConfig } from "./whatsapp-server";

export const BOT_MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
const MAX_BOT_TURNS = 40;
const MAX_TOOL_ROUNDS = 5;
const DAY_NAMES = [
  "domingo",
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábado",
];

type Settings = {
  bot_enabled: boolean;
  bot_test_mode: boolean;
  bot_test_numbers: string[];
  handoff_name: string;
  hours_start: string;
  hours_end: string;
  business_days: number[];
};
type Conversation = {
  id: string;
  wa_id: string;
  application_id: string | null;
  bot_paused: boolean;
  bot_state: Record<string, unknown>;
  bot_turns: number;
};
type Message = {
  direction: "in" | "out";
  author: string;
  kind: string;
  body: string;
  media: { filename?: string } | null;
  media_status: string | null;
  created_at: string;
};
type CaseRow = {
  id: string;
  full_name: string;
  national_id: string | null;
  rent_amount: number | null;
  rent_currency: string | null;
  guarantee_type: string;
  source: string;
  monthly_income?: number | null;
};

export type BotClient = Pick<Anthropic, "beta">;

// Uruguayan CI written with separators (1.234.567-8, 123.456-7, 1234567-8) or digits right after
// the word "cédula"/"CI". Bare 7-8 digit numbers alone are ignored: they may be phone numbers.
const CI_PATTERN =
  /\b(\d\.\d{3}\.\d{3}-\d|\d{3}\.\d{3}-\d|\d{6,7}-\d)\b|(?<=\b(?:c[ée]dula|ci|c\.i\.)\s*(?:es|:|n[°º]|nro\.?)?\s*)(\d{7,8})\b/gi;

export function extractCI(text: string): string | null {
  for (const m of text.matchAll(CI_PATTERN)) return (m[1] ?? m[2]) || null;
  return null;
}
export const maskCI = (text: string) => text.replace(CI_PATTERN, "[cédula]");

export function inBusinessHours(
  s: Pick<Settings, "hours_start" | "hours_end" | "business_days">,
  now = new Date(),
) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/Montevideo",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
    parts.weekday,
  );
  const hm = `${parts.hour}:${parts.minute}`;
  return (
    s.business_days.includes(day === 0 ? 7 : day) &&
    hm >= s.hours_start.slice(0, 5) &&
    hm < s.hours_end.slice(0, 5)
  );
}

export function daysLabel(days: number[]) {
  const sorted = [...days].sort();
  const name = (d: number) => DAY_NAMES[d % 7];
  const consecutive = sorted.every(
    (d, i) => i === 0 || d === sorted[i - 1] + 1,
  );
  if (sorted.length > 2 && consecutive)
    return `${name(sorted[0])} a ${name(sorted[sorted.length - 1])}`;
  return sorted.map(name).join(", ");
}

const PROFILE_KEYS = Object.keys(DOC_PROFILES) as DocProfile[];

export const BOT_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "actualizar_datos_del_caso",
    description:
      "Guarda en el CRM datos que el cliente dio explícitamente en la conversación. Usá null para lo que no sepas. No inventes ni deduzcas datos.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: [
        "nombre_completo",
        "monto_alquiler",
        "moneda",
        "tipo_garantia",
        "situacion_ingresos",
        "ingresos_liquidos_titular",
        "cantidad_estudiantes",
      ],
      properties: {
        nombre_completo: {
          type: ["string", "null"],
          description: "Nombre y apellido tal como los dio el cliente.",
        },
        monto_alquiler: {
          type: ["number", "null"],
          description: "Monto mensual del alquiler, solo el número.",
        },
        moneda: {
          type: ["string", "null"],
          enum: ["UYU", "USD", null],
          description: "UYU para pesos, USD para dólares.",
        },
        tipo_garantia: {
          type: ["string", "null"],
          enum: ["tradicional", "universitaria", "rural", null],
        },
        situacion_ingresos: {
          type: ["string", "null"],
          enum: [...PROFILE_KEYS, null],
        },
        ingresos_liquidos_titular: {
          type: ["number", "null"],
          description:
            "Ingresos líquidos mensuales del titular, en pesos. No la suma con cogarantes.",
        },
        cantidad_estudiantes: {
          type: ["integer", "null"],
          description:
            "Garantía universitaria: cuántos estudiantes se presentan.",
        },
      },
    },
  },
  {
    name: "enviar_lista_de_documentos",
    description:
      "Envía al cliente la lista oficial de documentos para una forma de cobro (o la de estudiantes para la universitaria). Usala en lugar de escribir la lista.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["situacion_ingresos"],
      properties: {
        situacion_ingresos: { type: "string", enum: PROFILE_KEYS },
      },
    },
  },
  {
    name: "calcular_referencias",
    description:
      "Hace las cuentas aprobadas: costo aproximado (70% del alquiler), referencia del 30% de ingresos en tradicional y topes de universitaria. Guarda el alquiler en el CRM. Usala siempre que tengas que dar un número.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: [
        "modalidad",
        "monto_alquiler",
        "moneda",
        "ingresos_liquidos_totales",
        "cantidad_estudiantes",
      ],
      properties: {
        modalidad: {
          type: "string",
          enum: ["tradicional", "universitaria", "rural"],
        },
        monto_alquiler: {
          type: "number",
          description: "Alquiler mensual que dio el cliente.",
        },
        moneda: { type: "string", enum: ["UYU", "USD"] },
        ingresos_liquidos_totales: {
          type: ["number", "null"],
          description:
            "Tradicional: ingresos líquidos mensuales sumados de quienes presentan ingresos, en la misma moneda que el alquiler. Null si no se saben.",
        },
        cantidad_estudiantes: {
          type: ["integer", "null"],
          description:
            "Universitaria: cantidad de estudiantes. Null si no se sabe.",
        },
      },
    },
  },
  {
    name: "derivar_a_persona",
    description:
      "Pasa la conversación a la persona del equipo. El sistema avisa al cliente con el horario de atención. Después de usarla no escribas nada más.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["motivo"],
      properties: {
        motivo: { type: "string", description: "Motivo breve para el equipo." },
      },
    },
  },
];

/** Turns stored WhatsApp messages into alternating Claude turns (first turn is always the customer). */
export function transcript(
  messages: Message[],
  handoffName: string,
): Anthropic.Beta.BetaMessageParam[] {
  const out: Anthropic.Beta.BetaMessageParam[] = [];
  for (const m of messages) {
    // Long messages are cut to keep each request small and the cost predictable.
    let text = (m.body?.trim() || "").slice(0, 1500);
    if (m.kind === "template")
      text = `[Se envió el mensaje automático de saludo de Garantía Porto]`;
    else if (m.media)
      text = `[El cliente envió un archivo: ${m.media.filename || text || "adjunto"}${m.media_status === "stored" ? ", guardado en su carpeta" : ""}]`;
    // The CI never reaches the model, whoever wrote it (the web-form confirmation includes it).
    else text = maskCI(text);
    if (!text) continue;
    if (m.direction === "out" && m.author === "human")
      text = `[${handoffName} escribió]: ${text}`;
    const role = m.direction === "in" ? "user" : "assistant";
    const last = out[out.length - 1];
    if (last && last.role === role) last.content = `${last.content}\n${text}`;
    else out.push({ role, content: text });
  }
  if (out[0]?.role === "assistant")
    out.unshift({ role: "user", content: "[Inicio de la conversación]" });
  return out;
}

export function caseContext(
  c: CaseRow,
  conv: Conversation,
  inHours: boolean,
  introduced: boolean,
) {
  const st = conv.bot_state as {
    income_profile?: string;
    documents_sent_for?: string;
    students?: number;
    site_button?: string;
  };
  return [
    "Contexto actual del caso (para vos, no lo copies textualmente):",
    `- Origen: ${c.source === "whatsapp" ? "consulta que llegó directo por WhatsApp" : "solicitud del formulario web"}.`,
    `- Nombre registrado: ${c.full_name}.`,
    `- Cédula: ${c.national_id ? "registrada" : "no registrada"}.`,
    `- Alquiler: ${c.rent_amount ? `${c.rent_amount} ${c.rent_currency ?? ""}`.trim() : "sin dato"}.`,
    `- Tipo de garantía registrado: ${c.guarantee_type}.`,
    `- Ingresos líquidos del titular registrados: ${c.monthly_income ? `$ ${c.monthly_income}` : "sin dato"}.`,
    `- Situación de ingresos: ${st.income_profile ?? "sin dato"}.`,
    ...(st.students ? [`- Cantidad de estudiantes: ${st.students}.`] : []),
    ...(st.site_button
      ? [
          `- Llegó por el botón de WhatsApp del sitio: ${st.site_button === "general" ? "botón general (sin tipo de garantía)" : `garantía ${st.site_button}`}.`,
        ]
      : []),
    `- Lista de documentos ya enviada: ${st.documents_sent_for ?? "no"}.`,
    `- ¿Ya respondiste antes en esta conversación?: ${introduced ? "sí" : "no (es tu primer mensaje: empezá con el saludo de la base de conocimiento)"}.`,
    `- Ahora estamos ${inHours ? "dentro" : "fuera"} del horario de atención humana.`,
  ].join("\n");
}

const supportsFallbacks = (model: string) =>
  /^claude-(opus-5|sonnet-5-5|fable-5)/.test(model);

export type BotResult = {
  ran: boolean;
  sent: number;
  handedOff: boolean;
  reason?: string;
};

/** Runs one assistant turn for a conversation if it is active and has an unanswered customer message. */
export async function runBotTurn(
  db: SupabaseClient,
  cfg: WaConfig,
  conversationId: string,
  client: BotClient | null = process.env.ANTHROPIC_API_KEY
    ? new Anthropic()
    : null,
  fetcher: typeof fetch = fetch,
): Promise<BotResult> {
  if (!client)
    return {
      ran: false,
      sent: 0,
      handedOff: false,
      reason: "sin clave de Anthropic",
    };
  const claim = await db.rpc("wa_bot_claim", {
    p_conversation: conversationId,
  });
  if (claim.error || !claim.data)
    return { ran: false, sent: 0, handedOff: false, reason: "en curso" };
  let state: Record<string, unknown> = {},
    turn = false,
    sent = 0,
    handedOff = false;
  try {
    const [{ data: s }, { data: conv }] = await Promise.all([
      db.from("wa_settings").select("*").eq("id", 1).single(),
      db.from("wa_conversations").select("*").eq("id", conversationId).single(),
    ]);
    const settings = s as Settings | null,
      c = conv as Conversation | null;
    if (!settings || !c?.application_id)
      return { ran: false, sent, handedOff, reason: "sin datos" };
    const active =
      settings.bot_enabled &&
      !c.bot_paused &&
      (!settings.bot_test_mode || settings.bot_test_numbers.includes(c.wa_id));
    if (!active) return { ran: false, sent, handedOff, reason: "inactivo" };
    const { data: rows } = await db
      .from("wa_messages")
      .select("direction,author,kind,body,media,media_status,created_at")
      .eq("conversation_id", c.id)
      .order("created_at", { ascending: false })
      .limit(30);
    const history = ((rows ?? []) as Message[]).reverse();
    if (!history.length || history[history.length - 1].direction !== "in")
      return { ran: false, sent, handedOff, reason: "sin mensajes nuevos" };

    const lastBot = [...history]
      .reverse()
      .find((m) => m.direction === "out" && m.author === "bot");
    // The first assistant message of each conversation says it is automatic.
    let tagPending = !lastBot;
    const enqueue = async (text: string) => {
      const body = tagPending ? `${text}\n\n${AUTO_TAG}` : text;
      tagPending = false;
      const r = await db.from("wa_outbox").insert({
        application_id: c.application_id,
        purpose: "bot",
        to_phone: `+${c.wa_id}`,
        kind: "text",
        body: body.slice(0, 4096),
      });
      if (r.error) throw Error(r.error.message);
      sent++;
    };
    const inHours = inBusinessHours(settings);
    const days = daysLabel(settings.business_days);
    const from = settings.hours_start.slice(0, 5),
      to = settings.hours_end.slice(0, 5);
    const handoff = async (reason: string) => {
      await db.rpc("wa_bot_handoff", {
        p_conversation: c.id,
        p_reason: reason,
      });
      await enqueue(
        handoffMessage(settings.handoff_name, inHours, days, from, to),
      );
      handedOff = true;
    };

    let skipModel = false;
    if (c.bot_turns >= MAX_BOT_TURNS) {
      await handoff(
        "La conversación superó el límite de respuestas automáticas.",
      );
      skipModel = true;
    }

    // The CI is captured by the server from the customer's own text and never sent to the model.
    for (const m of history)
      if (
        m.direction === "in" &&
        m.kind === "text" &&
        (!lastBot || m.created_at > lastBot.created_at)
      ) {
        const ci = extractCI(m.body);
        if (ci)
          await db.rpc("wa_bot_update_case", {
            p_application: c.application_id,
            f: { national_id: ci },
          });
      }
    const [{ data: row }, { data: sensitive }] = await Promise.all([
      db
        .from("applications")
        .select(
          "id,full_name,national_id,rent_amount,rent_currency,guarantee_type,source",
        )
        .eq("id", c.application_id)
        .single(),
      db
        .from("application_sensitive")
        .select("monthly_income")
        .eq("application_id", c.application_id)
        .maybeSingle(),
    ]);
    if (!row)
      return { ran: false, sent, handedOff, reason: "caso no encontrado" };
    const kase: CaseRow = {
      ...(row as CaseRow),
      monthly_income:
        sensitive?.monthly_income == null
          ? null
          : Number(sensitive.monthly_income),
    };
    state = { ...c.bot_state };

    // Fixed first steps, before any model call (docs/WHATSAPP-FAQ.md, sections 2.1 and 2.2).
    if (!lastBot && !skipModel) {
      const inbound = history.filter((m) => m.direction === "in");
      const last = inbound[inbound.length - 1];
      const button = inbound
        .map((m) => siteButton(m.body || ""))
        .find((b) => b !== null);
      if (button) {
        state = { ...state, site_button: button };
        if (button !== "general") {
          await db.rpc("wa_bot_update_case", {
            p_application: c.application_id,
            f: { guarantee_type: button },
          });
          kase.guarantee_type =
            kase.source === "whatsapp" ? button : kase.guarantee_type;
        }
        if (button === "rural") {
          await enqueue(ruralMessage(settings.handoff_name));
          await db.rpc("wa_bot_handoff", {
            p_conversation: c.id,
            p_reason: "Garantía rural: derivación directa.",
          });
          handedOff = true;
          turn = true;
          skipModel = true;
        }
      }
      if (kase.source === "web" && last && isGreetingButton(last.body || "")) {
        const text = webConfirmation({
          ...kase,
          monthly_income: kase.monthly_income ?? null,
        });
        if (text) {
          await enqueue(text);
          turn = true;
          skipModel = true;
        }
      }
    }

    const messages: Anthropic.Beta.BetaMessageParam[] = [
      ...transcript(history, settings.handoff_name),
      // Mid-conversation system message: keeps the cached system prompt and tools untouched.
      {
        role: "system",
        content: caseContext(
          kase,
          { ...c, bot_state: state },
          inHours,
          !!lastBot,
        ),
      },
    ];
    const system = systemPrompt(settings.handoff_name, days, from, to);
    if (!skipModel) turn = true;
    for (
      let round = 0;
      round < MAX_TOOL_ROUNDS && !handedOff && !skipModel;
      round++
    ) {
      const response = await client.beta.messages.create({
        model: BOT_MODEL,
        max_tokens: 4000,
        output_config: { effort: "low" },
        system: [
          { type: "text", text: system, cache_control: { type: "ephemeral" } },
        ],
        tools: BOT_TOOLS,
        messages,
        ...(supportsFallbacks(BOT_MODEL)
          ? {
              betas: ["server-side-fallback-2026-07-01"],
              fallbacks: "default" as const,
            }
          : {}),
      });
      if (response.stop_reason === "refusal") {
        await handoff("El asistente no pudo responder este mensaje.");
        break;
      }
      for (const block of response.content)
        if (block.type === "text" && block.text.trim())
          await enqueue(block.text.trim());
      const uses = response.content.filter(
        (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use",
      );
      if (response.stop_reason !== "tool_use" || !uses.length) break;
      messages.push({
        role: "assistant",
        content: response.content as Anthropic.Beta.BetaContentBlockParam[],
      });
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const use of uses) {
        const input = use.input as Record<string, unknown>;
        let result: string;
        try {
          if (use.name === "actualizar_datos_del_caso") {
            const changed = await db.rpc("wa_bot_update_case", {
              p_application: c.application_id,
              f: {
                full_name: input.nombre_completo ?? null,
                rent_amount: input.monto_alquiler ?? null,
                rent_currency: input.moneda ?? null,
                guarantee_type: input.tipo_garantia ?? null,
                monthly_income: input.ingresos_liquidos_titular ?? null,
              },
            });
            if (changed.error) throw Error(changed.error.message);
            if (
              typeof input.situacion_ingresos === "string" &&
              input.situacion_ingresos in DOC_PROFILES
            )
              state = { ...state, income_profile: input.situacion_ingresos };
            if (
              Number.isInteger(input.cantidad_estudiantes) &&
              Number(input.cantidad_estudiantes) > 0 &&
              Number(input.cantidad_estudiantes) < 50
            )
              state = { ...state, students: input.cantidad_estudiantes };
            result = `Guardado. Campos actualizados en el CRM: ${JSON.stringify(changed.data)}.`;
          } else if (use.name === "enviar_lista_de_documentos") {
            const p = String(input.situacion_ingresos) as DocProfile;
            if (!(p in DOC_PROFILES))
              throw Error("Situación de ingresos desconocida");
            await enqueue(documentListMessage(p));
            state = { ...state, income_profile: p, documents_sent_for: p };
            result = "Lista enviada al cliente. No la repitas.";
          } else if (use.name === "calcular_referencias") {
            const rent = Number(input.monto_alquiler);
            const currency = input.moneda === "USD" ? "USD" : "UYU";
            result = references({
              modalidad: String(input.modalidad) as GuaranteeType,
              monto_alquiler: rent,
              moneda: currency,
              ingresos_liquidos_totales:
                input.ingresos_liquidos_totales == null
                  ? null
                  : Number(input.ingresos_liquidos_totales),
              cantidad_estudiantes:
                input.cantidad_estudiantes == null
                  ? null
                  : Number(input.cantidad_estudiantes),
            });
            await db.rpc("wa_bot_update_case", {
              p_application: c.application_id,
              f: { rent_amount: rent, rent_currency: currency },
            });
          } else if (use.name === "derivar_a_persona") {
            await handoff(
              String(input.motivo || "Derivación solicitada por el asistente"),
            );
            result = "Derivado. No escribas nada más.";
          } else throw Error("Herramienta desconocida");
        } catch (e) {
          result = `Error: ${e instanceof Error ? e.message : "no se pudo completar"}`;
          results.push({
            type: "tool_result",
            tool_use_id: use.id,
            content: result,
            is_error: true,
          });
          continue;
        }
        results.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: result,
        });
      }
      messages.push({ role: "user", content: results });
    }
  } catch (e) {
    // The model or a dependency failed after retries: hand the chat to a person instead of going silent.
    const reason =
      e instanceof Anthropic.APIError
        ? `Error del asistente (HTTP ${e.status}).`
        : "Error del asistente.";
    await db.rpc("wa_bot_handoff", {
      p_conversation: conversationId,
      p_reason: reason,
    });
    handedOff = true;
  } finally {
    await db.rpc("wa_bot_release", {
      p_conversation: conversationId,
      p_state: state,
      p_turn: turn,
    });
  }
  if (sent) await processOutbox(db, cfg, 10, fetcher).catch(() => undefined);
  return { ran: turn, sent, handedOff };
}
