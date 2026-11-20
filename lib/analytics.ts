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

// ---- Response times and time to preapproval ----

/** Attention hours from Integraciones: "09:00"–"17:00", ISO weekdays (1 = Monday … 7 = Sunday). */
export type BusinessHours = { start: string; end: string; days: number[] };
export const DEFAULT_HOURS: BusinessHours = {
  start: "09:00",
  end: "17:00",
  days: [1, 2, 3, 4, 5],
};
// Uruguay has used UTC−3 all year since 2015 (no daylight saving).
const UY_SHIFT_MS = -3 * 3600000;
const DAY_MS = 86400000;
const minutesOf = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

/** Minutes between two instants that fall inside the attention hours (Uruguay time). */
export function businessMinutes(from: number, to: number, h: BusinessHours) {
  if (!(to > from)) return 0;
  const open = minutesOf(h.start),
    close = minutesOf(h.end);
  if (close <= open) return 0;
  const a = from + UY_SHIFT_MS,
    b = to + UY_SHIFT_MS;
  const first = Math.floor(a / DAY_MS),
    last = Math.min(Math.floor(b / DAY_MS), first + 730);
  let total = 0;
  for (let day = first; day <= last; day++) {
    const dow = new Date(day * DAY_MS).getUTCDay();
    if (!h.days.includes(dow === 0 ? 7 : dow)) continue;
    const start = day * DAY_MS + open * 60000,
      end = day * DAY_MS + close * 60000;
    total += Math.max(0, Math.min(end, b) - Math.max(start, a));
  }
  return total / 60000;
}

/** Length of one working day, in minutes. */
export const workdayMinutes = (h: BusinessHours) =>
  Math.max(1, minutesOf(h.end) - minutesOf(h.start));

export type ResponseTurn = {
  application_id: string;
  author_id: string | null;
  asked_at: string;
  answered_at: string | null;
};

type TurnMessage = {
  id: string;
  conversation_id: string;
  application_id: string | null;
  direction: "in" | "out";
  author_id: string | null;
  status: string;
  created_at: string;
};

/**
 * Same rule as wa_response_turns (migration 026), for the demo: a client turn starts with the first
 * client message after the team's last reply; the answer is the next message from a team member.
 */
export function responseTurns(messages: TurnMessage[]): ResponseTurn[] {
  const relevant = messages
    .filter(
      (m) =>
        m.application_id &&
        (m.direction === "in" ||
          (m.direction === "out" && m.author_id && m.status !== "failed")),
    )
    .sort(
      (x, y) =>
        x.conversation_id.localeCompare(y.conversation_id) ||
        x.created_at.localeCompare(y.created_at) ||
        x.id.localeCompare(y.id),
    );
  const turns: ResponseTurn[] = [];
  relevant.forEach((m, i) => {
    const prev = relevant[i - 1];
    if (m.direction !== "in") return;
    if (
      prev &&
      prev.conversation_id === m.conversation_id &&
      prev.direction === "in"
    )
      return;
    const reply = relevant
      .slice(i + 1)
      .find(
        (o) => o.conversation_id === m.conversation_id && o.direction === "out",
      );
    turns.push({
      application_id: m.application_id!,
      author_id: reply?.author_id ?? null,
      asked_at: m.created_at,
      answered_at: reply?.created_at ?? null,
    });
  });
  return turns;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b),
    mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};
const mean = (xs: number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

export type TimeStats = {
  count: number;
  /** In working minutes (attention hours). */
  median: number | null;
  average: number | null;
  /** Calendar minutes, nights and weekends included. */
  calendarAverage: number | null;
};
function timeStats(
  pairs: { from: number; to: number }[],
  h: BusinessHours,
): TimeStats {
  const work = pairs.map((p) => businessMinutes(p.from, p.to, h));
  return {
    count: pairs.length,
    median: median(work),
    average: mean(work),
    calendarAverage: mean(pairs.map((p) => (p.to - p.from) / 60000)),
  };
}

/** WhatsApp response time per team member, for client messages within the period. */
export function responseByUser(
  turns: ResponseTurn[],
  h: BusinessHours,
  include: (t: ResponseTurn) => boolean,
) {
  const mine = turns.filter(include);
  const byUser = new Map<string, { from: number; to: number }[]>();
  for (const t of mine) {
    if (!t.author_id || !t.answered_at) continue;
    const list = byUser.get(t.author_id) ?? [];
    list.push({ from: Date.parse(t.asked_at), to: Date.parse(t.answered_at) });
    byUser.set(t.author_id, list);
  }
  const answered = [...byUser.values()].flat();
  return {
    total: timeStats(answered, h),
    unanswered: mine.filter((t) => !t.answered_at).length,
    users: [...byUser].map(([author_id, pairs]) => ({
      author_id,
      ...timeStats(pairs, h),
    })),
  };
}

type StageChange = {
  at: number;
  before: unknown;
  after: unknown;
  actor: string;
};
function guaranteeChanges(
  audits: Audit[],
  applicationId: string,
): StageChange[] {
  return audits
    .filter((ev) => ev.application_id === applicationId)
    .flatMap((ev) => {
      const g = (
        ev.changes as
          Record<string, { before?: unknown; after?: unknown }> | undefined
      )?.guarantee_stage;
      return g && "after" in g
        ? [
            {
              at: Date.parse(ev.created_at),
              before: g.before,
              after: g.after,
              actor: ev.actor_name || "Sin registro",
            },
          ]
        : [];
    })
    .sort((x, y) => x.at - y.at);
}

/**
 * Time from "Recibimos documentación" to "Cargada la preaprobación", from the audited stage changes.
 * Measured from the last time the documents were marked received before the preapproval; attributed
 * to whoever loaded the preapproval. Cases without that history are left out.
 */
export function documentsToPreapproval(
  apps: Application[],
  audits: Audit[],
  h: BusinessHours,
  includeDate: (iso: string) => boolean,
  now: number,
) {
  const done: {
    application_id: string;
    actor: string;
    from: number;
    to: number;
  }[] = [];
  const waiting: { application_id: string; since: number }[] = [];
  for (const a of apps) {
    const changes = guaranteeChanges(audits, a.id);
    let received: number | null = null;
    for (const c of changes) {
      if (c.after === "documentacion_recibida") received = c.at;
      else if (c.after === "preaprobacion_cargada" && received !== null) {
        if (includeDate(new Date(c.at).toISOString()))
          done.push({
            application_id: a.id,
            actor: c.actor,
            from: received,
            to: c.at,
          });
        received = null;
      } else received = null;
    }
    if (
      a.guarantee_stage === "documentacion_recibida" &&
      !a.archived &&
      received !== null
    )
      waiting.push({ application_id: a.id, since: received });
  }
  const byActor = new Map<string, { from: number; to: number }[]>();
  for (const d of done)
    byActor.set(d.actor, [...(byActor.get(d.actor) ?? []), d]);
  return {
    total: timeStats(done, h),
    users: [...byActor].map(([actor, pairs]) => ({
      actor,
      ...timeStats(pairs, h),
    })),
    waiting: {
      count: waiting.length,
      oldest: waiting.length
        ? Math.max(...waiting.map((w) => businessMinutes(w.since, now, h)))
        : null,
    },
  };
}

/** "45 min", "3 h 20 min" or "2,5 días hábiles". */
export function formatWorkTime(minutes: number | null, h: BusinessHours) {
  if (minutes === null) return "Sin datos";
  const day = workdayMinutes(h);
  if (minutes >= day)
    return `${(minutes / day).toLocaleString("es-UY", { maximumFractionDigits: 1 })} días hábiles`;
  if (minutes < 1) return "menos de 1 min";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hh = Math.floor(minutes / 60),
    mm = Math.round(minutes % 60);
  return mm ? `${hh} h ${mm} min` : `${hh} h`;
}

/** Calendar time, for comparison: "50 min", "5 h", "2,1 días". */
export function formatCalendarTime(minutes: number | null) {
  if (minutes === null) return "Sin datos";
  if (minutes < 1) return "menos de 1 min";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  if (minutes < 1440)
    return `${(minutes / 60).toLocaleString("es-UY", { maximumFractionDigits: 1 })} h`;
  return `${(minutes / 1440).toLocaleString("es-UY", { maximumFractionDigits: 1 })} días`;
}
