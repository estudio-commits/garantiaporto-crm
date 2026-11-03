import { test } from "node:test";
import assert from "node:assert/strict";
import { seed } from "../lib/demo";
import {
  demoMutation,
  followUp,
  pendingIssuance,
  validCI,
  normalizeCI,
  formatCI,
  validDriveFolder,
  migrateApplication,
} from "../lib/workflow";
test("follow-up uses Uruguay calendar dates and last comment, never edits", () => {
  const a = {
    ...seed().applications[0],
    created_at: "2026-11-02T02:59:00Z",
    updated_at: "2026-11-03T15:00:00Z",
  };
  assert.equal(followUp(a, [], Date.parse("2026-11-02T02:59:59Z")), null);
  assert.equal(followUp(a, [], Date.parse("2026-11-02T03:00:00Z")), "próximo");
  assert.equal(followUp(a, [], Date.parse("2026-11-03T03:00:00Z")), "urgente");
  const notes = [
    {
      id: "n",
      application_id: a.id,
      author_id: "u",
      body: "Ficticio",
      created_at: "2026-11-03T03:01:00Z",
    },
  ];
  assert.equal(followUp(a, notes, Date.parse("2026-11-03T15:00:00Z")), null);
  assert.equal(
    followUp({ ...a, archived: true }, [], Date.parse("2026-11-05T12:00:00Z")),
    null,
  );
  for (const stage of ["aprobada", "rechazada"])
    assert.equal(
      followUp(
        { ...a, guarantee_stage: stage },
        [],
        Date.parse("2026-11-05T12:00:00Z"),
      ),
      null,
    );
  assert.equal(
    followUp(
      { ...a, stage: "finalizado" },
      [],
      Date.parse("2026-11-05T12:00:00Z"),
    ),
    "urgente",
  ); // independent commercial axis
});
test("identity supports both lengths without inventing or truncating digits", () => {
  for (const ci of [
    "0.000.000-0",
    "000.000-0",
    "00000000",
    "0000000",
    "0000000-0",
  ])
    assert.equal(validCI(ci), true);
  for (const ci of [
    "",
    "123",
    "a0000000",
    "00.000.000-0",
    "000 000 0",
    "0.000.00-0",
  ])
    assert.equal(validCI(ci), false);
  assert.equal(normalizeCI("000.000-0"), "0000000");
  assert.equal(formatCI("00000000"), "0.000.000-0");
  assert.equal(formatCI("0000000"), "000.000-0");
});
test("folder validation rejects spoofed domains, files and active URLs", () => {
  assert.ok(
    validDriveFolder(
      "https://drive.google.com/drive/folders/demo_123?usp=sharing",
    ),
  );
  assert.ok(
    validDriveFolder("https://drive.google.com/drive/u/0/folders/demo-123"),
  );
  for (const u of [
    "javascript:alert(1)",
    "https://drive.google.com.evil.test/drive/folders/a",
    "https://evil@drive.google.com/drive/folders/a",
    "http://drive.google.com/drive/folders/a",
    "https://drive.google.com/file/d/a",
  ])
    assert.equal(validDriveFolder(u), false);
});
test("legacy workflow migration preserves dates, independent axes and missing request date", () => {
  const old = {
    ...seed().applications[0],
    stage: "en_preaprobacion",
    guarantee_stage: undefined,
    preapproval: "en_proceso",
    requested_date: undefined,
  };
  const a = migrateApplication(old);
  assert.equal(a.stage, "en_contacto");
  assert.equal(a.guarantee_stage, "preaprobacion_cargada");
  assert.equal(a.created_at, old.created_at);
  assert.equal(a.requested_date, null);
});
test("demo records old/new changes, ignores no-ops and touches parent on follow-up", () => {
  const s = seed();
  s.applications[0].updated_at = "2020-01-01T00:00:00Z";
  const a = s.applications[0],
    p = s.profiles[0];
  assert.equal(
    demoMutation(
      s,
      "applications",
      { id: a.id, full_name: a.full_name },
      "update",
      "id",
      p,
    ),
    s,
  );
  const next = demoMutation(
    s,
    "applications",
    { id: a.id, stage: "en_contacto" },
    "update",
    "id",
    p,
  );
  assert.equal(next.applications[0].guarantee_stage, a.guarantee_stage);
  assert.ok(next.applications[0].updated_at > a.updated_at);
  assert.deepEqual((next.audits[0].changes as Record<string, unknown>).stage, {
    before: "nuevo",
    after: "en_contacto",
  });
  const followed = demoMutation(
    s,
    "notes",
    {
      id: "test",
      application_id: a.id,
      author_id: p.id,
      body: "Ficticio",
      created_at: new Date().toISOString(),
    },
    "insert",
    "id",
    p,
  );
  assert.ok(followed.applications[0].updated_at > a.updated_at);
});

test("issuance is admin-only, requires approval and evidence, and remains auditable", () => {
  const s = seed(),
    a = s.applications[0];
  a.guarantee_stage = "aprobada";
  a.decision = "aprobada";
  assert.equal(pendingIssuance(a), true);
  const value = {
    id: a.id,
    issued_date: "2026-11-03",
    issued_reference: "FICTICIO-001",
  };
  assert.throws(
    () => demoMutation(s, "applications", value, "update", "id", s.profiles[1]),
    /administración/,
  );
  for (const invalid of [
    { ...value, issued_reference: " " },
    { ...value, issued_date: "2026-02-30" },
    { ...value, issued_date: null },
  ])
    assert.throws(() =>
      demoMutation(s, "applications", invalid, "update", "id", s.profiles[0]),
    );
  const next = demoMutation(
    s,
    "applications",
    value,
    "update",
    "id",
    s.profiles[0],
  );
  assert.equal(pendingIssuance(next.applications[0]), false);
  assert.equal(next.applications[0].stage, a.stage);
  assert.equal(next.applications[0].guarantee_stage, "aprobada");
  assert.throws(
    () =>
      demoMutation(
        next,
        "applications",
        { id: a.id, guarantee_stage: "sin_contactar" },
        "update",
        "id",
        s.profiles[0],
      ),
    /anulá/,
  );
  const canceled = demoMutation(
    next,
    "applications",
    { id: a.id, issued_date: null, issued_reference: null },
    "update",
    "id",
    s.profiles[0],
  );
  assert.equal(pendingIssuance(canceled.applications[0]), true);
  assert.deepEqual(
    (canceled.audits[0].changes as Record<string, unknown>).issued_reference,
    { before: "FICTICIO-001", after: null },
  );
});
