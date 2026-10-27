import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseUyMoney,
  completionAfter,
  visible,
  eventSchema,
} from "../lib/domain";
import { seed } from "../lib/demo";
test("Uruguayan amounts are parsed without guessing malformed input", () => {
  assert.equal(parseUyMoney("25.000,50"), 25000.5);
  assert.equal(parseUyMoney("25000"), 25000);
  assert.throws(() => parseUyMoney("25.00"));
  assert.throws(() => parseUyMoney("-10"));
});
test("late step one cannot downgrade a complete request", () => {
  assert.equal(completionAfter("completo", 1), "completo");
  assert.equal(completionAfter("parte_1_recibida", 2), "completo");
});
test("seller visibility excludes other owners and unassigned requests", () => {
  const s = seed(),
    p = s.profiles[1];
  assert.ok(
    s.applications
      .filter((a) => visible(a, p))
      .every((a) => a.assigned_user_id === p.id),
  );
  assert.equal(
    s.applications.filter((a) => visible(a, { ...p, active: false })).length,
    0,
  );
});
test("web event validates types and retains phone zeroes", () => {
  const e = {
    schema_version: 1,
    event_id: crypto.randomUUID(),
    solicitud_id: crypto.randomUUID(),
    step: 1,
    sent_at: new Date().toISOString(),
    data: {
      full_name: "Persona Ficticia",
      phone: "000123",
      rent_amount: 25000,
      rent_currency: "UYU",
    },
  };
  assert.equal(eventSchema.parse(e).data.phone, "000123");
  assert.equal(eventSchema.safeParse({ ...e, step: 3 }).success, false);
  assert.equal(
    eventSchema.safeParse({ ...e, data: { ...e.data, rent_amount: -1 } })
      .success,
    false,
  );
});
