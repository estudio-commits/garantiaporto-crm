// Daily ping so the Supabase project is never paused for inactivity (free projects pause after
// 7 days without activity). A real query through the API, independent of WhatsApp and Drive.
import type { SupabaseClient } from "@supabase/supabase-js";

export type KeepAliveResult =
  | { ok: true; at: string; ms: number }
  | { ok: false; at: string; error: string };

export async function keepAlive(
  db: SupabaseClient,
  now: () => number = Date.now,
): Promise<KeepAliveResult> {
  const start = now();
  const at = new Date(start).toISOString();
  // Count only (no rows returned): the smallest query that still reaches the database.
  const r = await db
    .from("profiles")
    .select("id", { count: "exact", head: true });
  if (r.error) return { ok: false, at, error: r.error.message.slice(0, 200) };
  return { ok: true, at, ms: now() - start };
}
