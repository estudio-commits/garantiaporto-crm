import { test } from "node:test";
import assert from "node:assert/strict";
import { seed } from "../lib/demo";
import {
  demoMutation,
  needsFollowUp,
  validDriveFolder,
  migrateApplication,
} from "../lib/workflow";
test("follow-up boundary is exactly 48 hours, regardless of browser local timezone", () => {
  const a = seed().applications[0];
  a.updated_at = "2026-10-25T12:00:00Z";
  assert.equal(needsFollowUp(a, Date.parse("2026-10-27T11:59:59Z")), false);
  assert.equal(needsFollowUp(a, Date.parse("2026-10-27T12:00:00Z")), true);
  assert.equal(
    needsFollowUp({ ...a, archived: true }, Date.parse("2026-10-28T12:00:00Z")),
    false,
  );
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
