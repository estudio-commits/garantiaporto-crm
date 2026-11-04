import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { runInNewContext } from "node:vm";
const script = readFileSync(
  new URL("../integrations/wordpress/browser.js", import.meta.url),
  "utf8",
);
function harness(saved?: string) {
  const listeners: Record<string, (...args: any[]) => void> = {};
  let persisted = saved ?? "";
  function form(id: string) {
    const fields: Record<string, { value: string }> = Object.fromEntries(
      ["solicitud_id", "event_id", "url_origen", "pagina_origen"].map((k) => [
        k,
        { value: "" },
      ]),
    );
    return {
      id,
      fields,
      querySelector(selector: string) {
        const key = selector.match(/form_fields\[([^\]]+)\]/)?.[1];
        return key ? fields[key] : null;
      },
    };
  }
  const first = form("garantia_paso_1"),
    second = form("garantia_paso_2");
  const document = {
    title: "Página ficticia",
    querySelectorAll: () => [first, second],
    addEventListener: (
      name: string,
      fn: (...args: any[]) => void,
      capture: boolean,
    ) => {
      assert.equal(capture, true);
      listeners[name] = fn;
    },
  };
  const context = {
    document,
    window: {},
    crypto: webcrypto,
    location: { href: "https://example.test/?utm_source=ficticio" },
    sessionStorage: {
      getItem: () => persisted,
      setItem: (_k: string, v: string) => {
        persisted = v;
      },
    },
    setTimeout: (fn: () => void) => fn(),
    jQuery: () => ({
      closest: () => ({ length: 0 }),
      on: (name: string, fn: (...args: any[]) => void) => {
        listeners[name] = fn;
      },
    }),
  };
  runInNewContext(script, context);
  return { first, second, listeners, persisted: () => persisted, context };
}
test("WordPress steps share one UUID, separate events and preserve attribution", () => {
  const h = harness();
  const id = h.first.fields.solicitud_id.value;
  assert.match(id, /^[0-9a-f-]{36}$/);
  assert.equal(h.second.fields.solicitud_id.value, id);
  assert.notEqual(
    h.first.fields.event_id.value,
    h.second.fields.event_id.value,
  );
  h.first.fields.url_origen.value =
    "https://example.test/original?gclid=ficticio";
  h.listeners.submit({ target: h.first });
  assert.equal(
    h.first.fields.url_origen.value,
    "https://example.test/original?gclid=ficticio",
  );
  h.listeners["submit_success.portoCrm"]({ target: h.first });
  assert.equal(h.second.fields.solicitud_id.value, id);
  const repeated = harness(h.persisted());
  assert.equal(repeated.first.fields.solicitud_id.value, id);
  assert.equal(
    repeated.first.fields.event_id.value,
    h.first.fields.event_id.value,
  );
});
test("completed request rotates only on next popup; installing listener twice is harmless", () => {
  const h = harness();
  const id = h.first.fields.solicitud_id.value;
  const listener = h.listeners.submit;
  runInNewContext(script, h.context);
  assert.equal(h.listeners.submit, listener);
  h.listeners["submit_success.portoCrm"]({ target: h.second });
  assert.equal(h.first.fields.solicitud_id.value, id);
  h.listeners["elementor/popup/show.portoCrm"]();
  assert.notEqual(h.first.fields.solicitud_id.value, id);
  assert.equal(
    h.first.fields.solicitud_id.value,
    h.second.fields.solicitud_id.value,
  );
});
