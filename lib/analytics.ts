import type { Application, Note, Audit } from "./domain";
import { followUp, terminal, pendingIssuance } from "./workflow";
export function summarize(apps: Application[], notes: Note[], now: number) {
  const approved = apps.filter((a) => a.guarantee_stage === "aprobada").length;
  const rejected = apps.filter((a) => a.guarantee_stage === "rechazada").length;
  const firstResponses = apps
    .flatMap((a) => {
      const n = notes
        .filter(
          (n) =>
            n.application_id === a.id &&
            n.kind === "comunicacion" &&
            Date.parse(n.created_at) >= Date.parse(a.created_at),
        )
        .sort((x, y) => x.created_at.localeCompare(y.created_at))[0];
      return n
        ? [(Date.parse(n.created_at) - Date.parse(a.created_at)) / 3600000]
        : [];
    })
    .sort((a, b) => a - b);
  const mid = Math.floor(firstResponses.length / 2);
  return {
    total: apps.length,
    approved,
    issued: apps.filter((a) => Boolean(a.issued_date)).length,
    pendingIssuance: apps.filter(pendingIssuance).length,
    rejected,
    pending: apps.filter((a) => !terminal(a.guarantee_stage)).length,
    approvalRate: approved + rejected ? approved / (approved + rejected) : null,
    conversion: apps.length ? approved / apps.length : null,
    overdue: apps.filter((a) => followUp(a, notes, now)).length,
    responseSample: firstResponses.length,
    medianResponse: firstResponses.length
      ? (firstResponses[mid] +
          firstResponses[Math.floor((firstResponses.length - 1) / 2)]) /
        2
      : null,
  };
}
export function groupedStats(
  apps: Application[],
  key: (a: Application) => string,
  notes: Note[],
  now: number,
) {
  const groups = new Map<string, Application[]>();
  for (const a of apps) {
    const k = key(a);
    groups.set(k, [...(groups.get(k) || []), a]);
  }
  return [...groups]
    .map(([label, rows]) => ({ label, ...summarize(rows, notes, now) }))
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
}

// Only confirmed rejections; missing historical transitions remain explicitly unknown.
export function rejectionStages(apps: Application[], audits: Audit[]) {
  const counts = new Map<string, number>();
  for (const app of apps.filter((a) => a.guarantee_stage === "rechazada")) {
    const transition = audits
      .filter(
        (ev) =>
          ev.application_id === app.id &&
          (
            ev.changes as
              Record<string, { before?: unknown; after?: unknown }> | undefined
          )?.guarantee_stage?.after === "rechazada",
      )
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    const before = (
      transition?.changes as Record<string, { before?: unknown }> | undefined
    )?.guarantee_stage?.before;
    const key = typeof before === "string" ? before : "sin_historial_anterior";
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts].map(([stage, count]) => ({ stage, count }));
}
