import type { Application, Store, Profile, Audit } from "./domain";
export const rejectionReasons = [
  "ingresos_insuficientes",
  "score_insuficiente",
  "documentacion_insuficiente",
  "clearing",
] as const;
export const terminal = (s: string | undefined) =>
  s === "aprobada" || s === "rechazada";
export const todayUy = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Montevideo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export const dateTime = (s: string) =>
  new Intl.DateTimeFormat("es-UY", {
    timeZone: "America/Montevideo",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(s));
export const needsFollowUp = (a: Application, now = Date.now()) =>
  !a.archived && now - Date.parse(a.updated_at || a.created_at) >= 48 * 3600000;
export function validDriveFolder(v: string) {
  if (!v) return true;
  try {
    const u = new URL(v);
    return (
      u.protocol === "https:" &&
      u.hostname === "drive.google.com" &&
      !u.username &&
      !u.password &&
      !u.port &&
      /^\/drive\/(?:u\/\d+\/)?folders\/[A-Za-z0-9_-]+\/?$/.test(u.pathname)
    );
  } catch {
    return false;
  }
}
export function migrateApplication(a: Application): Application {
  return {
    ...a,
    stage: ["nuevo", "en_contacto", "finalizado"].includes(a.stage)
      ? a.stage
      : ["finalizado", "descartado"].includes(a.stage)
        ? "finalizado"
        : "en_contacto",
    guarantee_stage:
      a.guarantee_stage ||
      (terminal(a.decision)
        ? a.decision
        : a.preapproval !== "no_iniciada"
          ? "preaprobacion_cargada"
          : ["completa", "recibida_incompleta"].includes(a.documentation)
            ? "documentacion_recibida"
            : ["solicitada", "pendiente_cliente"].includes(a.documentation)
              ? "documentacion_solicitada"
              : "sin_contactar"),
    requested_date: a.requested_date ?? null,
    drive_folder_url: a.drive_folder_url ?? null,
  };
}
export function changed(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
) {
  return Object.fromEntries(
    Object.entries(after)
      .filter(
        ([k, v]) =>
          !["updated_at", "created_at"].includes(k) &&
          JSON.stringify(before[k] ?? null) !== JSON.stringify(v ?? null),
      )
      .map(([k, v]) => [k, { before: before[k] ?? null, after: v ?? null }]),
  );
}
export function demoMutation(
  s: Store,
  k: keyof Store,
  v: Record<string, unknown>,
  mode: string,
  match: string,
  p: Profile,
): Store {
  const rows = s[k] as unknown as Record<string, unknown>[];
  const matches = (r: Record<string, unknown>) =>
    r[match] === v[match] && (k !== "values" || r.field_id === v.field_id);
  const old = rows.find(matches);
  const next = { ...old, ...v };
  const delta = changed(old || {}, next);
  if (old && !Object.keys(delta).length) return s;
  const now = new Date().toISOString();
  const aid =
    k === "applications"
      ? String(v.id)
      : v.application_id
        ? String(v.application_id)
        : null;
  if (k === "applications") {
    if (!validDriveFolder(String(next.drive_folder_url || "")))
      throw Error("Ingresá un enlace HTTPS a una carpeta de Google Drive.");
    next.updated_at = now;
  }
  const visibility: Audit["visibility"] =
    k === "sensitive"
      ? "admin"
      : k === "clearing"
        ? "clearing"
        : k === "values" && s.fields.find((f) => f.id === v.field_id)?.sensitive
          ? "admin"
          : "case";
  const audit: Audit = {
    id: crypto.randomUUID(),
    application_id: aid!,
    actor_id: p.id,
    actor_name: p.full_name,
    action: `${k}:${old ? "UPDATE" : "INSERT"}`,
    changes: delta,
    visibility,
    created_at: now,
  };
  const updated = old
    ? rows.map((r) => (matches(r) ? next : r))
    : [next, ...rows];
  return {
    ...s,
    [k]: updated,
    ...(k !== "applications" && aid
      ? {
          applications: s.applications.map((a) =>
            a.id === aid ? { ...a, updated_at: now } : a,
          ),
        }
      : {}),
    audits: aid ? [audit, ...s.audits] : s.audits,
  } as Store;
}
