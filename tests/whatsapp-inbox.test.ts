import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dayLabel,
  initials,
  listTime,
  sameDay,
  sortInbox,
} from "../lib/whatsapp";

// 2026-11-09 15:00 in Montevideo (UTC-3).
const now = Date.parse("2026-11-09T18:00:00Z");

test("unread conversations go first, then by most recent message", () => {
  const list = [
    { id: "a", unread_count: 0, last_message_at: "2026-11-09T17:00:00Z" },
    { id: "b", unread_count: 2, last_message_at: "2026-11-08T10:00:00Z" },
    { id: "c", unread_count: 0, last_message_at: null },
    { id: "d", unread_count: 1, last_message_at: "2026-11-09T12:00:00Z" },
    { id: "e", unread_count: 0, last_message_at: "2026-11-09T17:30:00Z" },
  ];
  assert.deepEqual(
    sortInbox(list).map((c) => c.id),
    ["d", "b", "e", "a", "c"],
  );
  assert.equal(list[0]!.id, "a", "does not mutate the input");
});

test("list time follows the Montevideo calendar", () => {
  assert.equal(listTime("2026-11-09T16:05:00Z", now), "13:05");
  // 01:30 UTC on the 9th is still the 8th in Montevideo.
  assert.equal(listTime("2026-11-09T01:30:00Z", now), "Ayer");
  assert.equal(listTime("2026-11-06T15:00:00Z", now), "viernes");
  assert.equal(listTime("2026-10-20T15:00:00Z", now), "20/10/26");
});

test("day separators and initials", () => {
  assert.equal(dayLabel("2026-11-09T12:00:00Z", now), "Hoy");
  assert.equal(dayLabel("2026-11-08T12:00:00Z", now), "Ayer");
  assert.match(
    dayLabel("2026-11-03T12:00:00Z", now),
    /^Martes 3 de noviembre$/,
  );
  assert.ok(sameDay("2026-11-09T03:30:00Z", "2026-11-09T23:00:00Z"));
  assert.ok(!sameDay("2026-11-09T02:30:00Z", "2026-11-09T03:30:00Z"));
  assert.equal(initials("Bruno  Demostración Pérez"), "BD");
  assert.equal(initials(""), "?");
});

import { fillPreview, templatePreview } from "../lib/whatsapp";

test("template preview picks the configured language and flattens the text", () => {
  const list = [
    {
      name: "saludo_solicitud",
      language: "en_US",
      status: "APPROVED",
      components: [{ type: "BODY", text: "Hi {{1}}" }],
    },
    {
      name: "saludo_solicitud",
      language: "es_UY",
      status: "APPROVED",
      components: [
        { type: "HEADER", format: "TEXT", text: "Garantía Porto" },
        { type: "BODY", text: "Hola {{1}}, recibimos tu solicitud." },
        { type: "FOOTER", text: "Mensaje ficticio" },
        { type: "BUTTONS", buttons: [{ text: "Quiero avanzar" }] },
      ],
    },
  ];
  const t = templatePreview(list, "saludo_solicitud", "es_UY")!;
  assert.equal(t.header, "Garantía Porto");
  assert.equal(
    fillPreview(t.body),
    "Hola [nombre del cliente], recibimos tu solicitud.",
  );
  assert.equal(t.footer, "Mensaje ficticio");
  assert.deepEqual(t.buttons, ["Quiero avanzar"]);
  assert.equal(
    templatePreview(list, "saludo_solicitud", "pt_BR")!.language,
    "en_US",
  );
  assert.equal(templatePreview(list, "otra", "es_UY"), null);
  assert.equal(
    templatePreview(
      [
        {
          name: "x",
          components: [
            { type: "HEADER", format: "IMAGE" },
            { type: "BODY", text: "b" },
          ],
        },
      ],
      "x",
      "es_UY",
    )!.header,
    "[image]",
  );
});
