import { test } from "node:test";
import assert from "node:assert/strict";
import { seed } from "../lib/demo";
import { approvalGroups, upgradeStore, WEB_SOURCE_ID } from "../lib/sources";
test("upgrade preserves existing records and does not infer agency from manual entry", () => {
  const old = seed();
  delete (old as Partial<typeof old>).sources;
  for (const a of old.applications) delete a.source_id;
  old.applications[0].summary = "Preserve this note";
  const updated = upgradeStore(old);
  assert.equal(updated.applications[0].source_id, null);
  assert.equal(updated.applications[1].source_id, WEB_SOURCE_ID);
  assert.equal(updated.applications[0].summary, "Preserve this note");
  assert.equal(updated.sources.length, 2);
});
test("approval metrics use formal decisions only and no decisions is not zero percent", () => {
  const rows = seed().applications.slice(0, 4);
  rows[0].decision = "aprobada";
  rows[1].decision = "rechazada";
  rows[2].preapproval = "preaprobado";
  const [g] = approvalGroups(rows, () => "all");
  assert.equal(g.rate, 0.5);
  assert.equal(g.total, 4);
  assert.equal(g.decided, 2);
  assert.equal(approvalGroups([rows[2]], () => "all")[0].rate, null);
});
