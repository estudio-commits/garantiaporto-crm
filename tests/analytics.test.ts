import { test } from "node:test";
import assert from "node:assert/strict";
import { summarize, groupedStats, rejectionStages } from "../lib/analytics";
import { seed } from "../lib/demo";
import { eventSchema } from "../lib/domain";
test("metrics distinguish decisions from conversion and preserve unknowns", () => {
  const base = seed().applications[0];
  const apps = [
    base,
    { ...base, id: "2", guarantee_stage: "aprobada" },
    { ...base, id: "3", guarantee_stage: "rechazada" },
  ];
  const stats = summarize(apps, [], Date.now());
  assert.equal(stats.approvalRate, 0.5);
  assert.equal(stats.conversion, 1 / 3);
  assert.equal(stats.pending, 1);
  assert.equal(stats.medianResponse, null);
  assert.equal(summarize([base], [], Date.now()).approvalRate, null);
  assert.equal(
    groupedStats(
      apps,
      (a) => (a.id === "2" ? "Web" : "Inmobiliaria"),
      [],
      Date.now(),
    ).length,
    2,
  );
});
test("response time counts first communication only and ignores later/other notes", () => {
  const app = { ...seed().applications[0], created_at: "2026-11-01T12:00:00Z" };
  const note = {
    id: "1",
    application_id: app.id,
    author_id: "u",
    body: "ficticio",
    created_at: "2026-11-01T13:00:00Z",
    kind: "comentario" as const,
  };
  const stats = summarize(
    [app],
    [
      note,
      {
        ...note,
        id: "2",
        kind: "comunicacion",
        created_at: "2026-11-01T15:00:00Z",
      },
      {
        ...note,
        id: "3",
        kind: "comunicacion",
        created_at: "2026-11-02T15:00:00Z",
      },
    ],
    Date.now(),
  );
  assert.equal(stats.medianResponse, 3);
  assert.equal(stats.responseSample, 1);
});
test("marketing values and extra survive schema parsing; unmapped data is explicitly rejected", () => {
  const event = {
    schema_version: 1,
    event_id: crypto.randomUUID(),
    solicitud_id: crypto.randomUUID(),
    step: 1,
    sent_at: new Date().toISOString(),
    data: {
      full_name: "Ficticio",
      phone: "000",
      fbclid: "test",
      button_origin: "demo",
    },
    extra: { campaign_variant: "A", landing_page: "https://example.test" },
  };
  assert.deepEqual(eventSchema.parse(event), event);
  assert.equal(
    eventSchema.safeParse({
      ...event,
      data: { ...event.data, unmapped: "preserve through extra instead" },
    }).success,
    false,
  );
});

test("loss stages use the latest recorded rejection and retain unknown history", () => {
  const app = { ...seed().applications[0], guarantee_stage: "rechazada" };
  const event = {
    id: "1",
    application_id: app.id,
    actor_id: null,
    action: "applications:UPDATE",
    created_at: "2026-11-01T15:00:00Z",
    changes: {
      guarantee_stage: { before: "documentacion_recibida", after: "rechazada" },
    },
  };
  const result = rejectionStages(
    [app, { ...app, id: "no-history" }],
    [
      event,
      {
        ...event,
        id: "2",
        created_at: "2026-11-02T15:00:00Z",
        changes: {
          guarantee_stage: {
            before: "preaprobacion_cargada",
            after: "rechazada",
          },
        },
      },
    ],
  );
  assert.deepEqual(result, [
    { stage: "preaprobacion_cargada", count: 1 },
    { stage: "sin_historial_anterior", count: 1 },
  ]);
});
