import { createHmac, randomUUID } from "node:crypto";
const secret = process.env.CRM_WEBHOOK_SECRET;
if (!secret)
  throw Error("Set CRM_WEBHOOK_SECRET in the isolated test environment");
const target = process.env.CRM_TEST_URL || "http://127.0.0.1:3000";
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(target))
  throw Error("Simulator only targets loopback");
const solicitud_id = randomUUID();
for (const step of [1, 2, 2]) {
  const e = {
    schema_version: 1,
    event_id: step === 1 ? randomUUID() : solicitud_id,
    solicitud_id,
    step,
    sent_at: "2026-10-26T12:00:00Z",
    data: {
      full_name: "Persona Ficticia Integración",
      phone: "000000000",
      rent_amount: 25000,
      rent_currency: "UYU",
      ...(step === 2
        ? { national_id: "DEMO-NO-VALIDO", monthly_income: 80000 }
        : {}),
    },
  };
  const body = JSON.stringify(e),
    timestamp = String(Math.floor(Date.now() / 1000));
  const response = await fetch(target + "/api/integration/events", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-crm-timestamp": timestamp,
      "x-crm-signature": createHmac("sha256", secret)
        .update(`${timestamp}.${body}`)
        .digest("hex"),
    },
    body,
  });
  console.log({ step, status: response.status, result: await response.json() });
  if (!response.ok) process.exitCode = 1;
}
