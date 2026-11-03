import { test } from "node:test";
import assert from "node:assert/strict";
import { whatsappNumber, whatsappUrl } from "../lib/phone";
test("WhatsApp normalizes local and international Uruguay numbers", () => {
  for (const n of [
    "099 000 001",
    "99000001",
    "+598 99 000 001",
    "00598-99-000-001",
    "59899000001",
    "+598 (0) 99 000 001",
  ])
    assert.equal(whatsappNumber(n), "59899000001");
  assert.equal(
    whatsappUrl("099000001"),
    "https://api.whatsapp.com/send?phone=59899000001",
  );
});
test("WhatsApp rejects incomplete, malformed and ambiguous numbers", () => {
  for (const n of [
    "",
    "000 000 001",
    "099",
    "59899",
    "099000001 ext 3",
    "javascript:123",
    "099000001&text=test",
    "+59812345678",
  ])
    assert.equal(whatsappUrl(n), null);
  assert.equal(whatsappNumber("+1 (202) 555-0100"), "12025550100");
});
