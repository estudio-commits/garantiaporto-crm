import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { keepAlive } from "../lib/keepalive";

const fake = (error: { message: string } | null) => {
  const seen: unknown[] = [];
  const db = {
    from: (table: string) => ({
      select: async (cols: string, opts: unknown) => {
        seen.push([table, cols, opts]);
        return { count: 3, error };
      },
    }),
  } as unknown as SupabaseClient;
  return { db, seen };
};

test("pings the database with a count-only query", async () => {
  const { db, seen } = fake(null);
  let t = 1_700_000_000_000;
  const r = await keepAlive(db, () => (t += 40));
  assert.deepEqual(r, {
    ok: true,
    at: new Date(1_700_000_000_040).toISOString(),
    ms: 40,
  });
  assert.deepEqual(seen, [["profiles", "id", { count: "exact", head: true }]]);
});

test("reports a failed ping instead of hiding it", async () => {
  const { db } = fake({ message: "project paused" });
  const r = await keepAlive(db, () => 0);
  assert.deepEqual(r, {
    ok: false,
    at: new Date(0).toISOString(),
    error: "project paused",
  });
});
