import type { Application, ClientSource, Store } from "./domain";
export const WEB_SOURCE_ID = "40000000-0000-4000-8000-000000000001";
export const REAL_ESTATE_SOURCE_ID = "40000000-0000-4000-8000-000000000002";
export const defaultSources = (): ClientSource[] => [
  { id: WEB_SOURCE_ID, name: "garantiaporto.com.uy", archived: false },
  { id: REAL_ESTATE_SOURCE_ID, name: "Negocio inmobiliario", archived: false },
];
export const sourceName = (a: Application, sources: ClientSource[]) =>
  sources.find((s) => s.id === a.source_id)?.name || "Sin identificar";
// Upgrade existing browser data without discarding notes, edits or custom fields.
// A manual capture is not evidence of an estate-agency origin.
export function upgradeStore(s: Store): Store {
  return {
    ...s,
    sources: s.sources ?? defaultSources(),
    applications: s.applications.map((a) => ({
      ...a,
      source_id:
        a.source_id === undefined
          ? a.source === "web"
            ? WEB_SOURCE_ID
            : null
          : a.source_id,
    })),
  };
}
export function approvalGroups(
  apps: Application[],
  key: (a: Application) => string,
) {
  const groups = new Map<
    string,
    { label: string; total: number; approved: number; decided: number }
  >();
  for (const a of apps) {
    const label = key(a);
    const g = groups.get(label) || { label, total: 0, approved: 0, decided: 0 };
    g.total++;
    if (a.decision === "aprobada") g.approved++;
    if (["aprobada", "rechazada"].includes(a.decision)) g.decided++;
    groups.set(label, g);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, rate: g.decided ? g.approved / g.decided : null }))
    .sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1));
}
