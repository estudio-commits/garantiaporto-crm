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
  documentsMessage,
  handoffHoursNote,
  rentCurrency,
  handoffMessage,
  isGreetingButton,
  costMessage,
  evaluateRent,
  ruralMessage,
  siteButton,
  systemPrompt,
  webConfirmation,
  type DocProfile,
  type GuaranteeType,
} from "./bot-knowledge";
import { processOutbox, type WaConfig } from "./whatsapp-server";
import { approvedLessons, lessonsPrompt } from "./bot-learning";

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
  student_count?: number | null;
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

const MISSING_CURRENCY =
  "Falta la moneda: el alquiler es menor a 5.000, así que preguntale al cliente si es en pesos o en dólares.";
const PROFILE_KEYS = Object.keys(DOC_PROFILES) as DocProfile[];

// Strict tool schemas reject `enum` next to a type list such as ["string", "null"]: an optional
// choice is written as anyOf(string enum, null).
const nullableEnum = (values: readonly string[], description?: string) => ({
  anyOf: [{ type: "string", enum: [...values] }, { type: "null" }],
  ...(description ? { description } : {}),
});

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
          anyOf: [{ type: "string" }, { type: "null" }],
          description: "Nombre y apellido tal como los dio el cliente.",
        },
        monto_alquiler: {
          anyOf: [{ type: "number" }, { type: "null" }],
          description: "Monto mensual del alquiler, solo el número.",
        },
        moneda: nullableEnum(
          ["UYU", "USD"],
          "UYU para pesos, USD para dólares. Null si el cliente no la dijo: el sistema la deduce del monto.",
        ),
        tipo_garantia: nullableEnum(["tradicional", "universitaria", "rural"]),
        situacion_ingresos: nullableEnum(PROFILE_KEYS),
        ingresos_liquidos_titular: {
          anyOf: [{ type: "number" }, { type: "null" }],
          description:
            "Ingresos líquidos mensuales del titular, en pesos. No la suma con cogarantes.",
        },
        cantidad_estudiantes: {
          anyOf: [{ type: "integer" }, { type: "null" }],
          description:
            "Garantía universitaria: cuántos estudiantes se presentan.",
        },
      },
    },
  },
  {
    name: "enviar_lista_de_documentos",
    description:
      "Agrega al final de tu mensaje la lista oficial de documentos para una forma de cobro (o la de estudiantes para la universitaria). Usala en lugar de escribir la lista; si hay varias formas de cobro, una vez por cada una: el sistema las junta en un solo mensaje.",
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
    name: "evaluar_alquiler",
    description:
      "Dice si la operación aplica: en tradicional, si los ingresos líquidos alcanzan para el alquiler; en universitaria, si el alquiler entra en el tope por estudiante. Devuelve los datos para el cliente y qué hacer. Guarda el alquiler en el CRM.",
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
        moneda: nullableEnum(
          ["UYU", "USD"],
          "La que dijo el cliente, o null si no la dijo: el sistema la deduce del monto.",
        ),
        ingresos_liquidos_totales: {
          anyOf: [{ type: "number" }, { type: "null" }],
          description:
            "Tradicional: ingresos líquidos mensuales sumados de quienes presentan ingresos, en la misma moneda que el alquiler. Null si no se saben.",
        },
        cantidad_estudiantes: {
          anyOf: [{ type: "integer" }, { type: "null" }],
          description:
            "Universitaria: cantidad de estudiantes. Null si no se sabe.",
        },
      },
    },
  },
  {
    name: "estimar_costo",
    description:
      "Costo aproximado de la garantía (72% del alquiler mensual). Usala solo si el cliente pregunta cuánto sale.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["modalidad", "monto_alquiler", "moneda"],
      properties: {
        modalidad: {
          type: "string",
          enum: ["tradicional", "universitaria", "rural"],
        },
        monto_alquiler: { type: "number" },
        moneda: nullableEnum(
          ["UYU", "USD"],
          "La que dijo el cliente, o null si no la dijo.",
        ),
      },
    },
  },
  {
    name: "derivar_a_persona",
    description:
      "Pasa la conversación a la persona del equipo. En el mismo mensaje en que la usás, avisale al cliente que lo va a atender esa persona; el sistema agrega el horario si es fuera de hora. Si no escribís nada, el sistema envía un aviso de derivación. Después de usarla no escribas nada más.",
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
    ...(c.student_count || st.students
      ? [`- Cantidad de estudiantes: ${c.student_count ?? st.students}.`]
      : []),
    ...(st.site_button
      ? [
          `- Llegó por el botón de WhatsApp del sitio: ${st.site_button === "general" ? "botón general (sin tipo de garantía)" : `garantía ${st.site_button}`}.`,
        ]
      : []),
    `- ¿Ya se confirmó con evaluar_alquiler que aplica?: ${(st as { fit?: string | null }).fit ? "sí" : "no"}.`,
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

/**
 * Readable reason for the team when the assistant fails. Includes the API's own message (it describes
 * the request, never customer data) so a rejected request can be diagnosed from the CRM.
 */
export function botErrorReason(e: unknown) {
  if (e instanceof Anthropic.APIError) {
    const body = e.error as { error?: { message?: unknown } } | undefined;
    const detail =
      typeof body?.error?.message === "string" ? body.error.message : "";
    const clean = detail.replace(/\s+/g, " ").replace(/\.+$/, "").slice(0, 300);
    return `Error del asistente (HTTP ${e.status})${clean ? `: ${clean}` : ""}.`;
  }
  return `Error del asistente: ${e instanceof Error ? e.message.slice(0, 200) : "desconocido"}.`;
}

/**
 * The single message the assistant sends at the end of a turn. Document lists go after the text
 * (one closing line for all); a handoff uses the model's own words plus the hours note when out of
 * hours, or the approved notice if the model wrote nothing.
 */
export function finalReply(p: {
  draft: string;
  documents: DocProfile[];
  handoff: {
    name: string;
    inHours: boolean;
    days: string;
    from: string;
    to: string;
  } | null;
}) {
  let draft = p.draft.trim();
  // "Ya te envié la documentación…" makes no sense right above the list itself.
  if (
    p.documents.length &&
    /(?<![\p{L}])(ya )?te (la |las |los )?(envi[eé]|mand[eé]|pas[eé])(?![\p{L}])/iu.test(
      draft,
    )
  )
    draft = "";
  const parts = [draft];
  if (p.documents.length) parts.push(documentsMessage(p.documents));
  if (p.handoff) {
    const h = p.handoff;
    parts.push(
      draft
        ? handoffHoursNote(h.name, h.inHours, h.days, h.from, h.to)
        : handoffMessage(h.name, h.inHours, h.days, h.from, h.to),
    );
  }
  return parts.filter(Boolean).join("\n\n");
}

/** True when an earlier assistant reply for this case is still waiting to be sent. */
async function pendingBotReply(
  db: SupabaseClient,
  cfg: WaConfig,
  applicationId: string,
  fetcher: typeof fetch,
) {
  const pending = async () => {
    const r = await db
      .from("wa_outbox")
      .select("id")
      .eq("application_id", applicationId)
      .eq("purpose", "bot")
      .in("status", ["pending", "sending"])
      .limit(1);
    return !r.error && (r.data?.length ?? 0) > 0;
  };
  if (!(await pending())) return false;
  await processOutbox(db, cfg, 10, fetcher).catch(() => undefined);
  return pending();
}

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
    // A previous reply still waiting to go out is not in the chat yet: answering now would repeat it.
    if (await pendingBotReply(db, cfg, c.application_id, fetcher))
      return {
        ran: false,
        sent,
        handedOff,
        reason: "respuesta pendiente de envío",
      };
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
    // The model's reply is sent once, at the end of the turn: its last text, the document lists
    // it asked for and, if it handed over, the handoff notice, all in one message.
    let draft = "",
      modelHandoff = false;
    const docProfiles: DocProfile[] = [];

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
          "id,full_name,national_id,rent_amount,rent_currency,guarantee_type,source,student_count",
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
    // Lessons approved by administration (weekly learning) extend the knowledge base.
    const system =
      systemPrompt(settings.handoff_name, days, from, to) +
      lessonsPrompt(await approvedLessons(db));
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
      const said = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text.trim())
        .filter(Boolean)
        .join("\n\n");
      if (said) draft = said;
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
                rent_currency:
                  input.monto_alquiler == null
                    ? (input.moneda ?? null)
                    : rentCurrency(
                        Number(input.monto_alquiler),
                        input.moneda as "UYU" | "USD" | null,
                      ),
                guarantee_type: input.tipo_garantia ?? null,
                monthly_income: input.ingresos_liquidos_titular ?? null,
                student_count: input.cantidad_estudiantes ?? null,
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
            // Documents only after evaluar_alquiler confirmed the operation applies.
            const needs = p === "estudiante" ? "universitaria" : "tradicional";
            if (state.fit !== needs)
              throw Error(
                "Todavía no está confirmado que aplica. Usá evaluar_alquiler con el alquiler y los ingresos (o los estudiantes); si no alcanza, no envíes documentos y ofrecé alternativas.",
              );
            docProfiles.push(p);
            state = { ...state, income_profile: p, documents_sent_for: p };
            result =
              "Lista agregada: va al final de tu mensaje, en el mismo envío. Presentala con una frase breve; no la repitas, no digas que ya la enviaste ni cómo mandarla.";
          } else if (use.name === "evaluar_alquiler") {
            const rent = Number(input.monto_alquiler);
            const currency = rentCurrency(
              rent,
              input.moneda as "UYU" | "USD" | null,
            );
            if (!currency) throw Error(MISSING_CURRENCY);
            const modalidad = String(input.modalidad) as GuaranteeType;
            const fit = evaluateRent({
              modalidad,
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
            state = { ...state, fit: fit.ok ? modalidad : null };
            result = `Para el cliente (en tus palabras, breve): ${fit.facts}\nQué hacer: ${fit.guidance}`;
            await db.rpc("wa_bot_update_case", {
              p_application: c.application_id,
              f: { rent_amount: rent, rent_currency: currency },
            });
          } else if (use.name === "estimar_costo") {
            const rent = Number(input.monto_alquiler);
            const currency = rentCurrency(
              rent,
              input.moneda as "UYU" | "USD" | null,
            );
            if (!currency) throw Error(MISSING_CURRENCY);
            result = `Para el cliente: ${costMessage(String(input.modalidad) as GuaranteeType, rent, currency)}`;
            await db.rpc("wa_bot_update_case", {
              p_application: c.application_id,
              f: { rent_amount: rent, rent_currency: currency },
            });
          } else if (use.name === "derivar_a_persona") {
            await db.rpc("wa_bot_handoff", {
              p_conversation: c.id,
              p_reason: String(
                input.motivo || "Derivación solicitada por el asistente",
              ),
            });
            handedOff = true;
            modelHandoff = true;
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
    const reply = finalReply({
      draft,
      documents: docProfiles,
      handoff: modelHandoff
        ? {
            name: settings.handoff_name,
            inHours,
            days,
            from,
            to,
          }
        : null,
    });
    if (reply) await enqueue(reply);
  } catch (e) {
    // The model or a dependency failed after retries: hand the chat to a person instead of going silent.
    const reason = botErrorReason(e);
    console.error("[whatsapp-bot]", reason);
    await db.rpc("wa_bot_handoff", {
      p_conversation: conversationId,
      p_reason: reason,
    });
    handedOff = true;
  } finally {
    // Send before releasing the turn, so the next turn finds these replies in the chat.
    if (sent) await processOutbox(db, cfg, 10, fetcher).catch(() => undefined);
    await db.rpc("wa_bot_release", {
      p_conversation: conversationId,
      p_state: state,
      p_turn: turn,
    });
  }
  return { ran: turn, sent, handedOff };
}

/** Pause before answering, like a person reading: 10 to 15 seconds. */
export const BOT_PAUSE_MS = { min: 10000, max: 15000 };
export const botPause = (random = Math.random) =>
  BOT_PAUSE_MS.min +
  Math.round(random() * (BOT_PAUSE_MS.max - BOT_PAUSE_MS.min));

const wait = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

/**
 * Answers a client message after the pause, once for everything the client wrote meanwhile.
 * If a newer client message arrived during the pause, its own webhook answers (this one stops).
 * If another turn is still running, waits for it instead of dropping the message.
 */
export async function runBotAfterPause(
  db: SupabaseClient,
  cfg: WaConfig,
  conversationId: string,
  messageId: string,
  readyAt: number,
  opts: {
    client?: BotClient | null;
    sleep?: (ms: number) => Promise<unknown>;
    now?: () => number;
    retries?: number;
  } = {},
): Promise<BotResult> {
  const sleep = opts.sleep ?? wait,
    now = opts.now ?? Date.now;
  await sleep(Math.max(0, readyAt - now()));
  // Same second counts as "together": only a strictly later message takes over.
  const [mine, latest] = await Promise.all([
    db
      .from("wa_messages")
      .select("created_at")
      .eq("id", messageId)
      .maybeSingle(),
    db
      .from("wa_messages")
      .select("created_at")
      .eq("conversation_id", conversationId)
      .eq("direction", "in")
      .order("created_at", { ascending: false })
      .limit(1),
  ]);
  const at = (mine.data as { created_at?: string } | null)?.created_at;
  const newest = (latest.data as { created_at: string }[] | null)?.[0]
    ?.created_at;
  if (at && newest && Date.parse(newest) > Date.parse(at))
    return {
      ran: false,
      sent: 0,
      handedOff: false,
      reason: "hay un mensaje más nuevo",
    };
  let result: BotResult = { ran: false, sent: 0, handedOff: false };
  for (let i = 0; i <= (opts.retries ?? 6); i++) {
    result =
      opts.client === undefined
        ? await runBotTurn(db, cfg, conversationId)
        : await runBotTurn(db, cfg, conversationId, opts.client);
    if (
      result.reason !== "en curso" &&
      result.reason !== "respuesta pendiente de envío"
    )
      return result;
    await sleep(5000);
  }
  return result;
}
