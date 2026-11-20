import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_HOURS,
  businessMinutes,
  documentsToPreapproval,
  formatCalendarTime,
  formatWorkTime,
  responseByUser,
  responseTurns,
} from "../lib/analytics";
import type { Application, Audit } from "../lib/domain";

// Uruguay is UTC−3: 12:00Z = 09:00 in Montevideo. 2026-11-20 is a Friday.
const at = (s: string) => Date.parse(s);

test("counts only attention hours, in Uruguay time", () => {
  const h = DEFAULT_HOURS;
  assert.equal(
    businessMinutes(at("2026-11-20T13:00:00Z"), at("2026-11-20T14:30:00Z"), h),
    90,
  );
  // Friday 16:00 → Monday 10:00 (Uruguay): 60 min Friday + 60 min Monday.
  assert.equal(
    businessMinutes(at("2026-11-20T19:00:00Z"), at("2026-11-23T13:00:00Z"), h),
    120,
  );
  // Written at night, answered before opening: no working time.
  assert.equal(
    businessMinutes(at("2026-11-20T23:00:00Z"), at("2026-11-21T11:00:00Z"), h),
    0,
  );
  assert.equal(
    businessMinutes(at("2026-11-20T14:00:00Z"), at("2026-11-20T13:00:00Z"), h),
    0,
  );
  // Saturdays count when the team works them.
  assert.equal(
    businessMinutes(at("2026-11-21T12:00:00Z"), at("2026-11-21T13:00:00Z"), {
      ...h,
      days: [6],
    }),
    60,
  );
  assert.equal(formatWorkTime(0, h), "menos de 1 min");
  assert.equal(formatWorkTime(45, h), "45 min");
  assert.equal(formatWorkTime(200, h), "3 h 20 min");
  assert.equal(formatWorkTime(1200, h), "2,5 días hábiles");
  assert.equal(formatCalendarTime(3000), "2,1 días");
  assert.equal(formatWorkTime(null, h), "Sin datos");
});

const msg = (
  id: string,
  direction: "in" | "out",
  created_at: string,
  author_id: string | null = null,
  extra: Partial<{ status: string; conversation_id: string }> = {},
) => ({
  id,
  conversation_id: "c1",
  application_id: "a1",
  direction,
  author_id,
  status: "sent",
  created_at,
  ...extra,
});

test("pairs each client turn with the first reply from a person", () => {
  const turns = responseTurns([
    msg("1", "in", "2026-11-20T13:00:00Z"),
    msg("2", "in", "2026-11-20T13:05:00Z"), // same turn
    msg("3", "out", "2026-11-20T13:06:00Z", null), // assistant: not a person
    msg("4", "out", "2026-11-20T13:20:00Z", "ana", { status: "failed" }), // did not go out
    msg("5", "out", "2026-11-20T13:30:00Z", "ana"),
    msg("6", "out", "2026-11-20T13:31:00Z", "ana"),
    msg("7", "in", "2026-11-20T14:00:00Z"),
    msg("8", "out", "2026-11-20T15:00:00Z", "beto"),
    msg("9", "in", "2026-11-20T16:00:00Z"), // not answered yet
    msg("10", "in", "2026-11-20T13:10:00Z", null, { conversation_id: "c2" }),
  ]);
  assert.deepEqual(
    turns.map((t) => [
      t.asked_at.slice(11, 16),
      t.author_id,
      t.answered_at?.slice(11, 16) ?? null,
    ]),
    [
      ["13:00", "ana", "13:30"],
      ["14:00", "beto", "15:00"],
      ["16:00", null, null],
      ["13:10", null, null],
    ],
  );
  const stats = responseByUser(turns, DEFAULT_HOURS, () => true);
  assert.equal(stats.unanswered, 2);
  assert.deepEqual(
    stats.users.map((u) => [u.author_id, u.count, u.median]),
    [
      ["ana", 1, 30],
      ["beto", 1, 60],
    ],
  );
  assert.equal(stats.total.average, 45);
});

const audit = (
  application_id: string,
  created_at: string,
  before: string | null,
  after: string,
  actor_name = "Ana Ficticia",
): Audit => ({
  id: `${application_id}-${created_at}`,
  application_id,
  actor_id: null,
  action: "applications:UPDATE",
  created_at,
  changes: { guarantee_stage: { before, after } },
  visibility: "case",
  actor_name,
});

test("measures documents received → preapproval from the stage history", () => {
  const app = (id: string, guarantee_stage: string) =>
    ({ id, guarantee_stage, archived: false }) as Application;
  const audits = [
    // a1: received Monday 10:00, back to requested, received again Tuesday 10:00, preapproval Tuesday 12:00.
    audit(
      "a1",
      "2026-11-16T13:00:00Z",
      "documentacion_solicitada",
      "documentacion_recibida",
    ),
    audit(
      "a1",
      "2026-11-16T14:00:00Z",
      "documentacion_recibida",
      "documentacion_solicitada",
    ),
    audit(
      "a1",
      "2026-11-17T13:00:00Z",
      "documentacion_solicitada",
      "documentacion_recibida",
    ),
    audit(
      "a1",
      "2026-11-17T15:00:00Z",
      "documentacion_recibida",
      "preaprobacion_cargada",
      "Beto Ficticio",
    ),
    // a2: preapproval without a received step in its history: not counted.
    audit(
      "a2",
      "2026-11-17T15:00:00Z",
      "sin_contactar",
      "preaprobacion_cargada",
    ),
    // a3: still waiting since Wednesday 09:00.
    audit(
      "a3",
      "2026-11-18T12:00:00Z",
      "documentacion_solicitada",
      "documentacion_recibida",
    ),
  ];
  const r = documentsToPreapproval(
    [
      app("a1", "preaprobacion_cargada"),
      app("a2", "preaprobacion_cargada"),
      app("a3", "documentacion_recibida"),
    ],
    audits,
    DEFAULT_HOURS,
    () => true,
    at("2026-11-18T20:00:00Z"), // Wednesday 17:00
  );
  assert.equal(r.total.count, 1);
  assert.equal(r.total.median, 120);
  assert.deepEqual(
    r.users.map((u) => u.actor),
    ["Beto Ficticio"],
  );
  assert.deepEqual(r.waiting, { count: 1, oldest: 480 });
  const outside = documentsToPreapproval(
    [app("a1", "preaprobacion_cargada")],
    audits,
    DEFAULT_HOURS,
    (iso) => iso.startsWith("2026-12"),
    at("2026-11-18T20:00:00Z"),
  );
  assert.equal(outside.total.count, 0);
});
