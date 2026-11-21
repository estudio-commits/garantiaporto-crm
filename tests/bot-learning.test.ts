import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  anonymize,
  cleanProposals,
  learningTranscripts,
  lessonsPrompt,
  runLearning,
  weekOf,
  type LearningMessage,
  type Proposals,
} from "../lib/bot-learning";

test("weeks start on Monday, Uruguay time", () => {
  assert.equal(weekOf(Date.parse("2026-11-20T15:00:00Z")), "2026-11-16"); // Friday
  assert.equal(weekOf(Date.parse("2026-11-16T03:30:00Z")), "2026-11-16"); // Monday 00:30 UY
  assert.equal(weekOf(Date.parse("2026-11-16T02:30:00Z")), "2026-11-09"); // still Sunday in UY
});

test("masks names, cédulas, phones, e-mails and links", () => {
  const out = anonymize(
    "Hola Martina Ficticia, tu CI 4.444.444-4 y tu cel 099 123 456 (martina@correo.com) https://ejemplo.com/x. Alquiler $ 30.000",
    ["Martina Ficticia"],
  );
  assert.equal(
    out,
    "Hola [cliente] [cliente], tu CI [cédula] y tu cel [número] ([correo]) [enlace] Alquiler $ 30.000",
  );
  // Words inside other words are kept; names of one or two letters are not masked.
  assert.equal(anonymize("Martinez, Ana y Al", ["Martín", "Ana", "Al"]), "Martinez, [cliente] y Al");
});

const m = (
  conversation_id: string,
  direction: "in" | "out",
  author: string,
  body: string,
  minute: number,
  kind = "text",
): LearningMessage => ({
  conversation_id,
  application_id: "a",
  direction,
  author,
  kind,
  body,
  created_at: `2026-11-20T13:${String(minute).padStart(2, "0")}:00Z`,
});

test("builds masked transcripts of conversations with both sides", () => {
  const { text, conversations } = learningTranscripts(
    [
      m("c1", "in", "customer", "Hola, soy Martina. ¿Aceptan mascotas?", 1),
      m("c1", "out", "bot", "Te paso con Lucía.", 2),
      m(
        "c1",
        "out",
        "human",
        "Hola Martina, la garantía no depende de mascotas.",
        3,
      ),
      m("c1", "in", "customer", "", 4, "image"),
      m("c2", "in", "customer", "Hola", 1), // nobody answered: skipped
      m("c3", "out", "system", "Plantilla: saludo", 1, "template"), // client never wrote: skipped
    ],
    (id) => (id === "c1" ? ["Martina Ficticia"] : []),
  );
  assert.equal(conversations, 1);
  assert.equal(
    text,
    [
      "### Conversación 1",
      "Cliente: Hola, soy [cliente]. ¿Aceptan mascotas?",
      "Asistente: Te paso con Lucía.",
      "Equipo: Hola [cliente], la garantía no depende de mascotas.",
      "Cliente: [archivo]",
    ].join("\n"),
  );
});

const proposal = (over: Partial<Proposals["propuestas"][number]> = {}) => ({
  tipo: "pregunta" as const,
  pregunta: "¿Se aceptan mascotas?",
  respuesta:
    "La garantía no depende de tener mascotas: eso lo define el contrato con el propietario.",
  motivo: "El asistente derivó en 3 conversaciones.",
  conversaciones: 3,
  falta_confirmar: false,
  ...over,
});

test("keeps only usable, new and anonymous proposals", () => {
  const rows = cleanProposals(
    {
      propuestas: [
        proposal(),
        proposal({ pregunta: "¿se aceptan MASCOTAS?" }), // repeated
        proposal({ pregunta: "¿Puedo pagar en cuotas?" }), // already approved
        proposal({ pregunta: null }), // question without text
        proposal({
          tipo: "estilo",
          pregunta: null,
          respuesta: "Cerrá con el próximo paso, Martina.",
        }),
        proposal({
          pregunta: "¿Sirve el recibo de sueldo de octubre?",
          respuesta: "  ",
          conversaciones: 0,
        }),
      ],
    },
    [{ kind: "pregunta", question: "¿Puedo pagar en cuotas?", answer: "Sí." }],
    ["Martina Ficticia"],
  );
  assert.deepEqual(
    rows.map((r) => [r.kind, r.question, r.evidence]),
    [
      ["pregunta", "¿Se aceptan mascotas?", 3],
      ["estilo", null, 3],
    ],
  );
  assert.equal(rows[1]!.answer, "Cerrá con el próximo paso, [cliente].");
});

test("approved lessons extend the assistant's prompt; style notes are not data", () => {
  assert.equal(lessonsPrompt([]), "");
  const prompt = lessonsPrompt([
    {
      kind: "pregunta",
      question: "¿Se aceptan mascotas?",
      answer: "No depende de la garantía.",
    },
    {
      kind: "estilo",
      question: null,
      answer: "Terminá con una pregunta para avanzar.",
    },
  ]);
  assert.match(
    prompt,
    /- P: ¿Se aceptan mascotas\?\n {2}R: No depende de la garantía\./,
  );
  assert.match(prompt, /Son guías de tono, no datos/);
  assert.match(prompt, /- Terminá con una pregunta para avanzar\./);
});

// Minimal stand-in for the Supabase client: records writes, answers reads from fixed tables.
function fakeDb(tables: Record<string, Record<string, unknown>[]>) {
  const writes: { table: string; op: string; value: unknown }[] = [];
  const from = (table: string) => {
    let op = "select",
      value: unknown = null;
    const result = () => {
      if (op === "insert") {
        writes.push({ table, op, value });
        return { data: { id: 1 }, error: null };
      }
      if (op === "update") {
        writes.push({ table, op, value });
        return { data: null, error: null };
      }
      return { data: tables[table] ?? [], error: null };
    };
    const chain: Record<string, unknown> = {
      select: () => chain,
      insert: (v: unknown) => ((op = "insert"), (value = v), chain),
      update: (v: unknown) => ((op = "update"), (value = v), chain),
      eq: () => chain,
      neq: () => chain,
      gte: () => chain,
      in: () => chain,
      order: () => chain,
      limit: () => chain,
      single: async () => result(),
      then: (ok: (r: unknown) => unknown) => Promise.resolve(result()).then(ok),
    };
    return chain;
  };
  return { db: { from } as unknown as SupabaseClient, writes };
}

test("runs the weekly analysis: masked input, stored proposals, finished run", async () => {
  const { db, writes } = fakeDb({
    wa_messages: [
      m(
        "c1",
        "in",
        "customer",
        "Hola, soy Martina Ficticia, mi CI es 4.444.444-4. ¿Aceptan mascotas?",
        1,
      ),
      m(
        "c1",
        "out",
        "human",
        "Hola Martina, la garantía no depende de mascotas.",
        3,
      ),
    ],
    applications: [{ id: "a", full_name: "Martina Ficticia" }],
    wa_conversations: [
      { id: "c1", application_id: "a", profile_name: "Marti" },
    ],
    wa_bot_lessons: [],
  });
  let sent = "";
  const result = await runLearning(
    db,
    async (_system, user) => {
      sent = user;
      return {
        propuestas: [
          proposal({ respuesta: "No depende de las mascotas, Martina." }),
        ],
      };
    },
    null,
    Date.parse("2026-11-20T15:00:00Z"),
  );
  assert.deepEqual(result, { status: "lista", conversations: 1, proposals: 1 });
  assert.ok(
    !/Martina|4\.444|Ficticia/.test(sent),
    "personal data reached the model",
  );
  assert.match(sent, /Base de conocimiento actual/);
  const stored = writes.find((w) => w.table === "wa_bot_lessons")!
    .value as Record<string, unknown>[];
  assert.equal(stored[0]!.answer, "No depende de las mascotas, [cliente].");
  assert.equal(stored[0]!.week, "2026-11-16");
  const finished = writes
    .filter((w) => w.table === "wa_bot_learning_runs")
    .at(-1)!.value as Record<string, unknown>;
  assert.equal(finished.status, "lista");
});

test("a failed analysis is recorded as an error, without proposals", async () => {
  const { db, writes } = fakeDb({
    wa_messages: [
      m("c1", "in", "customer", "Hola", 1),
      m("c1", "out", "bot", "Hola", 2),
    ],
  });
  const result = await runLearning(
    db,
    async () => null,
    null,
    Date.parse("2026-11-20T15:00:00Z"),
  );
  assert.equal(result.status, "error");
  assert.ok(!writes.some((w) => w.table === "wa_bot_lessons"));
});
